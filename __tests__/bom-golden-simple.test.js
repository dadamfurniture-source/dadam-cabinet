/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * B3: 단순 상자 카테고리(신발장·화장대·수납장·창고장) BOM 골든 (docs/01-plan/detail-bom-deepening.plan.md §5 B3,
 * docs/design-rules/simple-categories.md §6).
 *
 * 네 카테고리는 싱크대와 같은 범용 워크스페이스라 `extractors.js extractSimpleBox` 하나가 카테고리 상수표
 * (`BOM_SIMPLE_CATEGORY_RULES`)로 산출한다. 골든은 그 **현재 출력**의 동결이고, 값의 근거는 아래 규칙 시험과
 * simple-categories.md §6 부재표가 본다. 기존 5종 골든(sink15·sink18·sinkCorner·wardrobe·fridge)은 이 단계에서
 * 바이트 하나 안 바뀐다 — `bom-golden-addonly.test.js` 가 계속 지킨다.
 *
 * 갱신: UPDATE_GOLDEN=1 npx jest __tests__/bom-golden-simple.test.js
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const {
  loadExtractors, snapshotOf, expectGolden, MATERIAL_ROW_KEYS, HARDWARE_ROW_KEYS,
} = require('../test-utils/bom-golden/golden');
const X = require('../js/detaildesign/extractors.js');

const NAMES = ['shoerack', 'vanity', 'storage', 'warehouse'];
const LABELS = { shoerack: '신발장', vanity: '화장대', storage: '수납장', warehouse: '창고장' };

const snaps = {};
NAMES.forEach((name) => { snaps[name] = snapshotOf(designOf(FIXTURES[name])); });

const rowsOf = (snap, mod) => snap.materials.filter((m) => m.module === mod);
const partsOf = (snap, mod) => rowsOf(snap, mod).map((m) => m.part);
const rowOf = (snap, mod, part) => rowsOf(snap, mod).find((m) => m.part === part);

describe.each(NAMES)('BOM 골든 — %s', (name) => {
  const snap = snaps[name];

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden(name, snap);
  });

  test('행 형태: 자재 17필드(B0 11 + B1 6) · 철물 8필드 부분집합, 품목 라벨은 카테고리 이름', () => {
    expect(snap.materials.length).toBeGreaterThan(0);
    snap.materials.forEach((m) => expect(Object.keys(m)).toEqual(MATERIAL_ROW_KEYS));
    snap.hardware.forEach((h) => expect(HARDWARE_ROW_KEYS.filter((k) => k in h)).toEqual(Object.keys(h)));
    snap.materials.forEach((m) => expect(m.itemLabel).toBe(LABELS[name]));
    snap.hardware.forEach((h) => expect(h.itemLabel).toBe(LABELS[name]));
  });

  test('부재 이름은 전부 BOM_PART_DEFS 에 있고(폴백 없음) partId 는 유일하다', () => {
    snap.materials.forEach((m) => {
      expect(X.bomPartDefOf(m.part).fallback).toBeUndefined();
      expect(typeof m.slot).toBe('string');
      expect(m.partId).toMatch(/^0-.+-.+-\d+$/);
    });
    const ids = snap.materials.map((m) => m.partId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('싱크대 전용 부재(상판·코너 마감·개수대·쿡탑)는 없다', () => {
    const parts = new Set(snap.materials.map((m) => m.part));
    ['상판', '휠라(코너1)', '몰딩(코너1)', '휠라(코너2)', '몰딩(코너2)'].forEach((p) => expect(parts.has(p)).toBe(false));
    expect(snap.materials.some((m) => /개수대|가스대|후드/.test(m.module))).toBe(false);
  });

  test('경첩 = 자재 도어 행과 같은 수·같은 높이 (bom-protocol.md §4-1)', () => {
    const { HardwareExtractor } = loadExtractors();
    const he = new HardwareExtractor();
    const want = snap.materials
      .filter((m) => m.part === '도어')
      .reduce((sum, m) => sum + he.getHingeCount(m.h) * m.qty, 0);
    expect(snap.hardwareSummary['경첩']).toBe(want);
  });

  test('손잡이 = 자재 도어 행 수량 합 (경첩과 같은 함수 bomSimpleHingeDoorsOf)', () => {
    const doors = snap.materials.filter((m) => m.part === '도어').reduce((sum, m) => sum + m.qty, 0);
    expect(snap.hardwareSummary['손잡이']).toBe(doors);
    const specs = FIXTURES[name].specs;
    const want = FIXTURES[name].modules.reduce((sum, m) => sum + X.bomSimpleHingeDoorsOf(m, specs).count, 0);
    expect(want).toBe(doors);
  });

  test('선반 브라켓 = 자재 선반 행 수량 합 × 4', () => {
    const shelves = snap.materials.filter((m) => m.part === '선반').reduce((sum, m) => sum + m.qty, 0);
    expect(snap.hardwareSummary['브라켓'] || 0).toBe(shelves * 4);
  });

  test('다리발은 키큰장 단을 뺀 하부장만 센다 (좌대가 받친다)', () => {
    const legs = FIXTURES[name].modules
      .filter((m) => m.pos === 'lower' && m.type !== 'tall')
      .reduce((sum, m) => sum + (m.w <= 600 ? 4 : m.w <= 900 ? 6 : 8), 0);
    expect(snap.hardwareSummary['다리발']).toBe(legs);
  });

  test('레일은 서랍 개수만큼, 길이는 깊이 문턱(≤350→350 · ≤450→450 · >450→500)', () => {
    const rails = snap.hardware.filter((h) => h.category === '레일');
    const drawers = FIXTURES[name].modules.filter((m) => m.isDrawer && m.pos === 'lower');
    expect(rails.length).toBe(drawers.length);
    drawers.forEach((m, i) => {
      expect(rails[i].qty).toBe(m.drawerCount || 1);
      expect(rails[i].spec).toBe(`${X.bomSimpleRailLenOf(m.d || FIXTURES[name].d)}mm`);
    });
  });
});

describe('신발장 (shoerack) — 얕은 깊이 350 · 선반 분배 · 서랍 상자 환산', () => {
  const snap = snaps.shoerack;

  test('doorCount·shelfCount 미지정 모듈은 폴백값과 [확인 필요] 비고, 명시 모듈은 비고 없음', () => {
    const u1door = rowOf(snap, '상부장-상부장', '도어');
    expect(u1door.qty).toBe(2);                      // round(900/450)
    expect(u1door.note).toMatch(/^\[확인 필요\] simple-categories\.md 에 없음 — 붙박이장 규칙 준용/);
    const u1shelf = rowOf(snap, '상부장-상부장', '선반');
    expect(u1shelf.qty).toBe(2);                     // 705: floor(705/180)−1 = 2, 235 ≤ 350
    expect(u1shelf.note).toMatch(/신발장 선반 분배 180~350/);
    // u2 는 같은 라벨(상부장-상부장)이라 partId 로 가른다 — doorCount 1 · shelfCount 3 명시
    const u2 = snap.materials.filter((m) => m.partId.startsWith('0-u2-'));
    expect(u2.find((m) => m.part === '도어').qty).toBe(1);
    expect(u2.find((m) => m.part === '도어').note).toBe('');
    expect(u2.find((m) => m.part === '선반').qty).toBe(3);
    expect(u2.find((m) => m.part === '선반').note).toBe('');
  });

  test('하부 몸통은 깊이 350 그대로 (싱크 550 폴백을 타지 않는다), 목찬넬 −70', () => {
    expect(rowOf(snap, '하부장-하부장', '측판').w).toBe(350);
    expect(rowOf(snap, '하부장-하부장', '지판').h).toBe(350);
    expect(rowOf(snap, '하부장-하부장', '선반').h).toBe(350 - 15);
    expect(rowOf(snap, '하부장-하부장', '밴드(처짐방지)').h).toBe(708 - 30 - 70);
    expect(rowOf(snap, '하부장-하부장', '밴드(처짐방지)').qty).toBe(2); // W 900 ≥ 800
  });

  test('서랍 상자는 레일 350 으로 환산 — 측판 290 · 밑판 299, 전후판 428 ≤ 600 이라 하단보강 없음', () => {
    expect(rowOf(snap, '하부장-서랍장', '서랍측판').w).toBe(290);
    expect(rowOf(snap, '하부장-서랍장', '서랍밑판').h).toBe(299);
    expect(rowOf(snap, '하부장-서랍장', '서랍전후판').w).toBe(500 - 72);
    expect(partsOf(snap, '하부장-서랍장')).not.toContain('서랍 하단보강');
    expect(rowOf(snap, '하부장-서랍장', '서랍측판').note).toMatch(/D350 → 레일 350: 측판 290 · 밑판 299/);
    // 서랍 2 → 서랍도어 2장 (440−20)/2 = 210, 여닫이 도어 708−440−30 = 238 → 1장
    expect(rowOf(snap, '하부장-서랍장', '서랍도어')).toMatchObject({ qty: 2, h: 210, w: 496 });
    expect(rowOf(snap, '하부장-서랍장', '도어')).toMatchObject({ qty: 1, h: 238 });
    expect(partsOf(snap, '하부장-서랍장')).toContain('목찬넬');
  });

  test('오픈선반(doorCount 0 · isOpen) 은 도어 없이 명시 선반 3', () => {
    expect(partsOf(snap, '하부장-오픈선반')).not.toContain('도어');
    expect(rowOf(snap, '하부장-오픈선반', '선반').qty).toBe(3);
  });

  test('EP: 상몰딩 1500(4면) · 걸레받이 1800×145 · 목찬넬 전면·지면 · 휠라 좌·우 60×2160', () => {
    expect(partsOf(snap, 'EP')).toEqual(['상몰딩', '걸레받이', '목찬넬(전면)', '목찬넬(지면)', '휠라(좌)', '휠라(우)']);
    expect(rowOf(snap, 'EP', '상몰딩')).toMatchObject({ w: 60, h: 1500, edge: '4면' });
    expect(rowOf(snap, 'EP', '걸레받이')).toMatchObject({ w: 1800, h: 145 });
    expect(rowOf(snap, 'EP', '휠라(좌)')).toMatchObject({ w: 60, h: 2310 - 150 });
  });
});

describe('화장대 (vanity) — 18T · 찬넬(목찬넬 아님) · 우측 None', () => {
  const snap = snaps.vanity;

  test('몸통 18T: W−36 · 뒷판 (W−36)×(H−18), 도어는 18T MDF 그대로', () => {
    expect(rowOf(snap, '하부장-하부장', '지판').w).toBe(600 - 36);
    expect(rowOf(snap, '하부장-하부장', '뒷판')).toMatchObject({ w: 600 - 36, h: 708 - 18, thickness: 2.7 });
    expect(rowOf(snap, '하부장-하부장', '도어')).toMatchObject({ thickness: 18, w: 596, h: 678 });
  });

  test('목찬넬이 아니면 처짐방지 −70 없음, EP 목찬넬 없음 (서랍장 목찬넬 120 은 서랍 규칙이라 남는다)', () => {
    expect(rowOf(snap, '하부장-하부장', '밴드(처짐방지)').h).toBe(708 - 36);
    expect(partsOf(snap, 'EP')).toEqual(['상몰딩', '걸레받이', '휠라(좌)']);
    expect(partsOf(snap, '하부장-서랍장')).toContain('목찬넬');
  });

  test('서랍 3(D500 → 레일 500: 440·449 싱크와 같다) — 하단보강 있음, 여닫이 도어 없음(18 ≤ 50)', () => {
    expect(rowOf(snap, '하부장-서랍장', '서랍측판').w).toBe(440);
    expect(rowOf(snap, '하부장-서랍장', '서랍밑판').h).toBe(449);
    expect(rowOf(snap, '하부장-서랍장', '서랍 하단보강')).toMatchObject({ w: 440, h: 60, qty: 3 });
    expect(rowOf(snap, '하부장-서랍장', '서랍도어')).toMatchObject({ qty: 3, h: Math.floor((660 - 20) / 3) });
    expect(partsOf(snap, '하부장-서랍장')).not.toContain('도어');
    expect(snap.hardware.find((h) => h.category === '레일')).toMatchObject({ spec: '500mm', qty: 3 });
  });

  test('shelfCount 0 명시 → 선반 없음, 미지정 하부장 → 1 + [확인 필요](싱크 규칙)', () => {
    const u2 = snap.materials.filter((m) => m.partId.startsWith('0-u2-'));
    expect(u2.map((m) => m.part)).not.toContain('선반');
    const l2shelf = rowOf(snap, '하부장-하부장', '선반');
    expect(l2shelf.qty).toBe(1);
    expect(l2shelf.note).toMatch(/싱크대 규칙 준용 \(shelfCount 미지정 → 상부 2 · 하부 1\)/);
  });
});

describe('수납장 (storage) — 통짜 키큰장 · 깊이 400 · 서랍 1', () => {
  const snap = snaps.storage;

  test('통짜 키큰장은 sink.md §5.1 단 부재표(좌대 상자·상몰딩·목찬넬 그 단에), 선반 4 명시, 도어 H−30 ×2', () => {
    const parts = partsOf(snap, '키큰장(TL)');
    expect(parts).toEqual(expect.arrayContaining(['측판', '지판', '밴드', '뒷판', '밴드(처짐방지)', '선반', '도어', '목찬넬(전면)', '목찬넬(지면)', '상몰딩']));
    expect(rowOf(snap, '키큰장(TL)', '선반').qty).toBe(4);
    expect(rowOf(snap, '키큰장(TL)', '도어')).toMatchObject({ qty: 2, h: 2190 - 30, w: 296 });
    expect(partsOf(snap, '키큰장(TL)-좌대')).toEqual(['좌대 전후', '좌대 측', '좌대 걸레받이']);
    expect(rowOf(snap, '키큰장(TL)', '측판').w).toBe(400);
  });

  test('라인 폭은 키큰장을 뺀 1800 — 걸레받이·목찬넬, 다리발 6+6', () => {
    expect(rowOf(snap, 'EP', '걸레받이').w).toBe(1800);
    expect(rowOf(snap, 'EP', '목찬넬(전면)').h).toBe(1800);
    expect(snap.hardwareSummary['다리발']).toBe(12);
  });

  test('서랍 1(D400 → 레일 450: 390·399) — 전판 250, 여닫이 도어 458 ×2, 하단보강(828 > 600)', () => {
    expect(rowOf(snap, '하부장-서랍장', '서랍측판').w).toBe(390);
    expect(rowOf(snap, '하부장-서랍장', '서랍밑판').h).toBe(399);
    expect(rowOf(snap, '하부장-서랍장', '서랍도어')).toMatchObject({ qty: 1, h: 250, w: 896 });
    expect(rowOf(snap, '하부장-서랍장', '도어')).toMatchObject({ qty: 2, h: 708 - 220 - 30, w: 446 });
    expect(rowOf(snap, '하부장-서랍장', '서랍 하단보강')).toMatchObject({ w: 390, qty: 1 });
    expect(snap.hardware.find((h) => h.category === '레일')).toMatchObject({ spec: '450mm', qty: 1 });
  });
});

describe('창고장 (warehouse) — 플래너 3단 스택 · 몰딩(좌)·EP(우)', () => {
  const snap = snaps.warehouse;
  const tier = (label) => rowsOf(snap, label);

  test('하부단·중간단·상부단이 갈린다 — 좌대·목찬넬은 하부단, 상몰딩은 상부단, 도어 H−30 / H−4 / H−4', () => {
    expect(partsOf(snap, '키큰장(하부단)')).toEqual(expect.arrayContaining(['목찬넬(전면)', '목찬넬(지면)', '도어']));
    expect(partsOf(snap, '키큰장(하부단)-좌대')).toEqual(['좌대 전후', '좌대 측', '좌대 중간보강', '좌대 걸레받이']);
    expect(rowOf(snap, '키큰장(하부단)', '도어').h).toBe(750 - 30);
    expect(partsOf(snap, '키큰장(중간단)')).not.toContain('상몰딩');
    expect(partsOf(snap, '키큰장(중간단)')).not.toContain('목찬넬(전면)');
    expect(rowOf(snap, '키큰장(중간단)', '도어').h).toBe(780 - 4);
    expect(rowOf(snap, '키큰장(중간단)', '선반').qty).toBe(2);
    expect(partsOf(snap, '키큰장(상부단)')).toContain('상몰딩');
    expect(partsOf(snap, '키큰장(상부단)')).not.toContain('선반'); // shelfCount 0
    expect(rowOf(snap, '키큰장(상부단)', '도어').h).toBe(600 - 4);
    expect(tier('키큰장(하부단)').every((m) => m.partId.startsWith('0-planner-x-0-'))).toBe(true);
  });

  test('mod.d 없는 하부장은 품목 깊이 450 (카테고리 기본 450 과 같다), 선반 1 [확인 필요]', () => {
    expect(rowOf(snap, '하부장-하부장', '측판').w).toBe(450);
    expect(rowOf(snap, '하부장-하부장', '선반')).toMatchObject({ qty: 1, h: 450 - 15 });
    expect(rowOf(snap, '하부장-하부장', '선반').note).toMatch(/^\[확인 필요\]/);
  });

  test('EP: 몰딩(좌) 60 · EP(우) 20 · 걸레받이 1200(스택 800 제외) · 상몰딩 1200', () => {
    expect(partsOf(snap, 'EP')).toEqual(['상몰딩', '걸레받이', '목찬넬(전면)', '목찬넬(지면)', '몰딩(좌)', 'EP(우)']);
    expect(rowOf(snap, 'EP', '걸레받이').w).toBe(1200);
    expect(rowOf(snap, 'EP', 'EP(우)').w).toBe(20);
    expect(snap.hardwareSummary['다리발']).toBe(8);
  });
});

describe('규칙표·도우미 (BOM_SIMPLE_CATEGORY_RULES)', () => {
  test('categoryId 는 data-constants CATEGORIES 그대로 — shoerack·vanity·storage·warehouse, 기본 깊이 350·500·400·450', () => {
    expect(Object.keys(X.BOM_SIMPLE_CATEGORY_RULES)).toEqual(['shoerack', 'vanity', 'storage', 'warehouse']);
    expect(Object.values(X.BOM_SIMPLE_CATEGORY_RULES).map((r) => r.defaultD)).toEqual([350, 500, 400, 450]);
    expect(Object.values(X.BOM_SIMPLE_CATEGORY_RULES).map((r) => r.label)).toEqual(['신발장', '화장대', '수납장', '창고장']);
    // 플래너 프리셋 이름 'shoe' 는 품목 id 가 아니다
    expect(X.BOM_SIMPLE_CATEGORY_RULES.shoe).toBeUndefined();
  });

  test('신발장 선반 기본 개수 = planner-engine.js calcDefaultShelves(180~350) 와 같은 식', () => {
    const shoe = X.BOM_SIMPLE_CATEGORY_RULES.shoerack;
    expect(X.bomSimpleDefaultShelfCount(705, 'upper', shoe)).toBe(2);   // 235
    expect(X.bomSimpleDefaultShelfCount(708, 'lower', shoe)).toBe(2);
    expect(X.bomSimpleDefaultShelfCount(2190, 'tall', shoe)).toBe(11);  // 182.5
    expect(X.bomSimpleDefaultShelfCount(300, 'lower', shoe)).toBe(0);   // floor(300/180)−1 = 0
    expect(X.bomSimpleDefaultShelfCount(400, 'lower', shoe)).toBe(1);   // 1 → 200
    // 그 밖은 싱크 규칙
    const gen = X.BOM_SIMPLE_CATEGORY_RULES.storage;
    expect(X.bomSimpleDefaultShelfCount(705, 'upper', gen)).toBe(2);
    expect(X.bomSimpleDefaultShelfCount(708, 'lower', gen)).toBe(1);
    expect(X.bomSimpleDefaultShelfCount(2190, 'tall', gen)).toBe(1);
  });

  test('선반 수: shelfCount 숫자면 그대로(오픈이라도), 아니면 서랍·EL·오픈은 0, 그 밖은 기본', () => {
    const gen = X.BOM_SIMPLE_CATEGORY_RULES.storage;
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', h: 708, shelfCount: 3, isOpen: true }, gen)).toEqual({ qty: 3, defaulted: false });
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', h: 708, isDrawer: true }, gen)).toEqual({ qty: 0, defaulted: false });
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', h: 708, isEL: true }, gen)).toEqual({ qty: 0, defaulted: false });
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', h: 708, doorCount: 0 }, gen)).toEqual({ qty: 0, defaulted: false });
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', h: 708 }, gen)).toEqual({ qty: 1, defaulted: true });
    expect(X.bomSimpleShelfQtyOf({ pos: 'upper', h: 705 }, gen)).toEqual({ qty: 2, defaulted: true });
    expect(X.bomSimpleShelfQtyOf({ pos: 'lower', type: 'tall', h: 2190 }, gen)).toEqual({ qty: 1, defaulted: true });
  });

  test('도어 수: 숫자면 그대로(0 존중), isOpen 은 0, 아니면 round(W/450) 폴백', () => {
    expect(X.bomSimpleDoorCountOf({ doorCount: 0 }, 900)).toEqual({ count: 0, defaulted: false });
    expect(X.bomSimpleDoorCountOf({ doorCount: 1 }, 900)).toEqual({ count: 1, defaulted: false });
    expect(X.bomSimpleDoorCountOf({ isOpen: true }, 900)).toEqual({ count: 0, defaulted: false });
    expect(X.bomSimpleDoorCountOf({}, 900)).toEqual({ count: 2, defaulted: true });
    expect(X.bomSimpleDoorCountOf({}, 300)).toEqual({ count: 1, defaulted: true });
  });

  test('깊이 폴백: mod.d → item.d → 카테고리 기본, 상부는 295', () => {
    const shoe = X.BOM_SIMPLE_CATEGORY_RULES.shoerack;
    expect(X.bomSimpleDepthOf({ d: 320 }, 'lower', { d: 350 }, shoe)).toBe(320);
    expect(X.bomSimpleDepthOf({}, 'lower', { d: 380 }, shoe)).toBe(380);
    expect(X.bomSimpleDepthOf({}, 'lower', {}, shoe)).toBe(350);
    expect(X.bomSimpleDepthOf({}, 'upper', { d: 380 }, shoe)).toBe(295);
  });

  test('레일 길이 문턱 (bom-protocol.md §4-2)', () => {
    expect(X.bomSimpleRailLenOf(350)).toBe(350);
    expect(X.bomSimpleRailLenOf(400)).toBe(450);
    expect(X.bomSimpleRailLenOf(450)).toBe(450);
    expect(X.bomSimpleRailLenOf(500)).toBe(500);
  });

  test('네 카테고리를 한 설계에 넣어도 itemIdx 가 partId 를 가른다', () => {
    const { MaterialExtractor } = loadExtractors();
    const design = { items: NAMES.map((n) => JSON.parse(JSON.stringify(FIXTURES[n]))) };
    const rows = new MaterialExtractor().extract(design).materials;
    NAMES.forEach((n, i) => {
      expect(rows.filter((m) => m.itemLabel === LABELS[n]).every((m) => m.partId.startsWith(`${i}-`))).toBe(true);
    });
    expect(new Set(rows.map((m) => m.partId)).size).toBe(rows.length);
  });
});
