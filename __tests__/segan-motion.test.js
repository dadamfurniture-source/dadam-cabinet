/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, afterEach, __dirname, document, window, jest */
/**
 * SEGAN 움직임 한 벌 (segan/motion.js — CLAUDE.md 「SEGAN 모션 규칙」)
 *
 *   스프링   응답 · 감쇠(애플 두 값) — 지금 값에서 이어 가고, 새 목표를 주면 속도를 들고 간다. 동작 줄이기면 바로 끝
 *   곡선     같은 스프링의 CSS linear() — 0 에서 1 로, 감쇠 1.0 은 넘치지 않고 0.8 은 넘친다. :root 변수로도 둔다
 *   끌기     고무줄 (넘은 거리 · 크기 · 0.55) · 놓은 속도로 더 갈 거리 (d 0.998)
 *   들어오기 · 막대 · 선  멈춘 모습이 최종 모습 (fill backwards), 동작 줄이기면 흐려지기만
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'segan/motion.js'), 'utf8');

/** 화면 주기를 손으로 돌린다 — 16ms 씩 */
function fakeFrames() {
  let t = 0;
  let queue = [];
  window.requestAnimationFrame = (fn) => {
    queue.push(fn);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  jest.spyOn(window.performance, 'now').mockImplementation(() => t);
  return {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        t += 16;
        const q = queue;
        queue = [];
        q.forEach((fn) => fn(t));
      }
    },
  };
}

function boot({ reduce = false, frames = true, linear = true } = {}) {
  delete window.SeganMotion;
  document.documentElement.removeAttribute('style');
  window.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion/.test(q), media: q });
  window.CSS = { supports: (p, v) => linear && /linear\(/.test(v) };
  const f = frames ? fakeFrames() : null;
  if (!frames) {
    delete window.requestAnimationFrame;
    delete window.cancelAnimationFrame;
  }
  (0, eval)(SRC);
  return { M: window.SeganMotion, f };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
  delete window.CSS;
});

describe('곡선 — 같은 스프링의 linear()', () => {
  test('감쇠 1.0 은 0 → 1 로 넘치지 않고 오르기만, 0.35초 응답은 약 0.5초에 멈춘다', () => {
    const { M } = boot();
    const c = M.curve(0.35, 1);
    const pts = c.easing
      .replace(/^linear\(|\)$/g, '')
      .split(', ')
      .map(Number);
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(1);
    expect(pts.every((v, i) => i === 0 || v >= pts[i - 1])).toBe(true);
    expect(Math.max(...pts)).toBeLessThanOrEqual(1);
    expect(c.ms).toBeGreaterThan(450);
    expect(c.ms).toBeLessThan(600);
  });

  test('감쇠 0.8 은 1 을 넘었다가 돌아온다 (던진 것에만 쓴다)', () => {
    const { M } = boot();
    const pts = M.curve(0.3, 0.8)
      .easing.replace(/^linear\(|\)$/g, '')
      .split(', ')
      .map(Number);
    expect(Math.max(...pts)).toBeGreaterThan(1);
    expect(pts[pts.length - 1]).toBe(1);
  });

  test(':root 에 --sg-spring · --sg-spring-ms — linear() 를 모르면 shell.css 의 대신 곡선', () => {
    const { M } = boot();
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--sg-spring')).toBe(M.UI.easing);
    expect(root.getPropertyValue('--sg-spring')).toMatch(/^linear\(0, /);
    expect(root.getPropertyValue('--sg-spring-ms')).toBe(M.UI.ms + 'ms');
    const old = boot({ linear: false }).M;
    expect(old.UI.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    const css = fs.readFileSync(path.join(ROOT, 'segan/shell.css'), 'utf8');
    expect(css).toMatch(/--sg-spring: cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  });
});

describe('끌기 — 고무줄 · 놓은 속도', () => {
  test('고무줄: 넘은 거리보다 덜 따라오고, 멀리 갈수록 더 버틴다 (0.55)', () => {
    const { M } = boot();
    expect(M.rubber(0, 500)).toBe(0);
    expect(M.rubber(100, 100)).toBeCloseTo((100 * 100 * 0.55) / (100 + 55), 6);
    const a = M.rubber(50, 500);
    const b = M.rubber(100, 500);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(a); // 두 번째 50 은 첫 50 보다 덜 간다
    expect(M.rubber(10, 0)).toBe(0);
  });

  test('놓은 속도로 더 갈 거리 = (v/1000)·d/(1−d), d 0.998', () => {
    const { M } = boot();
    expect(M.project(1000)).toBeCloseTo(499, 6);
    expect(M.project(-500)).toBeCloseTo(-249.5, 6);
    expect(M.project(1000, 0.99)).toBeCloseTo(99, 6);
  });
});

describe('스프링 — 끊을 수 있다', () => {
  test('목표로 가서 멈추고 약속이 풀린다 · 감쇠 1.0 은 넘치지 않는다', async () => {
    const { M, f } = boot();
    const seen = [];
    const s = M.spring((x) => seen.push(x), { value: 0, response: 0.35, damping: 1, eps: 0.01 });
    let done = false;
    s.to(100).then(() => {
      done = true;
    });
    f.step(80);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(s.x).toBe(100);
    expect(Math.max(...seen)).toBeLessThanOrEqual(100);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1] - 1e-9)).toBe(true);
  });

  test('움직이는 중에 새 목표 — 지금 자리 · 속도에서 이어 간다 (뛰지 않는다)', () => {
    const { M, f } = boot();
    const seen = [];
    const s = M.spring((x) => seen.push(x), { value: 0, response: 0.35, eps: 0.01 });
    s.to(100);
    f.step(6);
    const at = s.x;
    const v = s.v;
    expect(at).toBeGreaterThan(0);
    expect(v).toBeGreaterThan(0);
    s.to(0);
    f.step(1);
    // 다음 칸은 지금 자리 근처 — 0 으로 뛰지 않는다, 속도를 들고 가서 바로 돌아서지 않는다
    expect(Math.abs(seen[seen.length - 1] - at)).toBeLessThan(30);
    expect(seen[seen.length - 1]).toBeGreaterThan(at - 1);
    f.step(120);
    expect(s.x).toBe(0);
  });

  test('놓은 속도를 받는다 · halt 는 그 자리에 멈춘다 · set 은 바로', () => {
    const { M, f } = boot();
    const s = M.spring(() => {}, { value: 0, eps: 0.5 });
    s.to(0, { velocity: 2000 });
    f.step(2);
    expect(s.x).toBeGreaterThan(10); // 손이 준 속도로 지나쳤다가 돌아온다
    s.halt();
    const at = s.x;
    f.step(10);
    expect(s.x).toBe(at);
    s.set(42);
    expect(s.x).toBe(42);
    expect(s.v).toBe(0);
  });

  test('동작 줄이기 · 화면 주기 없음 — 바로 목표', async () => {
    for (const opt of [{ reduce: true }, { frames: false }]) {
      const { M } = boot(opt);
      const seen = [];
      const s = M.spring((x) => seen.push(x), { value: 0 });
      await s.to(50);
      expect(seen).toEqual([50]);
    }
  });
});

describe('숫자 굴리기 · 들어오기 · 막대 · 선', () => {
  const fakeAnim = () => {
    const calls = [];
    const el = document.createElement('div');
    el.animate = (frames, opts) => {
      calls.push({ frames, opts });
      return { cancel() {} };
    };
    return { el, calls };
  };

  test('숫자: 지난 값에서 새 값으로 굴러가고, 끝은 정확히 새 값', async () => {
    const { M, f } = boot();
    const el = document.createElement('b');
    const fmt = (v) => Math.round(v) + '건';
    M.roll(el, 5, 7, fmt, 0);
    expect(el.textContent).toBe('5건'); // 처음은 지난 값
    await new Promise((r) => setTimeout(r, 5)); // 미룬 시작
    f.step(3);
    expect(['5건', '6건', '7건']).toContain(el.textContent);
    f.step(120);
    expect(el.textContent).toBe('7건');
  });

  test('숫자: 동작 줄이기면 바로 최종값', () => {
    const { M } = boot({ reduce: true });
    const el = document.createElement('b');
    M.roll(el, -76, 287, (v) => Math.round(v) + '만', 0);
    expect(el.textContent).toBe('287만');
  });

  test('들어오기: from → 지금 모습 (fill backwards — 멈춘 모습이 최종), 동작 줄이기면 흐려지기만', () => {
    let { M } = boot();
    let a = fakeAnim();
    M.enter(a.el, { transform: 'translateX(28px)', opacity: 0.3 }, 40);
    expect(a.calls[0].frames).toEqual([
      { transform: 'translateX(28px)', opacity: 0.3 },
      { transform: 'none', opacity: 1 },
    ]);
    expect(a.calls[0].opts).toMatchObject({
      easing: M.UI.easing,
      duration: M.UI.ms,
      delay: 40,
      fill: 'backwards',
    });
    ({ M } = boot({ reduce: true }));
    a = fakeAnim();
    M.enter(a.el, { transform: 'translateX(28px)', opacity: 0.3 });
    expect(a.calls[0].frames).toEqual([{ opacity: 0.4 }, { opacity: 1 }]);
    expect(a.calls[0].opts.duration).toBe(200);
    expect(M.enter(document.createElement('div'), { opacity: 0 })).toBeNull(); // animate 없는 곳은 그대로
  });

  test('막대: 멈춘 모습은 그 비율 그대로, 0 에서 자란다 · 동작 줄이기면 움직이지 않는다', () => {
    let { M } = boot();
    let a = fakeAnim();
    M.grow(a.el, 0.46, 'x', 60);
    expect(a.el.style.transform).toBe('scaleX(0.46)');
    expect(a.calls[0].frames).toEqual([{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.46)' }]);
    expect(a.calls[0].opts.fill).toBe('backwards');
    ({ M } = boot({ reduce: true }));
    a = fakeAnim();
    M.grow(a.el, 0.8, 'y');
    expect(a.el.style.transform).toBe('scaleY(0.8)');
    expect(a.calls).toHaveLength(0);
  });

  test('선: 길이만큼 감췄다가 그린다 (0.9초)', () => {
    const { M } = boot();
    const a = fakeAnim();
    a.el.getTotalLength = () => 300;
    M.draw(a.el, 100);
    expect(a.calls[0].frames[0]).toEqual({ strokeDasharray: '300 300', strokeDashoffset: 300 });
    expect(a.calls[0].frames[1]).toEqual({ strokeDasharray: '300 300', strokeDashoffset: 0 });
    expect(a.calls[0].opts).toMatchObject({ duration: 900, delay: 100, fill: 'backwards' });
  });
});

describe('규칙 · 싣기', () => {
  beforeEach(() => {
    delete window.SeganMotion;
  });

  test('CLAUDE.md 에 SEGAN 모션 규칙 — 기본 스프링 · 동작 줄이기 · v5 재질', () => {
    const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
    expect(md).toMatch(/## SEGAN 앱 모션 규칙/);
    expect(md).toMatch(/감쇠 1\.0 · 응답 0\.35초/);
    expect(md).toMatch(/동작 줄이기: 밀기 · 스프링 대신 0\.2초 흐려지기/);
    expect(md).toMatch(/재질은 v5 그대로/);
  });

  test('마이페이지는 셸보다 먼저 싣는다 · 서비스 워커가 담는다', () => {
    const me = fs.readFileSync(path.join(ROOT, 'segan/me.html'), 'utf8');
    const at = (s) => me.indexOf(s);
    expect(at('src="motion.js?v=')).toBeGreaterThan(0);
    expect(at('src="motion.js?v=')).toBeLessThan(at('src="shell.js?v='));
    const sw = fs.readFileSync(path.join(ROOT, 'segan/sw.js'), 'utf8');
    expect(sw).toMatch(/versioned\(SCOPE \+ 'motion\.js'\)/);
  });

  test('누름 — 누르는 순간 0.97배 · 0.1초, 목록 줄은 바탕만, 동작 줄이기면 줄지 않는다', () => {
    const css = fs.readFileSync(path.join(ROOT, 'segan/shell.css'), 'utf8');
    expect(css).toMatch(
      /\.sg-btn:active,\s*\.mk-btn:active:not\(:disabled\) \{\s*transform: scale\(0\.97\);\s*transition-duration: 100ms;/
    );
    expect(css).toMatch(
      /a\.sg-row:active,\s*button\.sg-row:active \{\s*background: var\(--v5-well\);/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.sg-btn:active,\s*\.mk-btn:active:not\(:disabled\) \{\s*transform: none;/
    );
  });
});
