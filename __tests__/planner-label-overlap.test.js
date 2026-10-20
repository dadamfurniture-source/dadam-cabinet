/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, setTimeout */
/**
 * 2026-10-20 플래너 점검 L2 — 평면도 글자 겹침.
 * 상부장이 하부장 뒤쪽을 덮으면 하부장 이름·치수가 상부장 글자 밑에 깔려 읽을 수 없었다.
 * 바닥 장 글자는 덮이지 않은 앞쪽 띠 가운데로 내려간다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (p, sec) => p.document.querySelector(`.rect-btn[data-section="${sec}"]`).click();
function geo(p, sec) {
  const g = p.document.querySelector(`g.content > g.sect-rect.${sec}`);
  const r = g.querySelector(':scope > rect');
  const t = g.querySelector(':scope > text');
  const n = (el, a) => parseFloat(el.getAttribute(a));
  return { y: n(r, 'y'), h: n(r, 'height'), ty: n(t, 'y'), g };
}

describe('상부장이 덮은 하부장 글자', () => {
  test('하부장 글자는 상부장 아래 앞쪽 띠 가운데', async () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink&w=3000' });
    click(p, 'lower');
    click(p, 'upper');
    await tick();
    const lo = geo(p, 'lower');
    const up = geo(p, 'upper');
    const free = up.y + up.h;
    expect(up.y).toBe(lo.y);
    expect(lo.ty).toBeCloseTo((free + lo.y + lo.h) / 2, 3);
    // 상부장 글자는 제자리
    expect(up.ty).toBeCloseTo(up.y + up.h / 2, 3);
  });

  test('상부장을 지우면 하부장 글자는 가운데로 돌아온다', async () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink&w=3000' });
    click(p, 'lower');
    click(p, 'upper');
    await tick();
    geo(p, 'upper').g.remove();
    await tick();
    const lo = geo(p, 'lower');
    expect(lo.ty).toBeCloseTo(lo.y + lo.h / 2, 3);
  });

  test('상부장이 없으면 그대로 가운데', async () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink' });
    click(p, 'lower');
    click(p, 'tall');
    await tick();
    for (const sec of ['lower', 'tall']) {
      const f = geo(p, sec);
      expect(f.ty).toBeCloseTo(f.y + f.h / 2, 3);
    }
  });
});
