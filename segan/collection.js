/* ============================================================
   segan/collection.js — 「시공사례」 탭 (segan/collection.html)

   사이트 collection.html 과 같은 방식으로 읽는다 — 누구나(로그인 없이) 본다:
     collection_posts 를 최신순(created_at DESC), 24줄씩 키셋으로 (idx_collection_posts_created)
     region 칸이 없는 DB 면 region 없이 다시 묻는다
     DB 사례를 앞에, 자체 시공 사진(STATIC, 같은 목록)을 뒤에
     source 'ai_render'(AI 스튜디오 자동 게시)는 「AI 연출컷」 으로 적는다 (실제 시공 사진으로 오해하지 않게)
   사이트와 다른 점: 정적 사진은 DB 사례를 다 받은 뒤에 붙인다 (사이트는 첫 24줄 뒤에 두고 다음 DB 줄을
   그 뒤에 잇는다 — 앱은 최신순이 끝까지 이어지게). 처음 9장 · 6장씩 더(같다) + 「더 보기」 단추,
   누르면 앱 안에서 크게 본다.
   이미지는 배경으로만 그린다 — 다운로드 단추 · 링크는 두지 않는다. 관리자 「내리기」는 사이트에만 있다.
   ============================================================ */
/* global window, document, IntersectionObserver */
(function () {
  'use strict';

  var FIRST = 9; // 처음 노출 (collection.html 과 같다)
  var STEP = 6; // 더 보기마다
  var PAGE = 24; // 서버에서 한 번에

  // collection.html STATIC 과 같은 목록 (segan/ 에서 보므로 ../)
  var STATIC = [
    { image_url: '../app/portfolio/kitchen-n1-1.jpg', region: '서울 논현' },
    { image_url: '../app/portfolio/kitchen-n1-2.jpg', region: '서울 성수' },
    { image_url: '../app/portfolio/kitchen-n1-3.jpg', region: '서울 성수' },
    { image_url: '../app/portfolio/kitchen-n1-4.jpg', region: '서울 반포' },
    { image_url: '../app/portfolio/kitchen-n3-2.jpg', region: '성남 분당' },
    { image_url: '../app/portfolio/kitchen-n3-3.jpg', region: '인천 송도' },
    { image_url: '../app/portfolio/kitchen-n4-1.jpg', region: '성남 판교' },
    { image_url: '../app/portfolio/kitchen-n6-1.jpg', region: '고양 일산' },
    { image_url: '../app/portfolio/kitchen-n6-2.jpg', region: '용인 수지' },
    { image_url: '../app/portfolio/kitchen-n6-3.jpg', region: '고양 일산' },
    { image_url: '../app/portfolio/kitchen-n7-1.jpg', region: '하남 위례' },
    { image_url: '../app/portfolio/kitchen-n7-2.jpg', region: '수원 광교' },
    { image_url: '../app/portfolio/kitchen-n7-3.jpg', region: '서울 마포' },
    { image_url: '../app/portfolio/kitchen-n7-4.jpg', region: '수원 광교' },
    { image_url: '../app/portfolio/funiture-n4-1.jpg', region: '서울 논현' },
  ];

  var S = {
    db: [], // DB 사례 (최신순)
    posts: [], // 화면 순서 = DB 사례 + (DB 를 다 받았으면) 정적 사례
    shown: 0,
    loading: false,
    exhausted: false,
    cursor: null,
    hasRegion: true,
    sb: null,
    open: -1, // 크게 보는 사례
    back: null, // 닫으면 초점을 돌려줄 곳
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** CSS url() 안에 넣을 주소 — 따옴표 · 괄호 · 역슬래시를 막는다 */
  function cssUrl(u) {
    return 'url("' + String(u || '').replace(/["\\\n\r()]/g, encodeURIComponent) + '")';
  }

  // ── 서버 ───────────────────────────────────────────────
  function queryPage(withRegion) {
    var q = S.sb
      .from('collection_posts')
      .select(
        withRegion ? 'id, image_url, region, source, created_at' : 'id, image_url, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (S.cursor) q = q.lt('created_at', S.cursor);
    return q;
  }

  async function fetchPage() {
    if (!S.sb || S.exhausted) return [];
    var res;
    try {
      res = await queryPage(S.hasRegion);
      if (res.error && S.hasRegion) {
        S.hasRegion = false;
        res = await queryPage(false);
      }
    } catch (e) {
      res = { error: e };
    }
    if (res.error) {
      S.exhausted = true;
      return [];
    }
    var rows = res.data || [];
    if (rows.length < PAGE) S.exhausted = true;
    if (rows.length) S.cursor = rows[rows.length - 1].created_at;
    return rows;
  }

  // ── 그리기 ─────────────────────────────────────────────
  function caption(p) {
    var ai = p.source === 'ai_render';
    var region = ai ? '' : String(p.region || '').trim();
    return { brand: ai ? 'AI 연출컷' : '다담가구', region: region, ai: ai };
  }

  function label(p) {
    var c = caption(p);
    return c.ai
      ? 'AI 연출컷'
      : c.region
        ? '다담가구 시공 사례 · ' + c.region
        : '다담가구 시공 사례';
  }

  function tileHTML(p, i) {
    var c = caption(p);
    return (
      '<figure class="cl-tile' +
      (c.ai ? ' cl-tile--ai' : '') +
      '">' +
      '<button type="button" class="cl-open" data-open="' +
      i +
      '" aria-label="' +
      esc(label(p)) +
      ' 크게 보기"><span class="cl-img" style="background-image:' +
      esc(cssUrl(p.image_url)) +
      '"></span></button>' +
      '<figcaption class="cl-cap"><span class="cl-brand">' +
      esc(c.brand) +
      '</span>' +
      (c.region
        ? '<span class="cl-dot" aria-hidden="true"></span><span class="cl-region">' +
          esc(c.region) +
          '</span>'
        : '') +
      '</figcaption></figure>'
    );
  }

  function render(from) {
    var html = '';
    for (var i = from; i < S.shown; i++) html += tileHTML(S.posts[i], i);
    $('clTiles').insertAdjacentHTML('beforeend', html);
  }

  function atEnd() {
    return S.exhausted && S.shown >= S.posts.length;
  }

  function updateState() {
    $('clState').textContent = S.loading
      ? '불러오는 중'
      : atEnd()
        ? S.posts.length
          ? '마지막 사례입니다'
          : ''
        : S.shown + ' / ' + S.posts.length + (S.exhausted ? '' : '+');
    $('clMore').hidden = S.loading || atEnd();
  }

  /**
   * DB 사례를 모두 받은 뒤에 정적 사례를 붙인다 — 최신순이 끝까지 지켜지고, 이미 그린 자리 사이로
   * 새 줄이 끼어들지 않는다 (사이트는 첫 묶음 뒤에 정적 사례를 두고 다음 DB 줄을 그 뒤에 잇는다).
   */
  function syncPosts() {
    S.posts = S.exhausted ? S.db.concat(STATIC) : S.db.slice();
  }

  /** 다음 묶음 — 실제 레코드 수에서 멈춘다 (되풀이하지 않는다) */
  async function loadMore(n) {
    if (S.loading || atEnd()) return;
    S.loading = true;
    updateState();
    while (S.db.length - S.shown < n && !S.exhausted) {
      var rows = await fetchPage();
      S.db = S.db.concat(rows);
      if (!rows.length) break;
    }
    syncPosts();
    var from = S.shown;
    S.shown = Math.min(S.shown + n, S.posts.length);
    render(from);
    S.loading = false;
    updateState();
  }

  // ── 크게 보기 ──────────────────────────────────────────
  function openView(i) {
    var p = S.posts[i];
    if (!p) return;
    if (S.open < 0) S.back = document.activeElement;
    S.open = i;
    $('clViewImg').style.backgroundImage = cssUrl(p.image_url);
    $('clViewImg').setAttribute('aria-label', label(p));
    var c = caption(p);
    $('clViewCap').textContent = c.region ? c.brand + ' · ' + c.region : c.brand;
    $('clPrev').disabled = i <= 0;
    $('clNext').disabled = i >= S.shown - 1;
    $('clView').hidden = false;
    document.body.classList.add('cl-locked');
    $('clClose').focus();
  }

  function closeView() {
    if (S.open < 0) return;
    S.open = -1;
    $('clView').hidden = true;
    $('clViewImg').style.backgroundImage = '';
    document.body.classList.remove('cl-locked');
    if (S.back && S.back.focus) S.back.focus();
  }

  function bind() {
    $('clTiles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) openView(Number(b.getAttribute('data-open')));
    });
    $('clMore').addEventListener('click', function () {
      loadMore(STEP);
    });
    $('clClose').addEventListener('click', closeView);
    $('clPrev').addEventListener('click', function () {
      openView(S.open - 1);
    });
    $('clNext').addEventListener('click', function () {
      openView(S.open + 1);
    });
    // 바깥(어두운 곳)을 눌러도 닫는다
    $('clView').addEventListener('click', function (e) {
      if (e.target === $('clView')) closeView();
    });
    document.addEventListener('keydown', function (e) {
      if (S.open < 0) return;
      if (e.key === 'Escape') closeView();
      else if (e.key === 'ArrowLeft' && S.open > 0) openView(S.open - 1);
      else if (e.key === 'ArrowRight' && S.open < S.shown - 1) openView(S.open + 1);
    });
    // 아래까지 내리면 저절로 더 (지원하는 브라우저만 — 없으면 「더 보기」 단추)
    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting && !S.loading && !atEnd()) loadMore(STEP);
        },
        { rootMargin: '300px' }
      );
      io.observe($('clSentinel'));
    }
  }

  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 없으면 정적 사례만 */
    }
    return null;
  }

  async function init() {
    if (!$('clTiles')) return;
    bind();
    S.sb = client();
    S.loading = true;
    updateState();
    var rows = await fetchPage();
    S.db = rows;
    if (!S.sb) S.exhausted = true;
    syncPosts();
    S.loading = false;
    S.shown = Math.min(FIRST, S.posts.length);
    render(0);
    updateState();
  }

  var api = {
    STATIC: STATIC,
    state: S,
    loadMore: loadMore,
    openView: openView,
    closeView: closeView,
  };
  window.SeganCollection = api;
  api.ready = new Promise(function (resolve) {
    var go = function () {
      init().then(resolve, resolve);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
