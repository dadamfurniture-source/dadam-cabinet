/**
 * 수주 구분 — 고객 · 거래처 (2026-10-19 대표: 수주에 거래처 칸).
 *
 * 같은 원가라도 거래처에는 × 1.1, 고객에게는 × 1.2 로 판다. 지금까지는 계약금이 거래처 견적과
 * 1,000원 안이면 거래처로 짐작했다. 이제 수주의 price_tier 칸이 정본이고, 칸이 비었거나
 * 아직 DB 에 없을 때(database/orders-price-tier.sql 실행 전)만 그 짐작으로 돌아간다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierOf, createOrderFromDocument, listOrders, updateOrder } from '../src/orders.js';
import { summarizeMonth } from '../src/production/service.js';
import { scenarioBase } from '../src/management/summary.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
// PostgREST 가 모르는 칸을 받았을 때의 응답
const NO_COLUMN = () => fail(400, { code: '42703', message: 'column orders.price_tier does not exist' });

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

const QUOTE = { partner: { total: 1100000 }, cost: { total: 1000000, fixed_recovery: 0 } };

test('구분: 수주에 적힌 구분이 정본 — 계약금이 거래처 견적과 달라도 거래처', () => {
  assert.equal(tierOf({ price_tier: 'partner', contract_amount: 1050000 }, QUOTE), 'partner');
  assert.equal(tierOf({ price_tier: 'customer', contract_amount: 1100000 }, QUOTE), 'customer');
});

test('구분: 칸이 비었거나 없으면 예전 짐작 — 계약금이 거래처 견적과 1,000원 안이면 거래처', () => {
  assert.equal(tierOf({ price_tier: null, contract_amount: 1100500 }, QUOTE), 'partner');
  assert.equal(tierOf({ contract_amount: 1050000 }, QUOTE), 'customer');
  assert.equal(tierOf({ contract_amount: 1100000 }, { cost: {} }), 'customer'); // 거래처 견적이 없는 옛 스냅샷
  assert.equal(tierOf({ price_tier: 'weird', contract_amount: 1100000 }, QUOTE), 'partner');
});

const DOC = (tier) => ({
  id: 'DOC1', design_id: 'D1', snapshot_id: 'S1', doc_type: 'customer_confirmation', decision: 'approved', customer_name: '김고객',
  totals: { subtotal: 1000000, vat: 100000, total: 1100000, ...(tier ? { price_tier: tier } : {}) },
});
const createRoute = (doc, { missing = false } = {}) => (u, method, body) => {
  if (method === 'GET' && u.includes('/design_documents?')) return json([doc]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  if (method === 'GET' && u.includes('/orders?')) return json([]);
  if (method === 'POST' && u.endsWith('/orders')) return missing && 'price_tier' in body ? NO_COLUMN() : json([{ id: 'O1', ...body }], 201);
  return null;
};

test('수주 만들기: 거래처용 확인서면 거래처, 고객용이면 고객으로 넣는다', async () => {
  await withFetch(createRoute(DOC('partner')), async (calls) => {
    const { order } = await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: 'U1' } });
    assert.equal(order.price_tier, 'partner');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  });
  await withFetch(createRoute(DOC(null)), async () => {
    const { order } = await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: 'U1' } });
    assert.equal(order.price_tier, 'customer');
  });
});

test('수주 만들기: 구분 칸이 아직 DB 에 없어도 수주는 막히지 않는다 — 칸만 빼고 다시 넣는다', async () => {
  await withFetch(createRoute(DOC('partner'), { missing: true }), async (calls) => {
    const { order, reused } = await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: 'U1' } });
    assert.equal(reused, false);
    assert.equal(order.id, 'O1');
    assert.equal(order.price_tier, undefined);
    const posts = calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.equal(posts[1].body.contract_amount, 1100000);
  });
});

test('수주 목록: 구분 칸까지 읽고, 칸이 없으면 빼고 다시 읽는다', async () => {
  const route = (missing) => (u, method) => {
    if (u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
    if (method === 'GET' && u.includes('/orders?')) {
      if (u.includes('price_tier')) return missing ? NO_COLUMN() : json([{ id: 'O1', price_tier: 'partner' }]);
      return json([{ id: 'O1' }]);
    }
    return null;
  };
  await withFetch(route(false), async () => {
    assert.deepEqual(await listOrders(ENV, { user: { id: 'U1' }, designId: 'D1' }), [{ id: 'O1', price_tier: 'partner' }]);
  });
  await withFetch(route(true), async () => {
    assert.deepEqual(await listOrders(ENV, { user: { id: 'U1' }, designId: 'D1' }), [{ id: 'O1' }]);
  });
});

const updateRoute = (missing) => (u, method, body) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1', status: 'confirmed' }]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  if (method === 'PATCH' && u.includes('/orders?')) return missing ? NO_COLUMN() : json([{ id: 'O1', ...body }]);
  return null;
};

test('수주 고치기: 구분을 바꾼다 · 모르는 값은 거절', async () => {
  await withFetch(updateRoute(false), async (calls) => {
    const o = await updateOrder(ENV, { orderId: 'O1', user: { id: 'U1' }, patch: { price_tier: 'partner' } });
    assert.equal(o.price_tier, 'partner');
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { price_tier: 'partner' });
    await assert.rejects(updateOrder(ENV, { orderId: 'O1', user: { id: 'U1' }, patch: { price_tier: 'vip' } }), /customer, partner/);
  });
});

test('수주 고치기: 칸이 아직 없으면 SQL 을 실행하라고 알려 준다', async () => {
  await withFetch(updateRoute(true), async () => {
    await assert.rejects(
      updateOrder(ENV, { orderId: 'O1', user: { id: 'U1' }, patch: { price_tier: 'partner' } }),
      /orders-price-tier\.sql/,
    );
  });
});

// ── 월 손익 · 경영 대시보드가 같은 구분을 쓴다 ──
const SNAPS = new Map([['s1', { quote_payload: QUOTE }]]);
const at = '2026-10-05T01:00:00Z';

test('월 손익: 깎아 준 거래처 주문도 칸이 거래처면 거래처로 센다', () => {
  const orders = [
    { id: 'A', order_no: 'SO-1', snapshot_id: 's1', contract_amount: 1050000, status: 'confirmed', ordered_at: at, price_tier: 'partner' },
    { id: 'B', order_no: 'SO-2', snapshot_id: 's1', contract_amount: 1050000, status: 'confirmed', ordered_at: at },
  ];
  const rows = summarizeMonth(orders, SNAPS, { month: '2026-10', overheadMonthly: 0 }).rows;
  assert.deepEqual(rows.map((r) => [r.id, r.tier]), [['A', 'partner'], ['B', 'customer']]);
});

test('만약에 판: 거래처 매출도 같은 구분으로 나눈다', () => {
  const orders = [
    { id: 'A', snapshot_id: 's1', contract_amount: 1100000, status: 'confirmed', ordered_at: at, price_tier: 'partner' },
    { id: 'B', snapshot_id: 's1', contract_amount: 1100000, status: 'confirmed', ordered_at: at, price_tier: 'customer' },
  ];
  const b = scenarioBase(orders, SNAPS, {}, '2026-10');
  assert.equal(b.revenuePartner, 1000000);
  assert.equal(b.revenueCustomer, 1000000);
});
