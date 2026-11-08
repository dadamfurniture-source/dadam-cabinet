/* ============================================================
   segan/me.js — 「마이」 탭 마이페이지 (segan/me.html) — 메뉴(첫 화면) + 하위 화면

   메뉴 (주소에 # 없음 · PC 1100px~ 에서는 왼쪽에 늘 보인다) — 쓸 수 있는 줄만 연다
     내 정보    이름(profiles.name) · 이메일 · 등급(profiles.tier — segan/billing.js PLAN_KO 와 같은 이름,
                업체 직책 「실장」과 다르다) · 남은 크레딧
     오늘 작업  작업자만 — 셸 판정 roles.workMe(GET /work/me) 의 건수 · 다음 작업을 js/mypage-work.js
                (summaryCounts · nextJobText · SUSPENDED_NOTE) 로 적는다, 누르면 작업 화면(work.html)
     묶음 — 업체 구성원(협력업체 · 다담 공장)은 업체 · 본사 · 내 것 차례, 아니면 내 것 · 업체 · 본사. 맨 아래 로그아웃
       업체  팩토리 #partner (업체가 없으면 「팩토리로 시작하기」, 신청 중이면 「팩토리 신청」) · 상담 #partner-consults ·
             프로젝트 #partner-projects · A/S함 #as — 그 칸을 그렸을 때만 (segan/partner*.js · as-requests.js 의 판정)
             · 회계 ledger.html — segan/books.js 가 GET /ledger/me 로 장부(full · read)를 열 때
               (사진만 올리면 「영수증 · 명세표 올리기」) · 설계 · 비서 — 셸 판정 (SeganShell.ROLE_LINKS group company)
       본사  관리 · 관리자 화면 (PC) — 셸 판정 is_admin (ROLE_LINKS group hq)
       내 것 내 연출컷 · 상담 내역 #consults · 내 프로젝트 #projects-mine · A/S 접수 #as-mine (둘은 그 칸을 읽었을 때만) ·
             크레딧 · 구독(billing.html) · 내 활동 · 알림 #notify (push.js 가 칸을 열 때만) · 설정
   하위 화면 (SCREENS — 주소 #이름)
     폰 · 태블릿은 하나만 (메뉴를 감추고 위에 「‹ 마이페이지」 · 그 화면 이름), PC 는 오른쪽 칸 —
     # 가 없으면 업체 구성원은 업체 묶음의 첫 칸(대개 팩토리), 아니면 상담 내역. 다른 페이지(연출컷 · 구독 · 설정 · 활동 ·
     회계 · 작업 · 관리 · 비서 · 설계)는 그대로 페이지 이동 (설계는 PC 브라우저에서만 새 탭 — SeganShell.desktopTab).
     알림 · 결제가 여는 주소(me.html#partner · #partner-consults · #as · ?failed=1)는 그대로 그 화면이다.
     메뉴에서 누르면 기록을 하나 넣는다(pushState — 뒤로 가기가 메뉴로 돌아온다). 「‹ 마이페이지」 는 메뉴에서 왔으면
     뒤로, 알림 · 새로 고침으로 바로 왔으면 그 기록을 메뉴로 바꾼다(replaceState). 칸마다 「읽은 뒤에만 보인다」(hidden)는
     각 모듈이 정한다 — 메뉴 줄은 그 칸이 보일 때만 열고, 못 여는 화면으로 오면 「볼 수 있는 내용이 없습니다」.

   업체 칸은 segan/partner.js 가 그린다 (여기서 로그인 뒤 SeganPartner.load 를 부른다). 업체 › 상담 · 상담 설정은
   segan/partner-consults.js, 업체 › 회계는 segan/books.js, 알림 칸은 segan/push.js 가 그린다 (업체 칸을 읽은 뒤
   SeganPartnerConsults.load · SeganBooks.load · SeganPush.load 에 그 /partner/me 를 넘긴다). 로그아웃 · 사업자 정보는
   segan/shell.js. 여기서는 넷을 채운다:
     내 프로젝트 workflow-api GET /me/projects (본인 토큰). 단계 6칸 · 끝난 상태 · 계약 금액 ·
                다음 결제(안 낸 것 중 낼 날이 가장 이른 것 — 워커 payments.js 와 같은 due_on 오름차순 ·
                빈 날 뒤) · 설치일. 수금 단계 이름은 erp.html PAY_STAGE_LABELS · 워커 payments.js 와 같다.
                다음 결제 줄 아래 결제 칸 — 결제 버튼 · 가상계좌 입금 안내 · 확인 중 (segan/pay.js, 다담 공장 수주만)
                못 읽으면(오류 · 404 · 주소 없음) 칸째 감춘다 — 가짜 값을 그리지 않는다
                시공 완료 줄 아래 「A/S 신청」 · 「A/S 접수」 칸 · 팩토리 A/S함은 segan/as-requests.js
     상담 내역  consultations (본인 — RLS 「Users can view own consultations」), 최신순.
                상태 이름은 admin/consultations.html STATUS_LABELS 와 같다
     크레딧    RPC my_credit_wallet (업체 구성원이면 업체 통장, 아니면 내 통장) + credit_costs 로 「생성 N회」
                — segan/make.js 의 loadWallet 을 한 번 불러 업체 칸과 함께 쓴다
     구독      billing.html 과 같은 payments-api GET /subscription, 등급 · 이름은 profiles.
                상태 이름은 billing.html STATUS_KO 와 같다. 바꾸기는 앱 안 구독 관리(segan/billing.html)에서.
                업체 실장 · 직원은 구독 칸 없이 company 만 온다 — 「팩토리 구독은 대표가 관리합니다」
   ============================================================ */
/* global window, document, fetch, location, history, MutationObserver */
(function () {
  'use strict';

  var CONSULT_STATUS = { pending: '대기', confirmed: '확정', completed: '완료', cancelled: '취소' }; // admin/consultations.html
  var SUB_STATUS = {
    active: '이용 중',
    cancelled: '해지 예약됨',
    past_due: '결제 실패 · 재시도 중',
    expired: '종료됨',
  }; // billing.html
  // 등급 이름 — segan/billing.js PLAN_KO · segan/plans.html 과 같다 (profiles.tier, DB 0047)
  var TIER_NAME = { standard: 'Standard', manager: 'Manager', expert: 'Expert', agent: 'Agent' };
  var LIMIT = 20;

  // 내 프로젝트 — GET /me/projects 의 stage 순서 그대로 (상담 → 시공 완료)
  var PROJECT_STAGES = [
    ['consult', '상담'],
    ['render', '연출컷'],
    ['design', '설계'],
    ['quote', '견적'],
    ['order', '수주'],
    ['installed', '시공 완료'],
  ];
  var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' }; // active 는 적지 않는다
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // erp.html · 워커 payments.js

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso) {
    // 날짜만 온 값(due_on 'YYYY-MM-DD')은 그대로 읽는다 — Date 로 바꾸면 시간대에 따라 하루 밀린다
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso));
    if (m) return m[1] + '.' + m[2] + '.' + m[3];
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (
      d.getFullYear() +
      '.' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '.' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  /** billing.html statusLabel 과 같다 — 해지 후 ended_at 이 찍혔으면 「종료됨」 */
  function subLabel(sub) {
    if (sub.status === 'cancelled' && sub.ended_at) return '종료됨';
    return SUB_STATUS[sub.status] || sub.status || '';
  }

  // ── 내 프로젝트 ────────────────────────────────────────
  /** 다음 결제 — 안 낸 것(paid_on 없음) 중 낼 날이 가장 이른 것. 날이 없는 것은 뒤, 같으면 받은 순서 */
  function nextPayment(payments) {
    var best = null;
    (Array.isArray(payments) ? payments : []).forEach(function (x) {
      if (!x || x.paid_on) return;
      if (!best) best = x;
      else if (x.due_on && (!best.due_on || String(x.due_on) < String(best.due_on))) best = x;
    });
    return best;
  }

  /** 단계 6칸 — 지금 단계까지 막대를 채운다 (만들기 탭 단계 막대와 같은 모양) */
  function stepsHtml(stage) {
    var at = -1;
    PROJECT_STAGES.forEach(function (s, i) {
      if (s[0] === stage) at = i;
    });
    return (
      '<ol class="me-steps" aria-label="진행 단계">' +
      PROJECT_STAGES.map(function (s, i) {
        return (
          '<li class="me-step' +
          (i <= at ? ' me-step--done' : '') +
          '"' +
          (i === at ? ' aria-current="step"' : '') +
          '>' +
          esc(s[1]) +
          '</li>'
        );
      }).join('') +
      '</ol>'
    );
  }

  function factHtml(label, value) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  /** 프로젝트 한 줄 — 제목 · 회사 · 상태(active 아니면) · 단계 · 계약 금액 · 다음 결제 · 설치일 */
  function projectHtml(p) {
    var facts = [];
    var order = p.order || null;
    if (order && order.contract_amount != null) {
      facts.push(factHtml('계약 금액', won(order.contract_amount)));
    }
    var pay = nextPayment(p.payments);
    if (pay) {
      var t = PAY_STAGE[pay.stage] || pay.stage || '';
      if (pay.amount != null) t += (t ? ' ' : '') + won(pay.amount);
      if (pay.due_on) t += (t ? ' · ' : '') + day(pay.due_on);
      facts.push(factHtml('다음 결제', t));
    }
    if (p.install_at) facts.push(factHtml('설치일', day(p.install_at)));
    var payBox = pay && window.SeganPay ? window.SeganPay.boxHtml(pay) : '';
    var status = p.status && p.status !== 'active' ? PROJECT_STATUS[p.status] || p.status : '';
    return (
      '<li class="me-project"><span class="me-p-head"><span class="me-c-main"><b>' +
      esc(p.title || '프로젝트') +
      '</b>' +
      (p.company_name ? '<small>' + esc(p.company_name) + '</small>' : '') +
      '</span>' +
      (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
      '</span>' +
      stepsHtml(p.stage) +
      (facts.length ? '<dl class="me-facts">' + facts.join('') + '</dl>' : '') +
      payBox +
      (window.SeganAs ? window.SeganAs.slotHtml(p) : '') +
      '</li>'
    );
  }

  var payBound = false;
  /** 다음 결제 줄의 결제 버튼 (segan/pay.js) — 막히면 칸 아래 글로. 입금 기다림 · 이미 받음(409)이면 칸을 다시 받는다 */
  function bindPay(session) {
    var list = $('meProjects');
    if (!list || payBound || !window.SeganPay) return;
    payBound = true;
    list.addEventListener('click', async function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-pay-id]') : null;
      if (!b) return;
      var err = $('mePayError');
      if (err) err.hidden = true;
      b.disabled = true;
      var r = await window.SeganPay.start(
        session,
        b.getAttribute('data-pay-id'),
        b.getAttribute('data-pay-method')
      );
      b.disabled = false;
      if (r.ok) return;
      if (err) {
        err.textContent = r.message;
        err.hidden = false;
      }
      if (r.reload) loadProjects(session);
    });
  }

  async function loadProjects(session) {
    var section = $('meProjectSection');
    if (!section) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    var base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!base) return;
    try {
      var res = await fetch(base + '/me/projects', {
        headers: { Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store',
      });
      if (!res.ok) return; // 404(아직 없는 주소) · 오류 — 칸째 감춘다
      var body = await res.json();
      if (!body || body.success !== true || !Array.isArray(body.data)) return;
      var rows = body.data;
      $('meProjects').innerHTML = rows.map(projectHtml).join(''); // 모양이 틀린 행은 던진다 → 칸째 감춘다
      $('meProjectEmpty').hidden = rows.length > 0;
      section.hidden = false;
      bindPay(session);
    } catch {
      section.hidden = true;
    }
  }

  // ── 상담 내역 ──────────────────────────────────────────
  async function loadConsults(sb, session) {
    var list = $('meConsults');
    try {
      var res = await sb
        .from('consultations')
        .select('id, title, status, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (res.error) throw res.error;
      var rows = res.data || [];
      list.innerHTML = rows
        .map(function (c) {
          return (
            '<li><span class="sg-row me-consult"><span class="me-c-main"><b>' +
            esc(c.title || '상담') +
            '</b><small>' +
            esc(day(c.created_at)) +
            '</small></span><span class="me-badge me-badge--' +
            esc(c.status || 'pending') +
            '">' +
            esc(CONSULT_STATUS[c.status] || c.status || '대기') +
            '</span></span></li>'
          );
        })
        .join('');
      $('meConsultEmpty').hidden = rows.length > 0;
    } catch {
      list.innerHTML = '';
      $('meConsultEmpty').hidden = false;
      $('meConsultEmpty').textContent = '상담 내역을 불러오지 못했습니다.';
    }
  }

  // ── 크레딧 · 구독 ──────────────────────────────────────
  async function loadPlan(sb, session, wallet) {
    var tier = 'standard';
    try {
      var p = await sb
        .from('profiles')
        .select('tier, name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (p && p.data && p.data.tier) tier = p.data.tier;
      var name = p && p.data && typeof p.data.name === 'string' ? p.data.name.trim() : '';
      $('meName').textContent = name;
      $('meName').hidden = !name;
    } catch {
      /* 등급을 못 읽으면 standard 로 적는다 (billing.html 과 같다) */
    }
    $('meTier').textContent = TIER_NAME[tier] || String(tier).toUpperCase();

    try {
      var w = await wallet;
      var left = w && w.balance != null ? Number(w.balance) : null;
      var cc = await sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      var cost = cc && cc.data ? cc.data.credits : null;
      $('meCredits').textContent =
        left == null
          ? '-'
          : left.toLocaleString('ko-KR') +
            ' 크레딧' +
            (cost > 0 ? ' · 생성 ' + Math.floor(left / cost) + '회' : '');
    } catch {
      $('meCredits').textContent = '-';
    }

    var cfg = window.DADAM_CONFIG || {};
    var api = (cfg.paymentsApi && cfg.paymentsApi.url) || '';
    try {
      if (!api) throw new Error('no api');
      var res = await fetch(api + '/subscription', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      var body = await res.json();
      var sub = body && body.data ? body.data : null;
      if (!sub && body && body.company) {
        $('meSub').textContent = '팩토리 구독은 대표가 관리합니다';
      } else if (!sub || sub.plan === 'free') {
        $('meSub').textContent = '없음';
      } else {
        var t = subLabel(sub);
        if (sub.status === 'active' && sub.next_charge_at)
          t += ' · 다음 결제 ' + day(sub.next_charge_at);
        else if (sub.amount_krw) t += ' · 월 ' + won(sub.amount_krw);
        $('meSub').textContent = t;
      }
    } catch {
      $('meSub').textContent = '불러오지 못했습니다';
    }
  }

  // ── 메뉴 · 하위 화면 ─────────────────────────────────────
  // section = 그 화면의 칸 · parts = 업체 칸(#partner) 안에서 보일 부분(그중 하나가 보여야 연다) ·
  // filled = 이 칸이 비어 있지 않아야 연다 (공장 구성원은 업체 내용 없이 상담 · 프로젝트 · A/S함만 온다) ·
  // label = 업체 칸 이름을 그 화면 제목으로 (모듈이 그리는 h3)
  var SCREENS = {
    partner: {
      title: '팩토리',
      section: 'partner',
      parts: ['mePartnerTitle', 'mePartner', 'meBooks'],
      filled: 'mePartner',
    },
    'partner-consults': {
      title: '상담',
      section: 'partner',
      parts: ['partner-consults', 'partnerConsultSettings'],
      label: 'partnerConsultsTitle',
    },
    'partner-projects': {
      title: '프로젝트',
      section: 'partner',
      parts: ['partnerProjects'],
      label: 'partnerProjectsTitle',
    },
    as: { title: 'A/S함', section: 'partner', parts: ['as'], label: 'asTitle' },
    consults: { title: '상담 내역', section: 'meConsultSection' },
    'projects-mine': { title: '내 프로젝트', section: 'meProjectSection' },
    'as-mine': { title: 'A/S 접수', section: 'meAsSection' },
    notify: { title: '알림', section: 'mePush' },
  };
  var COMPANY_SCREENS = ['partner', 'partner-consults', 'partner-projects', 'as']; // 업체 묶음 차례
  var SECTIONS = ['meProjectSection', 'meAsSection', 'partner', 'meConsultSection', 'mePush'];
  var PARTNER_PARTS = [
    'mePartnerTitle',
    'mePartner',
    'partner-consults',
    'partnerConsultSettings',
    'partnerProjects',
    'as',
    'meBooks',
  ];
  var GROUP_ORDER = {
    member: ['meGroupCompany', 'meGroupHq', 'meGroupMine'],
    other: ['meGroupMine', 'meGroupCompany', 'meGroupHq'],
  };
  var WIDE = '(min-width: 1100px)'; // shell.css 두 칸 — 시트가 옆 패널이 되는 폭과 같다
  var HUB_TITLE = '마이페이지';
  var TEXT = {
    wait: '확인하는 중…',
    none: '볼 수 있는 내용이 없습니다.',
    start: '팩토리로 시작하기',
    applying: '팩토리 신청',
    ledger: '회계',
    upload: '영수증 · 명세표 올리기',
    noJob: '없음',
    seeMine: '작업 화면 「내 작업」에서 확인하세요',
    pending: '승인 대기 — 회사가 확인하면 작업을 볼 수 있습니다', // js/mypage-work.js summaryHtml 과 같은 글
    rejected: '신청이 승인되지 않았습니다',
  };

  var H = {
    on: false, // 로그인해 메뉴를 그렸다
    loaded: false, // 칸을 모두 읽었다 (못 여는 화면 안내를 그때부터)
    partnerKnown: false, // /partner/me 를 읽었다 (PC 첫 칸을 그때 고른다)
    roles: null, // 셸 판정
  };

  function shown(id) {
    var el = $(id);
    return !!el && !el.hidden;
  }

  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 그 화면을 보일 수 있나 — 칸을 그 모듈이 열었을 때만 */
  function available(name) {
    var s = own(SCREENS, name) ? SCREENS[name] : null;
    if (!s || !shown(s.section)) return false;
    if (s.filled) {
      var f = $(s.filled);
      return !!f && f.children.length > 0;
    }
    if (s.parts) return s.parts.some(shown);
    return true;
  }

  function isWide() {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
    } catch {
      return false;
    }
  }

  /** 주소의 # 가 고른 화면 — 모르는 # 는 메뉴 */
  function askedScreen() {
    var h = String(location.hash || '').slice(1);
    return own(SCREENS, h) ? h : '';
  }

  /** 업체 칸 판정 (segan/partner.js) → { me, view } */
  function partnerOf() {
    var P = window.SeganPartner;
    var me = P && P.state ? P.state.me : null;
    return { me: me, view: P && P.viewOf ? P.viewOf(me) : 'hidden' };
  }

  /** 업체 구성원 — 협력업체가 있거나 다담 공장 구성원 */
  function isMember() {
    var p = partnerOf();
    return p.view === 'company' || !!(p.me && p.me.hq_member === true);
  }

  /** PC 에서 # 없이 열면 — 업체 구성원은 업체 묶음의 첫 칸, 아니면 상담 내역 */
  function defaultScreen() {
    if (isMember()) {
      for (var i = 0; i < COMPANY_SCREENS.length; i++)
        if (available(COMPANY_SCREENS[i])) return COMPANY_SCREENS[i];
    }
    return 'consults';
  }

  function off(id, yes) {
    var el = $(id);
    if (el) el.classList.toggle('me-off', yes);
  }

  /** 지금 주소 · 폭에 맞는 화면을 보인다 ('' = 메뉴만, 폰 · 태블릿) */
  function apply() {
    var main = $('main');
    if (!main || !H.on) return;
    var asked = askedScreen();
    var wide = isWide();
    var name = asked || (wide && H.partnerKnown ? defaultScreen() : '');
    var s = name ? SCREENS[name] : null;
    var open = !!name && available(name); // 못 여는 화면이면 칸 없이 안내만
    main.setAttribute('data-me-screen', name);
    SECTIONS.forEach(function (id) {
      off(id, !open || s.section !== id);
    });
    PARTNER_PARTS.forEach(function (id) {
      off(id, !s || !s.parts || s.parts.indexOf(id) < 0);
    });
    var sec = $('partner');
    if (sec)
      sec.setAttribute('aria-labelledby', s && s.label && $(s.label) ? s.label : 'mePartnerTitle');
    var note = $('mePaneNote');
    if (note) {
      var text = '';
      if (name && !open) text = H.loaded ? TEXT.none : TEXT.wait;
      else if (!name && wide) text = TEXT.wait; // PC — 업체 칸을 읽는 동안 첫 칸을 고르지 않는다
      note.textContent = text;
      note.hidden = !text;
    }
    document.querySelectorAll('#meHub a[data-me-go]').forEach(function (a) {
      if (name && a.getAttribute('data-me-go') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var back = $('meBack');
    if (back) back.hidden = !asked;
    var title = $('meTitle');
    // PC 는 왼쪽 메뉴가 늘 보여 「마이페이지」 그대로, 폰 · 태블릿은 그 화면 이름
    if (title) title.textContent = asked && !wide ? SCREENS[asked].title : HUB_TITLE;
    document.title = (asked ? SCREENS[asked].title + ' · ' : '') + HUB_TITLE + ' · SEGAN';
  }

  function toTop() {
    var se = document.scrollingElement || document.documentElement;
    if (se) se.scrollTop = 0;
  }

  /** 메뉴에서 그 화면으로 — 기록을 하나 넣는다 (meFrom = 넣기 전 화면, '' 이면 메뉴) */
  function go(name) {
    var from = askedScreen();
    if (name === from) return;
    try {
      history.pushState({ meFrom: from }, '', '#' + name);
    } catch {
      location.hash = name;
      return;
    }
    apply();
    toTop();
  }

  /** 「‹ 마이페이지」 — 메뉴에서 왔으면 뒤로, 아니면(알림 · 새로 고침) 이 기록을 메뉴로 바꾼다 */
  function backToHub(e) {
    if (e) e.preventDefault();
    var st = history.state;
    if (st && typeof st === 'object' && st.meFrom === '') {
      history.back(); // popstate → apply
      return;
    }
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* 그래도 메뉴를 보인다 */
    }
    apply();
    toTop();
  }

  function onHubClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-me-go]') : null;
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    go(a.getAttribute('data-me-go'));
  }

  function onPop(e) {
    var Shell = window.SeganShell;
    if (Shell && Shell.sheet && Shell.sheet.isSheetState(e && e.state)) return; // 시트 표시 칸 (segan/shell.js)
    apply();
  }

  /** 로그인 안내의 로그인 단추 — 하위 화면 주소(#partner · 알림의 #partner-consults · #as 등)로 왔으면 그 # 로 돌아온다 */
  function keepHashOnGate() {
    var name = askedScreen();
    if (!name) return;
    var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    if (a)
      a.setAttribute(
        'href',
        '../login.html?redirect=' + encodeURIComponent('segan/me.html#' + name)
      );
  }

  /** 역할 링크 — 셸 ROLE_LINKS 의 group company · hq 를 그 묶음 끝에 (처음엔 감춘다) */
  function roleRows() {
    var Shell = window.SeganShell || {};
    (Shell.ROLE_LINKS || []).forEach(function (r) {
      var ul = r.group === 'company' ? $('meCompanyRows') : r.group === 'hq' ? $('meHqRows') : null;
      if (!ul || ul.querySelector('[data-role="' + r.key + '"]')) return;
      var li = document.createElement('li');
      li.setAttribute('data-role', r.key);
      li.hidden = true;
      li.innerHTML =
        '<a class="sg-row" href="' +
        esc(r.href) +
        '"' +
        (r.desktopTab ? ' data-desktop-tab' : '') +
        '>' +
        esc(r.label) +
        '</a>';
      ul.appendChild(li);
      if (r.desktopTab && Shell.applyLinkTarget) Shell.applyLinkTarget(li.firstChild);
    });
  }

  /** 오늘 작업 — GET /work/me 요약 (js/mypage-work.js 의 건수 · 다음 작업 글) */
  function workLines(me) {
    var W = window.DadamMyPageWork;
    var w = (me && me.worker) || {};
    if (!W) return [];
    if (w.status === 'approved' || w.status === 'suspended') {
      var c = W.summaryCounts(me);
      var lines = [
        '예정 · 진행 ' +
          c.mine +
          '건 · 보완요청 ' +
          c.revision +
          '건 · 새 소식 ' +
          c.newEvents +
          '건' +
          (w.status === 'suspended' ? '' : ' · 모집중 ' + c.open + '건'),
      ];
      if (w.status === 'suspended') lines.push(W.SUSPENDED_NOTE);
      var job = me.next_job;
      var next = TEXT.noJob;
      if (job && typeof job === 'object') next = W.nextJobText(job);
      else if (c.mine > 0) next = TEXT.seeMine;
      lines.push('다음 작업 ' + next);
      return lines;
    }
    if (w.status === 'pending') return [TEXT.pending];
    if (w.status === 'rejected') return [TEXT.rejected];
    return [];
  }

  function renderWork(roles) {
    var card = $('meWork');
    if (!card) return;
    var me = roles && roles.workMe;
    card.hidden = !me;
    if (!me) return;
    var link = (window.SeganShell && window.SeganShell.ROLE_LINKS) || [];
    for (var i = 0; i < link.length; i++)
      if (link[i].group === 'work') card.setAttribute('href', link[i].href);
    try {
      $('meWorkBody').innerHTML = workLines(me)
        .map(function (t) {
          return '<span class="me-work-line">' + esc(t) + '</span>';
        })
        .join('');
    } catch {
      $('meWorkBody').innerHTML = ''; // 모양이 틀린 응답 — 제목 · 링크만
    }
  }

  function item(key, on) {
    var li = document.querySelector('#meHub [data-me-item="' + key + '"]');
    if (li) li.hidden = !on;
    return li;
  }

  /** 메뉴 줄 · 묶음을 지금 칸 상태에 맞춘다 (모듈이 칸을 열고 닫을 때마다) */
  function sync() {
    if (!H.on) return;
    Object.keys(SCREENS).forEach(function (name) {
      item(name, available(name));
    });
    // 팩토리 줄 — 업체 이름, 업체가 없으면 「팩토리로 시작하기」, 신청 중이면 「팩토리 신청」
    var p = partnerOf();
    var label = $('mePartnerLabel');
    if (label)
      label.textContent =
        p.view === 'start'
          ? TEXT.start
          : p.view === 'company' || p.view === 'hidden'
            ? SCREENS.partner.title
            : TEXT.applying;
    var val = $('mePartnerVal');
    if (val)
      val.textContent =
        p.view === 'company' && p.me.company && p.me.company.name ? p.me.company.name : '';
    // 회계 — segan/books.js 의 GET /ledger/me 답
    var B = window.SeganBooks;
    var kind = B && B.state ? B.state.ledgerKind : '';
    var ledger = item('ledger', kind === 'book' || kind === 'upload');
    if (ledger && $('meLedger'))
      $('meLedger').textContent = kind === 'upload' ? TEXT.upload : TEXT.ledger;
    // 역할 링크 — 셸 판정
    var roles = H.roles || {};
    ((window.SeganShell && window.SeganShell.ROLE_LINKS) || []).forEach(function (r) {
      var li = document.querySelector('#meHub [data-role="' + r.key + '"]');
      if (li) li.hidden = roles[r.role || r.key] !== true;
    });
    // 묶음 — 연 줄이 없으면 묶음째 감춘다, 업체 구성원은 업체가 먼저
    ['meGroupCompany', 'meGroupHq', 'meGroupMine'].forEach(function (id) {
      var g = $(id);
      if (g) g.hidden = !g.querySelector('li:not([hidden])');
    });
    var hub = $('meHub');
    var tail = hub ? hub.querySelector('.me-logout') : null;
    if (hub && tail) {
      var order = GROUP_ORDER[isMember() ? 'member' : 'other'];
      var now = [].filter
        .call(hub.children, function (g) {
          return g.classList.contains('me-group');
        })
        .map(function (g) {
          return g.id;
        });
      if (now.join() !== order.join())
        order.forEach(function (id) {
          if ($(id)) hub.insertBefore($(id), tail); // 차례가 바뀔 때만 옮긴다 (누른 줄의 초점을 지키게)
        });
    }
    apply();
  }

  /** 모듈이 칸을 열고 닫으면(hidden) · 업체 내용을 다시 그리면 메뉴를 맞춘다 */
  function watch() {
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(sync);
    SECTIONS.concat(PARTNER_PARTS).forEach(function (id) {
      var el = $(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    });
    if ($('mePartner')) mo.observe($('mePartner'), { childList: true });
  }

  /** 로그인 뒤 한 번 — 메뉴를 그리고 주소 · 폭 · 칸 변화를 듣는다 */
  function initHub(auth) {
    H.on = true;
    H.roles = auth.roles || null;
    roleRows();
    renderWork(H.roles);
    var hub = $('meHub');
    if (hub && !hub.getAttribute('data-bound')) {
      hub.setAttribute('data-bound', '1');
      hub.addEventListener('click', onHubClick);
    }
    var back = $('meBack');
    if (back && !back.getAttribute('data-bound')) {
      back.setAttribute('data-bound', '1');
      back.addEventListener('click', backToHub);
    }
    // 손잡이는 하나만 (스크립트를 다시 실어도 겹치지 않게)
    if (window.__seganMeOff) window.__seganMeOff();
    var mq = null;
    try {
      mq = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
    } catch {
      mq = null;
    }
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', apply);
    if (mq && mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq && mq.addListener) mq.addListener(apply);
    window.__seganMeOff = function () {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', apply);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq && mq.removeListener) mq.removeListener(apply);
    };
    watch();
    sync();
  }

  /** 모듈 하나를 다 읽으면 메뉴를 맞춘다 (상태만 바뀌는 것 — 회계 자격 · 업체 판정) */
  function synced(p) {
    return Promise.resolve(p).then(function (v) {
      sync();
      return v;
    });
  }

  async function start(auth) {
    var Partner = window.SeganPartner;
    if (!auth || !auth.session || !auth.sb || !$('meConsults')) {
      // me.html#partner · #partner-consults · #as 등 → 로그인 뒤 같은 화면
      keepHashOnGate();
      return;
    }
    initHub(auth);
    // 크레딧 통장 — 크레딧 줄과 업체 칸이 같은 값을 쓴다 (한 번만 묻는다)
    var M = window.SeganMake;
    var wallet = Promise.resolve(M && M.loadWallet ? M.loadWallet(auth.sb) : null).catch(
      function () {
        return null;
      }
    );
    var partner = Partner && Partner.load ? Partner.load(auth.sb, auth.session, wallet) : null;
    apply(); // 업체 칸이 ?failed=1 을 #partner 로 바꾼 뒤 — 그 화면부터
    var Consults = window.SeganPartnerConsults;
    var Books = window.SeganBooks;
    var Projects = window.SeganPartnerProjects;
    var Push = window.SeganPush;
    var As = window.SeganAs;
    await Promise.all([
      synced(loadProjects(auth.session)),
      // 내 A/S 접수 — 업체 칸과 상관없다 (segan/as-requests.js)
      synced(As && As.loadMine ? As.loadMine(auth.sb, auth.session) : null),
      // 업체 › 상담 · 회계 · 알림 — 업체 칸이 읽은 /partner/me 로 가린다
      //   상담 = Expert · Agent 업체 · 다담 공장 구성원 (segan/partner-consults.js), 회계 = 대표 · 실장 (segan/books.js),
      //   프로젝트 = 다담 공장 · Manager · Expert · Agent 업체 구성원 (segan/partner-projects.js),
      //   알림 = 업체 구성원 · 본사 · 신청 중 (segan/push.js)
      Promise.resolve(partner).then(function () {
        H.partnerKnown = true;
        sync();
        var me = Partner && Partner.state ? Partner.state.me : null;
        return Promise.all([
          synced(Consults && Consults.load ? Consults.load(auth.sb, auth.session, me) : null),
          synced(Books && Books.load ? Books.load(auth.sb, auth.session, me) : null),
          synced(Projects && Projects.load ? Projects.load(auth.sb, auth.session, me) : null),
          // A/S함 = 다담 공장 · Expert · Agent 구성원 (segan/as-requests.js)
          synced(As && As.load ? As.load(auth.sb, auth.session, me) : null),
          // 작업자도 알림 칸 — 셸의 작업 탭 판정을 그대로 넘긴다
          synced(
            Push && Push.load
              ? Push.load(auth.sb, auth.session, me, {
                  worker: !!(auth.roles && auth.roles.worker),
                })
              : null
          ),
        ]);
      }),
      loadConsults(auth.sb, auth.session),
      loadPlan(auth.sb, auth.session, wallet),
    ]);
    H.loaded = true;
    H.partnerKnown = true;
    sync();
  }

  var api = {
    SCREENS: SCREENS,
    COMPANY_SCREENS: COMPANY_SCREENS,
    TEXT: TEXT,
    state: H,
    available: available,
    apply: apply,
    CONSULT_STATUS: CONSULT_STATUS,
    SUB_STATUS: SUB_STATUS,
    PROJECT_STAGES: PROJECT_STAGES,
    PROJECT_STATUS: PROJECT_STATUS,
    PAY_STAGE: PAY_STAGE,
    subLabel: subLabel,
    nextPayment: nextPayment,
    projectHtml: projectHtml,
  };
  window.SeganMe = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
