/**
 * 두 번 실행 막기 키 · 낡은 요청 막기 — AI 비서 승인 카드가 기존 주소를 부를 때 (DB 0041).
 *
 *   - POST /orders/:id/payments · /orders/:id/costs — X-Idempotency-Key 가 같으면 먼저 넣은 줄을 그대로 (200, 줄 하나)
 *   - PATCH /orders/:id expect_status — 지금 상태가 본 상태도 바꿀 상태도 아니면 409 stale, 이미 바꿀 상태면 그대로 200
 *   - PATCH /orders/:id/payments/:id expect_unpaid — 이미 받은 일정이면 같은 날은 200(그대로), 다른 날은 409 stale
 * 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';
import { HQ } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = 'c0000000-0000-4000-8000-000000000001';
const OWNER = uid(1);
const MANAGER = uid(2);
const STAFF = uid(3);
const D1 = rid(1);
const O1 = rid(11);
const P1 = rid(21);
const KEY = { 'X-Idempotency-Key': 'act:00000000-0000-4000-8000-0000000000aa' };

function fake() {
  return createFake({
    tables: {
      companies: [
        { id: HQ, kind: 'hq', name: '다담 공장', status: 'active' },
        { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      ],
      company_members: [
        { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
        { company_id: A, user_id: MANAGER, role: 'manager', status: 'active' },
        { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
      ],
      designs: [{ id: D1, company_id: A, user_id: OWNER, project_id: null }],
      orders: [
        { id: O1, company_id: A, design_id: D1, order_no: 'SO-20261101-AAAA', status: 'confirmed', contract_amount: 1000000, received_amount: 0 },
      ],
      order_payments: [{ id: P1, order_id: O1, stage: 'balance', amount: 500000, due_on: '2026-11-10', paid_on: null }],
      order_costs: [],
      order_events: [],
      counterparties: [],
    },
  });
}

const call = (f, path, token, init) => callWorker(worker, f, path, token, init);

test('수금 줄 — 같은 키는 한 번만 (두 번째 200 · 같은 줄 · reused), 키가 없으면 따로', async () => {
  const f = fake();
  const body = { stage: 'deposit', amount: 300000, paid_on: '2026-11-05' };
  const a = await call(f, `/orders/${O1}/payments`, OWNER, { method: 'POST', body, headers: KEY });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.data.reused, false);
  const b = await call(f, `/orders/${O1}/payments`, OWNER, { method: 'POST', body, headers: KEY });
  assert.equal(b.status, 200);
  assert.equal(b.json.data.reused, true);
  assert.equal(b.json.data.payment.id, a.json.data.payment.id);
  assert.equal(f.db.order_payments.filter((p) => p.stage === 'deposit').length, 1);
  assert.equal(f.db.orders[0].received_amount, 300000);
  await call(f, `/orders/${O1}/payments`, OWNER, { method: 'POST', body });
  assert.equal(f.db.order_payments.filter((p) => p.stage === 'deposit').length, 2);
  const bad = await call(f, `/orders/${O1}/payments`, OWNER, { method: 'POST', body, headers: { 'X-Idempotency-Key': 'bad key!' } });
  assert.equal(bad.status, 422);
});

test('원가 줄 — 같은 키는 한 번만 (두 번째 200 · 같은 줄), 직원은 그대로 403', async () => {
  const f = fake();
  const body = { category: 'material', amount: 120000, vat_amount: 12000, evidence_type: 'tax_invoice' };
  const a = await call(f, `/orders/${O1}/costs`, MANAGER, { method: 'POST', body, headers: KEY });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const b = await call(f, `/orders/${O1}/costs`, MANAGER, { method: 'POST', body, headers: KEY });
  assert.equal(b.status, 200);
  assert.equal(b.json.data.id, a.json.data.id);
  assert.equal(f.db.order_costs.length, 1);
  assert.equal(f.db.order_costs[0].idempotency_key, KEY['X-Idempotency-Key']);
  const staff = await call(f, `/orders/${O1}/costs`, STAFF, { method: 'POST', body, headers: KEY });
  assert.equal(staff.status, 403);
});

test('수주 상태 — expect_status 가 지금과 다르면 409 stale (바꾸지 않음), 맞으면 바꾸고, 이미 바꿀 상태면 그대로 200', async () => {
  const f = fake();
  const path = `/orders/${O1}`;
  const stale = await call(f, path, STAFF, { method: 'PATCH', body: { status: 'in_production', expect_status: 'delivered' } });
  assert.equal(stale.status, 409, JSON.stringify(stale.json));
  assert.equal(stale.json.code, 'stale');
  assert.equal(f.db.orders[0].status, 'confirmed');
  const ok = await call(f, path, STAFF, { method: 'PATCH', body: { status: 'in_production', expect_status: 'confirmed' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(f.db.orders[0].status, 'in_production');
  const events = f.db.order_events.length;
  // 끊겨 다시 보낸 승인 — 이미 제작 중이라 그대로
  const again = await call(f, path, STAFF, { method: 'PATCH', body: { status: 'in_production', expect_status: 'confirmed' } });
  assert.equal(again.status, 200);
  assert.equal(f.db.order_events.length, events);
  const bad = await call(f, path, STAFF, { method: 'PATCH', body: { status: 'delivered', expect_status: 'nope' } });
  assert.equal(bad.status, 422);
});

test('수금 받음 — expect_unpaid: 안 받은 일정이면 받음, 같은 날 다시는 200 그대로, 다른 날은 409 stale, true 만 받는다', async () => {
  const f = fake();
  const path = `/orders/${O1}/payments/${P1}`;
  const a = await call(f, path, OWNER, { method: 'PATCH', body: { paid_on: '2026-11-05', expect_unpaid: true } });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(f.db.order_payments[0].paid_on, '2026-11-05');
  assert.equal(f.db.orders[0].received_amount, 500000);
  const again = await call(f, path, OWNER, { method: 'PATCH', body: { paid_on: '2026-11-05', expect_unpaid: true } });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.payment.paid_on, '2026-11-05');
  const stale = await call(f, path, OWNER, { method: 'PATCH', body: { paid_on: '2026-11-06', expect_unpaid: true } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'stale');
  assert.equal(f.db.order_payments[0].paid_on, '2026-11-05');
  const bad = await call(f, path, OWNER, { method: 'PATCH', body: { paid_on: '2026-11-06', expect_unpaid: false } });
  assert.equal(bad.status, 422);
  // expect_unpaid 없이 고치는 예전 길은 그대로
  const plain = await call(f, path, OWNER, { method: 'PATCH', body: { paid_on: null } });
  assert.equal(plain.status, 200);
  assert.equal(f.db.order_payments[0].paid_on, null);
});
