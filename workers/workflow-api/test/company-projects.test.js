/**
 * 업체 고객 · 프로젝트 — src/company-projects.js 를 워커로 부른다.
 *   GET|POST /company/projects · PUT /designs/:designId/project
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { canHoldProjects, COMPANY_PROJECTS_LIMIT } from '../src/company-projects.js';
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
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const CUSTOMER = uid(31);
const ADMIN = uid(71);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const A = cid(1); // Agent
const B = cid(2); // Expert
const S = cid(3); // 멈춘 협력업체

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
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF_A2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
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
  };
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), admins: [ADMIN], ...opts });
const call = (fake, path, token, init) => callWorker(worker, fake, path, token, init);
const create = (fake, body, token = OWNER_A) =>
  call(fake, '/company/projects', token, { method: 'POST', body });
const link = (fake, designId, body, token = OWNER_A) =>
  call(fake, `/designs/${designId}/project`, token, { method: 'PUT', body });

// ── 프로젝트를 가질 수 있는 업체 ──────────────────────────────────

test('프로젝트를 가지는 업체 — 다담 공장 · active 협력업체 Expert · Agent 만', () => {
  assert.equal(canHoldProjects({ kind: 'hq', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'agent', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'expert', status: 'active' }), true);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'standard', status: 'active' }), false);
  assert.equal(canHoldProjects({ kind: 'partner', plan: 'expert', status: 'suspended' }), false);
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
