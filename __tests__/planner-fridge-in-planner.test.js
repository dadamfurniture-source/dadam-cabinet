/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-10-20 냉장고장을 플래너로 옮긴다 — 기본 가구 11종이 모두 플래너에서 BOM 까지 간다.
 *
 *   1. 화면  NATIVE_ONLY·PLANNER_RESULT_BLOCKED 에서 fridge 를 뺐다 (step2-navigation·planner-to-bom-wardrobe 시험이 목록을 본다)
 *   2. BOM   플래너 모듈(pos 가 있는 모듈)은 싱크대 규칙 — 위장은 2026-09-22 일반 상부장, 키큰장은 단 규칙(sink.md §5.1).
 *            전용 화면이 만든 type 모듈(옛 설계)은 그대로 extractFridge.
 *   3. 브리지 냉장고장(fridge) 모듈 몸통 = 전체 − 상몰딩 (상부장과 같다). 예전엔 하부장 식으로 상판 12 만 빠졌다.
 *   4. 배치  장 버튼은 줄 끝에 이어 붙이고 정면(회전 0) — 예전엔 두 번째 사각형이 첫 사각형과 겹쳐 구조 단계가 막았다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { snapshotOf } = require('../test-utils/bom-golden/golden');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

function loadConverter() {
  const start = UI.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = UI.indexOf('function _applyPlannerResult');
  // eslint-disable-next-line no-new-func
  return new Function(`${UI.slice(start, end)}; return { _convertPlannerModules };`)();
}
const { _convertPlannerModules } = loadConverter();

// 브라우저에서 냉장고장 + 키큰장을 놓고 자동계산한 결과를 브리지가 옮긴 모양 (2026-10-20 실측)
const PLANNER_MODULES = [
  { id: 'planner-fridge-0-0', type: 'storage', name: '상부장', pos: 'upper', w: 680, h: 355, totalH: 415,
    heightParts: { moldingH: 60 }, d: 670, doorCount: 2, is2door: true, isDrawer: false, shelfCount: 0 },
  { id: 'planner-tall-0-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 801, totalH: 861,
    heightParts: { moldingH: 0, pedestalH: 60 }, d: 620, doorCount: 1, isDrawer: false, shelfCount: 1 },
  { id: 'planner-tall-1-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 979, totalH: 979,
    heightParts: { moldingH: 0, pedestalH: 0 }, d: 620, doorCount: 1, isDrawer: false, shelfCount: 2 },
  { id: 'planner-tall-2-0', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 400, totalH: 460,
    heightParts: { moldingH: 60, pedestalH: 0 }, d: 620, doorCount: 1, isDrawer: false, shelfCount: 0 },
];
const SPECS = { bodyThickness: 15, moldingH: 60, upperDoorOverlap: 15 };
const fridgeDesign = (modules) => ({ items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: SPECS, modules }] });

describe('냉장고장 BOM — 플래너 모듈은 싱크대 규칙', () => {
  const r = snapshotOf(fridgeDesign(PLANNER_MODULES));

  test('냉장고 위 상부장이 나온다 (전에는 type storage 라 extractFridge 가 버렸다)', () => {
    const side = r.materials.find((m) => m.part === '측판' && /상부장/.test(m.module));
    expect(side).toBeTruthy();
    expect([side.w, side.h]).toEqual([670, 355]);
    // 2026-10-20 사장님 확정(EP − 25) — [확인 필요] 비고는 없다
    expect(side.note || '').not.toMatch(/확인 필요/);
    expect(r.materials[0].itemLabel).toBe('냉장고장');
  });

  test('키큰장은 단마다 나온다 — 하부단에 좌대, 상부단에 상몰딩', () => {
    const mods = new Set(r.materials.map((m) => m.module));
    expect(mods).toContain('키큰장(하부단)');
    expect(mods).toContain('키큰장(중간단)');
    expect(mods).toContain('키큰장(상부단)');
    expect(r.materials.some((m) => m.part === '좌대 걸레받이')).toBe(true);
  });

  test('경첩이 나온다', () => {
    expect(r.hardware.some((h) => h.category === '경첩')).toBe(true);
  });

  test('전용 화면이 만든 type 모듈(옛 설계)은 예전 규칙 그대로 — 키큰장 선반 3', () => {
    const legacy = snapshotOf(fridgeDesign([
      { id: 1, type: 'fridge', name: '냉장고', w: 600, h: 1800, d: 680 },
      { id: 2, type: 'tall', name: '키큰장', w: 600, h: 2140, d: 550, doorCount: 1 },
    ]));
    const shelf = legacy.materials.find((m) => m.module === '키큰장' && m.part === '선반');
    expect(shelf && shelf.qty).toBe(3);
    expect(legacy.materials.some((m) => m.module === '냉장고')).toBe(false);
  });
});

describe('브리지 — 냉장고장 모듈 몸통 = 전체 − 상몰딩', () => {
  test('위장 415 (355 + 상몰딩 60) → 몸통 355', () => {
    const { modules } = _convertPlannerModules({
      modules: [{ id: 'fridge-0', section: 'fridge', part: '상부장', W: 680, H: 415, D: 670, x: 0, y: 0 }],
      structures: { 'fridge-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [680], areaIs2D: [true], shelves: [], moldingH: 60, pedestalH: 0 } },
    }, { moldingH: 60, sinkLegHeight: 150, topThickness: 12 });
    expect(modules).toHaveLength(1);
    expect(modules[0].pos).toBe('upper');
    expect(modules[0].h).toBe(355);
    expect(modules[0].heightParts).toEqual({ moldingH: 60 });
  });
});

describe('장 버튼 — 줄 끝에 이어 붙인다', () => {
  function placed(p) {
    return [...p.document.querySelectorAll('g.content > g.sect-rect')].map((g) => {
      const r = g.querySelector(':scope > rect');
      return {
        section: [...g.classList].find((c) => c !== 'sect-rect' && c !== 'selected'),
        x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'),
        rot: g.getAttribute('transform') || '',
      };
    });
  }
  const click = (p, sec) => p.document.querySelector(`.rect-btn[data-section="${sec}"]`).click();

  test('냉장고장 옆 키큰장 — 겹치지 않고 정면 그대로', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=fridge&w=1900&h=2310&d=700' });
    click(p, 'fridge');
    click(p, 'tall');
    const [f, t] = placed(p);
    expect(t.x).toBe(f.x + f.w);
    expect(t.y).toBe(f.y);
    expect(f.rot).toBe('');
    expect(t.rot).toBe('');
  });

  test('하부장 2400 뒤 키큰장은 2400 끝에, 상부장은 줄 처음에', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=sink' });
    click(p, 'lower');
    click(p, 'tall');
    click(p, 'upper');
    const [l, t, u] = placed(p);
    expect(t.x).toBe(l.x + l.w);
    expect(u.x).toBe(l.x);
    expect([l.rot, t.rot, u.rot]).toEqual(['', '', '']);
  });

  test('사람이 줄 앞 가운데로 온다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=t&item=1&preset=fridge' });
    click(p, 'fridge');
    click(p, 'tall');
    const [f, t] = placed(p);
    const c = p.document.querySelector('g.person circle');
    expect(+c.getAttribute('cx')).toBe((f.x + t.x + t.w) / 2);
  });
});

describe('냉장고장 위장 몸통 깊이 = 좌우 EP 깊이 − 25 (사장님 확정 "25를 뺀다", 2026-10-20)', () => {
  test('자리 700 (EP 700) → 몸통 675 · 자리 800 → 775', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    const area = p.g('areas').find((a) => a.section === 'fridge');
    expect(area.D).toBe(700);
    expect(p.g('MASTER_RULES').FRIDGE_UPPER_EP_MINUS).toBe(25);
    expect(p.g('addModuleToArea')(area.id, { section: 'fridge' }).D).toBe(675);
    const p2 = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    const area2 = p2.g('areas').find((a) => a.section === 'fridge');
    area2.D = 800;
    expect(p2.g('addModuleToArea')(area2.id, { section: 'fridge' }).D).toBe(775);
  });

  test('벽에 건다 — 부재·철물이 싱크대 상부장과 같다', () => {
    const up = PLANNER_MODULES[0];
    const fr = snapshotOf(fridgeDesign([up]));
    const sk = snapshotOf({ items: [{ categoryId: 'sink', w: 1900, h: 2310, d: 700, specs: SPECS, modules: [up] }] });
    const key = (r) => [
      r.materials.map((m) => [m.part, m.material, m.thickness, m.w, m.h, m.qty, m.note].join('|')).sort(),
      r.hardware.map((h) => [h.category, h.qty].join('|')).sort(),
    ];
    expect(key(fr)).toEqual(key(sk));
    expect(fr.hardware.some((h) => h.category === '브라켓')).toBe(true);
  });
});
