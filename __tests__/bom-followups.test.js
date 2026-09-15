/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * P1 후속 (agent/bom-followups) — 키큰장 단별 경첩 수.
 *
 * P1(#649)이 키큰장 단의 **자재 행** 도어 높이를 sink.md §5.1 대로 고쳤지만(목찬넬 하부단 H−30 · 푸쉬 단 H−4),
 * HardwareExtractor.extractHinges 는 여전히 `pos:'lower' → H−30` 으로 도어 높이를 따로 셈했다. 경첩 수 문턱
 * (≤900 2구 · ≤1600 3구 · 그 밖 4구, bom-protocol.md §4-1)은 재단 도어 높이 기준이므로 몸통 H 905~930 ·
 * 1605~1630 구간의 푸쉬 단에서 도어마다 경첩 한 개가 빠지고, 보링 위치도 26mm 어긋났다.
 * 이제 두 추출기가 같은 함수(bomTallTierDoorH)를 쓴다 — 이 시험은 자재 행의 도어 h 와 경첩 행의 보링(110, …, h−110)을 맞춰 본다.
 *
 * 상판은 **품목당 한 장**으로 확정(사용자 결정 2026-09-15) — P1-3 행 그대로. 여기서는 그 결정을 잠근다.
 */
const { loadExtractors } = require('../test-utils/bom-golden/golden');

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

/** 브리지가 보내는 키큰장 스택 (bom-p1-fixes.test.js 와 같은 값 — planner-golden lShape). */
const TALL_STACK = [
  { id: 'planner-tall-0-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 801, totalH: 861, d: 620,
    heightParts: { moldingH: 0, pedestalH: 60 }, doorCount: 1, shelfCount: 1, isDrawer: false, isEL: false, isOpen: false },
  { id: 'planner-tall-1-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 979, totalH: 979, d: 620,
    heightParts: { moldingH: 0, pedestalH: 0 }, doorCount: 1, shelfCount: 2, isDrawer: false, isEL: false, isOpen: false },
  { id: 'planner-tall-2-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 400, totalH: 460, d: 620,
    heightParts: { moldingH: 60, pedestalH: 0 }, doorCount: 1, shelfCount: 0, isDrawer: false, isEL: false, isOpen: false },
];
const LOWER = { id: 'planner-lower-0-0', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, shelfCount: 1 };
const UPPER = { id: 'planner-upper-0-0', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 720, d: 290, doorCount: 2, shelfCount: 2 };

const tier = (over) => Object.assign({}, TALL_STACK[1], over);   // 중간단(푸쉬) 을 바탕으로

function sinkItem(modules, over = {}) {
  return Object.assign({ categoryId: 'sink', w: 4200, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules }, over);
}

function extractBoth(item) {
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const design = { appVersion: 'followups-test', items: [item] };
  return {
    materials: new MaterialExtractor().extract(design).materials,
    hardware: new HardwareExtractor().extract(design).hardware,
  };
}

/** 모듈의 자재 행 도어 h · 경첩 행 {qty, spec, boring[]} — 경첩 비고 "이름 (보링: a, b, c)" 를 읽는다. */
function doorAndHinge(item, moduleId, moduleName) {
  const { materials, hardware } = extractBoth(item);
  const doors = materials.filter((r) => r.partId.indexOf(`0-${moduleId}-door`) === 0);
  expect(doors).toHaveLength(1);
  const hinges = hardware.filter((h) => h.category === '경첩' && h.note.indexOf(`${moduleName} (`) === 0);
  expect(hinges).toHaveLength(1);
  const m = /보링: ([\d, ]+)\)/.exec(hinges[0].note);
  const boring = m[1].split(',').map((s) => parseInt(s.trim(), 10));
  return { door: doors[0], hinge: hinges[0], boring };
}

/** 경첩 행이 자재 행의 도어 높이를 봤다는 증거 — 보링 첫/끝 = 110 / doorH−110, 구 수 = 문턱 규칙. */
function expectHingeMatchesDoor({ door, hinge, boring }, wantCount) {
  expect(boring[0]).toBe(110);
  expect(boring[boring.length - 1]).toBe(door.h - 110);
  expect(boring).toHaveLength(wantCount);
  expect(hinge.spec).toBe(`${wantCount}구`);
  expect(hinge.qty).toBe(wantCount * door.qty);
}

describe('키큰장 단별 경첩 수 — 경첩은 자재 행이 낸 도어 높이를 본다 (sink.md §5.1 · bom-protocol.md §4-1)', () => {
  test('스택 세 단: 하부단(목찬넬 H−30) · 중간단(푸쉬 H−4) · 상부단(푸쉬 H−4) 모두 보링이 자재 도어 h 와 맞는다', () => {
    const item = sinkItem([...TALL_STACK, LOWER, UPPER]);
    // 각 단의 이름이 같아('키큰장') 비고로는 못 가르므로 단마다 따로 이름을 준다
    item.modules[0].name = '키큰장A'; item.modules[1].name = '키큰장B'; item.modules[2].name = '키큰장C';
    const a = doorAndHinge(item, 'planner-tall-0-0', '키큰장A');
    const b = doorAndHinge(item, 'planner-tall-1-0', '키큰장B');
    const c = doorAndHinge(item, 'planner-tall-2-0', '키큰장C');
    expect(a.door.h).toBe(801 - 30);   // 목찬넬 하부단
    expect(b.door.h).toBe(979 - 4);    // 푸쉬 중간단
    expect(c.door.h).toBe(400 - 4);    // 푸쉬 상부단
    expectHingeMatchesDoor(a, 2);
    expectHingeMatchesDoor(b, 3);
    expectHingeMatchesDoor(c, 2);
  });

  test('푸쉬 중간단 몸통 H 920 → 도어 916 → 3구 (예전 H−30=890 가정이면 2구로 하나 빠졌다)', () => {
    const r = doorAndHinge(sinkItem([tier({ h: 920, name: '키큰장M' })]), 'planner-tall-1-0', '키큰장M');
    expect(r.door.h).toBe(916);
    expectHingeMatchesDoor(r, 3);
    expect(r.boring).toEqual([110, 458, 806]);
  });

  test('푸쉬 단 몸통 H 1620 · 양문 → 도어 1616 → 4구 × 2 = 8 (예전 1590 가정이면 3구 × 2 = 6)', () => {
    const r = doorAndHinge(sinkItem([tier({ h: 1620, doorCount: 2, name: '키큰장W' })]), 'planner-tall-1-0', '키큰장W');
    expect(r.door.h).toBe(1616);
    expect(r.door.qty).toBe(2);
    expectHingeMatchesDoor(r, 4);
    expect(r.hinge.qty).toBe(8);
  });

  test('푸쉬 손잡이 스펙이면 하부단도 H−4 — 경첩도 따라간다', () => {
    const item = sinkItem([Object.assign({}, TALL_STACK[0], { h: 920, name: '키큰장P' })], { specs: Object.assign({}, SPECS, { handle: '푸쉬' }) });
    const r = doorAndHinge(item, 'planner-tall-0-0', '키큰장P');
    expect(r.door.h).toBe(916);
    expectHingeMatchesDoor(r, 3);
  });

  test('목찬넬 하부단은 예전대로 H−30 — 경첩 수가 바뀌지 않는다 (H 920 → 890 → 2구)', () => {
    const r = doorAndHinge(sinkItem([Object.assign({}, TALL_STACK[0], { h: 920, name: '키큰장G' })]), 'planner-tall-0-0', '키큰장G');
    expect(r.door.h).toBe(890);
    expectHingeMatchesDoor(r, 2);
  });

  test('단 정보 없는 통짜 키큰장(상세설계 addTallModule) — 목찬넬 H−30, 경첩도 같은 높이 (H 1650 → 1620 → 4구)', () => {
    const single = { id: 'tall-single', type: 'tall', name: '키큰장S', pos: 'lower', w: 600, h: 1650, d: 550, doorCount: 1 };
    const r = doorAndHinge(sinkItem([single]), 'tall-single', '키큰장S');
    expect(r.door.h).toBe(1620);
    expectHingeMatchesDoor(r, 4);
  });

  test('하부장·상부장 경첩은 예전과 같다 — 하부 H−30 · 상부 H+15 (골든이 지키는 값)', () => {
    const item = sinkItem([LOWER, UPPER]);
    const lo = doorAndHinge(item, 'planner-lower-0-0', '하부장');
    const up = doorAndHinge(item, 'planner-upper-0-0', '상부장');
    expect(lo.door.h).toBe(708 - 30);
    expect(up.door.h).toBe(720 + 15);
    expectHingeMatchesDoor(lo, 2);
    expectHingeMatchesDoor(up, 2);
  });

  test('붙박이·냉장고장 모듈(pos 없음)은 tall 가지를 타지 않는다 — 냉장고장 키큰장 2290 → 4구 그대로', () => {
    const { HardwareExtractor } = loadExtractors();
    const fridge = { categoryId: 'fridge', w: 1800, h: 2350, d: 700, specs: {},
      modules: [{ id: 'r2', type: 'tall', name: '키큰장', w: 600, h: 2290, d: 700, doorCount: 1 }] };
    const hw = new HardwareExtractor().extract({ appVersion: 't', items: [fridge] }).hardware;
    const hinge = hw.find((h) => h.category === '경첩');
    expect(hinge.spec).toBe('4구');
    expect(hinge.note).toBe('키큰장 (보링: 110, 763, 1527, 2180)');
  });

  test('경첩 수 문턱 — ≤900 2구 · 901~1600 3구 · 1601+ 4구 (bom-protocol.md §4-1)', () => {
    const { HardwareExtractor } = loadExtractors();
    const hx = new HardwareExtractor();
    expect([hx.getHingeCount(900), hx.getHingeCount(901), hx.getHingeCount(1600), hx.getHingeCount(1601)]).toEqual([2, 3, 3, 4]);
  });
});

describe('상판은 품목당 한 장 — 사용자 결정 2026-09-15 (런마다 나누지 않는다)', () => {
  test('하부 라인이 여러 모듈이어도 상판 행은 하나, partId 0-ep-top-0, 폭 = 하부 폭 합 + 좌·우 마감', () => {
    const { materials } = extractBoth(sinkItem([...TALL_STACK, LOWER, Object.assign({}, LOWER, { id: 'planner-lower-1-0', w: 1000 }), UPPER]));
    const tops = materials.filter((r) => r.part === '상판');
    expect(tops).toHaveLength(1);
    expect(tops[0].partId).toBe('0-ep-top-0');
    expect(tops[0].w).toBe(900 + 1000 + 60 + 60);
    expect(tops[0].h).toBe(650);
    expect(tops[0].qty).toBe(1);
  });
});
