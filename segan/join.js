/* ============================================================
   segan/join.js — 업체 직원 초대 받기 (segan/join.html#t=<토큰>)

   흐름
     1. 주소 #t= 의 토큰을 이 탭(sessionStorage)에만 둔다 — 로그인을 다녀와도 쓴다 (작업자 포털 초대와 같은 방법)
     2. 로그인이 없으면 login.html?redirect=segan/join.html#t=… 로 다녀온다
     3. 로그인했으면 주소창에서 토큰을 지우고 POST /partner/invites/peek 로 업체 이름 · 역할 · 기한을 보인다
     4. 「수락」 → POST /partner/invites/accept → 내 정보 업체 칸(me.html#partner)으로
   410(만료 · 취소 · 이미 씀) · 409(업체 멈춤 · 이미 구성원 · 열린 신청) 은 한국어로 안내한다.
   토큰은 수락했거나 쓸 수 없는 것이 확인되면 지운다.
   ============================================================ */
/* global window, document, location, history, sessionStorage, fetch */
(function () {
  'use strict';

  var TOKEN_KEY = 'segan.join.token';
  var TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
  var LOGIN_PAGE = '../login.html';
  var DONE_PAGE = 'me.html#partner';
  var ROLE_LABEL = { owner: '대표', manager: '실장', staff: '직원' }; // segan/partner.js 와 같다

  // 서버 code → 안내 (서버 error 문장이 없을 때도 같은 뜻이 되게)
  var STOP = {
    invite_invalid: [
      '쓸 수 없는 초대 링크입니다',
      '기한이 지났거나, 취소됐거나, 이미 쓴 링크입니다. 대표에게 새 링크를 받아 주세요.',
    ],
    company_inactive: [
      '지금은 이 업체에 들어갈 수 없습니다',
      '업체 구독이 멈춰 있거나 해지된 업체입니다. 대표에게 문의해 주세요.',
    ],
    already_member: ['이미 업체에 속해 있습니다', '한 사람은 한 업체에서만 함께할 수 있습니다.'],
    application_open: [
      '진행 중인 업체 신청이 있습니다',
      '「내 정보 › 업체」에서 신청을 거둔 뒤 이 링크를 다시 열어 주세요.',
    ],
    bad_link: ['초대 링크가 올바르지 않습니다', '받은 링크 전체를 그대로 열어 주세요.'],
    no_server: ['지금은 초대를 확인할 수 없습니다', '잠시 후 이 링크를 다시 열어 주세요.'],
  };

  var J = { sb: null, session: null, token: '', base: '', invite: null, sending: false };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 날짜 (ISO UTC 로 온다) */
  function kstDay(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  /** 주소 # 뒤의 t= 토큰 (형식이 틀리면 '') */
  function tokenFromHash(hash) {
    var out = '';
    String(hash || '')
      .replace(/^#/, '')
      .split('&')
      .forEach(function (part) {
        var i = part.indexOf('=');
        if (i <= 0 || part.slice(0, i) !== 't') return;
        var v = part.slice(i + 1);
        try {
          v = decodeURIComponent(v);
        } catch {
          return;
        }
        if (TOKEN_RE.test(v)) out = v;
      });
    return out;
  }

  function store(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 */
    }
  }

  function stored() {
    try {
      var v = sessionStorage.getItem(TOKEN_KEY);
      return v && TOKEN_RE.test(v) ? v : '';
    } catch {
      return '';
    }
  }

  /** 로그인 뒤 돌아올 곳 — js/auth-redirect.js 가 받는 같은 사이트 *.html#… */
  function loginHref(token) {
    return LOGIN_PAGE + '?redirect=' + encodeURIComponent('segan/join.html#t=' + token);
  }

  function show(name) {
    document.querySelectorAll('[data-jn-view]').forEach(function (el) {
      el.hidden = el.getAttribute('data-jn-view') !== name;
    });
  }

  function stop(code, serverText) {
    var s = STOP[code] || STOP.no_server;
    $('jnStopTitle').textContent = s[0];
    $('jnStopText').textContent = STOP[code] ? s[1] : serverText || s[1];
    show('stop');
  }

  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 없으면 로그인 안 된 것으로 */
    }
    return null;
  }

  async function post(path, body) {
    var res;
    try {
      res = await fetch(J.base + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + J.session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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

  /** 실패 응답 → 안내. 410 은 언제나 쓸 수 없는 링크, 409 는 code 별 */
  function failed(r) {
    var code = r.body && r.body.code;
    if (r.status === 410) {
      store('');
      return stop('invite_invalid');
    }
    if (r.status === 409 && STOP[code]) {
      if (code === 'company_inactive') store('');
      return stop(code);
    }
    return stop('no_server', r.body && typeof r.body.error === 'string' ? r.body.error : '');
  }

  async function peek() {
    var r = await post('/partner/invites/peek', { token: J.token });
    var d = r.ok ? r.body.data : null;
    if (!d || typeof d !== 'object') return failed(r);
    J.invite = d;
    var role = ROLE_LABEL[d.role] || String(d.role || '');
    $('jnTitle').textContent = (d.company_name || '업체') + '에서 함께하자고 초대했습니다';
    $('jnCompany').textContent = d.company_name || '';
    $('jnRole').textContent = role;
    $('jnExpires').textContent = kstDay(d.expires_at) ? kstDay(d.expires_at) + '까지' : '';
    $('jnError').hidden = true;
    show('invite');
  }

  async function accept() {
    if (J.sending) return;
    J.sending = true;
    $('jnAccept').disabled = true;
    var r = await post('/partner/invites/accept', { token: J.token });
    J.sending = false;
    $('jnAccept').disabled = false;
    if (r.ok && r.body.data && r.body.data.company) {
      store('');
      api.go(DONE_PAGE);
      return;
    }
    if (r.status === 410 || r.status === 409) return failed(r);
    $('jnError').textContent =
      (r.body && typeof r.body.error === 'string' && r.body.error) ||
      '수락하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    $('jnError').hidden = false;
  }

  async function init() {
    if (!$('jnAccept')) return;
    $('jnAccept').addEventListener('click', accept);
    var fromHash = tokenFromHash(location.hash);
    if (fromHash) store(fromHash);
    J.token = fromHash || stored();
    if (!J.token) return stop('bad_link');

    J.sb = client();
    if (J.sb) {
      try {
        var r = await J.sb.auth.getSession();
        J.session = (r && r.data && r.data.session) || null;
      } catch {
        J.session = null;
      }
    }
    if (!J.session) {
      $('jnLogin').setAttribute('href', loginHref(J.token));
      return show('signed-out');
    }
    // 로그인했으면 토큰은 이 탭에만 둔다 — 주소창 · 방문 기록에서 지운다
    if (fromHash) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        /* noop */
      }
    }
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.accountApi && cfg.accountApi.url) || '';
    if (!J.base) return stop('no_server');
    await peek();
  }

  var api = {
    TOKEN_KEY: TOKEN_KEY,
    STOP: STOP,
    state: J,
    tokenFromHash: tokenFromHash,
    loginHref: loginHref,
    /** 페이지 이동 — 시험이 바꿔 끼운다 */
    go: function (url) {
      location.assign(url);
    },
  };
  window.SeganJoin = api;
  api.ready = new Promise(function (resolve) {
    var go = function () {
      init().then(resolve, resolve);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
