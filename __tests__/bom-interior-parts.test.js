/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 모듈 속 부재 — 석가(중간판) · 선반 · 속서랍 (2026-10-29 사장님, js/detaildesign/bom-interior-rules.js · docs/design-rules/interior-parts.md).
 *
 *   석가   몸통 PB T · (W − 2T) × 천지판 깊이, 처짐방지목이 있으면 그 뒤까지 (−T) · 칸 균등
 *   선반   1장씩 · 칸마다 균등 · 칸 간격 최소 200 (2026-10-30 사장님 「200 으로 낮추기」 · 신발장 150 — planner-engine MASTER_RULES 와 같다)
 *   속서랍 붙박이장 속서랍 규칙 (W − 2T 통 내경 · 350 × 단수 · 모듈 D = 몸통 D − 110 · 전면 = 앞선 − 70), 지판 위.
 *          처짐방지목은 속서랍 상판 위부터 (서랍이 앞 가운데 목대에 걸리지 않는다)
 *   구조 s.interior 가 있는 모듈은 선반 수도 구조 그대로 — 싱크 상부 2 · 하부 1 고정을 타지 않는다. 없는 모듈은 예전과 같다.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
require('../js/detaildesign/bom-open-cabinet-rules.js');
const IR = require('../js/detaildesign/bom-interior-rules.js');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
const AR = require('../js/detaildesign/assembly-rules.js');
const engine = require('../js/planner/planner-engine.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const C = AR.CARCASS;
const SPECS = Object.assign({}, LEDGER_SPECS, { handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const T = 15, D = 550, BACK = 70, AREA_D = 650, UD = 295;
const LOWER_H = 870 - SPECS.sinkLegHeight - SPECS.topThickness;   // 708
const UPPER_H = 780 - SPECS.moldingH;                             // 720
const doors = (W, n, extra) => Object.assign({
  moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'],
  areaWidths: [W], areaIs2D: [n === 2],
}, extra || {});
/** 규칙 파일 배치로 구조 속을 채운다 — 간편 플래너(모듈 라이브러리)가 하는 그대로 */
const inside = (W, H, Dd, o) => {
  const L = IR.interiorLayoutOf(Object.assign({ W, H, D: Dd, T }, o));
  return { shelves: L.shelves, interior: { mids: L.mids, inner: o.inner || 0 }, L };
};

const L900 = inside(900, LOWER_H, D, { inner: 1 });
const U900 = inside(900, UPPER_H, UD, { mids: 1 });
const L600 = inside(600, LOWER_H, D, { shelves: 0 });

/** 하부 줄: 2도어 900 (속서랍 1) · 1도어 600 (선반 0 — 속을 정함) · 2도어 900 (속 그대로), 상부 줄: 2도어 900 (석가 1 · 선반 0) · 2도어 900 (속 그대로) */
function kitchen() {
  const modules = [
    { id: 'a', section: 'lower', W: 900, H: 870, D, x: 0, y: BACK, areaH: 870 },
    { id: 'b', section: 'lower', W: 600, H: 870, D, x: 900, y: BACK, areaH: 870 },
    { id: 'c', section: 'lower', W: 900, H: 870, D, x: 1500, y: BACK, areaH: 870 },
    { id: 'u', section: 'upper', W: 900, H: 780, D: UD, x: 0, y: 0, areaH: 780 },
    { id: 'v', section: 'upper', W: 900, H: 780, D: UD, x: 900, y: 0, areaH: 780 },
  ];
  const structures = {
    a: doors(900, 2, { shelves: L900.shelves, interior: L900.interior }),
    b: doors(600, 1, { shelves: L600.shelves, interior: L600.interior }),
    c: doors(900, 2, { shelves: engine.calcDefaultShelves('lower', LOWER_H) }),
    u: doors(900, 2, { shelves: U900.shelves, interior: U900.interior }),
    v: doors(900, 2, { shelves: engine.calcDefaultShelves('upper', UPPER_H) }),
  };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'sink', w: 2400, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
  const mk = (id) => `0-${key(id)}`;
  const shelfY = {};
  Object.keys(structures).forEach((id) => { shelfY[mk(id)] = structures[id].shelves; });
  const lines = [[
    { key: 'area-lower-0', D: AREA_D, modules: ['a', 'b', 'c'].map((id, i) => ({ moduleKey: mk(id), x0: [0, 900, 1500][i], back: BACK })) },
    { key: 'area-upper-0', D: 325, modules: ['u', 'v'].map((id, i) => ({ moduleKey: mk(id), x0: i * 900, back: 30 })) },
  ]];
  const spec = Asm.of({ items: [item] }, { materials, hardware, lines, shelfY });
  const rows = (id) => materials.filter((m) => m.moduleKey === mk(id));
  const modOf = (id) => spec.items[0].modules.find((m) => m.moduleKey === mk(id));
  return { conv, key, materials, hardware, spec, rows, modOf };
}
const pick = (rows, part) => rows.filter((r) => r.part === part).map((r) => [r.w, r.h, r.qty]);

describe('규칙 파일 — 배치', () => {
  test('칸 간격 최소 — 일반 200 (사장님 2026-10-30, 기본 선반 수 규칙 300 과 따로), 신발장 = MASTER_RULES 150, 판 두께 = BODY_T', () => {
    expect(IR.INTERIOR_RULES.SPACE_MIN).toEqual({ general: 200, shoe: engine.MASTER_RULES.SHELF_SPACE_MIN_SHOE });
    expect(engine.MASTER_RULES.SHELF_SPACE_MIN).toBe(300);   // 기본 선반 수 (calcDefaultShelves) 는 그대로
    expect(IR.INTERIOR_RULES.PANEL_T).toBe(engine.MASTER_RULES.BODY_T);
  });

  test('석가 · 속서랍이 없으면 선반 자리 = 플래너 기본 (shelvesEvenInner · calcDefaultShelves)', () => {
    expect(IR.interiorLayoutOf({ H: UPPER_H, W: 900, D: UD, shelves: 2, shoe: false }).shelves).toEqual(engine.shelvesEvenInner(UPPER_H, 2));
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 900, D, shelves: 1 }).shelves).toEqual(engine.calcDefaultShelves('lower', LOWER_H));
  });

  test('석가 n 장 = 몸통 안 n + 1 칸 균등, 선반은 칸마다 고르게 (남는 장은 아래 칸부터)', () => {
    const L = IR.interiorLayoutOf({ H: 2100, W: 600, D: 590, mids: 1, shelves: 3 });
    expect(L.mids).toEqual([1050]);   // 15 + (2070 − 15) / 2 + 7.5
    expect(L.cells.map((c) => c.shelves)).toEqual([2, 1]);
    expect(L.shelves).toEqual(IR.shelvesInCell(L.cells[0].y0, L.cells[0].y1, 2, T).concat(IR.shelvesInCell(L.cells[1].y0, L.cells[1].y1, 1, T)));
    expect(L.errors).toEqual([]);
  });

  test('칸 간격이 최소보다 좁으면 막는다 — 하부장 선반 2 (226) 는 들어가고 3 (169 < 200) 은 막는다, 신발장 기준은 150', () => {
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 600, D, shelves: 2 }).errors).toEqual([]);
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 600, D, shelves: 3 }).errors).toEqual(['칸 간격 169 이 최소 200 보다 좁습니다']);
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 600, D, shelves: 3, shoe: true }).errors).toEqual([]);
  });

  test('속서랍 — 붙박이장 규칙 그대로 (모듈 W = 내경 − 120 · H = 350 · D = 몸통 − 110), 지판 위 350 + 상판 15', () => {
    const z = L900.L.inner;
    const ref = WR.innerDrawerLayout({ Wi: 870, zoneH: 350, drawers: 1, T, D, rail: 'under' });
    expect([z.moduleW, z.moduleH, z.moduleD, z.totalH]).toEqual([750, 350, 440, 365]);
    expect(z.fronts).toEqual(ref.fronts);
    expect(L900.L.innerTop).toBe(T + 365);
    expect(L900.L.errors).toEqual([]);
    expect(L900.L.warnings.some((w) => /레일 450 이 안 들어간다/.test(w))).toBe(true);   // 모듈 440 → 레일 400 (여유 30)
  });

  test('속서랍이 안 되는 자리는 막는다 — 상부장 깊이(모듈 185 — 레일 없음) · 몸통에 안 들어가는 단수', () => {
    expect(IR.interiorLayoutOf({ H: UPPER_H, W: 900, D: UD, inner: 1 }).errors.join(' ')).toMatch(/레일도 들어가지 않습니다/);
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 900, D, inner: 2 }).errors.join(' ')).toMatch(/몸통 안 높이/);
  });
});

describe('자재 — 싱크 줄', () => {
  const { rows, hardware, key } = kitchen();

  test('하부 900 속서랍 1 — 선반 없음 (구조 그대로), 속서랍 모듈 · 전면 · 좌우몰딩 = 붙박이장 규칙, 처짐방지목 = 속서랍 상판 위 ~ 앞 밴드 밑', () => {
    const r = rows('a');
    expect(pick(r, '선반')).toEqual([]);
    const mod = r.filter((m) => /-내부서랍모듈$/.test(m.module));
    const ref = WR.innerDrawerModulePartsOf(L900.L.inner);
    expect(mod.map((m) => [m.part, m.w, m.h, m.qty])).toEqual(ref.map((m) => [m.part, m.w, m.h, m.qty]));
    expect(pick(r, '내부서랍 전면판')).toEqual(WR.innerDrawerPartsOf(L900.L.inner).filter((x) => x.part === '내부서랍 전면판').map((x) => [x.w, x.h, x.qty]));
    expect(pick(r, '내부서랍 좌우몰딩')).toEqual([[350, 60, 2]]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([[C.BRACE_W, LOWER_H - 2 * T - 70 - 365, 1]]);
    expect(pick(r, '석가')).toEqual([]);
  });

  test('상부 900 석가 1 · 선반 0 — 석가 870 × (천판 277 − 처짐방지목 15), 선반 없음 (예전 고정 2 를 타지 않는다)', () => {
    const r = rows('u');
    expect(pick(r, '석가')).toEqual([[870, UD - C.SAKURI_PANEL_D_MINUS - T, 1]]);
    expect(pick(r, '선반')).toEqual([]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([[C.BRACE_W, UPPER_H - 2 * T, 1]]);
  });

  test('하부 600 선반 0 (속을 정함) — 선반 없음, 석가 · 속서랍 없음', () => {
    expect(pick(rows('b'), '선반')).toEqual([]);
    expect(rows('b').some((m) => /석가|내부서랍/.test(m.part + m.module))).toBe(false);
  });

  test('속을 정하지 않은 모듈은 예전 그대로 — 하부 선반 1 · 상부 선반 2', () => {
    expect(pick(rows('c'), '선반')).toEqual([[870, D - T, 1]]);
    expect(pick(rows('v'), '선반')).toEqual([[870, UD - C.SAKURI_SHELF_D_MINUS, 2]]);
  });

  test('레일 — 속서랍 1단: 문주 언더레일 400 (여유 30 기준) 1 SET', () => {
    const rails = hardware.filter((h) => h.category === '레일' && /속서랍/.test(h.note));
    expect(rails.map((h) => [h.item, h.spec, h.qty])).toEqual([['문주 언더레일', '400mm', 1]]);
    expect(rails[0].note).toMatch(/속서랍/);
    expect(key('a')).toBeTruthy();
  });
});

describe('조립 명세', () => {
  const { spec, modOf } = kitchen();

  test('석가 — 구조 자리(중심 y), 뒤끝 = 천판 뒤끝 (사쿠리 홈 앞)', () => {
    const m = modOf('u');
    const mids = m.parts.filter((p) => p.part === '석가');
    expect(mids).toHaveLength(1);
    expect(mids[0].frame.o[1]).toBe(U900.L.mids[0] - T / 2);
    expect(mids[0].frame.o[2]).toBe(-UD / 2 + C.SAKURI_PANEL_D_MINUS);
  });

  test('속서랍 — 모듈 밑면 = 지판 윗면, 전면 앞면 = 앞선 − 70, 처짐방지목 밑단 = 속서랍 상판 윗면, 박스 · 레일 자리', () => {
    const m = modOf('a');
    const side = m.parts.find((p) => p.tags.innerDrawer && p.part === '측판');
    expect(side.frame.o[1]).toBe(T);
    const front = m.parts.find((p) => p.part === '내부서랍 전면판');
    expect(front.frame.o[2] + front.t).toBe(D / 2 - WR.WARDROBE_RULES.INNER_DRAWER.FRONT_SETBACK);
    const brace = m.parts.find((p) => p.part === '밴드(처짐방지)');
    expect(brace.frame.o[1]).toBe(T + 365);
    expect(m.drawerBoxes).toHaveLength(1);
    expect((m.hardware || []).filter((h) => h.kind === 'rail' && h.pending)).toEqual([]);
  });

  test('못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    expect(spec.unplaced).toEqual([]);
    expect(Check.check(spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
