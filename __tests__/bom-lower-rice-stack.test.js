/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 하부 밥솥장 (밑 서랍) — 2026-10-26 사장님 결정.
 *
 *   하부 줄에 서랍 모듈 위에 밥솥장 상자를 쌓는다 — 둘은 따로 만든 모듈이다.
 *     몸통 708 = 서랍 모듈 178 + 밥솥장 500 + 목대 30   (밥솥장 윗면 = 이웃 하부장 도어 윗선 828)
 *   서랍 모듈   서랍 1칸 · 위는 하부장 상단 목찬넬과 같다 (따내기 70×40 · 목찬넬 전면 52 + 지면 40 — 그 모듈의 부재)
 *   밥솥장 위   목대 30 × W × 18T 2장, 도어 색 — 앞(몸통 앞선에서 22 안쪽) · 뒤
 *   상판 아래 목찬넬 줄은 그 칸에서 끊긴다 · 걸레받이 · 상판은 이어진다 (밑 서랍 모듈이 그 자리를 센다)
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
require('../js/detaildesign/bom-open-cabinet-rules.js');
const RR = require('../js/detaildesign/bom-rice-cabinet-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const SPECS = Object.assign({}, LEDGER_SPECS, { handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const D = 550, BACK = 70, AREA_D = 650;
const door2 = (W) => ({ moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [W], areaIs2D: [true], legH: 150, shelves: [] });
const drawer1 = () => ({
  moduleKind: 'normal', verticalCount: 1, areaTypes: ['door'], areaDirections: ['left'], areaWidths: [450], areaIs2D: [false],
  legH: 150, topT: 0, shelves: [],   // 위는 상판이 아니라 밥솥장 — 상판 두께를 빼지 않는다
  horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 1,
  drawer: { rail: 'under', sakuri: true, boxT: 0, grades: ['auto'], doorGrade: '', topDrawer: true },
});
const rice = (door, dir) => ({
  moduleKind: 'rice', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir || 'left'], areaWidths: [450], areaIs2D: [false],
  legH: 0, shelves: [], rice: { door },
});

/** 하부 줄: 2도어 600 · [서랍 178 + 밥솥장 500 + 목대 30] 450 · 2도어 600 */
function line(door, dir) {
  const modules = [
    { id: 'l0', section: 'lower', W: 600, H: 870, D, x: 0, y: BACK, areaH: 870 },
    { id: 'd1', section: 'lower', W: 450, H: 150 + 178, D, x: 600, y: BACK, areaH: 150 + 178, stackTop: 'rice' },
    { id: 'r1', section: 'lower', W: 450, H: 500 + 30 + 12, D, x: 600, y: BACK, areaH: 870, riceBelow: 'drawer' },
    { id: 'l2', section: 'lower', W: 600, H: 870, D, x: 1050, y: BACK, areaH: 870 },
  ];
  const structures = { l0: door2(600), d1: drawer1(), r1: rice(door, dir), l2: door2(600) };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'sink', w: 1650, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
  const lines = [[{ key: 'area-lower-0', D: AREA_D, modules: [
    { moduleKey: `0-${key('l0')}`, x0: 0, back: BACK }, { moduleKey: `0-${key('d1')}`, x0: 600, back: BACK },
    { moduleKey: `0-${key('r1')}`, x0: 600, back: BACK }, { moduleKey: `0-${key('l2')}`, x0: 1050, back: BACK },
  ] }]];
  const spec = Asm.of({ items: [item] }, { materials, lines });
  return { conv, item, materials, spec, key };
}

describe('브리지 — 쌓인 밥솥장 · 밑 서랍', () => {
  test('밥솥장 몸통 = 542 − 상판 12 − 목대 30 = 500, stacked · riceTopBatten · 경고 없음', () => {
    const { conv } = line('none');
    const r = conv.modules.find((m) => m.moduleKind === 'rice');
    expect([r.h, r.stacked, r.riceTopBatten]).toEqual([500, true, 30]);
    expect(conv.warnings.filter((w) => /밥솥장/.test(w))).toEqual([]);
  });

  test('밑 서랍 모듈 = 328 − 다리 150 − 상판 0 = 178, stackTop rice', () => {
    const { conv, key } = line('none');
    const d = conv.modules.find((m) => m.id === key('d1'));
    expect([d.h, d.stackTop, d.drawerLayout, d.drawerCount]).toEqual([178, 'rice', 'all', 1]);
  });

  test('표시가 없는 하부 모듈은 예전 payload 그대로 (stackTop · stacked 없음)', () => {
    const { conv, key } = line('none');
    const l = conv.modules.find((m) => m.id === key('l0'));
    expect(l).not.toHaveProperty('stackTop');
    expect(l).not.toHaveProperty('stacked');
  });
});

describe('BOM', () => {
  test('밑 서랍: 서랍 앞판 1장 446 × 148 (몸통 178 − 상단 슬롯 30) · 그 모듈의 목찬넬 전면 52 + 지면 40 · 측판 따내기', () => {
    const { materials } = line('none');
    const rows = materials.filter((m) => m.moduleKey === '0-planner-d1-0');
    const row = (p) => rows.filter((m) => m.part === p);
    expect(row('서랍도어').map((m) => [m.w, m.h, m.qty])).toEqual([[446, 148, 1]]);
    expect(row('측판')[0].h).toBe(178);
    expect(row('측판')[0].note).toMatch(/목찬넬 따내기 상단 70×40/);
    expect(row('목찬넬(전면)').map((m) => [m.w, m.h, m.qty])).toEqual([[52, 450, 1]]);
    expect(row('목찬넬(지면)').map((m) => [m.w, m.h, m.qty])).toEqual([[40, 450, 1]]);
  });

  test('밥솥장 위 목대 30 × 450 × 18T 2장 — 도어 색 (마감 슬롯 door)', () => {
    const { materials } = line('none');
    const b = materials.filter((m) => m.part === RR.RULES.LOWER_TOP_BATTEN.PART);
    expect(b.map((m) => [m.material, m.thickness, m.w, m.h, m.qty, m.slot])).toEqual([['MDF', 18, 30, 450, 2, 'door']]);
  });

  test('줄 — 상판 아래 목찬넬은 밥솥장 칸에서 끊겨 600 두 장 · 걸레받이 · 상판은 1650 한 장', () => {
    const { materials } = line('none');
    const ep = (p) => materials.filter((m) => /EP|상판/.test(m.module) && m.part === p).map((m) => [m.h, m.qty]);
    expect(ep('목찬넬(전면)')).toEqual([[600, 2]]);
    expect(ep('목찬넬(지면)')).toEqual([[600, 2]]);
    expect(materials.filter((m) => m.part === '걸레받이').map((m) => m.w)).toEqual([1650]);
    expect(materials.find((m) => m.part === '상판').w).toBe(1650);
  });
});

describe('조립 명세', () => {
  test.each([['none'], ['swing'], ['liftup']])('밥솥장 %s — 못 놓은 행 없음 · 조립 검사 오류 없음', (door) => {
    const { spec } = line(door, 'right');
    expect(spec.unplaced.filter((u) => u.reason !== 'shelf-height-unknown')).toEqual([]);
    expect(Check.check(spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  test('목대 자리 — 상자 위 y 500 … 530, 앞 목대 앞면 = 앞선 − 22, 뒤 목대 = 뒤끝', () => {
    const { spec } = line('none');
    const r = spec.items[0].modules.find((m) => m.moduleKey === '0-planner-r1-rice');
    const bat = r.parts.filter((p) => p.part === RR.RULES.LOWER_TOP_BATTEN.PART);
    expect(bat.map((p) => p.box)).toEqual([
      { min: [-225, 500, 275 - 22 - 18], max: [225, 530, 275 - 22] },
      { min: [-225, 500, -275], max: [225, 530, -275 + 18] },
    ]);
  });

  test('줄 부재 — 목찬넬은 두 구간에 놓이고 쌓인 밥솥장은 줄에 서지 않는다', () => {
    const { spec } = line('none');
    const runs = spec.items[0].runs || [];
    const ch = runs.filter((r) => r.parts.some((p) => p.part === '목찬넬(전면)'));
    expect(ch.map((r) => r.hostModuleKey).sort()).toEqual(['0-planner-l0-0', '0-planner-l2-0']);
    expect(runs.some((r) => r.hostModuleKey === '0-planner-r1-rice')).toBe(false);
  });
});
