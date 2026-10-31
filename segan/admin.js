/* ============================================================
   segan/admin.js — 「관리」 탭 (segan/admin.html, 관리자에게만 탭이 보인다)

   누가 보나  관리자 — segan/shell.js 가 AdminAccess.isAdmin 으로 가려 SeganShell.ready 의 admin 에 싣는다.
             관리자가 아니면 「관리자만 볼 수 있습니다」만 (서버도 관리자만 답한다).
   오늘 할 일  수 넷 — 서버가 준 그대로 센다. 못 읽은 줄은 「불러오지 못함」 (0 으로 채우지 않는다)
               새 업체 신청            account-api  GET /admin/partner/applications?status=applied,meeting  (data 배열)
               배정을 기다리는 상담    workflow-api GET /admin/consult-inbox?state=pending   (data.items)
               업체 답을 기다리는 배정  workflow-api GET /admin/consult-inbox?state=assigned  (data.items)
               결정할 생산 제안        workflow-api GET /reports/summary  (data.pendingProposals)
             목록 한 번 상한(INBOX_LIMIT 200 — 워커 distribution/admin.js)에 닿으면 「200+」.
             줄을 누르면 그 일을 하는 화면 — 앱 화면이 있으면 #화면(새 업체 신청 #applications),
             아직 없으면 PC 관리자 화면(admin/*.html).
   앱 화면    주소의 # 로 고른다 (VIEWS). 화면을 열면 오늘 할 일 · PC에서 열기를 감추고, 「‹ 관리」로 돌아오면
             수를 다시 읽는다 (그 화면에서 처리했을 수 있다).
   PC에서 열기  표 · 큰 입력이 많아 PC 에 남기는 관리자 화면 10개 (주소 · 이름은 js/admin-shell.js ADMIN_NAV)
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var INBOX_LIMIT = 200; // 워커 distribution/admin.js INBOX_LIMIT
  var TODAY = [
    { key: 'applications', label: '새 업체 신청', href: '#applications' },
    { key: 'pending', label: '배정을 기다리는 상담', href: '#consults' },
    { key: 'assigned', label: '업체 답을 기다리는 배정', href: '#consults-assigned' },
    { key: 'proposals', label: '결정할 생산 제안', href: '#reports' },
  ];
  // PC 에 남기는 화면 — 이름은 js/admin-shell.js ADMIN_NAV 와 같다 (시험이 본다)
  var PC_PAGES = [
    { href: '../admin/management.html', label: '경영 대시보드' },
    { href: '../admin/counterparties.html', label: '거래처 · 공급처' },
    { href: '../admin/gallery.html', label: '시공사례 관리' },
    { href: '../admin/reference-images.html', label: '참고 이미지' },
    { href: '../admin/dataset.html', label: '학습 데이터셋' },
    { href: '../admin/partner-eval.html', label: '업체 평가' },
    { href: '../admin/appliances.html', label: '가전 모델 관리' },
    { href: '../admin/work-jobs.html', label: '작업 배정' },
    { href: '../admin/logs.html', label: '활동 로그' },
    { href: '../admin/settings.html', label: '설정' },
  ];
  var FAIL = '불러오지 못함';
  // 앱 화면 — 주소 # 이름 → [칸 id, 채우는 모듈 이름]
  var VIEWS = {
    applications: ['adApplications', 'SeganAdminApplications'],
    consults: ['adConsults', 'SeganAdminConsults'], // #consults-assigned = 답 기다림 탭으로
    reports: ['adReports', 'SeganAdminReports'],
  };

  var A = { sb: null, session: null, counts: {}, view: '' };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 받은 수 → 보일 글자. null(못 읽음)은 FAIL, 상한에 닿으면 「N+」 */
  function countText(n, limit) {
    if (n == null || !isFinite(Number(n)) || Number(n) < 0) return FAIL;
    var v = Number(n);
    if (limit && v >= limit) return limit + '+건';
    return v + '건';
  }

  /** account-api 신청 목록 본문 → 수 | null */
  function applicationsOf(body) {
    var d = body && body.success === true ? body.data : null;
    return Array.isArray(d) ? d.length : null;
  }

  /** workflow-api consult-inbox 본문 → 수 | null */
  function inboxOf(body) {
    var d = body && body.success === true ? body.data : null;
    return d && typeof d === 'object' && Array.isArray(d.items) ? d.items.length : null;
  }

  /** workflow-api reports/summary 본문 → 결정할 생산 제안 수 | null */
  function proposalsOf(body) {
    var d = body && body.success === true ? body.data : null;
    var n = d && typeof d === 'object' ? d.pendingProposals : null;
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = A.sb && (await A.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return A.session ? A.session.access_token : '';
  }

  /** GET → 본문 | null (주소 없음 · 오류 · 끊김 · JSON 아님) */
  async function getJson(base, path) {
    if (!base) return null;
    try {
      var res = await fetch(base + path, {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadCounts() {
    var cfg = window.DADAM_CONFIG || {};
    var work = (cfg.workflowApi && cfg.workflowApi.url) || '';
    var acc = (cfg.accountApi && cfg.accountApi.url) || '';
    var got = await Promise.all([
      getJson(acc, '/admin/partner/applications?status=applied,meeting'),
      getJson(work, '/admin/consult-inbox?state=pending'),
      getJson(work, '/admin/consult-inbox?state=assigned'),
      getJson(work, '/reports/summary'),
    ]);
    return {
      applications: applicationsOf(got[0]),
      pending: inboxOf(got[1]),
      assigned: inboxOf(got[2]),
      proposals: proposalsOf(got[3]),
    };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function todayHtml(counts) {
    return TODAY.map(function (t) {
      var n = counts[t.key];
      var limit = t.key === 'pending' || t.key === 'assigned' ? INBOX_LIMIT : 0;
      var on = Number(n) > 0;
      return (
        '<li data-today="' +
        t.key +
        '"><a class="sg-row ad-row" href="' +
        esc(t.href) +
        '">' +
        esc(t.label) +
        '<span class="ad-count' +
        (on ? ' is-on' : '') +
        '">' +
        esc(countText(n, limit)) +
        '</span></a></li>'
      );
    }).join('');
  }

  function pcHtml() {
    return PC_PAGES.map(function (p) {
      return '<li><a class="sg-row" href="' + esc(p.href) + '">' + esc(p.label) + '</a></li>';
    }).join('');
  }

  async function showHome() {
    $('adPc').hidden = false;
    A.counts = await loadCounts();
    $('adTodayRows').innerHTML = todayHtml(A.counts);
    $('adToday').hidden = false;
  }

  /** 주소의 # 로 화면을 고른다 — '이름' 또는 '이름-값'(값은 그 화면에 넘긴다), 모르는 # 는 첫 화면 */
  async function route() {
    var hash = String(window.location.hash || '').slice(1);
    var dash = hash.indexOf('-');
    var name = dash > 0 ? hash.slice(0, dash) : hash;
    var arg = dash > 0 ? hash.slice(dash + 1) : '';
    var view = Object.prototype.hasOwnProperty.call(VIEWS, name) ? VIEWS[name] : null;
    Object.keys(VIEWS).forEach(function (k) {
      var el = $(VIEWS[k][0]);
      if (el) el.hidden = !view || VIEWS[k] !== view;
    });
    var mod = view ? window[view[1]] : null;
    if (view && mod && mod.load) {
      $('adToday').hidden = true;
      $('adPc').hidden = true;
      A.view = name;
      await mod.load(A.sb, A.session, arg);
      return;
    }
    if (view) $(view[0]).hidden = true; // 모듈이 없으면 첫 화면
    A.view = '';
    await showHome();
  }

  async function start(r) {
    if (!r || !r.session) return; // 로그인 안내는 셸이 보인다
    A.sb = r.sb || null;
    A.session = r.session;
    if (r.admin !== true) {
      $('adDenied').hidden = false;
      return;
    }
    $('adPcRows').innerHTML = pcHtml();
    // 주소 # 가 바뀌면 화면을 다시 고른다 — 손잡이는 하나만 (스크립트를 다시 실어도 겹치지 않게)
    if (window.__seganAdminHash) window.removeEventListener('hashchange', window.__seganAdminHash);
    window.__seganAdminHash = function () {
      api.routed = route();
    };
    window.addEventListener('hashchange', window.__seganAdminHash);
    await route();
  }

  var api = {
    TODAY: TODAY,
    PC_PAGES: PC_PAGES,
    INBOX_LIMIT: INBOX_LIMIT,
    VIEWS: VIEWS,
    state: A,
    countText: countText,
    applicationsOf: applicationsOf,
    inboxOf: inboxOf,
    proposalsOf: proposalsOf,
  };
  window.SeganAdmin = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
