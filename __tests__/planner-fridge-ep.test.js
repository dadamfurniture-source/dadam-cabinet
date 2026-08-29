/**
 * W12-35: 냉장고장은 좌우에 EP 가 **기본**으로 선다.
 *
 * 냉장고장은 냉장고와 벽 사이에 세우는 장이라 옆면이 늘 드러난다 — 마감이
 * 없으면 몸통 PB 가 그대로 보인다. 나란한 장에 가려지는 다른 섹션과 다르다.
 *
 * 기본값이지 강제가 아니다. 사람이 '없음' 으로 뗀 것을 되살리지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const st = Object.assign({}, seed);
  const search = st._search || '?design=fep&item=1';
  delete st._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: st });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 냉장고장 영역 하나짜리 배치 */
function fridgeSeed() {
  return {
    'dadam_layout_v1::fep:1': JSON.stringify({
      version: 1, savedAt: '2026-01-01T00:00:00.000Z', person: { cx: 900, cy: 1500 },
      modules: [{ section: 'fridge', x: 0, y: 0, w: 900, h: 700, moduleH: 2300, rotation: 0, finishings: [] }],
    }),
  };
}

const finsOf = (p, areaId) =>
  p.g('modules').filter((m) => m.isFinishing && m.areaId === areaId);

/** 도구 패널의 '+ 모듈 추가' 를 실제로 누른다 */
function addViaTools(p, area) {
  p.g('setActiveArea')(area.id);
  const btn = p.document.querySelector('.area-tools .at-add');
  expect(btn).not.toBeNull();
  btn.onclick();
}

describe('냉장고장 영역', () => {
  test('첫 모듈을 넣으면 좌·우에 EP 가 선다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    expect(area).toBeTruthy();
    addViaTools(p, area);
    const fins = finsOf(p, area.id);
    expect(fins.map((f) => f.hostSide).sort()).toEqual(['left', 'right']);
    fins.forEach((f) => expect(f.section).toBe('ep'));
  });

  test('EP 는 배치 공간 높이·깊이 그대로다 (W12-18)', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    finsOf(p, area.id).forEach((f) => {
      expect(f.H).toBe(area.H);
      expect(f.D).toBe(area.D);
    });
  });

  test('모듈이 EP 폭만큼 내놓는다 — 영역 총 폭은 그대로다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    const total = p.g('modules')
      .filter((m) => m.areaId === area.id)
      .reduce((sum, m) => sum + m.W, 0);
    expect(total).toBeLessThanOrEqual(area.W);
    const host = p.g('modules').find((m) => m.areaId === area.id && !m.isFinishing);
    expect(host.W).toBeLessThan(area.W);
  });

  test('자동계산으로 채워도 선다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    p.g('autoCalcArea')(area.id);
    expect(finsOf(p, area.id).map((f) => f.hostSide).sort()).toEqual(['left', 'right']);
  });

  test('새로고침을 견딘다', () => {
    const seed = fridgeSeed();
    const p = boot(seed);
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    p.g('persistPlannerState')();
    const again = boot(Object.assign(p.storage._dump(), { _search: '?design=fep&item=1' }));
    expect(again.g('modules').filter((m) => m.isFinishing).map((f) => f.hostSide).sort())
      .toEqual(['left', 'right']);
  });
});

describe('기본값이지 강제가 아니다', () => {
  test('뗀 뒤에 모듈을 더 넣어도 되살아나지 않는다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    p.g('setAreaFinish')(area.id, 'left', '');
    expect(finsOf(p, area.id).map((f) => f.hostSide)).toEqual(['right']);
    addViaTools(p, area);            // 두 번째 모듈
    expect(finsOf(p, area.id).map((f) => f.hostSide)).toEqual(['right']);
  });

  test('이미 다른 마감재가 있으면 덮어쓰지 않는다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    p.g('setAreaFinish')(area.id, 'left', 'molding');
    p.g('applyDefaultAreaFinish')(area.id);
    const left = p.g('areaFinishOn')(area.id, 'left');
    expect(left.section).toBe('molding');
  });

  test('두 번 불러도 한 장씩이다 (멱등)', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    addViaTools(p, area);
    expect(p.g('applyDefaultAreaFinish')(area.id)).toBe(0);
    expect(finsOf(p, area.id).length).toBe(2);
  });
});

describe('다른 섹션은 그대로다', () => {
  test('하부장에는 기본 마감이 없다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    expect(area.section).toBe('lower');
    p.g('addModuleToArea')(area.id, { section: 'lower', W: 900, x: area.x || 0 });
    p.g('applyDefaultAreaFinish')(area.id);
    expect(p.g('modules').filter((m) => m.isFinishing).length).toBe(0);
  });

  test('모듈이 없으면 아무것도 세우지 않는다 — 폭을 내놓을 데가 없다', () => {
    const p = boot(fridgeSeed());
    const area = p.g('areas').find((a) => a.section === 'fridge');
    expect(p.g('applyDefaultAreaFinish')(area.id)).toBe(0);
    expect(p.g('modules').filter((m) => m.isFinishing).length).toBe(0);
  });
});

describe('소스 규약', () => {
  test('어느 섹션이 기본인지 한 곳에 적혀 있다', () => {
    expect(SRC).toContain("const DEFAULT_EP_SECTIONS = ['fridge'];");
  });

  test('이미 있는 마감은 건드리지 않는다', () => {
    const fn = SRC.slice(SRC.indexOf('function applyDefaultAreaFinish'),
                         SRC.indexOf('/** 영역 끝에 지금 붙어 있는 마감재'));
    expect(fn).toContain('if (areaFinishOn(areaId, side)) return;');
    expect(fn).toContain("modules.some((m) => m.areaId === areaId && !m.isFinishing)");
  });

  test('영역을 채운 뒤에 부른다 — 자동계산 두 갈래 모두', () => {
    // 마감재는 폭을 내놓을 모듈이 있어야 선다. 스택은 단들이 함께 내놓는다.
    expect((SRC.match(/applyDefaultAreaFinish\(/g) || []).length).toBe(4);  // 정의 1 + 호출 3
    const stack = SRC.slice(SRC.indexOf('function autoCalcStack'), SRC.indexOf('function orphanHostFinishings'));
    expect(stack).toContain('applyDefaultAreaFinish(area.id)');
  });

  test('손으로 넣을 때는 첫 모듈에만 붙인다', () => {
    const fn = SRC.slice(SRC.indexOf("on('.at-add'"), SRC.indexOf("on('.at-auto'"));
    expect(fn).toContain("const first = !modules.some((x) => x.areaId === area.id && !x.isFinishing);");
    expect(fn).toContain('if (m && first) applyDefaultAreaFinish(area.id);');
  });
});
