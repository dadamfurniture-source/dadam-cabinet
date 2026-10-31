/* ============================================================
   segan/shell.js — SEGAN 앱 셸 (헤더 · 아래 탭 · 푸터 · 로그인 상태 · 서비스 워커)

   탭 4개 (순서 고정): 만들기 · 시공사례 · 내 연출컷 · 내 정보
     + 관리 (관리자에게만 — 내 정보 역할 메뉴와 같은 AdminAccess.isAdmin 이 참일 때 연다, 처음엔 감춤)
     - 폰(좁은 화면): 아래 고정 탭 막대
     - PC(넓은 화면): v5 헤더 모양의 위 메뉴 + 사업자 정보 푸터
       폰에서는 사업자 정보를 내 정보 안에 둔다.
   탭은 로그인 전에도 보인다. 내 연출컷 · 내 정보는 로그인이 없으면
   「로그인이 필요합니다」와 로그인 버튼(돌아올 곳 = 지금 페이지)을 보인다.

   쓰는 법 (segan/*.html):
     <body data-tab="make">            <!-- make | collection | renders | me | admin -->
       <div data-segan-shell="header"></div>
       <main id="main">…</main>
       <div data-segan-shell="footer"></div>
       <div data-segan-shell="tabbar"></div>
     <script src="shell.js" defer></script>   (실제 페이지는 ?v= 자산 버전을 붙인다)
   로그인이 필요한 페이지는 [data-auth-view="checking|signed-out|signed-in"] 세 칸을 둔다.
   signed-out 칸 안의 [data-segan-shell="gate"] 는 이 파일이 로그인 안내로 채운다.

   역할 메뉴(내 정보)는 기존 사이트 판정을 그대로 쓴다 — 새 규칙을 만들지 않는다.
     상세설계   js/detaildesign-access.js  DetailDesignAccess.fetchStatus(…).approved
                (관리자는 언제나, 그 밖은 profiles.tier 가 POLICY.minTier 이상 또는 본사 승인)
     관리자 화면 js/admin-access.js        AdminAccess.isAdmin(sb)  (is_admin RPC)
     작업자 포털 js/mypage-work.js         DadamMyPageWork.shouldShow(GET /work/me)
   링크 주소는 js/site-shell.js 와 같다 (detaildesign.html · admin/index.html · worker.html).

   서비스 워커 등록 — 범위는 /segan/ 하나뿐이다. 기존 사이트는 서비스 워커를 쓰지 않는다.
   ============================================================ */
/* global window, document, navigator, location, fetch, CustomEvent */
(function () {
  'use strict';

  // ── 정본 ─────────────────────────────────────────────
  var TABS = [
    { key: 'make', label: '만들기', href: './', target: 'segan/index.html' },
    {
      key: 'collection',
      label: '시공사례',
      href: 'collection.html',
      target: 'segan/collection.html',
    },
    { key: 'renders', label: '내 연출컷', href: 'renders.html', target: 'segan/renders.html' },
    { key: 'me', label: '내 정보', href: 'me.html', target: 'segan/me.html' },
    // 관리자 전용 — 판정 전에는 감춘다 (applyAdminTab)
    { key: 'admin', label: '관리', href: 'admin.html', target: 'segan/admin.html', admin: true },
  ];

  // 역할 메뉴 — 주소는 js/site-shell.js(DETAIL DESIGN · ACCOUNT_MENU 관리자 페이지)와
  // js/mypage-work.js(작업자 페이지 열기)가 쓰는 페이지 그대로
  var ROLE_LINKS = [
    { key: 'detail', label: '상세설계', href: '../detaildesign.html' },
    { key: 'admin', label: '관리자 화면', href: '../admin/index.html' },
    { key: 'worker', label: '작업자 포털', href: '../worker.html' },
  ];

  // 로그인 — 기존 login.html 의 ?redirect= (js/auth-redirect.js 가 같은 사이트 *.html 만 받는다)
  var LOGIN_PAGE = '../login.html';

  // 사업자 정보 — js/site-shell.js 의 BIZ 와 같은 값이다 (시험이 사이트 푸터와 비교한다).
  var BIZ = {
    desc: '공간을 읽고 가구를 짓습니다. 맞춤 제작 가구의 설계부터 시공까지.',
    tel: '010-7738-6822',
    email: 'dadamfurniture@gmail.com',
    addr: '대구광역시 북구 호국로 21-17, 우측 안쪽 공장(산격동)',
    hours: '평일 09:00 - 18:00',
    copy: '© 2026 다담가구. All rights reserved.',
    biz:
      '상호: 다담가구 | 대표: 홍찬호 | 사업자등록번호: 466-24-01961 | ' +
      '통신판매업 신고번호: 신고 준비 중',
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tabOf(key) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].key === key) return TABS[i];
    return null;
  }

  /** 로그인 뒤 이 탭으로 돌아오는 로그인 주소 */
  function loginHref(key) {
    var tab = tabOf(key) || TABS[0];
    return LOGIN_PAGE + '?redirect=' + encodeURIComponent(tab.target);
  }

  // ── 그리기 ───────────────────────────────────────────
  var ICON_PATHS = {
    make: '<rect x="4.5" y="4.5" width="15" height="15"/><path d="M12 8.5v7M8.5 12h7"/>',
    collection:
      '<rect x="4.5" y="4.5" width="6.5" height="6.5"/><rect x="13" y="4.5" width="6.5" height="6.5"/>' +
      '<rect x="4.5" y="13" width="6.5" height="6.5"/><rect x="13" y="13" width="6.5" height="6.5"/>',
    renders:
      '<rect x="3.5" y="5.5" width="17" height="13"/><path d="M3.5 16l4.8-4.8 3.7 3.7 2.4-2.4 6.1 6"/>' +
      '<circle cx="15.6" cy="9.4" r="1.3"/>',
    me: '<circle cx="12" cy="8.4" r="3.4"/><path d="M5 19.5c0-3.5 3.1-5.6 7-5.6s7 2.1 7 5.6"/>',
    admin: '<rect x="5.5" y="4.5" width="13" height="15"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>',
  };

  function icon(key) {
    return (
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="1.2" aria-hidden="true" focusable="false">' +
      ICON_PATHS[key] +
      '</svg>'
    );
  }

  function links(current, withIcon) {
    return TABS.map(function (t) {
      return (
        '<a href="' +
        t.href +
        '" data-tab-link="' +
        t.key +
        '"' +
        (t.key === current ? ' aria-current="page"' : '') +
        (t.admin ? ' hidden' : '') +
        '>' +
        (withIcon ? icon(t.key) : '') +
        '<span>' +
        esc(t.label) +
        '</span></a>'
      );
    }).join('');
  }

  function headerHTML(current) {
    return (
      '<header class="sg-header">' +
      '<a class="sg-brand" href="./"><img src="icons/wordmark.svg?v=2026110105" alt="SEGAN" width="477" height="75" /></a>' +
      '<nav class="sg-nav" aria-label="주 메뉴">' +
      links(current, false) +
      '</nav>' +
      '</header>'
    );
  }

  function tabbarHTML(current) {
    return '<nav class="sg-tabbar" aria-label="주 메뉴">' + links(current, true) + '</nav>';
  }

  function bizLines() {
    return (
      '<p>' +
      esc(BIZ.desc) +
      '</p>' +
      '<p>' +
      esc(BIZ.tel) +
      '<br>' +
      esc(BIZ.email) +
      '<br>' +
      esc(BIZ.addr) +
      '<br>' +
      esc(BIZ.hours) +
      '</p>'
    );
  }

  function footerHTML() {
    return (
      '<footer class="sg-footer"><div class="sg-footer-in">' +
      bizLines() +
      '<div class="sg-footer-bottom"><span>' +
      esc(BIZ.copy) +
      '</span><span>' +
      esc(BIZ.biz) +
      '</span></div>' +
      '</div></footer>'
    );
  }

  /** 폰에서 내 정보 아래에 두는 사업자 정보 (넓은 화면에서는 푸터가 같은 내용을 보인다) */
  function bizHTML() {
    return (
      '<section class="sg-biz" aria-label="사업자 정보">' +
      bizLines() +
      '<p>' +
      esc(BIZ.copy) +
      '<br>' +
      esc(BIZ.biz) +
      '</p>' +
      '</section>'
    );
  }

  /** 내 정보의 역할 메뉴 — 처음엔 모두 감추고, 판정이 참인 줄만 연다 */
  function rolesHTML() {
    return (
      '<section class="sg-section" id="sgRoles" aria-labelledby="sgRolesTitle" hidden>' +
      '<h2 id="sgRolesTitle">업무</h2>' +
      '<ul class="sg-rows">' +
      ROLE_LINKS.map(function (r) {
        return (
          '<li data-role="' +
          r.key +
          '" hidden><a class="sg-row" href="' +
          r.href +
          '">' +
          esc(r.label) +
          '</a></li>'
        );
      }).join('') +
      '</ul>' +
      '</section>'
    );
  }

  /** 은/는 — 마지막 글자에 받침이 있으면 「은」 */
  function topic(word) {
    var c = word.charCodeAt(word.length - 1) - 0xac00;
    return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? '은' : '는');
  }

  function gateHTML(key) {
    var tab = tabOf(key);
    return (
      '<div class="sg-gate">' +
      '<p class="sg-title">로그인이 필요합니다</p>' +
      '<p class="sg-note">' +
      esc(topic(tab ? tab.label : '이 화면')) +
      ' 로그인한 뒤에 볼 수 있습니다.</p>' +
      '<a class="sg-btn" href="' +
      esc(loginHref(key)) +
      '">로그인</a>' +
      '</div>'
    );
  }

  // ── 로그인 상태 ───────────────────────────────────────
  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 클라이언트가 없으면 로그인 안 된 것으로 본다 */
    }
    return null;
  }

  async function sessionOf(sb) {
    if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      return r && r.data ? r.data.session : null;
    } catch {
      return null;
    }
  }

  /** 작업자인가 — 마이페이지와 같은 GET /work/me + DadamMyPageWork.shouldShow. 실패하면 false */
  async function isWorker(session) {
    try {
      var cfg = window.DADAM_CONFIG || {};
      var base = (cfg.workflowApi && cfg.workflowApi.url) || '';
      var token = session && session.access_token;
      if (!base || !token || !window.DadamMyPageWork) return false;
      var res = await fetch(base + '/work/me', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      var body = await res.json();
      if (!res.ok || !body || !body.success) return false;
      return window.DadamMyPageWork.shouldShow(body.data);
    } catch {
      return false;
    }
  }

  /** 역할 메뉴 판정 — 기존 사이트 모듈에 맡긴다. 모르면 감춘다 */
  async function detectRoles(sb, session) {
    var out = { detail: false, admin: false, worker: false };
    if (!sb || !session) return out;
    var userId = session.user && session.user.id;
    var jobs = [
      (async function () {
        if (window.AdminAccess) out.admin = (await window.AdminAccess.isAdmin(sb)) === true;
      })(),
      (async function () {
        if (window.DetailDesignAccess && userId) {
          var st = await window.DetailDesignAccess.fetchStatus(sb, userId);
          out.detail = !!(st && st.approved);
        }
      })(),
      (async function () {
        out.worker = await isWorker(session);
      })(),
    ];
    await Promise.all(
      jobs.map(function (p) {
        return p.catch(function () {});
      })
    );
    return out;
  }

  function showView(name) {
    document.querySelectorAll('[data-auth-view]').forEach(function (el) {
      el.hidden = el.getAttribute('data-auth-view') !== name;
    });
  }

  async function applyMe(sb, session) {
    var email = document.getElementById('sgAccountEmail');
    if (email) email.textContent = (session.user && session.user.email) || '';

    var logout = document.getElementById('sgLogout');
    if (logout) {
      logout.onclick = async function () {
        try {
          // 이 기기의 업무 알림 구독을 지운다 — 다음 사람이 앞사람 알림을 받지 않게 (segan/push.js)
          var Push = window.SeganPush;
          if (Push && Push.forget) await Push.forget();
        } catch {
          /* 그래도 로그아웃한다 */
        }
        try {
          await sb.auth.signOut();
        } catch {
          /* 그래도 새로 고친다 */
        }
        try {
          if (window.AdminAccess) window.AdminAccess.clearCache();
          if (window.DetailDesignAccess) window.DetailDesignAccess.clearCache();
        } catch {
          /* noop */
        }
        location.reload();
      };
    }

    var roles = await detectRoles(sb, session);
    var any = false;
    ROLE_LINKS.forEach(function (r) {
      var item = document.querySelector('[data-role="' + r.key + '"]');
      if (item) item.hidden = !roles[r.key];
      if (roles[r.key]) any = true;
    });
    var section = document.getElementById('sgRoles');
    if (section) section.hidden = !any;
    return roles;
  }

  async function applyAuth(current) {
    if (!document.querySelector('[data-auth-view]')) return { session: null };
    var sb = client();
    var session = await sessionOf(sb);
    if (!session) {
      showView('signed-out');
      return { session: null };
    }
    showView('signed-in');
    var roles = current === 'me' ? await applyMe(sb, session) : null;
    window.dispatchEvent(new CustomEvent('segan:auth', { detail: { sb: sb, session: session } }));
    // 탭 페이지 스크립트(renders.js 등)가 같은 클라이언트 · 세션을 쓴다 — SeganShell.ready 로 받는다
    return { sb: sb, session: session, roles: roles };
  }

  /**
   * 관리 탭 — 관리자에게만 연다. 내 정보는 역할 메뉴 판정(roles.admin)을 그대로 쓰고,
   * 다른 탭은 AdminAccess.isAdmin(sb) 를 묻는다 (참만 1분 기억한다 — js/admin-access.js). 모르면 감춘 채 둔다.
   */
  async function applyAdminTab(r) {
    var on = false;
    try {
      if (r && r.roles) on = r.roles.admin === true;
      else if (window.AdminAccess) {
        var sb = (r && r.sb) || client();
        var session = (r && r.session) || (await sessionOf(sb));
        if (sb && session) on = (await window.AdminAccess.isAdmin(sb)) === true;
      }
    } catch {
      on = false;
    }
    document.querySelectorAll('[data-tab-link="admin"]').forEach(function (a) {
      a.hidden = !on;
    });
    return on;
  }

  // ── 주입 ─────────────────────────────────────────────
  function mount() {
    var current = (document.body && document.body.getAttribute('data-tab')) || '';
    document.querySelectorAll('[data-segan-shell]').forEach(function (slot) {
      var kind = slot.getAttribute('data-segan-shell');
      if (kind === 'header') slot.outerHTML = headerHTML(current);
      else if (kind === 'tabbar') slot.outerHTML = tabbarHTML(current);
      else if (kind === 'footer') slot.outerHTML = footerHTML();
      else if (kind === 'biz') slot.outerHTML = bizHTML();
      else if (kind === 'gate') slot.outerHTML = gateHTML(current);
      else if (kind === 'roles') slot.outerHTML = rolesHTML();
    });
    return applyAuth(current).then(function (r) {
      return applyAdminTab(r).then(function (on) {
        r.admin = on;
        return r;
      });
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/segan/sw.js', { scope: '/segan/' }).catch(function () {
        // 등록 실패해도 앱은 그대로 쓴다 (오프라인 화면만 없다)
      });
    });
  }

  var ready = new Promise(function (resolve) {
    var run = function () {
      mount().then(resolve, function () {
        resolve({ session: null });
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  });

  registerServiceWorker();

  window.SeganShell = {
    TABS: TABS,
    ROLE_LINKS: ROLE_LINKS,
    BIZ: BIZ,
    loginHref: loginHref,
    detectRoles: detectRoles,
    ready: ready,
  };
})();
