/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 붙박이장 상몰딩 마감 종류 — 상몰딩 · 인몰딩 · 무몰딩 (specs.wardrobeMoldingType, bom-wardrobe-rules.js).
 *
 *   2026-10-30 사장님 (간편 플래너): "상몰딩 마감칸을 만들어서, 상몰딩, 인몰딩, 무몰딩으로 두고 …"
 *   2026-10-31 사장님: "인몰딩은 상몰딩 위치가 몸통앞선 + 도어가 몰딩을 덮는 형식, 상몰딩은 도어 앞선에 설치되는 형태"
 *                      → 인몰딩 도어 위 끝 「천장 아래 20 남김」 (IN_MOLDING_TOP_GAP).
 *   종류가 없으면 예전 그대로 (높이 · 마감재 스위치). 합성 데이터만.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const R = WR.WARDROBE_RULES;
const BASE = Object.assign({}, LEDGER_SPECS, { finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const STRUCT = { legH: 0, moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [900], areaIs2D: [true] };

/** 천장 2300 통 하나 — 상몰딩 높이 · 종류를 품목 스펙에 */
function run(molding, wardrobe) {
  const H = 2300;
  const specs = Object.assign({}, BASE, molding);
  const modules = [{ id: 'w', section: 'wardrobe', W: 900, H, D: 590, x: 0, y: 0, areaH: H }];
  const structures = { w: Object.assign({}, STRUCT, { wardrobe: wardrobe || { preset: 'short2' } }) };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, specs));
  const item = { categoryId: 'wardrobe', w: 900, h: H, d: 620, specs: Object.assign({}, specs), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const spec = Asm.of({ items: [item] }, { materials, hardware });
  const mk = `0-${conv.modules[0].id}`;
  const rows = (re) => materials.filter((m) => re.test(m.part)).map((m) => [m.part, m.w, m.h, m.qty]);
  return { materials, hardware, spec, mk, rows };
}
const top = { wardrobeMoldingH: 60, wardrobeMoldingType: 'top' };
const inn = { wardrobeMoldingH: 60, wardrobeMoldingType: 'in' };
const none = { wardrobeMoldingH: 20, wardrobeMoldingType: 'none' };

describe('규칙 파일', () => {
  test('종류 — top · in · none, 모르는 값은 null (예전 그대로)', () => {
    expect(R.MOLDING_TYPES).toEqual(['top', 'in', 'none']);
    expect(R.IN_MOLDING_TOP_GAP).toBe(20);
    expect(['top', 'in', 'none', 'x', undefined].map((t) => WR.moldingTypeOf({ wardrobeMoldingType: t }))).toEqual(['top', 'in', 'none', null, null]);
  });
  test('인몰딩 도어 늘림 = 상몰딩 높이 − 20 (도어 위 끝 = 천장 − 20), 그 밖은 0', () => {
    expect(WR.doorTopExtraOf(inn)).toBe(40);
    expect(WR.doorTopExtraOf({ wardrobeMoldingH: 80, wardrobeMoldingType: 'in' })).toBe(60);
    expect(WR.doorTopExtraOf({ wardrobeMoldingH: 10, wardrobeMoldingType: 'in' })).toBe(0);
    expect([top, none, { wardrobeMoldingH: 60 }, {}].map(WR.doorTopExtraOf)).toEqual([0, 0, 0, 0]);
  });
  test('부재 — 인몰딩은 이름만 다른 같은 판 (몸통 앞선), 무몰딩은 없음, 상몰딩 · 인몰딩을 고르면 60 미만도 60×18T 마감재', () => {
    expect(WR.moldingPartFor({ moldingH: 60, totalW: 2000, type: 'in' })).toMatchObject({ part: '인몰딩', material: 'MDF', t: 18, w: 60, h: R.EP_LENGTH, qty: 1 });
    expect(WR.moldingPartFor({ moldingH: 60, totalW: 2000, type: 'in' }).note).toMatch(/몸통 앞선/);
    expect(WR.moldingPartFor({ moldingH: 60, totalW: 2000, type: 'top' })).toMatchObject({ part: '상몰딩', w: 60 });
    expect(WR.moldingPartFor({ moldingH: 80, totalW: 2000, type: 'none' })).toBeNull();
    expect(WR.moldingPartFor({ moldingH: 40, totalW: 2000, type: 'top' })).toMatchObject({ part: '상몰딩', w: R.MOLDING_FINISH_W });
    expect(WR.moldingPartFor({ moldingH: 40, totalW: 2000 })).toBeNull();   // 종류 없음 — 예전 그대로 (스위치 꺼짐)
  });
});

describe('BOM · 철물 · 조립 — 천장 2300 · 짧은옷 2단', () => {
  test('상몰딩 60 — 몸통 2180, 도어 = 좌대 60 + 몸통 − 20 = 2220, 상몰딩 60 × 2440', () => {
    const r = run(top);
    expect(r.rows(/^측판$/).map((x) => x[2])).toEqual([1090, 1090]);   // 두 몸통
    expect(r.rows(/^도어$/)).toEqual([['도어', 446, 2220, 2]]);
    expect(r.rows(/몰딩$/).filter((x) => /상|인/.test(x[0]))).toEqual([['상몰딩', 60, 2440, 1]]);
  });
  test('인몰딩 60 — 몸통 2180 그대로, 도어가 몰딩을 덮어 40 길다 (2260, 위 끝 2280 = 천장 − 20), 인몰딩 60 × 2440', () => {
    const r = run(inn);
    expect(r.rows(/^측판$/).map((x) => x[2])).toEqual([1090, 1090]);   // 두 몸통
    expect(r.rows(/^도어$/)).toEqual([['도어', 446, 2260, 2]]);
    expect(r.rows(/몰딩$/).filter((x) => /상|인/.test(x[0]))).toEqual([['인몰딩', 60, 2440, 1]]);
    // 조립 — 도어가 자리를 찾는다 (윗변 = 몸통 상단 + 40), 검사 오류 없음
    const mod = r.spec.items[0].modules.find((m) => m.moduleKey === r.mk);
    expect(mod.parts.filter((p) => p.part === '도어').length).toBe(2);
    expect(r.spec.unplaced.filter((u) => u.moduleKey === r.mk)).toEqual([]);
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  test('무몰딩 20 — 몸통 2220, 도어 2260 (인몰딩 60 과 도어 위 끝이 같다), 몰딩 부재 없음', () => {
    const r = run(none);
    expect(r.rows(/^측판$/).map((x) => x[2])).toEqual([1110, 1110]);   // 두 몸통
    expect(r.rows(/^도어$/)).toEqual([['도어', 446, 2260, 2]]);
    expect(r.rows(/몰딩$/).filter((x) => /상|인/.test(x[0]))).toEqual([]);
  });
  test('인몰딩 + 외부 서랍 (긴옷 + 서랍) — 서랍 위 도어도 40 길다, 조립 자리 그대로', () => {
    const t = run(top, { preset: 'longDrawer' });
    const i = run(inn, { preset: 'longDrawer' });
    const door = (r) => r.rows(/^도어$/)[0];
    expect(door(i)[2] - door(t)[2]).toBe(40);
    expect(i.spec.unplaced.filter((u) => u.moduleKey === i.mk)).toEqual([]);
    expect(Check.check(i.spec).issues.filter((x) => x.level === 'error')).toEqual([]);
  });
  test('종류가 없으면 예전 그대로 — 상몰딩 20 이면 도어 2260 · 부재 없음', () => {
    const r = run({ wardrobeMoldingH: 20 });
    expect(r.rows(/^도어$/)).toEqual([['도어', 446, 2260, 2]]);
    expect(r.rows(/몰딩$/).filter((x) => /상|인/.test(x[0]))).toEqual([]);
  });
});
