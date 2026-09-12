/**
 * W12-71: 도면 스냅샷 저장소.
 *
 *   배치·구조는 여태 localStorage 에만 있었다. 이 파일은 그것을 계정에 올리고
 *   되가져오는 경로를 잠근다. 지켜야 하는 성질 둘:
 *
 *     ① payload 를 변환하지 않는다 — 담은 것과 되쓴 것이 **같아야** 한다.
 *     ② 로그인·설계 저장 전에도 페이지가 죽지 않는다 — 던지지 않고 reason 을 준다.
 */
const fs = require('fs');
const path = require('path');
const store = require('../js/planner/planner-store');
const {
  PLANNER_STAGES,
  PLANNER_STAGE_KEYS,
  plannerScopeIds,
  plannerScopeIsRemote,
  plannerSnapshotPayload,
  applyPlannerSnapshot,
  plannerSnapshotSummary,
  PlannerStore,
  migratePlannerLocalScope,
} = store;

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');
const SQL = fs.readFileSync(path.join(__dirname, '..', 'database', 'planner-snapshots-schema.sql'), 'utf8');

/** 메모리 저장소 — 진짜 localStorage 를 건드리지 않는다 */
function memStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    map: m,
    read: (k) => (m.has(k) ? m.get(k) : null),
    write: (k, v) => m.set(k, v),
  };
}

describe('스코프 — 설계를 저장하기 전에는 DB 를 쓰지 않는다', () => {
  test('design·item 을 숫자/UUID 로 뽑는다', () => {
    const ids = plannerScopeIds('?design=abc-123&item=1700000000000');
    expect(ids).toEqual({ designId: 'abc-123', itemId: 1700000000000 });
    expect(plannerScopeIsRemote(ids)).toBe(true);
  });

  test('새 품목의 소수 uniqueId(Date.now()+Math.random()) 도 스코프다 — 내림해서 BIGINT 와 맞춘다', () => {
    // 2026-09-13: 이게 막혀 있어 설계를 저장한 뒤에도 no-scope 로 도면 저장이 조용히 실패했다.
    const ids = plannerScopeIds('?design=abc-123&item=1757550000000.4567');
    expect(ids).toEqual({ designId: 'abc-123', itemId: 1757550000000 });
    expect(plannerScopeIsRemote(ids)).toBe(true);
    expect(plannerScopeIds('?design=abc&item=12.').itemId).toBeNull();
    expect(plannerScopeIds('?design=abc&item=abc').itemId).toBeNull();
  });

  test("design=local 은 원격 스코프가 아니다 — designs 행이 없어 RLS 를 태울 수 없다", () => {
    const ids = plannerScopeIds('?design=local&item=17');
    expect(ids.designId).toBeNull();
    expect(plannerScopeIsRemote(ids)).toBe(false);
  });

  test("item=bootstrap 도 아니다 — 품목이 아직 없다", () => {
    expect(plannerScopeIsRemote(plannerScopeIds('?design=abc&item=bootstrap'))).toBe(false);
    expect(plannerScopeIds('?design=abc&item=bootstrap').bootstrap).toBe(true);
  });

  test("품목이 없으면(bootstrap) ready 는 'no-item' — 설계 저장으로 풀리는 no-scope 와 다르다", async () => {
    const r = await PlannerStore.ready(plannerScopeIds('?design=local&item=bootstrap'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-item');
    const r2 = await PlannerStore.ready(plannerScopeIds('?design=local&item=17'));
    expect(r2.reason).toBe('no-scope');
  });

  test('파라미터가 없으면 스코프도 없다', () => {
    expect(plannerScopeIsRemote(plannerScopeIds(''))).toBe(false);
  });
});

describe('payload 는 저장 키 값 그대로다', () => {
  test('배치 = layout + origin', () => {
    const s = memStore({
      dadam_layout_v1: JSON.stringify({ modules: [1, 2, 3] }),
      dadam_origin_v1: JSON.stringify({ x: 10, y: 20, ceiling: 2400 }),
    });
    expect(plannerSnapshotPayload('layout', s.read)).toEqual({
      layout: { modules: [1, 2, 3] },
      origin: { x: 10, y: 20, ceiling: 2400 },
    });
  });

  test('구조 = modules + structures', () => {
    const s = memStore({
      dadam_struct_modules_v1: JSON.stringify({ modules: [{ id: 'lower-0' }] }),
      dadam_structure_v1: JSON.stringify({ 'lower-0': { verticalCount: 2 } }),
    });
    expect(plannerSnapshotPayload('structure', s.read)).toEqual({
      modules: { modules: [{ id: 'lower-0' }] },
      structures: { 'lower-0': { verticalCount: 2 } },
    });
  });

  test('담을 것이 없으면 null — 빈 스냅샷을 쌓지 않는다', () => {
    expect(plannerSnapshotPayload('layout', memStore().read)).toBeNull();
  });

  test('깨진 JSON 은 담지 않는다 — 담으면 불러올 때 다시 깨진다', () => {
    const s = memStore({ dadam_layout_v1: '{{{', dadam_origin_v1: '{"x":1}' });
    expect(plannerSnapshotPayload('layout', s.read)).toEqual({ origin: { x: 1 } });
  });

  test('디테일은 localStorage 키가 없다 — 정본이 design_items 이기 때문', () => {
    expect(PLANNER_STAGE_KEYS.detail).toEqual({});
    expect(plannerSnapshotPayload('detail', memStore().read)).toBeNull();
  });
});

describe('되쓰기 — 담은 것과 되쓴 것이 같다', () => {
  test('왕복해도 값이 변하지 않는다', () => {
    const seed = {
      dadam_layout_v1: JSON.stringify({ version: 1, modules: [{ section: 'lower', w: 1200 }] }),
      dadam_origin_v1: JSON.stringify({ x: 0, y: 0, ceiling: 2400 }),
    };
    const a = memStore(seed);
    const payload = plannerSnapshotPayload('layout', a.read);
    const b = memStore();
    applyPlannerSnapshot('layout', payload, b.write);
    expect(JSON.parse(b.read('dadam_layout_v1'))).toEqual(JSON.parse(seed.dadam_layout_v1));
    expect(JSON.parse(b.read('dadam_origin_v1'))).toEqual(JSON.parse(seed.dadam_origin_v1));
  });

  test('스냅샷에 없는 필드는 건드리지 않는다 — 조용히 지우면 되돌릴 수 없다', () => {
    const s = memStore({ dadam_origin_v1: '{"x":99}' });
    const applied = applyPlannerSnapshot('layout', { layout: { modules: [] } }, s.write);
    expect(applied).toEqual(['layout']);
    expect(s.read('dadam_origin_v1')).toBe('{"x":99}');
  });

  test('디테일은 되쓸 키가 없다 — 복원은 상세설계가 한다', () => {
    const s = memStore();
    expect(applyPlannerSnapshot('detail', { specs: {}, modules: [] }, s.write)).toEqual([]);
    expect(s.map.size).toBe(0);
  });
});

describe('목록 요약 — 열어 보지 않고 고를 수 있어야 한다', () => {
  test('배치는 배치 공간 개수', () => {
    expect(plannerSnapshotSummary('layout', { layout: { modules: [1, 2] } })).toBe('배치 공간 2개');
  });
  test('구조는 모듈 수와 구조 건수', () => {
    expect(plannerSnapshotSummary('structure', {
      modules: { modules: [1, 2, 3] }, structures: { a: {}, b: {} },
    })).toBe('모듈 3개 · 구조 2건');
  });
  test('모양이 어긋나도 던지지 않는다', () => {
    expect(() => plannerSnapshotSummary('structure', { modules: null })).not.toThrow();
  });
});

describe('로그인·SDK 가 없어도 죽지 않는다', () => {
  test('supabase 가 없으면 client() 가 null', () => {
    expect(PlannerStore.client()).toBeNull();
  });

  test('ready() 는 던지지 않고 이유를 준다', async () => {
    const r = await PlannerStore.ready({ designId: 'd1', itemId: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-sdk');
  });

  test('스코프가 없으면 no-scope', async () => {
    const r = await PlannerStore.ready({ designId: null, itemId: null });
    expect(r).toMatchObject({ ok: false, reason: 'no-scope' });
  });

  test('save 도 던지지 않는다', async () => {
    await expect(PlannerStore.save('layout', { ids: { designId: 'd', itemId: 1 } }))
      .resolves.toMatchObject({ ok: false });
  });

  test('list 는 실패해도 rows 를 준다 — UI 가 순회할 수 있어야 한다', async () => {
    const r = await PlannerStore.list('layout', 10, { designId: 'd', itemId: 1 });
    expect(Array.isArray(r.rows)).toBe(true);
  });
});

describe('local 스코프 이관 — 저장 전에 그린 배치를 잃지 않는다', () => {
  test('::local:17 의 값이 ::<designId>:17 로 옮겨간다', () => {
    localStorage.clear();
    localStorage.setItem('dadam_layout_v1::local:17', '{"modules":[1]}');
    localStorage.setItem('dadam_structure_v1::local:17', '{"a":1}');
    const moved = migratePlannerLocalScope('D-9', 17);
    expect(moved).toEqual(expect.arrayContaining(['dadam_layout_v1', 'dadam_structure_v1']));
    expect(localStorage.getItem('dadam_layout_v1::D-9:17')).toBe('{"modules":[1]}');
    expect(localStorage.getItem('dadam_layout_v1::local:17')).toBeNull();
  });

  test('새 스코프에 이미 값이 있으면 덮지 않는다 — 그쪽이 더 최신이다', () => {
    localStorage.clear();
    localStorage.setItem('dadam_layout_v1::local:17', '{"old":1}');
    localStorage.setItem('dadam_layout_v1::D-9:17', '{"new":1}');
    migratePlannerLocalScope('D-9', 17);
    expect(localStorage.getItem('dadam_layout_v1::D-9:17')).toBe('{"new":1}');
  });

  test('설계 id 가 없으면 아무것도 하지 않는다', () => {
    expect(migratePlannerLocalScope(null, 17)).toEqual([]);
  });
});

describe('스키마와 코드가 같은 것을 말한다', () => {
  test('stage 값 3종이 CHECK 제약과 일치한다', () => {
    expect(PLANNER_STAGES).toEqual(['layout', 'structure', 'detail']);
    PLANNER_STAGES.forEach((st) => expect(SQL).toContain(`'${st}'`));
  });

  test('소유권은 designs.user_id 하나다 — user_id 컬럼을 따로 두지 않는다', () => {
    expect(SQL).toContain('d.user_id = auth.uid()');
    expect(SQL).not.toMatch(/^\s*user_id\s+UUID/m);
  });

  test('자동 저장 행은 스코프당 하나임을 DB 가 보장한다', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX[\s\S]*WHERE is_autosave/);
  });

  test('upsert 를 쓰지 않는다 — 부분 인덱스를 PostgREST 가 집지 못한다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'planner', 'planner-store.js'), 'utf8');
    expect(src).not.toContain('.upsert(');
  });
});

describe('플래너 화면에 붙어 있다', () => {
  test('구조 단계가 저장소를 싣는다 — planner-scope 다음이어야 한다', () => {
    const scopeAt = SRC.indexOf('js/planner/planner-scope.js');
    const storeAt = SRC.indexOf('js/planner/planner-store.js');
    expect(scopeAt).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(scopeAt);
  });

  test('📥 도면 불러오기 · 💾 도면 저장 버튼이 상단바 우측 끝(패널 토글 앞)에 있다', () => {
    // 2026-09-13: 배치·구조·디테일 세 단계가 같은 자리에 같은 두 버튼 — ⚡ 전체 자동계산 오른쪽
    const load = SRC.indexOf('id="loadDrawingBtn"');
    const save = SRC.indexOf('id="saveDrawingBtn"');
    const auto = SRC.indexOf('id="autoCalcAllBtn"');
    const panel = SRC.indexOf('class="panel-toggle"');
    expect(load).toBeGreaterThan(auto);
    expect(load).toBeLessThan(save);
    expect(save).toBeLessThan(panel);
  });

  test('불러오기는 확인을 받는다 — 지금 그린 것을 덮어쓰기 때문', () => {
    // 2026-09-13: 확인창은 공통 메뉴가, 자동 저장 한 벌은 구조 페이지의 pick 이 남긴다
    const MENU = fs.readFileSync(path.join(__dirname, '..', 'js', 'planner', 'planner-drawing-menu.js'), 'utf8');
    const at = MENU.indexOf('async function pickSnapshot');
    expect(MENU.slice(at, at + 900)).toContain('confirm(');
    const pick = SRC.indexOf("stage: 'structure',");
    expect(SRC.slice(pick, pick + 900)).toContain("PlannerStore.save('structure', { autosave: true })");
  });

  test('구조 저장이 계정에도 올린다 — 상단 도면 저장 하나로 (바닥바 구조 저장은 없다)', () => {
    // 2026-09-13: 바닥바 '💾 구조 저장'(saveBtn) 제거. 저장은 공통 메뉴의 save 가 계정에 올린다.
    expect(SRC).toContain("PlannerStore.save('structure', { name })");
    expect(SRC).not.toContain('id="saveBtn"');
  });

  test('배치 단계도 올린다 — 상단 도면 저장 하나로 (바닥바 배치 저장은 없다)', () => {
    const shell = fs.readFileSync(path.join(__dirname, '..', 'mockup-shell.html'), 'utf8');
    expect(shell).toContain("PlannerStore.save('layout', { name })");
    expect(shell).not.toContain('id="saveLayoutBtn"');
    expect(shell).toContain('js/planner/planner-store.js');
  });

  test('디테일 복원은 저장하지 않는다 — 정본은 design_items 라 되쓰기만 하고 저장은 사람이 누른다', () => {
    // 2026-09-13: 디테일 불러오기는 디테일 단계(detaildesign) 우측 상단 메뉴가 맡는다.
    const dd = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'detail-drawing.js'), 'utf8');
    expect(dd).toContain("PlannerStore.loadAny(id, 'detail')");
    expect(dd).toContain('hasUnsavedChanges = true');
    expect(dd).not.toContain('saveDesignQuiet(');
    const step1 = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'ui-step1.js'), 'utf8');
    expect(step1).toContain("e.data.type === 'DADAM_RESTORE_DETAIL'");   // iframe 경로도 같은 되쓰기를 쓴다
    expect(step1).toContain('applyDetailSnapshotToItem(item, e.data.specs, e.data.modules)');
  });
});
