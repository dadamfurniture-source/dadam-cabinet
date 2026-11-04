/* ============================================================
   segan/ledger-book.js — 회계 매출 · 매입 표 (segan/ledger.html 의 매출 · 매입 탭 — ledger.js 가 부른다)

   보이기   한 달 장부 줄(GET /ledger/book rows)을 방향으로 나눈 표 — 일자 · 거래처 · 내용 · 주문 · 계정 · 공급가 · 부가세 ·
            합계 · 증빙 · 출처. 거름(출처) · 찾기(거래처 · 내용 · 주문번호) · 합계 줄. 매입은 「매입처별」 묶음
            (줄 수 · 공급가 · 부가세 · 합계 · 세금계산서 있음). 받을 돈(GET /ledger/receivables) · 낼 돈(/ledger/payables) 목록
   숫자     서버 값 그대로 — 이 파일이 더하는 것은 합계(공급가 + 부가세)와 합계 줄 · 묶음 합뿐. 부가세를 모르는 줄은 「모름」
   글은 모두 textContent 로 넣는다 (HTML 글을 그대로 넣지 않는다).
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  // 탭마다 — 보이는 방향 · 출처 거름
  var SIDES = {
    sales: {
      dirs: ['income', 'asset_sell'],
      sources: [
        ['all', '전체'],
        ['entry', '직접'],
        ['payment', '수금'],
      ],
    },
    buys: {
      dirs: ['expense', 'asset_buy'],
      sources: [
        ['all', '전체'],
        ['entry', '직접'],
        ['cost', '수주 원가'],
      ],
    },
  };
  // 표의 출처 꼬리표 — 짧게 (거름 단추는 「수주 원가」)
  var SOURCE = { entry: '직접', payment: '수금', cost: '원가' };

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function won(n) {
    return num(n).toLocaleString('ko-KR');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** 'YYYY-MM-DD' → 'MM.DD' */
  function day(d) {
    return d ? String(d).slice(5).replace('-', '.') : '';
  }

  // ── 계산 (순수) ─────────────────────────────────────────
  /**
   * 표에 보일 줄 — 방향 · 취소 · 출처 · 찾기
   * @param {Array} rows   GET /ledger/book rows
   * @param {'sales'|'buys'} side
   * @param {{ showVoid?: boolean, source?: string, query?: string }} [o]
   */
  function rowsFor(rows, side, o) {
    var s = SIDES[side];
    var opt = o || {};
    var q = String(opt.query || '')
      .trim()
      .toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (!r || !s || s.dirs.indexOf(r.direction) < 0) return false;
      if (!opt.showVoid && r.voided_at) return false;
      if (opt.source && opt.source !== 'all' && r.source !== opt.source) return false;
      if (!q) return true;
      return [r.counterparty_name, r.description, r.order_no].some(function (v) {
        return v && String(v).toLowerCase().indexOf(q) >= 0;
      });
    });
  }

  /** 합계 줄 — 취소한 줄은 빼고 센다. 부가세를 모르는 줄은 수만 */
  function totalsOf(rows) {
    var t = { n: 0, amount: 0, vat: 0, total: 0, vatUnknown: 0 };
    (rows || []).forEach(function (r) {
      if (!r || r.voided_at) return;
      t.n += 1;
      t.amount += num(r.amount);
      if (r.vat_amount == null) t.vatUnknown += 1;
      else t.vat += num(r.vat_amount);
      t.total += num(r.amount) + num(r.vat_amount);
    });
    return t;
  }

  /** 매입처별 — 거래처 이름(없으면 「거래처 없음」)마다 줄 수 · 공급가 · 부가세 · 합계 · 세금계산서 있음, 합계 큰 순 */
  function bySupplier(rows) {
    var map = {};
    var order = [];
    (rows || []).forEach(function (r) {
      if (!r || r.voided_at) return;
      var name = r.counterparty_name ? String(r.counterparty_name).trim() : '';
      var key = name || '-';
      if (!map[key]) {
        map[key] = {
          name: name || '거래처 없음',
          n: 0,
          amount: 0,
          vat: 0,
          total: 0,
          taxInvoice: false,
        };
        order.push(key);
      }
      var g = map[key];
      g.n += 1;
      g.amount += num(r.amount);
      g.vat += num(r.vat_amount);
      g.total += num(r.amount) + num(r.vat_amount);
      if (r.evidence_type === 'tax_invoice' || r.evidence_type === 'invoice') g.taxInvoice = true;
    });
    return order
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return b.total - a.total;
      });
  }

  // ── 그리기 ─────────────────────────────────────────────
  function cell(tr, text, cls) {
    var td = el('td', cls || '', text);
    tr.appendChild(td);
    return td;
  }

  function head(table, cols) {
    var thead = el('thead');
    var tr = el('tr');
    cols.forEach(function (c) {
      tr.appendChild(el('th', c[1] || '', c[0]));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  /**
   * 장부 표 — 줄을 누르면 ctx.onRow(줄). ctx: { accountName(code), evidenceName(code), selected }
   * @returns {HTMLTableElement}
   */
  function bookTable(rows, ctx) {
    var c = ctx || {};
    var table = el('table', 'lg-tbl');
    head(table, [
      ['일자', 'l'],
      ['거래처 · 내용', 'l'],
      ['계정', 'l'],
      ['공급가', ''],
      ['부가세', ''],
      ['합계', ''],
      ['증빙', 'l'],
      ['출처', 'l'],
    ]);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el(
        'tr',
        'lg-tr' + (r.voided_at ? ' lg-tr--void' : '') + (c.selected === r.id ? ' is-on' : '')
      );
      tr.setAttribute('data-id', r.id);
      tr.setAttribute('data-source', r.source);
      tr.tabIndex = 0;
      cell(tr, day(r.entry_date), 'l');
      var who = el('td', 'l lg-td-who');
      who.appendChild(el('b', '', r.counterparty_name || (r.source === 'payment' ? '고객' : '-')));
      var sub = [r.description, r.order_no ? '주문 ' + r.order_no : ''].filter(Boolean).join(' · ');
      if (sub) who.appendChild(el('small', '', sub));
      tr.appendChild(who);
      cell(tr, c.accountName ? c.accountName(r.account) : r.account || '', 'l');
      cell(tr, won(r.amount), 'n');
      cell(
        tr,
        r.vat_amount == null ? '모름' : won(r.vat_amount) + (r.vat_computed ? '*' : ''),
        'n'
      );
      cell(tr, won(num(r.amount) + num(r.vat_amount)), 'n');
      cell(
        tr,
        r.evidence_type ? (c.evidenceName ? c.evidenceName(r.evidence_type) : r.evidence_type) : '',
        'l'
      );
      var src = el('td', 'l');
      src.appendChild(
        el(
          'span',
          'lg-src lg-src--' + r.source,
          (SOURCE[r.source] || r.source) + (r.voided_at ? ' · 취소' : '')
        )
      );
      tr.appendChild(src);
      body.appendChild(tr);
    });
    if (!rows.length) {
      var empty = el('tr');
      var td = el('td', 'lg-tbl-empty', '이 달 줄이 없습니다.');
      td.colSpan = 8;
      empty.appendChild(td);
      body.appendChild(empty);
    }
    table.appendChild(body);
    var t = totalsOf(rows);
    var foot = el('tfoot');
    var tr = el('tr');
    var label = el(
      'td',
      'l',
      '합계 ' + t.n + '줄' + (t.vatUnknown ? ' · 부가세 모름 ' + t.vatUnknown : '')
    );
    label.colSpan = 3;
    tr.appendChild(label);
    cell(tr, won(t.amount), 'n');
    cell(tr, won(t.vat), 'n');
    cell(tr, won(t.total), 'n');
    var rest = el('td');
    rest.colSpan = 2;
    tr.appendChild(rest);
    foot.appendChild(tr);
    table.appendChild(foot);
    return table;
  }

  /** 매입처별 표 */
  function supplierTable(groups) {
    var table = el('table', 'lg-tbl');
    head(table, [
      ['매입처', 'l'],
      ['줄', ''],
      ['공급가', ''],
      ['부가세', ''],
      ['합계', ''],
      ['세금계산서', 'l'],
    ]);
    var body = el('tbody');
    groups.forEach(function (g) {
      var tr = el('tr');
      cell(tr, g.name, 'l');
      cell(tr, String(g.n), 'n');
      cell(tr, won(g.amount), 'n');
      cell(tr, won(g.vat), 'n');
      cell(tr, won(g.total), 'n');
      cell(tr, g.taxInvoice ? '있음' : '없음', 'l' + (g.taxInvoice ? '' : ' lg-td-muted'));
      body.appendChild(tr);
    });
    if (!groups.length) {
      var empty = el('tr');
      var td = el('td', 'lg-tbl-empty', '이 달 매입이 없습니다.');
      td.colSpan = 6;
      empty.appendChild(td);
      body.appendChild(empty);
    }
    table.appendChild(body);
    return table;
  }

  /**
   * 받을 돈 · 낼 돈 목록 — data: GET /ledger/receivables | /ledger/payables data
   * @param {'in'|'out'} kind
   */
  function moneyList(box, data, kind, stageName) {
    box.textContent = '';
    var items = (data && data.items) || [];
    if (!items.length) {
      box.appendChild(
        el('li', 'lg-mny-empty', kind === 'in' ? '받을 돈이 없습니다.' : '낼 돈이 없습니다.')
      );
      return;
    }
    items.forEach(function (x) {
      var li = el('li', 'lg-mny' + (x.late ? ' lg-mny--late' : ''));
      var main = el('span', 'lg-mny-main');
      var title =
        kind === 'in'
          ? '주문 ' + (x.order_no || '-') + ' · ' + (stageName ? stageName(x.stage) : x.stage || '')
          : (x.vendor || '거래처 없음') + (x.order_no ? ' · 주문 ' + x.order_no : '');
      main.appendChild(el('b', '', title));
      main.appendChild(
        el(
          'small',
          '',
          (x.due_on ? (kind === 'in' ? '받을 날 ' : '낼 날 ') + day(x.due_on) : '날짜 없음') +
            (x.late ? ' · 늦음' : '')
        )
      );
      li.appendChild(main);
      li.appendChild(el('span', 'lg-mny-amt', won(x.amount) + '원'));
      box.appendChild(li);
    });
  }

  window.SeganLedgerBook = {
    SIDES: SIDES,
    rowsFor: rowsFor,
    totalsOf: totalsOf,
    bySupplier: bySupplier,
    bookTable: bookTable,
    supplierTable: supplierTable,
    moneyList: moneyList,
  };
})();
