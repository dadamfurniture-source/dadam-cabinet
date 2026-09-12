/**
 * 2026-09-13: 저장된 배치·구조·디테일을 계정에서 **파일 불러오기처럼** 꺼낸다.
 *
 *   · PlannerStore.listAll(stage)  — 내 모든 설계·품목의 스냅샷 (designs.name · design_items.name 을 붙여)
 *   · PlannerStore.loadAny(id)     — 어느 설계 것이든 지금 스코프의 localStorage 로 되쓴다 (설계 미저장이어도)
 *   · 배치 단계 '📂 배치 불러오기' 가 드롭다운이 됐다: 이 브라우저 마지막 저장 + 계정(이 품목 / 내 모든 설계) + 이름 저장
 *   · 구조 단계 '도면 불러오기' 에 '이 품목 / 내 모든 설계' 범위가 생겼다
 */
const fs = require('fs');
const path = require('path');
const { PlannerStore, plannerSnapshotOrigin } = require('../js/planner/planner-store');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8').split('\r\n').join('\n');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8').split('\r\n').join('\n');

/** 체이닝되는 가짜 supabase 클라이언트 — 테이블별 결과를 돌려준다 */
function fakeClient(byTable, opts = {}) {
  const calls = [];
  const q = (table) => {
    const rec = { table, ops: [] };
    calls.push(rec);
    const b = {
      select: (c) => { rec.ops.push(['select', c]); return b; },
      eq: (k, v) => { rec.ops.push(['eq', k, v]); return b; },
      in: (k, v) => { rec.ops.push(['in', k, v]); return b; },
      order: () => b,
      limit: (n) => { rec.ops.push(['limit', n]); return b; },
      single: async () => ({ data: (byTable[table] || [])[0] || null, error: null }),
      then: (res) => res({ data: byTable[table] || [], error: null }),
    };
    return b;
  };
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: 'u1' } } } }) },
    from: (table) => q(table),
  };
}

const ROWS = [
  { id: 's1', stage: 'layout', name: '주방 A', is_autosave: false, updated_at: '2026-09-10T01:00:00Z', created_at: '2026-09-10T01:00:00Z',
    payload: { layout: { modules: [{ section: 'lower' }] }, origin: { x: 0, y: 0, ceiling: 2400 } },
    design_id: 'd-1', item_unique_id: 11, designs: { name: '김씨댁' } },
  { id: 's2', stage: 'layout', name: null, is_autosave: true, updated_at: '2026-09-11T01:00:00Z', created_at: '2026-09-11T01:00:00Z',
    payload: { layout: { modules: [] }, origin: null }, design_id: 'd-2', item_unique_id: 22, designs: { name: '박씨댁' } },
];
const ITEMS = [
  { design_id: 'd-1', unique_id: 11, name: '싱크대', category: 'sink' },
  { design_id: 'd-2', unique_id: 22, name: null, category: 'wardrobe' },
];

afterEach(() => { PlannerStore._client = null; });

describe('PlannerStore.listAll — 내 모든 설계의 스냅샷', () => {
  test('설계명·품목명을 붙여 돌려준다', async () => {
    PlannerStore._client = fakeClient({ planner_snapshots: ROWS, design_items: ITEMS });
    const r = await PlannerStore.listAll('layout');
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => [x.id, x.design_name, x.item_name])).toEqual([
      ['s1', '김씨댁', '싱크대'],
      ['s2', '박씨댁', 'wardrobe'],   // 이름이 없으면 카테고리
    ]);
  });

  test('단계로 거르고, 품목 이름은 관련 설계만 묻는다', async () => {
    const c = fakeClient({ planner_snapshots: ROWS, design_items: ITEMS });
    PlannerStore._client = c;
    await PlannerStore.listAll('structure', 7);
    const snap = c.calls.find((x) => x.table === 'planner_snapshots');
    expect(snap.ops).toEqual(expect.arrayContaining([['eq', 'stage', 'structure'], ['limit', 7]]));
    const items = c.calls.find((x) => x.table === 'design_items');
    expect(items.ops).toEqual(expect.arrayContaining([['in', 'design_id', ['d-1', 'd-2']]]));
  });

  test('로그인이 없으면 빈 목록과 이유', async () => {
    PlannerStore._client = fakeClient({ planner_snapshots: ROWS }, { session: false });
    const r = await PlannerStore.listAll('layout');
    expect(r).toMatchObject({ ok: false, reason: 'no-session', rows: [] });
  });

  test('설계가 저장되지 않은 스코프(local)에서도 된다 — ready 가 아니라 session 만 본다', async () => {
    PlannerStore._client = fakeClient({ planner_snapshots: ROWS, design_items: ITEMS });
    const ready = await PlannerStore.ready({ designId: null, itemId: 5 });
    expect(ready.ok).toBe(false);
    const r = await PlannerStore.listAll('layout');
    expect(r.ok).toBe(true);
  });
});

describe('PlannerStore.loadAny — 어느 설계 것이든 지금 스코프로', () => {
  test('payload 를 배치·원점 키에 되쓴다', async () => {
    PlannerStore._client = fakeClient({ planner_snapshots: [ROWS[0]] });
    // jsdom 의 진짜 localStorage — scopedKey 가 없는 모듈 환경이라 base 키 그대로 쓰인다
    localStorage.removeItem('dadam_layout_v1');
    localStorage.removeItem('dadam_origin_v1');
    const r = await PlannerStore.loadAny('s1');
    expect(r.ok).toBe(true);
    expect(r.row.id).toBe('s1');
    expect(r.applied.sort()).toEqual(['layout', 'origin']);
    expect(JSON.parse(localStorage.getItem('dadam_layout_v1'))).toEqual(ROWS[0].payload.layout);
    expect(JSON.parse(localStorage.getItem('dadam_origin_v1'))).toEqual(ROWS[0].payload.origin);
  });

  test('단계를 넘기면 그 단계 저장본만 받는다 — 배치 저장본을 구조 단계에서 부르면 되쓰지 않는다', async () => {
    PlannerStore._client = fakeClient({ planner_snapshots: [ROWS[0]] });
    localStorage.removeItem('dadam_layout_v1');
    const r = await PlannerStore.loadAny('s1', 'structure');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stage-mismatch');
    expect(r.message).toContain('배치 도면은 배치 단계에서만');
    expect(localStorage.getItem('dadam_layout_v1')).toBeNull();
    const ok = await PlannerStore.loadAny('s1', 'layout');
    expect(ok.ok).toBe(true);
  });

  test('세 단계 모두 지금 단계를 넘겨 부른다 — 소스 규약', () => {
    expect(SHELL).toContain("PlannerStore.loadAny(id, 'layout')");
    expect(STRUCT).toContain("PlannerStore.loadAny(id, 'structure')");
    const dd = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'detail-drawing.js'), 'utf8');
    expect(dd).toContain("PlannerStore.loadAny(id, 'detail')");
    expect(SHELL).not.toContain("getElementById('loadLayoutBtn')");   // 옛 인라인 메뉴는 없다
  });
});

describe('출처 표시', () => {
  test('같은 스코프면 비고, 다르면 설계 · 품목', () => {
    const row = Object.assign({}, ROWS[0], { design_name: '김씨댁', item_name: '싱크대' });
    expect(plannerSnapshotOrigin(row, { designId: 'd-1', itemId: 11 })).toBe('');
    expect(plannerSnapshotOrigin(row, { designId: 'd-9', itemId: 11 })).toBe('김씨댁 · 싱크대');
    expect(plannerSnapshotOrigin({ design_id: 'x', item_unique_id: 3 }, { designId: null, itemId: 3 })).toBe('다른 설계 · 품목 3');
  });
});

describe('배치 단계 — 📂 배치 불러오기 드롭다운', () => {
  function boot(withLocal) {
    const layout = { version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null,
      modules: [{ section: 'lower', x: 0, y: 0, w: 1800, h: 650, moduleH: 870, rotation: 0, finishings: [] }] };
    const p = bootPlanner('mockup-shell.html', {
      search: '?design=d1&item=1',
      storage: withLocal ? { 'dadam_layout_v1::d1:1': JSON.stringify(layout) } : {},
    });
    if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
    return p;
  }
  const flush = () => new Promise((r) => setTimeout(r, 30));

  test('버튼이 메뉴를 열고, 이 브라우저의 마지막 저장이 첫 줄이다', async () => {
    const p = boot(true);
    const menu = p.document.getElementById('loadDrawingMenu');
    expect(menu.hidden).toBe(true);
    p.document.getElementById('loadDrawingBtn').onclick({ stopPropagation() {} });
    await flush();
    expect(menu.hidden).toBe(false);
    const local = menu.querySelector('[data-local]');
    expect(local).not.toBeNull();
    expect(local.textContent).toContain('마지막 저장');
    expect(local.textContent).toContain('모듈 1개');
  });

  test('마지막 저장 줄을 누르면 예전처럼 localStorage 배치를 되살린다', async () => {
    const p = boot(true);
    p.document.getElementById('loadDrawingBtn').onclick({ stopPropagation() {} });
    await flush();
    expect(p.document.querySelectorAll('g.sect-rect').length).toBe(0);
    p.document.querySelector('#loadDrawingMenu [data-local]').onclick({ stopPropagation() {} });
    expect(p.document.querySelectorAll('g.sect-rect').length).toBe(1);
  });

  test('계정 구역에는 범위 토글(이 품목 / 내 모든 설계)과 저장 버튼이 있다', async () => {
    const p = boot(false);
    p.document.getElementById('loadDrawingBtn').onclick({ stopPropagation() {} });
    await flush();
    const menu = p.document.getElementById('loadDrawingMenu');
    expect(menu.querySelector('[data-scope="item"]')).not.toBeNull();
    expect(menu.querySelector('[data-scope="all"]')).not.toBeNull();
    expect(menu.querySelector('[data-save]')).not.toBeNull();
    // 하네스에는 supabase SDK 가 없다 — 저장 버튼은 비활성이고 이유가 붙는다
    expect(menu.querySelector('[data-save]').disabled).toBe(true);
    expect(menu.textContent).toContain('이 화면에서는 계정 저장을 쓸 수 없습니다');
  });
});

describe('소스 규약', () => {
  const MENU = fs.readFileSync(path.join(ROOT, 'js/planner/planner-drawing-menu.js'), 'utf8');
  test('공통 메뉴에 범위 토글이 있고 listAll 을 쓴다 · 두 단계 모두 loadAny 로 되쓴다', () => {
    expect(MENU).toContain('data-scope="all"');
    expect(MENU).toContain('PlannerStore.listAll(stage)');
    expect(STRUCT).toContain("PlannerStore.loadAny(id, 'structure')");
    expect(SHELL).toContain("PlannerStore.loadAny(id, 'layout')");
    expect(STRUCT).not.toContain('PlannerStore.loadInto(id)');
  });
  test('배치 단계는 되쓴 뒤 fromStructure 토큰을 두고 다시 연다', () => {
    const at = SHELL.indexOf("stage: 'layout',");
    const fn = SHELL.slice(at, at + 1800);
    expect(fn).toContain("sessionStorage.setItem('fromStructure', '1')");
    expect(fn).toContain('location.reload()');
  });
});
