/* ============================================================
   segan/collection-view.js — 시공사례 사진 한 장 (타일 · 사진 보기 · 좋아요) — window.SeganPostView

   시공사례 탭(segan/collection.js)과 마이페이지 「좋아요」(segan/me.js #likes)가 같이 쓴다.

   사진 한 장 (post) — 화면이 쓰는 모양 하나로 맞춘다
     DB 게시물   collection_posts 의 id · image_url · place_label · door_color · company_id · like_count · source · created_at
                 + 업체 이름 RPC collection_post_companies (본사 · 활동 중 협력업체만 — DB 0049)
     내 좋아요   RPC collection_my_likes 한 줄 (업체 이름이 같이 온다)
     자체 시공   segan/collection.js STATIC (id 가 없다 — 좋아요 없음). 업체는 「다담가구」, 장소는 지역,
                 타일은 가벼운 사본(app/portfolio/display/), 크게 볼 때는 원본
   글 규칙
     업체  업체 이름 → 없고 AI 연출컷(source 'ai_render')이면 「AI 연출컷」 → 아니면 그 줄을 보이지 않는다
           (직접 올린 사진에 「다담가구」를 붙이지 않는다 — 누구의 일인지는 DB company_id 가 정한다)
     장소  place_label (비면 줄 없음) · 색상 door_color (비면 줄 없음)
     AI 연출컷은 타일 귀퉁이에 「AI」, 사진 보기 제목도 「AI 연출컷」 — 실제 시공 사진으로 오해하지 않게
   「이 스타일로 연출컷」 — 만들기(./)를 그 사진을 참고 사진으로 담고 연다 (segan/make.js takeLinkRefs)
     DB 게시물 ./?ref=<게시물 id> · 자체 시공 ./?ref=<파일 이름> · AI 연출컷은 단추 없음 (만들기가 AI 연출컷 ref 를 건너뛴다)
   사진 보기 — SeganShell.sheet kind 'sheet' (폰 아래 시트 · PC 1100px~ 오른쪽 옆 패널, 뒤로 가기가 닫는다, 주소 그대로)
   좋아요 (♡ — aria-pressed) — 로그인한 사람만, 본인 줄만 (DB 0049 RLS)
     누르기  collection_likes insert { user_id, post_id } (이미 있으면 23505 — 좋아한 것으로 본다)
     풀기    collection_likes delete .eq('post_id', id)
     숫자는 먼저 바꿔 보이고, 실패하면 되돌린다. 로그인 전이면 가운데 작은 창으로 로그인을 권한다 (kind 'dialog')
   이미지는 img loading="lazy" + width · height (자리를 먼저 잡는다). 다운로드 단추 · 링크는 두지 않는다 —
   길게 눌러 저장 · 끌기 · 오른쪽 단추 메뉴도 막는다 (예전 배경 그림과 같은 정도)
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var TEXT = {
    ai: 'AI 연출컷',
    title: '시공사례',
    hq: '다담가구', // 자체 시공 사진(STATIC) — 다담가구가 시공한 사진
    place: '장소',
    color: '색상',
    company: '업체',
    like: '좋아요',
    make: '이 스타일로 연출컷',
    open: '크게 보기',
    likeFail: '좋아요를 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
    loginTitle: '로그인',
    loginBody: '로그인하면 좋아요를 저장할 수 있습니다',
    login: '로그인',
  };
  var STATIC_FULL = '../app/portfolio/';
  var STATIC_THUMB = '../app/portfolio/display/'; // 같은 사진의 가벼운 사본 (segan/make.js refThumb 와 같다)
  var TILE = 400; // 타일 img width · height — 정사각 칸 (CSS 가 칸 폭에 맞춘다)
  var COMPANY_IDS = 100; // collection_post_companies 가 받는 앞 100개 (DB 0049)
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var STEM_RE = /^[a-z0-9-]{1,40}$/i; // segan/make.js STATIC_STEM_RE 와 같다
  var HEART =
    '<svg class="pv-heart" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // ── 사진 한 장 ─────────────────────────────────────────
  /** DB 게시물 한 줄 + 업체({ company_name, company_kind } — collection_post_companies) */
  function fromRow(row, company) {
    var c = company && typeof company === 'object' ? company : {};
    return {
      id: str(row.id),
      image_url: str(row.image_url),
      thumb: str(row.image_url),
      place_label: str(row.place_label),
      door_color: str(row.door_color),
      // 본사(다담) 일은 고객에게 「다담가구」로 보인다 — DB 의 본사 업체 이름(다담 공장)은 내부 이름
      company_name: str(c.company_kind) === 'hq' ? TEXT.hq : str(c.company_name),
      company_kind: str(c.company_kind),
      source: str(row.source) || 'upload',
      like_count: num(row.like_count),
      created_at: row.created_at || null,
      stem: '',
    };
  }

  /** collection_my_likes 한 줄 — 업체 이름이 같이 온다 (liked_at 은 다음 쪽을 묻는 데 쓴다) */
  function fromLike(row) {
    var p = fromRow(
      {
        id: row.post_id,
        image_url: row.image_url,
        place_label: row.place_label,
        door_color: row.door_color,
        like_count: row.like_count,
        source: row.source,
        created_at: row.created_at,
      },
      { company_name: row.company_name, company_kind: row.company_kind }
    );
    p.liked_at = row.liked_at || null;
    return p;
  }

  /** 자체 시공 사진 (segan/collection.js STATIC — { image_url: '../app/portfolio/<이름>.jpg', region }) */
  function fromStatic(s) {
    var file = String(s.image_url || '').replace(/^.*\//, '');
    var stem = file.replace(/\.jpg$/i, '');
    return {
      id: '',
      image_url: STATIC_FULL + file,
      thumb: STATIC_THUMB + file,
      place_label: str(s.region),
      door_color: '',
      company_name: TEXT.hq,
      company_kind: 'hq',
      source: 'upload',
      like_count: 0,
      created_at: null,
      stem: STEM_RE.test(stem) ? stem : '',
    };
  }

  /** 화면 글 — { ai, title, company, place, color } (규칙은 머리말) */
  function labels(p) {
    var ai = p.source === 'ai_render';
    return {
      ai: ai,
      title: ai ? TEXT.ai : TEXT.title,
      company: p.company_name || (ai ? TEXT.ai : ''),
      place: p.place_label || '',
      color: p.door_color || '',
    };
  }

  /** 사진 이름 (타일 단추 · 사진 대체 글) — 「시공사례 · 인천 연수구 · 주방 · 다담가구」 */
  function nameOf(p) {
    var l = labels(p);
    var parts = [l.title];
    if (l.place) parts.push(l.place);
    if (l.company && l.company !== l.title) parts.push(l.company);
    return parts.join(' · ');
  }

  /** 「이 스타일로 연출컷」 주소 — AI 연출컷 · 모르는 것은 '' (단추 없음) */
  function refHref(p) {
    if (!p || p.source === 'ai_render') return '';
    if (p.id && UUID_RE.test(p.id)) return './?ref=' + encodeURIComponent(p.id);
    if (!p.id && p.stem) return './?ref=' + encodeURIComponent(p.stem);
    return '';
  }

  /** 타일 하나 — 누르면 크게 (data-open = 목록 안 차례) */
  function tileHTML(p, i) {
    var l = labels(p);
    return (
      '<button type="button" class="cl-tile' +
      (l.ai ? ' cl-tile--ai' : '') +
      '" data-open="' +
      i +
      '" aria-label="' +
      esc(nameOf(p) + ' ' + TEXT.open) +
      '"><img src="' +
      esc(p.thumb || p.image_url) +
      '" alt="" width="' +
      TILE +
      '" height="' +
      TILE +
      '" loading="lazy" decoding="async" draggable="false" />' +
      (l.ai ? '<span class="cl-mark" aria-hidden="true">AI</span>' : '') +
      '</button>'
    );
  }

  // ── 서버 ───────────────────────────────────────────────
  /** 업체 이름 — 게시물 id → { company_name, company_kind }. 못 읽으면 빈 표 (업체 줄만 빠진다) */
  async function companies(sb, ids) {
    var out = {};
    var list = (ids || []).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    if (!sb || !list.length) return out;
    for (var i = 0; i < list.length; i += COMPANY_IDS) {
      try {
        var res = await sb.rpc('collection_post_companies', {
          p_post_ids: list.slice(i, i + COMPANY_IDS),
        });
        if (!res || res.error || !Array.isArray(res.data)) continue;
        res.data.forEach(function (r) {
          if (r && r.post_id && str(r.company_name))
            out[r.post_id] = {
              company_name: str(r.company_name),
              company_kind: str(r.company_kind),
            };
        });
      } catch {
        /* 업체 줄 없이 그린다 */
      }
    }
    return out;
  }

  /** 이 중 내가 좋아한 것 — 게시물 id → true (본인 줄만 읽힌다). 로그인 전 · 실패면 빈 표 */
  async function myLikes(sb, userId, ids) {
    var out = {};
    var list = (ids || []).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    if (!sb || !userId || !list.length) return out;
    try {
      var res = await sb.from('collection_likes').select('post_id').in('post_id', list);
      if (res && !res.error && Array.isArray(res.data))
        res.data.forEach(function (r) {
          if (r && r.post_id) out[r.post_id] = true;
        });
    } catch {
      /* 빈 ♡ 로 그린다 */
    }
    return out;
  }

  /** 좋아요 넣기 · 빼기 → { ok } (이미 좋아한 줄이면 23505 — 넣은 것으로 본다) */
  async function setLike(sb, userId, postId, on) {
    if (!sb || !userId || !UUID_RE.test(String(postId || ''))) return { ok: false };
    try {
      var res = on
        ? await sb.from('collection_likes').insert({ user_id: userId, post_id: postId })
        : await sb.from('collection_likes').delete().eq('post_id', postId);
      if (res && res.error) return { ok: on && res.error.code === '23505' };
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ── 사진 보기 ──────────────────────────────────────────
  function sheetApi() {
    var Shell = window.SeganShell;
    return Shell && Shell.sheet ? Shell.sheet : null;
  }

  /** 로그인 전에 ♡ — 가운데 작은 창 (로그인 단추 = 돌아올 곳 loginHref) */
  function askLogin(loginHref) {
    var sheet = sheetApi();
    if (!sheet) return null;
    var box = document.createElement('div');
    box.className = 'pv-login';
    box.innerHTML =
      '<p class="sg-note">' +
      esc(TEXT.loginBody) +
      '</p><a class="sg-btn" href="' +
      esc(loginHref || '../login.html') +
      '">' +
      esc(TEXT.login) +
      '</a>';
    return sheet.open({ kind: 'dialog', title: TEXT.loginTitle, body: box });
  }

  function factHTML(label, value) {
    return value ? '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
  }

  /** 누른 타일의 그림 크기 (받아 둔 것) — 크게 볼 자리를 먼저 잡는다. 모르면 정사각 */
  function sizeOf(img) {
    var w = img && img.complete ? img.naturalWidth : 0;
    var h = img && img.complete ? img.naturalHeight : 0;
    return w > 0 && h > 0 ? { w: w, h: h } : { w: 1, h: 1 };
  }

  /**
   * 사진 보기를 연다.
   * @param {object} p  사진 한 장 (fromRow · fromLike · fromStatic)
   * @param {{ sb?, userId?: string, liked?: boolean, loginHref?: string, img?: Element,
   *           onLike?: function(object, boolean), onClose?: function(string) }} o
   * @returns 시트 손잡이 (SeganShell.sheet.open) — 셸이 없으면 null
   */
  function open(p, o) {
    o = o || {};
    var sheet = sheetApi();
    if (!sheet || !p) return null;
    var l = labels(p);
    var size = sizeOf(o.img);
    var st = { liked: !!o.liked, count: num(p.like_count), busy: false };
    var canLike = !!p.id && UUID_RE.test(p.id);
    var href = refHref(p);

    var box = document.createElement('article');
    box.className = 'pv';
    box.innerHTML =
      '<div class="pv-photo" style="aspect-ratio: ' +
      size.w +
      ' / ' +
      size.h +
      '"><img src="' +
      esc(p.image_url || p.thumb) +
      '" alt="' +
      esc(nameOf(p)) +
      '" width="' +
      size.w +
      '" height="' +
      size.h +
      '" decoding="async" draggable="false" /></div>' +
      (canLike
        ? '<div class="pv-bar"><button type="button" class="pv-like" aria-pressed="false">' +
          HEART +
          '<span class="pv-like-text">' +
          esc(TEXT.like) +
          '</span> <span class="pv-count"></span></button></div>' +
          '<p class="pv-error" role="alert" hidden></p>'
        : '') +
      '<dl class="pv-facts">' +
      factHTML(TEXT.place, l.place) +
      factHTML(TEXT.color, l.color) +
      factHTML(TEXT.company, l.company) +
      '</dl>' +
      (href ? '<a class="sg-btn pv-make" href="' + esc(href) + '">' + esc(TEXT.make) + '</a>' : '');
    var facts = box.querySelector('.pv-facts');
    if (facts && !facts.children.length) facts.parentNode.removeChild(facts);
    guardImages(box);

    var btn = box.querySelector('.pv-like');
    var err = box.querySelector('.pv-error');
    function paint() {
      if (!btn) return;
      btn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      btn.querySelector('.pv-count').textContent = String(st.count);
    }
    paint();
    if (btn)
      btn.addEventListener('click', async function () {
        if (!o.userId) {
          askLogin(o.loginHref);
          return;
        }
        if (st.busy) return;
        st.busy = true;
        btn.setAttribute('aria-busy', 'true');
        if (err) err.hidden = true;
        var next = !st.liked;
        st.liked = next;
        st.count = Math.max(0, st.count + (next ? 1 : -1));
        paint();
        var r = await setLike(o.sb, o.userId, p.id, next);
        if (!r.ok) {
          st.liked = !next;
          st.count = Math.max(0, st.count + (next ? -1 : 1));
          paint();
          if (err) {
            err.textContent = TEXT.likeFail;
            err.hidden = false;
          }
        } else {
          p.like_count = st.count;
          if (typeof o.onLike === 'function') o.onLike(p, st.liked);
        }
        st.busy = false;
        btn.removeAttribute('aria-busy');
      });

    return sheet.open({
      kind: 'sheet',
      title: l.title,
      body: box,
      onClose: function (why) {
        if (typeof o.onClose === 'function') o.onClose(why, st.liked);
      },
    });
  }

  /** 다운로드 막기 — 오른쪽 단추 메뉴 · 끌기 (길게 눌러 저장은 CSS -webkit-touch-callout) */
  function guardImages(root) {
    if (!root || root.getAttribute('data-pv-guard')) return;
    root.setAttribute('data-pv-guard', '1');
    ['contextmenu', 'dragstart'].forEach(function (type) {
      root.addEventListener(type, function (e) {
        if (e.target && e.target.tagName === 'IMG') e.preventDefault();
      });
    });
  }

  window.SeganPostView = {
    TEXT: TEXT,
    TILE: TILE,
    fromRow: fromRow,
    fromLike: fromLike,
    fromStatic: fromStatic,
    labels: labels,
    nameOf: nameOf,
    refHref: refHref,
    tileHTML: tileHTML,
    companies: companies,
    myLikes: myLikes,
    setLike: setLike,
    askLogin: askLogin,
    open: open,
    guardImages: guardImages,
  };
})();
