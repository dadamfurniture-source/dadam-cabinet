/* ============================================================
   segan/blog.js — 매거진 책장 (blog.html · 홈 index.html 의 매거진 칸) · 책 ↔ 글 화면 바꾸기 (+ blog-*.html)

   책장 (.bk-shelf — 매거진 화면과 홈 화면에 같은 것이 놓인다)
     폰       브라우저 옆 스크롤 그대로 (scroll-snap — segan/magazine.css). 스크립트는 기울기만 더한다
     마우스   끌면 1:1 로 따라오고, 놓으면 놓은 속도로 멈출 책을 셈해(SeganMotion.project) 그 책에 맞춰 선다.
              끝을 넘겨 끌면 고무줄(rubber 0.55), 놓으면 돌아온다. 6px 넘게 끌었으면 누름으로 치지 않는다.
              움직이는 중에 다시 잡으면 그 자리에서 이어 간다
     기울기   옆으로 움직이는 동안 책이 끄는 반대쪽으로 아주 조금 기운다 (최대 1.5° — .bk-shelf 의 --bk-lean)
     들어오기 책장이 처음 화면에 보일 때 책이 왼쪽부터 차례로 선반에 내려앉고 칸 조명이 따라 켜진다 (60ms 간격 —
              홈에서는 스크롤로 내려와 보일 때). 글에서 돌아온 때는 하지 않는다
     ‹ ›      책이 화면보다 많을 때만 보인다 (마우스 · 키보드용)
     장       매거진 화면(.bk-case--pages)만 — 2026-11-23 대표님 「4열이 넘어가면 행을 추가해서 4*4, 그 이상은 다음으로
              드래그해서 넘어가도록」. 한 장 = 열(--bk-cols: PC · 태블릿 4, 폰 2) × 행(책 수만큼, 4 까지).
              책은 한 장 안에서 왼쪽 위부터 줄마다 채운다(grid-column · grid-row). 넘치면 다음 장이 오른쪽에 이어지고,
              끌기 · ‹ › · 놓은 뒤 맞춰 서기는 책 한 권이 아니라 한 장씩. 마지막 장의 빈 자리는 불 켜진 빈 칸.
              장이 둘 이상이면 아래에 장 표시(눌러서 그 장으로). 홈(index.html)의 책장은 한 줄 그대로

   화면 바꾸기 (문서 사이 — magazine.css 「화면 바꾸기」 칸과 짝)
     책을 누르면 그 표지에만 view-transition-name: bk-cover 를 붙인다. 글 화면은 매거진에서 왔을 때
     (매거진 화면 · 홈 · 다른 글) 글 머리 표지에 같은 이름을 붙인다 → 표지가 커지며 글 머리로 이어진다.
     글에서 책장(매거진 화면 · 홈)으로 돌아오면 떠난 글의 책에 이름을 붙여 표지가 제자리로 돌아간다.
     이때 segan/motion.js 가 붙인 밀기(sg-forward · sg-back)는 뺀다 (본문은 0.2초 흐려지기).
     책장에서 글이 아닌 화면으로 떠날 때는 이름을 뗀다. 화면 바꾸기를 모르는 브라우저는 평소대로 민다.
     동작 줄이기면 이름을 붙이지 않는다 (흐려지기만).

   SeganMagazine — 셈은 순수 함수로 내놓는다 (시험이 본다)
     screenOf(url)                       'list'(매거진 화면) · 'home'(홈) · 글 이름('materials' …) · '' (그 밖)
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
  var PAGE_ROWS = 4; // 한 장의 행 수 (많아야)

  /**
   * 장 나누기 (순수) — 책 n 권 · 열 cols → { rows, per, pages, at[i] = { col, row, start } }
   * col · row 는 grid 의 1 부터. 빈 칸까지 셈한 칸 수는 pages * per
   */
  function pageLayout(n, cols) {
    cols = Math.max(1, Math.floor(cols) || 1);
    var rows = Math.min(PAGE_ROWS, Math.max(1, Math.ceil(n / cols)));
    var per = cols * rows;
    var pages = Math.max(1, Math.ceil(n / per));
    var at = [];
    for (var i = 0; i < pages * per; i++) {
      var page = Math.floor(i / per);
      var k = i % per;
      at.push({
        col: page * cols + (k % cols) + 1,
        row: Math.floor(k / cols) + 1,
        start: k === 0,
      });
    }
    return { cols: cols, rows: rows, per: per, pages: pages, at: at };
  }

  function motion() {
    return window.SeganMotion || null;
  }
  function reduced() {
    var M = motion();
    return !!(M && typeof M.reduced === 'function' && M.reduced());
  }

  /**
   * 주소 → 책이 있는 화면 ('list' · 'home' · 글 이름 · '')
   * — /segan/blog · blog.html · blog-materials(.html) · 홈은 /segan/ · /segan/index(.html)
   */
  function screenOf(url) {
    var path;
    if (!url) return '';
    try {
      path = new URL(String(url || ''), location.href).pathname;
    } catch {
      return '';
    }
    if (/\/segan\/(?:index(?:\.html)?)?$/.test(path)) return 'home';
    var m = /^blog(?:-([a-z0-9-]+))?(?:\.html)?$/.exec(path.split('/').pop() || '');
    if (!m) return '';
    return m[1] || 'list';
  }
  /** 책장이 놓인 화면인가 (매거진 화면 · 홈) */
  function isShelf(screen) {
    return screen === 'list' || screen === 'home';
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
    if (!root || !slug || isShelf(slug)) return null;
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

  // 새 화면의 첫 그림 직전 — 책이 있는 화면에서 온 것이면 표지를 잇는다
  function onReveal(e) {
    var vt = e && e.viewTransition;
    if (!vt) return;
    var from = screenOf(cameFrom());
    var here = screenOf(location.href);
    if (!from || !here || from === here) return;
    // 책장 → 글 · 글 → 글: 글 머리 표지. 글 → 책장: 떠난 글의 책 (책장 ↔ 책장은 책이 없어 그냥 넘어간다)
    var cover = isShelf(here) ? coverOf(bookFor(document, cameFrom())) : headCover();
    if (!nameCover(cover)) return;
    if (vt.types) for (var i = 0; i < SLIDES.length; i++) vt.types.delete(SLIDES[i]);
  }

  // 이 화면을 떠나기 직전 — 글에서 책이 있는 화면으로 가면 글 머리 표지가 떠난다
  function onSwap(e) {
    if (!e || !e.viewTransition) return;
    var here = screenOf(location.href);
    if (!here) return;
    var to = e.activation && e.activation.entry ? screenOf(e.activation.entry.url) : '';
    if (isShelf(here)) {
      // 책장은 누른 책에 이미 붙였다 (click). 글이 아닌 화면으로 떠날 때는 앞서 붙인 이름을 뗀다
      if (!to || isShelf(to)) nameCover(null);
      return;
    }
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
    var paged = !!box && box.classList.contains('bk-case--pages');
    var lay = null; // 장으로 놓았을 때의 pageLayout (못 놓으면 null — 한 줄 책장)
    var dots = null;

    function cell() {
      return cells.length ? cells[0].getBoundingClientRect().width : 0;
    }
    /** 맞춰 서는 한 단위 — 장이면 한 장 폭, 아니면 책 한 권 */
    function unit() {
      return lay ? cell() * lay.cols : cell();
    }
    function units() {
      return lay ? lay.pages : cells.length;
    }
    function maxScroll() {
      return Math.max(0, ul.scrollWidth - ul.clientWidth);
    }

    /** 지금 폭의 열 수 — magazine.css 의 --bk-cols (모르면 0 — 한 줄 책장 그대로) */
    function colsNow() {
      if (!paged || typeof window.getComputedStyle !== 'function') return 0;
      var n = parseInt(window.getComputedStyle(box).getPropertyValue('--bk-cols'), 10);
      return n > 0 ? n : 0;
    }

    /** 책을 장으로 놓는다 — 열 수가 바뀔 때만 다시 (빈 칸도 그때 다시 만든다) */
    function arrange() {
      var cols = colsNow();
      if ((lay ? lay.cols : 0) === cols) return false;
      [].forEach.call(ul.querySelectorAll('.bk-cell--empty'), function (li) {
        li.remove();
      });
      var real = [].slice.call(ul.querySelectorAll('.bk-cell'));
      if (!cols) {
        lay = null;
        ul.classList.remove('is-paged');
        real.forEach(function (li) {
          li.style.gridColumn = '';
          li.style.gridRow = '';
          li.classList.remove('is-page-start');
        });
      } else {
        lay = pageLayout(real.length, cols);
        for (var i = real.length; i < lay.at.length; i++) {
          var li = document.createElement('li');
          li.className = 'bk-cell bk-cell--empty';
          li.setAttribute('aria-hidden', 'true');
          li.innerHTML = '<span class="bk-niche"><span class="bk-glow"></span></span>';
          ul.appendChild(li);
          real.push(li);
        }
        real.forEach(function (li, k) {
          li.style.gridColumn = String(lay.at[k].col);
          li.style.gridRow = String(lay.at[k].row);
          li.classList.toggle('is-page-start', lay.at[k].start);
        });
        ul.classList.add('is-paged');
      }
      cells = ul.querySelectorAll('.bk-cell:not(.bk-cell--empty)');
      drawDots();
      return true;
    }

    /** 장 표시 — 장이 둘 이상일 때만. 누르면 그 장으로 */
    function drawDots() {
      if (!paged || !box) return;
      if (!dots) {
        dots = document.createElement('div');
        dots.className = 'bk-dots';
        dots.setAttribute('role', 'group');
        dots.setAttribute('aria-label', '책장 장');
        dots.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('[data-page]') : null;
          if (!b) return;
          var c = unit();
          glide(snapScroll(Number(b.getAttribute('data-page')) * c, c, units(), maxScroll()), 0, false);
        });
        box.appendChild(dots);
      }
      var n = lay ? lay.pages : 1;
      dots.hidden = n < 2;
      var html = '';
      for (var i = 0; i < n; i++)
        html +=
          '<button type="button" class="bk-dot" data-page="' + i + '" aria-label="' + (i + 1) + '쪽"></button>';
      if (dots.getAttribute('data-n') !== String(n)) {
        dots.innerHTML = html;
        dots.setAttribute('data-n', String(n));
      }
      markDot();
    }
    function markDot() {
      if (!dots || dots.hidden) return;
      var c = unit();
      var on = c ? Math.round(ul.scrollLeft / c) : 0;
      [].forEach.call(dots.querySelectorAll('[data-page]'), function (b) {
        if (Number(b.getAttribute('data-page')) === on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
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
      var c = unit();
      if (!c) return;
      var per = lay ? 1 : Math.max(1, Math.floor(ul.clientWidth / c) - 1); // 장이면 한 장씩
      var at = Math.round(ul.scrollLeft / c) + dir * per;
      glide(snapScroll(at * c, c, units(), maxScroll()), 0, false);
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
        markDot();
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
      var c = unit();
      var landing = ul.scrollLeft + (M && M.project ? M.project(vel) : 0);
      // 장이면 한 번 놓을 때 많아야 한 장 — 힘껏 던져도 바로 옆 장까지만
      if (lay && c) {
        var here = Math.round(d.from / c) * c;
        landing = Math.max(here - c, Math.min(here + c, landing));
      }
      var to = c ? snapScroll(landing, c, units(), maxScroll()) : ul.scrollLeft;
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

    // 들어오기 — 책장이 처음 화면에 보일 때 한 번 (홈에서는 스크롤로 내려와야 보인다).
    // 글에서 돌아온 때는 표지가 날아와 앉으므로 하지 않는다
    var settled = false;
    function settleIn() {
      if (settled) return;
      settled = true;
      for (var i = 0; i < books.length; i++) {
        var stand = books[i].querySelector('.bk-stand');
        var glow = books[i].querySelector('.bk-glow');
        if (stand) M.enter(stand, { opacity: 0, transform: 'translateY(-14px)' }, i * STAGGER);
        if (glow) M.enter(glow, { opacity: 0.2 }, i * STAGGER + 90);
      }
    }
    var fromArticle = !!bookFor(document, cameFrom());
    if (M && typeof M.enter === 'function' && !fromArticle) {
      if (typeof window.IntersectionObserver === 'function') {
        var io = new window.IntersectionObserver(
          function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (!entries[i].isIntersecting) continue;
              io.disconnect();
              settleIn();
              return;
            }
          },
          { rootMargin: '0px 0px -12% 0px' }
        );
        io.observe(ul);
      } else settleIn();
    }

    arrange();
    navs();
    // 폭이 바뀌면 — 열 수가 바뀌었으면 다시 놓고, 보던 장(그 장의 첫 책)에 맞춰 선다
    window.addEventListener('resize', function () {
      var c0 = unit();
      var page = c0 ? Math.round(ul.scrollLeft / c0) : 0;
      var first = lay ? page * lay.per : 0;
      if (arrange() && lay) ul.scrollLeft = Math.floor(first / lay.per) * unit();
      navs();
      markDot();
    });
    return { step: step, navs: navs, arrange: arrange };
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
    pageLayout: pageLayout,
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
