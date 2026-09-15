/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * P1 BOM 버그 3건 (docs/02-design/features/scene-bom-ledger.md §4 P1) — 지금 발주가 틀리던 것.
 *
 *   1. 키큰장 단 → 하부장 규칙 오적용. 브리지(ui-step1.js _convertPlannerModules)는 키큰장 스택의 단을
 *      `pos:'lower', type:'tall'` + `heightParts` 로 보내는데 extractSink 하부 루프가 type 을 안 봤다:
 *      중간장·상부장 도어가 H−30, 선반 0 인 단에 선반 1 강제, 걸레받이·목찬넬 폭에 세 단 폭이 다 더해짐.
 *      → `addTallTierParts` (sink.md §5): 단별 도어(목찬넬 단 H−30 / 푸쉬 단 H−4), shelfCount 그대로,
 *        좌대·목찬넬은 바닥 단에, 상몰딩은 맨 위 단에, 라인 폭(걸레받이·목찬넬)에서는 뺀다.
 *   2. 상부장 없는 배치의 상몰딩. `moldingW = totalUpperW || effectiveW` 가 하부 폭으로 떨어져 없는 상몰딩이 나갔다.
 *   3. 상판·좌대 미산출. 상판을 하부 라인 한 장(두께·자재는 specs)으로 낸다. 붙박이장 좌대는 이미 있다 — 여기서 잠근다.
 */
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const { wardrobe } = require('../test-utils/bom-golden/fixtures');

const SPECS = {
  layoutShape: 'I',
  doorColorUpper: '화이트', doorFinishUpper: '무광',
  doorColorLower: '화이트', doorFinishLower: '무광',
  topColor: '스노우', topThickness: 12,
  bodyThickness: 15,
  lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150,
  handle: '찬넬 (목찬넬)',
  finishLeftType: 'Filler', finishLeftWidth: 60,
  finishRightType: 'Filler', finishRightWidth: 60,
  upperDoorOverlap: 15,
  wardrobePedestal: 60,
};

/** 브리지가 보내는 키큰장 스택 — planner-golden lShape 의 실제 값 (3D stackForArea: 하부 801+좌대 60 · 중간 979 · 상부 400+상몰딩 60). */
const TALL_STACK = [
  { id: 'planner-tall-0-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 801, totalH: 861, d: 620,
    heightParts: { moldingH: 0, pedestalH: 60 }, doorCount: 1, shelfCount: 1, isDrawer: false, isEL: false, isOpen: false },
  { id: 'planner-tall-1-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 979, totalH: 979, d: 620,
    heightParts: { moldingH: 0, pedestalH: 0 }, doorCount: 1, shelfCount: 2, isDrawer: false, isEL: false, isOpen: false },
  { id: 'planner-tall-2-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 400, totalH: 460, d: 620,
    heightParts: { moldingH: 60, pedestalH: 0 }, doorCount: 1, shelfCount: 0, isDrawer: false, isEL: false, isOpen: false },
];
const LOWERS = [
  { id: 'planner-lower-0-0', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, shelfCount: 1 },
  { id: 'planner-lower-1-0', type: 'storage', name: '하부장', pos: 'lower', w: 1000, h: 708, d: 550, doorCount: 2, shelfCount: 1 },
];
const UPPER = { id: 'planner-upper-0-0', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 720, d: 290, doorCount: 2, shelfCount: 2 };

function sinkItem(modules, over = {}) {
  return Object.assign({ categoryId: 'sink', w: 4200, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules }, over);
}

function extract(item) {
  const { MaterialExtractor } = loadExtractors();
  return new MaterialExtractor().extract({ appVersion: 'p1-test', items: [item] }).materials;
}

const rowsOf = (rows, moduleId, part) => rows.filter((r) => r.partId.indexOf(`0-${moduleId}-`) === 0 && (!part || r.part === part));
const one = (rows, moduleId, part) => {
  const r = rowsOf(rows, moduleId, part);
  expect(r).toHaveLength(1);
  return r[0];
};

describe('P1-1 키큰장 단은 하부장 규칙이 아니다 (sink.md §5)', () => {
  const rows = extract(sinkItem([...LOWERS, ...TALL_STACK]));

  test('단별 도어 높이 — 목찬넬 하부단 H−30, 푸쉬 중간·상부단 H−4 (3D defaultHandleType 과 같다)', () => {
    expect(one(rows, 'planner-tall-0-0', '도어')).toMatchObject({ w: 596, h: 771, qty: 1 });   // 801 − 30
    expect(one(rows, 'planner-tall-1-0', '도어')).toMatchObject({ w: 596, h: 975, qty: 1 });   // 979 − 4
    expect(one(rows, 'planner-tall-2-0', '도어')).toMatchObject({ w: 596, h: 396, qty: 1 });   // 400 − 4
  });

  test('선반은 shelfCount 그대로 — 0 인 상부단에 선반을 강제하지 않는다', () => {
    expect(one(rows, 'planner-tall-0-0', '선반').qty).toBe(1);
    expect(one(rows, 'planner-tall-1-0', '선반').qty).toBe(2);
    expect(rowsOf(rows, 'planner-tall-2-0', '선반')).toHaveLength(0);
  });

  test('처짐방지목 — 목찬넬 단만 −70, 푸쉬 단은 H−2T', () => {
    expect(one(rows, 'planner-tall-0-0', '밴드(처짐방지)').h).toBe(801 - 30 - 70);
    expect(one(rows, 'planner-tall-1-0', '밴드(처짐방지)').h).toBe(979 - 30);
    expect(one(rows, 'planner-tall-2-0', '밴드(처짐방지)').h).toBe(400 - 30);
  });

  test('걸레받이·목찬넬 라인 폭 = 하부장 폭 합 — 키큰장 세 단(600×3)은 들어가지 않는다', () => {
    expect(one(rows, 'ep', '걸레받이')).toMatchObject({ w: 1900, h: 145 });
    expect(one(rows, 'ep', '목찬넬(전면)')).toMatchObject({ w: 52, h: 1900 });
    expect(one(rows, 'ep', '목찬넬(지면)')).toMatchObject({ w: 40, h: 1900 });
  });

  test('키큰장 하부단은 제 폭의 목찬넬을 따로 낸다 — 중간·상부단에는 없다', () => {
    expect(one(rows, 'planner-tall-0-0', '목찬넬(전면)')).toMatchObject({ w: 52, h: 600, slot: 'handle' });
    expect(one(rows, 'planner-tall-0-0', '목찬넬(지면)')).toMatchObject({ w: 40, h: 600 });
    expect(rowsOf(rows, 'planner-tall-1-0').filter((r) => /목찬넬/.test(r.part))).toHaveLength(0);
    expect(rowsOf(rows, 'planner-tall-2-0').filter((r) => /목찬넬/.test(r.part))).toHaveLength(0);
  });

  test('좌대는 스택에 한 벌, 바닥 단에 (sink.md §5 좌대 60 · 상자 구성은 wardrobe.md) — 걸레받이는 없다', () => {
    expect(one(rows, 'planner-tall-0-0', '좌대 전후')).toMatchObject({ material: 'PB', thickness: 15, w: 570, h: 60, qty: 2, slot: 'kick' });
    expect(one(rows, 'planner-tall-0-0', '좌대 측')).toMatchObject({ w: 585, h: 60, qty: 2 });
    expect(rowsOf(rows, 'planner-tall-0-0', '좌대 중간보강')).toHaveLength(0);   // W 600 < 700
    expect(one(rows, 'planner-tall-0-0', '좌대 걸레받이')).toMatchObject({ material: 'MDF', thickness: 18, w: 60, h: 600, qty: 1 });
    ['planner-tall-1-0', 'planner-tall-2-0'].forEach((id) => {
      expect(rowsOf(rows, id).filter((r) => /좌대/.test(r.part))).toHaveLength(0);
    });
    expect(rows.filter((r) => r.part === '걸레받이' && r.partId.indexOf('0-ep-') !== 0)).toHaveLength(0);
  });

  test('상몰딩은 맨 위 단에 한 장 (moldingH × W) — 상부 라인 상몰딩과 별개', () => {
    expect(one(rows, 'planner-tall-2-0', '상몰딩')).toMatchObject({ material: 'MDF', thickness: 18, w: 60, h: 600, qty: 1, slot: 'finishing' });
    expect(rowsOf(rows, 'planner-tall-0-0', '상몰딩')).toHaveLength(0);
    expect(rowsOf(rows, 'planner-tall-1-0', '상몰딩')).toHaveLength(0);
    expect(rowsOf(rows, 'ep', '상몰딩')).toHaveLength(0);   // 상부장이 없다
  });

  test('몸통은 하부장과 같다 — 측판·지판·밴드·뒷판 (단별 H)', () => {
    expect(one(rows, 'planner-tall-1-0', '측판')).toMatchObject({ w: 620, h: 979, qty: 2 });
    expect(one(rows, 'planner-tall-1-0', '지판')).toMatchObject({ w: 570, h: 620 });
    expect(one(rows, 'planner-tall-1-0', '밴드')).toMatchObject({ w: 70, h: 570, qty: 2 });
    expect(one(rows, 'planner-tall-1-0', '뒷판')).toMatchObject({ thickness: 2.7, w: 570, h: 964 });
  });

  test('단 정보가 없는 통짜 키큰장(상세설계 addTallModule) — 좌대·상몰딩 모두, 도어는 목찬넬 H−30', () => {
    const single = { id: 'tl-1', type: 'tall', name: '키큰장(TL)', pos: 'lower', w: 600, h: 2190, d: 550, doorCount: 1, elCount: 0 };
    const r = extract(sinkItem([...LOWERS, single]));
    expect(one(r, 'tl-1', '도어')).toMatchObject({ w: 596, h: 2160 });
    expect(one(r, 'tl-1', '선반').qty).toBe(1);
    expect(one(r, 'tl-1', '좌대 전후')).toMatchObject({ w: 570, h: 60, qty: 2 });
    expect(one(r, 'tl-1', '상몰딩')).toMatchObject({ w: 60, h: 600 });
    expect(one(r, 'tl-1', '목찬넬(전면)')).toMatchObject({ w: 52, h: 600 });
    expect(one(r, 'ep', '걸레받이').w).toBe(1900);
  });

  test('키큰장만 있는 라인 — 걸레받이·라인 목찬넬이 없다 (좌대가 받친다)', () => {
    const r = extract(sinkItem([...TALL_STACK]));
    expect(rowsOf(r, 'ep', '걸레받이')).toHaveLength(0);
    expect(rowsOf(r, 'ep').filter((x) => /목찬넬/.test(x.part))).toHaveLength(0);
    expect(rowsOf(r, 'ep', '상판')).toHaveLength(0);
    expect(one(r, 'planner-tall-0-0', '목찬넬(전면)').h).toBe(600);
  });

  test('푸쉬 손잡이 스펙이면 하부단 도어도 H−4, 목찬넬·처짐방지 −70 이 없다', () => {
    const r = extract(sinkItem([...LOWERS, ...TALL_STACK], { specs: Object.assign({}, SPECS, { handle: '푸쉬' }) }));
    expect(one(r, 'planner-tall-0-0', '도어').h).toBe(797);
    expect(rowsOf(r, 'planner-tall-0-0').filter((x) => /목찬넬/.test(x.part))).toHaveLength(0);
    expect(one(r, 'planner-tall-0-0', '밴드(처짐방지)').h).toBe(801 - 30);
  });
});

describe('P1-2 상부장 없는 배치에는 상몰딩을 내지 않는다', () => {
  test('상부 모듈 0 → ep 상몰딩 없음 (예전엔 하부 폭 4866 짜리 상몰딩이 나갔다)', () => {
    const rows = extract(sinkItem([...LOWERS]));
    expect(rowsOf(rows, 'ep', '상몰딩')).toHaveLength(0);
    expect(rows.filter((r) => r.part === '상몰딩')).toHaveLength(0);
  });

  test('상부 모듈이 있으면 상몰딩 폭 = 상부 폭 합 (하부 폭이 아니다)', () => {
    const rows = extract(sinkItem([...LOWERS, UPPER]));
    expect(one(rows, 'ep', '상몰딩')).toMatchObject({ w: 60, h: 900, qty: 1, edge: '4면' });
  });

  test('하부 모듈이 하나도 없는 옛 저장 설계 — 상몰딩은 여전히 없고 걸레받이만 품목 폭 − 120 으로 떨어진다', () => {
    const rows = extract(sinkItem([]));
    expect(rowsOf(rows, 'ep', '상몰딩')).toHaveLength(0);
    expect(one(rows, 'ep', '걸레받이').w).toBe(4200 - 120);
  });
});
