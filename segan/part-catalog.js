/* ============================================================
   segan/part-catalog.js — 「구매 · 재고 › 철물 · 부속 카탈로그」 (segan/me.html #part-catalog)

   2026-11-18 사장님 「키친가이드 사이트 제품들도 정리해서 DB에 넣으려고」 · 「키친가이드, 무림상사, 모아가구 철물 처럼
   회사별로 구분」 · 「구매 · 재고 아래 메뉴로, 다담 공장만 따로 보게」.
   공급 회사마다 파는 상품(씽크볼 · 후드 · 수전 · 쿡탑 · 서랍재 · 레일 · 경첩 · 손잡이 · 하드웨어 · 악세사리 …)을
   사진 · 참고가 · 매입가 · 옵션 · 사양과 함께 본다.

   누가 보나  다담 공장 구성원(account-api GET /partner/me 의 hq_member) · 다담 본사 구성원(platform_member).
             다른 팩토리 · 고객에게는 그려지지 않는다 (묻지도 않는다). segan/me.js 가 업체 칸을 읽은 뒤
             SeganPartCatalog.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message })
               GET   /parts/catalog            { can_manage, vendors[{ id, name, site_url, count }], items[…] }
                                               매입가 · 숨긴 상품은 대표 · 실장에게만 온다. 사진은 서명 주소(한 시간)
               POST  /parts/import             카탈로그 파일의 한 묶음 { vendor, seen_on, items[≤30] } → { added, updated, same, ids }
               POST  /parts/items/:id/photo    사진 바이트
               PATCH /parts/items/:id          { buy_price?(원 | null), active? }
   화면      공급 회사 고르기 → 분류 · 찾기 → 상품 줄(사진 · 이름 · 브랜드 · 분류 · 참고가 · 매입가) → 펼치면 옵션 · 추가상품 · 사양.
             대표 · 실장: 매입가 적기 · 숨기기/다시 쓰기 · 「카탈로그 파일 올리기」(.json — 상품을 30개씩, 사진을 하나씩 올린다.
             같은 파일을 다시 올리면 달라진 것만 고치고 이미 있는 사진은 건너뛴다).
   없는 것    지우기 (서버에 없다 — 숨기기만) · 공급 회사 이름 고치기.
   못 읽으면  칸째 감춘다 (오류 · 끊김 · 권한 없음 · DB 적용 전). 바꾸기가 안 되면 서버 글을 그 자리에 적는다.
   정보      고객 정보는 없다. 매입가는 화면에만 그린다 — 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch, FileReader, atob */
(function () {
  'use strict';

  var FORMAT = 'segan-part-catalog/1'; // 카탈로그 파일의 꼴
  var IMPORT_CHUNK = 30; // workflow-api part-catalog.js PART_IMPORT_MAX 와 같다
  var FILE_MAX_BYTES = 40 * 1024 * 1024;
  var PAGE = 60; // 한 번에 그리는 상품 줄 — 「더 보기」로 늘린다
  var PRICE_MAX = 100000000;

  var TEXT = {
    title: '철물 · 부속 카탈로그',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    empty: '아직 넣은 상품이 없습니다.',
    emptyManage: '아직 넣은 상품이 없습니다. 「카탈로그 파일 올리기」로 넣습니다.',
    none: '여기에 맞는 상품이 없습니다.',
    all: '전체',
    allCats: '분류 모두',
    find: '이름 · 브랜드 · 옵션에서 찾기',
    ref: '참고가',
    buy: '매입가',
    noPrice: '가격 없음',
    more: '더 보기',
    hide: '숨기기',
    unhide: '다시 쓰기',
    hidden: '숨김',
    unchecked: '사양 확인 전',
    upload: '카탈로그 파일 올리기',
    badFile: '카탈로그 파일(.json)이 아닙니다.',
    bigFile: '파일이 너무 큽니다 (40MB 까지).',
    options: '옵션',
    addons: '추가상품',
    specs: '사양',
    size: '크기',
    source: '원래 상품 쪽',
    soldout: '품절',
    saved: '저장했습니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false,
    canManage: false,
    vendors: [],
    items: [],
    vendor: '',
    cat: '',
    q: '',
    shown: PAGE,
    open: {},
    busy: false,
    msg: '',
    err: '',
    progress: '',
  };

  function $(id) {
    return document.getElementById(id);
  }
  function str(v) {
    return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  }
  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function won(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function httpsOf(u) {
    var s = str(u).trim();
    return /^https:\/\//.test(s) ? s : '';
  }
  function intOrNull(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  /** 이 칸을 읽어 볼 사람인가 — 다담 공장 구성원 · 다담 본사 구성원. 다른 팩토리에는 묻지도 않는다 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    return me.hq_member === true || me.platform_member === true;
  }

  /** 서버가 준 상품 하나 — 이름 없는 줄은 버린다 */
  function itemOf(v) {
    var r = obj(v);
    var id = str(r.id);
    var name = str(r.name).trim();
    if (!id || !name) return null;
    return {
      id: id,
      vendor_id: str(r.vendor_id),
      vendor_item_no: str(r.vendor_item_no),
      category: str(r.category).trim(),
      sub_category: str(r.sub_category).trim(),
      brand: str(r.brand).trim(),
      name: name,
      ref_price: intOrNull(r.ref_price),
      ref_price_on: str(r.ref_price_on),
      buy_price: intOrNull(r.buy_price),
      buy_price_on: str(r.buy_price_on),
      options: (Array.isArray(r.options) ? r.options : []).map(obj).filter(function (o) {
        return str(o.l);
      }),
      addons: (Array.isArray(r.addons) ? r.addons : []).map(obj).filter(function (o) {
        return str(o.l);
      }),
      specs: obj(r.specs),
      specs_checked: r.specs_checked === true,
      width_mm: intOrNull(r.width_mm),
      depth_mm: intOrNull(r.depth_mm),
      height_mm: intOrNull(r.height_mm),
      source_url: httpsOf(r.source_url),
      note: str(r.note).trim(),
      photo_url: httpsOf(r.photo_url),
      has_photo: r.has_photo === true,
      active: r.active !== false,
    };
  }

  /** 서버 답 → { canManage, vendors, items } — 모양이 아니면 null */
  function catalogOf(data) {
    var d = obj(data);
    if (!Array.isArray(d.vendors) || !Array.isArray(d.items)) return null;
    return {
      canManage: d.can_manage === true,
      vendors: d.vendors.map(obj).filter(function (v) {
        return str(v.id) && str(v.name);
      }).map(function (v) {
        return { id: str(v.id), name: str(v.name), site_url: httpsOf(v.site_url), count: intOrNull(v.count) || 0 };
      }),
      items: d.items.map(itemOf).filter(Boolean),
    };
  }

  function hayOf(it) {
    return (
      it.name + ' ' + it.brand + ' ' + it.category + ' ' + it.sub_category + ' ' + it.vendor_item_no + ' ' +
      it.options.map(function (o) {
        return str(o.l);
      }).join(' ')
    ).toLowerCase();
  }

  /** 고른 공급 회사 · 분류 · 찾는 말에 맞는 상품 */
  function filtered() {
    var q = J.q.trim().toLowerCase();
    return J.items.filter(function (it) {
      if (J.vendor && it.vendor_id !== J.vendor) return false;
      if (J.cat && it.category !== J.cat) return false;
      return !q || hayOf(it).indexOf(q) >= 0;
    });
  }

  /** 고른 공급 회사의 분류와 그 수 (이름 차례) */
  function catsOf() {
    var m = {};
    J.items.forEach(function (it) {
      if (J.vendor && it.vendor_id !== J.vendor) return;
      var c = it.category || '';
      m[c] = (m[c] || 0) + 1;
    });
    return Object.keys(m).sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    }).map(function (c) {
      return { name: c, count: m[c] };
    });
  }

  /** 카탈로그 파일 글 → { vendor, seen_on, items } — 꼴이 아니면 null */
  function fileOf(textValue) {
    var d = null;
    try {
      d = JSON.parse(textValue);
    } catch {
      return null;
    }
    d = obj(d);
    var v = obj(d.vendor);
    if (d.format !== FORMAT || !str(v.name).trim() || !Array.isArray(d.items) || !d.items.length) return null;
    return {
      vendor: { name: str(v.name).trim(), site_url: httpsOf(v.site_url) },
      seen_on: /^\d{4}-\d{2}-\d{2}$/.test(str(d.seen_on)) ? str(d.seen_on) : '',
      items: d.items.map(obj),
    };
  }

  /** 파일의 상품 하나 → 서버에 보낼 모양 (사진은 따로 올린다) */
  function importBodyOf(it) {
    var out = {};
    ['vendor_item_no', 'category', 'sub_category', 'brand', 'name', 'ref_price', 'options', 'addons', 'specs', 'width_mm', 'depth_mm', 'height_mm', 'source_url', 'note'].forEach(function (k) {
      if (it[k] !== undefined && it[k] !== null) out[k] = it[k];
    });
    return out;
  }

  /** 파일의 사진 글(data:image/…;base64,…) → 바이트. 꼴이 아니면 null */
  function photoBytesOf(dataUrl) {
    var m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(str(dataUrl));
    if (!m) return null;
    try {
      var bin = atob(m[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    } catch {
      return null;
    }
  }

  async function token() {
    try {
      var r = J.sb && (await J.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return J.session ? J.session.access_token : '';
  }

  async function call(method, path, body, raw) {
    if (!J.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body && !raw) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = 'application/octet-stream';
    var res;
    try {
      res = await fetch(J.base + path, {
        method: method,
        headers: headers,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      return { ok: false, status: 0, body: {} };
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    return { ok: res.ok && b.success === true, status: res.status, body: b };
  }

  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  function box() {
    return $('partCatalog');
  }

  function showSection() {
    var b = box();
    var sec = $('partner');
    if (sec && b && !b.hidden) sec.hidden = false;
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    J.ready = false;
  }

  function vendorName(id) {
    for (var i = 0; i < J.vendors.length; i++) if (J.vendors[i].id === id) return J.vendors[i].name;
    return '';
  }

  function detailHtml(it) {
    var h = '';
    var g = null;
    if (it.options.length) {
      h += '<p class="pc-k">' + esc(TEXT.options) + '</p><ul class="pc-opts">';
      it.options.forEach(function (o) {
        var grp = str(o.g);
        if (grp !== g) {
          g = grp;
          if (grp) h += '<li class="pc-g">' + esc(grp) + '</li>';
        }
        var d = typeof o.d === 'number' && o.d !== 0 ? (o.d > 0 ? '+' : '−') + won(Math.abs(o.d)) : '';
        h += '<li><span>' + esc(o.l) + (o.x === true ? ' (' + esc(TEXT.soldout) + ')' : '') + '</span><span>' + esc(d) + '</span></li>';
      });
      h += '</ul>';
    }
    if (it.addons.length) {
      h += '<p class="pc-k">' + esc(TEXT.addons) + '</p><ul class="pc-opts">';
      it.addons.forEach(function (a) {
        h += '<li><span>' + esc(a.l) + '</span><span>' + (typeof a.p === 'number' ? '+' + esc(won(a.p)) : '') + '</span></li>';
      });
      h += '</ul>';
    }
    var size = [it.width_mm, it.depth_mm, it.height_mm];
    var keys = Object.keys(it.specs);
    if (keys.length || size.some(function (n) { return n !== null; })) {
      h += '<p class="pc-k">' + esc(TEXT.specs) + (it.specs_checked ? '' : ' <span class="pc-tag">' + esc(TEXT.unchecked) + '</span>') + '</p><ul class="pc-opts">';
      if (size.some(function (n) { return n !== null; })) {
        h += '<li><span>' + esc(TEXT.size) + ' (폭 × 깊이 × 높이 mm)</span><span>' + esc(size.map(function (n) { return n === null ? '–' : n; }).join(' × ')) + '</span></li>';
      }
      keys.forEach(function (k) {
        h += '<li><span>' + esc(k) + '</span><span>' + esc(it.specs[k]) + '</span></li>';
      });
      h += '</ul>';
    }
    if (it.note) h += '<p class="pc-note">' + esc(it.note) + '</p>';
    if (it.source_url) h += '<p class="pc-note"><a href="' + esc(it.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(TEXT.source) + '</a></p>';
    return h;
  }

  function rowHtml(it) {
    var meta = [it.brand, [it.category, it.sub_category].filter(Boolean).join(' › '), J.vendor ? '' : vendorName(it.vendor_id)].filter(Boolean).join(' · ');
    var bits = [];
    if (it.options.length) bits.push(TEXT.options + ' ' + it.options.length);
    if (it.addons.length) bits.push(TEXT.addons + ' ' + it.addons.length);
    if (Object.keys(it.specs).length || it.width_mm !== null) bits.push(TEXT.specs);
    var detail = detailHtml(it);
    var h = '<li class="pc-row' + (it.active ? '' : ' is-off') + '" data-pc-item="' + esc(it.id) + '">';
    h += it.photo_url
      ? '<img class="pc-ph" src="' + esc(it.photo_url) + '" alt="" loading="lazy" width="72" height="72">'
      : '<span class="pc-ph" aria-hidden="true"></span>';
    h += '<div class="pc-info"><p class="pc-name">' + esc(it.name) + (it.active ? '' : ' <span class="pc-tag">' + esc(TEXT.hidden) + '</span>') + '</p>';
    if (meta) h += '<p class="pc-meta">' + esc(meta) + '</p>';
    // 펼칠 것이 원래 상품 쪽 링크뿐이면 링크만 그린다
    if (detail && !bits.length && !it.note) h += detail;
    else if (detail) {
      h += '<details class="pc-det"' + (J.open[it.id] ? ' open' : '') + ' data-pc-det="' + esc(it.id) + '"><summary>' + esc(bits.join(' · ') || TEXT.source) + '</summary>' + detail + '</details>';
    }
    h += '</div><div class="pc-money"><p><span class="pc-k">' + esc(TEXT.ref) + '</span> ' + (it.ref_price === null ? '<span class="pc-none">' + esc(TEXT.noPrice) + '</span>' : esc(won(it.ref_price))) + '</p>';
    if (J.canManage) {
      h += '<label class="pc-buy"><span class="pc-k">' + esc(TEXT.buy) + '</span> <input type="text" inputmode="numeric" data-pc-buy="' + esc(it.id) + '" value="' + (it.buy_price === null ? '' : esc(it.buy_price.toLocaleString('ko-KR'))) + '" aria-label="' + esc(it.name + ' ' + TEXT.buy) + '"' + (J.busy ? ' disabled' : '') + '></label>';
      h += '<button type="button" class="pc-btn" data-pc-toggle="' + esc(it.id) + '"' + (J.busy ? ' disabled' : '') + '>' + esc(it.active ? TEXT.hide : TEXT.unhide) + '</button>';
    }
    return h + '</div></li>';
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    var list = filtered();
    var cats = catsOf();
    var h = '<h3 class="me-pt-sub" id="partCatalogTitle">' + esc(TEXT.title) + '</h3>';
    if (!J.items.length) {
      h += '<p class="mk-note">' + esc(J.canManage ? TEXT.emptyManage : TEXT.empty) + '</p>';
    } else {
      h += '<div class="pc-chips" role="group" aria-label="공급 회사">';
      h += '<button type="button" class="pc-chip" data-pc-vendor="" aria-pressed="' + (J.vendor ? 'false' : 'true') + '">' + esc(TEXT.all) + ' ' + J.items.length + '</button>';
      J.vendors.forEach(function (v) {
        h += '<button type="button" class="pc-chip" data-pc-vendor="' + esc(v.id) + '" aria-pressed="' + (J.vendor === v.id ? 'true' : 'false') + '">' + esc(v.name) + ' ' + v.count + '</button>';
      });
      h += '</div><div class="pc-tools"><input type="search" id="partCatalogFind" value="' + esc(J.q) + '" placeholder="' + esc(TEXT.find) + '" aria-label="' + esc(TEXT.find) + '">';
      h += '<select id="partCatalogCat" aria-label="분류"><option value="">' + esc(TEXT.allCats) + '</option>';
      cats.forEach(function (c) {
        h += '<option value="' + esc(c.name) + '"' + (J.cat === c.name ? ' selected' : '') + '>' + esc((c.name || '분류 없음') + ' ' + c.count) + '</option>';
      });
      h += '</select></div>';
    }
    if (J.canManage) {
      h += '<div class="pc-bar"><label class="pc-btn pc-file">' + esc(TEXT.upload) + '<input type="file" id="partCatalogFile" accept=".json,application/json"' + (J.busy ? ' disabled' : '') + '></label>';
      if (J.progress) h += '<span class="pc-progress" role="status">' + esc(J.progress) + '</span>';
      h += '</div>';
    }
    if (J.err) h += '<p class="pc-err" role="alert">' + esc(J.err) + '</p>';
    else if (J.msg) h += '<p class="pc-msg" role="status">' + esc(J.msg) + '</p>';
    if (J.items.length) {
      h += '<p class="pc-count">' + list.length + '개</p>';
      if (!list.length) h += '<p class="mk-note">' + esc(TEXT.none) + '</p>';
      else {
        h += '<ul class="pc-list">' + list.slice(0, J.shown).map(rowHtml).join('') + '</ul>';
        if (list.length > J.shown) h += '<button type="button" class="pc-btn pc-more" data-pc-more>' + esc(TEXT.more) + ' (' + (list.length - J.shown) + ')</button>';
      }
    }
    b.innerHTML = h;
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    showSection();
  }

  async function reload() {
    var r = await call('GET', '/parts/catalog');
    var c = r.ok ? catalogOf(r.body.data) : null;
    if (!c) return false;
    J.canManage = c.canManage;
    J.vendors = c.vendors;
    J.items = c.items;
    if (J.vendor && !vendorName(J.vendor)) J.vendor = '';
    return true;
  }

  function itemById(id) {
    for (var i = 0; i < J.items.length; i++) if (J.items[i].id === id) return J.items[i];
    return null;
  }

  /** 매입가 칸의 글 → 원 (빈 글 = null, 틀리면 undefined) */
  function buyOf(textValue) {
    var s = str(textValue).replace(/[,\s원]/g, '');
    if (!s) return null;
    if (!/^\d+$/.test(s)) return undefined;
    var n = Number(s);
    return n <= PRICE_MAX ? n : undefined;
  }

  async function patch(id, body) {
    var it = itemById(id);
    if (!it || J.busy) return;
    J.busy = true;
    J.err = '';
    J.msg = '';
    var r = await call('PATCH', '/parts/items/' + encodeURIComponent(id), body);
    J.busy = false;
    var next = r.ok ? itemOf(obj(r.body.data).item) : null;
    if (next) {
      J.items[J.items.indexOf(it)] = next;
      J.msg = TEXT.saved;
    } else J.err = errText(r);
    render();
  }

  /** 카탈로그 파일 올리기 — 상품을 30개씩, 그다음 사진을 하나씩 (이미 있는 사진은 건너뛴다) */
  async function upload(file) {
    if (!file || J.busy || !J.canManage) return;
    J.err = '';
    J.msg = '';
    if (file.size > FILE_MAX_BYTES) {
      J.err = TEXT.bigFile;
      render();
      return;
    }
    var textValue = await new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(str(fr.result));
      };
      fr.onerror = function () {
        resolve('');
      };
      fr.readAsText(file);
    });
    var f = fileOf(textValue);
    if (!f) {
      J.err = TEXT.badFile;
      render();
      return;
    }
    J.busy = true;
    var sum = { added: 0, updated: 0, same: 0, photos: 0, photoFail: 0 };
    var ids = {};
    for (var i = 0; i < f.items.length; i += IMPORT_CHUNK) {
      J.progress = '상품 ' + Math.min(i + IMPORT_CHUNK, f.items.length) + ' / ' + f.items.length;
      render();
      var body = { vendor: f.vendor, items: f.items.slice(i, i + IMPORT_CHUNK).map(importBodyOf) };
      if (f.seen_on) body.seen_on = f.seen_on;
      var r = await call('POST', '/parts/import', body);
      if (!r.ok) {
        J.busy = false;
        J.progress = '';
        J.err = errText(r) + ' (' + (i + 1) + '번째 묶음부터 올리지 못했습니다)';
        await reload();
        render();
        return;
      }
      var d = obj(r.body.data);
      sum.added += intOrNull(d.added) || 0;
      sum.updated += intOrNull(d.updated) || 0;
      sum.same += intOrNull(d.same) || 0;
      var got = obj(d.ids);
      Object.keys(got).forEach(function (k) {
        ids[k] = obj(got[k]);
      });
    }
    var todo = f.items.filter(function (it) {
      var hit = ids[str(it.vendor_item_no) || str(it.name).replace(/\s+/g, ' ').trim().toLowerCase()];
      return str(it.photo) && hit && hit.id && hit.has_photo !== true;
    });
    for (var k = 0; k < todo.length; k++) {
      J.progress = '사진 ' + (k + 1) + ' / ' + todo.length;
      if (k % 5 === 0) render();
      var it = todo[k];
      var bytes = photoBytesOf(it.photo);
      var hit = ids[str(it.vendor_item_no) || str(it.name).replace(/\s+/g, ' ').trim().toLowerCase()];
      var pr = bytes ? await call('POST', '/parts/items/' + encodeURIComponent(hit.id) + '/photo', bytes, true) : { ok: false };
      if (pr.ok) sum.photos += 1;
      else sum.photoFail += 1;
    }
    J.busy = false;
    J.progress = '';
    await reload();
    J.msg = '올렸습니다 — 새 상품 ' + sum.added + ' · 고침 ' + sum.updated + ' · 그대로 ' + sum.same + ' · 사진 ' + sum.photos + (sum.photoFail ? ' (사진 ' + sum.photoFail + '개는 올리지 못했습니다 — 같은 파일을 다시 올리면 이어서 올립니다)' : '');
    render();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-pc-bound') === '1') return;
    b.setAttribute('data-pc-bound', '1');
    b.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-pc-vendor],[data-pc-toggle],[data-pc-more]') : null;
      if (!t || !b.contains(t)) return;
      if (t.hasAttribute('data-pc-vendor')) {
        J.vendor = t.getAttribute('data-pc-vendor') || '';
        J.cat = '';
        J.shown = PAGE;
        render();
      } else if (t.hasAttribute('data-pc-more')) {
        J.shown += PAGE;
        render();
      } else {
        var it = itemById(t.getAttribute('data-pc-toggle'));
        if (it) patch(it.id, { active: !it.active });
      }
    });
    b.addEventListener('toggle', function (e) {
      var d = e.target;
      if (d && d.getAttribute && d.getAttribute('data-pc-det')) J.open[d.getAttribute('data-pc-det')] = d.open === true;
    }, true);
    var findTimer = null;
    b.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'partCatalogFind') return;
      J.q = e.target.value;
      clearTimeout(findTimer);
      findTimer = setTimeout(function () {
        J.shown = PAGE;
        render();
        var el = $('partCatalogFind');
        if (el) {
          el.focus();
          try {
            el.setSelectionRange(el.value.length, el.value.length);
          } catch {
            /* 고르기를 모르는 입력 칸 */
          }
        }
      }, 200);
    });
    b.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'partCatalogCat') {
        J.cat = t.value;
        J.shown = PAGE;
        render();
      } else if (t.id === 'partCatalogFile') {
        upload(t.files && t.files[0]);
      } else if (t.getAttribute && t.getAttribute('data-pc-buy')) {
        var it = itemById(t.getAttribute('data-pc-buy'));
        var n = buyOf(t.value);
        if (!it) return;
        if (n === undefined) {
          J.err = '매입가는 숫자(원)로 적습니다.';
          J.msg = '';
          render();
        } else if (n !== it.buy_price) patch(it.id, { buy_price: n });
      }
    });
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.me = me || null;
    J.vendors = [];
    J.items = [];
    J.vendor = '';
    J.cat = '';
    J.q = '';
    J.shown = PAGE;
    J.open = {};
    J.msg = '';
    J.err = '';
    J.progress = '';
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reload())) return;
      bind();
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganPartCatalog = {
    FORMAT: FORMAT,
    IMPORT_CHUNK: IMPORT_CHUNK,
    TEXT: TEXT,
    canSee: canSee,
    itemOf: itemOf,
    catalogOf: catalogOf,
    fileOf: fileOf,
    importBodyOf: importBodyOf,
    photoBytesOf: photoBytesOf,
    buyOf: buyOf,
    state: J,
    load: load,
  };
})();
