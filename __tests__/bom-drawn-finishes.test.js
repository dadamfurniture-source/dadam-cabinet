/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-24 사장님 D9 — 좌·우 마감재(휠라 · 몰딩 · EP)는 **도면이 정본**.
 *   A 가: 플래너에 놓은 마감재(브리지 specs.drawnFinishes) 그대로 발주한다. 스펙 finishLeft/Right 는 쓰지 않는다.
 *   B 1:  도면에 마감재가 하나도 없으면 발주하지 않고 발행 전 확인창(bom-preflight 오류)에 알린다.
 *   C:    높이는 도면 규칙 (휠라 = 옆 도어, 몰딩 · EP = 상판 아래), 하부 · 상부 따로.
 * 합성 데이터만.
 */
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const Preflight = require('../js/detaildesign/bom-preflight.js');

const SPECS = {
  layoutShape: 'I', bodyThickness: 15, lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150, topThickness: 12,
  handle: '찬넬 (목찬넬)', upperDoorOverlap: 15,
  // 스펙에는 좌우 휠라 60 이 있다 — 발주에는 쓰지 않는다
  finishLeftType: 'Filler', finishLeftWidth: 60, finishRightType: 'Filler', finishRightWidth: 60,
};
const LOWERS = [
  { id: 'planner-lower-0-0', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, shelfCount: 1 },
  { id: 'planner-lower-1-0', type: 'storage', name: '하부장', pos: 'lower', w: 1000, h: 708, d: 550, doorCount: 2, shelfCount: 1 },
];
const UPPER = { id: 'planner-upper-0-0', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 720, d: 290, doorCount: 2, shelfCount: 2 };
const fin = (section, side, o) => Object.assign({
  section, side, edge: side, area: 'lower', W: section === 'ep' ? 20 : 60, partW: section === 'ep' ? 18 : 60, x: null,
}, o);

function run(drawnFinishes, category) {
  const { MaterialExtractor } = loadExtractors();
  const specs = Object.assign({}, SPECS);
  if (drawnFinishes !== undefined) specs.drawnFinishes = drawnFinishes;
  const item = { categoryId: category || 'sink', w: 3000, h: 2310, d: 650, specs, modules: [...LOWERS, UPPER] };
  return new MaterialExtractor().extract({ appVersion: 'd9-test', items: [item] });
}
const finishRows = (rows) => rows.filter((r) => /^(휠라|몰딩|EP)\((좌|우)\)$/.test(r.part));

describe('도면 마감재 → BOM 행 (D9 가 · C)', () => {
  test('휠라 · 몰딩 = MDF 18T, 부재 폭 × 도면 높이 / EP = partW T, 깊이 × 높이 — 비고 "도면 마감재"', () => {
    const r = run([
      fin('ep', 'left', { H: 858, D: 650, baseY: 0 }),
      fin('filler', 'right', { H: 678, D: 650, baseY: 150 }),
    ]);
    expect(finishRows(r.materials).map((m) => [m.part, m.material, m.thickness, m.w, m.h, m.qty, m.edge, m.note]))
      .toEqual([['EP(좌)', 'MDF', 18, 650, 858, 1, '4면', '도면 마감재'], ['휠라(우)', 'MDF', 18, 60, 678, 1, '4면', '도면 마감재']]);
    expect(r.notices).toEqual([]);
  });

  test('상부장 옆 마감재는 따로 (area upper) — 하부와 같은 쪽이어도 행이 둘', () => {
    const r = run([fin('filler', 'left', { H: 678, D: 650, baseY: 150 }), fin('molding', 'left', { area: 'upper', H: 720, D: 290, baseY: 1590 })]);
    expect(finishRows(r.materials).map((m) => [m.part, m.w, m.h])).toEqual([['휠라(좌)', 60, 678], ['몰딩(좌)', 60, 720]]);
    expect(new Set(finishRows(r.materials).map((m) => m.partId)).size).toBe(2);
  });

  test('스펙 휠라 60 × (품목 H − 다리발) 은 더 이상 나오지 않는다', () => {
    const r = run([fin('filler', 'left', { H: 678, D: 650, baseY: 150 })]);
    expect(r.materials.some((m) => m.h === 2310 - 150 && /휠라|몰딩\(|EP\(/.test(m.part))).toBe(false);
    expect(finishRows(r.materials)).toHaveLength(1);
  });

  test('상판 폭 = 하부 폭 합 + 하부 영역 도면 마감재 공간 폭 (비움 포함, 상부 영역 마감재는 빼고)', () => {
    const r = run([
      fin('ep', 'left', { H: 858, D: 650, baseY: 0 }),
      fin('gap', 'right', { W: 15, partW: 0, H: 858, D: 650, baseY: 0 }),
      fin('molding', 'left', { area: 'upper', H: 720, D: 290, baseY: 1590 }),
    ]);
    expect(r.materials.find((m) => m.part === '상판').w).toBe(900 + 1000 + 20 + 15);
    expect(finishRows(r.materials).map((m) => m.part)).toEqual(['EP(좌)', '몰딩(좌)']);   // 비움은 판이 없다
  });

  test('단순 상자 카테고리(신발장)도 도면 마감재로', () => {
    const r = run([fin('filler', 'left', { H: 678, D: 350, baseY: 150 })], 'shoerack');
    expect(finishRows(r.materials).map((m) => [m.part, m.w, m.h])).toEqual([['휠라(좌)', 60, 678]]);
  });
});

describe('도면에 마감재가 없으면 발주하지 않고 확인창 (D9 B-1)', () => {
  test.each([['빈 목록', []], ['목록 없음 (옛 설계)', undefined]])('%s → 마감재 행 0 · 알림 finish-none', (_, list) => {
    const r = run(list);
    expect(finishRows(r.materials)).toEqual([]);
    expect(r.notices.map((n) => [n.code, n.itemIdx])).toEqual([['finish-none', 0]]);
    expect(r.notices[0].message).toMatch(/마감재를 발주하지 않습니다/);
  });

  test('쪽·부재 폭을 모르는 옛 값은 발주하지 않고 finish-unknown', () => {
    const r = run([{ section: 'molding', side: null, edge: null, area: null, W: 60, partW: null, H: 700, D: 650, baseY: null, x: 0 }]);
    expect(finishRows(r.materials)).toEqual([]);
    expect(r.notices.map((n) => n.code)).toEqual(['finish-unknown']);
  });

  test('붙박이장은 이 규칙 밖 (wardrobe.md 그대로) — 알림 없음', () => {
    const { MaterialExtractor } = loadExtractors();
    const r = new MaterialExtractor().extract({ items: [{ categoryId: 'wardrobe', w: 1200, h: 2400, d: 600, specs: {}, modules: [] }] });
    expect(r.notices).toEqual([]);
  });

  test('도어교체(도어 판만)는 마감재 알림이 없다', () => {
    expect(run([], 'door').notices).toEqual([]);
  });

  test('bom-preflight: opts.notices 는 오류로 올라가 발행 전 확인창에 뜬다 (ok = false)', () => {
    const r = run([]);
    const res = Preflight.check(r.materials, [], { notices: r.notices });
    const hit = res.issues.filter((x) => x.code === 'finish-none');
    expect(hit).toHaveLength(1);
    expect(hit[0].level).toBe('error');
    expect(res.ok).toBe(false);
    expect(Preflight.check(r.materials, []).issues.some((x) => x.code === 'finish-none')).toBe(false);
  });
});
