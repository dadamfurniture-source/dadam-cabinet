/**
 * 수금 · 지급 → 13주 현금흐름 · 미수 나이 — 경영 대시보드 2단계 PR-9.
 *
 * 일감이 달마다 0.2배~2.4배로 출렁이는 공장에는 이익보다 현금이 먼저다.
 * 수금 일정(계약금 · 중도금 · 잔금)과 지급 예정일, 통장 잔액으로 오늘부터 13주를 내다본다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, receivedOf, addPayment, updateCostDates, addCashBalance, listPayments } from '../src/payments.js';
import { cashflowOf, agingOf, buildManagementSummary } from '../src/management/summary.js';
import { clearAdminCache } from '../src/reports/admin.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const NO_TABLE = () => fail(404, { code: 'PGRST205', message: "Could not find the table 'public.order_payments' in the schema cache" });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init.method || 'GET', calls.at(-1).body);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const owned = (u, method) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1' }]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  return null;
};
beforeEach(() => clearAdminCache());

test('수금 일정 입력: 단계 · 금액은 꼭, 받기로 한 날이나 받은 날 중 하나는 있어야', () => {
  assert.deepEqual(validatePayment({ stage: 'deposit', amount: '3300000', due_on: '2026-10-01', method: 'transfer', memo: ' 계약 당일 ' }), {
    stage: 'deposit', amount: 3300000, due_on: '2026-10-01', method: 'transfer', memo: '계약 당일',
  });
  assert.throws(() => validatePayment({ stage: 'tip', amount: 1, due_on: '2026-10-01' }), /stage/);
  assert.throws(() => validatePayment({ stage: 'balance', amount: 0, due_on: '2026-10-01' }), /1원 이상/);
  assert.throws(() => validatePayment({ stage: 'balance', amount: 100 }), /하나는 적어/);
  assert.throws(() => validatePayment({ stage: 'balance', amount: 100, due_on: '10/1' }), /due_on/);
  assert.deepEqual(validatePayment({ paid_on: '2026-10-21' }, { partial: true }), { paid_on: '2026-10-21' });
  assert.deepEqual(validatePayment({ paid_on: null }, { partial: true }), { paid_on: null });
});

test('받은 합은 받은 날이 있는 것만', () => {
  assert.equal(receivedOf([{ amount: 3300000, paid_on: '2026-10-01' }, { amount: 4400000, paid_on: null }, { amount: '100', paid_on: '2026-10-02' }]), 3300100);
});

test('일정을 넣으면 수주의 수금액을 받은 합으로 맞춘다', async () => {
  await withFetch((u, method, body) => owned(u, method)
    || (method === 'POST' && u.endsWith('/order_payments') ? json([{ id: 'P2', ...body }], 201) : null)
    || (method === 'GET' && u.includes('/order_payments?') ? json([{ amount: 3300000, paid_on: '2026-10-01' }, { amount: 3300000, paid_on: null }]) : null)
    || (method === 'PATCH' && u.includes('/orders?id=eq.O1') ? json([{ id: 'O1', ...body }]) : null), async (calls) => {
    const out = await addPayment(ENV, { orderId: 'O1', user: { id: 'U1' }, body: { stage: 'interim', amount: 3300000, due_on: '2026-10-10' } });
    assert.equal(out.received, 3300000);
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { received_amount: 3300000 });
  });
});

test('표가 아직 없으면 읽기는 null, 쓰기는 SQL 안내', async () => {
  await withFetch((u) => (u.includes('/order_payments?') ? NO_TABLE() : null), async () => {
    assert.equal(await listPayments(ENV, 'O1'), null);
  });
  await withFetch((u, method) => owned(u, method) || (method === 'POST' ? NO_TABLE() : null), async () => {
    await assert.rejects(addPayment(ENV, { orderId: 'O1', user: { id: 'U1' }, body: { stage: 'deposit', amount: 1, due_on: '2026-10-01' } }), /management-phase2\.sql/);
  });
});

test('지급: 원가 줄의 낸 날 · 낼 날만 고친다 ("냈음")', async () => {
  await withFetch((u, method, body) => owned(u, method)
    || (method === 'GET' && u.includes('/order_costs?') ? json([{ id: 'C1', order_id: 'O1' }]) : null)
    || (method === 'PATCH' ? json([{ id: 'C1', ...body }]) : null), async (calls) => {
    await updateCostDates(ENV, { orderId: 'O1', costId: 'C1', user: { id: 'U1' }, body: { spent_on: '2026-10-21', amount: 1 } });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { spent_on: '2026-10-21' });
  });
});

test('통장 잔액은 관리자만, 기준일과 정수 잔액', async () => {
  await withFetch((u) => (u.includes('/admin_roles?') ? json([]) : null), async () => {
    await assert.rejects(addCashBalance(ENV, { user: { id: 'U1' }, body: { as_of: '2026-10-20', amount: 1 } }), /관리자만/);
  });
  clearAdminCache();
  await withFetch((u, method, body) => (u.includes('/admin_roles?') ? json([{ role: 'admin' }]) : method === 'POST' ? json([{ id: 'B1', ...body }], 201) : null), async () => {
    const row = await addCashBalance(ENV, { user: { id: 'U1' }, body: { as_of: '2026-10-20', amount: '-250000', memo: '마이너스 통장' } });
    assert.equal(row.amount, -250000);
    await assert.rejects(addCashBalance(ENV, { user: { id: 'U1' }, body: { as_of: '', amount: 1 } }), /기준일/);
  });
});

// ── 13주 현금흐름 · 미수 나이 (오늘 2026-10-21 수요일 → 10-19 월요일부터) ──
const TODAY = '2026-10-21';
const BALANCES = [{ as_of: '2026-10-01', amount: 3000000 }, { as_of: '2026-10-20', amount: 10000000 }];
const ORDERS = [
  { id: 'A', order_no: 'SO-1', design_id: 'dA', contract_amount: 11000000, received_amount: 3300000, status: 'confirmed' },
  { id: 'B', order_no: 'SO-2', design_id: 'dB', contract_amount: 5500000, received_amount: 0, status: 'in_production' },
  { id: 'C', order_no: 'SO-3', customer_name: '최고객', design_id: 'dC', contract_amount: 2200000, received_amount: 1000000, status: 'delivered', delivered_at: '2026-08-01T03:00:00Z' },
  { id: 'D', order_no: 'SO-4', design_id: 'dD', contract_amount: 1100000, received_amount: 0, status: 'confirmed' },
  { id: 'E', order_no: 'SO-5', design_id: 'dE', contract_amount: 9900000, received_amount: 0, status: 'cancelled' },
  { id: 'F', order_no: 'SO-6', design_id: 'dF', contract_amount: 3300000, received_amount: 3300000, status: 'completed', completed_at: '2026-09-01T03:00:00Z' },
];
const PAYMENTS = [
  { order_id: 'A', stage: 'deposit', amount: 3300000, due_on: '2026-10-01', paid_on: '2026-10-01' },
  { order_id: 'A', stage: 'interim', amount: 3300000, due_on: '2026-10-10', paid_on: null }, // 11일 밀림 → 이번 주
  { order_id: 'A', stage: 'balance', amount: 4400000, due_on: '2026-11-20', paid_on: null }, // 5번째 주
  { order_id: 'A', stage: 'other', amount: 200000, due_on: null, paid_on: null }, // 날짜 모름
  { order_id: 'A', stage: 'other', amount: 100000, due_on: '2027-03-01', paid_on: null }, // 13주 뒤
  { order_id: 'E', stage: 'other', amount: 500000, due_on: '2026-10-25', paid_on: null }, // 취소된 수주 — 빼기
];
const COSTS = [
  { amount: 920000, due_on: '2026-10-15', spent_on: null }, // 밀린 지급 → 이번 주
  { amount: 500000, due_on: '2026-10-30', spent_on: null }, // 2번째 주
  { amount: 777000, due_on: '2026-10-22', spent_on: '2026-10-20' }, // 이미 냄
  { amount: 300000, due_on: '2027-02-01', spent_on: null }, // 13주 뒤
];
const INSTALLS = new Map([['dB', '2026-11-04']]);

test('13주 현금흐름: 잔액 1,000만에서 시작, 밀린 돈은 이번 주, 일정 없는 수주는 설치일에, 고정비는 주 1,428,462', () => {
  const c = cashflowOf({ balances: BALANCES, payments: PAYMENTS, costs: COSTS, orders: ORDERS, installs: INSTALLS, overheadMonthly: 6190000 }, TODAY);
  assert.equal(c.start, '2026-10-19');
  assert.equal(c.end, '2027-01-17');
  assert.deepEqual(c.opening, { amount: 10000000, as_of: '2026-10-20', days: 1, stale: false });
  assert.equal(c.weeklyOverhead, 1428462);
  assert.equal(c.weeks.length, 13);
  assert.deepEqual(c.weeks.slice(0, 5).map((w) => [w.start, w.inflow, w.outflow, w.balance]), [
    ['2026-10-19', 4500000, 2348462, 12151538], // 중도금 330만 + C 남은 120만 / 밀린 지급 92만 + 고정비
    ['2026-10-26', 0, 1928462, 10223076], // 지급 50만 + 고정비
    ['2026-11-02', 5500000, 1428462, 14294614], // B 설치일 11-04
    ['2026-11-09', 0, 1428462, 12866152],
    ['2026-11-16', 4400000, 1428462, 15837690], // 잔금 11-20
  ]);
  assert.equal(c.weeks.at(-1).balance, 4409994); // 15,837,690 − 8 × 1,428,462
  assert.deepEqual(c.lowest, { week: 12, start: '2027-01-11', balance: 4409994 });
  assert.equal(c.firstNegative, null);
  assert.equal(c.overdueIn, 4500000);
  assert.equal(c.overdueOut, 920000);
  assert.equal(c.laterIn, 100000);
  assert.equal(c.laterOut, 300000);
  assert.equal(c.unscheduledIn, 1300000); // 날짜 모르는 일정 20만 + 설치일 없는 D 110만
  assert.equal(c.unscheduledOrders, 2);
});

test('13주 현금흐름: 잔액이 7일 넘게 묵으면 알리고, 잔액을 안 적었으면 0 에서 — 처음 마이너스가 되는 주', () => {
  const c = cashflowOf({ balances: [{ as_of: '2026-10-01', amount: 1000000 }], payments: [], costs: [], orders: [], installs: new Map(), overheadMonthly: 6190000 }, TODAY);
  assert.deepEqual(c.opening, { amount: 1000000, as_of: '2026-10-01', days: 20, stale: true });
  assert.equal(c.firstNegative, 0);
  const none = cashflowOf({ balances: [], payments: [], costs: [], orders: [], installs: new Map(), overheadMonthly: 0 }, TODAY);
  assert.equal(none.opening, null);
  assert.equal(none.weeks[0].balance, 0);
});

test('미수 나이: 밀린 돈 450만 — 30일 이내 330만 · 61~90일 120만, 기한 전 1,130만, 오래 밀린 순', () => {
  const a = agingOf({ payments: PAYMENTS, orders: ORDERS }, TODAY);
  assert.equal(a.overdue, 4500000);
  assert.equal(a.notDue, 11300000); // 잔금 440만 + 날짜 모름 20만 + 13주 뒤 10만 + B 550만 + D 110만
  assert.deepEqual(a.buckets, [
    { key: '0-30', label: '30일 이내', amount: 3300000, count: 1 },
    { key: '31-60', label: '31~60일', amount: 0, count: 0 },
    { key: '61-90', label: '61~90일', amount: 1200000, count: 1 },
    { key: '90+', label: '90일 넘음', amount: 0, count: 0 },
  ]);
  assert.deepEqual(a.top, [
    { order_id: 'C', label: '최고객 (SO-3)', stage: null, amount: 1200000, days: 81 },
    { order_id: 'A', label: 'SO-1', stage: 'interim', amount: 3300000, days: 11 },
  ]);
});

test('수금 표가 없으면(2단계 SQL 전) 둘 다 null', () => {
  assert.equal(cashflowOf({ balances: null, payments: null }, TODAY), null);
  assert.equal(agingOf({ payments: null, orders: ORDERS }, TODAY), null);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: {}, month: '2026-10', today: TODAY });
  assert.equal(s.cashflow, null);
  assert.equal(s.aging, null);
});
