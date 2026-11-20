/**
 * 본사가 고른 연출컷만 시공사례에 (2026-11-20, src/hq-collection.js · DB 0075).
 *
 * 고정하는 것:
 *   1) 누가: 사이트 관리자(admin_roles admin · super_admin) · 다담 본사(platform) active 대표 · 실장만 — 아니면 403 not_hq
 *   2) 목록: 끝난 AI 스튜디오 연출컷(플래너 모드 · 모르는 품목 · 대표 연출컷 없는 것 빼고) 새 것부터, 고른 것인지,
 *      사진은 서명 주소, 고객 id 를 내보내지 않는다, 다음 쪽 시각
 *   3) 올리기: 게시물이 없으면 자동 게시 스위치가 꺼져 있어도 복사해 새로 올리고 고른 때 · 사람을 적는다,
 *      예전 자동 게시 행(고른 때 없음)이 있으면 고른 때만 적는다, 이미 고른 것은 그대로
 *   4) 내리기: 게시물 행과 공개 복사본을 지운다
 *   5) DB 0075 전(hq_picked_at 칸 없음)이면 409 db_pending
 *   6) 길: GET /api/hq/collection · POST|DELETE /api/hq/collection/:id — 토큰 없으면 401
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  HQ_COLLECTION_PAGE,
  assertHqPicker,
  listHqCollection,
  pickHqCollection,
  pickable,
  unpickHqCollection,
} from '../src/hq-collection.js';

const SB = 'https://example.supabase.co';
const HQ_USER = '11111111-1111-4111-8111-111111111111';
const CUST = '44444444-4444-4444-8444-444444444444';
const PLATFORM = '55555555-5555-4555-8555-555555555555';
const GEN = '22222222-2222-4222-8222-222222222222';
const GEN2 = '66666666-6666-4666-8666-666666666666';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
  COLLECTION_AUTO_POST: 'off',
};
const base = (id) => ({ slot: 'base', label: '싱크대 · 기본안', path: `${CUST}/${id}/base.png`, url: 'stored' });
const genRow = (id, extra = {}) => ({
  id,
  user_id: CUST,
  status: 'done',
  category: 'sink',
  options: { door_color: 'walnut woodgrain' },
  images: [base(id), { slot: 'v1', path: `${CUST}/${id}/v1.jpg` }],
  created_at: '2026-11-20T01:00:00.000Z',
  ...extra,
});

const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Supabase 흉내 — admin · members · gens · posts · missingColumn 로 답을 정한다 */
function installSupabase({ admin = null, members = [], gens = [], posts = [], missingColumn = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    if (u.includes('/auth/v1/user')) return jsonRes({ id: HQ_USER, email: 'hq@example.com' });
    if (u.includes('/rest/v1/admin_roles')) return jsonRes(admin ? [{ role: admin }] : []);
    if (u.includes('/rest/v1/companies')) return jsonRes([{ id: PLATFORM }]);
    if (u.includes('/rest/v1/company_members')) {
      calls.push({ kind: 'member', url: u });
      return jsonRes(u.includes(`company_id=eq.${PLATFORM}`) ? members : []);
    }
    if (u.includes('/rest/v1/generations')) {
      calls.push({ kind: 'gens', url: u });
      const one = u.match(/id=eq\.([0-9a-f-]{36})/);
      return jsonRes(one ? gens.filter((g) => g.id === one[1]) : gens);
    }
    if (u.includes('/rest/v1/collection_posts')) {
      if (missingColumn && u.includes('hq_picked')) return jsonRes({ code: '42703', message: 'column collection_posts.hq_picked_at does not exist' }, 400);
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        calls.push({ kind: 'insert', body });
        return jsonRes([{ id: 'new-post', ...body }], 201);
      }
      if (method === 'PATCH') {
        calls.push({ kind: 'patch', url: u, body: JSON.parse(init.body) });
        return jsonRes([{ id: 'p' }]);
      }
      if (method === 'DELETE') {
        calls.push({ kind: 'row-delete', url: u });
        return jsonRes(posts.map((p) => ({ storage_path: p.storage_path })));
      }
      calls.push({ kind: 'posts', url: u });
      return jsonRes(posts);
    }
    if (u.includes('/storage/v1/object/sign/generations')) {
      const body = JSON.parse(init.body);
      return jsonRes(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/generations/${p}?token=t` })));
    }
    if (u.startsWith(`${SB}/storage/v1/object/generations/`) && method === 'GET') {
      return new Response(Buffer.from('PNG'), { headers: { 'Content-Type': 'image/png' } });
    }
    if (u.startsWith(`${SB}/storage/v1/object/collection`)) {
      calls.push({ kind: method === 'DELETE' ? 'file-delete' : 'upload', url: u });
      return jsonRes({ Key: 'ok' });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  return calls;
}

// ─── 1) 누가 ───

test('누가: 사이트 관리자 · 본사 대표 · 실장은 되고, 본사 직원 · 다른 사람은 403 not_hq', async () => {
  installSupabase({ admin: 'admin' });
  assert.deepEqual(await assertHqPicker(ENV, { id: HQ_USER }), { via: 'admin' });
  installSupabase({ members: [{ role: 'manager' }] });
  assert.deepEqual(await assertHqPicker(ENV, { id: HQ_USER }), { via: 'platform' });
  installSupabase({ members: [{ role: 'staff' }] });
  await assert.rejects(assertHqPicker(ENV, { id: HQ_USER }), (e) => e.statusCode === 403 && e.code === 'not_hq');
  installSupabase({});
  await assert.rejects(assertHqPicker(ENV, { id: HQ_USER }), (e) => e.code === 'not_hq');
});

// ─── 2) 목록 ───

test('고를 수 있는 연출컷: 끝남 · AI 스튜디오 · 아는 품목 · 대표 연출컷 있음', () => {
  assert.equal(pickable(genRow(GEN)), true);
  assert.equal(pickable(genRow(GEN, { status: 'failed' })), false);
  assert.equal(pickable(genRow(GEN, { options: { mode: 'planner' } })), false);
  assert.equal(pickable(genRow(GEN, { category: 'mystery' })), false);
  assert.equal(pickable(genRow(GEN, { images: [{ slot: 'v1', path: 'x' }] })), false);
});

test('목록: 새 것부터 · 고른 것인지 · 서명 주소 · 품목 · 문 색, 고객 id 는 없다', async () => {
  const calls = installSupabase({
    gens: [genRow(GEN), genRow(GEN2, { category: 'wardrobe', options: { door_color: 'white' }, created_at: '2026-11-19T01:00:00.000Z' })],
    posts: [{ generation_id: GEN, hq_picked_at: '2026-11-20T02:00:00.000Z' }, { generation_id: GEN2, hq_picked_at: null }],
  });
  const out = await listHqCollection(ENV, '');
  const q = calls.find((c) => c.kind === 'gens').url;
  assert.match(q, /status=eq\.done/);
  assert.match(q, /order=created_at\.desc/);
  assert.match(q, /options->>mode\.neq\.planner/);
  assert.match(q, new RegExp(`limit=${HQ_COLLECTION_PAGE}`));
  assert.deepEqual(
    out.items.map((i) => [i.id, i.place_label, i.door_color, i.picked]),
    [
      [GEN, '싱크대', '월넛', true],
      [GEN2, '붙박이장', '화이트', false], // 예전 자동 게시 행(고른 때 없음)은 「안 올림」
    ]
  );
  assert.match(out.items[0].image, /\/object\/sign\/generations\/.+base\.png\?token=t$/);
  assert.equal(JSON.stringify({ ...out, items: out.items.map(({ image, ...rest }) => rest) }).includes(CUST), false); // 사진 주소 말고는 고객 id 없음
  assert.equal(Object.keys(out.items[0]).includes('user_id'), false);
  assert.equal(out.next, null);
});

test('목록: before 시각 앞 것만, 시각이 아니면 400', async () => {
  const calls = installSupabase({ gens: [] });
  await listHqCollection(ENV, '2026-11-20T00:00:00.000Z');
  assert.match(calls.find((c) => c.kind === 'gens').url, /created_at=lt\.2026-11-20T00:00:00\.000Z/);
  await assert.rejects(listHqCollection(ENV, 'nope'), (e) => e.statusCode === 400);
});

// ─── 3) 올리기 ───

test('올리기: 게시물이 없으면 스위치가 꺼져 있어도 복사해 올리고 고른 때 · 사람을 적는다', async () => {
  const calls = installSupabase({ gens: [genRow(GEN)], posts: [] });
  const out = await pickHqCollection(ENV, GEN, { id: HQ_USER }, { now: () => 'T1' });
  assert.deepEqual(out, { picked: true, created: true });
  const ins = calls.find((c) => c.kind === 'insert').body;
  assert.equal(ins.source, 'ai_render');
  assert.equal(ins.generation_id, GEN);
  assert.equal(ins.hq_picked_at, 'T1');
  assert.equal(ins.hq_picked_by, HQ_USER);
  assert.equal(ins.place_label, '싱크대');
  assert.ok(calls.some((c) => c.kind === 'upload' && /\/collection\/ai\/[0-9a-f-]{36}\.png$/.test(c.url)));
});

test('올리기: 예전 자동 게시 행이 있으면 고른 때만 적는다, 이미 고른 것은 그대로', async () => {
  let calls = installSupabase({ gens: [genRow(GEN)], posts: [{ id: 'old', hq_picked_at: null }] });
  const patched = [];
  const patch = async (env, table, id, body) => patched.push([table, id, body]);
  assert.deepEqual(await pickHqCollection(ENV, GEN, { id: HQ_USER }, { now: () => 'T2', patch }), { picked: true, created: false });
  assert.deepEqual(patched, [['collection_posts', 'old', { hq_picked_at: 'T2', hq_picked_by: HQ_USER }]]);
  assert.equal(calls.some((c) => c.kind === 'insert' || c.kind === 'upload'), false);
  calls = installSupabase({ gens: [genRow(GEN)], posts: [{ id: 'old', hq_picked_at: 'T0' }] });
  patched.length = 0;
  await pickHqCollection(ENV, GEN, { id: HQ_USER }, { patch });
  assert.deepEqual(patched, []);
});

test('올리기: 고를 수 없는 연출컷 · 모르는 id 는 404', async () => {
  installSupabase({ gens: [genRow(GEN, { options: { mode: 'planner' } })] });
  await assert.rejects(pickHqCollection(ENV, GEN, { id: HQ_USER }), (e) => e.statusCode === 404);
  await assert.rejects(pickHqCollection(ENV, 'nope', { id: HQ_USER }), (e) => e.statusCode === 404);
});

// ─── 4) 내리기 ───

test('내리기: 게시물 행과 공개 복사본을 지운다', async () => {
  const calls = installSupabase({ posts: [{ storage_path: 'ai/x.png' }] });
  assert.deepEqual(await unpickHqCollection(ENV, GEN), { picked: false, removed: 1 });
  assert.ok(calls.some((c) => c.kind === 'row-delete' && c.url.includes(`generation_id=eq.${GEN}`)));
  assert.ok(calls.some((c) => c.kind === 'file-delete'));
});

// ─── 5) DB 0075 전 ───

test('DB 0075 전이면 목록 · 올리기가 409 db_pending', async () => {
  console.warn = () => {};
  installSupabase({ gens: [genRow(GEN)], missingColumn: true });
  await assert.rejects(listHqCollection(ENV, ''), (e) => e.statusCode === 409 && e.code === 'db_pending');
  await assert.rejects(pickHqCollection(ENV, GEN, { id: HQ_USER }), (e) => e.code === 'db_pending');
});

// ─── 6) 길 ───

test('길: 토큰 없으면 401, 본사 아니면 403, 본사면 목록 · 올리기 · 내리기', async () => {
  const req = (method, path, auth = true) =>
    new Request(`https://w.example${path}`, {
      method,
      headers: { Origin: 'https://dadamfurniture.com', ...(auth ? { Authorization: 'Bearer t' } : {}) },
    });
  installSupabase({});
  let res = await worker.fetch(req('GET', '/api/hq/collection', false), ENV, {});
  assert.equal(res.status, 401);
  res = await worker.fetch(req('GET', '/api/hq/collection'), ENV, {});
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'not_hq');
  installSupabase({ admin: 'admin', gens: [genRow(GEN)], posts: [] });
  res = await worker.fetch(req('GET', '/api/hq/collection'), ENV, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.items.length, 1);
  res = await worker.fetch(req('POST', `/api/hq/collection/${GEN}`), ENV, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).picked, true);
  res = await worker.fetch(req('DELETE', `/api/hq/collection/${GEN}`), ENV, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).picked, false);
});
