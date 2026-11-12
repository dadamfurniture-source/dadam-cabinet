/**
 * 업체 고객 · 프로젝트 — src/company-projects.js 를 워커로 부른다.
 *   GET|POST /company/projects · PUT /designs/:designId/project
 *   PUT /company/projects/:id/assignee · GET /company/projects/:id/assignee-candidates (src/company-assignee.js, DB 0042)
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { canHoldProjects, COMPANY_PROJECTS_LIMIT, PROJECT_PLANS } from '../src/company-projects.js';
import { rankCandidates, CANDIDATE_DAYS } from '../src/company-assignee.js';
import { createFake, callWorker, writesOf } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER_A = uid(11);
const MANAGER_A = uid(12);
const STAFF_A = uid(13);
const STAFF_A2 = uid(14);
const OWNER_B = uid(21);
const OWNER_S = uid(51);
const OWNER_M = uid(52);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const CUSTOMER = uid(31);
const ADMIN = uid(71);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const A = cid(1); // Agent
const B = cid(2); // Expert
const S = cid(3); // 멈춘 협력업체
const M = cid(4); // Manager (DB 0047)

const CUS_A1 = rid(1);
const CUS_B1 = rid(2);
const PRJ_A1 = rid(11);
const PRJ_A2 = rid(12);
const PRJ_B1 = rid(13);
const PRJ_F1 = rid(14);
const D_A_STAFF = rid(21); // A 직원이 만든 A 설계
const D_A_ORDER = rid(22); // 수주가 생긴 A 설계
const D_HQ_CUSTOMER = rid(23); // 일반 고객이 만든 다담 공장 설계
const D_HQ_OWNER = rid(24); // 다담 공장 대표가 만든 설계

const at = (d) => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`;

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
      { id: S, kind: 'partner', name: '멈춘 가구', plan: 'expert', status: 'suspended' },
      { id: M, kind: 'partner', name: '사아 인테리어', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF_A2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
    ],
    customers: [
      { id: CUS_A1, company_id: A, user_id: null, name: '김고객', phone: '010-1111-2222' },
      { id: CUS_B1, company_id: B, user_id: null, name: '이고객', phone: null },
    ],
    projects: [
      {
        id: PRJ_A1,
        company_id: A,
        customer_id: CUS_A1,
        title: '싱크대',
        status: 'active',
        created_at: at(10),
        assignee_id: STAFF_A,
      },
      {
        id: PRJ_A2,
        company_id: A,
        customer_id: CUS_A1,
        title: '붙박이장',
        status: 'closed',
        created_at: at(20),
        closed_at: at(25),
      },
      {
        id: PRJ_B1,
        company_id: B,
        customer_id: CUS_B1,
        title: 'B 싱크대',
        status: 'active',
        created_at: at(15),
      },
      {
        id: PRJ_F1,
        company_id: FACTORY,
        customer_id: rid(3),
        title: '공장 상담',
        status: 'active',
        created_at: at(5),
      },
    ],
    designs: [
      { id: D_A_STAFF, company_id: A, user_id: STAFF_A, project_id: null },
      { id: D_A_ORDER, company_id: A, user_id: OWNER_A, project_id: PRJ_A1 },
      { id: D_HQ_CUSTOMER, company_id: FACTORY, user_id: CUSTOMER, project_id: null },
      { id: D_HQ_OWNER, company_id: FACTORY, user_id: FACTORY_OWNER, project_id: null },
      { id: rid(25), company_id: A, user_id: OWNER_A, project_id: PRJ_A2 },
      { id: rid(26), company_id: A, user_id: OWNER_A, project_id: PRJ_A2 },
    ],
    orders: [
      { id: rid(31), company_id: A, design_id: D_A_ORDER, project_id: PRJ_A1, status: 'confirmed' },
    ],
    profiles: [
      { id: OWNER_A, name: '가대표' },
      { id: MANAGER_A, name: '다실장' },
      { id: STAFF_A, name: '나직원' },
    ],
    design_schedules: [
      { id: rid(41), design_id: D_A_ORDER, type: 'installation', status: 'scheduled', scheduled_at: soon(2) },
      { id: rid(42), design_id: D_A_ORDER, type: 'delivery', status: 'scheduled', scheduled_at: soon(CANDIDATE_DAYS + 3) },
      { id: rid(43), design_id: D_A_ORDER, type: 'installation', status: 'cancelled', scheduled_at: soon(1) },
    ],
    // 단계 계산 (목록의 stage) — 시험마다 필요한 줄을 넣는다
    design_documents: [],
    generations: [],
  };
}

/** 지금부터 며칠 뒤 (일정 — 추천은 오늘부터 CANDIDATE_DAYS 일) */
function soon(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), admins: [ADMIN], ...opts });
const call = (fake, path, token, init) => callWorker(worker, fake, path, token, init);
const create = (fake, body, token = OWNER_A, headers = {}) =>
  call(fake, '/company/projects', token, { method: 'POST', body, headers });
const link = (fake, designId, body, token = OWNER_A) =>
  call(fake, `/designs/${designId}/project`, token, { method: 'PUT', body });

// ── 프로젝트를 가질 수 있는 업체 ──────────────────────────────────

test('프로젝트를 가지는 업체 — 다담 공장 · active 협력업체 Manager · Expert · Agent 만', () => {
  assert.deepEqual([...PROJECT_PLANS], ['manager', 'expert', 'agent']);
  assert.equal(canHoldProjects({ kind: 'hq', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'agent', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'expert', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'manager', status: 'active' }), true, 'Manager 부터 (DB 0047)');
  assert.equal(canHoldProjects({ kind: 'partner', plan: null, status: 'active' }), false);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'standard', status: 'active' }), false);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'expert', status: 'suspended' }), false);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'manager', status: 'suspended' }), false);
  assert.equal(canHoldProjects({ kind: 'platform', status: 'active' }), false);
  assert.equal(canHoldProjects(null), false);
});

// ── 목록 ──────────────────────────────────────────────────────

test('목록 — 구성원이 아니면 403 not_member, 다담 본사 · 멈춘 업체는 403 not_project_company', async () => {
  const fake = fakeOf();
  const none = await call(fake, '/company/projects', NOBODY);
  assert.equal(none.status, 403);
  assert.equal(none.json.code, 'not_member');
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await call(fake, '/company/projects', who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
});

test('목록 — 내 업체 프로젝트만 최신 순, 고객 이름 · 전화 · 이어진 설계 수, 직원도 본다', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/company/projects', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const d = r.json.data;
  assert.deepEqual(d.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
  assert.equal(d.can_manage, false, '직원은 만들지 못한다');
  assert.deepEqual(
    d.items.map((p) => [p.id, p.title, p.status, p.design_count]),
    [
      [PRJ_A2, '붙박이장', 'closed', 2],
      [PRJ_A1, '싱크대', 'active', 1],
    ]
  );
  assert.deepEqual(d.items[0].customer, { id: CUS_A1, name: '김고객', phone: '010-1111-2222' });
  assert.equal(d.items[0].closed_at, at(25));
  const list = fake.calls.find((c) => c.method === 'GET' && c.table === 'projects');
  assert.equal(list.params.get('limit'), String(COMPANY_PROJECTS_LIMIT));
  const owner = await call(fake, '/company/projects', OWNER_A);
  assert.equal(owner.json.data.can_manage, true);
  // 다담 공장 · Expert 업체도
  const f = await call(fake, '/company/projects', FACTORY_OWNER);
  assert.deepEqual(
    f.json.data.items.map((p) => [p.id, p.customer]),
    [[PRJ_F1, null]]
  );
  const b = await call(fake, '/company/projects', OWNER_B);
  assert.deepEqual(b.json.data.items[0].customer, { id: CUS_B1, name: '이고객', phone: null });
});

test('목록 — 프로젝트마다 단계(고객 「내 프로젝트」와 같은 계산) · 최신 수주 (취소 수주 · 거둔 확인서 · 다른 업체 수주는 빼고)', async () => {
  const fake = fakeOf();
  const D_B = rid(27);
  fake.db.designs.push({ id: D_B, company_id: B, user_id: OWNER_B, project_id: PRJ_B1 });
  fake.db.design_documents.push(
    { id: rid(51), design_id: D_B, doc_type: 'customer_confirmation', status: 'issued' },
    { id: rid(52), design_id: D_A_STAFF, doc_type: 'customer_confirmation', status: 'revoked' }
  );
  fake.db.generations.push({ id: rid(61), project_id: PRJ_F1 });
  fake.db.orders.push(
    { id: rid(32), company_id: A, project_id: PRJ_A2, status: 'cancelled', order_no: 'X-1' },
    { id: rid(33), company_id: B, project_id: PRJ_A1, status: 'completed', order_no: 'X-2' }
  );
  const a = await call(fake, '/company/projects', OWNER_A);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual(
    a.json.data.items.map((p) => [p.id, p.stage, p.order]),
    [
      [PRJ_A2, 'design', null],
      [PRJ_A1, 'order', { id: rid(31), order_no: null, status: 'confirmed' }],
    ]
  );
  const b = await call(fake, '/company/projects', OWNER_B);
  assert.deepEqual(b.json.data.items.map((p) => [p.stage, p.order]), [['quote', null]]);
  const f = await call(fake, '/company/projects', FACTORY_OWNER);
  assert.deepEqual(f.json.data.items.map((p) => [p.stage, p.order]), [['render', null]]);
  // 설치가 끝난 수주
  fake.db.orders.find((o) => o.id === rid(31)).status = 'completed';
  const done = await call(fake, '/company/projects', OWNER_A);
  assert.equal(done.json.data.items.find((p) => p.id === PRJ_A1).stage, 'installed');
  // 수주는 내 업체 것만 묻는다
  const q = fake.calls.filter((c) => c.method === 'GET' && c.table === 'orders').pop();
  assert.equal(q.params.get('company_id'), `eq.${A}`);
  assert.equal(q.params.get('status'), 'neq.cancelled');
});

test('Manager 업체도 프로젝트를 본다 · 만든다 (2026-11-08, DB 0047)', async () => {
  const fake = fakeOf();
  const list = await call(fake, '/company/projects', OWNER_M);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.deepEqual(list.json.data.company, { id: M, name: '사아 인테리어', kind: 'partner', plan: 'manager' });
  assert.deepEqual(list.json.data.items, []);
  const r = await create(fake, { title: '현관 신발장', customer: { name: '정고객', phone: '010-5555-6666' } }, OWNER_M);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(fake.db.projects.find((p) => p.id === r.json.data.project_id).company_id, M);
});

// ── 만들기 ─────────────────────────────────────────────────────

test('만들기 — 새 고객(이름 · 전화) + 프로젝트, 201 { project_id, customer_id }', async () => {
  const fake = fakeOf();
  const r = await create(fake, {
    title: '  거실장  ',
    customer: { name: ' 박고객 ', phone: ' 010-3333-4444 ' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const { project_id, customer_id } = r.json.data;
  const cus = fake.db.customers.find((c) => c.id === customer_id);
  assert.deepEqual([cus.company_id, cus.name, cus.phone], [A, '박고객', '010-3333-4444']);
  const prj = fake.db.projects.find((p) => p.id === project_id);
  assert.deepEqual(
    [prj.company_id, prj.customer_id, prj.title, prj.status],
    [A, customer_id, '거실장', 'active']
  );
  // 전화 없이도 — 실장도 만든다
  const m = await create(
    fake,
    { title: '신발장', customer: { name: '최고객', phone: '' } },
    MANAGER_A
  );
  assert.equal(m.status, 201);
  assert.equal(fake.db.customers.find((c) => c.id === m.json.data.customer_id).phone, null);
});

test('만들기 — 있는 고객(customer_id)에 새 프로젝트, 다른 업체 고객은 404', async () => {
  const fake = fakeOf();
  const r = await create(fake, { title: '두 번째', customer_id: CUS_A1 });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.customer_id, CUS_A1);
  assert.equal(fake.db.customers.length, 2, '고객 행은 새로 만들지 않는다');
  const other = await create(fake, { title: '남의 고객', customer_id: CUS_B1 });
  assert.equal(other.status, 404);
  assert.equal(writesOf(fake).filter((c) => c.table === 'projects').length, 1);
});

test('만들기 — 직원 403 not_manager, 다담 본사 · 멈춘 업체 403, 틀린 본문 422', async () => {
  const fake = fakeOf();
  const staff = await create(fake, { title: 'x', customer: { name: '고객' } }, STAFF_A);
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_manager');
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await create(fake, { title: 'x', customer: { name: '고객' } }, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
  for (const [body, field] of [
    [null, undefined],
    [{ customer: { name: '고객' } }, 'title'],
    [{ title: '   ', customer: { name: '고객' } }, 'title'],
    [{ title: 'x'.repeat(101), customer: { name: '고객' } }, 'title'],
    [{ title: 'x' }, 'customer'],
    [{ title: 'x', customer_id: CUS_A1, customer: { name: '고객' } }, 'customer'],
    [{ title: 'x', customer_id: 'nope' }, 'customer_id'],
    [{ title: 'x', customer: '고객' }, 'customer'],
    [{ title: 'x', customer: { name: '' } }, 'customer.name'],
    [{ title: 'x', customer: { name: '가'.repeat(51) } }, 'customer.name'],
    [{ title: 'x', customer: { name: '고객', phone: '전화' } }, 'customer.phone'],
    [{ title: 'x', customer: { name: '고객', phone: 1012345678 } }, 'customer.phone'],
  ]) {
    const r = await create(fake, body);
    assert.equal(r.status, 422, JSON.stringify(body));
    if (field) assert.equal(r.json.details.field, field, JSON.stringify(body));
  }
  assert.equal(writesOf(fake).length, 0);
});

test('만들기 — 프로젝트를 못 만들면 이번에 만든 고객 행을 지운다', async () => {
  const fake = fakeOf({
    before: (method, table) =>
      method === 'POST' && table === 'projects'
        ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
        : null,
  });
  const r = await create(fake, { title: 'x', customer: { name: '고객' } });
  assert.equal(r.status >= 500, true);
  assert.equal(fake.db.customers.length, 2, '만든 고객 행은 지웠다');
});

// ── 설계 잇기 ──────────────────────────────────────────────────

test('만들기 — 같은 X-Idempotency-Key 는 한 번만 (두 번째 200 · 같은 프로젝트 · 고객도 하나), 키 없으면 따로, 틀린 키 422', async () => {
  const fake = fakeOf();
  const body = { title: '거실장', customer: { name: '박고객', phone: '' } };
  const key = { 'X-Idempotency-Key': 'act:00000000-0000-4000-8000-000000000001' };
  const a = await create(fake, body, OWNER_A, key);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.data.reused, false);
  const b = await create(fake, body, OWNER_A, key);
  assert.equal(b.status, 200);
  assert.deepEqual(b.json.data, { ...a.json.data, reused: true });
  assert.equal(fake.db.projects.filter((p) => p.title === '거실장').length, 1);
  assert.equal(fake.db.customers.filter((c) => c.name === '박고객').length, 1);
  // 다른 업체는 같은 키도 따로
  const other = await create(fake, { title: '거실장', customer_id: CUS_B1 }, OWNER_B, key);
  assert.equal(other.status, 201);
  // 키가 없으면 예전처럼 부를 때마다
  await create(fake, body);
  assert.equal(fake.db.projects.filter((p) => p.title === '거실장' && p.company_id === A).length, 2);
  const bad = await create(fake, body, OWNER_A, { 'X-Idempotency-Key': 'bad key!' });
  assert.equal(bad.status, 422);
});

test('잇기 — 대표가 같은 업체 프로젝트에 잇고 풀기, 같은 값이면 쓰지 않는다', async () => {
  const fake = fakeOf();
  const r = await link(fake, D_A_STAFF, { project_id: PRJ_A1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { design_id: D_A_STAFF, project_id: PRJ_A1 });
  assert.equal(fake.db.designs.find((d) => d.id === D_A_STAFF).project_id, PRJ_A1);
  const before = writesOf(fake).length;
  const same = await link(fake, D_A_STAFF, { project_id: PRJ_A1 });
  assert.equal(same.status, 200);
  assert.equal(writesOf(fake).length, before, '같은 프로젝트면 쓰지 않는다');
  const off = await link(fake, D_A_STAFF, { project_id: null });
  assert.equal(off.status, 200);
  assert.equal(fake.db.designs.find((d) => d.id === D_A_STAFF).project_id, null);
});

test('잇기 — 설계를 만든 직원은 되고, 다른 직원 · 다른 업체는 403', async () => {
  const fake = fakeOf();
  const maker = await link(fake, D_A_STAFF, { project_id: PRJ_A1 }, STAFF_A);
  assert.equal(maker.status, 200);
  const other = await link(fake, D_A_STAFF, { project_id: PRJ_A2 }, STAFF_A2);
  assert.equal(other.status, 403);
  assert.equal(other.json.code, 'not_linker');
  const b = await link(fake, D_A_STAFF, { project_id: PRJ_A2 }, OWNER_B);
  assert.equal(b.status, 403);
  assert.equal(fake.db.designs.find((d) => d.id === D_A_STAFF).project_id, PRJ_A1);
});

test('잇기 — 다른 업체 프로젝트 · 없는 프로젝트 404, 수주가 생긴 설계 409 has_order', async () => {
  const fake = fakeOf();
  const cross = await link(fake, D_A_STAFF, { project_id: PRJ_B1 });
  assert.equal(cross.status, 404);
  const gone = await link(fake, D_A_STAFF, { project_id: rid(99) });
  assert.equal(gone.status, 404);
  const ordered = await link(fake, D_A_ORDER, { project_id: PRJ_A2 });
  assert.equal(ordered.status, 409);
  assert.equal(ordered.json.code, 'has_order');
  const unlink = await link(fake, D_A_ORDER, { project_id: null });
  assert.equal(unlink.status, 409, '풀기도 수주 전까지만');
  assert.equal(writesOf(fake).length, 0);
});

test('잇기 — 다담 공장 설계: 대표 · 관리자만, 설계를 만든 일반 고객은 403', async () => {
  const fake = fakeOf();
  const customer = await link(fake, D_HQ_CUSTOMER, { project_id: PRJ_F1 }, CUSTOMER);
  assert.equal(customer.status, 403);
  assert.equal(customer.json.code, 'not_linker');
  const owner = await link(fake, D_HQ_OWNER, { project_id: PRJ_F1 }, FACTORY_OWNER);
  assert.equal(owner.status, 200);
  const admin = await link(fake, D_HQ_CUSTOMER, { project_id: PRJ_F1 }, ADMIN);
  assert.equal(admin.status, 200);
  assert.equal(fake.db.designs.find((d) => d.id === D_HQ_CUSTOMER).project_id, PRJ_F1);
});

test('잇기 — expect_project_id: 그 사이 바뀌었으면 409 stale (쓰지 않음), 이미 바라는 프로젝트면 200, 틀린 값 422', async () => {
  const fake = fakeOf();
  const ok = await link(fake, D_A_STAFF, { project_id: PRJ_A1, expect_project_id: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // 끊겨 다시 보낸 승인 — 이미 PRJ_A1 이라 그대로 성공
  const again = await link(fake, D_A_STAFF, { project_id: PRJ_A1, expect_project_id: null });
  assert.equal(again.status, 200);
  // 카드는 「안 이은 설계」로 봤는데 지금은 PRJ_A1 — 풀지 않는다
  const before = writesOf(fake).length;
  const stale = await link(fake, D_A_STAFF, { project_id: null, expect_project_id: null });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'stale');
  assert.equal(writesOf(fake).length, before);
  assert.equal(fake.db.designs.find((d) => d.id === D_A_STAFF).project_id, PRJ_A1);
  const bad = await link(fake, D_A_STAFF, { project_id: null, expect_project_id: 'x' });
  assert.equal(bad.status, 422);
});

test('설계 목록 — 내 업체 설계만 최근 고친 순, 이은 프로젝트 · 수주 여부, 직원도 본다 · 다담 본사는 403', async () => {
  const fake = fakeOf();
  fake.db.designs.forEach((d, i) => {
    d.name = '설계 ' + (i + 1);
    d.updated_at = at(10 + i);
  });
  const r = await call(fake, '/company/designs', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.data.items;
  assert.ok(items.every((d) => fake.db.designs.find((x) => x.id === d.id).company_id === A));
  assert.deepEqual(
    items.map((d) => d.id),
    [rid(26), rid(25), D_A_ORDER, D_A_STAFF]
  );
  assert.deepEqual(items.find((d) => d.id === D_A_ORDER), {
    id: D_A_ORDER,
    name: '설계 2',
    project_id: PRJ_A1,
    created_at: null,
    updated_at: at(11),
    has_order: true,
  });
  assert.equal(items.find((d) => d.id === D_A_STAFF).has_order, false);
  const platform = await call(fake, '/company/designs', PLATFORM_STAFF);
  assert.equal(platform.status, 403);
});

test('잇기 — 틀린 본문 422, 없는 설계 404', async () => {
  const fake = fakeOf();
  for (const body of [null, {}, { project_id: 'nope' }, { project_id: 7 }]) {
    const r = await link(fake, D_A_STAFF, body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.equal(r.json.details.field, 'project_id');
  }
  assert.equal((await link(fake, rid(98), { project_id: PRJ_A1 })).status, 404);
  assert.equal((await link(fake, 'not-a-uuid', { project_id: PRJ_A1 })).status, 404);
});

// ── 담당자 (DB 0042, 2026-11-06 작업 분배 ①~④) ─────────────────────────────

test('목록 — 담당자 · 지금 구성원(역할 → 이름 차례), 직원도 본다', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/company/projects', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.assignee_ready, true);
  assert.deepEqual(d.members.map((m) => [m.user_id, m.name, m.role]), [
    [OWNER_A, '가대표', 'owner'],
    [MANAGER_A, '다실장', 'manager'],
    [STAFF_A, '나직원', 'staff'],
    [STAFF_A2, null, 'staff'],
  ]);
  const by = Object.fromEntries(d.items.map((p) => [p.id, p.assignee]));
  assert.deepEqual(by[PRJ_A1], { user_id: STAFF_A, name: '나직원', role: 'staff' });
  assert.equal(by[PRJ_A2], null);
});

test('목록 — DB 0042 전이면 담당자 없이 (assignee_ready false)', async () => {
  const fake = fakeOf({
    before: (method, table, params) =>
      method === 'GET' && table === 'projects' && String(params.get('select') || '').includes('assignee_id')
        ? new Response(JSON.stringify({ code: '42703', message: 'column projects.assignee_id does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        : null,
  });
  const r = await call(fake, '/company/projects', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.assignee_ready, false);
  assert.ok(r.json.data.items.every((p) => p.assignee === null));
});

test('담당자 정하기 — 대표 · 실장만, 지금 구성원만, 같으면 그대로, 본 담당자가 바뀌었으면 409 stale, 비우기', async () => {
  const fake = fakeOf();
  const put = (id, body, token = OWNER_A) => call(fake, `/company/projects/${id}/assignee`, token, { method: 'PUT', body });
  const ok = await put(PRJ_A2, { assignee_id: MANAGER_A });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.assignee_id, MANAGER_A);
  const row = fake.db.projects.find((p) => p.id === PRJ_A2);
  assert.deepEqual([row.assignee_id, row.assigned_by], [MANAGER_A, OWNER_A]);

  const staff = await put(PRJ_A2, { assignee_id: STAFF_A }, STAFF_A);
  assert.deepEqual([staff.status, staff.json.code], [403, 'not_manager']);
  const outsider = await put(PRJ_A2, { assignee_id: OWNER_B });
  assert.deepEqual([outsider.status, outsider.json.details && outsider.json.details.code], [422, 'not_member']);
  const other = await put(PRJ_B1, { assignee_id: OWNER_A });
  assert.equal(other.status, 404, '남의 업체 프로젝트');
  const bad = await put(PRJ_A2, { assignee: MANAGER_A });
  assert.equal(bad.status, 422);

  const writes = fake.calls.filter((c) => c.method === 'PATCH' && c.table === 'projects').length;
  const same = await put(PRJ_A2, { assignee_id: MANAGER_A, expect_assignee_id: null }, MANAGER_A);
  assert.equal(same.status, 200, '이미 그 사람이면 그대로 성공');
  assert.equal(fake.calls.filter((c) => c.method === 'PATCH' && c.table === 'projects').length, writes, '쓰지 않는다');
  const stale = await put(PRJ_A2, { assignee_id: STAFF_A, expect_assignee_id: null });
  assert.deepEqual([stale.status, stale.json.code], [409, 'stale']);
  const moved = await put(PRJ_A2, { assignee_id: STAFF_A, expect_assignee_id: MANAGER_A });
  assert.equal(moved.status, 200);
  const cleared = await put(PRJ_A2, { assignee_id: null });
  assert.equal(cleared.status, 200);
  assert.equal(fake.db.projects.find((p) => p.id === PRJ_A2).assignee_id, null);
});

test('담당자 후보 — 진행 중 담당이 적은 사람 → 이레 안 일정이 적은 사람 → 이름(없으면 뒤), 대표 · 실장만', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/company/projects/${PRJ_A2}/assignee-candidates`, MANAGER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual([d.project_id, d.assignee_id, d.days], [PRJ_A2, null, CANDIDATE_DAYS]);
  assert.deepEqual(d.candidates.map((c) => [c.user_id, c.active_projects, c.week_schedules]), [
    [OWNER_A, 0, 0],
    [MANAGER_A, 0, 0],
    [STAFF_A2, 0, 0],
    [STAFF_A, 1, 1],
  ]);
  const staff = await call(fake, `/company/projects/${PRJ_A2}/assignee-candidates`, STAFF_A);
  assert.deepEqual([staff.status, staff.json.code], [403, 'not_manager']);
});

test('추천 차례 (순수) — 담당 수 → 일정 수 → 이름', () => {
  const members = [
    { user_id: 'u1', name: '다', role: 'staff' },
    { user_id: 'u2', name: '가', role: 'staff' },
    { user_id: 'u3', name: '나', role: 'owner' },
  ];
  const projects = [{ id: 'p1', assignee_id: 'u2' }, { id: 'p2', assignee_id: 'u1' }];
  const designs = [{ id: 'd1', project_id: 'p1' }, { id: 'd2', project_id: 'p2' }];
  const schedules = [{ design_id: 'd1' }, { design_id: 'd1' }];
  assert.deepEqual(rankCandidates(members, projects, schedules, designs).map((c) => [c.user_id, c.active_projects, c.week_schedules]), [
    ['u3', 0, 0],
    ['u1', 1, 0],
    ['u2', 1, 2],
  ]);
});
