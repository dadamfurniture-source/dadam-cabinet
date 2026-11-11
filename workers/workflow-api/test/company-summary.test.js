/**
 * 업체 숫자 — src/company-summary.js
 *   GET /company/summary[?month=YYYY-MM]
 * 권한은 가짜 Supabase(test/helpers/distribution-fake.js)로 워커를 불러 보고,
 * 숫자는 가짜 fetch 로 함수를 바로 불러 본다 (설계 조인 거르기는 가짜 Supabase 가 모른다). 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { getCompanySummary, summaryMonth } from '../src/company-summary.js';
import { funnelOf, leadTimeOf } from '../src/management/summary.js';
import { createFake, callWorker, writesOf, ENV } from './helpers/distribution-fake.js';
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
const OWNER_S = uid(51);
const PLATFORM_STAFF = uid(61);
const ADMIN = uid(71);
const NOBODY = uid(90);
const PLATFORM = cid(100);
const A = cid(1);
const S = cid(3);

const NOW = Date.parse('2026-11-11T03:00:00.000Z'); // 한국 시간 2026-11-11

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: S, kind: 'partner', name: '멈춘 가구', plan: 'expert', status: 'suspended' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
    ],
  };
}

// ── 순수 ──────────────────────────────────────────────────────

test('summaryMonth — YYYY-MM 꼴이 아니면 이번 달(한국 시간)', () => {
  assert.equal(summaryMonth('2026-10', NOW), '2026-10');
  assert.equal(summaryMonth(undefined, NOW), '2026-11');
  assert.equal(summaryMonth('2026-13', NOW), '2026-11');
  assert.equal(summaryMonth('2026-1', NOW), '2026-11');
  assert.equal(summaryMonth("2026-10' or 1=1", NOW), '2026-11');
  // 한국 시간으로 달이 넘어간 때 (UTC 로는 아직 10월 31일 15시)
  assert.equal(summaryMonth(null, Date.parse('2026-10-31T15:30:00Z')), '2026-11');
});

// ── 권한 (워커) ───────────────────────────────────────────────

test('대표 · 실장만 — 직원은 403 not_manager, 구성원이 아니면 not_member, 본사 · 멈춘 업체는 not_project_company', async () => {
  const fake = createFake({ tables: tables(), admins: [ADMIN], nowMs: NOW });
  const call = (token) => callWorker(worker, fake, '/company/summary', token);
  const staff = await call(STAFF_A);
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_manager');
  for (const who of [NOBODY, ADMIN]) {
    const r = await call(who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_member');
  }
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await call(who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
  assert.equal((await call(null)).status, 401);
  // 막힌 사람에게는 숫자 재료를 읽지도 않는다
  for (const t of ['design_documents', 'orders', 'design_schedules', 'consultations'])
    assert.equal(fake.calls.some((c) => c.table === t), false, t);
  assert.deepEqual(writesOf(fake), []);
});

// ── 숫자 (가짜 fetch) ─────────────────────────────────────────

const json = (rows, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET' });
    const res = route(u);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const D1 = rid(1);
const D2 = rid(2);
const D3 = rid(3);
const DOCS = [
  // D1 — 11월 3일 처음 나가 열람 · 승인, 수주까지
  { design_id: D1, doc_type: 'customer_confirmation', status: 'approved', decision: 'approved', created_at: '2026-11-03T01:00:00Z', first_viewed_at: '2026-11-03T05:00:00Z', decided_at: '2026-11-05T01:00:00Z', reasons: null },
  // D2 — 11월 4일 처음 나가 수정 요청(금액), 고쳐 다시 냄 (답 기다림)
  { design_id: D2, doc_type: 'customer_confirmation', status: 'rejected', decision: 'rejected', created_at: '2026-11-04T01:00:00Z', first_viewed_at: '2026-11-04T03:00:00Z', decided_at: '2026-11-06T01:00:00Z', reasons: ['price'] },
  { design_id: D2, doc_type: 'customer_confirmation', status: 'issued', decision: null, created_at: '2026-11-07T01:00:00Z', first_viewed_at: null, decided_at: null, reasons: null },
  // D3 — 10월에 처음 나감 (11월 코호트가 아니다)
  { design_id: D3, doc_type: 'customer_confirmation', status: 'issued', decision: null, created_at: '2026-10-20T01:00:00Z', first_viewed_at: null, decided_at: null, reasons: null },
];
const ORDERS = [
  { design_id: D1, ordered_at: '2026-11-05T02:00:00Z', status: 'confirmed' },
  { design_id: D3, ordered_at: '2026-08-01T00:00:00Z', status: 'completed' },
];
const SCHEDULES = [
  { design_id: D3, type: 'measurement', status: 'done', scheduled_at: '2026-08-04T00:00:00Z', planned_at: '2026-08-04T00:00:00Z', completed_at: '2026-08-04T00:00:00Z' },
  { design_id: D3, type: 'manufacturing_start', status: 'done', scheduled_at: '2026-08-10T00:00:00Z', planned_at: '2026-08-10T00:00:00Z', completed_at: '2026-08-10T00:00:00Z' },
  { design_id: D3, type: 'manufacturing_end', status: 'done', scheduled_at: '2026-08-20T00:00:00Z', planned_at: '2026-08-20T00:00:00Z', completed_at: '2026-08-20T00:00:00Z' },
  { design_id: D3, type: 'installation', status: 'done', scheduled_at: '2026-08-25T00:00:00Z', planned_at: '2026-08-23T00:00:00Z', completed_at: '2026-08-25T00:00:00Z' },
];
const CONSULTS = [{ created_at: '2026-11-02T00:00:00Z' }, { created_at: '2026-11-09T00:00:00Z' }];

const route = (over = {}) => (u) => {
  if (u.includes('/company_members?')) return json([{ company_id: A, role: 'owner' }]);
  if (u.includes('/companies?')) return json([{ id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' }]);
  if (u.includes('/design_documents?')) return 'documents' in over ? over.documents : json(DOCS);
  if (u.includes('/consultations?')) return 'consultations' in over ? over.consultations : json(CONSULTS);
  if (u.includes('/orders?')) return 'orders' in over ? over.orders : json(ORDERS);
  if (u.includes('/design_schedules?')) return 'schedules' in over ? over.schedules : json(SCHEDULES);
  return null;
};
const run = (query, over) => withFetch(route(over), async (calls) => ({ out: await getCompanySummary(ENV, { user: { id: OWNER_A }, query, nowMs: NOW }), calls }));

test('숫자 — 경영 요약과 같은 함수로 센 퍼널 · 리드타임을 돌려준다', async () => {
  const { out } = await run({});
  assert.deepEqual(out.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
  assert.equal(out.month, '2026-11');
  assert.deepEqual(out.funnel, funnelOf({ documents: DOCS, consultations: CONSULTS, orders: ORDERS }, '2026-11'));
  assert.deepEqual(out.lead, leadTimeOf({ schedules: SCHEDULES, leadOrders: ORDERS }, '2026-11', '2026-11-11'));
  // 손으로 센 값 — 11월에 처음 나간 설계 둘: 둘 다 열람, 하나 승인 → 수주, 하나는 다시 내서 답 기다림
  const f = out.funnel;
  assert.deepEqual(
    [f.leads, f.issued, f.viewed, f.approved, f.ordered, f.rejected, f.pending],
    [2, 2, 2, 1, 1, 0, 1]
  );
  assert.equal(f.conversion, 50);
  assert.equal(f.avgRevisions, 1.5);
  assert.deepEqual(f.reasons.codes.map((c) => [c.code, c.count]), [['price', 1]]);
  // 반년 창 안에 설치를 끝낸 수주 하나: 수주 → 설치 24일, 처음 잡은 날보다 2일 늦음
  assert.equal(out.lead.orders, 1);
  assert.equal(out.lead.totalMedianDays, 24);
  assert.deepEqual(out.lead.install, { done: 1, onTime: 0, onTimeRate: 0, avgLateDays: 2, rescheduled: 1, overdue: 0 });
});

test('조회 — 모두 내 업체로 거른다. 금액 · 고객 · 계산 근거는 읽지 않는다', async () => {
  const { calls, out } = await run({ month: '2026-10' });
  assert.equal(out.month, '2026-10');
  const of = (t) => calls.find((c) => c.url.includes(`/${t}?`)).url;
  const docs = of('design_documents');
  assert.ok(docs.includes(`designs.company_id=eq.${A}`));
  assert.ok(docs.includes('designs!inner(company_id)'));
  assert.ok(docs.includes('doc_type=eq.customer_confirmation'));
  assert.ok(of('orders').includes(`company_id=eq.${A}`));
  assert.ok(of('consultations').includes(`company_id=eq.${A}`));
  assert.ok(of('consultations').includes('created_at=gte.2026-10-01T00:00:00+09:00'));
  assert.ok(of('design_schedules').includes(`designs.company_id=eq.${A}`));
  for (const c of calls.filter((x) => /design_documents|orders|consultations|design_schedules/.test(x.url))) {
    for (const word of ['contract_amount', 'received_amount', 'customer_name', 'phone', 'totals', 'quote_payload', 'select=*'])
      assert.equal(c.url.includes(word), false, `${word} — ${c.url.slice(0, 80)}`);
    assert.equal(c.method, 'GET');
  }
  const text = JSON.stringify(out);
  for (const word of ['customer', 'amount', 'phone', 'cost', 'margin']) assert.equal(text.includes(word), false, word);
});

test('못 읽은 재료 — 상담은 leads null, 일정은 lead null, 수주는 없는 것으로. 확인서를 못 읽으면 던진다', async () => {
  const bad = json({ message: 'boom' }, 500);
  const a = await run({}, { consultations: bad, schedules: bad, orders: bad });
  assert.equal(a.out.funnel.leads, null);
  assert.equal(a.out.lead, null);
  assert.equal(a.out.funnel.issued, 2);
  assert.equal(a.out.funnel.ordered, 0);
  await assert.rejects(run({}, { documents: bad }));
});

test('자료가 없으면 — 0 과 null 로 채운 같은 모양', async () => {
  const { out } = await run({}, { documents: json([]), consultations: json([]), orders: json([]), schedules: json([]) });
  assert.equal(out.funnel.issued, 0);
  assert.equal(out.funnel.leads, 0);
  assert.equal(out.funnel.conversion, null);
  assert.equal(out.lead.orders, 0);
  assert.equal(out.lead.totalMedianDays, null);
  assert.equal(out.lead.slowest, null);
});
