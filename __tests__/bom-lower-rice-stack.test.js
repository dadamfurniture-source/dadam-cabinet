/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 하부 밥솥장 (밑 서랍) — 2026-10-26 사장님 결정.
 *
 *   하부 줄에 서랍 모듈 위에 밥솥장 상자를 쌓는다 — 둘은 따로 만든 모듈이다.
 *     몸통 708 = 서랍 모듈 250 (기본) + 밥솥장 428 (남는 높이) + 목대 30   (밥솥장 윗면 = 이웃 하부장 도어 윗선 828)
 *     하부 밥솥장 최소 내경 높이 392 — 들어가는 밥솥 높이 = 내경 − 선반 · 레일 약 70
 *   서랍 모듈   서랍 1칸 · 위는 하부장 상단 목찬넬과 같다 (따내기 70×40 · 목찬넬 전면 52 + 지면 40 — 그 모듈의 부재)
 *   밥솥장 위   목대 30 × W × 18T 2장, 도어 색 — 앞(몸통 앞선에서 22 안쪽) · 뒤
 *   상판 아래 목찬넬 줄은 그 칸에서 끊긴다 · 걸레받이 · 상판은 이어진다 (밑 서랍 모듈이 그 자리를 센다)
 *   끊겨 나뉜 목찬넬 자리는 2026-10-26 「조각」 규칙 그대로 (sink.md EP) — 깊이 때문에 나뉜 자리가 아니므로 800 보다 짧으면
 *   800 으로 내고 현장에서 자른다 (명세 · 3D 는 붙는 길이 600, tags.siteCut).
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
require('../js/detaildesign/bom-open-cabinet-rules.js');
const RR = require('../js/detaildesign/bom-rice-cabinet-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');
// 2026-10-26 「조각」 — 800 보다 짧은 조각 비고 (상자 · 밥솥장 규칙을 실은 뒤에 추출기를 싣는다)
const { BOM_LINE_PIECE_SITE_NOTE } = require('../js/detaildesign/extractors.js');

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

/** 하부 줄: 2도어 600 · [서랍 drawerH + 밥솥장 (708 − drawerH − 30) + 목대 30] 450 · 2도어 600. placed 면 평면 자리(plane → _place)도 싣는다 */
function line(door, dir, drawerH = RR.RULES.LOWER_STACK.DRAWER_H, placed = false) {
  const modules = [
    { id: 'l0', section: 'lower', W: 600, H: 870, D, x: 0, y: BACK, areaH: 870 },
    { id: 'd1', section: 'lower', W: 450, H: 150 + drawerH, D, x: 600, y: BACK, areaH: 150 + drawerH, stackTop: 'rice' },
    { id: 'r1', section: 'lower', W: 450, H: (708 - drawerH - 30) + 30 + 12, D, x: 600, y: BACK, areaH: 870, riceBelow: 'drawer' },
    { id: 'l2', section: 'lower', W: 600, H: 870, D, x: 1050, y: BACK, areaH: 870 },
  ].map((m) => (placed ? Object.assign(m, { plane: { cx: m.x + m.W / 2, cy: m.y + m.D / 2 }, rotation: 0 }) : m));
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
  test('밥솥장 몸통 = 470 − 상판 12 − 목대 30 = 428 (내경 392 = 하부 밥솥장 최소), stacked · riceTopBatten · 경고 없음', () => {
    const { conv } = line('none');
    const r = conv.modules.find((m) => m.moduleKind === 'rice');
    expect([r.h, r.stacked, r.riceTopBatten]).toEqual([428, true, 30]);
    expect(conv.warnings.filter((w) => /밥솥장/.test(w))).toEqual([]);
  });

  test('서랍을 260 으로 키우면 밥솥장 418 · 내경 382 — 하부 밥솥장 최소 392 경고', () => {
    const { conv } = line('none', 'left', 260);
    expect(conv.warnings.filter((w) => /밥솥장 내경 높이 382 가 최소 392/.test(w)).length).toBe(1);
  });

  test('키큰장 · 단독 밥솥장은 최소 400 그대로 (하부 쌓기만 392)', () => {
    expect(RR.warningsOf({ W: 450, H: 428, D: 550 }, { below: 'drawer' }).some((w) => /최소 400/.test(w))).toBe(true);
    expect(RR.warningsOf({ W: 450, H: 428, D: 550 }, { below: 'drawer', lowerStack: true })).toEqual([]);
  });

  test('밑 서랍 모듈 = 400 − 다리 150 − 상판 0 = 250, stackTop rice', () => {
    const { conv, key } = line('none');
    const d = conv.modules.find((m) => m.id === key('d1'));
    expect([d.h, d.stackTop, d.drawerLayout, d.drawerCount]).toEqual([250, 'rice', 'all', 1]);
  });

  test('표시가 없는 하부 모듈은 예전 payload 그대로 (stackTop · stacked 없음)', () => {
    const { conv, key } = line('none');
    const l = conv.modules.find((m) => m.id === key('l0'));
    expect(l).not.toHaveProperty('stackTop');
    expect(l).not.toHaveProperty('stacked');
  });
});

describe('BOM', () => {
  test('밑 서랍: 서랍 앞판 1장 446 × 220 (몸통 250 − 상단 슬롯 30) · 박스 소 75 · 그 모듈의 목찬넬 전면 52 + 지면 40 · 측판 따내기', () => {
    const { materials } = line('none');
    const rows = materials.filter((m) => m.moduleKey === '0-planner-d1-0');
    const row = (p) => rows.filter((m) => m.part === p);
    expect(row('서랍도어').map((m) => [m.w, m.h, m.qty])).toEqual([[446, 220, 1]]);
    expect(row('측판')[0].h).toBe(250);
    expect(row('서랍측판')[0].note).toMatch(/소 박스/);
    expect(rows.some((m) => /레일 여유 부족/.test(String(m.note || '')))).toBe(false);
    expect(row('측판')[0].note).toMatch(/목찬넬 따내기 상단 70×40/);
    expect(row('목찬넬(전면)').map((m) => [m.w, m.h, m.qty])).toEqual([[52, 450, 1]]);
    expect(row('목찬넬(지면)').map((m) => [m.w, m.h, m.qty])).toEqual([[40, 450, 1]]);
  });

  test('밥솥장 위 목대 30 × 450 × 18T 2장 — 도어 색 (마감 슬롯 door)', () => {
    const { materials } = line('none');
    const b = materials.filter((m) => m.part === RR.RULES.LOWER_TOP_BATTEN.PART);
    expect(b.map((m) => [m.material, m.thickness, m.w, m.h, m.qty, m.slot])).toEqual([['MDF', 18, 30, 450, 2, 'door']]);
  });

  test('줄 — 상판 아래 목찬넬은 밥솥장 칸에서 끊겨 600 두 자리 (800 발주 · 현장 자름) · 걸레받이 · 상판은 1650 한 장', () => {
    const { materials } = line('none');
    const ep = (p) => materials.filter((m) => /EP|상판/.test(m.module) && m.part === p).map((m) => [m.h, m.qty]);
    // 2026-10-26 「조각」: 600 자리는 깊이 때문에 나뉜 자리가 아니다 — 800 으로 내고 현장에서 자른다 (깊이가 다른 키큰장 한쪽 600 → 800 과 같다)
    expect(ep('목찬넬(전면)')).toEqual([[800, 2]]);
    expect(ep('목찬넬(지면)')).toEqual([[800, 2]]);
    expect(materials.filter((m) => /EP/.test(m.module) && /^목찬넬/.test(m.part)).every((m) => String(m.note).includes(BOM_LINE_PIECE_SITE_NOTE))).toBe(true);
    expect(materials.filter((m) => m.part === '걸레받이').map((m) => m.w)).toEqual([1650]);
    expect(materials.find((m) => m.part === '상판').w).toBe(1650);
  });

  test('평면 자리(_place)가 있어도 같다 — 쌓인 밥솥장은 자리에서 빠지고, 목찬넬만 그 칸에서 나뉜다 · 명세 못 놓은 행 없음', () => {
    const { conv, materials, spec } = line('none', 'left', RR.RULES.LOWER_STACK.DRAWER_H, true);
    expect(conv.modules.every((m) => !!m._place)).toBe(true);
    const ep = (p) => materials.filter((m) => /EP/.test(m.module) && m.part === p).map((m) => [m.h, m.qty]);
    expect(ep('목찬넬(전면)')).toEqual([[800, 2]]);
    expect(ep('목찬넬(지면)')).toEqual([[800, 2]]);
    expect(materials.filter((m) => m.part === '걸레받이').map((m) => [m.w, m.qty])).toEqual([[1650, 1]]);
    expect(spec.unplaced.filter((u) => u.reason !== 'shelf-height-unknown')).toEqual([]);
  });
});

describe('조립 명세', () => {
  test.each([['none'], ['swing'], ['liftup']])('밥솥장 %s — 못 놓은 행 없음 · 조립 검사 오류 없음', (door) => {
    const { spec } = line(door, 'right');
    expect(spec.unplaced.filter((u) => u.reason !== 'shelf-height-unknown')).toEqual([]);
    expect(Check.check(spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  test('목대 자리 — 상자 위 y 428 … 458, 앞 목대 앞면 = 앞선 − 22, 뒤 목대 = 뒤끝', () => {
    const { spec } = line('none');
    const r = spec.items[0].modules.find((m) => m.moduleKey === '0-planner-r1-rice');
    const bat = r.parts.filter((p) => p.part === RR.RULES.LOWER_TOP_BATTEN.PART);
    expect(bat.map((p) => p.box)).toEqual([
      { min: [-225, 428, 275 - 22 - 18], max: [225, 458, 275 - 22] },
      { min: [-225, 428, -275], max: [225, 458, -275 + 18] },
    ]);
  });

  test('줄 부재 — 목찬넬은 두 구간에 놓이고 쌓인 밥솥장은 줄에 서지 않는다', () => {
    const { spec } = line('none');
    const runs = spec.items[0].runs || [];
    const ch = runs.filter((r) => r.parts.some((p) => p.part === '목찬넬(전면)'));
    expect(ch.map((r) => r.hostModuleKey).sort()).toEqual(['0-planner-l0-0', '0-planner-l2-0']);
    // 현장에서 자르는 조각 — 명세 재단은 붙는 길이 600, 발주 800 (tags.siteCut)
    const pcs = ch.map((r) => r.parts.find((p) => p.part === '목찬넬(전면)'));
    expect(pcs.map((p) => [p.cut.h, p.tags.siteCut])).toEqual([[600, { order: 800 }], [600, { order: 800 }]]);
    expect(runs.some((r) => r.hostModuleKey === '0-planner-r1-rice')).toBe(false);
  });
});

describe('철물', () => {
  test('다리발은 밑 서랍 모듈만 — 쌓인 밥솥장은 세지 않는다 (줄 600 · 450 · 600 → 4 × 3 = 12)', () => {
    const { item, spec } = line('none');
    const { HardwareExtractor } = loadExtractors();
    const legs = new HardwareExtractor().extract({ items: [item] }).hardware.filter((h) => h.category === '다리발');
    expect(legs.map((h) => h.qty)).toEqual([12]);
    const r = spec.items[0].modules.find((m) => m.moduleKey === '0-planner-r1-rice');
    expect((r.hardware || []).filter((h) => h.kind === 'leg')).toEqual([]);
  });
});
