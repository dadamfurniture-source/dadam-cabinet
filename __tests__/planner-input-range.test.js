/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 입력 범위 표시 (ArchiWood 영상 분석 F, 2026-10-19).
 *   · 칸 타입 줄에 칸 폭 — 도어 한 장 폭이 MASTER_RULES 350~600 밖이면 빨간 ⚠
 *   · 양문 칸은 폭을 둘로 나눠 본다 · 싱크 라인 상·하부장만
 *   · 서랍 단수 옆에 1~4단 (bom-drawer-rules MAX_COUNT)
 */
const { bootPlanner } = require('../test-utils/planner-harness');

function pickLower(p) {
  const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id);
  p.g('setActiveModule')(m.id);
  return { m, s: p.g('getStructure')(m.id) };
}
const tags = (p) => [...p.document.querySelectorAll('#areasBody .door-range')];

describe('칸 도어 폭 범위', () => {
  test('범위 안은 흐리게, 밖은 빨간 ⚠ · 양문은 둘로 나눈다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ir1&item=1', storage: {} });
    const { m, s } = pickLower(p);
    m.W = 1700;
    Object.assign(s, {
      verticalCount: 3,
      areaTypes: ['door', 'door', 'door'],
      areaDirections: ['left', 'left', 'left'],
      areaWidths: [300, 800, 600],
      areaIs2D: [false, true, false],
    });
    p.g('renderRightPanel')();
    const t = tags(p);
    expect(t.map((x) => x.textContent.trim())).toEqual(['300 ⚠', '800', '600']);
    expect(t.map((x) => x.classList.contains('bad'))).toEqual([true, false, false]);
    expect(t[0].title).toContain('350~600 밖');
    expect(t[1].title).toContain('도어 한 장 400mm');
    expect(p.errors).toEqual([]);
  });

  test('도어가 아닌 칸은 표시하지 않는다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ir2&item=1', storage: {} });
    const { s } = pickLower(p);
    Object.assign(s, {
      verticalCount: 2,
      areaTypes: ['open', 'door'],
      areaDirections: ['left', 'left'],
      areaWidths: [200, 500],
      areaIs2D: [false, false],
    });
    p.g('renderRightPanel')();
    expect(tags(p)).toHaveLength(1);
  });

  test('서랍 단수 옆에 1~4단', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ir3&item=1', storage: {} });
    const { s } = pickLower(p);
    Object.assign(s, {
      horizontalLayout: 'doorTopDrawerBottom',
      bottomType: 'drawer',
      drawerCount: 2,
    });
    p.g('renderRightPanel')();
    expect(p.document.getElementById('inpDrawerCount').parentElement.textContent).toContain(
      '1~4단'
    );
  });
});
