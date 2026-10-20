/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-20 플래너 점검 — 장 버튼 쉽게 쓰기 (보고서 M7 · "왼쪽 아이콘에 글자").
 *
 *   1. 줄의 첫 사각형이 품목의 본 섹션이면 폭 = 품목 폭 (빠른 배치와 같은 규칙, planner-presets.js).
 *      예전엔 품목 폭 3000 이어도 하부장 2400 이 놓여 BOM 설계정보(3000)와 달랐다.
 *   2. 장·기기 버튼 아이콘 밑에 글자 — 아이콘만으론 하부장·상부장·키큰장을 가릴 수 없었다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

function widths(p) {
  return [...p.document.querySelectorAll('g.content > g.sect-rect')].map((g) => ({
    section: [...g.classList].find((c) => c !== 'sect-rect' && c !== 'selected'),
    w: +g.querySelector(':scope > rect').getAttribute('width'),
  }));
}
const click = (p, sec) => p.document.querySelector(`.rect-btn[data-section="${sec}"]`).click();

describe('장 버튼 — 줄의 첫 사각형 폭 = 품목 폭', () => {
  test('싱크대 품목 폭 3000 → 하부장 3000, 상부장 3000', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink&w=3000' });
    click(p, 'lower');
    click(p, 'upper');
    expect(widths(p)).toEqual([{ section: 'lower', w: 3000 }, { section: 'upper', w: 3000 }]);
  });

  test('줄에 이미 있으면 다음 사각형은 섹션 기본 폭 — 키큰장은 본 섹션이 아니라 기본 폭', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink&w=3000' });
    const cfg = p.g('SECTION_CONFIG');
    click(p, 'lower');
    click(p, 'lower');
    click(p, 'tall');
    expect(widths(p).map((r) => r.w)).toEqual([3000, cfg.lower.w, cfg.tall.w]);
  });

  test('품목 폭이 없으면 섹션 기본 폭', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink' });
    click(p, 'lower');
    expect(widths(p)[0].w).toBe(p.g('SECTION_CONFIG').lower.w);
  });

  test('붙박이장 품목 폭 2400 → 붙박이장 2400', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=wardrobe&w=2400' });
    click(p, 'wardrobe');
    expect(widths(p)[0]).toEqual({ section: 'wardrobe', w: 2400 });
  });
});

describe('장·기기 버튼 글자', () => {
  test('모든 배치 버튼 아이콘 밑에 이름이 있다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink' });
    const names = Object.fromEntries([...p.document.querySelectorAll('.rect-btn')].map((b) => [
      b.dataset.section, (b.querySelector('.lbl') || {}).textContent,
    ]));
    expect(names).toMatchObject({
      lower: '하부장', upper: '상부장', tall: '키큰장', fridge: '냉장고장', wardrobe: '붙박이장',
      sink: '분배기', hood: '후드', refrigerator: '냉장고', dishwasher: '식세기',
    });
  });
});
