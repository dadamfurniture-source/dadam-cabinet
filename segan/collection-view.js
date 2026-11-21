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
   타일 (2026-11-21 대표님 「사진 위에 색상 정보를 적지 말고 밑에 색상 정보 영역을 만들어서 개별로」)
     칸(.cl-cell) = 사진 단추(.cl-tile — 정사각, 누르면 사진 보기) + 사진 아래 색상 영역(.cl-info)
     색상 영역 = 색상을 하나씩 한 줄에(.cl-colors — 색 값을 알면 작은 색 칸) + ♡ 단추
     좋아요를 저장할 수 없는 사진(DB 게시물이 아닌 것)은 ♡ 없이. 색상을 몰라도 영역은 둔다 (줄 높이가 맞는다)
   사진 보기 (open — 같은 날 「사진을 클릭하면 바로 확대 사진이 나오지 말고 색상정보, 견적, 업체 정보」)
     SeganShell.sheet kind 'sheet' (폰 아래 시트 · PC 1100px~ 오른쪽 옆 패널, 뒤로 가기가 닫는다, 주소 그대로)
     사진(누르면 전체 화면) · 장소와 좋아요 한 줄 · 색상 · 예상 견적 · 업체 정보 · 「이 스타일로 연출컷」
     (장소 · 색상 · 견적 · 업체는 아는 것만 — 모르는 칸은 보이지 않는다)
   예상 견적 — 연출컷 견적과 같은 표준 단가표 (QUOTE_RATES = workers/generate-api/src/quote.js RATES — 시험이 두 표를 견준다)
     품목  AI 연출 사진 = 사진 이름(STATIC place) · AI 연출컷 = 품목 이름(place_label) · 직접 올린 사진 = 구분(category).
           어느 표인지 모르면 견적 칸을 보이지 않는다 (서버처럼 수납장 표로 대신하지 않는다)
     가로 길이  사진에는 치수가 없다 — 보는 사람이 300mm 씩 고른다 (1.2m ~ 6.0m, 처음 3.0m =
           연출컷이 벽 폭을 못 읽었을 때 쓰는 값. 한도는 서버 clampWall 1000 ~ 6000 안)
     줄(품목 · 금액) · 부가세 · 합계(VAT 포함) · 예상 범위(합계의 95% ~ 130%) — 셈은 서버 buildQuote 그대로
   전체 화면 (full) — 사진만 화면 가득. SeganShell.sheet 의 가운데 창 층(kind 'dialog')을 화면 가득 채워 쓴다
     (뒤로 가기 · Esc · 닫기가 닫는다, 주소 그대로). 사진 보기의 사진을 누르면 연다 — 사진 보기 위에 겹친다.
     사진을 누르면 「닫기」를 감췄다 보였다, 사진 바깥(어두운 자리)을 누르면 닫는다
   좋아요 (♡ — aria-pressed) — 로그인한 사람만, 본인 줄만 (DB 0049 RLS). 타일의 ♡ 와 사진 보기의 ♡ 가 같은 일을 한다
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
    hq: '다담가구',
    staticAi: 'AI 연출', // AI 연출 사진(STATIC) — 실제 시공이 아니므로 업체 대신
    place: '장소',
    color: '색상',
    company: '업체',
    companyInfo: '업체 정보',
    like: '좋아요',
    make: '이 스타일로 연출컷',
    open: '정보 보기',
    zoom: '사진 크게 보기',
    quote: '예상 견적',
    width: '가로 길이',
    narrower: '가로 길이 줄이기',
    wider: '가로 길이 늘리기',
    vat: '부가세',
    total: '합계 (VAT 포함)',
    range: '예상 범위',
    quoteNote:
      '연출컷 견적과 같은 표준 단가로 셈한 예상 금액입니다. 실제 금액은 현장 실측 · 자재 · 구성에 따라 달라집니다.',
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
  var HEX_RE = /^#[0-9a-f]{6}$/i; // 색 칸에 그대로 적는 값 — 이 꼴만 받는다
  var HEART =
    '<svg class="pv-heart" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';

  // ── 예상 견적 (표준 단가표) ─────────────────────────────
  // workers/generate-api/src/quote.js 의 RATES · INSTALL · DEMOLITION_PER_1000 을 그대로 옮긴 것 — 값을 여기서 정하지 않는다.
  // 서버 표를 고치면 이 표도 같이 고친다 (__tests__/segan-collection.test.js 가 두 표의 셈을 견준다)
  var KITCHEN_RATE = {
    lines: [
      { name: '하부장 캐비닛', price: 160000 },
      { name: '상부장 캐비닛', price: 140000, share: 0.7 },
      { name: '상판 (인조대리석)', price: 150000 },
    ],
    fixed: [
      { name: '수전', price: 40000 },
      { name: '싱크볼', price: 80000 },
      { name: '후드', price: 65000 },
    ],
  };
  var WARDROBE_RATE = { lines: [{ name: '붙박이장 캐비닛', price: 140000, per: 300 }] };
  var OFFICE_RATE = { lines: [{ name: '사무실 붙박이', price: 220000 }] };
  var QUOTE_RATES = {
    sink: KITCHEN_RATE,
    island: KITCHEN_RATE,
    wardrobe: WARDROBE_RATE,
    bedroom: WARDROBE_RATE,
    storage: { lines: [{ name: '수납장 캐비닛', price: 160000 }] },
    fridge: {
      lines: [
        { name: '팬트리 하부장', price: 180000 },
        { name: '상단 브릿지 캐비닛', price: 140000 },
      ],
    },
    vanity: { lines: [{ name: '파우더룸 캐비닛', price: 250000 }] },
    shoe: { lines: [{ name: '신발장 캐비닛', price: 400000 }] },
    office: OFFICE_RATE,
    study: OFFICE_RATE,
  };
  var QUOTE_INSTALL = 200000;
  var QUOTE_DEMOLITION_PER_1000 = 30000;
  var QUOTE_W = { min: 1200, max: 6000, step: 300, start: 3000 }; // 가로 길이 고르기 (mm)

  // 품목 이름 → 표 (AI 연출컷의 place_label — workers/generate-api/src/collection-post.js COLLECTION_PLACE_LABEL 의 거꾸로)
  var PLACE_QUOTE = {
    싱크대: 'sink',
    아일랜드: 'island',
    붙박이장: 'wardrobe',
    수납장: 'storage',
    냉장고장: 'fridge',
    화장대: 'vanity',
    신발장: 'shoe',
    사무실: 'office',
    서재: 'study',
    침실: 'bedroom',
  };
  // 직접 올린 사진의 구분(collection_posts.category) → 표. 실내 · 기타는 품목을 몰라 견적을 내지 않는다
  var CATEGORY_QUOTE = { kitchen: 'sink', builtin: 'wardrobe', storage: 'storage' };
  // AI 연출 사진 이름(segan/collection.js STATIC place) → 표. 앞에서부터 처음 맞는 것
  var STATIC_QUOTE = [
    [/냉장고장/, 'fridge'],
    [/아일랜드/, 'island'],
    [/주방/, 'sink'],
    [/신발장/, 'shoe'],
    [/붙박이장|드레스룸/, 'wardrobe'],
    [/화장대/, 'vanity'],
    [/책장|서재/, 'study'],
    [/수납장|홈카페장|세탁실장/, 'storage'],
  ];

  /**
   * 견적 — 서버 buildQuote(category, wallW) 와 같은 셈. 모르는 품목이면 null (서버처럼 수납장 표로 대신하지 않는다)
   * @returns {{ items: {name, quantity, unit_price, total}[], subtotal, vat, total, range: {min, max} } | null}
   */
  function buildQuote(key, wallW) {
    var rate = Object.prototype.hasOwnProperty.call(QUOTE_RATES, key) ? QUOTE_RATES[key] : null;
    if (!rate) return null;
    var mm = Math.max(0, Number(wallW) || 0);
    var items = [];
    rate.lines.forEach(function (l) {
      var span = Math.round(mm * (l.share || 1));
      if (l.per === 300) {
        var units = Math.ceil(span / 300);
        items.push({
          name: l.name,
          quantity: span + 'mm (' + units + '자)',
          unit_price: l.price,
          total: units * l.price,
        });
      } else {
        items.push({
          name: l.name,
          quantity: span + 'mm',
          unit_price: l.price,
          total: Math.round((l.price * span) / 1000),
        });
      }
    });
    (rate.fixed || []).forEach(function (f) {
      items.push({ name: f.name, quantity: '1개', unit_price: f.price, total: f.price });
    });
    items.push({
      name: '시공비',
      quantity: '1식',
      unit_price: QUOTE_INSTALL,
      total: QUOTE_INSTALL,
    });
    items.push({
      name: '기존 철거',
      quantity: mm + 'mm',
      unit_price: QUOTE_DEMOLITION_PER_1000,
      total: Math.round((QUOTE_DEMOLITION_PER_1000 * mm) / 1000),
    });
    var subtotal = items.reduce(function (s, i) {
      return s + i.total;
    }, 0);
    var vat = Math.round(subtotal * 0.1);
    var total = subtotal + vat;
    return {
      items: items,
      subtotal: subtotal,
      vat: vat,
      total: total,
      range: { min: Math.round(total * 0.95), max: Math.round(total * 1.3) },
    };
  }

  /** 이 사진의 견적 표 — 모르면 '' (견적 칸 없음) */
  function quoteKey(p) {
    if (!p) return '';
    if (p.quote_key) return p.quote_key;
    if (p.source === 'ai_render') return PLACE_QUOTE[p.place_label] || '';
    return CATEGORY_QUOTE[p.category] || '';
  }

  function won(n) {
    return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';
  }

  function meters(mm) {
    return (mm / 1000).toFixed(1) + 'm';
  }

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
      category: str(row.category),
      hex: [],
      quote_key: '',
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
        category: row.category,
        like_count: row.like_count,
        source: row.source,
        created_at: row.created_at,
      },
      { company_name: row.company_name, company_kind: row.company_kind }
    );
    p.liked_at = row.liked_at || null;
    return p;
  }

  /** AI 연출 사진 (segan/collection.js STATIC — { image_url: '../app/portfolio/<이름>.jpg', place, color, hex }).
   *  color = 「자재 이름 · 자재 이름」, hex = 그 차례의 색 값 (app/portfolio/luxe-manifest.json materials) */
  function fromStatic(s) {
    var file = String(s.image_url || '').replace(/^.*\//, '');
    var stem = file.replace(/\.jpg$/i, '');
    var place = str(s.place);
    var key = '';
    for (var i = 0; i < STATIC_QUOTE.length && !key; i++)
      if (STATIC_QUOTE[i][0].test(place)) key = STATIC_QUOTE[i][1];
    return {
      id: '',
      image_url: STATIC_FULL + file,
      thumb: STATIC_THUMB + file,
      place_label: place,
      door_color: str(s.color),
      category: '',
      hex: Array.isArray(s.hex) ? s.hex.filter(isHex) : [],
      quote_key: key,
      company_name: TEXT.staticAi,
      company_kind: '',
      source: 'upload',
      like_count: 0,
      created_at: null,
      stem: STEM_RE.test(stem) ? stem : '',
    };
  }

  /** 화면 글 — { ai, title, company, place, color } (규칙은 머리말).
   *  연출컷(ai_render)은 2026-11-20 대표님 「표시 없이, 업체 칸만 AI 연출」 — 타일 「AI」 표 없음, 제목 「시공사례」,
   *  업체 칸은 늘 「AI 연출」 (본사가 고른 연출컷만 시공사례에 나간다, DB 0075) */
  function labels(p) {
    var ai = p.source === 'ai_render';
    return {
      ai: false,
      title: TEXT.title,
      company: ai ? TEXT.staticAi : p.company_name || '',
      place: p.place_label || '',
      color: p.door_color || '',
    };
  }

  function isHex(v) {
    return typeof v === 'string' && HEX_RE.test(v);
  }

  /** 색상 하나씩 — [{ name, hex }]. 색상 글은 「이름 · 이름」, 색 값은 아는 것만 (AI 연출 사진) */
  function colorsOf(p) {
    var hex = p && Array.isArray(p.hex) ? p.hex : [];
    return String((p && p.door_color) || '')
      .split(' · ')
      .map(function (name, i) {
        return { name: name.trim(), hex: isHex(hex[i]) ? hex[i] : '' };
      })
      .filter(function (c) {
        return !!c.name;
      });
  }

  /** 색상 목록 줄 — 색 값을 알면 작은 색 칸을 앞에 (cls = 목록 클래스) */
  function colorsHTML(p, cls) {
    var list = colorsOf(p);
    if (!list.length) return '';
    return (
      '<ul class="' +
      cls +
      '">' +
      list
        .map(function (c) {
          return (
            '<li>' +
            (c.hex
              ? '<span class="cl-chip" style="background: ' + c.hex + '" aria-hidden="true"></span>'
              : '') +
            '<span>' +
            esc(c.name) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
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
    if (p.id && UUID_RE.test(p.id)) return 'make.html?ref=' + encodeURIComponent(p.id);
    if (!p.id && p.stem) return 'make.html?ref=' + encodeURIComponent(p.stem);
    return '';
  }

  /** 좋아요를 저장할 수 있는 사진인가 — DB 게시물만 (id 가 있다) */
  function canLike(p) {
    return !!(p && p.id && UUID_RE.test(p.id));
  }

  /**
   * 타일 하나 — 칸(.cl-cell) 안에 사진 단추(누르면 사진 보기, data-open = 목록 안 차례)와
   * 사진 아래 색상 영역(.cl-info — 색상 하나씩 한 줄 · ♡ 단추 data-like = 같은 차례). o.liked = 내가 좋아한 사진
   */
  function tileHTML(p, i, o) {
    var l = labels(p);
    var like = canLike(p);
    var cap =
      '<div class="cl-info">' +
      colorsHTML(p, 'cl-colors') +
      (like
        ? '<button type="button" class="cl-like" data-like="' +
          i +
          '" aria-pressed="' +
          (o && o.liked ? 'true' : 'false') +
          '" aria-label="' +
          esc(TEXT.like) +
          '">' +
          HEART +
          '</button>'
        : '') +
      '</div>';
    return (
      '<div class="cl-cell"><button type="button" class="cl-tile' +
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
      '</button>' +
      cap +
      '</div>'
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

  /** 내가 좋아한 사진인가 — o.liked 는 값이거나, 열 때마다 다시 묻는 함수 */
  function likedOf(o) {
    return !!(o && (typeof o.liked === 'function' ? o.liked() : o.liked));
  }

  /**
   * ♡ 한 번 — 먼저 바꿔 보이고(st.liked · st.count → paint), 못 넣으면 되돌리고 fail 을 부른다.
   * 로그인 전이면 로그인을 권하고 끝. 넣는 동안(aria-busy)은 다시 누르지 못한다
   * @returns {Promise<boolean>} 저장됐나
   */
  async function flipLike(p, o, st, btn, paint, fail) {
    o = o || {};
    if (!o.userId) {
      askLogin(o.loginHref);
      return false;
    }
    if (st.busy) return false;
    st.busy = true;
    if (btn) btn.setAttribute('aria-busy', 'true');
    var next = !st.liked;
    st.liked = next;
    st.count = Math.max(0, st.count + (next ? 1 : -1));
    paint();
    var r = await setLike(o.sb, o.userId, p.id, next);
    if (!r.ok) {
      st.liked = !next;
      st.count = Math.max(0, st.count + (next ? -1 : 1));
      paint();
      if (typeof fail === 'function') fail();
    } else {
      p.like_count = st.count;
      if (typeof o.onLike === 'function') o.onLike(p, st.liked);
    }
    st.busy = false;
    if (btn) btn.removeAttribute('aria-busy');
    return !!r.ok;
  }

  /**
   * 타일의 ♡ 를 눌렀다 — 단추의 aria-pressed 가 지금 상태다.
   * @param {Element} btn  .cl-like
   * @param {object} p     그 사진
   * @param {{ sb?, userId?: string, loginHref?: string, onLike?: function(object, boolean), onFail?: function() }} o
   */
  function likeTile(btn, p, o) {
    o = o || {};
    if (!btn || !canLike(p) || btn.getAttribute('aria-busy') === 'true')
      return Promise.resolve(false);
    var st = {
      liked: btn.getAttribute('aria-pressed') === 'true',
      count: num(p.like_count),
      busy: false,
    };
    return flipLike(
      p,
      o,
      st,
      btn,
      function () {
        btn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      },
      o.onFail
    );
  }

  /**
   * 사진만 전체 화면으로 — 가운데 창 층을 화면 가득 채운다 (segan/shell.css .pv-full-wrap).
   * 사진을 누르면 「닫기」를 감췄다 보였다, 사진 바깥을 누르면 닫는다. 사진 보기(open)의 사진을 누르면 연다
   * @param {object} p  사진 한 장
   * @param {{ img?: Element, onFullClose?: function(string) }} o  img = 이미 받아 둔 그림 (크기를 먼저 잡는다)
   * @returns 창 손잡이 (SeganShell.sheet.open) — 셸이 없으면 null
   */
  function full(p, o) {
    o = o || {};
    var sheet = sheetApi();
    if (!sheet || !p) return null;
    var size = sizeOf(o.img);
    // 칸에서 이미 받은 사진을 먼저 화면 가득 보이고, 원본을 다 받으면 바꿔 끼운다 (받는 동안 빈 화면이 되지 않게)
    var first = p.thumb || p.image_url;
    var big = p.image_url || p.thumb;
    var box = document.createElement('div');
    box.className = 'pv-full';
    box.innerHTML =
      '<img class="pv-full-img" src="' +
      esc(first) +
      '" alt="' +
      esc(nameOf(p)) +
      '" width="' +
      size.w +
      '" height="' +
      size.h +
      '" decoding="async" draggable="false" />';
    guardImages(box);
    var h = sheet.open({
      kind: 'dialog',
      title: labels(p).title,
      body: box,
      onClose: function (why) {
        if (typeof o.onFullClose === 'function') o.onFullClose(why);
      },
    });
    if (!h) return null;
    if (h.el && h.el.parentNode) h.el.parentNode.classList.add('pv-full-wrap');
    var pic = box.querySelector('.pv-full-img');
    if (big && big !== first && typeof window.Image === 'function') {
      var pre = new window.Image();
      pre.onload = function () {
        if (h.isOpen()) pic.src = big;
      };
      pre.src = big;
    }
    box.addEventListener('click', function (e) {
      var t = e.target;
      // 사진 = 단추를 감췄다 보였다 (사진만 본다) · 사진 바깥의 어두운 자리 = 닫기
      if (t === pic && inPicture(pic, e, size)) {
        if (h.el) h.el.classList.toggle('pv-full--bare');
        return;
      }
      h.close('backdrop');
    });
    return h;
  }

  /**
   * 누른 곳이 사진 그림 안인가 — img 칸은 화면을 가득 채우고 그림은 그 안에 비율대로 놓인다(object-fit: contain).
   * 그림 바깥의 어두운 자리는 「바깥」이다. 칸 크기를 모르면(그리지 않는 곳) 안으로 본다
   */
  function inPicture(img, e, size) {
    var r = img.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return true;
    var ratio =
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : size.w / size.h;
    if (!(ratio > 0)) return true;
    var w = Math.min(r.width, r.height * ratio);
    var hgt = w / ratio;
    var x = r.left + (r.width - w) / 2;
    var y = r.top + (r.height - hgt) / 2;
    return e.clientX >= x && e.clientX <= x + w && e.clientY >= y && e.clientY <= y + hgt;
  }

  function quoteRowHTML(name, quantity, amount) {
    return (
      '<div class="pv-qrow"><span>' +
      esc(name) +
      (quantity ? ' <small>' + esc(quantity) + '</small>' : '') +
      '</span><span>' +
      esc(won(amount)) +
      '</span></div>'
    );
  }

  /** 예상 견적 칸 — 가로 길이 고르기(− 값 +) · 줄 · 합계 · 범위. 값은 bindQuote 가 채운다 */
  function quoteHTML() {
    return (
      '<section class="pv-sec pv-quote"><h3 class="pv-h">' +
      esc(TEXT.quote) +
      '</h3><div class="pv-size"><span>' +
      esc(TEXT.width) +
      '</span><span class="pv-step"><button type="button" class="pv-step-btn" data-step="-1" aria-label="' +
      esc(TEXT.narrower) +
      '">−</button><output class="pv-size-value" aria-live="polite"></output>' +
      '<button type="button" class="pv-step-btn" data-step="1" aria-label="' +
      esc(TEXT.wider) +
      '">+</button></span></div><div class="pv-qrows"></div><div class="pv-qtotal"><span>' +
      esc(TEXT.total) +
      '</span><strong class="pv-qsum"></strong></div><p class="pv-qrange"></p><p class="sg-note pv-qnote">' +
      esc(TEXT.quoteNote) +
      '</p></section>'
    );
  }

  /** 견적 칸을 살린다 — 가로 길이를 300mm 씩 바꾸면 줄 · 합계 · 범위를 다시 셈한다 (합계는 지난 값에서 굴린다) */
  function bindQuote(box, key) {
    var w = QUOTE_W.start;
    var last = null;
    var val = box.querySelector('.pv-size-value');
    var rows = box.querySelector('.pv-qrows');
    var sum = box.querySelector('.pv-qsum');
    var range = box.querySelector('.pv-qrange');
    var minus = box.querySelector('[data-step="-1"]');
    var plus = box.querySelector('[data-step="1"]');
    function paint() {
      var q = buildQuote(key, w);
      if (!q) return;
      val.textContent = meters(w);
      rows.innerHTML =
        q.items
          .map(function (it) {
            return quoteRowHTML(it.name, it.quantity, it.total);
          })
          .join('') + quoteRowHTML(TEXT.vat, '', q.vat);
      var M = window.SeganMotion;
      if (M && typeof M.roll === 'function' && last != null) M.roll(sum, last, q.total, won);
      else sum.textContent = won(q.total);
      last = q.total;
      range.textContent = TEXT.range + ' ' + won(q.range.min) + ' ~ ' + won(q.range.max);
      minus.disabled = w <= QUOTE_W.min;
      plus.disabled = w >= QUOTE_W.max;
    }
    box.querySelector('.pv-step').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-step]') : null;
      if (!b || b.disabled) return;
      w = Math.max(
        QUOTE_W.min,
        Math.min(QUOTE_W.max, w + Number(b.getAttribute('data-step')) * QUOTE_W.step)
      );
      paint();
    });
    paint();
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
    var st = { liked: likedOf(o), count: num(p.like_count), busy: false };
    var likeable = canLike(p);
    var href = refHref(p);

    var qkey = quoteKey(p);
    var colors = colorsHTML(p, 'pv-colors');

    var box = document.createElement('article');
    box.className = 'pv';
    box.innerHTML =
      '<button type="button" class="pv-photo" style="aspect-ratio: ' +
      size.w +
      ' / ' +
      size.h +
      '" aria-label="' +
      esc(TEXT.zoom) +
      '"><img src="' +
      esc(p.image_url || p.thumb) +
      '" alt="' +
      esc(nameOf(p)) +
      '" width="' +
      size.w +
      '" height="' +
      size.h +
      '" decoding="async" draggable="false" /></button>' +
      (l.place || likeable
        ? '<div class="pv-bar">' +
          (l.place ? '<p class="pv-place">' + esc(l.place) + '</p>' : '') +
          (likeable
            ? '<button type="button" class="pv-like" aria-pressed="false">' +
              HEART +
              '<span class="pv-like-text">' +
              esc(TEXT.like) +
              '</span> <span class="pv-count"></span></button>'
            : '') +
          '</div>'
        : '') +
      (likeable ? '<p class="pv-error" role="alert" hidden></p>' : '') +
      (colors
        ? '<section class="pv-sec"><h3 class="pv-h">' +
          esc(TEXT.color) +
          '</h3>' +
          colors +
          '</section>'
        : '') +
      (qkey ? quoteHTML() : '') +
      (l.company
        ? '<section class="pv-sec"><h3 class="pv-h">' +
          esc(TEXT.companyInfo) +
          '</h3><dl class="pv-facts">' +
          factHTML(TEXT.company, l.company) +
          '</dl></section>'
        : '') +
      (href ? '<a class="sg-btn pv-make" href="' + esc(href) + '">' + esc(TEXT.make) + '</a>' : '');
    guardImages(box);
    if (qkey) bindQuote(box, qkey);

    // 사진을 누르면 사진만 전체 화면 — 이 창 위에 겹친다 (닫으면 이 창으로 돌아온다)
    var photo = box.querySelector('.pv-photo');
    photo.addEventListener('click', function () {
      full(p, { img: photo.querySelector('img'), onFullClose: o.onFullClose });
    });

    var btn = box.querySelector('.pv-like');
    var err = box.querySelector('.pv-error');
    function paint() {
      if (!btn) return;
      btn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      btn.querySelector('.pv-count').textContent = String(st.count);
    }
    paint();
    if (btn)
      btn.addEventListener('click', function () {
        if (err) err.hidden = true;
        flipLike(p, o, st, btn, paint, function () {
          if (!err) return;
          err.textContent = TEXT.likeFail;
          err.hidden = false;
        });
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
    canLike: canLike,
    likeTile: likeTile,
    full: full,
    open: open,
    colorsOf: colorsOf,
    quoteKey: quoteKey,
    buildQuote: buildQuote,
    QUOTE_W: QUOTE_W,
    guardImages: guardImages,
  };
})();
