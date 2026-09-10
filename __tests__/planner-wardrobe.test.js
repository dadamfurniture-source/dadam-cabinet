/**
 * P11 (gen-to-planner): 붙박이장이 배치 단계 섹션이 됐다.
 *
 * 지키는 계약:
 *   1) 섹션 정본 — wardrobe 치수는 지어낸 값이 아니라 detaildesign 정본과 같다
 *      (w 3600 = ui-step1 defaultWByCategory, d 600 = data-constants defaultD, H 2310 = defaultH)
 *   2) 배치 단계가 wardrobe 사각형을 **버리지 않고** 복원·저장한다
 *   3) 구조 단계가 wardrobe 영역을 자동계산할 수 있고, 높이는 좌대 60 + 상몰딩 20 으로 분해된다
 *      (하부장 가지인 다리발 150 + 상판 12 로 떨어지면 몸통이 82 틀어진다)
 *   4) 연출컷 가져오기 토큰(dadam_gen_autocalc_v1::scope)이 있으면 자동계산이 **정확히 1회** 돈다
 *      — 토큰은 먼저 지워지고, 모듈이 이미 있으면 손대지 않는다
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { PLANNER_SECTIONS, STRUCTURE_ONLY_SECTIONS } = require('../js/planner/planner-sections');
const { getMoldingH, MASTER_RULES } = require('../js/planner/planner-engine');

const ROOT = path.join(__dirname, '..');
const SCOPE = '::d1:7';
const SAVED_AT = '2026-09-11T00:00:00.000Z';

function wardrobeLayout(w) {
  const s = PLANNER_SECTIONS.wardrobe;
  return {
    version: 1, savedAt: SAVED_AT, person: { cx: 1800, cy: 1500 },
    modules: [{ section: 'wardrobe', x: 0, y: 0, w: w || s.w, h: s.h, moduleH: s.moduleH, rotation: 0, finishings: [] }],
  };
}

function boot(file, opts) {
  const p = bootPlanner(file, Object.assign({ search: '?design=d1&item=7' }, opts));
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('섹션 정본', () => {
  test('wardrobe 치수는 detaildesign 정본과 같다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    const cat = src.match(/id:\s*'wardrobe'[^}]*defaultD:\s*(\d+)[^}]*defaultH:\s*(\d+)/);
    expect(cat).toBeTruthy();
    expect(PLANNER_SECTIONS.wardrobe.h).toBe(Number(cat[1]));          // 깊이 600
    expect(PLANNER_SECTIONS.wardrobe.moduleH).toBe(Number(cat[2]));    // 높이 2310
    const step1 = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
    const w = step1.match(/wardrobe:\s*(\d+)/);
    expect(PLANNER_SECTIONS.wardrobe.w).toBe(Number(w[1]));            // 폭 3600
  });

  test('상몰딩 20 = DEFAULT_SPECS.wardrobeMoldingH, 좌대 60 = wardrobePedestal', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    expect(src).toMatch(/wardrobeMoldingH:\s*20\b/);
    expect(src).toMatch(/wardrobePedestal:\s*60\b/);
    expect(getMoldingH('wardrobe')).toBe(20);
    expect(MASTER_RULES.CROWN_MOLDING_WARDROBE).toBe(20);
  });

  test('구조 전용 섹션은 비었다 — wardrobe 가 정본으로 올라갔다', () => {
    expect(STRUCTURE_ONLY_SECTIONS).toEqual({});
  });
});

describe('배치 단계', () => {
  test('저장된 wardrobe 사각형을 복원하고 다시 저장한다', () => {
    const p = boot('mockup-shell.html', {
      storage: { ['dadam_layout_v1' + SCOPE]: JSON.stringify(wardrobeLayout()) },
      session: { fromStructure: '1' },
    });
    const out = p.g('serializeLayout')();
    expect(out.modules.length).toBe(1);
    expect(out.modules[0]).toMatchObject({ section: 'wardrobe', w: 3600, h: 600, moduleH: 2310 });
  });

  test('도구막대에 붙박이장 버튼이 있다', () => {
    const p = boot('mockup-shell.html', {});
    expect(p.document.querySelector('.rect-btn[data-section="wardrobe"]')).toBeTruthy();
  });
});

describe('구조 단계', () => {
  const TOKEN = 'dadam_gen_autocalc_v1' + SCOPE;
  const storage = () => ({ ['dadam_layout_v1' + SCOPE]: JSON.stringify(wardrobeLayout()) });

  test('가져오기 토큰이 있으면 부팅 시 자동계산이 돌고 토큰은 사라진다', () => {
    const p = boot('mockup-structure.html', { storage: storage(), session: { [TOKEN]: '1' } });
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    const ws = payload.modules.filter((m) => m.section === 'wardrobe');
    expect(ws.length).toBeGreaterThan(1);                         // 3600 이 여러 모듈로 나뉜다
    expect(ws.reduce((s, m) => s + m.W, 0)).toBe(3600);
    expect(ws.every((m) => m.H === 2310)).toBe(true);
    expect(p.session.getItem(TOKEN)).toBeNull();
    const saved = JSON.parse(p.storage.getItem('dadam_struct_modules_v1' + SCOPE));
    expect(saved.layoutSavedAt).toBe(SAVED_AT);
    expect(saved.modules.length).toBe(ws.length);
  });

  test('높이는 좌대 60 + 상몰딩 20 으로 분해된다', () => {
    const p = boot('mockup-structure.html', { storage: storage(), session: { [TOKEN]: '1' } });
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    const m = payload.modules.find((x) => x.section === 'wardrobe');
    const parts = p.g('heightPartsOf')(m, payload.structures[m.id] || {});
    expect(parts.map((x) => [x.key, x.value])).toEqual([['pedestalH', 60], ['moldingH', 20]]);
  });

  test('토큰이 없으면 자동계산하지 않는다', () => {
    const p = boot('mockup-structure.html', { storage: storage() });
    expect(p.g('buildPlannerPayload')('PLANNER_STATE').modules.length).toBe(0);
  });

  test('토큰이 있어도 모듈이 이미 있으면 손대지 않는다', () => {
    const existing = {
      layoutSavedAt: SAVED_AT,
      modules: [{ id: 'wardrobe-1', areaId: 'area-wardrobe-0', section: 'wardrobe', W: 900, H: 2310, D: 570, x: 0, y: 0, rotation: 0, finishings: [] }],
    };
    const p = boot('mockup-structure.html', {
      storage: Object.assign(storage(), { ['dadam_struct_modules_v1' + SCOPE]: JSON.stringify(existing) }),
      session: { [TOKEN]: '1' },
    });
    const mods = p.g('buildPlannerPayload')('PLANNER_STATE').modules;
    expect(mods.length).toBe(1);
    expect(mods[0].W).toBe(900);
    expect(p.session.getItem(TOKEN)).toBeNull();                  // 그래도 토큰은 소비된다
  });

  test('붙박이장 영역에 놓을 수 있는 섹션 목록에 wardrobe 가 있다', () => {
    const p = boot('mockup-structure.html', { storage: storage() });
    const area = p.g('areas')[0];
    expect(area.section).toBe('wardrobe');
    expect(p.g('sectionsFor')(area)).toContain('wardrobe');
  });
});
