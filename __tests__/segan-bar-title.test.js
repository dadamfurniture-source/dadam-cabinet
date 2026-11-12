/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser */
/**
 * SEGAN 앱 셸 — 막대 제목 · 스크롤로 들어오는 칸 (segan/shell.js barTitle · reveals)
 *
 *   막대 제목     본문 큰 제목(#main h1 — 지금 보이는 것)이 위 막대 밑으로 다 들어가면 막대 가운데에 같은 글을 작게.
 *                 data-bar-title 이 있으면 그 글, 빈 값이면 띄우지 않는다. 폰 · 태블릿만 (PC 는 스타일이 감춘다)
 *   들어오는 칸   [data-reveal] 은 스크롤로 처음 들어올 때 한 번만 (segan/motion.js enter). 처음부터 보이던 칸은 그대로
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('segan/shell.js');
const CSS = read('segan/shell.css').replace(/\r\n/g, '\n');

/** 화면에 들어왔는지를 손으로 알려 주는 가짜 IntersectionObserver */
function fakeObserver() {
  const made = [];
  window.IntersectionObserver = function (fn, opts) {
    const io = {
      fn,
      opts,
      seen: [],
      observe: (el) => io.seen.push(el),
      unobserve: (el) => {
        io.seen = io.seen.filter((x) => x !== el);
      },
      fire: (entries) => fn(entries, io),
    };
    made.push(io);
    return io;
  };
  return made;
}

/** h1 · 위 막대의 자리를 손으로 정한다 (jsdom 은 자리를 셈하지 않는다) */
function place(el, { bottom, shown = true }) {
  el.getClientRects = () => (shown ? [{}] : []);
  el.getBoundingClientRect = () => ({ top: bottom - 30, bottom });
}

async function boot(body, { observer = true, motion = false } = {}) {
  delete window.SeganShell;
  delete window.SeganMotion;
  delete window.IntersectionObserver;
  document.body.setAttribute('data-tab', 'collection');
  document.body.innerHTML =
    '<div data-segan-shell="header"></div><main id="main">' +
    body +
    '</main><div data-segan-shell="tabbar"></div>';
  const made = observer ? fakeObserver() : [];
  const entered = [];
  if (motion) window.SeganMotion = { enter: (el, from, delay) => entered.push([el, from, delay]) };
  (0, eval)(SRC);
  await window.SeganShell.ready;
  const header = document.querySelector('.sg-header');
  header.getBoundingClientRect = () => ({ top: 0, bottom: 60 });
  return { made, entered, header, label: document.querySelector('.sg-bar-title') };
}

afterEach(() => {
  delete window.IntersectionObserver;
  delete window.SeganMotion;
  document.body.innerHTML = '';
});

describe('막대 제목 — 큰 제목이 위 막대 밑으로 들어가면', () => {
  test('막대에 같은 글을 작게 — 꾸밈 글이라 읽어 주지 않는다, 제목이 다시 내려오면 뗀다', async () => {
    const { made, header, label } = await boot('<h1>시공사례</h1>');
    const h1 = document.querySelector('h1');
    expect(label.parentNode).toBe(header);
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(made[0].seen).toEqual([h1]);

    place(h1, { bottom: 140 });
    made[0].fire([]);
    expect(label.textContent).toBe('시공사례');
    expect(header.classList.contains('sg-header--titled')).toBe(false);

    place(h1, { bottom: 58 }); // 막대(60) 밑으로 다 들어갔다
    made[0].fire([]);
    expect(header.classList.contains('sg-header--titled')).toBe(true);

    place(h1, { bottom: 61 });
    made[0].fire([]);
    expect(header.classList.contains('sg-header--titled')).toBe(false);
  });

  test('data-bar-title — 그 글을 쓰고, 빈 값이면 띄우지 않는다 · 여러 줄 제목은 한 줄로', async () => {
    let r = await boot('<h1 data-bar-title="결과">Results\n  <br>  page</h1>');
    place(document.querySelector('h1'), { bottom: 10 });
    r.made[0].fire([]);
    expect(r.label.textContent).toBe('결과');
    expect(r.header.classList.contains('sg-header--titled')).toBe(true);

    r = await boot('<h1 data-bar-title="">공간을 읽고 <br>가구를 짓습니다</h1>');
    place(document.querySelector('h1'), { bottom: 10 });
    r.made[0].fire([]);
    expect(r.label.textContent).toBe('');
    expect(r.header.classList.contains('sg-header--titled')).toBe(false);

    r = await boot('<h1>공간을 읽고 <br>\n  가구를 짓습니다</h1>');
    place(document.querySelector('h1'), { bottom: 10 });
    r.made[0].fire([]);
    expect(r.label.textContent).toBe('공간을 읽고 가구를 짓습니다');
  });

  test('제목이 여럿이면 지금 보이는 것 (만들기 단계 · 마이페이지 하위 화면)', async () => {
    const { made, label, header } = await boot('<h1 id="a">사진</h1><h1 id="b">품목</h1>');
    const [a, b] = ['a', 'b'].map((id) => document.getElementById(id));
    place(a, { bottom: 10, shown: false });
    place(b, { bottom: 200 });
    made[0].fire([]);
    expect(label.textContent).toBe('품목');
    expect(header.classList.contains('sg-header--titled')).toBe(false);
    expect(made[0].seen).toEqual([a, b]);
    // 보이는 제목이 없으면 띄우지 않는다
    place(b, { bottom: 10, shown: false });
    made[0].fire([]);
    expect(label.textContent).toBe('');
    expect(header.classList.contains('sg-header--titled')).toBe(false);
  });

  test('IntersectionObserver 가 없는 브라우저 — 아무것도 붙이지 않는다 (화면은 그대로)', async () => {
    const { label, header } = await boot('<h1>시공사례</h1>', { observer: false });
    expect(label).toBeNull();
    expect(header).not.toBeNull();
  });

  test('스타일 — PC 에서는 없고 폰 · 태블릿에서만, 동작 줄이기는 오르지 않고 흐려지기만', () => {
    expect(CSS).toMatch(/\n\.sg-bar-title \{\s*display: none;\s*\}/);
    const phone = CSS.split('\n.sg-bar-title {\n  display: none;\n}\n')[1].split('\n}\n')[0];
    expect(phone).toMatch(/^\s*@media \(max-width: 1023\.98px\) \{/);
    expect(phone).toMatch(/\.sg-bar-title \{[^}]*display: block;[^}]*pointer-events: none;/);
    expect(phone).toMatch(/transform var\(--sg-spring-ms\) var\(--sg-spring\)/);
    const calm = CSS.split('/* 동작 줄이기 — 오르지 않고 흐려지기만 */')[1].split('\n}\n')[0];
    expect(calm).toMatch(/@media \(prefers-reduced-motion: reduce\) \{/);
    expect(calm).toMatch(/transition: opacity 200ms ease;/);
    // 위 메뉴가 열리는 폭 칸은 그대로 하나
    expect(CSS.split('@media (min-width: 1024px)')).toHaveLength(2);
  });
});

describe('스크롤로 들어오는 칸 — [data-reveal]', () => {
  test('처음부터 보이던 칸은 그대로, 나중에 들어오는 칸만 한 번 — 한꺼번에 들어오면 차례로', async () => {
    const { made, entered } = await boot(
      '<h1>홈</h1><p data-reveal id="a"></p><p data-reveal id="b"></p><p data-reveal id="c"></p>',
      { motion: true }
    );
    const io = made[1];
    const [a, b, c] = ['a', 'b', 'c'].map((id) => document.getElementById(id));
    expect(io.seen).toEqual([a, b, c]);
    io.fire([
      { target: a, isIntersecting: true },
      { target: b, isIntersecting: false },
      { target: c, isIntersecting: false },
    ]);
    expect(entered).toEqual([]);
    expect(io.seen).toEqual([b, c]);

    io.fire([
      { target: b, isIntersecting: true },
      { target: c, isIntersecting: true },
    ]);
    const from = { opacity: 0, transform: 'translateY(14px)' };
    expect(entered).toEqual([
      [b, from, 0],
      [c, from, 60],
    ]);
    expect(io.seen).toEqual([]);
  });

  test('motion.js 가 없거나 칸이 없으면 지켜보지 않는다', async () => {
    let r = await boot('<h1>홈</h1><p data-reveal></p>');
    expect(r.made).toHaveLength(1); // 막대 제목 것만
    r = await boot('<h1>홈</h1>', { motion: true });
    expect(r.made).toHaveLength(1);
  });

  test('홈 — 큰 제목은 막대에 띄우지 않고(워드마크가 있다), 세 걸음 · 시공사례 · 매거진 칸이 들어온다', () => {
    const doc = new DOMParser().parseFromString(read('segan/index.html'), 'text/html');
    expect(doc.querySelector('h1').getAttribute('data-bar-title')).toBe('');
    expect(doc.querySelectorAll('.hm-steps li[data-reveal]')).toHaveLength(3);
    expect(doc.querySelectorAll('a.hm-work[data-reveal]')).toHaveLength(6);
    expect(doc.querySelectorAll('.hm-posts li[data-reveal]')).toHaveLength(4);
    expect(doc.querySelectorAll('.hm-hero [data-reveal]')).toHaveLength(0); // 첫 화면은 움직이지 않는다
  });
});
