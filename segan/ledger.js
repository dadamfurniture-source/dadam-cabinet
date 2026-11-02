/* ============================================================
   segan/ledger.js — 업체 회계장부 (segan/ledger.html)

   누가 보나  workflow-api GET /ledger/me 가 답하는 사람 — 업체 구성원 + 업체 자격(Agent · 시험 업체).
             대표 · 실장(money)만 장부를 본다. 직원은 사진 올리기와 자기가 올린 사진의 상태만 (can_upload),
             올릴 수 없으면 「대표 · 실장만 봅니다」 안내만.
             자격 read(등급이 내려감)는 보기만 — 입력 · 고치기 · 취소 · 설정 저장 · 사진 올리기를 감춘다.
   데이터    GET /ledger/me · /ledger/accounts · /ledger/book?month=&include_void=1
             PUT /ledger/settings { vat_type, business_kind }
             POST /ledger/entries (X-Idempotency-Key — 입력 칸을 열 때마다 새 키, 다시 눌러도 한 줄)
             POST /ledger/entries/:id/void { reason } · /ledger/entries/:id/correct { reason, 바뀐 칸 }
             POST /ledger/documents 사진 바이트 (X-Idempotency-Key 사진마다 하나 · 메모는 X-Ledger-Note 머리)
             GET  /ledger/documents?limit=&before= — 대표 · 실장은 업체 사진 전부, 직원은 자기 것만 (서버가 가린다)
   사진      찍기(capture) · 앨범(여러 장). 캔버스로 다시 그려 JPEG 로 — 위치 같은 EXIF 가 빠지고, 긴 변 2576px ·
             375만 화소 이하로 줄인다 (워커 checks.js 와 같은 한도). 이 기기에서 못 여는 사진(HEIC 등)은 안내만 하고
             올리지 않는다. 한 장씩 차례로 올리고, 429(분 · 하루 한도)면 남은 사진은 멈춰 두었다가 「다시 올리기」.
             형식 · 크기로 거절된 사진(413 · 422)은 다시 올리지 않는다.
   보이는 것  늘 「종이 원본 5년 보관」 안내 · 과세 설정 · 달 바꾸기 · 달 요약(수입 · 비용 · 장부 손익 · 부가세)
             · 장부 줄 (직접 입력 · 수금 · 수주 원가 — 받은 날 · 낸 날 기준). 수금 · 원가 줄은 PC ERP 에서 고친다.
             취소한 줄은 「취소한 줄도 보기」를 켜야 보인다 (지우지 않는다).
   못 읽으면  /ledger/me 403 → 이유 한 줄 (구성원 아님 · 자격 없음 · 대표 · 실장 아님), 그 밖 → 「불러오지 못했습니다」
   여러 장부  /ledger/me 의 ledgers 가 둘 이상이면(다담 본사 대표 · 실장 — 본사 · 공장) 장부 고르기.
             남의 장부(viewing)는 보기 주소에 ?company= 를 붙이고 보기만 한다. 쓰기는 언제나 자기 업체
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
  // 사진 — 워커 src/ledger/checks.js PHOTO_MAX_* 와 같다
  var PHOTO_MAX_EDGE = 2576;
  var PHOTO_MAX_PIXELS = 3750000;
  var PHOTO_MAX_BYTES = 5242880;
  var JPEG_QUALITY = 0.85;
  var DOCS_PAGE = 20;
  // 대표 · 실장이 보는 상태 (워커 documents.js REVIEW_STATUSES)
  var DOC_STATUS = {
    pending: '확인 기다림',
    posted: '장부에 올림',
    returned: '돌려보냄',
    rejected: '쓰지 않음',
    skipped_budget: '한도로 못 읽음',
  };
  // 직원이 보는 상태 (워커 documents.js staffStatus — 확인 전은 모두 「올림」)
  var STAFF_STATUS = {
    uploaded: '올림',
    posted: '확인됨',
    returned: '돌려보냄',
    rejected: '쓰지 않음',
  };
  var HEIC_MSG =
    '이 브라우저에서 HEIC 사진을 열지 못했습니다. 아이폰은 설정 › 카메라 › 포맷 › 「높은 호환성」으로 찍으면 됩니다.';
  var OPEN_FAIL_MSG = '이 사진을 열지 못했습니다. JPEG · PNG 사진을 골라 주세요.';

  var L = {
    sb: null,
    session: null,
    base: '',
    me: null, // GET /ledger/me data
    company: '', // 보는 남의 장부 업체 id (비면 자기 업체)
    accounts: [], // [{ code, name, grp, note }]
    month: '',
    data: null, // GET /ledger/book data
    showVoid: false,
    form: null, // { mode: 'create' | 'correct', row, key }
    voiding: '', // 취소 이유를 적는 줄 id
    busy: false,
    docs: [], // GET /ledger/documents items (새것부터)
    docsMore: false,
    up: [], // 올릴 사진 [{ name, file, blob, key, note, status: wait|prep|send|done|same|fail, msg, final }]
    uploading: false,
    upAt: 0, // 올리는 사진 차례 (L.up 안)
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

  /** 올릴 크기 — 긴 변 2576px · 375만 화소 이하, 키우지 않는다 */
  function fitSize(width, height) {
    var s = Math.min(
      1,
      PHOTO_MAX_EDGE / Math.max(width, height),
      Math.sqrt(PHOTO_MAX_PIXELS / (width * height))
    );
    return {
      width: Math.max(1, Math.floor(width * s)),
      height: Math.max(1, Math.floor(height * s)),
    };
  }

  function isHeic(file) {
    var t = String((file && file.type) || '').toLowerCase();
    var n = String((file && file.name) || '').toLowerCase();
    return /hei[cf]/.test(t) || /\.hei[cf]$/.test(n);
  }

  /** 시각 → 한국 시간 'MM.DD HH:mm' */
  function stamp(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return (
      pad(k.getUTCMonth() + 1) +
      '.' +
      pad(k.getUTCDate()) +
      ' ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
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

  /** → { ok, status, data, code, message } (끊김은 status 0). o.raw 는 바이트(Blob) 본문, o.note 는 X-Ledger-Note */
  async function api(path, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (o.raw !== undefined) headers['Content-Type'] = o.raw.type || 'application/octet-stream';
    else if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.key) headers['X-Idempotency-Key'] = o.key;
    if (o.note) headers['X-Ledger-Note'] = encodeURIComponent(o.note);
    try {
      var res = await fetch(L.base + path, {
        method: o.method || 'GET',
        headers: headers,
        body:
          o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body),
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

  /** 보기 주소 — 남의 장부를 볼 때 ?company= */
  function withCompany(path) {
    if (!L.company) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'company=' + encodeURIComponent(L.company);
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
    $('lgReadonly').textContent =
      L.me && L.me.viewing
        ? (ledgerName(L.me.company_id) || '이') + ' 장부 — 보기만 합니다.'
        : '지금 등급에서는 장부를 보기만 할 수 있습니다.';
  }

  function ledgerName(id) {
    var list = (L.me && L.me.ledgers) || [];
    for (var i = 0; i < list.length; i++) if (list[i].company_id === id) return list[i].name || '';
    return '';
  }

  /** 장부 고르기 — 여는 장부가 둘 이상일 때만 */
  function renderSwitch() {
    var list = ((L.me && L.me.ledgers) || []).filter(function (x) {
      return x && x.company_id;
    });
    $('lgSwitch').hidden = list.length < 2;
    $('lgCompany').innerHTML = list
      .map(function (x) {
        return (
          '<option value="' +
          esc(x.company_id) +
          '">' +
          esc(x.name || x.company_id) +
          (x.own ? '' : ' (보기만)') +
          '</option>'
        );
      })
      .join('');
    $('lgCompany').value = L.me.company_id;
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
    var r = await api(
      withCompany('/ledger/book?month=' + encodeURIComponent(month) + '&include_void=1')
    );
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

  // ── 사진 ───────────────────────────────────────────────
  /** 기기에서 열기 · JPEG 로 다시 그리기 — 시험이 바꿔 낀다 (SeganLedger.media) */
  var media = {
    /** → Promise<{ source, width, height, release() }> — 못 열면 거절 */
    decode: function (file) {
      return new Promise(function (resolve, reject) {
        var url = window.URL.createObjectURL(file);
        var img = new window.Image();
        img.onload = function () {
          resolve({
            source: img,
            width: img.naturalWidth,
            height: img.naturalHeight,
            release: function () {
              window.URL.revokeObjectURL(url);
            },
          });
        };
        img.onerror = function () {
          window.URL.revokeObjectURL(url);
          reject(new Error('decode'));
        };
        img.src = url;
      });
    },
    /** → Promise<Blob | null> — 흰 바탕에 그린 JPEG (EXIF 는 따라오지 않는다) */
    encode: function (source, width, height) {
      return new Promise(function (resolve) {
        var c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        var ctx = c.getContext && c.getContext('2d');
        if (!ctx || !c.toBlob) return resolve(null);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);
        c.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
      });
    },
  };

  /** 사진 하나 → { blob } | { error } */
  async function preparePhoto(file) {
    var img = null;
    try {
      img = await media.decode(file);
    } catch {
      return { error: isHeic(file) ? HEIC_MSG : OPEN_FAIL_MSG };
    }
    try {
      if (!img || !(img.width > 0 && img.height > 0)) return { error: OPEN_FAIL_MSG };
      var size = fitSize(img.width, img.height);
      var blob = await media.encode(img.source, size.width, size.height);
      if (!blob || !blob.size) return { error: '사진을 JPEG로 바꾸지 못했습니다.' };
      if (blob.size > PHOTO_MAX_BYTES) return { error: '사진이 5MB를 넘습니다.' };
      return { blob: blob };
    } catch {
      return { error: '사진을 JPEG로 바꾸지 못했습니다.' };
    } finally {
      if (img && img.release) img.release();
    }
  }

  function canUpload() {
    return !!(L.me && L.me.can_upload);
  }

  function retryable(x) {
    return x.status === 'fail' && !x.final;
  }

  function renderUp() {
    var n = function (s) {
      return L.up.filter(function (x) {
        return x.status === s;
      }).length;
    };
    var text = '';
    if (L.uploading) {
      text = L.upAt + 1 + ' / ' + L.up.length + '장 올리는 중…';
    } else if (L.up.length) {
      text = [
        n('done') ? n('done') + '장 올림' : '',
        n('same') ? n('same') + '장은 이미 올린 사진' : '',
        n('fail') ? n('fail') + '장 못 올림' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    $('lgUpState').textContent = text;
    $('lgUpFail').innerHTML = L.up
      .filter(function (x) {
        return x.status === 'fail';
      })
      .map(function (x) {
        return '<li><b>' + esc(x.name) + '</b> — ' + esc(x.msg) + '</li>';
      })
      .join('');
    $('lgRetry').hidden = L.uploading || !L.up.some(retryable);
    $('lgShoot').disabled = L.uploading;
    $('lgPick').disabled = L.uploading;
  }

  /** 기다리는 사진을 한 장씩 — 다듬고 올린다 */
  async function runQueue() {
    if (L.uploading) return;
    L.uploading = true;
    for (var i = 0; i < L.up.length; i++) {
      var item = L.up[i];
      if (item.status !== 'wait') continue;
      L.upAt = i;
      if (!item.blob) {
        item.status = 'prep';
        renderUp();
        var p = await preparePhoto(item.file);
        item.file = null;
        if (p.error) {
          item.status = 'fail';
          item.msg = p.error;
          item.final = true;
          continue;
        }
        item.blob = p.blob;
      }
      item.status = 'send';
      renderUp();
      var r = await api('/ledger/documents', {
        method: 'POST',
        raw: item.blob,
        key: item.key,
        note: item.note,
      });
      if (r.ok) {
        item.status = r.data && r.data.reused ? 'same' : 'done';
        item.blob = null;
        continue;
      }
      item.status = 'fail';
      item.msg = r.message || (r.status === 0 ? '연결이 끊겼습니다.' : '올리지 못했습니다.');
      // 형식 · 크기로 거절된 사진은 다시 올려도 같다
      item.final = r.status === 413 || r.status === 422;
      if (r.status === 429) {
        // 분 · 하루 한도 — 남은 사진은 멈춰 두고 「다시 올리기」로
        for (var j = i + 1; j < L.up.length; j++) {
          if (L.up[j].status !== 'wait') continue;
          L.up[j].status = 'fail';
          L.up[j].msg = item.msg;
        }
        break;
      }
    }
    L.uploading = false;
    renderUp();
    await loadDocs();
  }

  /** 고른 사진을 줄에 — 멈춰 둔 사진도 함께 다시 올린다. 메모는 그때 칸 값 */
  function addPhotos(files) {
    var list = [].slice.call(files || []);
    if (!list.length || L.uploading || !canUpload()) return;
    var note = $('lgNote').value.trim();
    L.up = L.up
      .filter(retryable)
      .map(function (x) {
        x.status = 'wait';
        x.msg = '';
        return x;
      })
      .concat(
        list.map(function (f) {
          return {
            name: f.name || '사진',
            file: f,
            blob: null,
            key: newKey(),
            note: note,
            status: 'wait',
            msg: '',
            final: false,
          };
        })
      );
    return runQueue();
  }

  function retryUp() {
    if (L.uploading) return;
    L.up = L.up.filter(retryable).map(function (x) {
      x.status = 'wait';
      x.msg = '';
      return x;
    });
    return runQueue();
  }

  function docHtml(d) {
    var money = !!(L.me && L.me.money);
    var status = money ? d.review_status : d.status;
    var label = (money ? DOC_STATUS[status] : STAFF_STATUS[status]) || status;
    var why = money ? d.decision_reason : d.reason;
    var text = [
      money ? d.note : '',
      why && (status === 'returned' || status === 'rejected') ? '이유: ' + why : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      '<li class="lg-doc" data-status="' +
      esc(status) +
      '"><span class="lg-doc-line"><span>' +
      esc(stamp(d.created_at)) +
      '</span><b>' +
      esc(label) +
      '</b></span>' +
      (text ? '<small>' + esc(text) + '</small>' : '') +
      '</li>'
    );
  }

  function renderDocs() {
    $('lgDocs').innerHTML = L.docs.length
      ? L.docs.map(docHtml).join('')
      : '<li class="lg-empty">올린 사진이 없습니다.</li>';
    $('lgDocsMore').hidden = !L.docsMore;
  }

  /** 올린 사진 — 새것부터, 더 보기는 마지막 사진보다 앞선 것 */
  async function loadDocs(more) {
    var last = more && L.docs.length ? L.docs[L.docs.length - 1].created_at : '';
    var r = await api(
      withCompany(
        '/ledger/documents?limit=' + DOCS_PAGE + (last ? '&before=' + encodeURIComponent(last) : '')
      )
    );
    if (!r.ok) {
      $('lgDocs').innerHTML = '<li class="lg-empty">올린 사진을 불러오지 못했습니다.</li>';
      $('lgDocsMore').hidden = true;
      return;
    }
    var got = (r.data && r.data.items) || [];
    L.docs = last ? L.docs.concat(got) : got;
    L.docsMore = got.length === DOCS_PAGE;
    renderDocs();
  }

  function renderPhotosBox() {
    $('lgPhotos').hidden = false;
    $('lgUp').hidden = !canUpload();
    $('lgPhotosNote').textContent =
      L.me && L.me.money
        ? '사진을 읽어 장부 칸을 채우는 기능은 곧 붙습니다. 지금은 사진을 모아 두고, 장부는 직접 입력합니다.'
        : '올린 사진은 대표 · 실장이 확인해 장부에 올립니다. 금액은 대표 · 실장만 봅니다.';
  }

  function bindPhotos() {
    $('lgShoot').addEventListener('click', function () {
      $('lgCamera').click();
    });
    $('lgPick').addEventListener('click', function () {
      $('lgFiles').click();
    });
    ['lgCamera', 'lgFiles'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var files = [].slice.call($(id).files || []);
        $(id).value = ''; // 같은 사진을 다시 고를 수 있게
        addPhotos(files);
      });
    });
    $('lgRetry').addEventListener('click', retryUp);
    $('lgDocsMore').addEventListener('click', function () {
      loadDocs(true);
    });
  }

  async function switchTo(id) {
    if (L.busy || L.uploading || !L.me || id === L.me.company_id) return;
    var own = (
      (L.me.ledgers || []).filter(function (x) {
        return x.own;
      })[0] || {}
    ).company_id;
    var prev = L.company;
    L.company = id === own ? '' : id;
    var me = await api(withCompany('/ledger/me'));
    if (!me.ok || !me.data || !me.data.money) {
      L.company = prev;
      renderSwitch();
      return setState(DENY[me.code] || FAIL_MSG);
    }
    L.me = me.data;
    L.voiding = '';
    closeForm();
    renderTax();
    renderSwitch();
    renderPhotosBox();
    await loadBook(L.month);
    await loadDocs();
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
    $('lgCompany').addEventListener('change', function () {
      switchTo($('lgCompany').value);
    });
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
    if (!L.me.money) {
      // 직원 — 사진 올리기와 자기가 올린 사진의 상태만
      if (!L.me.can_upload) return setState(DENY.not_money);
      $('lgTitle').textContent = '영수증 올리기';
      document.title = '영수증 올리기 · SEGAN';
      bindPhotos();
      renderPhotosBox();
      return loadDocs();
    }
    // 자기 업체 장부가 없는 본사 대표 · 실장 — 서버가 공장 장부(보기만)로 열어 준다
    if (L.me.viewing) L.company = L.me.company_id;
    var acc = await api('/ledger/accounts');
    if (!acc.ok) return setState(FAIL_MSG);
    L.accounts = (acc.data && acc.data.items) || [];
    bind();
    bindPhotos();
    renderTax();
    renderSwitch();
    renderPhotosBox();
    $('lgBody').hidden = false;
    await loadBook(thisMonth());
    await loadDocs();
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
    fitSize: fitSize,
    stamp: stamp,
    media: media,
  };
  window.SeganLedger = exported;
  exported.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
