/* ============================================================
   segan/billing.js — 「구독 관리」 화면 (segan/billing.html — 내 정보 › 크레딧 · 구독 › 구독 관리)

   사이트 billing.html 을 그대로 옮겼다. 새 규칙을 만들지 않는다 — 같은 호출 · 같은 글 · 같은 단추:
     읽기      profiles.tier · tier_source, RPC my_credit_wallet (업체 구성원이면 업체 통장), credit_costs,
               payments-api GET /subscription (협력업체 구성원이면 company · role 도 온다), payment_history 최근 12줄
     지금 다시 결제  POST /subscription/retry (결제 실패 · 재시도 중일 때만)
     카드 바꾸기     토스 requestBillingAuth('CARD') → 돌아오면 POST /subscription/card { auth_key, customer_key }
     구독 해지      POST /cancel { reason: 'user_request' } — 한 번 더 묻는다 (사이트는 confirm 창, 앱은 확인 칸)
     업체 결제하고 시작 · 다시 결제  토스 requestBillingAuth('CARD') → billing-success.html?plan=<업체 등급>
               (사이트 결제 완료 화면 그대로). 떠나기 전에 sessionStorage partnerSignup = { plan, returnTo }
               — billing-success.html 의 「돌아가기」가 이 화면으로 온다
   토스가 돌아오는 곳은 이 화면이다: ?card=ok|fail (카드 바꾸기) · ?pay=fail (업체 결제 카드 등록 실패).
   돌아온 값은 주소창에서 바로 지운다 — 새로 고침으로 같은 authKey 를 다시 보내지 않게.
   등급 올리기 · 등급 변경 · 다시 구독하기는 사이트와 같은 요금제 화면(pricing.html)으로 간다.
   로그인 · 탭 · 로그인 안내는 segan/shell.js (data-tab="me"), 로그인 안내의 돌아올 곳만 이 화면으로 바꾼다.
   ============================================================ */
/* global window, document, location, history, fetch, sessionStorage, URLSearchParams */
(function () {
  'use strict';

  var LOGIN_PAGE = '../login.html';
  var SELF = 'segan/billing.html';
  var SELF_PATH = '/segan/billing.html'; // 토스 · 결제 완료 화면이 돌아오는 곳
  var PRICING = '../pricing.html'; // 사이트 billing.html 의 요금제 화면 (같은 곳)
  var SUCCESS_PATH = '/billing-success.html?plan='; // 업체 첫 결제 · 다시 결제 — 사이트 결제 완료 화면
  var SIGNUP_KEY = 'partnerSignup'; // billing-success.html 이 읽는다

  var STATUS_KO = {
    active: '이용 중',
    cancelled: '해지 예약됨',
    past_due: '결제 실패 · 재시도 중',
    expired: '종료됨',
  }; // billing.html
  var PLAN_KO = { expert: 'Expert', agent: 'Agent', standard: 'Standard' };
  var COMPANY_STATUS_KO = {
    active: '이용 중',
    suspended: '결제가 멈춰 읽기만 됩니다',
    closed: '해지된 업체',
  };
  var HIST_KO = { failed: '결제 실패', refunded: '환불', pending: '처리 중' };
  var ASK = {
    pastDue: '구독을 해지할까요? 더 이상 결제를 시도하지 않습니다.',
    active: '구독을 해지할까요? 이미 결제한 기간까지는 그대로 이용하실 수 있습니다.',
  };

  var B = {
    sb: null,
    session: null,
    api: '',
    cost: null,
    sub: null,
    company: null,
    flash: null, // { text, kind } — 다음 그리기 때 안내 위에 붙는다
    pendingCard: null, // 토스 카드 등록에서 돌아온 { auth_key, customer_key }
    clientKey: null,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  /** 날짜 — billing.html 과 같은 ko-KR 날짜, 없으면 「-」 */
  function day(d) {
    return d ? new Date(d).toLocaleDateString('ko-KR') : '-';
  }

  function row(k, v) {
    return (
      '<li><span class="sg-row">' +
      esc(k) +
      '<span class="me-val">' +
      esc(v) +
      '</span></span></li>'
    );
  }

  function say(msg, kind) {
    var el = $('blStatus');
    el.textContent = msg || '';
    el.className = 'bl-status' + (kind ? ' ' + kind : '');
    el.hidden = !msg;
  }

  function planName(p) {
    return PLAN_KO[p] || (p ? String(p).toUpperCase() : '-');
  }

  /** 해지된 구독은 등급을 내린 뒤 ended_at 이 찍힌다 — 그 전이면 「해지 예약됨」, 뒤면 「종료됨」 */
  function statusLabel(sub) {
    if (sub.status === 'cancelled' && sub.ended_at) return '종료됨';
    return STATUS_KO[sub.status] || sub.status;
  }

  /**
   * 결제 실패 · 해지 안내 — billing.html notice 와 같은 글.
   * 규칙은 payments-api(src/lifecycle.js): 재시도 = 첫 실패 1일 뒤 · 3일 뒤, 마지막도 실패하면 해지 +
   * Standard (결제로 받은 등급만), 업체 구독은 마지막도 실패하면 업체가 정지된다.
   */
  function notice(sub, tier, company) {
    if (sub.status === 'past_due') {
      return {
        kind: 'err',
        text:
          '정기 결제에 실패했습니다. ' +
          day(sub.next_charge_at) +
          '에 다시 결제를 시도합니다. 카드 한도·잔액을 확인해 주세요.\n' +
          '재시도는 첫 실패 후 1일·3일 뒤 두 번이며, 마지막 재시도도 실패하면 구독이 해지되고 ' +
          (company ? '업체가 정지되어 연출컷을 만들 수 없습니다.' : '등급이 Standard 로 바뀝니다.'),
      };
    }
    if (sub.status === 'cancelled' && sub.cancel_reason === 'payment_failed') {
      if (company) {
        return {
          kind: 'err',
          text:
            '정기 결제가 계속 실패해 ' +
            day(sub.cancel_at) +
            '에 구독이 해지되었습니다.' +
            (company.status === 'suspended' ? ' 업체가 정지되어 읽기만 됩니다.' : '') +
            ' 다시 시작하시려면 아래 「다시 결제」를 눌러 주세요.',
        };
      }
      return {
        kind: 'err',
        text:
          '정기 결제가 계속 실패해 ' +
          day(sub.cancel_at) +
          '에 구독이 해지되었습니다.' +
          (sub.ended_at && tier === 'standard' ? ' 등급이 Standard 로 바뀌었습니다.' : '') +
          ' 다시 구독하시려면 아래 버튼을 눌러 주세요.',
      };
    }
    if (sub.status === 'cancelled' && sub.cancel_reason === 'refunded') {
      return {
        kind: '',
        text: '결제가 환불되어 ' + day(sub.cancel_at) + '에 구독이 종료되었습니다.',
      };
    }
    return null;
  }

  // ── 단추 ───────────────────────────────────────────────
  function button(id, label, cls) {
    return (
      '<button type="button" class="mk-btn' +
      (cls ? ' ' + cls : '') +
      '" id="' +
      id +
      '">' +
      esc(label) +
      '</button>'
    );
  }

  function link(href, label, cls) {
    return (
      '<a class="mk-btn' +
      (cls ? ' ' + cls : '') +
      '" href="' +
      esc(href) +
      '">' +
      esc(label) +
      '</a>'
    );
  }

  function setActions(html) {
    $('blActions').innerHTML = html;
    var bind = function (id, fn) {
      if ($(id)) $(id).onclick = fn;
    };
    bind('blPayBtn', payCompany);
    bind('blRetryBtn', retryNow);
    bind('blCardBtn', changeCard);
    bind('blCancelBtn', askCancel);
  }

  // ── 그리기 ─────────────────────────────────────────────
  function renderPlan(sub, tier, tierSource, credits, company, role) {
    var rows = '';
    if (company) {
      rows += row('업체', company.name || '-');
      rows += row('업체 등급', planName(company.plan));
      if (company.next_plan) rows += row('다음 결제일부터', planName(company.next_plan));
      rows += row('업체 상태', COMPANY_STATUS_KO[company.status] || company.status || '-');
    } else {
      rows += row('현재 등급', (tier || 'standard').toUpperCase());
    }
    if (credits != null) {
      rows += row(
        company ? '업체 크레딧' : '남은 크레딧',
        credits.toLocaleString('ko-KR') +
          (B.cost > 0 ? ' (생성 ' + Math.floor(credits / B.cost) + '회)' : '')
      );
    }

    // 업체 실장 · 직원 — 구독은 대표가 관리한다
    if (company && role !== 'owner') {
      $('blPlanRows').innerHTML = rows;
      setActions('');
      say('업체 구독은 대표가 관리합니다.');
      return;
    }

    if (!sub || sub.plan === 'free') {
      rows += row('구독', '없음');
      $('blPlanRows').innerHTML = rows;
      if (company) {
        // 업체는 있는데 구독이 없다 (관리자가 만든 업체 등) — 대표가 업체 등급으로 첫 결제를 한다
        setActions(button('blPayBtn', '결제하고 시작', 'mk-btn--solid'));
        if (B.flash) say(B.flash.text, B.flash.kind);
        B.flash = null;
        return;
      }
      setActions(link(PRICING, '등급 올리기', 'mk-btn--solid'));
      if (tierSource === 'manual' && tier !== 'standard') {
        say('현재 등급은 본사 승인으로 부여된 등급입니다. 구독 결제와는 별개로 유지됩니다.');
      }
      return;
    }

    rows += row('구독 상태', statusLabel(sub));
    rows += row('월 결제액', won(sub.amount_krw));
    rows += row('이번 기간', day(sub.current_period_start) + ' ~ ' + day(sub.current_period_end));
    if (sub.status === 'active') {
      rows += row('다음 결제일', day(sub.next_charge_at));
    } else if (sub.status === 'past_due') {
      rows += row('다음 결제 시도', day(sub.next_charge_at));
    } else if (sub.ended_at) {
      rows += row('종료일', day(sub.ended_at));
    } else if (sub.cancel_at) {
      rows += row('이용 종료일', day(sub.cancel_at));
    }
    $('blPlanRows').innerHTML = rows;

    // 방금 한 일(지금 다시 결제 · 카드 바꾸기)의 결과를 상태 안내 위에 붙인다
    var n = notice(sub, tier, company);
    var text = [B.flash && B.flash.text, n && n.text].filter(Boolean).join('\n\n');
    if (text) say(text, (B.flash && B.flash.kind) || (n && n.kind) || '');
    B.flash = null;

    if (sub.status === 'past_due') {
      // 결제 실패로 재시도 중일 때만: 지금 다시 결제 · 카드 바꾸기 · 해지.
      // 여기서 실패해도 예정된 재시도(+1일 · +3일)는 그대로 간다 (payments-api)
      setActions(
        button('blRetryBtn', '지금 다시 결제', 'mk-btn--solid') +
          button('blCardBtn', '카드 바꾸기') +
          button('blCancelBtn', '구독 해지', 'bl-danger')
      );
    } else if (sub.status === 'active') {
      setActions(link(PRICING, '등급 변경') + button('blCancelBtn', '구독 해지', 'bl-danger'));
    } else if (company) {
      // 정지 · 해지된 업체만 다시 결제한다. 업체가 아직 이용 중이면(해지 예약 — 이용 종료일까지) 단추를 두지 않는다
      setActions(
        company.status !== 'active' ? button('blPayBtn', '다시 결제', 'mk-btn--solid') : ''
      );
    } else {
      setActions(link(PRICING, '다시 구독하기', 'mk-btn--solid'));
    }
  }

  function renderHistory(rows) {
    if (!rows || !rows.length) {
      $('blHistory').innerHTML = '<p class="me-empty">결제 내역이 없습니다.</p>';
      return;
    }
    // 실패 · 환불도 같은 표에 남는다 — 결제된 것처럼 보이지 않게 상태를 붙인다
    $('blHistory').innerHTML =
      '<ul class="sg-rows">' +
      rows
        .map(function (h) {
          var tag = HIST_KO[h.status] ? ' · ' + HIST_KO[h.status] : '';
          return row(day(h.created_at) + ' · ' + (h.plan || '') + tag, won(h.amount_krw));
        })
        .join('') +
      '</ul>';
  }

  // ── 하는 일 ────────────────────────────────────────────
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + B.session.access_token,
    };
  }

  function setBusy(on) {
    ['blRetryBtn', 'blCardBtn', 'blCancelBtn'].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = on;
    });
  }

  /** 결제 응답 → 안내 종류. 202(결과 확인 중)는 오류로 칠하지 않는다 */
  function chargeKind(res, body) {
    var charge = body && body.data && body.data.charge;
    if (!res.ok) return 'err';
    if (charge && (charge.result === 'declined' || charge.result === 'merchant')) return 'err';
    return '';
  }

  async function retryNow() {
    setBusy(true);
    say('결제하는 중입니다…');
    try {
      var res = await fetch(B.api + '/subscription/retry', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      var body = await res.json().catch(function () {
        return {};
      });
      var kind = res.status === 202 ? '' : chargeKind(res, body);
      B.flash = {
        text: (body && body.message) || (res.ok ? '결제했습니다.' : '결제하지 못했습니다.'),
        kind: kind,
      };
    } catch {
      B.flash = { text: '결제 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.', kind: 'err' };
    }
    await load();
  }

  async function tossClientKey() {
    if (B.clientKey) return B.clientKey;
    var res = await fetch(B.api + '/plans');
    var body = await res.json();
    B.clientKey = (body && body.data && body.data.client_key) || null;
    return B.clientKey;
  }

  async function changeCard() {
    setBusy(true);
    say('카드 등록 창을 여는 중입니다…');
    try {
      var ck = await tossClientKey();
      if (!ck || !window.TossPayments)
        throw new Error('결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      // 등록이 끝나면 토스가 successUrl 에 authKey · customerKey 를 붙여 이 화면으로 돌려보낸다
      await window.TossPayments(ck).requestBillingAuth('CARD', {
        customerKey: 'dadam-' + B.session.user.id,
        successUrl: location.origin + SELF_PATH + '?card=ok',
        failUrl: location.origin + SELF_PATH + '?card=fail',
      });
    } catch (err) {
      setBusy(false);
      // 고객이 창을 닫은 경우 — 오류로 소란 떨지 않는다
      if (err && err.code === 'USER_CANCEL') {
        await load();
        return;
      }
      say('카드 등록 창을 열지 못했습니다. ' + (err && err.message ? err.message : ''), 'err');
    }
  }

  /**
   * 업체 첫 결제 · 다시 결제 — 기존 업체로 결제한다 (업체를 새로 만들지 않는다, 등급 = 업체 등급).
   * billing-success.html 이 partnerSignup 의 plan 을 /issue-billing-key 에 보내고, returnTo 로 「돌아가기」를 단다.
   */
  async function payCompany() {
    if (!B.company) return;
    var btn = $('blPayBtn');
    if (btn) btn.disabled = true;
    say('카드 등록 창을 여는 중입니다…');
    try {
      var ck = await tossClientKey();
      if (!ck || !window.TossPayments)
        throw new Error('결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      try {
        sessionStorage.setItem(
          SIGNUP_KEY,
          JSON.stringify({ plan: B.company.plan, returnTo: SELF_PATH })
        );
      } catch {
        /* 저장을 못 해도 successUrl 의 plan 으로 결제한다 */
      }
      await window.TossPayments(ck).requestBillingAuth('CARD', {
        customerKey: 'dadam-' + B.session.user.id,
        successUrl: location.origin + SUCCESS_PATH + encodeURIComponent(B.company.plan),
        failUrl: location.origin + SELF_PATH + '?pay=fail',
      });
    } catch (err) {
      if (btn) btn.disabled = false;
      // 고객이 창을 닫은 경우 — 오류로 소란 떨지 않는다
      if (err && err.code === 'USER_CANCEL') {
        say('');
        return;
      }
      say('카드 등록 창을 열지 못했습니다. ' + (err && err.message ? err.message : ''), 'err');
    }
  }

  async function submitCard(pc) {
    say('새 카드를 등록하는 중입니다…');
    try {
      var res = await fetch(B.api + '/subscription/card', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(pc),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      B.flash = {
        text:
          (body && body.message) || (res.ok ? '카드를 바꿨습니다.' : '카드를 바꾸지 못했습니다.'),
        kind: chargeKind(res, body),
      };
    } catch {
      B.flash = {
        text: '카드 변경 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
        kind: 'err',
      };
    }
  }

  /** 토스 카드 등록에서 돌아왔는가 — 주소창에서는 바로 지운다 (같은 authKey 를 다시 보내지 않게) */
  function readCardReturn() {
    var q = new URLSearchParams(location.search);
    var card = q.get('card');
    var clear = function () {
      try {
        history.replaceState(null, '', location.pathname);
      } catch {
        /* 주소를 못 지워도 진행한다 */
      }
    };
    // 업체 다시 결제(payCompany)의 카드 등록이 실패해 돌아온 경우
    if (q.get('pay') === 'fail') {
      clear();
      try {
        sessionStorage.removeItem(SIGNUP_KEY);
      } catch {
        /* 다음 결제가 새 값으로 덮는다 */
      }
      if (q.get('code') !== 'USER_CANCEL') {
        B.flash = { text: '카드를 등록하지 못했습니다. ' + (q.get('message') || ''), kind: 'err' };
      }
      return;
    }
    if (!card) return;
    clear();
    if (card === 'ok' && q.get('authKey') && q.get('customerKey')) {
      B.pendingCard = { auth_key: q.get('authKey'), customer_key: q.get('customerKey') };
    } else if (card === 'fail' && q.get('code') !== 'USER_CANCEL') {
      B.flash = { text: '카드를 바꾸지 못했습니다. ' + (q.get('message') || ''), kind: 'err' };
    }
  }

  /** 구독 해지 — 한 번 더 묻는다 (사이트 billing.html 의 confirm 과 같은 글) */
  function askCancel() {
    var pastDue = B.sub && B.sub.status === 'past_due';
    $('blAskText').textContent = pastDue ? ASK.pastDue : ASK.active;
    $('blAsk').hidden = false;
    $('blActions').hidden = true;
  }

  function closeAsk() {
    $('blAsk').hidden = true;
    $('blActions').hidden = false;
  }

  async function cancel() {
    var yes = $('blAskYes');
    yes.disabled = true;
    say('해지 처리 중…');
    try {
      var res = await fetch(B.api + '/cancel', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reason: 'user_request' }),
      });
      var body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || '해지에 실패했습니다.');
      yes.disabled = false;
      closeAsk();
      say(
        body.data && body.data.past_due
          ? '해지되었습니다. 더 이상 결제를 시도하지 않습니다.'
          : '해지되었습니다. ' +
              day(body.data && body.data.cancel_at) +
              ' 까지 이용하실 수 있습니다.'
      );
      await load();
    } catch (e) {
      yes.disabled = false;
      say((e && e.message) || '해지에 실패했습니다.', 'err');
    }
  }

  // ── 읽기 ───────────────────────────────────────────────
  /** 읽고 그린다 — 안내 칸은 지우지 않는다 (방금 한 일의 안내가 남는다 — billing.html 과 같다) */
  async function load() {
    if (!B.sb || !B.api) {
      say('서비스에 연결할 수 없습니다.', 'err');
      return;
    }
    var s = await B.sb.auth.getSession();
    B.session = s && s.data ? s.data.session : null;
    if (!B.session) {
      location.assign(LOGIN_PAGE + '?redirect=' + encodeURIComponent(SELF));
      return;
    }

    if (B.pendingCard) {
      var pc = B.pendingCard;
      B.pendingCard = null;
      await submitCard(pc);
    }

    var tier = 'standard';
    var tierSource = 'manual';
    var credits = null;
    try {
      var prof = await B.sb
        .from('profiles')
        .select('tier, tier_source')
        .eq('id', B.session.user.id)
        .maybeSingle();
      if (prof.data) {
        tier = prof.data.tier || 'standard';
        tierSource = prof.data.tier_source || 'manual';
      }
      // 지금 쓰는 통장 — 협력업체 구성원은 업체 통장, 아니면 내 통장 (my_credit_wallet)
      var w = await B.sb.rpc('my_credit_wallet');
      var wallet = w && Array.isArray(w.data) ? w.data[0] : null;
      if (wallet && typeof wallet.balance === 'number') credits = wallet.balance;
      var cc = await B.sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      if (cc.data) B.cost = cc.data.credits;
    } catch {
      /* 등급 · 크레딧을 못 읽으면 기본값으로 그린다 (billing.html 과 같다) */
    }

    var sub = null;
    var company = null;
    var role = null;
    try {
      var res = await fetch(B.api + '/subscription', {
        headers: { Authorization: 'Bearer ' + B.session.access_token },
      });
      var body = await res.json();
      sub = body && body.data ? body.data : null;
      // 협력업체 대표 = 업체 구독 + company (role 이 없으면 대표), 실장 · 직원 = data null + company + role
      company = body && body.company ? body.company : null;
      role = company ? body.role || 'owner' : null;
    } catch {
      /* 구독을 못 읽으면 없는 것으로 그린다 (billing.html 과 같다) */
    }
    B.sub = sub;
    B.company = company;
    renderPlan(sub, tier, tierSource, credits, company, role);

    try {
      var h = await B.sb
        .from('payment_history')
        .select('created_at, plan, amount_krw, status')
        .order('created_at', { ascending: false })
        .limit(12);
      renderHistory(h.data);
    } catch {
      $('blHistory').innerHTML = '<p class="me-empty">결제 내역을 불러오지 못했습니다.</p>';
    }
  }

  // ── 시작 ───────────────────────────────────────────────
  function start(auth) {
    if (!$('blPlanRows')) return;
    if (!auth || !auth.session || !auth.sb) {
      // 로그인 안내 — 로그인한 뒤 이 화면으로 돌아온다
      var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
      if (a) a.setAttribute('href', LOGIN_PAGE + '?redirect=' + encodeURIComponent(SELF));
      return;
    }
    var cfg = window.DADAM_CONFIG || {};
    B.api = (cfg.paymentsApi && cfg.paymentsApi.url) || '';
    B.sb = auth.sb;
    B.session = auth.session;
    $('blAskYes').onclick = cancel;
    $('blAskNo').onclick = closeAsk;
    readCardReturn();
    return load();
  }

  var api = {
    STATUS_KO: STATUS_KO,
    PLAN_KO: PLAN_KO,
    COMPANY_STATUS_KO: COMPANY_STATUS_KO,
    state: B,
    notice: notice,
    statusLabel: statusLabel,
  };
  window.SeganBilling = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
