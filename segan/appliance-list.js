/* ============================================================
   segan/appliance-list.js — 마이페이지 관리 › 기준정보 › 「가전 모델」 (segan/me.html #applianceList, 주소 #appliances)

   PC 화면 admin/appliances.html(가전 모델 관리)의 「보기 · 찾기」만 마이페이지 안으로 옮긴 것.
   (마이페이지 B안 4단계 — 2026-11-11 대표님 결정: 남은 관리 화면은 앱에서 보기 · 찾기만.
    넣기 · 고치기 · 지우기 · 사진 가져오기는 PC 화면에 그대로 — 이 화면 아래 링크로 간다)

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganApplianceList.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 칸을 열지 않는다.
   데이터    Supabase 표 appliance_models (PC 화면과 같은 조회 — 종류 하나씩, 브랜드 · 모델명 차례, 읽기만)
               .from('appliance_models').select('*').eq('category', 종류).order('brand').order('model_name')
             화면을 실제로 열었을 때 처음 읽고(마이페이지를 열 때마다 읽지 않는다), 읽은 종류는 들고 있는다.
   화면      종류 단추 열넷 → 찾기(브랜드 · 모델명 · 라인 · 코드) · 세부 구분 고르기 → 몇 개 → 모델 줄
             (사진 · 브랜드 모델명 · 구분 · 라인 · 설치 방식 · 코드 · W × D × H · 용량 · 여유 공간 · 장 안쪽 치수 · 검증).
             한 번에 PAGE 줄, 「더 보기」로 이어 붙인다.
   사진      우리 Storage 로 가져온 사진(image_path)만 그린다. 제조사 원본 주소만 있는 모델은 글로만 적는다
             (제조사 서버에 요청을 보내지 않는다).
   못 읽으면  그 자리에 글 + 「다시 읽기」. 종류를 바꿔 다시 읽을 수 있다.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  // 종류 — admin/appliances.html 탭 차례 그대로
  var CATEGORIES = [
    ['refrigerator', '냉장고'],
    ['hood', '후드'],
    ['dishwasher', '식기세척기'],
    ['sink', '싱크볼'],
    ['cooktop', '쿡탑'],
    ['microwave', '전자레인지'],
    ['oven', '오븐'],
    ['rice_cooker', '밥솥'],
    ['range', '가스오븐레인지'],
    ['faucet', '수전'],
    ['robot_vacuum', '로봇청소기 스테이션'],
    ['food_disposer', '음식물처리기'],
    ['water_purifier', '정수기'],
    ['wine_cellar', '와인셀러'],
  ];
  // 종류별 세부 구분 — admin/appliances.html SUBTYPES (DB 검사 appliance_models_subtype_chk 와 같은 목록)
  var SUBTYPES = {
    refrigerator: {
      french_4door: '4도어',
      side_by_side: '양문형',
      two_door: '일반 2도어',
      one_door: '1도어',
      built_in: '빌트인',
      kimchi_stand: '김치 스탠드',
      kimchi_lid: '김치 뚜껑형',
      wine: '와인셀러',
      small: '소형',
    },
    microwave: { solo: '전자레인지', combi: '광파 · 오븐 겸용' },
    oven: { oven: '오븐', steam_oven: '스팀오븐', combi: '복합오븐 (전자레인지 겸용)' },
    dishwasher: { built_in: '빌트인', freestanding: '프리스탠딩', countertop: '카운터탑' },
    cooktop: { induction: '인덕션', highlight: '하이라이트', hybrid: '하이브리드', gas: '가스' },
    hood: { chimney: '침니형', slim: '슬림형', built_in: '빌트인', island: '아일랜드' },
    rice_cooker: { pressure_ih: 'IH 압력', ih: 'IH', pressure: '압력', electric: '전기 (마이컴)' },
    range: { gas: '가스', induction: '인덕션', hybrid: '하이브리드', highlight: '하이라이트' },
    robot_vacuum: { toe_kick: '걸레받이 히든 스테이션', built_in: '하부장 빌트인 스테이션' },
    food_disposer: {
      grinder: '분쇄 · 회수',
      grinder_microbial: '분쇄 + 미생물',
      microbial: '미생물 분해',
      dryer: '건조 · 분쇄건조',
    },
    water_purifier: { purify: '정수', cold: '냉정수', hot: '온정수', hot_cold: '냉온정수' },
    wine_cellar: { under_counter: '언더카운터', built_in: '빌트인' },
  };
  var INSTALL_LABEL = { freestanding: '일반', kitchen_fit: '키친핏', built_in: '빌트인' };
  var PHOTO_BUCKET = 'appliance-images';
  var PC_PAGE = '../admin/appliances.html';
  var HASH = '#appliances';
  var PAGE = 40;

  var TEXT = {
    title: '가전 모델',
    lead: '연출컷과 설계가 쓰는 가전 모델 목록입니다. 종류를 고르고 브랜드 · 모델명 · 코드로 찾습니다. 여기서는 보기만 합니다.',
    category: '종류',
    search: '찾기',
    searchHint: '브랜드 · 모델명 · 라인 · 코드',
    subtype: '세부 구분',
    subAll: '전체 구분',
    subNone: '구분 없음',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    retry: '다시 읽기',
    empty: '데이터 없음',
    count: '개',
    all: '전체',
    more: '더 보기',
    left: '남은',
    verified: '검증',
    unverified: '표준 추정',
    photoIn: '가져온 사진',
    photoSrc: '사진 원본 주소만 있음',
    code: '코드',
    others: '외',
    size: '크기',
    capacity: '용량',
    gap: '여유',
    gapSide: '좌우',
    gapTop: '위',
    gapBack: '뒤',
    room: '자리',
    niche: '장',
    pc: '넣기 · 고치기 · 지우기 · 사진 가져오기는 PC 관리 화면에서 합니다',
    pcLink: 'PC 가전 모델 관리 열기',
  };

  var A = {
    sb: null,
    ready: false,
    cat: CATEGORIES[0][0],
    rows: {}, // 종류 → 읽은 줄
    failed: '', // 지금 종류를 못 읽은 까닭
    busy: false,
    q: '',
    sub: '',
    shown: PAGE,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function own(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function isCat(k) {
    return CATEGORIES.some(function (c) {
      return c[0] === k;
    });
  }

  function subName(cat, sub) {
    return own(SUBTYPES, cat) && own(SUBTYPES[cat], sub) ? SUBTYPES[cat][sub] : '';
  }

  /** 서버가 준 줄 하나 — 이름 없는 줄은 버린다 */
  function rowOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var id = typeof v.id === 'string' || typeof v.id === 'number' ? String(v.id) : '';
    var brand = str(v.brand).trim();
    var name = str(v.model_name).trim();
    if (!id || (!brand && !name)) return null;
    var code = str(v.model_code).trim();
    return {
      id: id,
      category: str(v.category),
      brand: brand,
      name: name,
      code: code,
      codes: (Array.isArray(v.model_codes) ? v.model_codes : [])
        .map(function (c) {
          return String(c == null ? '' : c).trim();
        })
        .filter(Boolean),
      subtype: str(v.subtype),
      line: str(v.line).trim(),
      install: str(v.install_type),
      gas: (Array.isArray(v.gas_types) ? v.gas_types : []).map(String),
      w: num(v.width_mm),
      d: num(v.depth_mm),
      h: num(v.height_mm),
      cap: num(v.capacity_l),
      side: num(v.side_gap_mm),
      top: num(v.top_gap_mm),
      back: num(v.back_gap_mm),
      niche: [
        [num(v.niche_min_w_mm), num(v.niche_max_w_mm)],
        [num(v.niche_min_h_mm), num(v.niche_max_h_mm)],
        [num(v.niche_min_d_mm), num(v.niche_max_d_mm)],
      ],
      verified: v.verified === true,
      imagePath: str(v.image_path),
      imageAt: str(v.image_approved_at),
      hasSource: /^https:\/\//.test(str(v.image_source_url)),
    };
  }

  /** 줄 아랫글 — 세부 구분 · 라인 · 설치 방식 · 가스 */
  function subOf(r) {
    return [
      subName(r.category, r.subtype),
      r.line,
      own(INSTALL_LABEL, r.install) ? INSTALL_LABEL[r.install] : '',
      r.gas.join('/'),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 크기 — 'W × D × H mm' (없는 값은 ?), 셋 다 없으면 빈 글 */
  function sizeText(r) {
    if (r.w === null && r.d === null && r.h === null) return '';
    var one = function (v) {
      return v === null ? '?' : String(v);
    };
    return one(r.w) + ' × ' + one(r.d) + ' × ' + one(r.h) + ' mm';
  }

  /** 빌트인 장 안쪽 치수(니치) — 한 값이면 그 값, 범위면 최소~최대. 없으면 빈 글 (admin/appliances.html nicheText) */
  function nicheText(r) {
    var n = r.niche;
    if (n[0][0] === null && n[1][0] === null && n[2][0] === null) return '';
    var one = function (p) {
      return p[0] === null
        ? '?'
        : p[1] !== null && p[1] !== p[0]
          ? p[0] + '~' + p[1]
          : String(p[0]);
    };
    return TEXT.niche + ' ' + one(n[0]) + ' × ' + one(n[1]) + ' × ' + one(n[2]);
  }

  /**
   * 여유 공간 — 좌우(한쪽) · 위 · 뒤, 그리고 그 여유를 둔 자리 크기 (admin/appliances.html gapCell).
   *   자리 폭 = W + 2 × 좌우 여유, 자리 높이 = H + 위 여유. 없으면 빈 글
   */
  function gapText(r) {
    if (r.side === null && r.top === null && r.back === null) return '';
    var parts = [];
    if (r.side !== null) parts.push(TEXT.gapSide + ' ' + r.side);
    if (r.top !== null) parts.push(TEXT.gapTop + ' ' + r.top);
    if (r.back !== null) parts.push(TEXT.gapBack + ' ' + r.back);
    var w = r.side !== null && r.w ? r.w + 2 * r.side : null;
    var h = r.top !== null && r.h ? r.h + r.top : null;
    var room =
      w || h
        ? ' (' + TEXT.room + ' ' + (w === null ? r.w : w) + ' × ' + (h === null ? r.h : h) + ')'
        : '';
    return parts.join(' · ') + room;
  }

  /** 코드 — 대표 코드 + 「외 n개」 */
  function codeText(r) {
    var extra = r.codes.filter(function (c) {
      return c !== r.code;
    }).length;
    if (!r.code && !extra) return '';
    return (
      (r.code || r.codes[0]) + (extra && r.code ? ' ' + TEXT.others + ' ' + extra + TEXT.count : '')
    );
  }

  /** 가져온 사진의 공개 주소 — 설정이 없으면 빈 글 */
  function photoUrl(r) {
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.supabase;
    var base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    if (!base || !r.imagePath) return '';
    return (
      base +
      '/storage/v1/object/public/' +
      PHOTO_BUCKET +
      '/' +
      r.imagePath.split('/').map(encodeURIComponent).join('/') +
      (r.imageAt ? '?v=' + encodeURIComponent(r.imageAt) : '')
    );
  }

  /** 찾기 · 세부 구분으로 거른 줄 (admin/appliances.html renderTable 과 같은 조건) */
  function filtered(rows, q, sub, cat) {
    var needle = String(q || '')
      .trim()
      .toLowerCase();
    var useSub = own(SUBTYPES, cat) ? sub : '';
    return rows.filter(function (r) {
      if (useSub && (useSub === '_none' ? r.subtype : r.subtype !== useSub)) return false;
      if (!needle) return true;
      return [r.brand, r.name, r.line, r.code].concat(r.codes).some(function (v) {
        return String(v).toLowerCase().indexOf(needle) >= 0;
      });
    });
  }

  function countText(shownCount, total) {
    return (
      shownCount +
      TEXT.count +
      (shownCount !== total ? ' / ' + TEXT.all + ' ' + total + TEXT.count : '')
    );
  }

  function sec() {
    return $('applianceList');
  }

  function box() {
    return $('applianceListBody');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function catsHtml() {
    return (
      '<div class="al-cats" role="group" aria-label="' +
      esc(TEXT.category) +
      '">' +
      CATEGORIES.map(function (c) {
        return (
          '<button type="button" class="mk-btn dr-day al-cat" data-act="cat" data-cat="' +
          c[0] +
          '" aria-pressed="' +
          (A.cat === c[0] ? 'true' : 'false') +
          '"' +
          (A.busy ? ' disabled' : '') +
          '>' +
          esc(c[1]) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function toolsHtml() {
    var subs = own(SUBTYPES, A.cat) ? SUBTYPES[A.cat] : null;
    return (
      '<div class="al-tools"><label class="mk-input al-field" for="alSearch"><span>' +
      esc(TEXT.search) +
      '</span><input id="alSearch" type="search" autocomplete="off" placeholder="' +
      esc(TEXT.searchHint) +
      '" value="' +
      esc(A.q) +
      '"></label>' +
      (subs
        ? '<label class="mk-input al-field" for="alSub"><span>' +
          esc(TEXT.subtype) +
          '</span><select id="alSub"><option value="">' +
          esc(TEXT.subAll) +
          '</option>' +
          Object.keys(subs)
            .map(function (k) {
              return (
                '<option value="' +
                esc(k) +
                '"' +
                (A.sub === k ? ' selected' : '') +
                '>' +
                esc(subs[k]) +
                '</option>'
              );
            })
            .join('') +
          '<option value="_none"' +
          (A.sub === '_none' ? ' selected' : '') +
          '>' +
          esc(TEXT.subNone) +
          '</option></select></label>'
        : '') +
      '</div>'
    );
  }

  function fact(k, v) {
    return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : '';
  }

  function rowHtml(r) {
    var url = photoUrl(r);
    var sub = subOf(r);
    var title = [r.brand, r.name].filter(Boolean).join(' ');
    return (
      '<li class="me-cs-item al-item" data-al-row="' +
      esc(r.id) +
      '"><div class="al-head">' +
      (url
        ? '<img class="al-photo" src="' +
          esc(url) +
          '" alt="' +
          esc(title + ' ' + TEXT.photoIn) +
          '" loading="lazy" decoding="async" width="56" height="56">'
        : '') +
      '<span class="me-c-main"><b>' +
      esc(title) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span><span class="me-badge al-badge' +
      (r.verified ? ' al-ok' : '') +
      '">' +
      esc(r.verified ? TEXT.verified : TEXT.unverified) +
      '</span></div><dl class="me-facts al-facts">' +
      fact(TEXT.size, sizeText(r)) +
      fact(TEXT.capacity, r.cap === null ? '' : r.cap + ' L') +
      fact(TEXT.code, codeText(r)) +
      fact(TEXT.gap, [gapText(r), nicheText(r)].filter(Boolean).join(' · ')) +
      '</dl>' +
      (!url && r.hasSource ? '<p class="dr-note">' + esc(TEXT.photoSrc) + '</p>' : '') +
      '</li>'
    );
  }

  function listHtml() {
    if (A.failed)
      return (
        '<p class="mk-error" data-al="failed" role="alert">' +
        esc(A.failed) +
        '</p><button type="button" class="mk-btn" data-act="retry">' +
        esc(TEXT.retry) +
        '</button>'
      );
    var rows = A.rows[A.cat];
    if (!rows)
      return '<p class="mk-note" data-al="loading" role="status">' + esc(TEXT.loading) + '</p>';
    var list = filtered(rows, A.q, A.sub, A.cat);
    var head =
      '<p class="me-pt-msg dr-status" data-al="count" role="status">' +
      esc(countText(list.length, rows.length)) +
      '</p>';
    if (!list.length)
      return head + '<p class="me-empty" data-al="empty">' + esc(TEXT.empty) + '</p>';
    var left = list.length - A.shown;
    return (
      head +
      '<ul class="me-cs-list dr-list">' +
      list.slice(0, A.shown).map(rowHtml).join('') +
      '</ul>' +
      (left > 0
        ? '<button type="button" class="mk-btn al-more" data-act="more">' +
          esc(TEXT.more + ' (' + TEXT.left + ' ' + left + TEXT.count + ')') +
          '</button>'
        : '')
    );
  }

  function pcHtml() {
    return (
      '<p class="mk-note al-pc">' +
      esc(TEXT.pc) +
      ' — <a class="mk-link" data-al="pc" href="' +
      PC_PAGE +
      '" data-desktop-tab>' +
      esc(TEXT.pcLink) +
      '</a></p>'
    );
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !A.ready) return;
    b.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      catsHtml() +
      toolsHtml() +
      '<div data-al="list">' +
      listHtml() +
      '</div>' +
      pcHtml();
    if (A.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    s.hidden = false;
  }

  /** 목록만 다시 그린다 — 찾는 칸의 글 · 초점이 그대로 */
  function renderList() {
    var b = box();
    var el = b && b.querySelector('[data-al="list"]');
    if (el) el.innerHTML = listHtml();
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function hide() {
    var b = box();
    var s = sec();
    if (b) {
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    if (s) s.hidden = true;
    A.ready = false;
  }

  // ── 읽기 ───────────────────────────────────────────────
  /** 그 종류를 읽는다 — 이미 읽었으면 다시 읽지 않는다 (force 면 다시) */
  async function fetchCat(cat, force) {
    if (!A.ready || A.busy || !A.sb) return;
    if (A.rows[cat] && !force) return;
    A.busy = true;
    A.failed = '';
    if (force) delete A.rows[cat];
    render();
    var rows = null;
    var message = '';
    try {
      var res = await A.sb
        .from('appliance_models')
        .select('*')
        .eq('category', cat)
        .order('brand')
        .order('model_name');
      if (res && !res.error && Array.isArray(res.data)) rows = res.data.map(rowOf).filter(Boolean);
      else message = res && res.error && str(res.error.message);
    } catch {
      rows = null;
    }
    A.busy = false;
    if (rows) A.rows[cat] = rows;
    else if (A.cat === cat) A.failed = message ? TEXT.fail + ' (' + message + ')' : TEXT.fail;
    render();
  }

  /** 화면이 열려 있으면 지금 종류를 읽는다 — 마이페이지를 열 때마다 읽지 않으려고 주소로 가린다 */
  function ensure() {
    if (!A.ready || window.location.hash !== HASH) return;
    if (!A.rows[A.cat] && !A.failed) fetchCat(A.cat, false);
  }

  function pickCat(cat) {
    if (!isCat(cat) || cat === A.cat) return;
    A.cat = cat;
    A.q = '';
    A.sub = '';
    A.shown = PAGE;
    A.failed = '';
    render();
    focusOn('[data-act="cat"][data-cat="' + cat + '"]');
    if (!A.rows[cat])
      fetchCat(cat, false).then(function () {
        focusOn('[data-act="cat"][data-cat="' + cat + '"]');
      });
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || A.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'cat') pickCat(el.getAttribute('data-cat') || '');
    else if (act === 'retry') fetchCat(A.cat, true);
    else if (act === 'more') {
      var at = A.shown;
      A.shown += PAGE;
      renderList();
      // 새로 붙은 첫 줄로 초점 — 화면 읽기 프로그램이 이어서 읽는다
      var b = box();
      var li = b && b.querySelectorAll('li[data-al-row]')[at];
      if (li) {
        li.setAttribute('tabindex', '-1');
        li.focus();
      }
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || t.id !== 'alSearch') return;
    A.q = t.value;
    A.shown = PAGE;
    renderList();
  }

  function onChange(e) {
    var t = e.target;
    if (!t || t.id !== 'alSub') return;
    A.sub = t.value;
    A.shown = PAGE;
    renderList();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('input', onInput);
    b.addEventListener('change', onChange);
    window.addEventListener('hashchange', ensure);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 관리자가 아니면 칸을 감춘 채 둔다 */
  async function load(sb, session, me, opts) {
    hide();
    A.sb = sb || null;
    A.cat = CATEGORIES[0][0];
    A.rows = {};
    A.failed = '';
    A.busy = false;
    A.q = '';
    A.sub = '';
    A.shown = PAGE;
    if (!sb || !session || !(opts && opts.admin === true)) return;
    bind();
    A.ready = true;
    render();
    ensure();
  }

  window.SeganApplianceList = {
    CATEGORIES: CATEGORIES,
    SUBTYPES: SUBTYPES,
    INSTALL_LABEL: INSTALL_LABEL,
    PAGE: PAGE,
    TEXT: TEXT,
    rowOf: rowOf,
    subOf: subOf,
    sizeText: sizeText,
    nicheText: nicheText,
    gapText: gapText,
    codeText: codeText,
    photoUrl: photoUrl,
    filtered: filtered,
    countText: countText,
    state: A,
    load: load,
  };
})();
