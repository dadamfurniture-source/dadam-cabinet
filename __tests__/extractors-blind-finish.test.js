/**
 * W12-61: 멍판 마감재가 BOM 에 나온다.
 *
 * 멍 폭에는 마감재 **자리** 60 이 이미 들어가 있다 (corner.md §3.3). 그런데
 * 지금까지 그 자리에 설 부재가 없어, 60 이 멍가림판 MDF 로 발주되고 있었다.
 *
 *   멍가림판   멍 폭 − 목대 15        ← 마감재 60 은 **안 뺀다** (위를 덮으므로)
 *   마감재     재단 150 = 자리 60 + 겹침 90   (W12-72: 100 → 150, data-constants.js:89 가 정본)
 *
 * 종류는 멍장이 속한 라인 마감을 따라온다 (mod.blindFinishType).
 * 재단 폭은 플래너가 주는 blindFinishW 가 우선이고, 없으면(옛 저장 설계·Node) 추출기 폴백이다.
 * 폴백은 정본과 같은 150 이어야 한다 — 100 에 남아 있어 브라우저와 시험이 갈렸던 것을 B0 에서 맞췄다.
 */
global.dlog = () => {};

const { MaterialExtractor } = require('../js/detaildesign/extractors.js');

const BATTEN_T = 15;
const ZONE_W = 765;              // 인접 상판 700 → 700 − 10 + 60 + 15
const COVER_W = ZONE_W - BATTEN_T;
const FIN_SEAT_W = 60;           // 마감재 자리 (멍 공식의 60)
const FIN_PART_W = 150;          // 멍판 마감재 재단 폭 — data-constants.js:89 CORNER_FINISH_PART_W (W12-72)

/** 플래너가 넘겨주는 모양 그대로의 멍장 하나짜리 설계 */
function makeItem(over) {
  const blind = Object.assign({
    id: 'corner-blind-lower', type: 'storage', name: 'LT망장', pos: 'lower',
    w: 1143, h: 708, d: 550,
    doorCount: 1, doorW: 378, blindZoneW: ZONE_W,
    blindFinishType: 'Filler', blindFinishW: FIN_PART_W,
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

  test('경첩목대(ㄱ자 옆다리)는 그대로 따로 나온다 — 멍판에서 뺀 자리가 이것이다', () => {
    const b = parts.find((m) => m.part === '경첩목대(옆다리)');
    expect(b).toBeDefined();
    expect(b.thickness).toBe(BATTEN_T);
    expect(b.h).toBe(parts.find((m) => m.part === '멍가림판').h);
  });
});

describe('멍판 마감재가 라인 마감을 따라 나온다', () => {
  test('휠라면 휠라(멍판) 150 × 몸통H', () => {
    const fin = partsOf(makeItem()).find((m) => m.part === '휠라(멍판)');
    expect(fin).toBeDefined();
    expect(fin.thickness).toBe(18);
    expect(fin.w).toBe(FIN_PART_W);
    expect(fin.h).toBe(708);
    expect(fin.qty).toBe(1);
  });

  test('몰딩이면 몰딩(멍판)', () => {
    const parts = partsOf(makeItem({ blindFinishType: 'Molding' }));
    expect(parts.find((m) => m.part === '몰딩(멍판)')).toBeDefined();
    expect(parts.find((m) => m.part === '휠라(멍판)')).toBeUndefined();
  });

  test('재단은 자리(60)가 아니라 150 이다 — 60 이면 마감재가 안 붙는다', () => {
    const fin = partsOf(makeItem()).find((m) => m.part === '휠라(멍판)');
    expect(fin.w).toBe(FIN_SEAT_W + 90);
    expect(fin.w).not.toBe(FIN_SEAT_W);
    // 비고의 겹침도 실제 재단 폭에서 나온다 — 폭 150 옆에 "겹침 40" 이 적히면 공장이 헷갈린다
    expect(fin.note).toContain(`자리 ${FIN_SEAT_W} + 멍판 위 겹침 ${FIN_PART_W - FIN_SEAT_W}`);
  });

  test('종류 미지정(옛 저장 설계)이면 휠라로 떨어진다', () => {
    const parts = partsOf(makeItem({ blindFinishType: undefined, blindFinishW: undefined }));
    const fin = parts.find((m) => m.part === '휠라(멍판)');
    expect(fin).toBeDefined();
    // 폭도 폴백 상수로 떨어진다 — 정본 150 (W12-72, data-constants.js:89). 예전엔 폴백이 100 이었다.
    expect(fin.w).toBe(FIN_PART_W);
  });

  test('옛 저장 설계가 blindFinishW 100 을 들고 있으면 그대로 100 으로 낸다 (명시값 우선)', () => {
    const fin = partsOf(makeItem({ blindFinishW: 100 })).find((m) => m.part === '휠라(멍판)');
    expect(fin.w).toBe(100);
    expect(fin.note).toContain('겹침 40');
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
    ['멍가림판', '경첩목대(앞다리)', '경첩목대(옆다리)', '휠라(멍판)', '몰딩(멍판)'].forEach((part) => {
      expect(all.find((m) => m.part === part)).toBeUndefined();
    });
  });
});
