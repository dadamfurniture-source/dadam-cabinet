/**
 * 간편 플래너 웹판 저장소 (src/planner-drafts.js — DB 0046)
 *
 *   쓸 수 있는 사람: 다담 공장 · active 협력업체(expert · agent · manager) 구성원 · 관리자(다담 공장으로)
 *   보기: 그 업체 구성원 누구나 · 고치기 · 버리기 · 사진: 만든 사람 또는 대표 · 실장
 *   저장: rev 하나씩, check 면 rev 가 같을 때만(409 conflict), 내용이 같으면 그대로, 버린 설계는 409 discarded
 * 사람 · 설계는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  plannerAccess,
  listDrafts,
  getDraft,
  saveDraft,
  discardDraft,
  getAppState,
  putAppState,
  addPhoto,
  readPhoto,
  deletePhoto,
  listMyModules,
  saveMyModule,
  deleteMyModule,
  recommendOf,
  summaryOf,
  sniffPhoto,
  stableJson,
  PLANNER_PLANS,
} from '../src/planner-drafts.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P1 = 'f0000000-0000-4000-8000-0000000000b1'; // expert
const P2 = 'f0000000-0000-4000-8000-0000000000b2'; // standard
const P3 = 'f0000000-0000-4000-8000-0000000000b3'; // manager
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000002';
const STAFF2 = 'a0000000-0000-4000-8000-000000000003';
const STD = 'a0000000-0000-4000-8000-000000000004';
const MGR = 'a0000000-0000-4000-8000-000000000005';
const NOBODY = 'a0000000-0000-4000-8000-000000000009';
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const u = (id) => ({ id });

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
  arrayBuffer: async () => new ArrayBuffer(0),
});

function makeDb({ drafts = true } = {}) {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
      { id: P2, kind: 'partner', name: '다라 팩토리', plan: 'standard', status: 'active' },
      { id: P3, kind: 'partner', name: '마바 팩토리', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: P1, role: 'owner', status: 'active' },
      { user_id: STAFF, company_id: P1, role: 'staff', status: 'active' },
      { user_id: STAFF2, company_id: P1, role: 'staff', status: 'active' },
      { user_id: STD, company_id: P2, role: 'owner', status: 'active' },
      { user_id: MGR, company_id: P3, role: 'staff', status: 'active' },
    ],
    admin_roles: [{ user_id: ADMIN, role: 'admin' }],
    planner_drafts: drafts ? [] : null,
    planner_draft_photos: drafts ? [] : null,
    planner_my_modules: drafts ? [] : null,
    objects: new Map(),
    patches: [],
  };
}

const KEYS = { planner_drafts: ['company_id', 'id'], planner_my_modules: ['user_id', 'id'], planner_draft_photos: ['company_id', 'draft_id', 'file'] };

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|neq|in)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'neq') return String(v) !== m[2];
  return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(v));
}

let clock = Date.parse('2026-11-07T00:00:00Z');
const now = () => new Date((clock += 1000)).toISOString();

async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    if (s.includes('/storage/v1/object/')) {
      const key = decodeURIComponent(s.split('/storage/v1/object/')[1]);
      if (method === 'POST') {
        db.objects.set(key, new Uint8Array(init.body));
        return json({ Key: key });
      }
      const got = db.objects.get(key);
      if (!got) return json({ error: 'not found' }, 404);
      return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => got.buffer.slice(got.byteOffset, got.byteOffset + got.byteLength) };
    }
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const hit = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') {
      let rows = hit();
      const order = q.get('order');
      if (order) {
        const [col] = order.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? 1 : -1));
      }
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const keys = KEYS[table];
      if (keys && db[table].some((r) => keys.every((k) => r[k] === body[k]))) return json({ code: '23505', message: 'duplicate key 23505' }, 409);
      const t = now();
      const row = { created_at: t, updated_at: t, discarded_at: null, deleted_at: null, ...body };
      db[table].push(row);
      return json([row], 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const rows = hit();
      rows.forEach((r) => Object.assign(r, patch, table === 'planner_drafts' ? { updated_at: now() } : {}));
      db.patches.push({ table, patch, n: rows.length });
      return json(rows);
    }
    if (method === 'DELETE') {
      const gone = hit();
      db[table] = db[table].filter((r) => !gone.includes(r));
      return json(gone);
    }
    throw new Error(`unexpected ${method} ${s}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const project = (over = {}) => ({
  format: 'dadam.planner-lite/1',
  id: 'd-test-0001',
  name: '시험 주방',
  item: 'sink',
  createdAt: '2026-11-07T01:00:00.000Z',
  updatedAt: '2026-11-07T01:05:00.000Z',
  walls: [
    { lines: { floor: [{ libId: 'LB-D2-900' }, { libId: 'TL-A', tiers: ['TT-1', 'TT-2'] }], upper: [{ libId: 'UB-D2-900' }] } },
    { lines: { floor: [{ libId: 'LB-D2-900' }] } },
  ],
  ...over,
});

function png(w = 4, h = 3) {
  const u8 = new Uint8Array(33);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(u8.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return u8;
}
const photoRequest = (bytes) => new Request('https://w.example/x', { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/png' } });

async function rejects(p, status, code) {
  await assert.rejects(p, (e) => {
    assert.equal(e.statusCode, status, e.message);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

test('누가 쓰나 — 다담 공장 · Expert · Agent · MANAGER 팩토리 구성원, 관리자는 다담 공장으로', async () => {
  assert.deepEqual([...PLANNER_PLANS], ['expert', 'agent', 'manager']);
  const db = makeDb();
  await withDb(db, async () => {
    const a = await plannerAccess(ENV, { user: u(OWNER) });
    assert.deepEqual(a, { company: { id: P1, name: '가나 팩토리', kind: 'partner', plan: 'expert' }, role: 'owner', can_manage: true });
    assert.equal((await plannerAccess(ENV, { user: u(STAFF) })).can_manage, false);
    assert.equal((await plannerAccess(ENV, { user: u(MGR) })).company.plan, 'manager');
    const ad = await plannerAccess(ENV, { user: u(ADMIN) });
    assert.deepEqual([ad.company.id, ad.role, ad.can_manage], [HQ, 'admin', true]);
    await rejects(plannerAccess(ENV, { user: u(STD) }), 403, 'not_planner_company');
    await rejects(plannerAccess(ENV, { user: u(NOBODY) }), 403, 'not_member');
  });
  // 멈춘 팩토리는 못 쓴다
  const db2 = makeDb();
  db2.companies[1].status = 'suspended';
  await withDb(db2, () => rejects(plannerAccess(ENV, { user: u(OWNER) }), 403, 'not_planner_company'));
});

test('요약 — 벽 · 모듈 수(바닥 + 상부), 라이브러리 모듈은 단마다 한 번씩', () => {
  const s = summaryOf(project({ orderNo: 'SO-1', completedConfirmed: true }));
  assert.equal(s.walls, 2);
  assert.equal(s.modules, 4);
  assert.deepEqual(s.libIds, ['LB-D2-900', 'TL-A', 'TT-1', 'TT-2', 'UB-D2-900']);
  assert.equal(s.orderNo, 'SO-1');
  assert.equal(s.completed, true);
  assert.equal(stableJson({ b: 1, a: [{ d: 2, c: 3 }] }), stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test('저장 · 목록 · 열기 — 새 설계는 rev 하나, rev · archivedAt 은 표 칸이 맡는다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const r = await saveDraft(ENV, { user: u(STAFF), body: { project: { ...project(), rev: 0, archivedAt: 'x' } } });
    assert.deepEqual(r, { id: 'd-test-0001', rev: 1, count: 1 });
    const row = db.planner_drafts[0];
    assert.equal(row.company_id, P1);
    assert.equal(row.created_by, STAFF);
    assert.equal('rev' in row.model, false);
    assert.equal('archivedAt' in row.model, false);
    assert.equal(row.summary.modules, 4);

    const list = await listDrafts(ENV, { user: u(STAFF2) });
    assert.equal(list.count, 1);
    assert.deepEqual(
      { id: list.items[0].id, name: list.items[0].name, walls: list.items[0].walls, modules: list.items[0].modules, rev: list.items[0].rev, mine: list.items[0].mine },
      { id: 'd-test-0001', name: '시험 주방', walls: 2, modules: 4, rev: 1, mine: false }
    );
    const got = await getDraft(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' }, query: {} });
    assert.equal(got.project.rev, 1);
    assert.equal(got.project.name, '시험 주방');
    // 다른 업체(관리자 = 다담 공장)는 못 본다
    assert.equal((await listDrafts(ENV, { user: u(ADMIN) })).count, 0);
    await rejects(getDraft(ENV, { user: u(ADMIN), params: { id: 'd-test-0001' }, query: {} }), 404);
    assert.deepEqual(await getDraft(ENV, { user: u(ADMIN), params: { id: 'd-test-0001' }, query: { ifExists: '1' } }), { project: null });
  });
});

test('고치기 — 만든 사람 · 대표만, 내용이 바뀌면 rev + 1, 같으면 그대로, check 면 rev 가 같을 때만', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    await rejects(saveDraft(ENV, { user: u(STAFF2), body: { project: project({ name: '남이 고침', rev: 1 }) } }), 403, 'not_draft_editor');

    const r2 = await saveDraft(ENV, { user: u(STAFF), body: { project: project({ name: '고침', rev: 1 }), check: true } });
    assert.equal(r2.rev, 2);
    assert.equal(db.planner_drafts[0].name, '고침');
    assert.equal(db.planner_drafts[0].updated_by, STAFF);

    // 같은 내용 — PATCH 없이 그대로
    const before = db.patches.length;
    const same = await saveDraft(ENV, { user: u(OWNER), body: { project: project({ name: '고침', rev: 2 }) } });
    assert.equal(same.rev, 2);
    assert.equal(db.patches.length, before);

    // 대표는 남의 설계도 고친다
    assert.equal((await saveDraft(ENV, { user: u(OWNER), body: { project: project({ name: '대표가 고침', rev: 2 }) } })).rev, 3);

    // 옛 사본(rev 1)으로 check 저장 → 409, 저장된 rev 를 알려 준다
    await assert.rejects(saveDraft(ENV, { user: u(STAFF), body: { project: project({ name: '옛 사본', rev: 1 }), check: true } }), (e) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.code, 'conflict');
      assert.deepEqual(e.details, { rev: 3 });
      return true;
    });
    // check 없으면 덮어쓴다 (저장된 rev 다음)
    assert.equal((await saveDraft(ENV, { user: u(STAFF), body: { project: project({ name: '덮어씀', rev: 1 }) } })).rev, 4);
  });
});

test('버리기 — 표시만, 버린 뒤 열기 404 · 저장 409 discarded, 남은 수', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    await saveDraft(ENV, { user: u(STAFF), body: { project: project({ id: 'd-test-0002' }) } });
    await rejects(discardDraft(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' } }), 403, 'not_draft_editor');
    assert.deepEqual(await discardDraft(ENV, { user: u(STAFF), params: { id: 'd-test-0001' } }), { discarded: true, count: 1 });
    assert.equal(db.planner_drafts.length, 2);
    assert.ok(db.planner_drafts[0].discarded_at);
    assert.deepEqual(await discardDraft(ENV, { user: u(STAFF), params: { id: 'd-test-0001' } }), { discarded: false, count: 1 });
    await rejects(getDraft(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, query: {} }), 404);
    await rejects(saveDraft(ENV, { user: u(STAFF), body: { project: project({ rev: 1 }) } }), 409, 'discarded');
    assert.equal((await listDrafts(ENV, { user: u(STAFF) })).count, 1);
  });
});

test('잘못된 저장 — id 모양 · project 없음 · 5MB 넘음', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await rejects(saveDraft(ENV, { user: u(STAFF), body: { project: project({ id: '../x' }) } }), 422);
    await rejects(saveDraft(ENV, { user: u(STAFF), body: {} }), 422);
    await rejects(saveDraft(ENV, { user: u(STAFF), body: { project: project({ blob: 'x'.repeat(5 * 1024 * 1024) }) } }), 413);
    await rejects(saveDraft(ENV, { user: u(STD), body: { project: project() } }), 403, 'not_planner_company');
    assert.equal(db.planner_drafts.length, 0);
  });
});

test('앱 보낸 기록 — 읽기 · 적기 (만든 사람 · 대표), 64KB 까지', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    assert.deepEqual(await getAppState(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' } }), { state: null });
    await rejects(putAppState(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' }, body: { state: { designId: 'x' } } }), 403, 'not_draft_editor');
    await putAppState(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, body: { state: { designId: 'x', snapshotId: 'y' } } });
    assert.deepEqual((await getAppState(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' } })).state, { designId: 'x', snapshotId: 'y' });
    assert.equal(db.planner_drafts[0].rev, 1);
    await rejects(putAppState(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, body: { state: { big: 'x'.repeat(70000) } } }), 413);
    await rejects(putAppState(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, body: { state: [1] } }), 422);
  });
});

test('사진 — 올리기(업체/설계/파일 경로 · 줄) · 읽기(바이트) · 지우기(표시만), 형식 · 남의 설계', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    const r = await addPhoto(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, request: photoRequest(png(40, 30)) });
    assert.match(r.file, /^photo-[a-z0-9]+-[0-9a-f]{8}\.png$/);
    assert.deepEqual([r.w, r.h, r.bytes], [40, 30, 33]);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.ok(db.objects.has(`planner-photos/${P1}/d-test-0001/${r.file}`));
    assert.equal(db.planner_draft_photos[0].mime, 'image/png');

    const got = await readPhoto(ENV, { user: u(STAFF2), params: { id: 'd-test-0001', file: r.file } });
    assert.equal(got.mime, 'image/png');
    assert.equal(got.bytes.byteLength, 33);

    await rejects(deletePhoto(ENV, { user: u(STAFF2), params: { id: 'd-test-0001', file: r.file } }), 403, 'not_draft_editor');
    assert.deepEqual(await deletePhoto(ENV, { user: u(OWNER), params: { id: 'd-test-0001', file: r.file } }), { file: r.file });
    assert.ok(db.planner_draft_photos[0].deleted_at);
    assert.ok(db.objects.has(`planner-photos/${P1}/d-test-0001/${r.file}`));
    await rejects(readPhoto(ENV, { user: u(STAFF), params: { id: 'd-test-0001', file: r.file } }), 404);

    await rejects(addPhoto(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, request: photoRequest(new Uint8Array(40).fill(7)) }), 422);
    await rejects(addPhoto(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' }, request: photoRequest(png()) }), 403, 'not_draft_editor');
    await rejects(addPhoto(ENV, { user: u(STAFF), params: { id: 'd-none-0001' }, request: photoRequest(png()) }), 404);
    await rejects(readPhoto(ENV, { user: u(STAFF), params: { id: 'd-test-0001', file: '../x.png' } }), 422);
  });
});

test('사진 형식 — JPEG SOF · PNG · WEBP(VP8X) 크기, 아니면 null', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0, 0]);
  assert.deepEqual(sniffPhoto(jpg), { ext: 'jpg', mime: 'image/jpeg', w: 30, h: 20 });
  assert.deepEqual(sniffPhoto(png(7, 9)), { ext: 'png', mime: 'image/png', w: 7, h: 9 });
  const webp = new Uint8Array(30);
  webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  webp.set([99, 0, 0, 49, 0, 0], 24);
  assert.deepEqual(sniffPhoto(webp), { ext: 'webp', mime: 'image/webp', w: 100, h: 50 });
  assert.equal(sniffPhoto(new Uint8Array(20)), null);
});

test('내 모듈 — 사람마다 저장 · 목록 · 지우기, id 모양', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const mod = { id: 'my-abc123def456', name: '내 900 도어장', libId: 'LB-D2-900', W: 900, item: 'sink', createdAt: '2026-11-07T00:00:00Z' };
    assert.equal((await saveMyModule(ENV, { user: u(STAFF), body: { module: mod } })).count, 1);
    assert.equal(db.planner_my_modules[0].company_id, P1);
    assert.deepEqual((await listMyModules(ENV, { user: u(STAFF) })).modules[0].libId, 'LB-D2-900');
    assert.equal((await listMyModules(ENV, { user: u(STAFF2) })).count, 0);
    await rejects(saveMyModule(ENV, { user: u(STAFF), body: { module: { ...mod, id: 'x' } } }), 422);
    await rejects(deleteMyModule(ENV, { user: u(STAFF), params: { id: '../x' } }), 422);
    assert.deepEqual(await deleteMyModule(ENV, { user: u(STAFF), params: { id: mod.id } }), { id: mod.id, count: 0 });
  });
});

test('추천 — 그 사람이 마지막으로 저장한 그 품목 설계에 든 모듈, 설계 수 많은 것부터', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    await saveDraft(ENV, { user: u(STAFF), body: { project: project({ id: 'd-test-0002', walls: [{ lines: { floor: [{ libId: 'LB-D2-900' }] } }] }) } });
    await saveDraft(ENV, { user: u(STAFF), body: { project: project({ id: 'd-test-0003', item: 'shoerack', walls: [{ lines: { floor: [{ libId: 'SH-1' }] } }] }) } });
    await saveDraft(ENV, { user: u(OWNER), body: { project: project({ id: 'd-test-0004' }) } });
    const r = await recommendOf(ENV, { user: u(STAFF), query: { item: 'sink' } });
    assert.equal(r.designs, 2);
    assert.deepEqual(r.used[0], { id: 'LB-D2-900', n: 2 });
    assert.equal(r.used.length, 5);
    await rejects(recommendOf(ENV, { user: u(STAFF), query: {} }), 422);
  });
});

test('DB 0046 전 — 409 db_pending (쓸 수 있나는 표 없이 답한다)', async () => {
  const db = makeDb({ drafts: false });
  await withDb(db, async () => {
    assert.equal((await plannerAccess(ENV, { user: u(OWNER) })).can_manage, true);
    await rejects(listDrafts(ENV, { user: u(OWNER) }), 409, 'db_pending');
    await rejects(saveDraft(ENV, { user: u(OWNER), body: { project: project() } }), 409, 'db_pending');
    await rejects(listMyModules(ENV, { user: u(OWNER) }), 409, 'db_pending');
  });
});

test('라우트 — worker.js 에 길이 다 있다', () => {
  const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const [method, path] of [
    ['GET', '/planner/access'],
    ['GET', '/planner/drafts'],
    ['POST', '/planner/drafts'],
    ['GET', '/planner/drafts/:id'],
    ['POST', '/planner/drafts/:id/discard'],
    ['GET', '/planner/drafts/:id/app-state'],
    ['PUT', '/planner/drafts/:id/app-state'],
    ['POST', '/planner/drafts/:id/photos'],
    ['GET', '/planner/drafts/:id/photos/:file'],
    ['DELETE', '/planner/drafts/:id/photos/:file'],
    ['GET', '/planner/my-modules'],
    ['POST', '/planner/my-modules'],
    ['DELETE', '/planner/my-modules/:id'],
    ['GET', '/planner/recommend'],
  ]) {
    assert.match(src, new RegExp(`method: '${method}',\\s+path: '${path.replace(/[/:]/g, (c) => `\\${c}`)}',`), `${method} ${path}`);
  }
});
