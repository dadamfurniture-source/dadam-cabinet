/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-13 거래명세서 확인표 → 사장님 결정 (hardware.md §1·§2).
 *   경첩      실제로 사는 H052W 105° 저압 — 15T 몸통 H052W-5, 18T 몸통 H052W-3
 *   리프트업  경첩 대신 가변철물 小(23KG) 1 SET/도어 (폭 450~600)
 *   슬라이딩  경첩 대신 SDR-2 상·하레일 2500 1조/모듈 + 상·하부속 도어당 2
 *   레일      간단 카테고리도 싱크와 같은 "깊이 − 50 이하 최대" — 550 은 산 적이 없어 500 이 끝
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const { loadExtractors } = require('../test-utils/bom-golden/golden');

const { HardwareExtractor } = loadExtractors();
const hardwareOf = (fixture) => new HardwareExtractor().extract(designOf(fixture)).hardware;

function fridgeWith(doorType, w = 600, doorCount = 1) {
  const f = JSON.parse(JSON.stringify(FIXTURES.fridge));
  f.modules = f.modules.filter((m) => m.type === 'tall');
  Object.assign(f.modules[0], { doorType, w, doorCount });
  return f;
}

describe('경첩 품번 — 몸통 두께로 갈린다', () => {
  test('15T 몸통은 H052W-5 105도 저압', () => {
    const hinges = hardwareOf(FIXTURES.sink15).filter((h) => h.category === '경첩');
    expect(hinges.length).toBeGreaterThan(0);
    hinges.forEach((h) => expect(h.item).toBe('H052W-5 105도 저압 경첩'));
  });

  test('18T 몸통은 H052W-3', () => {
    const hinges = hardwareOf(FIXTURES.sink18).filter((h) => h.category === '경첩');
    expect(hinges.length).toBeGreaterThan(0);
    hinges.forEach((h) => expect(h.item).toBe('H052W-3 105도 저압 경첩'));
  });
});

describe('여닫이가 아닌 냉장고장 도어', () => {
  test('리프트업은 경첩 없이 가변철물 1 SET/도어', () => {
    const hw = hardwareOf(fridgeWith('liftup', 600, 1));
    expect(hw.filter((h) => h.category === '경첩')).toEqual([]);
    const lift = hw.filter((h) => h.category === '리프트업');
    expect(lift).toHaveLength(1);
    expect(lift[0]).toMatchObject({ item: '리프트업도어 가변철물 小(23KG)', qty: 1, unit: 'SET' });
    expect(lift[0].note).not.toMatch(/확인 필요/);
  });

  test('리프트업 도어 폭이 450~600 밖이면 비고에 남긴다', () => {
    const lift = hardwareOf(fridgeWith('liftup', 900, 1)).find((h) => h.category === '리프트업');
    expect(lift.note).toMatch(/도어 폭 900 — 450~600 밖/);
  });

  test('슬라이딩은 경첩 없이 레일 1조 + 상·하부속 도어당 2', () => {
    const hw = hardwareOf(fridgeWith('sliding', 900, 2));
    expect(hw.filter((h) => h.category === '경첩')).toEqual([]);
    const s = Object.fromEntries(hw.filter((h) => h.category === '슬라이딩').map((h) => [h.item, h.qty]));
    expect(s).toEqual({ 'SDR-2 상·하레일': 1, 'SDR-2 상부속': 4, 'SDR-2 하부속': 4 });
  });

  test('fridge.md 의 옛 표기 lift·slide 도 같다', () => {
    expect(hardwareOf(fridgeWith('lift')).some((h) => h.category === '리프트업')).toBe(true);
    expect(hardwareOf(fridgeWith('slide', 900, 2)).some((h) => h.category === '슬라이딩')).toBe(true);
  });

  test('여닫이·플랩은 예전처럼 경첩', () => {
    ['swing', 'flap'].forEach((t) => {
      const hw = hardwareOf(fridgeWith(t));
      expect(hw.some((h) => h.category === '경첩')).toBe(true);
      expect(hw.some((h) => h.category === '리프트업' || h.category === '슬라이딩')).toBe(false);
    });
  });
});

describe('간단 카테고리 레일 길이 — 싱크와 같은 "깊이 − 50 이하 최대" (bom-protocol.md §4-2)', () => {
  const railOf = (fixture, d) => {
    const f = JSON.parse(JSON.stringify(fixture));
    f.modules.forEach((m) => { if (m.isDrawer) m.d = d; });
    return hardwareOf(f).filter((h) => h.category === '레일').map((h) => h.spec);
  };
  const withDrawer = FIXTURES.storage.modules.some((m) => m.isDrawer) ? FIXTURES.storage
    : [FIXTURES.vanity, FIXTURES.warehouse, FIXTURES.shoerack].find((f) => f.modules.some((m) => m.isDrawer));

  // 550 레일은 사지 않는다 — 깊이 620 도 500
  test.each([[350, '300mm'], [400, '350mm'], [450, '400mm'], [500, '450mm'], [550, '500mm'], [620, '500mm']])(
    '깊이 %i → %s', (d, spec) => {
      const specs = railOf(withDrawer, d);
      expect(specs.length).toBeGreaterThan(0);
      specs.forEach((s) => expect(s).toBe(spec));
    });
});
