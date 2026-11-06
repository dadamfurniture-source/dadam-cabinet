/* ============================================================
   segan/as-requests.js — A/S 접수 (segan/me.html)

   2026-11-06 A/S 접수 묶음: 고객 앱 A/S 신청 → 본사 기록 → 그 수주의 팩토리 담당자(없으면 대표 · 실장)에게 바로.
   앱 상담으로 시작한 수주(고객 계정과 이어진 수주)만. 48시간 넘게 아무도 안 받으면 본사에 알림(서버 cron).

   고객 (내 프로젝트)
     시공 완료(stage installed)이고 수주 id 가 있는 프로젝트 줄 아래 「A/S 신청」 — 내용(1000자) · 사진(5장)
       POST /me/orders/:orderId/as-requests/photo   본문 = 사진 (JPEG · PNG, 긴 변 PHOTO_EDGE 로 줄여 보낸다)
       POST /me/orders/:orderId/as-requests         { body, photo_paths }
     「A/S 접수」 칸 (#meAsSection) — GET /me/as-requests, 아직 받지 않은 접수는 「거두기」(한 번 더 묻는다)
       POST /me/as-requests/:id/cancel
   팩토리 (내 정보 › 팩토리 › A/S함, #as — 앱 알림 as_request 가 me.html#as 로 연다)
       GET  /company/as-requests                    { ready, items[{ id, order_no, body, photo_urls, state, label, mine, can_handle, … }] }
       POST /company/as-requests/:id/receive        받기
       POST /company/as-requests/:id/done           끝
     다담 공장 구성원 · Expert · Agent 구성원 (segan/partner-projects.js 와 같은 판정). 접수가 없으면
     다담 공장 · Agent 만 빈 칸을 보인다 (Expert 는 앱 상담 수주가 없다).
   못 읽으면  (403 · 404 · 오류 · 끊김 · ready false — DB 0045 전) 칸째 감춘다.
   segan/me.js 가 내 프로젝트 줄마다 slotHtml(p) 를 붙이고, loadMine · load 를 부른다.
   ============================================================ */
/* global window, document, fetch, location, createImageBitmap */
(function () {
  'use strict';

  var BODY_MAX = 1000; // 워커 as-requests.js BODY_MAX
  var PHOTOS_MAX = 5; // 워커 PHOTOS_MAX
  var PHOTO_EDGE = 1920; // 긴 변 — 워커 ledger/checks.js PHOTO_MAX_EDGE 2576 · 375만 화소 안
  var JPEG_QUALITY = 0.85;
  var HASH = '#as';
  var STATE_LABEL = { requested: '접수', received: '받음', done: '끝', cancelled: '거둠' }; // 워커 AS_STATE_LABEL
  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var PLANS = ['expert', 'agent']; // segan/partner-projects.js 와 같다
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var TEXT = {
    open: 'A/S 신청',
    lead: '고칠 곳과 상황을 적어 주세요. 사진이 있으면 함께 보내 주세요. 시공한 팩토리에 바로 갑니다.',
    bodyEmpty: 'A/S 내용을 적어 주세요.',
    bodyLong: '내용은 ' + BODY_MAX + '자까지 적을 수 있습니다.',
    tooMany: '사진은 ' + PHOTOS_MAX + '장까지 보낼 수 있습니다.',
    badPhoto: 'JPEG · PNG 사진만 보낼 수 있습니다.',
    sent: 'A/S를 접수했습니다. 팩토리가 받으면 아래 「A/S 접수」에서 「받음」으로 바뀝니다.',
    cancelAsk: '이 접수를 거둘까요?',
    boxLead:
      '고객이 앱에서 보낸 A/S입니다. 그 수주의 담당자(없으면 대표 · 실장)가 받습니다. 48시간 넘게 받지 않으면 본사에 알림이 갑니다.',
    boxEmpty: '아직 A/S 접수가 없습니다.',
    received: 'A/S를 받았습니다.',
    done: 'A/S를 끝냈습니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var S = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null, // GET /partner/me data
    form: '', // A/S 신청 칸을 연 수주 id
    sent: '', // 방금 접수한 수주 id
    busy: false,
    mine: null, // GET /me/as-requests items
    ask: '', // 거두기를 묻는 접수 id
    box: null, // GET /company/as-requests items
    boxMsg: '',
    boxErr: '',
    bound: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 한국 시간 YYYY.MM.DD HH:mm */
  function kstTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var d = new Date(t + 9 * 3600 * 1000);
    var p = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getUTCFullYear() +
      '.' +
      p(d.getUTCMonth() + 1) +
      '.' +
      p(d.getUTCDate()) +
      ' ' +
      p(d.getUTCHours()) +
      ':' +
      p(d.getUTCMinutes())
    );
  }

  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 팩토리 A/S함을 묻나 — 다담 공장 구성원 · Expert · Agent 협력업체 구성원 */
  function canSee(me) {
    if (isHq(me)) return true;
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      PLANS.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }

  /** 접수가 없어도 빈 A/S함을 보이나 — 앱 상담을 받는 다담 공장 · Agent */
  function showsEmpty(me) {
    return isHq(me) || !!(me && me.company && me.company.plan === 'agent');
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

  /** → { ok, status, body } (끊기면 status 0) — blob 이면 그대로 보낸다 */
  async function call(method, path, body) {
    var headers = { Authorization: 'Bearer ' + (await token()) };
    var raw = body && typeof body === 'object' && typeof body.size === 'number' && body.type;
    if (raw) headers['Content-Type'] = body.type;
    else if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(S.base + path, {
        method: method,
        headers: headers,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
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
    return { ok: res.ok && !!b && b.success === true, status: res.status, body: b || {} };
  }

  function messageOf(r) {
    return (r && r.body && typeof r.body.message === 'string' && r.body.message) || TEXT.generic;
  }

  /** { ready, items } 본문 → items | null (ready 가 아니거나 모양이 틀리면 null) */
  function itemsOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || d.ready !== true || !Array.isArray(d.items)) return null;
    return d.items.filter(function (x) {
      return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
    });
  }

  // ── 사진 ───────────────────────────────────────────────
  function okType(file) {
    return !!file && /^image\/(jpeg|png)$/.test(file.type || '');
  }

  /** 사진 하나 → 보낼 Blob | null — 긴 변 PHOTO_EDGE 로 줄인 JPEG (못 열면 JPEG · PNG 만 그대로) */
  async function shrink(file) {
    if (typeof createImageBitmap !== 'function') return okType(file) ? file : null;
    var bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return okType(file) ? file : null;
    }
    var k = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height));
    if (k === 1 && okType(file)) return file;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    var ctx = c.getContext && c.getContext('2d');
    if (!ctx || !c.toBlob) return okType(file) ? file : null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (resolve) {
      c.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    return blob || (okType(file) ? file : null);
  }

  // ── 고객: 내 프로젝트 줄의 A/S 신청 ──────────────────────
  /** 이 프로젝트에 A/S 신청을 다나 — 시공 완료 · 수주 id */
  function orderIdOf(p) {
    if (!p || p.stage !== 'installed' || !p.order || typeof p.order !== 'object') return '';
    var id = String(p.order.id || '');
    return UUID_RE.test(id) ? id : '';
  }

  function formHtml(orderId) {
    return (
      '<form class="me-pt-form me-as-form" data-as-form="' +
      esc(orderId) +
      '" novalidate>' +
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      '<label class="mk-input"><span>A/S 내용</span><textarea name="body" rows="4" maxlength="' +
      BODY_MAX +
      '"></textarea></label>' +
      '<label class="mk-input"><span>사진 (' +
      PHOTOS_MAX +
      '장까지, 없어도 됩니다)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/*" multiple /></label>' +
      '<p class="mk-error" data-as-err role="alert" hidden></p>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid">보내기</button>' +
      '<button type="button" class="mk-btn" data-as-act="close">닫기</button></div>' +
      '</form>'
    );
  }

  function slotInner(orderId) {
    if (S.form === orderId) return formHtml(orderId);
    return (
      (S.sent === orderId ? '<p class="me-pt-msg" role="status">' + esc(TEXT.sent) + '</p>' : '') +
      '<div class="rd-acts"><button type="button" class="mk-btn" data-as-act="open" data-order="' +
      esc(orderId) +
      '">' +
      esc(TEXT.open) +
      '</button></div>'
    );
  }

  /** 내 프로젝트 한 줄 아래 — segan/me.js projectHtml 이 붙인다 (달 수 없으면 빈 글) */
  function slotHtml(p) {
    var id = orderIdOf(p);
    if (!id) return '';
    return '<div class="me-as-slot" data-as-slot="' + esc(id) + '">' + slotInner(id) + '</div>';
  }

  function redrawSlot(orderId) {
    var list = $('meProjects');
    var slot = list && list.querySelector('[data-as-slot="' + orderId + '"]');
    if (slot) slot.innerHTML = slotInner(orderId);
  }

  function setFormBusy(form, busy) {
    form.querySelectorAll('button, textarea, input').forEach(function (el) {
      el.disabled = busy;
    });
  }

  function formError(form, msg) {
    var el = form.querySelector('[data-as-err]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function submitForm(form) {
    if (S.busy) return;
    var orderId = form.getAttribute('data-as-form');
    var text = String((form.elements.body && form.elements.body.value) || '').trim();
    if (!text) return formError(form, TEXT.bodyEmpty);
    if (text.length > BODY_MAX) return formError(form, TEXT.bodyLong);
    var files = [].slice.call((form.elements.photos && form.elements.photos.files) || []);
    if (files.length > PHOTOS_MAX) return formError(form, TEXT.tooMany);
    formError(form, '');
    S.busy = true;
    setFormBusy(form, true);
    try {
      var paths = [];
      for (var i = 0; i < files.length; i++) {
        var blob = await shrink(files[i]);
        if (!blob) return formError(form, TEXT.badPhoto);
        var up = await call('POST', '/me/orders/' + encodeURIComponent(orderId) + '/as-requests/photo', blob);
        var path = up.ok && up.body.data ? up.body.data.photo_path : '';
        if (!path) return formError(form, messageOf(up));
        paths.push(path);
      }
      var r = await call('POST', '/me/orders/' + encodeURIComponent(orderId) + '/as-requests', {
        body: text,
        photo_paths: paths,
      });
      if (!r.ok) return formError(form, messageOf(r));
      S.form = '';
      S.sent = orderId;
      redrawSlot(orderId);
      loadMineList();
    } finally {
      S.busy = false;
      if (form.isConnected) setFormBusy(form, false);
    }
  }

  function onProjectsClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-as-act]') : null;
    if (!b || S.busy) return;
    var act = b.getAttribute('data-as-act');
    if (act === 'open') {
      var prev = S.form;
      S.form = b.getAttribute('data-order') || '';
      S.sent = '';
      if (prev && prev !== S.form) redrawSlot(prev);
      redrawSlot(S.form);
      var ta = $('meProjects').querySelector('[data-as-form] textarea');
      if (ta && ta.focus) ta.focus();
    } else if (act === 'close') {
      var id = S.form;
      S.form = '';
      if (id) redrawSlot(id);
    }
  }

  function onProjectsSubmit(e) {
    var form = e.target && e.target.closest ? e.target.closest('form[data-as-form]') : null;
    if (!form) return;
    e.preventDefault();
    submitForm(form);
  }

  // ── 고객: A/S 접수 칸 ───────────────────────────────────
  function mineRowHtml(x) {
    var sub = [x.factory, kstTime(x.created_at)].filter(Boolean).join(' · ');
    var asking = S.ask === x.id;
    return (
      '<li class="me-as-item" data-as-id="' +
      esc(x.id) +
      '"><span class="me-p-head"><span class="me-c-main"><b>' +
      esc(x.order_no || 'A/S') +
      '</b><small>' +
      esc(sub) +
      '</small></span><span class="me-badge me-badge--' +
      esc(x.state) +
      '">' +
      esc(x.label || STATE_LABEL[x.state] || x.state || '') +
      '</span></span>' +
      '<p class="me-as-body">' +
      esc(x.body || '') +
      '</p>' +
      (x.can_cancel === true
        ? asking
          ? '<div class="rd-acts me-as-ask"><span>' +
            esc(TEXT.cancelAsk) +
            '</span><button type="button" class="mk-btn mk-btn--solid" data-as-act="cancel-yes" data-id="' +
            esc(x.id) +
            '">거두기</button><button type="button" class="mk-btn" data-as-act="cancel-no">그대로</button></div>'
          : '<div class="rd-acts"><button type="button" class="mk-btn" data-as-act="cancel" data-id="' +
            esc(x.id) +
            '">거두기</button></div>'
        : '') +
      '</li>'
    );
  }

  function renderMine() {
    var section = $('meAsSection');
    var list = $('meAsList');
    if (!section || !list) return;
    var items = S.mine || [];
    list.innerHTML = items.map(mineRowHtml).join('');
    section.hidden = items.length === 0;
  }

  function mineError(msg) {
    var el = $('meAsError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function loadMineList() {
    var r = await call('GET', '/me/as-requests');
    var items = r.ok ? itemsOf(r.body) : null;
    S.mine = items || [];
    try {
      renderMine();
    } catch {
      var section = $('meAsSection');
      if (section) section.hidden = true;
    }
  }

  async function onMineClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-as-act]') : null;
    if (!b || S.busy) return;
    var act = b.getAttribute('data-as-act');
    if (act === 'cancel') {
      S.ask = b.getAttribute('data-id') || '';
      mineError('');
      renderMine();
    } else if (act === 'cancel-no') {
      S.ask = '';
      renderMine();
    } else if (act === 'cancel-yes') {
      var id = b.getAttribute('data-id') || '';
      S.busy = true;
      b.disabled = true;
      var r = await call('POST', '/me/as-requests/' + encodeURIComponent(id) + '/cancel');
      S.busy = false;
      S.ask = '';
      if (!r.ok) mineError(messageOf(r));
      await loadMineList();
    }
  }

  /** 고객 쪽 — me.js 가 로그인 뒤 부른다 (업체 칸과 상관없다) */
  async function loadMine(sb, session) {
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb;
    S.session = session;
    S.form = '';
    S.sent = '';
    S.ask = '';
    S.mine = null;
    var section = $('meAsSection');
    if (section) section.hidden = true;
    if (!S.base || !session) return;
    if (!S.bound) {
      S.bound = true;
      var projects = $('meProjects');
      if (projects) {
        projects.addEventListener('click', onProjectsClick);
        projects.addEventListener('submit', onProjectsSubmit);
      }
      var list = $('meAsList');
      if (list) list.addEventListener('click', onMineClick);
    }
    await loadMineList();
  }

  // ── 팩토리: A/S함 ───────────────────────────────────────
  function boxRowHtml(x) {
    var photos = (Array.isArray(x.photo_urls) ? x.photo_urls : []).filter(function (u) {
      return typeof u === 'string' && /^https:\/\//.test(u);
    });
    var sub = ['접수 ' + kstTime(x.created_at), x.mine === true ? '내 담당' : '']
      .filter(Boolean)
      .join(' · ');
    var act = '';
    if (x.can_handle === true && x.state === 'requested') act = ['receive', '받기'];
    else if (x.can_handle === true && x.state === 'received') act = ['done', 'A/S 끝'];
    return (
      '<li class="me-pt-row me-as-row" data-as-item="' +
      esc(x.id) +
      '"><span class="me-pt-line"><span class="me-c-main"><b>' +
      esc(x.order_no || 'A/S') +
      '</b><small>' +
      esc(sub) +
      '</small></span><span class="me-badge me-badge--' +
      esc(x.state) +
      '">' +
      esc(x.label || STATE_LABEL[x.state] || x.state || '') +
      '</span></span>' +
      '<p class="me-as-body">' +
      esc(x.body || '') +
      '</p>' +
      (photos.length
        ? '<div class="me-as-photos">' +
          photos
            .map(function (u, i) {
              return (
                '<a href="' +
                esc(u) +
                '" target="_blank" rel="noopener"><img src="' +
                esc(u) +
                '" alt="A/S 사진 ' +
                (i + 1) +
                '" loading="lazy" /></a>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      (act
        ? '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-as-act="' +
          act[0] +
          '" data-id="' +
          esc(x.id) +
          '">' +
          esc(act[1]) +
          '</button></div>'
        : '') +
      '</li>'
    );
  }

  function renderBox() {
    var box = $('as');
    if (!box) return;
    var items = S.box || [];
    box.innerHTML =
      '<h3 class="me-pt-sub" id="asTitle">A/S함</h3>' +
      '<p class="mk-note">' +
      esc(TEXT.boxLead) +
      '</p>' +
      (S.boxMsg ? '<p class="me-pt-msg" role="status">' + esc(S.boxMsg) + '</p>' : '') +
      (S.boxErr ? '<p class="mk-error" role="alert">' + esc(S.boxErr) + '</p>' : '') +
      (items.length
        ? '<ul class="me-pt-list">' + items.map(boxRowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.boxEmpty) + '</p>');
    box.hidden = false;
    // 다담 공장 구성원은 업체 칸에 협력업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다
    var section = $('partner');
    if (section && isHq(S.me)) section.hidden = false;
  }

  function scrollIfAsked() {
    var box = $('as');
    if (!box || box.hidden || location.hash !== HASH) return;
    var section = $('partner');
    if (section) section.hidden = false;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'start' });
  }

  /** → 보일 items | null (감춘다) */
  async function fetchBox() {
    var r = await call('GET', '/company/as-requests');
    var items = r.ok ? itemsOf(r.body) : null;
    if (!items) return null;
    if (!items.length && !showsEmpty(S.me)) return null;
    return items;
  }

  async function reloadBox() {
    var box = $('as');
    var items = await fetchBox();
    if (!items) {
      if (box) {
        box.hidden = true;
        box.innerHTML = '';
      }
      return;
    }
    S.box = items;
    renderBox();
  }

  async function onBoxClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-as-act]') : null;
    if (!b || S.busy) return;
    var act = b.getAttribute('data-as-act');
    if (act !== 'receive' && act !== 'done') return;
    var id = b.getAttribute('data-id') || '';
    S.busy = true;
    b.disabled = true;
    S.boxMsg = '';
    S.boxErr = '';
    var r = await call('POST', '/company/as-requests/' + encodeURIComponent(id) + '/' + act, act === 'done' ? {} : undefined);
    S.busy = false;
    if (r.ok) S.boxMsg = act === 'receive' ? TEXT.received : TEXT.done;
    else S.boxErr = messageOf(r);
    await reloadBox();
  }

  /** 앱이 열린 채 알림을 눌러 주소의 # 만 바뀌었다 — A/S함을 다시 읽고 내려간다 */
  async function onHash() {
    if (location.hash !== HASH || !S.base || !canSee(S.me) || S.busy) return;
    await reloadBox();
    scrollIfAsked();
  }

  /** 팩토리 쪽 — me.js 가 업체 칸(/partner/me)을 읽은 뒤 부른다 */
  async function load(sb, session, me) {
    var box = $('as');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb;
    S.session = session;
    S.me = me;
    S.box = null;
    S.boxMsg = '';
    S.boxErr = '';
    if (!S.base || !session || !canSee(me)) return;
    try {
      var items = await fetchBox();
      if (!items) return;
      S.box = items;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onBoxClick);
        window.addEventListener('hashchange', onHash);
      }
      renderBox(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      scrollIfAsked();
    } catch {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganAs = {
    BODY_MAX: BODY_MAX,
    PHOTOS_MAX: PHOTOS_MAX,
    PHOTO_EDGE: PHOTO_EDGE,
    STATE_LABEL: STATE_LABEL,
    HASH: HASH,
    state: S,
    canSee: canSee,
    orderIdOf: orderIdOf,
    slotHtml: slotHtml,
    itemsOf: itemsOf,
    loadMine: loadMine,
    load: load,
  };
})();
