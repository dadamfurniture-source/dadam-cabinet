/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, Element */
/**
 * SEGAN 앱 셸 — 시트 유리 · 닫히는 모습 (segan/shell.js leave · segan/shell.css)
 *
 *   닫히는 모습   닫으면 바로 닫힌 것(초점 · onClose · 잠금 풀기)이고 그림만 0.22초 나간다 — 폰 시트는 아래로,
 *                 가운데 창은 흐려지기만. 나가는 동안 누를 수 없다. 새 창을 열면 나가던 그림은 바로 치운다
 *   유리          시트 · 옆 패널은 유리, 가운데 창은 불투명. 창이 열려 있는 동안 위 막대 · 아래 탭은 불투명
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('segan/shell.js');
const CSS = read('segan/shell.css').replace(/\r\n/g, '\n');
const wraps = () => [...document.querySelectorAll('.sg-sheet-wrap')];

/** 움직임을 손으로 끝내는 가짜 Element.animate */
function fakeAnimate() {
  const runs = [];
  Element.prototype.animate = function (frames, opts) {
    let end;
    const finished = new Promise((resolve) => {
      end = resolve;
    });
    const run = { el: this, frames, opts, finished, end };
    runs.push(run);
    return run;
  };
  return runs;
}

async function boot({ animate = true, reduce = false } = {}) {
  delete window.SeganShell;
  delete Element.prototype.animate;
  document.body.className = '';
  document.body.setAttribute('data-tab', 'collection');
  document.body.innerHTML =
    '<div data-segan-shell="header"></div><main id="main"><h1>시공사례</h1>' +
    '<button id="opener">열기</button></main><div data-segan-shell="tabbar"></div>';
  window.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion/.test(q), media: q });
  const runs = animate ? fakeAnimate() : [];
  (0, eval)(SRC);
  await window.SeganShell.ready;
  return { sheet: window.SeganShell.sheet, runs };
}

afterEach(() => {
  delete Element.prototype.animate;
  delete window.matchMedia;
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('닫히는 모습 — 바로 닫히고 그림만 나간다', () => {
  test('폰 시트 — 닫는 순간 닫힌 것, 그림은 아래로 나간 뒤 치운다 (나가는 동안 누를 수 없다)', async () => {
    const { sheet, runs } = await boot();
    const closed = [];
    document.getElementById('opener').focus();
    const h = sheet.open({ title: '사진 보기', body: '글', onClose: (why) => closed.push(why) });
    expect(document.body.classList.contains('sg-locked')).toBe(true);
    await h.close();

    expect(closed).toEqual(['close']);
    expect(h.isOpen()).toBe(false);
    expect(document.body.classList.contains('sg-locked')).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('opener'));
    // 그림은 아직 남아 나가는 중
    const [wrap] = wraps();
    expect(wrap.classList.contains('sg-sheet-wrap--out')).toBe(true);
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(wrap.inert).toBe(true);
    const fade = runs.find((r) => r.el === wrap);
    expect(fade.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(fade.opts).toMatchObject({ duration: 220, fill: 'forwards' });
    const slide = runs.find((r) => r.el === h.el);
    expect(slide.frames).toEqual([{ transform: 'translateY(100%)' }]); // 지금 자리에서 이어 나간다
    expect(slide.opts).toMatchObject({ duration: 220, fill: 'forwards' });

    fade.end();
    await fade.finished;
    await Promise.resolve();
    expect(wraps()).toEqual([]);
  });

  test('가운데 창은 흐려지기만 · 동작 줄이기도 흐려지기만 (0.2초)', async () => {
    let r = await boot();
    let h = r.sheet.open({ title: '지울까요', body: '글', kind: 'dialog' });
    await h.close();
    expect(r.runs.map((x) => x.el.className)).toEqual([
      'sg-sheet-wrap sg-sheet-wrap--dialog sg-sheet-wrap--out',
    ]);

    r = await boot({ reduce: true });
    h = r.sheet.open({ title: '사진 보기', body: '글' });
    await h.close();
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(r.runs[0].opts.duration).toBe(200);
  });

  test('새 창을 열면 나가던 그림은 바로 치운다 — 같은 것이 둘이 되지 않는다', async () => {
    const { sheet } = await boot();
    const a = sheet.open({ title: '하나', body: '글' });
    await a.close();
    expect(wraps()).toHaveLength(1);
    const b = sheet.open({ title: '둘', body: '글' });
    expect(wraps()).toEqual([b.el.parentNode]);
    expect(wraps()[0].classList.contains('sg-sheet-wrap--out')).toBe(false);
  });

  test('새 시트가 바꿔 끼우는 앞 시트는 나가는 그림 없이 바로 치운다', async () => {
    const { sheet, runs } = await boot();
    const closed = [];
    sheet.open({ title: '하나', body: '글', onClose: (why) => closed.push(why) });
    const b = sheet.open({ title: '둘', body: '글' });
    expect(closed).toEqual(['replaced']);
    expect(wraps()).toEqual([b.el.parentNode]);
    expect(runs).toEqual([]);
  });

  test('움직일 수 없는 브라우저 — 닫으면 바로 치운다', async () => {
    const { sheet } = await boot({ animate: false });
    const h = sheet.open({ title: '사진 보기', body: '글' });
    await h.close();
    expect(wraps()).toEqual([]);
  });
});

describe('유리 — 시트 · 옆 패널, 가운데 창과 겹치는 막대는 불투명', () => {
  const rule = (sel) => CSS.split(`\n${sel} {`)[1].split('\n}')[0];

  test('시트는 유리 토큰, 가운데 창은 불투명 종이색', () => {
    expect(rule('.sg-sheet')).toMatch(/background: var\(--v5-glass\);/);
    expect(rule('.sg-sheet')).toMatch(/\n\s*backdrop-filter: var\(--v5-blur\);/);
    const dialog = rule('.sg-sheet-wrap--dialog .sg-sheet');
    expect(dialog).toMatch(/background: var\(--v5-paper\);/);
    expect(dialog).toMatch(/\n\s*backdrop-filter: none;/);
  });

  test('창이 열려 있는 동안(body.sg-locked) 위 막대 · 아래 탭은 불투명 — 유리를 겹치지 않는다', () => {
    const locked = rule('body.sg-locked .sg-header,\nbody.sg-locked .sg-tabbar');
    expect(locked).toMatch(/background: var\(--v5-glass-solid\);/);
    expect(locked).toMatch(/\n\s*backdrop-filter: none;/);
  });

  test('유리를 못 쓰는 곳 — 시트도 불투명 종이색', () => {
    const after = (mark) => CSS.split(mark)[1].split('\n}\n')[0];
    const paper = /\.sg-sheet \{[^}]*background: var\(--v5-paper\);/;
    expect(after('@supports not ((backdrop-filter: blur(1px))')).toMatch(paper);
    expect(
      after('@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)')
    ).toMatch(paper);
  });

  test('나가는 그림은 누를 수 없다 · 규칙을 CLAUDE.md 에 적어 둔다', () => {
    expect(CSS).toMatch(/\.sg-sheet-wrap--out \{\s*pointer-events: none;\s*\}/);
    const md = read('CLAUDE.md');
    expect(md).toMatch(/닫으면 바로 닫힌 것이고 그림만 0\.22초 나간다/);
    expect(md).toMatch(/시트가 열려 있는 동안 막대는 불투명, 가운데 창은 늘 불투명/);
  });
});
