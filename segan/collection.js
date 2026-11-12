/* ============================================================
   segan/collection.js — 「시공사례」 탭 (segan/collection.html)

   사진을 인스타그램처럼 정사각 칸으로 늘어놓는다 — 폰 3칸 · PC(1024px~) 4칸, 칸 사이 2~3px (segan/shell.css .cl-grid).
   누구나(로그인 없이) 본다:
     collection_posts 최신순(created_at DESC), 24줄씩 키셋 (idx_collection_posts_created) — 공개 칸만 읽는다
       id · image_url · place_label · door_color · company_id · like_count · source · created_at (DB 0049)
     업체 이름은 RPC collection_post_companies (업체가 있는 게시물만, 쪽마다 한 번)
     로그인했으면 이 쪽에서 내가 좋아한 것 — collection_likes post_id (본인 줄만 읽힌다)
     DB 사례를 다 받은 뒤에 자체 시공 사진(STATIC — 사이트 collection.html 과 같은 목록)을 붙인다
       (최신순이 끝까지 이어지고, 이미 그린 자리 사이로 새 줄이 끼어들지 않는다)
   처음 24장 · 24장씩 더 — 아래까지 내리면 저절로(IntersectionObserver), 없으면 「더 보기」 단추.
   누르면 사진 보기(장소 · 색상 · 업체 · 좋아요 · 이 스타일로 연출컷) — segan/collection-view.js (SeganPostView)
   AI 연출컷(source 'ai_render')은 타일 귀퉁이에 「AI」 — 실제 시공 사진으로 오해하지 않게.
   다운로드 단추 · 링크는 두지 않는다. 관리자 「내리기」는 사이트에만 있다.
   자재 칸은 여기서 뺐다 — 자재 글은 매거진으로 옮긴다 (/material 은 /segan/blog 로 넘긴다, _redirects).
   ============================================================ */
/* global window, document, IntersectionObserver */
(function () {
  'use strict';

  var PAGE = 24; // 서버에서 한 번에 · 처음 노출 · 더 보기마다 (3칸 · 4칸 모두 줄이 꽉 찬다)
  var COLS = 'id,image_url,place_label,door_color,company_id,like_count,source,created_at';
  var SELF = 'collection'; // 로그인 뒤 돌아올 곳 (segan/shell.js loginHref)

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
    db: [], // DB 사례 (최신순, SeganPostView 모양)
    posts: [], // 화면 순서 = DB 사례 + (DB 를 다 받았으면) 정적 사례
    shown: 0,
    loading: false,
    exhausted: false,
    cursor: null,
    sb: null,
    userId: '', // 로그인한 사람 (없으면 '')
    liked: {}, // 게시물 id → true (내가 좋아한 것)
    sheet: null, // 열린 사진 보기
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function PV() {
    return window.SeganPostView;
  }

  function loginHref() {
    var Shell = window.SeganShell;
    return Shell && Shell.loginHref ? Shell.loginHref(SELF) : '../login.html';
  }

  // ── 서버 ───────────────────────────────────────────────
  function queryPage() {
    var q = S.sb
      .from('collection_posts')
      .select(COLS)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (S.cursor) q = q.lt('created_at', S.cursor);
    return q;
  }

  /** 다음 쪽 — 게시물 + 업체 이름 + (로그인했으면) 내 좋아요. 못 읽으면 더 묻지 않는다 */
  async function fetchPage() {
    if (!S.sb || S.exhausted) return [];
    var res;
    try {
      res = await queryPage();
    } catch (e) {
      res = { error: e };
    }
    if (!res || res.error) {
      S.exhausted = true;
      return [];
    }
    var rows = (res.data || []).filter(function (r) {
      return r && r.id && r.image_url;
    });
    if ((res.data || []).length < PAGE) S.exhausted = true;
    if (rows.length) S.cursor = rows[rows.length - 1].created_at;
    var ids = rows.map(function (r) {
      return r.id;
    });
    var withCompany = rows
      .filter(function (r) {
        return !!r.company_id;
      })
      .map(function (r) {
        return r.id;
      });
    var both = await Promise.all([
      PV().companies(S.sb, withCompany),
      PV().myLikes(S.sb, S.userId, ids),
    ]);
    Object.keys(both[1]).forEach(function (id) {
      S.liked[id] = true;
    });
    return rows.map(function (r) {
      return PV().fromRow(r, both[0][r.id]);
    });
  }

  // ── 그리기 ─────────────────────────────────────────────
  function render(from) {
    var html = '';
    for (var i = from; i < S.shown; i++) html += PV().tileHTML(S.posts[i], i);
    $('clTiles').insertAdjacentHTML('beforeend', html);
  }

  function atEnd() {
    return S.exhausted && S.shown >= S.posts.length;
  }

  function updateState() {
    $('clState').textContent = S.loading
      ? '불러오는 중'
      : atEnd() && S.posts.length
        ? '마지막 사례입니다'
        : '';
    $('clMore').hidden = S.loading || atEnd();
  }

  /** DB 사례를 모두 받은 뒤에 정적 사례를 붙인다 */
  function syncPosts() {
    S.posts = S.exhausted ? S.db.concat(STATIC.map(PV().fromStatic)) : S.db.slice();
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

  // ── 사진 보기 ──────────────────────────────────────────
  function openPost(i, tile) {
    var p = S.posts[i];
    if (!p || !PV()) return null;
    S.sheet = PV().open(p, {
      sb: S.sb,
      userId: S.userId,
      liked: !!(p.id && S.liked[p.id]),
      loginHref: loginHref(),
      img: tile ? tile.querySelector('img') : null,
      onLike: function (post, on) {
        if (on) S.liked[post.id] = true;
        else delete S.liked[post.id];
      },
      onClose: function () {
        S.sheet = null;
      },
    });
    return S.sheet;
  }

  function bind() {
    $('clTiles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) openPost(Number(b.getAttribute('data-open')), b);
    });
    PV().guardImages($('clTiles'));
    $('clMore').addEventListener('click', function () {
      loadMore(PAGE);
    });
    // 아래까지 내리면 저절로 더 (지원하는 브라우저만 — 없으면 「더 보기」 단추)
    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting && !S.loading && !atEnd()) loadMore(PAGE);
        },
        { rootMargin: '600px' }
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

  /** 로그인한 사람 — 이 기기의 세션만 본다 (없으면 '') */
  async function userOf(sb) {
    if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') return '';
    try {
      var r = await sb.auth.getSession();
      var s = r && r.data ? r.data.session : null;
      return (s && s.user && s.user.id) || '';
    } catch {
      return '';
    }
  }

  async function init() {
    if (!$('clTiles') || !PV()) return;
    bind();
    S.sb = client();
    S.loading = true;
    updateState();
    S.userId = await userOf(S.sb);
    var rows = await fetchPage();
    S.db = rows;
    if (!S.sb) S.exhausted = true;
    syncPosts();
    S.loading = false;
    S.shown = Math.min(PAGE, S.posts.length);
    render(0);
    updateState();
  }

  var api = {
    STATIC: STATIC,
    PAGE: PAGE,
    COLS: COLS,
    state: S,
    loadMore: loadMore,
    openPost: openPost,
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
