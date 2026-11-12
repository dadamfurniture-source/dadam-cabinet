/* ============================================================
   segan/gallery-view.js — 마이페이지 관리 › 기준정보 › 「시공사례」 (segan/me.html #galleryView, 주소 #gallery-list)

   PC 화면 admin/gallery.html(시공사례 관리)의 「보기 · 찾기」만 마이페이지 안으로 옮긴 것.
   (마이페이지 B안 4단계 — 2026-11-11 대표님 결정: 남은 관리 화면은 앱에서 보기 · 찾기만.
    올리기 · 지우기 · 갤러리 ↔ 학습용 바꾸기는 PC 화면에 그대로 — 이 화면 아래 링크로 간다)
   누구나 보는 「시공사례」 탭(segan/collection.html)과는 다른 화면이다 — 이쪽은 학습용 사진까지 있는 관리 목록.

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganGalleryView.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 칸을 열지 않는다.
   데이터    Supabase 표 furniture_images (읽기만 — 새 것부터 PAGE 장씩, 총 장수는 count)
               .from('furniture_images').select(칸, { count: 'exact' }).order('created_at', { ascending: false })
               .range(시작, 끝) [.eq('category', 품목)] [.eq('is_training', 참/거짓)] [.or(설명 · 스타일에 찾는 글)]
             PC 화면은 전부(많으면 2만 장) 읽어 화면에서 거르지만, 여기서는 서버에서 걸러 PAGE 장씩만 읽는다.
             화면을 실제로 열었을 때 처음 읽는다(마이페이지를 열 때마다 읽지 않는다).
   화면      품목 고르기 · 쓰임(전체 · 갤러리용 · 학습용) · 찾기(설명 · 스타일) → 몇 장 → 사진 칸(품목 · 스타일 · 설명 ·
             학습용 표시) → 「더 보기」. 사진을 누르면 새 탭에서 크게.
   못 읽으면  그 자리에 글 + 「다시 읽기」.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  // 품목 — admin/gallery.html UPLOAD_CATEGORIES 차례 그대로
  var CATEGORIES = [
    ['l_shaped_sink', 'L자형 싱크대'],
    ['peninsula_sink', '반도형 싱크대'],
    ['island_kitchen', '아일랜드'],
    ['sink', '싱크대 (일반)'],
    ['wardrobe', '붙박이장'],
    ['fridge_cabinet', '냉장고장'],
    ['shoe_cabinet', '신발장'],
    ['vanity', '화장대'],
    ['storage', '수납장'],
    ['warehouse', '창고장'],
    ['door', '도어교체'],
    ['custom', '비규격장'],
    ['hood', '후드'],
    ['cooktop', '쿡탑'],
    ['countertop', '상판'],
    ['handle', '손잡이'],
    ['faucet', '수전'],
  ];
  // 예전 id — DB 에 남아 있을 수 있다 (admin/gallery.html CATEGORY_LABELS)
  var LEGACY = {
    fridge: '냉장고장 (구 id)',
    shoe: '신발장 (구 id)',
    shoerack: '신발장 (구 id)',
    island: '아일랜드 (구 id)',
    kitchen: '주방 전체',
  };
  var USES = [
    ['', '전체'],
    ['false', '갤러리용'],
    ['true', '학습용'],
  ];
  var COLUMNS = 'id,category,style,description,image_url,is_training,created_at';
  var PC_PAGE = '../admin/gallery.html';
  var HASH = '#gallery-list';
  var PAGE = 30;
  var Q_MAX = 40;

  var TEXT = {
    title: '시공사례',
    lead: '시공사례 탭과 연출컷 학습에 쓰는 사진 목록입니다. 품목 · 쓰임으로 거르고 설명 · 스타일로 찾습니다. 여기서는 보기만 합니다.',
    category: '품목',
    catAll: '전체 품목',
    use: '쓰임',
    search: '찾기',
    searchHint: '설명 · 스타일',
    find: '찾기',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    retry: '다시 읽기',
    empty: '이미지가 없습니다',
    count: '장',
    shown: '보이는',
    all: '전체',
    more: '더 보기',
    left: '남은',
    training: '학습용',
    photo: '사진',
    pc: '올리기 · 지우기 · 갤러리 ↔ 학습용 바꾸기는 PC 관리 화면에서 합니다',
    pcLink: 'PC 시공사례 관리 열기',
  };

  var G = {
    sb: null,
    ready: false,
    loaded: false, // 한 번이라도 읽었나
    rows: [],
    total: null,
    failed: '',
    busy: false,
    cat: '',
    use: '',
    q: '', // 서버에 물은 찾는 글
    draft: '', // 찾는 칸에 적는 중인 글
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

  function own(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 품목 이름 — 아는 품목 · 예전 id · 그 밖은 id 그대로 */
  function catLabel(id) {
    var c = CATEGORIES.filter(function (x) {
      return x[0] === id;
    })[0];
    if (c) return c[1];
    if (own(LEGACY, id)) return LEGACY[id];
    return id || '-';
  }

  function isCat(id) {
    return (
      id === '' ||
      CATEGORIES.some(function (c) {
        return c[0] === id;
      })
    );
  }

  /** 사진 한 장 — id 가 없거나 https 주소가 아니면 버린다 */
  function rowOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var id = typeof v.id === 'string' || typeof v.id === 'number' ? String(v.id) : '';
    var url = str(v.image_url);
    if (!id || url.indexOf('https://') !== 0) return null;
    return {
      id: id,
      url: url,
      category: str(v.category),
      style: str(v.style).trim(),
      description: str(v.description).trim(),
      training: v.is_training === true,
    };
  }

  /**
   * 찾는 글 → 서버 거르기에 넣을 글. PostgREST or(…) 글법에 뜻이 있는 글자(쉼표 · 괄호 · 따옴표 · % · * · 역슬래시)는
   * 빈칸으로 바꾸고 Q_MAX 자까지 — 남는 것이 없으면 빈 글 (찾지 않는다)
   */
  function needle(q) {
    return String(q == null ? '' : q)
      .replace(/[,()"'%*\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Q_MAX);
  }

  /** 서버 or(…) 거르기 글 — 설명 또는 스타일에 그 글이 들어 있다 */
  function orFilter(q) {
    var n = needle(q);
    return n ? 'description.ilike.*' + n + '*,style.ilike.*' + n + '*' : '';
  }

  /** 사진 아랫글 — 스타일 · 설명(40자까지) */
  function subOf(r) {
    var d = r.description.length > 40 ? r.description.slice(0, 40) + '…' : r.description;
    return [r.style, d].filter(Boolean).join(' · ');
  }

  function countText(shown, total) {
    if (typeof total !== 'number') return shown + TEXT.count;
    return shown < total
      ? TEXT.shown + ' ' + shown + TEXT.count + ' / ' + TEXT.all + ' ' + total + TEXT.count
      : total + TEXT.count;
  }

  function sec() {
    return $('galleryView');
  }

  function box() {
    return $('galleryViewBody');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function toolsHtml() {
    var dis = G.busy ? ' disabled' : '';
    return (
      '<div class="al-tools gv-tools"><label class="mk-input al-field" for="gvCat"><span>' +
      esc(TEXT.category) +
      '</span><select id="gvCat"' +
      dis +
      '><option value="">' +
      esc(TEXT.catAll) +
      '</option>' +
      CATEGORIES.map(function (c) {
        return (
          '<option value="' +
          c[0] +
          '"' +
          (G.cat === c[0] ? ' selected' : '') +
          '>' +
          esc(c[1]) +
          '</option>'
        );
      }).join('') +
      '</select></label><label class="mk-input al-field" for="gvUse"><span>' +
      esc(TEXT.use) +
      '</span><select id="gvUse"' +
      dis +
      '>' +
      USES.map(function (u) {
        return (
          '<option value="' +
          u[0] +
          '"' +
          (G.use === u[0] ? ' selected' : '') +
          '>' +
          esc(u[1]) +
          '</option>'
        );
      }).join('') +
      '</select></label><div class="gv-find"><label class="mk-input al-field" for="gvSearch"><span>' +
      esc(TEXT.search) +
      '</span><input id="gvSearch" type="search" autocomplete="off" maxlength="' +
      Q_MAX +
      '" placeholder="' +
      esc(TEXT.searchHint) +
      '" value="' +
      esc(G.draft) +
      '"' +
      dis +
      '></label><button type="button" class="mk-btn" data-act="find"' +
      dis +
      '>' +
      esc(TEXT.find) +
      '</button></div></div>'
    );
  }

  function tileHtml(r, i) {
    var name = catLabel(r.category);
    var sub = subOf(r);
    return (
      '<li class="gv-tile" data-gv-row="' +
      esc(r.id) +
      '"><a href="' +
      esc(r.url) +
      '" target="_blank" rel="noopener noreferrer"><img src="' +
      esc(r.url) +
      '" alt="' +
      esc(name + ' ' + TEXT.photo + ' ' + (i + 1)) +
      '" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="160" height="160"></a><p class="gv-cap"><b>' +
      esc(name) +
      '</b>' +
      (r.training ? ' <span class="me-badge gv-badge">' + esc(TEXT.training) + '</span>' : '') +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</p></li>'
    );
  }

  function listHtml() {
    if (G.failed && !G.rows.length)
      return (
        '<p class="mk-error" data-gv="failed" role="alert">' +
        esc(G.failed) +
        '</p><button type="button" class="mk-btn" data-act="retry"' +
        (G.busy ? ' disabled' : '') +
        '>' +
        esc(TEXT.retry) +
        '</button>'
      );
    if (!G.loaded)
      return '<p class="mk-note" data-gv="loading" role="status">' + esc(TEXT.loading) + '</p>';
    var head =
      '<p class="me-pt-msg dr-status" data-gv="count" role="status">' +
      esc(G.busy ? TEXT.loading : countText(G.rows.length, G.total)) +
      '</p>' +
      (G.failed
        ? '<p class="mk-error" data-gv="failed" role="alert">' + esc(G.failed) + '</p>'
        : '');
    if (!G.rows.length)
      return head + '<p class="me-empty" data-gv="empty">' + esc(TEXT.empty) + '</p>';
    var left = typeof G.total === 'number' ? G.total - G.rows.length : 0;
    return (
      head +
      '<ul class="gv-grid">' +
      G.rows.map(tileHtml).join('') +
      '</ul>' +
      (left > 0
        ? '<button type="button" class="mk-btn al-more" data-act="more"' +
          (G.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.more + ' (' + TEXT.left + ' ' + left + TEXT.count + ')') +
          '</button>'
        : '')
    );
  }

  function pcHtml() {
    return (
      '<p class="mk-note al-pc">' +
      esc(TEXT.pc) +
      ' — <a class="mk-link" data-gv="pc" href="' +
      PC_PAGE +
      '" data-desktop-tab>' +
      esc(TEXT.pcLink) +
      '</a></p>'
    );
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !G.ready) return;
    b.innerHTML =
      '<p class="mk-note">' + esc(TEXT.lead) + '</p>' + toolsHtml() + listHtml() + pcHtml();
    if (G.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    s.hidden = false;
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
    G.ready = false;
  }

  // ── 읽기 ───────────────────────────────────────────────
  /** 지금 거르기로 offset 번째부터 PAGE 장 — { rows, total } 또는 { message } */
  async function readPage(offset) {
    try {
      var qy = G.sb
        .from('furniture_images')
        .select(COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (G.cat) qy = qy.eq('category', G.cat);
      if (G.use) qy = qy.eq('is_training', G.use === 'true');
      var or = orFilter(G.q);
      if (or) qy = qy.or(or);
      var res = await qy;
      if (!res || res.error || !Array.isArray(res.data))
        return { message: (res && res.error && str(res.error.message)) || '' };
      return {
        rows: res.data.map(rowOf).filter(Boolean),
        got: res.data.length,
        total: typeof res.count === 'number' ? res.count : null,
      };
    } catch {
      return { message: '' };
    }
  }

  /** 처음부터 다시 읽는다 (거르기가 바뀌었거나 처음) — back = 끝난 뒤 초점 둘 곳 */
  async function reload(back) {
    if (!G.ready || G.busy || !G.sb) return;
    G.busy = true;
    G.failed = '';
    render();
    var r = await readPage(0);
    G.busy = false;
    G.loaded = true;
    if (r.rows) {
      G.rows = r.rows;
      G.total = r.total === null ? r.rows.length : r.total;
    } else {
      G.rows = [];
      G.total = null;
      G.failed = r.message ? TEXT.fail + ' (' + r.message + ')' : TEXT.fail;
    }
    render();
    if (back) focusOn(back);
  }

  /** 다음 PAGE 장을 이어 붙인다 — 못 읽으면 있던 사진은 그대로 두고 글만 */
  async function more() {
    if (!G.ready || G.busy || !G.sb) return;
    var at = G.rows.length;
    G.busy = true;
    G.failed = '';
    render();
    var r = await readPage(at);
    G.busy = false;
    if (r.rows) {
      G.rows = G.rows.concat(r.rows);
      if (r.total !== null) G.total = r.total;
      // 줄 수가 모자라게 왔으면 끝이다 — 「더 보기」가 남지 않게 총 장수를 맞춘다
      if (r.got < PAGE) G.total = G.rows.length;
    } else {
      G.failed = r.message ? TEXT.fail + ' (' + r.message + ')' : TEXT.fail;
    }
    render();
    var b = box();
    var li = b && b.querySelectorAll('li[data-gv-row] a')[at];
    if (li && li.focus) li.focus();
    else focusOn('[data-act="more"]');
  }

  /** 화면이 열려 있으면 처음 한 번 읽는다 — 마이페이지를 열 때마다 읽지 않으려고 주소로 가린다 */
  function ensure() {
    if (!G.ready || window.location.hash !== HASH) return;
    if (!G.loaded && !G.busy) reload('');
  }

  function find() {
    var el = $('gvSearch');
    G.draft = el ? el.value : G.draft;
    G.q = needle(G.draft);
    reload('#gvSearch');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || G.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'find') find();
    else if (act === 'retry') reload('#gvCat');
    else if (act === 'more') more();
  }

  function onChange(e) {
    var t = e.target;
    if (!t || G.busy) return;
    if (t.id === 'gvCat' && isCat(t.value)) {
      G.cat = t.value;
      reload('#gvCat');
    } else if (t.id === 'gvUse') {
      G.use = t.value === 'true' || t.value === 'false' ? t.value : '';
      reload('#gvUse');
    }
  }

  function onInput(e) {
    if (e.target && e.target.id === 'gvSearch') G.draft = e.target.value;
  }

  function onKey(e) {
    if (e.key !== 'Enter' || G.busy || !e.target || e.target.id !== 'gvSearch') return;
    e.preventDefault();
    find();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('change', onChange);
    b.addEventListener('input', onInput);
    b.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', ensure);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 관리자가 아니면 칸을 감춘 채 둔다 */
  async function load(sb, session, me, opts) {
    hide();
    G.sb = sb || null;
    G.loaded = false;
    G.rows = [];
    G.total = null;
    G.failed = '';
    G.busy = false;
    G.cat = '';
    G.use = '';
    G.q = '';
    G.draft = '';
    if (!sb || !session || !(opts && opts.admin === true)) return;
    bind();
    G.ready = true;
    render();
    ensure();
  }

  window.SeganGalleryView = {
    CATEGORIES: CATEGORIES,
    LEGACY: LEGACY,
    USES: USES,
    COLUMNS: COLUMNS,
    PAGE: PAGE,
    TEXT: TEXT,
    catLabel: catLabel,
    rowOf: rowOf,
    needle: needle,
    orFilter: orFilter,
    subOf: subOf,
    countText: countText,
    state: G,
    load: load,
  };
})();
