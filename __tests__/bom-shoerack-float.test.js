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

  test('줄 자리(lines)가 없으면 가림판은 자리 미정 (run-part) — 걸레받이와 같다', () => {
    const ep = (spec.unplaced || []).filter((u) => /-ep$/.test(u.moduleKey)).map((u) => [u.part, u.reason]);
    expect(ep).toContainEqual(['가림판', 'run-part']);
    expect(ep).toContainEqual(['가림판(좌우)', 'run-part']);
  });
});

describe('띄움 가림판 · 좌우 가림판 — 조립 명세 자리 (2026-10-29 사장님 "아직 안 된 것 진행")', () => {
  /** 벽 하나 — 하부 l1 0 · 오픈 l2 900 · 키큰장 t1 1350, 상부 u1 0 (bom-assembly.test.js linesOf 와 같은 모양) */
  const lines = { 0: [{ key: 'wall', D: 350, modules: [
    { moduleKey: '0-l1', x0: 0 }, { moduleKey: '0-l2', x0: 900 }, { moduleKey: '0-t1', x0: 1350 }, { moduleKey: '0-u1', x0: 0 }] }] };
  const specOf = (d) => Asm.of(d, { materials: new MaterialExtractor().extract(d).materials, lines });
  const runsOf = (s, part) => s.items[0].runs.filter((r) => r.parts[0].part === part)
    .map((r) => ({ host: r.hostModuleKey, min: r.parts[0].box.min, max: r.parts[0].box.max, tags: r.parts[0].tags }));
  const epOf = (s) => (s.unplaced || []).filter((u) => /-ep$/.test(u.moduleKey)).map((u) => [u.part, u.reason]);

  test('가림판 — 바닥 줄 한 조각(키큰장까지 1800), 뒷면 = 몸통 뒷면 · 밑단 바닥(−200) · 윗단 −5', () => {
    const s = specOf(shoeDesign());
    const [c] = runsOf(s, '가림판');
    expect(runsOf(s, '가림판')).toHaveLength(1);
    expect(c.host).toBe('0-l1');
    expect([c.min[0], c.max[0]]).toEqual([-450, 1350]);
    expect([c.min[1], c.max[1]]).toEqual([-200, -5]);
    expect([c.min[2], c.max[2]]).toEqual([-175, -175 + 18]);
    expect(epOf(s).filter((e) => /가림판/.test(e[0]))).toEqual([]);
  });

  test('좌우 가림판 — 줄 양 끝 몸통 옆면 바깥, 밑단 바닥 · 높이 띄움 + 20 · 깊이 끝 마감재대로 (마감재 없음 380)', () => {
    const s = specOf(shoeDesign());
    const sides = runsOf(s, '가림판(좌우)');
    expect(sides.map((r) => [r.host, r.tags.side, r.min[0], r.max[0], r.min[1], r.max[1], r.min[2], r.max[2]])).toEqual([
      ['0-l1', 'left', -468, -450, -200, 20, -175, -175 + 380],
      ['0-t1', 'right', 225, 243, -200, 20, -175, -175 + 380],
    ]);
  });

  test('끝 마감재가 다르면 행이 갈려도 같은 끝에 — 왼쪽 쫄 310 · 오른쪽 몰딩 345', () => {
    const d = shoeDesign();
    d.items[0].modules.forEach((m, i) => { if (m.pos === 'lower') m._x = [0, 900, 1350][i]; });
    d.items[0].specs.drawnFinishes = [
      { section: 'filler', side: null, edge: 'left', area: 'lower', W: 60, partW: 60, H: 1000, D: 380, baseY: 0, x: -60 },
      { section: 'molding', side: null, edge: 'right', area: 'tall', W: 60, partW: 60, H: 2300, D: 380, baseY: 0, x: 1800 },
    ];
    const sides = runsOf(specOf(d), '가림판(좌우)');
    expect(sides.map((r) => [r.host, r.tags.side, r.tags.finish, r.max[2] - r.min[2]])).toEqual([
      ['0-t1', 'right', 'molding', 345], ['0-l1', 'left', 'filler', 310]]);
  });

  test('EP 끝은 좌우 가림판이 없다 — 남은 끝만 놓인다', () => {
    const d = shoeDesign();
    d.items[0].modules.forEach((m, i) => { if (m.pos === 'lower') m._x = [0, 900, 1350][i]; });
    d.items[0].specs.drawnFinishes = [{ section: 'ep', side: null, edge: 'left', area: 'lower', W: 20, partW: 18, H: 1000, D: 380, baseY: 0, x: -20 }];
    const sides = runsOf(specOf(d), '가림판(좌우)');
    expect(sides.map((r) => [r.host, r.tags.side])).toEqual([['0-t1', 'right']]);
  });

  test('띄움이 아니면 가림판 없이 걸레받이가 예전 자리에 (걸레받이 조각 그대로)', () => {
    const s = specOf(shoeDesign({ floatH: 0, topThickness: 0, topMaterial: undefined }));
    expect(runsOf(s, '가림판').concat(runsOf(s, '가림판(좌우)'))).toEqual([]);
    expect(runsOf(s, '걸레받이').length).toBeGreaterThan(0);
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

describe('신발장 벤치 · 키큰장 도어 전신거울 (2026-10-29 사장님)', () => {
  /** 키큰장 450 · 벤치 900 · 키큰장 450 (키큰장 사이 벤치) — 위치 _x 는 플래너 좌표 */
  function benchDesign(over, place) {
    const d = shoeDesign(over);
    const floatH = AR.floatHOf(d.items[0].specs);
    const tallH = 2300 - (floatH || 60) - 60;
    const tall = (id) => ({ id, type: 'tall', name: '키큰장', pos: 'lower', w: 450, h: tallH, d: 350, doorCount: 1, isDrawer: false, isEL: false,
      heightParts: { pedestalH: floatH ? 0 : 60, moldingH: 60 } });
    d.items[0].modules = [tall('t1'),
      { id: 'b1', type: 'storage', moduleKind: 'bench', name: '벤치', pos: 'lower', w: 900, h: 450, d: 350, doorCount: 0, isDrawer: false, isEL: false },
      tall('t2')];
    if (place) d.items[0].modules.forEach((m, i) => { m._x = [0, 450, 1350][i]; });
    return d;
  }
  const lines = { 0: [{ key: 'wall', D: 350, modules: [{ moduleKey: '0-t1', x0: 0 }, { moduleKey: '0-b1', x0: 450 }, { moduleKey: '0-t2', x0: 1350 }] }] };

  test('상수 — 앉는 면 450 · 앉는 판 18T · 목대 = 보강목 규격 · 각파이프 30 · 기본 폭 900, 거울 5T · 여백 50', () => {
    expect(X.BOM_BENCH).toEqual({ SEAT_H: 450, SEAT_T: 18, CLEAT_T: C.UPPER_BAND_T, CLEAT_W: C.UPPER_BAND_W, PIPE: 30, W: 900 });
    expect(C.BENCH_SEAT_H).toBe(450);
    expect([X.BOM_MIRROR.T, X.BOM_MIRROR.MARGIN, X.BOM_MIRROR.MATERIAL]).toEqual([5, 50, '거울']);
    expect([X.bomIsBenchModule({ moduleKind: 'bench' }), X.bomIsBenchModule({ moduleKind: 'open' }), X.bomIsBenchModule(null)]).toEqual([true, false, false]);
  });

  test('띄움 벤치 — 앉는 판 MDF 18T 900 × 380, 받침은 철제 각파이프 30 × 2 (목대 판 없음), 다리발 없음', () => {
    const d = benchDesign();
    const mats = new MaterialExtractor().extract(d).materials;
    const hw = new HardwareExtractor().extract(d).hardware;
    expect(mats.filter((m) => /^벤치/.test(m.part)).map((m) => [m.module, m.part, m.material, m.thickness, m.w, m.h, m.qty]))
      .toEqual([['벤치-900', '벤치 앉는 판', 'MDF', 18, 900, 380, 1]]);
    expect(hw.filter((h) => h.category === '벤치 받침').map((h) => [h.item, h.spec, h.qty, h.moduleKey])).toEqual([['철제 각파이프 30', '30×30 · 길이 350mm', 2, '0-b1']]);
    expect(hw.some((h) => h.category === '다리발')).toBe(false);
    mats.forEach((m) => expect(X.bomPartDefOf(m.part).fallback).toBeUndefined());
  });

  test('띄움 아닌 벤치 — 받침 목대 PB 15T × 60 × 350 두 개, 각파이프 없음, 벤치는 다리발 · 걸레받이 자리 밖', () => {
    const d = benchDesign({ floatH: 0, topThickness: 0, topMaterial: undefined });
    const mats = new MaterialExtractor().extract(d).materials;
    const hw = new HardwareExtractor().extract(d).hardware;
    expect(mats.filter((m) => m.part === '벤치 목대').map((m) => [m.material, m.thickness, m.w, m.h, m.qty])).toEqual([['PB', 15, 350, 60, 2]]);
    expect(hw.some((h) => h.category === '벤치 받침' || h.category === '다리발')).toBe(false);
    expect(mats.some((m) => m.part === '걸레받이')).toBe(false);   // 키큰장은 좌대 걸레받이 — 하부 줄 걸레받이 없음
  });

  test('띄움 줄 — 벤치 아래는 가림판이 없고, 벤치 옆 키큰장 옆면이 줄 끝이 된다 (좌우 가림판 4) — 위치가 없는 옛 도면도', () => {
    [false, true].forEach((place) => {
      const mats = new MaterialExtractor().extract(benchDesign({}, place)).materials;
      expect(mats.filter((m) => m.part === '가림판(좌우)').reduce((s, m) => s + m.qty, 0)).toBe(4);
      expect(mats.filter((m) => m.part === '가림판').reduce((s, m) => s + m.qty, 0)).toBe(2);
      expect(mats.some((m) => m.part === '상판')).toBe(false);
    });
  });

  test('조립 명세 — 앉는 판 윗면 = 바닥 ~ 450 (띄움 200 이면 몸통 바닥 자리에서 250), 목대는 앉는 판 바로 아래 양쪽 안쪽', () => {
    const run = (d) => { const s = Asm.of(d, { materials: new MaterialExtractor().extract(d).materials, lines }); return { s, m: s.items[0].modules.find((x) => x.moduleKey === '0-b1') }; };
    const fl = run(benchDesign());
    const seat = fl.m.parts.find((p) => p.part === '벤치 앉는 판');
    expect([seat.box.min[1], seat.box.max[1], seat.box.min[0], seat.box.max[0], seat.box.min[2], seat.box.max[2]]).toEqual([232, 250, -450, 450, -175, 205]);
    expect(fl.m.parts.some((p) => p.part === '벤치 목대')).toBe(false);
    const nf = run(benchDesign({ floatH: 0, topThickness: 0, topMaterial: undefined }));
    const cleats = nf.m.parts.filter((p) => p.part === '벤치 목대').map((p) => [p.tags.side, p.box.min[0], p.box.max[0], p.box.min[1], p.box.max[1], p.box.min[2], p.box.max[2]]);
    expect(cleats).toEqual([['left', -450, -435, 222, 282, -175, 175], ['right', 435, 450, 222, 282, -175, 175]]);
    [fl.s, nf.s].forEach((s) => expect((s.unplaced || []).filter((u) => u.moduleKey === '0-b1')).toEqual([]));
  });

  test('거울 — 외짝 키큰장 도어 446 × 2055 → 거울 5T 346 × 1955, 도어 앞면 가운데 (사방 50)', () => {
    const d = benchDesign();
    d.items[0].modules[0].mirror = 'single';
    const mats = new MaterialExtractor().extract(d).materials;
    const door = mats.find((m) => m.moduleKey === '0-t1' && m.part === '도어');
    const mir = mats.filter((m) => m.part === '거울');
    expect(mir.map((m) => [m.module, m.material, m.thickness, m.w, m.h, m.qty, m.edge])).toEqual([[door.module, '거울', 5, door.w - 100, door.h - 100, 1, '-']]);
    const s = Asm.of(d, { materials: mats, lines });
    const mod = s.items[0].modules.find((x) => x.moduleKey === '0-t1');
    const dp = mod.parts.find((p) => p.part === '도어'), mp = mod.parts.find((p) => p.part === '거울');
    expect([mp.box.min[0] - dp.box.min[0], dp.box.max[0] - mp.box.max[0], mp.box.min[1] - dp.box.min[1], dp.box.max[1] - mp.box.max[1]]).toEqual([50, 50, 50, 50]);
    expect([mp.box.min[2], mp.box.max[2]]).toEqual([dp.box.max[2], dp.box.max[2] + 5]);
    expect((s.unplaced || []).filter((u) => u.part === '거울')).toEqual([]);
  });

  test('거울 — 양문은 고른 짝만 (왼쪽 · 오른쪽), 짝이 안 맞으면 내지 않고 알린다', () => {
    const d = benchDesign();
    Object.assign(d.items[0].modules[2], { w: 900, doorCount: 2, mirror: 'right' });
    const r = new MaterialExtractor().extract(d);
    const door2 = r.materials.find((m) => m.moduleKey === '0-t2' && m.part === '도어');
    const mir = r.materials.filter((m) => m.part === '거울');
    expect(mir.map((m) => [m.w, m.h])).toEqual([[door2.w - 100, door2.h - 100]]);
    const s = Asm.of(d, { materials: r.materials, lines });
    const mod = s.items[0].modules.find((x) => x.moduleKey === '0-t2');
    const doors = mod.parts.filter((p) => p.part === '도어').sort((a, b) => a.box.min[0] - b.box.min[0]);
    const mp = mod.parts.find((p) => p.part === '거울');
    expect(mp.box.min[0] - doors[1].box.min[0]).toBe(50);
    const bad = benchDesign();
    bad.items[0].modules[0].mirror = 'left';   // 외짝인데 양문 짝
    const rb = new MaterialExtractor().extract(bad);
    expect(rb.materials.some((m) => m.part === '거울')).toBe(false);
    expect(rb.notices.map((n) => n.code)).toContain('mirror-door');
  });

  test('띄움 아닌 키큰장(단 짜임)에도 거울 — 도어 행에서 크기를 읽는다', () => {
    const d = benchDesign({ floatH: 0, topThickness: 0, topMaterial: undefined });
    d.items[0].modules[0].mirror = 'single';
    const mats = new MaterialExtractor().extract(d).materials;
    const door = mats.find((m) => m.moduleKey === '0-t1' && m.part === '도어');
    expect(mats.filter((m) => m.part === '거울').map((m) => [m.w, m.h])).toEqual([[door.w - 100, door.h - 100]]);
  });
});

describe('브리지 — 벤치 · 거울 표시 (2026-10-29 사장님)', () => {
  const { loadConverter } = require('../test-utils/bom-parts');
  const doors = (W, n, dir, extra) => Object.assign({
    moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir || 'left'],
    areaWidths: [W], areaIs2D: [n === 2],
  }, extra || {});
  const specs = () => Object.assign({ layoutShape: 'I', bodyThickness: 15, upperH: 720, sinkLegHeight: 150, moldingH: 60, upperDoorOverlap: 15 }, X.BOM_SHOERACK_DEFAULTS);
  const convert = (structures) => loadConverter()._convertPlannerModules({
    modules: [
      { id: 't1', section: 'tall', W: 450, H: 2300, D: 350, x: 0, y: 0 },
      { id: 'b1', section: 'lower', W: 900, H: 450, D: 350, x: 450, y: 0 },
      { id: 't2', section: 'tall', W: 900, H: 2300, D: 350, x: 1350, y: 0 },
    ],
    structures, hasStructures: true,
  }, specs());

  test('벤치 구조(s.bench)는 몸통 없는 벤치 모듈 하나 — moduleKind bench · 폭 · 깊이 · 위치만', () => {
    const conv = convert({ t1: doors(450, 1), b1: { bench: true }, t2: doors(900, 2) });
    const b = conv.modules.find((m) => m.moduleKind === 'bench');
    expect(b).toMatchObject({ id: 'planner-b1-0', pos: 'lower', w: 900, d: 350, doorCount: 0, isOpen: false, isDrawer: false, _x: 450 });
  });

  test('거울 구조(s.mirror)는 외짝 single · 양문 left/right 를 그대로, 모르는 값 · 표시 없음은 싣지 않는다', () => {
    const conv = convert({ t1: doors(450, 1, 'left', { mirror: 'single' }), b1: { bench: true }, t2: doors(900, 2, 'left', { mirror: 'right' }) });
    const of = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0);
    expect([of('t1').mirror, of('t2').mirror]).toEqual(['single', 'right']);
    const plain = convert({ t1: doors(450, 1, 'left', { mirror: 'top' }), b1: { bench: true }, t2: doors(900, 2) });
    expect(plain.modules.some((m) => 'mirror' in m)).toBe(false);
  });
});
