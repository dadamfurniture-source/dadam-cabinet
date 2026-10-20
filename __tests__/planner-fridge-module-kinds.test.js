/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-10-20 홈카페장·EL장 모듈 타입 (사장님 카드 "모듈 타입으로").
 *
 * 홈카페장 모듈 타입 — 냉장고장이 플래너로 옮겨 오며 예전 전용 화면의 홈카페장을 구조 단계 "타입"으로 고른다.
 * 부재는 fridge.md §11 홈카페장 그대로 (bom-homecafe-rules.js). 결정 카드 추천안(모듈 타입), 사장님 답 전.
 */
const fs = require('fs');
const path = require('path');
const HC = require('../js/detaildesign/bom-homecafe-rules');
const EL = require('../js/detaildesign/bom-el-rules');
const { bootPlanner } = require('../test-utils/planner-harness');
const { snapshotOf } = require('../test-utils/bom-golden/golden');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

function loadConverter() {
  const start = UI.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = UI.indexOf('function _applyPlannerResult');
  // eslint-disable-next-line no-new-func
  return new Function('DadamHomecafeRules', 'DadamElRules', `${UI.slice(start, end)}; return { _convertPlannerModules };`)(HC, EL);
}
const { _convertPlannerModules } = loadConverter();
const rows = (r, mod) => r.materials.filter((m) => m.module === mod).map((m) => [m.part, m.material, m.thickness, m.w, m.h, m.qty, m.edge]);

describe('규칙 파일 — fridge.md §11 부재표', () => {
  test('W600 × H979 × D620', () => {
    expect(HC.partsOf({ W: 600, H: 979, D: 620 }).map((p) => [p.part, p.w, p.h, p.qty])).toEqual([
      ['측판', 640, 979, 2], ['천판', 564, 620, 1], ['지판', 564, 620, 1], ['뒷판', 564, 979, 1], ['선반', 564, 605, 2],
    ]);
    expect(HC.doorOf({ W: 600, H: 979 }, 1)).toEqual({ w: 596, h: 999, qty: 1 });
    expect(HC.doorOf({ W: 900, H: 979 }, 2)).toEqual({ w: 446, h: 999, qty: 2 });
    expect(HC.doorOf({ W: 600, H: 979 }, 0).qty).toBe(1);
  });

  test('치수가 없으면 빈 목록', () => {
    expect(HC.partsOf({ W: 30, H: 900, D: 600 })).toEqual([]);
    expect(HC.partsOf({})).toEqual([]);
  });
});

describe('예전 냉장고장 화면의 홈카페장 — 규칙 파일로 옮겨도 같은 행', () => {
  test('type homecafe 모듈', () => {
    const r = snapshotOf({ items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: {},
      modules: [{ id: 3, type: 'homecafe', name: '홈카페장', w: 600, h: 2140, d: 550, doorCount: 2 }] }] });
    expect(rows(r, '홈카페장')).toEqual([
      ['측판', 'MDF', 18, 570, 2140, 2, '3면'],
      ['천판', 'MDF', 18, 564, 550, 1, '2면(가로)'],
      ['지판', 'MDF', 18, 564, 550, 1, '2면(가로)'],
      ['뒷판', 'MDF', 18, 564, 2140, 1, '2면(가로)'],
      ['선반', 'MDF', 18, 564, 535, 2, '1면(전)'],
      ['도어', 'MDF', 18, 296, 2160, 2, '4면'],
    ]);
  });
});

describe('플래너 홈카페장 — 브리지 → BOM', () => {
  const payload = {
    modules: [{ id: 'tall-0', section: 'tall', W: 600, H: 979, D: 620, x: 720, y: 0 }],
    structures: { 'tall-0': { moduleKind: 'homecafe', horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [600], areaIs2D: [false], shelves: [], pedestalH: 0, moldingH: 0 } },
  };

  test('브리지가 홈카페장 모듈 하나로 넘긴다', () => {
    const { modules } = _convertPlannerModules(payload, { moldingH: 60 });
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ moduleKind: 'homecafe', name: '홈카페장', w: 600, h: 979, d: 620, doorCount: 1 });
  });

  test('냉장고장 품목에서 부재표대로 나오고 키큰장 규칙으로 또 나오지 않는다', () => {
    const { modules } = _convertPlannerModules(payload, { moldingH: 60 });
    const r = snapshotOf({ items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: { bodyThickness: 15 }, modules }] });
    expect(rows(r, '홈카페장')).toEqual([
      ['측판', 'MDF', 18, 640, 979, 2, '3면'],
      ['천판', 'MDF', 18, 564, 620, 1, '2면(가로)'],
      ['지판', 'MDF', 18, 564, 620, 1, '2면(가로)'],
      ['뒷판', 'MDF', 18, 564, 979, 1, '2면(가로)'],
      ['선반', 'MDF', 18, 564, 605, 2, '1면(전)'],
      ['도어', 'MDF', 18, 596, 999, 1, '4면'],
    ]);
    expect(r.materials.filter((m) => m.material === 'PB')).toEqual([]);
    const hinge = r.hardware.filter((h) => h.category === '경첩');
    expect(hinge.reduce((s, h) => s + h.qty, 0)).toBe(3); // 도어 999 → 3구 (≤900 2구 · 901~1600 3구)
  });

  test('싱크대 품목의 키큰장에서도 같은 부재표', () => {
    const { modules } = _convertPlannerModules(payload, { moldingH: 60 });
    const r = snapshotOf({ items: [{ categoryId: 'sink', w: 3000, h: 2310, d: 650, specs: { bodyThickness: 15 }, modules }] });
    expect(rows(r, '홈카페장').map((x) => x[0])).toEqual(['측판', '천판', '지판', '뒷판', '선반', '도어']);
  });
});

describe('구조 단계 타입 고르기', () => {
  test('타입 목록에 홈카페장이 있고 규칙 파일을 싣는다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    expect(p.g('homecafeRules')()).toBeTruthy();
    const src = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(src).toMatch(/<script src="js\/detaildesign\/bom-homecafe-rules\.js\?v=[\d.]+"><\/script>/);
    expect(src).toContain('homecafeKindHtml(s, dims)');
  });
});

describe('EL장 — 도어 종류만, 몸통은 예전 PB 상자, 치수 [확인 필요]', () => {
  const payload = (el) => ({
    modules: [{ id: 'tall-1', section: 'tall', W: 600, H: 979, D: 620, x: 720, y: 0 }],
    structures: { 'tall-1': { moduleKind: 'el', el, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [600], areaIs2D: [false], shelves: [], pedestalH: 0, moldingH: 0 } },
  });

  test('도어 종류 목록이 data-constants EL_DOOR_TYPES 와 같다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    EL.RULES.DOOR_TYPES.forEach((d) => expect(src).toContain(`{ id: '${d.id}', name: '${d.name}' }`));
  });

  test('브리지 — EL장 모듈, 도어 종류만 싣는다', () => {
    const { modules } = _convertPlannerModules(payload({ door: 'liftup' }), { moldingH: 60 });
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ moduleKind: 'el', name: 'EL장', doorCount: 0, doorType: 'liftup', isEL: true });
    expect(_convertPlannerModules(payload({ door: 'xx' }), {}).modules[0].doorType).toBeNull();
  });

  test('BOM — PB 측판·천판·지판·뒷판, 도어 행 없음, 측판 비고에 도어 종류와 [확인 필요]', () => {
    const { modules } = _convertPlannerModules(payload({ door: 'liftup' }), { moldingH: 60 });
    const r = snapshotOf({ items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: { bodyThickness: 15 }, modules }] });
    const el = r.materials.filter((m) => m.module === 'EL장');
    expect(el.map((m) => m.part)).toEqual(['측판', '천판', '지판', '뒷판']);
    expect(el[0]).toMatchObject({ material: 'PB', w: 620, h: 979, qty: 2 });
    expect(el[0].note).toContain('도어 리프트업');
    expect(el[0].note).toContain('[확인 필요] EL장 몸통·도어 치수');
    expect(r.materials.some((m) => m.part === '도어')).toBe(false);
    expect(r.hardware.some((h) => h.category === '경첩' || h.category === '리프트업')).toBe(false);
  });

  test('예전 화면 type el 모듈은 비고 없이 예전 그대로', () => {
    const r = snapshotOf({ items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: { bodyThickness: 15 },
      modules: [{ id: 5, type: 'el', name: 'EL장', w: 600, h: 900, d: 550 }] }] });
    const el = r.materials.filter((m) => m.module === 'EL장');
    expect(el.map((m) => [m.part, m.w, m.h])).toEqual([['측판', 550, 900], ['천판', 570, 532], ['지판', 570, 532], ['뒷판', el[3].w, el[3].h]]);
    expect(el[0].note).toBe('sakuri(15→3mm)');
  });

  test('구조 단계 — 타입에 EL장, 도어 종류 고르기', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(src).toMatch(/<script src="js\/detaildesign\/bom-el-rules\.js\?v=[\d.]+"><\/script>/);
    expect(src).toContain('elKindHtml(s)');
    expect(src).toContain("s.el = Object.assign({}, s.el, { door: e.target.value || null });");
  });
});
