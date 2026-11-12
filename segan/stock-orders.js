/* ============================================================
   segan/stock-orders.js — 「구매 · 재고 › 발주」 (segan/me.html #stockOrders)

   철물 · 판재를 공급처에 발주한 것을 적어 두고, 물건이 오면 「입고」 한 번으로 재고를 늘리는 화면.
   (2026-11-12 사장님 결정 — 구매 발주 만들기 · 발주서 인쇄 포함. 생산 › 외주 발주는 수주에 딸린 도어 · 상판 외주라 다른 화면이다)

   누가 보나  다담 공장 구성원 · 협력업체 Expert · Agent 구성원 (segan/stock.js 와 같다).
             발주 적기 · 취소는 서버가 can_manage 라고 한 사람(대표 · 실장)만, 입고 · 발주서 인쇄는 구성원 누구나.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganStockOrders.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /stock/orders                { can_manage, company { name }, items[{ id, code, state, supplier, expected_on, note, by,
                                                   created_at, closed_at, lines[{ id, item_id, name, spec, unit, qty, received_qty }] }] }
               POST /stock/orders                { supplier_id?, expected_on, note?, lines[{ item_id, qty }] }
               POST /stock/orders/:id/receive    { qtys?: { 줄 id: 들어온 수량 } }
               POST /stock/orders/:id/cancel
               GET  /stock/items                 「발주 적기」를 열 때 품목 · 공급처 목록을 읽는다
   화면      탭(진행 중 · 끝난 것) → 줄(번호 · 공급처 · 품목 수 · 받을 날 · 상태). 줄을 누르면 그 자리에 품목 표와 단추.
             입고 — 줄마다 들어온 수량 칸(발주 수량이 채워져 있다)을 고치고 「입고 적기」. 덜 온 만큼은 더 기다리지 않는다.
             취소 — 되돌릴 수 없어 그 자리에서 한 번 되묻는다 (확인 창을 띄우지 않는다).
             발주 적기 — 공급처 · 받을 날 · 품목 줄(고르고 수량) · 메모. 「부족한 품목 채우기」는 안전 재고보다 적은 품목을 모자란 만큼 넣는다.
   발주서    번호 · 날짜 · 받는 곳(공급처) · 보내는 곳(우리 팩토리) · 품목 · 규격 · 수량 · 메모를 이 문서 안 인쇄 칸에 그리고
             인쇄 창을 연다 (PDF 로 저장해 보낼 수 있다). 단가 · 금액은 넣지 않는다.
   없는 것    발주 고치기 (잘못 적었으면 취소하고 새로 적는다) · 나눠 입고 (덜 온 것은 새 발주로).
   못 읽으면  칸째 감춘다 (메뉴 줄도 없다 — DB 0062 적용 전 포함).
   정보      품목 · 공급처 이름 · 메모는 화면과 인쇄에만 쓴다 — 알림 · 기기 저장에 싣지 않는다. 고객 정보는 다루지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['expert', 'agent'];
  var STATES = ['ordered', 'received', 'cancelled'];
  var STATE_NAME = { ordered: '발주함', received: '입고 끝', cancelled: '취소' };
  var TABS = ['open', 'closed'];
  var LINES_MAX = 30;
  var NOTE_MAX = 200;

  var TEXT = {
    title: '발주',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '철물 · 판재를 공급처에 발주한 기록입니다. 물건이 오면 「입고」를 눌러 재고에 넣습니다. 도어 · 상판 외주는 생산 › 외주 발주에서 봅니다.',
    tab: { open: '진행 중', closed: '끝난 것' },
    add: '발주 적기',
    addTitle: '새 발주',
    supplier: '공급처 (선택)',
    supplierNone: '고르지 않음',
    noSupplier: '공급처 없음',
    expectedOn: '받을 날',
    memo: '메모 (선택)',
    item: '품목',
    itemPick: '품목 고르기',
    qty: '수량',
    lineAdd: '품목 더하기',
    lineDel: '빼기',
    fillShort: '부족한 품목 채우기',
    noShort: '안전 재고보다 적은 품목이 없습니다.',
    noItems: '발주할 품목이 없습니다. 먼저 기본 자재 · 철물에 품목을 더해 주세요.',
    itemsFail: '품목을 읽지 못했습니다. 잠시 뒤 다시 해 주세요.',
    put: '발주 넣기',
    stop: '그만두기',
    empty: { open: '진행 중인 발주가 없습니다.', closed: '끝난 발주가 없습니다.' },
    late: '받을 날 지남',
    kinds: '종',
    receive: '입고',
    receiveSave: '입고 적기',
    receiveHint:
      '들어온 수량을 고쳐 적습니다. 덜 온 만큼은 더 기다리지 않습니다 — 나머지는 새 발주로 적어 주세요.',
    cancel: '발주 취소',
    askCancel: '이 발주를 취소합니다. 되돌릴 수 없습니다.',
    yesCancel: '취소하기',
    print: '발주서 인쇄',
    ordered: '발주 수량',
    got: '들어온 수량',
    needDay: '받을 날을 골라 주세요.',
    needLine: '품목을 하나 이상 고르고 수량을 적어 주세요.',
    needQty: '수량을 0 보다 큰 숫자로 적어 주세요.',
    dupLine: '같은 품목이 두 번 들어 있습니다.',
    tooMany: '품목은 한 발주에 30줄까지입니다.',
    placed: '발주를 넣었습니다.',
    received: '입고했습니다. 재고에 넣었습니다.',
    cancelled: '발주를 취소했습니다.',
    printed: '발주서를 인쇄 창으로 보냈습니다.',
    doc: '발주서',
    docNo: '번호',
    docDay: '발주일',
    docTo: '받는 곳',
    docFrom: '보내는 곳',
    docSpec: '규격',
    docUnit: '단위',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    canManage: false,
    company: '',
    today: '',
    items: [],
    tab: 'open',
    open: '',
    mode: '', // '' | receive | cancel
    adding: false,
    form: null, // { supplier, expectedOn, note, lines[{ item, qty }] }
    stock: null, // 발주 적기에 쓰는 품목 [{ id, kind, name, spec, unit, qty, safety, expected }]
    suppliers: [],
    got: {},
    msg: '',
    err: '',
    busy: false,
  };

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) {
    return typeof v === 'string' ? v : '';
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function num(v) {
    var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return isFinite(n) ? n : null;
  }

  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  function qtyText(n) {
    var v = num(n);
    if (v === null) return '0';
    return (Math.round(v * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  /** 'YYYY-MM-DD' → 'MM.DD' */
  function md(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d));
    return m ? m[2] + '.' + m[3] : '';
  }
  /** ISO 때 → 한국 날짜 'YYYY-MM-DD' */
  function kstDay(iso) {
    var t = Date.parse(str(iso));
    return isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : '';
  }

  /** 서버가 준 발주 하나 — 번호 없거나 모르는 상태 · 줄이 하나도 없으면 버린다 */
  function orderOf(v) {
    var r = obj(v);
    if (!str(r.id) || !str(r.code).trim() || STATES.indexOf(r.state) < 0) return null;
    var lines = (Array.isArray(r.lines) ? r.lines : [])
      .map(function (x) {
        var l = obj(x);
        var qty = num(l.qty);
        if (!str(l.id) || qty === null || qty <= 0) return null;
        return {
          id: l.id,
          itemId: str(l.item_id),
          name: str(l.name).trim() || '—',
          spec: str(l.spec).trim(),
          unit: str(l.unit).trim(),
          qty: qty,
          got: num(l.received_qty),
        };
      })
      .filter(Boolean);
    if (!lines.length) return null;
    var s = obj(r.supplier);
    return {
      id: r.id,
      code: str(r.code).trim(),
      state: r.state,
      supplier: str(s.name).trim(),
      expectedOn: md(r.expected_on) ? str(r.expected_on).slice(0, 10) : '',
      note: str(r.note).trim(),
      by: str(r.by).trim(),
      day: kstDay(r.created_at),
      lines: lines,
    };
  }

  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(orderOf).filter(Boolean);
  }

  function inTab(o, tab) {
    return tab === 'closed' ? o.state !== 'ordered' : o.state === 'ordered';
  }

  /** 받을 날이 지났는데 아직 안 들어온 발주인가 */
  function isLate(o, today) {
    return o.state === 'ordered' && !!o.expectedOn && !!today && o.expectedOn < today;
  }

  /** 발주 적기에 쓰는 품목 — 쓰는 것만. 모자란 수량 = 안전 재고 − 남은 수량 − 입고 예정 */
  function stockOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items
      .map(function (v) {
        var r = obj(v);
        if (!str(r.id) || !str(r.name).trim() || r.active === false) return null;
        var qty = num(r.qty) || 0;
        var safety = num(r.safety_qty) || 0;
        var expected = num(r.expected_qty) || 0;
        return {
          id: r.id,
          kind: r.kind === 'board' ? 'board' : 'hardware',
          name: str(r.name).trim(),
          spec: str(r.spec).trim(),
          unit: str(r.unit).trim(),
          need: Math.max(Math.ceil(safety - qty - expected), 0),
        };
      })
      .filter(Boolean);
  }

  /** 적는 칸 → 서버로 보낼 몸. 빈 줄은 버린다. 틀리면 { error } */
  function orderBody(form) {
    var f = obj(form);
    if (!md(str(f.expectedOn))) return { error: TEXT.needDay, focus: 'expectedOn' };
    var seen = {};
    var lines = [];
    var rows = Array.isArray(f.lines) ? f.lines : [];
    for (var i = 0; i < rows.length; i++) {
      var l = obj(rows[i]);
      var item = str(l.item);
      var raw = str(l.qty).trim();
      if (!item && !raw) continue;
      if (!item) return { error: TEXT.needLine, focus: 'item-' + i };
      var q = num(raw);
      if (q === null || q <= 0) return { error: TEXT.needQty, focus: 'qty-' + i };
      if (seen[item]) return { error: TEXT.dupLine, focus: 'item-' + i };
      seen[item] = true;
      lines.push({ item_id: item, qty: q });
    }
    if (!lines.length) return { error: TEXT.needLine, focus: 'item-0' };
    if (lines.length > LINES_MAX) return { error: TEXT.tooMany, focus: 'item-0' };
    return {
      body: {
        supplier_id: str(f.supplier) || null,
        expected_on: f.expectedOn,
        note: str(f.note).trim() || null,
        lines: lines,
      },
    };
  }

  /** 들어온 수량 칸 → { qtys } (발주 수량과 다른 줄만). 틀리면 { error } */
  function receiveBody(order, got) {
    var qtys = {};
    for (var i = 0; i < order.lines.length; i++) {
      var l = order.lines[i];
      var raw = str(obj(got)[l.id]).trim();
      if (!raw) continue;
      var q = num(raw);
      if (q === null || q < 0) return { error: TEXT.needQty, focus: l.id };
      if (q !== l.qty) qtys[l.id] = q;
    }
    return { body: Object.keys(qtys).length ? { qtys: qtys } : {} };
  }

  async function token() {
    try {
      var r = J.sb && (await J.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return J.session ? J.session.access_token : '';
  }

  async function call(method, path, body) {
    if (!J.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(J.base + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      return { ok: false, status: 0, body: {} };
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    return { ok: res.ok && b.success === true, status: res.status, body: b };
  }

  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  // ── 그리기 ────────────────────────────────────────────────────

  function box() {
    return $('stockOrders');
  }
  function dis() {
    return J.busy ? ' disabled' : '';
  }
  function btn(act, label, solid, extra) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (extra || '') +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function errHtml() {
    return (
      '<p class="mk-error" data-po="err" role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>'
    );
  }
  function itemLabel(s) {
    return s.name + (s.spec ? ' · ' + s.spec : '');
  }

  function addFormHtml() {
    var f = J.form;
    var stock = J.stock || [];
    var groups = [
      ['board', '기본 자재'],
      ['hardware', '철물'],
    ];
    function options(picked) {
      return (
        '<option value="">' +
        esc(TEXT.itemPick) +
        '</option>' +
        groups
          .map(function (g) {
            var list = stock.filter(function (s) {
              return s.kind === g[0];
            });
            if (!list.length) return '';
            return (
              '<optgroup label="' +
              esc(g[1]) +
              '">' +
              list
                .map(function (s) {
                  return (
                    '<option value="' +
                    esc(s.id) +
                    '"' +
                    (s.id === picked ? ' selected' : '') +
                    '>' +
                    esc(itemLabel(s) + ' (' + s.unit + ')') +
                    '</option>'
                  );
                })
                .join('') +
              '</optgroup>'
            );
          })
          .join('')
      );
    }
    return (
      '<div class="cp-form st-form" data-po="form"><h4 class="od-h">' +
      esc(TEXT.addTitle) +
      '</h4><div class="ps-grid cp-grid">' +
      '<label class="mk-input ps-field st-field" for="stockOrders-supplier"><span>' +
      esc(TEXT.supplier) +
      '</span><select id="stockOrders-supplier" data-f="supplier"' +
      dis() +
      '><option value="">' +
      esc(TEXT.supplierNone) +
      '</option>' +
      J.suppliers
        .map(function (s) {
          return (
            '<option value="' +
            esc(s.id) +
            '"' +
            (s.id === f.supplier ? ' selected' : '') +
            '>' +
            esc(s.name) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<label class="mk-input ps-field st-field" for="stockOrders-expectedOn"><span>' +
      esc(TEXT.expectedOn) +
      '</span><input id="stockOrders-expectedOn" data-f="expectedOn" type="date" value="' +
      esc(f.expectedOn) +
      '"' +
      dis() +
      '></label>' +
      '<label class="mk-input ps-field st-field cp-wide" for="stockOrders-note"><span>' +
      esc(TEXT.memo) +
      '</span><input id="stockOrders-note" data-f="note" type="text" maxlength="' +
      NOTE_MAX +
      '" autocomplete="off" value="' +
      esc(f.note) +
      '"' +
      dis() +
      '></label></div>' +
      '<ul class="po-lines">' +
      f.lines
        .map(function (l, i) {
          return (
            '<li class="po-line"><label class="mk-input po-item" for="stockOrders-item-' +
            i +
            '"><span>' +
            esc(TEXT.item + ' ' + (i + 1)) +
            '</span><select id="stockOrders-item-' +
            i +
            '" data-l="item" data-i="' +
            i +
            '" data-focus="item-' +
            i +
            '"' +
            dis() +
            '>' +
            options(l.item) +
            '</select></label>' +
            '<label class="mk-input po-qty" for="stockOrders-qty-' +
            i +
            '"><span>' +
            esc(TEXT.qty) +
            '</span><input id="stockOrders-qty-' +
            i +
            '" data-l="qty" data-i="' +
            i +
            '" data-focus="qty-' +
            i +
            '" type="text" inputmode="decimal" autocomplete="off" value="' +
            esc(l.qty) +
            '"' +
            dis() +
            '></label>' +
            (f.lines.length > 1
              ? btn(
                  'line-del',
                  TEXT.lineDel,
                  false,
                  ' data-i="' +
                    i +
                    '" aria-label="' +
                    esc(TEXT.item + ' ' + (i + 1) + ' ' + TEXT.lineDel) +
                    '"'
                )
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul><div class="ps-bar po-linebar">' +
      (f.lines.length < LINES_MAX ? btn('line-add', TEXT.lineAdd) : '') +
      btn('fill-short', TEXT.fillShort) +
      '</div>' +
      errHtml() +
      '<div class="ps-bar">' +
      btn('save-add', TEXT.put, true) +
      btn('stop', TEXT.stop) +
      '</div></div>'
    );
  }

  function detailHtml(o) {
    var receiving = J.mode === 'receive';
    var closed = o.state !== 'ordered';
    var table =
      '<div class="od-tablewrap"><table class="od-table po-table"><thead><tr><th scope="col">' +
      esc(TEXT.item) +
      '</th><th scope="col" class="od-num">' +
      esc(TEXT.ordered) +
      '</th>' +
      (receiving || o.state === 'received'
        ? '<th scope="col" class="od-num">' + esc(TEXT.got) + '</th>'
        : '') +
      '</tr></thead><tbody>' +
      o.lines
        .map(function (l) {
          var gotCell = '';
          if (receiving)
            gotCell =
              // 이름표는 aria-label 로 — 표 칸 안의 감춘 글자는 폰에서 옆으로 넘친다
              '<td class="od-num"><input class="po-got" aria-label="' +
              esc(l.name + ' ' + TEXT.got) +
              '" id="stockOrders-got-' +
              esc(l.id) +
              '" data-got="' +
              esc(l.id) +
              '" type="text" inputmode="decimal" autocomplete="off" value="' +
              esc(J.got[l.id] === undefined ? String(l.qty) : J.got[l.id]) +
              '"' +
              dis() +
              '> ' +
              esc(l.unit) +
              '</td>';
          else if (o.state === 'received')
            gotCell =
              '<td class="od-num">' + esc(l.got === null ? '' : qtyText(l.got) + l.unit) + '</td>';
          return (
            '<tr><th scope="row">' +
            esc(l.name) +
            (l.spec ? '<small>' + esc(l.spec) + '</small>' : '') +
            '</th><td class="od-num">' +
            esc(qtyText(l.qty) + l.unit) +
            '</td>' +
            gotCell +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
    var facts = [
      ['발주일', md(o.day)],
      [TEXT.expectedOn, md(o.expectedOn)],
    ];
    if (o.by) facts.push(['적은 사람', o.by]);
    if (o.note) facts.push(['메모', o.note]);
    var bar;
    if (receiving)
      bar =
        '<small class="cp-hint">' +
        esc(TEXT.receiveHint) +
        '</small><div class="ps-bar">' +
        btn('save-receive', TEXT.receiveSave, true) +
        btn('stop', TEXT.stop) +
        '</div>';
    else if (J.mode === 'cancel')
      bar =
        '<p class="mk-note so-ask" role="alert">' +
        esc(TEXT.askCancel) +
        '</p><div class="ps-bar">' +
        btn('confirm-cancel', TEXT.yesCancel, true) +
        btn('stop', TEXT.stop) +
        '</div>';
    else
      bar =
        '<div class="ps-bar so-acts">' +
        (closed ? '' : btn('receive', TEXT.receive, true)) +
        btn('print', TEXT.print) +
        (!closed && J.canManage ? btn('ask-cancel', TEXT.cancel) : '') +
        '</div>';
    return (
      '<div class="st-detail" data-po="detail"><dl class="me-facts">' +
      facts
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>' +
      table +
      bar +
      errHtml() +
      '<p class="me-pt-msg ps-msg" data-po="msg" role="status">' +
      esc(J.msg) +
      '</p></div>'
    );
  }

  function rowHtml(o) {
    var open = J.open === o.id;
    var late = isLate(o, J.today);
    return (
      '<li class="me-cs-item st-item' +
      (o.state === 'ordered' ? '' : ' me-cs-item--off') +
      '" data-po-row="' +
      esc(o.id) +
      '"><button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(o.id) +
      '" aria-expanded="' +
      open +
      '"' +
      dis() +
      '><span class="me-c-main"><b>' +
      esc(o.code + ' · ' + (o.supplier || TEXT.noSupplier)) +
      '</b><small>' +
      esc(
        o.lines[0].name +
          (o.lines.length > 1 ? ' 외 ' + (o.lines.length - 1) + TEXT.kinds : '') +
          ' · ' +
          TEXT.expectedOn +
          ' ' +
          md(o.expectedOn)
      ) +
      '</small></span><span class="ad-status st-status"><span class="od-badge">' +
      esc(STATE_NAME[o.state]) +
      '</span>' +
      (late ? '<span class="od-badge st-warn">' + esc(TEXT.late) + '</span>' : '') +
      '</span></button>' +
      (open ? detailHtml(o) : '') +
      '</li>'
    );
  }

  function countOf(tab) {
    return J.items.filter(function (o) {
      return inTab(o, tab);
    }).length;
  }

  function keep() {
    var b = box();
    if (!b) return;
    if (J.form) {
      b.querySelectorAll('[data-f]').forEach(function (el) {
        J.form[el.getAttribute('data-f')] = el.value;
      });
      b.querySelectorAll('[data-l]').forEach(function (el) {
        var line = J.form.lines[Number(el.getAttribute('data-i'))];
        if (line) line[el.getAttribute('data-l')] = el.value;
      });
    }
    b.querySelectorAll('[data-got]').forEach(function (el) {
      J.got[el.getAttribute('data-got')] = el.value;
    });
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    var rows = J.items.filter(function (o) {
      return inTab(o, J.tab);
    });
    b.innerHTML =
      '<h3 class="me-pt-sub" id="stockOrdersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      (J.adding && J.form
        ? addFormHtml()
        : '<div class="ps-bar st-top">' +
          (J.canManage ? btn('add', TEXT.add, true) : '') +
          '<p class="me-pt-msg ps-msg" data-po="topmsg" role="status">' +
          esc(J.open ? '' : J.msg) +
          '</p></div>' +
          (!J.open && J.err ? errHtml() : '')) +
      '<div class="cs-choices oo-filter" role="group" aria-label="상태로 거르기">' +
      TABS.map(function (t) {
        var on = J.tab === t;
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="tab" data-tab="' +
          t +
          '" aria-pressed="' +
          on +
          '"' +
          dis() +
          '>' +
          esc(TEXT.tab[t]) +
          ' <span class="cp-count">' +
          countOf(t) +
          '</span></button>'
        );
      }).join('') +
      '</div>' +
      (rows.length
        ? '<ul class="me-cs-list oo-list st-list">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty[J.tab]) + '</p>');
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    J.ready = false;
  }

  function find(id) {
    return J.items.filter(function (o) {
      return o.id === id;
    })[0];
  }

  async function reloadList() {
    var r = await call('GET', '/stock/orders');
    var list = r.ok ? listOf(r.body.data) : null;
    if (!list) return false;
    var d = obj(r.body.data);
    J.items = list;
    J.canManage = d.can_manage === true;
    J.company = str(obj(d.company).name).trim();
    J.today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    return true;
  }

  /** 재고가 바뀌었다 — 재고 화면들이 다음에 다시 읽게 한다 */
  function touchStock() {
    ['SeganStock', 'SeganStockMoves'].forEach(function (name) {
      var m = window[name];
      if (m && typeof m.refresh === 'function') m.refresh();
    });
  }

  function clearNote() {
    J.msg = '';
    J.err = '';
  }

  function blankForm() {
    return { supplier: '', expectedOn: '', note: '', lines: [{ item: '', qty: '' }] };
  }

  async function startAdd() {
    clearNote();
    J.busy = true;
    render();
    var r = await call('GET', '/stock/items');
    var stock = r.ok ? stockOf(r.body.data) : null;
    J.busy = false;
    if (!stock) J.err = r.ok ? TEXT.itemsFail : errText(r);
    else if (!stock.length) J.err = TEXT.noItems;
    else {
      J.stock = stock;
      J.suppliers = (Array.isArray(obj(r.body.data).suppliers) ? r.body.data.suppliers : [])
        .map(function (s) {
          return { id: str(obj(s).id), name: str(obj(s).name) };
        })
        .filter(function (s) {
          return s.id && s.name;
        });
      J.form = blankForm();
      J.adding = true;
      J.open = '';
      J.mode = '';
    }
    render();
    focusOn(J.adding ? '[data-f="expectedOn"]' : '[data-act="add"]');
  }

  /** 안전 재고보다 적은 품목을 모자란 만큼 줄로 넣는다 (이미 고른 품목은 건너뛴다) */
  function fillShort() {
    keep();
    clearNote();
    var have = {};
    J.form.lines = J.form.lines.filter(function (l) {
      return l.item || str(l.qty).trim();
    });
    J.form.lines.forEach(function (l) {
      have[l.item] = true;
    });
    var added = 0;
    (J.stock || []).forEach(function (s) {
      if (s.need > 0 && !have[s.id] && J.form.lines.length < LINES_MAX) {
        J.form.lines.push({ item: s.id, qty: String(s.need) });
        added += 1;
      }
    });
    if (!J.form.lines.length) J.form.lines.push({ item: '', qty: '' });
    if (!added) J.err = TEXT.noShort;
    render();
    focusOn(added ? '[data-act="save-add"]' : '[data-act="fill-short"]');
  }

  async function saveAdd() {
    keep();
    var made = orderBody(J.form);
    clearNote();
    if (made.error) {
      J.err = made.error;
      render();
      focusOn('[data-f="' + made.focus + '"], [data-focus="' + made.focus + '"]');
      return;
    }
    J.busy = true;
    render();
    var r = await call('POST', '/stock/orders', made.body);
    if (r.ok) {
      await reloadList();
      J.adding = false;
      J.form = null;
      J.tab = 'open';
      J.msg = TEXT.placed + (str(obj(r.body.data).code) ? ' ' + obj(r.body.data).code : '');
      touchStock();
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn(r.ok ? '[data-act="add"]' : '[data-act="save-add"]');
  }

  async function closeOrder(path, body, okText) {
    var id = J.open;
    clearNote();
    J.busy = true;
    render();
    var r = await call('POST', '/stock/orders/' + encodeURIComponent(id) + path, body);
    if (r.ok) {
      await reloadList();
      J.mode = '';
      J.got = {};
      J.open = ''; // 진행 중 탭에서 빠진다 — 줄을 닫고 위에 알린다
      J.msg = okText;
      touchStock();
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn(r.ok ? '[data-act="tab"][aria-pressed="true"]' : '[data-act="stop"]');
  }

  function saveReceive() {
    keep();
    var o = find(J.open);
    if (!o) return;
    var made = receiveBody(o, J.got);
    if (made.error) {
      clearNote();
      J.err = made.error;
      render();
      focusOn('[data-got="' + made.focus + '"]');
      return;
    }
    closeOrder('/receive', made.body, TEXT.received);
  }

  /** 발주서 — 이 문서 안 인쇄 칸에 그리고 인쇄 창을 연다 */
  function printOrder(o) {
    [].slice.call(document.querySelectorAll('body > .so-print')).forEach(function (el) {
      el.parentNode.removeChild(el);
    });
    var el = document.createElement('div');
    el.id = 'stockOrderPrint';
    el.className = 'so-print po-doc';
    el.innerHTML =
      '<h1>' +
      esc(TEXT.doc) +
      '</h1><dl class="po-doc-facts"><div><dt>' +
      esc(TEXT.docNo) +
      '</dt><dd>' +
      esc(o.code) +
      '</dd></div><div><dt>' +
      esc(TEXT.docDay) +
      '</dt><dd>' +
      esc(o.day) +
      '</dd></div><div><dt>' +
      esc(TEXT.expectedOn) +
      '</dt><dd>' +
      esc(o.expectedOn) +
      '</dd></div><div><dt>' +
      esc(TEXT.docTo) +
      '</dt><dd>' +
      esc(o.supplier || '') +
      '</dd></div><div><dt>' +
      esc(TEXT.docFrom) +
      '</dt><dd>' +
      esc(J.company) +
      '</dd></div></dl><table><thead><tr><th>#</th><th>' +
      esc(TEXT.item) +
      '</th><th>' +
      esc(TEXT.docSpec) +
      '</th><th class="po-doc-num">' +
      esc(TEXT.qty) +
      '</th><th>' +
      esc(TEXT.docUnit) +
      '</th></tr></thead><tbody>' +
      o.lines
        .map(function (l, i) {
          return (
            '<tr><td>' +
            (i + 1) +
            '</td><td>' +
            esc(l.name) +
            '</td><td>' +
            esc(l.spec) +
            '</td><td class="po-doc-num">' +
            esc(qtyText(l.qty)) +
            '</td><td>' +
            esc(l.unit) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>' +
      (o.note ? '<p class="po-doc-note">' + esc(o.note) + '</p>' : '');
    document.body.appendChild(el);
    document.body.classList.add('so-printing');
    var done = function () {
      document.body.classList.remove('so-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } catch {
      done();
    }
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    var o = find(J.open);
    if (act === 'tab') {
      J.tab = TABS.indexOf(el.getAttribute('data-tab')) >= 0 ? el.getAttribute('data-tab') : 'open';
      J.open = '';
      J.mode = '';
      clearNote();
      render();
      focusOn('[data-act="tab"][aria-pressed="true"]');
    } else if (act === 'open') {
      var id = el.getAttribute('data-id') || '';
      J.open = J.open === id ? '' : id;
      J.mode = '';
      J.got = {};
      J.adding = false;
      J.form = null;
      clearNote();
      render();
      focusOn('[data-act="open"][data-id="' + id + '"]');
    } else if (act === 'add') startAdd();
    else if (act === 'stop') {
      J.adding = false;
      J.form = null;
      J.mode = '';
      J.got = {};
      clearNote();
      render();
      focusOn(J.open ? '[data-act="open"][aria-expanded="true"]' : '[data-act="add"]');
    } else if (act === 'line-add' && J.form) {
      keep();
      if (J.form.lines.length < LINES_MAX) J.form.lines.push({ item: '', qty: '' });
      render();
      focusOn('[data-focus="item-' + (J.form.lines.length - 1) + '"]');
    } else if (act === 'line-del' && J.form) {
      keep();
      J.form.lines.splice(Number(el.getAttribute('data-i')), 1);
      if (!J.form.lines.length) J.form.lines.push({ item: '', qty: '' });
      render();
      focusOn('[data-act="line-add"]');
    } else if (act === 'fill-short' && J.form) fillShort();
    else if (act === 'save-add' && J.form) saveAdd();
    else if (!o) return;
    else if (act === 'receive') {
      J.mode = 'receive';
      J.got = {};
      clearNote();
      render();
      focusOn('[data-got]');
    } else if (act === 'save-receive') saveReceive();
    else if (act === 'ask-cancel' && J.canManage) {
      J.mode = 'cancel';
      clearNote();
      render();
      focusOn('[data-act="confirm-cancel"]');
    } else if (act === 'confirm-cancel' && J.mode === 'cancel')
      closeOrder('/cancel', {}, TEXT.cancelled);
    else if (act === 'print') {
      printOrder(o);
      clearNote();
      J.msg = TEXT.printed;
      render();
      focusOn('[data-act="print"]');
    }
  }

  /** 글 칸에서 Enter — 그 칸의 저장 */
  function onKey(e) {
    if (e.key !== 'Enter' || J.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.hasAttribute('data-got')) {
      e.preventDefault();
      saveReceive();
    } else if (J.form && (el.hasAttribute('data-f') || el.hasAttribute('data-l'))) {
      e.preventDefault();
      saveAdd();
    }
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('keydown', onKey);
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.items = [];
    J.tab = 'open';
    J.open = '';
    J.mode = '';
    J.adding = false;
    J.form = null;
    J.stock = null;
    J.suppliers = [];
    J.got = {};
    J.canManage = false;
    J.busy = false;
    clearNote();
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reloadList())) return;
      bind();
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganStockOrders = {
    STATE_NAME: STATE_NAME,
    TEXT: TEXT,
    canSee: canSee,
    orderOf: orderOf,
    listOf: listOf,
    inTab: inTab,
    isLate: isLate,
    stockOf: stockOf,
    orderBody: orderBody,
    receiveBody: receiveBody,
    state: J,
    load: load,
  };
})();
