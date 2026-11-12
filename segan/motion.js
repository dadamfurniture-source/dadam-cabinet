/* ============================================================
   segan/motion.js — 앱 움직임 한 벌 (CLAUDE.md 「SEGAN 모션 규칙」 — 애플식, 웹)

   값은 애플이 쓰는 두 가지로 적는다 — 응답(초, 목표에 닿는 빠르기) · 감쇠(1.0 = 튀지 않고 멈춤).
     기본       응답 0.35 · 감쇠 1.0          (UI — 화면 · 막대 · 시트 열기)
     숫자       응답 0.6  · 감쇠 1.0          (지난 값 → 새 값으로 굴림)
     던진 것    응답 0.3  · 감쇠 0.8          (시트를 끌다 놓을 때만 — 손이 준 속도가 있을 때)
   스프링은 지금 값에서 이어 간다 — 움직이는 중에 새 목표를 주면 속도를 그대로 들고 간다(끊을 수 있다).
   transform · opacity 만 움직인다. 멈춘 모습이 곧 최종 모습이다(fill backwards — 앞쪽만 채운다).
   동작 줄이기(prefers-reduced-motion)면 밀기 · 스프링 대신 0.2초 흐려지기, 숫자는 바로 최종값.

   SeganMotion
     reduced()                         동작 줄이기인가
     spring(apply, opts)               { x, v, target, to(target, {response, damping, velocity}) → 약속, set(v), halt() }
     curve(response, damping)          같은 스프링의 CSS linear() 곡선 { easing, ms }
     UI                                curve(0.35, 1) — :root 의 --sg-spring · --sg-spring-ms 로도 둔다
     enter(el, from, delay)            들어오기 (from = 시작 keyframe — transform · opacity)
     roll(el, from, to, format, delay) 숫자 굴리기
     grow(el, scale, axis, delay)      막대 자라기 (transform scaleX · scaleY — 멈춘 모습은 scale 그대로)
     draw(path, delay)                 선 그리기 (stroke-dashoffset)
     rubber(over, dim) · project(v)    끌기 — 끝에서 고무줄 · 놓은 속도로 멈출 곳 (애플 WWDC 2018 식)
     navType(from, to)                 화면 바꾸기 방향 — 'sg-forward' · 'sg-back' · '' (흐려지기)

   화면 바꾸기 (문서 사이 — segan/shell.css 「화면 바꾸기」 칸과 짝)
     들어온 쪽으로 나간다. 방향은 두 화면의 자리만으로 정한다 — 뒤로 가기에도 같은 셈이 거꾸로 맞는다.
       탭 → 탭              폰 아래 탭 차례(홈 · 연출컷 · 시공사례 · 매거진 · 마이)대로 좌우
       탭 → 하위 화면       오른쪽에서 들어온다 (sg-forward)
       하위 화면 → 탭       왼쪽에서 돌아온다 (sg-back)
       그 밖 · PC · 동작 줄이기   0.2초 흐려지기 (방향을 정하지 않는다)
     첫 그림 전에 정해야 하므로 모든 앱 화면이 이 파일을 머리에서 바로(defer 없이) 싣는다.
   ============================================================ */
/* global window, document, location, performance, CSS, URL */
(function () {
  'use strict';

  var FALLBACK = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var REDUCED_MS = 200; // 동작 줄이기 — 흐려지기만

  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  /** 응답 · 감쇠 → 질량 1 의 강성 k · 감쇠 계수 c */
  function params(response, damping) {
    var w = (2 * Math.PI) / response;
    return { k: w * w, c: 2 * damping * w };
  }

  // 화면 주기 — 부를 때마다 window 에서 찾는다 (없으면 스프링은 바로 목표로)
  function hasFrames() {
    return typeof window.requestAnimationFrame === 'function';
  }
  function frame(fn) {
    return window.requestAnimationFrame(fn);
  }
  function cancelFrame(id) {
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
  }
  var now = function () {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  };

  /**
   * 끊을 수 있는 스프링 하나. apply(x) 를 화면 주기마다 부른다.
   * opts: value(처음 값) · response · damping · eps(멈췄다고 볼 차이)
   */
  function spring(apply, opts) {
    opts = opts || {};
    var s = {
      x: Number(opts.value) || 0,
      v: 0,
      target: Number(opts.value) || 0,
      response: opts.response || 0.35,
      damping: opts.damping == null ? 1 : opts.damping,
      eps: opts.eps || 0.01,
      running: false,
    };
    var id = 0;
    var gen = 0; // 이 번호가 바뀌면 지난 주기는 그만둔다 (주기를 못 지우는 곳에서도)
    var resolve = null;
    function finish() {
      s.running = false;
      id = 0;
      if (resolve) {
        var r = resolve;
        resolve = null;
        r();
      }
    }
    function stop() {
      if (id) cancelFrame(id);
      id = 0;
      gen++;
      s.running = false;
    }
    s.set = function (val) {
      stop();
      s.x = s.target = Number(val);
      s.v = 0;
      apply(s.x);
      finish();
    };
    s.halt = function () {
      stop();
      s.v = 0;
    };
    s.to = function (target, o) {
      o = o || {};
      if (o.response) s.response = o.response;
      if (o.damping != null) s.damping = o.damping;
      if (o.velocity != null) s.v = Number(o.velocity) || 0;
      s.target = Number(target);
      var p = new Promise(function (r) {
        var prev = resolve;
        resolve = function () {
          if (prev) prev();
          r();
        };
      });
      if (reduced() || !hasFrames()) {
        s.set(target);
        return p;
      }
      if (!s.running) {
        s.running = true;
        var mine = ++gen;
        var last = now();
        var tick = function () {
          if (mine !== gen) return;
          var t = now();
          var dt = Math.min(0.064, Math.max(0, (t - last) / 1000));
          last = t;
          var kc = params(s.response, s.damping);
          var n = Math.max(1, Math.ceil(dt * 240));
          var h = dt / n;
          for (var i = 0; i < n; i++) {
            var a = -kc.k * (s.x - s.target) - kc.c * s.v;
            s.v += a * h;
            s.x += s.v * h;
          }
          if (Math.abs(s.x - s.target) < s.eps && Math.abs(s.v) < s.eps * 20) {
            s.x = s.target;
            s.v = 0;
            apply(s.x);
            finish();
            return;
          }
          apply(s.x);
          id = frame(tick);
        };
        id = frame(tick);
      }
      return p;
    };
    return s;
  }

  /** 같은 스프링의 CSS linear() 곡선 — 끝나는 시간(오차 0.2 % 안)도 함께 */
  function curve(response, damping) {
    var w = (2 * Math.PI) / response;
    var z = damping;
    var f = function (t) {
      if (z >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
      var wd = w * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
    };
    var T = 0;
    for (var t = 0; t < 4; t += 0.004) if (Math.abs(1 - f(t)) > 0.002) T = t;
    T += 0.004;
    var pts = [];
    for (var i = 0; i <= 40; i++)
      pts.push(i === 40 ? 1 : Math.round(f((T * i) / 40) * 10000) / 10000);
    return { easing: 'linear(' + pts.join(', ') + ')', ms: Math.round(T * 1000) };
  }

  function canLinear() {
    try {
      return !!(CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));
    } catch {
      return false;
    }
  }

  var UI = canLinear() ? curve(0.35, 1) : { easing: FALLBACK, ms: 520 };
  try {
    document.documentElement.style.setProperty('--sg-spring', UI.easing);
    document.documentElement.style.setProperty('--sg-spring-ms', UI.ms + 'ms');
  } catch {
    /* 변수를 못 두면 shell.css 의 기본 곡선 */
  }

  function canAnimate(el) {
    return !!el && typeof el.animate === 'function';
  }

  /** 들어오기 — from 에서 지금 모습으로. 동작 줄이기면 흐려지기만 */
  function enter(el, from, delay) {
    if (!canAnimate(el)) return null;
    if (reduced())
      return el.animate([{ opacity: 0.4 }, { opacity: 1 }], {
        duration: REDUCED_MS,
        delay: delay || 0,
      });
    var to = {};
    for (var k in from)
      if (Object.prototype.hasOwnProperty.call(from, k)) to[k] = k === 'opacity' ? 1 : 'none';
    return el.animate([from, to], {
      duration: UI.ms,
      easing: UI.easing,
      delay: delay || 0,
      fill: 'backwards',
    });
  }

  /** 숫자 굴리기 — from → to 를 format 으로 적는다. 동작 줄이기면 바로 to */
  function roll(el, from, to, format, delay) {
    if (!el) return;
    if (el._sgRoll) el._sgRoll.halt();
    var sp = (el._sgRoll =
      el._sgRoll ||
      spring(
        function (v) {
          el.textContent = el._sgFmt(v);
        },
        { value: to, response: 0.6, damping: 1, eps: Math.max(0.001, Math.abs(to - from) / 2000) }
      ));
    el._sgFmt = format;
    if (reduced() || !hasFrames() || from === to || !isFinite(from)) {
      sp.set(to);
      return;
    }
    sp.set(from);
    window.setTimeout(function () {
      sp.to(to);
    }, delay || 0);
  }

  /** 막대 자라기 — 멈춘 모습은 scale 그대로 (axis 'x' · 'y') */
  function grow(el, scale, axis, delay) {
    if (!el) return;
    var fn = axis === 'y' ? 'scaleY' : 'scaleX';
    el.style.transform = fn + '(' + scale + ')';
    if (!canAnimate(el) || reduced()) return;
    el.animate([{ transform: fn + '(0)' }, { transform: fn + '(' + scale + ')' }], {
      duration: UI.ms + 180,
      easing: UI.easing,
      delay: delay || 0,
      fill: 'backwards',
    });
  }

  /** 선 그리기 — 왼쪽부터. 멈춘 모습은 실선 */
  function draw(path, delay) {
    if (!canAnimate(path) || reduced() || typeof path.getTotalLength !== 'function') return;
    var len = path.getTotalLength();
    if (!(len > 0)) return;
    var dash = len + ' ' + len;
    path.animate(
      [
        { strokeDasharray: dash, strokeDashoffset: len },
        { strokeDasharray: dash, strokeDashoffset: 0 },
      ],
      {
        duration: 900,
        easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)',
        delay: delay || 0,
        fill: 'backwards',
      }
    );
  }

  /** 끝을 넘어 끌면 갈수록 더 버틴다 (over = 넘은 거리, dim = 크기) */
  function rubber(over, dim, c) {
    c = c == null ? 0.55 : c;
    if (!(dim > 0)) return 0;
    return (over * dim * c) / (dim + c * Math.abs(over));
  }

  /** 놓은 속도(px/s)로 더 갈 거리 — 스크롤 감속과 같은 꼴 (d 0.998 보통) */
  function project(velocity, d) {
    d = d == null ? 0.998 : d;
    return ((velocity / 1000) * d) / (1 - d);
  }

  // ── 화면 바꾸기 (문서 사이) ─────────────────────────────
  var TAB_ORDER = ['', 'make', 'collection', 'blog', 'me']; // 폰 아래 탭 차례 — '' = 홈 (/segan/ · index)
  var WIDE = '(min-width: 1024px)'; // shell.css — 위 메뉴가 보이는 폭 (PC 는 흐려지기만)
  var FORWARD = 'sg-forward';
  var BACK = 'sg-back';

  /** 주소 → 화면 이름 (파일 이름에서 .html 을 뗀 것, 홈은 '') — 이 앱 폴더 밖이면 null */
  function screenOf(url, base) {
    var u;
    var b;
    try {
      b = new URL(base);
      u = new URL(String(url || ''), b);
    } catch {
      return null;
    }
    var dir = b.pathname.replace(/[^/]*$/, '');
    if (u.origin !== b.origin || u.pathname.indexOf(dir) !== 0) return null;
    var name = u.pathname.slice(dir.length);
    if (name.indexOf('/') >= 0) return null; // 더 깊은 곳(플래너 등)은 다른 앱
    name = name.replace(/\.html$/, '');
    return name === 'index' ? '' : name;
  }

  /** from 화면에서 to 화면으로 — 'sg-forward'(오른쪽에서) · 'sg-back'(왼쪽에서) · ''(흐려지기) */
  function navType(from, to) {
    var a = screenOf(from, to);
    var b = screenOf(to, to);
    if (a == null || b == null || a === b) return '';
    var ia = TAB_ORDER.indexOf(a);
    var ib = TAB_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ib > ia ? FORWARD : BACK;
    if (ia >= 0) return FORWARD;
    if (ib >= 0) return BACK;
    return '';
  }

  function wide() {
    try {
      return !!(window.matchMedia && window.matchMedia(WIDE).matches);
    } catch {
      return false;
    }
  }

  /** 떠나온 화면 주소 — 모르면 '' (뒤로 가기인데 어디서 왔는지 모르면 방향을 정하지 않는다) */
  function cameFrom() {
    var act = window.navigation && window.navigation.activation;
    if (act) return (act.from && act.from.url) || '';
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.type === 'back_forward') return '';
    } catch {
      /* noop */
    }
    return document.referrer || '';
  }

  // 새 화면의 첫 그림 직전 — 방향을 화면 바꾸기에 붙인다 (shell.css 가 그 이름으로 민다)
  function onReveal(e) {
    var vt = e && e.viewTransition;
    if (!vt || !vt.types || reduced() || wide()) return;
    var type = navType(cameFrom(), location.href);
    if (type) vt.types.add(type);
  }
  if (typeof window.addEventListener === 'function')
    window.addEventListener('pagereveal', onReveal);

  window.SeganMotion = {
    navType: navType,
    reduced: reduced,
    spring: spring,
    curve: curve,
    UI: UI,
    enter: enter,
    roll: roll,
    grow: grow,
    draw: draw,
    rubber: rubber,
    project: project,
  };
})();
