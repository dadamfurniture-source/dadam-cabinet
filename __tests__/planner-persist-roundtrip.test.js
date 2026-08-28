/**
 * W12-28: 편집한 값이 새로고침을 견디는가 (저장 왕복).
 *
 * `persistPlannerState()` 는 `saveStructures()` 와 `saveLayoutFromModules()` 만
 * 불렀다. 그런데 `modules` 배열(m.W/H/D/x/isFixed)의 정본 저장소는
 * **MODULES_KEY** 이고 거기 쓰는 함수는 `saveStructModules()` 하나뿐이다.
 * `saveLayoutFromModules()` 는 `_srcIndex` 가 없으면 곧바로 false 로 빠지는데,
 * `addModuleToArea` 가 만든 모듈에는 `_srcIndex` 가 없다.
 *
 *   → 영역에 넣은 모듈의 치수 편집이 **어느 경로로도 새로고침을 못 견뎠다.**
 *
 * 이 파일은 "고치고 다시 열었을 때 그대로인가" 만 본다. 편집 UI 가 팔레트든
 * 우측 패널이든 상관없이 성립해야 하는 계약이다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

/** seedFor 는 `_search` 를 함께 준다 — 그걸 써야 저장 scope 가 맞는다. */
function boot(seed) {
  const storage = Object.assign({}, seed);
  const search = storage._search || '?design=gold&item=1';
  delete storage._search;
  const p = bootPlanner('mockup-structure.html', { search, storage });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p._search = search;
  return p;
}

/** 저장소를 그대로 넘겨 다시 부팅한다 — 새로고침과 같다. */
function reboot(p) {
  return boot(Object.assign(p.storage._dump(), { _search: p._search }));
}

/** 영역 하나에 하부장 모듈을 넣은 상태 */
function withModule() {
  const p = boot(seedFor(FIXTURES.straight, { modules: false }));
  const area = p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id, { section: 'lower', W: 600, x: area.x || 0 });
  expect(m).not.toBeNull();
  return { p, area, m };
}

describe('모듈 치수가 새로고침을 견딘다', () => {
  test('폭 변경이 남는다', () => {
    const { p, m } = withModule();
    m.W = 777;
    p.g('persistPlannerState')();
    const again = reboot(p);
    const back = again.g('modules').find((x) => x.id === m.id);
    expect(back).toBeDefined();
    expect(back.W).toBe(777);
  });

  test('높이·깊이도 남는다', () => {
    const { p, m } = withModule();
    m.H = 910; m.D = 601;
    p.g('persistPlannerState')();
    const back = reboot(p).g('modules').find((x) => x.id === m.id);
    expect(back.H).toBe(910);
    expect(back.D).toBe(601);
  });

  test('고정 표시가 남는다', () => {
    const { p, m } = withModule();
    m.isFixed = true;
    p.g('persistPlannerState')();
    const back = reboot(p).g('modules').find((x) => x.id === m.id);
    expect(back.isFixed).toBe(true);
  });

  test('모듈이 통째로 사라지지 않는다', () => {
    const { p } = withModule();
    p.g('persistPlannerState')();
    expect(reboot(p).g('modules').length).toBeGreaterThan(0);
  });
});

describe('구조 값도 새로고침을 견딘다', () => {
  test('분할 수와 도어 방향이 남는다', () => {
    const { p, m } = withModule();
    const s = p.g('getStructure')(m.id);
    p.g('syncCellArrays')(s, 2);
    s.areaDirections[1] = 'right';
    p.g('persistPlannerState')();
    const s2 = reboot(p).g('getStructure')(m.id);
    expect(s2.verticalCount).toBe(2);
    expect(s2.areaDirections[1]).toBe('right');
  });

  test('손잡이가 남는다 — 3D 형상을 바꾸는 값이다', () => {
    const { p, m } = withModule();
    const s = p.g('getStructure')(m.id);
    s.handleType = 'push';
    p.g('persistPlannerState')();
    expect(reboot(p).g('getStructure')(m.id).handleType).toBe('push');
  });

  test('선반 위치가 남는다', () => {
    const { p, m } = withModule();
    const s = p.g('getStructure')(m.id);
    s.shelves = [300, 500];
    p.g('persistPlannerState')();
    expect(reboot(p).g('getStructure')(m.id).shelves).toEqual([300, 500]);
  });
});

describe('저장 순서 — 도장이 어긋나면 모듈이 전멸한다', () => {
  // saveLayoutFromModules() 는 layout.savedAt 을 갱신한다. loadStructModules() 는
  // 그 값(currentLayoutStamp)으로 모듈 소속을 판정하므로, 배치를 되쓴 **뒤에**
  // 모듈을 저장해야 새 도장으로 찍힌다. 순서가 뒤집히면 다음 새로고침에 modules=[] 이 된다.
  test('예전 방식으로 열린 설계도 편집 후 살아남는다', () => {
    const p = boot(seedFor(FIXTURES.straight));   // 레거시 경로 (_srcIndex 있음)
    const before = p.g('modules').length;
    expect(before).toBeGreaterThan(0);
    p.g('modules')[0].W = 888;
    p.g('persistPlannerState')();
    const again = reboot(p);
    expect(again.g('modules').length).toBe(before);
    expect(again.g('modules')[0].W).toBe(888);
  });

  test('persistPlannerState 가 세 저장을 모두 부른다', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    const fn = SRC.slice(SRC.indexOf('function persistPlannerState'), SRC.indexOf('function getStructure'));
    expect(fn).toContain('saveStructures()');
    expect(fn).toContain('saveLayoutFromModules()');
    expect(fn).toContain('saveStructModules()');
    // 배치를 되쓴 뒤에 모듈을 찍어야 도장이 맞는다
    expect(fn.indexOf('saveLayoutFromModules()')).toBeLessThan(fn.indexOf('saveStructModules()'));
  });
});
