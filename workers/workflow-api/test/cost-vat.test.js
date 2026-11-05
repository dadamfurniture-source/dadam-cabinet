/**
 * 수주 원가의 부가세 · 증빙 칸 · 바꾼 사람 머리 · 13주 현금 흐름 (database/migrations/0027).
 *
 *   원가 줄 금액은 부가세 뺀 공급가. vat_amount 는 공제되는 부가세 — 안 보내면 칸을 싣지 않는다(NULL = 미기재)
 *   evidence_type 은 장부 증빙 값 그대로 (src/ledger/checks.js EVIDENCE_TYPES)
 *   원가 · 수금 줄을 쓰는 요청은 x-actor-id 머리를 싣는다 — 장부 바꾼 기록(ledger_events)의 사람
 *   13주 현금 흐름의 나갈 돈 = 공급가 + 부가세 (옛 줄은 부가세가 NULL 이라 금액 그대로)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HQ, companyRoute } from './fixtures/company.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { addCost, deleteCost } from '../src/orders.js';
import { addPayment, updatePayment, deletePayment, updateCostDates } from '../src/payments.js';
import { cashflowOf } from '../src/management/summary.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const USER = { id: 'U1' };
const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body, actor: (init.headers || {})['x-actor-id'] || null });
    const res = route(u, method, body);
    if (!res) throw new Error(`unexpected fetch ${method} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** 본사 수주 O1 — 설계 주인 U1 (원가 · 수금 권한) */
const owned = (u, method) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1', company_id: HQ, status: 'confirmed' }]);
  if (companyRoute(u)) return companyRoute(u);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1', company_id: HQ }]);
  return null;
};
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

test('원가 줄 — 부가세 · 증빙을 받고, 안 보내면 칸을 싣지 않는다(미기재). 바꾼 사람 머리', async () => {
  const route = (u, method, body) => owned(u, method) || (method === 'POST' && u.endsWith('/order_costs') ? json([{ id: 'C1', ...body }], 201) : null);
  await withFetch(route, async (calls) => {
    const { cost: row } = await addCost(ENV, { orderId: 'O1', user: USER, body: { category: 'material', amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice' } });
    assert.equal(row.vat_amount, 100000);
    assert.equal(row.evidence_type, 'tax_invoice');
    const [w] = writes(calls);
    assert.equal(w.actor, 'U1');
    assert.equal(w.body.amount, 1000000);
  });
  await withFetch(route, async (calls) => {
    await addCost(ENV, { orderId: 'O1', user: USER, body: { category: 'material', amount: 5000, vat_amount: '', evidence_type: null } });
    const [w] = writes(calls);
    assert.equal('vat_amount' in w.body, false);
    assert.equal('evidence_type' in w.body, false);
  });
  for (const bad of [{ vat_amount: -1 }, { vat_amount: 1.5 }, { vat_amount: 'abc' }, { evidence_type: 'receipt' }]) {
    await withFetch(route, async (calls) => {
      await assert.rejects(addCost(ENV, { orderId: 'O1', user: USER, body: { category: 'material', amount: 5000, ...bad } }), { statusCode: 422 }, JSON.stringify(bad));
      assert.equal(writes(calls).length, 0);
    });
  }
});

test('원가 줄 지우기 · 날짜 바꾸기, 수금 줄 넣기 · 고치기 · 지우기 — 모두 바꾼 사람 머리', async () => {
  const route = (u, method, body) => owned(u, method)
    || (method === 'GET' && u.includes('/order_costs?') ? json([{ id: 'C1', order_id: 'O1' }]) : null)
    || (method === 'GET' && u.includes('/order_payments?') ? json([{ id: 'P1', order_id: 'O1', amount: 100, paid_on: null }]) : null)
    || (method === 'DELETE' ? json([]) : null)
    || (method === 'PATCH' && u.includes('/order_costs?') ? json([{ id: 'C1', ...body }]) : null)
    || (method === 'PATCH' && u.includes('/order_payments?') ? json([{ id: 'P1', order_id: 'O1', ...body }]) : null)
    || (method === 'POST' && u.endsWith('/order_payments') ? json([{ id: 'P2', ...body }], 201) : null)
    || (method === 'PATCH' && u.includes('/orders?') ? json([{ id: 'O1' }]) : null);
  await withFetch(route, async (calls) => {
    await deleteCost(ENV, { orderId: 'O1', costId: 'C1', user: USER });
    await updateCostDates(ENV, { orderId: 'O1', costId: 'C1', user: USER, body: { spent_on: '2026-11-02' } });
    await addPayment(ENV, { orderId: 'O1', user: USER, body: { stage: 'deposit', amount: 500000, due_on: '2026-11-10' } });
    await updatePayment(ENV, { orderId: 'O1', paymentId: 'P1', user: USER, body: { paid_on: '2026-11-02' } });
    await deletePayment(ENV, { orderId: 'O1', paymentId: 'P1', user: USER });
    const money = writes(calls).filter((c) => c.url.includes('/order_costs') || c.url.includes('/order_payments'));
    assert.deepEqual(money.map((c) => `${c.method} ${c.url.includes('/order_costs') ? 'cost' : 'payment'}`), [
      'DELETE cost', 'PATCH cost', 'POST payment', 'PATCH payment', 'DELETE payment',
    ]);
    for (const c of money) assert.equal(c.actor, 'U1', `${c.method} ${c.url}`);
  });
});

test('13주 현금 흐름 — 나갈 돈은 공급가 + 부가세, 옛 줄(부가세 NULL)은 금액 그대로', () => {
  const base = { balances: [{ as_of: '2026-11-02', amount: 0 }], payments: [], orders: [], installs: new Map(), overheadMonthly: 0 };
  const c = cashflowOf({
    ...base,
    costs: [
      { amount: 1000000, vat_amount: 100000, due_on: '2026-11-05', spent_on: null },
      { amount: 500000, vat_amount: null, due_on: '2026-11-06', spent_on: null },
      { amount: 300000, vat_amount: 30000, due_on: '2026-11-04', spent_on: '2026-11-03' }, // 이미 냄
    ],
  }, '2026-11-02');
  assert.equal(c.weeks[0].outflow, 1600000);
});
