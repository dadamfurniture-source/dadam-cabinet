/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect */
/**
 * 키큰장 단 모듈 · 두 단 — 2026-11-04 사장님 「개별 모듈 형태도 추가 … 하부장을 포함한 중간장, 상부장 형태의 수납장」 ·
 *   「키큰장 가운데 단 모양인데, 천판, 지판을 포함하여 결합되는 모듈」 · 두 단 높이 「위 단이 가져감」 (sink.md §5.1).
 *
 *   planner-engine.js tallTierSplitOf — 세 단은 mockup-structure tallTiers(보존 없음)와 같은 식, 두 단은 아래 단 = 세 단 높이 · 위 단 = 나머지.
 *   단 하나만 따로 (가운데 단 · 폭 450 · 2도어 900) 도 엔진 BOM 이 같은 단 규칙(천판 + 지판 · 도어 W/doorCount − 4)으로 짓는다.
 */
global.dlog = global.dlog || (() => {});
const engine = require('../js/planner/planner-engine.js');
const { MaterialExtractor, HardwareExtractor } = require('../js/detaildesign/extractors.js');

const MR = engine.MASTER_RULES;
const O = { moldingH: 60, pedestalH: 60 };
const brief = (tiers) => tiers.map((t) => [t.part, t.H, t.baseY, t.pedestalH, t.moldingH]);

describe('tallTierSplitOf — 세 단', () => {
  test('천장 2300 · 상몰딩 60 · 좌대 60 → 하부 861 · 중간 979 · 상부 460, 빈틈 없이 쌓고 좌대는 맨 아래 · 상몰딩은 맨 위', () => {
    expect(brief(engine.tallTierSplitOf(2300, O))).toEqual([
      ['하부장', 861, 0, 60, 0], ['중간장', 979, 861, 0, 0], ['상부장', 460, 1840, 0, 60],
    ]);
  });

  test('mockup-structure tallTiers 와 같은 식 — 상부장 = FRIDGE_UPPER_H_MAX + 상몰딩, 중간장 = floor(몸통 × MIDDLE_BODY_RATIO)', () => {
    [2100, 2300, 2400, 2550].forEach((H) => {
      const t = engine.tallTierSplitOf(H, O);
      const body = H - (MR.FRIDGE_UPPER_H_MAX + 60) - 60;
      expect(t[2].H).toBe(MR.FRIDGE_UPPER_H_MAX + 60);
      expect(t[1].H).toBe(Math.floor(body * MR.MIDDLE_BODY_RATIO));
      expect(t[0].H + t[1].H + t[2].H).toBe(H);
    });
  });

  test('몸통이 나오지 않으면 아무 단도 세우지 않는다', () => {
    expect(engine.tallTierSplitOf(MR.FRIDGE_UPPER_H_MAX + 60 + 60, O)).toEqual([]);
    expect(engine.tallTierSplitOf(0, O)).toEqual([]);
  });
});

describe('tallTierSplitOf — 두 단은 위 단이 가져간다 (2026-11-04 사장님)', () => {
  test('하부장 + 상부장 → 861 · 1439, 하부장은 세 단 높이 그대로', () => {
    expect(brief(engine.tallTierSplitOf(2300, Object.assign({ parts: ['하부장', '상부장'] }, O)))).toEqual([
      ['하부장', 861, 0, 60, 0], ['상부장', 1439, 861, 0, 60],
    ]);
  });

  test('하부장 + 중간장 → 중간장이 맨 위 단이라 상몰딩을 진다', () => {
    expect(brief(engine.tallTierSplitOf(2300, Object.assign({ parts: ['하부장', '중간장'] }, O)))).toEqual([
      ['하부장', 861, 0, 60, 0], ['중간장', 1439, 861, 0, 60],
    ]);
  });

  test('하부장이 없거나 차례가 틀리거나 한 단이면 받지 않는다', () => {
    [['중간장', '상부장'], ['하부장'], ['하부장', '상부장', '중간장'], ['하부장', '하부장'], ['하부장', '옆장']].forEach((parts) => {
      expect(() => engine.tallTierSplitOf(2300, Object.assign({ parts }, O))).toThrow(/하부장부터 2~3 단/);
    });
  });
});

describe('단 하나만 따로 — 엔진 BOM 이 같은 단 규칙으로 짓는다', () => {
  const SPECS = {
    layoutShape: 'I', topThickness: 12, bodyThickness: 15, lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150,
    handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0,
    upperDoorOverlap: 15, wardrobePedestal: 60,
  };
  const middle = (w, doorCount) => ({
    id: 'planner-tall-0-0', type: 'tall', name: '키큰장', pos: 'lower', w, h: 979, totalH: 979, d: 620,
    heightParts: { pedestalH: 0, moldingH: 0 }, doorCount, shelfCount: 0, isDrawer: false, isEL: false, isOpen: false, hingeSide: 'left',
  });
  const run = (m) => {
    const design = { items: [{ categoryId: 'sink', w: m.w, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules: [m] }] };
    return { materials: new MaterialExtractor().extract(design).materials, hardware: new HardwareExtractor().extract(design).hardware };
  };

  test.each([[450, 1], [600, 1], [900, 2]])('가운데 단 폭 %i · 도어 %i장 — 천판 + 지판, 도어 폭 W/doorCount − 4, 높이 H − 4 (푸쉬)', (w, n) => {
    const r = run(middle(w, n));
    const parts = r.materials.map((m) => m.part);
    expect(parts).toEqual(expect.arrayContaining(['측판', '지판', '천판', '뒷판', '도어']));
    expect(parts).not.toContain('밴드');
    expect(parts.some((p) => /좌대|상몰딩/.test(p))).toBe(false);
    const door = r.materials.find((m) => m.part === '도어');
    expect([door.w, door.h, door.qty]).toEqual([w / n - 4, 979 - 4, n]);
    expect(r.hardware.filter((h) => h.category === '경첩').reduce((s, h) => s + h.qty, 0)).toBeGreaterThan(0);
  });
});
