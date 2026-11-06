/**
 * 고객 A/S 접수 (src/as-requests.js — DB 0045, 2026-11-06 A/S 접수 묶음)
 *
 *   고객: 본인 수주(고객 계정과 이어진 수주)만 — 남의 수주는 404
 *   간 곳: 그 수주 프로젝트의 담당자, 없으면 대표 · 실장 (앱 알림 as_request — 주문번호만)
 *   팩토리: 받기 · 끝은 대표 · 실장 또는 그 접수의 담당자, 상태는 requested → received → done (requested → cancelled)
 *   본사: 기록 · A/S 율, 48시간 넘게 아무도 안 받으면 Slack 한 메시지 + alerted_at
 *   0045 전이면 쓰기 409 db_pending · 보기 ready false
 * 사람 · 주문은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  addAsPhoto,
  addAsRequest,
  listMyAsRequests,
  cancelMyAsRequest,
  listCompanyAsRequests,
  receiveAsRequest,
  finishAsRequest,
  listAsAdmin,
  runAsAlerts,
  asStats,
  buildAsAlert,
  requestOf,
  PHOTOS_MAX,
  ALERT_HOURS,
} from '../src/as-requests.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const SLACK = 'https://hooks.slack.test/T/B/x';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000002';
const STAFF2 = 'a0000000-0000-4000-8000-000000000003';
const CUSTOMER = 'a0000000-0000-4000-8000-0000000000c1';
const OTHER = 'a0000000-0000-4000-8000-0000000000c2';
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const O1 = 'e0000000-0000-4000-8000-000000000001';
const O2 = 'e0000000-0000-4000-8000-000000000002';
const PRJ = 'e0000000-0000-4000-8000-0000000000e1';
const PRJ2 = 'e0000000-0000-4000-8000-0000000000e2';
const CUS = 'e0000000-0000-4000-8000-0000000000f1';
const REP_AS = 'e0000000-0000-4000-8000-0000000000a1';
const REP_INSTALL = 'e0000000-0000-4000-8000-0000000000a2';
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

function makeDb({ table = true, assignee = STAFF } = {}) {
  return {
    orders: [
      { id: O1, order_no: 'SO-20261106-0A01', company_id: PARTNER, project_id: PRJ, status: 'delivered', completed_at: new Date().toISOString() },
      { id: O2, order_no: 'SO-20261106-0A02', company_id: PARTNER, project_id: PRJ2, status: 'delivered', completed_at: null },
    ],
    projects: [
      { id: PRJ, company_id: PARTNER, customer_id: CUS, assignee_id: assignee },
      { id: PRJ2, company_id: PARTNER, customer_id: null, assignee_id: null },
    ],
    customers: [{ id: CUS, user_id: CUSTOMER }],
    order_reports: [
      { id: REP_AS, order_id: O1, kind: 'as_done' },
      { id: REP_INSTALL, order_id: O1, kind: 'install_done' },
    ],
    named: [{ id: PARTNER, name: '가나 팩토리', kind: 'partner' }, { id: HQ, name: '다담 공장', kind: 'hq' }],
    admin_roles: [{ user_id: ADMIN, role: 'admin' }],
    as_requests: table ? [] : null,
    outbox: [],
    uploads: [],
    slack: [],
  };
}

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|neq|in|gte|lt)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'neq') return String(v) !== m[2];
  if (m[1] === 'gte') return v != null && Date.parse(v) >= Date.parse(m[2]);
  if (m[1] === 'lt') return v != null && Date.parse(v) < Date.parse(m[2]);
  return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(v));
}

/** 0045 지킴이 흉내 — 상태가 바뀔 때만 때를 찍는다 */
function guard(row, patch) {
  const next = { ...row, ...patch };
  if (patch.state && patch.state !== row.state) {
    const okMove = (row.state === 'requested' && ['received', 'cancelled'].includes(patch.state)) || (row.state === 'received' && patch.state === 'done');
    if (!okMove) throw new Error(`지킴이: ${row.state} -> ${patch.state}`);
    const at = new Date().toISOString();
    if (patch.state === 'received') next.received_at = at;
    if (patch.state === 'done') next.done_at = at;
    if (patch.state === 'cancelled') next.cancelled_at = at;
  }
  return next;
}

async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    if (s === SLACK) {
      db.slack.push(JSON.parse(init.body));
      return { ok: !db.slackDown, status: db.slackDown ? 400 : 200, text: async () => (db.slackDown ? 'down' : 'ok') };
    }
    if (s.includes('/storage/v1/object/sign/')) {
      const b = JSON.parse(init.body);
      return json(b.paths.map((p) => ({ path: p, signedURL: `/object/sign/as-request-photos/${p}?token=t` })));
    }
    if (s.includes('/storage/v1/object/')) {
      db.uploads.push(s.split('/storage/v1/object/')[1]);
      return json({ Key: 'k' });
    }
    if (s.includes('/notification_outbox')) {
      db.outbox.push(...JSON.parse(init.body));
      return json(null, 201);
    }
    if (s.includes('/companies?') && s.includes('select=id,name')) {
      const q = new URLSearchParams(s.split('?')[1]);
      return json(db.named.filter((r) => matches(r, 'id', q.get('id'))));
    }
    // notifyRoles — 그 팩토리 active 구성원 전부 (user_id · role)
    if (s.includes('/company_members?') && s.includes('company_id=')) {
      return json(MEMBERS.filter((m) => m.status === 'active').map((m) => ({ user_id: m.user_id, role: m.role })));
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
    const picked = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') {
      let rows = picked();
      if (q.get('order') === 'created_at.desc') rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (q.get('order') === 'created_at.asc') rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const row = { id: crypto.randomUUID(), state: 'requested', created_at: new Date(Date.now() + db[table].length * 1000).toISOString(), ...body };
      db[table].push(row);
      return json([row], 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const out = [];
      for (const r of picked()) {
        Object.assign(r, guard(r, patch));
        out.push({ ...r });
      }
      return json(out);
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
const path = (n) => `${PARTNER}/${O1}/0000000${n}-0000-4000-8000-000000000000.jpg`;

test('본문 검사 (순수) — 내용 1~1000자 · 이 수주 경로만 · 같은 사진 하나로 · 5장까지', () => {
  const order = { id: O1, company_id: PARTNER };
  assert.deepEqual(requestOf({ body: '  문이 안 닫혀요 ', photo_paths: [path(1), path(1)] }, order), { body: '문이 안 닫혀요', photos: [path(1)] });
  assert.deepEqual(requestOf({ body: '서랍' }, order), { body: '서랍', photos: [] });
  assert.throws(() => requestOf({ body: '   ' }, order), (e) => e.statusCode === 422);
  assert.throws(() => requestOf({ body: 'x'.repeat(1001) }, order), (e) => e.statusCode === 422);
  assert.throws(() => requestOf({ body: 'x', photo_paths: 'a.jpg' }, order), (e) => e.statusCode === 422);
  assert.throws(() => requestOf({ body: 'x', photo_paths: [`${PARTNER}/${O2}/00000001-0000-4000-8000-000000000000.jpg`] }, order), (e) => e.statusCode === 422);
  assert.throws(() => requestOf({ body: 'x', photo_paths: Array.from({ length: PHOTOS_MAX + 1 }, (_, i) => path(i)) }, order), (e) => e.statusCode === 422);
});

test('고객 — 사진 올리고 접수, 담당자에게만 앱 알림(주문번호만), 내 접수 목록 · 거두기', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const { photo_path } = await addAsPhoto(ENV, { user: u(CUSTOMER), params: p, request: photoRequest(png()) });
    assert.match(photo_path, new RegExp(`^${PARTNER}/${O1}/[0-9a-f-]{36}\\.png$`));
    assert.equal(db.uploads.length, 1);
    assert.match(db.uploads[0], /^as-request-photos\//);
    const r = await addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '문이 안 닫혀요', photo_paths: [photo_path] } });
    assert.deepEqual([r.state, r.route], ['requested', 'assignee']);
    assert.deepEqual(db.as_requests[0], { ...db.as_requests[0], company_id: PARTNER, order_id: O1, customer_user_id: CUSTOMER, route: 'assignee', assignee_id: STAFF, photos: [photo_path] });
    assert.deepEqual(db.outbox.map((x) => [x.user_id, x.kind, x.url]), [[STAFF, 'as_request', '/segan/me.html#as']]);
    assert.ok(!db.outbox[0].body.includes('문이'), '알림에는 내용을 싣지 않는다');
    assert.match(db.outbox[0].body, /SO-20261106-0A01/);
    const mine = await listMyAsRequests(ENV, { user: u(CUSTOMER) });
    assert.equal(mine.ready, true);
    assert.deepEqual(mine.items.map((x) => [x.factory, x.order_no, x.label, x.can_cancel]), [['가나 팩토리', 'SO-20261106-0A01', '접수', true]]);
    const c = await cancelMyAsRequest(ENV, { user: u(CUSTOMER), params: { id: r.id } });
    assert.equal(c.state, 'cancelled');
    assert.ok(c.cancelled_at);
    await assert.rejects(() => cancelMyAsRequest(ENV, { user: u(CUSTOMER), params: { id: r.id } }), (e) => e.statusCode === 409 && e.code === 'not_requested');
  });
});

test('고객 — 남의 수주 · 고객 계정이 없는 수주는 404, 남의 접수는 거두지 못한다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await assert.rejects(() => addAsRequest(ENV, { user: u(OTHER), params: p, body: { body: '문' } }), (e) => e.statusCode === 404);
    await assert.rejects(() => addAsPhoto(ENV, { user: u(OTHER), params: p, request: photoRequest(png()) }), (e) => e.statusCode === 404);
    await assert.rejects(() => addAsRequest(ENV, { user: u(CUSTOMER), params: { orderId: O2 }, body: { body: '문' } }), (e) => e.statusCode === 404);
    const r = await addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '문' } });
    await assert.rejects(() => cancelMyAsRequest(ENV, { user: u(OTHER), params: { id: r.id } }), (e) => e.statusCode === 404);
    assert.deepEqual((await listMyAsRequests(ENV, { user: u(OTHER) })).items, []);
    assert.equal(db.uploads.length, 0);
  });
});

test('담당자가 없는 수주 — 대표 · 실장에게 (직원은 받지 않는다)', async () => {
  const db = makeDb({ assignee: null });
  await withDb(db, async () => {
    const r = await addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '서랍이 걸려요' } });
    assert.equal(r.route, 'owners');
    assert.equal(db.as_requests[0].assignee_id, null);
    assert.deepEqual(db.outbox.map((x) => x.user_id), [OWNER]);
  });
});

test('팩토리 — A/S함 · 받기 · 끝(A/S 완료 보고와 잇기), 담당자 아닌 직원은 403, 차례가 틀리면 409', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const r = await addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '문', photo_paths: [path(1)] } });
    const box = await listCompanyAsRequests(ENV, { user: u(STAFF) });
    assert.equal(box.ready, true);
    assert.deepEqual(box.items.map((x) => [x.order_no, x.label, x.mine, x.can_handle, x.photo_urls.length]), [['SO-20261106-0A01', '접수', true, true, 1]]);
    assert.match(box.items[0].photo_urls[0], /as-request-photos/);
    const other = await listCompanyAsRequests(ENV, { user: u(STAFF2) });
    assert.deepEqual(other.items.map((x) => [x.mine, x.can_handle]), [[false, false]], '담당자가 아닌 직원은 보기만');
    await assert.rejects(() => receiveAsRequest(ENV, { user: u(STAFF2), params: { id: r.id } }), (e) => e.statusCode === 403);
    await assert.rejects(() => finishAsRequest(ENV, { user: u(STAFF), params: { id: r.id }, body: {} }), (e) => e.statusCode === 409 && e.code === 'not_received');
    const got = await receiveAsRequest(ENV, { user: u(STAFF), params: { id: r.id } });
    assert.equal(got.state, 'received');
    assert.ok(got.received_at);
    assert.equal(db.as_requests[0].received_by, STAFF);
    await assert.rejects(() => receiveAsRequest(ENV, { user: u(OWNER), params: { id: r.id } }), (e) => e.statusCode === 409 && e.code === 'not_requested');
    await assert.rejects(() => cancelMyAsRequest(ENV, { user: u(CUSTOMER), params: { id: r.id } }), (e) => e.statusCode === 409, '받은 뒤에는 고객이 거두지 못한다');
    await assert.rejects(() => finishAsRequest(ENV, { user: u(STAFF), params: { id: r.id }, body: { report_id: REP_INSTALL } }), (e) => e.statusCode === 422, '설치 완료 보고는 잇지 못한다');
    const done = await finishAsRequest(ENV, { user: u(OWNER), params: { id: r.id }, body: { report_id: REP_AS } });
    assert.deepEqual([done.state, done.report_id], ['done', REP_AS]);
    assert.equal(db.as_requests[0].done_report_id, REP_AS);
    assert.ok(db.as_requests[0].done_at);
  });
});

test('팩토리 — 구성원이 아니면 403, 남의 팩토리 접수는 404', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await assert.rejects(() => listCompanyAsRequests(ENV, { user: u(OTHER) }), (e) => e.statusCode === 403);
    db.as_requests.push({ id: 'b0000000-0000-4000-8000-000000000001', company_id: HQ, order_id: O1, state: 'requested', route: 'owners', assignee_id: null, created_at: new Date().toISOString() });
    await assert.rejects(() => receiveAsRequest(ENV, { user: u(OWNER), params: { id: 'b0000000-0000-4000-8000-000000000001' } }), (e) => e.statusCode === 404);
  });
});

test('본사 기록 (순수) — 거둔 것은 빼고, 늦음 · 평균 시간 · 팩토리마다 A/S 율', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const h = (n) => new Date(now - n * 3600000).toISOString();
  const rows = [
    { company_id: 'A', state: 'requested', created_at: h(ALERT_HOURS + 1) },
    { company_id: 'A', state: 'requested', created_at: h(1) },
    { company_id: 'A', state: 'done', created_at: h(10), received_at: h(8), done_at: h(4) },
    { company_id: 'B', state: 'cancelled', created_at: h(3), cancelled_at: h(2) },
  ];
  const s = asStats(rows, new Map([['A', 30], ['C', 5]]), now);
  assert.deepEqual([s.total, s.waiting, s.late, s.avg_receive_hours, s.avg_done_hours], [3, 2, 1, 2, 6]);
  assert.deepEqual(s.factories, [
    { company_id: 'A', count: 3, done: 1, orders_done: 30, as_rate: 10 },
    { company_id: 'C', count: 0, done: 0, orders_done: 5, as_rate: 0 },
  ]);
  assert.equal(asStats([{ company_id: 'D', state: 'requested', created_at: h(1) }], new Map(), now).factories[0].as_rate, null, '끝낸 수주가 없으면 비율 없음');
});

test('본사 화면 — 관리자만, 팩토리 이름 · 주문번호 · 상태 · 기록, 날 수 검사', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '문' } });
    const v = await listAsAdmin(ENV, { user: u(ADMIN), query: {} });
    assert.equal(v.ready, true);
    assert.equal(v.days, 30);
    assert.deepEqual(v.items.map((x) => [x.factory, x.order_no, x.label, x.alerted]), [['가나 팩토리', 'SO-20261106-0A01', '접수', false]]);
    assert.ok(!('body' in v.items[0]), '본사 목록에는 고객이 적은 내용을 싣지 않는다');
    assert.deepEqual(v.stats.factories.map((f) => [f.name, f.count, f.orders_done, f.as_rate]), [['가나 팩토리', 1, 1, 100]]);
    await assert.rejects(() => listAsAdmin(ENV, { user: u(OWNER), query: {} }), (e) => e.statusCode === 403);
    await assert.rejects(() => listAsAdmin(ENV, { user: u(ADMIN), query: { days: '181' } }), (e) => e.statusCode === 422);
  });
});

test('48시간 알림 — 받지 않은 것만 한 메시지, alerted_at 을 찍어 다시 보내지 않는다, Slack 이 막히면 다음 차례에', async () => {
  const db = makeDb();
  const now = Date.now();
  const old = new Date(now - (ALERT_HOURS + 2) * 3600000).toISOString();
  db.as_requests.push(
    { id: 'b0000000-0000-4000-8000-000000000001', company_id: PARTNER, order_id: O1, state: 'requested', route: 'owners', created_at: old, alerted_at: null },
    { id: 'b0000000-0000-4000-8000-000000000002', company_id: PARTNER, order_id: O2, state: 'received', route: 'owners', created_at: old, received_at: old, alerted_at: null },
    { id: 'b0000000-0000-4000-8000-000000000003', company_id: PARTNER, order_id: O2, state: 'requested', route: 'owners', created_at: new Date(now - 3600000).toISOString(), alerted_at: null },
  );
  const env = { ...ENV, SLACK_WEBHOOK_URL: SLACK, PUBLIC_BASE_URL: 'https://dadam.example/' };
  await withDb(db, async () => {
    db.slackDown = true;
    const fail = await runAsAlerts(env, { nowMs: now });
    assert.equal(fail.failed, 1);
    assert.equal(db.as_requests[0].alerted_at, null, '못 보냈으면 찍지 않는다');
    db.slackDown = false;
    db.slack.length = 0;
    const r = await runAsAlerts(env, { nowMs: now });
    assert.deepEqual(r, { alerted: 1 });
    assert.equal(db.slack.length, 1);
    assert.match(db.slack[0].text, /A\/S 접수 1건이 48시간 넘게/);
    assert.match(db.slack[0].text, /SO-20261106-0A01/);
    assert.match(db.slack[0].text, /https:\/\/dadam\.example\/admin\/as-requests\.html/);
    assert.ok(db.as_requests[0].alerted_at);
    assert.equal(db.as_requests[1].alerted_at, null);
    assert.equal(db.as_requests[2].alerted_at, null);
    assert.deepEqual(await runAsAlerts(env, { nowMs: now }), { alerted: 0 });
    assert.equal(db.slack.length, 1);
  });
  assert.deepEqual(await runAsAlerts(ENV, { nowMs: now }), { alerted: 0, skipped: 'slack' });
  assert.equal(buildAsAlert([{ order_no: 'SO-20261106-0A09' }, { order_no: '홍길동' }]).text, `A/S 접수 2건이 ${ALERT_HOURS}시간 넘게 받지 않은 채 있습니다 — SO-20261106-0A09`, '주문번호 모양이 아니면 싣지 않는다');
});

test('DB 0045 전 — 쓰기 409 db_pending, 보기 ready false, 알림은 건너뛴다', async () => {
  const db = makeDb({ table: false });
  await withDb(db, async () => {
    await assert.rejects(() => addAsRequest(ENV, { user: u(CUSTOMER), params: p, body: { body: '문' } }), (e) => e.statusCode === 409 && e.code === 'db_pending');
    assert.deepEqual(await listMyAsRequests(ENV, { user: u(CUSTOMER) }), { ready: false, items: [] });
    assert.deepEqual(await listCompanyAsRequests(ENV, { user: u(OWNER) }), { ready: false, items: [] });
    assert.equal((await listAsAdmin(ENV, { user: u(ADMIN), query: {} })).ready, false);
    await assert.rejects(() => cancelMyAsRequest(ENV, { user: u(CUSTOMER), params: { id: 'b0000000-0000-4000-8000-000000000001' } }), (e) => e.statusCode === 409 && e.code === 'db_pending');
    assert.deepEqual(await runAsAlerts({ ...ENV, SLACK_WEBHOOK_URL: SLACK }), { alerted: 0, skipped: 'db' });
    assert.equal(db.slack.length, 0);
  });
});
