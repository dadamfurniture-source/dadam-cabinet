/**
 * 다담 본사 › 업체관리 › 등록 업체 — src/hq-companies.js 를 워커로 부른다.
 *   GET /hq/companies · /hq/companies/:id/projects · /hq/companies/:id/members
 * 보는 사람은 다담 본사 active 대표 · 실장만, 고객 이름 · 전화 · 이메일은 싣지 않는다.
 * 가짜 Supabase 는 test/helpers/distribution-fake.js (자격 함수 company_entitled 는 before 로 답한다). 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { HQ_COMPANY_KINDS } from '../src/hq-companies.js';
import { createFake, callWorker, writesOf } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const P_OWNER = uid(1); // 다담 본사 대표
const P_MANAGER = uid(2); // 다담 본사 실장
const P_STAFF = uid(3); // 다담 본사 직원
const A_OWNER = uid(11);
const A_STAFF = uid(12);
const A_LEFT = uid(13);
const F_OWNER = uid(21);
const ADMIN = uid(71);

const PLATFORM = cid(100);
const A = cid(1); // Agent 협력업체
const B = cid(2); // Expert 협력업체

const at = (d) => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`;
const LEDGER = { [A]: 'full', [B]: 'none', [FACTORY]: 'full' };

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      {
        id: A,
        kind: 'partner',
        name: '가나 가구',
        plan: 'agent',
        status: 'active',
        sido: '대구광역시',
        gugun: '북구',
      },
      {
        id: B,
        kind: 'partner',
        name: '다라 주방',
        plan: 'expert',
        status: 'suspended',
        sido: '경기도',
        gugun: '성남시',
      },
    ],
    company_members: [
      {
        company_id: PLATFORM,
        user_id: P_OWNER,
        role: 'owner',
        status: 'active',
        created_at: at(1),
      },
      {
        company_id: PLATFORM,
        user_id: P_MANAGER,
        role: 'manager',
        status: 'active',
        created_at: at(2),
      },
      {
        company_id: PLATFORM,
        user_id: P_STAFF,
        role: 'staff',
        status: 'active',
        created_at: at(3),
      },
      { company_id: A, user_id: A_STAFF, role: 'staff', status: 'active', created_at: at(6) },
      { company_id: A, user_id: A_OWNER, role: 'owner', status: 'active', created_at: at(5) },
      { company_id: A, user_id: A_LEFT, role: 'staff', status: 'removed', created_at: at(4) },
      { company_id: FACTORY, user_id: F_OWNER, role: 'owner', status: 'active', created_at: at(1) },
    ],
    profiles: [
      { id: A_OWNER, name: '가대표', email: 'owner-a@example.test' },
      { id: A_STAFF, name: '나직원', email: 'staff-a@example.test' },
      { id: A_LEFT, name: '떠난이', email: 'left-a@example.test' },
    ],
    customers: [{ id: rid(1), company_id: A, name: '김고객', phone: '010-1111-2222' }],
    projects: [
      {
        id: rid(11),
        company_id: A,
        customer_id: rid(1),
        title: '싱크대',
        status: 'active',
        created_at: at(10),
        assignee_id: A_STAFF,
      },
      {
        id: rid(12),
        company_id: A,
        customer_id: rid(1),
        title: '붙박이장',
        status: 'closed',
        created_at: at(20),
        closed_at: at(25),
      },
      {
        id: rid(13),
        company_id: FACTORY,
        customer_id: null,
        title: '공장 상담',
        status: 'active',
        created_at: at(5),
      },
    ],
    designs: [{ id: rid(21), company_id: A, user_id: A_OWNER, project_id: rid(12) }],
    orders: [
      { id: rid(31), company_id: A, project_id: rid(11), status: 'in_production', order_no: 'S-1' },
    ],
    design_documents: [],
    generations: [],
  };
}

const fakeOf = () =>
  createFake({
    tables: tables(),
    admins: [ADMIN],
    before: (method, table, params, body) => {
      if (table === 'rpc/company_entitled') {
        const level =
          body && body.p_feature === 'ledger' ? LEDGER[body.p_company] || 'none' : 'none';
        return new Response(JSON.stringify(level), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return null;
    },
  });
const call = (fake, path, token) => callWorker(worker, fake, path, token);

test('목록에 드는 업체 — 다담 공장 · 협력업체 (다담 본사 자신은 빼고)', () => {
  assert.deepEqual([...HQ_COMPANY_KINDS], ['hq', 'partner']);
});

test('본사 대표 · 실장만 — 본사 직원 · 협력업체 대표 · 관리자(본사 구성원 아님) · 로그인 없음은 막는다', async () => {
  const fake = fakeOf();
  for (const who of [P_STAFF, A_OWNER, ADMIN]) {
    for (const path of [
      '/hq/companies',
      `/hq/companies/${A}/projects`,
      `/hq/companies/${A}/members`,
    ]) {
      const r = await call(fake, path, who);
      assert.equal(r.status, 403, `${who} ${path}`);
      assert.equal(r.json.code, 'not_platform');
    }
  }
  const none = await call(fake, '/hq/companies', null);
  assert.equal(none.status, 401);
  assert.deepEqual(writesOf(fake), []);
});

test('업체 목록 — 다담 공장 먼저 · 협력업체 이름 차례, 구성원 수(active) · 프로젝트 수 · 장부 자격', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/hq/companies', P_MANAGER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  assert.deepEqual(
    r.json.data.items.map((c) => [
      c.name,
      c.kind,
      c.plan,
      c.status,
      c.members,
      c.projects,
      c.ledger,
    ]),
    [
      ['다담 공장', 'hq', null, 'active', 1, 1, 'full'],
      ['가나 가구', 'partner', 'agent', 'active', 2, 2, 'full'],
      ['다라 주방', 'partner', 'expert', 'suspended', 0, 0, 'none'],
    ]
  );
  assert.deepEqual(r.json.data.items[1], {
    id: A,
    kind: 'partner',
    name: '가나 가구',
    plan: 'agent',
    status: 'active',
    sido: '대구광역시',
    gugun: '북구',
    members: 2,
    projects: 2,
    ledger: 'full',
  });
  assert.ok(!r.json.data.items.some((c) => c.id === PLATFORM), '다담 본사 자신은 없다');
});

test('업체 프로젝트 — 단계 · 수주 상태 · 설계 수 · 담당(이름 · 직책), 고객 이름 · 전화는 싣지 않는다', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/hq/companies/${A}/projects`, P_OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.company, {
    id: A,
    kind: 'partner',
    name: '가나 가구',
    plan: 'agent',
  });
  assert.deepEqual(
    r.json.data.items.map((p) => [
      p.title,
      p.status,
      p.stage,
      p.order_status,
      p.design_count,
      p.assignee,
    ]),
    [
      ['붙박이장', 'closed', 'design', null, 1, null],
      ['싱크대', 'active', 'order', 'in_production', 0, { name: '나직원', role: 'staff' }],
    ]
  );
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes('김고객') && !text.includes('010-1111-2222'), '고객 이름 · 전화 없음');
  assert.ok(!('customer' in r.json.data.items[0]));
  // 다담 공장도
  const f = await call(fake, `/hq/companies/${FACTORY}/projects`, P_OWNER);
  assert.deepEqual(
    f.json.data.items.map((p) => [p.title, p.stage]),
    [['공장 상담', 'consult']]
  );
});

test('업체 구성원 — 활동 중 먼저(대표 · 실장 · 직원 차례), 나간 사람은 뒤, 이메일은 싣지 않는다', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/hq/companies/${A}/members`, P_MANAGER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(
    r.json.data.items.map((m) => [m.name, m.role, m.status]),
    [
      ['가대표', 'owner', 'active'],
      ['나직원', 'staff', 'active'],
      ['떠난이', 'staff', 'removed'],
    ]
  );
  assert.equal(r.json.data.items[0].joined_at, at(5));
  assert.ok(!JSON.stringify(r.json).includes('@example.test'), '이메일 없음');
});

test('없는 업체 · 다담 본사 자신 · 모양이 틀린 id 는 404', async () => {
  const fake = fakeOf();
  for (const id of [PLATFORM, cid(999), 'not-a-uuid']) {
    for (const tail of ['projects', 'members']) {
      const r = await call(fake, `/hq/companies/${id}/${tail}`, P_OWNER);
      assert.equal(r.status, 404, `${id} ${tail}`);
    }
  }
});
