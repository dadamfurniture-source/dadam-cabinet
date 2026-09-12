/**
 * W12-72: 선택은 **보고 있는 화면을 건드리지 않는다.**
 *
 *   확대해 놓고 모듈을 하나 누르면 줌·카메라가 매번 초기화됐다. 원인은
 *   setActiveArea 가 "다른 영역으로 옮길 때" 무조건 화면을 맞춘 것이다 —
 *   도면에서 모듈을 누를 때도 (영역이 같이 바뀌며) 그 길을 탔다.
 *
 *   이제 맞춤은 **사람이 자리를 옮길 때**만이다: 좌측 '배치' 목록, '배치' 탭.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(fx) {
  const s = Object.assign({}, seedFor(fx)); const search = s._search; delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}
const snapView = (p) => Object.assign({}, p.g('view'));

describe('선택이 뷰 거리를 초기화하지 않는다', () => {
  test('영역을 바꿔도 줌·팬이 그대로다 — 기본값은 맞추지 않는 것', () => {
    const p = boot(FIXTURES.lShape);
    const v = p.g('view');
    v.zoom = 0.42; v.panX = 137; v.panY = -88;
    const before = snapView(p);
    const other = p.g('areas').find((a) => a.id !== p.g('activeAreaId'));
    p.g('setActiveArea')(other.id);
    expect(snapView(p)).toEqual(before);
  });

  test("'배치' 목록에서 고를 때만 맞춘다 — 그건 자리를 옮기는 동작이다", () => {
    const p = boot(FIXTURES.lShape);
    const v = p.g('view');
    v.zoom = 0.42; v.panX = 137; v.panY = -88;
    const other = p.g('areas').find((a) => a.id !== p.g('activeAreaId'));
    p.g('setActiveArea')(other.id, { fit: true });
    expect(p.g('view').zoom).not.toBe(0.42);
  });

  test('모듈을 골라도 줌·팬이 그대로다', () => {
    const p = boot(FIXTURES.lShape);
    p.g('setViewMode')('all');
    const v = p.g('view');
    v.zoom = 0.35; v.panX = 40; v.panY = 60;
    const before = snapView(p);
    p.g('modules').forEach((m) => p.g('setActiveModule')(m.id));
    expect(snapView(p)).toEqual(before);
  });

  test("'전체' 보기에서 모듈을 골라도 3D 카메라를 다시 맞추지 않는다 (2026-09-12)", () => {
    // renderFrontView 래퍼가 'all' 에서 renderAll3D() 를 fit 기본값으로 불러 카메라가 초기화됐다.
    // 맞춤 없는 호출(renderAll3D())은 '전체' 탭에 들어올 때(setViewMode) 하나뿐이어야 한다.
    const bare = (SRC.match(/renderAll3D\(\);/g) || []).length;
    expect(bare).toBe(1);
    const at = SRC.indexOf('renderFrontView = function()');
    expect(SRC.slice(at, at + 900)).not.toMatch(/renderAll3D\(\);/);
  });

  test('3D 도면 클릭은 fit 을 요청하지 않는다', () => {
    const at = SRC.indexOf('function handleEntityClick');
    const fn = SRC.slice(at, at + 700);
    expect(fn).toContain('setActiveArea(mesh.userData.areaId)');
    expect(fn).not.toContain('fit: true');
  });

  test('2D 영역 사각형 클릭도 마찬가지다', () => {
    expect(SRC).toContain("setActiveArea(a.id); });");
  });
});

describe('빈 공간을 누르면 선택이 풀린다', () => {
  test('clearActiveModule 이 선택을 비운다', () => {
    // activeId 는 원시값이라 하네스 스냅샷이 낡는다 — 화면으로 본다.
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const id = p.g('modules')[1].id;
    p.g('setActiveModule')(id);
    expect(p.document.querySelector(`#contentG [data-module-id="${id}"]`).getAttribute('stroke'))
      .toBe('var(--pick, #1d6fe0)');
    expect(p.g('clearActiveModule')()).toBe(true);
    expect(p.document.querySelector(`#contentG [data-module-id="${id}"]`).getAttribute('stroke'))
      .not.toBe('var(--pick, #1d6fe0)');
  });

  test('풀리면 파란 테두리가 하나도 남지 않는다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    p.g('setActiveModule')(p.g('modules')[1].id);
    p.g('clearActiveModule')();
    const blue = [...p.document.querySelectorAll('#contentG [data-module-id]')]
      .filter((r) => r.getAttribute('stroke') === 'var(--pick, #1d6fe0)');
    expect(blue).toHaveLength(0);
    expect(p.document.getElementById('curModuleName').textContent).toBe('모듈을 선택하세요');
  });

  test('영역 선택은 건드리지 않는다 — 배치 공간은 배경이다', () => {
    const p = boot(FIXTURES.lShape);
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    p.g('setActiveModule')(p.g('modules')[0].id);
    p.g('clearActiveModule')();
    // 영역 보기가 유지된다 = activeAreaId 가 살아 있다는 관찰 가능한 증거
    expect(p.g('isAreaView')()).toBe(true);
    p.g('setViewMode')('area');
    expect(p.document.querySelector('#mlBody [data-area-pick].active').getAttribute('data-area-pick'))
      .toBe(area.id);
  });

  test('고른 것이 없으면 아무 일도 하지 않는다', () => {
    const p = boot(FIXTURES.straight);
    p.g('clearActiveModule')();
    expect(p.g('clearActiveModule')()).toBe(false);
  });

  test('3D 는 아무것도 안 맞았을 때 푼다', () => {
    const at = SRC.indexOf('const picked = pickEntityHit(hits);');
    // 2026-09-12: 모듈만이 아니라 배치까지 — 처음 상태로
    expect(SRC.slice(at, at + 400)).toContain('else { clearHighlight(); clearSelection(); }');
  });

  test('2D 는 배경 클릭에서 푼다 — 팬으로 넘어간 드래그는 클릭이 아니다', () => {
    const at = SRC.indexOf("svg.addEventListener('click'");
    expect(at).toBeGreaterThan(-1);
    const fn = SRC.slice(at, at + 220);
    expect(fn).toContain('panInfo.moved');
    expect(fn).toContain('clearSelection()');
  });
});

describe('도면 불러오기 메뉴는 저장 버튼을 감추지 않는다', () => {
  test('쓸 수 없는 상태여도 단계·저장 버튼을 그린다', () => {
    const at = SRC.indexOf('async function renderMenu');
    const fn = SRC.slice(at, at + 1800);
    // 예전엔 여기서 안내 한 줄만 남기고 return 했다 — 저장 버튼이 사라졌다.
    expect(fn).not.toMatch(/menu\.innerHTML = `<div class="lm-note">\$\{esc\(storeExcuse/);
    expect(fn).toContain('data-save=');
    expect(fn).toContain('disabled title=');
  });

  test('비활성 버튼 스타일이 있다', () => {
    expect(SRC).toContain('.load-menu .lm-stage button:disabled{opacity:.4;cursor:not-allowed}');
  });
});

describe('첫 클릭은 배치, 두 번째 클릭은 모듈 (2026-09-12)', () => {
  const title = (p) => p.document.querySelector('.panel-header-title').textContent;
  const carcass = (id) => ({ userData: { entityKind: 'carcass', moduleId: id } });

  test("'전체' 보기에서 모듈을 누르면 그 배치가 먼저 선택된다", () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');           // activeAreaId 가 비워진다
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(carcass(m.id));
    expect(title(p)).toBe('영역 편집');
    expect(p.document.getElementById('curModuleName').textContent).not.toContain(p.g('moduleTag')(m));
  });

  test('한 번 더 누르면 모듈이 선택된다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(carcass(m.id));
    p.g('handleEntityClick')(carcass(m.id));
    expect(title(p)).toBe('구조 편집');
    expect(p.document.querySelector(`#contentG [data-module-id="${m.id}"]`).getAttribute('stroke'))
      .toBe('var(--pick, #1d6fe0)');
  });

  test('같은 배치 안의 다른 모듈은 바로 선택된다', () => {
    // 골든은 사각형 하나가 영역 하나라 같은 영역에 모듈이 둘인 상태를 직접 만든다
    const p = boot(FIXTURES.straight);
    const area = p.g('areas').find((a) => a.section === 'lower');
    const a1 = p.g('addModuleToArea')(area.id, { W: 500, x: area.x });
    const a2 = p.g('addModuleToArea')(area.id, { W: 500, x: area.x + 500 });
    p.g('setViewMode')('all');
    p.g('handleEntityClick')(carcass(a1.id));   // 배치
    p.g('handleEntityClick')(carcass(a1.id));   // 모듈
    p.g('handleEntityClick')(carcass(a2.id));   // 같은 배치 → 바로 모듈
    expect(title(p)).toBe('구조 편집');
    expect(p.document.querySelector(`#contentG [data-module-id="${a2.id}"]`).getAttribute('stroke'))
      .toBe('var(--pick, #1d6fe0)');
  });

  test('다른 배치의 모듈을 누르면 다시 배치부터다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const lower = p.g('modules').find((x) => x.section === 'lower');
    const upper = p.g('modules').find((x) => x.section === 'upper');
    p.g('handleEntityClick')(carcass(lower.id));
    p.g('handleEntityClick')(carcass(lower.id));
    p.g('handleEntityClick')(carcass(upper.id));
    expect(title(p)).toBe('영역 편집');
  });

  test('배치를 골라도 줌·팬은 그대로다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const v = p.g('view');
    v.zoom = 0.33; v.panX = 51; v.panY = 77;
    const before = snapView(p);
    p.g('handleEntityClick')(carcass(p.g('modules')[1].id));
    expect(snapView(p)).toEqual(before);
  });
});

describe('배치 선택 표시와 처음 상태 (2026-09-12)', () => {
  const carcass = (id) => ({ userData: { entityKind: 'carcass', moduleId: id } });
  const pickedRect = (p) => p.document.querySelector('#contentG rect[data-area-id][data-picked="1"]');

  test('첫 클릭으로 배치가 선택되면 파란 테두리와 이름표가 뜬다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(carcass(m.id));
    const r = pickedRect(p);
    expect(r).not.toBeNull();
    expect(r.getAttribute('stroke')).toBe('var(--pick, #1d6fe0)');
    expect(p.document.getElementById('curModuleName').textContent).toMatch(/^배치: /);
  });

  test('모듈을 고르면 배치 표시는 배경 강조로 돌아간다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(carcass(m.id));
    p.g('handleEntityClick')(carcass(m.id));
    expect(pickedRect(p)).toBeNull();
    expect(p.document.getElementById('curModuleName').textContent).not.toMatch(/^배치: /);
  });

  test('빈 곳을 누르면 모듈·배치가 모두 풀린다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(carcass(m.id));
    p.g('handleEntityClick')(carcass(m.id));
    expect(p.g('clearSelection')()).toBe(true);
    expect(pickedRect(p)).toBeNull();
    expect(p.document.querySelector('.area-tools')).toBeNull();
    expect(p.document.getElementById('curModuleName').textContent).toBe('모듈을 선택하세요');
    expect(p.document.querySelector('.empty-msg')).not.toBeNull();
    const blue = [...p.document.querySelectorAll('#contentG [data-module-id]')]
      .filter((r) => r.getAttribute('stroke') === 'var(--pick, #1d6fe0)');
    expect(blue).toHaveLength(0);
    expect(p.g('clearSelection')()).toBe(false);   // 이미 처음 상태
  });

  test('풀어도 줌·팬은 그대로다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    p.g('handleEntityClick')(carcass(p.g('modules')[1].id));
    const v = p.g('view');
    v.zoom = 0.31; v.panX = 12; v.panY = 34;
    const before = snapView(p);
    p.g('clearSelection')();
    expect(snapView(p)).toEqual(before);
  });
});
