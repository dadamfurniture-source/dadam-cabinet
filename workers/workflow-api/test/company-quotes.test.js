/**
 * 업체 견적 목록 — src/company-quotes.js 를 워커로 부른다.
 *   GET /company/quotes
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  quoteTotals,
  COMPANY_QUOTES_LIMIT,
  COMPANY_QUOTE_DESIGNS,
  QUOTE_DOC_TYPE,
} from '../src/company-quotes.js';
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
const STAFF_A = uid(13);
const OWNER_B = uid(21);
const OWNER_S = uid(51);
const OWNER_M = uid(52);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const ADMIN = uid(71);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const A = cid(1); // Agent
const B = cid(2); // Expert
const S = cid(3); // 멈춘 협력업체
const M = cid(4); // Manager

const CUS_A1 = rid(1);
const CUS_B1 = rid(2);
const PRJ_A1 = rid(11);
const PRJ_B1 = rid(13);
const D_A_LINKED = rid(21); // 프로젝트에 이은 A 설계
const D_A_FREE = rid(22); // 잇지 않은 A 설계
const D_B = rid(23); // B 설계
const D_F = rid(24); // 다담 공장 설계
const DOC_A1 = rid(31);
const DOC_A2 = rid(32);
const DOC_A3 = rid(33);
const DOC_A_WORK = rid(34);
const DOC_B1 = rid(35);
const DOC_F1 = rid(36);

const at = (d) => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`;

const doc = (id, designId, day, patch = {}) => ({
  id,
  design_id: designId,
  snapshot_id: rid(900),
  doc_type: 'customer_confirmation',
  rev: 1,
  doc_no: 'Q-' + id.slice(-4),
  status: 'issued',
  title: '예시 견적',
  customer_name: '원본이름',
  customer_name_masked: '김**',
  totals: { subtotal: 1000000, vat: 100000, total: 1100000 },
  render_payload: { quote: { cost: { total: 700000 }, margin_rate: 0.3 } },
  expires_at: null,
  first_viewed_at: null,
  view_count: 0,
  decision: null,
  decided_at: null,
  signer_name: null,
  superseded_by: null,
  created_at: at(day),
  ...patch,
});

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
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
    ],
    customers: [
      { id: CUS_A1, company_id: A, user_id: null, name: '김고객', phone: '010-1111-2222' },
      { id: CUS_B1, company_id: B, user_id: null, name: '이고객', phone: '010-3333-4444' },
    ],
    projects: [
      { id: PRJ_A1, company_id: A, customer_id: CUS_A1, title: '싱크대', status: 'active', created_at: at(1) },
      { id: PRJ_B1, company_id: B, customer_id: CUS_B1, title: 'B 싱크대', status: 'active', created_at: at(1) },
    ],
    designs: [
      { id: D_A_LINKED, company_id: A, user_id: OWNER_A, project_id: PRJ_A1, name: '예시 싱크대 A', updated_at: at(20) },
      { id: D_A_FREE, company_id: A, user_id: STAFF_A, project_id: null, name: null, updated_at: at(21) },
      { id: D_B, company_id: B, user_id: OWNER_B, project_id: PRJ_B1, name: 'B 설계', updated_at: at(22) },
      { id: D_F, company_id: FACTORY, user_id: FACTORY_OWNER, project_id: null, name: '공장 설계', updated_at: at(23) },
    ],
    design_documents: [
      doc(DOC_A1, D_A_LINKED, 10, {
        status: 'superseded',
        superseded_by: DOC_A2,
        first_viewed_at: at(11),
        view_count: 3,
      }),
      doc(DOC_A2, D_A_LINKED, 12, {
        rev: 2,
        status: 'approved',
        decision: 'approved',
        decided_at: at(13),
        totals: { subtotal: 2000000, vat: 200000, total: 2200000, price_tier: 'B' },
      }),
      doc(DOC_A3, D_A_FREE, 15, { status: 'revoked', totals: null, doc_no: null, title: null }),
      doc(DOC_A_WORK, D_A_LINKED, 16, { doc_type: 'work_order' }),
      doc(DOC_B1, D_B, 17),
      doc(DOC_F1, D_F, 18),
    ],
  };
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), admins: [ADMIN], ...opts });
const call = (fake, token) => callWorker(worker, fake, '/company/quotes', token);

test('상수 · quoteTotals — 고객 금액 셋만, 하나도 없으면 null', () => {
  assert.equal(QUOTE_DOC_TYPE, 'customer_confirmation');
  assert.equal(COMPANY_QUOTES_LIMIT, 200);
  assert.equal(COMPANY_QUOTE_DESIGNS, 200);
  assert.deepEqual(quoteTotals({ subtotal: 1, vat: 2, total: 3, price_tier: 'B', cost: 9 }), {
    subtotal: 1,
    vat: 2,
    total: 3,
  });
  assert.deepEqual(quoteTotals({ total: 5, vat: '1' }), { subtotal: null, vat: null, total: 5 });
  assert.equal(quoteTotals(null), null);
  assert.equal(quoteTotals([1, 2]), null);
  assert.equal(quoteTotals({ note: 'x' }), null);
});

test('구성원이 아니면 403 not_member, 다담 본사 · 멈춘 업체는 403 not_project_company', async () => {
  const fake = fakeOf();
  for (const who of [NOBODY, ADMIN]) {
    const none = await call(fake, who);
    assert.equal(none.status, 403, who);
    assert.equal(none.json.code, 'not_member');
  }
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await call(fake, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
  assert.equal((await callWorker(worker, fake, '/company/quotes', null)).status, 401);
});

test('내 업체의 고객 확인서만 새 것부터 — 직원도 본다, 캐시하지 않는다', async () => {
  const fake = fakeOf();
  const r = await call(fake, STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const d = r.json.data;
  assert.deepEqual(d.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
  // 작업지시서(DOC_A_WORK) · 다른 업체(DOC_B1 · DOC_F1) 는 없다
  assert.deepEqual(
    d.items.map((x) => x.id),
    [DOC_A3, DOC_A2, DOC_A1]
  );
  const owner = await call(fake, OWNER_A);
  assert.deepEqual(owner.json.data, d, '대표와 직원이 같은 것을 본다 (고객 금액뿐이다)');
});

test('줄마다 — 번호 · 판 · 상태 · 금액 · 설계 · 프로젝트 · 고객 이름', async () => {
  const d = (await call(fakeOf(), OWNER_A)).json.data;
  const [revoked, approved, old] = d.items;
  assert.deepEqual(approved, {
    id: DOC_A2,
    doc_no: 'Q-0032',
    rev: 2,
    status: 'approved',
    title: '예시 견적',
    created_at: at(12),
    expires_at: null,
    first_viewed_at: null,
    view_count: 0,
    decision: 'approved',
    decided_at: at(13),
    superseded: false,
    totals: { subtotal: 2000000, vat: 200000, total: 2200000 }, // price_tier 는 싣지 않는다
    design: { id: D_A_LINKED, name: '예시 싱크대 A' },
    project: { id: PRJ_A1, title: '싱크대' },
    customer_name: '김고객', // 프로젝트에 이은 설계 = 프로젝트의 고객 이름
  });
  assert.equal(old.superseded, true);
  assert.equal(old.status, 'superseded');
  assert.equal(old.first_viewed_at, at(11));
  assert.equal(old.view_count, 3);
  // 잇지 않은 설계 — 프로젝트 없음, 문서에 남은 가린 이름. 금액 · 번호 · 제목이 없으면 null
  assert.deepEqual(revoked.project, null);
  assert.equal(revoked.customer_name, '김**');
  assert.deepEqual(revoked.design, { id: D_A_FREE, name: null });
  assert.equal(revoked.totals, null);
  assert.equal(revoked.doc_no, null);
  assert.equal(revoked.title, null);
  assert.equal(revoked.status, 'revoked');
});

test('원가 · 마진 · 원본 이름 · 전화는 싣지 않는다', async () => {
  const r = await call(fakeOf(), OWNER_A);
  const text = JSON.stringify(r.json);
  for (const word of ['render_payload', 'margin_rate', 'cost', '원본이름', '010-1111-2222', 'customer_name_masked', 'snapshot_id', 'price_tier']) {
    assert.equal(text.includes(word), false, word);
  }
});

test('업체마다 자기 것만 — 다담 공장 · 다른 협력업체', async () => {
  const fake = fakeOf();
  const b = (await call(fake, OWNER_B)).json.data;
  assert.deepEqual(b.items.map((x) => x.id), [DOC_B1]);
  assert.equal(b.items[0].customer_name, '이고객');
  const f = (await call(fake, FACTORY_OWNER)).json.data;
  assert.equal(f.company.kind, 'hq');
  assert.deepEqual(f.items.map((x) => x.id), [DOC_F1]);
  assert.equal(f.items[0].project, null);
});

test('설계가 없는 업체(Manager) — 빈 목록, 문서 표는 읽지 않는다', async () => {
  const fake = fakeOf();
  const r = await call(fake, OWNER_M);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.items, []);
  assert.equal(r.json.data.company.plan, 'manager');
  assert.equal(fake.calls.some((c) => c.table === 'design_documents'), false);
});

test('읽기만 한다 — 조회는 업체로 거르고, 쓰는 요청이 없다', async () => {
  const fake = fakeOf();
  await call(fake, OWNER_A);
  assert.deepEqual(writesOf(fake), []);
  const designs = fake.calls.find((c) => c.method === 'GET' && c.table === 'designs');
  assert.equal(designs.params.get('company_id'), `eq.${A}`);
  assert.equal(designs.params.get('order'), 'updated_at.desc');
  assert.equal(designs.params.get('limit'), String(COMPANY_QUOTE_DESIGNS));
  const docs = fake.calls.find((c) => c.method === 'GET' && c.table === 'design_documents');
  assert.equal(docs.params.get('doc_type'), 'eq.customer_confirmation');
  assert.equal(docs.params.get('order'), 'created_at.desc');
  assert.equal(docs.params.get('limit'), String(COMPANY_QUOTES_LIMIT));
  assert.equal(docs.params.get('design_id'), `in.(${D_A_FREE},${D_A_LINKED})`);
  assert.equal(docs.params.get('select').includes('render_payload'), false);
  const projects = fake.calls.find((c) => c.method === 'GET' && c.table === 'projects');
  assert.equal(projects.params.get('company_id'), `eq.${A}`);
  const customers = fake.calls.find((c) => c.method === 'GET' && c.table === 'customers');
  assert.equal(customers.params.get('company_id'), `eq.${A}`);
  assert.equal(customers.params.get('select'), 'id,name');
});

test('다른 방법(POST)은 없다 — 405', async () => {
  const r = await callWorker(worker, fakeOf(), '/company/quotes', OWNER_A, { method: 'POST', body: {} });
  assert.equal(r.status, 405);
});
