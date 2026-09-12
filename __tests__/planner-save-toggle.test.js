/**
 * W12-75: 저장 버튼과 자동저장 토글, 그리고 "모듈 하나만 보는 화면" 의 제거.
 */
const fs = require('fs');
const path = require('path');
const store = require('../js/planner/planner-store');
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

describe('자동저장 on/off', () => {
  beforeEach(() => { try { localStorage.clear(); } catch (e) {} });

  test('기본은 켜짐', () => {
    expect(store.plannerAutosaveEnabled()).toBe(true);
  });

  test('끄면 꺼진 채로 남는다 — 브라우저 취향이라 스코프를 안 붙인다', () => {
    store.setPlannerAutosave(false);
    expect(store.plannerAutosaveEnabled()).toBe(false);
    expect(localStorage.getItem(store.PLANNER_AUTOSAVE_KEY)).toBe('off');
    store.setPlannerAutosave(true);
    expect(store.plannerAutosaveEnabled()).toBe(true);
  });

  test('꺼져 있으면 계정에 올리지 않는다', () => {
    store.setPlannerAutosave(false);
    expect(store.plannerAutosave('structure', 0)).toBe(false);
    store.setPlannerAutosave(true);
    expect(store.plannerAutosave('structure', 999999)).toBe(true);
  });

  test('꺼도 localStorage 저장은 그대로다 — 작업을 잃는 스위치가 아니다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'planner', 'planner-store.js'), 'utf8');
    const at = src.indexOf('function plannerAutosave(stage');
    const fn = src.slice(at, at + 700);
    expect(fn).toContain('if (!plannerAutosaveEnabled()) return false;');
    // 이 함수는 localStorage 를 건드리지 않는다 — 계정 업로드만 한다
    expect(fn).not.toContain('localStorage.setItem');
  });
});

describe('상단바에 저장 버튼과 토글이 있다', () => {
  test('💾 도면 저장 버튼', () => {
    const p = boot(FIXTURES.straight);
    const b = p.document.getElementById('saveDrawingBtn');
    expect(b).not.toBeNull();
    expect(b.textContent).toContain('도면 저장');
    expect(typeof b.onclick).toBe('function');
  });

  test('자동저장 토글이 상태를 글자로 보여준다', () => {
    const p = boot(FIXTURES.straight);
    const t = p.document.getElementById('autoSaveToggle');
    expect(t).not.toBeNull();
    const first = t.textContent;
    expect(first).toMatch(/자동저장 (켬|끔)/);
    t.onclick();
    expect(t.textContent).not.toBe(first);
    expect(t.textContent).toMatch(/자동저장 (켬|끔)/);
    t.onclick();
    expect(t.textContent).toBe(first);
  });

  test('토글이 켜짐/꺼짐을 class 로도 남긴다 — 눈으로 구분되게', () => {
    const p = boot(FIXTURES.straight);
    const t = p.document.getElementById('autoSaveToggle');
    const on = t.classList.contains('on');
    t.onclick();
    expect(t.classList.contains('on')).toBe(!on);
    expect(t.classList.contains('off')).toBe(on);
  });

  test('저장 버튼은 📥 도면 불러오기 오른쪽 · ⚡ 전체 자동계산 왼쪽', () => {
    const load = SRC.indexOf('id="loadDrawingBtn"');
    const save = SRC.indexOf('id="saveDrawingBtn"');
    const auto = SRC.indexOf('id="autoCalcAllBtn"');
    expect(load).toBeLessThan(save);
    expect(save).toBeLessThan(auto);
  });
});

describe('모듈 하나만 보는 화면은 없다', () => {
  test('activeAreaId 가 없어도 전체를 그린다 — 자동계산 직후가 그 상태다', () => {
    const p = boot(FIXTURES.straight);
    p.g('autoCalcAllAreas')();
    expect(p.g('activeAreaId')).toBeNull();     // 영역을 고른 적이 없다
    expect(p.g('isAreaView')()).toBe(true);
    p.g('setActiveModule')(p.g('modules')[0].id);
    expect(p.document.querySelectorAll('#contentG [data-module-id]').length)
      .toBe(p.g('modules').length);
  });

  test('키큰장·냉장고장이 클릭 한 번에 사라지지 않는다', () => {
    const p = boot(FIXTURES.lShape);
    p.g('autoCalcAllAreas')();
    const before = p.document.querySelectorAll('#contentG [data-module-id]').length;
    expect(before).toBeGreaterThan(1);
    p.g('modules').forEach((m) => p.g('setActiveModule')(m.id));
    expect(p.document.querySelectorAll('#contentG [data-module-id]').length).toBe(before);
  });

  test('모듈 하나만 그리던 코드가 남아 있지 않다', () => {
    expect(SRC).not.toContain('function renderModule3D');
    expect(SRC).not.toContain('function fitCameraToModule');
    expect(SRC).not.toContain('renderModuleFront(content, m, s, 0, 0)');
  });
});

describe('다른 모듈의 칸은 선택만 한다', () => {
  test('선택과 도어 뒤집기를 한 번에 하지 않는다', () => {
    const at = SRC.indexOf('function bindFrontCell');
    const fn = SRC.slice(at, at + 1200);
    // 2026-09-12: 첫 클릭은 배치(pickAreaFirst) — 선택 경로일 뿐 뒤집기는 여전히 안 한다
    expect(fn).toContain('if (activeId !== m.id) { if (!pickAreaFirst(m.id)) setActiveModule(m.id); return; }');
  });
});
