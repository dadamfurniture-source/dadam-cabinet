/* ============================================================
   segan/ledger.js — 업체 회계장부 (segan/ledger.html)

   누가 보나  workflow-api GET /ledger/me 가 답하는 사람 — 업체 구성원 + 업체 자격(Agent · 시험 업체).
             대표 · 실장(money)만 장부를 본다. 직원은 「대표 · 실장만 봅니다」 안내만.
             자격 read(등급이 내려감)는 보기만 — 입력 · 고치기 · 취소 · 설정 저장을 감춘다.
   데이터    GET /ledger/me · /ledger/accounts · /ledger/book?month=&include_void=1
             PUT /ledger/settings { vat_type, business_kind }
             POST /ledger/entries (X-Idempotency-Key — 입력 칸을 열 때마다 새 키, 다시 눌러도 한 줄)
             POST /ledger/entries/:id/void { reason } · /ledger/entries/:id/correct { reason, 바뀐 칸 }
   보이는 것  늘 「종이 원본 5년 보관」 안내 · 과세 설정 · 달 바꾸기 · 달 요약(수입 · 비용 · 장부 손익 · 부가세)
             · 장부 줄 (직접 입력 · 수금 · 수주 원가 — 받은 날 · 낸 날 기준). 수금 · 원가 줄은 PC ERP 에서 고친다.
             취소한 줄은 「취소한 줄도 보기」를 켜야 보인다 (지우지 않는다).
   못 읽으면  /ledger/me 403 → 이유 한 줄 (구성원 아님 · 자격 없음 · 대표 · 실장 아님), 그 밖 → 「불러오지 못했습니다」
   로그인 · 클라이언트는 segan/shell.js 가 맡는다 (SeganShell.ready 의 sb · session).
   ============================================================ */
/* global window, document, fetch, crypto */
(function () {
  'use strict';

  // 값은 워커 src/ledger/checks.js 와 같다
  var DIRECTION = {
    expense: '비용',
    income: '수입',
    asset_buy: '자산 사기',
    asset_sell: '자산 팔기',
  };
  var GROUPS = {
    income: ['income'],
    expense: ['purchase', 'manufacturing', 'admin'],
    asset_buy: ['asset'],
    asset_sell: ['asset'],
  };
  var EVIDENCE = {
    tax_invoice: '세금계산서',
    invoice: '계산서',
    card: '카드',
    cash_receipt: '현금영수증',
    simple_receipt: '간이영수증',
    statement: '거래명세표',
    other: '기타',
    none: '증빙 없음',
  };
  var METHOD = { transfer: '계좌이체', card: '카드', cash: '현금', other: '기타' };
  var SOURCE = { entry: '직접', payment: '수금', cost: '수주 원가' };
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // segan/books.js 와 같다
  var VAT_TYPE = { general: '일반과세', simplified: '간이과세', exempt: '면세' };
  var BIZ_KIND = { manufacturing: '제조', retail: '도소매' };
  var DENY = {
    not_member: '장부는 업체 구성원만 씁니다.',
    not_entitled: '장부는 Agent 업체가 씁니다.',
    not_money: '장부는 업체 대표 · 실장만 봅니다.',
  };
  var FAIL_MSG = '장부를 불러오지 못했습니다.';
  var MONTH_RE = /^(\d{4})-(\d{2})$/;

  var L = {
    sb: null,
    session: null,
    base: '',
    me: null, // GET /ledger/me data
    accounts: [], // [{ code, name, grp, note }]
    month: '',
    data: null, // GET /ledger/book data
    showVoid: false,
    form: null, // { mode: 'create' | 'correct', row, key }
    voiding: '', // 취소 이유를 적는 줄 id
    busy: false,
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

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 금액 — 값이 없으면 「-」 */
  function money(n) {
    if (n == null || n === '' || !isFinite(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  /** 'YYYY-MM-DD' → 'MM.DD' */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s == null ? '' : s));
    return m ? m[2] + '.' + m[3] : '';
  }

  /** 한국 시간 오늘 'YYYY-MM-DD' */
  function today(now) {
    var k = new Date((now == null ? Date.now() : now) + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate());
  }

  function thisMonth(now) {
    return today(now).slice(0, 7);
  }

  function shiftMonth(month, by) {
    var m = MONTH_RE.exec(month);
    if (!m) return '';
    var t = Number(m[1]) * 12 + Number(m[2]) - 1 + by;
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }

  function monthLabel(month) {
    var m = MONTH_RE.exec(month);
    return m ? m[1] + '년 ' + Number(m[2]) + '월' : '';
  }

  function newKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ── 판정 (순수 — 시험이 직접 부른다) ─────────────────────
  /** 그 구분에 쓰는 계정 */
  function accountsFor(accounts, direction) {
    var groups = GROUPS[direction] || [];
    return (accounts || []).filter(function (a) {
      return a && groups.indexOf(a.grp) >= 0;
    });
  }

  /** 들어온 돈인가 (+) */
  function isIn(direction) {
    return direction === 'income' || direction === 'asset_sell';
  }

  /** 줄 설명 — 수금은 단계 이름, 수주 줄은 수주 번호 */
  function rowText(row) {
    var text =
      row.source === 'payment' ? PAY_STAGE[row.description] || row.description : row.description;
    return [text, row.counterparty_name, row.order_no].filter(Boolean).join(' · ');
  }

  /** 고치기 — 처음 값과 다른 칸만 (장부 보기에 없는 칸 — 결제 수단 · 사업자번호 — 은 적었을 때만) */
  function diffPatch(row, v) {
    var out = {};
    var same = function (a, b) {
      return String(a == null ? '' : a) === String(b == null ? '' : b);
    };
    [
      'entry_date',
      'direction',
      'account',
      'description',
      'counterparty_name',
      'amount',
      'vat_amount',
      'evidence_type',
    ].forEach(function (k) {
      if (!same(row[k], v[k])) out[k] = v[k];
    });
    if (v.payment_method) out.payment_method = v.payment_method;
    if (v.counterparty_biz_no) out.counterparty_biz_no = v.counterparty_biz_no;
    return out;
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = L.sb && (await L.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return L.session ? L.session.access_token : '';
  }

  /** → { ok, status, data, code, message } (끊김은 status 0) */
  async function api(path, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.key) headers['X-Idempotency-Key'] = o.key;
    try {
      var res = await fetch(L.base + path, {
        method: o.method || 'GET',
        headers: headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        cache: 'no-store',
      });
      var b = null;
      try {
        b = await res.json();
      } catch {
        b = null;
      }
      var good = res.ok && b && b.success === true;
      return {
        ok: !!good,
        status: res.status,
        data: good ? b.data : null,
        code: b && b.code ? b.code : '',
        message: b && b.message ? b.message : '',
      };
    } catch {
      return { ok: false, status: 0, data: null, code: '', message: '' };
    }
  }

  function canWrite() {
    return !!(L.me && L.me.can_write);
  }

  // ── 그리기 ─────────────────────────────────────────────
  function setState(text) {
    $('lgState').textContent = text || '';
  }

  function renderTax() {
    var tax = (L.me && L.me.tax) || {};
    $('lgVatType').value = tax.vat_type || '';
    $('lgBizKind').value = tax.business_kind || '';
    $('lgTaxNote').textContent = tax.vat_type
      ? VAT_TYPE[tax.vat_type] + (tax.business_kind ? ' · ' + BIZ_KIND[tax.business_kind] : '')
      : '과세 유형을 정해 주세요. 일반과세 업체만 받은 돈을 공급가 · 부가세로 나눠 보입니다.';
    var w = canWrite();
    $('lgVatType').disabled = !w;
    $('lgBizKind').disabled = !w;
    $('lgTaxSave').hidden = !w;
  }

  function renderSummary() {
    var t = (L.data && L.data.totals) || {};
    var items = [
      ['수입', money(t.income)],
      ['비용', money(t.expense)],
      [
        '장부 손익',
        t.income == null ? '-' : money((Number(t.income) || 0) - (Number(t.expense) || 0)),
      ],
      ['받은 부가세', money(t.income_vat)],
      ['낸 부가세', money(t.expense_vat)],
    ];
    if (Number(t.asset_buy) || Number(t.asset_sell)) {
      items.push(['자산 사기', money(t.asset_buy)], ['자산 팔기', money(t.asset_sell)]);
    }
    $('lgSum').innerHTML = items
      .map(function (x) {
        return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
      })
      .join('');
    var notes = [];
    if (Number(t.vat_unknown) > 0) {
      notes.push(
        '부가세를 모르는 줄 ' +
          t.vat_unknown +
          '개 — 부가세 칸이 생기기 전 원가 줄이거나, 일반과세가 아닌 업체의 수금입니다.'
      );
    }
    if (Number(t.account_unknown) > 0) {
      notes.push('계정이 정해지지 않은 원가 줄 ' + t.account_unknown + '개 (노무 · 외주).');
    }
    $('lgSumNote').textContent = notes.join(' ');
    $('lgSumNote').hidden = !notes.length;
    $('lgMonth').textContent = monthLabel(L.month);
    $('lgNext').disabled = L.busy || L.month >= thisMonth();
    $('lgPrev').disabled = L.busy;
  }

  function accountName(code) {
    for (var i = 0; i < L.accounts.length; i++)
      if (L.accounts[i].code === code) return L.accounts[i].name;
    return code ? code : '계정 미정';
  }

  function itemHtml(row) {
    var voided = !!row.voided_at;
    var sign = isIn(row.direction) ? '+' : '−';
    var vat =
      row.vat_amount == null
        ? '부가세 모름'
        : '부가세 ' + money(row.vat_amount) + (row.vat_computed ? ' (계산값)' : '');
    var meta = [vat, row.evidence_type ? EVIDENCE[row.evidence_type] || row.evidence_type : '']
      .filter(Boolean)
      .join(' · ');
    var acts = '';
    if (row.source === 'entry' && !voided && canWrite()) {
      acts =
        L.voiding === row.id
          ? '<div class="lg-void"><input type="text" maxlength="300" aria-label="취소 이유" placeholder="취소 이유 · 필수" data-void-reason />' +
            '<button type="button" class="mk-btn" data-act="void-ok" data-id="' +
            esc(row.id) +
            '">취소하기</button>' +
            '<button type="button" class="mk-link" data-act="void-no">그만</button></div>'
          : '<div class="lg-item-acts"><button type="button" class="mk-link" data-act="edit" data-id="' +
            esc(row.id) +
            '">고치기</button>' +
            '<button type="button" class="mk-link" data-act="void" data-id="' +
            esc(row.id) +
            '">취소</button></div>';
    }
    return (
      '<li class="lg-item' +
      (voided ? ' lg-item--void' : '') +
      '" data-source="' +
      esc(row.source) +
      '" data-id="' +
      esc(row.id) +
      '">' +
      '<span class="lg-line"><span class="lg-main"><b>' +
      esc(accountName(row.account)) +
      '</b>' +
      '<small>' +
      esc(
        [day(row.entry_date), SOURCE[row.source] || row.source, rowText(row)]
          .filter(Boolean)
          .join(' · ')
      ) +
      '</small></span>' +
      '<span class="lg-amt' +
      (isIn(row.direction) ? ' lg-amt--in' : '') +
      '">' +
      sign +
      esc(money(row.amount)) +
      '</span></span>' +
      '<small class="lg-meta">' +
      esc(meta) +
      (voided ? ' · 취소한 줄' : '') +
      '</small>' +
      acts +
      '</li>'
    );
  }

  function renderList() {
    var rows = ((L.data && L.data.rows) || []).filter(function (r) {
      return r && (L.showVoid || !r.voided_at);
    });
    $('lgList').innerHTML = rows.length
      ? rows.map(itemHtml).join('')
      : '<li class="lg-empty">이 달 장부 줄이 없습니다.</li>';
  }

  function render() {
    renderSummary();
    renderList();
    $('lgAdd').hidden = !canWrite();
    $('lgReadonly').hidden = !(L.me && L.me.level === 'read');
  }

  // ── 입력 칸 ────────────────────────────────────────────
  function fillAccounts(direction, selected) {
    var list = accountsFor(L.accounts, direction);
    $('lgAccount').innerHTML = list
      .map(function (a) {
        return (
          '<option value="' +
          esc(a.code) +
          '">' +
          esc(a.name + (a.note ? ' (' + a.note + ')' : '')) +
          '</option>'
        );
      })
      .join('');
    if (
      selected &&
      list.some(function (a) {
        return a.code === selected;
      })
    )
      $('lgAccount').value = selected;
  }

  function fillSelect(id, labels, blank) {
    $(id).innerHTML =
      (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
      Object.keys(labels)
        .map(function (k) {
          return '<option value="' + k + '">' + esc(labels[k]) + '</option>';
        })
        .join('');
  }

  function formError(text) {
    $('lgFormError').textContent = text || '';
    $('lgFormError').hidden = !text;
  }

  function openForm(mode, row) {
    L.form = { mode: mode, row: row || null, key: newKey() };
    var r = row || {};
    $('lgFormTitle').textContent = mode === 'correct' ? '장부 줄 고치기' : '직접 입력';
    $('lgDate').value = r.entry_date || today();
    $('lgDir').value = r.direction || 'expense';
    fillAccounts($('lgDir').value, r.account);
    $('lgDesc').value = r.description || '';
    $('lgCpName').value = r.counterparty_name || '';
    $('lgCpBiz').value = '';
    $('lgAmount').value = r.amount == null ? '' : r.amount;
    $('lgVat').value = r.vat_amount == null ? '' : r.vat_amount;
    $('lgEvidence').value = r.evidence_type || '';
    $('lgMethod').value = '';
    $('lgReason').value = '';
    $('lgReasonRow').hidden = mode !== 'correct';
    formError('');
    $('lgForm').hidden = false;
  }

  function closeForm() {
    L.form = null;
    $('lgForm').hidden = true;
    formError('');
  }

  /** 입력 칸 값 → 보낼 칸 (틀리면 { error }) */
  function formValues() {
    var amount = Number($('lgAmount').value);
    var vatText = $('lgVat').value;
    var vat = vatText === '' ? 0 : Number(vatText);
    if (!$('lgDate').value) return { error: '일자를 적어 주세요.' };
    if (!$('lgAccount').value) return { error: '계정을 골라 주세요.' };
    if (!(Number.isInteger(amount) && amount >= 1))
      return { error: '금액을 1원 이상 정수로 적어 주세요.' };
    if (!(Number.isInteger(vat) && vat >= 0))
      return { error: '부가세는 0 이상 정수로 적어 주세요.' };
    if (!$('lgEvidence').value) return { error: '증빙을 골라 주세요.' };
    return {
      values: {
        entry_date: $('lgDate').value,
        direction: $('lgDir').value,
        account: $('lgAccount').value,
        description: $('lgDesc').value.trim() || null,
        counterparty_name: $('lgCpName').value.trim() || null,
        counterparty_biz_no: $('lgCpBiz').value.trim() || null,
        amount: amount,
        vat_amount: vat,
        evidence_type: $('lgEvidence').value,
        payment_method: $('lgMethod').value || null,
      },
    };
  }

  async function submitForm(e) {
    if (e) e.preventDefault();
    if (!L.form || L.busy) return;
    var got = formValues();
    if (got.error) return formError(got.error);
    var r;
    L.busy = true;
    $('lgSave').disabled = true;
    if (L.form.mode === 'correct') {
      var reason = $('lgReason').value.trim();
      var patch = diffPatch(L.form.row, got.values);
      if (!reason) r = { ok: false, message: '고치는 이유를 적어 주세요.' };
      else if (!Object.keys(patch).length) r = { ok: false, message: '바뀐 칸이 없습니다.' };
      else {
        patch.reason = reason;
        r = await api('/ledger/entries/' + encodeURIComponent(L.form.row.id) + '/correct', {
          method: 'POST',
          body: patch,
        });
      }
    } else {
      r = await api('/ledger/entries', { method: 'POST', body: got.values, key: L.form.key });
    }
    L.busy = false;
    $('lgSave').disabled = false;
    if (!r.ok) return formError(r.message || '저장하지 못했습니다.');
    closeForm();
    await loadBook(L.month);
  }

  // ── 읽기 · 행동 ─────────────────────────────────────────
  async function loadBook(month) {
    L.busy = true;
    renderSummary();
    var r = await api('/ledger/book?month=' + encodeURIComponent(month) + '&include_void=1');
    L.busy = false;
    L.month = month;
    L.data = r.ok ? r.data : { rows: [], totals: {} };
    setState(r.ok ? '' : FAIL_MSG);
    render();
  }

  async function saveTax() {
    var vatType = $('lgVatType').value;
    var bizKind = $('lgBizKind').value;
    if (!vatType || !bizKind) return setState('과세 유형과 업종을 모두 골라 주세요.');
    var r = await api('/ledger/settings', {
      method: 'PUT',
      body: { vat_type: vatType, business_kind: bizKind },
    });
    if (!r.ok) return setState(r.message || '설정을 저장하지 못했습니다.');
    L.me.tax = r.data;
    renderTax();
    setState('과세 설정을 저장했습니다.');
    await loadBook(L.month);
  }

  async function voidRow(id) {
    var input = document.querySelector('[data-void-reason]');
    var reason = input ? input.value.trim() : '';
    if (!reason) return setState('취소 이유를 적어 주세요.');
    var r = await api('/ledger/entries/' + encodeURIComponent(id) + '/void', {
      method: 'POST',
      body: { reason: reason },
    });
    if (!r.ok) return setState(r.message || '취소하지 못했습니다.');
    L.voiding = '';
    setState('그 줄을 취소했습니다. 「취소한 줄도 보기」로 볼 수 있습니다.');
    await loadBook(L.month);
  }

  function rowById(id) {
    var rows = (L.data && L.data.rows) || [];
    for (var i = 0; i < rows.length; i++)
      if (rows[i].id === id && rows[i].source === 'entry') return rows[i];
    return null;
  }

  function onListClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || L.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    if (act === 'edit') {
      var row = rowById(id);
      if (row) openForm('correct', row);
    } else if (act === 'void') {
      L.voiding = id;
      renderList();
    } else if (act === 'void-no') {
      L.voiding = '';
      renderList();
    } else if (act === 'void-ok') {
      return voidRow(id);
    }
  }

  function bind() {
    fillSelect('lgEvidence', EVIDENCE, '고르기');
    fillSelect('lgMethod', METHOD, '고르지 않음');
    $('lgPrev').addEventListener('click', function () {
      if (!L.busy) loadBook(shiftMonth(L.month, -1));
    });
    $('lgNext').addEventListener('click', function () {
      var next = shiftMonth(L.month, 1);
      if (!L.busy && next <= thisMonth()) loadBook(next);
    });
    $('lgShowVoid').addEventListener('change', function () {
      L.showVoid = $('lgShowVoid').checked;
      renderList();
    });
    $('lgAdd').addEventListener('click', function () {
      openForm('create');
    });
    $('lgCancel').addEventListener('click', closeForm);
    $('lgDir').addEventListener('change', function () {
      fillAccounts($('lgDir').value);
    });
    $('lgForm').addEventListener('submit', submitForm);
    $('lgTaxSave').addEventListener('click', saveTax);
    $('lgList').addEventListener('click', onListClick);
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('lgList')) return;
    L.sb = auth.sb;
    L.session = auth.session;
    var cfg = window.DADAM_CONFIG || {};
    L.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!L.base) return setState(FAIL_MSG);
    var me = await api('/ledger/me');
    if (!me.ok) return setState(DENY[me.code] || FAIL_MSG);
    L.me = me.data;
    if (!L.me.money) return setState(DENY.not_money);
    var acc = await api('/ledger/accounts');
    if (!acc.ok) return setState(FAIL_MSG);
    L.accounts = (acc.data && acc.data.items) || [];
    bind();
    renderTax();
    $('lgBody').hidden = false;
    await loadBook(thisMonth());
  }

  var exported = {
    DIRECTION: DIRECTION,
    EVIDENCE: EVIDENCE,
    state: L,
    accountsFor: accountsFor,
    diffPatch: diffPatch,
    rowText: rowText,
    thisMonth: thisMonth,
    shiftMonth: shiftMonth,
  };
  window.SeganLedger = exported;
  exported.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
