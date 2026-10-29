/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 신발장 띄움 시공 · 단순 상자 상판 · 신발장 상부 깊이 350 (2026-10-28 사장님 — 간편 플래너 신발장 모듈).
 *
 *   띄움 (품목 스펙 floatH > 0): 다리발 · 걸레받이 · 좌대 없음, 하부장 · 키큰장 몸통은 상부장 짜임 ("하부장도 사쿠리형으로" —
 *   사쿠리 · 천판 · 지판 · 홈 속 뒷판 · 벽 고정 보강목 2 · 도어 H + 내림), 줄 아래 가림판 (걸레받이 크기 · 몸통 뒤 맞춤),
 *   줄 좌우 가림판 (몸통 바깥 · 띄움 + 20 × 끝 마감재별 깊이 — 쫄 몸통 − 40 · 몰딩 몸통 − 5 · EP 없음 · 없음 = 몸통 + 앞 자리).
 *   상판 = 스펙에 재질이 있을 때만 (신발장 18T MDF · 화장대 12T 인조대리석), 깊이 = 몸통 + 앞 자리.
 */
const X = require('../js/detaildesign/extractors.js');
const AR = require('../js/detaildesign/assembly-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const engine = require('../js/planner/planner-engine.js');
const { loadExtractors } = require('../test-utils/bom-golden/golden');

const { MaterialExtractor, HardwareExtractor } = loadExtractors();
const C = AR.CARCASS;

/** 신발장 — 띄움 200 · 하부 바닥~윗면 1000 · 상판 18T MDF: 하부 900 2도어 · 오픈 450 · 키큰장 통도어 450 / 상부 900 (깊이 없음 → 350) */
function shoeDesign(over) {
  const specs = Object.assign({
    layoutShape: 'I', bodyThickness: 15, upperH: 720, sinkLegHeight: 150, moldingH: 60, upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)', doorColorUpper: '화이트', doorFinishUpper: '무광', doorColorLower: '화이트', doorFinishLower: '무광',
  }, X.BOM_SHOERACK_DEFAULTS, over || {});
  const top = X.bomSimpleTopTOf(specs);
  const floatH = AR.floatHOf(specs);
  const lowerH = specs.lowerH - top - (floatH || specs.sinkLegHeight);
  const tallH = 2300 - (floatH || 60) - 60;
  return {
    items: [{
      categoryId: 'shoerack', w: 2700, h: 2310, d: 350, specs,
      modules: [
        { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: lowerH, d: 350, doorCount: 2, isDrawer: false, isEL: false },
        { id: 'l2', type: 'storage', name: '오픈선반', pos: 'lower', w: 450, h: lowerH, d: 350, doorCount: 0, isOpen: true, shelfCount: 3, isDrawer: false, isEL: false },
        { id: 't1', type: 'tall', name: '키큰장', pos: 'lower', w: 450, h: tallH, d: 350, doorCount: 1, isDrawer: false, isEL: false,
          heightParts: { pedestalH: floatH ? 0 : 60, moldingH: 60 } },
        { id: 'u1', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 705, doorCount: 2, isDrawer: false, isEL: false },
      ],
    }],
  };
}

const rowsOf = (mats, mod) => mats.filter((m) => m.module === mod);
const rowOf = (mats, mod, part) => rowsOf(mats, mod).find((m) => m.part === part);

describe('신발장 기본값 · 상판 앞 자리 (2026-10-28 사장님)', () => {
  test('하부 바닥~윗면 1000 · 띄움 200 · 상판 18T MDF, 상부 깊이 350 (하부와 같다)', () => {
    expect(X.BOM_SHOERACK_DEFAULTS).toEqual({ lowerH: 1000, floatH: 200, topMaterial: 'MDF', topThickness: 18 });
    expect(X.BOM_SIMPLE_CATEGORY_RULES.shoerack.upperD).toBe(350);
    expect(X.BOM_SIMPLE_CATEGORY_RULES.vanity.upperD).toBe(295);
  });
  test('상판 앞 자리 = 플래너 배치 공간 앞 자리 (물끊기 + 도어 자리)', () => {
    expect(X.BOM_SIMPLE_TOP_FRONT).toBe(engine.MASTER_RULES.CORNER_DRIP + engine.MASTER_RULES.DOOR_SEAT_D);
  });
  test('상판 두께 0 = 없음 (예전 "|| 12" 폴백을 타지 않는다), 값이 없으면 12', () => {
    expect([X.bomSimpleTopTOf({ topThickness: 0 }), X.bomSimpleTopTOf({ topThickness: 18 }), X.bomSimpleTopTOf({})]).toEqual([0, 18, 12]);
    expect([AR.floatHOf({ floatH: 200 }), AR.floatHOf({ floatH: 0 }), AR.floatHOf({})]).toEqual([200, 0, 0]);
  });
});

describe('띄움 시공 — 자재', () => {
  const design = shoeDesign();
  const mats = new MaterialExtractor().extract(design).materials;
  const hw = new HardwareExtractor().extract(design).hardware;

  test('하부장 — 상부장 짜임: 사쿠리 측판 · 천판 · 지판 · 홈 속 뒷판 · 보강목 2 · 도어 H + 15 (몸통 = 1000 − 상판 18 − 띄움 200 = 782)', () => {
    const L = '하부장-하부장';
    expect(rowOf(mats, L, '측판')).toMatchObject({ w: 350, h: 782, qty: 2, note: 'sakuri(15→3mm)' });
    expect(rowOf(mats, L, '천판')).toMatchObject({ w: 870, h: 350 - C.SAKURI_PANEL_D_MINUS });
    expect(rowOf(mats, L, '밴드(보강목)')).toMatchObject({ thickness: C.UPPER_BAND_T, w: 870, h: C.UPPER_BAND_W, qty: 2 });
    expect(rowOf(mats, L, '도어')).toMatchObject({ w: 446, h: 782 + 15, qty: 2 });
    expect(rowOf(mats, L, '선반')).toMatchObject({ h: 350 - C.SAKURI_SHELF_D_MINUS });   // 칸 간격 150~300 (신발장)
    expect(rowsOf(mats, L).some((m) => m.part === '밴드' || /목찬넬/.test(m.part))).toBe(false);
  });

  test('오픈선반 — 사쿠리 몸통, 도어 없음, 선반은 지정 수', () => {
    const O = '하부장-오픈선반';
    expect(rowOf(mats, O, '측판').note).toBe('sakuri(15→3mm)');
    expect(rowOf(mats, O, '도어')).toBeUndefined();
    expect(rowOf(mats, O, '선반').qty).toBe(3);
  });

  test('키큰장 통도어 — 사쿠리 몸통 · 보강목 · 도어 H + 15 · 상몰딩, 좌대 없음', () => {
    const t = rowsOf(mats, '키큰장(상부단)');
    expect(t.find((m) => m.part === '측판')).toMatchObject({ h: 2300 - 200 - 60, note: 'sakuri(15→3mm)' });
    expect(t.find((m) => m.part === '밴드(보강목)').qty).toBe(2);
    expect(t.find((m) => m.part === '도어')).toMatchObject({ w: 446, h: 2040 + 15, qty: 1 });
    expect(t.some((m) => m.part === '상몰딩')).toBe(true);
    expect(mats.some((m) => /좌대/.test(m.part) || /좌대/.test(m.module))).toBe(false);
  });

  test('상부장 깊이가 없으면 350', () => {
    expect(rowOf(mats, '상부장-상부장', '측판').w).toBe(350);
  });

  test('줄 부재 — 걸레받이 · 목찬넬 대신 가림판 (띄움 − 5, 키큰장까지 한 줄) · 좌우 가림판 (끝 마감재 없음 = 띄움 + 20 × 몸통 + 30) · 상판 18T MDF (몸통 + 30)', () => {
    const ep = rowsOf(mats, 'EP');
    expect(ep.some((m) => m.part === '걸레받이' || /목찬넬/.test(m.part))).toBe(false);
    expect(ep.filter((m) => m.part === '가림판')).toEqual([expect.objectContaining({ material: 'MDF', thickness: 18, w: 1800, h: 195, qty: 1 })]);
    expect(ep.filter((m) => m.part === '가림판(좌우)')).toEqual([expect.objectContaining({ material: 'MDF', thickness: 18, w: 220, h: 380, qty: 2 })]);
    const top = mats.find((m) => m.part === '상판');
    expect(top).toMatchObject({ material: 'MDF', thickness: 18, w: 1350, h: 380, qty: 1 });
    mats.forEach((m) => expect(X.bomPartDefOf(m.part).fallback).toBeUndefined());
  });

  test('좌우 가림판 깊이는 끝 모듈 몸통 기준 — 끝이 오픈장 상자(걷어 낸 모듈)여도', () => {
    const d = shoeDesign();
    d.items[0].modules = [
      { id: 'o1', type: 'storage', name: '오픈장', pos: 'lower', w: 450, h: 782, d: 340, moduleKind: 'open', isOpen: true, doorCount: 0, isDrawer: false, isEL: false },
      { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 782, d: 350, doorCount: 2, isDrawer: false, isEL: false },
    ];
    const ep = new MaterialExtractor().extract(d).materials.filter((m) => m.part === '가림판(좌우)');
    expect(ep.map((m) => [m.h, m.qty]).sort()).toEqual([[370, 1], [380, 1]]);
  });

  /** 도면 마감재가 있는 신발장 — 모듈 위치 _x (플래너 좌표): 하부장 0~900 · 오픈 900~1350 · 키큰장 1350~1800 */
  function withFinishes(fins) {
    const d = shoeDesign();
    d.items[0].modules.forEach((m, i) => { if (m.pos === 'lower') m._x = [0, 900, 1350][i]; });
    d.items[0].specs.drawnFinishes = fins;
    return new MaterialExtractor().extract(d).materials.filter((m) => m.part === '가림판(좌우)').map((m) => [m.w, m.h, m.qty]).sort();
  }
  const fin = (section, x, W, area, edge) => ({ section, x, W, area, edge, side: null, partW: section === 'ep' ? 18 : 60, H: 1000, D: 380, baseY: 0 });

  test('끝 마감재별 깊이 (2026-10-28 · 29 사장님) — 쫄 몸통 − 40 (여유 5) · 몰딩 몸통 − 5, 높이 띄움 + 20', () => {
    expect(withFinishes([fin('filler', -60, 60, 'lower', 'left'), fin('molding', 1800, 60, 'tall', 'right')])).toEqual([[220, 310, 1], [220, 345, 1]]);
    expect(withFinishes([fin('filler', -60, 60, 'lower', 'left'), fin('filler', 1800, 60, 'tall', 'right')])).toEqual([[220, 310, 2]]);
  });

  test('EP 끝은 좌우 가림판 없음 (EP 가 바닥까지), 비움 · 마감재 없음 = 배치 공간 깊이 (몸통 + 30)', () => {
    expect(withFinishes([fin('ep', -18, 18, 'lower', 'left'), fin('gap', 1800, 30, 'tall', 'right')])).toEqual([[220, 380, 1]]);
    expect(withFinishes([fin('ep', -18, 18, 'lower', 'left'), fin('ep', 1800, 18, 'tall', 'right')])).toEqual([]);
  });

  test('상부 마감재 · 끝에서 떨어진 마감재는 바닥 줄 끝 마감재가 아니다', () => {
    expect(withFinishes([fin('filler', -60, 60, 'upper', 'left'), fin('molding', 2000, 60, 'lower', null)])).toEqual([[220, 380, 2]]);
  });

  test('모듈 위치가 없는 옛 도면은 배치 공간 끝(edge)으로 짝짓는다', () => {
    const d = shoeDesign();
    d.items[0].specs.drawnFinishes = [{ section: 'filler', side: null, edge: 'left', area: 'lower', W: null, partW: 60, H: 1000, D: null, baseY: 0, x: null }];
    const rows = new MaterialExtractor().extract(d).materials.filter((m) => m.part === '가림판(좌우)').map((m) => [m.h, m.qty]).sort();
    expect(rows).toEqual([[310, 1], [380, 1]]);
  });

  test('깊이 도우미 — 상수와 같다', () => {
    expect(C.FLOAT_SIDE_D_MINUS).toEqual({ filler: 40, molding: 5 });
    expect([X.bomFloatSideDepthOf('filler', 350), X.bomFloatSideDepthOf('molding', 350), X.bomFloatSideDepthOf('ep', 350), X.bomFloatSideDepthOf(null, 350), X.bomFloatSideDepthOf('gap', 350)])
      .toEqual([310, 345, 0, 380, 380]);
  });

  test('철물 — 다리발 없음, 키큰장 도어 경첩은 도어 높이(2055)로', () => {
    expect(hw.some((h) => h.category === '다리발')).toBe(false);
    const hinge = hw.filter((h) => /경첩/.test(h.category || ''));
    expect(hinge.length).toBeGreaterThan(0);
    expect(X.bomSimpleHingeDoorsOf(design.items[0].modules[2], design.items[0].specs)).toEqual({ count: 1, doorH: 2055 });
    expect(X.bomSimpleHingeDoorsOf(design.items[0].modules[0], design.items[0].specs)).toEqual({ count: 2, doorH: 797 });
  });
});

describe('띄움 시공 — 조립 명세', () => {
  const design = shoeDesign();
  const materials = new MaterialExtractor().extract(design).materials;
  const spec = Asm.of(design, { materials });
  const mods = spec.items[0].modules;
  const byKey = (k) => mods.find((m) => m.moduleKey === k);

  test('하부장 · 키큰장 몸통 부재는 다 놓인다 (보강목은 홈 뒤, 도어는 몸통 밑으로 15)', () => {
    ['0-l1', '0-t1'].forEach((k) => {
      const unplaced = (spec.unplaced || []).filter((u) => u.moduleKey === k && !/shelf/.test(u.reason));
      expect(unplaced).toEqual([]);
    });
    const door = byKey('0-l1').parts.find((p) => p.part === '도어');
    expect(door.frame.o[1]).toBe(-15);
    const band = byKey('0-l1').parts.filter((p) => p.part === '밴드(보강목)');
    expect(band.map((p) => p.tags && p.tags.mount)).toEqual(['behind-groove', 'behind-groove']);
  });

  test('다리발 철물 자리가 없다', () => {
    mods.forEach((m) => expect((m.hardware || []).some((h) => h.kind === 'leg')).toBe(false));
  });
});

describe('띄움이 아니면 예전 그대로 — 다리발 · 걸레받이, 하부장 짜임', () => {
  const design = shoeDesign({ floatH: 0, topThickness: 0, topMaterial: undefined });
  const mats = new MaterialExtractor().extract(design).materials;
  const hw = new HardwareExtractor().extract(design).hardware;
  test('하부장 측판은 사쿠리가 아니고 밴드 2 · 걸레받이 · 다리발 · 좌대가 있다, 상판 없음', () => {
    expect(rowOf(mats, '하부장-하부장', '측판').note).not.toMatch(/sakuri/);
    expect(rowOf(mats, '하부장-하부장', '측판').h).toBe(1000 - 0 - 150);
    expect(mats.some((m) => m.part === '걸레받이')).toBe(true);
    expect(mats.some((m) => m.part === '좌대 전후')).toBe(true);
    expect(mats.some((m) => m.part === '가림판' || m.part === '상판')).toBe(false);
    expect(hw.some((h) => h.category === '다리발')).toBe(true);
  });
});

describe('화장대 상판 — 스펙에 재질이 있으면 (2026-10-28 사장님 기본 12T 인조대리석)', () => {
  test('인조대리석 12T · 깊이 몸통 500 + 30', () => {
    const d = shoeDesign({ floatH: 0, topMaterial: '인조대리석', topThickness: 12, lowerH: 870 });
    d.items[0].categoryId = 'vanity';
    d.items[0].modules.forEach((m) => { if (m.pos === 'lower') m.d = 500; });
    const top = new MaterialExtractor().extract(d).materials.find((m) => m.part === '상판');
    expect(top).toMatchObject({ material: '인조대리석', thickness: 12, w: 1350, h: 530 });
  });
});
