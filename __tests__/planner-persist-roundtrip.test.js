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

describe('우측 패널 조작이 저장된다 (W12-29)', () => {
  /** 모듈 하나를 고른 상태로 우측 패널을 그린다 */
  function panel() {
    const { p, m } = withModule();
    p.g('setActiveModule')(m.id);
    p.g('renderRightPanel')();
    return { p, m, doc: p.document };
  }
  const fire = (el, type) => { el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true })); };

  test('좌우 분할', () => {
    const { p, m, doc } = panel();
    const inp = doc.getElementById('inpVCount');
    inp.value = '3';
    inp.onchange({ target: inp });
    expect(reboot(p).g('getStructure')(m.id).verticalCount).toBe(3);
  });

  test('상하 구성', () => {
    const { p, m, doc } = panel();
    const sel = doc.getElementById('selHLayout');
    sel.value = 'doorTopDrawerBottom';
    sel.onchange({ target: sel });
    expect(reboot(p).g('getStructure')(m.id).horizontalLayout).toBe('doorTopDrawerBottom');
  });

  test('하부 영역 높이', () => {
    const { p, m, doc } = panel();
    const sel = doc.getElementById('selHLayout');
    sel.value = 'doorTopDrawerBottom';
    sel.onchange({ target: sel });
    const inp = p.document.getElementById('inpDrawerH');
    inp.value = '250';
    inp.onchange({ target: inp });
    expect(reboot(p).g('getStructure')(m.id).drawerHeight).toBe(250);
  });

  test('영역 타입', () => {
    const { p, m, doc } = panel();
    const sel = doc.querySelector('#areasBody .a-type');
    sel.value = 'drawer';
    sel.onchange({ target: sel });
    expect(reboot(p).g('getStructure')(m.id).areaTypes[0]).toBe('drawer');
  });

  test('도어 방향', () => {
    const { p, m, doc } = panel();
    const sel = doc.querySelector('#areasBody .a-dir');
    if (!sel) return;                       // 양문이면 select 가 없다
    sel.value = 'right';
    sel.onchange({ target: sel });
    expect(reboot(p).g('getStructure')(m.id).areaDirections[0]).toBe('right');
  });

  // reboot 은 새 jsdom 을 만든다 — DOM 조작을 끝낸 뒤 한 번만 부른다.
  test('선반 위치', () => {
    const { p, m, doc } = panel();
    const inp = doc.querySelector('#shelvesBody input[type="number"]');
    inp.value = '420';
    inp.onchange({ target: inp });
    expect(reboot(p).g('getStructure')(m.id).shelves[0]).toBe(420);
  });

  test('선반 추가', () => {
    const { p, m, doc } = panel();
    const before = p.g('getStructure')(m.id).shelves.length;
    doc.getElementById('addShelf').onclick();
    expect(reboot(p).g('getStructure')(m.id).shelves.length).toBe(before + 1);
  });

  test('선반 삭제', () => {
    const { p, m, doc } = panel();
    const before = p.g('getStructure')(m.id).shelves.length;
    expect(before).toBeGreaterThan(0);
    doc.querySelector('#shelvesBody button.del').onclick();
    expect(reboot(p).g('getStructure')(m.id).shelves.length).toBe(before - 1);
  });

  test('손잡이 타입·위치 — 3D 형상을 바꾸는 값이다', () => {
    const { p, m, doc } = panel();
    const t = doc.getElementById('selHType');
    t.value = 'alu-channel';
    t.onchange({ target: t });
    const pos = p.document.getElementById('selHPos');
    pos.value = 'middle';
    pos.onchange({ target: pos });
    const s2 = reboot(p).g('getStructure')(m.id);
    expect(s2.handleType).toBe('alu-channel');
    expect(s2.handlePosition).toBe('middle');
  });

  test('손잡이를 바꾸면 형상 계산이 바로 따라온다', () => {
    const { p, m, doc } = panel();
    const s = p.g('getStructure')(m.id);
    expect(p.g('doorTopGapOf')(m, s)).toBe(30);   // 하부장 기본 = 목찬넬
    const t = doc.getElementById('selHType');
    t.value = 'push';
    t.onchange({ target: t });
    expect(p.g('doorTopGapOf')(m, p.g('getStructure')(m.id))).toBe(0);
  });
});

describe('타이핑 중 셀 폭이 사라지지 않는다 (W12-29)', () => {
  test('분할 입력은 onchange 다 — oninput 이면 한 글자마다 비운다', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    const body = SRC.slice(SRC.indexOf("getElementById('splitBody')"), SRC.indexOf("서랍 단수 — 예전엔"));
    expect(body).toContain("getElementById('inpVCount').onchange");
    expect(body).not.toContain("getElementById('inpVCount').oninput");
    expect(body).not.toContain('inpDr.oninput');
  });

  test('선반 입력도 onchange 다', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    const body = SRC.slice(SRC.indexOf("#shelvesBody input[type=\"number\"]"), SRC.indexOf("#shelvesBody button.del"));
    expect(body).toContain('inp.onchange');
    expect(body).not.toContain('inp.oninput');
  });

  test('panelCommit 이 저장·정면도·패널을 한 벌로 묶는다', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    const fn = SRC.slice(SRC.indexOf('function panelCommit'), SRC.indexOf('function renderHeightPanel'));
    ['persistPlannerState()', 'renderFrontView()', 'renderRightPanel()'].forEach((k) => expect(fn).toContain(k));
  });
});
