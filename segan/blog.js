/* ============================================================
   segan/blog.js — 매거진 책장 (blog.html) · 책 ↔ 글 화면 바꾸기 (blog.html · blog-*.html)

   책장 (blog.html 의 .bk-shelf)
     폰       브라우저 옆 스크롤 그대로 (scroll-snap — segan/magazine.css). 스크립트는 기울기만 더한다
     마우스   끌면 1:1 로 따라오고, 놓으면 놓은 속도로 멈출 책을 셈해(SeganMotion.project) 그 책에 맞춰 선다.
              끝을 넘겨 끌면 고무줄(rubber 0.55), 놓으면 돌아온다. 6px 넘게 끌었으면 누름으로 치지 않는다.
              움직이는 중에 다시 잡으면 그 자리에서 이어 간다
     기울기   옆으로 움직이는 동안 책이 끄는 반대쪽으로 아주 조금 기운다 (최대 1.5° — .bk-shelf 의 --bk-lean)
     들어오기 책이 왼쪽부터 차례로 선반에 내려앉고 칸 조명이 따라 켜진다 (60ms 간격). 글에서 돌아온 때는 하지 않는다
     ‹ ›      책이 화면보다 많을 때만 보인다 (마우스 · 키보드용)

   화면 바꾸기 (문서 사이 — magazine.css 「화면 바꾸기」 칸과 짝)
     책을 누르면 그 표지에만 view-transition-name: bk-cover 를 붙인다. 글 화면은 매거진에서 왔을 때
     글 머리 표지에 같은 이름을 붙인다 → 표지가 커지며 글 머리로 이어진다. 글에서 목록으로 돌아오면
     떠난 글의 책에 이름을 붙여 표지가 제자리로 돌아간다. 이때 segan/motion.js 가 붙인 밀기(sg-forward ·
     sg-back)는 뺀다 (본문은 0.2초 흐려지기). 화면 바꾸기를 모르는 브라우저는 평소대로 민다.
     동작 줄이기면 이름을 붙이지 않는다 (흐려지기만).

   SeganMagazine — 셈은 순수 함수로 내놓는다 (시험이 본다)
     screenOf(url)                       'list' · 글 이름('materials' …) · '' (매거진 화면이 아님)
     velocityOf(hist, now)               끌기 기록 [{t, x}] → 놓은 속도 px/s (마지막 0.1초 · 멈췄다 놓으면 0)
     snapIndex(landing, cell, count)     멈출 곳 → 맞춰 설 책 차례
     snapScroll(landing, cell, count, max) 그 책의 스크롤 자리 (끝을 넘지 않는다)
     leanOf(velocity)                    옆 속도 px/s → 기우는 각(도)
     bookFor(root, url)                  그 글의 책(a.bk-book) 또는 null
   ============================================================ */
/* global window, document, location, URL, setTimeout, clearTimeout */
(function () {
  'use strict';

  var DRAG_START = 6; // px — 이만큼 끌어야 끌기 (그 전에는 누름)
  var LEAN_MAX = 1.5; // 도
  var LEAN_AT = 1600; // px/s — 이 속도에서 가장 많이 기운다
  var STAGGER = 60; // ms — 책이 차례로 내려앉는 간격
  var NAME = 'bk-cover';
  var SLIDES = ['sg-forward', 'sg-back'];

  function motion() {
    return window.SeganMotion || null;
  }
  function reduced() {
    var M = motion();
    return !!(M && typeof M.reduced === 'function' && M.reduced());
  }

  /** 주소 → 매거진 화면 ('list' · 글 이름 · '') — /segan/blog · blog.html · blog-materials(.html) */
  function screenOf(url) {
    var name;
    if (!url) return '';
    try {
      name = new URL(String(url || ''), location.href).pathname.split('/').pop() || '';
    } catch {
      return '';
    }
    var m = /^blog(?:-([a-z0-9-]+))?(?:\.html)?$/.exec(name);
    if (!m) return '';
    return m[1] || 'list';
  }

  /** 끌기 기록 → 놓은 속도 px/s. 마지막 0.1초만 본다 — 멈췄다 놓으면 0 */
  function velocityOf(hist, now) {
    if (!hist || hist.length < 2) return 0;
    var b = hist[hist.length - 1];
    var a = b;
    for (var i = hist.length - 1; i >= 0 && b.t - hist[i].t <= 100; i--) a = hist[i];
    if (!(b.t > a.t) || now - b.t >= 80) return 0;
    return ((b.x - a.x) / (b.t - a.t)) * 1000;
  }

  function snapIndex(landing, cell, count) {
    if (!(cell > 0) || !(count > 0)) return 0;
    return Math.min(count - 1, Math.max(0, Math.round(landing / cell)));
  }

  function snapScroll(landing, cell, count, max) {
    var at = snapIndex(landing, cell, count) * cell;
    return Math.max(0, Math.min(at, Math.max(0, max || 0)));
  }

  function leanOf(velocity) {
    var d = ((Number(velocity) || 0) / LEAN_AT) * LEAN_MAX;
    return Math.max(-LEAN_MAX, Math.min(LEAN_MAX, d));
  }

  function bookFor(root, url) {
    var slug = screenOf(url);
    if (!root || !slug || slug === 'list') return null;
    var books = root.querySelectorAll('a.bk-book');
    for (var i = 0; i < books.length; i++)
      if (screenOf(books[i].getAttribute('href')) === slug) return books[i];
    return null;
  }

  // ── 화면 바꾸기 — 표지에 이름 붙이기 ─────────────────────
  function coverOf(book) {
    return book ? book.querySelector('.bk-cover') : null;
  }
  /** 이 화면에서 이름을 가질 표지는 하나뿐이다 */
  function nameCover(cover) {
    var all = document.querySelectorAll('.bk-cover');
    for (var i = 0; i < all.length; i++) all[i].style.viewTransitionName = '';
    if (cover && !reduced()) cover.style.viewTransitionName = NAME;
    return !!cover && !reduced();
  }
  function headCover() {
    return document.querySelector('.ma-cover .bk-cover');
  }

  /** 어디서 왔나 — 뒤로 · 앞으로도 떠난 화면을 안다 (Navigation API), 모르면 '' */
  function cameFrom() {
    var act = window.navigation && window.navigation.activation;
    if (act) return (act.from && act.from.url) || '';
    return '';
  }

  // 새 화면의 첫 그림 직전 — 매거진 안에서 온 것이면 표지를 잇는다
  function onReveal(e) {
    var vt = e && e.viewTransition;
    if (!vt) return;
    var from = screenOf(cameFrom());
    var here = screenOf(location.href);
    if (!from || !here || from === here) return;
    // 목록 → 글 · 글 → 글: 글 머리 표지. 글 → 목록: 떠난 글의 책
    var cover = here === 'list' ? coverOf(bookFor(document, cameFrom())) : headCover();
    if (!nameCover(cover)) return;
    if (vt.types) for (var i = 0; i < SLIDES.length; i++) vt.types.delete(SLIDES[i]);
  }

  // 이 화면을 떠나기 직전 — 글에서 매거진 안으로 가면 글 머리 표지가 떠난다
  function onSwap(e) {
    if (!e || !e.viewTransition) return;
    var here = screenOf(location.href);
    if (!here || here === 'list') return; // 목록은 누른 책에 이미 붙였다 (click)
    var to = e.activation && e.activation.entry ? screenOf(e.activation.entry.url) : '';
    if (to) nameCover(headCover());
    else nameCover(null);
  }

  // ── 책장 ────────────────────────────────────────────────
  function shelf(ul) {
    var M = motion();
    var box = ul.closest('.bk-case') || ul.parentElement;
    var books = ul.querySelectorAll('a.bk-book');
    var cells = ul.querySelectorAll('.bk-cell');
    var prev = box ? box.querySelector('.bk-nav--prev') : null;
    var next = box ? box.querySelector('.bk-nav--next') : null;

    function cell() {
      return cells.length ? cells[0].getBoundingClientRect().width : 0;
    }
    function maxScroll() {
      return Math.max(0, ul.scrollWidth - ul.clientWidth);
    }

    // 누른 책의 표지에 이름을 붙인다 (새 창 · 새 탭으로 여는 누름은 화면 바꾸기가 아니다)
    ul.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a.bk-book') : null;
      if (!a || e.defaultPrevented) return;
      if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      nameCover(coverOf(a));
    });

    // ‹ › — 넘칠 때만, 끝에서는 그쪽을 감춘다
    function navs() {
      var max = maxScroll();
      if (prev) prev.hidden = !(max > 1 && ul.scrollLeft > 1);
      if (next) next.hidden = !(max > 1 && ul.scrollLeft < max - 1);
    }

    var scrollSp = null; // 놓은 뒤 맞춰 서기 · ‹ › (스크롤 자리)
    var pullSp = null; // 끝을 넘긴 만큼 (고무줄 — transform)
    var leanSp = null; // 기울기
    if (M && typeof M.spring === 'function') {
      scrollSp = M.spring(
        function (x) {
          ul.scrollLeft = x;
        },
        { value: 0, eps: 0.5 }
      );
      pullSp = M.spring(
        function (x) {
          ul.style.transform = x ? 'translateX(' + x.toFixed(1) + 'px)' : '';
        },
        { value: 0, eps: 0.5 }
      );
      leanSp = M.spring(
        function (x) {
          ul.style.setProperty('--bk-lean', x.toFixed(2) + 'deg');
        },
        { value: 0, eps: 0.02 }
      );
    }

    function settle() {
      ul.classList.remove('is-dragging');
    }
    /** 스크롤 자리 to 로 — 스프링이 없으면 바로 */
    function glide(to, velocity, thrown) {
      if (!scrollSp) {
        ul.scrollLeft = to;
        settle();
        return;
      }
      ul.classList.add('is-dragging'); // 가는 동안 브라우저의 맞춰 서기가 끼어들지 않게
      scrollSp.x = ul.scrollLeft;
      scrollSp
        .to(to, { response: 0.3, damping: thrown ? 0.8 : 1, velocity: velocity || 0 })
        .then(function () {
          if (!drag) settle();
        });
    }

    function step(dir) {
      var c = cell();
      if (!c) return;
      var per = Math.max(1, Math.floor(ul.clientWidth / c) - 1);
      var at = Math.round(ul.scrollLeft / c) + dir * per;
      glide(snapScroll(at * c, c, cells.length, maxScroll()), 0, false);
    }
    if (prev)
      prev.addEventListener('click', function () {
        step(-1);
      });
    if (next)
      next.addEventListener('click', function () {
        step(1);
      });

    // 기울기 — 옆으로 움직이는 속도만큼, 멈추면 돌아온다
    var lastX = ul.scrollLeft;
    var lastT = Date.now();
    var rest = 0;
    ul.addEventListener(
      'scroll',
      function () {
        navs();
        if (!leanSp || reduced()) return;
        var t = Date.now();
        var dt = t - lastT;
        if (dt > 0 && dt < 120)
          leanSp.to(leanOf(((ul.scrollLeft - lastX) / dt) * 1000), { response: 0.2, damping: 1 });
        lastX = ul.scrollLeft;
        lastT = t;
        clearTimeout(rest);
        rest = setTimeout(function () {
          leanSp.to(0, { response: 0.35, damping: 1 });
        }, 90);
      },
      { passive: true }
    );

    // 마우스 끌기 — 손가락은 브라우저 스크롤이 맡는다
    var drag = null;
    var dragged = false; // 방금 끌었다 → 그 누름은 누름이 아니다
    ul.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button > 0) return;
      if (maxScroll() <= 1) return; // 넘치지 않으면 끌 것이 없다
      if (scrollSp) scrollSp.halt(); // 움직이는 중이면 그 자리에서 잡는다
      if (pullSp) pullSp.set(0);
      dragged = false;
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        from: ul.scrollLeft,
        on: false,
        hist: [{ t: Date.now(), x: e.clientX }],
      };
    });
    ul.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0;
      if (!drag.on) {
        if (Math.abs(dx) < DRAG_START) return;
        drag.on = true;
        dragged = true;
        ul.classList.add('is-dragging');
        try {
          ul.setPointerCapture(e.pointerId);
        } catch {
          /* 붙잡지 못해도 책장 안에서는 따라간다 */
        }
      }
      var max = maxScroll();
      var want = drag.from - dx; // 손을 1:1 로 따른다
      var over = want < 0 ? want : want > max ? want - max : 0;
      ul.scrollLeft = Math.max(0, Math.min(max, want));
      var pull = over && M && M.rubber ? -M.rubber(over, ul.clientWidth || 1) : 0;
      if (pullSp) pullSp.set(pull);
      drag.hist.push({ t: Date.now(), x: e.clientX });
      if (drag.hist.length > 6) drag.hist.shift();
    });
    function release(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag;
      drag = null;
      if (!d.on) return;
      var vel = e && e.type === 'pointercancel' ? 0 : -velocityOf(d.hist, Date.now()); // 스크롤 쪽 속도
      if (pullSp && pullSp.x) pullSp.to(0, { response: 0.3, damping: 1 });
      var c = cell();
      var landing = ul.scrollLeft + (M && M.project ? M.project(vel) : 0);
      var to = c ? snapScroll(landing, c, cells.length, maxScroll()) : ul.scrollLeft;
      glide(to, vel, Math.abs(vel) > 200);
    }
    ul.addEventListener('pointerup', release);
    ul.addEventListener('pointercancel', release);
    // 끈 뒤의 누름은 먹는다 (글로 넘어가지 않는다)
    ul.addEventListener(
      'click',
      function (e) {
        if (!dragged) return;
        dragged = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
    // 링크 · 그림을 집어 끄는 브라우저 동작은 막는다
    ul.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });
    // 휠 · 손가락이 들어오면 맞춰 서던 것을 그만둔다 (입력을 막지 않는다)
    ['wheel', 'touchstart'].forEach(function (type) {
      ul.addEventListener(
        type,
        function () {
          if (scrollSp && scrollSp.running) {
            scrollSp.halt();
            settle();
          }
        },
        { passive: true }
      );
    });

    // 들어오기 — 글에서 돌아온 때는 표지가 날아와 앉으므로 하지 않는다
    var fromArticle = !!bookFor(document, cameFrom());
    if (M && typeof M.enter === 'function' && !fromArticle) {
      for (var i = 0; i < books.length; i++) {
        var stand = books[i].querySelector('.bk-stand');
        var glow = books[i].querySelector('.bk-glow');
        if (stand) M.enter(stand, { opacity: 0, transform: 'translateY(-14px)' }, i * STAGGER);
        if (glow) M.enter(glow, { opacity: 0.2 }, i * STAGGER + 90);
      }
    }

    navs();
    window.addEventListener('resize', navs);
    return { step: step, navs: navs };
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagereveal', onReveal);
    window.addEventListener('pageswap', onSwap);
  }

  var api = {
    screenOf: screenOf,
    velocityOf: velocityOf,
    snapIndex: snapIndex,
    snapScroll: snapScroll,
    leanOf: leanOf,
    bookFor: bookFor,
    shelf: null,
  };
  window.SeganMagazine = api;

  function start() {
    var ul = document.querySelector('.bk-shelf');
    if (ul) api.shelf = shelf(ul);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
