/**
 * 업체 고객 — src/company-customers.js 를 워커로 부른다.
 *   GET /company/customers · PATCH /company/customers/:id
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { customerPatch, COMPANY_CUSTOMERS_LIMIT } from '../src/company-customers.js';
import { CUSTOMER_NAME_MAX } from '../src/company-projects.js';
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
const OWNER_B = uid(21);
const OWNER_S = uid(51);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const APP_CUSTOMER = uid(31);
const ADMIN = uid(71);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const S = cid(3);

const CUS_A1 = rid(1);
const CUS_A2 = rid(2);
const CUS_A3 = rid(3);
const CUS_B1 = rid(4);
const PRJ_A1 = rid(11);
const PRJ_A2 = rid(12);
const PRJ_B1 = rid(13);

const at = (d) => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`;
const NOW = Date.parse('2026-11-11T03:00:00.000Z');

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
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
    ],
    customers: [
      { id: CUS_A1, company_id: A, user_id: null, name: '김고객', phone: '010-1111-2222', created_at: at(1), updated_at: at(1) },
      { id: CUS_A2, company_id: A, user_id: APP_CUSTOMER, name: '박고객', phone: null, created_at: at(5), updated_at: at(5) },
      { id: CUS_A3, company_id: A, user_id: null, name: null, phone: null, created_at: at(3), updated_at: at(3) },
      { id: CUS_B1, company_id: B, user_id: null, name: '이고객', phone: '010-3333-4444', created_at: at(2), updated_at: at(2) },
    ],
    projects: [
      { id: PRJ_A1, company_id: A, customer_id: CUS_A1, title: '싱크대', status: 'active', created_at: at(10) },
      { id: PRJ_A2, company_id: A, customer_id: CUS_A1, title: null, status: 'closed', created_at: at(20) },
      { id: PRJ_B1, company_id: B, customer_id: CUS_B1, title: 'B 싱크대', status: 'active', created_at: at(15) },
    ],
    designs: [],
    design_documents: [],
  };
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), admins: [ADMIN], nowMs: NOW, ...opts });
const list = (fake, token) => callWorker(worker, fake, '/company/customers', token);
const patch = (fake, id, body, token = OWNER_A) =>
  callWorker(worker, fake, `/company/customers/${id}`, token, { method: 'PATCH', body });

// ── 순수 함수 ─────────────────────────────────────────────────

test('customerPatch — 이름 · 전화 가운데 온 것만, 전화는 비우면 지운다', () => {
  assert.deepEqual(customerPatch({ name: '  새이름 ' }), { name: '새이름' });
  assert.deepEqual(customerPatch({ phone: ' 010-1234-5678 ' }), { phone: '010-1234-5678' });
  assert.deepEqual(customerPatch({ name: '가', phone: null }), { name: '가', phone: null });
  assert.deepEqual(customerPatch({ phone: '  ' }), { phone: null });
  assert.deepEqual(customerPatch({ name: '가', company_id: 'x', user_id: 'y', id: 'z' }), { name: '가' }, '다른 칸은 버린다');
  for (const bad of [null, [], 'x', {}, { memo: 'x' }]) assert.throws(() => customerPatch(bad), /name|JSON/);
  assert.throws(() => customerPatch({ name: '   ' }), /name 이 필요/);
  assert.throws(() => customerPatch({ name: 3 }), /name 이 필요/);
  assert.throws(() => customerPatch({ name: '가'.repeat(CUSTOMER_NAME_MAX + 1) }), /자까지/);
  assert.doesNotThrow(() => customerPatch({ name: '가'.repeat(CUSTOMER_NAME_MAX) }));
  for (const bad of ['abc', '010', '010 1234 5678', '+82-10-1234-5678', 1012345678, {}])
    assert.throws(() => customerPatch({ phone: bad }), /전화는/, String(bad));
});

// ── 목록 ──────────────────────────────────────────────────────

test('목록 — 구성원이 아니면 403 not_member, 다담 본사 · 멈춘 업체는 403 not_project_company', async () => {
  const fake = fakeOf();
  for (const who of [NOBODY, ADMIN, APP_CUSTOMER]) {
    const r = await list(fake, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_member');
  }
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await list(fake, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
  assert.equal((await callWorker(worker, fake, '/company/customers', null)).status, 401);
});

test('목록 — 내 업체 고객만 새 고객부터, 프로젝트를 붙인다. 직원도 본다 (고치지는 못한다)', async () => {
  const fake = fakeOf();
  const r = await list(fake, STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const d = r.json.data;
  assert.deepEqual(d.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
  assert.equal(d.can_manage, false);
  assert.deepEqual(d.items, [
    { id: CUS_A2, name: '박고객', phone: null, app_user: true, created_at: at(5), updated_at: at(5), projects: [] },
    { id: CUS_A3, name: null, phone: null, app_user: false, created_at: at(3), updated_at: at(3), projects: [] },
    {
      id: CUS_A1,
      name: '김고객',
      phone: '010-1111-2222',
      app_user: false,
      created_at: at(1),
      updated_at: at(1),
      projects: [
        { id: PRJ_A2, title: null, status: 'closed', created_at: at(20) },
        { id: PRJ_A1, title: '싱크대', status: 'active', created_at: at(10) },
      ],
    },
  ]);
  assert.equal(JSON.stringify(r.json).includes(APP_CUSTOMER), false, '고객의 앱 계정 id 는 싣지 않는다');
  for (const who of [OWNER_A, MANAGER_A]) assert.equal((await list(fake, who)).json.data.can_manage, true);
  assert.deepEqual(writesOf(fake), []);
});

test('목록 — 조회는 업체로 거른다. 고객이 없으면 프로젝트 표는 읽지 않는다', async () => {
  const fake = fakeOf();
  await list(fake, OWNER_A);
  const customers = fake.calls.find((c) => c.method === 'GET' && c.table === 'customers');
  assert.equal(customers.params.get('company_id'), `eq.${A}`);
  assert.equal(customers.params.get('order'), 'created_at.desc');
  assert.equal(customers.params.get('limit'), String(COMPANY_CUSTOMERS_LIMIT));
  const projects = fake.calls.find((c) => c.method === 'GET' && c.table === 'projects');
  assert.equal(projects.params.get('company_id'), `eq.${A}`);

  const b = (await list(fake, OWNER_B)).json.data;
  assert.deepEqual(b.items.map((c) => c.id), [CUS_B1]);

  const empty = fakeOf();
  const f = await list(empty, FACTORY_OWNER);
  assert.equal(f.status, 200);
  assert.deepEqual(f.json.data.items, []);
  assert.equal(empty.calls.some((c) => c.table === 'projects'), false);
});

// ── 고치기 ────────────────────────────────────────────────────

test('고치기 — 대표 · 실장만. 직원은 403 not_manager, 아무것도 쓰지 않는다', async () => {
  const fake = fakeOf();
  const r = await patch(fake, CUS_A1, { name: '새이름' }, STAFF_A);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'not_manager');
  for (const who of [NOBODY, ADMIN]) assert.equal((await patch(fake, CUS_A1, { name: 'x' }, who)).status, 403, who);
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const x = await patch(fake, CUS_A1, { name: 'x' }, who);
    assert.equal(x.status, 403, who);
    assert.equal(x.json.code, 'not_project_company');
  }
  assert.deepEqual(writesOf(fake), []);
});

test('고치기 — 이름 · 전화를 바꾸고 고친 줄을 돌려준다. 업체 · 계정 연결은 건드리지 않는다', async () => {
  const fake = fakeOf();
  const r = await patch(fake, CUS_A2, { name: ' 박새이름 ', phone: '010-9999-0000', company_id: B, user_id: null }, MANAGER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const { updated_at: touched, ...saved } = r.json.data;
  assert.deepEqual(saved, { id: CUS_A2, name: '박새이름', phone: '010-9999-0000' });
  assert.ok(Date.parse(touched) > Date.parse(at(5)), '고친 때를 새로 적는다');
  const writes = writesOf(fake);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].table, 'customers');
  assert.equal(writes[0].params.get('id'), `eq.${CUS_A2}`);
  assert.equal(writes[0].params.get('company_id'), `eq.${A}`, '내 업체 줄로만 고친다');
  assert.deepEqual(Object.keys(writes[0].body).sort(), ['name', 'phone', 'updated_at']);
  const row = fake.db.customers.find((c) => c.id === CUS_A2);
  assert.equal(row.company_id, A);
  assert.equal(row.user_id, APP_CUSTOMER);
  assert.equal(row.name, '박새이름');
  // 목록에도 바로 보인다
  const again = (await list(fake, OWNER_A)).json.data.items.find((c) => c.id === CUS_A2);
  assert.equal(again.phone, '010-9999-0000');
});

test('고치기 — 한 칸만 보내면 그 칸만. 전화는 null · 빈 글로 지운다', async () => {
  const fake = fakeOf();
  const a = await patch(fake, CUS_A1, { phone: null });
  assert.equal(a.status, 200);
  assert.deepEqual([a.json.data.name, a.json.data.phone], ['김고객', null]);
  const b = await patch(fake, CUS_A1, { name: '김바뀜' });
  assert.deepEqual([b.json.data.name, b.json.data.phone], ['김바뀜', null]);
  const c = await patch(fake, CUS_A3, { phone: '053-123-4567' });
  assert.deepEqual([c.json.data.name, c.json.data.phone], [null, '053-123-4567']);
});

test('고치기 — 다른 업체 고객 · 없는 고객 · 이상한 id 는 404, 쓰지 않는다', async () => {
  const fake = fakeOf();
  for (const id of [CUS_B1, rid(999), 'not-a-uuid']) {
    const r = await patch(fake, id, { name: '남의고객' });
    assert.equal(r.status, 404, id);
  }
  assert.deepEqual(writesOf(fake), []);
  assert.equal(fake.db.customers.find((c) => c.id === CUS_B1).name, '이고객');
});

test('고치기 — 틀린 본문은 422, 어느 칸인지 알려 주고 쓰지 않는다', async () => {
  const fake = fakeOf();
  const cases = [
    [{}, 'name'],
    [{ memo: 'x' }, 'name'],
    [{ name: '  ' }, 'name'],
    [{ name: '가'.repeat(CUSTOMER_NAME_MAX + 1) }, 'name'],
    [{ phone: 'abc' }, 'phone'],
    [{ name: '가', phone: '010' }, 'phone'],
  ];
  for (const [body, field] of cases) {
    const r = await patch(fake, CUS_A1, body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.equal(r.json.details.field, field, JSON.stringify(body));
  }
  assert.deepEqual(writesOf(fake), []);
});

test('다른 방법(POST · DELETE)은 없다 — 고객을 지우는 길은 만들지 않았다', async () => {
  const fake = fakeOf();
  const del = await callWorker(worker, fake, `/company/customers/${CUS_A1}`, OWNER_A, { method: 'DELETE' });
  assert.ok([404, 405].includes(del.status), String(del.status));
  const post = await callWorker(worker, fake, '/company/customers', OWNER_A, { method: 'POST', body: { name: 'x' } });
  assert.ok([404, 405].includes(post.status), String(post.status));
  assert.deepEqual(writesOf(fake), []);
});
