/**
 * 2026-09-13: 도면 저장 / 도면 불러오기 — 배치·구조·디테일 공통 메뉴 (js/planner/planner-drawing-menu.js).
 *
 *   · 세 단계 모두 우측 상단에 [📥 도면 불러오기 ▾] [💾 도면 저장]
 *   · 저장은 그 단계만, 불러오기도 그 단계 저장본만 (범위: 이 품목 / 내 모든 설계)
 *   · 페이지는 stage·pick·save 만 넘기고, 목록·확인창·안내는 메뉴가 맡는다
 */
const fs = require('fs');
const path = require('path');
const { mountPlannerDrawingMenu } = require('../js/planner/planner-drawing-menu');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

function fakeStore(o) {
  return {
    ready: async () => o.ready || { ok: true, ids: { designId: 'd1', itemId: 1 } },
    session: async () => o.session || { ok: true },
    list: async (stage) => ({ ok: true, rows: (o.rows || []).filter((r) => r.stage === stage) }),
    listAll: async (stage) => ({ ok: true, rows: (o.all || []).filter((r) => r.stage === stage) }),
  };
}
function dom() {
  document.body.innerHTML = '<div class="pdm-wrap"><button id="b">📥</button><div id="m" hidden></div><button id="s">💾</button></div>';
  return { btn: document.getElementById('b'), menu: document.getElementById('m'), saveBtn: document.getElementById('s') };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  global.PLANNER_STAGE_LABEL = { layout: '배치', structure: '구조', detail: '디테일' };
  global.plannerSnapshotWhen = () => '오늘 10:00';
  global.plannerSnapshotSummary = () => '';
  global.plannerSnapshotOrigin = (r, ids) => (ids && r.design_id === ids.designId ? '' : '다른집 · 싱크대');
});
afterEach(() => { delete global.PlannerStore; });

describe('그 단계만 보여 준다', () => {
  test('stage 가 structure 면 구조 저장본만 나온다', async () => {
    global.PlannerStore = fakeStore({ rows: [
      { id: 'a', stage: 'layout', name: '배치1', design_id: 'd1', item_unique_id: 1 },
      { id: 'b', stage: 'structure', name: '구조1', design_id: 'd1', item_unique_id: 1 },
    ] });
    const el = dom();
    const ctl = mountPlannerDrawingMenu({ stage: 'structure', ...el, toast() {}, pick: async () => {}, save: async () => ({ ok: true }) });
    await ctl.render();
    const rows = [...el.menu.querySelectorAll('[data-snap]')];
    expect(rows.map((r) => r.dataset.snap)).toEqual(['b']);
    expect(el.menu.textContent).toContain('계정에 저장된 구조');
    expect(el.menu.querySelector('[data-save]').textContent).toContain('현재 구조 저장');
  });

  test("'내 모든 설계' 로 바꾸면 listAll 을 쓰고 출처가 붙는다", async () => {
    global.PlannerStore = fakeStore({ rows: [], all: [
      { id: 'z', stage: 'layout', name: '옛집 배치', design_id: 'd9', item_unique_id: 7 },
    ] });
    const el = dom();
    const ctl = mountPlannerDrawingMenu({ stage: 'layout', ...el, toast() {}, pick: async () => {}, save: async () => ({ ok: true }) });
    await ctl.render();
    expect(el.menu.querySelectorAll('[data-snap]')).toHaveLength(0);
    el.menu.querySelector('[data-scope="all"]').onclick({ stopPropagation() {} });
    await flush();
    const row = el.menu.querySelector('[data-snap="z"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.pdm-origin').textContent).toBe('다른집 · 싱크대');
  });
});

describe('설계가 저장되지 않았을 때', () => {
  test("목록은 '내 모든 설계' 로 열리고, 저장 버튼은 살아 있다 (설계 저장으로 이어진다)", async () => {
    global.PlannerStore = fakeStore({ ready: { ok: false, reason: 'no-scope', ids: { designId: null, itemId: 1 } }, all: [] });
    const el = dom();
    const ctl = mountPlannerDrawingMenu({ stage: 'layout', ...el, toast() {}, pick: async () => {}, save: async () => ({ ok: false, reason: 'no-scope' }) });
    await ctl.render();
    expect(el.menu.querySelector('[data-scope="all"]').classList.contains('on')).toBe(true);
    expect(el.menu.querySelector('[data-scope="item"]').disabled).toBe(true);
    expect(el.menu.querySelector('[data-save]').disabled).toBe(false);
    expect(el.menu.textContent).toContain('도면 저장을 누르면 설계를 먼저 저장한 뒤');
  });

  test('이름 저장이 no-scope 면 onNoScope 로 넘긴다', async () => {
    global.PlannerStore = fakeStore({ ready: { ok: false, reason: 'no-scope' } });
    const el = dom();
    const toasts = [];
    let asked = null;
    window.prompt = () => '내 도면';
    const ctl = mountPlannerDrawingMenu({ stage: 'structure', ...el, toast: (t) => toasts.push(t),
      pick: async () => {}, save: async () => ({ ok: false, reason: 'no-scope' }), onNoScope: (name) => { asked = name; return true; } });
    await ctl.saveNamed();
    expect(asked).toBe('내 도면');
    expect(toasts.join(' ')).toContain('먼저 설계를 저장합니다');
  });
});

describe('불러오기와 저장은 페이지에 맡긴다', () => {
  test('줄을 누르면 확인 뒤 pick(id) 를 부른다', async () => {
    global.PlannerStore = fakeStore({ rows: [{ id: 'k', stage: 'layout', name: 'x', design_id: 'd1', item_unique_id: 1 }] });
    const el = dom();
    const picked = [];
    window.confirm = () => true;
    const ctl = mountPlannerDrawingMenu({ stage: 'layout', ...el, toast() {}, pick: async (id) => picked.push(id), save: async () => ({ ok: true }) });
    await ctl.render();
    el.menu.hidden = false;
    el.menu.querySelector('[data-snap="k"]').onclick({ stopPropagation() {} });
    await flush();
    expect(picked).toEqual(['k']);
    expect(el.menu.hidden).toBe(true);
  });

  test('취소하면 pick 을 부르지 않는다', async () => {
    global.PlannerStore = fakeStore({ rows: [{ id: 'k', stage: 'layout', name: 'x', design_id: 'd1', item_unique_id: 1 }] });
    const el = dom();
    const picked = [];
    window.confirm = () => false;
    const ctl = mountPlannerDrawingMenu({ stage: 'layout', ...el, toast() {}, pick: async (id) => picked.push(id), save: async () => ({ ok: true }) });
    await ctl.render();
    el.menu.querySelector('[data-snap="k"]').onclick({ stopPropagation() {} });
    await flush();
    expect(picked).toEqual([]);
  });

  test('💾 도면 저장 버튼은 이름을 묻고 save(name) 을 부른다', async () => {
    global.PlannerStore = fakeStore({});
    const el = dom();
    const saved = [];
    window.prompt = () => '오늘 구조';
    mountPlannerDrawingMenu({ stage: 'structure', ...el, toast() {}, pick: async () => {}, save: async (name) => { saved.push(name); return { ok: true }; } });
    el.saveBtn.onclick();
    await flush();
    expect(saved).toEqual(['오늘 구조']);
  });

  test('배치 단계의 첫 줄(이 브라우저 마지막 저장)은 계정과 무관하게 apply 를 부른다', async () => {
    global.PlannerStore = fakeStore({ ready: { ok: false, reason: 'no-sdk' }, session: { ok: false, reason: 'no-sdk' } });
    const el = dom();
    let applied = 0;
    const ctl = mountPlannerDrawingMenu({ stage: 'layout', ...el, toast() {}, pick: async () => {}, save: async () => ({ ok: true }),
      localRow: () => ({ label: '↩ 마지막 저장', meta: '모듈 3개', apply: () => { applied++; } }) });
    await ctl.render();
    el.menu.querySelector('[data-local]').onclick({ stopPropagation() {} });
    expect(applied).toBe(1);
    expect(el.menu.textContent).toContain('이 화면에서는 계정 저장을 쓸 수 없습니다');
  });
});

describe('세 단계가 같은 자리에 같은 두 버튼을 갖는다', () => {
  test('배치 · 구조 — 상단바 우측 끝(패널 토글 앞)', () => {
    for (const f of ['mockup-shell.html', 'mockup-structure.html']) {
      const html = read(f);
      const load = html.indexOf('id="loadDrawingBtn"');
      const save = html.indexOf('id="saveDrawingBtn"');
      const panel = html.indexOf('class="panel-toggle"');
      expect(load).toBeGreaterThan(0);
      expect(load).toBeLessThan(save);
      expect(save).toBeLessThan(panel);
      expect(html).toContain('js/planner/planner-drawing-menu.js');
    }
  });
  test('디테일 — BOM 산출 결과 머리줄 우측', () => {
    const html = read('detaildesign.html');
    const head = html.indexOf('BOM 산출 결과');
    const load = html.indexOf('id="detailLoadBtn"');
    const save = html.indexOf('id="detailSaveBtn"');
    const back = html.indexOf('onclick="backToStep2()"');
    expect(load).toBeGreaterThan(head);
    expect(load).toBeLessThan(save);
    expect(save).toBeLessThan(back);
    expect(html).toContain('js/detaildesign/detail-drawing.js');
    expect(html.indexOf('js/planner/planner-drawing-menu.js')).toBeLessThan(html.indexOf('js/detaildesign/detail-drawing.js'));
  });
  test('디테일 저장은 품목마다 stage detail 로, 설계 미저장이면 saveDesign 부터', () => {
    const js = read('js/detaildesign/detail-drawing.js');
    expect(js).toContain("PlannerStore.save('detail', {");
    expect(js).toContain('await saveDesign();');
    expect(js).toContain("stage: 'detail'");
  });
});
