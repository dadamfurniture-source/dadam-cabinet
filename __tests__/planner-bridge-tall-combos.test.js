/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 브리지 (ui-step1.js _convertPlannerModules) — 키큰장 단 조합, 2026-10-24 사장님 (모듈 라이브러리 키큰장 조합).
 *
 *   상자 단   키큰장 섹션의 오픈장 · 밥솥장 · 홈카페장 · EL장 모듈도 `type:'tall'` + heightParts — BOM 이 그 단의 좌대 · 상몰딩을 내고
 *             다리발 · 라인 폭에서 뺀다 (sink.md §5.1). 하부 · 상부 섹션의 상자는 예전 그대로 'storage'.
 *   플랩      키큰장 **맨 위 단**(상몰딩을 짊어진 단) 칸 열림 '위' → doorOpen 'up' (상부장 플랩과 같은 철물).
 *   밥솥장    여닫이 · 포켓 도어는 외짝 — 경첩 방향 = 칸 열림 방향 (2026-10-23 4-1 C). 오픈 · 리프트에는 없다.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
// 브리지는 상자 규칙 파일을 전역(DadamHomecafeRules · DadamElRules …)으로 찾는다 — 상세설계 화면이 싣는 순서처럼 먼저 싣는다
require('../js/detaildesign/bom-open-cabinet-rules.js');
require('../js/detaildesign/bom-rice-cabinet-rules.js');
require('../js/detaildesign/bom-homecafe-rules.js');
require('../js/detaildesign/bom-el-rules.js');

const convert = (modules, structures) => loadConverter()._convertPlannerModules(
  { modules, structures, hasStructures: true }, Object.assign({}, LEDGER_SPECS));

/** 키큰장 세 단 — 하부 861(좌대 60) · 중간 979 · 상부 460(상몰딩 60), 플래너 tallTiers 모양 (합성 값) */
const TIERS = [
  { part: '하부장', H: 861, pedestalH: 60, moldingH: 0 },
  { part: '중간장', H: 979, pedestalH: 0, moldingH: 0 },
  { part: '상부장', H: 460, pedestalH: 0, moldingH: 60 },
];
function tallStack(over) {
  const modules = TIERS.map((t, i) => ({ id: `tall-${i}`, section: 'tall', part: t.part, W: 600, H: t.H, D: 620, x: 0, y: 0, areaH: 2300 }));
  const structures = {};
  TIERS.forEach((t, i) => {
    structures[`tall-${i}`] = Object.assign({
      moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'],
      areaWidths: [600], areaIs2D: [false], legH: 0, pedestalH: t.pedestalH, moldingH: t.moldingH, shelves: [],
    }, (over || {})[i] || {});
  });
  return { modules, structures };
}
const byTier = (conv, i) => conv.modules.find((m) => String(m.id).indexOf(`planner-tall-${i}-`) === 0);

describe('상자 단 — 키큰장 섹션의 상자 모듈은 키큰장 단으로 넘긴다', () => {
  test.each([['open', 'open'], ['rice', 'rice'], ['homecafe', 'homecafe'], ['el', 'el']])('%s: type tall + 단의 heightParts', (kind, suffix) => {
    const { modules, structures } = tallStack({ 0: { moduleKind: kind } });
    const m = byTier(convert(modules, structures), 0);
    expect(m.id).toBe(`planner-tall-0-${suffix}`);
    expect(m.type).toBe('tall');
    expect(m.moduleKind).toBe(kind);
    expect(m.heightParts).toEqual({ moldingH: 0, pedestalH: 60 });
  });

  test('하부 섹션의 오픈장은 예전 그대로 storage (다리발로 선다)', () => {
    const conv = convert([{ id: 'l0', section: 'lower', W: 450, H: 870, D: 550, x: 0, y: 0 }],
      { l0: { moduleKind: 'open', verticalCount: 1, areaTypes: ['door'], areaWidths: [450], areaIs2D: [false], areaDirections: ['left'], legH: 150 } });
    expect(conv.modules[0].type).toBe('storage');
  });

  test('BOM: 맨 아래 단 오픈장은 다리발을 세지 않는다 (좌대가 받친다)', () => {
    const { modules, structures } = tallStack({ 0: { moduleKind: 'open' } });
    const conv = convert(modules, structures);
    const { HardwareExtractor } = loadExtractors();
    const item = { categoryId: 'sink', w: 600, h: 2310, d: 650, specs: Object.assign({}, LEDGER_SPECS), modules: conv.modules };
    const hw = new HardwareExtractor().extract({ items: [item] }).hardware;
    expect(hw.filter((h) => h.category === '다리발')).toEqual([]);
    // 자재 — 오픈장 상자 + 그 단의 좌대 상자 · 걸레받이 (BOM addTallStackParts, #1050)
    const { MaterialExtractor } = loadExtractors();
    const rows = new MaterialExtractor().extract({ items: [item] }).materials.filter((m) => m.moduleKey === '0-planner-tall-0-open');
    expect(rows.map((m) => m.part)).toEqual(['측판', '천지판', '뒷판', '좌대 전후', '좌대 측', '좌대 걸레받이']);
  });
});

describe('플랩 — 키큰장 맨 위 단 칸 열림 "위"', () => {
  test('맨 위 단(상몰딩 단) "위" 는 doorOpen up, 경첩 방향은 붙이지 않는다', () => {
    const { modules, structures } = tallStack({ 2: { areaDirections: ['up'] } });
    const m = byTier(convert(modules, structures), 2);
    expect(m.doorOpen).toBe('up');
    expect(m).not.toHaveProperty('hingeSide');
  });

  test('중간 · 맨 아래 단 "위" 는 플랩이 아니다 (필드 없음)', () => {
    const { modules, structures } = tallStack({ 0: { areaDirections: ['up'] }, 1: { areaDirections: ['up'] } });
    const conv = convert(modules, structures);
    expect(byTier(conv, 0)).not.toHaveProperty('doorOpen');
    expect(byTier(conv, 1)).not.toHaveProperty('doorOpen');
  });

  test('BOM: 맨 위 단 플랩 — 천판 쪽 경첩(도어 폭 변) + 가스쇼바 2', () => {
    const { modules, structures } = tallStack({ 2: { areaDirections: ['up'] } });
    const conv = convert(modules, structures);
    const { HardwareExtractor } = loadExtractors();
    const item = { categoryId: 'sink', w: 600, h: 2310, d: 650, specs: Object.assign({}, LEDGER_SPECS), modules: conv.modules };
    const hw = new HardwareExtractor().extract({ items: [item] }).hardware.filter((h) => h.moduleKey === '0-planner-tall-2-0');
    expect(hw.map((h) => h.category)).toEqual(['경첩', '가스쇼바']);
    expect(hw[0].boringSide).toBe('top');
    expect(hw[1].qty).toBe(2);
  });
});

describe('밥솥장 — 경첩으로 세는 도어는 칸 열림 방향이 경첩 방향', () => {
  const riceOf = (door, dir) => {
    const { modules, structures } = tallStack({ 0: { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer' }, 1: { moduleKind: 'rice', rice: { door }, areaDirections: [dir] } });
    return byTier(convert(modules, structures), 1);
  };
  test.each([['swing', 'right'], ['swing', 'left'], ['pocket', 'right']])('%s · %s', (door, dir) => {
    expect(riceOf(door, dir).hingeSide).toBe(dir);
  });
  test('오픈 · 리프트에는 경첩 방향이 없다', () => {
    expect(riceOf('none', 'right')).not.toHaveProperty('hingeSide');
    expect(riceOf('liftup', 'right')).not.toHaveProperty('hingeSide');
  });
});
