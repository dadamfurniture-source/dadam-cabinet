/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 모듈 속 부재 — 세로칸막이 · 선반 · 속서랍 (2026-10-29 사장님, js/detaildesign/bom-interior-rules.js · docs/design-rules/interior-parts.md).
 *
 *   세로칸막이 (2026-10-30 사장님 "중간판을 세로칸막이로 바꿔줘") 몸통 PB T · 천지판 깊이 × (지판 · 속서랍 상판 ~ 천판 · 밴드), 좌우 칸 균등,
 *          나뉜 칸마다 선반 따로, 가운데를 덮으면 처짐방지목 빼기, 칸 폭 최소 200 (붙박이장 MIN_CELL_W)
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
  return { shelves: L.shelves, interior: Object.assign({ mids: o.mids || 0, inner: o.inner || 0 }, o.cols ? { cols: o.cols } : {}), L };
};

const L900 = inside(900, LOWER_H, D, { inner: 1 });
const U900 = inside(900, UPPER_H, UD, { mids: 1 });
const L600 = inside(600, LOWER_H, D, { shelves: 0 });
const LD900 = inside(900, LOWER_H, D, { mids: 1, cols: [2, 0] });
const UW900 = inside(900, UPPER_H, UD, { mids: 2, cols: [0, 1, 0] });

/** 하부 줄: 2도어 900 (속서랍 1) · 1도어 600 (선반 0 — 속을 정함) · 2도어 900 (속 그대로) · 2도어 900 (세로칸막이 1 · 왼쪽 선반 2),
 *  상부 줄: 2도어 900 (세로칸막이 1 · 선반 0) · 2도어 900 (속 그대로) · 2도어 900 (세로칸막이 2 · 가운데 칸 선반 1) */
function kitchen() {
  const modules = [
    { id: 'a', section: 'lower', W: 900, H: 870, D, x: 0, y: BACK, areaH: 870 },
    { id: 'b', section: 'lower', W: 600, H: 870, D, x: 900, y: BACK, areaH: 870 },
    { id: 'c', section: 'lower', W: 900, H: 870, D, x: 1500, y: BACK, areaH: 870 },
    { id: 'd', section: 'lower', W: 900, H: 870, D, x: 2400, y: BACK, areaH: 870 },
    { id: 'u', section: 'upper', W: 900, H: 780, D: UD, x: 0, y: 0, areaH: 780 },
    { id: 'v', section: 'upper', W: 900, H: 780, D: UD, x: 900, y: 0, areaH: 780 },
    { id: 'w', section: 'upper', W: 900, H: 780, D: UD, x: 1800, y: 0, areaH: 780 },
  ];
  const structures = {
    a: doors(900, 2, { shelves: L900.shelves, interior: L900.interior }),
    b: doors(600, 1, { shelves: L600.shelves, interior: L600.interior }),
    c: doors(900, 2, { shelves: engine.calcDefaultShelves('lower', LOWER_H) }),
    d: doors(900, 2, { shelves: LD900.shelves, interior: LD900.interior }),
    u: doors(900, 2, { shelves: U900.shelves, interior: U900.interior }),
    v: doors(900, 2, { shelves: engine.calcDefaultShelves('upper', UPPER_H) }),
    w: doors(900, 2, { shelves: UW900.shelves, interior: UW900.interior }),
  };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'sink', w: 3300, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
  const mk = (id) => `0-${key(id)}`;
  const shelfY = {};
  Object.keys(structures).forEach((id) => { shelfY[mk(id)] = structures[id].shelves; });
  const lines = [[
    { key: 'area-lower-0', D: AREA_D, modules: ['a', 'b', 'c', 'd'].map((id, i) => ({ moduleKey: mk(id), x0: [0, 900, 1500, 2400][i], back: BACK })) },
    { key: 'area-upper-0', D: 325, modules: ['u', 'v', 'w'].map((id, i) => ({ moduleKey: mk(id), x0: i * 900, back: 30 })) },
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

  test('세로칸막이 · 속서랍이 없으면 선반 자리 = 플래너 기본 (shelvesEvenInner · calcDefaultShelves)', () => {
    expect(IR.interiorLayoutOf({ H: UPPER_H, W: 900, D: UD, shelves: 2, shoe: false }).shelves).toEqual(engine.shelvesEvenInner(UPPER_H, 2));
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 900, D, shelves: 1 }).shelves).toEqual(engine.calcDefaultShelves('lower', LOWER_H));
  });

  test('세로칸막이 n 장 = 몸통 안 폭 n + 1 칸 좌우 균등 (나머지는 맨 오른쪽), 나뉜 칸마다 선반, 가운데를 덮으면 처짐방지목 빼기 (2026-10-30 사장님)', () => {
    const L = IR.interiorLayoutOf({ H: LOWER_H, W: 900, D, mids: 1, cols: [2, 0], shelves: 1 });
    expect(L.cols.map((c) => [c.x0, c.w, c.shelves])).toEqual([[15, 427, 2], [457, 428, 0]]);   // (870 − 15) / 2 = 427 · 428
    expect(L.divs).toEqual([{ x0: 442 }]);
    expect([L.divY0, L.divH, L.braceOff]).toEqual([T, LOWER_H - 2 * T, true]);
    expect(L.shelves).toEqual(IR.shelvesInCell(T, LOWER_H - T, 2, T));
    expect(L.errors).toEqual([]);
    // 나뉜 칸 선반을 안 주면 모듈 선반 수를 받는다
    expect(IR.interiorLayoutOf({ H: LOWER_H, W: 900, D, mids: 1, shelves: 1 }).cols.map((c) => c.shelves)).toEqual([1, 1]);
    // 2장이면 가운데가 비어 처짐방지목은 그대로
    const L2 = IR.interiorLayoutOf({ H: UPPER_H, W: 900, D: UD, mids: 2 });
    expect([L2.cols.map((c) => c.w), L2.divs.map((d) => d.x0), L2.braceOff]).toEqual([[280, 280, 280], [295, 590], false]);
    // 칸 폭 최소 = 붙박이장 MIN_CELL_W 200 (사장님 「붙박이장과 같은 200」) — 450 에 2장이면 130
    expect(IR.interiorLayoutOf({ H: UPPER_H, W: 450, D: UD, mids: 1 }).errors).toEqual([]);
    expect(IR.interiorLayoutOf({ H: UPPER_H, W: 450, D: UD, mids: 2 }).errors).toEqual([`세로칸막이 2장이면 칸 폭 130 이 최소 ${WR.WARDROBE_RULES.MIN_CELL_W} 보다 좁습니다`]);
    // 가로 중간판 시절 구조(중심 y 배열)는 장수만 읽는다
    expect(IR.normalize({ mids: [300, 500], inner: 0 })).toEqual({ mids: 2, cols: null, inner: 0 });
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
    expect(pick(r, '세로칸막이')).toEqual([]);
  });

  test('상부 900 세로칸막이 1 · 선반 0 — 칸막이 천판 깊이 277 × 690 (앞까지), 가운데라 처짐방지목 없음, 선반 없음', () => {
    const r = rows('u');
    expect(pick(r, '세로칸막이')).toEqual([[UD - C.SAKURI_PANEL_D_MINUS, UPPER_H - 2 * T, 1]]);
    expect(pick(r, '선반')).toEqual([]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([]);
  });

  test('하부 900 세로칸막이 1 · 왼쪽 선반 2 — 칸막이 지판 깊이 550 × 608 (목찬넬 앞 밴드 밑까지 = 처짐방지목 높이), 선반 427 × 2, 처짐방지목 없음', () => {
    const r = rows('d');
    expect(pick(r, '세로칸막이')).toEqual([[D, pick(rows('c'), '밴드(처짐방지)')[0][1], 1]]);
    expect(pick(r, '세로칸막이')[0][1]).toBe(LOWER_H - 2 * T - 70);
    expect(pick(r, '선반')).toEqual([[427, D - T, 2]]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([]);
  });

  test('상부 900 세로칸막이 2 · 가운데 칸 선반 1 — 칸막이 2장, 선반 280 × 1, 가운데가 비어 처짐방지목 그대로', () => {
    const r = rows('w');
    expect(pick(r, '세로칸막이')).toEqual([[UD - C.SAKURI_PANEL_D_MINUS, UPPER_H - 2 * T, 2]]);
    expect(pick(r, '선반')).toEqual([[280, UD - C.SAKURI_SHELF_D_MINUS, 1]]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([[C.BRACE_W, UPPER_H - 2 * T, 1]]);
  });

  test('하부 600 선반 0 (속을 정함) — 선반 없음, 세로칸막이 · 속서랍 없음', () => {
    expect(pick(rows('b'), '선반')).toEqual([]);
    expect(rows('b').some((m) => /세로칸막이|내부서랍/.test(m.part + m.module))).toBe(false);
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

  test('세로칸막이 — 측판처럼 선다: 왼쪽 면 = 나뉜 칸 사이, 밑단 = 지판 윗면, 뒤끝 = 천판 뒤끝 (사쿠리 홈 앞), 처짐방지목 없음', () => {
    const m = modOf('u');
    const divs = m.parts.filter((p) => p.part === '세로칸막이');
    expect(divs).toHaveLength(1);
    expect(divs[0].frame.o).toEqual([-450 + 442, T, -UD / 2 + C.SAKURI_PANEL_D_MINUS]);
    expect(m.parts.filter((p) => p.part === '밴드(처짐방지)')).toEqual([]);
    expect(modOf('w').parts.filter((p) => p.part === '세로칸막이').map((p) => p.frame.o[0])).toEqual([-450 + 295, -450 + 590]);
  });

  test('나뉜 칸 선반 — 그 칸 자리 (x = 칸 왼쪽, y = 칸 안 균등)', () => {
    const sh = modOf('d').parts.filter((p) => p.part === '선반');
    expect(sh.map((p) => [p.frame.o[0], p.frame.o[1]])).toEqual(IR.shelvesInCell(T, LOWER_H - T, 2, T).map((y) => [-450 + 15, y - T / 2]));
    expect(modOf('w').parts.filter((p) => p.part === '선반').map((p) => p.frame.o[0])).toEqual([-450 + 310]);
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
