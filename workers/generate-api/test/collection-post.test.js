/**
 * 시공사례 자동 게시 (2026-10-27, src/collection-post.js · database/collection-auto-post.sql).
 *
 * 고정하는 것:
 *   1) 올릴지: COLLECTION_AUTO_POST 'on' · AI 스튜디오(플래너 모드 아님) · 기본안 있음 · 아는 품목 — 품목 짝은 표 그대로
 *   2) 무엇을: 기본안(base) 한 장을 service_role 로 읽어 공개 버킷 collection 'ai/{무작위 UUID}.{ext}' 에 복사
 *      (주소에 회원 id · 연출컷 id 없음 — DB 0052), 행은 그 공개 URL(generations · 서명 URL 아님) · source 'ai_render' ·
 *      generation_id · ON CONFLICT DO NOTHING
 *   3) 멱등 · 실패: 이미 있으면 행은 그대로 두고 방금 올린 복사본을 지운다, 행을 못 넣으면 복사본을 지운다(그 경로를
 *      가리키는 행이 있다고 확인될 때만 남긴다), 던지지 않는다
 *   4) 잡: done 패치를 보낸 뒤에 올리고, 게시가 실패해도 done 은 그대로 · 재시도 없음. 플래너 모드는 올리지 않는다.
 *      fail() 의 기본안 있는 done 도 올리고, done 패치가 실패했으면 올리지 않는다
 *   5) 연출컷 삭제(DELETE /api/generate/:id)는 게시물 행과 복사본을 먼저 지운다
 *   6) 사진 정보 (DB 0049): place_label = 품목 이름, door_color = 문짝 색 이름 (모르면 null), company_id = 올린 사람의
 *      active 업체 (없으면 null) — 업체는 파일을 올리기 전에 읽고, 못 읽으면 아무것도 올리지 않는다.
 *      이름 표는 화면 글 · DB 0049 채우기 표와 같다
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GenerateJob } from '../src/job.js';
import worker from '../src/worker.js';
import { CATEGORIES, DOOR_COLORS } from '../src/prompts.js';
import {
  COLLECTION_CATEGORY,
  COLLECTION_DOOR_COLOR,
  COLLECTION_PLACE_LABEL,
  collectionPath,
  collectionPostInfo,
  collectionPostPlan,
  postToCollection,
  removeCollectionPostsFor,
} from '../src/collection-post.js';

const SB = 'https://example.supabase.co';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
  COLLECTION_AUTO_POST: 'on',
};
const BASE = { label: '신발장 · 기본안', path: `${USER_ID}/${ROW_ID}/base.png`, url: 'stored' };
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const JOB = { id: ROW_ID, userId: USER_ID, category: 'shoe', options: { design_style: 'modern', door_color: 'walnut woodgrain' } };
const CK = { images: { base: BASE, v1: { path: `${USER_ID}/${ROW_ID}/v1.jpg` } } };

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  console.error = realError;
});

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const b64 = (s) => Buffer.from(s).toString('base64');

/**
 * Supabase 흉내. collection 쪽 호출을 calls 에 차례로 남긴다.
 *   insert: 'ok' | 'dup' | 'error'   existing: 정리 때 보이는 행
 *   members: company_members 읽기 결과 (기본 없음 = 고객) | 'error'
 */
function installSupabase({ insert = 'ok', existing = [], baseRead = 'ok', patchFail = false, members = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.startsWith(`${SB}/storage/v1/object/generations/`) && method === 'GET') {
      calls.push({ kind: 'read', url: u });
      if (baseRead !== 'ok') return new Response('nope', { status: 404 });
      return new Response(Buffer.from('PNGBYTES'), { headers: { 'Content-Type': 'image/png' } });
    }
    if (u.startsWith(`${SB}/storage/v1/object/collection`)) {
      calls.push({ kind: method === 'DELETE' ? 'file-delete' : 'upload', url: u, headers: init.headers, body: init.body });
      return jsonRes({ Key: 'ok' });
    }
    if (u.startsWith(`${SB}/rest/v1/company_members`)) {
      calls.push({ kind: 'member', url: decodeURIComponent(u), headers: init.headers, method });
      if (members === 'error') return jsonRes({ message: 'boom' }, 500);
      return jsonRes(members);
    }
    if (u.startsWith(`${SB}/rest/v1/collection_posts`)) {
      if (method === 'POST') {
        calls.push({ kind: 'insert', url: u, headers: init.headers, body: JSON.parse(init.body) });
        if (insert === 'error') return jsonRes({ message: 'column "source" does not exist' }, 400);
        return jsonRes(insert === 'dup' ? [] : [{ id: 'p1' }], 201);
      }
      if (method === 'DELETE') {
        calls.push({ kind: 'row-delete', url: decodeURIComponent(u) });
        return jsonRes(existing);
      }
      calls.push({ kind: 'select', url: decodeURIComponent(u) });
      return jsonRes(existing);
    }
    // 잡·경로가 쓰는 나머지
    if (u.includes('/storage/v1/object/')) {
      if (method === 'POST') return jsonRes({ Key: 'ok' });
      if (method === 'DELETE') {
        calls.push({ kind: 'gen-file-delete', url: u });
        return jsonRes([]);
      }
      return new Response(Buffer.from('IMG'), { headers: { 'Content-Type': u.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if (method === 'GET') return jsonRes([]);
      if (method === 'DELETE') {
        calls.push({ kind: 'gen-delete', url: u });
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(init.body);
      calls.push({ kind: 'patch', body });
      if (patchFail && body.status) return jsonRes({ message: 'boom' }, 500);
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 1800, wall_height_mm: 2400, confidence: 'medium', existing_furniture: 'none', site_condition: 'finished' })
          : JSON.stringify({ ok: true, issues: [], note: '' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  return calls;
}

// ─── 1) 올릴지 ───

test('품목 짝: 생성 품목 전부가 collection_posts.category CHECK 안의 값으로 간다', () => {
  assert.deepEqual(Object.keys(COLLECTION_CATEGORY).sort(), Object.keys(CATEGORIES).sort(), '빠진 품목이 없다');
  for (const v of Object.values(COLLECTION_CATEGORY)) {
    assert.ok(['kitchen', 'builtin', 'storage', 'interior', 'other'].includes(v), v);
  }
  assert.deepEqual(COLLECTION_CATEGORY, {
    sink: 'kitchen', island: 'kitchen', fridge: 'kitchen',
    wardrobe: 'builtin', shoe: 'builtin', bedroom: 'builtin',
    storage: 'storage', vanity: 'interior', office: 'other', study: 'other',
  });
});

test('올릴지: on · AI 스튜디오 · 기본안 · 아는 품목일 때만', () => {
  assert.deepEqual(collectionPostPlan(ENV, JOB, CK), { ok: true, base: BASE, category: 'builtin' });
  assert.equal(collectionPostPlan({ ...ENV, COLLECTION_AUTO_POST: 'off' }, JOB, CK).reason, 'off');
  assert.equal(collectionPostPlan({ ...ENV, COLLECTION_AUTO_POST: undefined }, JOB, CK).reason, 'off');
  assert.equal(collectionPostPlan(ENV, { ...JOB, options: { mode: 'planner' } }, CK).reason, 'planner');
  assert.equal(collectionPostPlan(ENV, JOB, { images: { v1: CK.images.v1 } }).reason, 'no_base', '추천안만 있으면 올리지 않는다');
  assert.equal(collectionPostPlan(ENV, { ...JOB, category: 'kitchen_island_x' }, CK).reason, 'unknown_category');
});

const AI_PATH = /^ai\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;

test('경로: ai/{무작위 UUID}.{확장자} — 회원 id · 연출컷 id 가 없고, 부를 때마다 새 경로', () => {
  const png = collectionPath('image/png');
  const jpg = collectionPath('image/jpeg');
  assert.match(png, AI_PATH);
  assert.ok(png.endsWith('.png'));
  assert.ok(jpg.endsWith('.jpg'));
  assert.notEqual(collectionPath('image/png'), png);
  for (const p of [png, jpg]) {
    assert.ok(!p.includes(USER_ID) && !p.includes(ROW_ID), p);
  }
});

// ─── 2) 무엇을 ───

test('게시: 기본안을 읽어 collection 에 복사하고 공개 URL 로 행 하나 — ON CONFLICT DO NOTHING', async () => {
  const calls = installSupabase();
  const out = await postToCollection(ENV, JOB, CK);
  assert.equal(out.posted, true);
  assert.equal(out.reason, undefined);
  assert.match(out.path, AI_PATH);
  assert.ok(out.path.endsWith('.png'));
  const path = out.path;
  assert.deepEqual(calls.map((c) => c.kind), ['read', 'member', 'upload', 'insert']);
  assert.equal(calls[0].url, `${SB}/storage/v1/object/generations/${BASE.path}`, '기본안만 읽는다 (v1·방 사진 아님)');
  const up = calls[2];
  assert.equal(up.url, `${SB}/storage/v1/object/collection/${path}`);
  assert.equal(up.headers.Authorization, 'Bearer service');
  assert.equal(up.headers['Content-Type'], 'image/png');
  assert.equal(up.headers['x-upsert'], 'true');
  assert.equal(up.headers['Cache-Control'], 'max-age=3600');
  assert.equal(Buffer.from(up.body).toString(), 'PNGBYTES');
  const ins = calls[3];
  assert.equal(ins.url, `${SB}/rest/v1/collection_posts?on_conflict=generation_id`);
  assert.equal(ins.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
  assert.deepEqual(ins.body, {
    user_id: USER_ID,
    image_url: `${SB}/storage/v1/object/public/collection/${path}`,
    storage_path: path,
    category: 'builtin',
    source: 'ai_render',
    generation_id: ROW_ID,
    place_label: '신발장',
    door_color: '월넛',
    company_id: null,
  });
  assert.ok(!/generations|token=|object\/sign/.test(ins.body.image_url), 'generations 주소·서명 URL 을 저장하지 않는다');
  for (const v of [ins.body.image_url, ins.body.storage_path, up.url]) {
    assert.ok(!v.includes(USER_ID) && !v.includes(ROW_ID), `공개 주소에 회원 id · 연출컷 id 가 없다: ${v}`);
  }
});

// ─── 3) 멱등 · 실패 ───

test('멱등: 이미 올라가 있으면(ON CONFLICT) 행은 그대로 — 방금 올린 복사본만 지운다', async () => {
  const calls = installSupabase({ insert: 'dup' });
  const out = await postToCollection(ENV, JOB, CK);
  assert.deepEqual(out, { posted: false, reason: 'duplicate' });
  const up = calls.find((c) => c.kind === 'upload');
  const del = calls.filter((c) => c.kind === 'file-delete');
  assert.equal(del.length, 1);
  assert.equal(del[0].url, `${SB}/storage/v1/object/collection`);
  assert.deepEqual(JSON.parse(del[0].body), { prefixes: [up.url.slice(`${SB}/storage/v1/object/collection/`.length)] });
  assert.deepEqual(calls.map((c) => c.kind), ['read', 'member', 'upload', 'insert', 'file-delete']);
});

test('실패: 행을 못 넣으면 복사본을 지운다 — 던지지 않는다', async () => {
  console.warn = () => {};
  const calls = installSupabase({ insert: 'error', existing: [] });
  const out = await postToCollection(ENV, JOB, CK);
  assert.deepEqual(out, { posted: false, reason: 'error' });
  const path = calls.find((c) => c.kind === 'upload').url.slice(`${SB}/storage/v1/object/collection/`.length);
  assert.match(path, AI_PATH);
  const del = calls.find((c) => c.kind === 'file-delete');
  assert.ok(del, '복사본 삭제');
  assert.equal(del.url, `${SB}/storage/v1/object/collection`);
  assert.deepEqual(JSON.parse(del.body), { prefixes: [path] });
});

test('실패: 같은 연출컷 행이 방금 올린 경로를 가리킨다고 확인되면 남긴다 — 연출컷 id 와 경로로 묻는다', async () => {
  console.warn = () => {};
  const calls = installSupabase({ insert: 'error', existing: [{ id: 'p0' }] });
  await postToCollection(ENV, JOB, CK);
  assert.equal(calls.filter((c) => c.kind === 'file-delete').length, 0);
  const path = calls.find((c) => c.kind === 'upload').url.slice(`${SB}/storage/v1/object/collection/`.length);
  const sel = calls.find((c) => c.kind === 'select');
  assert.equal(sel.url, `${SB}/rest/v1/collection_posts?generation_id=eq.${ROW_ID}&storage_path=eq.${path}&select=id`);
});

test('실패: 기본안을 못 읽으면 올리지도 넣지도 않는다', async () => {
  console.warn = () => {};
  const calls = installSupabase({ baseRead: 'fail' });
  const out = await postToCollection(ENV, JOB, CK);
  assert.deepEqual(out, { posted: false, reason: 'error' });
  assert.deepEqual(calls.map((c) => c.kind), ['read']);
});

// ─── 6) 사진 정보 (DB 0049) ───

test('사진 정보: 업체 구성원이면 그 업체 id — service_role 로 active 구성원 줄 하나만 읽는다', async () => {
  const calls = installSupabase({ members: [{ company_id: COMPANY_ID }] });
  const out = await postToCollection(ENV, JOB, CK);
  assert.equal(out.posted, true);
  const member = calls.find((c) => c.kind === 'member');
  assert.equal(member.method, 'GET');
  assert.equal(member.headers.Authorization, 'Bearer service');
  assert.equal(member.url, `${SB}/rest/v1/company_members?user_id=eq.${USER_ID}&status=eq.active&select=company_id&limit=1`);
  const ins = calls.find((c) => c.kind === 'insert');
  assert.equal(ins.body.company_id, COMPANY_ID);
  assert.ok(!('region' in ins.body), '지역은 넣지 않는다 (연출컷의 방은 고객 집)');
});

test('사진 정보: 업체를 못 읽으면 파일도 행도 올리지 않는다 — 던지지 않는다', async () => {
  console.warn = () => {};
  const calls = installSupabase({ members: 'error' });
  const out = await postToCollection(ENV, JOB, CK);
  assert.deepEqual(out, { posted: false, reason: 'error' });
  assert.deepEqual(calls.map((c) => c.kind), ['read', 'member']);
});

test('사진 정보: 품목 이름 · 문짝 색 이름 — 모르는 값이면 null', () => {
  assert.deepEqual(collectionPostInfo(JOB), { place_label: '신발장', door_color: '월넛' });
  assert.deepEqual(collectionPostInfo({ category: 'sink', options: { door_color: 'oak woodgrain' } }), { place_label: '싱크대', door_color: '오크' });
  assert.deepEqual(collectionPostInfo({ category: 'sink', options: {} }), { place_label: '싱크대', door_color: null });
  assert.deepEqual(collectionPostInfo({ category: 'mystery', options: { door_color: 'pink' } }), { place_label: null, door_color: null });
  assert.deepEqual(collectionPostInfo({ category: 'sink' }), { place_label: '싱크대', door_color: null });
});

test('사진 정보: 이름 표는 품목 · 문짝 색 전부를 덮고, DB 0049 채우기 표 · 화면 글과 같다', () => {
  assert.deepEqual(Object.keys(COLLECTION_PLACE_LABEL).sort(), Object.keys(CATEGORIES).sort(), '빠진 품목이 없다');
  assert.deepEqual(Object.keys(COLLECTION_DOOR_COLOR), [...DOOR_COLORS], '받는 문짝 색 전부');
  const sql = fs.readFileSync(new URL('../../../database/migrations/0049_collection_info.sql', import.meta.url), 'utf8');
  const pairs = (expr) => {
    const at = sql.indexOf(`CASE ${expr}`);
    assert.ok(at > 0, expr);
    const out = {};
    for (const m of sql.slice(at, sql.indexOf('END', at)).matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)) out[m[1]] = m[2];
    return out;
  };
  assert.deepEqual(pairs('g.category'), { ...COLLECTION_PLACE_LABEL });
  assert.deepEqual(pairs("g.options ->> 'door_color'"), { ...COLLECTION_DOOR_COLOR });
  const html = fs.readFileSync(new URL('../../../ai-design.html', import.meta.url), 'utf8');
  const sel = /<select id="doorColor">([\s\S]*?)<\/select>/.exec(html)[1];
  const doors = Object.fromEntries([...sel.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(doors, { ...COLLECTION_DOOR_COLOR });
  const kinds = {};
  for (const m of html.matchAll(/key: '(\w+)',\s*label: '([^']+)'/g)) kinds[m[1]] = m[2];
  assert.deepEqual(kinds, { ...COLLECTION_PLACE_LABEL });
});

test('플래너 모드·꺼짐은 아무 요청도 하지 않는다', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch 하면 안 된다');
  };
  assert.equal((await postToCollection(ENV, { ...JOB, options: { mode: 'planner' } }, CK)).reason, 'planner');
  assert.equal((await postToCollection({ ...ENV, COLLECTION_AUTO_POST: 'off' }, JOB, CK)).reason, 'off');
});

// ─── 4) 잡 ───

function fakeState() {
  const m = new Map();
  return {
    m,
    storage: {
      get: async (k) => m.get(k),
      put: async (k, v) => void m.set(k, structuredClone(v)),
      setAlarm: async () => {
        m.set('__alarm', true);
      },
      deleteAll: async () => m.clear(),
      deleteAlarm: async () => {},
    },
  };
}

const INPUTS = { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] };

async function runJob(env, options) {
  const state = fakeState();
  const job = new GenerateJob(state, env);
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'shoe', options, inputs: INPUTS, startedAt: Date.now() }),
    })
  );
  state.m.delete('__alarm');
  await job.alarm();
  return state;
}

test('잡: done 패치를 보낸 뒤 기본안 한 장을 올린다 — 잡은 깨끗이 끝난다', async () => {
  const calls = installSupabase();
  const state = await runJob(ENV, { variants: false });
  const doneAt = calls.findIndex((c) => c.kind === 'patch' && c.body.status === 'done');
  assert.ok(doneAt >= 0, 'done');
  // 잡 앞부분은 방 사진(room.jpg)을 읽는다 — 게시가 읽는 것은 기본안(base.png) 하나다
  const baseUrl = `${SB}/storage/v1/object/generations/${USER_ID}/${ROW_ID}/base.png`;
  const coll = calls
    .map((c, i) => [c.kind, i, c.url])
    .filter(([k, , u]) => k === 'upload' || k === 'insert' || (k === 'read' && u === baseUrl));
  assert.deepEqual(coll.map(([k]) => k), ['read', 'upload', 'insert']);
  assert.ok(coll.every(([, i]) => i > doneAt), '게시는 done 다음');
  assert.deepEqual(
    calls.slice(doneAt + 1).filter((c) => c.kind === 'read').map((c) => c.url),
    [baseUrl],
    'done 뒤에는 기본안만 읽는다 (추천안·방 사진 아님)'
  );
  assert.equal(calls.filter((c) => c.kind === 'insert').length, 1);
  assert.equal(state.m.size, 0, '체크포인트를 비웠다 (재시도 없음)');
});

test('잡: 게시가 실패해도 done 은 그대로 · 재시도하지 않는다', async () => {
  console.warn = () => {};
  const calls = installSupabase({ insert: 'error' });
  const state = await runJob(ENV, { variants: false });
  assert.equal(calls.filter((c) => c.kind === 'patch' && c.body.status === 'done').length, 1);
  assert.equal(calls.filter((c) => c.kind === 'patch' && c.body.status === 'failed').length, 0);
  assert.ok(calls.some((c) => c.kind === 'file-delete'), '복사본은 지웠다');
  assert.equal(state.m.size, 0);
  assert.equal(state.m.get('__alarm'), undefined, '다시 돌 알람을 걸지 않았다');
});

test('잡: COLLECTION_AUTO_POST 가 꺼져 있으면 올리지 않는다', async () => {
  const calls = installSupabase();
  await runJob({ ...ENV, COLLECTION_AUTO_POST: 'off' }, { variants: false });
  assert.equal(calls.filter((c) => ['upload', 'insert'].includes(c.kind)).length, 0);
});

test('잡 fail(): 기본안이 있어 done 으로 닫으면 올리고, done 패치가 실패했으면 올리지 않는다', async () => {
  const jobObj = { ...JOB, creditRef: 'c' };
  let calls = installSupabase();
  await new GenerateJob(fakeState(), ENV).fail(jobObj, { step: 'variants', images: { base: BASE } }, 'timeout');
  assert.equal(calls.find((c) => c.kind === 'patch').body.status, 'done');
  assert.deepEqual(calls.filter((c) => ['read', 'upload', 'insert'].includes(c.kind)).map((c) => c.kind), ['read', 'upload', 'insert']);

  console.error = () => {};
  calls = installSupabase({ patchFail: true });
  await new GenerateJob(fakeState(), ENV).fail(jobObj, { step: 'variants', images: { base: BASE } }, 'timeout');
  assert.equal(calls.filter((c) => ['upload', 'insert'].includes(c.kind)).length, 0);
});

test('잡 fail(): 기본안이 없으면(failed) 올리지 않는다', async () => {
  const calls = installSupabase();
  globalThis.fetch = ((inner) => async (url, init) => {
    if (String(url).includes('/rest/v1/rpc/refund_credit_svc')) return jsonRes({});
    return inner(url, init);
  })(globalThis.fetch);
  await new GenerateJob(fakeState(), ENV).fail({ ...JOB, creditRef: 'c' }, { step: 'rendering', images: {} }, 'boom');
  assert.equal(calls.find((c) => c.kind === 'patch').body.status, 'failed');
  assert.equal(calls.filter((c) => ['read', 'upload', 'insert'].includes(c.kind)).length, 0);
});

// ─── 5) 연출컷 삭제 ───

test('removeCollectionPostsFor: 행을 지우고 그 파일을 collection 버킷에서 지운다', async () => {
  const calls = installSupabase({ existing: [{ storage_path: `${USER_ID}/gen-${ROW_ID}.png` }] });
  const out = await removeCollectionPostsFor(ENV, ROW_ID);
  assert.deepEqual(out, { removed: 1 });
  assert.equal(calls[0].kind, 'row-delete');
  assert.match(calls[0].url, /collection_posts\?generation_id=eq\.22222222-2222-4222-8222-222222222222&select=storage_path$/);
  assert.equal(calls[1].kind, 'file-delete');
  assert.deepEqual(JSON.parse(calls[1].body), { prefixes: [`${USER_ID}/gen-${ROW_ID}.png`] });
});

test('DELETE /api/generate/:id — 게시물 행·복사본을 먼저 지우고 연출컷을 지운다', async () => {
  const row = { id: ROW_ID, user_id: USER_ID, status: 'done', inputs: INPUTS, images: [{ slot: 'base', path: BASE.path }] };
  const calls = installSupabase({ existing: [{ storage_path: `${USER_ID}/gen-${ROW_ID}.png` }] });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/generations') && (init.method || 'GET') === 'GET') {
      return jsonRes(u.includes('parent_id=') ? [] : [row]);
    }
    return inner(url, init);
  };
  const res = await worker.fetch(
    new Request(`https://api.test/api/generate/${ROW_ID}`, { method: 'DELETE', headers: { Authorization: 'Bearer t' } }),
    { ...ENV }
  );
  assert.equal(res.status, 200);
  const kinds = calls.map((c) => c.kind);
  assert.deepEqual(kinds.filter((k) => ['row-delete', 'file-delete', 'gen-file-delete', 'gen-delete'].includes(k)), [
    'row-delete',
    'file-delete',
    'gen-file-delete',
    'gen-delete',
  ]);
});

test('DELETE /api/generate/:id — 게시물 정리가 실패해도 연출컷 삭제는 간다', async () => {
  console.warn = () => {};
  const row = { id: ROW_ID, user_id: USER_ID, status: 'done', inputs: INPUTS, images: [] };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID });
    if (u.includes('/rest/v1/collection_posts')) return jsonRes({ message: 'column "generation_id" does not exist' }, 400);
    if (u.includes('/rest/v1/generations') && method === 'GET') return jsonRes(u.includes('parent_id=') ? [] : [row]);
    if (u.includes('/rest/v1/generations') && method === 'DELETE') {
      calls.push('gen-delete');
      return new Response(null, { status: 204 });
    }
    if (u.includes('/storage/v1/object/')) return jsonRes([]);
    throw new Error(`unexpected ${method} ${u}`);
  };
  const res = await worker.fetch(
    new Request(`https://api.test/api/generate/${ROW_ID}`, { method: 'DELETE', headers: { Authorization: 'Bearer t' } }),
    { ...ENV }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ['gen-delete']);
});
