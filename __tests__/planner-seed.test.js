/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, afterEach, jest, __dirname, global */
/**
 * 씨앗 패널 — js/planner/planner-seed.js (2026-10-25 사장님: "내가 자주 하는 구성 저장").
 *
 * 1. 지금 구조 → 씨앗 (서명·폭·앵커만, 요약·기본 이름, 자동계산과 같은지)
 * 2. 저장한 씨앗 → 자동완성 패널 — plannerGenomeImpute 가 씨앗 구성을 제안한다
 * 3. 관리자만: 버튼 숨김/보임, 관리자가 아니면 저장하지 않는다
 * 4. 저장 흐름: 이름 받기 → genome_seed_panel insert (행 모양), 표가 없을 때 할 일을 말한다
 * 5. 구조 페이지 배선 (버튼 · 스크립트 순서 · onAdmin)
 */
const fs = require('fs');
const path = require('path');
const G = require('../js/planner/planner-genome.js');
const S = require('../js/planner/planner-seed.js');
const DrawerRules = require('../js/detaildesign/bom-drawer-rules.js');

const cell = (W, dir, is2D) => ({ moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir], areaWidths: [W], areaIs2D: [!!is2D] });
const drawer = (W, ratio, rail, boxT) => {
  const r = DrawerRules.gradesFromRatio(ratio, { topDrawer: true });
  return Object.assign(cell(W, 'left'), { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: r.drawerCount, drawer: { rail, sakuri: true, boxT, grades: r.grades, doorGrade: r.doorGrade, topDrawer: true } });
};
// 하부: 양문 900(개수대) · 서랍장 600 · 단문 450 / 상부: 양문 900(후드) · 단문 450
function design(lowerMiddle) {
  return {
    modules: [
      { id: 'lower-0', areaId: 'area-lower-0', section: 'lower', x: 0, W: 900 },
      { id: 'lower-1', areaId: 'area-lower-0', section: 'lower', x: 900, W: 600 },
      { id: 'lower-2', areaId: 'area-lower-0', section: 'lower', x: 1500, W: 450 },
      { id: 'upper-0', areaId: 'area-upper-0', section: 'upper', x: 0, W: 900 },
      { id: 'upper-1', areaId: 'area-upper-0', section: 'upper', x: 900, W: 450 },
      { id: 'sink-0', areaId: 'area-sink-0', section: 'sink', x: 100, W: 700 },
      { id: 'hood-0', areaId: 'area-hood-0', section: 'hood', x: 0, W: 900 },
      { id: 'ep-0', areaId: 'area-lower-0', section: 'ep', x: 1950, W: 20, isFinishing: true },
    ],
    structures: {
      'lower-0': cell(900, 'left', true),
      'lower-1': lowerMiddle || drawer(600, '2:1:1', 'ball', 18),
      'lower-2': cell(450, 'right'),
      'upper-0': cell(900, 'left', true),
      'upper-1': cell(450, 'left'),
    },
  };
}

describe('지금 구조 → 씨앗', () => {
  test('서명 · 폭 · 앵커 · 고정만 담는다 (마감재 · 가전 자리는 좌위가 아니다)', () => {
    const d = design();
    const rec = S.plannerSeedRecord(d.modules, d.structures, { doorWMax: 600 });
    expect(rec.problems).toEqual([]);
    expect(rec.lines).toEqual([
      { section: 'lower', loci: [
        { W: 900, sig: 'D2', anchors: ['sink'], fixed: false },
        { W: 600, sig: 'DR:2:1:1|ball|18|sk', anchors: [], fixed: false },
        { W: 450, sig: 'D1/R', anchors: [], fixed: false },
      ] },
      { section: 'upper', loci: [
        { W: 900, sig: 'D2', anchors: ['hood'], fixed: false },
        { W: 450, sig: 'D1/L', anchors: [], fixed: false },
      ] },
    ]);
  });

  test('요약은 자동계산과 다른 선택만 이름으로 적는다', () => {
    const d = design();
    const rec = S.plannerSeedRecord(d.modules, d.structures, { doorWMax: 600 });
    expect(rec.summary).toBe('하부 3 · 상부 2 — 서랍장 2:1:1 볼레일 18T, 도어 오른쪽 경첩');
    expect(rec.defaultName).toBe('하부 1,950 구성');
    expect(rec.informative).toBe(true);
  });

  test('모두 자동계산 기본값이면 배울 것이 없다고 표시한다', () => {
    const d = design(cell(600, 'left'));
    d.structures['lower-2'] = cell(450, 'left');
    const rec = S.plannerSeedRecord(d.modules, d.structures, { doorWMax: 600 });
    expect(rec.informative).toBe(false);
  });

  test('장이 없으면 저장을 막는다', () => {
    expect(S.plannerSeedRecord([], {}, { doorWMax: 600 }).problems[0]).toMatch(/배치된 장이 없습니다/);
  });

  test('서명 이름', () => {
    expect(S.plannerSeedAlleleName('T:SRD-SW/R')).toBe('키큰장 서랍·밥솥장(여닫이)·도어');
    expect(S.plannerSeedAlleleName('D1/U')).toBe('플랩');
    expect(S.plannerSeedAlleleName('OPEN')).toBe('오픈장');
  });
});

describe('씨앗 → 자동완성 패널', () => {
  test('씨앗만 있는 새 계정에서 자동계산 직후 자리를 씨앗 구성으로 제안한다', () => {
    const d = design();
    const rec = S.plannerSeedRecord(d.modules, d.structures, { doorWMax: 600 });
    const panel = S.plannerSeedPanel([{ id: 'seed-1', lines: rec.lines }]);
    expect(panel).toHaveLength(2);
    expect(panel[0]).toMatchObject({ own: false, seed: 'seed-1' });
    expect(panel[0].line.loci[2].allele).toEqual({ sig: 'D1/R', type: 'D1', hinge: 'right' });
    // 같은 폭·앵커의 새 하부 라인, 구조는 모두 가림
    const g = G.plannerGenomeOf(design());
    const lower = g.lines.find((l) => l.section === 'lower');
    const query = { section: 'lower', loci: lower.loci.map((l) => Object.assign({}, l, { allele: null })) };
    const r = G.plannerGenomeImpute(query, panel, { k: 1 });
    expect(r.loci.map((l) => l.best)).toEqual(['D2', 'DR:2:1:1|ball|18|sk', 'D1/R']);
  });
});

describe('관리자만', () => {
  let saveButton, menuButton, menu;
  beforeEach(() => {
    document.body.innerHTML = '<button id="s"></button><button id="m"></button><div id="menu"></div>';
    saveButton = document.getElementById('s');
    menuButton = document.getElementById('m');
    menu = document.getElementById('menu');
  });

  test('처음엔 숨기고, 관리자라고 알려 주면 보인다', () => {
    S.PlannerSeed.mount({ saveButton, menuButton, menu, state: () => design() });
    expect(saveButton.hidden).toBe(true);
    expect(menuButton.hidden).toBe(true);
    S.PlannerSeed.setAdmin(true);
    expect(saveButton.hidden).toBe(false);
    S.PlannerSeed.setAdmin(false);
    expect(saveButton.hidden).toBe(true);
    expect(menu.hidden).toBe(true);
  });

  test('관리자가 아니면 저장하지 않는다', async () => {
    S.PlannerSeed.mount({ saveButton, menuButton, menu, state: () => design() });
    S.PlannerSeed.setAdmin(false);
    expect(await S.PlannerSeed.save()).toBeNull();
  });
});

describe('저장 흐름', () => {
  let inserted, toasts, insertError;
  beforeEach(() => {
    inserted = null; toasts = []; insertError = null;
    global.PlannerStore = {
      session: async () => ({ ok: true, client: { from: (t) => ({ insert: async (row) => { inserted = { t, row }; return { error: insertError }; } }) } }),
    };
    global.prompt = jest.fn(() => '  I자 1950 개수대 왼쪽  ');
    global.confirm = jest.fn(() => true);
    S.PlannerSeed.mount({ state: () => design(), doorWMax: 600, toast: (t) => toasts.push(t) });
    S.PlannerSeed.setAdmin(true);
  });
  afterEach(() => { delete global.PlannerStore; delete global.prompt; delete global.confirm; });

  test('이름을 받아 genome_seed_panel 에 넣는다', async () => {
    const r = await S.PlannerSeed.save();
    expect(r.ok).toBe(true);
    expect(inserted.t).toBe('genome_seed_panel');
    expect(inserted.row).toMatchObject({ name: 'I자 1950 개수대 왼쪽', genome_version: 1, source_design_id: null });
    expect(inserted.row.lines[0].loci[1].sig).toBe('DR:2:1:1|ball|18|sk');
    expect(inserted.row.summary).toMatch(/서랍장 2:1:1/);
    expect(toasts.pop()).toBe('🌱 씨앗 저장 — I자 1950 개수대 왼쪽');
    expect(global.confirm).not.toHaveBeenCalled();   // 배울 것이 있는 구성이면 묻지 않는다
  });

  test('이름 칸에서 취소하면 저장하지 않는다', async () => {
    global.prompt = jest.fn(() => null);
    expect(await S.PlannerSeed.save()).toBeNull();
    expect(inserted).toBeNull();
  });

  test('표가 아직 없으면 실행할 SQL 파일을 알려 준다', async () => {
    insertError = { code: 'PGRST205', message: "Could not find the table 'public.genome_seed_panel' in the schema cache" };
    const r = await S.PlannerSeed.save();
    expect(r.ok).toBe(false);
    expect(toasts.pop()).toMatch(/database\/genome-seed-panel\.sql/);
  });

  test('관리자 권한이 없다고 DB 가 막으면 그렇게 말한다', () => {
    expect(S.plannerSeedExcuse({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/관리자 계정만/);
  });
});

describe('구조 페이지 배선', () => {
  const html = fs.readFileSync(path.join(__dirname, '../mockup-structure.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]);

  test('관리자 버튼 두 개와 메뉴가 숨김으로 있다', () => {
    expect(html).toMatch(/id="seedSaveBtn" hidden/);
    expect(html).toMatch(/id="seedMenuBtn" hidden/);
    expect(html).toMatch(/#seedSaveBtn\[hidden\],#seedMenuBtn\[hidden\]\{display:none\}/);
  });
  test('planner-store.js · planner-genome.js 뒤에 planner-seed.js 가 실린다', () => {
    expect(srcs.indexOf('js/planner/planner-store.js')).toBeLessThan(srcs.indexOf('js/planner/planner-seed.js'));
    expect(srcs.indexOf('js/planner/planner-genome.js')).toBeLessThan(srcs.indexOf('js/planner/planner-seed.js'));
  });
  test('역할은 PlannerExport 의 onAdmin 이 같이 넘기고, 씨앗은 그보다 먼저 붙인다', () => {
    expect(html).toMatch(/onAdmin: \(on\) => \{ PlannerCadCheck\.setAdmin\(on\); PlannerSeed\.setAdmin\(on\); \}/);
    expect(html.indexOf('PlannerSeed.mount(')).toBeLessThan(html.indexOf('PlannerExport.mount('));
  });
});
