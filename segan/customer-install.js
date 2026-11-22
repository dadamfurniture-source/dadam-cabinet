/* ============================================================
   segan/customer-install.js — 고객 초대 링크로 들어오기 · 고객이 설치 날 확인 (segan/me.html)

   2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 · 「진행」 (워커 workflow-api — DB 0082).

   고객 초대 링크  me.html#customer-invite=<토큰>  (업체 프로젝트 줄의 「고객 초대」가 만든 링크 — segan/partner-projects.js)
     토큰은 주소에서 바로 지우고 이 탭의 sessionStorage 에만 둔다 (로그인하러 갔다 와도 이어지게. 잇고 나면 지운다).
       POST /customer-invites/peek    { token } → { company_name, expires_at }   로그인 전에도 — 「가나 팩토리가 보낸 초대」
       POST /customer-invites/accept  { token } → { project_id, company_name }    「내 계정과 잇기」를 누르면
     로그인 전이면 로그인 칸 위에 「로그인하면 프로젝트가 이어집니다」. 거둠 · 만료 · 사용됨(410)이면 「업체에 새 링크를 받아 주세요」.
     이으면 페이지를 다시 열어 「내 프로젝트」에 그 프로젝트가 보이게 한다.

   설치 날 (내 프로젝트 줄 — segan/me.js 가 줄마다 slotHtml(p) 를 붙인다)
     줄의 install { id, scheduled_at, status, confirmed_at, change_requested_at } (GET /me/projects) 이 있고
     진행 중인 프로젝트 · 열린 설치 일정이면:
       확인 전   「이 날 좋아요」 · 「바꿔 주세요」
       확인함    「확인했습니다」 + 「바꿔 주세요」
       요청함    「바꿔 달라고 했습니다 — 업체가 날짜를 고치면 알려 드립니다」 + 「이 날 좋아요」
       POST /me/schedules/:id/confirm
       POST /me/schedules/:id/change  { note? }  — 「바꿔 주세요」는 같은 단추로 바라는 것 칸(200자)을 펼치고 접는다
     날짜는 업체가 고친다 (고객은 요청만).
   못 읽으면 · 옛 서버면 칸이 없다.
   ============================================================ */
/* global window, document, fetch, location, sessionStorage, history */
(function () {
  'use strict';

  var KEY = 'segan.customerInvite'; // 이 탭의 sessionStorage — 로그인하러 갔다 와도 잇게
  var DONE_KEY = 'segan.customerInviteDone'; // 이은 뒤 다시 연 페이지에 한 번 보일 글
  var HASH_RE = /^#customer-invite=([A-Za-z0-9_-]{20,100})$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var NOTE_MAX = 200; // 워커 my-schedules.js CHANGE_NOTE_MAX
  var OPEN = ['scheduled', 'confirmed', 'in_progress'];
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  var TEXT = {
    inviteTitle: '업체가 보낸 프로젝트 초대',
    inviteFrom:
      '이(가) 보낸 초대입니다. 내 계정과 이으면 마이페이지 「내 프로젝트」에서 진행 · 설치 날 · 결제 · A/S 를 볼 수 있습니다.',
    inviteLogin: '로그인하면 이어서 잇습니다. 아래에서 로그인해 주세요.',
    inviteBtn: '내 계정과 잇기',
    inviteGone: '쓸 수 없는 초대 링크입니다',
    inviteGoneHint: '업체에 새 링크를 받아 주세요.',
    inviteDone: '프로젝트를 내 계정과 이었습니다. 아래 「내 프로젝트」에서 볼 수 있습니다.',
    installLabel: '설치 날',
    ok: '이 날 좋아요',
    change: '바꿔 주세요',
    confirmed: '확인했습니다',
    asked: '바꿔 달라고 했습니다 — 업체가 날짜를 고치면 알려 드립니다',
    noteLabel: '바라는 날 · 시간 (선택)',
    noteLong: '바라는 것은 ' + NOTE_MAX + '자까지 적을 수 있습니다.',
    send: '보내기',
    sentOk: '이 날로 확인했습니다.',
    sentChange: '업체에 바꿔 달라고 알렸습니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var S = {
    sb: null,
    session: null,
    base: '',
    token: '',
    peek: null, // { company_name } | 'gone'
    err: '',
    busy: false,
    byProject: {}, // 프로젝트 id → 줄 (slotHtml 이 받은 것)
    changeFor: '', // 「바꿔 주세요」 칸을 펼친 프로젝트 id
    msg: {}, // 프로젝트 id → { text, err }
    bound: false,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function two(n) {
    return String(n).padStart(2, '0');
  }
  /** 한국 시각 「11.28 (금) 09:00」 */
  function kstText(iso) {
    var ms = Date.parse(iso || '');
    if (!Number.isFinite(ms)) return '';
    var d = new Date(ms + 9 * 3600000);
    return (
      two(d.getUTCMonth() + 1) +
      '.' +
      two(d.getUTCDate()) +
      ' (' +
      WEEK[d.getUTCDay()] +
      ') ' +
      two(d.getUTCHours()) +
      ':' +
      two(d.getUTCMinutes())
    );
  }
  function store(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }
  function put(key, val) {
    try {
      if (val) sessionStorage.setItem(key, val);
      else sessionStorage.removeItem(key);
    } catch {
      /* 저장소를 못 쓰면 이 페이지에서만 */
    }
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = S.sb && (await S.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return S.session ? S.session.access_token : '';
  }
  /** → { ok, status, body } (끊기면 status 0) */
  async function call(method, path, body, auth) {
    if (!S.base) return { ok: false, status: 0, body: {} };
    var headers = { 'Content-Type': 'application/json' };
    if (auth !== false) headers.Authorization = 'Bearer ' + (await token());
    try {
      var res = await fetch(S.base + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      var json = {};
      try {
        json = (await res.json()) || {};
      } catch {
        json = {};
      }
      return { ok: res.ok && json.success === true, status: res.status, body: json };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }
  function errText(r) {
    return (r && r.body && typeof r.body.message === 'string' && r.body.message) || TEXT.generic;
  }

  // ── 고객 초대 링크 ───────────────────────────────────────
  /** 주소의 토큰을 꺼내 저장소로 옮기고 주소에서 지운다 */
  function takeToken() {
    var m = HASH_RE.exec(location.hash || '');
    if (m) {
      put(KEY, m[1]);
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        location.hash = '';
      }
      return m[1];
    }
    return store(KEY);
  }

  function cardHtml(signedIn) {
    if (S.peek === 'gone')
      return (
        '<section class="me-card ci-card" data-ci="gone"><h2 class="me-pt-sub">' +
        esc(TEXT.inviteGone) +
        '</h2><p class="mk-note">' +
        esc(S.err || '') +
        ' ' +
        esc(TEXT.inviteGoneHint) +
        '</p></section>'
      );
    var name = S.peek && S.peek.company_name ? S.peek.company_name : '업체';
    return (
      '<section class="me-card ci-card" data-ci="invite"><h2 class="me-pt-sub">' +
      esc(TEXT.inviteTitle) +
      '</h2><p><b>' +
      esc(name) +
      '</b>' +
      esc(TEXT.inviteFrom) +
      '</p>' +
      (signedIn
        ? (S.err ? '<p class="mk-error" role="alert">' + esc(S.err) + '</p>' : '') +
          '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-ci-act="accept"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.inviteBtn) +
          '</button></div>'
        : '<p class="mk-note">' + esc(TEXT.inviteLogin) + '</p>') +
      '</section>'
    );
  }

  /** 로그인 칸 · 마이페이지 맨 위에 초대 카드를 그린다 */
  function paintCard() {
    var signedIn = !!S.session;
    var host = document.querySelector(
      '[data-auth-view="' + (signedIn ? 'signed-in' : 'signed-out') + '"]'
    );
    if (!host) return;
    var box = document.getElementById('meCustomerInvite');
    if (!box) {
      box = document.createElement('div');
      box.id = 'meCustomerInvite';
      host.insertBefore(box, host.firstChild);
      box.addEventListener('click', onCardClick);
    }
    box.innerHTML = cardHtml(signedIn);
  }

  async function onCardClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-ci-act="accept"]') : null;
    if (!b || S.busy || !S.token) return;
    S.busy = true;
    S.err = '';
    paintCard();
    var r = await call('POST', '/customer-invites/accept', { token: S.token });
    S.busy = false;
    if (r.ok) {
      put(KEY, '');
      put(DONE_KEY, '1');
      location.replace(location.pathname + location.search + '#projects-mine');
      location.reload();
      return;
    }
    if (r.status === 410 || r.status === 404) {
      put(KEY, '');
      S.peek = 'gone';
    }
    S.err = errText(r);
    paintCard();
  }

  async function startInvite() {
    if (store(DONE_KEY)) {
      put(DONE_KEY, '');
      var host = document.querySelector('[data-auth-view="signed-in"]');
      if (host && S.session) {
        var done = document.createElement('p');
        done.className = 'mk-note ci-done';
        done.setAttribute('data-ci', 'done');
        done.textContent = TEXT.inviteDone;
        host.insertBefore(done, host.firstChild);
      }
    }
    if (!S.token) return;
    var r = await call('POST', '/customer-invites/peek', { token: S.token }, false);
    if (r.ok && r.body.data && typeof r.body.data === 'object')
      S.peek = { company_name: r.body.data.company_name || null };
    else if (r.status === 410 || r.status === 404 || r.status === 422) {
      S.peek = 'gone';
      S.err = errText(r);
      put(KEY, '');
    } else return; // 옛 서버 · 끊김 — 카드를 내지 않는다 (토큰은 다음에 다시)
    paintCard();
  }

  // ── 설치 날 ─────────────────────────────────────────────
  function installOf(p) {
    var i = p && p.install && typeof p.install === 'object' ? p.install : null;
    if (
      !i ||
      !UUID_RE.test(String(i.id || '')) ||
      !Number.isFinite(Date.parse(i.scheduled_at || ''))
    )
      return null;
    if (i.status && OPEN.indexOf(i.status) < 0) return null;
    if (p.status && p.status !== 'active') return null;
    return i;
  }

  /** 내 프로젝트 한 줄 아래의 설치 날 칸 (없으면 '') */
  function slotHtml(p) {
    var i = installOf(p);
    if (!i || !p || !UUID_RE.test(String(p.id || ''))) return '';
    S.byProject[p.id] = p;
    var asked = !!i.change_requested_at;
    var ok = !asked && !!i.confirmed_at;
    var open = S.changeFor === p.id;
    var m = S.msg[p.id];
    var btn = function (act, label, solid) {
      return (
        '<button type="button" class="mk-btn' +
        (solid ? ' mk-btn--solid' : '') +
        '" data-ci-act="' +
        act +
        '" data-for="' +
        esc(p.id) +
        '"' +
        (act === 'change' ? ' aria-expanded="' + open + '"' : '') +
        (S.busy ? ' disabled' : '') +
        '>' +
        esc(label) +
        '</button>'
      );
    };
    return (
      '<div class="ci-install" data-install="' +
      esc(p.id) +
      '"><p class="ci-line"><span>' +
      esc(TEXT.installLabel) +
      '</span> <b>' +
      esc(kstText(i.scheduled_at)) +
      '</b>' +
      (ok ? ' <small data-ci="confirmed">' + esc(TEXT.confirmed) + '</small>' : '') +
      (asked ? ' <small data-ci="asked">' + esc(TEXT.asked) + '</small>' : '') +
      '</p><div class="rd-acts">' +
      (ok ? '' : btn('ok', TEXT.ok, false)) +
      btn('change', TEXT.change, open) +
      '</div>' +
      (open
        ? '<form class="ci-change" data-ci-form="change" data-for="' +
          esc(p.id) +
          '" novalidate><label class="mk-input"><span>' +
          esc(TEXT.noteLabel) +
          '</span><textarea name="note" rows="2" maxlength="' +
          NOTE_MAX +
          '"></textarea></label><div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.send) +
          '</button></div></form>'
        : '') +
      (m
        ? '<p class="' +
          (m.err ? 'mk-error' : 'mk-note') +
          '"' +
          (m.err ? ' role="alert"' : '') +
          '>' +
          esc(m.text) +
          '</p>'
        : '') +
      '</div>'
    );
  }

  function repaint(id) {
    var el = document.querySelector('[data-install="' + id + '"]');
    var p = S.byProject[id];
    if (!el || !p) return;
    var html = slotHtml(p);
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    if (tmp.firstChild) el.replaceWith(tmp.firstChild);
    else el.remove();
  }

  async function send(id, what, note) {
    var p = S.byProject[id];
    var i = installOf(p);
    if (!i || S.busy) return;
    S.busy = true;
    S.msg[id] = null;
    repaint(id);
    var r = await call(
      'POST',
      '/me/schedules/' + i.id + '/' + (what === 'ok' ? 'confirm' : 'change'),
      what === 'ok' ? null : { note: note || null }
    );
    S.busy = false;
    if (r.ok && r.body.data && typeof r.body.data === 'object') {
      var d = r.body.data;
      p.install = Object.assign({}, i, {
        confirmed_at: d.customer_confirmed_at || null,
        change_requested_at: d.customer_change_requested_at || null,
      });
      S.changeFor = '';
      S.msg[id] = { text: what === 'ok' ? TEXT.sentOk : TEXT.sentChange, err: false };
    } else {
      S.msg[id] = { text: errText(r), err: true };
    }
    repaint(id);
  }

  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-ci-act]') : null;
    if (!b || b.disabled || S.busy) return;
    var id = b.getAttribute('data-for') || '';
    if (!S.byProject[id]) return;
    var act = b.getAttribute('data-ci-act');
    if (act === 'ok') send(id, 'ok');
    else if (act === 'change') {
      // 같은 단추로 펼치고 접는다
      var was = S.changeFor;
      S.changeFor = was === id ? '' : id;
      S.msg[id] = null;
      if (was && was !== id) repaint(was);
      repaint(id);
      var t = S.changeFor ? document.querySelector('[data-install="' + id + '"] textarea') : null;
      if (t && t.focus) t.focus();
    }
  }

  function onSubmit(e) {
    var f = e.target && e.target.closest ? e.target.closest('form[data-ci-form="change"]') : null;
    if (!f) return;
    e.preventDefault();
    var id = f.getAttribute('data-for') || '';
    var el = f.querySelector('textarea[name="note"]');
    var note = el ? String(el.value || '').trim() : '';
    if ([...note].length > NOTE_MAX) {
      S.msg[id] = { text: TEXT.noteLong, err: true };
      repaint(id);
      return;
    }
    send(id, 'change', note);
  }

  function bind() {
    if (S.bound) return;
    var list = document.getElementById('meProjects');
    if (!list) return;
    S.bound = true;
    list.addEventListener('click', onClick);
    list.addEventListener('submit', onSubmit);
  }

  /** 세션이 정해지면 — 로그인 전이면 session null */
  function init(sb, session) {
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb || null;
    S.session = session || null;
    if (S.session) bind();
    if (!S.token) S.token = takeToken();
    return startInvite();
  }

  function boot() {
    // 토큰은 먼저 주소에서 뺀다 (다른 스크립트가 주소를 화면 이름으로 읽기 전에)
    S.token = takeToken();
    // 셸(segan/shell.js)이 이 파일보다 늦게 읽힐 수 있다 — 생길 때까지 잠깐 기다린다
    var tries = 0;
    (function go() {
      var Shell = window.SeganShell;
      if (Shell && Shell.ready && typeof Shell.ready.then === 'function') {
        Shell.ready.then(
          function (auth) {
            init(auth && auth.sb, auth && auth.session);
          },
          function () {
            init(null, null);
          }
        );
        return;
      }
      if (tries++ < 100) setTimeout(go, 20);
    })();
  }

  window.SeganInstall = {
    HASH_RE: HASH_RE,
    NOTE_MAX: NOTE_MAX,
    TEXT: TEXT,
    state: S,
    kstText: kstText,
    installOf: installOf,
    slotHtml: slotHtml,
    init: init,
    takeToken: takeToken,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
