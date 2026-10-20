/**
 * 작업자 포털 서버 (docs/01-plan/worker-portal-contract.md §6 서버 목록).
 *
 * DB 는 PostgREST 의 일부(eq · neq · in · is · gt/lt · order · limit · 고유 제약)를 흉내 내는 메모리 가짜로 대신한다.
 * 라우트는 worker.fetch 로 JWT → 핸들러 → 응답까지 그대로 돌린다. Slack 웹훅도 가짜 fetch 가 받는다.
 * 사람 · 주소 · 번호는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import worker from '../src/worker.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { computeJobStatus, pickNextJob } from '../src/work/jobs.js';
import { effectiveStatus, jobCard, jobDetail, findForbiddenKeys, FORBIDDEN_KEYS, SITE_NOTE } from '../src/work/reveal.js';
import { buildWorkSlack } from '../src/work/notify.js';
import { hashInviteToken } from '../src/work/invites.js';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  CORS_ORIGINS: 'https://dadamfurniture.com',
  SHARE_TOKEN_PEPPER: 'pepper-for-tests',
  PUBLIC_BASE_URL: 'https://dadam.test',
  SLACK_WEBHOOK_URL: 'https://hooks.slack.test/services/T/B/X',
};

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const SUPPORT = 'a0000000-0000-4000-8000-000000000002';
const CUSTOMER = 'c0000000-0000-4000-8000-000000000001';
const NEWBIE = 'c0000000-0000-4000-8000-000000000002';
const U_W1 = 'b0000000-0000-4000-8000-000000000001';
const U_W2 = 'b0000000-0000-4000-8000-000000000002';
const U_PEND = 'b0000000-0000-4000-8000-000000000003';
const W1 = 'd0000000-0000-4000-8000-000000000001';
const W2 = 'd0000000-0000-4000-8000-000000000002';
const WP = 'd0000000-0000-4000-8000-000000000003';
const ORDER = 'e0000000-0000-4000-8000-000000000001';

// 지어낸 개인정보 — 어떤 작업자 응답 · Slack 에도 나오면 안 된다
const CUSTOMER_NAME = '홍길동';
const W1_PHONE = '010-0000-0001';
const PAY = 250000;

const ACTIVE = ['offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted'];

// ── 가짜 PostgREST ───────────────────────────────────────────────

const json = (rows, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const fail = (status, text) => ({ ok: false, status, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => text });
const clone = (v) => JSON.parse(JSON.stringify(v));

const DEFAULTS = {
  workers: () => ({ phone: null, kinds: [], region_label: null, status: 'pending', photo_consent: false, approved_by: null, approved_at: null, reject_reason: null, invited_via: null, last_seen_at: null, updated_at: new Date().toISOString() }),
  worker_invites: () => ({ kinds_preset: [], display_name_preset: null, used_at: null, used_by: null, created_by: null }),
  work_jobs: () => ({ status: 'draft', detail: null, region_label: null, starts_at: null, ends_at: null, apply_deadline: null, slots: 1, mode: 'open', pay_amount: null, pay_unit: null, pay_visible: false, order_id: null, design_id: null, version: 0, cancel_reason: null, updated_at: new Date().toISOString() }),
  work_applications: () => ({ status: 'applied', message: null, decided_by: null, decided_at: null, decide_reason: null }),
  work_assignments: () => ({ application_id: null, started_at: null, submitted_at: null, accepted_at: null, revision_count: 0, no_show: false, release_reason: null, updated_at: new Date().toISOString() }),
  work_updates: () => ({ assignment_id: null, issue_chips: [], amends_id: null, visible_to_worker: true }),
  work_job_events: () => ({ assignment_id: null, actor_user_id: null, from_status: null, to_status: null, note: null, payload: {}, notified_at: null }),
  worker_events: () => ({ actor_user_id: null, from_status: null, to_status: null, note: null, payload: {} }),
};
const UNIQUE = {
  workers: (r) => r.user_id || null,
  worker_invites: (r) => r.token_hash,
  work_applications: (r) => `${r.job_id}|${r.worker_id}`,
  work_assignments: (r) => (ACTIVE.includes(r.status) ? `${r.job_id}|${r.worker_id}` : null),
};

function makeDb() {
  const db = { tables: {}, users: {}, calls: [], slack: [], missing: new Set(), onPatch: null };

  const col = (row, key) => {
    if (key.includes('->>')) {
      const [c, k] = key.split('->>');
      const o = row[c];
      return o && o[k] !== undefined && o[k] !== null ? String(o[k]) : null;
    }
    return row[key];
  };
  const cmp = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (typeof a === 'number' && !Number.isNaN(nb)) return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  const check = (row, key, expr) => {
    const v = col(row, key);
    const isNull = v === null || v === undefined;
    if (expr === 'is.null') return isNull;
    if (expr === 'not.is.null') return !isNull;
    if (expr === 'is.true') return v === true;
    if (expr === 'is.false') return v === false;
    const m = expr.match(/^(eq|neq|gt|gte|lt|lte|in)\.([\s\S]*)$/);
    if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
    if (isNull) return false;
    const [, op, raw] = m;
    if (op === 'in') return raw.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (op === 'eq') return String(v) === raw;
    if (op === 'neq') return String(v) !== raw;
    const c = cmp(v, raw);
    return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
  };
  const sortRows = (rows, order) => {
    if (!order) return rows;
    const keys = order.split(',').map((s) => {
      const [c, dir = 'asc'] = s.split('.');
      return { c, desc: dir === 'desc' };
    });
    return rows.slice().sort((a, b) => {
      for (const { c, desc } of keys) {
        const x = a[c];
        const y = b[c];
        if (x === y) continue;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const r = cmp(x, y);
        if (r) return desc ? -r : r;
      }
      return 0;
    });
  };
  const violates = (table, row, except) => {
    const f = UNIQUE[table];
    if (!f) return false;
    const k = f(row);
    return k !== null && k !== undefined && (db.tables[table] || []).some((o) => o !== except && f(o) === k);
  };

  db.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    db.calls.push({ url: decodeURIComponent(u), method, body });
    if (u === ENV.SLACK_WEBHOOK_URL) {
      db.slack.push(body);
      return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok', json: async () => ({}) };
    }
    if (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`)) {
      const tok = String((init.headers || {}).Authorization || '').replace(/^Bearer\s+/i, '');
      const id = db.users[tok];
      return id ? json({ id, email: `${tok}@example.invalid` }) : fail(401, 'invalid');
    }
    if (!u.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) throw new Error(`unexpected fetch ${method} ${u}`);
    const parsed = new URL(u);
    const table = parsed.pathname.replace('/rest/v1/', '');
    if (db.missing.has(table)) return fail(404, '{"code":"PGRST205","message":"Could not find the table"}');
    const filters = [];
    let order = null;
    let limit = null;
    for (const [k, v] of parsed.searchParams) {
      if (k === 'select' || k === 'offset' || k === 'on_conflict') continue;
      if (k === 'order') order = v;
      else if (k === 'limit') limit = Number(v);
      else filters.push([k, v]);
    }
    const rows = db.tables[table] || (db.tables[table] = []);
    const match = (r) => filters.every(([k, v]) => check(r, k, v));
    if (method === 'GET') {
      let out = sortRows(rows.filter(match), order);
      if (limit) out = out.slice(0, limit);
      return json(clone(out));
    }
    if (method === 'POST') {
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...b };
        if (violates(table, row)) return fail(409, '{"code":"23505","message":"duplicate key"}');
        rows.push(row);
        made.push(row);
      }
      return json(clone(made), 201);
    }
    if (method === 'PATCH') {
      if (db.onPatch) db.onPatch(table, filters, body);
      const hit = rows.filter(match);
      for (const r of hit) if (violates(table, { ...r, ...body }, r)) return fail(409, '{"code":"23505"}');
      hit.forEach((r) => Object.assign(r, body));
      return json(clone(hit));
    }
    if (method === 'DELETE') {
      const hit = rows.filter(match);
      db.tables[table] = rows.filter((r) => !hit.includes(r));
      return json(clone(hit));
    }
    throw new Error(`가짜 DB: ${method}`);
  };
  return db;
}

function seed(db) {
  db.users = {
    'tok-admin': ADMIN, 'tok-support': SUPPORT, 'tok-cust': CUSTOMER, 'tok-new': NEWBIE,
    'tok-w1': U_W1, 'tok-w2': U_W2, 'tok-pend': U_PEND,
  };
  db.tables.admin_roles = [{ user_id: ADMIN, role: 'super_admin' }, { user_id: SUPPORT, role: 'support' }];
  const base = { consent_version: 'v1', photo_consent: false, created_at: '2020-01-01T00:00:00.000Z', approved_at: '2020-01-01T00:00:00.000Z', last_seen_at: null, reject_reason: null, region_label: '시험시 가구' };
  db.tables.workers = [
    { ...base, id: W1, user_id: U_W1, display_name: '시험기사A', phone: W1_PHONE, kinds: ['install', 'assembly'], status: 'approved' },
    { ...base, id: W2, user_id: U_W2, display_name: '시험기사B', phone: '010-0000-0002', kinds: ['install'], status: 'approved' },
    { ...base, id: WP, user_id: U_PEND, display_name: '시험대기', phone: null, kinds: ['install'], status: 'pending', approved_at: null },
  ];
  db.tables.orders = [{ id: ORDER, order_no: 'DD-TEST-1', customer_name: CUSTOMER_NAME, contract_amount: 9900000 }];
}

let db;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  clearAdminCache();
  db = makeDb();
  seed(db);
  globalThis.fetch = db.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function call(method, path, { token, body } = {}) {
  const pending = [];
  const headers = { Origin: 'https://dadamfurniture.com' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    ENV,
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending);
  const out = await res.json();
  return { status: res.status, body: out, data: out.data, headers: res.headers };
}

/** 관리자가 만들고 게시한 작업 */
async function makeJob(fields = {}) {
  const r = await call('POST', '/work/admin/jobs', { token: 'tok-admin', body: { kind: 'install', title: '시험 주방 설치', region_label: '시험시 가구', slots: 1, ...fields } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = await call('POST', `/work/admin/jobs/${r.data.id}/publish`, { token: 'tok-admin' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return p.data;
}

/** 신청 → 승인 → 배정 */
async function assign(job, token = 'tok-w1') {
  const a = await call('POST', `/work/jobs/${job.id}/apply`, { token, body: {} });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const ok = await call('POST', `/work/admin/applications/${a.data.id}/approve`, { token: 'tok-admin', body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return ok.data.assignment;
}

const rowOf = (table, id) => db.tables[table].find((r) => r.id === id);
/** 시각 비교(gt)가 같은 밀리초에 걸리지 않게 */
const tick = () => new Promise((r) => setTimeout(r, 5));

// ── 순수 함수 ────────────────────────────────────────────────────

test('작업 상태 자동 전이 — 정원 · 첫 시작 · 검수 · 완료, draft · cancelled · closed 는 그대로', () => {
  const job = { status: 'open', kind: 'install', slots: 2 };
  const a = (status) => ({ status });
  assert.equal(computeJobStatus(job, [a('confirmed')]), 'open');
  assert.equal(computeJobStatus(job, [a('confirmed'), a('confirmed'), a('declined')]), 'filled');
  assert.equal(computeJobStatus(job, [a('offered'), a('confirmed')]), 'open', 'offered 는 정원에 세지 않는다');
  assert.equal(computeJobStatus({ ...job, status: 'filled' }, [a('started'), a('confirmed')]), 'in_progress');
  assert.equal(computeJobStatus({ ...job, status: 'in_progress' }, [a('submitted'), a('accepted'), a('released')]), 'review');
  assert.equal(computeJobStatus({ ...job, status: 'review' }, [a('accepted'), a('accepted')]), 'done');
  assert.equal(computeJobStatus({ ...job, status: 'review' }, [a('revision'), a('accepted')]), 'in_progress');
  assert.equal(computeJobStatus({ ...job, kind: 'assembly', status: 'in_progress' }, [a('accepted')]), 'done');
  assert.equal(computeJobStatus({ ...job, kind: 'assembly', status: 'in_progress' }, [a('submitted')]), 'in_progress', '조립은 review 를 거치지 않는다');
  // 응답 없는 초대(offered)는 정원에 세지 않으므로 검수 · 완료도 막지 않는다
  assert.equal(computeJobStatus({ ...job, slots: 1, status: 'in_progress' }, [a('submitted'), a('offered')]), 'review');
  assert.equal(computeJobStatus({ ...job, slots: 1, status: 'review' }, [a('accepted'), a('offered')]), 'done');
  assert.equal(computeJobStatus({ ...job, kind: 'assembly', slots: 1, status: 'in_progress' }, [a('accepted'), a('offered')]), 'done');
  assert.equal(computeJobStatus({ ...job, status: 'filled' }, [a('started'), a('offered')]), 'in_progress');
  for (const s of ['draft', 'cancelled', 'closed', 'done']) assert.equal(computeJobStatus({ ...job, status: s }, [a('confirmed'), a('confirmed')]), s);
});

test('마감은 저장하지 않고 읽을 때 — open 이고 apply_deadline 이 지나면 expired', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(effectiveStatus({ status: 'open', apply_deadline: '2026-10-19T23:59:00Z' }, now), 'expired');
  assert.equal(effectiveStatus({ status: 'open', apply_deadline: '2026-10-20T01:00:00Z' }, now), 'open');
  assert.equal(effectiveStatus({ status: 'filled', apply_deadline: '2026-10-01T00:00:00Z' }, now), 'filled');
  assert.equal(effectiveStatus({ status: 'open', apply_deadline: null }, now), 'open');
});

test('공개 사다리 — 금액은 pay_visible 일 때만, 주문번호 · 가린 이름은 활성 배정일 때만, 현장은 늘 null', () => {
  const job = { id: 'j', kind: 'install', title: 't', slots: 1, status: 'open', pay_amount: PAY, pay_unit: 'day', pay_visible: false, detail: 'd', cost: 1, address: 'x' };
  const hidden = jobCard(job);
  assert.equal('pay' in hidden, false);
  assert.ok(!JSON.stringify(hidden).includes(String(PAY)));
  assert.deepEqual(jobCard({ ...job, pay_visible: true }).pay, { amount: PAY, unit: 'day' });
  const order = { order_no: 'DD-TEST-1', customer_name: CUSTOMER_NAME };
  const active = jobDetail(job, { assignment: { id: 'a', status: 'confirmed' }, order });
  assert.equal(active.order_no, 'DD-TEST-1');
  assert.equal(active.customer_masked, '홍*동');
  assert.equal(active.site, null);
  assert.equal(active.site_note, SITE_NOTE);
  const ended = jobDetail(job, { assignment: { id: 'a', status: 'released' }, order });
  assert.equal('order_no' in ended || 'customer_masked' in ended, false);
  assert.deepEqual(findForbiddenKeys([hidden, active, ended]), []);
  assert.deepEqual(findForbiddenKeys({ worker: { phone: '1' }, x: { phone: '2', note: 'n' } }, { allowPhoneAt: ['$.worker'] }), ['$.x.phone', '$.x.note']);
  assert.deepEqual([...FORBIDDEN_KEYS].sort(), ['address', 'cost', 'customer_name', 'margin', 'note', 'phone']);
});

test('Slack 문구 — 종류 · 제목 · 표시 이름 · 링크만 (작업 행의 금액 · 주문 칸은 넘겨도 쓰지 않는다)', () => {
  const msg = buildWorkSlack('application_created', {
    job: { id: 'j1', kind: 'as', title: '<b>시험</b> A/S', pay_amount: PAY, order_id: ORDER, customer_name: CUSTOMER_NAME, address: '시험로 1' },
    workerName: '시험기사A',
    link: 'https://dadam.test/admin/work-jobs.html?job=j1',
  });
  const s = JSON.stringify(msg);
  assert.match(msg.text, /작업 신청 — A\/S · &lt;b&gt;시험&lt;\/b&gt; A\/S — 시험기사A/);
  for (const bad of [String(PAY), CUSTOMER_NAME, '시험로', ORDER]) assert.ok(!s.includes(bad), bad);
  assert.ok(s.includes('admin/work-jobs.html?job=j1'));
});

// ── 라우트 · 권한 ────────────────────────────────────────────────

const CONTRACT_ROUTES = [
  ['GET', '/work/me'], ['POST', '/work/register'], ['POST', '/work/claim-invite'], ['GET', '/work/jobs'],
  ['GET', `/work/jobs/${ORDER}`], ['POST', `/work/jobs/${ORDER}/apply`], ['POST', `/work/applications/${ORDER}/withdraw`],
  ['POST', `/work/assignments/${ORDER}/confirm`], ['POST', `/work/assignments/${ORDER}/decline`], ['POST', `/work/assignments/${ORDER}/start`],
  ['POST', `/work/assignments/${ORDER}/release`], ['POST', `/work/assignments/${ORDER}/updates`],
  ['GET', '/work/admin/jobs'], ['POST', '/work/admin/jobs'], ['GET', `/work/admin/jobs/${ORDER}`], ['PATCH', `/work/admin/jobs/${ORDER}`],
  ['POST', `/work/admin/jobs/${ORDER}/publish`], ['POST', `/work/admin/jobs/${ORDER}/cancel`], ['POST', `/work/admin/jobs/${ORDER}/close`],
  ['POST', `/work/admin/jobs/${ORDER}/invite`], ['POST', `/work/admin/jobs/${ORDER}/updates`],
  ['POST', `/work/admin/applications/${ORDER}/approve`], ['POST', `/work/admin/applications/${ORDER}/reject`],
  ['POST', `/work/admin/assignments/${ORDER}/accept`], ['POST', `/work/admin/assignments/${ORDER}/revision`], ['POST', `/work/admin/assignments/${ORDER}/remove`],
  ['GET', '/work/admin/workers'], ['PATCH', `/work/admin/workers/${ORDER}`],
  ['GET', `/work/admin/workers/${ORDER}/notes`], ['POST', `/work/admin/workers/${ORDER}/notes`], ['POST', '/work/admin/invites'],
  ['GET', `/work/admin/workers/${ORDER}/events`],
];

test('라우트 — 계약의 경로가 모두 JWT 로 등록돼 있다 (토큰 없으면 401, 404 · 405 아님)', async () => {
  for (const [m, p] of CONTRACT_ROUTES) {
    const r = await call(m, p, m === 'GET' ? {} : { body: {} });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('고객 계정이 /work/admin/* 를 부르면 403', async () => {
  for (const [m, p] of CONTRACT_ROUTES.filter(([, p]) => p.startsWith('/work/admin/'))) {
    const r = await call(m, p, { token: 'tok-cust', body: m === 'GET' ? undefined : { reason: 'x', note: 'x', worker_id: W1, kind: 'note', body: 'x', visible_to_worker: true, version: 0, expires_at: '2099-01-01T00:00:00Z' } });
    assert.equal(r.status, 403, `${m} ${p} → ${r.status}`);
  }
});

test('support 역할 — 작업 보드는 읽지만 쓰기 · 작업자 메모(읽기 포함)는 403, 편집자는 메모를 읽고 쓴다', async () => {
  assert.equal((await call('GET', '/work/admin/jobs', { token: 'tok-support' })).status, 200);
  assert.equal((await call('GET', '/work/admin/workers', { token: 'tok-support' })).status, 200);
  assert.equal((await call('POST', '/work/admin/jobs', { token: 'tok-support', body: { kind: 'install', title: 't' } })).status, 403);
  assert.equal((await call('GET', `/work/admin/workers/${W1}/notes`, { token: 'tok-support' })).status, 403);
  assert.equal((await call('POST', `/work/admin/workers/${W1}/notes`, { token: 'tok-support', body: { note: '메모' } })).status, 403);
  const add = await call('POST', `/work/admin/workers/${W1}/notes`, { token: 'tok-admin', body: { note: '시험 메모' } });
  assert.equal(add.status, 201);
  const list = await call('GET', `/work/admin/workers/${W1}/notes`, { token: 'tok-admin' });
  assert.deepEqual(list.data.items.map((n) => n.note), ['시험 메모']);
  // 작업자 본인 정보에는 메모가 없다
  const me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.ok(!JSON.stringify(me.body).includes('시험 메모'));
});

test('잘못된 UUID 는 422 (작업자 · 관리자 경로 모두)', async () => {
  assert.equal((await call('GET', '/work/jobs/not-a-uuid', { token: 'tok-w1' })).status, 422);
  assert.equal((await call('POST', '/work/jobs/123/apply', { token: 'tok-w1', body: {} })).status, 422);
  assert.equal((await call('POST', '/work/assignments/abc/start', { token: 'tok-w1', body: {} })).status, 422);
  assert.equal((await call('POST', '/work/applications/abc/withdraw', { token: 'tok-w1', body: {} })).status, 422);
  assert.equal((await call('GET', '/work/admin/jobs/xyz', { token: 'tok-admin' })).status, 422);
  assert.equal((await call('POST', '/work/admin/applications/bad/approve', { token: 'tok-admin', body: {} })).status, 422);
  assert.equal((await call('POST', `/work/admin/jobs/${ORDER}/invite`, { token: 'tok-admin', body: { worker_id: 'w1' } })).status, 422);
});

test('대기 작업자는 신청 · 목록 403, /work/me 는 대기 상태를 돌려준다', async () => {
  const job = await makeJob();
  assert.equal((await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-pend', body: {} })).status, 403);
  assert.equal((await call('GET', '/work/jobs?tab=open', { token: 'tok-pend' })).status, 403);
  assert.equal((await call('GET', `/work/jobs/${job.id}`, { token: 'tok-pend' })).status, 403);
  assert.equal((await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-cust', body: {} })).status, 403, '작업자 행 없는 고객');
  const me = await call('GET', '/work/me', { token: 'tok-pend' });
  assert.equal(me.status, 200);
  assert.equal(me.data.ready, true);
  assert.equal(me.data.worker.status, 'pending');
  assert.deepEqual(me.data.counts, { open: 0, mine: 0, revision: 0, newEvents: 0 });
  const none = await call('GET', '/work/me', { token: 'tok-cust' });
  assert.deepEqual([none.data.ready, none.data.worker], [true, null]);
});

test('중복 신청 409 · 모집 아님 · 마감 · 종류 불일치 409 · 철회는 applied 만', async () => {
  const job = await makeJob();
  const first = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w1', body: { message: '가능합니다' } });
  assert.equal(first.status, 201);
  assert.deepEqual([first.data.status, first.data.message], ['applied', '가능합니다']);
  assert.equal((await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w1', body: {} })).status, 409);

  const asJob = await makeJob({ kind: 'as' });
  assert.equal((await call('POST', `/work/jobs/${asJob.id}/apply`, { token: 'tok-w2', body: {} })).status, 409, '종류 불일치');
  const expired = await makeJob({ apply_deadline: '2026-01-01T00:00:00Z' });
  const late = await call('POST', `/work/jobs/${expired.id}/apply`, { token: 'tok-w1', body: {} });
  assert.equal(late.status, 409, '지원 종료일 지남');
  assert.equal(late.body.message, '지원 종료일이 지났습니다');
  const draft = await call('POST', '/work/admin/jobs', { token: 'tok-admin', body: { kind: 'install', title: '초안' } });
  assert.equal((await call('POST', `/work/jobs/${draft.data.id}/apply`, { token: 'tok-w1', body: {} })).status, 409, '모집 아님');
  const invited = await makeJob({ mode: 'invite' });
  assert.equal((await call('POST', `/work/jobs/${invited.id}/apply`, { token: 'tok-w1', body: {} })).status, 409, '공개 모집이 아님');

  // 마감 · 초대 작업은 모집중 탭에 없다, 관리자 목록에는 expired 로
  const open = await call('GET', '/work/jobs?tab=open', { token: 'tok-w1' });
  assert.deepEqual(open.data.items.map((c) => c.id), [job.id]);
  assert.equal(open.data.items[0].my.application_status, 'applied');
  const adminList = await call('GET', '/work/admin/jobs?status=expired', { token: 'tok-admin' });
  assert.deepEqual(adminList.data.items.map((j) => [j.id, j.effective_status]), [[expired.id, 'expired']]);

  assert.equal((await call('POST', `/work/applications/${first.data.id}/withdraw`, { token: 'tok-w2' })).status, 404, '남의 신청');
  const w = await call('POST', `/work/applications/${first.data.id}/withdraw`, { token: 'tok-w1' });
  assert.equal(w.data.status, 'withdrawn');
  assert.equal((await call('POST', `/work/applications/${first.data.id}/withdraw`, { token: 'tok-w1' })).status, 409);
});

test('정원 초과 승인 409 — 버전 경쟁에 지면 배정 · 신청을 되돌린다, 정원이 차면 다음 승인도 409', async () => {
  const job = await makeJob({ slots: 1 });
  const a1 = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w1', body: {} });
  const a2 = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w2', body: {} });

  // 다른 관리자가 먼저 작업을 바꾼 것처럼 — 잠금 직전에 version 을 올린다
  db.onPatch = (table) => {
    if (table !== 'work_jobs') return;
    rowOf('work_jobs', job.id).version += 1;
    db.onPatch = null;
  };
  const raced = await call('POST', `/work/admin/applications/${a1.data.id}/approve`, { token: 'tok-admin', body: {} });
  assert.equal(raced.status, 409);
  assert.equal(db.tables.work_assignments.length, 0, '배정은 지워졌다');
  assert.equal(rowOf('work_applications', a1.data.id).status, 'applied', '신청은 되돌렸다');
  assert.ok(db.calls.some((c) => c.method === 'DELETE' && c.url.includes('/work_assignments?')));
  assert.equal(rowOf('work_jobs', job.id).status, 'open');

  const ok = await call('POST', `/work/admin/applications/${a1.data.id}/approve`, { token: 'tok-admin', body: {} });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.data.application.status, ok.data.assignment.status, ok.data.assignment.via], ['approved', 'confirmed', 'application']);
  assert.equal(rowOf('work_jobs', job.id).status, 'filled');
  const full = await call('POST', `/work/admin/applications/${a2.data.id}/approve`, { token: 'tok-admin', body: {} });
  assert.equal(full.status, 409);
  assert.match(full.body.message, /정원/);
  assert.equal(db.tables.work_assignments.filter((a) => a.status === 'confirmed').length, 1);

  // PATCH 도 version 이 틀리면 409
  const stale = await call('PATCH', `/work/admin/jobs/${job.id}`, { token: 'tok-admin', body: { title: '새 제목', version: 0 } });
  assert.equal(stale.status, 409);
  assert.equal((await call('PATCH', `/work/admin/jobs/${job.id}`, { token: 'tok-admin', body: { title: '새 제목' } })).status, 422, 'version 필수');
});

test('남의 배정은 404 — 시작 · 보고 · 포기 · 수락 모두', async () => {
  const job = await makeJob();
  const asg = await assign(job, 'tok-w1');
  for (const [p, body] of [['start', {}], ['release', { reason: 'x' }], ['confirm', {}], ['decline', {}], ['updates', { kind: 'progress', body: 'x' }]]) {
    const r = await call('POST', `/work/assignments/${asg.id}/${p}`, { token: 'tok-w2', body });
    assert.equal(r.status, 404, p);
  }
  assert.equal(rowOf('work_assignments', asg.id).status, 'confirmed');
});

test('한 바퀴 — 게시 → 신청 → 승인 → 시작 → 보고 → 완료 보고 → 검수 → 완료 → 마감, closed 작업에 보고 409', async () => {
  const job = await makeJob({ pay_amount: PAY, pay_unit: 'day', pay_visible: false, order_id: ORDER, detail: '싱크 3.2m' });
  assert.equal(job.status, 'open');
  const card = (await call('GET', '/work/jobs?tab=open', { token: 'tok-w1' })).data.items[0];
  assert.equal('pay' in card, false, 'pay_visible=false 면 금액 없음');
  assert.ok(!JSON.stringify(card).includes(String(PAY)));

  const asg = await assign(job, 'tok-w1');
  assert.equal(rowOf('work_jobs', job.id).status, 'filled');
  // 다른 작업자는 모집이 끝난 작업을 볼 수 없다
  assert.equal((await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w2' })).status, 404);

  const detail = await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w1' });
  assert.equal(detail.data.order_no, 'DD-TEST-1');
  assert.equal(detail.data.customer_masked, '홍*동');
  assert.equal(detail.data.site, null);
  assert.equal(detail.data.my.assignment_status, 'confirmed');
  assert.ok(!JSON.stringify(detail.body).includes(CUSTOMER_NAME));

  assert.equal((await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '끝' } })).status, 409, '시작 전 완료 보고');
  const st = await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w1' });
  assert.equal(st.data.status, 'started');
  assert.equal(rowOf('work_jobs', job.id).status, 'in_progress');
  const pr = await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'progress', body: '하부장 설치 중' } });
  assert.equal(pr.status, 201);
  const rs = await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '설치 끝' } });
  assert.equal(rs.status, 201);
  assert.equal(rowOf('work_assignments', asg.id).status, 'submitted');
  assert.equal(rowOf('work_jobs', job.id).status, 'review');

  const rev = await call('POST', `/work/admin/assignments/${asg.id}/revision`, { token: 'tok-admin', body: { reason: '문짝 수평' } });
  assert.equal(rev.data.status, 'revision');
  assert.equal(rowOf('work_jobs', job.id).status, 'in_progress');
  const mine = await call('GET', '/work/jobs?tab=mine', { token: 'tok-w1' });
  assert.equal(mine.data.items[0].my.assignment_status, 'revision');
  const timeline = (await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w1' })).data.timeline;
  assert.ok(timeline.some((u) => u.author_role === 'company' && u.body === '보완 요청: 문짝 수평'));
  await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '수평 다시 맞춤' } });
  assert.equal(rowOf('work_jobs', job.id).status, 'review');

  const acc = await call('POST', `/work/admin/assignments/${asg.id}/accept`, { token: 'tok-admin' });
  assert.equal(acc.data.status, 'accepted');
  assert.equal(rowOf('work_jobs', job.id).status, 'done');
  // ★5 가 — 끝난 뒤에도 추가 보고
  assert.equal((await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'issue', body: '손잡이 홈 추가 확인 필요' } })).status, 201);
  const done = await call('GET', '/work/jobs?tab=done', { token: 'tok-w1' });
  assert.deepEqual(done.data.items.map((c) => c.id), [job.id]);

  const closed = await call('POST', `/work/admin/jobs/${job.id}/close`, { token: 'tok-admin' });
  assert.deepEqual([closed.data.status, closed.data.auto_declined], ['closed', 0], '남은 초대가 없으면 0건');
  const late = await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'progress', body: '추가' } });
  assert.equal(late.status, 409, 'closed 작업에 보고 409');

  // 모든 전이가 이벤트로 남는다
  const types = db.tables.work_job_events.filter((e) => e.job_id === job.id).map((e) => e.type);
  for (const t of ['job_created', 'job_published', 'application_created', 'application_approved', 'assignment_confirmed', 'job_status', 'assignment_started', 'assignment_submitted', 'assignment_revision', 'assignment_accepted', 'job_closed']) {
    assert.ok(types.includes(t), t);
  }
  const statusFlow = db.tables.work_job_events.filter((e) => e.job_id === job.id && e.type === 'job_status').map((e) => `${e.from_status}>${e.to_status}`);
  assert.deepEqual(statusFlow, ['open>filled', 'filled>in_progress', 'in_progress>review', 'review>in_progress', 'in_progress>review', 'review>done']);
});

test('작업자 응답에 금지 키가 없다 — 목록 · 상세 · 신청 · 배정 · 보고 · 내 정보(본인 phone 만)', async () => {
  const job = await makeJob({ pay_amount: PAY, pay_unit: 'job', pay_visible: true, order_id: ORDER });
  const open = await call('GET', '/work/jobs?tab=open', { token: 'tok-w1' });
  assert.deepEqual(open.data.items[0].pay, { amount: PAY, unit: 'job' }, 'pay_visible=true 면 금액');
  const apply = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w1', body: { message: 'ok' } });
  await call('POST', `/work/admin/applications/${apply.data.id}/approve`, { token: 'tok-admin', body: { reason: '내부 판단 메모' } });
  const asgId = db.tables.work_assignments[0].id;
  await call('POST', `/work/admin/jobs/${job.id}/updates`, { token: 'tok-admin', body: { kind: 'note', body: '작업자에게 안 보이는 메모', visible_to_worker: false } });
  const responses = [
    open.body, apply.body,
    (await call('GET', '/work/jobs?tab=mine', { token: 'tok-w1' })).body,
    (await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w1' })).body,
    (await call('POST', `/work/assignments/${asgId}/start`, { token: 'tok-w1' })).body,
    (await call('POST', `/work/assignments/${asgId}/updates`, { token: 'tok-w1', body: { kind: 'issue', body: '부품 하나 부족', issue_chips: ['부품 누락'] } })).body,
    (await call('GET', '/work/jobs?tab=done', { token: 'tok-w1' })).body,
  ];
  for (const r of responses) {
    assert.deepEqual(findForbiddenKeys(r), [], JSON.stringify(r));
    const s = JSON.stringify(r);
    for (const bad of [CUSTOMER_NAME, W1_PHONE, '내부 판단 메모', '작업자에게 안 보이는 메모', '시험기사B']) assert.ok(!s.includes(bad), bad);
  }
  const me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.deepEqual(findForbiddenKeys(me.body, { allowPhoneAt: ['$.data.worker'] }), []);
  assert.equal(me.data.worker.phone, W1_PHONE, '본인 휴대폰은 본인에게만');
  assert.equal(me.headers.get('Cache-Control'), 'no-store, private');
  assert.equal(open.headers.get('Cache-Control'), 'no-store, private');
});

test('assembly 완료 보고는 검수 없이 바로 accepted · 작업 done (편집자 accept 는 409)', async () => {
  const job = await makeJob({ kind: 'assembly', title: '시험 조립 추가 인원' });
  const asg = await assign(job, 'tok-w1');
  await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w1' });
  const r = await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '통 8개 조립' } });
  assert.equal(r.status, 201);
  const row = rowOf('work_assignments', asg.id);
  assert.equal(row.status, 'accepted');
  assert.ok(row.submitted_at && row.accepted_at);
  assert.equal(rowOf('work_jobs', job.id).status, 'done');
  assert.equal((await call('POST', `/work/admin/assignments/${asg.id}/accept`, { token: 'tok-admin' })).status, 409);
});

test('회사 정정 — 원본 행은 그대로, 정정은 amends_id 로 쌓이고 작업자에게 보일지 매번 고른다', async () => {
  const job = await makeJob();
  const asg = await assign(job, 'tok-w1');
  await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w1' });
  const orig = await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'progress', body: '상판 3.2m 설치' } });
  const before = clone(rowOf('work_updates', orig.data.id));

  const fix = await call('POST', `/work/admin/jobs/${job.id}/updates`, {
    token: 'tok-admin', body: { kind: 'correction', body: '상판 길이 정정: 3.4m', assignment_id: asg.id, amends_id: orig.data.id, visible_to_worker: true },
  });
  assert.equal(fix.status, 201);
  assert.deepEqual([fix.data.author_role, fix.data.amends_id], ['company', orig.data.id]);
  await call('POST', `/work/admin/jobs/${job.id}/updates`, { token: 'tok-admin', body: { kind: 'note', body: '내부 메모', assignment_id: asg.id, visible_to_worker: false } });
  await call('POST', `/work/admin/jobs/${job.id}/updates`, { token: 'tok-admin', body: { kind: 'note', body: '작업 전체 공지', visible_to_worker: true } });

  assert.deepEqual(rowOf('work_updates', orig.data.id), before, '원본 행 그대로');
  assert.equal(db.calls.some((c) => (c.method === 'PATCH' || c.method === 'DELETE') && c.url.includes('/work_updates')), false);

  const timeline = (await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w1' })).data.timeline;
  assert.deepEqual(timeline.map((u) => u.body), ['상판 3.2m 설치', '상판 길이 정정: 3.4m', '작업 전체 공지']);
  assert.equal(timeline[1].amends_id, orig.data.id);

  const admin = await call('GET', `/work/admin/jobs/${job.id}`, { token: 'tok-admin' });
  assert.equal(admin.data.updates.length, 4, '관리자는 전부 본다');
  assert.equal(admin.data.applications[0].worker.display_name, '시험기사A');

  // 다른 작업의 기록 · 배정을 가리키면 404, visible_to_worker 는 필수
  const other = await makeJob({ title: '다른 작업' });
  assert.equal((await call('POST', `/work/admin/jobs/${other.id}/updates`, { token: 'tok-admin', body: { kind: 'correction', body: 'x', amends_id: orig.data.id, visible_to_worker: true } })).status, 404);
  assert.equal((await call('POST', `/work/admin/jobs/${other.id}/updates`, { token: 'tok-admin', body: { kind: 'note', body: 'x', assignment_id: asg.id, visible_to_worker: true } })).status, 404);
  assert.equal((await call('POST', `/work/admin/jobs/${job.id}/updates`, { token: 'tok-admin', body: { kind: 'note', body: 'x' } })).status, 422);
});

test('초대 링크 — 1회용 · 만료 410 · 없는 토큰 404 · 이미 작업자 409, DB 에는 해시만, 가입은 pending', async () => {
  const bad = await call('POST', '/work/admin/invites', { token: 'tok-admin', body: { kinds_preset: ['as'], expires_at: '2020-01-01T00:00:00Z' } });
  assert.equal(bad.status, 422, '지난 만료일');
  const inv = await call('POST', '/work/admin/invites', { token: 'tok-admin', body: { kinds_preset: ['as'], display_name_preset: '시험초대', expires_at: '2099-01-01T00:00:00Z' } });
  assert.equal(inv.status, 201);
  assert.match(inv.data.url, /^https:\/\/dadam\.test\/worker\.html#invite=[A-Za-z0-9_-]{30,}$/);
  const token = inv.data.url.split('#invite=')[1];
  const stored = rowOf('worker_invites', inv.data.id);
  assert.equal(stored.token_hash, await hashInviteToken(ENV, token));
  assert.ok(!JSON.stringify(db.tables.worker_invites).includes(token), '평문 토큰은 저장하지 않는다');

  assert.equal((await call('POST', '/work/claim-invite', { token: 'tok-new', body: { token } })).status, 422, '동의 버전 없음');
  assert.equal(stored.used_at, null, '검사에 걸리면 링크를 쓰지 않는다');
  const claim = await call('POST', '/work/claim-invite', { token: 'tok-new', body: { token, consent_version: 'v1', photo_consent: true } });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  assert.deepEqual([claim.data.status, claim.data.display_name, claim.data.kinds, claim.data.photo_consent], ['pending', '시험초대', ['as'], true]);
  assert.equal(db.tables.workers.find((w) => w.user_id === NEWBIE).invited_via, inv.data.id);

  assert.equal((await call('POST', '/work/claim-invite', { token: 'tok-cust', body: { token, consent_version: 'v1' } })).status, 410, '1회용');
  assert.equal((await call('POST', '/work/claim-invite', { token: 'tok-new', body: { token, consent_version: 'v1' } })).status, 409, '이미 작업자');
  assert.equal((await call('POST', '/work/claim-invite', { token: 'tok-cust', body: { token: 'z'.repeat(32), consent_version: 'v1' } })).status, 404);
  db.tables.worker_invites.push({ id: randomUUID(), token_hash: await hashInviteToken(ENV, 'y'.repeat(32)), kinds_preset: [], display_name_preset: null, expires_at: '2026-01-01T00:00:00Z', used_at: null });
  assert.equal((await call('POST', '/work/claim-invite', { token: 'tok-cust', body: { token: 'y'.repeat(32), consent_version: 'v1', display_name: '시험' } })).status, 410, '만료');
  // 초대로 와도 대기 — 승인 전에는 신청할 수 없다
  const job = await makeJob({ kind: 'as' });
  assert.equal((await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-new', body: {} })).status, 403);
});

test('공개 신청 — pending 으로 등록, 두 번째는 409, 관리자 승인 뒤 신청 가능 · 잘못된 전이 409', async () => {
  const body = { display_name: '시험신청', phone: '010-0000-0009', kinds: ['install'], region_label: '시험시', consent_version: 'v1', photo_consent: false };
  assert.equal((await call('POST', '/work/register', { token: 'tok-cust', body: { ...body, kinds: ['cutting'] } })).status, 422);
  assert.equal((await call('POST', '/work/register', { token: 'tok-cust', body: { ...body, consent_version: '' } })).status, 422);
  const r = await call('POST', '/work/register', { token: 'tok-cust', body });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'pending');
  assert.equal((await call('POST', '/work/register', { token: 'tok-cust', body })).status, 409);
  assert.equal((await call('POST', '/work/register', { token: 'tok-w1', body })).status, 409);

  const ok = await call('PATCH', `/work/admin/workers/${r.data.id}`, { token: 'tok-admin', body: { status: 'approved' } });
  assert.deepEqual([ok.data.status, ok.data.approved_by], ['approved', ADMIN]);
  assert.equal((await call('PATCH', `/work/admin/workers/${r.data.id}`, { token: 'tok-admin', body: { status: 'rejected' } })).status, 409, 'approved → rejected 없음');
  assert.equal((await call('PATCH', `/work/admin/workers/${r.data.id}`, { token: 'tok-admin', body: { status: 'suspended' } })).data.status, 'suspended');
  const pending = await call('GET', '/work/admin/workers?status=pending', { token: 'tok-admin' });
  assert.deepEqual(pending.data.items.map((w) => w.id), [WP]);

  const slack = JSON.stringify(db.slack);
  assert.ok(slack.includes('작업자 가입 신청') && slack.includes('시험신청'));
  assert.ok(!slack.includes('010-0000-0009'), '휴대폰은 Slack 에 없다');
});

test('Slack — 신청 · 철회 · 거절 · 포기 · 완료 · 문제 보고, 문구에 주소 · 실명 · 금액 · 보고 본문 없음', async () => {
  const job = await makeJob({ pay_amount: PAY, pay_unit: 'day', pay_visible: true, order_id: ORDER });
  const a2 = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w2', body: {} });
  await call('POST', `/work/applications/${a2.data.id}/withdraw`, { token: 'tok-w2' });
  const asg = await assign(job, 'tok-w1');
  await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w1' });
  await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'issue', body: '현관 비번 0000, 시험시 시험로 1 302호', issue_chips: ['현장 조건 다름'] } });
  await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '완료' } });

  const other = await makeJob({ mode: 'direct', title: '시험 지정 작업' });
  const offer = await call('POST', `/work/admin/jobs/${other.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  assert.equal(offer.status, 201);
  assert.equal((await call('POST', `/work/assignments/${offer.data.id}/decline`, { token: 'tok-w2', body: { reason: '일정 겹침' } })).data.status, 'declined');
  const third = await makeJob({ title: '시험 포기 작업' });
  const asg3 = await assign(third, 'tok-w2');
  assert.equal((await call('POST', `/work/assignments/${asg3.id}/release`, { token: 'tok-w2', body: {} })).status, 422, '포기 사유 필수');
  assert.equal((await call('POST', `/work/assignments/${asg3.id}/release`, { token: 'tok-w2', body: { reason: '개인 사정' } })).data.status, 'released');
  assert.equal(rowOf('work_jobs', third.id).status, 'open', '자리가 비면 다시 모집');

  const texts = db.slack.map((p) => p.text);
  for (const label of ['작업 신청', '신청 철회', '문제 보고', '완료 보고', '배정 거절', '배정 포기']) {
    assert.ok(texts.some((t) => t.includes(label)), label);
  }
  const all = JSON.stringify(db.slack);
  for (const bad of [CUSTOMER_NAME, 'DD-TEST-1', String(PAY), '250,000', '25만', W1_PHONE, '시험로', '0000,', '일정 겹침', '개인 사정']) {
    assert.ok(!all.includes(bad), bad);
  }
  assert.ok(all.includes(`https://dadam.test/admin/work-jobs.html?job=${job.id}`));
  assert.ok(texts.every((t) => t.startsWith('[작업자 포털]')));
});

test('직접 지정 — 승인 · 종류 맞는 작업자만, 수락하면 정원에 들고 정원이 찼으면 수락 409', async () => {
  const job = await makeJob({ mode: 'invite', slots: 1, kind: 'install' });
  const pend = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: WP } });
  assert.equal(pend.status, 409, '대기 작업자');
  assert.equal(pend.body.message, '승인된 작업자만 배정할 수 있습니다');
  const asJob = await makeJob({ kind: 'as', mode: 'invite' });
  assert.equal((await call('POST', `/work/admin/jobs/${asJob.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } })).status, 409, '종류 불일치');
  const o1 = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } });
  const o2 = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  assert.deepEqual([o1.data.status, o1.data.via], ['offered', 'invite']);
  assert.equal((await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } })).status, 409, '중복 지정');
  // 초대받은 작업은 모집중이 아니어도 내 작업에서 보인다
  const mine = await call('GET', '/work/jobs?tab=mine', { token: 'tok-w2' });
  assert.equal(mine.data.items[0].my.assignment_status, 'offered');
  assert.equal((await call('GET', `/work/jobs/${job.id}`, { token: 'tok-w2' })).status, 200);
  assert.equal((await call('POST', `/work/assignments/${o1.data.id}/confirm`, { token: 'tok-w1' })).data.status, 'confirmed');
  assert.equal(rowOf('work_jobs', job.id).status, 'filled');
  assert.equal((await call('POST', `/work/assignments/${o2.data.id}/confirm`, { token: 'tok-w2' })).status, 409, '정원이 찼다');
  // 편집자 제외 (노쇼 표시) → 자리가 비면 다시 open, 사유는 작업자에게 안 나간다
  const rm = await call('POST', `/work/admin/assignments/${o1.data.id}/remove`, { token: 'tok-admin', body: { reason: '연락 두절', no_show: true } });
  assert.deepEqual([rm.data.status, rm.data.no_show], ['removed', true]);
  assert.equal(rowOf('work_jobs', job.id).status, 'open');
  const done = await call('GET', '/work/jobs?tab=done', { token: 'tok-w1' });
  assert.ok(!JSON.stringify(done.body).includes('연락 두절'));
  assert.equal((await call('POST', `/work/assignments/${o2.data.id}/confirm`, { token: 'tok-w2' })).data.status, 'confirmed');
});

test('남은 초대는 검수 · 완료를 막지 않는다 — 정원 1 에 둘을 초대, 한 명이 끝내면 review → done → 마감, 마감하면 남은 초대는 자동 종료', async () => {
  const job = await makeJob({ mode: 'invite', slots: 1, kind: 'install' });
  const o1 = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } });
  const o2 = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  assert.equal((await call('POST', `/work/assignments/${o1.data.id}/confirm`, { token: 'tok-w1' })).data.status, 'confirmed');
  assert.equal((await call('POST', `/work/assignments/${o1.data.id}/start`, { token: 'tok-w1' })).data.status, 'started');
  assert.equal(rowOf('work_jobs', job.id).status, 'in_progress');
  assert.equal((await call('POST', `/work/assignments/${o1.data.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '설치 끝' } })).status, 201);
  assert.equal(rowOf('work_jobs', job.id).status, 'review', '응답 없는 초대가 남아도 검수 대기');
  assert.equal((await call('POST', `/work/admin/assignments/${o1.data.id}/accept`, { token: 'tok-admin' })).data.status, 'accepted');
  assert.equal(rowOf('work_jobs', job.id).status, 'done');
  // done 까지는 남은 초대를 건드리지 않는다
  assert.equal(rowOf('work_assignments', o2.data.id).status, 'offered');
  const closed = await call('POST', `/work/admin/jobs/${job.id}/close`, { token: 'tok-admin' });
  assert.deepEqual([closed.status, closed.data.status, closed.data.auto_declined], [200, 'closed', 1]);
  // 마감하면 남은 초대는 declined (사유는 작업자에게 보이는 안내), 수락은 409
  const o2Row = rowOf('work_assignments', o2.data.id);
  assert.deepEqual([o2Row.status, o2Row.release_reason], ['declined', '작업이 마감돼 초대가 끝났습니다']);
  assert.equal(rowOf('work_assignments', o1.data.id).status, 'accepted', '끝난 배정은 그대로');
  assert.equal((await call('POST', `/work/assignments/${o2.data.id}/confirm`, { token: 'tok-w2' })).status, 409);
  const auto = db.tables.work_job_events.filter((e) => e.job_id === job.id && e.type === 'assignment_auto_declined');
  assert.equal(auto.length, 1);
  assert.deepEqual(
    [auto[0].assignment_id, auto[0].actor_kind, auto[0].actor_user_id, auto[0].from_status, auto[0].to_status, auto[0].note, auto[0].payload],
    [o2.data.id, 'system', null, 'offered', 'declined', '작업이 마감돼 초대가 끝났습니다', { worker_id: W2, reason: 'job_closed' }],
  );
  const statusFlow = db.tables.work_job_events.filter((e) => e.job_id === job.id && e.type === 'job_status').map((e) => `${e.from_status}>${e.to_status}`);
  assert.deepEqual(statusFlow, ['open>filled', 'filled>in_progress', 'in_progress>review', 'review>done']);
});

test('작업 취소 — 응답 없는 초대만 자동 종료(auto_declined), 확정 배정 · 대기 신청은 그대로, 초대받은 사람의 새 소식 · 지난 작업에 사유', async () => {
  // 세 번째 승인 작업자 (공개 신청 → 승인)
  const reg = await call('POST', '/work/register', { token: 'tok-new', body: { display_name: '시험기사C', kinds: ['install'], consent_version: 'v1' } });
  await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'approved' } });

  const job = await makeJob({ slots: 3 });
  const asg = await assign(job, 'tok-w1');
  const waiting = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-new', body: {} });
  const offer = await call('POST', `/work/admin/jobs/${job.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  assert.equal(offer.data.status, 'offered');
  // 다른 작업의 초대는 건드리지 않는다
  const other = await makeJob({ mode: 'invite', title: '다른 초대 작업' });
  const otherOffer = await call('POST', `/work/admin/jobs/${other.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });

  await call('GET', '/work/jobs?tab=mine', { token: 'tok-w2' });
  await tick();
  const c = await call('POST', `/work/admin/jobs/${job.id}/cancel`, { token: 'tok-admin', body: { reason: '고객 일정 변경' } });
  assert.deepEqual([c.status, c.data.status, c.data.auto_declined], [200, 'cancelled', 1]);

  assert.deepEqual([rowOf('work_assignments', offer.data.id).status, rowOf('work_assignments', offer.data.id).release_reason], ['declined', '작업이 취소돼 초대가 끝났습니다']);
  assert.equal(rowOf('work_assignments', asg.id).status, 'confirmed', '확정 배정은 그대로');
  assert.equal(rowOf('work_applications', waiting.data.id).status, 'applied', '대기 신청은 그대로');
  assert.equal(rowOf('work_assignments', otherOffer.data.id).status, 'offered', '다른 작업의 초대는 그대로');

  const ev = db.tables.work_job_events.filter((e) => e.type === 'assignment_auto_declined');
  assert.deepEqual(ev.map((e) => [e.job_id, e.assignment_id, e.actor_kind, e.from_status, e.to_status, e.note, e.payload]), [
    [job.id, offer.data.id, 'system', 'offered', 'declined', '작업이 취소돼 초대가 끝났습니다', { worker_id: W2, reason: 'job_cancelled' }],
  ]);

  // 초대받은 사람의 새 소식 배지에 잡힌다
  const me = await call('GET', '/work/me', { token: 'tok-w2' });
  assert.equal(me.data.counts.newEvents, 1);
  // 지난 작업 탭에서 끝난 이유가 보인다
  const done = await call('GET', '/work/jobs?tab=done', { token: 'tok-w2' });
  const card = done.data.items.find((j) => j.id === job.id);
  assert.deepEqual([card.my.assignment_status, card.my.release_reason], ['declined', '작업이 취소돼 초대가 끝났습니다']);
  assert.deepEqual(findForbiddenKeys(done.body), []);
  // 이미 취소된 작업을 다시 취소하면 409 — 자동 종료도 다시 돌지 않는다
  assert.equal((await call('POST', `/work/admin/jobs/${job.id}/cancel`, { token: 'tok-admin', body: { reason: '다시' } })).status, 409);
  assert.equal(db.tables.work_job_events.filter((e) => e.type === 'assignment_auto_declined').length, 1);
});

test('작업 취소 — done 전만, 취소된 작업에는 보고 · 승인 409', async () => {
  const job = await makeJob({ slots: 2 });
  const asg = await assign(job, 'tok-w1');
  const a2 = await call('POST', `/work/jobs/${job.id}/apply`, { token: 'tok-w2', body: {} });
  assert.equal((await call('POST', `/work/admin/jobs/${job.id}/cancel`, { token: 'tok-admin', body: {} })).status, 422, '사유 필수');
  const c = await call('POST', `/work/admin/jobs/${job.id}/cancel`, { token: 'tok-admin', body: { reason: '고객 일정 변경' } });
  assert.deepEqual([c.data.status, c.data.cancel_reason], ['cancelled', '고객 일정 변경']);
  assert.equal((await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'progress', body: 'x' } })).status, 409);
  assert.equal((await call('POST', `/work/admin/applications/${a2.data.id}/approve`, { token: 'tok-admin', body: {} })).status, 409);
  assert.equal((await call('POST', `/work/admin/jobs/${job.id}/cancel`, { token: 'tok-admin', body: { reason: '다시' } })).status, 409);
  const card = (await call('GET', '/work/jobs?tab=mine', { token: 'tok-w1' })).data.items[0];
  assert.equal(card.effective_status, 'cancelled');
});

test('/work/me 배지 — 모집중 · 내 작업 · 보완요청 · 새 소식(내 작업을 열어 보면 0)', async () => {
  const j1 = await makeJob();
  await makeJob({ title: '두 번째' });
  const asg = await assign(j1, 'tok-w1');
  let me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.data.counts.open, 1);
  assert.equal(me.data.counts.mine, 1);
  assert.equal(me.data.counts.revision, 0);
  assert.equal(me.data.counts.newEvents, 2, '신청 승인 + 배정 확정 (내가 한 신청은 세지 않는다)');
  await tick();
  await call('GET', '/work/jobs?tab=mine', { token: 'tok-w1' });
  me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.data.counts.newEvents, 0);
  await tick();
  await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w1' });
  await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '끝' } });
  await call('POST', `/work/admin/assignments/${asg.id}/revision`, { token: 'tok-admin', body: { reason: '사진 부족' } });
  me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.deepEqual([me.data.counts.revision, me.data.counts.newEvents], [1, 1]);
});

test('표가 아직 없으면 — 목록은 빈 결과, /work/me 는 { ready:false }', async () => {
  for (const t of ['workers', 'worker_invites', 'worker_notes', 'work_jobs', 'work_applications', 'work_assignments', 'work_updates', 'work_job_events']) db.missing.add(t);
  const me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.status, 200);
  assert.deepEqual(me.data, { ready: false, worker: null, counts: { open: 0, mine: 0, revision: 0, newEvents: 0 }, next_job: null });
  for (const tab of ['open', 'mine', 'done']) {
    const r = await call('GET', `/work/jobs?tab=${tab}`, { token: 'tok-w1' });
    assert.deepEqual([r.status, r.data.items], [200, []], tab);
  }
  assert.deepEqual((await call('GET', '/work/admin/jobs', { token: 'tok-admin' })).data.items, []);
  assert.deepEqual((await call('GET', '/work/admin/workers', { token: 'tok-admin' })).data.items, []);
  assert.equal((await call('GET', '/work/jobs?tab=bogus', { token: 'tok-w1' })).status, 422);
});

test('작업 만들기 — 초안 · 금액 기본 숨김 · 주소 칸은 받지 않는다, 게시 · 고치기는 draft/open 만', async () => {
  const r = await call('POST', '/work/admin/jobs', { token: 'tok-admin', body: { kind: 'as', title: '  시험 A/S  ', address: '시험로 1', customer_name: CUSTOMER_NAME, slots: 2 } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.data.status, r.data.title, r.data.pay_visible, r.data.mode, r.data.version, r.data.slots], ['draft', '시험 A/S', false, 'open', 0, 2]);
  assert.equal('address' in rowOf('work_jobs', r.data.id) || 'customer_name' in rowOf('work_jobs', r.data.id), false);
  for (const bad of [{ kind: 'cutting', title: 't' }, { kind: 'as', title: '' }, { kind: 'as', title: 't', slots: 0 }, { kind: 'as', title: 't', pay_amount: -1 }, { kind: 'as', title: 't', pay_unit: 'month' }, { kind: 'as', title: 'x'.repeat(81) }, { kind: 'as', title: 't', starts_at: 'tomorrow' }]) {
    assert.equal((await call('POST', '/work/admin/jobs', { token: 'tok-admin', body: bad })).status, 422, JSON.stringify(bad));
  }
  const p = await call('PATCH', `/work/admin/jobs/${r.data.id}`, { token: 'tok-admin', body: { pay_amount: PAY, pay_unit: 'day', version: 0 } });
  assert.deepEqual([p.status, p.data.pay_amount, p.data.version], [200, PAY, 1]);
  const pub = await call('POST', `/work/admin/jobs/${r.data.id}/publish`, { token: 'tok-admin' });
  assert.equal(pub.data.status, 'open');
  assert.equal((await call('POST', `/work/admin/jobs/${r.data.id}/publish`, { token: 'tok-admin' })).status, 409);
  assert.equal((await call('POST', `/work/admin/jobs/${r.data.id}/close`, { token: 'tok-admin' })).status, 409, 'done 이 아니면 마감 불가');
  const list = await call('GET', '/work/admin/jobs?status=open', { token: 'tok-admin' });
  assert.deepEqual([list.data.items[0].applications, list.data.items[0].confirmed, list.data.items[0].slots], [0, 0, 2]);
});

// ── 1주차 후속 (2026-10-20) ──────────────────────────────────────

const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;

test('다음 작업 고르기 (순수) — 보완요청 먼저, 아니면 KST 오늘 이후 가장 이른 시작일, 아니면 첫 줄 (mypage-work.js 와 같은 규칙)', () => {
  const NOW = Date.parse('2026-10-20T03:00:00Z'); // KST 10/20 12:00
  const card = (id, startsAt, status = 'confirmed') => ({ id, starts_at: startsAt, my: { assignment_status: status } });
  const past = card('past', '2026-10-19T01:00:00Z');
  const earlyToday = card('today', '2026-10-19T15:30:00Z'); // KST 10/20 00:30 — 오늘이라 아직 다음 작업
  const lateYesterday = card('yday', '2026-10-19T14:30:00Z'); // KST 10/19 23:30 — 어제
  const later = card('later', '2026-10-25T00:00:00Z');
  const soon = card('soon', '2026-10-22T00:00:00Z');
  const undated = card('none', null);
  assert.equal(pickNextJob([past, later, soon, undated], NOW).id, 'soon');
  assert.equal(pickNextJob([lateYesterday, earlyToday, later], NOW).id, 'today');
  assert.equal(pickNextJob([past, later, card('rev', '2026-10-30T00:00:00Z', 'revision')], NOW).id, 'rev');
  assert.equal(pickNextJob([later, card('rev2', null, 'revision')], NOW).id, 'rev2', '보완요청은 날짜가 없어도 먼저');
  assert.equal(pickNextJob([past, lateYesterday, undated], NOW).id, 'past', '날짜가 다 지났거나 없으면 첫 줄');
  assert.equal(pickNextJob([undated], NOW).id, 'none');
  assert.equal(pickNextJob([], NOW), null);
  assert.equal(pickNextJob(null, NOW), null);
});

test('/work/me next_job — 내 작업 중 다음 작업 한 장 (JobCard), 읽음 처리(last_seen_at)는 건드리지 않는다', async () => {
  const now = Date.now();
  const pastJob = await makeJob({ title: '지난 날짜', starts_at: iso(now - 3 * DAY) });
  const farJob = await makeJob({ title: '먼 날짜', starts_at: iso(now + 6 * DAY) });
  const nearJob = await makeJob({ title: '가까운 날짜', mode: 'invite', starts_at: iso(now + 2 * DAY), pay_amount: PAY, pay_unit: 'day', pay_visible: false, order_id: ORDER });
  const undatedJob = await makeJob({ title: '날짜 없음' });
  await assign(pastJob, 'tok-w1');
  await assign(farJob, 'tok-w1');
  await call('POST', `/work/admin/jobs/${nearJob.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } });
  await assign(undatedJob, 'tok-w1');
  const callsBefore = db.calls.length;

  let me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.status, 200);
  assert.equal(me.data.next_job.id, nearJob.id, '오늘 이후 가장 이른 시작일 (초대도 내 작업)');
  assert.deepEqual([me.data.next_job.title, me.data.next_job.my.assignment_status, me.data.next_job.effective_status], ['가까운 날짜', 'offered', 'open']);
  assert.equal('pay' in me.data.next_job, false, 'pay_visible=false 면 금액 없음');
  assert.deepEqual(findForbiddenKeys(me.body, { allowPhoneAt: ['$.data.worker'] }), []);
  assert.ok(!JSON.stringify(me.data.next_job).includes(CUSTOMER_NAME) && !JSON.stringify(me.data.next_job).includes('DD-TEST-1'), '카드에는 주문 정보가 없다');
  // 읽음 처리 없음 — workers 를 고치는 요청이 없고 last_seen_at 은 그대로
  assert.equal(rowOf('workers', W1).last_seen_at, null);
  assert.equal(db.calls.slice(callsBefore).some((c) => c.method !== 'GET' && c.url.includes('/rest/v1/workers')), false);
  assert.equal(me.data.counts.newEvents > 0, true, '새 소식은 그대로 남는다');

  // 같은 규칙을 내 작업 탭 순서에 적용한 것과 같다
  const mine = await call('GET', '/work/jobs?tab=mine', { token: 'tok-w1' });
  assert.deepEqual(mine.data.items.map((j) => j.id), [pastJob.id, nearJob.id, farJob.id, undatedJob.id], '시작일 오름차순, 없는 것은 뒤');
  assert.equal(pickNextJob(mine.data.items).id, me.data.next_job.id);

  // 보완요청이 있으면 그것이 먼저
  const revJob = await makeJob({ title: '보완 작업', starts_at: iso(now + 9 * DAY) });
  const revAsg = await assign(revJob, 'tok-w1');
  await call('POST', `/work/assignments/${revAsg.id}/start`, { token: 'tok-w1' });
  await call('POST', `/work/assignments/${revAsg.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '끝' } });
  await call('POST', `/work/admin/assignments/${revAsg.id}/revision`, { token: 'tok-admin', body: { reason: '사진 부족' } });
  me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.data.next_job.id, revJob.id);

  // 내 작업이 없으면 null, 작업자가 아니면 null
  assert.equal((await call('GET', '/work/me', { token: 'tok-w2' })).data.next_job, null);
  assert.equal((await call('GET', '/work/me', { token: 'tok-pend' })).data.next_job, null);
  assert.equal((await call('GET', '/work/me', { token: 'tok-cust' })).data.next_job, null);
});

test('/work/me next_job — 앞날 작업이 없으면 내 작업 탭 첫 줄 (지난 시작일 중 가장 이른 것)', async () => {
  const now = Date.now();
  const a = await makeJob({ title: '나흘 전', starts_at: iso(now - 4 * DAY) });
  const b = await makeJob({ title: '이틀 전', starts_at: iso(now - 2 * DAY) });
  const c = await makeJob({ title: '날짜 없음' });
  await assign(b, 'tok-w1');
  await assign(c, 'tok-w1');
  await assign(a, 'tok-w1');
  const me = await call('GET', '/work/me', { token: 'tok-w1' });
  assert.equal(me.data.next_job.id, a.id);
});

test('정지된 작업자 — 모집중 · 신청 · 초대 수락만 403(문구), 지난 기록 · 진행 중인 일 정리는 된다', async () => {
  const applied = await makeJob({ title: '신청만 한 작업' });
  const appliedForApprove = await makeJob({ title: '승인 대기 신청' });
  const confirmed = await makeJob({ title: '확정 작업', starts_at: iso(Date.now() + 2 * DAY) });
  const toRelease = await makeJob({ title: '포기할 작업' });
  const invited = await makeJob({ mode: 'invite', title: '초대 작업' });
  const invited2 = await makeJob({ mode: 'invite', title: '거절할 초대' });
  const fresh = await makeJob({ title: '새 작업' });

  const app = await call('POST', `/work/jobs/${applied.id}/apply`, { token: 'tok-w2', body: {} });
  const app2 = await call('POST', `/work/jobs/${appliedForApprove.id}/apply`, { token: 'tok-w2', body: {} });
  const asg = await assign(confirmed, 'tok-w2');
  const asgRelease = await assign(toRelease, 'tok-w2');
  const offer = await call('POST', `/work/admin/jobs/${invited.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  const offer2 = await call('POST', `/work/admin/jobs/${invited2.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });

  const sus = await call('PATCH', `/work/admin/workers/${W2}`, { token: 'tok-admin', body: { status: 'suspended' } });
  assert.equal(sus.data.status, 'suspended');

  // /work/me — 요약은 보이고 모집중은 0
  const me = await call('GET', '/work/me', { token: 'tok-w2' });
  assert.equal(me.status, 200);
  assert.equal(me.data.worker.status, 'suspended');
  assert.deepEqual([me.data.counts.open, me.data.counts.mine], [0, 4]);
  assert.equal(me.data.next_job.id, confirmed.id);

  // 막음 — 라우트마다 문구
  const open = await call('GET', '/work/jobs?tab=open', { token: 'tok-w2' });
  assert.deepEqual([open.status, open.body.message], [403, '정지된 계정은 새 작업을 볼 수 없습니다']);
  const noTab = await call('GET', '/work/jobs', { token: 'tok-w2' });
  assert.equal(noTab.status, 403, 'tab 없음 = open');
  const apply = await call('POST', `/work/jobs/${fresh.id}/apply`, { token: 'tok-w2', body: {} });
  assert.deepEqual([apply.status, apply.body.message], [403, '정지된 계정은 새 작업에 신청할 수 없습니다']);
  const confirm = await call('POST', `/work/assignments/${offer.data.id}/confirm`, { token: 'tok-w2' });
  assert.deepEqual([confirm.status, confirm.body.message], [403, '정지된 계정은 새 작업을 수락할 수 없습니다']);
  assert.equal(rowOf('work_assignments', offer.data.id).status, 'offered');
  assert.equal(db.tables.work_applications.filter((a) => a.job_id === fresh.id).length, 0);
  // 모집중 열람 경로 없음 — 내 신청 · 배정이 없는 작업은 404
  assert.equal((await call('GET', `/work/jobs/${fresh.id}`, { token: 'tok-w2' })).status, 404);

  // 허용 — 지난 기록
  const mine = await call('GET', '/work/jobs?tab=mine', { token: 'tok-w2' });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.items.map((j) => j.id).sort(), [confirmed.id, toRelease.id, invited.id, invited2.id].sort());
  assert.equal((await call('GET', '/work/jobs?tab=done', { token: 'tok-w2' })).status, 200);
  const detailApplied = await call('GET', `/work/jobs/${applied.id}`, { token: 'tok-w2' });
  assert.deepEqual([detailApplied.status, detailApplied.data.my.application_status], [200, 'applied'], '내 신청이 있는 작업');
  const detail = await call('GET', `/work/jobs/${confirmed.id}`, { token: 'tok-w2' });
  assert.deepEqual([detail.status, detail.data.my.assignment_status], [200, 'confirmed'], '내 배정이 있는 작업');
  // 허용 — 진행 중인 일 정리
  assert.equal((await call('POST', `/work/applications/${app.data.id}/withdraw`, { token: 'tok-w2' })).data.status, 'withdrawn');
  assert.equal((await call('POST', `/work/assignments/${offer2.data.id}/decline`, { token: 'tok-w2', body: { reason: '일정 겹침' } })).data.status, 'declined');
  assert.equal((await call('POST', `/work/assignments/${asgRelease.id}/release`, { token: 'tok-w2', body: { reason: '개인 사정' } })).data.status, 'released');
  assert.equal((await call('POST', `/work/assignments/${asg.id}/start`, { token: 'tok-w2' })).data.status, 'started');
  assert.equal((await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w2', body: { kind: 'progress', body: '설치 중' } })).status, 201);
  assert.equal((await call('POST', `/work/assignments/${asg.id}/updates`, { token: 'tok-w2', body: { kind: 'result', body: '설치 끝' } })).status, 201);
  assert.equal(rowOf('work_assignments', asg.id).status, 'submitted');

  // 정지 작업자의 응답에도 금지 키 없음
  for (const r of [me.body, mine.body, detail.body, detailApplied.body]) {
    assert.deepEqual(findForbiddenKeys(r, { allowPhoneAt: ['$.data.worker'] }), [], JSON.stringify(r));
  }

  // 관리자 — 정지 작업자에게 초대 · 신청 승인은 409
  const inv = await call('POST', `/work/admin/jobs/${fresh.id}/invite`, { token: 'tok-admin', body: { worker_id: W2 } });
  assert.deepEqual([inv.status, inv.body.message], [409, '정지된 작업자는 배정할 수 없습니다']);
  const appr = await call('POST', `/work/admin/applications/${app2.data.id}/approve`, { token: 'tok-admin', body: {} });
  assert.deepEqual([appr.status, appr.body.message], [409, '정지된 작업자는 배정할 수 없습니다']);
  assert.equal(rowOf('work_applications', app2.data.id).status, 'applied');

  // 다시 승인하면 모집중이 열린다
  await call('PATCH', `/work/admin/workers/${W2}`, { token: 'tok-admin', body: { status: 'approved' } });
  assert.equal((await call('GET', '/work/jobs?tab=open', { token: 'tok-w2' })).status, 200);
  assert.equal((await call('POST', `/work/assignments/${offer.data.id}/confirm`, { token: 'tok-w2' })).data.status, 'confirmed');
});

test('대기 · 반려 · 미등록 — 지난 기록 라우트도 403 (그대로)', async () => {
  const job = await makeJob();
  await call('PATCH', `/work/admin/workers/${WP}`, { token: 'tok-admin', body: { status: 'rejected', reject_reason: '서류 미비' } });
  for (const tok of ['tok-pend', 'tok-cust']) {
    for (const tab of ['open', 'mine', 'done']) assert.equal((await call('GET', `/work/jobs?tab=${tab}`, { token: tok })).status, 403, `${tok} ${tab}`);
    assert.equal((await call('GET', `/work/jobs/${job.id}`, { token: tok })).status, 403, tok);
    assert.equal((await call('POST', `/work/applications/${ORDER}/withdraw`, { token: tok })).status, 403, tok);
    for (const p of ['decline', 'release', 'start', 'updates']) {
      assert.equal((await call('POST', `/work/assignments/${ORDER}/${p}`, { token: tok, body: { reason: 'x', kind: 'progress', body: 'x' } })).status, 403, `${tok} ${p}`);
    }
  }
});

test('관리자 작업자 목록 — active_count(응답 대기 · 확정 · 진행 · 보고 · 보완) · done_count', async () => {
  const j1 = await makeJob({ title: '확정' });
  await assign(j1, 'tok-w1');
  const j2 = await makeJob({ mode: 'invite', title: '초대' });
  await call('POST', `/work/admin/jobs/${j2.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } });
  const j3 = await makeJob({ kind: 'assembly', title: '조립 끝' });
  const a3 = await assign(j3, 'tok-w1');
  await call('POST', `/work/assignments/${a3.id}/start`, { token: 'tok-w1' });
  await call('POST', `/work/assignments/${a3.id}/updates`, { token: 'tok-w1', body: { kind: 'result', body: '끝' } });
  const j4 = await makeJob({ mode: 'invite', title: '거절' });
  const o4 = await call('POST', `/work/admin/jobs/${j4.id}/invite`, { token: 'tok-admin', body: { worker_id: W1 } });
  await call('POST', `/work/assignments/${o4.data.id}/decline`, { token: 'tok-w1', body: {} });
  const j5 = await makeJob({ title: '진행' });
  const a5 = await assign(j5, 'tok-w1');
  await call('POST', `/work/assignments/${a5.id}/start`, { token: 'tok-w1' });

  const list = await call('GET', '/work/admin/workers', { token: 'tok-support' });
  const byId = new Map(list.data.items.map((w) => [w.id, w]));
  assert.deepEqual([byId.get(W1).active_count, byId.get(W1).done_count], [3, 1], 'confirmed · offered · started = 3, declined 은 빼고, accepted 는 실적');
  assert.deepEqual([byId.get(W2).active_count, byId.get(W2).done_count], [0, 0]);
  assert.deepEqual([byId.get(WP).active_count, byId.get(WP).done_count], [0, 0]);
});

test('작업자 이력 (worker_events) — 공개 신청 · 초대 가입 · 상태 변경(반려 사유) · 종류 변경, 개인정보 없음, 409 는 한국어 상태 이름', async () => {
  const reg = await call('POST', '/work/register', { token: 'tok-cust', body: { display_name: '시험신청', phone: '010-0000-0009', kinds: ['install'], region_label: '시험시', consent_version: 'v1' } });
  assert.equal(reg.status, 201);
  const inv = await call('POST', '/work/admin/invites', { token: 'tok-admin', body: { kinds_preset: ['as'], display_name_preset: '시험초대', expires_at: '2099-01-01T00:00:00Z' } });
  const claim = await call('POST', '/work/claim-invite', { token: 'tok-new', body: { token: inv.data.url.split('#invite=')[1], consent_version: 'v1' } });
  assert.equal(claim.status, 201);

  await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'approved' } });
  await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { kinds: ['install', 'as'] } });
  await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { kinds: ['as', 'install'] } }); // 같은 종류 — 이력 없음
  await call('PATCH', `/work/admin/workers/${claim.data.id}`, { token: 'tok-admin', body: { status: 'rejected', reject_reason: '활동 지역 밖' } });

  const rows = (id) => db.tables.worker_events.filter((e) => e.worker_id === id).map((e) => [e.type, e.actor_kind, e.actor_user_id, e.from_status, e.to_status, e.note, e.payload]);
  assert.deepEqual(rows(reg.data.id), [
    ['registered', 'worker', CUSTOMER, null, 'pending', null, { via: 'public' }],
    ['status_changed', 'admin', ADMIN, 'pending', 'approved', null, {}],
    ['kinds_changed', 'admin', ADMIN, null, null, null, { kinds: ['install', 'as'] }],
  ]);
  assert.deepEqual(rows(claim.data.id), [
    ['registered', 'worker', NEWBIE, null, 'pending', null, { via: 'invite', invite_id: inv.data.id }],
    ['status_changed', 'admin', ADMIN, 'pending', 'rejected', '활동 지역 밖', {}],
  ]);
  const all = JSON.stringify(db.tables.worker_events);
  for (const bad of ['시험신청', '시험초대', '010-0000-0009', '시험시']) assert.ok(!all.includes(bad), bad);

  // 상태 변경 409 — 한국어 상태 이름
  const no = await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'rejected' } });
  assert.deepEqual([no.status, no.body.message], [409, "'승인' 상태에서 '반려'(으)로 바꿀 수 없습니다"]);
  const no2 = await call('PATCH', `/work/admin/workers/${claim.data.id}`, { token: 'tok-admin', body: { status: 'approved' } });
  assert.equal(no2.body.message, "'반려' 상태에서 '승인'(으)로 바꿀 수 없습니다");
  await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'suspended' } });
  const no3 = await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'rejected' } });
  assert.equal(no3.body.message, "'정지' 상태에서 '반려'(으)로 바꿀 수 없습니다");
  assert.equal(db.tables.worker_events.filter((e) => e.worker_id === reg.data.id).length, 4, '막힌 변경은 이력이 없다');
});

test('GET /work/admin/workers/:id/events — 최근순, support 도 읽는다, 고객 403 · 없는 작업자 404 · 잘못된 id 422 · 표가 없으면 빈 목록', async () => {
  await call('PATCH', `/work/admin/workers/${WP}`, { token: 'tok-admin', body: { status: 'approved' } });
  await tick();
  await call('PATCH', `/work/admin/workers/${WP}`, { token: 'tok-admin', body: { kinds: ['install', 'as'] } });
  db.tables.worker_events.push({ id: randomUUID(), worker_id: W1, actor_kind: 'admin', type: 'status_changed', from_status: 'pending', to_status: 'approved', payload: {}, created_at: '2020-01-01T00:00:00.000Z' });

  const r = await call('GET', `/work/admin/workers/${WP}/events`, { token: 'tok-support' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((e) => e.type), ['kinds_changed', 'status_changed'], '최근순, 이 작업자 것만');
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  assert.equal((await call('GET', `/work/admin/workers/${WP}/events`, { token: 'tok-admin' })).status, 200);
  assert.equal((await call('GET', `/work/admin/workers/${WP}/events`, { token: 'tok-cust' })).status, 403);
  assert.equal((await call('GET', `/work/admin/workers/${WP}/events`, { token: 'tok-w1' })).status, 403);
  assert.equal((await call('GET', `/work/admin/workers/${ORDER}/events`, { token: 'tok-admin' })).status, 404);
  assert.equal((await call('GET', '/work/admin/workers/not-a-uuid/events', { token: 'tok-admin' })).status, 422);
  assert.deepEqual((await call('GET', `/work/admin/workers/${W2}/events`, { token: 'tok-admin' })).data.items, [], '기록 없음');

  // 표가 아직 없으면 — 읽기는 빈 목록, 쓰기(가입 · 상태 변경)는 경고만 남기고 계속
  db.missing.add('worker_events');
  assert.deepEqual((await call('GET', `/work/admin/workers/${WP}/events`, { token: 'tok-admin' })).data.items, []);
  const reg = await call('POST', '/work/register', { token: 'tok-cust', body: { display_name: '시험신청', kinds: ['install'], consent_version: 'v1' } });
  assert.equal(reg.status, 201);
  assert.equal((await call('PATCH', `/work/admin/workers/${reg.data.id}`, { token: 'tok-admin', body: { status: 'approved' } })).status, 200);
});
