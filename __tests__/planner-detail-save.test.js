/**
 * 마감(디테일) 저장 · 이름 기본값 저장 (2026-09-23).
 *
 * 증상 1: 디테일 단계에서 「도면 저장」을 누르면 "⚠ 저장 실패: empty".
 *   원인 — 마감은 사용자가 **무언가를 바꿀 때만** 저장 키(dadam_detail_v1)에 쓴다. 기본 마감 그대로면
 *   키가 없어 저장소가 올릴 것이 없다고 거절했다. 화면에는 멀쩡히 마감(기본값)이 있는데도.
 *   고친 방식 — 마감 모듈이 "지금 화면의 마감" 을 저장소에 **제공자로 등록**하고, 저장소는 키가
 *   비었을 때만 그것을 쓴다. 화면에 들어가자마자 키에 써 두지 않는 이유: 부모가 보내 주는 마감(D1)과
 *   순서가 꼬여 기본값이 진짜 마감을 덮을 수 있다.
 *
 * 증상 2: 이름 칸을 비우고 확인하면 **조용히** 저장이 안 됐다 (설계 저장은 그러면서 "저장됨" 을 띄웠다).
 *   고친 방식 — **취소만** 멈춘다. 비었으면 기본 이름으로 저장한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE = require('../js/planner/planner-store.js');
const MENU = fs.readFileSync(path.join(ROOT, 'js/planner/planner-drawing-menu.js'), 'utf8');
const DETAIL = fs.readFileSync(path.join(ROOT, 'js/planner/planner-detail.js'), 'utf8');
const PERSIST = fs.readFileSync(path.join(ROOT, 'js/detaildesign/persistence-init.js'), 'utf8');
const { plannerDrawingExcuse } = require('../js/planner/planner-drawing-menu.js');

/** 로그인된 것처럼 — ready() 가 ok, insert 는 기록만 한다 */
function fakeReady(rows) {
  const client = {
    from: () => ({
      insert: (row) => { rows.push(row); return { select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }; },
    }),
  };
  return async () => ({ ok: true, client, ids: { designId: 'd1', itemId: 100 } });
}

describe('저장소 — 키가 비었으면 등록된 제공자에게 묻는다', () => {
  const realReady = STORE.PlannerStore.ready;
  afterEach(() => { STORE.PlannerStore.ready = realReady; localStorage.clear && localStorage.clear(); });

  test('제공자가 없고 키도 없으면 여전히 empty — 없는 것을 지어내지 않는다', async () => {
    const rows = [];
    STORE.PlannerStore.ready = fakeReady(rows);
    const r = await STORE.PlannerStore.save('layout', { name: 'x' });   // layout 은 제공자가 없다
    expect(r).toEqual({ ok: false, reason: 'empty' });
    expect(rows).toHaveLength(0);
  });

  test('디테일은 기본 마감 그대로도 저장된다 — 제공자가 지금 화면의 마감을 준다', async () => {
    const rows = [];
    STORE.PlannerStore.ready = fakeReady(rows);
    const shown = { version: 1, item: {}, sections: {}, modules: {}, parts: {} };   // 기본 마감 모양
    STORE.plannerRegisterStagePayload('detail', () => ({ detail: shown }));
    const r = await STORE.PlannerStore.save('detail', { name: '디테일 기본' });
    expect(r.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ detail: shown });   // 키를 읽은 것과 같은 모양
    expect(rows[0].name).toBe('디테일 기본');
  });

  test('제공자가 터져도 저장을 죽이지 않는다 — empty 로 돌려준다', () => {
    STORE.plannerRegisterStagePayload('detail', () => { throw new Error('boom'); });
    expect(STORE.plannerProvidedPayload('detail')).toBeNull();
  });

  test('빈 객체를 주면 없는 것으로 본다', () => {
    STORE.plannerRegisterStagePayload('detail', () => ({}));
    expect(STORE.plannerProvidedPayload('detail')).toBeNull();
  });
});

describe('마감 모듈이 자기를 제공자로 등록한다', () => {
  test('mount 에서 등록한다 — 키에 미리 써 두지 않는다', () => {
    const mount = DETAIL.slice(DETAIL.indexOf('  mount(o) {'), DETAIL.indexOf('  mount(o) {') + 1400);
    expect(mount).toContain("plannerRegisterStagePayload('detail'");
    expect(mount).toContain('{ detail: this.detail }');
  });
});

describe('이름 — 취소만 멈추고, 비었으면 기본 이름으로 저장한다', () => {
  test('도면 저장: null(취소)만 멈춘다', () => {
    const fn = MENU.slice(MENU.indexOf('async function saveNamed'), MENU.indexOf('function close()'));
    expect(fn).toContain('if (typed === null) return null;');
    expect(fn).toContain('String(typed).trim() || defaultName');
    expect(fn).not.toMatch(/if \(!name\) return null;/);   // 예전: 빈 이름이면 조용히 끝
  });

  test('설계 저장: 취소만 멈추고, 빈 이름은 기본 이름으로', () => {
    const fn = PERSIST.slice(PERSIST.indexOf('async function saveDesign()'), PERSIST.indexOf('async function saveDesignItems'));
    expect(fn).toContain('if (typedName === null)');
    expect(fn).toContain('String(typedName).trim() || defaultDesignName');
    expect(fn).not.toMatch(/if \(!designName\) \{\s*updateSaveStatus\('saved', '저장됨'\);/);
  });

  test('설계 저장을 취소해도 "저장됨" 이라고 거짓말하지 않는다 (한 번도 저장 안 된 설계)', () => {
    const fn = PERSIST.slice(PERSIST.indexOf('async function saveDesign()'), PERSIST.indexOf('async function saveDesignItems'));
    const cancel = fn.slice(fn.indexOf('if (typedName === null)'), fn.indexOf('const designName'));
    expect(cancel).toContain("classList.add('hidden')");
  });
});

describe('empty 에 알아들을 문구가 붙는다', () => {
  test('예전엔 "⚠ 저장 실패: empty" 였다', () => {
    expect(plannerDrawingExcuse('empty')).toMatch(/아직 저장할 내용이 없습니다/);
  });
});
