/**
 * 상담 확정(POST /consultations/:id/accept) · 내 프로젝트(GET /me/projects) — src/projects.js.
 *
 * 가짜 PostgREST 는 표를 메모리에 두고 eq · neq · in · is.null 거르기, select 칸 고르기,
 * designs!inner(...) 내장 조인, order · limit, 넣기 · 고치기 · 지우기를 흉내 낸다.
 * 그래서 두 번 부르기(멱등)는 첫 호출이 바꾼 행을 두 번째 호출이 그대로 읽는다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { projectStage, PROJECT_STAGES } from '../src/projects.js';
import { HQ, PARTNER } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };

const ADMIN = 'u-admin';
const STAFF = 'u-staff';
const MEMBER = 'u-member';
const NEWBIE = 'u-newbie';
const OTHER = 'u-other';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C_MEMBER = id(1);
const C_GUEST = id(2);
const C_PARTNER = id(3);
const C_DONE = id(4);
const C_CANCELLED = id(5);
const C_NEWBIE = id(6);
const C_LINKED_GEN = id(7);
const C_PARTNER_GEN = id(8);
const C_HAS_CUSTOMER = id(9);
const C_MISSING = id(99);

const GEN_FREE = 'g-free';
const GEN_TAKEN = 'g-taken';
const GEN_PARTNER = 'g-partner';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── 가짜 PostgREST ───────────────────────────────────────────────

const res = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

function matches(value, filter) {
  if (filter === 'is.null') return value == null;
  if (filter.startsWith('eq.')) return value != null && String(value) === filter.slice(3);
  if (filter.startsWith('neq.')) return value == null || String(value) !== filter.slice(4);
  if (filter.startsWith('in.(')) return value != null && filter.slice(4, -1).split(',').includes(String(value));
  throw new Error(`fake: 모르는 거르기 ${filter}`);
}

const RESERVED = new Set(['select', 'order', 'limit']);

/** select 칸 → 행. 「표!inner(칸)」 은 design_id 로 그 표 행을 붙인다 */
function project(row, select, db) {
  if (!select || select === '*') return { ...row };
  const out = {};
  for (const part of select.match(/[^,(]+(\([^)]*\))?/g)) {
    const embed = part.match(/^(\w+)!inner\(([^)]*)\)$/);
    if (embed) {
      const [, table, cols] = embed;
      const parent = db[table].find((r) => r.id === row.design_id);
      out[table] = Object.fromEntries(cols.split(',').map((c) => [c, parent ? parent[c] : undefined]));
    } else {
      out[part] = row[part];
    }
  }
  return out;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((k) => {
    const [col, dir = 'asc', nulls] = k.split('.');
    return { col, desc: dir === 'desc', nullsLast: nulls === 'nullslast' || (nulls == null && dir === 'asc') };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc, nullsLast } of keys) {
      const x = a[col];
      const y = b[col];
      if (x === y) continue;
      if (x == null) return nullsLast ? 1 : -1;
      if (y == null) return nullsLast ? -1 : 1;
      const cmp = x < y ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

/**
 * tables: { 표: [행] } — 고쳐 쓰므로 시험마다 새로 만든다.
 * admins: 관리자 user_id 목록. hooks.beforePatch(table, rows) 가 무엇을 돌려주면 그 응답을 쓴다.
 */
function fakeDb(tables, { admins = [ADMIN], hooks = {} } = {}) {
  const db = { companies: [{ id: HQ, kind: 'hq', name: '다담가구' }, { id: PARTNER, kind: 'partner', name: '협력업체' }], ...tables };
  for (const t of ['customers', 'projects', 'consultations', 'generations', 'orders', 'order_payments', 'designs', 'design_documents', 'design_schedules']) {
    db[t] = db[t] || [];
  }
  let seq = 0;
  const calls = [];

  function rowsFor(table, q) {
    let rows = db[table];
    for (const [key, filter] of q.entries()) {
      if (RESERVED.has(key)) continue;
      if (key.includes('.')) {
        const [embedTable, col] = key.split('.');
        rows = rows.filter((r) => {
          const parent = db[embedTable].find((p) => p.id === r.design_id);
          return parent && matches(parent[col], filter);
        });
      } else {
        rows = rows.filter((r) => matches(r[key], filter));
      }
    }
    return rows;
  }

  async function fetch(url, init = {}) {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: decodeURIComponent(String(url)), method, body, path: u.pathname, q: u.searchParams });
    if (u.pathname === '/auth/v1/user') {
      const token = (init.headers.Authorization || '').replace(/^Bearer\s+/, '');
      return res({ id: token });
    }
    if (u.pathname === '/rest/v1/admin_roles') {
      const uid = u.searchParams.get('user_id').replace(/^eq\./, '');
      return res(admins.includes(uid) ? [{ role: 'admin' }] : []);
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (!db[table]) throw new Error(`fake: 모르는 표 ${table}`);
    const q = u.searchParams;
    if (method === 'GET') {
      let rows = sortRows(rowsFor(table, q), q.get('order'));
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return res(rows.map((r) => project(r, q.get('select'), db)));
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const made = [];
      for (const r of list) {
        if (table === 'customers' && r.user_id && db.customers.some((c) => c.company_id === r.company_id && c.user_id === r.user_id)) {
          return { ok: false, status: 409, headers: { get: () => 'application/json' }, text: async () => '{"code":"23505"}' };
        }
        const row = { id: `${table}-new-${++seq}`, created_at: `2026-10-28T00:00:0${seq}Z`, ...r };
        db[table].push(row);
        made.push(row);
      }
      return res(made, 201);
    }
    if (method === 'PATCH') {
      const rows = rowsFor(table, q);
      const hooked = hooks.beforePatch && hooks.beforePatch(table, rows);
      if (hooked) return hooked;
      for (const r of rows) Object.assign(r, body);
      return res(rows.map((r) => project(r, q.get('select'), db)));
    }
    if (method === 'DELETE') {
      const rows = rowsFor(table, q);
      db[table] = db[table].filter((r) => !rows.includes(r));
      return res(null, 204);
    }
    throw new Error(`fake: ${method}`);
  }

  return { db, calls, fetch };
}

async function call(fake, path, token, { method = 'GET', body } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await worker.fetch(
      new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      ENV,
      { waitUntil: () => {} },
    );
    const text = await r.text();
    return { status: r.status, json: JSON.parse(text), headers: r.headers };
  } finally {
    globalThis.fetch = original;
  }
}

const writes = (fake) => fake.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/rest/v1/'));
const WHEN = '2026-11-03T05:00:00.000Z';
const accept = (fake, consultationId, token = ADMIN, body = { confirmed_at: WHEN }) =>
  call(fake, `/consultations/${consultationId}/accept`, token, { method: 'POST', body });

// ── 상담 확정 ────────────────────────────────────────────────────

const consult = (cid, extra = {}) => ({
  id: cid, company_id: HQ, customer_id: null, project_id: null, generation_id: null, user_id: null,
  name: '김고객', email: 'kim@example.test', phone: '010-1111-2222', title: '주방 싱크대 상담', status: 'pending', confirmed_at: null,
  ...extra,
});

function acceptDb(hooks) {
  return fakeDb(
    {
      customers: [
        { id: 'cust-member', company_id: HQ, user_id: MEMBER, name: null, phone: null },
        // 비회원 상담과 이름 · 연락처가 같은 기존 고객 — 잇지 않아야 한다
        { id: 'cust-samephone', company_id: HQ, user_id: null, name: '김고객', phone: '010-1111-2222' },
      ],
      consultations: [
        consult(C_MEMBER, { user_id: MEMBER }),
        consult(C_GUEST),
        consult(C_PARTNER, { company_id: PARTNER }),
        consult(C_DONE, { status: 'completed' }),
        consult(C_CANCELLED, { status: 'cancelled' }),
        consult(C_NEWBIE, { user_id: NEWBIE }),
        consult(C_LINKED_GEN, { user_id: MEMBER, generation_id: GEN_TAKEN }),
        consult(C_PARTNER_GEN, { generation_id: GEN_PARTNER }),
        consult(C_HAS_CUSTOMER, { customer_id: 'cust-member', status: 'confirmed', confirmed_at: '2026-11-01T00:00:00.000Z' }),
      ],
      generations: [
        { id: GEN_FREE, company_id: HQ, project_id: null },
        { id: GEN_TAKEN, company_id: HQ, project_id: 'proj-other' },
        { id: GEN_PARTNER, company_id: PARTNER, project_id: null },
      ],
    },
    { hooks },
  );
}

test('accept — 관리자가 아니면 403, 아무것도 쓰지 않는다', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_MEMBER, STAFF);
  assert.equal(r.status, 403);
  assert.equal(r.json.success, false);
  assert.equal(writes(fake).length, 0);
  assert.ok(!fake.calls.some((c) => c.path === '/rest/v1/consultations'), '상담도 읽지 않는다');
});

test('accept — 본사 상담이 아니면 관리자도 403', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_PARTNER);
  assert.equal(r.status, 403);
  assert.equal(writes(fake).length, 0);
});

test('accept — 없는 상담 · id 모양이 아니면 404', async () => {
  const fake = acceptDb();
  assert.equal((await accept(fake, C_MISSING)).status, 404);
  assert.equal((await accept(fake, 'not-a-uuid')).status, 404);
  assert.equal(writes(fake).length, 0);
});

test('accept — 완료 · 취소 상담은 409', async () => {
  const fake = acceptDb();
  for (const cid of [C_DONE, C_CANCELLED]) {
    const r = await accept(fake, cid);
    assert.equal(r.status, 409, cid);
  }
  assert.equal(writes(fake).length, 0);
});

test('accept — confirmed_at 이 없거나 날짜가 아니면 422', async () => {
  const fake = acceptDb();
  assert.equal((await accept(fake, C_MEMBER, ADMIN, {})).status, 422);
  assert.equal((await accept(fake, C_MEMBER, ADMIN, { confirmed_at: 'tomorrow-ish' })).status, 422);
  assert.equal(writes(fake).length, 0);
});

test('accept — 회원 상담은 그 계정의 본사 고객 행을 쓰고 프로젝트를 만든다', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_MEMBER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const data = r.json.data;
  assert.equal(data.consultation_id, C_MEMBER);
  assert.equal(data.customer_id, 'cust-member');
  assert.deepEqual(data.created, { customer: false, project: true });
  assert.deepEqual(Object.keys(data).sort(), ['consultation_id', 'created', 'customer_id', 'project_id']);

  const proj = fake.db.projects.find((p) => p.id === data.project_id);
  assert.deepEqual(
    { company_id: proj.company_id, customer_id: proj.customer_id, title: proj.title, status: proj.status },
    { company_id: HQ, customer_id: 'cust-member', title: '주방 싱크대 상담', status: 'active' },
  );
  const row = fake.db.consultations.find((c) => c.id === C_MEMBER);
  assert.equal(row.customer_id, 'cust-member');
  assert.equal(row.project_id, data.project_id);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.confirmed_at, WHEN);
  assert.equal(row.company_id, HQ, '회사는 그대로');
  assert.equal(fake.db.customers.length, 2, '고객 행을 더 만들지 않는다');
});

test('accept — 회원인데 본사 고객 행이 없으면 { company_id: 본사, user_id } 로 만든다', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_NEWBIE);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.created, { customer: true, project: true });
  const made = fake.db.customers.find((c) => c.id === r.json.data.customer_id);
  assert.equal(made.company_id, HQ);
  assert.equal(made.user_id, NEWBIE);
  assert.equal(made.name, undefined, '계정 고객 행에는 이름 · 연락처를 베끼지 않는다');
});

test('accept — 비회원 상담은 이름 · 연락처로 새 본사 고객 (같은 연락처 고객에 잇지 않는다, 이메일 없음)', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_GUEST);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.created, { customer: true, project: true });
  assert.notEqual(r.json.data.customer_id, 'cust-samephone');
  const insert = writes(fake).find((c) => c.method === 'POST' && c.path === '/rest/v1/customers');
  assert.deepEqual(insert.body, { company_id: HQ, name: '김고객', phone: '010-1111-2222' });
  assert.ok(!fake.calls.some((c) => c.method === 'GET' && c.path === '/rest/v1/customers'), '이름 · 연락처로 고객을 찾지 않는다');
});

test('accept — 두 번 불러도 고객 · 프로젝트가 하나뿐, 두 번째는 일정만 바뀐다', async () => {
  const fake = acceptDb();
  const first = await accept(fake, C_GUEST);
  const counts = { customers: fake.db.customers.length, projects: fake.db.projects.length };
  const later = '2026-11-05T01:00:00.000Z';
  const second = await accept(fake, C_GUEST, ADMIN, { confirmed_at: later });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.data.customer_id, first.json.data.customer_id);
  assert.equal(second.json.data.project_id, first.json.data.project_id);
  assert.deepEqual(second.json.data.created, { customer: false, project: false });
  assert.deepEqual({ customers: fake.db.customers.length, projects: fake.db.projects.length }, counts);
  assert.equal(fake.db.consultations.find((c) => c.id === C_GUEST).confirmed_at, later);
});

test('accept — 고객만 이어진 확정 상담(일정 변경)은 고객을 그대로 쓰고 프로젝트만 만든다', async () => {
  const fake = acceptDb();
  const r = await accept(fake, C_HAS_CUSTOMER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.customer_id, 'cust-member');
  assert.deepEqual(r.json.data.created, { customer: false, project: true });
  assert.ok(!fake.calls.some((c) => c.path === '/rest/v1/customers'), '고객 표를 읽지도 쓰지도 않는다');
});

test('accept — 상담 고치기는 읽은 그대로일 때만 (상태 · 연결 칸으로 거른다)', async () => {
  const fake = acceptDb();
  await accept(fake, C_GUEST);
  const patch = writes(fake).find((c) => c.method === 'PATCH' && c.path === '/rest/v1/consultations');
  assert.equal(patch.q.get('id'), `eq.${C_GUEST}`);
  assert.equal(patch.q.get('status'), 'in.(pending,confirmed)');
  assert.equal(patch.q.get('customer_id'), 'is.null');
  assert.equal(patch.q.get('project_id'), 'is.null');
  assert.deepEqual(Object.keys(patch.body).sort(), ['confirmed_at', 'customer_id', 'project_id', 'status', 'updated_at']);
});

test('accept — 그사이 다른 요청이 상담을 바꿨으면 409, 이번에 만든 프로젝트 · 비회원 고객은 지운다', async () => {
  const fake = acceptDb({ beforePatch: (table) => (table === 'consultations' ? res([]) : null) });
  const r = await accept(fake, C_GUEST);
  assert.equal(r.status, 409);
  assert.equal(fake.db.projects.length, 0);
  assert.deepEqual(fake.db.customers.map((c) => c.id).sort(), ['cust-member', 'cust-samephone']);
});

test('accept — 연출컷은 본사 것이고 프로젝트가 없을 때만 잇는다', async () => {
  const fake = acceptDb();
  fake.db.consultations.find((c) => c.id === C_MEMBER).generation_id = GEN_FREE;
  const linked = await accept(fake, C_MEMBER);
  assert.equal(fake.db.generations.find((g) => g.id === GEN_FREE).project_id, linked.json.data.project_id);

  const taken = await accept(fake, C_LINKED_GEN);
  assert.equal(taken.status, 200);
  assert.equal(fake.db.generations.find((g) => g.id === GEN_TAKEN).project_id, 'proj-other', '이미 이어진 연출컷은 그대로');

  const partner = await accept(fake, C_PARTNER_GEN);
  assert.equal(partner.status, 200);
  assert.equal(fake.db.generations.find((g) => g.id === GEN_PARTNER).project_id, null, '다른 회사 연출컷은 건드리지 않는다');

  for (const c of writes(fake).filter((w) => w.path === '/rest/v1/generations')) {
    assert.equal(c.method, 'PATCH');
    assert.equal(c.q.get('company_id'), `eq.${HQ}`);
    assert.equal(c.q.get('project_id'), 'is.null');
    assert.deepEqual(Object.keys(c.body), ['project_id']);
  }
});

test('accept — 연출컷이 없는 상담은 연출컷 표를 건드리지 않는다', async () => {
  const fake = acceptDb();
  await accept(fake, C_MEMBER);
  assert.ok(!fake.calls.some((c) => c.path === '/rest/v1/generations'));
});

// ── 내 프로젝트 ──────────────────────────────────────────────────

test('projectStage — 걸린 행 중 가장 높은 단계', () => {
  assert.deepEqual(PROJECT_STAGES, ['consult', 'render', 'design', 'quote', 'order', 'installed']);
  assert.equal(projectStage({}), 'consult');
  assert.equal(projectStage({ hasRender: true }), 'render');
  assert.equal(projectStage({ hasRender: true, hasDesign: true }), 'design');
  assert.equal(projectStage({ hasDesign: true, hasQuote: true }), 'quote');
  assert.equal(projectStage({ orders: [{ status: 'confirmed' }], hasQuote: true }), 'order');
  assert.equal(projectStage({ orders: [{ status: 'in_production' }, { status: 'completed' }] }), 'installed');
});

/** 나(MEMBER)는 본사 · 협력업체 고객 행 둘. 다른 사람(OTHER)의 프로젝트 하나 */
function myDb() {
  const P = (n, extra) => ({ id: `p-${n}`, company_id: HQ, customer_id: 'cust-me-hq', title: `프로젝트 ${n}`, status: 'active', created_at: `2026-10-0${n}T00:00:00Z`, ...extra });
  return fakeDb({
    customers: [
      { id: 'cust-me-hq', company_id: HQ, user_id: MEMBER },
      { id: 'cust-me-partner', company_id: PARTNER, user_id: MEMBER },
      { id: 'cust-other', company_id: HQ, user_id: OTHER },
    ],
    projects: [
      P(1), // 상담만
      P(2), // 연출컷
      P(3), // 설계
      P(4), // 확인서
      P(5), // 수주
      P(6, { company_id: PARTNER, customer_id: 'cust-me-partner' }), // 시공 완료
      P(7), // 설계 + 회수된 확인서 + 취소된 수주뿐 → 설계
      P(8), // 설계 + 대체된(superseded) 확인서 → 확인서
      { id: 'p-other', company_id: HQ, customer_id: 'cust-other', title: '남의 프로젝트', status: 'active', created_at: '2026-10-09T00:00:00Z' },
    ],
    generations: [{ id: 'g2', project_id: 'p-2' }, { id: 'g-other', project_id: 'p-other' }],
    designs: [
      { id: 'd3', project_id: 'p-3' },
      { id: 'd4', project_id: 'p-4' },
      { id: 'd5', project_id: 'p-5' },
      { id: 'd6', project_id: 'p-6' },
      { id: 'd7', project_id: 'p-7' },
      { id: 'd8', project_id: 'p-8' },
      { id: 'd-other', project_id: 'p-other' },
    ],
    design_documents: [
      { id: 'doc4', design_id: 'd4', doc_type: 'customer_confirmation', status: 'issued' },
      { id: 'doc3-wo', design_id: 'd3', doc_type: 'work_order', status: 'issued' },
      { id: 'doc7', design_id: 'd7', doc_type: 'customer_confirmation', status: 'revoked' },
      { id: 'doc8', design_id: 'd8', doc_type: 'customer_confirmation', status: 'superseded' },
    ],
    orders: [
      // 가장 최근 수주지만 취소 — 단계 · 최신 수주에서 빠진다
      { id: 'o5-cancelled', project_id: 'p-5', order_no: 'SO-5C', status: 'cancelled', contract_amount: 900000, received_amount: 0, ordered_at: '2026-10-25T00:00:00Z', completed_at: null, note: '내부 메모', created_at: '2026-10-25T00:00:00Z' },
      { id: 'o5', project_id: 'p-5', order_no: 'SO-5B', status: 'in_production', contract_amount: 1100000, received_amount: 500000, ordered_at: '2026-10-20T00:00:00Z', completed_at: null, note: '내부 메모', created_at: '2026-10-20T00:00:00Z' },
      { id: 'o6', project_id: 'p-6', order_no: 'SO-6', status: 'completed', contract_amount: 2000000, received_amount: 2000000, ordered_at: '2026-10-11T00:00:00Z', completed_at: '2026-10-25T00:00:00Z', note: null, created_at: '2026-10-11T00:00:00Z' },
      { id: 'o7', project_id: 'p-7', order_no: 'SO-7', status: 'cancelled', contract_amount: 700000, received_amount: 0, ordered_at: '2026-10-26T00:00:00Z', completed_at: null, created_at: '2026-10-26T00:00:00Z' },
      { id: 'o-other', project_id: 'p-other', order_no: 'SO-X', status: 'confirmed', contract_amount: 1, received_amount: 1, ordered_at: '2026-10-12T00:00:00Z', completed_at: null, created_at: '2026-10-12T00:00:00Z' },
    ],
    order_payments: [
      { id: 'pay1', order_id: 'o5', stage: 'balance', amount: 600000, due_on: '2026-11-20', paid_on: null, method: 'transfer', memo: '내부' },
      { id: 'pay2', order_id: 'o5', stage: 'deposit', amount: 500000, due_on: '2026-10-20', paid_on: '2026-10-20', method: 'card', memo: null },
      { id: 'pay-cancelled', order_id: 'o5-cancelled', stage: 'deposit', amount: 900000, due_on: '2026-10-10', paid_on: null },
      { id: 'pay7', order_id: 'o7', stage: 'deposit', amount: 700000, due_on: '2026-10-26', paid_on: null },
    ],
    design_schedules: [
      { id: 's1', design_id: 'd5', type: 'installation', status: 'cancelled', scheduled_at: '2026-11-01T00:00:00Z', assignee_name: '설치 기사' },
      { id: 's2', design_id: 'd5', type: 'installation', status: 'scheduled', scheduled_at: '2026-11-12T00:00:00Z', assignee_name: '설치 기사' },
      { id: 's3', design_id: 'd5', type: 'installation', status: 'confirmed', scheduled_at: '2026-11-15T00:00:00Z' },
      { id: 's4', design_id: 'd5', type: 'measurement', status: 'scheduled', scheduled_at: '2026-10-30T00:00:00Z' },
      { id: 's-other', design_id: 'd-other', type: 'installation', status: 'scheduled', scheduled_at: '2026-10-29T00:00:00Z' },
    ],
  });
}

test('me/projects — data 는 프로젝트 배열, 내 고객 행(회사 무관)의 프로젝트만, 최신순', async () => {
  const fake = myDb();
  const r = await call(fake, '/me/projects', MEMBER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.success, true);
  assert.ok(Array.isArray(r.json.data), 'data 는 배열 (items 로 감싸지 않는다)');
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const items = r.json.data;
  assert.deepEqual(items.map((p) => p.id), ['p-8', 'p-7', 'p-6', 'p-5', 'p-4', 'p-3', 'p-2', 'p-1']);
  const customerRead = fake.calls.find((c) => c.path === '/rest/v1/customers');
  assert.equal(customerRead.q.get('user_id'), `eq.${MEMBER}`);
  const projectRead = fake.calls.find((c) => c.path === '/rest/v1/projects');
  assert.equal(projectRead.q.get('customer_id'), 'in.(cust-me-hq,cust-me-partner)');
  assert.equal(projectRead.q.get('order'), 'created_at.desc');
  assert.equal(projectRead.q.get('limit'), '50');
  assert.equal(items.find((p) => p.id === 'p-6').company_name, '협력업체');
  assert.equal(items.find((p) => p.id === 'p-1').company_name, '다담가구');
});

test('me/projects — 단계 사다리 (상담 → 연출컷 → 설계 → 확인서 → 수주 → 시공 완료)', async () => {
  const r = await call(myDb(), '/me/projects', MEMBER);
  const stage = Object.fromEntries(r.json.data.map((p) => [p.id, p.stage]));
  assert.deepEqual(stage, {
    'p-1': 'consult', 'p-2': 'render', 'p-3': 'design', 'p-4': 'quote', 'p-5': 'order', 'p-6': 'installed',
    'p-7': 'design', // 회수된 확인서 · 취소된 수주는 세지 않는다
    'p-8': 'quote', // 대체된 확인서는 센다
  });
});

test('me/projects — 취소된 수주는 단계 · 최신 수주에서 빠진다, 남은 수주가 없으면 order null · payments []', async () => {
  const fake = myDb();
  const r = await call(fake, '/me/projects', MEMBER);
  const p5 = r.json.data.find((p) => p.id === 'p-5');
  assert.equal(p5.order.order_no, 'SO-5B', '더 최근의 취소 수주(SO-5C)가 아니라 살아 있는 수주');
  assert.ok(!p5.payments.some((x) => x.amount === 900000), '취소 수주의 수금 일정은 싣지 않는다');
  const p7 = r.json.data.find((p) => p.id === 'p-7');
  assert.equal(p7.order, null);
  assert.deepEqual(p7.payments, []);
  const orderRead = fake.calls.find((c) => c.path === '/rest/v1/orders');
  assert.equal(orderRead.q.get('status'), 'neq.cancelled');
  const paymentRead = fake.calls.find((c) => c.path === '/rest/v1/order_payments');
  assert.equal(paymentRead.q.get('order_id'), 'in.(o6,o5)', '살아 있는 최신 수주만 (프로젝트 최신순)');
});

test('me/projects — 확인서 단계는 회수(revoked) 문서를 빼고 읽는다', async () => {
  const fake = myDb();
  await call(fake, '/me/projects', MEMBER);
  const docRead = fake.calls.find((c) => c.path === '/rest/v1/design_documents');
  assert.equal(docRead.q.get('doc_type'), 'eq.customer_confirmation');
  assert.equal(docRead.q.get('status'), 'neq.revoked');
});

test('me/projects — 수주는 최신 것 하나와 그 수금 일정, 설치일은 취소 안 된 가장 이른 설치', async () => {
  const r = await call(myDb(), '/me/projects', MEMBER);
  const p5 = r.json.data.find((p) => p.id === 'p-5');
  assert.deepEqual(p5.order, { order_no: 'SO-5B', status: 'in_production', contract_amount: 1100000, ordered_at: '2026-10-20T00:00:00Z', completed_at: null });
  assert.deepEqual(p5.payments, [
    { stage: 'deposit', amount: 500000, due_on: '2026-10-20', paid_on: '2026-10-20' },
    { stage: 'balance', amount: 600000, due_on: '2026-11-20', paid_on: null },
  ]);
  assert.equal(p5.install_at, '2026-11-12T00:00:00Z');
  const p1 = r.json.data.find((p) => p.id === 'p-1');
  assert.equal(p1.order, null);
  assert.deepEqual(p1.payments, []);
  assert.equal(p1.install_at, null);
});

test('me/projects — 원가 · 마진 · 수금 합계 · 내부 메모 · 담당자는 싣지도 읽지도 않는다', async () => {
  const fake = myDb();
  const r = await call(fake, '/me/projects', MEMBER);
  for (const p of r.json.data) {
    assert.deepEqual(Object.keys(p).sort(), ['company_name', 'created_at', 'id', 'install_at', 'order', 'payments', 'stage', 'status', 'title']);
    if (p.order) assert.deepEqual(Object.keys(p.order).sort(), ['completed_at', 'contract_amount', 'order_no', 'ordered_at', 'status']);
    for (const x of p.payments) assert.deepEqual(Object.keys(x).sort(), ['amount', 'due_on', 'paid_on', 'stage']);
  }
  const text = JSON.stringify(r.json);
  for (const word of ['received_amount', 'cost', 'margin', 'memo', 'note', 'assignee', '설치 기사', '내부', 'p-other', 'SO-X']) {
    assert.ok(!text.includes(word), `${word} 없음`);
  }
  for (const c of fake.calls.filter((x) => x.path.startsWith('/rest/v1/'))) {
    assert.ok(!['/rest/v1/order_costs', '/rest/v1/rework_logs', '/rest/v1/consultations'].includes(c.path), `${c.path} 를 읽지 않는다`);
    const select = c.q.get('select') || '';
    assert.ok(select !== '*' && !/received_amount|cost|margin|memo|note|assignee/.test(select), `${c.path} select=${select}`);
    if (c.q.get('limit') === null) assert.equal(c.path, '/rest/v1/companies', `${c.path} 는 행 수 상한이 있다`);
  }
  assert.ok(fake.calls.every((c) => c.method === 'GET'), '읽기만 한다');
});

test('me/projects — 고객 행이 없거나 프로젝트가 없으면 빈 목록 (더 읽지 않는다)', async () => {
  const none = myDb();
  const a = await call(none, '/me/projects', NEWBIE);
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.data, []);
  assert.deepEqual(none.calls.filter((c) => c.path.startsWith('/rest/v1/')).map((c) => c.path), ['/rest/v1/customers']);

  const empty = fakeDb({ customers: [{ id: 'cust-x', company_id: HQ, user_id: STAFF }] });
  const b = await call(empty, '/me/projects', STAFF);
  assert.deepEqual(b.json.data, []);
  assert.deepEqual(empty.calls.filter((c) => c.path.startsWith('/rest/v1/')).map((c) => c.path), ['/rest/v1/customers', '/rest/v1/projects']);
});

test('me/projects — 로그인하지 않으면 401', async () => {
  const fake = myDb();
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const r = await worker.fetch(new Request('https://api.test/me/projects'), ENV, { waitUntil: () => {} });
    assert.equal(r.status, 401);
  } finally {
    globalThis.fetch = original;
  }
});
