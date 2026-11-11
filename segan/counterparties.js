/* ============================================================
   segan/counterparties.js — 「구매 · 재고 › 거래처 · 공급처」 (segan/me.html #counterparties)

   PC 화면 admin/counterparties.html(거래처 · 공급처)을 마이페이지 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나)
   PC 화면은 사이트 관리자만 열 수 있었다. 서버는 처음부터 업체 대표 · 실장에게 그 업체의 목록을 준다
   (workflow-api counterparties.js counterpartyCompanyOf) — 수주 상세(segan/orders.js)가 고르는 목록이 이것이다.

   누가 보나  다담 공장 구성원(account-api GET /partner/me 의 hq_member — 대표 · 실장 · 사이트 관리자만 서버가 답한다) ·
             협력업체 Expert · Agent 의 대표 · 실장. 다담 본사 구성원 · Manager 업체 · 그 밖의 구성원 · 고객에게는
             그려지지 않는다. segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤
             SeganCounterparties.load(sb, session, partnerMe) 를 부른다. 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message })
               GET   /counterparties       { items[{ id, kind, name, category, phone, memo, active }] } — 이름 차례.
                                           표가 아직 없으면 items: null
               POST  /counterparties       { kind, name, category?, phone?, memo? } → 넣은 줄
               PATCH /counterparties/:id   { name?, category?, phone?, memo?, active? } → 고친 줄 (종류는 못 바꾼다)
   화면      넣는 칸(종류 · 이름 · 갈래 · 연락처 · 메모) → 거래처 줄 · 공급처 줄 (「고치기」 · 「숨기기」/「다시 쓰기」).
             숨긴 줄은 흐리게 남는다 — 이미 붙인 수주 · 원가는 그대로이고 「다시 쓰기」로 되돌린다 (되묻지 않는다).
   없는 것    지우기 (서버에 없다 — 숨기기만).
   못 읽으면  칸째 감춘다 (오류 · 끊김 · 권한 없음 · 표 없음). 바꾸기가 안 되면 서버 글을 그 자리에 적는다.
   정보      업체 이름 · 연락처 · 메모는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  // 종류 · 갈래 이름 — workflow-api counterparties.js (KIND_LABEL · CATEGORY_LABEL) · admin/counterparties.html 과 같다
  var KINDS = ['partner', 'supplier'];
  var KIND_NAME = { partner: '거래처', supplier: '공급처' };
  var KIND_OPTION = { partner: '거래처 (인테리어 업체)', supplier: '공급처 (사는 곳)' };
  var CATEGORY_NAME = {
    door: '도어',
    cut_edge: '재단 · 엣지',
    countertop: '상판',
    board: '원판',
    hardware: '철물',
    install: '시공',
    other: '기타',
  };
  var CATEGORIES = Object.keys(CATEGORY_NAME);
  var PLANS = ['expert', 'agent']; // 구매 · 재고 메뉴 — Expert 이상 (segan/me.js FACTORY_PLANS 와 같다)
  var ROLES = ['owner', 'manager']; // 대표 · 실장 (서버 counterpartyCompanyOf 와 같다)
  var LIMIT = { name: 100, phone: 40, memo: 1000 };

  var TEXT = {
    title: '거래처 · 공급처',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '거래처는 우리에게 주문하는 인테리어 업체, 공급처는 우리가 사는 곳입니다. 수주에 거래처를, 실적 원가에 공급처를 붙일 때 이 목록에서 고릅니다.',
    formNew: '새로 넣기',
    formEdit: '고치기',
    kind: '종류',
    name: '이름',
    category: '갈래 (선택)',
    categoryNone: '고르지 않음',
    phone: '연락처 (선택)',
    memo: '메모 (선택)',
    kindLocked: '종류는 넣은 뒤에 바꿀 수 없습니다.',
    add: '넣기',
    save: '저장',
    stop: '그만 고치기',
    edit: '고치기',
    hide: '숨기기',
    show: '다시 쓰기',
    hidden: '숨김',
    empty: '아직 없습니다. 위에서 넣어 주세요.',
    needName: '이름을 적어 주세요.',
    added: '넣었습니다.',
    saved: '고쳤습니다.',
    shown: '다시 씁니다.',
    hid: '숨겼습니다. 이미 붙인 수주 · 원가는 그대로입니다.',
    count: '곳',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false,
    items: [],
    form: blank(),
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

  /** 빈 넣는 칸 — id 가 있으면 고치는 중 */
  function blank() {
    return { id: '', kind: 'partner', name: '', category: '', phone: '', memo: '' };
  }

  /** 이 칸을 읽어 볼 사람인가 — 다담 공장 구성원(서버가 대표 · 실장 · 관리자만 답한다) · Expert · Agent 업체의 대표 · 실장.
      본사 구성원 · Manager 업체 · 그 밖의 구성원에게는 묻지도 않는다 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    return PLANS.indexOf(c.plan) >= 0 && ROLES.indexOf(c.role) >= 0;
  }

  /** 서버가 준 줄 하나 — 모르는 종류 · 이름 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    var name = str(r.name).trim();
    if (!id || !name || KINDS.indexOf(r.kind) < 0) return null;
    return {
      id: id,
      kind: r.kind,
      name: name,
      category: r.kind === 'supplier' && CATEGORIES.indexOf(r.category) >= 0 ? r.category : '',
      phone: str(r.phone).trim(),
      memo: str(r.memo).trim(),
      active: r.active !== false,
    };
  }

  /** 목록 — 배열이 아니면 null (표 없음 · 이상한 답 → 칸을 감춘다) */
  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  /** 한 종류의 줄 — 서버 차례(이름) 그대로 */
  function rowsOf(kind) {
    return J.items.filter(function (c) {
      return c.kind === kind;
    });
  }

  /** 줄 아랫글 — 갈래(공급처) · 연락처 · 숨김 */
  function subOf(c) {
    var parts = [];
    if (c.kind === 'supplier' && c.category) parts.push(CATEGORY_NAME[c.category]);
    if (c.phone) parts.push(c.phone);
    if (!c.active) parts.push(TEXT.hidden);
    return parts.join(' · ');
  }

  /** 넣는 칸에서 서버로 보낼 몸 — 고칠 때는 종류를 뺀다 (서버가 버린다). 갈래는 공급처만 */
  function bodyOf(form) {
    var f = obj(form);
    var kind = KINDS.indexOf(f.kind) >= 0 ? f.kind : 'partner';
    var body = { name: str(f.name).trim(), phone: str(f.phone).trim(), memo: str(f.memo).trim() };
    if (kind === 'supplier')
      body.category = CATEGORIES.indexOf(f.category) >= 0 ? f.category : null;
    if (!f.id) body.kind = kind;
    return body;
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

  function box() {
    return $('counterparties');
  }

  function btn(act, label, solid, extra) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (extra || '') +
      (J.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function optionsHtml(pairs, picked) {
    return pairs
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
      .join('');
  }

  function field(id, label, inner, extra) {
    return (
      '<label class="mk-input ps-field cp-field' +
      ((extra && extra.cls) || '') +
      '" for="' +
      id +
      '"' +
      (extra && extra.hidden ? ' hidden' : '') +
      (extra && extra.wrap ? ' data-cp="' + extra.wrap + '"' : '') +
      '><span>' +
      esc(label) +
      '</span>' +
      inner +
      '</label>'
    );
  }

  /** 넣는 칸 — 고치는 중이면 종류를 잠근다. 갈래는 공급처일 때만 */
  function formHtml() {
    var f = J.form;
    var editing = !!f.id;
    var dis = J.busy ? ' disabled' : '';
    var kinds = KINDS.map(function (k) {
      return [k, KIND_OPTION[k]];
    });
    var cats = [['', TEXT.categoryNone]].concat(
      CATEGORIES.map(function (k) {
        return [k, CATEGORY_NAME[k]];
      })
    );
    return (
      '<div class="cp-form" data-cp="form"><h4 class="od-h" id="counterpartiesFormTitle">' +
      esc(editing ? TEXT.formEdit + ' — ' + f.name0 : TEXT.formNew) +
      '</h4><div class="ps-grid cp-grid">' +
      field(
        'cpKind',
        TEXT.kind,
        '<select id="cpKind" data-f="kind"' +
          (editing ? ' disabled aria-describedby="cpKindNote"' : dis) +
          '>' +
          optionsHtml(kinds, f.kind) +
          '</select>' +
          (editing
            ? '<small class="cp-hint" id="cpKindNote">' + esc(TEXT.kindLocked) + '</small>'
            : '')
      ) +
      field(
        'cpName',
        TEXT.name,
        '<input id="cpName" data-f="name" type="text" maxlength="' +
          LIMIT.name +
          '" autocomplete="off" value="' +
          esc(f.name) +
          '"' +
          dis +
          '>'
      ) +
      field(
        'cpCategory',
        TEXT.category,
        '<select id="cpCategory" data-f="category"' +
          dis +
          '>' +
          optionsHtml(cats, f.category) +
          '</select>',
        { hidden: f.kind !== 'supplier', wrap: 'category' }
      ) +
      field(
        'cpPhone',
        TEXT.phone,
        '<input id="cpPhone" data-f="phone" type="text" inputmode="tel" maxlength="' +
          LIMIT.phone +
          '" autocomplete="off" value="' +
          esc(f.phone) +
          '"' +
          dis +
          '>'
      ) +
      field(
        'cpMemo',
        TEXT.memo,
        '<input id="cpMemo" data-f="memo" type="text" maxlength="' +
          LIMIT.memo +
          '" autocomplete="off" value="' +
          esc(f.memo) +
          '"' +
          dis +
          '>',
        { cls: ' cp-wide' }
      ) +
      '</div><p class="mk-error" data-cp="err" role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p><div class="ps-bar">' +
      btn('save', editing ? TEXT.save : TEXT.add, true) +
      (editing ? btn('stop', TEXT.stop) : '') +
      '<p class="me-pt-msg ps-msg" data-cp="msg" role="status">' +
      esc(J.msg) +
      '</p></div></div>'
    );
  }

  function rowHtml(c) {
    var sub = subOf(c);
    return (
      '<li class="me-cs-item cp-item' +
      (c.active ? '' : ' me-cs-item--off') +
      (J.form.id === c.id ? ' cp-item--on' : '') +
      '" data-cp-row="' +
      esc(c.id) +
      '"><div class="cp-row"><span class="me-c-main"><b>' +
      esc(c.name) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span><div class="rd-acts cp-acts">' +
      btn('edit', TEXT.edit, false, ' data-id="' + esc(c.id) + '"') +
      btn('toggle', c.active ? TEXT.hide : TEXT.show, false, ' data-id="' + esc(c.id) + '"') +
      '</div></div>' +
      (c.memo ? '<p class="cp-memo">' + esc(c.memo) + '</p>' : '') +
      '</li>'
    );
  }

  function listHtml(kind) {
    var rows = rowsOf(kind);
    return (
      '<section class="cp-sec" data-cp-kind="' +
      kind +
      '"><h4 class="od-h">' +
      esc(KIND_NAME[kind]) +
      ' <span class="cp-count">' +
      rows.length +
      esc(TEXT.count) +
      '</span></h4>' +
      (rows.length
        ? '<ul class="me-cs-list cp-list">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>') +
      '</section>'
    );
  }

  /** 지금 칸에 적힌 것을 상태로 — 다시 그려도 적던 글이 남는다 */
  function keep() {
    var b = box();
    if (!b) return;
    b.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.getAttribute('data-f');
      if (k === 'kind' && J.form.id) return; // 고치는 중에는 종류를 못 바꾼다
      J.form[k] = el.value;
    });
  }

  function showSection() {
    var b = box();
    var sec = $('partner');
    if (sec && b && !b.hidden) sec.hidden = false;
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="counterpartiesTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      formHtml() +
      KINDS.map(listHtml).join('');
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    showSection();
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

  /** 목록을 다시 읽는다 — 배열로 답했을 때만 true */
  async function reloadList() {
    var r = await call('GET', '/counterparties');
    var list = r.ok ? listOf(r.body.data) : null;
    if (!list) return false;
    J.items = list;
    return true;
  }

  /** 다시 읽기가 안 됐을 때 — 서버가 돌려준 줄만 목록에 끼운다 (이름 차례) */
  function upsert(v) {
    var row = rowOf(v);
    if (!row) return;
    var at = -1;
    J.items.forEach(function (c, i) {
      if (c.id === row.id) at = i;
    });
    if (at >= 0) J.items[at] = row;
    else J.items.push(row);
    J.items.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'ko');
    });
  }

  /** 목록이 바뀌었다 — 수주 상세(segan/orders.js)가 들고 있는 고르는 목록을 비워 다음에 다시 읽게 한다 */
  function touchOrders() {
    var O = window.SeganOrders;
    if (O && O.state && typeof O.state === 'object') O.state.cp = undefined;
  }

  async function after(r) {
    if (!(await reloadList())) upsert(r.body.data);
    touchOrders();
  }

  async function save() {
    keep();
    var f = J.form;
    J.msg = '';
    J.err = '';
    if (!str(f.name).trim()) {
      J.err = TEXT.needName;
      render();
      focusOn('#cpName');
      return;
    }
    var editing = !!f.id;
    J.busy = true;
    render();
    var r = editing
      ? await call('PATCH', '/counterparties/' + encodeURIComponent(f.id), bodyOf(f))
      : await call('POST', '/counterparties', bodyOf(f));
    if (r.ok) {
      await after(r);
      J.form = blank();
      if (!editing) J.form.kind = f.kind; // 같은 종류를 이어서 넣기 쉽게
      J.msg = editing ? TEXT.saved : TEXT.added;
    } else {
      J.err = errText(r);
    }
    J.busy = false;
    render();
    focusOn(r.ok ? '[data-act="save"]' : '#cpName');
  }

  function edit(id) {
    var c = J.items.filter(function (x) {
      return x.id === id;
    })[0];
    if (!c) return;
    J.form = {
      id: c.id,
      kind: c.kind,
      name: c.name,
      name0: c.name,
      category: c.category,
      phone: c.phone,
      memo: c.memo,
    };
    J.msg = '';
    J.err = '';
    render();
    var b = box();
    var form = b && b.querySelector('[data-cp="form"]');
    if (form && form.scrollIntoView) form.scrollIntoView({ block: 'nearest' });
    focusOn('#cpName');
  }

  function stop() {
    J.form = blank();
    J.msg = '';
    J.err = '';
    render();
    focusOn('#cpName');
  }

  async function toggle(id) {
    var c = J.items.filter(function (x) {
      return x.id === id;
    })[0];
    if (!c) return;
    keep();
    J.msg = '';
    J.err = '';
    J.busy = true;
    render();
    var r = await call('PATCH', '/counterparties/' + encodeURIComponent(id), { active: !c.active });
    if (r.ok) {
      await after(r);
      J.msg = c.active ? TEXT.hid : TEXT.shown;
    } else {
      J.err = errText(r);
    }
    J.busy = false;
    render();
    focusOn('[data-act="toggle"][data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (act === 'save') save();
    else if (act === 'stop') stop();
    else if (act === 'edit') edit(id);
    else if (act === 'toggle') toggle(id);
  }

  /** 종류를 바꾸면 갈래 칸을 보이거나 감춘다 (다시 그리지 않는다 — 적던 글 · 초점이 그대로) */
  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute || el.getAttribute('data-f') !== 'kind') return;
    var b = box();
    var wrap = b && b.querySelector('[data-cp="category"]');
    if (wrap) wrap.hidden = el.value !== 'supplier';
  }

  /** 글 칸에서 Enter — 저장 */
  function onKey(e) {
    if (e.key !== 'Enter' || J.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !el.getAttribute('data-f')) return;
    e.preventDefault();
    save();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('change', onChange);
    b.addEventListener('keydown', onKey);
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
    J.form = blank();
    J.msg = '';
    J.err = '';
    J.busy = false;
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

  window.SeganCounterparties = {
    KINDS: KINDS,
    KIND_NAME: KIND_NAME,
    CATEGORY_NAME: CATEGORY_NAME,
    TEXT: TEXT,
    canSee: canSee,
    rowOf: rowOf,
    listOf: listOf,
    subOf: subOf,
    bodyOf: bodyOf,
    state: J,
    load: load,
  };
})();
