/* ============================================================
   segan/stock.js — 「구매 · 재고 › 기본 자재 · 철물」 (segan/me.html #stockBoard · #stockHardware)

   판재(기본 자재) · 철물의 남은 수량을 적는 화면. 두 화면은 같은 틀이고 종류만 다르다.
   (마이페이지 B안 6단계 — 2026-11-12 사장님 결정: 입고 · 출고는 구성원 누구나, 품목 더하기 · 안전 재고 ·
    실사 조정은 대표 · 실장, 입고 예정은 손으로 적는다)

   누가 보나  다담 공장 구성원 · 협력업체 Expert · Agent 구성원 (segan/me.js FACTORY_PLANS — 구매 · 재고 메뉴와 같다).
             다담 본사 구성원 · Manager 업체 · 고객에게는 묻지도 않는다. 대표 · 실장인지는 서버 답(can_manage)을 따른다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganStock.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /stock/items               { can_manage, priced, suppliers[{ id, name }], items[…] }
                                                단가(unit_price) · priced 는 대표 · 실장 답에만 온다 — 왔을 때만 단가 칸을 그린다
               POST  /stock/items               품목 더하기 (대표 · 실장)
               PATCH /stock/items/:id           고치기 · 숨기기 · 입고 예정 (대표 · 실장)
               POST  /stock/items/:id/moves     { kind: in|out|adjust, qty, ref?, note? } → { move, item }
               GET   /stock/moves?item=<id>     그 품목의 입출고 기록
   화면      탭(전체 · 부족 · 입고 예정 · 숨김) · 공급처로 거르기 → 줄(품목 · 규격 · 남은 수량 · 안전 재고 · 상태 · 공급처).
             줄을 누르면 그 자리에 상세 — 입고 · 출고 · 실사 조정 적기, 고치기, 숨기기, 최근 기록.
             실사 조정은 「세어 본 수량」을 적는다 — 지금 수량과의 차이를 기록으로 보낸다.
   없는 것    지우기 (서버에 없다 — 숨기기만). 기록 고치기 (추가만 — 잘못 적었으면 반대로 한 번 더 적는다).
   못 읽으면  칸째 감춘다 (오류 · 끊김 · 권한 없음 · DB 적용 전) — 그때 메뉴는 「준비 중」 안내로 남는다 (segan/me.js).
   정보      품목 · 공급처 이름 · 메모는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다. 고객 정보는 다루지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var KINDS = ['board', 'hardware'];
  var BOX = { board: 'stockBoard', hardware: 'stockHardware' };
  var TITLE_ID = { board: 'stockBoardTitle', hardware: 'stockHardwareTitle' };
  var KIND_NAME = { board: '기본 자재', hardware: '철물' };
  var UNIT0 = { board: '장', hardware: '개' };
  var PLANS = ['expert', 'agent']; // segan/me.js FACTORY_PLANS 와 같다
  var MOVES = ['in', 'out', 'adjust'];
  var MOVE_NAME = { in: '입고', out: '출고', adjust: '실사 조정' };
  var TABS = ['all', 'short', 'expected', 'hidden'];
  var LIMIT = { name: 80, spec: 80, unit: 8, memo: 300, ref: 60, note: 200 };
  var RECENT = 10; // 상세에 보이는 최근 기록 수

  var TEXT = {
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: {
      board: '판재(보드)의 남은 장수입니다. 들어오고 나갈 때마다 적으면 남은 수량이 맞춰집니다.',
      hardware:
        '경첩 · 레일 같은 철물의 남은 수량입니다. 안전 재고보다 적어지면 「부족」으로 보입니다.',
    },
    tab: { all: '전체', short: '부족', expected: '입고 예정', hidden: '숨김' },
    supplierAll: '공급처 모두',
    supplierNone: '고르지 않음',
    add: { board: '기본 자재 더하기', hardware: '철물 더하기' },
    addTitle: '새 품목',
    editTitle: '고치기',
    name: '품목',
    spec: '규격 (선택)',
    unit: '단위',
    safety: '안전 재고',
    supplier: '공급처 (선택)',
    first: '지금 수량 (선택)',
    price: '단가 (원, 선택)',
    priceFact: '단가',
    worth: '재고 금액',
    won: '원',
    needPrice: '단가는 0 이상의 원 단위 숫자로 적어 주세요.',
    memo: '메모 (선택)',
    expectedQty: '입고 예정 수량',
    expectedOn: '받을 날',
    expectedHint: '입고 예정은 수량과 받을 날을 같이 적습니다. 둘 다 비우면 지워집니다.',
    save: '저장',
    put: '넣기',
    stop: '그만두기',
    edit: '고치기',
    hide: '숨기기',
    show: '다시 쓰기',
    empty: {
      all: '아직 품목이 없습니다.',
      short: '안전 재고보다 적은 품목이 없습니다.',
      expected: '입고 예정인 품목이 없습니다.',
      hidden: '숨긴 품목이 없습니다.',
    },
    emptyStaff: '아직 품목이 없습니다. 대표 · 실장이 품목을 더하면 여기에 보입니다.',
    left: '남은 수량',
    stShort: '부족',
    stOk: '재고 있음',
    stExpected: '입고 예정',
    stHidden: '숨김',
    qty: '수량',
    counted: '세어 본 수량',
    ref: '어디에 썼는지 (선택)',
    refHint: '작업 번호처럼 짧게 적습니다. 고객 이름 · 전화는 적지 않습니다.',
    moveNote: '메모 (선택)',
    write: '적기',
    adjustHint: '세어 본 수량을 적으면 지금 수량과의 차이가 기록으로 남습니다.',
    same: '지금 수량과 같습니다.',
    needName: '품목 이름을 적어 주세요.',
    needUnit: '단위를 적어 주세요.',
    needQty: '수량을 숫자로 적어 주세요.',
    needExpected: '입고 예정은 수량과 받을 날을 같이 적어 주세요.',
    added: '더했습니다.',
    saved: '고쳤습니다.',
    hid: '숨겼습니다. 기록은 그대로 남습니다.',
    shown: '다시 씁니다.',
    wrote: '적었습니다.',
    history: '최근 기록',
    historyNone: '아직 기록이 없습니다.',
    historyFail: '기록을 읽지 못했습니다.',
    historyWait: '기록을 읽는 중입니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false,
    canManage: false,
    priced: false, // 단가 칸을 쓰나 — 서버가 대표 · 실장에게 priced: true 라고 했을 때만
    items: [],
    suppliers: [],
    view: { board: fresh(), hardware: fresh() },
    busy: false,
  };

  /** 화면 하나의 상태 — tab 탭 · supplier 거르기 · open 연 줄 · mode 연 줄에서 하는 일('' | edit) · adding 더하는 중 ·
      move 적는 종류 · form 적던 글 · msg · err · moves 연 줄의 기록(null = 읽는 중, false = 못 읽음) */
  function fresh() {
    return {
      tab: 'all',
      supplier: '',
      open: '',
      mode: '',
      adding: false,
      move: 'in',
      form: {},
      msg: '',
      err: '',
      moves: null,
    };
  }

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

  /** 이 화면을 물어볼 사람인가 — 다담 공장 구성원 · Expert · Agent 업체 구성원 */
  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  /** 수량 글 — 천 단위 쉼표, 소수는 둘째 자리까지 */
  function qtyText(n) {
    var v = num(n);
    if (v === null) return '0';
    return (Math.round(v * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }

  /** 'YYYY-MM-DD' → 'MM.DD' */
  function dayText(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(d));
    return m ? m[2] + '.' + m[3] : '';
  }

  /** ISO 때 → 'MM.DD HH:mm' (한국 시간) */
  function whenText(iso) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return (
      p(k.getUTCMonth() + 1) +
      '.' +
      p(k.getUTCDate()) +
      ' ' +
      p(k.getUTCHours()) +
      ':' +
      p(k.getUTCMinutes())
    );
  }

  /** 서버가 준 품목 하나 — 모르는 종류 · 이름 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = str(r.id);
    var name = str(r.name).trim();
    if (!id || !name || KINDS.indexOf(r.kind) < 0) return null;
    var s = obj(r.supplier);
    var qty = num(r.qty) || 0;
    var safety = num(r.safety_qty) || 0;
    var eq = num(r.expected_qty);
    var active = r.active !== false;
    return {
      id: id,
      kind: r.kind,
      name: name,
      spec: str(r.spec).trim(),
      unit: str(r.unit).trim() || UNIT0[r.kind],
      qty: qty,
      safety: safety,
      short: active && qty < safety,
      supplier: str(s.id) && str(s.name) ? { id: s.id, name: s.name } : null,
      expectedQty: eq !== null && eq > 0 && dayText(r.expected_on) ? eq : null,
      expectedOn: eq !== null && eq > 0 && dayText(r.expected_on) ? r.expected_on : '',
      memo: str(r.memo).trim(),
      price: num(r.unit_price), // 대표 · 실장 답에만 온다 (없으면 null)
      active: active,
    };
  }

  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  function moveOf(v) {
    var r = obj(v);
    var qty = num(r.qty);
    if (!str(r.id) || MOVES.indexOf(r.kind) < 0 || qty === null) return null;
    return {
      id: r.id,
      kind: r.kind,
      qty: qty,
      after: num(r.qty_after),
      ref: str(r.ref).trim(),
      note: str(r.note).trim(),
      by: str(r.by).trim(),
      at: str(r.created_at),
    };
  }

  /** 탭에 드는가 */
  function inTab(c, tab) {
    if (tab === 'hidden') return !c.active;
    if (!c.active) return false;
    if (tab === 'short') return c.short;
    if (tab === 'expected') return c.expectedQty !== null;
    return true;
  }

  function kindRows(kind) {
    return J.items.filter(function (c) {
      return c.kind === kind;
    });
  }

  /** 지금 보이는 줄 — 탭 · 공급처 */
  function rowsOf(kind) {
    var v = J.view[kind];
    return kindRows(kind).filter(function (c) {
      return inTab(c, v.tab) && (!v.supplier || (c.supplier && c.supplier.id === v.supplier));
    });
  }

  function countOf(kind, tab) {
    return kindRows(kind).filter(function (c) {
      return inTab(c, tab);
    }).length;
  }

  /** 줄 상태 글 — [{ text, warn }] */
  function statusOf(c) {
    if (!c.active) return [{ text: TEXT.stHidden }];
    var out = [];
    if (c.short) out.push({ text: TEXT.stShort, warn: true });
    if (c.expectedQty !== null) out.push({ text: TEXT.stExpected + ' ' + dayText(c.expectedOn) });
    if (!out.length) out.push({ text: TEXT.stOk });
    return out;
  }

  /** 기록 한 줄 글 — '입고 200개 — 철물 업체 C' */
  function moveText(m, unit) {
    var head =
      m.kind === 'adjust'
        ? MOVE_NAME.adjust + ' ' + (m.qty > 0 ? '+' : '−') + qtyText(Math.abs(m.qty)) + unit
        : MOVE_NAME[m.kind] + ' ' + qtyText(m.qty) + unit;
    var tail = [m.ref, m.note].filter(Boolean).join(' · ');
    return head + (tail ? ' — ' + tail : '');
  }

  /** 적는 칸 → 서버로 보낼 입출고 몸. 틀리면 { error } */
  function moveBody(kind, form, item) {
    var f = obj(form);
    var n = num(f.qty);
    if (n === null) return { error: TEXT.needQty };
    var body = { kind: kind };
    if (kind === 'adjust') {
      if (n < 0) return { error: TEXT.needQty };
      var d = Math.round((n - item.qty) * 100) / 100;
      if (d === 0) return { error: TEXT.same };
      body.qty = d;
    } else {
      if (n <= 0) return { error: TEXT.needQty };
      body.qty = n;
    }
    if (kind === 'out' && str(f.ref).trim()) body.ref = str(f.ref).trim();
    if (str(f.note).trim()) body.note = str(f.note).trim();
    return { body: body };
  }

  /** 품목 칸 → 서버로 보낼 몸 (id 가 있으면 고치기). 틀리면 { error, focus } */
  function itemBody(kind, form, editing, priced) {
    var f = obj(form);
    var name = str(f.name).trim();
    var unit = str(f.unit).trim();
    if (!name) return { error: TEXT.needName, focus: 'name' };
    if (!unit) return { error: TEXT.needUnit, focus: 'unit' };
    var safety = str(f.safety).trim() ? num(f.safety) : 0;
    if (safety === null || safety < 0) return { error: TEXT.needQty, focus: 'safety' };
    var body = {
      name: name,
      spec: str(f.spec).trim(),
      unit: unit,
      safety_qty: safety,
      supplier_id: str(f.supplier) || null,
      memo: str(f.memo).trim() || null,
    };
    if (priced) {
      var pt = str(f.price).trim().replace(/,/g, '');
      if (!pt) body.unit_price = null;
      else {
        var price = num(pt);
        if (price === null || price < 0 || Math.round(price) !== price)
          return { error: TEXT.needPrice, focus: 'price' };
        body.unit_price = price;
      }
    }
    if (editing) {
      var eq = str(f.expectedQty).trim();
      var eo = str(f.expectedOn).trim();
      if (!eq && !eo) {
        body.expected_qty = null;
        body.expected_on = null;
      } else {
        var q = num(eq);
        if (q === null || q <= 0 || !dayText(eo))
          return { error: TEXT.needExpected, focus: 'expectedQty' };
        body.expected_qty = q;
        body.expected_on = eo;
      }
    } else {
      body.kind = kind;
      if (str(f.first).trim()) {
        var first = num(f.first);
        if (first === null || first < 0) return { error: TEXT.needQty, focus: 'first' };
        if (first > 0) body.qty = first;
      }
    }
    return { body: body };
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

  function input(kind, key, label, value, o) {
    var opt = o || {};
    var id = BOX[kind] + '-' + key;
    return (
      '<label class="mk-input ps-field st-field' +
      (opt.wide ? ' cp-wide' : '') +
      '" for="' +
      id +
      '"><span>' +
      esc(label) +
      '</span><input id="' +
      id +
      '" data-f="' +
      key +
      '" type="' +
      (opt.type || 'text') +
      '"' +
      (opt.num ? ' inputmode="decimal"' : '') +
      (opt.max ? ' maxlength="' + opt.max + '"' : '') +
      ' autocomplete="off" value="' +
      esc(value == null ? '' : value) +
      '"' +
      dis() +
      '></label>'
    );
  }

  function supplierSelect(kind, picked) {
    var id = BOX[kind] + '-supplier';
    var opts = [['', TEXT.supplierNone]].concat(
      J.suppliers.map(function (s) {
        return [s.id, s.name];
      })
    );
    return (
      '<label class="mk-input ps-field st-field" for="' +
      id +
      '"><span>' +
      esc(TEXT.supplier) +
      '</span><select id="' +
      id +
      '" data-f="supplier"' +
      dis() +
      '>' +
      opts
        .map(function (p) {
          return (
            '<option value="' +
            esc(p[0]) +
            '"' +
            (p[0] === picked ? ' selected' : '') +
            '>' +
            esc(p[1]) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  function noteHtml(v) {
    return (
      '<p class="mk-error" data-st="err" role="alert"' +
      (v.err ? '' : ' hidden') +
      '>' +
      esc(v.err) +
      '</p>'
    );
  }

  /** 품목 칸 — 더하기(위) · 고치기(연 줄 안) */
  function itemFormHtml(kind, editing) {
    var v = J.view[kind];
    var f = v.form;
    return (
      '<div class="cp-form st-form" data-st="form"><h4 class="od-h">' +
      esc(editing ? TEXT.editTitle : TEXT.addTitle) +
      '</h4><div class="ps-grid cp-grid">' +
      input(kind, 'name', TEXT.name, f.name, { max: LIMIT.name }) +
      input(kind, 'spec', TEXT.spec, f.spec, { max: LIMIT.spec }) +
      input(kind, 'unit', TEXT.unit, f.unit, { max: LIMIT.unit }) +
      input(kind, 'safety', TEXT.safety, f.safety, { num: true }) +
      supplierSelect(kind, str(f.supplier)) +
      (editing
        ? input(kind, 'expectedQty', TEXT.expectedQty, f.expectedQty, { num: true }) +
          input(kind, 'expectedOn', TEXT.expectedOn, f.expectedOn, { type: 'date' })
        : input(kind, 'first', TEXT.first, f.first, { num: true })) +
      (J.priced ? input(kind, 'price', TEXT.price, f.price, { num: true }) : '') +
      input(kind, 'memo', TEXT.memo, f.memo, { max: LIMIT.memo, wide: true }) +
      '</div>' +
      (editing ? '<small class="cp-hint">' + esc(TEXT.expectedHint) + '</small>' : '') +
      noteHtml(v) +
      '<div class="ps-bar">' +
      btn('save-item', editing ? TEXT.save : TEXT.put, true) +
      btn('stop', TEXT.stop) +
      '</div></div>'
    );
  }

  function moveFormHtml(kind, c) {
    var v = J.view[kind];
    var kinds = J.canManage ? MOVES : ['in', 'out'];
    var mk = kinds.indexOf(v.move) >= 0 ? v.move : 'in';
    return (
      '<div class="st-move" data-st="move"><div class="cs-choices" role="group" aria-label="적을 종류">' +
      kinds
        .map(function (k) {
          return (
            '<button type="button" class="mk-btn' +
            (k === mk ? ' mk-btn--solid' : '') +
            '" data-act="move-kind" data-kind="' +
            k +
            '" aria-pressed="' +
            (k === mk) +
            '"' +
            dis() +
            '>' +
            esc(MOVE_NAME[k]) +
            '</button>'
          );
        })
        .join('') +
      '</div><div class="ps-grid cp-grid">' +
      input(
        kind,
        'qty',
        (mk === 'adjust' ? TEXT.counted : TEXT.qty) + ' (' + c.unit + ')',
        v.form.qty,
        { num: true }
      ) +
      (mk === 'out' ? input(kind, 'ref', TEXT.ref, v.form.ref, { max: LIMIT.ref }) : '') +
      input(kind, 'note', TEXT.moveNote, v.form.note, { max: LIMIT.note, wide: mk !== 'out' }) +
      '</div>' +
      (mk === 'adjust'
        ? '<small class="cp-hint">' + esc(TEXT.adjustHint) + '</small>'
        : mk === 'out'
          ? '<small class="cp-hint">' + esc(TEXT.refHint) + '</small>'
          : '') +
      noteHtml(v) +
      '<div class="ps-bar">' +
      btn('save-move', TEXT.write, true) +
      (J.canManage
        ? btn('edit', TEXT.edit) + btn('toggle', c.active ? TEXT.hide : TEXT.show)
        : '') +
      '<p class="me-pt-msg ps-msg" data-st="msg" role="status">' +
      esc(v.msg) +
      '</p></div></div>'
    );
  }

  function historyHtml(kind, c) {
    var v = J.view[kind];
    var body;
    if (v.moves === null) body = '<p class="me-empty">' + esc(TEXT.historyWait) + '</p>';
    else if (v.moves === false) body = '<p class="me-empty">' + esc(TEXT.historyFail) + '</p>';
    else if (!v.moves.length) body = '<p class="me-empty">' + esc(TEXT.historyNone) + '</p>';
    else
      body =
        '<ul class="st-history">' +
        v.moves
          .slice(0, RECENT)
          .map(function (m) {
            return (
              '<li><time>' +
              esc(whenText(m.at)) +
              '</time><span>' +
              esc(moveText(m, c.unit)) +
              '</span>' +
              (m.by ? '<small>' + esc(m.by) + '</small>' : '') +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    return (
      '<div class="st-hist" data-st="history"><h4 class="od-h">' +
      esc(TEXT.history) +
      '</h4>' +
      body +
      '</div>'
    );
  }

  function detailHtml(kind, c) {
    var v = J.view[kind];
    var facts = [
      [TEXT.left, qtyText(c.qty) + c.unit],
      [TEXT.safety, qtyText(c.safety) + c.unit],
    ];
    if (c.expectedQty !== null)
      facts.push([
        TEXT.stExpected,
        qtyText(c.expectedQty) + c.unit + ' · ' + dayText(c.expectedOn),
      ]);
    if (c.supplier) facts.push(['공급처', c.supplier.name]);
    if (J.priced && c.price !== null) {
      facts.push([TEXT.priceFact, qtyText(c.price) + TEXT.won]);
      facts.push([TEXT.worth, qtyText(Math.round(c.qty * c.price)) + TEXT.won]);
    }
    if (c.memo) facts.push(['메모', c.memo]);
    return (
      '<div class="st-detail" data-st="detail"><dl class="me-facts">' +
      facts
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>' +
      (v.mode === 'edit'
        ? itemFormHtml(kind, true)
        : c.active
          ? moveFormHtml(kind, c)
          : hiddenBarHtml(v)) +
      historyHtml(kind, c) +
      '</div>'
    );
  }

  /** 숨긴 품목 — 적지 못한다. 대표 · 실장에게 「다시 쓰기」만 */
  function hiddenBarHtml(v) {
    return (
      noteHtml(v) +
      '<div class="ps-bar">' +
      btn('toggle', TEXT.show, true) +
      '<p class="me-pt-msg ps-msg" data-st="msg" role="status">' +
      esc(v.msg) +
      '</p></div>'
    );
  }

  function rowHtml(kind, c) {
    var v = J.view[kind];
    var open = v.open === c.id;
    var sub = [c.spec, c.supplier ? c.supplier.name : ''].filter(Boolean).join(' · ');
    return (
      '<li class="me-cs-item st-item' +
      (c.active ? '' : ' me-cs-item--off') +
      '" data-st-row="' +
      esc(c.id) +
      '"><button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(c.id) +
      '" aria-expanded="' +
      open +
      '"' +
      dis() +
      '><span class="me-c-main"><b>' +
      esc(c.name) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span><span class="st-qty"><span><b>' +
      esc(qtyText(c.qty)) +
      '</b>' +
      esc(c.unit) +
      '</span><small>' +
      esc(TEXT.safety + ' ' + qtyText(c.safety)) +
      '</small></span><span class="ad-status st-status">' +
      statusOf(c)
        .map(function (s) {
          return (
            '<span class="od-badge' + (s.warn ? ' st-warn' : '') + '">' + esc(s.text) + '</span>'
          );
        })
        .join('') +
      '</span></button>' +
      (open ? detailHtml(kind, c) : '') +
      '</li>'
    );
  }

  function tabsHtml(kind) {
    var v = J.view[kind];
    return (
      '<div class="cs-choices oo-filter" role="group" aria-label="상태로 거르기">' +
      TABS.filter(function (t) {
        return t !== 'hidden' || (J.canManage && countOf(kind, 'hidden') > 0);
      })
        .map(function (t) {
          var on = v.tab === t;
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
            countOf(kind, t) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** 품목에 붙은 공급처로 거르기 — 둘 이상일 때만 */
  function supplierFilterHtml(kind) {
    var seen = {};
    var list = [];
    kindRows(kind).forEach(function (c) {
      if (c.supplier && !seen[c.supplier.id]) {
        seen[c.supplier.id] = true;
        list.push(c.supplier);
      }
    });
    if (list.length < 2) return '';
    var v = J.view[kind];
    return (
      '<label class="mk-input st-supplier" for="' +
      BOX[kind] +
      '-by"><span>공급처</span><select id="' +
      BOX[kind] +
      '-by" data-st="supplier"' +
      dis() +
      '><option value="">' +
      esc(TEXT.supplierAll) +
      '</option>' +
      list
        .map(function (s) {
          return (
            '<option value="' +
            esc(s.id) +
            '"' +
            (s.id === v.supplier ? ' selected' : '') +
            '>' +
            esc(s.name) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  function box(kind) {
    return $(BOX[kind]);
  }

  function kindOfEl(el) {
    var b = el && el.closest ? el.closest('#' + BOX.board + ',#' + BOX.hardware) : null;
    return b ? (b.id === BOX.board ? 'board' : 'hardware') : '';
  }

  /** 지금 칸에 적힌 것을 상태로 — 다시 그려도 적던 글이 남는다 */
  function keep(kind) {
    var b = box(kind);
    if (!b) return;
    b.querySelectorAll('[data-f]').forEach(function (el) {
      J.view[kind].form[el.getAttribute('data-f')] = el.value;
    });
  }

  function render(kind) {
    var b = box(kind);
    if (!b || !J.ready) return;
    var v = J.view[kind];
    var rows = rowsOf(kind);
    var none = !kindRows(kind).length;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="' +
      TITLE_ID[kind] +
      '">' +
      esc(KIND_NAME[kind]) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note[kind]) +
      '</p>' +
      (J.canManage
        ? v.adding
          ? itemFormHtml(kind, false)
          : '<div class="ps-bar st-top">' +
            btn('add', TEXT.add[kind], true) +
            '<p class="me-pt-msg ps-msg" data-st="topmsg" role="status">' +
            esc(v.open ? '' : v.msg) +
            '</p></div>'
        : '') +
      tabsHtml(kind) +
      supplierFilterHtml(kind) +
      (rows.length
        ? '<ul class="me-cs-list oo-list st-list">' +
          rows
            .map(function (c) {
              return rowHtml(kind, c);
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' +
          esc(none && !J.canManage ? TEXT.emptyStaff : TEXT.empty[v.tab]) +
          '</p>');
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  function renderAll() {
    KINDS.forEach(render);
  }

  function focusOn(kind, sel) {
    var b = box(kind);
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function hide() {
    KINDS.forEach(function (k) {
      var b = box(k);
      if (b) {
        b.hidden = true;
        b.innerHTML = '';
        b.removeAttribute('aria-busy');
      }
    });
    J.ready = false;
  }

  function find(id) {
    return J.items.filter(function (c) {
      return c.id === id;
    })[0];
  }

  async function reloadList() {
    var r = await call('GET', '/stock/items');
    var list = r.ok ? listOf(r.body.data) : null;
    if (!list) return false;
    var d = obj(r.body.data);
    J.items = list;
    J.canManage = d.can_manage === true;
    J.priced = J.canManage && d.priced === true;
    J.suppliers = (Array.isArray(d.suppliers) ? d.suppliers : [])
      .map(function (s) {
        return { id: str(obj(s).id), name: str(obj(s).name) };
      })
      .filter(function (s) {
        return s.id && s.name;
      });
    return true;
  }

  async function loadMoves(kind, id) {
    var v = J.view[kind];
    v.moves = null;
    var r = await call('GET', '/stock/moves?item=' + encodeURIComponent(id));
    if (v.open !== id) return; // 그 사이 다른 줄을 열었다
    var items = r.ok ? obj(r.body.data).items : null;
    v.moves = Array.isArray(items) ? items.map(moveOf).filter(Boolean) : false;
    var b = box(kind);
    var slot = b && b.querySelector('[data-st="history"]');
    var c = find(id);
    if (slot && c) slot.outerHTML = historyHtml(kind, c); // 기록 자리만 바꾼다 — 적던 글 · 초점이 그대로
  }

  function clearNote(v) {
    v.msg = '';
    v.err = '';
  }

  function open(kind, id) {
    var v = J.view[kind];
    var same = v.open === id;
    v.open = same ? '' : id;
    v.mode = '';
    v.adding = false;
    v.form = {};
    v.move = 'in';
    clearNote(v);
    render(kind);
    focusOn(kind, '[data-act="open"][data-id="' + id + '"]');
    if (!same && find(id)) loadMoves(kind, id);
  }

  function startAdd(kind) {
    var v = J.view[kind];
    v.adding = true;
    v.open = '';
    v.mode = '';
    v.form = { unit: UNIT0[kind] };
    clearNote(v);
    render(kind);
    focusOn(kind, '[data-f="name"]');
  }

  function startEdit(kind) {
    var v = J.view[kind];
    var c = find(v.open);
    if (!c) return;
    v.mode = 'edit';
    v.form = {
      name: c.name,
      spec: c.spec,
      unit: c.unit,
      safety: String(c.safety),
      supplier: c.supplier ? c.supplier.id : '',
      expectedQty: c.expectedQty === null ? '' : String(c.expectedQty),
      expectedOn: c.expectedOn,
      memo: c.memo,
      price: c.price === null ? '' : String(c.price),
    };
    clearNote(v);
    render(kind);
    focusOn(kind, '[data-f="name"]');
  }

  function stop(kind) {
    var v = J.view[kind];
    v.adding = false;
    v.mode = '';
    v.form = {};
    clearNote(v);
    render(kind);
    focusOn(kind, v.open ? '[data-act="open"][aria-expanded="true"]' : '[data-act="add"]');
  }

  async function saveItem(kind) {
    keep(kind);
    var v = J.view[kind];
    var editing = v.mode === 'edit' && !!v.open;
    var made = itemBody(kind, v.form, editing, J.priced);
    clearNote(v);
    if (made.error) {
      v.err = made.error;
      render(kind);
      focusOn(kind, '[data-f="' + made.focus + '"]');
      return;
    }
    J.busy = true;
    renderAll();
    var r = editing
      ? await call('PATCH', '/stock/items/' + encodeURIComponent(v.open), made.body)
      : await call('POST', '/stock/items', made.body);
    if (r.ok) {
      await reloadList();
      v.adding = false;
      v.mode = '';
      v.form = {};
      v.msg = editing ? TEXT.saved : TEXT.added;
    } else v.err = errText(r);
    J.busy = false;
    renderAll();
    focusOn(kind, r.ok ? (editing ? '[data-act="edit"]' : '[data-act="add"]') : '[data-f="name"]');
  }

  async function toggle(kind) {
    var v = J.view[kind];
    var c = find(v.open);
    if (!c) return;
    clearNote(v);
    J.busy = true;
    renderAll();
    var r = await call('PATCH', '/stock/items/' + encodeURIComponent(c.id), { active: !c.active });
    if (r.ok) {
      await reloadList();
      v.msg = c.active ? TEXT.hid : TEXT.shown;
      v.open = ''; // 탭에서 빠질 수 있다 — 줄을 닫고 위에 알린다
      if (v.tab === 'hidden' && !countOf(kind, 'hidden')) v.tab = 'all';
    } else v.err = errText(r);
    J.busy = false;
    renderAll();
    focusOn(kind, r.ok ? '[data-act="tab"][aria-pressed="true"]' : '[data-act="toggle"]');
  }

  async function saveMove(kind) {
    keep(kind);
    var v = J.view[kind];
    var c = find(v.open);
    if (!c) return;
    var mk = !J.canManage && v.move === 'adjust' ? 'in' : v.move;
    var made = moveBody(mk, v.form, c);
    clearNote(v);
    if (made.error) {
      v.err = made.error;
      render(kind);
      focusOn(kind, '[data-f="qty"]');
      return;
    }
    J.busy = true;
    renderAll();
    var r = await call('POST', '/stock/items/' + encodeURIComponent(c.id) + '/moves', made.body);
    if (r.ok) {
      if (!(await reloadList())) {
        var it = obj(obj(r.body.data).item);
        if (num(it.qty) !== null) c.qty = num(it.qty);
      }
      v.form = {};
      v.msg = TEXT.wrote;
    } else v.err = errText(r);
    J.busy = false;
    renderAll();
    focusOn(kind, '[data-f="qty"]');
    if (r.ok && find(c.id) && v.open === c.id) loadMoves(kind, c.id);
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var kind = kindOfEl(el);
    if (!kind) return;
    var v = J.view[kind];
    var act = el.getAttribute('data-act');
    if (act === 'tab') {
      v.tab = TABS.indexOf(el.getAttribute('data-tab')) >= 0 ? el.getAttribute('data-tab') : 'all';
      v.open = '';
      v.mode = '';
      clearNote(v);
      render(kind);
      focusOn(kind, '[data-act="tab"][aria-pressed="true"]');
    } else if (act === 'open') open(kind, el.getAttribute('data-id') || '');
    else if (act === 'add') startAdd(kind);
    else if (act === 'edit') startEdit(kind);
    else if (act === 'stop') stop(kind);
    else if (act === 'save-item') saveItem(kind);
    else if (act === 'toggle') toggle(kind);
    else if (act === 'save-move') saveMove(kind);
    else if (act === 'move-kind') {
      keep(kind);
      v.move =
        MOVES.indexOf(el.getAttribute('data-kind')) >= 0 ? el.getAttribute('data-kind') : 'in';
      v.form.qty = '';
      clearNote(v);
      render(kind);
      focusOn(kind, '[data-f="qty"]');
    }
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute || el.getAttribute('data-st') !== 'supplier') return;
    var kind = kindOfEl(el);
    if (!kind) return;
    J.view[kind].supplier = el.value;
    J.view[kind].open = '';
    render(kind);
    focusOn(kind, '[data-st="supplier"]');
  }

  /** 글 칸에서 Enter — 그 칸의 저장 */
  function onKey(e) {
    if (e.key !== 'Enter' || J.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !el.getAttribute('data-f')) return;
    var kind = kindOfEl(el);
    if (!kind) return;
    e.preventDefault();
    if (el.closest('[data-st="form"]')) saveItem(kind);
    else saveMove(kind);
  }

  function bind() {
    KINDS.forEach(function (k) {
      var b = box(k);
      if (!b || b.getAttribute('data-bound')) return;
      b.setAttribute('data-bound', '1');
      b.addEventListener('click', onClick);
      b.addEventListener('change', onChange);
      b.addEventListener('keydown', onKey);
    });
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.me = me || null;
    J.items = [];
    J.suppliers = [];
    J.canManage = false;
    J.priced = false;
    J.view = { board: fresh(), hardware: fresh() };
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reloadList())) return;
      bind();
      J.ready = true;
      renderAll();
    } catch {
      hide();
    }
  }

  window.SeganStock = {
    KINDS: KINDS,
    BOX: BOX,
    KIND_NAME: KIND_NAME,
    MOVE_NAME: MOVE_NAME,
    TEXT: TEXT,
    canSee: canSee,
    rowOf: rowOf,
    listOf: listOf,
    moveOf: moveOf,
    inTab: inTab,
    statusOf: statusOf,
    qtyText: qtyText,
    dayText: dayText,
    whenText: whenText,
    moveText: moveText,
    moveBody: moveBody,
    itemBody: itemBody,
    state: J,
    load: load,
  };
})();
