/**
 * 2026-09-13: 플래너에서 '도면 저장'을 눌렀는데 설계가 아직 저장되지 않은 경우.
 *
 * 예전: "저장 실패: 이 설계는 아직 저장되지 않았습니다…" 로 끝났다.
 * 이제: 플래너 → 부모 DADAM_REQUEST_SAVE_DESIGN → 부모가 saveDesign() → DADAM_DESIGN_SAVED{designId}
 *       → 플래너가 local 키를 새 스코프로 옮기고 같은 단계를 새 스코프로 다시 연 뒤 미룬 저장을 이어서 한다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const LAYOUT = { version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null,
  modules: [{ section: 'lower', x: 0, y: 0, w: 1800, h: 650, moduleH: 870, rotation: 0, finishings: [] }] };

function bootLocal(file) {
  const p = bootPlanner(file, {
    search: '?design=local&item=1757550000000.123',
    storage: { 'dadam_layout_v1::local:1757550000000.123': JSON.stringify(LAYOUT) },
    session: { fromStructure: '1' },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('플래너가 부모에게 설계 저장을 부탁한다', () => {
  test('no-scope 에서 이름 저장을 누르면 부모에 DADAM_REQUEST_SAVE_DESIGN 이 가고 저장이 미뤄진다', () => {
    const p = bootLocal('mockup-structure.html');
    const sent = p.g('plannerRequestDesignSave')({ stage: 'structure', name: '테스트' });
    expect(sent).toBe(true);
    const msg = p.messages.find((m) => m && m.type === 'DADAM_REQUEST_SAVE_DESIGN');
    expect(msg).toBeTruthy();
    expect(msg.itemParam).toBe('1757550000000.123');     // iframe 이 쓰는 문자열 그대로
    expect(msg.itemUniqueId).toBe(1757550000000.123);
    expect(JSON.parse(p.session.getItem('dadam_planner_pending_save_v1'))).toEqual({ stage: 'structure', name: '테스트' });
  });

  test('부모가 저장하면 local 키가 새 스코프로 옮겨지고 URL 의 design 만 바뀐다', () => {
    const p = bootLocal('mockup-shell.html');
    const calls = [];
    p.location.replace = (u) => calls.push(u);
    expect(p.g('plannerOnDesignSaved')('d-new')).toBe(true);
    expect(p.storage.getItem('dadam_layout_v1::d-new:1757550000000.123')).toBe(JSON.stringify(LAYOUT));
    expect(p.storage.getItem('dadam_layout_v1::local:1757550000000.123')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('design=d-new');
    expect(calls[0]).toContain('item=1757550000000.123');
    expect(calls[0]).toMatch(/^\/mockup-shell\.html\?/);          // 같은 단계를 다시 연다
    expect(p.session.getItem('fromStructure')).toBe('1');
  });

  test('설계 저장 뒤 다시 연 화면(소수 item)에서 미룬 저장이 실제로 계정에 간다', async () => {
    // 부모가 준 새 design 으로 다시 열린 상태: design=d-new&item=1757550000000.123
    const p = bootPlanner('mockup-structure.html', { search: '?design=d-new&item=1757550000000.123',
      storage: { 'dadam_structure_v1::d-new:1757550000000.123': '{}' } });
    p.session.setItem('dadam_planner_pending_save_v1', JSON.stringify({ stage: 'structure', name: '미룬 것' }));
    const saved = [];
    p.window.PlannerStore.ready = async () => ({ ok: true, ids: { designId: 'd-new', itemId: 1757550000000 } });
    p.window.PlannerStore.save = async (stage, opt) => { saved.push([stage, opt]); return { ok: true, id: 'x' }; };
    const toasts = [];
    const r = await p.g('plannerRunPendingSave')((m) => toasts.push(m));
    expect(r.ok).toBe(true);
    expect(saved).toEqual([['structure', { name: '미룬 것' }]]);
    expect(toasts[0]).toContain('구조 도면을 계정에 저장했습니다');
    expect(p.session.getItem('dadam_planner_pending_save_v1')).toBeNull();
  });

  test('미룬 저장이 스코프 때문에 못 가면 조용히 삼키지 않고 이유를 띄운다', async () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=d-new&item=1757550000000.123',
      storage: { 'dadam_structure_v1::d-new:1757550000000.123': '{}' } });
    p.session.setItem('dadam_planner_pending_save_v1', JSON.stringify({ stage: 'structure', name: 'x' }));
    p.window.PlannerStore.ready = async () => ({ ok: false, reason: 'no-session' });
    const toasts = [];
    const r = await p.g('plannerRunPendingSave')((m) => toasts.push(m));
    expect(r.ok).toBe(false);
    expect(toasts[0]).toContain('구조 도면 저장 실패');
    expect(toasts[0]).toContain('로그인');
  });

  test('취소하면 미룬 저장 토큰이 지워진다', () => {
    const p = bootLocal('mockup-structure.html');
    p.g('plannerRequestDesignSave')({ stage: 'structure', name: 'x' });
    p.window.dispatchEvent(new p.window.MessageEvent('message', {
      data: { type: 'DADAM_DESIGN_SAVE_CANCELED' }, origin: p.location.origin,
    }));
    expect(p.session.getItem('dadam_planner_pending_save_v1')).toBeNull();
  });
});

describe('소스 규약', () => {
  test('두 단계의 이름 저장이 no-scope 면 plannerRequestDesignSave 로 넘긴다', () => {
    const shell = read('mockup-shell.html');
    const struct = read('mockup-structure.html');
    // 2026-09-13: 공통 메뉴(onNoScope)로 넘긴다
    expect(shell).toContain("onNoScope: (name) => plannerRequestDesignSave({ stage: 'layout', name })");
    expect(struct).toContain("onNoScope: (name) => plannerRequestDesignSave({ stage: 'structure', name })");
    const menu = read('js/planner/planner-drawing-menu.js');
    expect(menu).toContain("r.reason === 'no-scope' && typeof o.onNoScope === 'function' && o.onNoScope(name)");
    expect(shell).toContain('plannerRunPendingSave(');
    expect(struct).toContain('plannerRunPendingSave(');
  });

  test('부모(ui-step1)가 DADAM_REQUEST_SAVE_DESIGN 을 받아 saveDesign 을 부르고 id 를 돌려준다', () => {
    const js = read('js/detaildesign/ui-step1.js');
    const at = js.indexOf("e.data.type === 'DADAM_REQUEST_SAVE_DESIGN'");
    expect(at).toBeGreaterThan(0);
    const fn = js.slice(at, at + 1400);
    expect(fn).toContain('e.origin !== location.origin');
    expect(fn).toContain('await saveDesign()');
    expect(fn).toContain("reply('DADAM_DESIGN_SAVED', { designId: currentDesignId })");
    expect(fn).toContain("reply('DADAM_DESIGN_SAVE_CANCELED')");
  });

  test('설계 첫 저장의 스코프 이관은 iframe 이 쓰는 문자열(String(uniqueId))로도 한다', () => {
    const js = read('js/detaildesign/persistence-init.js');
    expect(js).toContain('migratePlannerLocalScope(designId, itemStr)');
  });
});
