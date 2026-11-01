/* ============================================================
   segan/pay.js — 수금 일정 결제 (다담 공장 수주) · 결제 결과 화면 (segan/pay.html)

   어디서     내 정보 › 내 프로젝트의 「다음 결제」 줄 (segan/me.js 가 boxHtml 로 그리고 start 를 부른다)
             결제창이 돌아오면 segan/pay.html (이 파일이 confirm 을 부르고 결과를 그린다)
   서버      payments-api (본인 토큰 · { success, data } · 오류는 { success:false, code, message })
               POST /order-payments/checkout { payment_id } → { order_id, amount, order_name, client_key }
                    409 waiting_deposit → { transaction: { virtual_account } }
               POST /order-payments/confirm  { paymentKey, orderId, amount } → { transaction }
   결제창    토스 결제창 v1 (segan/me.html 이 https://js.tosspayments.com/v1/payment 를 싣는다)
               카드 · 간편결제 = CARD, 가상계좌 = VIRTUAL_ACCOUNT. 돌아올 곳 pay.html (실패면 ?result=fail)
   보이는 것  워커 /me/projects 의 수금 일정 한 줄 { id, payable, online }
               online.status waiting_deposit → 입금 안내 (은행 · 계좌 · 예금주 · 기한)
               online.status check_needed    → 받은 금액 확인 중 안내
               payable                        → 결제 버튼 둘
             협력업체 수주는 payable 이 아니다 (업체가 직접 받는다) — 아무것도 그리지 않는다
   ============================================================ */
/* global window, document, fetch, location, URL, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var METHODS = { card: 'CARD', virtual_account: 'VIRTUAL_ACCOUNT' };
  var STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // segan/me.js PAY_STAGE 와 같다
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  // 토스 은행 코드 → 이름 (가상계좌를 내 주는 은행 · 자주 쓰는 은행). 모르면 코드를 그대로
  var BANK = {
    '02': 'KDB산업은행',
    '03': 'IBK기업은행',
    '06': 'KB국민은행',
    '07': 'Sh수협은행',
    11: 'NH농협은행',
    12: '지역 농 · 축협',
    20: '우리은행',
    23: 'SC제일은행',
    31: 'iM뱅크',
    32: '부산은행',
    34: '광주은행',
    35: '제주은행',
    37: '전북은행',
    39: '경남은행',
    45: '새마을금고',
    48: '신협',
    71: '우체국',
    81: '하나은행',
    88: '신한은행',
    89: '케이뱅크',
    90: '카카오뱅크',
    92: '토스뱅크',
  };
  var TEXT = {
    card: '카드 · 간편결제',
    va: '가상계좌',
    waiting: '가상계좌로 입금해 주세요',
    checking: '받은 금액을 확인하고 있습니다. 확인되면 이 칸이 바뀝니다.',
    module: '결제창을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    failed: '결제를 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
    paid: '결제했습니다',
    payFail: '결제하지 못했습니다',
    noInfo: '결제 정보가 없습니다. 내 정보에서 다시 결제해 주세요.',
    login: '로그인이 끝났습니다. 다시 로그인한 뒤 내 정보에서 확인해 주세요.',
  };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }
  function bankName(code) {
    if (!code) return '';
    var c = String(code);
    return BANK[c] || '은행 코드 ' + c;
  }
  /** ISO 시각 → '11/5(목) 23:59' (한국 시간) */
  function dueText(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    var d = new Date(t + 9 * 3600 * 1000);
    var hh = String(d.getUTCHours()).padStart(2, '0');
    var mm = String(d.getUTCMinutes()).padStart(2, '0');
    return (
      d.getUTCMonth() +
      1 +
      '/' +
      d.getUTCDate() +
      '(' +
      WEEKDAY[d.getUTCDay()] +
      ') ' +
      hh +
      ':' +
      mm
    );
  }

  /** 가상계좌 입금 안내 (dl) */
  function vaHtml(va) {
    if (!va) return '';
    var rows = [
      ['은행', bankName(va.bank)],
      ['계좌', va.account_number || ''],
      ['예금주', va.holder || ''],
      ['기한', va.due_at ? dueText(va.due_at) + '까지' : ''],
    ].filter(function (r) {
      return r[1];
    });
    return (
      '<dl class="pay-va">' +
      rows
        .map(function (r) {
          return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>'
    );
  }

  /** 다음 결제 줄의 결제 칸 — 입금 기다림 · 확인 중 · 결제 버튼 · (그 밖은 빈 글) */
  function boxHtml(pay) {
    if (!pay || pay.paid_on) return '';
    var online = pay.online || null;
    if (online && online.status === 'waiting_deposit') {
      return (
        '<div class="pay-box"><p class="pay-title">' +
        esc(TEXT.waiting) +
        '</p>' +
        vaHtml(online.virtual_account) +
        '</div>'
      );
    }
    if (online && online.status === 'check_needed') {
      return '<div class="pay-box"><p class="mk-note">' + esc(TEXT.checking) + '</p></div>';
    }
    if (!pay.payable || !UUID_RE.test(String(pay.id || ''))) return '';
    var btn = function (method, label, solid) {
      return (
        '<button type="button" class="mk-btn' +
        (solid ? ' mk-btn--solid' : '') +
        '" data-pay-id="' +
        esc(pay.id) +
        '" data-pay-method="' +
        method +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    return (
      '<div class="pay-box pay-acts">' +
      btn('card', TEXT.card, true) +
      btn('virtual_account', TEXT.va, false) +
      '</div>'
    );
  }

  function payBase() {
    var cfg = window.DADAM_CONFIG || {};
    return (cfg.paymentsApi && cfg.paymentsApi.url) || '';
  }

  async function post(path, session, body) {
    var res = await fetch(payBase() + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    var data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return {
      status: res.status,
      ok: res.ok && !!(data && data.success === true),
      body: data || {},
    };
  }

  /** 돌아올 곳 — 이 페이지 옆 pay.html (실패면 ?result=fail) */
  function returnUrls(here) {
    var base = new URL('pay.html', here || location.href);
    var fail = new URL(base.href);
    fail.searchParams.set('result', 'fail');
    return { success: base.href, fail: fail.href };
  }

  /**
   * 결제창 열기. 막히면 그 까닭을 돌려준다 (부르는 쪽이 글로 보인다).
   * @returns {Promise<{ ok: boolean, message?: string, reload?: boolean }>}
   */
  async function start(session, paymentId, method) {
    if (!session || !UUID_RE.test(String(paymentId || '')) || !METHODS[method] || !payBase()) {
      return { ok: false, message: TEXT.failed };
    }
    var r;
    try {
      r = await post('/order-payments/checkout', session, { payment_id: paymentId });
    } catch {
      return { ok: false, message: TEXT.failed };
    }
    if (!r.ok) {
      // 입금 기다림 · 이미 받음 — 칸을 다시 그리면 안내가 나온다
      var reload = r.status === 409;
      return { ok: false, message: r.body.message || TEXT.failed, reload: reload };
    }
    var d = r.body.data || {};
    if (!d.client_key || typeof window.TossPayments !== 'function')
      return { ok: false, message: TEXT.module };
    var urls = returnUrls();
    try {
      await window.TossPayments(d.client_key).requestPayment(METHODS[method], {
        amount: d.amount,
        orderId: d.order_id,
        orderName: d.order_name,
        successUrl: urls.success,
        failUrl: urls.fail,
      });
      return { ok: true };
    } catch (e) {
      // 결제창을 닫으면(USER_CANCEL) 아무 말 없이 그대로
      if (e && e.code === 'USER_CANCEL') return { ok: true };
      return { ok: false, message: (e && e.message) || TEXT.failed };
    }
  }

  // ── 결제 결과 화면 (segan/pay.html) ───────────────────────
  /** 주소 ?paymentKey&orderId&amount (성공) · ?result=fail&code&message (실패) */
  function readResult(search) {
    var q = new URLSearchParams(search || '');
    if (q.get('result') === 'fail')
      return { kind: 'fail', message: q.get('message') || '', code: q.get('code') || '' };
    var amount = Number(q.get('amount'));
    if (q.get('paymentKey') && q.get('orderId') && Number.isInteger(amount) && amount > 0) {
      return {
        kind: 'confirm',
        paymentKey: q.get('paymentKey'),
        orderId: q.get('orderId'),
        amount: amount,
      };
    }
    return { kind: 'none' };
  }

  /** 승인 응답의 결제 한 줄 → 결과 화면 */
  function resultHtml(tx) {
    if (tx && tx.status === 'paid') {
      return (
        '<p class="sg-title">' +
        esc(TEXT.paid) +
        '</p><p class="sg-note">' +
        esc(won(tx.amount_received || tx.amount_requested)) +
        ' 받았습니다. 영수증은 결제사 안내를 확인해 주세요.</p>'
      );
    }
    if (tx && tx.status === 'waiting_deposit') {
      return (
        '<p class="sg-title">' +
        esc(TEXT.waiting) +
        '</p><p class="sg-note">' +
        esc(won(tx.amount_requested)) +
        ' — 입금이 확인되면 내 프로젝트에 받음으로 바뀝니다.</p>' +
        vaHtml(tx.virtual_account)
      );
    }
    if (tx && tx.status === 'check_needed') {
      return (
        '<p class="sg-title">' +
        esc(TEXT.paid) +
        '</p><p class="sg-note">' +
        esc(TEXT.checking) +
        '</p>'
      );
    }
    return (
      '<p class="sg-title">' +
      esc(TEXT.payFail) +
      '</p><p class="sg-note">' +
      esc((tx && tx.status_note) || TEXT.failed) +
      '</p>'
    );
  }

  function show(box, html) {
    box.innerHTML = html;
  }

  async function initPage() {
    var box = document.getElementById('payResult');
    if (!box) return;
    var r = readResult(location.search);
    // 결제 정보는 주소에 남기지 않는다
    if (r.kind !== 'none' && window.history && window.history.replaceState)
      window.history.replaceState(null, '', location.pathname);
    if (r.kind === 'fail') {
      show(
        box,
        '<p class="sg-title">' +
          esc(TEXT.payFail) +
          '</p><p class="sg-note">' +
          esc(r.message || TEXT.failed) +
          '</p>'
      );
      return;
    }
    if (r.kind === 'none') {
      show(box, '<p class="sg-note">' + esc(TEXT.noInfo) + '</p>');
      return;
    }
    var cfg = window.DADAM_CONFIG || {};
    var session = null;
    try {
      var sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      var got = await sb.auth.getSession();
      session = got && got.data && got.data.session;
    } catch {
      session = null;
    }
    if (!session) {
      show(box, '<p class="sg-note">' + esc(TEXT.login) + '</p>');
      return;
    }
    var res;
    try {
      res = await post('/order-payments/confirm', session, {
        paymentKey: r.paymentKey,
        orderId: r.orderId,
        amount: r.amount,
      });
    } catch {
      show(
        box,
        '<p class="sg-title">' +
          esc(TEXT.payFail) +
          '</p><p class="sg-note">' +
          esc(TEXT.failed) +
          '</p>'
      );
      return;
    }
    if (!res.ok) {
      show(
        box,
        '<p class="sg-title">' +
          esc(TEXT.payFail) +
          '</p><p class="sg-note">' +
          esc(res.body.message || TEXT.failed) +
          '</p>'
      );
      return;
    }
    show(box, resultHtml((res.body.data || {}).transaction));
  }

  window.SeganPay = {
    BANK: BANK,
    STAGE: STAGE,
    TEXT: TEXT,
    bankName: bankName,
    dueText: dueText,
    boxHtml: boxHtml,
    returnUrls: returnUrls,
    start: start,
    readResult: readResult,
    resultHtml: resultHtml,
    initPage: initPage,
  };

  if (document.getElementById('payResult')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
    else initPage();
  }
})();
