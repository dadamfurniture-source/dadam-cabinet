/* ============================================================
   segan/ledger-report.js — 인쇄용 월 회계 보고서 (segan/ledger-report.html)

   누가      업체 대표 · 실장 (GET /ledger/me 가 money 가 아니면 이유 한 줄). 본사 대표 · 실장은 ?company= 로 공장 장부
   데이터    GET /ledger/me (업체 이름 — ledgers) · /ledger/dashboard?month=&months=12 · /ledger/accounts ·
             /ledger/receivables · /ledger/payables (장부 서버가 모르면 그 줄은 뺀다)
   보이기    A4 한 장 — 칸 넷(매출 · 매입 · 장부 손익 · 부가세 예상 — 일반과세만, 반기) · 최근 6달 표 · 매입 계정별 ·
             지출 상대 상위 10 · 받을 돈 · 낼 돈 · 남은 할 일 · 월 마감 메모(GET /ledger/close-memo — 2026-11-06 6-L3,
             서버가 센 손볼 곳 그대로, 0 인 것은 뺀다). 숫자는 서버 값 그대로 — 이 화면이 더하는 것은 장부 손익과
             반기 부가세 참고뿐 (SeganLedgerBoard.vatHalf — 회계 한눈에와 같은 셈)
   인쇄      「인쇄 · PDF 저장」 = window.print. 앱 머리 · 아래 탭 · 단추는 인쇄에서 뺀다 (ledger-report.css)
   협력 팩토리 (본사 보기 · report) — 관리 › 팩토리 평가의 「장부 보고서」가 ?company=<팩토리> 로 연다.
             /ledger/me 가 report: true 면 이름은 me.company_name, 돌아가기는 팩토리 평가(그 팩토리를 연 채),
             보고서만 본다는 한 줄. 장부 화면(ledger.html)으로 가는 길은 없다 (서버도 보고서 경로만 연다).
             장부가 없는 팩토리는 /ledger/me 가 no_ledger 로 답한다 → 이유 한 줄
   글은 모두 textContent 로 넣는다.
   ============================================================ */
/* global window, document, fetch, location, URLSearchParams */
(function () {
  'use strict';

  var DENY = {
    not_member: '회계 보고서는 팩토리 구성원만 봅니다.',
    not_entitled: '회계 보고서는 Agent 팩토리가 봅니다.',
    not_money: '회계 보고서는 팩토리 대표 · 실장만 봅니다.',
    no_ledger: '이 팩토리는 아직 장부가 없습니다.',
  };
  /** 협력 팩토리 보고서(report) — 돌아가기 · 한 줄 */
  var EVAL_PAGE = '../admin/partner-eval.html'; // 관리 › 팩토리 평가 (#company= 로 그 팩토리를 연다)
  var EVAL_BACK = '‹ 팩토리 평가';
  var REPORT_NOTE = '다담 본사 보기 — 월 보고서만 봅니다 (장부 줄 · 사진은 열지 않습니다).';
  var FAIL_MSG = '회계 보고서를 불러오지 못했습니다.';
  var NOT_READY_MSG = '회계 보고서를 준비하는 중입니다. 잠시 뒤 다시 열어 주세요.';
  var MONTHS = 12; // 워커 src/ledger/dashboard.js DASH_MONTHS
  var TABLE_MONTHS = 6; // 보고서의 달 표
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var R = {
    sb: null,
    session: null,
    base: '',
    company: '', // 본사 보기 — 주소의 ?company=
    report: false, // 협력 팩토리 보고서만 (GET /ledger/me report: true)
    month: '',
    me: null,
    data: null, // GET /ledger/dashboard data
    names: {}, // 계정 코드 → 이름
    recv: null, // GET /ledger/receivables data (없으면 null)
    pay: null, // GET /ledger/payables data
    memo: null, // GET /ledger/close-memo data (모르면 null — 칸째 감춘다)
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function board() {
    return window.SeganLedgerBoard;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 날짜 'YYYY-MM-DD' */
  function today() {
    var k = new Date(Date.now() + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate());
  }

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function setState(msg) {
    $('lrState').textContent = msg || '';
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = R.sb && (await R.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return R.session ? R.session.access_token : '';
  }

  /** → { ok, status, data, code } (끊김은 status 0) */
  async function api(path) {
    try {
      var res = await fetch(R.base + path, {
        headers: { Authorization: 'Bearer ' + (await token()) },
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
      };
    } catch {
      return { ok: false, status: 0, data: null, code: '' };
    }
  }

  function withCompany(path) {
    if (!R.company) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'company=' + encodeURIComponent(R.company);
  }

  // ── 계산 (순수) ─────────────────────────────────────────
  function monthRow(data, month) {
    var list = (data && data.months) || [];
    for (var i = 0; i < list.length; i++) if (list[i].month === month) return list[i];
    return null;
  }

  /** 보고서 달까지 TABLE_MONTHS 달 (오래된 것부터) */
  function lastMonths(data, month) {
    return ((data && data.months) || [])
      .filter(function (r) {
        return r.month <= month;
      })
      .slice(-TABLE_MONTHS);
  }

  /** 남은 할 일 — 서버 수 그대로 [글, 수] (0 은 뺀다) */
  function todos(data, month) {
    var cur = monthRow(data, month) || {};
    return [
      ['확인 기다리는 사진', Number(data.pending_photos) || 0, '장'],
      ['세금계산서 기다리는 명세표', Number(data.held_statements) || 0, '장'],
      ['증빙 경고', Number(cur.evidence_risk) || 0, '건'],
      ['계정 미정', Number(cur.account_unknown) || 0, '줄'],
      ['부가세 포함 합계로 적힌 원가', Number(cur.vat_unknown) || 0, '줄'],
    ].filter(function (x) {
      return x[1] > 0;
    });
  }

  // ── 그리기 ─────────────────────────────────────────────
  /** 월 마감 메모 — 몇 장 · 몇 건 */
  var MEMO_UNIT = { noevid: '건', simple30k: '건', invoice: '장', photos: '장', late: '건', dup: '건' };
  /** 수금 단계 — 워커 order_payments.stage */
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' };

  /** 'YYYY-MM-DD…' → 'MM.DD' */
  function mmdd(s) {
    var v = String(s || '');
    return v.length >= 10 ? v.slice(5, 7) + '.' + v.slice(8, 10) : '';
  }

  /**
   * 월 마감 메모 줄 (순수) — 서버 items 차례 그대로, 0 인 것은 뺀다 → [{ text, rows: [글] }]
   *   부가세는 일반과세일 때 (받은 − 낸) 를, 부가세 모르는 줄은 늘. 바뀐 계정은 줄이 있을 때.
   */
  function memoLines(memo, names) {
    var out = [];
    ((memo && memo.items) || []).forEach(function (x) {
      if (!x || !x.key) return;
      var n = Number(x.n) || 0;
      if (x.key === 'vat') {
        if (x.counted)
          out.push({ text: '부가세 (받은 − 낸) ' + won(x.amount) + (n ? ' · 부가세 모르는 줄 ' + n + '줄' : ''), rows: [] });
        else if (n) out.push({ text: '부가세 모르는 줄 ' + n + '줄', rows: [] });
        return;
      }
      if (x.key === 'acct') {
        var list = x.rows || [];
        if (!list.length) return;
        out.push({
          text: x.label,
          rows: list.map(function (r) {
            var nm = r.account ? (names && names[r.account]) || r.account : '계정 미정';
            var rate = r.rate == null ? '' : ' · ' + (r.rate >= 0 ? '+' : '') + r.rate + '%';
            return nm + ' ' + won(r.amount) + ' (전달 ' + won(r.prev) + rate + ')';
          }),
        });
        return;
      }
      if (!n) return;
      var money = x.amount != null && x.key !== 'invoice' && x.key !== 'photos' ? ' · ' + won(x.amount) : '';
      out.push({
        text: x.label + ' ' + n + (MEMO_UNIT[x.key] || '건') + money,
        rows: (x.rows || []).map(function (r) {
          if (x.key === 'late')
            return [r.order_no || '-', PAY_STAGE[r.stage] || r.stage || '', r.due_on ? mmdd(r.due_on) + '까지' : '', won(r.amount)]
              .filter(Boolean)
              .join(' · ');
          if (x.key === 'dup') return [mmdd(r.date), r.name || '-'].filter(Boolean).join(' · ');
          return [mmdd(r.date), r.name || '-', won(r.amount)].filter(Boolean).join(' · ');
        }),
      });
    });
    return out;
  }

  function tile(box, label, value, sub) {
    var div = el('div', 'lr-tile');
    div.appendChild(el('dt', '', label));
    var dd = el('dd');
    dd.appendChild(el('b', '', value));
    if (sub) dd.appendChild(el('small', '', sub));
    div.appendChild(dd);
    box.appendChild(div);
  }

  function table(box, head, rows, empty) {
    box.textContent = '';
    var t = el('table', 'lr-tbl');
    var tr = el('tr');
    head.forEach(function (h, i) {
      tr.appendChild(el('th', i ? 'n' : '', h));
    });
    var thead = el('thead');
    thead.appendChild(tr);
    t.appendChild(thead);
    var body = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (c, i) {
        row.appendChild(el('td', i ? 'n' : '', c));
      });
      body.appendChild(row);
    });
    if (!rows.length) {
      var e = el('tr');
      var td = el('td', 'lr-empty', empty);
      td.colSpan = head.length;
      e.appendChild(td);
      body.appendChild(e);
    }
    t.appendChild(body);
    box.appendChild(t);
  }

  function companyName() {
    var me = R.me || {};
    if (R.report) return me.company_name || ''; // 협력 팩토리는 me.ledgers 에 없다
    var list = me.ledgers || [];
    for (var i = 0; i < list.length; i++)
      if (list[i].company_id === me.company_id) return list[i].name || '';
    return '';
  }

  function render() {
    var Bd = board();
    var d = R.data;
    var cur = monthRow(d, R.month) || {};
    var prev = monthRow(d, Bd.shiftMonth(R.month, -1));
    var profit = Number(cur.income || 0) - Number(cur.expense || 0);
    var name = companyName();
    $('lrTitle').textContent = (name ? name + ' · ' : '') + Bd.monthLabel(R.month) + ' 회계 보고';
    $('lrMade').textContent = '만든 날 ' + today() + ' · 받은 돈 · 낸 돈 기준';
    $('lrMonth').textContent = Bd.monthLabel(R.month);
    $('lrNext').disabled = R.busy || R.month >= Bd.shiftMonth(today().slice(0, 7), 0);
    $('lrPrev').disabled = R.busy;

    var tiles = $('lrTiles');
    tiles.textContent = '';
    tile(tiles, '매출 (받은 돈)', won(cur.income), '부가세 ' + won(cur.income_vat) + ' 따로');
    tile(tiles, '매입', won(cur.expense), '공제 부가세 ' + won(cur.expense_vat));
    var diff = prev ? profit - (Number(prev.income || 0) - Number(prev.expense || 0)) : null;
    tile(
      tiles,
      '장부 손익',
      won(profit),
      diff === null ? '매출 − 매입' : '지난달보다 ' + (diff >= 0 ? '+' : '−') + won(Math.abs(diff))
    );
    if (d.vat_type === 'general') {
      var h = Bd.vatHalf(d, R.month);
      tile(tiles, '부가세 예상 (' + h.label + ')', won(h.amount), '매출세액 − 매입세액 · 참고');
    } else {
      tile(
        tiles,
        '부가세 예상',
        '-',
        d.vat_type ? '일반과세 업체만 셉니다' : '과세 유형을 정해 주세요'
      );
    }

    table(
      $('lrMonths'),
      ['달', '매출', '매입', '장부 손익'],
      lastMonths(d, R.month).map(function (r) {
        return [
          Bd.monthLabel(r.month),
          won(r.income),
          won(r.expense),
          won(Number(r.income || 0) - Number(r.expense || 0)),
        ];
      }),
      '장부 줄이 없습니다.'
    );
    table(
      $('lrAccounts'),
      ['계정', '금액', '부가세', '줄'],
      (d.accounts || [])
        .slice()
        .sort(function (a, b) {
          return b.amount - a.amount;
        })
        .map(function (a) {
          var nm = a.account ? R.names[a.account] || a.account : '계정 미정';
          return [
            nm + (a.direction === 'asset_buy' ? ' (자산)' : ''),
            won(a.amount),
            won(a.vat_amount),
            String(a.n || 0),
          ];
        }),
      '이 달 매입이 없습니다.'
    );
    table(
      $('lrSuppliers'),
      ['지출 상대', '금액', '줄'],
      (d.suppliers || []).slice(0, 10).map(function (s) {
        return [s.name || '-', won(s.amount), String(s.n || 0)];
      }),
      '이 달 지출 상대가 없습니다.'
    );

    var money = [];
    if (R.recv)
      money.push([
        '받을 돈',
        won(R.recv.total) +
          ' · ' +
          (R.recv.count || 0) +
          '건' +
          (R.recv.late_count ? ' (늦음 ' + won(R.recv.late_total) + ')' : ''),
      ]);
    if (R.pay)
      money.push([
        '낼 돈',
        won(R.pay.total) +
          ' · ' +
          (R.pay.count || 0) +
          '건' +
          (R.pay.late_count ? ' (늦음 ' + won(R.pay.late_total) + ')' : ''),
      ]);
    $('lrMoneyBox').hidden = !money.length;
    var dl = $('lrMoney');
    dl.textContent = '';
    money.forEach(function (m) {
      dl.appendChild(el('dt', '', m[0]));
      dl.appendChild(el('dd', '', m[1]));
    });

    var ul = $('lrTodo');
    ul.textContent = '';
    var list = todos(d, R.month);
    if (!list.length) ul.appendChild(el('li', '', '남은 할 일이 없습니다.'));
    list.forEach(function (x) {
      ul.appendChild(el('li', '', x[0] + ' ' + x[1] + x[2]));
    });

    // 월 마감 메모 — 서버가 모르면(0034 전 · 오류) 칸째 감춘다
    $('lrMemoBox').hidden = !R.memo;
    var mu = $('lrMemo');
    mu.textContent = '';
    if (R.memo) {
      var lines = memoLines(R.memo, R.names);
      if (!lines.length) mu.appendChild(el('li', '', '손볼 곳이 없습니다.'));
      lines.forEach(function (x) {
        var li = el('li', '', x.text);
        x.rows.forEach(function (r) {
          li.appendChild(el('small', '', r));
        });
        mu.appendChild(li);
      });
    }
  }

  // ── 불러오기 ───────────────────────────────────────────
  async function load(month) {
    if (R.busy) return;
    R.busy = true;
    setState('불러오는 중…');
    var r = await api(withCompany('/ledger/dashboard?month=' + month + '&months=' + MONTHS));
    if (!r.ok) {
      R.busy = false;
      return setState(DENY[r.code] || FAIL_MSG);
    }
    if (!r.data || r.data.available === false) {
      R.busy = false;
      return setState(NOT_READY_MSG);
    }
    R.data = r.data;
    R.month = month;
    var recv = await api(withCompany('/ledger/receivables'));
    var pay = await api(withCompany('/ledger/payables'));
    var memo = await api(withCompany('/ledger/close-memo?month=' + month));
    R.recv = recv.ok ? recv.data : null;
    R.pay = pay.ok ? pay.data : null;
    R.memo = memo.ok && memo.data && memo.data.available === true ? memo.data : null;
    R.busy = false;
    setState('');
    $('lrBody').hidden = false;
    render();
  }

  /** 협력 팩토리 — 돌아가기는 팩토리 평가 (장부 화면은 서버가 열지 않는다) */
  function reportBack() {
    var back = $('lrBack');
    back.href = EVAL_PAGE + '#company=' + encodeURIComponent(R.company);
    back.textContent = EVAL_BACK;
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('lrBody') || !board()) return;
    R.sb = auth.sb;
    R.session = auth.session;
    var cfg = window.DADAM_CONFIG || {};
    R.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!R.base) return setState(FAIL_MSG);
    var q = new URLSearchParams(location.search);
    var company = q.get('company') || '';
    R.company = UUID_RE.test(company) ? company : '';
    if (R.company) $('lrBack').href = withCompany('ledger.html');
    var me = await api(withCompany('/ledger/me'));
    if (!me.ok) {
      if (me.code === 'no_ledger' && R.company) reportBack();
      return setState(DENY[me.code] || FAIL_MSG);
    }
    if (!me.data || !me.data.money) return setState(DENY.not_money);
    R.me = me.data;
    R.report = !!R.company && me.data.report === true;
    if (R.report) {
      reportBack();
      $('lrView').textContent = REPORT_NOTE;
      $('lrView').hidden = false;
    }
    var acc = await api('/ledger/accounts');
    if (acc.ok)
      ((acc.data && acc.data.items) || []).forEach(function (a) {
        R.names[a.code] = a.name;
      });
    $('lrPrint').addEventListener('click', function () {
      window.print();
    });
    $('lrPrev').addEventListener('click', function () {
      load(board().shiftMonth(R.month, -1));
    });
    $('lrNext').addEventListener('click', function () {
      var next = board().shiftMonth(R.month, 1);
      if (next <= today().slice(0, 7)) load(next);
    });
    var month = q.get('month') || '';
    await load(MONTH_RE.test(month) && month <= today().slice(0, 7) ? month : today().slice(0, 7));
  }

  var exported = { state: R, lastMonths: lastMonths, todos: todos, memoLines: memoLines };
  window.SeganLedgerReport = exported;
  exported.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
