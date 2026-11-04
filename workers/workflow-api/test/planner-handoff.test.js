/**
 * 간편 플래너 설계 받기 — POST /planner/designs (src/planner-handoff.js, DB 0035 designs.source · source_ref).
 *
 *   본사 대표 · 실장 · 관리자만 (아니면 403 not_planner_sender) · 같은 플래너 설계 = 같은 앱 설계 (없으면 만들고, 있으면 그대로)
 *   · 부재 ID 가 겹치면 INSERT 전에 422 · 0035 적용 전이면 409 db_pending · 동결은 createSnapshot 그대로.
 * 사람 · 설계는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache, ForbiddenError, ValidationError, ConflictError } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { receivePlannerDesign, duplicatePartIds, PLANNER_SOURCE } from '../src/planner-handoff.js';
import worker from '../src/worker.js';
import { HQ, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const MEMBERS = [
  { user_id: OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: STAFF, company_id: HQ, role: 'staff', status: 'active' },
];

const json = (rows, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const fail = (status, body) => ({ ok: false, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });

/** PostgREST 흉내 — designs 찾기 · 만들기, 동결 (cut-plan.test.js 와 같은 길) */
function fakeSupabase({ existing = null, missing = false } = {}) {
  const calls = { designPosts: [], snapshotPosts: [], designFinds: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    const path = u.split('?')[0];
    if (companyRoute(u, { members: MEMBERS })) return companyRoute(u, { members: MEMBERS });
    if (/\/admin_roles\?/.test(u)) return json([]);
    if (method === 'GET' && /\/designs\?/.test(u)) {
      const q = new URL(u).searchParams;
      if (q.get('source')) {
        calls.designFinds += 1;
        if (missing) return fail(400, { code: 'PGRST204', message: "Could not find the 'source' column of 'designs' in the schema cache" });
        return json(existing ? [existing] : []);
      }
      const id = (q.get('id') || '').replace(/^eq\./, '');
      const row = existing && existing.id === id ? existing : calls.designPosts.find((d) => d.id === id);
      return json(row ? [{ company_id: HQ, ...row }] : []);
    }
    if (method === 'POST' && /\/designs$/.test(path)) {
      const body = JSON.parse(init.body);
      const row = { id: 'D-NEW', ...body };
      calls.designPosts.push(row);
      return json([row], 201);
    }
    if (/\/company_settings\?/.test(u)) return json([]);
    if (/\/pricing_rule_sets\?/.test(u)) return json([{ id: 'RS1', name: 'seed', is_active: true }]);
    if (/\/pricing_rules\?/.test(u)) return json([]);
    if (method === 'GET' && /\/design_snapshots\?/.test(u)) return json([]);
    if (method === 'POST' && /\/design_snapshots$/.test(path)) {
      const body = JSON.parse(init.body);
      calls.snapshotPosts.push(body);
      return json([{ id: 'S1', created_at: '2026-11-04T00:00:00Z', ...body }], 201);
    }
    throw new Error('unexpected fetch ' + method + ' ' + u);
  };
  calls.restore = () => { globalThis.fetch = original; };
  return calls;
}

function body(over) {
  return Object.assign({
    planner_design_id: 'proj-test-1',
    title: '시험 설계 (합성)',
    design: { items: [{ categoryId: 'sink', name: '싱크대', w: 2400, modules: [{ pos: 'lower', type: 'door', w: 900 }, { pos: 'upper', type: 'door', w: 900 }] }] },
    bom: { materials: [
      { partId: 'w1/floor/m1|0-lower-0-body:side-0', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 },
      { partId: 'w1/floor/m2|0-lower-0-body:side-0', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 },
    ] },
    hardware: {},
  }, over || {});
}

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

test('부재 ID 겹침 — 비어 있는 ID 는 세지 않는다', () => {
  assert.deepEqual(duplicatePartIds([{ partId: 'a' }, { partId: 'b' }, { partId: 'a' }, { part: 'x' }, { partId: '' }]), ['a']);
  assert.deepEqual(duplicatePartIds(null), []);
});

test('처음 보내면 앱 설계를 만든다 — 출처 planner-lite · 플래너 설계 id · 주인은 보낸 사람, 동결본은 createSnapshot 그대로', async () => {
  const f = fakeSupabase();
  try {
    const r = await receivePlannerDesign(ENV, { user: { id: OWNER }, body: body() });
    assert.deepEqual([r.design_id, r.created, r.snapshot_id, r.reused], ['D-NEW', true, 'S1', false]);
    const d = f.designPosts[0];
    assert.deepEqual([d.source, d.source_ref, d.user_id, d.company_id, d.name, d.status, d.total_items, d.total_modules], [PLANNER_SOURCE, 'proj-test-1', OWNER, HQ, '시험 설계 (합성)', 'draft', 1, 2]);
    assert.equal(f.snapshotPosts.length, 1);
    assert.equal(f.snapshotPosts[0].design_id, 'D-NEW');
    assert.equal(f.snapshotPosts[0].bom_payload.materials.length, 2, 'BOM 은 플래너가 보낸 그대로');
  } finally { f.restore(); }
});

test('다시 보내면 같은 앱 설계에 동결 — 새 설계를 만들지 않는다', async () => {
  const f = fakeSupabase({ existing: { id: 'D-OLD', user_id: OWNER, name: '시험 설계 (합성)' } });
  try {
    const r = await receivePlannerDesign(ENV, { user: { id: OWNER }, body: body() });
    assert.deepEqual([r.design_id, r.created], ['D-OLD', false]);
    assert.equal(f.designPosts.length, 0);
    assert.equal(f.snapshotPosts[0].design_id, 'D-OLD');
  } finally { f.restore(); }
});

test('본사 직원(대표 · 실장 아님)은 보내지 못한다 — 403 not_planner_sender, 아무것도 쓰지 않는다', async () => {
  const f = fakeSupabase();
  try {
    await assert.rejects(() => receivePlannerDesign(ENV, { user: { id: STAFF }, body: body() }), (e) => e instanceof ForbiddenError && e.code === 'not_planner_sender');
    assert.equal(f.designPosts.length + f.snapshotPosts.length + f.designFinds, 0);
  } finally { f.restore(); }
});

test('부재 ID 가 겹치면 INSERT 전에 422 · 플래너 설계 id · 이름이 없어도 422', async () => {
  const f = fakeSupabase();
  try {
    const dup = body();
    dup.bom.materials[1].partId = dup.bom.materials[0].partId;
    await assert.rejects(() => receivePlannerDesign(ENV, { user: { id: OWNER }, body: dup }), (e) => e instanceof ValidationError && /부재 ID/.test(e.message));
    await assert.rejects(() => receivePlannerDesign(ENV, { user: { id: OWNER }, body: body({ planner_design_id: '../x' }) }), ValidationError);
    await assert.rejects(() => receivePlannerDesign(ENV, { user: { id: OWNER }, body: body({ title: '  ' }) }), ValidationError);
    assert.equal(f.designPosts.length + f.snapshotPosts.length, 0);
  } finally { f.restore(); }
});

test('DB 0035 적용 전 — 409 db_pending', async () => {
  const f = fakeSupabase({ missing: true });
  try {
    await assert.rejects(() => receivePlannerDesign(ENV, { user: { id: OWNER }, body: body() }), (e) => e instanceof ConflictError && e.details && e.details.code === 'db_pending');
  } finally { f.restore(); }
});

test('라우트 — POST /planner/designs 는 로그인이 있어야 한다', async () => {
  const res = await worker.fetch(new Request('https://w.example/planner/designs', { method: 'POST', body: '{}' }), ENV, { waitUntil() {} });
  assert.equal(res.status, 401);
});
