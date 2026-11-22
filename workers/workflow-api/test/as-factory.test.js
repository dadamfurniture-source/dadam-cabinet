/**
 * 영업 사원 업체 고객의 A/S 를 만든 팩토리가 바로 받는다 (src/as-requests.js · DB 0082 as_requests.handler_*).
 * 2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 — 「1번으로 처리」(① 만든 팩토리가 바로 받고 영업 사원 업체는 본다).
 *
 * 고정하는 것
 *   1) 영업 사원 업체(plan manager) 수주 + 받은 제작 의뢰 → 접수가 팩토리로 간다 (팩토리 쪽 프로젝트 담당자에게 as_request,
 *      영업 사원 업체 대표 · 실장 · 담당자에게 as_factory — 글에 내용 · 이름이 없다), 두 프로젝트 일지에 한 줄씩
 *   2) 팩토리 A/S함에 보이고 받기 · 끝을 한다 (완료 보고는 잇지 않는다)
 *   3) 영업 사원 업체 A/S함에는 「만든 팩토리가 처리」로 보이고 단추가 없다 — 받기 · 끝은 403 factory_handles
 *   4) 받은 의뢰가 없으면 · 팩토리 등급 업체면 지금처럼 수주한 업체가 받는다
 *   5) DB 0082 전 — 처리 업체 칸이 없으면 지금처럼 수주한 업체가 받는다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const M = cid(1); // 영업 사원 업체 (plan manager)
const F = cid(2); // 만든 팩토리
const E = cid(3); // 직접 만드는 팩토리 (plan expert)
const M_OWNER = uid(11);
const M_STAFF = uid(12); // 영업 사원 업체 프로젝트 담당자
const F_OWNER = uid(21);
const F_STAFF = uid(22); // 팩토리 쪽 프로젝트 담당자
const F_STAFF2 = uid(23);
const E_OWNER = uid(31);
const ME = uid(41); // 고객
const CUS = rid(1);
const CUS_E = rid(2);
const CUS_F = rid(3); // 팩토리 쪽 고객 줄 (= 영업 사원 업체)
const PM = rid(11); // 영업 사원 업체 프로젝트
const PF = rid(12); // 팩토리 쪽 프로젝트 (의뢰를 받아 생김)
const PE = rid(13); // 직접 만드는 팩토리의 프로젝트
const DM = rid(21);
const OM = rid(31); // 영업 사원 업체 수주
const OE = rid(32); // 팩토리 등급 업체의 수주
const REQ = rid(41);
const ORDER_NO = 'SO-20261123-0A01';
const BODY = '서랍이 안 닫혀요 — 김고객';

function tables({ accepted = true } = {}) {
  const project = (id, company_id, customer_id, assignee_id = null) => ({
    id,
    company_id,
    customer_id,
    title: '예시',
    status: 'active',
    created_at: '2026-11-01T00:00:00Z',
    assignee_id,
  });
  return {
    companies: [
      { id: M, kind: 'partner', name: '가나 인테리어', plan: 'manager', status: 'active' },
      { id: F, kind: 'partner', name: '다라 팩토리', plan: 'expert', status: 'active' },
      { id: E, kind: 'partner', name: '마바 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: M, user_id: M_OWNER, role: 'owner', status: 'active' },
      { company_id: M, user_id: M_STAFF, role: 'staff', status: 'active' },
      { company_id: F, user_id: F_OWNER, role: 'owner', status: 'active' },
      { company_id: F, user_id: F_STAFF, role: 'staff', status: 'active' },
      { company_id: F, user_id: F_STAFF2, role: 'staff', status: 'active' },
      { company_id: E, user_id: E_OWNER, role: 'owner', status: 'active' },
    ],
    customers: [
      { id: CUS, company_id: M, user_id: ME, name: '김고객', phone: null },
      { id: CUS_E, company_id: E, user_id: ME, name: '김고객', phone: null },
      { id: CUS_F, company_id: F, user_id: null, name: '가나 인테리어', phone: null },
    ],
    projects: [project(PM, M, CUS, M_STAFF), project(PF, F, CUS_F, F_STAFF), project(PE, E, CUS_E)],
    orders: [
      { id: OM, company_id: M, project_id: PM, design_id: DM, order_no: ORDER_NO, status: 'completed' },
      { id: OE, company_id: E, project_id: PE, design_id: null, order_no: 'SO-20261123-0E01', status: 'completed' },
    ],
    production_requests: accepted
      ? [
          {
            id: REQ,
            company_id: M,
            project_id: PM,
            design_id: DM,
            status: 'accepted',
            factory_company_id: F,
            factory_project_id: PF,
            created_at: '2026-11-10T00:00:00Z',
          },
        ]
      : [],
    as_requests: [],
    project_events: [],
  };
}

const call = (fake, path, token, opts) => callWorker(worker, fake, path, token, opts);
const file = (fake, orderId = OM) =>
  call(fake, `/me/orders/${orderId}/as-requests`, ME, { method: 'POST', body: { body: BODY } });
const box = async (fake, token) => {
  const r = await call(fake, '/company/as-requests', token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data.items;
};
const outbox = (fake, kind) => fake.db.notification_outbox.filter((n) => n.kind === kind);

test('영업 사원 업체 수주 — 접수가 만든 팩토리로 (팩토리 담당자에게 as_request, 영업 사원 업체 대표 · 담당자에게 as_factory), 두 일지에', async () => {
  const fake = createFake({ tables: tables() });
  const r = await file(fake);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const [row] = fake.db.as_requests;
  assert.deepEqual(
    [row.company_id, row.handler_company_id, row.handler_project_id, row.route, row.assignee_id],
    [M, F, PF, 'assignee', F_STAFF]
  );
  assert.deepEqual(outbox(fake, 'as_request').map((n) => [n.user_id, n.company_id]), [[F_STAFF, F]]);
  assert.deepEqual(outbox(fake, 'as_factory').map((n) => n.user_id).sort(), [M_OWNER, M_STAFF].sort());
  for (const n of fake.db.notification_outbox) {
    const text = JSON.stringify(n);
    assert.ok(!text.includes('서랍') && !text.includes('김고객') && !text.includes('다라'), text);
  }
  assert.ok(outbox(fake, 'as_factory')[0].body.includes(ORDER_NO));
  const logged = fake.db.project_events.filter((e) => e.type === 'as_requested').map((e) => [e.company_id, e.project_id]);
  assert.deepEqual(logged.sort(), [[M, PM], [F, PF]].sort());
});

test('팩토리 A/S함 — 보이고 받기 · 끝을 한다 (완료 보고는 잇지 않는다), 영업 사원 업체는 보기만 (403 factory_handles)', async () => {
  const fake = createFake({ tables: tables() });
  await file(fake);
  const id = fake.db.as_requests[0].id;
  // 팩토리 쪽
  const [fRow] = await box(fake, F_STAFF);
  assert.deepEqual([fRow.id, fRow.handled_by, fRow.handler_name, fRow.can_handle, fRow.order_no], [id, 'from_manager', null, true, ORDER_NO]);
  assert.equal((await box(fake, F_STAFF2))[0].can_handle, false, '담당자 아닌 직원은 못 한다');
  // 영업 사원 업체 쪽
  const [mRow] = await box(fake, M_OWNER);
  assert.deepEqual([mRow.id, mRow.handled_by, mRow.handler_name, mRow.can_handle], [id, 'factory', '다라 팩토리', false]);
  const no = await call(fake, `/company/as-requests/${id}/receive`, M_OWNER, { method: 'POST' });
  assert.deepEqual([no.status, no.json.code], [403, 'factory_handles']);
  // 남의 업체는 있는지도 모른다
  assert.equal((await call(fake, `/company/as-requests/${id}/receive`, E_OWNER, { method: 'POST' })).status, 404);
  // 팩토리 담당자가 받고 끝낸다
  const got = await call(fake, `/company/as-requests/${id}/receive`, F_STAFF, { method: 'POST' });
  assert.equal(got.status, 200, JSON.stringify(got.json));
  const rep = await call(fake, `/company/as-requests/${id}/done`, F_STAFF, { method: 'POST', body: { report_id: rid(99) } });
  assert.equal(rep.status, 422, '완료 보고는 잇지 않는다');
  const done = await call(fake, `/company/as-requests/${id}/done`, F_STAFF, { method: 'POST', body: {} });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(fake.db.as_requests[0].state, 'done');
  // 일지 — 팩토리 쪽은 그 사람, 영업 사원 업체 쪽은 「누가」 없이
  const recv = fake.db.project_events.filter((e) => e.type === 'as_received');
  assert.deepEqual(
    recv.map((e) => [e.project_id, e.actor_kind, e.actor_user_id || null]).sort(),
    [[PM, 'system', null], [PF, 'member', F_STAFF]].sort()
  );
});

test('받은 의뢰가 없거나 팩토리 등급 업체의 수주면 지금처럼 수주한 업체가 받는다', async () => {
  const none = createFake({ tables: tables({ accepted: false }) });
  assert.equal((await file(none)).status, 201);
  const [row] = none.db.as_requests;
  assert.deepEqual([row.company_id, row.handler_company_id || null, row.assignee_id], [M, null, M_STAFF]);
  assert.equal(outbox(none, 'as_factory').length, 0);
  assert.equal((await box(none, M_OWNER))[0].handled_by, 'mine');

  const expert = createFake({ tables: tables() });
  assert.equal((await file(expert, OE)).status, 201);
  const [e] = expert.db.as_requests;
  assert.deepEqual([e.company_id, e.handler_company_id || null], [E, null]);
});

test('DB 0082 전 — 처리 업체 칸이 없으면 지금처럼 수주한 업체가 받는다 (목록도 그 칸 없이)', async () => {
  const missing = () =>
    new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'handler_company_id' column" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  const fake = createFake({
    tables: tables(),
    before: (method, table, params, body) => {
      if (table !== 'as_requests') return null;
      if (method === 'POST' && body && 'handler_company_id' in body) return missing();
      if (method === 'GET' && /handler_company_id/.test(params.get('select') || '') ) return missing();
      if (method === 'GET' && params.has('handler_company_id')) return missing();
      return null;
    },
  });
  const r = await file(fake);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const [row] = fake.db.as_requests;
  assert.deepEqual([row.company_id, row.handler_company_id || null, row.assignee_id], [M, null, M_STAFF]);
  const items = await box(fake, M_OWNER);
  assert.deepEqual([items.length, items[0].handled_by, items[0].can_handle], [1, 'mine', true]);
  const got = await call(fake, `/company/as-requests/${row.id}/receive`, M_OWNER, { method: 'POST' });
  assert.equal(got.status, 200, JSON.stringify(got.json));
});
