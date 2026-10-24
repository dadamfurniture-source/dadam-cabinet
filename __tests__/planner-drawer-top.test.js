/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global */
/**
 * 서랍장 맨 위 칸도 서랍 (2026-10-24 사장님, 범위: 서랍장만) — 플래너 몫.
 *
 *   '서랍장으로' 칸 타입 → drawer.topDrawer 를 켠다. 전면 장수는 그대로 두고 위 칸을 서랍으로 (비율 "2:2" → 서랍 2:2).
 *   전면 비율 입력 → topDrawer 면 "서랍:서랍…" (gradesFromRatio topDrawer, 서랍 2~4장)
 *   정면도 · 3D · 레이아웃은 위 칸도 서랍 — BOM 브리지가 drawerLayout 'all' 로 넘긴다 (ui-step1.js)
 *   상하 구성을 직접 고르거나 자동계산을 하면 "도어 + 아래 서랍" 으로 돌아간다 (표시를 끈다)
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { autoCalcModule } = require('../js/planner/planner-engine.js');

function lowerModule(p) {
  const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id);
  p.g('setActiveModule')(m.id);
  return { m, s: p.g('getStructure')(m.id) };
}

function toDrawerUnit(p) {
  const sel = p.document.querySelector('#areasBody .a-type');
  sel.value = 'drawer';
  sel.onchange({ target: sel });
  p.g('applyModuleDraft')();
}

describe('서랍장으로 — 위 칸도 서랍', () => {
  test('칸 타입 서랍 → topDrawer · 전면 2장 그대로 (도어 2 : 서랍 2 → 서랍 2 : 2)', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt1&item=1', storage: {} });
    const { m } = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    const s = p.g('getStructure')(m.id);
    expect(s.horizontalLayout).toBe('doorTopDrawerBottom');
    expect(s.bottomType).toBe('drawer');
    expect(s.drawer).toMatchObject({ topDrawer: true, doorGrade: '', grades: ['auto', 'auto'] });
    expect(s.drawerCount).toBe(2);
    const L = p.g('drawerLayoutFor')(m, s);
    expect(L.fronts.map((f) => f.kind)).toEqual(['drawer', 'drawer']);
    expect(L.boxes).toHaveLength(2);
    expect(p.errors).toEqual([]);
  });

  test('전면 비율 "2:1:1" → 서랍 3장 (첫 칸도 서랍) · 화면 비율은 서랍 비율', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt2&item=1', storage: {} });
    const { m } = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    p.g('renderRightPanel')();
    const inp = p.document.getElementById('inpDrawerRatio');
    expect(inp.value).toBe('2:2');
    inp.value = '2:1:1';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    const s = p.g('getStructure')(m.id);
    expect(s.drawerCount).toBe(3);
    expect(p.g('drawerRulesOf')(s)).toMatchObject({ topDrawer: true, grades: ['auto', 'small', 'small'] });
    p.g('renderRightPanel')();
    expect(p.document.getElementById('inpDrawerRatio').value).toBe('2:1:1');
    // 등급 줄은 서랍만 (도어 등급 칸 없음)
    expect(p.document.getElementById('selDoorGrade')).toBeNull();
    expect(p.document.getElementById('selDrawerGrade2')).not.toBeNull();
    expect(p.errors).toEqual([]);
  });

  test('서랍 5장은 받지 않는다 (서랍 최대 4)', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt3&item=1', storage: {} });
    const { m } = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    p.g('renderRightPanel')();
    const inp = p.document.getElementById('inpDrawerRatio');
    inp.value = '2:2:2:2:2';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(inp.value).toBe('2:2');
    expect(p.g('getStructure')(m.id).drawerCount).toBe(2);
  });

  test('payload → 브리지: 위 칸도 서랍 (drawerLayout all · 도어 0)', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt4&item=1', storage: {} });
    const { m } = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    const payload = p.g('buildPlannerPayload')('PLANNER_DONE');
    expect(payload.structures[m.id].drawer.topDrawer).toBe(true);
    const { loadConverter } = require('../test-utils/bom-parts');
    global.dlog = () => {};
    const conv = loadConverter()._convertPlannerModules(JSON.parse(JSON.stringify(payload)), {
      bodyThickness: 15, lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60, handle: '찬넬 (목찬넬)',
    });
    const mod = conv.modules.find((x) => String(x.id).startsWith(`planner-${m.id}-`));
    expect(mod).toMatchObject({ drawerLayout: 'all', doorCount: 0, isDrawer: true, drawerCount: 2 });
  });
});

describe('서랍장 표시 끄기 — "도어 + 아래 서랍" 으로', () => {
  test('상하 구성을 직접 고르면 끈다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt5&item=1', storage: {} });
    const { m } = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    p.g('renderRightPanel')();
    const sel = p.document.getElementById('selHLayout');
    sel.value = 'doorTopDrawerBottom';
    sel.onchange({ target: sel });
    p.g('applyModuleDraft')();
    const s = p.g('getStructure')(m.id);
    expect(s.drawer.topDrawer).toBe(false);
    expect(p.g('drawerLayoutFor')(m, s).fronts[0].kind).toBe('door');
  });

  test('자동계산 하부장은 위 칸 도어 (autoCalcModule 이 끈다) · 새 구조는 꺼진 채로 시작', () => {
    const s = { drawer: { rail: 'ball', topDrawer: true, grades: ['auto'] }, areaTypes: ['door'], areaDirections: ['left'] };
    autoCalcModule({ id: 'lower-0', section: 'lower', W: 600, H: 870, x: 0 }, s, null);
    expect(s.drawer).toMatchObject({ rail: 'ball', topDrawer: false });
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt6&item=1', storage: {} });
    expect(p.g('defaultStructure')().drawer.topDrawer).toBe(false);
  });

  test('비율 옮기기는 같은 종류끼리 — 서랍장 비율이 자동계산 하부장으로 가지 않는다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dt7&item=1', storage: {} });
    const a = lowerModule(p);
    p.g('renderRightPanel')();
    toDrawerUnit(p);
    const b = lowerModule(p);
    Object.assign(b.s, { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 1 });
    expect(p.g('otherDrawerModules')(a.m).map((x) => x.id)).not.toContain(b.m.id);
    expect(p.g('otherDrawerModules')(b.m).map((x) => x.id)).not.toContain(a.m.id);
  });
});
