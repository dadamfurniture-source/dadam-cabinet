/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 붙박이장 통 — 칸마다 선반 자리 · 옷봉 빼기 (2026-10-31 사장님 간편 플래너
 *   "선반은 선반을 따로 클릭하면 높이를 설정할 수 있는 입력창 … 아랫면에서 얼마, 윗면에서 얼마 … 이 기능을 사용해도 옷봉의 생성여부는 자동으로 조건에 따라" ·
 *   "옷봉을 클릭하면 제거 버튼이 생성되고 제거 버튼 클릭하면 제거").
 *
 *   cellShelfYs — 칸마다 선반 밑면 y 목록 (칸 바닥에서). 사람이 정한 자리라 칸 규칙(긴옷 315 · 균등)을 쓰지 않는다. 장수 = 목록 길이.
 *                 판이 겹치거나 칸 밖이면 경고하고 칸 규칙 자리 (플래너 · 라이브러리는 경고를 오류로 막는다).
 *   cellRods    — 칸마다 0 = 사람이 뺀 옷봉. 옷봉만 빼고 선반 자리는 그대로.
 *   옷봉 걸 공간 (ROD_MIN_HANG 950) 은 선반 자리를 정한 칸도 본다 — 옷봉은 최상단 선반 바로 아래라 선반을 옮기면 걸 공간이 바뀐다.
 *   구조 s.wardrobe → 브리지 mod.wardrobe → BOM(extractWardrobe · 옷봉 철물) · 조립(wardrobeOf). 표시 없는 통은 예전과 같다.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const SPECS = Object.assign({}, LEDGER_SPECS, { finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const STRUCT = { legH: 0, moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [900], areaIs2D: [true] };
const at = (o) => WR.layoutWardrobeModule(Object.assign({ W: 900, D: 590, bodyH: 2230 }, o));
/** 칸 바닥에서 선반 밑면 · 봉 중심 */
const ysOf = (L, i) => L.shelves.filter((s) => s.cell === i).map((s) => s.y - L.cells[i].y0);
const rodsOf = (L, i) => L.rods.filter((r) => r.cell === i).map((r) => r.y - L.cells[i].y0);

function run(wardrobe) {
  const modules = [{ id: 'w', section: 'wardrobe', W: 900, H: 2310, D: 590, x: 0, y: 0, areaH: 2310 }];
  const structures = { w: Object.assign({}, STRUCT, { wardrobe }) };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'wardrobe', w: 900, h: 2310, d: 620, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const spec = Asm.of({ items: [item] }, { materials, hardware });
  const mk = `0-${conv.modules[0].id}`;
  const mod = spec.items[0].modules.find((m) => m.moduleKey === mk);
  return {
    mod: conv.modules[0], spec, mk,
    shelves: materials.filter((m) => m.part === '선반').reduce((s, m) => s + m.qty, 0),
    shelfY: mod.parts.filter((p) => p.part === '선반').map((p) => p.frame.o[1]),
    rods: hardware.filter((h) => h.category === '옷봉' && h.item === '옷봉').reduce((s, h) => s + h.qty, 0),
  };
}

describe('규칙 파일', () => {
  test('normalizeBlock — cellShelfYs 는 칸마다 숫자 목록 (반올림 · 작은 것부터) 또는 null, cellRods 는 0 만 (나머지 null), 정한 칸이 없으면 싣지 않는다', () => {
    const b = WR.normalizeBlock({ preset: 'shelf22', cellShelfYs: [[600.4, 100], null, 'x', [1, 'y']], cellRods: [0, 1, null, '0'] });
    expect(b.cellShelfYs).toEqual([[100, 600], null, null, null]);
    expect(b.cellRods).toEqual([0, null, null, 0]);
    expect(Object.keys(WR.normalizeBlock({ preset: 'shelf22', cellShelfYs: [null], cellRods: [1, null] }))).not.toEqual(expect.arrayContaining(['cellShelfYs', 'cellRods']));
    expect(WR.normalizeBlock(undefined)).toEqual({ preset: null, cells: null, drawers: null, externalDrawer: null });
  });
  test('선반형 하부 칸 선반 자리 100 · 600 — 그 자리 그대로 (칸 규칙 균등 352 · 718 대신), 다른 칸 · 몸통 그대로', () => {
    const base = at({ preset: 'shelf22' });
    expect(ysOf(base, 0)).toEqual([352, 718]);
    const L = at({ preset: 'shelf22', cellShelfYs: [[100, 600], null] });
    expect(ysOf(L, 0)).toEqual([100, 600]);
    expect(ysOf(L, 1)).toEqual(ysOf(base, 1));
    expect(WR.cabinetsOf(L).map((c) => [c.y0, c.h])).toEqual(WR.cabinetsOf(base).map((c) => [c.y0, c.h]));
    expect(L.warnings).toEqual([]);
  });
  test('장수 = 목록 길이 — cellShelves 보다 먼저 (선반 하나를 정하면 그 칸 선반이 그 장수)', () => {
    const L = at({ preset: 'shelf22', cellShelves: [3, null], cellShelfYs: [[500], null] });
    expect([L.cells[0].shelves, ysOf(L, 0)]).toEqual([1, [500]]);
  });
  test('판이 겹치거나 (100 · 110 — 판 15) 칸 밖이면 (2000 > 칸 1085) 경고하고 칸 규칙 자리', () => {
    const base = at({ preset: 'shelf22' });
    [[100, 110], [100, 2000], [-5]].forEach((ys) => {
      const L = at({ preset: 'shelf22', cellShelfYs: [ys, null] });
      expect(ysOf(L, 0)).toEqual(ysOf(base, 0));
      expect(L.warnings).toEqual([expect.stringContaining('들어가지 않는다')]);
    });
    // 맞닿는 것은 된다 (빈 높이 0) — 칸 간격 최소는 붙박이장 규칙에 없다
    expect(at({ preset: 'shelf22', cellShelfYs: [[100, 115, 1070], null] }).warnings).toEqual([]);
  });
});

describe('옷봉 — 자동 (ROD_MIN_HANG) · 사람이 빼기', () => {
  test('긴옷 칸 첫 선반을 옮기면 옷봉이 따라간다 (최상단 선반 바로 아래 75) — 걸 공간 950 이상이면 그대로', () => {
    const base = at({ preset: 'longDrawer' });
    expect([ysOf(base, 0), rodsOf(base, 0)]).toEqual([[1185], [1110]]);
    const L = at({ preset: 'longDrawer', cellShelfYs: [[1400]] });
    expect([ysOf(L, 0), rodsOf(L, 0), L.cells[0].kind]).toEqual([[1400], [1325], 'rod']);
  });
  test('선반을 내려 걸 공간이 950 보다 짧아지면 옷봉을 뺀다 — 선반 자리는 정한 그대로 (칸 규칙으로 다시 셈하지 않는다), 다시 올리면 옷봉이 돌아온다', () => {
    const low = at({ preset: 'longDrawer', cellShelfYs: [[1000]] });   // 봉 925 — 바닥에서 950 미만
    expect([ysOf(low, 0), rodsOf(low, 0), low.cells[0].kind]).toEqual([[1000], [], 'shelf']);
    const two = at({ preset: 'longDrawer', cellShelfYs: [[500, 1300]] });   // 봉 1225 − 아래 선반 윗면 515 = 710
    expect([ysOf(two, 0), rodsOf(two, 0)]).toEqual([[500, 1300], []]);
    const edge = at({ preset: 'longDrawer', cellShelfYs: [[1025]] });   // 봉 950 — 최소라 건다
    expect(rodsOf(edge, 0)).toEqual([950]);
  });
  test('선반을 내려 위 빈 칸이 생기면 옷봉은 그 칸에 — 걸 수 있는 가장 위 빈 칸, 위 판 밑면 − 75 (2026-10-31 사장님 "옷봉이 설치되는 공간 1175가 충분히 나오는데")', () => {
    const L = at({ preset: 'longDrawer', cellShelfYs: [[300]] });   // 칸 1500 — 선반 위 빈 칸 1500 − 315 = 1185
    expect([ysOf(L, 0), rodsOf(L, 0), L.cells[0].kind]).toEqual([[300], [1500 - 75], 'rod']);
    expect(WR.rodGapPositions({ h: 1500, rods: 1 }, [300], { T: 15 })).toEqual([1425]);
    // 사장님 설계 그대로 — 일반서랍 2단 (외부) · 칸 1490 · 선반 300 → 빈 칸 1175, 옷봉 1415 · 걸 공간 1100
    const D = WR.layoutWardrobeModule({ preset: 'longDrawer', W: 900, D: 590, bodyH: 2220, drawers: 2, externalDrawer: true, cellShelfYs: [[300]] });
    expect([D.cells[0].h, rodsOf(D, 0)]).toEqual([1490, [1415]]);
    expect(rodsOf(D, 0)[0] - (300 + 15)).toBe(1100);
    // 위 · 가운데 칸이 다 모자라고 맨 아래가 되면 맨 아래 칸 위쪽에 (선반 둘 1100 · 1300 → 첫 선반 아래 1025)
    expect(rodsOf(at({ preset: 'longDrawer', cellShelfYs: [[1100, 1300]] }), 0)).toEqual([1025]);
    // 선반이 위에 붙은 기본 자리는 예전과 같다 (맨 위 선반 아래)
    expect(rodsOf(at({ preset: 'longDrawer', cellShelfYs: [[1185]] }), 0)).toEqual(rodsOf(at({ preset: 'longDrawer' }), 0));
    // 선반 칸에는 새로 걸지 않는다
    expect(at({ preset: 'shelf22', cellShelfYs: [[100], null] }).rods.length).toBe(0);
  });
  test('cellRods 0 — 사람이 뺀 옷봉: 긴옷은 옷봉만 빠지고 선반은 그린 자리 (1185) 그대로, 짧은옷 하부는 빈 칸, 옷봉 없는 칸은 그대로', () => {
    const L = at({ preset: 'longDrawer', cellRods: [0] });
    expect([ysOf(L, 0), rodsOf(L, 0), L.cells[0].kind]).toEqual([[1185], [], 'shelf']);
    const S = at({ preset: 'short2', cellRods: [0, null] });
    expect(S.cells.map((c) => [c.kind, c.rods])).toEqual([['open', 0], ['rod', 1]]);
    expect(at({ preset: 'shelf22', cellRods: [0, 0] }).shelves.length).toBe(4);
  });
  test('세로칸막이로 나눈 칸은 나눈 뒤 칸 차례 — 짧은옷 하부 세로칸막이 1, 오른쪽 칸 옷봉만 뺀다', () => {
    const L = at({ preset: 'short2', cellSplits: [1, null], cellRods: [null, 0, null] });
    expect(L.cells.map((c) => [c.label, c.rods])).toEqual([['하부 옷봉 1', 1], ['하부 옷봉 2', 0], ['상부 옷봉', 1]]);
  });
});

describe('배선 — 구조 → 브리지 → BOM → 조립', () => {
  test('표시 없는 통은 예전 그대로', () => {
    const r = run({ preset: 'shelf22' });
    expect(['cellShelfYs', 'cellRods'].filter((k) => k in r.mod.wardrobe)).toEqual([]);
    expect([r.shelves, r.rods]).toEqual([4, 0]);
  });
  test('선반 자리 — 브리지가 싣고, 조립 선반 높이가 그 자리 (몸통 바닥 + 칸 + y), 검사 오류 없음', () => {
    const r = run({ preset: 'shelf22', cellShelfYs: [[100, 600], null] });
    expect(r.mod.wardrobe.cellShelfYs).toEqual([[100, 600], null]);
    const L = at({ preset: 'shelf22' });
    expect(r.shelfY.slice(0, 2)).toEqual([100 + L.cells[0].y0, 600 + L.cells[0].y0]);
    expect(r.spec.unplaced.filter((u) => u.moduleKey === r.mk)).toEqual([]);
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  test('옷봉 빼기 — 브리지가 싣고, 옷봉 철물이 판재와 같이 빠진다 (짧은옷 2단 2 → 1)', () => {
    expect(run({ preset: 'short2' }).rods).toBe(2);
    const r = run({ preset: 'short2', cellRods: [0, null] });
    expect(r.mod.wardrobe.cellRods).toEqual([0, null]);
    expect(r.rods).toBe(1);
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
