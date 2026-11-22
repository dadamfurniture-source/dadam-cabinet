/* ============================================================
   segan/collection.js — 「시공사례」 탭 (segan/collection.html)

   사진을 인스타그램처럼 정사각 칸으로 늘어놓는다 — 폰 3칸 · PC(1024px~) 4칸, 칸 사이 2~3px (segan/shell.css .cl-grid).
   누구나(로그인 없이) 본다:
     collection_posts 최신순(created_at DESC), 24줄씩 키셋 (idx_collection_posts_created) — 공개 칸만 읽는다.
       직접 올린 사진(source 'upload')과 본사가 고른 연출컷(hq_picked_at 있음, DB 0075)만 읽는다 —
       2026-11-20 대표님 「연출컷은 본사에서 정하고 올릴 수 있도록」. 연출컷 자동 게시는 끔(COLLECTION_AUTO_POST "off"),
       본사는 마이페이지 › 플랫폼 › 시공사례 고르기(segan/hq-collection.js)에서 올리고 내린다
       id · image_url · place_label · door_color · company_id · like_count · source · created_at (DB 0049)
     업체 이름은 RPC collection_post_companies (업체가 있는 게시물만, 쪽마다 한 번)
     로그인했으면 이 쪽에서 내가 좋아한 것 — collection_likes post_id (본인 줄만 읽힌다)
     AI 연출 사진 36장(app/portfolio/luxe-manifest.json)은 DB 0076 이 게시물 행으로 넣었다 (2026-11-21 대표님 「하트 달아주고」)
       — 다른 게시물처럼 읽히고 ♡ 가 달린다. DB 사례를 다 받은 뒤, 그 행으로 오지 않은 사진만 STATIC 에서 붙인다
       (DB 를 못 읽을 때 · 0076 적용 전 · 누가 내린 사진 — 그 칸에는 ♡ 가 없다. 같은 사진이 두 번 나오지 않는다)
   처음 24장 · 24장씩 더 — 아래까지 내리면 저절로(IntersectionObserver), 없으면 「더 보기」 단추.
   사진 아래 색상 영역에 색상을 하나씩과 ♡(좋아요 — DB 게시물만). 사진을 누르면 사진 보기
   (색상 · 업체 정보 · 좋아요 · 이 스타일로 연출컷), 그 안의 사진을 누르면 사진만 전체 화면
   — segan/collection-view.js (SeganPostView) (2026-11-21 대표님)
   (예전에 자동으로 올라간 연출컷 행은 DB 에 남아 있지만 본사가 고르기 전에는 안 보인다. 연출컷도 사진 위 표시 없이, 업체 칸 「AI 연출」)
   다운로드 단추 · 링크는 두지 않는다. 관리자 「내리기」는 사이트에만 있다.
   사진 보기의 「공유」는 사진 한 장 주소 /segan/p/<id> (DB 게시물만 — 메신저 미리보기는 functions/segan/p/[id].js).
   그 주소로 들어오면 여기 ?p=<id> 로 넘어와 그 사진 보기를 바로 연다 (목록에 없으면 한 건 읽는다 · ?p= 는 열 때 지운다).
   자재 칸은 여기서 뺐다 — 자재 글은 매거진으로 옮긴다 (/material 은 /segan/blog 로 넘긴다, _redirects).
   ============================================================ */
/* global window, document, IntersectionObserver, URL, URLSearchParams */
(function () {
  'use strict';

  var PAGE = 24; // 서버에서 한 번에 · 처음 노출 · 더 보기마다 (3칸 · 4칸 모두 줄이 꽉 찬다)
  var COLS = 'id,image_url,place_label,door_color,company_id,like_count,source,created_at';
  var SELF = 'collection'; // 로그인 뒤 돌아올 곳 (segan/shell.js loginHref)

  // AI 연출 사진 36장 (app/portfolio/luxe-manifest.json, segan/ 에서 보므로 ../) — 장소 대신 품목, 색상 = 예림 도어 자재 이름.
  // 밝은 luxe 15장과 다양한 색 · 디자인 · 품목 mix 21장을 고르게 섞은 차례 (2026-11-20).
  // 실제 시공 사진이 아니므로 지역 · 업체를 붙이지 않는다 (사진 보기의 업체 줄은 「AI 연출」)
  // 같은 36장이 DB 게시물로도 들어 있다 (database/migrations/0076 — 차례 · 품목 · 색상이 이 목록과 같다, 시험이 견준다).
  // 여기 것은 DB 로 오지 않았을 때만 그린다 (syncPosts)
  var STATIC = [
    {
      image_url: '../app/portfolio/mix-01.jpg',
      place: '일자형 주방',
      color: '매트 딥그린 · 카카오월넛',
    },
    {
      image_url: '../app/portfolio/mix-10.jpg',
      place: '안방 붙박이장',
      color: '매트 카페브라운 · 매트 아이보리',
    },
    {
      image_url: '../app/portfolio/luxe-01.jpg',
      place: '아일랜드 주방',
      color: '매트 화이트 · 세이오크',
    },
    {
      image_url: '../app/portfolio/mix-16.jpg',
      place: '홈카페장',
      color: '아크 마멀레이드 · 매트 아이보리',
    },
    {
      image_url: '../app/portfolio/mix-02.jpg',
      place: '아일랜드 주방',
      color: '매트 블랙 · 카타니아 오크',
    },
    {
      image_url: '../app/portfolio/luxe-10.jpg',
      place: '안방 붙박이장',
      color: '매트 캐시미어 · 세이오크',
    },
    {
      image_url: '../app/portfolio/luxe-02.jpg',
      place: '일자형 주방',
      color: '매트 아이보리 · 슈가엘름',
    },
    {
      image_url: '../app/portfolio/luxe-13.jpg',
      place: '홈카페장',
      color: '매트 밀크화이트 · 세이오크',
    },
    {
      image_url: '../app/portfolio/mix-03.jpg',
      place: 'ㄱ자형 주방',
      color: '매트 인디고 · 매트 화이트',
    },
    {
      image_url: '../app/portfolio/mix-11.jpg',
      place: '드레스룸',
      color: '그레이쉬 오크 · 매트 다크그레이',
    },
    {
      image_url: '../app/portfolio/luxe-03.jpg',
      place: 'ㄱ자형 주방',
      color: '매트 밀크화이트 · 매트 샌드그레이',
    },
    {
      image_url: '../app/portfolio/mix-17.jpg',
      place: '거실 수납장',
      color: '매트 다크그레이 · 소프트월넛',
    },
    {
      image_url: '../app/portfolio/mix-04.jpg',
      place: 'ㄷ자형 주방',
      color: '매트 미스트그린 · 매트 아이보리',
    },
    {
      image_url: '../app/portfolio/luxe-11.jpg',
      place: '드레스룸',
      color: '매트 화이트 · 프렌치오크',
    },
    {
      image_url: '../app/portfolio/luxe-04.jpg',
      place: 'ㄷ자형 주방',
      color: '매트 캐시미어 · 프렌치오크',
    },
    {
      image_url: '../app/portfolio/luxe-14.jpg',
      place: '다이닝 수납장',
      color: '매트 샌드그레이 · 매트 밀크화이트',
    },
    {
      image_url: '../app/portfolio/mix-05.jpg',
      place: '대면형 주방',
      color: '매트 타우니레드 · 매트 샌드그레이',
    },
    {
      image_url: '../app/portfolio/mix-12.jpg',
      place: '아이방 붙박이장',
      color: '매트 스카이브리즈 · 슈가엘름',
    },
    {
      image_url: '../app/portfolio/luxe-05.jpg',
      place: '대면형 주방',
      color: '매트 화이트 · 아크 샌드듄',
    },
    {
      image_url: '../app/portfolio/mix-18.jpg',
      place: '다이닝 수납장',
      color: '아크 포레스트그린 · 네이처 오크',
    },
    {
      image_url: '../app/portfolio/mix-06.jpg',
      place: '일자형 주방',
      color: '아크 플라워블루 · 매트 화이트',
    },
    {
      image_url: '../app/portfolio/luxe-12.jpg',
      place: '드레스룸',
      color: '매트 아이보리 · 슈가엘름',
    },
    {
      image_url: '../app/portfolio/luxe-06.jpg',
      place: '아일랜드 주방',
      color: '매트 샌드그레이 · 매트 화이트',
    },
    {
      image_url: '../app/portfolio/luxe-15.jpg',
      place: '거실 수납장',
      color: '아크 샌드듄 · 프렌치오크',
    },
    {
      image_url: '../app/portfolio/mix-07.jpg',
      place: '11자 주방',
      color: '콘크리트 그레이 · 네이처 오크',
    },
    {
      image_url: '../app/portfolio/mix-13.jpg',
      place: '현관 신발장',
      color: '매트 그레이 · 네이처 오크',
    },
    {
      image_url: '../app/portfolio/luxe-07.jpg',
      place: '냉장고장',
      color: '매트 아이보리 · 세이오크',
    },
    {
      image_url: '../app/portfolio/mix-19.jpg',
      place: '세탁실장',
      color: '매트 버터스카치 · 매트 화이트',
    },
    {
      image_url: '../app/portfolio/mix-08.jpg',
      place: '아일랜드 주방',
      color: '글로시 화이트 · 윈체스터월넛',
    },
    {
      image_url: '../app/portfolio/mix-14.jpg',
      place: '드레스룸',
      color: '매트 로지핑크 · 매트 화이트',
    },
    {
      image_url: '../app/portfolio/luxe-08.jpg',
      place: '11자 주방',
      color: '매트 밀크화이트 · 프렌치오크',
    },
    {
      image_url: '../app/portfolio/mix-20.jpg',
      place: '화장대',
      color: '세라믹 문 브릭 · 매트 밀크화이트',
    },
    {
      image_url: '../app/portfolio/mix-09.jpg',
      place: '냉장고장',
      color: '매트 스모키올리브 · 피넛오크',
    },
    {
      image_url: '../app/portfolio/mix-15.jpg',
      place: '작은방 붙박이장',
      color: '아크 미드나잇블루 · 카카오월넛',
    },
    {
      image_url: '../app/portfolio/luxe-09.jpg',
      place: '주방 디테일',
      color: '매트 화이트 · 세이오크',
    },
    {
      image_url: '../app/portfolio/mix-21.jpg',
      place: '서재 책장',
      color: '카카오월넛 · 매트 블랙',
    },
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
      .or('source.eq.upload,hq_picked_at.not.is.null')
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
  function isLiked(p) {
    return !!(p && p.id && S.liked[p.id]);
  }

  function render(from) {
    var html = '';
    for (var i = from; i < S.shown; i++)
      html += PV().tileHTML(S.posts[i], i, { liked: isLiked(S.posts[i]) });
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

  /** DB 사례를 모두 받은 뒤에, 게시물 행으로 오지 않은 AI 연출 사진만 붙인다 (같은 사진을 두 번 그리지 않는다) */
  function syncPosts() {
    if (!S.exhausted) {
      S.posts = S.db.slice();
      return;
    }
    var have = {};
    S.db.forEach(function (p) {
      if (p.stem) have[p.stem] = true;
    });
    S.posts = S.db.concat(
      STATIC.map(PV().fromStatic).filter(function (p) {
        return !have[p.stem];
      })
    );
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

  // ── 사진 보기 · 좋아요 ─────────────────────────────────
  /** 사진 한 장에 쓰는 것 — 사진 보기 · 타일의 ♡ 가 같이 쓴다 (post: 목록 밖 사진 — 공유 주소로 들어온 것) */
  function postOpts(i, tile, post) {
    var p = post || S.posts[i];
    return {
      sb: S.sb,
      userId: S.userId,
      // 열 때마다 다시 본다 — 타일에서 ♡ 를 누른 뒤 사진 보기를 열어도 맞는다
      liked: function () {
        return isLiked(p);
      },
      loginHref: loginHref(),
      img: tile ? tile.querySelector('img') : null,
      onLike: function (post, on) {
        if (on) S.liked[post.id] = true;
        else delete S.liked[post.id];
        // 타일의 ♡ 도 같이 (사진 보기에서 눌렀을 때)
        var heart = $('clTiles').querySelector('[data-like="' + i + '"]');
        if (heart) heart.setAttribute('aria-pressed', on ? 'true' : 'false');
      },
      onFail: function () {
        $('clState').textContent = PV().TEXT.likeFail;
      },
      onClose: function () {
        S.sheet = null;
      },
    };
  }

  /** 사진을 눌렀다 — 사진 보기 (색상 · 업체 정보). 사진만 전체 화면은 그 안의 사진을 누르면 */
  function openPost(i, tile) {
    var p = S.posts[i];
    if (!p || !PV()) return null;
    S.sheet = PV().open(p, postOpts(i, tile));
    return S.sheet;
  }

  /** 공유 주소로 들어왔다 (?p=<id>) — 그 사진 보기를 연다. 목록에 없으면 같은 공개 조건으로 한 건 읽는다 */
  function sharedId() {
    try {
      var id = new URLSearchParams(window.location.search).get('p') || '';
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        ? id.toLowerCase()
        : '';
    } catch {
      return '';
    }
  }

  function dropShared() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('p');
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* 주소는 그대로 둔다 */
    }
  }

  async function openShared(id) {
    // 주소에서 먼저 지운다 — 사진 보기는 방문 기록을 하나 쌓고 닫을 때 되돌아오므로, 되돌아온 주소에 ?p= 가 남지 않게
    dropShared();
    var i = S.posts.findIndex(function (p) {
      return p.id === id;
    });
    var post = i >= 0 ? S.posts[i] : null;
    if (!post && S.sb) {
      try {
        var res = await S.sb
          .from('collection_posts')
          .select(COLS)
          .eq('id', id)
          .or('source.eq.upload,hq_picked_at.not.is.null')
          .limit(1);
        var row = res && !res.error && res.data ? res.data[0] : null;
        if (row && row.image_url) {
          var both = await Promise.all([
            row.company_id ? PV().companies(S.sb, [row.id]) : {},
            PV().myLikes(S.sb, S.userId, [row.id]),
          ]);
          if (both[1][row.id]) S.liked[row.id] = true;
          post = PV().fromRow(row, both[0][row.id]);
        }
      } catch {
        post = null;
      }
    }
    if (!post) return null; // 없거나 숨은 사진 — 목록만
    var tile = i >= 0 ? $('clTiles').querySelector('[data-open="' + i + '"]') : null;
    S.sheet = PV().open(post, postOpts(i, tile, post));
    return S.sheet;
  }

  /** 타일의 ♡ 를 눌렀다 */
  function likePost(i, btn) {
    var p = S.posts[i];
    if (!p || !PV()) return Promise.resolve(false);
    if ($('clState').textContent === PV().TEXT.likeFail) $('clState').textContent = '';
    return PV().likeTile(btn, p, postOpts(i, null));
  }

  function bind() {
    $('clTiles').addEventListener('click', function (e) {
      var heart = e.target.closest('[data-like]');
      if (heart) {
        likePost(Number(heart.getAttribute('data-like')), heart);
        return;
      }
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
    var shared = sharedId();
    if (shared) await openShared(shared);
  }

  var api = {
    STATIC: STATIC,
    PAGE: PAGE,
    COLS: COLS,
    state: S,
    loadMore: loadMore,
    openPost: openPost,
    openShared: openShared,
    likePost: likePost,
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
