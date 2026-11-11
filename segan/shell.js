/* ============================================================
   segan/shell.js — SEGAN 앱 셸 (헤더 · 아래 탭 · 푸터 · 로그인 상태 · 서비스 워커)

   메뉴 (순서 고정 — TABS)
     PC 위 메뉴(1024px~):  AI 연출컷 · 시공사례 · 매거진 · AI 시스템 소개 · 구독        오른쪽 끝에 마이페이지
     폰 아래 탭(~1023px):  연출컷 · 시공사례 · 매거진 · SEGAN · 마이 (다섯 — SEGAN 은 소개 · 구독 둘 다,
                           두 화면 위의 [소개 | 구독] 으로 오간다)
     PC 글(label)과 폰 글(short)이 다를 수 있다. 탭 하나가 여러 화면에서 켜진다 (pages):
       연출컷 = 만들기 · 상담 신청(consult, data-tab make), SEGAN = 소개 · 구독(폰), 마이 = 마이페이지와 그 안 화면
       (내 연출컷 · 비서 · 관리 · 작업 — body data-tab 이 그 이름, 설정 · 구독 관리 · 회계 · 결제 · 초대 등은 data-tab me).
     같은 막대에 그 화면 이름의 탭이 있으면 그것이 먼저 켜진다 (구독 화면 — PC 는 「구독」, 폰은 「SEGAN」).
     내 연출컷 · 비서 · 관리 · 작업은 막대에 두지 않는다 — 마이페이지 메뉴에서 간다
       (내 연출컷은 「내 것」, 비서 · 설계는 「업체」, 관리는 「본사」, 작업은 맨 위 「오늘 작업」 카드 — segan/me.js.
       화면 파일 · 주소는 그대로).
     관리 화면(admin.js)이 쓰는 관리자 판정(SeganShell.ready 의 admin)은 그대로 싣는다.
     - 폰 · 태블릿(~1023px): 위 막대(워드마크) + 아래 고정 탭 막대
     - PC(1024px~): v5 헤더 모양의 위 메뉴 + 사업자 정보 푸터. 위 메뉴는 1024px 부터 연다 — Chrome 에서
       13px Noto Sans KR 로 잰 글 폭 합 335px + 워드마크 116px + 칸 사이 34px × 6 = 655px 이라, 768px 화면의
       672px 칸(좌우 48px)에는 17px 만 남는다 (글꼴이 늦게 오거나 14px 이면 넘친다). 1024px 이면 928px 칸에 273px 여유.
       폰에서는 사업자 정보를 마이페이지 안에 둔다.
   메뉴는 로그인 전에도 보인다. 마이페이지 · 내 연출컷은 로그인이 없으면
   「로그인이 필요합니다」와 로그인 버튼(돌아올 곳 = 지금 페이지)을 보인다.

   쓰는 법 (segan/*.html):
     <body data-tab="make">   <!-- make | collection | blog | about | plans | me | renders | assistant | admin | work -->
       <div data-segan-shell="header"></div>
       <main id="main">…</main>
       <div data-segan-shell="footer"></div>
       <div data-segan-shell="tabbar"></div>
     <script src="shell.js" defer></script>   (실제 페이지는 ?v= 자산 버전을 붙인다)
   로그인이 필요한 페이지는 [data-auth-view="checking|signed-out|signed-in"] 세 칸을 둔다.
   signed-out 칸 안의 [data-segan-shell="gate"] 는 이 파일이 로그인 안내로 채운다.

   역할 판정(ROLE_LINKS — 설계 · 비서 · 작업 · 관리)은 기존 판정을 그대로 쓴다 — 새 규칙을 만들지 않는다.
   판정은 이 파일이 마이페이지에서만 묻고(SeganShell.ready 의 roles), 메뉴 나무는 segan/me.html · me.js 가 그린다
   (플래너 줄 = roles.planner, 본사 줄 = roles.admin, 맨 위 「오늘 작업」 카드 = work 링크 — 2026-11-09 메뉴 나무).
     설계       워크플로 API GET /planner/access  (200 이면 연다 — 다담 공장 · Manager · Expert · Agent 업체 구성원 · 관리자,
                판정은 workers/workflow-api/src/planner-drafts.js canUsePlanner. 403 · 실패는 감춘다)
                주소 planner/ = 간편 플래너 웹판 (/segan/planner/ — 다른 Worker, 이 저장소 밖).
                PC 브라우저에서만 새 탭으로 연다 (desktopTab — 아래 「새 탭」), 폰 · 태블릿 · 설치한 앱은 같은 창
     비서       assistant-api GET /assistant/me 의 level 이 full · read 일 때 (참만 1분 기억 — hasAssistant)
     작업       js/mypage-work.js         DadamMyPageWork.shouldShow(GET /work/me) — 앱 안 segan/work.html
                (그 응답은 roles.workMe 로 넘긴다 — 마이페이지 「오늘 작업」 카드의 요약)
     관리       js/admin-access.js        AdminAccess.isAdmin(sb)  (is_admin RPC) — 앱 안 관리 화면 segan/admin.html
     관리자 화면 (PC)  같은 판정 — 사이트 관리자 화면 admin/index.html (js/site-shell.js 와 같은 주소)

   서비스 워커 등록 — 범위는 /segan/ 하나뿐이다. 기존 사이트는 서비스 워커를 쓰지 않는다.

   시트 · 옆 패널 · 가운데 창 — SeganShell.sheet (아래 「시트」 칸에 규칙과 쓰는 법)

   SEGAN 비서 (위 막대 「비서」 · PC 아래 입력 줄 · 안내 모드)는 segan/guide.js — 이 파일 뒤에 싣는다.
   그 파일이 쓰는 것: SeganShell.client(이 화면의 Supabase 클라이언트 하나) · hasAssistant(업무 비서 판정) ·
   assistantBase · sheet. 로그아웃은 그 대화 기록(sessionStorage segan.guide.)도 지운다.
   ============================================================ */
/* global window, document, navigator, location, fetch, CustomEvent */
(function () {
  'use strict';

  // ── 정본 ─────────────────────────────────────────────
  // label = PC 위 메뉴 글, short = 폰 아래 탭 글(없으면 label), pages = 이 탭이 켜지는 다른 화면(body data-tab),
  // phone: false = PC 위 메뉴에만, end: true = PC 위 메뉴 오른쪽 끝
  var TABS = [
    { key: 'make', label: 'AI 연출컷', short: '연출컷', href: './', target: 'segan/index.html' },
    {
      key: 'collection',
      label: '시공사례',
      href: 'collection.html',
      target: 'segan/collection.html',
    },
    { key: 'blog', label: '매거진', href: 'blog.html', target: 'segan/blog.html' },
    // 폰은 SEGAN 하나가 소개 · 구독 둘 다 (두 화면 위 [소개 | 구독])
    {
      key: 'about',
      label: 'AI 시스템 소개',
      short: 'SEGAN',
      href: 'about.html',
      target: 'segan/about.html',
      pages: ['plans'],
    },
    { key: 'plans', label: '구독', href: 'plans.html', target: 'segan/plans.html', phone: false },
    {
      key: 'me',
      label: '마이페이지',
      short: '마이',
      href: 'me.html',
      target: 'segan/me.html',
      // 막대에 없는 마이페이지 안 화면 — 내 연출컷 · 비서 · 관리 · 작업
      pages: ['renders', 'assistant', 'admin', 'work'],
      end: true,
    },
  ];

  // 막대에 없는 화면 — 로그인 안내 글 · 돌아올 곳 (TABS 에 없는 body data-tab)
  var SCREENS = {
    renders: { label: '내 연출컷', target: 'segan/renders.html' },
    assistant: { label: '비서', target: 'segan/assistant.html' },
    admin: { label: '관리', target: 'segan/admin.html' },
    work: { label: '작업', target: 'segan/work.html' },
  };

  // 역할 링크 — role = 여는 판정(없으면 key), group = 쓰는 곳 (work = 마이페이지 맨 위 「오늘 작업」 카드 — segan/me.js.
  //   company · hq 줄은 2026-11-09 메뉴 나무(segan/me.html)가 플래너 · 본사 하위 줄로 직접 둔다), desktopTab = PC 브라우저에서만 새 탭.
  // 설계는 간편 플래너 웹판(/segan/planner/), 비서 · 작업 · 관리는 앱 안 화면,
  // 관리자 화면 (PC) 는 js/site-shell.js(ACCOUNT_MENU)와 같은 사이트 관리자 화면
  var ROLE_LINKS = [
    { key: 'planner', label: '설계', href: 'planner/', group: 'company', desktopTab: true }, // 간편 플래너 — 예전 상세설계 자리
    { key: 'assistant', label: '비서', href: 'assistant.html', group: 'company' }, // AI 비서 — 예전 「비서」 탭
    { key: 'worker', label: '작업', href: 'work.html', group: 'work' }, // 작업자 포털 — 예전 「작업」 탭
    { key: 'admin-app', role: 'admin', label: '관리', href: 'admin.html', group: 'hq' }, // 앱 안 관리 — 예전 「관리」 탭
    { key: 'admin', label: '관리자 화면 (PC)', href: '../admin/index.html', group: 'hq' },
  ];

  // 로그인 — 기존 login.html 의 ?redirect= (js/auth-redirect.js 가 같은 사이트 *.html 만 받는다)
  var LOGIN_PAGE = '../login.html';

  // AI 비서 워커 (workers/assistant-api) — js/config.js 에 assistantApi.url 이 있으면 그 주소
  var ASSISTANT_API = 'https://dadam-assistant-api.dadamfurniture.workers.dev';
  var ASSISTANT_MEMO = 'segan.assistant.on.'; // + 사용자 id → 참으로 판정한 때 (sessionStorage)
  var GUIDE_MEMO = 'segan.guide.'; // SEGAN 비서 안내 대화 기록 (segan/guide.js — sessionStorage)
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

  /** 화면 이름(body data-tab) → 글 · 돌아올 곳 — 탭이거나 막대에 없는 화면 */
  function screenOf(key) {
    return tabOf(key) || (Object.prototype.hasOwnProperty.call(SCREENS, key) ? SCREENS[key] : null);
  }

  /** 막대에 넣는 탭 — 'pc' 위 메뉴 · 'phone' 아래 탭 */
  function barTabs(bar) {
    return TABS.filter(function (t) {
      return bar === 'phone' ? t.phone !== false : t.pc !== false;
    });
  }

  /**
   * 이 화면에서 켜지는 탭 — 같은 막대에 그 이름의 탭이 있으면 그것, 아니면 pages 에 그 화면을 둔 첫 탭.
   * 없으면 '' (아무 탭도 켜지 않는다)
   */
  function currentTab(page, bar) {
    var list = barTabs(bar);
    var i;
    for (i = 0; i < list.length; i++) if (list[i].key === page) return list[i].key;
    for (i = 0; i < list.length; i++) {
      if ((list[i].pages || []).indexOf(page) >= 0) return list[i].key;
    }
    return '';
  }

  /** 로그인 뒤 이 화면으로 돌아오는 로그인 주소 */
  function loginHref(key) {
    var screen = screenOf(key) || TABS[0];
    return LOGIN_PAGE + '?redirect=' + encodeURIComponent(screen.target);
  }

  // ── 그리기 ───────────────────────────────────────────
  var ICON_PATHS = {
    make: '<rect x="4.5" y="4.5" width="15" height="15"/><path d="M12 8.5v7M8.5 12h7"/>',
    collection:
      '<rect x="4.5" y="4.5" width="6.5" height="6.5"/><rect x="13" y="4.5" width="6.5" height="6.5"/>' +
      '<rect x="4.5" y="13" width="6.5" height="6.5"/><rect x="13" y="13" width="6.5" height="6.5"/>',
    blog: '<rect x="5.5" y="4.5" width="13" height="15"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/>',
    about: '<circle cx="12" cy="12" r="7.5"/><path d="M12 11v5M12 8.2v.6"/>',
    me: '<circle cx="12" cy="8.4" r="3.4"/><path d="M5 19.5c0-3.5 3.1-5.6 7-5.6s7 2.1 7 5.6"/>',
  };

  function icon(key) {
    return (
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="1.2" aria-hidden="true" focusable="false">' +
      ICON_PATHS[key] +
      '</svg>'
    );
  }

  /** 막대 하나의 링크 — 'pc' 는 글(label)만, 'phone' 은 아이콘 + 짧은 글(short) */
  function links(page, bar) {
    var phone = bar === 'phone';
    var on = currentTab(page, bar);
    return barTabs(bar)
      .map(function (t) {
        return (
          '<a href="' +
          t.href +
          '" data-tab-link="' +
          t.key +
          '"' +
          (!phone && t.end ? ' class="sg-nav-end"' : '') +
          (t.key === on ? ' aria-current="page"' : '') +
          '>' +
          (phone ? icon(t.key) : '') +
          '<span>' +
          esc(phone ? t.short || t.label : t.label) +
          '</span></a>'
        );
      })
      .join('');
  }

  function headerHTML(current) {
    return (
      '<header class="sg-header">' +
      '<a class="sg-brand" href="./"><img src="icons/wordmark.svg?v=2026111133" alt="SEGAN" width="477" height="75" /></a>' +
      '<nav class="sg-nav" aria-label="주 메뉴">' +
      links(current, 'pc') +
      '</nav>' +
      '</header>'
    );
  }

  function tabbarHTML(current) {
    return '<nav class="sg-tabbar" aria-label="주 메뉴">' + links(current, 'phone') + '</nav>';
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

  // ── 새 탭 ─────────────────────────────────────────────
  /**
   * PC 브라우저인가 — 마우스(pointer: fine) · 1100px 이상 · 설치한 앱(display-mode standalone)이 아님.
   * 그때만 새 탭으로 여는 링크(ROLE_LINKS desktopTab — 설계)를 새 탭으로, 아니면 같은 창. 모르면(matchMedia 없음) 같은 창
   */
  function desktopTab() {
    try {
      var mm = window.matchMedia;
      if (typeof mm !== 'function') return false;
      if (!mm.call(window, '(pointer: fine)').matches) return false;
      if (!mm.call(window, '(min-width: 1100px)').matches) return false;
      if (mm.call(window, '(display-mode: standalone)').matches) return false;
      return navigator.standalone !== true; // iOS 홈 화면 앱
    } catch {
      return false;
    }
  }

  /** a[data-desktop-tab] — PC 브라우저면 새 탭(target _blank · rel noopener), 아니면 같은 창 */
  function applyLinkTarget(a) {
    if (!a || !a.setAttribute) return;
    if (desktopTab()) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  }

  /** 누르는 그 순간의 화면으로 다시 정한다 (창 폭을 바꾼 뒤에도 맞게) — 이동은 클릭 처리 뒤에 일어난다 */
  function onLinkTargetClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-desktop-tab]') : null;
    if (a) applyLinkTarget(a);
  }

  /** 은/는 — 마지막 글자에 받침이 있으면 「은」 */
  function topic(word) {
    var c = word.charCodeAt(word.length - 1) - 0xac00;
    return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? '은' : '는');
  }

  function gateHTML(key) {
    var screen = screenOf(key);
    return (
      '<div class="sg-gate">' +
      '<p class="sg-title">로그인이 필요합니다</p>' +
      '<p class="sg-note">' +
      esc(topic(screen ? screen.label : '이 화면')) +
      ' 로그인한 뒤에 볼 수 있습니다.</p>' +
      '<a class="sg-btn" href="' +
      esc(loginHref(key)) +
      '">로그인</a>' +
      '</div>'
    );
  }

  // ── 로그인 상태 ───────────────────────────────────────
  var sbClient = null; // 이 화면의 클라이언트 하나 — 셸 · SEGAN 비서(segan/guide.js)가 같이 쓴다

  function client() {
    if (sbClient) return sbClient;
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        sbClient = window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 클라이언트가 없으면 로그인 안 된 것으로 본다 */
    }
    return sbClient;
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

  /**
   * 작업자인가 — 사이트 마이페이지와 같은 GET /work/me + DadamMyPageWork.shouldShow.
   * 작업자면 그 응답(data — 「오늘 작업」 카드의 요약), 아니면 · 실패하면 null
   */
  async function workerOf(session) {
    try {
      var cfg = window.DADAM_CONFIG || {};
      var base = (cfg.workflowApi && cfg.workflowApi.url) || '';
      var token = session && session.access_token;
      if (!base || !token || !window.DadamMyPageWork) return null;
      var res = await fetch(base + '/work/me', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      var body = await res.json();
      if (!res.ok || !body || !body.success) return null;
      return window.DadamMyPageWork.shouldShow(body.data) ? body.data : null;
    } catch {
      return null;
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
   * 비서를 여나 (마이페이지 「업무」의 비서 줄) — GET /assistant/me 가 200 이고 level 이 full · read 일 때만
   * (none · 403 · 실패는 false). 참만 이 탭(sessionStorage)에 1분 기억한다 — 화면을 옮길 때마다 묻지 않게.
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

  /**
   * 역할 판정 — 기존 판정(사이트 모듈 · 워크플로 API · 비서 API)에 맡긴다. 모르면 거짓.
   * workMe = 작업자면 GET /work/me 의 data (아니면 null)
   */
  async function detectRoles(sb, session) {
    var out = { planner: false, admin: false, worker: false, assistant: false, workMe: null };
    if (!sb || !session) return out;
    var jobs = [
      (async function () {
        if (window.AdminAccess) out.admin = (await window.AdminAccess.isAdmin(sb)) === true;
      })(),
      (async function () {
        out.planner = await canPlan(session);
      })(),
      (async function () {
        out.workMe = await workerOf(session);
        out.worker = !!out.workMe;
      })(),
      (async function () {
        out.assistant = await hasAssistant(session);
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
            if (k && (k.indexOf(ASSISTANT_MEMO) === 0 || k.indexOf(GUIDE_MEMO) === 0))
              window.sessionStorage.removeItem(k);
          }
        } catch {
          /* noop */
        }
        location.reload();
      };
    }

    // 역할 링크는 segan/me.js 가 메뉴 묶음(업체 · 본사 · 오늘 작업)에 그린다 — 판정만 넘긴다
    return detectRoles(sb, session);
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
   * 역할 판정 (SeganShell.ready 의 admin · worker · assistant) — 막대에는 더 이상 역할 탭이 없다.
   * 마이페이지는 역할 메뉴 판정(roles)을 그대로 싣는다. 다른 화면은 관리 화면(admin.js)이 쓰는
   * 관리자 판정만 — 로그인 칸이 있는 화면에서 AdminAccess.isAdmin(sb) (참만 1분 기억 — js/admin-access.js).
   * 작업 · 비서는 마이페이지에서만 묻는다. 모르면(로그인 전 · 모듈 없음 · 실패) 거짓.
   */
  async function roleFlags(r) {
    var on = { admin: false, work: false, assistant: false };
    try {
      if (r && r.roles) {
        on.admin = r.roles.admin === true;
        on.work = r.roles.worker === true;
        on.assistant = r.roles.assistant === true;
      } else if (r && r.sb && r.session && window.AdminAccess) {
        on.admin = (await window.AdminAccess.isAdmin(r.sb)) === true;
      }
    } catch {
      on = { admin: false, work: false, assistant: false };
    }
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
    });
    return applyAuth(current).then(function (r) {
      return roleFlags(r).then(function (on) {
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
     why: 'close'(h.close) · 'button'(닫기) · 'escape' · 'backdrop'(바깥) · 'back'(뒤로 가기) · 'replaced'(새 시트) ·
          'drag'(폰 시트 머리를 끌어 내림)
     폰 시트(kind 'sheet', 1100px 미만)는 머리를 끌어 내려 닫는다 — 손가락을 1:1 로 따라가고, 위로는 고무줄,
     놓은 속도로 멈출 곳을 셈해 시트 높이의 40 % 를 넘으면 닫는다 (CLAUDE.md 「SEGAN 모션 규칙」).
     segan/motion.js 를 실은 화면은 스프링으로 돌아오고 · 내려가며, 없으면 바로 자리로
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

  var DRAG_CLOSE = 0.4; // 시트 높이의 이만큼 넘게 내려갈 속도 · 거리면 닫는다

  function narrowScreen() {
    try {
      return !(window.matchMedia && window.matchMedia('(min-width: 1100px)').matches);
    } catch {
      return true;
    }
  }

  /** 놓은 속도(px/s)로 더 갈 거리 — segan/motion.js project 와 같은 식 (d 0.998) */
  function projectDistance(v) {
    return ((v / 1000) * 0.998) / (1 - 0.998);
  }

  /** 끝을 넘어 끌면 갈수록 더 버틴다 — segan/motion.js rubber 와 같은 식 */
  function rubberband(over, dim) {
    return dim > 0 ? (over * dim * 0.55) / (dim + 0.55 * Math.abs(over)) : 0;
  }

  /** 폰 시트 — 머리를 끌어 내려 닫는다 (위 「시트」 칸) */
  function bindSheetDrag(L, head) {
    var M = window.SeganMotion;
    var y = 0;
    var put = function (v) {
      y = v;
      L.box.style.transform = v ? 'translateY(' + v + 'px)' : '';
    };
    var sp = M && M.spring ? M.spring(put, { value: 0, eps: 0.5 }) : null;
    var drag = null;
    head.addEventListener('pointerdown', function (e) {
      if (!L.open || !L.dismissible || !narrowScreen() || e.button > 0) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea'))
        return;
      if (sp) sp.halt(); // 움직이는 중이면 그 자리에서 잡는다
      if (typeof L.box.getAnimations === 'function') {
        L.box.getAnimations().forEach(function (a) {
          a.finish(); // 올라오는 중이면 다 올라온 것으로 — 그다음부터 손을 따른다
        });
      }
      try {
        head.setPointerCapture(e.pointerId);
      } catch {
        /* 붙잡지 못해도 머리 안에서는 따라간다 */
      }
      drag = { y0: e.clientY, from: y, hist: [{ t: Date.now(), y: e.clientY }] };
    });
    head.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var v = drag.from + (e.clientY - drag.y0);
      if (v < 0) v = -rubberband(-v, L.box.offsetHeight || 1);
      if (sp) sp.set(v);
      else put(v);
      drag.hist.push({ t: Date.now(), y: e.clientY });
      if (drag.hist.length > 6) drag.hist.shift();
    });
    function release(e) {
      if (!drag) return;
      // 놓은 속도 — 마지막 0.1초 동안만 (멈췄다 놓으면 0)
      var h = drag.hist;
      var b = h[h.length - 1];
      var a = b;
      for (var i = h.length - 1; i >= 0 && b.t - h[i].t <= 100; i--) a = h[i];
      var vel = b.t > a.t && Date.now() - b.t < 80 ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px/s, 아래가 +
      drag = null;
      var H = L.box.offsetHeight || 0;
      var landing = y + projectDistance(vel);
      if (e.type !== 'pointercancel' && L.open && y > 0 && landing > Math.max(H, 1) * DRAG_CLOSE) {
        // 놓은 속도 그대로 내려가고, 다 내려가면 닫는다
        if (sp && H) {
          sp.to(H, { response: 0.3, damping: 1, velocity: vel }).then(function () {
            if (L.open) closeLayer(L, 'drag');
          });
        } else {
          put(H);
          closeLayer(L, 'drag');
        }
        return;
      }
      if (sp) sp.to(0, { response: 0.3, damping: Math.abs(vel) > 200 ? 0.8 : 1, velocity: vel });
      else put(0);
    }
    head.addEventListener('pointerup', release);
    head.addEventListener('pointercancel', release);
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
    if (kind === 'sheet') bindSheetDrag(L, head);
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
  // 새 탭 링크(a[data-desktop-tab]) — 누르는 순간 PC 브라우저인지 다시 본다 (capture — 페이지 처리기보다 먼저)
  document.addEventListener('click', onLinkTargetClick, true);
  window.__seganSheetOff = function () {
    window.removeEventListener('popstate', onSheetPop, true);
    document.removeEventListener('keydown', onSheetKey);
    document.removeEventListener('click', onLinkTargetClick, true);
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
    SCREENS: SCREENS,
    ROLE_LINKS: ROLE_LINKS,
    currentTab: currentTab,
    BIZ: BIZ,
    loginHref: loginHref,
    detectRoles: detectRoles,
    desktopTab: desktopTab,
    applyLinkTarget: applyLinkTarget,
    assistantBase: assistantBase,
    hasAssistant: hasAssistant,
    client: client,
    ready: ready,
    sheet: {
      open: openSheet,
      isSheetState: isSheetState,
      current: currentSheet,
      STATE_KEY: SHEET_KEY,
    },
  };
})();
