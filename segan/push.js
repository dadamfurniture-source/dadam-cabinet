/* ============================================================
   segan/push.js — 「내 정보」 탭의 알림 칸 (segan/me.html #mePush) — 업무 알림(web push)

   누가 보나  account-api GET /partner/me 로 가린다 (segan/me.js 가 업체 칸을 읽은 뒤
             SeganPush.load(sb, session, partnerMe) 를 부른다 — /partner/me 를 두 번 묻지 않는다)
               협력업체 구성원 (company 있음, 역할 무관) · 본사 구성원 (hq_member) ·
               업체 신청 진행 중 (application.status applied · meeting · approved) ·
               작업자 (셸의 작업 탭 판정 — load 의 opts.worker, 작업 초대 · 신청 결과 · 확정 · 일정 알림)
             그 밖이면 칸이 없다. 서버도 그 밖이면 403 code 'no_company' 를 준다.
   서버      workflow-api (응답은 { success, data })
               GET    /push/key            VAPID 공개 키 (base64url) — 로그인 없이. 못 읽으면 칸째 감춘다
               POST   /push/subscriptions  (Bearer) { endpoint, keys: { p256dh, auth }, user_agent } → 201
               DELETE /push/subscriptions  (Bearer) { endpoint } → 204
   화면 (위에서부터 먼저 맞는 것)
     아이폰 · 아이패드인데 홈 화면 앱이 아님 → 홈 화면에 추가하는 법
     알림을 못 받는 브라우저 → 한 줄
     권한을 막음 → 설정에서 다시 켜는 법 한 줄
     이 기기 구독 있음 (registration.pushManager.getSubscription()) → 「끄기」 (구독 해지 + DELETE)
       이때 POST /push/subscriptions 를 한 번 조용히 다시 보낸다 — 서버가 endpoint 로 덮어써
       사람 · 업체를 다시 묶는다 (업체 신청 중에 켠 사람이 업체 구성원이 된 뒤에도 업체 알림을 받게).
       권한은 묻지 않고 실패는 그냥 둔다. 403 no_company 면 켜기 때처럼 이 기기 구독을 푼다
     그 밖 → 「알림 켜기」 — 권한은 이 단추를 누를 때만 묻는다
   알림 글은 서버가 정한다 (고객 개인정보를 넣지 않는 것은 서버 몫). 화면 · 서비스 워커는 글을 보태지 않는다.
   알림을 띄우고 누르면 여는 일은 segan/sw.js. 로그아웃(segan/shell.js)하면 SeganPush.forget 으로
   이 기기 구독을 지운다 — 다음 사람이 앞사람 알림을 받지 않게.
   ============================================================ */
/* global window, document, navigator, fetch, setTimeout, clearTimeout, atob, Notification */
(function () {
  'use strict';

  var APPLYING = ['applied', 'meeting', 'approved']; // 업체 신청 진행 중
  var LEAD =
    '업무 알림(승인 요청 · 확인서 결정 · 결제 · 작업 초대 · 작업 일정 등)이 이 기기로 옵니다.';
  var TEXT = {
    on: '이 기기에서 알림을 받고 있습니다.',
    unsupported:
      '이 브라우저에서는 알림을 받을 수 없습니다. 크롬 · 삼성 인터넷에서 열거나, 아이폰은 홈 화면에 추가한 SEGAN에서 열어 주세요.',
    ios: '아이폰은 홈 화면에 추가한 SEGAN에서만 알림을 받을 수 있어요',
    inapp: '안에서 연 화면에서는 알림을 받을 수 없어요', // 앞에 카카오톡 · 네이버 … 이름 (모르면 「앱」)
    iosOld:
      '아이폰 알림은 iOS 16.4 이상에서 받을 수 있어요. 「설정 › 일반 › 소프트웨어 업데이트」에서 올린 뒤 다시 열어 주세요.',
    denied: '알림이 막혀 있습니다. 브라우저(휴대폰) 설정에서 이 사이트의 알림을 허용해 주세요.',
    turnedOn: '알림을 켰습니다.',
    turnedOff: '알림을 껐습니다.',
    notAllowed: '알림을 허용해야 켤 수 있습니다.',
    noCompany: '업체 구성원만 알림을 받을 수 있습니다.',
    failOn: '알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.',
    failOff: '알림을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };
  var IOS_STEPS = [
    'Safari 아래쪽 공유 단추를 누릅니다.',
    '「홈 화면에 추가」를 누릅니다.',
    '홈 화면의 SEGAN을 열고 여기서 알림을 켭니다.',
  ];
  var INAPP_STEPS_ANDROID = [
    '오른쪽 위 메뉴(⋮)에서 「다른 브라우저로 열기」를 누릅니다.',
    '크롬(또는 삼성 인터넷)에서 로그인하고 여기서 알림을 켭니다.',
  ];
  var INAPP_STEPS_IOS = ['메뉴에서 「Safari로 열기」를 누릅니다.'].concat(IOS_STEPS);
  /** 앱 안 브라우저(web push 없음) — userAgent 표시 → 이름. 맨 끝은 안드로이드 앱 안 WebView 일반 */
  var IN_APPS = [
    [/KAKAOTALK/i, '카카오톡'],
    [/NAVER\(inapp/i, '네이버'],
    [/DaumApps/i, '다음'],
    [/\bBAND\//, '밴드'],
    [/Instagram/i, '인스타그램'],
    [/FBAN|FBAV/, '페이스북'],
    [/\bLine\//, '라인'],
    [/; wv\)/, '앱'],
  ];
  var KEY_RE = /^[A-Za-z0-9_-]+={0,2}$/;
  var SW_WAIT = 10000; // 서비스 워커가 켜지기를 기다리는 시간
  var FORGET_WAIT = 3000; // 로그아웃 때 구독 지우기를 기다리는 시간

  var S = {
    sb: null,
    session: null,
    base: '', // workflow-api
    key: '', // VAPID 공개 키
    sub: null, // 이 기기 구독
    view: '', // inapp | iosold | ios | unsupported | denied | on | off
    env: null, // envOf 결과 (안내 문구 고르기)
    msg: '',
    err: '',
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 판정 (순수 함수 — 시험이 직접 부른다) ─────────────────
  /** 알림 칸을 보이나 — 협력업체 구성원 · 본사 구성원 · 업체 신청 진행 중 · 작업자(opts.worker) */
  function canUse(me, opts) {
    if (opts && opts.worker === true) return true;
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.hq_member === true) return true;
    if (me.company && typeof me.company === 'object') return true;
    var a = me.application;
    return !!(a && typeof a === 'object' && APPLYING.indexOf(a.status) >= 0);
  }

  /** 이 브라우저 — 아이폰 · 홈 화면 앱 · web push 지원 · 권한 */
  function envOf(w) {
    var nav = w.navigator || {};
    var ua = String(nav.userAgent || '');
    var ios =
      /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    var standalone = nav.standalone === true;
    try {
      if (!standalone && w.matchMedia)
        standalone = w.matchMedia('(display-mode: standalone)').matches;
    } catch {
      /* 모르면 홈 화면 앱이 아닌 것으로 본다 */
    }
    var supported = 'serviceWorker' in nav && 'PushManager' in w && 'Notification' in w;
    var permission = supported ? w.Notification.permission : '';
    var inApp = '';
    for (var i = 0; i < IN_APPS.length && !inApp; i++) if (IN_APPS[i][0].test(ua)) inApp = IN_APPS[i][1];
    // 아이폰 web push 는 iOS 16.4 부터 — userAgent 의 OS 판을 읽을 수 있을 때만 본다(아이패드 데스크톱 모드는 모름)
    var v = ios ? ua.match(/OS (\d+)[_.](\d+)/) : null;
    var iosOld = !!v && (+v[1] < 16 || (+v[1] === 16 && +v[2] < 4));
    return {
      ios: ios,
      standalone: !!standalone,
      supported: supported,
      permission: permission,
      inApp: inApp,
      iosOld: iosOld,
    };
  }

  /** 보일 화면 — inapp | iosold | ios | unsupported | denied | on | off */
  function viewOf(env, sub) {
    if (env.inApp) return 'inapp';
    if (env.ios && env.iosOld) return 'iosold';
    if (env.ios && !env.standalone) return 'ios';
    if (!env.supported) return 'unsupported';
    if (env.permission === 'denied') return 'denied';
    return sub ? 'on' : 'off';
  }

  /** base64url VAPID 공개 키 → 바이트 (P-256 비압축 점 65바이트가 아니면 null) */
  function keyBytes(key) {
    var s = String(key || '');
    if (!KEY_RE.test(s)) return null;
    try {
      var b64 = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var raw = atob(b64);
      if (raw.length !== 65) return null;
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }

  /** 서버에 보낼 구독 — { endpoint, keys: { p256dh, auth }, user_agent } (모양이 틀리면 null) */
  function subscriptionBody(sub, ua) {
    var j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : null;
    var keys = j && j.keys;
    if (!j || typeof j.endpoint !== 'string' || !j.endpoint || !keys) return null;
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
    return {
      endpoint: j.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      user_agent: String(ua || ''),
    };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function btn(act, label, solid) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (S.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function bodyHtml() {
    if (S.view === 'ios') {
      return (
        '<p class="me-pt-warn">' +
        esc(TEXT.ios) +
        '</p><ol class="me-push-steps">' +
        IOS_STEPS.map(function (t) {
          return '<li>' + esc(t) + '</li>';
        }).join('') +
        '</ol>'
      );
    }
    if (S.view === 'inapp') {
      var env = S.env || {};
      return (
        '<p class="me-pt-warn">' +
        esc((env.inApp || '앱') + ' ' + TEXT.inapp) +
        '</p><ol class="me-push-steps">' +
        (env.ios ? INAPP_STEPS_IOS : INAPP_STEPS_ANDROID)
          .map(function (t) {
            return '<li>' + esc(t) + '</li>';
          })
          .join('') +
        '</ol>'
      );
    }
    if (S.view === 'iosold') {
      return '<p class="me-pt-warn">' + esc(TEXT.iosOld) + '</p>';
    }
    if (S.view === 'unsupported' || S.view === 'denied') {
      return '<p class="me-pt-warn">' + esc(TEXT[S.view]) + '</p>';
    }
    if (S.view === 'on') {
      return (
        '<p class="me-pt-title">' +
        esc(TEXT.on) +
        '</p><div class="rd-acts">' +
        btn('off', '끄기', false) +
        '</div>'
      );
    }
    return '<div class="rd-acts">' + btn('on', '알림 켜기', true) + '</div>';
  }

  function render() {
    var section = $('mePush');
    var root = $('mePushBody');
    if (!section || !root) return;
    root.innerHTML =
      '<div class="me-pt-box" data-view="' +
      esc(S.view) +
      '"><p class="mk-note">' +
      esc(LEAD) +
      '</p>' +
      bodyHtml() +
      (S.msg ? '<p class="me-pt-msg" role="status">' + esc(S.msg) + '</p>' : '') +
      (S.err ? '<p class="mk-error" role="alert">' + esc(S.err) + '</p>' : '') +
      '</div>';
    section.hidden = false;
  }

  // ── 서버 · 브라우저 ─────────────────────────────────────
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

  /** workflow-api 호출 → { ok, status, body } (끊기면 status 0) */
  async function call(method, path, body, auth) {
    var headers = {};
    if (auth) headers.Authorization = 'Bearer ' + (await token());
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(S.base + path, {
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
    return { ok: res.ok, status: res.status, body: b && typeof b === 'object' ? b : {} };
  }

  async function fetchKey() {
    var r = await call('GET', '/push/key', null, false);
    var d = r.ok && r.body.success === true ? r.body.data : null;
    var key = d && typeof d.key === 'string' ? d.key : '';
    return keyBytes(key) ? key : '';
  }

  /** 이 페이지의 서비스 워커 등록 (없으면 null — 기다리지 않는다) */
  async function registration() {
    try {
      var sw = navigator.serviceWorker;
      return (sw && (await sw.getRegistration())) || null;
    } catch {
      return null;
    }
  }

  async function currentSub() {
    var reg = await registration();
    try {
      return reg && reg.pushManager ? (await reg.pushManager.getSubscription()) || null : null;
    } catch {
      return null;
    }
  }

  /** 켜진 서비스 워커 — segan/shell.js 가 등록한다. 오래 걸리면 그만 기다린다 */
  function readyRegistration() {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error('service worker not ready'));
      }, SW_WAIT);
      navigator.serviceWorker.ready.then(
        function (r) {
          clearTimeout(t);
          resolve(r);
        },
        function (e) {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  /** 권한 묻기 — 옛 Safari 는 콜백으로만 답한다 */
  function askPermission() {
    return new Promise(function (resolve) {
      try {
        var p = Notification.requestPermission(resolve);
        if (p && typeof p.then === 'function') {
          p.then(resolve, function () {
            resolve('default');
          });
        }
      } catch {
        resolve('default');
      }
    });
  }

  function done(view, msg, err) {
    S.busy = false;
    S.view = view;
    S.msg = msg || '';
    S.err = err || '';
    render();
  }

  // ── 동작 ───────────────────────────────────────────────
  /** 알림 켜기 — 권한 묻기(이 단추에서만) → 구독 → POST /push/subscriptions */
  async function turnOn() {
    S.busy = true;
    S.msg = '';
    S.err = '';
    render();
    var perm = await askPermission(); // 누른 바로 그때 묻는다 (사용자 동작 안에서)
    if (perm === 'denied') return done('denied');
    if (perm !== 'granted') return done('off', '', TEXT.notAllowed);
    var sub = null;
    try {
      if (!S.key) S.key = await fetchKey();
      var bytes = keyBytes(S.key);
      if (!bytes) return done('off', '', TEXT.failOn);
      var reg = await readyRegistration();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    } catch {
      return done('off', '', TEXT.failOn);
    }
    var body = subscriptionBody(sub, navigator.userAgent);
    var r = body ? await call('POST', '/push/subscriptions', body, true) : { ok: false, body: {} };
    if (r.ok) {
      S.sub = sub;
      return done('on', TEXT.turnedOn);
    }
    // 서버에 적지 못한 구독은 남기지 않는다 — 켜진 것처럼 보이지 않게
    try {
      await sub.unsubscribe();
    } catch {
      /* noop */
    }
    S.sub = null;
    done(
      'off',
      '',
      r.status === 403 && r.body.code === 'no_company' ? TEXT.noCompany : TEXT.failOn
    );
  }

  /** 끄기 — 이 기기 구독을 풀고 DELETE /push/subscriptions (서버 쪽은 실패해도 화면은 꺼진 것으로) */
  async function turnOff() {
    S.busy = true;
    S.msg = '';
    S.err = '';
    render();
    var sub = S.sub || (await currentSub());
    if (sub) {
      var endpoint = sub.endpoint;
      try {
        await sub.unsubscribe();
      } catch {
        return done('on', '', TEXT.failOff);
      }
      if (endpoint) await call('DELETE', '/push/subscriptions', { endpoint: endpoint }, true);
    }
    S.sub = null;
    done('off', TEXT.turnedOff);
  }

  /** 이 기기 구독을 서버에 다시 적는다 (「내 정보」를 열 때, 켜져 있으면). 권한은 묻지 않는다 */
  async function resync(sub) {
    var body = subscriptionBody(sub, navigator.userAgent);
    if (!body) return;
    var r = await call('POST', '/push/subscriptions', body, true);
    if (r.ok || r.status !== 403 || r.body.code !== 'no_company') return; // 실패는 그냥 둔다
    if (S.sub !== sub || S.busy) return; // 그새 사용자가 끄거나 켜는 중
    try {
      await sub.unsubscribe();
    } catch {
      return;
    }
    S.sub = null;
    S.view = viewOf(envOf(window), null);
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || S.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'on') return turnOn();
    if (act === 'off') return turnOff();
  }

  /**
   * 알림 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data,
   * opts.worker = 작업자인가 (segan/shell.js 의 작업 탭 판정 — GET /work/me 를 다시 묻지 않는다)
   */
  async function load(sb, session, me, opts) {
    var section = $('mePush');
    var root = $('mePushBody');
    if (!section || !root) return;
    section.hidden = true;
    root.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb;
    S.session = session;
    if (!S.base || !session || !canUse(me, opts)) return;
    try {
      S.key = await fetchKey();
      if (!S.key) return; // 서버가 아직 없다 (404 · 오류) — 칸째 감춘다
      var env = envOf(window);
      S.env = env;
      S.sub = env.supported ? await currentSub() : null;
      S.view = viewOf(env, S.sub);
      S.msg = '';
      S.err = '';
      S.busy = false;
      if (!root.getAttribute('data-bound')) {
        root.setAttribute('data-bound', '1');
        root.addEventListener('click', onClick);
      }
      render();
      if (S.view === 'on') await resync(S.sub).catch(function () {}); // 칸은 이미 그렸다
    } catch {
      section.hidden = true;
      root.innerHTML = '';
    }
  }

  /**
   * 로그아웃 때 — 이 기기 구독을 서버에서 지우고 푼다 (토큰이 있을 때 부른다). 오래 걸리면 그만 기다린다.
   * 다음에 이 기기로 로그인한 사람이 앞사람의 업무 알림을 받지 않게.
   */
  function forget() {
    var job = (async function () {
      var sub = await currentSub();
      if (!sub) return;
      var endpoint = sub.endpoint;
      var cfg = window.DADAM_CONFIG || {};
      if (!S.base) S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
      if (S.base && endpoint)
        await call('DELETE', '/push/subscriptions', { endpoint: endpoint }, true);
      try {
        await sub.unsubscribe();
      } catch {
        /* noop */
      }
    })().catch(function () {});
    return new Promise(function (resolve) {
      var t = setTimeout(resolve, FORGET_WAIT);
      job.then(function () {
        clearTimeout(t);
        resolve();
      });
    });
  }

  window.SeganPush = {
    APPLYING: APPLYING,
    TEXT: TEXT,
    state: S,
    canUse: canUse,
    envOf: envOf,
    viewOf: viewOf,
    keyBytes: keyBytes,
    subscriptionBody: subscriptionBody,
    load: load,
    forget: forget,
  };
})();
