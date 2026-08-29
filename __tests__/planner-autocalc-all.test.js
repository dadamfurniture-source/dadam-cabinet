/**
 * W12-46: 상단바의 "전체 자동계산" — 모든 배치 공간을 한 번에.
 *
 * 영역 도구의 `이 영역 자동계산`(autoCalcArea)을 영역마다 부르는 것과 같다.
 * 규칙을 새로 만들지 않는다 — 고정 모듈과 사람이 놓은 마감재는 autoCalcArea 가
 * 이미 보존한다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const st = Object.assign({}, seed);
  const search = st._search || '?design=aca&item=1';
  delete st._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: st });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const modsIn = (p, areaId) =>
  p.g('modules').filter((m) => m.areaId === areaId && !m.isFinishing);

describe('버튼이 상단바에 있다', () => {
  test('빈 상태에서도 버튼이 뜬다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const btn = p.document.getElementById('autoCalcAllBtn');
    expect(btn).not.toBeNull();
    expect(btn.closest('.topbar')).not.toBeNull();
    expect(btn.textContent).toContain('전체 자동계산');
  });

  test('누르면 동작한다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('modules').filter((m) => !m.isFinishing)).toHaveLength(0);
    p.document.getElementById('autoCalcAllBtn').onclick();
    expect(p.g('modules').filter((m) => !m.isFinishing).length).toBeGreaterThan(0);
  });
});

describe('모든 배치 공간을 채운다', () => {
  test('도어가 들어가는 영역은 모두 채운다', () => {
    // 도어 최소폭보다 좁은 영역은 autoCalcArea 가 원래 거절한다 — 그 규칙 그대로다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const areas = p.g('areas').filter((a) => !a.isFinishing);
    expect(areas.length).toBeGreaterThan(1);
    p.g('autoCalcAllAreas')();
    const wide = areas.filter((a) => a.W >= MIN);
    expect(wide.length).toBeGreaterThan(1);
    wide.forEach((a) => expect(modsIn(p, a.id).length).toBeGreaterThan(0));
  });

  test('너무 좁은 영역은 건너뛴다 — 다른 영역은 계속 채운다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const narrow = p.g('areas').filter((a) => !a.isFinishing && a.W < MIN);
    if (!narrow.length) return;
    const made = p.g('autoCalcAllAreas')();
    expect(made).toBeGreaterThan(0);                       // 한 곳이 막혀도 멈추지 않는다
    narrow.forEach((a) => expect(modsIn(p, a.id)).toHaveLength(0));
  });

  test('ㄱ자에서도 모든 영역을 채운다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const areas = p.g('areas').filter((a) => !a.isFinishing && a.W >= MIN);
    p.g('autoCalcAllAreas')();
    const empty = areas.filter((a) => modsIn(p, a.id).length === 0);
    expect(empty).toEqual([]);
  });

  test('만든 모듈 수를 돌려준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const n = p.g('autoCalcAllAreas')();
    expect(n).toBe(p.g('modules').filter((m) => !m.isFinishing).length);
  });

  test('마감재 영역은 건너뛴다 — 모듈을 담는 그릇이 아니다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const fin = p.g('areas').find((a) => a.isFinishing);
    if (!fin) return;
    p.g('autoCalcAllAreas')();
    expect(modsIn(p, fin.id)).toHaveLength(0);
  });

  test('배치 공간이 없으면 아무것도 안 한다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('areas').length = 0;
    expect(p.g('autoCalcAllAreas')()).toBe(0);
  });
});

describe('영역 하나씩 돌린 것과 같다', () => {
  test('결과가 같다', () => {
    const one = boot(seedFor(FIXTURES.lShape, { modules: false }));
    one.g('areas').filter((a) => !a.isFinishing).forEach((a) => one.g('autoCalcArea')(a.id));
    const all = boot(seedFor(FIXTURES.lShape, { modules: false }));
    all.g('autoCalcAllAreas')();
    const key = (p) => p.g('modules').map((m) => `${m.section}:${Math.round(m.x)}:${Math.round(m.W)}`).join('|');
    expect(key(all)).toBe(key(one));
  });

  test('고정 모듈은 보존된다 — autoCalcArea 규칙 그대로', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    const keep = p.g('addModuleToArea')(area.id, { section: 'lower', W: 500, x: area.x || 0 });
    keep.isFixed = true;
    p.g('autoCalcAllAreas')();
    const still = p.g('modules').find((m) => m.id === keep.id);
    expect(still).toBeTruthy();
    expect(still.W).toBe(500);
  });
});

describe('소스 규약', () => {
  test('규칙을 새로 만들지 않는다 — autoCalcArea 를 부른다', () => {
    const fn = SRC.slice(SRC.indexOf('function autoCalcAllAreas'), SRC.indexOf('function removeActiveModule'));
    expect(fn).toContain('autoCalcArea(a.id)');
    expect(fn).toContain("areas.filter((a) => !a.isFinishing)");
  });

  test('그리기는 한 번만 한다', () => {
    // 영역마다 다시 그리면 영역 수만큼 3D 를 새로 만든다.
    const fn = SRC.slice(SRC.indexOf('function autoCalcAllAreas'), SRC.indexOf('function removeActiveModule'));
    ['renderAreaTools()', 'renderModuleList()', 'renderFrontView()', 'renderRightPanel()'].forEach((call) => {
      expect((fn.match(new RegExp(call.replace('()', '\(\)'), 'g')) || []).length).toBe(1);
    });
    expect(fn.indexOf('renderFrontView()')).toBeGreaterThan(fn.indexOf('targets.forEach'));
  });

  test('버튼이 배선돼 있다', () => {
    expect(SRC).toContain("const btn = document.getElementById('autoCalcAllBtn');");
    expect(SRC).toContain('btn.onclick = () => autoCalcAllAreas();');
  });
});
