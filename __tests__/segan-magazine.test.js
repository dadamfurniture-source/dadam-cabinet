/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, afterEach, __dirname, document, window, DOMParser, jest */
/**
 * SEGAN 매거진 책장 — segan/blog.js (끌기 · 기울기 · 책 ↔ 글 화면 바꾸기) · segan/magazine.css.
 * 화면 구조(책 · 표지 · 글 화면의 표지)는 segan-info-pages.test.js 가 본다.
 *
 *   - 책장은 매거진 화면(blog.html)과 홈(index.html)에 같은 것이 놓인다
 *   - 셈: 주소 → 화면 이름 · 놓은 속도 · 맞춰 설 책 · 기우는 각 · 그 글의 책
 *   - 마우스 끌기: 6px 넘게 끌면 끌기(그 누름은 글로 가지 않는다) · 1:1 · 놓으면 책에 맞춰 선다 ·
 *     끝을 넘기면 고무줄. 손가락은 브라우저 스크롤에 맡긴다
 *   - ‹ ›: 책이 화면보다 많을 때만
 *   - 화면 바꾸기: 누른 책의 표지에만 이름 · 글에서 돌아오면 떠난 글의 책 · 밀기는 뺀다 · 동작 줄이기면 붙이지 않는다
 *   - magazine.css: 색은 머리의 --bk-* 에만 · transform · opacity 만 움직인다 · 동작 줄이기
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CSS = read('segan/magazine.css').replace(/\/\*[\s\S]*?\*\//g, '');

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const CELL = 200; // 시험에서 쓰는 칸 폭
const addListener = window.addEventListener.bind(window);
let listeners = []; // 스크립트가 window 에 건 것 — 화면을 다시 올릴 때 · 시험이 끝날 때 걷는다
function unhook() {
  for (const [type, fn] of listeners) window.removeEventListener(type, fn);
  listeners = [];
}

/**
 * 화면을 올리고 motion.js · blog.js 를 돌린다.
 * opts: page · reduced(동작 줄이기) · clientWidth(책장 보이는 폭) · from(떠나온 주소) · url(이 화면 주소)
 */
function load(options = {}) {
  const opts = { page: 'blog.html', reduced: false, clientWidth: 500, from: '', ...options };
  const doc = new DOMParser().parseFromString(read(`segan/${opts.page}`), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', opts.url || `/segan/${opts.page}`);
  window.matchMedia = (q) => ({
    matches: /prefers-reduced-motion/.test(q) ? opts.reduced : false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: opts.from ? { activation: { from: { url: opts.from } } } : undefined,
  });
  // 화면 주기 — 시험이 손으로 넘긴다
  const frames = [];
  let clock = 0;
  window.requestAnimationFrame = (fn) => frames.push(fn);
  window.cancelAnimationFrame = () => {};
  jest.spyOn(window.performance, 'now').mockImplementation(() => clock);
  const run = (ms = 3000) => {
    for (let t = 0; t < ms && frames.length; t += 16) {
      clock += 16;
      frames.splice(0).forEach((fn) => fn(clock));
    }
  };
  const ul = $('.bk-shelf');
  if (ul) {
    const count = ul.querySelectorAll('.bk-cell').length;
    Object.defineProperty(ul, 'clientWidth', { configurable: true, value: opts.clientWidth });
    Object.defineProperty(ul, 'scrollWidth', {
      configurable: true,
      value: Math.max(count * CELL, opts.clientWidth),
    });
    let left = 0;
    Object.defineProperty(ul, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (v) => {
        left = Math.max(0, Math.min(Number(v), ul.scrollWidth - ul.clientWidth));
      },
    });
    ul.setPointerCapture = jest.fn();
    for (const cell of ul.querySelectorAll('.bk-cell'))
      cell.getBoundingClientRect = () => ({ width: CELL, height: 300, left: 0, top: 0 });
  }
  // 들어오기 — 어느 것이 움직였는지 적는다
  const entered = [];
  for (const el of $$('.bk-stand, .bk-glow'))
    el.animate = jest.fn((frames_, o) => entered.push([el.className, frames_[0], o.delay]));

  unhook(); // 앞서 올린 화면의 스크립트는 걷는다
  window.addEventListener = (type, fn, o) => {
    listeners.push([type, fn]);
    return addListener(type, fn, o);
  };
  delete window.SeganMotion;
  delete window.SeganMagazine;
  (0, eval)(read('segan/motion.js'));
  (0, eval)(read('segan/blog.js'));
  return { ul, run, entered, Mag: window.SeganMagazine };
}

/** 포인터 일 — jsdom 에는 PointerEvent 가 없어 MouseEvent 에 칸을 얹는다 */
function ptr(el, type, x, more = {}) {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: more.pointerType || 'mouse' });
  el.dispatchEvent(e);
  return e;
}
/** 누름 — 글로 넘어가려 했는지(막지 않았는지) */
function click(el, init = {}) {
  const e = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  // jsdom 은 링크 누름을 실제로 옮기지 않는다 — 막혔는지만 본다
  el.dispatchEvent(e);
  return e;
}
const named = () =>
  $$('.bk-cover')
    .filter((c) => c.style.viewTransitionName)
    .map((c) => [...c.classList].find((n) => n.startsWith('bk-cover--')).replace('bk-cover--', ''));
/** 화면 바꾸기 일 (pagereveal · pageswap) */
function transition(type, init = {}) {
  const types = new Set(init.types || []);
  const e = new window.Event(type);
  if (!init.none) e.viewTransition = { types };
  if (init.to) e.activation = { entry: { url: init.to } };
  window.dispatchEvent(e);
  return [...types];
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  unhook();
  window.addEventListener = addListener;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('셈 (SeganMagazine)', () => {
  test('주소 → 화면 — 매거진 화면 list · 홈 home · 글 이름 · 그 밖은 빈 글 (확장자 없는 주소 · 쿼리 · # 도)', () => {
    const { Mag } = load();
    expect(
      [
        'https://dadamfurniture.com/segan/blog',
        '/segan/blog.html',
        'blog.html?v=1#top',
        'https://dadamfurniture.com/segan/blog-materials',
        'blog-kitchen-appliances.html',
        '/segan/blog-edge-finish.html#a',
        'https://dadamfurniture.com/segan/',
        '/segan/index.html?g=1#result',
        '/segan/index',
        'https://dadamfurniture.com/',
        '/segan/collection.html',
        '/segan/blogger.html',
        '',
      ].map(Mag.screenOf)
    ).toEqual([
      'list',
      'list',
      'list',
      'materials',
      'kitchen-appliances',
      'edge-finish',
      'home',
      'home',
      'home',
      '',
      '',
      '',
      '',
    ]);
  });

  test('놓은 속도 — 마지막 0.1초만 본다, 멈췄다 놓으면 0', () => {
    const { Mag } = load();
    const hist = [
      { t: 0, x: 0 },
      { t: 900, x: 400 }, // 오래전 — 셈에 안 든다
      { t: 950, x: 420 },
      { t: 1000, x: 470 },
    ];
    expect(Mag.velocityOf(hist, 1010)).toBeCloseTo(700); // (470 − 400) / 0.1초
    expect(Mag.velocityOf(hist, 1200)).toBe(0); // 멈췄다 놓음
    expect(Mag.velocityOf([{ t: 0, x: 0 }], 10)).toBe(0);
    expect(Mag.velocityOf([], 10)).toBe(0);
  });

  test('맞춰 설 책 — 멈출 곳에서 가장 가까운 책, 처음 · 끝을 넘지 않는다', () => {
    const { Mag } = load();
    expect([0, 99, 100, 101, 399, 9999, -500].map((x) => Mag.snapIndex(x, 200, 4))).toEqual([
      0, 0, 1, 1, 2, 3, 0,
    ]);
    expect(Mag.snapIndex(100, 0, 4)).toBe(0); // 칸 폭을 모르면 처음
    // 스크롤 자리 — 끝 책은 책장 끝(300)까지만
    expect([0, 120, 330, 9999].map((x) => Mag.snapScroll(x, 200, 4, 300))).toEqual([
      0, 200, 300, 300,
    ]);
  });

  test('기우는 각 — 속도에 비례, 최대 1.5°', () => {
    const { Mag } = load();
    expect(Mag.leanOf(0)).toBe(0);
    expect(Mag.leanOf(800)).toBeCloseTo(0.75);
    expect(Mag.leanOf(-800)).toBeCloseTo(-0.75);
    expect(Mag.leanOf(99999)).toBe(1.5);
    expect(Mag.leanOf(-99999)).toBe(-1.5);
  });

  test('그 글의 책 — 주소로 찾는다 (목록 · 다른 화면은 없음)', () => {
    const { Mag } = load();
    const book = Mag.bookFor(document, 'https://dadamfurniture.com/segan/blog-hardware');
    expect(book.getAttribute('href')).toBe('blog-hardware.html');
    expect(Mag.bookFor(document, '/segan/blog.html')).toBeNull();
    expect(Mag.bookFor(document, 'https://dadamfurniture.com/segan/')).toBeNull();
    expect(Mag.bookFor(document, '/segan/make.html')).toBeNull();
    expect(Mag.bookFor(document, '/segan/blog-none.html')).toBeNull();
  });
});

describe('책장 — 마우스 끌기', () => {
  test('6px 넘게 끌면 끌기 — 손을 1:1 로 따르고, 그 누름은 글로 가지 않는다', () => {
    const { ul } = load();
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 300);
    ptr(book, 'pointermove', 296);
    expect(ul.classList.contains('is-dragging')).toBe(false); // 아직 누름
    expect(ul.scrollLeft).toBe(0);
    ptr(book, 'pointermove', 220);
    expect(ul.classList.contains('is-dragging')).toBe(true);
    expect(ul.scrollLeft).toBe(80); // 왼쪽으로 80 끌었다
    expect(ul.setPointerCapture).toHaveBeenCalledWith(1);
    ptr(book, 'pointermove', 180);
    expect(ul.scrollLeft).toBe(120);
    jest.advanceTimersByTime(300);
    ptr(book, 'pointerup', 180);
    expect(click(book).defaultPrevented).toBe(true);
    expect(named()).toEqual([]); // 끈 것은 책을 고른 것이 아니다
    // 그다음 누름은 다시 누름이다
    expect(click(book).defaultPrevented).toBe(false);
  });

  test('끌지 않은 누름은 그대로 글로 — 그 책의 표지에만 이름이 붙는다', () => {
    load();
    const [first, second] = $$('a.bk-book');
    ptr(second, 'pointerdown', 300);
    ptr(second, 'pointermove', 303);
    ptr(second, 'pointerup', 303);
    expect(click(second).defaultPrevented).toBe(false);
    expect(named()).toEqual(['edge-finish']);
    click(first);
    expect(named()).toEqual(['materials']); // 이름은 늘 하나
  });

  test('새 탭 · 새 창으로 여는 누름에는 이름을 붙이지 않는다', () => {
    load();
    const book = $('a.bk-book');
    click(book, { ctrlKey: true });
    click(book, { metaKey: true });
    click(book, { shiftKey: true });
    click(book, { button: 1 });
    expect(named()).toEqual([]);
  });

  test('놓으면 책에 맞춰 선다 — 멈췄다 놓으면 가까운 책, 가는 동안은 브라우저의 맞춰 서기를 끈다', () => {
    const { ul, run } = load();
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 400);
    ptr(book, 'pointermove', 270); // 130 — 둘째 책(200)이 더 가깝다
    jest.advanceTimersByTime(300); // 멈췄다 놓는다
    ptr(book, 'pointerup', 270);
    expect(ul.classList.contains('is-dragging')).toBe(true);
    run();
    return Promise.resolve().then(() => {
      expect(ul.scrollLeft).toBe(200);
      expect(ul.classList.contains('is-dragging')).toBe(false);
    });
  });

  test('던지면 놓은 속도만큼 더 간다 — 끝을 넘지는 않는다', () => {
    const { ul, run } = load();
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 400);
    for (const x of [380, 340, 300, 260]) {
      jest.advanceTimersByTime(16);
      ptr(book, 'pointermove', x);
    }
    expect(ul.scrollLeft).toBe(140);
    jest.advanceTimersByTime(8);
    ptr(book, 'pointerup', 260); // 빠르게 왼쪽으로 던졌다
    run();
    expect(ul.scrollLeft).toBe(300); // 책 넷 800 − 보이는 폭 500
  });

  test('끝을 넘겨 끌면 고무줄 — 책장이 덜 따라오고, 놓으면 돌아온다', () => {
    const { ul, run } = load();
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 100);
    ptr(book, 'pointermove', 300); // 처음에서 오른쪽으로 200 더
    expect(ul.scrollLeft).toBe(0);
    const pulled = Number(/translateX\(([\d.]+)px\)/.exec(ul.style.transform)[1]);
    expect(pulled).toBeGreaterThan(40);
    expect(pulled).toBeLessThan(200); // 손보다 덜 간다
    jest.advanceTimersByTime(300);
    ptr(book, 'pointerup', 300);
    run();
    expect(ul.style.transform).toBe('');
    expect(ul.scrollLeft).toBe(0);
  });

  test('손가락 · 펜은 브라우저 스크롤에 맡긴다 — 스크립트가 끌지 않는다', () => {
    const { ul } = load();
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 300, { pointerType: 'touch' });
    ptr(book, 'pointermove', 200, { pointerType: 'touch' });
    expect(ul.classList.contains('is-dragging')).toBe(false);
    expect(ul.scrollLeft).toBe(0);
    expect(click(book).defaultPrevented).toBe(false);
  });

  test('책이 다 보이면 끌 것이 없다', () => {
    const { ul } = load({ clientWidth: 800 });
    const book = $('a.bk-book');
    ptr(book, 'pointerdown', 300);
    ptr(book, 'pointermove', 200);
    expect(ul.classList.contains('is-dragging')).toBe(false);
    expect(click(book).defaultPrevented).toBe(false);
  });

  test('링크 · 그림을 집어 끄는 브라우저 동작은 막는다', () => {
    const { ul } = load();
    const e = new window.Event('dragstart', { bubbles: true, cancelable: true });
    ul.querySelector('a.bk-book').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('책장 — ‹ › · 기울기 · 들어오기', () => {
  test('‹ › 는 책이 화면보다 많을 때만 — 처음에는 ›, 끝에서는 ‹', () => {
    const { ul, run } = load();
    const [prev, next] = [$('.bk-nav--prev'), $('.bk-nav--next')];
    expect([prev.hidden, next.hidden]).toEqual([true, false]);
    next.click();
    run();
    ul.dispatchEvent(new window.Event('scroll'));
    expect(ul.scrollLeft).toBe(200); // 보이는 책 둘 — 한 권 남기고 넘긴다
    expect([prev.hidden, next.hidden]).toEqual([false, false]);
    next.click();
    run();
    ul.dispatchEvent(new window.Event('scroll'));
    expect(ul.scrollLeft).toBe(300);
    expect([prev.hidden, next.hidden]).toEqual([false, true]);
    prev.click();
    run();
    prev.click();
    run();
    ul.dispatchEvent(new window.Event('scroll'));
    expect(ul.scrollLeft).toBe(0);
    expect([prev.hidden, next.hidden]).toEqual([true, false]);
  });

  test('책이 다 보이면 ‹ › 는 감춘 채로 둔다', () => {
    load({ clientWidth: 800 });
    expect([$('.bk-nav--prev').hidden, $('.bk-nav--next').hidden]).toEqual([true, true]);
  });

  test('옆으로 움직이는 동안 책이 기울고(--bk-lean), 멈추면 돌아온다', () => {
    const { ul, run } = load();
    jest.setSystemTime(1000);
    ul.dispatchEvent(new window.Event('scroll'));
    jest.setSystemTime(1016);
    ul.scrollLeft = 16; // 16ms 에 16px = 1000px/s
    ul.dispatchEvent(new window.Event('scroll'));
    run(400);
    const lean = parseFloat(ul.style.getPropertyValue('--bk-lean'));
    expect(lean).toBeGreaterThan(0.5);
    expect(lean).toBeLessThanOrEqual(1.5);
    jest.advanceTimersByTime(100); // 더 움직이지 않는다
    run();
    expect(parseFloat(ul.style.getPropertyValue('--bk-lean'))).toBe(0);
  });

  test('동작 줄이기 — 기울지 않는다', () => {
    const { ul, run } = load({ reduced: true });
    jest.setSystemTime(1000);
    ul.dispatchEvent(new window.Event('scroll'));
    jest.setSystemTime(1016);
    ul.scrollLeft = 16;
    ul.dispatchEvent(new window.Event('scroll'));
    run();
    expect(ul.style.getPropertyValue('--bk-lean')).toBe('');
  });

  test('들어오기 — 책이 왼쪽부터 60ms 간격으로 내려앉고 조명이 따라 켜진다 (멈춘 모습이 최종 모습)', () => {
    const { entered } = load();
    const stands = entered.filter(([cls]) => cls === 'bk-stand');
    const glows = entered.filter(([cls]) => cls === 'bk-glow');
    expect(stands.map(([, from, delay]) => [from, delay])).toEqual(
      [0, 60, 120, 180].map((d) => [{ opacity: 0, transform: 'translateY(-14px)' }, d])
    );
    expect(glows.map(([, from, delay]) => [from, delay])).toEqual(
      [90, 150, 210, 270].map((d) => [{ opacity: 0.2 }, d])
    );
  });

  test('들어오기는 책장이 처음 화면에 보일 때 한 번 — 홈에서는 스크롤로 내려와야 책이 내려앉는다', () => {
    let seen = null;
    const observed = [];
    const disconnect = jest.fn();
    window.IntersectionObserver = function (cb) {
      seen = cb;
      return { observe: (el) => observed.push(el), disconnect };
    };
    try {
      const { entered, ul } = load({ page: 'index.html' });
      expect(observed).toEqual([ul]);
      expect(entered).toEqual([]); // 아직 화면 아래
      seen([{ isIntersecting: false }]);
      expect(entered).toEqual([]);
      seen([{ isIntersecting: true }]);
      expect(entered.filter(([cls]) => cls === 'bk-stand')).toHaveLength(4);
      expect(disconnect).toHaveBeenCalledTimes(1);
      seen([{ isIntersecting: true }]); // 다시 보여도 한 번뿐 (지켜보기를 끊었다)
      expect(entered.filter(([cls]) => cls === 'bk-stand')).toHaveLength(4);
    } finally {
      delete window.IntersectionObserver;
    }
  });

  test('글에서 돌아온 때는 들어오기를 하지 않는다 — 표지가 날아와 앉는다', () => {
    const { entered } = load({ from: 'https://dadamfurniture.com/segan/blog-hardware' });
    expect(entered).toEqual([]);
  });
});

describe('화면 바꾸기 — 책 ↔ 글', () => {
  test('목록 → 글: 글 머리 표지에 이름을 붙이고 밀기(sg-forward)는 뺀다', () => {
    load({ page: 'blog-hardware.html', from: 'https://dadamfurniture.com/segan/blog' });
    expect(transition('pagereveal', { types: ['sg-forward'] })).toEqual([]);
    expect(named()).toEqual(['hardware']);
    expect($('.ma-cover .bk-cover').style.viewTransitionName).toBe('bk-cover');
  });

  test('글 → 목록: 떠난 글의 책에 이름을 붙이고 밀기(sg-back)는 뺀다', () => {
    load({ from: 'https://dadamfurniture.com/segan/blog-kitchen-appliances' });
    expect(transition('pagereveal', { types: ['sg-back'] })).toEqual([]);
    expect(named()).toEqual(['kitchen-appliances']);
  });

  test('홈의 책장도 같다 — 홈 → 글은 글 머리 표지, 글 → 홈은 떠난 글의 책', () => {
    load({ page: 'blog-hardware.html', from: 'https://dadamfurniture.com/segan/' });
    expect(transition('pagereveal', { types: ['sg-forward'] })).toEqual([]);
    expect(named()).toEqual(['hardware']);
    load({
      page: 'index.html',
      url: '/segan/',
      from: 'https://dadamfurniture.com/segan/blog-hardware',
    });
    expect(transition('pagereveal', { types: ['sg-back'] })).toEqual([]);
    expect(named()).toEqual(['hardware']);
    // 홈에서 누른 책에도 이름이 붙는다
    load({ page: 'index.html', url: '/segan/' });
    click($$('a.bk-book')[1]);
    expect(named()).toEqual(['edge-finish']);
  });

  test('책장 ↔ 책장(홈 ↔ 매거진 화면)은 책이 없다 — 평소대로 밀고, 앞서 붙인 이름은 뗀다', () => {
    load({ from: 'https://dadamfurniture.com/segan/' });
    expect(transition('pagereveal', { types: ['sg-forward'] })).toEqual(['sg-forward']);
    expect(named()).toEqual([]);
    // 책을 눌렀다가(이름이 붙음) 돌아와서 다른 탭으로 떠난다 → 이름을 뗀다
    load({ page: 'index.html', url: '/segan/' });
    click($('a.bk-book'));
    expect(named()).toEqual(['materials']);
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/blog-materials' });
    expect(named()).toEqual(['materials']); // 글로 가는 길 — 그대로
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/blog' });
    expect(named()).toEqual([]);
    click($('a.bk-book'));
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/make' });
    expect(named()).toEqual([]);
  });

  test('글 → 다른 글도 표지가 이어진다', () => {
    load({ page: 'blog-materials.html', from: '/segan/blog-hardware.html' });
    transition('pagereveal', { types: ['sg-forward'] });
    expect(named()).toEqual(['materials']);
  });

  test('책이 없는 화면에서 온 때는 평소대로 민다 — 이름을 붙이지 않는다', () => {
    load({ page: 'blog-hardware.html', from: 'https://dadamfurniture.com/segan/make' });
    expect(transition('pagereveal', { types: ['sg-forward'] })).toEqual(['sg-forward']);
    expect(named()).toEqual([]);
    load({ from: 'https://dadamfurniture.com/segan/collection' });
    expect(transition('pagereveal', { types: ['sg-back'] })).toEqual(['sg-back']);
    expect(named()).toEqual([]);
  });

  test('글을 떠날 때 — 책이 있는 화면(매거진 화면 · 홈 · 다른 글)으로 가면 글 머리 표지가 떠나고, 그 밖으로 가면 이름을 뗀다', () => {
    load({ page: 'blog-hardware.html', from: 'https://dadamfurniture.com/segan/make' });
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/' });
    expect(named()).toEqual(['hardware']);
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/blog' });
    expect(named()).toEqual(['hardware']);
    transition('pageswap', { to: 'https://dadamfurniture.com/segan/make' });
    expect(named()).toEqual([]);
  });

  test('화면 바꾸기를 모르는 브라우저 — 아무것도 하지 않는다', () => {
    load({ page: 'blog-hardware.html', from: 'https://dadamfurniture.com/segan/blog' });
    transition('pagereveal', { none: true });
    transition('pageswap', { none: true, to: '/segan/blog.html' });
    expect(named()).toEqual([]);
  });

  test('동작 줄이기 — 이름을 붙이지 않는다 (흐려지기만), 밀기 종류도 건드리지 않는다', () => {
    load({ page: 'blog-hardware.html', reduced: true, from: '/segan/blog.html' });
    expect(transition('pagereveal', { types: [] })).toEqual([]);
    expect(named()).toEqual([]);
    load({ reduced: true });
    click($('a.bk-book'));
    expect(named()).toEqual([]);
  });
});

describe('magazine.css — 매거진만의 예외를 한곳에', () => {
  test('색 값은 머리의 --bk-* 에만 적는다 (그 밖은 v5 토큰 · --bk-* 를 읽는다)', () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;
    const decls = CSS.split(/[;{}]/)
      .map((d) => d.trim())
      .filter((d) => literal.test(d));
    expect(decls.length).toBeGreaterThan(8);
    for (const d of decls) expect(d).toMatch(/^--bk-[\w-]+:/);
    // 숫자 셋으로 둔 색(--bk-*-rgb)은 rgba(var(…)) 로만 읽는다
    const triples = CSS.split(/[;{}]/)
      .map((d) => d.trim())
      .filter((d) => /^--[\w-]+:\s*\d+,\s*\d+,\s*\d+$/.test(d));
    for (const d of triples) expect(d).toMatch(/^--bk-[\w-]+-rgb:/);
    // 나무 · 조명은 다른 화면 파일로 새지 않는다
    for (const file of ['segan/shell.css', 'segan/info.css', 'segan/home.css'])
      expect(read(file)).not.toMatch(/--bk-/);
  });

  test('transform(translate · scale · rotate) · opacity 만 움직인다', () => {
    const moved = [...CSS.matchAll(/transition:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => v !== 'none')
      .flatMap((v) => v.split(/,(?![^(]*\))/).map((part) => part.trim().split(/\s+/)[0]));
    expect(moved.length).toBeGreaterThan(3);
    for (const prop of moved) expect(['translate', 'scale', 'rotate', 'opacity']).toContain(prop);
    expect(CSS).not.toMatch(/transition:\s*all\b/);
    expect(CSS).not.toMatch(/@keyframes/);
  });

  test('누름 0.97배 · 0.1초 — 끄는 중에는 누름이 아니다. 올림은 마우스가 있는 곳에서만', () => {
    const press = CSS.match(
      /\.bk-shelf:not\(\.is-dragging\) \.bk-book:active \.bk-stand\s*\{([^}]*)\}/
    )[1];
    expect(press).toMatch(/scale:\s*0\.97;/);
    expect(press).toMatch(/transition-duration:\s*100ms;/);
    const hover = CSS.split('@media (hover: hover) {')[1];
    expect(hover).toMatch(
      /\.bk-book:hover \.bk-stand\s*\{[^}]*translate:\s*0 -8px;[^}]*scale:\s*1\.03;/
    );
    // 올림 규칙은 그 안에만 (터치에서 눌린 채 들려 있지 않게)
    expect(CSS.split('@media (hover: hover) {')[0]).not.toMatch(/:hover/);
  });

  test('폰은 브라우저 옆 스크롤 — 책에 맞춰 서고, 끄는 동안만 끈다. ‹ › 는 44px', () => {
    const shelf = CSS.match(/\n\.bk-shelf\s*\{([^}]*)\}/)[1];
    expect(shelf).toMatch(/overflow-x:\s*auto;/);
    expect(shelf).toMatch(/scroll-snap-type:\s*x proximity;/);
    expect(CSS).toMatch(/\.bk-cell\s*\{[^}]*scroll-snap-align:\s*start;/);
    expect(CSS).toMatch(/\.bk-shelf\.is-dragging\s*\{[^}]*scroll-snap-type:\s*none;/);
    const nav = CSS.match(/\n\.bk-nav\s*\{([^}]*)\}/)[1];
    expect(nav).toMatch(/width:\s*44px;/);
    expect(nav).toMatch(/height:\s*44px;/);
    expect(nav).toMatch(/display:\s*none;/); // 손가락 화면에서는 끈다
  });

  test('동작 줄이기 — 들림 · 누름 · 기울기를 끈다. 화면 바꾸기는 표지에만 스프링', () => {
    const reduced = CSS.split('@media (prefers-reduced-motion: reduce) {')[1];
    expect(reduced).toMatch(/\.bk-stand\s*\{[^}]*rotate:\s*none;[^}]*transition:\s*none;/);
    expect(reduced).toMatch(/translate:\s*none;/);
    expect(CSS).toMatch(
      /::view-transition-group\(bk-cover\)\s*\{[^}]*animation-duration:\s*var\(--sg-spring-ms\);/
    );
    // 이름은 스크립트가 누른 책 하나에만 붙인다 — css 에 적어 두지 않는다
    expect(CSS).not.toMatch(/view-transition-name/);
  });
});
