/* ============================================================
   segan/stock-needs.js — 「구매 · 재고 › 작업 자재」 (segan/me.html #stockNeeds)

   진행 중인 수주(계약 확정 · 제작 중)마다 작업지시서의 자재가 재고에 있는지 보고, 쓴 만큼 한 번에 출고하는 화면.
   (2026-11-12 사장님 결정 — 판재는 재질 + 두께로 짝짓는다 · 출고는 사람이 누를 때 · 재단에서 남는 조각은 후보로만)

   누가 보나  다담 공장 구성원 · 협력업체 Expert · Agent 구성원 (segan/stock.js 와 같다).
             출고 · 자투리 후보 등록은 구성원 누구나, 짝 정하기는 서버가 can_manage 라고 한 사람(대표 · 실장)만.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganStockNeeds.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /stock/needs                      { can_manage, counts, orders[…], materials[…] }
               PUT  /stock/links                      { key, label, item_id } | { key, label, ignored: true } | { key }
               POST /stock/needs/:orderId/issue       { lines[{ item_id, qty }] } — 같은 수주는 한 번만
               GET  /stock/needs/:orderId/offcuts     { items[{ material, thickness_mm, width_mm, height_mm, sheet_no }] }
               GET  /stock/items                      짝표를 열 때 고를 품목을 읽는다
               POST /stock/offcuts                    자투리 후보를 등록할 때 (segan/stock-offcuts.js 와 같은 길)
   화면      보기 둘 — 「수주별」 · 「짝표」.
             수주별: 탭(전체 · 없음 · 짝 없음 · 입고 예정 · 재고 있음 · 출고함) → 줄(수주 번호 · 설계 이름 · 납기 · 상태).
               줄을 누르면 자재 표(자재 · 필요한 양 · 재고 품목과 남은 수량 · 상태)와 단추:
               「이 작업 자재 출고」 — 짝지은 자재가 필요한 양으로 채워져 나오고, 고친 뒤 「출고 적기」. 0 으로 두면 그 줄은 빼지 않는다.
               「남는 조각 보기」 — 재단 배치에서 남을 조각 후보. 실제로 남은 것만 「등록」(자투리 자재에 들어간다).
             대시보드: 구매 · 재고 대시보드(#meStockNeedsNumbers)에 상태별 수주 수 — 누르면 그 탭으로 이 화면이 열린다.
             짝표: 자재마다 재고 품목을 고른다 (판재는 기본 자재, 철물은 철물 품목). 「재고에서 다루지 않음」 · 「짝 없음」.
   상태      재고 있음 · 입고 예정(입고 예정까지 치면 됨) · 없음 · 짝 없음 · 다루지 않음. 재고는 납기 빠른 수주부터 채운다.
             색만으로 알리지 않는다 — 글자로 적는다.
   못 읽으면  칸째 감춘다 (메뉴 줄도 없다 — DB 0063 적용 전 포함).
   정보      수주 번호 · 설계 이름 · 자재 이름만 다룬다 — 고객 이름 · 금액은 오지 않는다. 기기에 남기지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['expert', 'agent'];
  var STATES = ['ok', 'expected', 'short', 'unlinked', 'ignored'];
  var LINE_NAME = {
    ok: '재고 있음',
    expected: '입고 예정',
    short: '없음',
    unlinked: '짝 없음',
    ignored: '다루지 않음',
  };
  var ORDER_NAME = {
    ok: '재고 있음',
    expected: '입고 예정',
    short: '없음',
    unlinked: '짝 없음',
    nodoc: '작업지시서 없음',
    issued: '출고함',
  };
  var TABS = ['all', 'short', 'unlinked', 'expected', 'ok', 'issued'];
  var STATUS_NAME = { confirmed: '계약 확정', in_production: '제작 중' };

  var TEXT = {
    title: '작업 자재',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '진행 중인 수주마다 작업지시서의 자재가 재고에 있는지 봅니다. 재고는 납기 빠른 수주부터 채웁니다.',
    view: { orders: '수주별', links: '짝표' },
    tab: {
      all: '전체',
      short: '없음',
      unlinked: '짝 없음',
      expected: '입고 예정',
      ok: '재고 있음',
      issued: '출고함',
    },
    empty: '진행 중인 수주가 없습니다.',
    emptyTab: '이 상태의 수주가 없습니다.',
    due: '납기',
    noDue: '납기 없음',
    cols: ['자재', '필요', '재고 품목 (남은 수량)', '상태'],
    noDoc: '이 수주에는 아직 작업지시서가 없습니다. 작업지시서를 발행하면 자재가 나옵니다.',
    noPlan: '재단 배치가 없어 판재 장수는 나오지 않습니다. 철물만 보입니다.',
    noLines: '작업지시서에 자재 줄이 없습니다.',
    issue: '이 작업 자재 출고',
    issueTitle: '출고할 수량',
    issueHint:
      '짝지은 자재가 필요한 양으로 채워져 있습니다. 실제로 쓴 만큼 고쳐 적습니다. 0 으로 두면 그 품목은 빼지 않습니다. 같은 수주는 한 번만 출고할 수 있습니다.',
    issueSave: '출고 적기',
    issueNone: '짝지은 자재가 없어 출고할 것이 없습니다. 먼저 「짝표」에서 짝을 정해 주세요.',
    stop: '그만두기',
    needQty: '수량을 0 이상의 숫자로 적어 주세요.',
    needOne: '출고할 수량이 모두 0 입니다.',
    issued: '출고했습니다. 재고에서 뺐습니다.',
    offcuts: '남는 조각 보기',
    offcutsTitle: '재단에서 남을 조각 (후보)',
    offcutsHint: '재단 배치로 셈한 것이라 실제와 다를 수 있습니다. 실제로 남은 것만 등록해 주세요.',
    offcutsNone: '쓸 만한 크기(긴 변 600 · 짧은 변 400 이상)로 남는 조각이 없습니다.',
    offcutsFail: '남는 조각을 읽지 못했습니다.',
    register: '등록',
    registered: '등록함',
    memoSuffix: ' 재단에서 남음',
    toOrders: '발주 적기로',
    toLinks: '짝표로',
    linksNote:
      '작업지시서에 나오는 자재를 재고 품목과 한 번 짝지어 두면, 그 뒤로는 저절로 이어집니다. 판재는 재질 + 두께, 철물은 분류 + 이름으로 나옵니다.',
    linksNoteStaff: '짝은 대표 · 실장이 정합니다.',
    linkCols: ['자재', '진행 중 수주에 필요한 양', '재고 품목'],
    linkNone: '짝 없음',
    linkIgnore: '재고에서 다루지 않음',
    linksEmpty: '진행 중인 수주의 작업지시서에 자재가 없습니다.',
    itemsFail: '품목을 읽지 못했습니다. 잠시 뒤 다시 해 주세요.',
    linked: '짝을 정했습니다.',
    unlinked: '짝을 풀었습니다.',
    ordersUnit: '건',
    dash: '진행 중 작업 자재',
    dashNone: '진행 중인 수주가 없습니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false,
    canManage: false,
    orders: [],
    materials: [],
    counts: {},
    view: 'orders',
    tab: 'all',
    open: '',
    mode: '', // '' | issue | offcuts
    qty: {},
    cands: null, // null 읽는 중 · false 못 읽음 · [{ …, done }]
    stock: null, // 짝표에서 고를 품목 [{ id, kind, name, spec, unit }]
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
  /** ISO 때 → 한국 날짜 'MM.DD' */
  function dayText(iso) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var d = new Date(t + 9 * 3600 * 1000).toISOString();
    return d.slice(5, 7) + '.' + d.slice(8, 10);
  }

  function itemOf(v) {
    var i = obj(v);
    if (!str(i.id) || !str(i.name).trim()) return null;
    return {
      id: i.id,
      name: str(i.name).trim(),
      spec: str(i.spec).trim(),
      unit: str(i.unit).trim(),
      qty: num(i.qty),
    };
  }
  function itemLabel(i) {
    return i.name + (i.spec ? ' · ' + i.spec : '');
  }

  /** 서버가 준 자재 줄 — 키 · 아는 상태가 없으면 버린다 */
  function lineOf(v) {
    var l = obj(v);
    var need = num(l.need);
    if (!str(l.key) || STATES.indexOf(l.state) < 0 || need === null) return null;
    return {
      key: l.key,
      kind: l.kind === 'board' ? 'board' : 'hardware',
      label: str(l.label).trim() || l.key,
      need: need,
      unit: str(l.unit).trim(),
      state: l.state,
      item: itemOf(l.item),
    };
  }

  /** 서버가 준 수주 — 번호 · 아는 상태가 없으면 버린다 */
  function orderOf(v) {
    var o = obj(v);
    if (!str(o.id) || !str(o.order_no).trim() || !ORDER_NAME[o.state]) return null;
    return {
      id: o.id,
      no: str(o.order_no).trim(),
      name: str(o.name).trim(),
      status: str(o.status),
      due: dayText(o.due),
      issued: o.issued === true,
      hasDoc: o.has_doc !== false,
      hasPlan: o.has_plan !== false,
      state: o.state,
      lines: (Array.isArray(o.lines) ? o.lines : []).map(lineOf).filter(Boolean),
    };
  }

  function materialOf(v) {
    var m = obj(v);
    if (!str(m.key)) return null;
    return {
      key: m.key,
      kind: m.kind === 'board' ? 'board' : 'hardware',
      label: str(m.label).trim() || m.key,
      unit: str(m.unit).trim(),
      need: num(m.need) || 0,
      orders: num(m.orders) || 0,
      ignored: m.ignored === true,
      item: itemOf(m.item),
    };
  }

  function dataOf(data) {
    var d = obj(data);
    if (!Array.isArray(d.orders) || !Array.isArray(d.materials)) return null;
    return {
      canManage: d.can_manage === true,
      orders: d.orders.map(orderOf).filter(Boolean),
      materials: d.materials.map(materialOf).filter(Boolean),
    };
  }

  function inTab(o, tab) {
    return tab === 'all' ? true : o.state === tab;
  }

  /** 출고할 줄 — 짝지은 자재만, 같은 품목은 더한다. [{ itemId, label, unit, need, have }] */
  function issueRows(order) {
    var by = {};
    var out = [];
    order.lines.forEach(function (l) {
      if (!l.item || l.state === 'ignored' || l.state === 'unlinked') return;
      if (by[l.item.id]) by[l.item.id].need = Math.round((by[l.item.id].need + l.need) * 100) / 100;
      else {
        by[l.item.id] = {
          itemId: l.item.id,
          label: itemLabel(l.item),
          unit: l.item.unit || l.unit,
          need: l.need,
          have: l.item.qty,
        };
        out.push(by[l.item.id]);
      }
    });
    return out;
  }

  /** 적은 수량 → 서버로 보낼 몸. 0 인 줄은 뺀다. 틀리면 { error } */
  function issueBody(rows, qty) {
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var raw = obj(qty)[r.itemId];
      var q = raw === undefined ? r.need : num(str(raw).trim() === '' ? '0' : raw);
      if (q === null || q < 0) return { error: TEXT.needQty, focus: r.itemId };
      if (q > 0) lines.push({ item_id: r.itemId, qty: q });
    }
    if (!lines.length) return { error: TEXT.needOne, focus: rows.length ? rows[0].itemId : '' };
    return { body: { lines: lines } };
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
    return $('stockNeeds');
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
      '<p class="mk-error" data-sn2="err" role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>'
    );
  }
  function badge(text, warn) {
    return '<span class="od-badge' + (warn ? ' st-warn' : '') + '">' + esc(text) + '</span>';
  }
  function warnState(s) {
    return s === 'short' || s === 'unlinked';
  }

  function issueHtml(o) {
    var rows = issueRows(o);
    if (!rows.length)
      return (
        '<p class="mk-note">' +
        esc(TEXT.issueNone) +
        '</p><div class="ps-bar">' +
        btn('stop', TEXT.stop) +
        '</div>'
      );
    return (
      '<div class="cp-form st-form" data-sn2="issue"><h4 class="od-h">' +
      esc(TEXT.issueTitle) +
      '</h4><ul class="po-lines">' +
      rows
        .map(function (r) {
          var v = J.qty[r.itemId] === undefined ? String(r.need) : J.qty[r.itemId];
          return (
            '<li class="po-line"><span class="po-item sn2-name"><b>' +
            esc(r.label) +
            '</b><small>' +
            esc('필요 ' + qtyText(r.need) + r.unit + ' · 남은 수량 ' + qtyText(r.have) + r.unit) +
            '</small></span>' +
            '<label class="mk-input po-qty" for="stockNeeds-q-' +
            esc(r.itemId) +
            '"><span>' +
            esc('출고 (' + r.unit + ')') +
            '</span><input id="stockNeeds-q-' +
            esc(r.itemId) +
            '" data-q="' +
            esc(r.itemId) +
            '" type="text" inputmode="decimal" autocomplete="off" value="' +
            esc(v) +
            '"' +
            dis() +
            '></label></li>'
          );
        })
        .join('') +
      '</ul><small class="cp-hint">' +
      esc(TEXT.issueHint) +
      '</small>' +
      errHtml() +
      '<div class="ps-bar">' +
      btn('save-issue', TEXT.issueSave, true) +
      btn('stop', TEXT.stop) +
      '</div></div>'
    );
  }

  function candsHtml() {
    var body;
    if (J.cands === null) body = '<p class="me-empty">…</p>';
    else if (J.cands === false) body = '<p class="me-empty">' + esc(TEXT.offcutsFail) + '</p>';
    else if (!J.cands.length) body = '<p class="me-empty">' + esc(TEXT.offcutsNone) + '</p>';
    else
      body =
        '<small class="cp-hint">' +
        esc(TEXT.offcutsHint) +
        '</small><ul class="po-lines">' +
        J.cands
          .map(function (c, i) {
            return (
              '<li class="po-line"><span class="po-item sn2-name"><b>' +
              esc(qtyText(c.width) + ' × ' + qtyText(c.height) + ' mm') +
              '</b><small>' +
              esc(c.material + ' · ' + qtyText(c.thickness) + 'T · 원판 ' + c.sheet) +
              '</small></span>' +
              (c.done
                ? badge(TEXT.registered)
                : btn('register', TEXT.register, false, ' data-i="' + i + '"')) +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    return (
      '<div class="cp-form st-form" data-sn2="cands"><h4 class="od-h">' +
      esc(TEXT.offcutsTitle) +
      '</h4>' +
      body +
      errHtml() +
      '<div class="ps-bar">' +
      btn('stop', TEXT.stop) +
      '</div></div>'
    );
  }

  function detailHtml(o) {
    var table = '';
    if (!o.hasDoc) table = '<p class="mk-note">' + esc(TEXT.noDoc) + '</p>';
    else if (!o.lines.length) table = '<p class="mk-note">' + esc(TEXT.noLines) + '</p>';
    else
      table =
        (o.hasPlan ? '' : '<p class="mk-note">' + esc(TEXT.noPlan) + '</p>') +
        '<div class="od-tablewrap"><table class="od-table po-table"><thead><tr>' +
        TEXT.cols
          .map(function (c, i) {
            return '<th scope="col"' + (i === 1 ? ' class="od-num"' : '') + '>' + esc(c) + '</th>';
          })
          .join('') +
        '</tr></thead><tbody>' +
        o.lines
          .map(function (l) {
            return (
              '<tr data-sn2-line="' +
              esc(l.key) +
              '"><th scope="row">' +
              esc(l.label) +
              '</th><td class="od-num">' +
              esc(qtyText(l.need) + l.unit) +
              '</td><td>' +
              esc(
                l.item
                  ? itemLabel(l.item) +
                      (l.item.qty === null ? '' : ' (' + qtyText(l.item.qty) + l.item.unit + ')')
                  : '—'
              ) +
              '</td><td>' +
              badge(
                o.issued && l.item ? ORDER_NAME.issued : LINE_NAME[l.state],
                !o.issued && warnState(l.state)
              ) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    var bar = '';
    if (J.mode === 'issue') bar = issueHtml(o);
    else if (J.mode === 'offcuts') bar = candsHtml();
    else if (o.hasDoc)
      bar =
        '<div class="ps-bar so-acts">' +
        (o.issued ? '' : btn('issue', TEXT.issue, true)) +
        (o.hasPlan ? btn('offcuts', TEXT.offcuts) : '') +
        (o.state === 'short'
          ? '<a class="mk-btn" href="#stock-orders">' + esc(TEXT.toOrders) + '</a>'
          : '') +
        (o.lines.some(function (l) {
          return l.state === 'unlinked';
        })
          ? btn('view', TEXT.toLinks, false, ' data-view="links"')
          : '') +
        '</div>' +
        errHtml() +
        '<p class="me-pt-msg ps-msg" data-sn2="msg" role="status">' +
        esc(J.msg) +
        '</p>';
    return '<div class="st-detail" data-sn2="detail">' + table + bar + '</div>';
  }

  function rowHtml(o) {
    var open = J.open === o.id;
    return (
      '<li class="me-cs-item st-item' +
      (o.issued ? ' me-cs-item--off' : '') +
      '" data-sn2-row="' +
      esc(o.id) +
      '"><button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(o.id) +
      '" aria-expanded="' +
      open +
      '"' +
      dis() +
      '><span class="me-c-main"><b>' +
      esc(o.no + (o.name ? ' · ' + o.name : '')) +
      '</b><small>' +
      esc((STATUS_NAME[o.status] || '') + ' · ' + (o.due ? TEXT.due + ' ' + o.due : TEXT.noDue)) +
      '</small></span><span class="ad-status st-status">' +
      badge(ORDER_NAME[o.state], warnState(o.state)) +
      '</span></button>' +
      (open ? detailHtml(o) : '') +
      '</li>'
    );
  }

  function ordersHtml() {
    var rows = J.orders.filter(function (o) {
      return inTab(o, J.tab);
    });
    return (
      '<div class="cs-choices oo-filter" role="group" aria-label="상태로 거르기">' +
      TABS.map(function (t) {
        var on = J.tab === t;
        var n = J.orders.filter(function (o) {
          return inTab(o, t);
        }).length;
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
          n +
          '</span></button>'
        );
      }).join('') +
      '</div>' +
      (!J.open && J.msg
        ? '<p class="me-pt-msg ps-msg" data-sn2="topmsg" role="status">' + esc(J.msg) + '</p>'
        : '') +
      (rows.length
        ? '<ul class="me-cs-list oo-list st-list">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(J.orders.length ? TEXT.emptyTab : TEXT.empty) + '</p>')
    );
  }

  function linkCell(m) {
    if (!J.canManage || !J.stock)
      return esc(m.item ? itemLabel(m.item) : m.ignored ? TEXT.linkIgnore : TEXT.linkNone);
    var picked = m.item ? m.item.id : m.ignored ? '-' : '';
    var list = J.stock.filter(function (s) {
      return s.kind === m.kind;
    });
    return (
      '<select class="sn2-pick" data-link="' +
      esc(m.key) +
      '" aria-label="' +
      esc(m.label + ' 재고 품목') +
      '"' +
      dis() +
      '><option value=""' +
      (picked === '' ? ' selected' : '') +
      '>' +
      esc(TEXT.linkNone) +
      '</option><option value="-"' +
      (picked === '-' ? ' selected' : '') +
      '>' +
      esc(TEXT.linkIgnore) +
      '</option>' +
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
      // 숨긴 품목과 짝지어 둔 경우 — 고를 목록에 없어도 지금 짝은 보인다
      (m.item &&
      !list.some(function (s) {
        return s.id === m.item.id;
      })
        ? '<option value="' + esc(m.item.id) + '" selected>' + esc(itemLabel(m.item)) + '</option>'
        : '') +
      '</select>'
    );
  }

  function linksHtml() {
    return (
      '<p class="mk-note">' +
      esc(TEXT.linksNote + (J.canManage ? '' : ' ' + TEXT.linksNoteStaff)) +
      '</p>' +
      errHtml() +
      '<p class="me-pt-msg ps-msg" data-sn2="msg" role="status">' +
      esc(J.msg) +
      '</p>' +
      (J.materials.length
        ? '<div class="od-tablewrap"><table class="od-table po-table sn2-links"><thead><tr>' +
          TEXT.linkCols
            .map(function (c, i) {
              return (
                '<th scope="col"' + (i === 1 ? ' class="od-num"' : '') + '>' + esc(c) + '</th>'
              );
            })
            .join('') +
          '</tr></thead><tbody>' +
          J.materials
            .map(function (m) {
              var none = !m.item && !m.ignored;
              return (
                '<tr data-sn2-mat="' +
                esc(m.key) +
                '"><th scope="row">' +
                esc(m.label) +
                (none ? ' ' + badge(TEXT.linkNone, true) : '') +
                '<small>' +
                esc(m.kind === 'board' ? '판재' : '철물') +
                '</small></th><td class="od-num">' +
                esc(
                  m.orders ? qtyText(m.need) + m.unit + ' · ' + m.orders + TEXT.ordersUnit : '—'
                ) +
                '</td><td>' +
                linkCell(m) +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<p class="me-empty">' + esc(TEXT.linksEmpty) + '</p>')
    );
  }

  function keep() {
    var b = box();
    if (!b) return;
    b.querySelectorAll('[data-q]').forEach(function (el) {
      J.qty[el.getAttribute('data-q')] = el.value;
    });
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="stockNeedsTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p><div class="cs-choices sn2-view" role="group" aria-label="보기">' +
      ['orders', 'links']
        .map(function (v) {
          var on = J.view === v;
          var warn =
            v === 'links'
              ? J.materials.filter(function (m) {
                  return !m.item && !m.ignored && m.orders > 0;
                }).length
              : 0;
          return (
            '<button type="button" class="mk-btn' +
            (on ? ' mk-btn--solid' : '') +
            '" data-act="view" data-view="' +
            v +
            '" aria-pressed="' +
            on +
            '"' +
            dis() +
            '>' +
            esc(TEXT.view[v]) +
            (warn ? ' <span class="cp-count">' + esc(TEXT.linkNone + ' ' + warn) + '</span>' : '') +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      (J.view === 'links' ? linksHtml() : ordersHtml());
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
    renderDash();
  }

  // ── 구매 · 재고 대시보드의 상태별 수주 수 ─────────────────────

  function dashBox() {
    return $('meStockNeedsNumbers');
  }

  function renderDash() {
    var b = dashBox();
    if (!b) return;
    if (!J.ready) {
      b.hidden = true;
      b.innerHTML = '';
      return;
    }
    var n = {};
    J.orders.forEach(function (o) {
      n[o.state] = (n[o.state] || 0) + 1;
    });
    var cell = function (key, label, tab, warn) {
      var c = n[key] || 0;
      return (
        '<div data-snd="' +
        key +
        '"' +
        (warn && c > 0 ? ' class="sn-warn"' : '') +
        '><dt>' +
        esc(label) +
        '</dt><dd><a href="#stock-needs" data-me-go="stock-needs" data-tab="' +
        tab +
        '">' +
        c +
        esc(TEXT.ordersUnit) +
        '</a></dd></div>'
      );
    };
    b.innerHTML =
      '<h3 class="me-pt-sub" id="meStockNeedsNumbersTitle">' +
      esc(TEXT.dash) +
      '</h3>' +
      (J.orders.length
        ? '<dl class="od-kpi as-kpi">' +
          cell('short', ORDER_NAME.short, 'short', true) +
          cell('unlinked', ORDER_NAME.unlinked, 'unlinked', true) +
          cell('expected', ORDER_NAME.expected, 'expected', false) +
          cell('ok', ORDER_NAME.ok, 'ok', false) +
          cell('issued', ORDER_NAME.issued, 'issued', false) +
          (n.nodoc ? cell('nodoc', ORDER_NAME.nodoc, 'all', false) : '') +
          '</dl>'
        : '<p class="me-empty">' + esc(TEXT.dashNone) + '</p>');
    b.hidden = false;
    if (!b.getAttribute('data-bound')) {
      b.setAttribute('data-bound', '1');
      b.addEventListener('click', onDashClick);
    }
  }

  /** 대시보드 칸을 눌렀다 — 그 상태 탭으로 맞춰 둔다 (화면 옮기기는 segan/me.js 가 한다) */
  function onDashClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('a[data-tab]') : null;
    if (!el || !J.ready || J.busy) return;
    var t = el.getAttribute('data-tab');
    J.tab = TABS.indexOf(t) >= 0 ? t : 'all';
    J.view = 'orders';
    J.open = '';
    J.mode = '';
    render();
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
    renderDash();
  }

  function find(id) {
    return J.orders.filter(function (o) {
      return o.id === id;
    })[0];
  }

  async function reload() {
    var r = await call('GET', '/stock/needs');
    var d = r.ok ? dataOf(r.body.data) : null;
    if (!d) return false;
    J.orders = d.orders;
    J.materials = d.materials;
    J.canManage = d.canManage;
    return true;
  }

  function touchStock() {
    ['SeganStock', 'SeganStockMoves', 'SeganStockOffcuts'].forEach(function (name) {
      var m = window[name];
      if (m && typeof m.refresh === 'function') m.refresh();
    });
  }

  function clearNote() {
    J.msg = '';
    J.err = '';
  }

  async function openLinks() {
    J.view = 'links';
    J.open = '';
    J.mode = '';
    clearNote();
    if (J.canManage && !J.stock) {
      J.busy = true;
      render();
      var r = await call('GET', '/stock/items');
      var items = r.ok ? obj(r.body.data).items : null;
      J.busy = false;
      if (Array.isArray(items))
        J.stock = items
          .map(function (v) {
            var i = obj(v);
            return str(i.id) && str(i.name).trim() && i.active !== false
              ? {
                  id: i.id,
                  kind: i.kind === 'board' ? 'board' : 'hardware',
                  name: str(i.name).trim(),
                  spec: str(i.spec).trim(),
                  unit: str(i.unit).trim(),
                }
              : null;
          })
          .filter(Boolean);
      else J.err = r.ok ? TEXT.itemsFail : errText(r);
    }
    render();
    focusOn('[data-act="view"][aria-pressed="true"]');
  }

  async function saveLink(key, value) {
    var m = J.materials.filter(function (x) {
      return x.key === key;
    })[0];
    if (!m || J.busy) return;
    clearNote();
    J.busy = true;
    render();
    var body = { key: key, label: m.label };
    if (value === '-') body.ignored = true;
    else if (value) body.item_id = value;
    var r = await call('PUT', '/stock/links', body);
    if (r.ok) {
      await reload();
      J.msg = value ? TEXT.linked : TEXT.unlinked;
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn('[data-link="' + String(key).replace(/["\\]/g, '\\$&') + '"]');
  }

  async function saveIssue() {
    keep();
    var o = find(J.open);
    if (!o) return;
    var made = issueBody(issueRows(o), J.qty);
    clearNote();
    if (made.error) {
      J.err = made.error;
      render();
      focusOn('[data-q="' + made.focus + '"]');
      return;
    }
    J.busy = true;
    render();
    var r = await call('POST', '/stock/needs/' + encodeURIComponent(o.id) + '/issue', made.body);
    if (r.ok) {
      await reload();
      J.mode = '';
      J.qty = {};
      J.msg = TEXT.issued;
      touchStock();
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn(r.ok ? '[data-act="open"][aria-expanded="true"]' : '[data-act="save-issue"]');
  }

  async function loadCands(id) {
    J.cands = null;
    var r = await call('GET', '/stock/needs/' + encodeURIComponent(id) + '/offcuts');
    if (J.open !== id || J.mode !== 'offcuts') return;
    var items = r.ok ? obj(r.body.data).items : null;
    J.cands = Array.isArray(items)
      ? items
          .map(function (v) {
            var c = obj(v);
            var w = num(c.width_mm);
            var h = num(c.height_mm);
            var t = num(c.thickness_mm);
            return str(c.material).trim() && w > 0 && h > 0 && t > 0
              ? {
                  material: str(c.material).trim(),
                  thickness: t,
                  width: w,
                  height: h,
                  sheet: num(c.sheet_no) || 0,
                  done: false,
                }
              : null;
          })
          .filter(Boolean)
      : false;
    render();
  }

  async function register(i) {
    var o = find(J.open);
    var c = Array.isArray(J.cands) ? J.cands[i] : null;
    if (!o || !c || c.done) return;
    clearNote();
    J.busy = true;
    render();
    var r = await call('POST', '/stock/offcuts', {
      material: c.material,
      thickness_mm: c.thickness,
      width_mm: c.width,
      height_mm: c.height,
      memo: o.no + TEXT.memoSuffix,
    });
    if (r.ok) {
      c.done = true;
      touchStock();
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn('[data-sn2="cands"] [data-act]');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    var o = find(J.open);
    if (act === 'view') {
      if (el.getAttribute('data-view') === 'links') openLinks();
      else {
        J.view = 'orders';
        clearNote();
        render();
        focusOn('[data-act="view"][aria-pressed="true"]');
      }
    } else if (act === 'tab') {
      J.tab = TABS.indexOf(el.getAttribute('data-tab')) >= 0 ? el.getAttribute('data-tab') : 'all';
      J.open = '';
      J.mode = '';
      clearNote();
      render();
      focusOn('[data-act="tab"][aria-pressed="true"]');
    } else if (act === 'open') {
      var id = el.getAttribute('data-id') || '';
      J.open = J.open === id ? '' : id;
      J.mode = '';
      J.qty = {};
      clearNote();
      render();
      focusOn('[data-act="open"][data-id="' + id + '"]');
    } else if (act === 'stop') {
      J.mode = '';
      J.qty = {};
      clearNote();
      render();
      focusOn('[data-act="open"][aria-expanded="true"]');
    } else if (!o) return;
    else if (act === 'issue' && !o.issued) {
      J.mode = 'issue';
      J.qty = {};
      clearNote();
      render();
      focusOn('[data-q]');
    } else if (act === 'save-issue') saveIssue();
    else if (act === 'offcuts') {
      J.mode = 'offcuts';
      J.cands = null;
      clearNote();
      render();
      loadCands(o.id);
    } else if (act === 'register') register(Number(el.getAttribute('data-i')));
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute || !el.hasAttribute('data-link') || !J.canManage) return;
    saveLink(el.getAttribute('data-link'), el.value);
  }

  function onKey(e) {
    if (e.key !== 'Enter' || J.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !el.hasAttribute('data-q')) return;
    e.preventDefault();
    saveIssue();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('change', onChange);
    b.addEventListener('keydown', onKey);
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.me = me || null;
    J.orders = [];
    J.materials = [];
    J.view = 'orders';
    J.tab = 'all';
    J.open = '';
    J.mode = '';
    J.qty = {};
    J.cands = null;
    J.stock = null;
    J.canManage = false;
    J.busy = false;
    clearNote();
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reload())) return;
      bind();
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  /** 다른 화면이 재고를 바꿨다 (입고 · 발주 등) — 조용히 다시 읽는다 */
  async function refresh() {
    if (!J.ready || J.busy) return;
    try {
      if (await reload()) render();
    } catch {
      /* 다음에 다시 읽는다 */
    }
  }

  window.SeganStockNeeds = {
    LINE_NAME: LINE_NAME,
    ORDER_NAME: ORDER_NAME,
    TEXT: TEXT,
    canSee: canSee,
    lineOf: lineOf,
    orderOf: orderOf,
    materialOf: materialOf,
    dataOf: dataOf,
    issueRows: issueRows,
    issueBody: issueBody,
    state: J,
    load: load,
    refresh: refresh,
  };
})();
