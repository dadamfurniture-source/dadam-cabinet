/* ============================================================
   segan/partner.js — 「내 정보」 탭의 업체 칸 (segan/me.html #partner)

   데이터 (segan/me.js 가 로그인 뒤 SeganPartner.load 를 부른다)
     account-api  GET /partner/me     내 업체 · 내 가장 최근 신청 · (대표면) 구성원 · 초대
     payments-api GET /plans          Expert · Agent 월 금액 · 토스 client_key (pricing.html 과 같은 호출)
     credit_plans                     등급별 월 크레딧 (pricing.html 과 같은 표) — 금액 · 크레딧을 적어 두지 않는다
     RPC my_credit_wallet             업체 통장 잔액 (segan/make.js loadWallet — 내 정보의 크레딧 줄과 같은 값)
   /partner/me 를 못 읽으면(오류 · 404 · 주소 없음) · 본사 구성원(hq_member)이면 칸째 감춘다 — 내 프로젝트와 같다.

   화면 (위에서부터 먼저 맞는 것)
     업체 있음         업체 이름 · 등급(다음 결제일부터 바뀌는 등급) · 상태 · 내 역할 · 크레딧
                       대표: 직원(내보내기) · 직원 초대(링크) · 등급 바꾸기 · 결제 관리(billing.html)
                       실장 · 직원: 업체 이름 · 내 역할 · 크레딧만
                       정지(suspended) 「결제가 멈춰 있어 읽기만 됩니다」, 해지(closed) 「해지된 업체입니다」
     신청 접수 · 미팅   단계 3칸 (신청 접수 → 미팅 예정 → 승인), 미팅 시각은 한국 시간, 「신청 거두기」
     승인(새 업체)      「결제하고 시작」 (Agent)
     보류              안내 + 상담 신청 링크, 아래에 「업체로 시작하기」 카드 (다시 신청할 수 있다)
     그 밖             「업체로 시작하기」 카드 둘
                       Expert — 결제하면 바로 시작: 업체 이름 · 시·도 · 시·군·구 → 카드 등록
                       Agent  — 신청 → 현장 미팅 → 본사 승인: 신청 칸 7개 → POST /partner/apply

   결제 — pricing.html 과 같은 토스 requestBillingAuth → billing-success.html?plan=…
     떠나기 전에 sessionStorage partnerSignup 에 { plan, company?, returnTo } 를 둔다 (billing-success.html 이 읽는다).
     returnTo = 결제 뒤 앱으로 돌아올 곳 (이 업체 칸, 같은 사이트 안 경로).
     창을 닫았거나 못 열었으면 지운다. 실패해 돌아오면(me.html?failed=1) 그 안내를 업체 칸에 보인다.
   지우는 동작(신청 거두기 · 내보내기 · 초대 취소 · 등급 예약)은 페이지 안에서 한 번 더 묻는다.
   ============================================================ */
/* global window, document, location, history, navigator, sessionStorage, fetch */
(function () {
  'use strict';

  var PLAN_LABEL = { expert: 'Expert', agent: 'Agent' };
  var ROLE_LABEL = { owner: '대표', manager: '실장', staff: '직원' };
  var COMPANY_STATUS = { active: '이용 중', suspended: '결제 멈춤', closed: '해지됨' };
  var MEMBER_STATUS = { active: '활동 중', removed: '내보냄' };
  var APP_STEPS = ['신청 접수', '미팅 예정', '승인'];
  var INVITE_ROLES = ['manager', 'staff'];

  var SIGNUP_KEY = 'partnerSignup'; // billing-success.html 이 읽는다
  var INVITE_PATH = '/segan/join.html#t=';
  var BILLING_PAGE = '../billing.html';
  var CONSULT_PAGE = '../consultation.html';
  var FAIL_PATH = '/segan/me.html?failed=1';
  var RETURN_TO = '/segan/me.html#partner'; // billing-success.html 의 「돌아가기」

  // DB 의 CHECK 와 같은 형식 (partner_applications) — 서버도 같은 것을 본다
  var PHONE_RE = /^[0-9][0-9-]{7,19}$/;
  var BIZNO_RE = /^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

  var GENERIC_ERR = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  var PAY_MODULE_ERR = '결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  var FAILED_MSG = '결제가 완료되지 않았습니다. 다시 시도해 주세요.'; // pricing.html 과 같은 글

  // Agent 신청 칸 — company: 업그레이드(Expert 업체 → Agent)면 업체 값을 쓴다 (서버도 업체 값으로 채운다)
  var APPLY_FIELDS = [
    { name: 'company_name', label: '업체 이름', max: 100, company: 'name' },
    { name: 'representative_name', label: '대표자 이름', max: 50 },
    {
      name: 'contact_phone',
      label: '연락처',
      re: PHONE_RE,
      bad: '연락처는 숫자와 - 로 적어 주세요. (예: 010-1234-5678)',
    },
    { name: 'sido', label: '시·도', max: 20, company: 'sido' },
    { name: 'gugun', label: '시·군·구', max: 40, company: 'gugun' },
    {
      name: 'business_number',
      label: '사업자등록번호',
      re: BIZNO_RE,
      bad: '사업자등록번호 10자리를 적어 주세요. (예: 123-45-67890)',
    },
    { name: 'intro', label: '하는 일 한 줄', max: 200 },
  ];

  var P = {
    sb: null,
    session: null,
    base: '', // account-api
    pay: '', // payments-api
    me: null, // GET /partner/me data
    plans: null, // GET /plans data { client_key, plans: [{ id, price_krw }] }
    credits: {}, // credit_plans tier → monthly_credits
    wallet: null, // my_credit_wallet 한 줄
    open: null, // 'expert' | 'agent' | 'upgrade' | 'invite'
    ask: null, // 한 번 더 묻는 동작 키 ('withdraw' · 'remove:<id>' · 'revoke:<id>' · 'plan:expert' · 'plan:cancel')
    invite: null, // 방금 만든 초대 { id, role, expires_at, link }
    msg: '',
    err: '',
    busy: false,
    scrolled: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(n) {
    return Number(n || 0).toLocaleString('ko-KR');
  }

  function won(n) {
    return num(n) + '원';
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 — 미팅 시각 · 초대 기한 (ISO UTC 로 온다) */
  function kst(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return new Date(t + 9 * 3600 * 1000);
  }

  function kstDay(iso) {
    var k = kst(iso);
    if (!k) return '';
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  function kstTime(iso) {
    var k = kst(iso);
    if (!k) return '';
    var W = ['일', '월', '화', '수', '목', '금', '토'];
    return (
      kstDay(iso) +
      ' (' +
      W[k.getUTCDay()] +
      ') ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }

  /** 은/는 — 마지막 글자에 받침이 있으면 「은」 (segan/shell.js 와 같다) */
  function topic(word) {
    var c = word.charCodeAt(word.length - 1) - 0xac00;
    return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? '은' : '는');
  }

  function planName(plan) {
    return PLAN_LABEL[plan] || String(plan || '');
  }

  function region(x) {
    return [x && x.sido, x && x.gugun].filter(Boolean).join(' ');
  }

  // ── 판정 · 신청 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 보일 화면 — hidden | company | pending | approved | held | start */
  function viewOf(d) {
    if (!d || typeof d !== 'object' || d.hq_member) return 'hidden';
    if (d.company) return 'company';
    var a = d.application;
    if (a && (a.status === 'applied' || a.status === 'meeting')) return 'pending';
    if (a && a.status === 'approved' && a.kind === 'new' && !a.used_at) return 'approved';
    if (a && a.status === 'held') return 'held';
    return 'start';
  }

  /**
   * Agent 신청 본문 — 앞뒤 공백을 자르고 형식을 본다. → { body } | { field, error }
   * company 가 있으면(업그레이드) 업체 이름 · 지역은 업체 값을 넣는다 (서버도 업체 값으로 채운다)
   */
  function applyBody(values, company) {
    var v = values || {};
    var body = {};
    for (var i = 0; i < APPLY_FIELDS.length; i++) {
      var f = APPLY_FIELDS[i];
      var fromCompany = company && f.company;
      var raw = fromCompany ? company[f.company] : v[f.name];
      var val = String(raw == null ? '' : raw).trim();
      body[f.name] = val;
      if (fromCompany) continue;
      if (!val) {
        if (f.name === 'sido' || f.name === 'gugun')
          return { field: f.name, error: '시·도와 시·군·구를 골라 주세요.' };
        return { field: f.name, error: f.label + josa(f.label) + ' 적어 주세요.' };
      }
      if (f.max && val.length > f.max)
        return { field: f.name, error: topic(f.label) + ' ' + f.max + '자까지 적을 수 있습니다.' };
      if (f.re && !f.re.test(val)) return { field: f.name, error: f.bad };
    }
    return { body: body };
  }

  /** 을/를 */
  function josa(word) {
    var c = word.charCodeAt(word.length - 1) - 0xac00;
    return c >= 0 && c < 11172 && c % 28 !== 0 ? '을' : '를';
  }

  /** Expert 시작 — 업체 이름 · 시·도 · 시·군·구 → { company } | { field, error } */
  function expertCompany(values) {
    var v = values || {};
    var name = String(v.name == null ? '' : v.name).trim();
    var sido = String(v.sido == null ? '' : v.sido).trim();
    var gugun = String(v.gugun == null ? '' : v.gugun).trim();
    if (!name) return { field: 'name', error: '업체 이름을 적어 주세요.' };
    if (name.length > 100)
      return { field: 'name', error: '업체 이름은 100자까지 적을 수 있습니다.' };
    if (!sido || sido.length > 20)
      return { field: 'sido', error: '시·도와 시·군·구를 골라 주세요.' };
    if (!gugun || gugun.length > 40)
      return { field: 'gugun', error: '시·도와 시·군·구를 골라 주세요.' };
    return { company: { name: name, sido: sido, gugun: gugun } };
  }

  /** 초대 링크 — 서버는 토큰만 준다. 링크는 화면이 만든다 */
  function inviteLink(origin, token) {
    return origin + INVITE_PATH + token;
  }

  /** 아직 쓸 수 있는 초대 (수락 · 취소 · 만료 아님) */
  function openInvites(list, now) {
    var t = now == null ? Date.now() : now;
    return (Array.isArray(list) ? list : []).filter(function (i) {
      if (!i || i.accepted_at || i.revoked_at) return false;
      var e = Date.parse(i.expires_at);
      return !isNaN(e) && e > t;
    });
  }

  // ── 그리기 조각 ─────────────────────────────────────────
  function fact(label, value) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function errBox() {
    return '<p class="mk-error" data-err role="alert" hidden></p>';
  }

  /** 월 금액 · 크레딧 월 N — /plans · credit_plans 에서 (못 읽은 것은 뺀다) */
  function planInfo(plan) {
    var list = (P.plans && Array.isArray(P.plans.plans) && P.plans.plans) || [];
    var p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === plan) p = list[i];
    var parts = [];
    if (p && p.price_krw != null) parts.push('월 ' + won(p.price_krw));
    if (P.credits[plan] != null) parts.push('크레딧 월 ' + num(P.credits[plan]));
    return parts.join(' · ');
  }

  function infoLine(plan) {
    var t = planInfo(plan);
    return t ? '<p class="me-pt-info">' + esc(t) + '</p>' : '';
  }

  /** 한 번 더 묻기 — P.ask 가 key 면 확인 칸, 아니면 원래 단추 */
  function askOr(key, normal, text, yes) {
    if (P.ask !== key) return normal;
    return (
      '<div class="rd-confirm me-pt-ask"><p class="mk-note">' +
      esc(text) +
      '</p><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="yes">' +
      esc(yes) +
      '</button><button type="button" class="mk-btn" data-act="no">그만두기</button></div></div>'
    );
  }

  function btn(act, label, solid, extra) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (extra || '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function acts(inner) {
    return '<div class="rd-acts">' + inner + '</div>';
  }

  function input(name, label, o) {
    var x = o || {};
    return (
      '<label class="mk-input"><span>' +
      esc(label) +
      '</span><input name="' +
      name +
      '" type="' +
      (x.type || 'text') +
      '"' +
      (x.max ? ' maxlength="' + x.max + '"' : '') +
      (x.mode ? ' inputmode="' + x.mode + '"' : '') +
      (x.auto ? ' autocomplete="' + x.auto + '"' : '') +
      (x.ph ? ' placeholder="' + esc(x.ph) + '"' : '') +
      ' /></label>'
    );
  }

  /** 시·도 · 시·군·구 — segan/regions.js (signup.html 과 같은 목록) */
  function regionHtml() {
    var R = window.SeganRegions || {};
    return (
      '<div class="cs-region"><label class="mk-input"><span>시·도</span><select name="sido">' +
      '<option value="">시/도 선택</option>' +
      Object.keys(R)
        .map(function (s) {
          return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
        })
        .join('') +
      '</select></label><label class="mk-input"><span>시·군·구</span><select name="gugun" disabled>' +
      '<option value="">시/군/구 선택</option></select></label></div>'
    );
  }

  function fillGugun(form) {
    var R = window.SeganRegions || {};
    var sido = form.querySelector('select[name="sido"]');
    var gugun = form.querySelector('select[name="gugun"]');
    if (!sido || !gugun) return;
    var list = R[sido.value] || [];
    gugun.innerHTML =
      '<option value="">시/군/구 선택</option>' +
      list
        .map(function (g) {
          return '<option value="' + esc(g) + '">' + esc(g) + '</option>';
        })
        .join('');
    gugun.disabled = !list.length;
  }

  // ── 화면: 업체로 시작하기 ───────────────────────────────
  function card(plan, how, label, act) {
    var on = P.open === plan;
    return (
      '<div class="me-pt-card" data-plan="' +
      plan +
      '"><b class="me-pt-name">' +
      esc(planName(plan)) +
      '</b>' +
      infoLine(plan) +
      '<p class="me-pt-how">' +
      esc(how) +
      '</p>' +
      btn(act, label, !on, ' aria-expanded="' + on + '"') +
      '</div>'
    );
  }

  function expertFormHtml() {
    return (
      '<form class="me-pt-form" data-form="expert" novalidate>' +
      '<p class="me-pt-title">Expert 로 시작하기</p>' +
      input('name', '업체 이름', { max: 100, auto: 'organization' }) +
      regionHtml() +
      '<p class="mk-note">카드를 등록하면 첫 달이 결제되고 바로 시작합니다.</p>' +
      errBox() +
      acts(
        '<button type="submit" class="mk-btn mk-btn--solid">카드 등록하고 시작</button>' +
          btn('close', '닫기')
      ) +
      '</form>'
    );
  }

  /** Agent 신청 — company 가 있으면 업그레이드(Expert 업체 → Agent): 업체 이름 · 지역 칸이 없다 */
  function applyFormHtml(company) {
    var up = !!company;
    return (
      '<form class="me-pt-form" data-form="apply" novalidate>' +
      '<p class="me-pt-title">' +
      (up ? 'Agent 로 바꾸기 신청' : 'Agent 업체 신청') +
      '</p>' +
      (up ? '' : input('company_name', '업체 이름', { max: 100, auto: 'organization' })) +
      input('representative_name', '대표자 이름', { max: 50, auto: 'name' }) +
      input('contact_phone', '연락처', {
        type: 'tel',
        mode: 'tel',
        max: 20,
        auto: 'tel',
        ph: '010-1234-5678',
      }) +
      (up ? '' : regionHtml()) +
      input('business_number', '사업자등록번호', { mode: 'numeric', max: 12, ph: '123-45-67890' }) +
      input('intro', '하는 일 한 줄', { max: 200, ph: '예: 주방 · 붙박이장 시공' }) +
      '<p class="mk-note">' +
      (up
        ? '신청을 받으면 본사가 연락해 현장 미팅을 잡습니다. 승인되면 다음 결제일부터 Agent 금액 · 크레딧으로 바뀝니다.'
        : '신청을 받으면 본사가 연락해 현장 미팅을 잡습니다. 승인되면 이 화면에서 결제하고 시작합니다.') +
      '</p>' +
      errBox() +
      acts(
        '<button type="submit" class="mk-btn mk-btn--solid">신청 보내기</button>' +
          btn('close', '닫기')
      ) +
      '</form>'
    );
  }

  function startHtml() {
    return (
      '<p class="me-pt-lead">업체로 시작하면 직원과 크레딧을 함께 씁니다.</p>' +
      '<div class="me-pt-cards">' +
      card('expert', '결제하면 바로 시작', '업체로 시작하기', 'open-expert') +
      card('agent', '신청 → 현장 미팅 → 본사 승인', '신청하기', 'open-agent') +
      '</div>' +
      (P.open === 'expert' ? expertFormHtml() : '') +
      (P.open === 'agent' ? applyFormHtml(null) : '')
    );
  }

  // ── 화면: 신청 진행 · 승인 · 보류 ────────────────────────
  function appStepsHtml(a) {
    var at = a.status === 'meeting' ? 1 : 0;
    return (
      '<ol class="me-steps me-steps--3" aria-label="신청 단계">' +
      APP_STEPS.map(function (label, i) {
        return (
          '<li class="me-step' +
          (i <= at ? ' me-step--done' : '') +
          '"' +
          (i === at ? ' aria-current="step"' : '') +
          '>' +
          esc(label) +
          '</li>'
        );
      }).join('') +
      '</ol>'
    );
  }

  /** 신청 접수 · 미팅 — upgrade 면 업체 칸 안에서 (업체 이름 · 지역은 위에 이미 있다) */
  function pendingHtml(a, upgrade) {
    var facts = [];
    if (!upgrade) {
      facts.push(fact('업체 이름', a.company_name));
      if (region(a)) facts.push(fact('지역', region(a)));
    }
    if (kstDay(a.created_at)) facts.push(fact('신청일', kstDay(a.created_at)));
    if (a.status === 'meeting' && kstTime(a.meeting_at))
      facts.push(fact('미팅', kstTime(a.meeting_at)));
    var note =
      a.status === 'meeting'
        ? '본사와 현장 미팅 뒤 승인 여부를 정합니다.'
        : '신청을 받았습니다. 본사가 연락해 현장 미팅을 잡습니다.';
    return (
      '<div class="me-pt-box" data-view="pending">' +
      '<p class="me-pt-title">' +
      (upgrade ? 'Agent 로 바꾸기 신청' : 'Agent 업체 신청') +
      '</p>' +
      appStepsHtml(a) +
      '<dl class="me-facts">' +
      facts.join('') +
      '</dl>' +
      '<p class="mk-note">' +
      esc(note) +
      '</p>' +
      askOr(
        'withdraw',
        acts(btn('ask-withdraw', '신청 거두기')),
        '신청을 거둘까요? 거둔 뒤에도 다시 신청할 수 있습니다.',
        '신청 거두기'
      ) +
      '</div>'
    );
  }

  function approvedHtml(a) {
    var facts = [fact('업체 이름', a.company_name)];
    if (region(a)) facts.push(fact('지역', region(a)));
    facts.push(fact('등급', planName('agent')));
    return (
      '<div class="me-pt-box" data-view="approved">' +
      '<p class="me-pt-title">승인되었습니다</p>' +
      '<dl class="me-facts">' +
      facts.join('') +
      '</dl>' +
      infoLine('agent') +
      '<p class="mk-note">카드를 등록하고 첫 달을 결제하면 바로 Agent 업체로 시작합니다.</p>' +
      errBox() +
      acts(btn('pay-agent', '결제하고 시작', true)) +
      '</div>'
    );
  }

  function heldHtml(upgrade) {
    return (
      '<div class="me-pt-box" data-view="held">' +
      '<p class="me-pt-title">보류되었습니다</p>' +
      '<p class="mk-note">' +
      (upgrade ? 'Agent 로 바꾸기 신청이' : '업체 신청이') +
      ' 보류되었습니다. 궁금한 점은 상담으로 물어봐 주세요. 다시 신청할 수도 있습니다.</p>' +
      acts('<a class="mk-btn" href="' + CONSULT_PAGE + '">상담 신청</a>') +
      '</div>'
    );
  }

  // ── 화면: 업체 있음 ─────────────────────────────────────
  /** 업체 통장 — my_credit_wallet 이 이 업체 통장일 때만 */
  function walletText(c) {
    var w = P.wallet;
    if (!w || w.scope !== 'company' || w.company_id !== c.id || w.balance == null) return '';
    return num(w.balance) + ' 크레딧' + (w.monthly ? ' · 월 ' + num(w.monthly) : '');
  }

  function membersHtml(d, editable) {
    var me = P.session && P.session.user ? P.session.user.id : '';
    var list = Array.isArray(d.members) ? d.members : [];
    var rows = list
      .filter(function (m) {
        return m && typeof m === 'object';
      })
      .map(function (m) {
        var can =
          editable &&
          m.status === 'active' &&
          m.role !== 'owner' &&
          m.user_id !== me &&
          UUID_RE.test(String(m.user_id || ''));
        var key = 'remove:' + m.user_id;
        var who = m.name || m.email || '이 사람';
        var state = [ROLE_LABEL[m.role] || m.role, MEMBER_STATUS[m.status] || m.status]
          .filter(Boolean)
          .join(' · ');
        return (
          '<li class="me-pt-row" data-member="' +
          esc(m.user_id) +
          '"><span class="me-pt-line"><span class="me-c-main"><b>' +
          esc(m.name || m.email || '이름 없음') +
          '</b>' +
          (m.name && m.email ? '<small>' + esc(m.email) + '</small>' : '') +
          '</span><span class="me-badge">' +
          esc(state) +
          '</span>' +
          (can && P.ask !== key
            ? btn('ask-remove', '내보내기', false, ' data-id="' + esc(m.user_id) + '"')
            : '') +
          '</span>' +
          (can
            ? askOr(
                key,
                '',
                who + josa(who) + ' 내보낼까요? 내보내면 업체 크레딧을 함께 쓰지 못합니다.',
                '내보내기'
              )
            : '') +
          '</li>'
        );
      });
    return (
      '<div class="me-pt-group"><p class="me-pt-sub">직원</p>' +
      (rows.length
        ? '<ul class="me-pt-list">' + rows.join('') + '</ul>'
        : '<p class="me-empty">아직 직원이 없습니다.</p>') +
      '</div>'
    );
  }

  function invitesHtml(d) {
    var open = openInvites(d.invites).filter(function (i) {
      return UUID_RE.test(String(i.id || ''));
    });
    var list = open.length
      ? '<ul class="me-pt-list">' +
        open
          .map(function (i) {
            var key = 'revoke:' + i.id;
            return (
              '<li class="me-pt-row" data-invite="' +
              esc(i.id) +
              '"><span class="me-pt-line"><span class="me-c-main"><b>' +
              esc((ROLE_LABEL[i.role] || i.role) + ' 초대') +
              '</b><small>' +
              esc(kstDay(i.expires_at) + '까지') +
              '</small></span>' +
              (P.ask !== key
                ? btn('ask-revoke', '초대 취소', false, ' data-id="' + esc(i.id) + '"')
                : '') +
              '</span>' +
              askOr(key, '', '이 초대 링크를 못 쓰게 할까요?', '초대 취소') +
              '</li>'
            );
          })
          .join('') +
        '</ul>'
      : '';
    var made = '';
    if (P.invite) {
      made =
        '<div class="me-pt-box me-pt-made" data-view="invite-link">' +
        '<p class="me-pt-title">' +
        esc((ROLE_LABEL[P.invite.role] || '직원') + ' 초대 링크') +
        '</p>' +
        '<input class="me-pt-url" id="mePartnerLink" type="text" readonly aria-label="초대 링크" value="' +
        esc(P.invite.link) +
        '" />' +
        '<p class="mk-note">' +
        esc(
          (kstDay(P.invite.expires_at)
            ? kstDay(P.invite.expires_at) + '까지 쓸 수 있습니다. '
            : '') + '링크는 지금만 보이니 복사해서 보내 주세요.'
        ) +
        '</p>' +
        acts(btn('copy-invite', '링크 복사', true)) +
        '<p class="me-pt-msg" data-copy role="status"></p>' +
        '</div>';
    }
    var form =
      P.open === 'invite'
        ? '<div class="me-pt-form" data-form="invite">' +
          '<fieldset class="cs-set"><legend>어떤 역할로 초대할까요?</legend>' +
          INVITE_ROLES.map(function (r) {
            return (
              '<label class="cs-opt"><input type="radio" name="inviteRole" value="' +
              r +
              '" /><span><b>' +
              esc(ROLE_LABEL[r]) +
              '</b></span></label>'
            );
          }).join('') +
          '</fieldset>' +
          errBox() +
          acts(btn('make-invite', '링크 만들기', true) + btn('close', '닫기')) +
          '</div>'
        : acts(btn('open-invite', '직원 초대'));
    return (
      '<div class="me-pt-group"><p class="me-pt-sub">직원 초대</p>' + list + made + form + '</div>'
    );
  }

  /** 등급 바꾸기 — Agent → Expert 예약 · 예약 취소 · Expert → Agent 신청(kind upgrade) */
  function planHtml(d) {
    var c = d.company;
    var a = d.application;
    var body = '';
    if (c.next_plan) {
      body =
        '<p class="mk-note">' +
        esc('다음 결제일부터 ' + planName(c.next_plan) + ' 로 바뀝니다.') +
        '</p>' +
        askOr(
          'plan:cancel',
          acts(btn('ask-plan-cancel', '예약 취소')),
          c.next_plan === 'agent'
            ? '예약을 취소할까요? Agent 로 바꾸려면 다시 신청해야 합니다.'
            : '예약을 취소할까요? 지금 등급 그대로 이어집니다.',
          '예약 취소'
        );
    } else if (c.plan === 'agent') {
      body =
        infoLine('expert') +
        '<p class="mk-note">다음 결제일부터 Expert 금액 · 크레딧으로 바뀝니다. 그때까지는 Agent 그대로입니다.</p>' +
        askOr(
          'plan:expert',
          acts(btn('ask-plan-expert', '다음 결제일부터 Expert 로 내리기')),
          '다음 결제일부터 Expert 로 내릴까요?',
          'Expert 로 내리기'
        );
    } else if (c.plan === 'expert') {
      var up = a && a.kind === 'upgrade' ? a : null;
      if (up && (up.status === 'applied' || up.status === 'meeting')) {
        body = pendingHtml(up, true);
      } else {
        body =
          (up && up.status === 'held' ? heldHtml(true) : '') +
          (P.open === 'upgrade'
            ? applyFormHtml(c)
            : infoLine('agent') +
              '<p class="mk-note">Agent 는 신청 → 현장 미팅 → 본사 승인 뒤 다음 결제일부터 바뀝니다.</p>' +
              acts(btn('open-upgrade', 'Agent 신청')));
      }
    }
    return body
      ? '<div class="me-pt-group"><p class="me-pt-sub">등급 바꾸기</p>' + body + '</div>'
      : '';
  }

  function companyHtml(d) {
    var c = d.company;
    var owner = c.role === 'owner';
    var active = c.status === 'active';
    var facts = [fact('업체 이름', c.name)];
    if (owner) {
      facts.push(
        fact(
          '등급',
          planName(c.plan) + (c.next_plan ? ' · 다음 결제일부터 ' + planName(c.next_plan) : '')
        )
      );
      facts.push(fact('상태', COMPANY_STATUS[c.status] || c.status));
    }
    facts.push(fact('내 역할', ROLE_LABEL[c.role] || c.role));
    var credit = walletText(c);
    if (credit) facts.push(fact('크레딧', credit));

    var notice = '';
    if (c.status === 'suspended') notice = '결제가 멈춰 있어 읽기만 됩니다.';
    else if (c.status === 'closed') notice = '해지된 업체입니다.';

    var out =
      '<div class="me-pt-box" data-view="company">' +
      '<dl class="me-facts">' +
      facts.join('') +
      '</dl>' +
      (notice ? '<p class="me-pt-warn">' + esc(notice) + '</p>' : '') +
      '</div>';
    if (owner) {
      out += membersHtml(d, active);
      if (active) out += invitesHtml(d) + planHtml(d);
      out +=
        '<ul class="sg-rows me-pt-rows"><li><a class="sg-row" href="' +
        BILLING_PAGE +
        '">결제 관리</a></li></ul>';
    }
    return out;
  }

  function render() {
    var section = $('partner');
    var root = $('mePartner');
    if (!section || !root) return;
    var view = viewOf(P.me);
    if (view === 'hidden') {
      root.innerHTML = '';
      section.hidden = true;
      return;
    }
    var html =
      (P.msg ? '<p class="me-pt-msg" role="status">' + esc(P.msg) + '</p>' : '') +
      (P.err ? '<p class="mk-error me-pt-err" role="alert">' + esc(P.err) + '</p>' : '');
    var a = P.me.application;
    if (view === 'company') html += companyHtml(P.me);
    else if (view === 'pending') html += pendingHtml(a, false);
    else if (view === 'approved') html += approvedHtml(a);
    else if (view === 'held') html += heldHtml(false) + startHtml();
    else html += startHtml();
    root.innerHTML = html; // 모양이 틀린 응답은 여기서 던진다 → load 가 칸째 감춘다
    section.hidden = false;
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = P.sb && (await P.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return P.session ? P.session.access_token : '';
  }

  /** account-api 호출 → { ok, status, body } (본문이 JSON 이 아니면 body = {}) */
  async function call(path, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (o.body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(P.base + path, {
        method: o.method || 'GET',
        headers: headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
        cache: 'no-store',
      });
    } catch {
      return { ok: false, status: 0, body: {} };
    }
    var body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    var b = body && typeof body === 'object' ? body : {};
    return { ok: res.ok && b.success === true, status: res.status, body: b };
  }

  function errText(r) {
    return (r && r.body && typeof r.body.error === 'string' && r.body.error) || GENERIC_ERR;
  }

  async function fetchMe() {
    var r = await call('/partner/me');
    var d = r.ok ? r.body.data : null;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  async function loadPlans() {
    if (!P.pay) return null;
    try {
      var res = await fetch(P.pay + '/plans');
      var body = await res.json();
      return res.ok && body && body.data && typeof body.data === 'object' ? body.data : null;
    } catch {
      return null;
    }
  }

  async function loadCredits(sb) {
    var out = {};
    try {
      var r = await sb.from('credit_plans').select('tier, monthly_credits');
      (Array.isArray(r && r.data) ? r.data : []).forEach(function (x) {
        if (x && x.tier) out[x.tier] = x.monthly_credits;
      });
    } catch {
      /* 크레딧 줄만 뺀다 */
    }
    return out;
  }

  async function refresh(err, msg) {
    var d = await fetchMe();
    if (d) P.me = d;
    P.err = err || '';
    P.msg = msg || '';
    P.ask = null;
    P.open = null;
    render();
  }

  // ── 동작 ───────────────────────────────────────────────
  function setBusy(on) {
    P.busy = on;
    var root = $('mePartner');
    if (!root) return;
    // 누르는 동안 칸 안의 단추 · 입력을 잠근다 (원래 잠긴 것은 그대로 둔다)
    root.querySelectorAll('button, input, select').forEach(function (el) {
      if (on && !el.disabled) {
        el.setAttribute('data-busy', '');
        el.disabled = true;
      } else if (!on && el.hasAttribute('data-busy')) {
        el.removeAttribute('data-busy');
        el.disabled = false;
      }
    });
  }

  /** 상자 안 오류 한 줄 (field 가 있으면 그 칸에 표시 · 초점) */
  function boxError(box, text, field) {
    var el = box && box.querySelector('[data-err]');
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    } else {
      P.err = text;
      render();
    }
    if (!box) return;
    box.querySelectorAll('[aria-invalid]').forEach(function (x) {
      x.removeAttribute('aria-invalid');
    });
    // 칸 이름은 서버(422 field)에서도 온다 — 아는 모양만 고른다
    var f = /^[a-z_]{1,40}$/.test(String(field || ''))
      ? box.querySelector('[name="' + field + '"]')
      : null;
    if (f) {
      f.setAttribute('aria-invalid', 'true');
      if (f.focus) f.focus();
    }
  }

  function clearSignup() {
    try {
      sessionStorage.removeItem(SIGNUP_KEY);
    } catch {
      /* noop */
    }
  }

  /** 토스 카드 등록 — pricing.html 과 같은 호출. 떠나기 전에 partnerSignup 을 둔다 */
  function startBilling(plan, signup, box) {
    var key = P.plans && P.plans.client_key;
    if (!key || typeof window.TossPayments !== 'function') return boxError(box, PAY_MODULE_ERR);
    try {
      // 모든 업체 결제(Expert · Agent)에 돌아올 곳을 함께 둔다
      var data = Object.assign({}, signup, { returnTo: RETURN_TO });
      sessionStorage.setItem(SIGNUP_KEY, JSON.stringify(data));
    } catch {
      return boxError(
        box,
        '이 브라우저에서는 결제를 이어 갈 수 없습니다. 다른 브라우저로 열어 주세요.'
      );
    }
    var fail = function (err) {
      clearSignup();
      // 창을 닫은 경우도 여기로 온다 — 오류로 소란 떨지 않는다 (pricing.html 과 같다)
      if (err && err.code === 'USER_CANCEL') return;
      boxError(box, '결제창을 열지 못했습니다. ' + (err && err.message ? err.message : ''));
    };
    try {
      var p = window.TossPayments(key).requestBillingAuth('CARD', {
        customerKey: 'dadam-' + P.session.user.id,
        successUrl: location.origin + '/billing-success.html?plan=' + encodeURIComponent(plan),
        failUrl: location.origin + FAIL_PATH,
      });
      if (p && typeof p.catch === 'function') p.catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  async function submitApply(form) {
    var c = P.me && P.me.company && P.me.company.role === 'owner' ? P.me.company : null;
    var values = {};
    APPLY_FIELDS.forEach(function (f) {
      var el = form.elements[f.name];
      values[f.name] = el ? el.value : '';
    });
    var r = applyBody(values, c);
    if (r.error) return boxError(form, r.error, r.field);
    boxError(form, '');
    setBusy(true);
    var res = await call('/partner/apply', { method: 'POST', body: r.body });
    setBusy(false);
    var app = res.ok && res.body.data ? res.body.data.application : null;
    if (app && typeof app === 'object') {
      P.me.application = app;
      P.open = null;
      P.err = '';
      P.msg = '신청을 받았습니다. 본사가 연락드립니다.';
      render();
      return;
    }
    if (res.status === 409) return refresh(errText(res));
    boxError(form, errText(res), res.status === 422 ? res.body.field : null);
  }

  function submitExpert(form) {
    var r = expertCompany({
      name: form.elements.name ? form.elements.name.value : '',
      sido: form.elements.sido ? form.elements.sido.value : '',
      gugun: form.elements.gugun ? form.elements.gugun.value : '',
    });
    if (r.error) return boxError(form, r.error, r.field);
    boxError(form, '');
    startBilling('expert', { plan: 'expert', company: r.company }, form);
  }

  async function makeInvite(box) {
    var picked = box.querySelector('input[name="inviteRole"]:checked');
    if (!picked || INVITE_ROLES.indexOf(picked.value) < 0)
      return boxError(box, '실장 · 직원 중에서 골라 주세요.');
    setBusy(true);
    var res = await call('/partner/invites', { method: 'POST', body: { role: picked.value } });
    setBusy(false);
    var d = res.ok ? res.body.data : null;
    if (!d || typeof d.token !== 'string' || !TOKEN_RE.test(d.token))
      return boxError(box, errText(res));
    P.invite = {
      id: d.id,
      role: d.role || picked.value,
      expires_at: d.expires_at,
      link: inviteLink(location.origin, d.token),
    };
    await refresh('', '');
  }

  async function copyInvite(box) {
    var out = box.querySelector('[data-copy]');
    var field = $('mePartnerLink');
    var link = P.invite ? P.invite.link : '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      if (out) out.textContent = '복사했습니다. 메시지로 보내 주세요.';
    } catch {
      if (field && field.select) field.select();
      if (out) out.textContent = '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.';
    }
  }

  /** 한 번 더 물은 동작 실행 */
  async function confirmed(key) {
    var res;
    var ok;
    setBusy(true);
    if (key === 'withdraw') {
      res = await call('/partner/apply/withdraw', { method: 'POST' });
      setBusy(false);
      var app = res.ok && res.body.data ? res.body.data.application : null;
      if (app && typeof app === 'object') {
        P.me.application = app;
        P.ask = null;
        P.err = '';
        P.msg = '신청을 거두었습니다.';
        render();
        return;
      }
      return refresh(errText(res));
    }
    var m = /^(remove|revoke):(.+)$/.exec(key);
    if (m && UUID_RE.test(m[2])) {
      var path =
        m[1] === 'remove'
          ? '/partner/members/' + encodeURIComponent(m[2]) + '/remove'
          : '/partner/invites/' + encodeURIComponent(m[2]) + '/revoke';
      res = await call(path, { method: 'POST' });
      setBusy(false);
      if (res.ok && m[1] === 'revoke' && P.invite && P.invite.id === m[2]) P.invite = null;
      ok = m[1] === 'remove' ? '내보냈습니다.' : '초대를 취소했습니다.';
      return res.ok ? refresh('', ok) : refresh(errText(res));
    }
    if (key === 'plan:expert' || key === 'plan:cancel') {
      var next = key === 'plan:expert' ? 'expert' : null;
      res = await call('/partner/plan', { method: 'POST', body: { next_plan: next } });
      setBusy(false);
      ok = next ? '다음 결제일부터 Expert 로 바뀝니다.' : '예약을 취소했습니다.';
      return res.ok ? refresh('', ok) : refresh(errText(res));
    }
    setBusy(false);
    P.ask = null;
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || P.busy || el.disabled) return;
    var act = el.getAttribute('data-act');
    var box = el.closest('.me-pt-form, .me-pt-box, .me-pt-group') || null;
    var toggle = function (name) {
      P.open = P.open === name ? null : name;
      P.ask = null;
      P.msg = '';
      P.err = '';
      render();
      var f = $('mePartner').querySelector('[data-form] input, [data-form] select');
      if (P.open && f && f.focus) f.focus();
    };
    if (act === 'open-expert') return toggle('expert');
    if (act === 'open-agent') return toggle('agent');
    if (act === 'open-upgrade') return toggle('upgrade');
    if (act === 'open-invite') return toggle('invite');
    if (act === 'close') {
      P.open = null;
      return render();
    }
    if (act === 'pay-agent') return startBilling('agent', { plan: 'agent' }, box);
    if (act === 'make-invite') return makeInvite(box);
    if (act === 'copy-invite') return copyInvite(box);
    if (act === 'no') {
      P.ask = null;
      return render();
    }
    if (act === 'yes') return P.ask ? confirmed(P.ask) : null;
    var id = el.getAttribute('data-id') || '';
    var ask = {
      'ask-withdraw': 'withdraw',
      'ask-remove': 'remove:' + id,
      'ask-revoke': 'revoke:' + id,
      'ask-plan-expert': 'plan:expert',
      'ask-plan-cancel': 'plan:cancel',
    }[act];
    if (ask) {
      P.ask = ask;
      P.msg = '';
      P.err = '';
      render();
    }
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    var kind = form.getAttribute('data-form');
    if (!kind) return;
    e.preventDefault();
    if (P.busy) return;
    if (kind === 'expert') return submitExpert(form);
    if (kind === 'apply') return submitApply(form);
  }

  function onChange(e) {
    var el = e.target;
    if (el && el.name === 'sido' && el.closest) {
      var form = el.closest('[data-form]');
      if (form) fillGugun(form);
    }
  }

  function bind() {
    var root = $('mePartner');
    if (!root || root.getAttribute('data-bound')) return;
    root.setAttribute('data-bound', '1');
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
  }

  /** 카드 등록이 끝나지 않고 돌아왔다 (me.html?failed=1) — 안내를 두고 주소에서 뗀다 */
  function takeFailed() {
    if (!/[?&]failed=1(?:&|$)/.test(location.search)) return false;
    clearSignup();
    try {
      history.replaceState(null, '', location.pathname + '#partner');
    } catch {
      /* noop */
    }
    return true;
  }

  function scrollIfAsked(force) {
    var section = $('partner');
    if (!section || section.hidden || P.scrolled) return;
    if (!force && location.hash !== '#partner') return;
    P.scrolled = true;
    if (section.scrollIntoView) section.scrollIntoView({ block: 'start' });
  }

  /** 로그인 안내의 로그인 단추 — me.html#partner 로 왔으면 돌아올 곳에 #partner 를 붙인다 */
  function keepHashOnGate() {
    if (location.hash !== '#partner') return;
    var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    if (a)
      a.setAttribute(
        'href',
        '../login.html?redirect=' + encodeURIComponent('segan/me.html#partner')
      );
  }

  /**
   * 업체 칸 채우기 — me.js 가 로그인 뒤 부른다. wallet 은 me.js 와 함께 쓰는 my_credit_wallet 약속
   */
  async function load(sb, session, wallet) {
    var section = $('partner');
    if (!section) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    P.base = (cfg.accountApi && cfg.accountApi.url) || '';
    P.pay = (cfg.paymentsApi && cfg.paymentsApi.url) || '';
    P.sb = sb;
    P.session = session;
    if (!P.base || !session) return;
    var failed = takeFailed();
    try {
      P.me = await fetchMe();
      if (viewOf(P.me) === 'hidden') {
        section.hidden = true;
        return;
      }
      var got = await Promise.all([
        loadPlans(),
        loadCredits(sb),
        Promise.resolve(wallet).catch(function () {
          return null;
        }),
      ]);
      P.plans = got[0];
      P.credits = got[1] || {};
      P.wallet = got[2] || null;
      if (failed) P.err = FAILED_MSG;
      bind();
      render();
      scrollIfAsked(failed);
    } catch {
      section.hidden = true;
    }
  }

  window.SeganPartner = {
    SIGNUP_KEY: SIGNUP_KEY,
    RETURN_TO: RETURN_TO,
    PLAN_LABEL: PLAN_LABEL,
    ROLE_LABEL: ROLE_LABEL,
    COMPANY_STATUS: COMPANY_STATUS,
    APPLY_FIELDS: APPLY_FIELDS,
    state: P,
    viewOf: viewOf,
    applyBody: applyBody,
    expertCompany: expertCompany,
    inviteLink: inviteLink,
    openInvites: openInvites,
    kstTime: kstTime,
    keepHashOnGate: keepHashOnGate,
    load: load,
  };
})();
