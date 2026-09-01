/**
 * W12-61: 멍판 마감재가 BOM 에 나온다.
 *
 * 멍 폭에는 마감재 **자리** 60 이 이미 들어가 있다 (corner.md §3.3). 그런데
 * 지금까지 그 자리에 설 부재가 없어, 60 이 멍가림판 MDF 로 발주되고 있었다.
 *
 *   멍가림판   멍 폭 − 목대 15        ← 마감재 60 은 **안 뺀다** (위를 덮으므로)
 *   마감재     재단 100 = 자리 60 + 겹침 40
 *
 * 종류는 멍장이 속한 라인 마감을 따라온다 (mod.blindFinishType).
 */
global.dlog = () => {};

const { MaterialExtractor } = require('../js/detaildesign/extractors.js');

const BATTEN_T = 15;
const ZONE_W = 765;              // 인접 상판 700 → 700 − 10 + 60 + 15
const COVER_W = ZONE_W - BATTEN_T;

/** 플래너가 넘겨주는 모양 그대로의 멍장 하나짜리 설계 */
function makeItem(over) {
  const blind = Object.assign({
    id: 'corner-blind-lower', type: 'storage', name: 'LT망장', pos: 'lower',
    w: 1143, h: 708, d: 550,
    doorCount: 1, doorW: 378, blindZoneW: ZONE_W,
    blindFinishType: 'Filler', blindFinishW: 100,
  }, over || {});
  return {
    categoryId: 'sink', w: 1970, h: 2310, d: 700,
    modules: [blind],
    specs: {
      lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
      finishLeftType: 'None', finishRightType: 'None',
    },
  };
}

const partsOf = (item) => new MaterialExtractor().extract({ items: [item] })
  .materials.filter((m) => m.module === '하부장-LT망장');

describe('멍가림판 — 목대는 빼고 마감재는 안 뺀다', () => {
  const parts = partsOf(makeItem());

  test('멍가림판 = 멍 폭 − 목대 15', () => {
    const cover = parts.find((m) => m.part === '멍가림판');
    expect(cover).toBeDefined();
    expect(cover.material).toBe('MDF');
    expect(cover.thickness).toBe(2.7);
    expect(cover.w).toBe(COVER_W);         // 750
    expect(cover.h).toBe(708);
    expect(cover.qty).toBe(1);
  });

  test('마감재 60 은 멍가림판에서 빼지 않는다 — 대체가 아니라 덧댐이다', () => {
    const cover = parts.find((m) => m.part === '멍가림판');
    expect(cover.w).not.toBe(COVER_W - 60);
    expect(cover.w).not.toBe(ZONE_W);      // 목대까지 안고 가면 15 과다
  });

  test('경첩목대는 그대로 따로 나온다 — 멍판에서 뺀 자리가 이것이다', () => {
    const b = parts.find((m) => m.part === '경첩목대');
    expect(b).toBeDefined();
    expect(b.thickness).toBe(BATTEN_T);
    expect(b.h).toBe(parts.find((m) => m.part === '멍가림판').h);
  });
});

describe('멍판 마감재가 라인 마감을 따라 나온다', () => {
  test('휠라면 휠라(멍판) 100 × 몸통H', () => {
    const fin = partsOf(makeItem()).find((m) => m.part === '휠라(멍판)');
    expect(fin).toBeDefined();
    expect(fin.thickness).toBe(18);
    expect(fin.w).toBe(100);
    expect(fin.h).toBe(708);
    expect(fin.qty).toBe(1);
  });

  test('몰딩이면 몰딩(멍판)', () => {
    const parts = partsOf(makeItem({ blindFinishType: 'Molding' }));
    expect(parts.find((m) => m.part === '몰딩(멍판)')).toBeDefined();
    expect(parts.find((m) => m.part === '휠라(멍판)')).toBeUndefined();
  });

  test('재단은 자리(60)가 아니라 100 이다 — 60 이면 마감재가 안 붙는다', () => {
    const fin = partsOf(makeItem()).find((m) => m.part === '휠라(멍판)');
    expect(fin.w).toBe(60 + 40);
    expect(fin.w).not.toBe(60);
  });

  test('종류 미지정(옛 저장 설계)이면 휠라로 떨어진다', () => {
    const parts = partsOf(makeItem({ blindFinishType: undefined, blindFinishW: undefined }));
    const fin = parts.find((m) => m.part === '휠라(멍판)');
    expect(fin).toBeDefined();
    expect(fin.w).toBe(100);        // 폭도 상수로 떨어진다
  });

  test("'None' 을 명시하면 안 나온다", () => {
    const parts = partsOf(makeItem({ blindFinishType: 'None' }));
    expect(parts.find((m) => m.part === '휠라(멍판)')).toBeUndefined();
    expect(parts.find((m) => m.part === '몰딩(멍판)')).toBeUndefined();
    expect(parts.find((m) => m.part === '멍가림판')).toBeDefined();   // 멍판은 그대로
  });
});

describe('멍장이 아니면 아무것도 안 나온다', () => {
  test('일반 하부장에는 멍판 부재가 없다', () => {
    const item = makeItem();
    item.modules = [{ id: 'm1', type: 'storage', name: '하부장', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1 }];
    const all = new MaterialExtractor().extract({ items: [item] }).materials;
    ['멍가림판', '경첩목대', '휠라(멍판)', '몰딩(멍판)'].forEach((part) => {
      expect(all.find((m) => m.part === part)).toBeUndefined();
    });
  });
});
