/**
 * 받을 돈 · 낼 돈 (src/ledger/money.js) — 수주 쪽 일정을 회계 화면에서 본다.
 *
 *   - 받을 돈: 안 받은 수금 일정 · 취소 수주 뺌 · 그 업체 것만, 받을 날 순(날짜 없는 것은 끝) · 늦음 · 합계
 *   - 낼 돈: 안 낸(spent_on 없음) · 낼 날 있는 원가, 거래처 이름(없으면 적은 이름) · 공급가 + 부가세
 *   - 대표 · 실장만 (직원 403 not_money), 고객 이름은 싣지 않는다
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { receivablesOf, payablesOf, MONEY_MAX } from '../src/ledger/money.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const O = (i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const P = (i) => `0b000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const K = (i) => `0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const CP = '0d000000-0000-4000-8000-000000000001';
const mem = (user_id, role) => ({ user_id, company_id: CO, role, status: 'active' });

// ── 순수 ─────────────────────────────────────────────────

test('받을 돈 — 안 받은 것만, 받을 날 순 · 날짜 없는 것은 끝, 오늘 전이면 늦음, 합계는 전부로', () => {
  const rows = [
    { id: P(1), order_id: O(1), stage: '잔금', amount: 3200000, due_on: '2026-11-08', paid_on: null, orders: { order_no: '2610-03' } },
    { id: P(2), order_id: O(2), stage: '중도금', amount: 4500000, due_on: '2026-10-25', paid_on: null, orders: { order_no: '2609-12' } },
    { id: P(3), order_id: O(3), stage: '계약금', amount: 1000000, due_on: null, paid_on: null, orders: { order_no: '2611-01' } },
    { id: P(4), order_id: O(1), stage: '계약금', amount: 900000, due_on: '2026-10-01', paid_on: '2026-10-01', orders: { order_no: '2610-03' } },
  ];
  const r = receivablesOf(rows, '2026-11-04');
  assert.deepEqual(r.items.map((x) => [x.order_no, x.stage, x.late]), [
    ['2609-12', '중도금', true],
    ['2610-03', '잔금', false],
    ['2611-01', '계약금', false],
  ]);
  assert.deepEqual([r.count, r.total, r.late_count, r.late_total], [3, 8700000, 1, 4500000]);
  assert.equal(r.today, '2026-11-04');
  assert.ok(r.items.every((x) => !('customer_name' in x)));
  const many = Array.from({ length: MONEY_MAX + 5 }, (_, i) => ({ id: P(i), order_id: O(1), amount: 1, due_on: '2026-12-01', paid_on: null }));
  const m = receivablesOf(many, '2026-11-04');
  assert.equal(m.items.length, MONEY_MAX);
  assert.equal(m.count, MONEY_MAX + 5);
});

test('낼 돈 — 안 냈고 낼 날 있는 원가, 거래처 이름이 먼저 · 공급가 + 부가세 (부가세 모름은 null)', () => {
  const rows = [
    { id: K(1), order_id: O(1), category: 'material', vendor_name: '적은 이름', counterparty_id: CP, amount: 3800000, vat_amount: 380000, spent_on: null, due_on: '2026-11-10', orders: { order_no: '2610-03' } },
    { id: K(2), order_id: O(2), category: 'logistics', vendor_name: '마바운송', counterparty_id: null, amount: 200000, vat_amount: null, spent_on: null, due_on: '2026-11-01', orders: { order_no: '2610-21' } },
    { id: K(3), order_id: O(2), category: 'material', vendor_name: '낸 것', counterparty_id: null, amount: 5, vat_amount: 0, spent_on: '2026-11-01', due_on: '2026-11-01' },
    { id: K(4), order_id: O(2), category: 'material', vendor_name: '날짜 없음', counterparty_id: null, amount: 5, vat_amount: 0, spent_on: null, due_on: null },
  ];
  const r = payablesOf(rows, '2026-11-04', new Map([[CP, '나무상사']]));
  assert.deepEqual(r.items.map((x) => [x.vendor, x.amount, x.vat_amount, x.late]), [
    ['마바운송', 200000, null, true],
    ['나무상사', 4180000, 380000, false],
  ]);
  assert.deepEqual([r.count, r.total, r.late_count, r.late_total], [2, 4380000, 1, 200000]);
});

// ── 주소 ─────────────────────────────────────────────────

function world() {
  return createFake({
    tables: {
      companies: [{ id: CO, kind: 'partner', plan: 'expert', status: 'active' }],
      company_members: [mem(OWNER, 'owner'), mem(STAFF, 'staff')],
      orders: [
        { id: O(1), company_id: CO, order_no: '2610-03', status: 'in_production', customer_name: '김고객' },
        { id: O(2), company_id: CO, order_no: '2610-21', status: 'cancelled', customer_name: '이고객' },
        { id: O(3), company_id: CO2, order_no: '9999-01', status: 'in_production', customer_name: '남의 고객' },
      ],
      order_payments: [
        { id: P(1), order_id: O(1), stage: '잔금', amount: 3200000, due_on: '2026-11-08', paid_on: null },
        { id: P(2), order_id: O(1), stage: '계약금', amount: 900000, due_on: '2026-10-01', paid_on: '2026-10-01' },
        { id: P(3), order_id: O(2), stage: '잔금', amount: 1, due_on: '2026-11-08', paid_on: null },
        { id: P(4), order_id: O(3), stage: '잔금', amount: 2, due_on: '2026-11-08', paid_on: null },
      ],
      order_costs: [
        { id: K(1), order_id: O(1), category: 'material', description: null, vendor_name: '적은 이름', counterparty_id: CP, amount: 3800000, vat_amount: 380000, spent_on: null, due_on: '2026-11-10' },
        { id: K(2), order_id: O(1), category: 'material', description: null, vendor_name: '낸 것', counterparty_id: null, amount: 5, vat_amount: 0, spent_on: '2026-11-01', due_on: '2026-11-01' },
        { id: K(3), order_id: O(3), category: 'material', description: null, vendor_name: '남의 것', counterparty_id: null, amount: 7, vat_amount: 0, spent_on: null, due_on: '2026-11-10' },
      ],
      counterparties: [{ id: CP, company_id: CO, name: '나무상사' }],
    },
    users: { t_owner: { id: OWNER }, t_staff: { id: STAFF } },
    rpc: (name) => (name === 'company_entitled' ? 'full' : undefined),
  });
}

async function call(fake, path, token = 't_owner') {
  return withFake(fake, async () => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  });
}

test('GET /ledger/receivables — 그 업체 · 취소 안 한 수주의 안 받은 수금만, 고객 이름 없음', async () => {
  const r = await call(world(), '/ledger/receivables');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual(d.items.map((x) => [x.id, x.order_no, x.stage, x.amount]), [[P(1), '2610-03', '잔금', 3200000]]);
  assert.equal(d.level, 'full');
  assert.equal(d.viewing, false);
  assert.ok(!JSON.stringify(d).includes('고객'));
});

test('GET /ledger/payables — 안 낸 원가, 거래처 이름 · 공급가 + 부가세', async () => {
  const r = await call(world(), '/ledger/payables');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual(d.items.map((x) => [x.id, x.order_no, x.vendor, x.amount, x.supply, x.vat_amount]), [
    [K(1), '2610-03', '나무상사', 4180000, 3800000, 380000],
  ]);
  assert.equal(d.total, 4180000);
});

test('받을 돈 · 낼 돈 — 직원은 403 not_money', async () => {
  for (const path of ['/ledger/receivables', '/ledger/payables']) {
    const r = await call(world(), path, 't_staff');
    assert.equal(r.status, 403, path);
    assert.equal(r.json.code, 'not_money', path);
  }
});
