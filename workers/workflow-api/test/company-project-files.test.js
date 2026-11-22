/**
 * 프로젝트 단계 사진 (src/company-project-files.js · DB 0083)
 *   POST   /company/projects/:id/stages/:key/photos   사진 올리기
 *   DELETE /company/projects/:id/photos/:fileId       지우기
 *   GET    /company/projects/:id/stages/:key          단계 칸에 올린 사진이 맨 앞 (src/company-project-stage.js)
 * 2026-11-23 대표님 승인 계획 「프로젝트 관리 새 틀」 — 답 5번 「① 2차로 만듦」.
 *
 * 고정하는 것
 *   1) 내 업체의 프로젝트에만, 그 단계에만 올린다. 경로는 <업체>/<프로젝트>/<uuid>.jpg|png — 화면에는 서명 주소만 간다
 *   2) 지우기는 올린 사람 · 대표 · 실장. 줄은 남기고 표시만 하고 버킷 파일을 치운다. 지운 사진은 단계 칸에 안 나온다
 *   3) JPEG · PNG 만, 한 단계에 STAGE_UPLOADS_MAX 장까지. 표 · 버킷이 없으면(DB 적용 전) 409 db_pending — 단계 칸은 그대로 읽힌다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { FILES_BUCKET, STAGE_UPLOADS_MAX } from '../src/company-project-files.js';
import { createFake, callWorker, objectsOf, ENV } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (d, h = 0) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const NOW = Date.parse(at(23, 3));

const A = cid(1);
const B = cid(2);
const OWNER_A = uid(11);
const STAFF_A = uid(13);
const STAFF_A2 = uid(14);
const OWNER_B = uid(21);
const NOBODY = uid(90);
const P1 = rid(11);
const PB = rid(15);

function tables({ files = [] } = {}) {
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF_A2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    profiles: [],
    projects: [
      { id: P1, company_id: A, customer_id: null, title: '예시 주방', status: 'active', created_at: at(2) },
      { id: PB, company_id: B, customer_id: null, title: '남의 프로젝트', status: 'active', created_at: at(2) },
    ],
    consultations: [],
    project_visits: [],
    designs: [],
    ...(files ? { project_files: files } : {}),
  };
}

/** 가장 작은 PNG 머리 (가로 · 세로만 읽힌다) */
function png(w = 4, h = 3) {
  const u8 = new Uint8Array(33);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(u8.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return u8;
}

/** 워커를 본문 그대로(사진 바이트) 부른다 */
async function raw(fake, path, token, { method = 'POST', bytes } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const r = await worker.fetch(
      new Request(`https://api.test${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(bytes ? { 'Content-Type': 'image/png' } : {}) },
        body: bytes,
      }),
      ENV,
      { waitUntil() {} }
    );
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  } finally {
    globalThis.fetch = original;
  }
}
const upload = (fake, token, { id = P1, key = 'measure', bytes = png() } = {}) =>
  raw(fake, `/company/projects/${id}/stages/${key}/photos`, token, { bytes });
const remove = (fake, token, fileId, id = P1) => raw(fake, `/company/projects/${id}/photos/${fileId}`, token, { method: 'DELETE' });
const stage = async (fake, token, key = 'measure', id = P1) => {
  const r = await callWorker(worker, fake, `/company/projects/${id}/stages/${key}`, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const make = (opts) => createFake({ tables: tables(opts), nowMs: NOW, buckets: [FILES_BUCKET, 'planner-photos'] });
const pathRe = new RegExp(`^${A}/${P1}/[0-9a-f-]{36}\\.png$`);

test('올리기 — 직원도 올린다. 줄에 단계 · 경로 · 올린 사람, 화면에는 서명 주소만. 단계 칸 맨 앞에 나온다', async () => {
  const fake = make();
  const r = await upload(fake, STAFF_A);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual([d.kind, d.label, d.note, d.mine], ['upload', '올린 사진', null, true]);
  assert.match(d.url, new RegExp(`/storage/v1/object/sign/${FILES_BUCKET}/${A}/${P1}/`));
  assert.equal(JSON.stringify(d).includes('"path"'), false);

  const [row] = fake.db.project_files;
  assert.deepEqual([row.company_id, row.project_id, row.stage, row.created_by, row.deleted_at], [A, P1, 'measure', STAFF_A, null]);
  assert.match(row.path, pathRe);
  assert.deepEqual(objectsOf(fake, FILES_BUCKET), [row.path]);

  // 단계 칸 — 그 단계에만, 내가 올린 것은 지울 수 있다
  const m = await stage(fake, STAFF_A);
  assert.deepEqual(m.uploads, { ready: true, max: STAGE_UPLOADS_MAX, count: 1 });
  assert.deepEqual(m.photos.map((p) => [p.id, p.kind, p.mine]), [[row.id, 'upload', true]]);
  const other = await stage(fake, STAFF_A, 'install');
  assert.deepEqual([other.uploads.count, other.photos], [0, []]);
  // 사진이 없던 단계(상담 · 견적 · 계약)에도 칸이 생긴다
  const consult = await stage(fake, STAFF_A, 'consult');
  assert.deepEqual([consult.uploads.ready, consult.photos], [true, []]);
  // 다른 직원이 보면 지울 수 없고, 대표는 지울 수 있다
  assert.deepEqual((await stage(fake, STAFF_A2)).photos.map((p) => p.mine), [false]);
  assert.deepEqual((await stage(fake, OWNER_A)).photos.map((p) => p.mine), [true]);
});

test('올리기 — 남의 업체 프로젝트 · 없는 프로젝트는 404, 구성원이 아니면 403, 단계 이름이 틀리면 422. 아무것도 남지 않는다', async () => {
  const fake = make();
  assert.equal((await upload(fake, STAFF_A, { id: PB })).status, 404);
  assert.equal((await upload(fake, STAFF_A, { id: rid(99) })).status, 404);
  assert.equal((await upload(fake, NOBODY)).status, 403);
  assert.equal((await upload(fake, STAFF_A, { key: 'party' })).status, 422);
  assert.deepEqual([fake.db.project_files, objectsOf(fake, FILES_BUCKET)], [[], []]);
});

test('올리기 — JPEG · PNG 만, 너무 큰 사진 · 빈 본문은 422', async () => {
  const fake = make();
  const bad = async (bytes) => {
    const r = await upload(fake, STAFF_A, { bytes });
    return [r.status, r.json.code || (r.json.error && r.json.error.code) || null];
  };
  assert.equal((await bad(new TextEncoder().encode('사진이 아닌 글입니다 ……')))[0], 422);
  assert.equal((await bad(png(4000, 3000)))[0], 422);
  assert.equal((await raw(fake, `/company/projects/${P1}/stages/measure/photos`, STAFF_A)).status, 422);
  assert.deepEqual([fake.db.project_files, objectsOf(fake, FILES_BUCKET)], [[], []]);
});

test(`올리기 — 한 단계에 ${STAGE_UPLOADS_MAX}장까지 (지운 것은 세지 않는다)`, async () => {
  const row = (n, extra = {}) => ({
    id: rid(500 + n),
    company_id: A,
    project_id: P1,
    stage: 'measure',
    path: `${A}/${P1}/${rid(700 + n)}.jpg`,
    note: null,
    created_by: STAFF_A,
    created_at: at(20, n % 24),
    deleted_at: null,
    deleted_by: null,
    ...extra,
  });
  const full = make({ files: Array.from({ length: STAGE_UPLOADS_MAX }, (_, i) => row(i)) });
  const r = await upload(full, STAFF_A);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(JSON.stringify(r.json).includes('too_many'), true);
  assert.equal(full.db.project_files.length, STAGE_UPLOADS_MAX);
  assert.deepEqual(objectsOf(full, FILES_BUCKET), []);
  // 다른 단계에는 올릴 수 있다
  assert.equal((await upload(full, STAFF_A, { key: 'install' })).status, 201);
  // 하나를 지운 것이면 자리가 난다
  const room = make({ files: Array.from({ length: STAGE_UPLOADS_MAX }, (_, i) => row(i, i === 0 ? { deleted_at: at(21), deleted_by: STAFF_A } : {})) });
  assert.equal((await upload(room, STAFF_A)).status, 201);
});

test('지우기 — 올린 사람 · 대표가 지운다. 줄은 남고 표시만, 버킷 파일은 치우고, 단계 칸에서 사라진다', async () => {
  const fake = make();
  const a = (await upload(fake, STAFF_A)).json.data;
  const b = (await upload(fake, STAFF_A)).json.data;
  // 다른 직원은 못 지운다
  const no = await remove(fake, STAFF_A2, a.id);
  assert.equal(no.status, 403, JSON.stringify(no.json));
  assert.equal(fake.db.project_files.every((r) => r.deleted_at === null), true);
  // 올린 사람
  const mine = await remove(fake, STAFF_A, a.id);
  assert.deepEqual([mine.status, mine.json.data], [200, { id: a.id }]);
  const rowA = fake.db.project_files.find((r) => r.id === a.id);
  assert.deepEqual([typeof rowA.deleted_at, rowA.deleted_by], ['string', STAFF_A]);
  assert.equal(objectsOf(fake, FILES_BUCKET).includes(rowA.path), false);
  // 대표
  assert.equal((await remove(fake, OWNER_A, b.id)).status, 200);
  assert.equal(fake.db.project_files.length, 2);
  assert.deepEqual(objectsOf(fake, FILES_BUCKET), []);
  const m = await stage(fake, STAFF_A);
  assert.deepEqual([m.uploads.count, m.photos], [0, []]);
  // 이미 지운 것 · 없는 것 · 남의 업체에서는 404
  assert.equal((await remove(fake, STAFF_A, a.id)).status, 404);
  assert.equal((await remove(fake, STAFF_A, rid(98))).status, 404);
  assert.equal((await remove(fake, OWNER_B, b.id, P1)).status, 404);
});

test('지우기 — 버킷 파일을 못 치워도 지운 것으로 친다 (단계 칸에 안 나온다)', async () => {
  const fake = make();
  const a = (await upload(fake, STAFF_A)).json.data;
  const inner = fake.fetch;
  fake.fetch = (input, init = {}) =>
    init.method === 'DELETE' && String(typeof input === 'string' ? input : input.url).includes('/storage/v1/object/')
      ? Promise.resolve(new Response('{"message":"boom"}', { status: 500 }))
      : inner(input, init);
  assert.equal((await remove(fake, STAFF_A, a.id)).status, 200);
  assert.deepEqual((await stage(fake, STAFF_A)).photos, []);
});

test('DB 0083 전 — 표가 없으면 올리기 · 지우기는 409 db_pending, 단계 칸은 그대로 읽히고 올리기 자리만 없다', async () => {
  const fake = make({ files: null });
  const r = await upload(fake, STAFF_A);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(JSON.stringify(r.json).includes('db_pending'), true);
  assert.deepEqual(objectsOf(fake, FILES_BUCKET), []);
  assert.equal((await remove(fake, STAFF_A, rid(98))).status, 409);
  const m = await stage(fake, STAFF_A);
  assert.deepEqual([m.uploads, m.photos], [{ ready: false, max: STAGE_UPLOADS_MAX, count: 0 }, []]);
});

test('DB 0083 전 — 버킷이 없으면 올리기는 409 db_pending, 줄을 남기지 않는다', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW, buckets: [] });
  const r = await upload(fake, STAFF_A);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.deepEqual(fake.db.project_files, []);
});

test('줄을 못 넣으면 올린 파일을 치운다 (주인 없는 파일을 남기지 않는다)', async () => {
  const fake = createFake({
    tables: tables(),
    nowMs: NOW,
    buckets: [FILES_BUCKET],
    before: (method, table) =>
      method === 'POST' && table === 'project_files'
        ? new Response(JSON.stringify({ code: '23514', message: 'project_files_path_check' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        : null,
  });
  const r = await upload(fake, STAFF_A);
  assert.ok(r.status >= 400, JSON.stringify(r.json));
  assert.deepEqual([fake.db.project_files, objectsOf(fake, FILES_BUCKET)], [[], []]);
});
