/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 플래너 — 키큰장 단 조합 (2026-10-24 사장님, 모듈 라이브러리 키큰장 조합: 밥솥 · 전자레인지 오픈 칸 · 플랩 …).
 *
 *   플랩      키큰장 **맨 위 단**도 칸 열림 '위 ▲ 플랩' (상부장 플랩과 같은 철물 — 브리지 doorOpen 'up', #1051)
 *   서랍 단   "싱크 서랍장 규칙 그대로" — 맨 아래 단에만 고를 수 있고, 전면은 **단 몸통**을 영역으로 푼다 (BOM drawerLayoutOf, #1050)
 *   밥솥장    여닫이 · 포켓 도어는 경첩 방향을 고른다 (칸 열림 방향 → 브리지 hingeSide, 2026-10-23 4-1 C)
 */
const { bootPlanner3D } = require('../test-utils/scene-parts');

/** 키큰장 배치 공간 하나 — 600 × 2300, 깊이 650 (합성 값) */
const LAYOUT = {
  version: 1, savedAt: '2026-01-01T00:00:00.000Z', person: { cx: 1000, cy: 1000 },
  modules: [{ section: 'tall', x: 0, y: 0, w: 600, h: 650, moduleH: 2300, rotation: 0, finishings: [] }],
};
function boot() {
  const p = bootPlanner3D(LAYOUT, { autoCalc: true });
  const tiers = p.g('modules').filter((m) => m.section === 'tall').sort((a, b) => (a.baseY || 0) - (b.baseY || 0));
  expect(tiers.map((m) => [m.part, m.H])).toEqual([['하부장', 861], ['중간장', 979], ['상부장', 460]]);
  return { p, tiers };
}
const DRAWER_2_2 = {
  horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 2,
  drawer: { rail: 'under', sakuri: true, boxT: 0, grades: ['auto', 'auto'], doorGrade: '', topDrawer: true },
};

describe('플랩 — 키큰장 맨 위 단', () => {
  test('맨 위 단만 플랩을 고를 수 있다 (좌 → 우 → 위 → 좌), 중간 · 맨 아래 단은 좌 ↔ 우', () => {
    const { p, tiers } = boot();
    expect(tiers.map((m) => p.g('flapAllowed')(m))).toEqual([false, false, true]);
    expect(p.g('nextDoorDir')(tiers[2], 'right')).toBe('up');
    expect(p.g('nextDoorDir')(tiers[1], 'right')).toBe('left');
  });
});

describe('서랍 단 — 맨 아래 단만, 전면 영역 = 단 몸통', () => {
  test('칸 타입에 "서랍장으로" 는 맨 아래 단에만 있다', () => {
    const { p, tiers } = boot();
    const drawerOptionOn = (m) => {
      p.g('setActiveModule')(m.id);
      p.g('renderRightPanel')();
      return !!p.document.querySelector('#areasBody .a-type option[value="drawer"]');
    };
    expect(tiers.map(drawerOptionOn)).toEqual([true, false, false]);
    expect(p.errors).toEqual([]);
  });

  test('맨 아래 단 서랍 2:2 — 전면 합 + 목찬넬 틈 30 × 2 = 몸통 801 (BOM 과 같은 식) · 중간 단은 레이아웃 없음', () => {
    const { p, tiers } = boot();
    const s0 = Object.assign(p.g('getStructure')(tiers[0].id), JSON.parse(JSON.stringify(DRAWER_2_2)));
    const L = p.g('drawerLayoutFor')(tiers[0], s0);
    expect(L.warnings).toEqual([]);
    expect(L.fronts.map((f) => f.h)).toEqual([370, 371]);
    expect(L.fronts.reduce((a, f) => a + f.h, 0) + 30 * 2).toBe(801);
    expect(L.boxes.map((b) => [b.size, b.fits])).toEqual([['large', true], ['large', true]]);
    const s1 = Object.assign(p.g('getStructure')(tiers[1].id), JSON.parse(JSON.stringify(DRAWER_2_2)));
    expect(p.g('drawerLayoutFor')(tiers[1], s1)).toBeNull();
    // 3D · 정면도가 그 구조로 그려진다 (오류 없음)
    p.g('renderAll3D')({ fit: false });
    p.g('renderFrontView')();
    expect(p.errors).toEqual([]);
  });
});

describe('밥솥장 — 여닫이 도어 경첩 방향', () => {
  test('여닫이를 고르면 경첩 칸이 뜨고, 우 ▶ 를 고르면 칸 열림 방향이 오른쪽', () => {
    const { p, tiers } = boot();
    const m = tiers[1];
    p.g('setActiveModule')(m.id);
    p.g('renderRightPanel')();
    const kind = p.document.getElementById('selModuleKind');
    kind.value = 'rice';
    kind.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(p.document.getElementById('selRiceHinge')).toBeNull();   // 오픈(기본)에는 없다
    const door = p.document.getElementById('selRiceDoor');
    door.value = 'swing';
    door.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    const hinge = p.document.getElementById('selRiceHinge');
    expect(hinge).not.toBeNull();
    expect(hinge.value).toBe('left');
    hinge.value = 'right';
    hinge.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    const s = p.g('getStructure')(m.id);
    expect([s.moduleKind, s.rice, s.areaDirections[0]]).toEqual(['rice', { door: 'swing' }, 'right']);
    expect(p.errors).toEqual([]);
  });
});

describe('밥솥장 — 조립 명세로 그리는 판 종류 (2026-10-25 사장님 슬라이딩 선반)', () => {
  test('오픈 상자 판 + 일반 장 몸통(도어) + 슬라이딩 선반 부재를 통째로 받는다', () => {
    const M = require('../js/planner/planner-assembly-mesh.js');
    expect(M.PLANNER_ASM_RICE_FAMILIES).toEqual(expect.arrayContaining(M.PLANNER_ASM_OPEN_FAMILIES.concat([
      'body:bottom', 'body:band', 'body:brace', 'rice:shelf', 'rice:batten', 'rice:front', 'rice:hinge-batten'])));
    // 오픈장 · 홈카페장은 예전 그대로
    expect(M.PLANNER_ASM_OPEN_FAMILIES).toEqual(['body:side', 'part:천지판', 'back', 'door']);
  });
});
