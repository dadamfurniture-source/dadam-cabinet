/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 같은 서랍 비율을 다른 서랍장에 한 번에 (ArchiWood 영상 분석 E, 2026-10-19).
 *   · 전면 배분 레이아웃이 있는 다른 모듈에만 · 레일 등 각자 값은 그대로
 *   · 초안이 바뀌어 있으면 먼저 적용
 */
const { bootPlanner } = require('../test-utils/planner-harness');

function addDrawerModule(p) {
  const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id);
  const s = p.g('getStructure')(m.id);
  Object.assign(s, {
    horizontalLayout: 'doorTopDrawerBottom',
    bottomType: 'drawer',
    drawerCount: 1,
  });
  return { m, s };
}

describe('다른 서랍장에도 적용', () => {
  test('버튼이 다른 서랍장 수를 세고, 누르면 단수·등급을 옮긴다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ra1&item=1', storage: {} });
    const a = addDrawerModule(p);
    const b = addDrawerModule(p);
    const c = addDrawerModule(p);
    c.s.drawer = { rail: 'ball', sakuri: true, boxT: 18, grades: [], doorGrade: '' };
    const plain = p.g('addModuleToArea')(p.g('areas').find((x) => x.section === 'lower').id);
    p.g('setActiveModule')(a.m.id);
    p.g('renderRightPanel')();

    const inp = p.document.getElementById('inpDrawerRatio');
    inp.value = '1:2:1';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    const btn = p.document.getElementById('btnRatioToOthers');
    expect(btn.textContent).toContain('다른 서랍장 2개');
    btn.click();

    // 초안이 먼저 적용된다
    expect(a.s.drawerCount).toBe(2);
    expect(p.g('drawerRulesOf')(a.s)).toMatchObject({
      doorGrade: 'small',
      grades: ['auto', 'small'],
    });
    [b, c].forEach((x) => {
      expect(x.s.drawerCount).toBe(2);
      expect(p.g('drawerRulesOf')(x.s)).toMatchObject({
        doorGrade: 'small',
        grades: ['auto', 'small'],
      });
    });
    expect(p.g('drawerRulesOf')(c.s)).toMatchObject({ rail: 'ball', sakuri: true, boxT: 18 });
    expect(p.g('getStructure')(plain.id).horizontalLayout).not.toBe('doorTopDrawerBottom');
    expect(p.errors).toEqual([]);
  });

  test('다른 서랍장이 없으면 버튼이 없다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ra2&item=1', storage: {} });
    const a = addDrawerModule(p);
    p.g('setActiveModule')(a.m.id);
    p.g('renderRightPanel')();
    expect(p.document.getElementById('inpDrawerRatio')).not.toBeNull();
    expect(p.document.getElementById('btnRatioToOthers')).toBeNull();
  });
});
