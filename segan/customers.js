/* ============================================================
   segan/customers.js — 「프로젝트 관리 › 영업 › 고객」 (segan/me.html #customers)

   마이페이지 B안 5단계 — 업체 고객을 한 화면에 모아 보고, 이름 · 전화를 고친다.
   지금까지는 프로젝트 줄에 붙은 고객만 볼 수 있었고 고치는 길이 없었다 (이 화면은 「준비 중」이었다).

   누가 보나  프로젝트를 가지는 업체의 구성원 — 다담 공장 구성원(account-api GET /partner/me 의 hq_member) ·
             협력업체 Manager · Expert · Agent 구성원. 다담 본사 구성원 · 업체 없는 사람 · 고객에게는 그려지지 않는다.
             고치기 단추는 서버가 can_manage 를 준 사람(대표 · 실장)에게만 — 서버도 같은 판정으로 다시 막는다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganCustomers.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message })
               GET   /company/customers       { company, can_manage, items[{ id, name, phone, app_user, created_at,
                                                updated_at, projects[{ id, title, status, created_at }] }] } — 새 고객부터 200명
               PATCH /company/customers/:id   { name?, phone? } → { id, name, phone, updated_at } (phone 은 null 이면 지운다)
   화면      찾기(이름 · 전화 — 서버에 묻지 않고 거른다) → 몇 명 → 고객 줄(이름 · 전화(누르면 전화) · 앱 고객 표시 ·
             프로젝트 이름들) → 「더 보기」. 「고치기」를 누르면 그 줄에서 이름 · 전화 칸이 열린다 (한 번에 한 줄).
   안 바뀌는 것 이미 보낸 견적서 · 수주에 적힌 고객 이름과 현장 연락처는 그대로다 — 고객 목록의 이름 · 전화만 바뀐다.
   없는 것    새 고객 넣기(프로젝트를 만들 때 함께 넣는다) · 지우기(서버에 없다).
   못 읽으면  칸째 감춘다 — 고객 화면에는 마이페이지가 「불러오지 못했습니다」를 적는다.
   정보      고객 이름 · 전화는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 등급 (서버 PROJECT_PLANS)
  var NAME_MAX = 50; // 서버 CUSTOMER_NAME_MAX
  var PHONE_MAX = 20;
  var PHONE_RE = /^[0-9][0-9-]{7,19}$/; // 서버 PHONE_RE — 숫자 · 하이픈 8~20자
  var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' }; // segan/me.js 와 같다
  var PAGE = 50;

  var TEXT = {
    title: '고객',
    note: '우리 팩토리의 고객입니다. 새 고객은 프로젝트를 만들 때 함께 넣습니다. 이름 · 전화를 고쳐도 이미 보낸 견적서 · 수주에 적힌 이름은 그대로입니다.',
    noteView: '우리 팩토리의 고객입니다. 이름 · 전화는 대표 · 실장이 고칩니다.',
    search: '찾기',
    searchHint: '이름 · 전화',
    count: '명',
    all: '전체',
    empty: '고객이 없습니다. 프로젝트를 만들 때 고객을 함께 넣습니다.',
    emptyFilter: '맞는 고객이 없습니다.',
    noName: '이름 없음',
    noPhone: '전화 없음',
    appUser: '앱 고객',
    projects: '프로젝트',
    noProjects: '프로젝트 없음',
    untitled: '이름 없는 프로젝트',
    edit: '고치기',
    name: '이름',
    phone: '전화 (비우면 지웁니다)',
    save: '저장',
    stop: '그만 고치기',
    more: '더 보기',
    left: '남은',
    needName: '이름을 적어 주세요.',
    badPhone: '전화는 숫자와 - 로 8~20자입니다.',
    saved: '고쳤습니다.',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
  };

  var C = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    canManage: false,
    items: [],
    q: '',
    shown: PAGE,
    editing: '', // 고치는 고객 id
    form: { name: '', phone: '' },
    msg: '', // 고친 뒤 글 (msgId 줄에 적는다)
    msgId: '',
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

  /** 이 칸을 읽어 볼 사람인가 — 다담 공장 구성원 · 협력업체 Manager · Expert · Agent 구성원 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    return c.status === 'active' && PLANS.indexOf(c.plan) >= 0;
  }

  /** 서버가 준 고객 한 줄 — id 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' ? r.id : '';
    if (!id) return null;
    return {
      id: id,
      name: str(r.name).trim(),
      phone: str(r.phone).trim(),
      appUser: r.app_user === true,
      projects: (Array.isArray(r.projects) ? r.projects : []).map(obj).map(function (p) {
        return { title: str(p.title).trim(), status: str(p.status) };
      }),
    };
  }

  /** 목록 — 배열이 아니면 null (이상한 답 → 칸을 감춘다) */
  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  /** 전화에서 숫자만 */
  function digits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  /** 찾는 글로 거른다 — 이름(대소문자 없이) 또는 전화(숫자만 견준다) */
  function filtered(rows, q) {
    var needle = String(q == null ? '' : q)
      .trim()
      .toLowerCase();
    if (!needle) return rows;
    var num = digits(needle);
    return rows.filter(function (r) {
      return (
        r.name.toLowerCase().indexOf(needle) >= 0 ||
        (num.length >= 2 && digits(r.phone).indexOf(num) >= 0)
      );
    });
  }

  /** tel: 주소 — 서버 꼴(숫자 · 하이픈)일 때만 */
  function telHref(phone) {
    return PHONE_RE.test(phone) ? 'tel:' + phone : '';
  }

  /** 프로젝트 글 — '프로젝트 2건 — 싱크대 · 붙박이장 (끝남)' */
  function projectsText(r) {
    if (!r.projects.length) return TEXT.noProjects;
    return (
      TEXT.projects +
      ' ' +
      r.projects.length +
      '건 — ' +
      r.projects
        .map(function (p) {
          var st = Object.prototype.hasOwnProperty.call(PROJECT_STATUS, p.status)
            ? ' (' + PROJECT_STATUS[p.status] + ')'
            : '';
          return (p.title || TEXT.untitled) + st;
        })
        .join(' · ')
    );
  }

  /** 고치는 칸의 값 → 서버로 보낼 몸. 틀리면 { error, field } */
  function bodyOf(form) {
    var name = str(obj(form).name).trim();
    var phone = str(obj(form).phone).trim();
    if (!name) return { error: TEXT.needName, field: 'name' };
    if (phone && !PHONE_RE.test(phone)) return { error: TEXT.badPhone, field: 'phone' };
    return { body: { name: name, phone: phone || null } };
  }

  function countText(shownCount, total) {
    return (
      shownCount +
      TEXT.count +
      (shownCount !== total ? ' / ' + TEXT.all + ' ' + total + TEXT.count : '')
    );
  }

  async function token() {
    try {
      var r = C.sb && (await C.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return C.session ? C.session.access_token : '';
  }

  async function call(method, path, body) {
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(C.base + path, {
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

  function box() {
    return $('customers');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function formHtml(r) {
    var dis = C.busy ? ' disabled' : '';
    return (
      '<div class="cu-form" data-cu="form"><div class="ps-grid"><label class="mk-input ps-field cp-field" for="cuName"><span>' +
      esc(TEXT.name) +
      '</span><input id="cuName" data-f="name" type="text" maxlength="' +
      NAME_MAX +
      '" autocomplete="off" value="' +
      esc(C.form.name) +
      '"' +
      dis +
      '></label><label class="mk-input ps-field cp-field" for="cuPhone"><span>' +
      esc(TEXT.phone) +
      '</span><input id="cuPhone" data-f="phone" type="text" inputmode="tel" maxlength="' +
      PHONE_MAX +
      '" autocomplete="off" value="' +
      esc(C.form.phone) +
      '"' +
      dis +
      '></label></div><p class="mk-error" data-cu="err" role="alert"' +
      (C.err ? '' : ' hidden') +
      '>' +
      esc(C.err) +
      '</p><div class="ps-bar"><button type="button" class="mk-btn mk-btn--solid" data-act="save" data-id="' +
      esc(r.id) +
      '"' +
      dis +
      '>' +
      esc(TEXT.save) +
      '</button><button type="button" class="mk-btn" data-act="stop"' +
      dis +
      '>' +
      esc(TEXT.stop) +
      '</button></div></div>'
    );
  }

  function rowHtml(r) {
    var tel = telHref(r.phone);
    var editing = C.editing === r.id;
    return (
      '<li class="me-cs-item cp-item' +
      (editing ? ' cp-item--on' : '') +
      '" data-cu-row="' +
      esc(r.id) +
      '"><div class="cp-row"><span class="me-c-main"><b>' +
      esc(r.name || TEXT.noName) +
      '</b><small>' +
      (r.phone
        ? tel
          ? '<a class="mk-link" href="' + esc(tel) + '">' + esc(r.phone) + '</a>'
          : esc(r.phone)
        : esc(TEXT.noPhone)) +
      '</small></span>' +
      (r.appUser ? '<span class="me-badge cu-badge">' + esc(TEXT.appUser) + '</span>' : '') +
      (C.canManage && !editing
        ? '<div class="rd-acts cp-acts"><button type="button" class="mk-btn" data-act="edit" data-id="' +
          esc(r.id) +
          '"' +
          (C.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.edit) +
          '</button></div>'
        : '') +
      '</div><p class="cp-memo">' +
      esc(projectsText(r)) +
      '</p>' +
      (editing ? formHtml(r) : '') +
      (C.msg && C.msgId === r.id
        ? '<p class="me-pt-msg" data-cu="msg" role="status">' + esc(C.msg) + '</p>'
        : '') +
      '</li>'
    );
  }

  function listHtml() {
    if (!C.items.length) return '<p class="me-empty" data-cu="empty">' + esc(TEXT.empty) + '</p>';
    var list = filtered(C.items, C.q);
    var head =
      '<p class="me-pt-msg dr-status" data-cu="count" role="status">' +
      esc(countText(list.length, C.items.length)) +
      '</p>';
    if (!list.length)
      return head + '<p class="me-empty" data-cu="empty">' + esc(TEXT.emptyFilter) + '</p>';
    var left = list.length - C.shown;
    return (
      head +
      '<ul class="me-cs-list cp-list">' +
      list.slice(0, C.shown).map(rowHtml).join('') +
      '</ul>' +
      (left > 0
        ? '<button type="button" class="mk-btn al-more" data-act="more">' +
          esc(TEXT.more + ' (' + TEXT.left + ' ' + left + TEXT.count + ')') +
          '</button>'
        : '')
    );
  }

  function render() {
    var b = box();
    if (!b || !C.ready) return;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="customersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(C.canManage ? TEXT.note : TEXT.noteView) +
      '</p>' +
      (C.items.length
        ? '<div class="al-tools"><label class="mk-input al-field" for="cuSearch"><span>' +
          esc(TEXT.search) +
          '</span><input id="cuSearch" type="search" autocomplete="off" placeholder="' +
          esc(TEXT.searchHint) +
          '" value="' +
          esc(C.q) +
          '"></label></div>'
        : '') +
      '<div data-cu="list">' +
      listHtml() +
      '</div>';
    if (C.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  /** 목록만 다시 그린다 — 찾는 칸의 글 · 초점이 그대로 */
  function renderList() {
    var b = box();
    var el = b && b.querySelector('[data-cu="list"]');
    if (el) el.innerHTML = listHtml();
    if (b) {
      if (C.busy) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
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
    C.ready = false;
  }

  function find(id) {
    return (
      C.items.filter(function (r) {
        return r.id === id;
      })[0] || null
    );
  }

  function cssId(id) {
    return String(id).replace(/["\\]/g, '\\$&');
  }

  // ── 누른 일 ────────────────────────────────────────────
  function edit(id) {
    var r = find(id);
    if (!r || !C.canManage) return;
    C.editing = id;
    C.form = { name: r.name, phone: r.phone };
    C.err = '';
    C.msg = '';
    C.msgId = '';
    renderList();
    focusOn('#cuName');
  }

  function stop() {
    var id = C.editing;
    C.editing = '';
    C.err = '';
    renderList();
    focusOn('[data-act="edit"][data-id="' + cssId(id) + '"]');
  }

  /** 고치는 칸에 적힌 것을 상태로 */
  function keep() {
    var b = box();
    if (!b) return;
    b.querySelectorAll('[data-cu="form"] [data-f]').forEach(function (el) {
      C.form[el.getAttribute('data-f')] = el.value;
    });
  }

  async function save(id) {
    var r = find(id);
    if (!r || C.editing !== id || C.busy) return;
    keep();
    var out = bodyOf(C.form);
    C.msg = '';
    C.msgId = '';
    if (out.error) {
      C.err = out.error;
      renderList();
      focusOn(out.field === 'phone' ? '#cuPhone' : '#cuName');
      return;
    }
    C.err = '';
    C.busy = true;
    renderList();
    var res = await call('PATCH', '/company/customers/' + encodeURIComponent(id), out.body);
    C.busy = false;
    if (res.ok) {
      var d = obj(res.body.data);
      r.name = str(d.name).trim();
      r.phone = str(d.phone).trim();
      C.editing = '';
      C.msg = TEXT.saved;
      C.msgId = id;
      renderList();
      focusOn('[data-act="edit"][data-id="' + cssId(id) + '"]');
    } else {
      var m = res.body && res.body.message;
      C.err = typeof m === 'string' && m ? m : TEXT.generic;
      renderList();
      focusOn('#cuName');
    }
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || C.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (act === 'edit') edit(id);
    else if (act === 'stop') stop();
    else if (act === 'save') save(id);
    else if (act === 'more') {
      var at = C.shown;
      C.shown += PAGE;
      renderList();
      var b = box();
      var li = b && b.querySelectorAll('li[data-cu-row]')[at];
      if (li) {
        li.setAttribute('tabindex', '-1');
        li.focus();
      }
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || t.id !== 'cuSearch') return;
    keep();
    C.q = t.value;
    C.shown = PAGE;
    renderList();
  }

  /** 고치는 칸에서 Enter — 저장 */
  function onKey(e) {
    if (e.key !== 'Enter' || C.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !el.getAttribute('data-f')) return;
    e.preventDefault();
    save(C.editing);
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('input', onInput);
    b.addEventListener('keydown', onKey);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    C.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    C.sb = sb || null;
    C.session = session || null;
    C.items = [];
    C.canManage = false;
    C.q = '';
    C.shown = PAGE;
    C.editing = '';
    C.form = { name: '', phone: '' };
    C.msg = '';
    C.msgId = '';
    C.err = '';
    C.busy = false;
    if (!C.base || !session || !canSee(me)) return;
    try {
      var r = await call('GET', '/company/customers');
      var list = r.ok ? listOf(r.body.data) : null;
      if (!list) return;
      C.items = list;
      C.canManage = obj(r.body.data).can_manage === true;
      bind();
      C.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganCustomers = {
    PLANS: PLANS,
    NAME_MAX: NAME_MAX,
    PHONE_RE: PHONE_RE,
    PAGE: PAGE,
    TEXT: TEXT,
    canSee: canSee,
    rowOf: rowOf,
    listOf: listOf,
    filtered: filtered,
    telHref: telHref,
    projectsText: projectsText,
    bodyOf: bodyOf,
    countText: countText,
    state: C,
    load: load,
  };
})();
