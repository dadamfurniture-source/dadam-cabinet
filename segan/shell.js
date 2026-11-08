/* ============================================================
   segan/shell.js — SEGAN 앱 셸 (헤더 · 아래 탭 · 푸터 · 로그인 상태 · 서비스 워커)

   탭 4개 (순서 고정): 만들기 · 시공사례 · 내 연출컷 · 내 정보
     + 관리 (관리자에게만 — 내 정보 역할 메뉴와 같은 AdminAccess.isAdmin 이 참일 때 연다, 처음엔 감춤)
     + 작업 (작업자에게만 — 같은 역할 메뉴 판정 GET /work/me + DadamMyPageWork.shouldShow, 처음엔 감춤.
            예전 worker.html 작업자 포털을 앱 안 segan/work.html 로 옮겼다)
     + 비서 (AI 비서 자격이 있는 업체 구성원에게만 — assistant-api GET /assistant/me 의 level 이 full · read 일 때,
            처음엔 감춤. 참만 1분 기억)
     - 폰(좁은 화면): 아래 고정 탭 막대
     - PC(넓은 화면): v5 헤더 모양의 위 메뉴 + 사업자 정보 푸터
       폰에서는 사업자 정보를 내 정보 안에 둔다.
   탭은 로그인 전에도 보인다. 내 연출컷 · 내 정보는 로그인이 없으면
   「로그인이 필요합니다」와 로그인 버튼(돌아올 곳 = 지금 페이지)을 보인다.

   쓰는 법 (segan/*.html):
     <body data-tab="make">            <!-- make | collection | renders | me | assistant | admin | work -->
       <div data-segan-shell="header"></div>
       <main id="main">…</main>
       <div data-segan-shell="footer"></div>
       <div data-segan-shell="tabbar"></div>
     <script src="shell.js" defer></script>   (실제 페이지는 ?v= 자산 버전을 붙인다)
   로그인이 필요한 페이지는 [data-auth-view="checking|signed-out|signed-in"] 세 칸을 둔다.
   signed-out 칸 안의 [data-segan-shell="gate"] 는 이 파일이 로그인 안내로 채운다.

   역할 메뉴(내 정보)는 기존 판정을 그대로 쓴다 — 새 규칙을 만들지 않는다.
     설계       워크플로 API GET /planner/access  (200 이면 연다 — 다담 공장 · Expert · Agent · MANAGER 업체 구성원 · 관리자,
                판정은 workers/workflow-api/src/planner-drafts.js canUsePlanner. 403 · 실패는 감춘다)
                주소 planner/ = 간편 플래너 웹판 (/segan/planner/ — 다른 Worker, 이 저장소 밖)
     관리자 화면 js/admin-access.js        AdminAccess.isAdmin(sb)  (is_admin RPC)
     작업자 포털 js/mypage-work.js         DadamMyPageWork.shouldShow(GET /work/me)
   관리자 화면 주소는 js/site-shell.js 와 같다 (admin/index.html).

   서비스 워커 등록 — 범위는 /segan/ 하나뿐이다. 기존 사이트는 서비스 워커를 쓰지 않는다.

   시트 · 옆 패널 · 가운데 창 — SeganShell.sheet (아래 「시트」 칸에 규칙과 쓰는 법)
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
    // AI 비서 자격이 있는 업체 구성원 — 판정 전에는 감춘다 (applyRoleTabs · hasAssistant)
    {
      key: 'assistant',
      label: '비서',
      href: 'assistant.html',
      target: 'segan/assistant.html',
      assistant: true,
    },
    // 관리자 전용 — 판정 전에는 감춘다 (applyAdminTab)
    { key: 'admin', label: '관리', href: 'admin.html', target: 'segan/admin.html', admin: true },
    // 작업자 전용 — 판정 전에는 감춘다 (applyRoleTabs)
    { key: 'work', label: '작업', href: 'work.html', target: 'segan/work.html', worker: true },
  ];

  // 역할 메뉴 — 설계는 간편 플래너 웹판(/segan/planner/), 관리자 화면은 js/site-shell.js(ACCOUNT_MENU)와
  // 같은 페이지, 작업은 앱 안 탭
  var ROLE_LINKS = [
    { key: 'planner', label: '설계', href: 'planner/' }, // 간편 플래너 — 예전 상세설계 자리
    { key: 'admin', label: '관리자 화면', href: '../admin/index.html' },
    { key: 'worker', label: '작업', href: 'work.html' }, // 작업자 포털 — 앱 안 「작업」 탭
  ];

  // 로그인 — 기존 login.html 의 ?redirect= (js/auth-redirect.js 가 같은 사이트 *.html 만 받는다)
  var LOGIN_PAGE = '../login.html';

  // AI 비서 워커 (workers/assistant-api) — js/config.js 에 assistantApi.url 이 있으면 그 주소
  var ASSISTANT_API = 'https://dadam-assistant-api.dadamfurniture.workers.dev';
  var ASSISTANT_MEMO = 'segan.assistant.on.'; // + 사용자 id → 참으로 판정한 때 (sessionStorage)
  var ASSISTANT_MEMO_MS = 60000;

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
    assistant: '<path d="M4.5 5.5h15v10h-8.2l-3.8 3.3v-3.3h-3z"/><path d="M8.5 10.5h7"/>',
    admin: '<rect x="5.5" y="4.5" width="13" height="15"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>',
    work: '<rect x="4.5" y="8.5" width="15" height="10"/><path d="M9.5 8.5V6h5v2.5M4.5 13h15"/>',
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
        (t.admin || t.worker || t.assistant ? ' hidden' : '') +
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
      '<a class="sg-brand" href="./"><img src="icons/wordmark.svg?v=2026110803" alt="SEGAN" width="477" height="75" /></a>' +
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

  /** 간편 플래너를 쓸 수 있나 — GET /planner/access 가 200 이고 success 일 때만. 403 · 실패는 false */
  async function canPlan(session) {
    try {
      var cfg = window.DADAM_CONFIG || {};
      var base = (cfg.workflowApi && cfg.workflowApi.url) || '';
      var token = session && session.access_token;
      if (!base || !token) return false;
      var res = await fetch(base + '/planner/access', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      if (!res.ok) return false;
      var body = await res.json();
      return !!(body && body.success);
    } catch {
      return false;
    }
  }

  /** AI 비서 워커 주소 */
  function assistantBase() {
    var cfg = window.DADAM_CONFIG || {};
    return (cfg.assistantApi && cfg.assistantApi.url) || ASSISTANT_API;
  }

  /**
   * 비서 탭을 여나 — GET /assistant/me 가 200 이고 level 이 full · read 일 때만 (none · 403 · 실패는 false).
   * 참만 이 탭(sessionStorage)에 1분 기억한다 — 탭을 옮길 때마다 묻지 않게.
   */
  async function hasAssistant(session) {
    try {
      var token = session && session.access_token;
      if (!token) return false;
      var memo = ASSISTANT_MEMO + ((session.user && session.user.id) || '');
      try {
        var at = Number(window.sessionStorage.getItem(memo));
        if (at && Date.now() - at < ASSISTANT_MEMO_MS) return true;
      } catch {
        /* 기억 못 하면 묻는다 */
      }
      var res = await fetch(assistantBase() + '/assistant/me', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      if (!res.ok) return false;
      var body = await res.json();
      var level = body && body.success && body.data ? body.data.level : '';
      var on = level === 'full' || level === 'read';
      if (on) {
        try {
          window.sessionStorage.setItem(memo, String(Date.now()));
        } catch {
          /* 다음에 다시 묻는다 */
        }
      }
      return on;
    } catch {
      return false;
    }
  }

  /** 역할 메뉴 판정 — 기존 판정(사이트 모듈 · 워크플로 API)에 맡긴다. 모르면 감춘다 */
  async function detectRoles(sb, session) {
    var out = { planner: false, admin: false, worker: false };
    if (!sb || !session) return out;
    var jobs = [
      (async function () {
        if (window.AdminAccess) out.admin = (await window.AdminAccess.isAdmin(sb)) === true;
      })(),
      (async function () {
        out.planner = await canPlan(session);
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
          for (var i = window.sessionStorage.length - 1; i >= 0; i--) {
            var k = window.sessionStorage.key(i);
            if (k && k.indexOf(ASSISTANT_MEMO) === 0) window.sessionStorage.removeItem(k);
          }
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
   * 관리 · 작업 · 비서 탭 — 관리자 · 작업자 · AI 비서 자격이 있는 업체 구성원에게만 연다.
   * 내 정보는 역할 메뉴 판정(roles)을 그대로 쓰고, 다른 탭은 AdminAccess.isAdmin(sb)
   * (참만 1분 기억 — js/admin-access.js) · GET /work/me 를 묻는다. 비서는 어느 탭이든 GET /assistant/me.
   * 모르면(로그인 전 · 모듈 없음 · 실패) 감춘 채 둔다.
   */
  async function applyRoleTabs(r) {
    var on = { admin: false, work: false, assistant: false };
    try {
      if (r && r.roles) {
        on.admin = r.roles.admin === true;
        on.work = r.roles.worker === true;
        on.assistant = await hasAssistant(r.session);
      } else if (window.AdminAccess || window.DadamMyPageWork) {
        // 판정 모듈이 실린 페이지만 세션을 묻는다
        var sb = (r && r.sb) || client();
        var session = (r && r.session) || (await sessionOf(sb));
        if (sb && session) {
          var got = await Promise.all([
            window.AdminAccess
              ? window.AdminAccess.isAdmin(sb).then(
                  function (x) {
                    return x === true;
                  },
                  function () {
                    return false;
                  }
                )
              : false,
            isWorker(session),
            hasAssistant(session),
          ]);
          on.admin = got[0] === true;
          on.work = got[1] === true;
          on.assistant = got[2] === true;
        }
      }
    } catch {
      on = { admin: false, work: false, assistant: false };
    }
    ['admin', 'work', 'assistant'].forEach(function (key) {
      document.querySelectorAll('[data-tab-link="' + key + '"]').forEach(function (a) {
        a.hidden = !on[key];
      });
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
      return applyRoleTabs(r).then(function (on) {
        r.admin = on.admin;
        r.worker = on.work;
        r.assistant = on.assistant;
        return r;
      });
    });
  }

  // ── 시트 · 옆 패널 · 가운데 창 ───────────────────────────
  /*
     버튼이 여는 것 (앱 전체 규칙)
       1. 화면 전환 — 기본. 주소가 바뀌고 뒤로 가기가 돌아온다 (이 도우미를 쓰지 않는다)
       2. 시트 · 옆 패널 (kind 'sheet' · 'panel') — 지금 화면을 둔 채 짧게 보기 · 고치기.
          폰은 아래에서 올라오는 시트, PC(1100px~)는 오른쪽 옆 패널. 한 번에 하나만 — 새로 열면 앞의 것을 닫는다
       3. 가운데 작은 창 (kind 'dialog') — 막는 확인만 (지우기 확인 · 동의 · 로그인 필요 · 크레딧 부족).
          시트 위에 겹쳐 열 수 있다
     열면 방문 기록에 표시 칸 하나만 넣는다 — history.pushState({ sgSheet: n }, '') (주소 · # 은 그대로라
     hashchange 가 없다). 뒤로 가기는 맨 위 창을 닫고, 그 popstate 는 페이지 처리기에 넘기지 않는다.
     닫기가 부른 history.back() 은 늦게 돌아온다 — 그 사이에 연 창은 바로 그리고, 표시 칸은 그 popstate 가
     돌아온 뒤에 넣는다(닫기 · 열기를 차례로 줄 세운다). 돌아온 popstate 는 아직 칸이 없는 새 창을 닫지 않는다.
     popstate 를 듣는 페이지는 맨 앞에서 SeganShell.sheet.isSheetState(e.state) 면 돌아간다
     (닫은 뒤 「앞으로」로 남은 표시 칸에 다시 들어온 때).

     쓰는 법
       var h = SeganShell.sheet.open({ title: '사진 보기', body: node, kind: 'sheet',
                                       onClose: function (why) {} });
       h.close();   // 약속 — 표시 칸을 되돌린 뒤 풀린다. 닫고 바로 화면을 옮기면 이것을 기다린다
     why: 'close'(h.close) · 'button'(닫기) · 'escape' · 'backdrop'(바깥) · 'back'(뒤로 가기) · 'replaced'(새 시트)
     dismissible: false — Esc · 바깥 누르기 · 닫기 버튼으로 닫지 않는다 (뒤로 가기는 닫는다)
     initialFocus: 창 안의 요소 — 없으면 창 자체에 초점
  */
  var SHEET_KEY = 'sgSheet';
  var SHEET_KINDS = { sheet: true, panel: true, dialog: true };
  var SHEET_POP_WAIT = 1500; // 닫기로 부른 history.back() 의 popstate 를 기다리는 한도 (ms)
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var sheetSeq = Date.now(); // 표시 번호 — 새로 고치기 전에 남은 옛 표시보다 늘 크다
  var layers = []; // 열린 창 (아래 → 위)
  var popWaits = []; // 닫기로 부른 history.back() — 돌아올 popstate 하나씩
  var historyJobs = []; // popstate 를 기다리는 동안 미룬 기록 일 (표시 칸 넣기 · 되돌리기) — 차례대로

  function isSheetState(state) {
    return !!state && typeof state === 'object' && typeof state[SHEET_KEY] === 'number';
  }

  /** 지금 기록 칸 값 + 표시 번호 n (페이지가 둔 값은 그대로 둔다) */
  function sheetState(n) {
    var cur = window.history.state;
    var out = {};
    if (cur && typeof cur === 'object') {
      for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) out[k] = cur[k];
    }
    out[SHEET_KEY] = n;
    return out;
  }

  /** 기록 일 — 돌아올 popstate 가 없으면 바로, 있으면 그것이 돌아온 뒤 차례대로 한다 */
  function afterPops(job) {
    if (!popWaits.length && !historyJobs.length) job();
    else historyJobs.push(job);
  }

  /** 기다리던 popstate 하나가 끝났다 (돌아옴 · 한도 넘김 · 실패) — 미룬 일을 이어서 한다 */
  function endWait(wait) {
    var k = popWaits.indexOf(wait);
    if (k >= 0) popWaits.splice(k, 1);
    window.clearTimeout(wait.timer);
    wait.resolve();
    // 미룬 일이 다시 뒤로 가면(popWaits 가 생기면) 남은 일은 그 popstate 를 또 기다린다
    while (!popWaits.length && historyJobs.length) historyJobs.shift()();
  }

  function focusables(root) {
    return [].filter.call(root.querySelectorAll(FOCUSABLE), function (n) {
      return !n.closest('[hidden]');
    });
  }

  /** layers[from..] 를 위에서부터 닫는다 — 방문 기록은 건드리지 않는다. 닫은 창들을 돌려준다 */
  function dropLayers(from, why) {
    var gone = layers.splice(from);
    if (!layers.length) document.body.classList.remove('sg-locked');
    var errors = [];
    for (var i = gone.length - 1; i >= 0; i--) {
      var L = gone[i];
      L.open = false;
      if (L.wrap.parentNode) L.wrap.parentNode.removeChild(L.wrap);
      if (why !== 'replaced' && L.opener && L.opener.isConnected && L.opener.focus) {
        try {
          L.opener.focus();
        } catch {
          /* 초점을 못 돌려도 닫는다 */
        }
      }
      if (typeof L.onClose === 'function') {
        try {
          L.onClose(why);
        } catch (err) {
          errors.push(err);
        }
      }
    }
    // 닫는 처리기 오류는 다른 창을 다 닫은 뒤에 알린다
    errors.forEach(function (err) {
      window.setTimeout(function () {
        throw err;
      }, 0);
    });
    return gone;
  }

  /**
   * 닫은 창의 표시 칸이 기록 맨 위에 있으면 그만큼 뒤로 — 돌아오는 popstate 는 이 셸이 받는다.
   * 앞서 부른 뒤로 가기가 아직 돌아오지 않았으면 그것이 돌아온 뒤에 본다 (그때의 맨 위 칸으로).
   */
  function popEntries(gone) {
    return new Promise(function (resolve) {
      afterPops(function () {
        var st = window.history.state;
        var cur = isSheetState(st) ? st[SHEET_KEY] : null;
        var mine = gone.some(function (L) {
          return L.pushed && L.entry === cur;
        });
        if (!mine) return resolve();
        var n = gone.filter(function (L) {
          return L.pushed && L.entry <= cur;
        }).length;
        var wait = { resolve: resolve };
        wait.timer = window.setTimeout(function () {
          endWait(wait);
        }, SHEET_POP_WAIT);
        popWaits.push(wait);
        try {
          if (n === 1) window.history.back();
          else window.history.go(-n);
        } catch {
          endWait(wait);
        }
      });
    });
  }

  /**
   * 새 창의 표시 칸을 넣는다 — 바꾼 시트의 칸이 맨 위면 그 칸을 쓴다(replaceState), 아니면 하나 넣는다.
   * 그 사이 닫힌 창은 칸을 넣지 않는다.
   */
  function pushEntry(L, replaced) {
    if (!L.open) return;
    var st = window.history.state;
    var cur = isSheetState(st) ? st[SHEET_KEY] : null;
    var reuse = cur !== null && replaced.indexOf(cur) >= 0;
    var state = sheetState(L.entry);
    L.pushed = true;
    try {
      // 주소 인자는 넘기지 않는다 — '' 를 넘기면 # 이 떨어진다
      if (reuse) window.history.replaceState(state, '');
      else window.history.pushState(state, '');
    } catch {
      /* 기록을 못 넣어도 창은 연다 (뒤로 가기만 창을 닫지 못한다) */
    }
  }

  function closeLayer(L, why) {
    var i = layers.indexOf(L);
    if (i < 0) return Promise.resolve();
    return popEntries(dropLayers(i, why));
  }

  /**
   * 뒤로 가기 — 지금 칸보다 뒤에 넣은 창을 닫고, 그 popstate 는 페이지 처리기에 넘기지 않는다.
   * 칸을 아직 넣지 않은 창(닫기의 뒤로 가기를 기다리며 연 새 창)은 이 popstate 로 닫지 않는다.
   */
  function onSheetPop(e) {
    var st = e.state;
    var at = isSheetState(st) ? st[SHEET_KEY] : -Infinity;
    var handled = false;
    var wait = popWaits.length ? popWaits[0] : null;
    if (wait) handled = true;
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].pushed && layers[i].entry > at) {
        dropLayers(i, 'back');
        handled = true;
        break;
      }
    }
    if (handled) e.stopImmediatePropagation();
    // 기다리던 popstate — 미룬 기록 일(새 창의 칸 넣기 등)을 이제 한다
    if (wait) endWait(wait);
  }

  /** 창 안에서만 Tab 이 돈다 */
  function trapTab(e, L) {
    var list = focusables(L.box);
    var active = document.activeElement;
    var inside = L.box.contains(active);
    if (!list.length) {
      e.preventDefault();
      L.box.focus();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey) {
      if (!inside || active === first || active === L.box) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onSheetKey(e) {
    var L = layers[layers.length - 1];
    if (!L) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      // 한글 조합 중 Esc 는 조합만 끝낸다
      if (e.defaultPrevented || e.isComposing || !L.dismissible) return;
      e.preventDefault();
      closeLayer(L, 'escape');
    } else if (e.key === 'Tab') {
      trapTab(e, L);
    }
  }

  /**
   * 시트 · 옆 패널 · 가운데 창을 연다.
   * @param {{ title?: string, body?: Node|string, kind?: 'sheet'|'panel'|'dialog',
   *           onClose?: function(string), dismissible?: boolean, initialFocus?: Element }} opts
   * @returns {{ kind: string, el: Element, body: Element, close: function(string=): Promise<void>,
   *             isOpen: function(): boolean }}
   */
  function openSheet(opts) {
    opts = opts || {};
    var kind = SHEET_KINDS[opts.kind] ? opts.kind : 'sheet';
    var opener = document.activeElement;
    var replaced = []; // 바꾼 시트 · 패널이 넣은 표시 칸 — 맨 위면 새 시트가 그 칸을 쓴다
    if (kind !== 'dialog') {
      // 시트 · 옆 패널은 하나만 — 앞의 것(과 그 위 창)을 닫고, 그 표시 칸을 새 시트가 쓴다
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].kind === 'dialog') continue;
        var below = layers[i];
        if (
          layers.slice(i).some(function (L) {
            return L.wrap.contains(opener);
          })
        )
          opener = below.opener;
        dropLayers(i, 'replaced').forEach(function (L) {
          if (L.pushed) replaced.push(L.entry);
        });
        break;
      }
    }

    var entry = ++sheetSeq;
    var titleId = 'sgSheetTitle' + entry;
    var wrap = document.createElement('div');
    wrap.className = 'sg-sheet-wrap sg-sheet-wrap--' + kind;
    var box = document.createElement('section');
    box.className = 'sg-sheet';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', titleId);
    box.tabIndex = -1;
    var head = document.createElement('header');
    head.className = 'sg-sheet-head';
    var title = document.createElement('h2');
    title.className = 'sg-sheet-title';
    title.id = titleId;
    title.textContent = opts.title || '';
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'sg-sheet-x';
    x.textContent = '닫기';
    head.appendChild(title);
    head.appendChild(x);
    var body = document.createElement('div');
    body.className = 'sg-sheet-body';
    if (opts.body && typeof opts.body === 'object' && opts.body.nodeType) {
      body.appendChild(opts.body);
    } else if (opts.body != null) {
      body.textContent = String(opts.body);
    }
    box.appendChild(head);
    box.appendChild(body);
    wrap.appendChild(box);

    var L = {
      kind: kind,
      wrap: wrap,
      box: box,
      entry: entry,
      pushed: false, // 표시 칸을 넣었나 — 앞 닫기의 뒤로 가기를 기다리는 동안은 false
      opener: opener && opener !== document.body ? opener : null,
      onClose: opts.onClose,
      dismissible: opts.dismissible !== false,
      open: true,
      downOnBack: null,
    };
    x.hidden = !L.dismissible;
    x.addEventListener('click', function () {
      closeLayer(L, 'button');
    });
    // 바깥 누르기 — 창 안에서 누르기 시작해 바깥에서 뗀 것은 치지 않는다
    wrap.addEventListener('pointerdown', function (e) {
      L.downOnBack = e.target === wrap;
    });
    wrap.addEventListener('click', function (e) {
      var down = L.downOnBack;
      L.downOnBack = null;
      if (e.target !== wrap || down === false || !L.dismissible) return;
      closeLayer(L, 'backdrop');
    });

    layers.push(L);
    // 앞 닫기의 뒤로 가기가 아직 돌아오지 않았으면 칸은 그 뒤에 넣는다 (창은 지금 그린다)
    afterPops(function () {
      pushEntry(L, replaced);
    });
    document.body.appendChild(wrap);
    document.body.classList.add('sg-locked');
    var focus = opts.initialFocus && box.contains(opts.initialFocus) ? opts.initialFocus : box;
    try {
      focus.focus();
    } catch {
      /* noop */
    }

    return {
      kind: kind,
      el: box,
      body: body,
      close: function (why) {
        return closeLayer(L, why || 'close');
      },
      isOpen: function () {
        return L.open;
      },
    };
  }

  /** 맨 위 창 — 없으면 null */
  function currentSheet() {
    var L = layers[layers.length - 1];
    return L ? { kind: L.kind, el: L.box } : null;
  }

  /** 새로 고치면 창은 없다 — 기록 칸에 남은 표시만 지운다 (페이지가 둔 값은 그대로) */
  function clearStaleSheetState() {
    try {
      var st = window.history.state;
      if (!isSheetState(st)) return;
      var kept = null;
      for (var k in st) {
        if (k === SHEET_KEY || !Object.prototype.hasOwnProperty.call(st, k)) continue;
        kept = kept || {};
        kept[k] = st[k];
      }
      window.history.replaceState(kept, '');
    } catch {
      /* noop */
    }
  }

  clearStaleSheetState();

  // 셸이 두 번 실려도(시험 · 잘못 넣은 태그) 처리기는 하나 — 앞 것을 뗀다
  if (typeof window.__seganSheetOff === 'function') window.__seganSheetOff();
  // capture — 페이지가 먼저 popstate 를 달아도 셸이 먼저 받는다
  window.addEventListener('popstate', onSheetPop, true);
  document.addEventListener('keydown', onSheetKey);
  window.__seganSheetOff = function () {
    window.removeEventListener('popstate', onSheetPop, true);
    document.removeEventListener('keydown', onSheetKey);
  };

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
    assistantBase: assistantBase,
    ready: ready,
    sheet: {
      open: openSheet,
      isSheetState: isSheetState,
      current: currentSheet,
      STATE_KEY: SHEET_KEY,
    },
  };
})();
