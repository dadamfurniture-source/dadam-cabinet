/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 붙박이장 통 — 칸마다 선반 수 (2026-10-30 사장님 간편 플래너 「칸마다 바꾸기」, bom-wardrobe-rules.js cellShelves).
 *
 *   몸통 구조(기본형 stack — 짧은옷 2단은 하부장 · 상부장 두 몸통)는 그대로 두고 칸의 선반 수만 바꾼다.
 *   사용자 칸(cells)은 몸통을 하나로 합치므로 쓰지 않는다. 선반 자리는 칸 규칙 shelfPositions 그대로.
 *   구조 s.wardrobe.cellShelves → 브리지 mod.wardrobe.cellShelves → BOM(extractWardrobe) · 조립(wardrobeOf). 표시 없는 통은 예전과 같다.
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
const IR = require('../js/detaildesign/bom-interior-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const SPECS = Object.assign({}, LEDGER_SPECS, { finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const STRUCT = { legH: 0, moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [900], areaIs2D: [true] };

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
  return { conv, mod: conv.modules[0], materials, hardware, spec, mk, shelves: materials.filter((m) => m.part === '선반').reduce((s, m) => s + m.qty, 0) };
}

describe('규칙 파일', () => {
  test('normalizeBlock — 칸마다 0~12 정수 또는 null, 바꾼 칸이 없으면 싣지 않는다', () => {
    expect(WR.normalizeBlock({ preset: 'short2', cellShelves: [2, null, 99, -1, 'x'] }).cellShelves).toEqual([2, null, 12, 0, null]);
    expect('cellShelves' in WR.normalizeBlock({ preset: 'short2', cellShelves: [null, null] })).toBe(false);
    expect(WR.normalizeBlock(undefined)).toEqual({ preset: null, cells: null, drawers: null, externalDrawer: null });
  });
  test('짧은옷 2단 하부 칸 선반 2 — 몸통 둘 그대로, 옷봉 걸 공간이 950 보다 짧아 그 칸 옷봉을 빼고 선반 칸 (선반 = 일반 규칙 균등) (2026-10-30 사장님)', () => {
    const base = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230 });
    const L = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, cellShelves: [2, null] });
    expect(WR.cabinetsOf(L).length).toBe(WR.cabinetsOf(base).length);
    expect(L.cells.map((c) => [c.kind, c.shelves, c.rods])).toEqual([['shelf', 2, 0], ['rod', 0, 1]]);
    expect(L.rods.map((r) => r.cell)).toEqual([1]);   // 상부 칸 옷봉은 그대로 (바꾸지 않은 칸)
    const c = L.cells[0];
    const ys = L.shelves.filter((s) => s.cell === 0).map((s) => s.y - c.y0);
    expect(ys).toEqual(WR.shelfPositions({ h: c.h, shelves: 2, rods: 0 }, { T: 15 }));
    expect(IR.wardrobeShelfErrorsOf(L, [2, null])).toEqual([]);
  });
  test('옷봉 걸 공간 (봉 중심 ~ 아래 판) 이 ROD_MIN_HANG 950 이상이면 옷봉은 그대로 — 긴옷 칸 선반 1 (기본) 은 그대로, 2 면 아래 선반까지 950 보다 짧아 뺀다', () => {
    expect(WR.WARDROBE_RULES.ROD_MIN_HANG).toBe(950);
    const keep = WR.layoutWardrobeModule({ preset: 'longDrawer', W: 900, D: 590, bodyH: 2230, cellShelves: [1] });
    const c = keep.cells[0];
    expect(keep.rods.length).toBe(1);
    expect(keep.rods[0].y - c.y0).toBeGreaterThan(950);
    const drop = WR.layoutWardrobeModule({ preset: 'longDrawer', W: 900, D: 590, bodyH: 2230, cellShelves: [2] });
    expect([drop.rods.length, drop.cells[0].kind]).toEqual([0, 'shelf']);
  });
  test('최소 950 — 걸 공간이 꼭 950 이면 옷봉을 걸고, 949 면 뺀다 (긴옷 + 속서랍 1: 칸 = 몸통 − 30 − 350, 옷봉 = 칸 − 315 − 75)', () => {
    const at = (bodyH) => WR.layoutWardrobeModule({ preset: 'longDrawer', W: 900, D: 590, bodyH, drawers: 1, externalDrawer: false });
    const ok = at(1720);
    expect(ok.rods.length).toBe(1);
    expect(ok.rods[0].y - ok.cells[0].y0).toBe(950);
    expect([at(1719).rods.length, at(1719).cells[0].kind]).toEqual([0, 'shelf']);
  });
  test('서랍을 바꾸면 그 서랍이 닿는 칸도 본다 — 짧은옷 2단에 속서랍 1 (맨 아래 캐비닛) · 외부 서랍 1 (캐비닛이 줄어 모든 칸), 바꾸지 않은 기본형은 높이가 낮아도 그대로', () => {
    const inner = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, drawers: 1, externalDrawer: false });
    expect(inner.cells.map((c) => c.rods)).toEqual([0, 1]);
    const ext = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, drawers: 1, externalDrawer: true });
    expect(ext.cells.map((c) => c.rods)).toEqual([0, 0]);
    expect(WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2120 }).rods.length).toBe(2);
  });
  test('세로칸막이 (cellSplits) — 짧은옷 2단 하부 칸 세로칸막이 1: 900 통 내경 870 → (870 − 15) / 2 = 427 · 428, 칸마다 짧은 옷봉, 세로칸막이 1장 (그 칸 높이) (2026-10-30 사장님)', () => {
    const base = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230 });
    const L = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, cellSplits: [1, null] });
    expect(WR.cabinetsOf(L).map((c) => [c.y0, c.h])).toEqual(WR.cabinetsOf(base).map((c) => [c.y0, c.h]));   // 몸통 그대로
    expect(L.cells.map((c) => [c.label, c.kind, c.x0, c.w, c.rods, c.sub])).toEqual([
      ['하부 옷봉 1', 'rod', 0, 427, 1, 0], ['하부 옷봉 2', 'rod', 442, 428, 1, 1], ['상부 옷봉', 'rod', 0, 870, 1, undefined],
    ]);
    expect(L.rods.map((r) => [r.cell, r.length])).toEqual([[0, 422], [1, 423], [2, 865]]);
    expect(L.dividers.map((d) => [d.part, d.axis, d.x, d.h, d.cutW])).toEqual([['세로칸막이', 'v', 427, base.cells[0].h, 590 - 18]]);
    expect(L.warnings).toEqual([]);
  });
  test('세로칸막이 뒤 cellShelves 는 나눈 뒤 칸 차례 — 왼쪽 선반 3 (옷봉 걸 공간이 모자라 엔진이 옷봉을 뺀다) · 오른쪽 옷봉 그대로', () => {
    const L = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, cellSplits: [1, null], cellShelves: [3, null, null] });
    expect(L.cells.map((c) => [c.kind, c.shelves, c.rods])).toEqual([['shelf', 3, 0], ['rod', 0, 1], ['rod', 0, 1]]);
    expect(L.shelves.filter((s) => s.cell === 0).map((s) => s.cutW)).toEqual([427, 427, 427]);
    expect(IR.wardrobeShelfErrorsOf(L, [3, null, null])).toEqual([]);
  });
  test('세로칸막이 — 반 분할 왼쪽 칸 1장은 427 → 206 · 206 (기존 가운데 칸막이 그대로 + 1장), 2장은 132 라 최소 200 미만 — 나누지 않고 경고', () => {
    const L = WR.layoutWardrobeModule({ preset: 'halfSplit', W: 900, D: 590, bodyH: 2230, cellSplits: [1, null] });
    expect(L.cells.map((c) => [c.label, c.x0, c.w])).toEqual([['좌 1', 0, 206], ['좌 2', 221, 206], ['우', 442, 427]]);
    expect(L.dividers.map((d) => d.x)).toEqual([206, 427]);
    const N = WR.layoutWardrobeModule({ preset: 'halfSplit', W: 900, D: 590, bodyH: 2230, cellSplits: [2, null] });
    expect(N.cells.length).toBe(2);
    expect(N.warnings).toEqual([expect.stringContaining('최소 200 미만')]);
  });
  test('normalizeBlock — cellSplits 칸마다 0~12 정수 (0 은 그대로 = null), 나눈 칸이 없으면 싣지 않는다', () => {
    expect(WR.normalizeBlock({ preset: 'short2', cellSplits: [1, 0, null, 99, 'x'] }).cellSplits).toEqual([1, null, null, 12, null]);
    expect('cellSplits' in WR.normalizeBlock({ preset: 'short2', cellSplits: [0, null] })).toBe(false);
  });
  test('칸 간격 최소는 두지 않는다 — 사장님 기본형 4번 통 하부 선반 3단이 이미 260 간격 (300 은 붙박이장 규칙이 아니다)', () => {
    const L = WR.layoutWardrobeModule({ preset: 'rodTopSplitBottom', W: 900, D: 590, bodyH: 2230 });
    const c = L.cells[0];
    expect([c.label, c.shelves]).toEqual(['하부 선반', 3]);
    expect(Math.floor((c.h - 3 * 15) / 4)).toBe(260);
    expect(IR.wardrobeShelfErrorsOf(L, [3])).toEqual([]);
  });
  test('낮은 옷봉 칸에 선반 — 옷봉을 빼서 선반 칸이 되므로 들어간다 (예전엔 첫 선반 자리가 없어 막았다)', () => {
    const L = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 600, cellShelves: [1] });
    expect(L.cells[0].h).toBeLessThan(WR.WARDROBE_RULES.LONG_FIRST_SHELF);
    expect([L.cells[0].rods, L.shelves.filter((s) => s.cell === 0).length]).toEqual([0, 1]);
    expect(IR.wardrobeShelfErrorsOf(L, [1])).toEqual([]);
    // 최소 간격이 없어 12장도 칸 안에 들어가면 받는다 — [확인 필요] 붙박이장 칸 선반 간격 최소
    const L12 = WR.layoutWardrobeModule({ preset: 'short2', W: 900, D: 590, bodyH: 2230, cellShelves: [12] });
    expect(IR.wardrobeShelfErrorsOf(L12, [12])).toEqual([]);
  });
});

/** 옷봉 파이프 철물 길이 (작은 것부터, 장수만큼) */
const rodLens = (r) => r.hardware.filter((h) => h.category === '옷봉' && h.item === '옷봉')
  .flatMap((h) => Array(h.qty).fill(h.spec.match(/(\d+)mm/)[1])).sort();

describe('배선 — 구조 → 브리지 → BOM → 조립', () => {
  test('표시 없는 통은 예전 그대로 (짧은옷 2단 선반 0)', () => {
    const r = run({ preset: 'short2' });
    expect('cellShelves' in r.mod.wardrobe).toBe(false);
    expect(r.shelves).toBe(0);
  });
  test('하부 칸 선반 2 · 상부 칸 선반 1 — 브리지가 싣고, BOM 선반 3장 · 몸통 둘 그대로, 조립에 선반 3 · 검사 오류 없음', () => {
    const base = run({ preset: 'short2' });
    const r = run({ preset: 'short2', cellShelves: [2, 1] });
    expect(r.mod.wardrobe.cellShelves).toEqual([2, 1]);
    expect([r.mod.shelfCountLower, r.mod.shelfCountUpper, r.mod.isDivided]).toEqual([2, 1, true]);
    expect(r.shelves).toBe(3);
    const parts = (m) => m.materials.filter((x) => x.part !== '선반').map((x) => [x.part, x.w, x.h, x.qty]);
    expect(parts(r)).toEqual(parts(base));   // 선반 말고는 같다 (몸통 둘 · 칸막이 · 옷봉)
    const mod = r.spec.items[0].modules.find((m) => m.moduleKey === r.mk);
    expect(mod.parts.filter((p) => p.part === '선반').length).toBe(3);
    expect(r.spec.unplaced.filter((u) => u.moduleKey === r.mk)).toEqual([]);
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  test('세로칸막이 — 짧은옷 2단 하부 칸 세로칸막이 1: 브리지가 싣고, BOM 세로칸막이 1장 · 옷봉 422 · 423 · 865, 몸통 그대로, 조립 검사 오류 없음', () => {
    const base = run({ preset: 'short2' });
    const r = run({ preset: 'short2', cellSplits: [1, null] });
    expect(r.mod.wardrobe.cellSplits).toEqual([1, null]);
    const div = r.materials.filter((m) => m.part === '세로칸막이');
    expect(div.reduce((s, m) => s + m.qty, 0)).toBe(1);
    const body = (m) => m.materials.filter((x) => x.part !== '세로칸막이').map((x) => [x.part, x.w, x.h, x.qty]);
    expect(body(r)).toEqual(body(base));   // 칸막이 말고는 같다 (몸통 둘 · 선반 없음)
    expect(rodLens(r)).toEqual(['422', '423', '865']);
    expect(r.spec.unplaced.filter((u) => u.moduleKey === r.mk)).toEqual([]);
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  test('옷봉 철물은 판재와 같은 배치 — 짧은옷 2단 속서랍 1 (내부) 은 하부 옷봉만 빠지고 상부 865 하나 (철물 쪽이 서랍 종류를 안 넘겨 외부로 셈하던 자리)', () => {
    expect(rodLens(run({ preset: 'short2', drawers: 1, externalDrawer: false }))).toEqual(['865']);
    expect(rodLens(run({ preset: 'short2', drawers: 1, externalDrawer: true }))).toEqual([]);
  });
  test('선반형 칸 선반 0 — 그 칸 선반이 빠진다', () => {
    expect(run({ preset: 'shelf22' }).shelves).toBe(4);
    expect(run({ preset: 'shelf22', cellShelves: [0, null] }).shelves).toBe(2);
  });
});
