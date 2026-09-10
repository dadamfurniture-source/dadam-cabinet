/**
 * W12-70: 모듈을 고르면 **도면은 그대로 있고 파란 테두리만 옮겨간다.**
 *
 *   예전엔 고르는 순간 화면이 그 모듈 하나로 당겨졌다(fitToActiveModule).
 *   '전체' 탭을 거쳐 '개별' 탭으로 오면 아예 그 모듈만 원점에 크게 그렸다.
 *   어느 라인의 어디를 고치는 중인지 알 수 없었다.
 *
 *   이제 선택은 **표시**일 뿐이다 — 2D·3D 모두 파랑(--pick) 테두리로만 알린다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

const PICK = 'var(--pick, #1d6fe0)';

function boot(fixture) {
  const s = Object.assign({}, seedFor(fixture));
  const search = s._search; delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 정면도에서 그 모듈의 외곽 rect */
function outlineOf(p, id) {
  return p.document.querySelector(`#contentG [data-module-id="${id}"]`);
}
function drawnCount(p) {
  return p.document.querySelectorAll('#contentG [data-module-id]').length;
}

describe('선택색은 파랑이다', () => {
  test('--pick 토큰이 있고, 갈색 선택색은 더 이상 쓰지 않는다', () => {
    expect(SRC).toContain('--pick:#1d6fe0;');
    expect(SRC).not.toContain("'var(--brand-deep, #6a4b2a)'");
  });

  test('2D 와 3D 가 같은 색 상수를 쓴다', () => {
    expect(SRC).toContain("const PICK_COLOR_CSS = 'var(--pick, #1d6fe0)';");
    expect(SRC).toContain('const PICK_COLOR_3D = 0x1d6fe0;');
  });

  test('고른 모듈의 테두리가 파랗고 굵다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const id = p.g('modules')[1].id;
    p.g('setActiveModule')(id);
    const on = outlineOf(p, id);
    expect(on.getAttribute('stroke')).toBe(PICK);
    expect(on.getAttribute('stroke-width')).toBe('8');
  });

  test('고르지 않은 모듈은 섹션 색 그대로다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const mods = p.g('modules');
    p.g('setActiveModule')(mods[1].id);
    const off = outlineOf(p, mods[2].id);
    expect(off.getAttribute('stroke')).not.toBe(PICK);
    expect(off.getAttribute('stroke-width')).toBe('4');
  });

  test('테두리가 새 모듈로 옮겨간다 — 두 개가 동시에 파랄 수 없다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const mods = p.g('modules');
    p.g('setActiveModule')(mods[0].id);
    p.g('setActiveModule')(mods[3].id);
    const blue = [...p.document.querySelectorAll('#contentG [data-module-id]')]
      .filter((r) => r.getAttribute('stroke') === PICK)
      .map((r) => r.getAttribute('data-module-id'));
    expect(blue).toEqual([mods[3].id]);
  });
});

describe('선택해도 계획 전체가 보인다', () => {
  test('모듈을 골라도 다른 모듈이 화면에 남는다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const mods = p.g('modules');
    expect(drawnCount(p)).toBe(mods.length);
    p.g('setActiveModule')(mods[0].id);
    expect(drawnCount(p)).toBe(mods.length);
  });

  test('선택이 화면을 모듈로 당기지 않는다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    const v0 = Object.assign({}, p.g('view'));
    p.g('setActiveModule')(p.g('modules')[2].id);
    const v1 = p.g('view');
    expect(v1.zoom).toBe(v0.zoom);
    expect(v1.panX).toBe(v0.panX);
    expect(v1.panY).toBe(v0.panY);
  });

  test("'전체' → '개별' 로 와도 모듈 하나만 남지 않는다", () => {
    // 예전에 유일하게 남아 있던 '개별 모듈 상세' 경로다.
    const p = boot(FIXTURES.straight);
    const mods = p.g('modules');
    p.g('setViewMode')('all');
    p.g('setActiveModule')(mods[1].id);
    p.g('setViewMode')('single');
    expect(drawnCount(p)).toBeGreaterThan(1);
    expect(p.g('isAreaView')()).toBe(true);
  });

  test("'개별' 로 와도 우측 패널은 그 모듈을 계속 편집한다", () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    p.g('setActiveModule')(p.g('modules')[1].id);
    p.g('setViewMode')('single');
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('구조 편집');
  });

  test("'전체' 탭이 고른 모듈을 지우지 않는다", () => {
    const p = boot(FIXTURES.straight);
    const id = p.g('modules')[1].id;
    p.g('setViewMode')('all');
    p.g('setActiveModule')(id);
    p.g('setViewMode')('all');
    expect(outlineOf(p, id).getAttribute('stroke')).toBe(PICK);
    expect(p.document.getElementById('curModuleName').textContent).not.toMatch(/전체 모듈/);
  });

  test('고른 모듈이 없으면 전체 탭은 여전히 개수를 적는다', () => {
    const p = boot(FIXTURES.straight);
    p.g('setViewMode')('all');
    expect(p.document.getElementById('curModuleName').textContent).toMatch(/전체 모듈/);
  });
});

describe('3D 도 같은 표시를 쓴다', () => {
  test('고른 모듈에 파란 상자를 씌운다', () => {
    expect(SRC).toContain('if (m.id === activeId) addPickOutline3D(modG, m, moduleMesh);');
    expect(SRC).toContain('function addPickOutline3D(');
  });

  test('그 상자는 클릭 대상이 아니다 — 모듈이 집혀야 한다', () => {
    const at = SRC.indexOf('function addPickOutline3D(');
    expect(SRC.slice(at, at + 1200)).toContain('box.raycast = function () {};');
  });

  test('3D 클릭도 setActiveModule 한 길을 쓴다', () => {
    expect(SRC).toContain('if (moduleId && moduleId !== activeId) setActiveModule(moduleId);');
  });

  test('선택하면 3D 를 다시 그린다 — 테두리가 옮겨가야 한다', () => {
    // W12-75: 모드를 가리지 않는다. 3D 는 언제나 계획 전체를 다시 그린다.
    const at = SRC.indexOf('setActiveModule = function(id)');
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 500)).toContain('renderAll3D({ fit: false })');
  });
});
