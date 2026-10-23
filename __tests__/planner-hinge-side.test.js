/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-23 사장님 4-1 C: 외짝 도어 경첩 방향 = 설계 화면의 좌개/우개.
 *   플래너 칸 열림 방향(좌 ◀ / 우 ▶)이 그 항목이다 — 정면도 화살표가 경첩 변에 그려진다 (양문은 왼 도어 ◀ · 오른 도어 ▶ = 바깥 변 경첩).
 *   브리지가 단문 칸에 hingeSide 를 싣고, 조립 명세가 경첩 컵을 그 변에 놓는다.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const Asm = require('../js/detaildesign/bom-assembly.js');

const X = Object.assign({}, require('../js/detaildesign/extractors.js'), loadExtractors());

const convert = (section, dirs, is2D = [false], types = ['door']) => {
  const payload = {
    modules: [{ id: 'm1', section, W: 600, H: section === 'upper' ? 780 : 870, D: section === 'upper' ? 320 : 580, x: 0, y: 0 }],
    structures: { m1: { verticalCount: 1, areaTypes: types, areaWidths: [600], areaIs2D: is2D, areaDirections: dirs } },
  };
  return loadConverter()._convertPlannerModules(payload, Object.assign({}, LEDGER_SPECS)).modules;
};

describe('브리지 — 단문 칸 좌/우 → BOM 모듈 hingeSide', () => {
  test.each([['lower', 'left'], ['lower', 'right'], ['upper', 'left'], ['upper', 'right']])('%s 단문 %s', (section, dir) => {
    expect(convert(section, [dir])[0].hingeSide).toBe(dir);
  });
  test('양문 · 플랩 · 오픈 · 방향 없음에는 필드가 없다', () => {
    expect(convert('lower', ['left'], [true])[0]).not.toHaveProperty('hingeSide');
    const flap = convert('upper', ['up'])[0];
    expect(flap.doorOpen).toBe('up');
    expect(flap).not.toHaveProperty('hingeSide');
    expect(convert('lower', ['left'], [false], ['open'])[0]).not.toHaveProperty('hingeSide');
    expect(convert('lower', [])[0]).not.toHaveProperty('hingeSide');
  });
});

describe('조립 명세 — 경첩 컵이 고른 변에', () => {
  test.each(['left', 'right'])('하부장 단문 %s', (dir) => {
    const mod = convert('lower', [dir])[0];
    const design = { items: [{ categoryId: 'sink', w: 2400, h: 2310, d: 650, specs: Object.assign({}, LEDGER_SPECS), modules: [mod] }] };
    const spec = Asm.of(design, {
      materials: new X.MaterialExtractor().extract(design).materials,
      hardware: new X.HardwareExtractor().extract(design).hardware,
    });
    const m = spec.items[0].modules.find((x) => x.moduleKey === `0-${mod.id}`);
    const hinges = m.hardware.filter((h) => h.kind === 'hinge');
    expect(hinges.length).toBeGreaterThanOrEqual(2);
    expect(hinges.every((h) => h.edge === dir && h.at && !h.pending)).toBe(true);
    const door = m.parts.find((p) => p.id === hinges[0].partId).box;
    expect(hinges[0].at[0]).toBe(dir === 'left' ? door.min[0] + 21.5 : door.max[0] - 21.5);
  });
});
