/**
 * 수주 완료 보고 (src/order-reports.js — DB 0043, 2026-11-06 작업 분배 ⑤ 「설치 완료」 · 「A/S 완료」 + 사진, 본사는 기록만)
 *
 *   보고 · 사진: 그 팩토리 대표 · 실장, 또는 그 수주 프로젝트의 담당자 (그 밖은 403 not_reporter)
 *   사진은 서버가 비공개 버킷에 — 이 수주 경로만 붙는다 · 10장까지 · 종류 둘 · 메모 500자
 *   보기: 수주를 볼 수 있는 사람 (사진은 서명 주소), 본사 관리자는 모든 팩토리 모아 보기
 *   0043 전이면 쓰기 409 db_pending · 보기 ready false
 * 사람 · 주문은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { addOrderReport, addReportPhoto, listOrderReports, listReportsAdmin, reportOf, PHOTOS_MAX } from '../src/order-reports.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000002';
const STAFF2 = 'a0000000-0000-4000-8000-000000000003';
const OTHER = 'a0000000-0000-4000-8000-000000000009';
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const O1 = 'e0000000-0000-4000-8000-000000000001';
const PRJ = 'e0000000-0000-4000-8000-0000000000e1';
const MEMBERS = [
  { user_id: OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: STAFF, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: STAFF2, company_id: PARTNER, role: 'staff', status: 'active' },
];
const u = (id) => ({ id });

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

function png(w = 4, h = 3) {
  const u8 = new Uint8Array(33);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(u8.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return u8;
}
const photoRequest = (bytes) => new Request('https://w.example/x', { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/png' } });

function makeDb({ reports = true } = {}) {
  return {
    orders: [{ id: O1, order_no: 'SO-1', customer_name: '홍길동', design_id: 'D1', company_id: PARTNER, project_id: PRJ, status: 'delivered' }],
    designs: [{ id: 'D1', user_id: OWNER, company_id: PARTNER }],
    projects: [{ id: PRJ, company_id: PARTNER, assignee_id: STAFF }],
    named: [{ id: PARTNER, name: '가나 팩토리', kind: 'partner' }, { id: HQ, name: '다담 공장', kind: 'hq' }],
    admin_roles: [{ user_id: ADMIN, role: 'admin' }],
    order_reports: reports ? [] : null,
    uploads: [],
  };
}

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|neq|in|gte)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'neq') return String(v) !== m[2];
  if (m[1] === 'gte') return Date.parse(v) >= Date.parse(m[2]);
  return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(v));
}

async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    if (s.includes('/storage/v1/object/sign/')) {
      const b = JSON.parse(init.body);
      return json(b.paths.map((p) => ({ path: p, signedURL: `/object/sign/order-report-photos/${p}?token=t` })));
    }
    if (s.includes('/storage/v1/object/')) {
      db.uploads.push(s.split('/storage/v1/object/')[1]);
      return json({ Key: 'k' });
    }
    if (s.includes('/companies?') && s.includes('select=id,name')) {
      const q = new URLSearchParams(s.split('?')[1]);
      return json(db.named.filter((r) => matches(r, 'id', q.get('id'))));
    }
    const hit = companyRoute(s, { members: MEMBERS });
    if (hit) return hit;
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    if (method === 'GET') {
      let rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      if (q.get('order') === 'created_at.desc') rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const row = { id: `r${db[table].length + 1}`, created_at: new Date(Date.now() + db[table].length * 1000).toISOString(), ...body };
      db[table].push(row);
      return json([row], 201);
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

const p = { orderId: O1 };

test('본문 검사 (순수) — 종류 둘 · 메모 500자 · 이 수주 경로만 · 10장까지', () => {
  const order = { id: O1, company_id: PARTNER };
  const path = (n) => `${PARTNER}/${O1}/0000000${n}-0000-4000-8000-000000000000.jpg`;
  assert.deepEqual(reportOf({ kind: 'install_done', note: '  끝 ', photo_paths: [path(1), path(1)] }, order), { kind: 'install_done', note: '끝', photos: [path(1)] });
  assert.throws(() => reportOf({ kind: 'inspect' }, order), (e) => e.statusCode === 422);
  assert.throws(() => reportOf({ kind: 'as_done', note: 'x'.repeat(501) }, order), (e) => e.statusCode === 422);
  assert.throws(() => reportOf({ kind: 'as_done', photo_paths: [`${PARTNER}/other/x.jpg`] }, order), (e) => e.statusCode === 422);
  assert.throws(() => reportOf({ kind: 'as_done', photo_paths: Array.from({ length: PHOTOS_MAX + 1 }, (_, i) => path(i)) }, order), (e) => e.statusCode === 422);
});

test('대표 — 사진을 올리고 붙여 「설치 완료」 보고, 목록은 최신순 · 사진 서명 주소, 수주 상태는 그대로', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const { photo_path } = await addReportPhoto(ENV, { user: u(OWNER), params: p, request: photoRequest(png()) });
    assert.match(photo_path, new RegExp(`^${PARTNER}/${O1}/[0-9a-f-]{36}\\.png$`));
    assert.equal(db.uploads.length, 1);
    const r = await addOrderReport(ENV, { user: u(OWNER), params: p, body: { kind: 'install_done', note: '설치 끝났습니다', photo_paths: [photo_path] } });
    assert.deepEqual([r.kind, r.note, r.photo_count], ['install_done', '설치 끝났습니다', 1]);
    assert.deepEqual(db.order_reports[0], { ...db.order_reports[0], company_id: PARTNER, order_id: O1, photos: [photo_path], reported_by: OWNER });
    await addOrderReport(ENV, { user: u(OWNER), params: p, body: { kind: 'as_done' } });
    const v = await listOrderReports(ENV, { user: u(STAFF2), params: p });
    assert.equal(v.ready, true);
    assert.equal(v.can_report, false, '담당자가 아닌 직원은 보기만');
    assert.deepEqual(v.items.map((x) => [x.label, x.photo_urls.length]), [['A/S 완료', 0], ['설치 완료', 1]]);
    assert.match(v.items[1].photo_urls[0], /order-report-photos/);
    assert.equal(db.orders[0].status, 'delivered');
  });
});

test('누가 — 담당자인 직원은 된다, 담당자가 아닌 직원은 403 not_reporter, 남의 팩토리는 수주부터 못 본다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await addOrderReport(ENV, { user: u(STAFF), params: p, body: { kind: 'install_done' } });
    await assert.rejects(() => addOrderReport(ENV, { user: u(STAFF2), params: p, body: { kind: 'install_done' } }), (e) => e.statusCode === 403 && e.code === 'not_reporter');
    await assert.rejects(() => addReportPhoto(ENV, { user: u(STAFF2), params: p, request: photoRequest(png()) }), (e) => e.statusCode === 403);
    await assert.rejects(() => listOrderReports(ENV, { user: u(OTHER), params: p }), (e) => e.statusCode === 403 || e.statusCode === 404);
    assert.equal(db.order_reports.length, 1);
  });
});

test('본사 모아 보기 — 관리자만, 팩토리 이름 · 주문번호 · 종류 · 사진, 날 수 검사', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const { photo_path } = await addReportPhoto(ENV, { user: u(OWNER), params: p, request: photoRequest(png()) });
    await addOrderReport(ENV, { user: u(OWNER), params: p, body: { kind: 'install_done', photo_paths: [photo_path] } });
    const v = await listReportsAdmin(ENV, { user: u(ADMIN), query: {} });
    assert.deepEqual(v.items.map((x) => [x.company_name, x.order_no, x.label, x.photo_urls.length]), [['가나 팩토리', 'SO-1', '설치 완료', 1]]);
    assert.equal(v.days, 30);
    await assert.rejects(() => listReportsAdmin(ENV, { user: u(OWNER), query: {} }), (e) => e.statusCode === 403);
    await assert.rejects(() => listReportsAdmin(ENV, { user: u(ADMIN), query: { days: '91' } }), (e) => e.statusCode === 422);
    const old = await listReportsAdmin(ENV, { user: u(ADMIN), query: { days: '1' }, nowMs: Date.now() + 3 * 86400000 });
    assert.deepEqual(old.items, [], '그 날 수 안의 보고만');
  });
});

test('DB 0043 전 — 쓰기 409 db_pending, 보기 ready false', async () => {
  const db = makeDb({ reports: false });
  await withDb(db, async () => {
    await assert.rejects(() => addOrderReport(ENV, { user: u(OWNER), params: p, body: { kind: 'install_done' } }), (e) => e.statusCode === 409 && e.code === 'db_pending');
    const v = await listOrderReports(ENV, { user: u(OWNER), params: p });
    assert.deepEqual(v, { ready: false, can_report: false, items: [] });
    const a = await listReportsAdmin(ENV, { user: u(ADMIN), query: {} });
    assert.equal(a.ready, false);
  });
});
