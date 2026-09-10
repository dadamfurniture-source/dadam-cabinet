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
    expect(SRC.slice(at, at + 400)).toContain('else { clearHighlight(); clearActiveModule(); }');
  });

  test('2D 는 배경 클릭에서 푼다 — 팬으로 넘어간 드래그는 클릭이 아니다', () => {
    const at = SRC.indexOf("svg.addEventListener('click'");
    expect(at).toBeGreaterThan(-1);
    const fn = SRC.slice(at, at + 220);
    expect(fn).toContain('panInfo.moved');
    expect(fn).toContain('clearActiveModule()');
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
