/**
 * 거래처 · 공급처 — 경영 대시보드 2단계 PR-8 (11 거래처 파레토 · 16 외주 성적표).
 *
 * 장부용이라 관리자만 만들고 본다. 수주에는 거래처를, 원가 줄에는 공급처를 붙인다.
 * 대시보드는 한 해 창으로 업체별 매출 · 공헌이익(파레토)과 공급처별 지출 · 입고 약속(성적표)을 낸다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCounterparty, listCounterparties, createCounterparty, updateCounterparty, assertCounterparty,
  SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_LABEL,
} from '../src/counterparties.js';
import { updateOrder, addCost } from '../src/orders.js';
import { updateReportMeta } from '../src/reports/service.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { partnersOf, suppliersOf, buildManagementSummary } from '../src/management/summary.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const NO_TABLE = () => fail(404, { code: 'PGRST205', message: "Could not find the table 'public.counterparties' in the schema cache" });
const P1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';

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
const admin = (yes) => (u) => (u.includes('/admin_roles?') ? json(yes ? [{ role: 'admin' }] : []) : null);
beforeEach(() => clearAdminCache());

test('입력: 종류 · 이름은 꼭, 공급처 갈래는 정해진 것만, 거래처에는 갈래가 없다', () => {
  assert.deepEqual(validateCounterparty({ kind: 'supplier', name: ' 상일 ', category: 'door', phone: '010-1', memo: '' }), {
    kind: 'supplier', name: '상일', category: 'door', phone: '010-1', memo: null,
  });
  assert.deepEqual(validateCounterparty({ kind: 'partner', name: '한빛인테리어', category: 'door' }), { kind: 'partner', name: '한빛인테리어', category: null });
  assert.throws(() => validateCounterparty({ kind: 'vip', name: 'x' }), /kind/);
  assert.throws(() => validateCounterparty({ kind: 'partner', name: '  ' }), /이름/);
  assert.throws(() => validateCounterparty({ kind: 'supplier', name: 'x', category: 'paint' }), /갈래/);
  assert.deepEqual(validateCounterparty({ active: false }, { partial: true }), { active: false });
  for (const c of SUPPLIER_CATEGORIES) assert.ok(SUPPLIER_CATEGORY_LABEL[c], c);
});

test('관리자만 — 아니면 403, 표가 아직 없으면 목록은 null', async () => {
  await withFetch(admin(false), async () => {
    await assert.rejects(listCounterparties(ENV, { user: { id: 'U1' } }), /관리자만/);
  });
  clearAdminCache();
  await withFetch((u) => admin(true)(u) || (u.includes('/counterparties?') ? NO_TABLE() : null), async () => {
    assert.deepEqual(await listCounterparties(ENV, { user: { id: 'U1' } }), { items: null });
  });
});

test('만들기: 같은 이름이면 알아듣게, 표가 없으면 SQL 안내 · 고치기는 종류를 바꾸지 않는다', async () => {
  await withFetch((u, method) => admin(true)(u) || (method === 'POST' ? fail(409, { code: '23505', message: 'duplicate key value violates unique constraint' }) : null), async () => {
    await assert.rejects(createCounterparty(ENV, { user: { id: 'U1' }, body: { kind: 'partner', name: '한빛' } }), /같은 이름이 이미 있습니다/);
  });
  clearAdminCache();
  await withFetch((u, method) => admin(true)(u) || (method === 'POST' ? NO_TABLE() : null), async () => {
    await assert.rejects(createCounterparty(ENV, { user: { id: 'U1' }, body: { kind: 'partner', name: '한빛' } }), /management-phase2\.sql/);
  });
  clearAdminCache();
  await withFetch((u, method, body) => admin(true)(u) || (method === 'PATCH' ? json([{ id: P1, kind: 'partner', ...body }]) : null), async (calls) => {
    await updateCounterparty(ENV, { user: { id: 'U1' }, id: P1, body: { kind: 'supplier', name: '한빛2', active: false } });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { name: '한빛2', active: false });
  });
});

test('붙이기: 종류가 맞아야 한다 — 거래처 칸에 공급처를 붙이지 못한다', async () => {
  await withFetch((u) => (u.includes('/counterparties?') ? json([{ id: S1, kind: 'supplier', name: '상일' }]) : null), async () => {
    await assert.rejects(assertCounterparty(ENV, S1, 'partner'), /거래처를 다시 골라/);
    assert.deepEqual(await assertCounterparty(ENV, S1, 'supplier'), { id: S1, kind: 'supplier', name: '상일' });
  });
  assert.equal(await assertCounterparty(ENV, null, 'partner'), null);
  await assert.rejects(assertCounterparty(ENV, 'not-a-uuid', 'partner'), /다시 골라/);
});

const owned = (u, method) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1', status: 'confirmed' }]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  return null;
};

test('수주에 거래처 붙이기 · 떼기', async () => {
  await withFetch((u, method, body) => owned(u, method)
    || (u.includes('/counterparties?') ? json([{ id: P1, kind: 'partner', name: '한빛' }]) : null)
    || (method === 'PATCH' ? json([{ id: 'O1', ...body }]) : null), async (calls) => {
    await updateOrder(ENV, { orderId: 'O1', user: { id: 'U1' }, patch: { partner_id: P1 } });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { partner_id: P1 });
  });
  await withFetch((u, method, body) => owned(u, method) || (method === 'PATCH' ? json([{ id: 'O1', ...body }]) : null), async (calls) => {
    await updateOrder(ENV, { orderId: 'O1', user: { id: 'U1' }, patch: { partner_id: null, price_tier: 'customer' } });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { price_tier: 'customer', partner_id: null });
  });
});

test('원가 줄에 공급처를 고르면 이름도 그 공급처로 맞춘다', async () => {
  await withFetch((u, method, body) => owned(u, method)
    || (u.includes('/counterparties?') ? json([{ id: S1, kind: 'supplier', name: '상일' }]) : null)
    || (method === 'POST' && u.endsWith('/order_costs') ? json([{ id: 'C1', ...body }], 201) : null), async () => {
    const row = await addCost(ENV, { orderId: 'O1', user: { id: 'U1' }, body: { category: 'outsourcing', amount: 920000, vendor_name: '상일도어?', counterparty_id: S1 } });
    assert.equal(row.counterparty_id, S1);
    assert.equal(row.vendor_name, '상일');
  });
});

test('외주 발주를 입고로 바꾸면 입고한 날을 남기고, 되돌리면 지운다', async () => {
  const route = (status, metrics) => (u, method, body) => {
    if (u.includes('/admin_roles?')) return json([{ role: 'admin' }]);
    if (method === 'GET' && u.includes('/work_reports?')) return json([{ id: 'R1', owner_id: 'U1', kind: 'outsource_order', status, metrics }]);
    if (method === 'PATCH') return json([{ id: 'R1', ...body }]);
    return null;
  };
  await withFetch(route('ordered', { vendor: '상일', pack: 'door' }), async (calls) => {
    await updateReportMeta(ENV, { user: { id: 'U1' }, id: P1, body: { status: 'received' } });
    const m = calls.find((c) => c.method === 'PATCH').body.metrics;
    assert.equal(m.vendor, '상일');
    assert.match(m.received_on, /^\d{4}-\d{2}-\d{2}$/);
  });
  clearAdminCache();
  await withFetch(route('received', { vendor: '상일', received_on: '2026-10-10' }), async (calls) => {
    await updateReportMeta(ENV, { user: { id: 'U1' }, id: P1, body: { status: 'ordered' } });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body.metrics, { vendor: '상일' });
  });
});

// ── 대시보드 ──
const CPS = [
  { id: 'pA', kind: 'partner', name: '한빛인테리어' },
  { id: 'pB', kind: 'partner', name: '다온디자인' },
  { id: 'pC', kind: 'partner', name: '소담' },
  { id: 'sDoor', kind: 'supplier', name: '상일', category: 'door' },
  { id: 'sTop', kind: 'supplier', name: '대리석공방', category: 'countertop' },
];
const SNAPS = new Map([
  ['k1', { quote_payload: { cost: { total: 3000000, fixed_recovery: 0 } } }],
  ['k2', { quote_payload: { cost: { total: 1000000, fixed_recovery: 100000 } } }],
]);
const P_ORDERS = [
  { id: 'o1', partner_id: 'pA', price_tier: 'partner', contract_amount: 4400000, snapshot_id: 'k1', status: 'confirmed', ordered_at: '2026-03-10T01:00:00Z' }, // 400만, 원가 300만
  { id: 'o2', partner_id: 'pA', price_tier: 'partner', contract_amount: 2200000, snapshot_id: null, status: 'completed', ordered_at: '2026-09-10T01:00:00Z' }, // 200만, 원가 모름
  { id: 'o3', partner_id: 'pB', price_tier: 'partner', contract_amount: 1100000, snapshot_id: 'k2', status: 'confirmed', ordered_at: '2026-10-02T01:00:00Z' }, // 100만, 원가 90만
  { id: 'o4', partner_id: 'pC', price_tier: 'partner', contract_amount: 1100000, snapshot_id: null, status: 'cancelled', ordered_at: '2026-10-03T01:00:00Z' }, // 취소
  { id: 'o5', partner_id: 'pC', price_tier: 'partner', contract_amount: 9900000, snapshot_id: null, status: 'confirmed', ordered_at: '2025-09-01T01:00:00Z' }, // 한 해 밖
  { id: 'o6', partner_id: null, price_tier: 'partner', contract_amount: 1100000, snapshot_id: null, status: 'confirmed', ordered_at: '2026-10-05T01:00:00Z' }, // 업체 안 붙임
];

test('거래처 파레토: 한빛 600만(한 해 매출 86%) · 다온 100만, 상위 20%(1곳)가 85.7%, 업체 안 붙인 거래처 수주 1', () => {
  const p = partnersOf({ partnerOrders: P_ORDERS, snapshotsById: SNAPS, counterparties: CPS }, '2026-10');
  assert.deepEqual(p.window, { days: 365, start: '2025-11-01', end: '2026-10-31' });
  assert.equal(p.partners, 2);
  assert.equal(p.revenue, 7000000);
  assert.deepEqual(p.rows, [
    { id: 'pA', name: '한빛인테리어', orders: 2, revenue: 6000000, contribution: 1000000, cmRate: 25, share: 85.7, cumShare: 85.7 },
    { id: 'pB', name: '다온디자인', orders: 1, revenue: 1000000, contribution: 100000, cmRate: 10, share: 14.3, cumShare: 100 },
  ]);
  assert.deepEqual(p.top20, { count: 1, share: 85.7 });
  assert.equal(p.unassigned, 1);
});

const COSTS = [
  { counterparty_id: 'sDoor', amount: 920000, spent_on: '2026-10-05', created_at: '2026-10-05T01:00:00Z' },
  { counterparty_id: 'sDoor', amount: 460000, spent_on: null, created_at: '2026-09-01T01:00:00Z' },
  { counterparty_id: 'sTop', amount: 500000, spent_on: '2025-05-01', created_at: '2026-01-01T01:00:00Z' }, // 낸 날이 한 해 밖
  { counterparty_id: 'gone', amount: 1, spent_on: '2026-10-01', created_at: '2026-10-01T01:00:00Z' }, // 지운 공급처
];
const OUTSOURCE = [
  { status: 'received', period_start: '2026-09-01', period_end: '2026-09-05', metrics: { vendor: '상일', received_on: '2026-09-05' } }, // 지킴
  { status: 'received', period_start: '2026-09-10', period_end: '2026-09-12', metrics: { vendor: '상일', received_on: '2026-09-15' } }, // 3일 늦음
  { status: 'received', period_start: '2026-08-01', period_end: '2026-08-04', metrics: { vendor: '상일' } }, // 예전 입고 — 날짜 없음
  { status: 'ordered', period_start: '2026-10-10', period_end: '2026-10-14', metrics: { vendor: '상일' } }, // 밀림 (오늘 10-19)
  { status: 'cancelled', period_start: '2026-10-11', period_end: '2026-10-15', metrics: { vendor: '상일' } },
  { status: 'ordered', period_start: '2026-10-12', period_end: '2026-10-20', metrics: { vendor: '일성합판' } }, // 장부에 없는 업체도 줄로
];

test('공급처 성적표: 상일 지출 138만 · 발주 4 · 약속 지킴 50%(날짜 있는 2건) · 늦은 날 3일 · 밀림 1, 장부 밖 업체도 한 줄', () => {
  const s = suppliersOf({ supplierCosts: COSTS, outsource: OUTSOURCE, counterparties: CPS }, '2026-10', '2026-10-19');
  assert.deepEqual(s.window, { days: 365, start: '2025-10-20', end: '2026-10-19' });
  assert.equal(s.suppliers, 2);
  assert.deepEqual(s.rows, [
    { id: 'sDoor', name: '상일', category: 'door', spend: 1380000, costRows: 2, orders: 4, onTimeRate: 50, dated: 2, avgLateDays: 3, overdue: 1 },
    { id: null, name: '일성합판', category: null, spend: 0, costRows: 0, orders: 1, onTimeRate: null, dated: 0, avgLateDays: null, overdue: 0 },
  ]);
});

test('표가 없으면(2단계 SQL 전) 둘 다 null', () => {
  assert.equal(partnersOf({ partnerOrders: P_ORDERS, snapshotsById: SNAPS, counterparties: null }, '2026-10'), null);
  assert.equal(suppliersOf({ supplierCosts: [], outsource: [], counterparties: null }, '2026-10'), null);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: {}, month: '2026-10' });
  assert.equal(s.partners, null);
  assert.equal(s.suppliers, null);
});
