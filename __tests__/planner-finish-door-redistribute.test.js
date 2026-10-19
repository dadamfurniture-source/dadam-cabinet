/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 마감재를 붙인 뒤 균등 분배는 **도어 장수**를 따른다 (W12-45 · W12-73).
 *
 * 결함 (2026-10-19): 자동계산을 마친 붙박이장 배치에 몰딩을 붙이면 `redistributeAreaWidths` 가
 *   모듈마다 `floor(자리 / 모듈 수)` 를 나눠 주었다. 도어 장수를 안 보니 단문 모듈이 양문 모듈과
 *   같은 폭을 받아 **도어 한 장이 최대 600 을 넘었다**.
 *     벽 3200 자동계산 → 914 · 914 · 914 · 457(단문)
 *     양끝 몰딩 60      → 770 · 770 · 770 · 770(단문 → 도어 770)
 *   자동계산을 다시 누르면 880 · 880 · 880 · 440 이 나왔다 — 같은 자리에 두 답.
 *
 * 지키는 계약:
 *   1) 마감재 뒤 분배는 도어 폭 하나를 라인 전체에 준다 — 단문은 한 장, 양문은 두 장 몫
 *   2) 잔여는 자동계산과 같은 규칙(spreadGapEqually — 조립 여유 안이면 그대로 둔다)
 *   3) 그래서 마감재를 붙인 결과와 그 자리에서 자동계산을 다시 돈 결과가 같다
 *   4) 도어 최소폭 판정도 도어 한 장 기준이다
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');

const SCOPE = '::fdr:1';

function layout(section, w) {
  const s = PLANNER_SECTIONS[section];
  return {
    version: 1, savedAt: '2026-10-19T00:00:00.000Z', person: { cx: 1800, cy: 1500 },
    modules: [{ section, x: 0, y: 0, w, h: s.h, moduleH: s.moduleH, rotation: 0, finishings: [] }],
  };
}

function boot(section, w) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=fdr&item=1',
    storage: { ['dadam_layout_v1' + SCOPE]: JSON.stringify(layout(section, w)) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const bodies = (p, areaId) => p.g('modules')
  .filter((m) => m.areaId === areaId && !m.isFinishing)
  .sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0));

/** 모듈의 도어 장수 — 칸마다 양문이면 2 */
function leaves(p, m) {
  const s = p.g('getStructure')(m.id);
  let n = 0;
  for (let i = 0; i < (s.verticalCount || 1); i++) n += (s.areaIs2D && s.areaIs2D[i]) ? 2 : 1;
  return n;
}

/** 모듈 폭을 도어 장수로 나눈 값들 — 도어 한 장의 폭 */
const doorWs = (p, mods) => mods.map((m) => m.W / leaves(p, m));

/** 자동계산 → 양끝 마감재. 마감재 직후 결과와 다시 자동계산한 결과를 함께 돌려준다. */
function finishAfterAutoCalc(section, wall, fin, finW) {
  const p = boot(section, wall);
  const area = p.g('areas').find((a) => a.section === section && !a.isFinishing);
  p.g('autoCalcArea')(area.id);
  const before = bodies(p, area.id).map((m) => ({ W: m.W, leaves: leaves(p, m) }));
  expect(p.g('setAreaFinish')(area.id, 'left', fin, finW)).toBeTruthy();
  expect(p.g('setAreaFinish')(area.id, 'right', fin, finW)).toBeTruthy();
  const after = bodies(p, area.id);
  const afterView = after.map((m) => ({ W: m.W, leaves: leaves(p, m), x: m.x }));
  const doors = doorWs(p, after);
  p.g('autoCalcArea')(area.id);
  const again = bodies(p, area.id).map((m) => ({ W: m.W, leaves: leaves(p, m), x: m.x }));
  return { p, area, before, after: afterView, doors, again };
}

describe('마감재 뒤 분배는 도어 장수를 따른다', () => {
  test('3200 붙박이장 + 양끝 몰딩 60 → 880 · 880 · 880 · 440', () => {
    const { before, after, doors } = finishAfterAutoCalc('wardrobe', 3200, 'molding', 60);
    // 전제: 자동계산이 양문 셋 + 단문 하나를 세웠다
    expect(before.map((m) => m.leaves)).toEqual([2, 2, 2, 1]);
    expect(before.map((m) => m.W)).toEqual([914, 914, 914, 457]);
    // 도어 장수는 그대로, 폭은 도어 단위로
    expect(after.map((m) => m.leaves)).toEqual([2, 2, 2, 1]);
    expect(after.map((m) => m.W)).toEqual([880, 880, 880, 440]);
    doors.forEach((d) => expect(d).toBe(440));
  });

  test.each([
    ['wardrobe', 3200],
    ['wardrobe', 4100],
    ['wardrobe', 2150],
    ['wardrobe', 3600],
    ['lower', 2400],
  ])('%s %i — 도어가 최대폭을 넘지 않고 라인 전체가 같은 폭이다', (section, wall) => {
    const { p, doors } = finishAfterAutoCalc(section, wall, 'molding', 60);
    const R = p.g('MASTER_RULES');
    doors.forEach((d) => {
      expect(d).toBeLessThanOrEqual(R.DOOR_W_MAX);
      expect(d).toBeGreaterThanOrEqual(R.DOOR_W_MIN);
    });
    expect(Math.max(...doors) - Math.min(...doors)).toBe(0);
  });

  test.each([
    ['wardrobe', 3200],
    ['wardrobe', 4100],
    ['wardrobe', 2150],
  ])('%s %i — 마감재 직후와 자동계산 다시 돈 결과가 같다', (section, wall) => {
    const { after, again } = finishAfterAutoCalc(section, wall, 'molding', 60);
    expect(after).toEqual(again);
  });

  test('잔여는 조립 여유 안이면 그대로 둔다 — 모듈은 왼쪽 마감재부터 이어진다', () => {
    // 4100 − 120 = 3980, 도어 9장 → 442 × 9 = 3978. 잔여 2 ≤ 조립 여유 5(모듈 5개)
    const { p, area, after } = finishAfterAutoCalc('wardrobe', 4100, 'molding', 60);
    expect(after.map((m) => m.W)).toEqual([884, 884, 884, 884, 442]);
    let cursor = (area.x || 0) + 60;
    after.forEach((m) => { expect(m.x).toBe(cursor); cursor += m.W; });
    const slack = (area.x || 0) + area.W - 60 - cursor;
    expect(slack).toBe(2);
    expect(slack).toBeLessThanOrEqual(p.g('jointSlack')(after.length));
  });

  test('마감재는 영역 양 끝에 붙는다 — 조립 여유는 마지막 모듈과 우 마감재 사이에 남는다', () => {
    // 자동계산(edgePlanOf · placeTail)과 같은 자리. 붙일 때 정한 x(호스트 끝)를 두면 여유만큼 뜬다.
    const p = boot('wardrobe', 4100);
    const area = p.g('areas').find((a) => a.section === 'wardrobe' && !a.isFinishing);
    p.g('autoCalcArea')(area.id);
    const l = p.g('setAreaFinish')(area.id, 'left', 'molding', 60);
    const r = p.g('setAreaFinish')(area.id, 'right', 'molding', 60);
    expect(l.x).toBe(area.x || 0);
    expect(r.x + r.W).toBe((area.x || 0) + area.W);
    const last = bodies(p, area.id).pop();
    expect(r.x - (last.x + last.W)).toBe(2);
  });

  test('autocalc-rules.md §9 의 표 — 2400 하부장에 EP · 몰딩을 붙였다 뗀다', () => {
    const p = boot('lower', 2400);
    const area = p.g('areas').find((a) => a.section === 'lower' && !a.isFinishing);
    p.g('autoCalcArea')(area.id);
    const ws = () => bodies(p, area.id).map((m) => m.W);
    expect(ws()).toEqual([960, 960, 480]);
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    expect(ws()).toEqual([952, 952, 476]);
    p.g('setAreaFinish')(area.id, 'right', 'molding', 60);
    expect(ws()).toEqual([928, 928, 464]);
    p.g('setAreaFinish')(area.id, 'left', '');
    expect(ws()).toEqual([936, 936, 468]);
  });

  test('셀 폭 합이 모듈 폭과 같다 — 칸 수·양문은 그대로', () => {
    const { p, area } = finishAfterAutoCalc('wardrobe', 3200, 'molding', 60);
    bodies(p, area.id).forEach((m) => {
      const s = p.g('getStructure')(m.id);
      expect(s.areaWidths.reduce((a, b) => a + b, 0)).toBe(m.W);
    });
  });
});

describe('도어 최소폭 판정도 도어 한 장 기준이다', () => {
  test('양문 모듈은 모듈 폭이 넉넉해도 도어가 350 미만이면 막는다', () => {
    // 양문 하나(도어 2장)가 꽉 찬 760 자리. 몰딩 60 → 700 / 2 = 350 은 들어가고,
    // 한 번 더 60 → 640 / 2 = 320 < 350 이라 막혀야 한다 (모듈 폭 640 만 보면 통과했다).
    const p = boot('lower', 760);
    const area = p.g('areas').find((a) => a.section === 'lower' && !a.isFinishing);
    const m = p.g('addModuleToArea')(area.id, { section: 'lower', W: 760, x: area.x || 0 });
    const s = p.g('getStructure')(m.id);
    s.areaIs2D = [true];
    s.areaWidths = [760];
    expect(p.g('setAreaFinish')(area.id, 'left', 'molding', 60)).toBeTruthy();
    expect(m.W).toBe(700);
    expect(p.g('setAreaFinish')(area.id, 'right', 'molding', 60)).toBeNull();
    expect(m.W).toBe(700);                                          // 아무것도 줄지 않았다
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(1);
  });
});
