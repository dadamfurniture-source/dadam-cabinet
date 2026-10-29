/**
 * 업체(회사) 단위 접근 · 보고.
 *
 * 이 워커는 service_role 로 읽어 RLS 가 걸리지 않는다 — 누가 어느 설계 · 수주를 보는지는 워커가 정한다.
 *   a. 설계 업체의 active 구성원 — 설계 · 견적 · 문서 · 수주(상태 · 계약금)는 누구나,
 *      원가 · 마진 · 수금 · 재작업 비용은 owner · manager 만
 *   b. 본사 설계를 만든 사람 (예전 규칙, 원가 · 수금 포함)
 *   c. 관리자는 본사 설계만 — 협력업체 설계는 못 본다
 * 본사 Slack · 경영 대시보드 · 생산 계획은 본사 일만 다룬다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertDesignAccess, clearHqCompanyCache, hqCompanyId, DbError } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { createOrderFromDocument, listOrders, listOwnHqOrders } from '../src/orders.js';
import { getDocumentForOwner, documentForViewer } from '../src/documents.js';
import { getSnapshot, getSnapshotForViewer, quoteForViewer } from '../src/snapshots.js';
import { createSchedules } from '../src/schedules.js';
import { getManagementSummary, hqByOrder, hqByDesign } from '../src/management/service.js';
import worker from '../src/worker.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' };
const OTHER_PARTNER = 'f0000000-0000-4000-8000-0000000000cc';

const CREATOR = 'u-creator';
const ADMIN = 'u-admin';
const P_OWNER = 'u-p-owner';
const P_MANAGER = 'u-p-manager';
const P_STAFF = 'u-p-staff';
const P_REMOVED = 'u-p-removed';
const HQ_STAFF = 'u-hq-staff';
const STRANGER = 'u-stranger';
const OTHER_OWNER = 'u-other-owner';

const MEMBERS = [
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: P_MANAGER, company_id: PARTNER, role: 'manager', status: 'active' },
  { user_id: P_STAFF, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: P_REMOVED, company_id: PARTNER, role: 'owner', status: 'removed' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
  { user_id: OTHER_OWNER, company_id: OTHER_PARTNER, role: 'owner', status: 'active' },
];

const DESIGNS = {
  'd-hq': { id: 'd-hq', user_id: CREATOR, company_id: HQ, project_id: null, title: '본사 설계' },
  'd-p': { id: 'd-p', user_id: P_STAFF, company_id: PARTNER, project_id: 'proj-1', title: '협력업체 설계' },
};

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

/** 가짜 PostgREST — 설계 · 구성원 · 관리자 + 부르는 쪽이 더하는 route */
function baseRoute({ hq = HQ, extra = () => null } = {}) {
  return (u, method, body) => {
    const company = companyRoute(u, { hq, members: MEMBERS });
    if (company) return company;
    if (u.includes('/admin_roles?')) return json(u.includes(`user_id=eq.${ADMIN}`) ? [{ role: 'admin' }] : []);
    const more = extra(u, method, body);
    if (more) return more;
    if (method === 'GET' && u.includes('/designs?id=eq.')) {
      const id = new URL(u).searchParams.get('id').replace(/^eq\./, '');
      return json(DESIGNS[id] ? [DESIGNS[id]] : []);
    }
    return null;
  };
}

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
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

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const allowed = (designId, userId, money) => assertDesignAccess(ENV, designId, { id: userId }, { money });
const forbidden = (designId, userId, money) => assert.rejects(allowed(designId, userId, money), (e) => e.statusCode === 403);

// ── 접근 규칙 ────────────────────────────────────────────────────

test('본사 설계를 만든 사람 — 구성원이 아니어도 원가 · 수금까지 (예전 규칙 그대로)', async () => {
  await withFetch(baseRoute(), async (calls) => {
    assert.equal((await allowed('d-hq', CREATOR, true)).id, 'd-hq');
    assert.equal((await allowed('d-hq', CREATOR, false)).id, 'd-hq');
    // 주인이면 구성원 · 관리자 표를 읽지 않는다
    assert.ok(!calls.some((c) => c.url.includes('/company_members?') || c.url.includes('/admin_roles?')));
  });
});

test('협력업체 구성원 — owner · manager 는 원가 · 수금까지, staff 는 원가 · 수금 없는 경로만', async () => {
  await withFetch(baseRoute(), async () => {
    assert.equal((await allowed('d-p', P_OWNER, true)).id, 'd-p');
    assert.equal((await allowed('d-p', P_MANAGER, true)).id, 'd-p');
    assert.equal((await allowed('d-p', P_STAFF, false)).id, 'd-p');
    await forbidden('d-p', P_STAFF, true);
  });
});

test('설계를 만든 staff 라도 협력업체 설계의 원가 · 수금은 못 본다 — 주인 규칙은 본사 설계만', async () => {
  // d-p 의 user_id 는 P_STAFF
  await withFetch(baseRoute(), async () => {
    await forbidden('d-p', P_STAFF, true);
  });
});

test('구성원에서 빠진(removed) 사람 · 다른 업체 구성원 · 모르는 사람은 403', async () => {
  await withFetch(baseRoute(), async (calls) => {
    await forbidden('d-p', P_REMOVED, false);
    await forbidden('d-p', OTHER_OWNER, false);
    await forbidden('d-p', STRANGER, false);
    await forbidden('d-hq', STRANGER, false);
    await forbidden('d-hq', P_OWNER, false);
    // 구성원은 active 만 읽는다
    assert.ok(calls.filter((c) => c.url.includes('/company_members?')).every((c) => c.url.includes('status=eq.active')));
  });
});

test('본사 구성원 — 본사 설계 전부, 원가 · 수금은 역할대로', async () => {
  await withFetch(baseRoute(), async () => {
    assert.equal((await allowed('d-hq', HQ_STAFF, false)).id, 'd-hq');
    await forbidden('d-hq', HQ_STAFF, true);
  });
});

test('관리자 — 본사 설계는 원가 · 수금까지, 협력업체 설계는 못 본다', async () => {
  await withFetch(baseRoute(), async () => {
    assert.equal((await allowed('d-hq', ADMIN, true)).id, 'd-hq');
    await forbidden('d-p', ADMIN, false);
    await forbidden('d-p', ADMIN, true);
  });
});

test('없는 설계는 404', async () => {
  await withFetch(baseRoute(), async () => {
    await assert.rejects(allowed('d-none', CREATOR, false), (e) => e.statusCode === 404);
  });
});

test('본사 행을 못 찾으면 던진다 — 대신할 값이 없다, 다음 호출은 다시 읽는다', async () => {
  await withFetch(baseRoute({ hq: null }), async () => {
    await assert.rejects(allowed('d-hq', CREATOR, false), (e) => e instanceof DbError && /본사/.test(e.message));
    await assert.rejects(hqCompanyId(ENV), DbError);
  });
  await withFetch(baseRoute(), async () => {
    assert.equal((await allowed('d-hq', CREATOR, false)).id, 'd-hq');
  });
});

test('본사 id 는 한 번만 읽는다 (격리 캐시)', async () => {
  await withFetch(baseRoute(), async (calls) => {
    await allowed('d-hq', CREATOR, false);
    await allowed('d-p', P_OWNER, true);
    await allowed('d-hq', ADMIN, true);
    assert.equal(calls.filter((c) => c.url.includes('/companies?')).length, 1);
    assert.ok(calls.find((c) => c.url.includes('/companies?')).url.includes('kind=eq.hq'));
  });
});

// ── 수주 ─────────────────────────────────────────────────────────

const approvedDoc = (designId) => ({
  id: 'DOC1', design_id: designId, snapshot_id: 'S1', doc_type: 'customer_confirmation', decision: 'approved', customer_name: '김고객',
  totals: { subtotal: 1000000, vat: 100000, total: 1100000 },
});

function orderCreateRoute(designId) {
  return baseRoute({
    extra: (u, method, body) => {
      if (method === 'GET' && u.includes('/design_documents?')) return json([approvedDoc(designId)]);
      if (method === 'GET' && u.includes('/orders?')) return json([]);
      if (method === 'POST' && u.endsWith('/orders')) return json([{ id: 'O-new', received_amount: 0, ...body }], 201);
      return null;
    },
  });
}

test('수주 만들기 — 업체 · 프로젝트를 설계에서 그대로 옮긴다', async () => {
  await withFetch(orderCreateRoute('d-p'), async (calls) => {
    const { order } = await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: P_OWNER } });
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.company_id, PARTNER);
    assert.equal(post.project_id, 'proj-1');
    assert.equal(order.company_id, PARTNER);
    assert.equal(order.received_amount, 0, '대표는 수금액까지');
  });
  await withFetch(orderCreateRoute('d-hq'), async (calls) => {
    await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: CREATOR } });
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.company_id, HQ);
    assert.equal(post.project_id, null);
  });
});

test('수주 만들기 — staff 도 만든다 (상태 · 계약금은 보고, 수금액은 빠진다)', async () => {
  await withFetch(orderCreateRoute('d-p'), async (calls) => {
    const { order } = await createOrderFromDocument(ENV, { documentId: 'DOC1', user: { id: P_STAFF } });
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
    assert.equal(order.contract_amount, 1100000);
    assert.equal(order.status, 'confirmed');
    assert.ok(!('received_amount' in order));
  });
});

/** 수주 목록 가짜 — 내가 만든 본사 설계 · 수주 질의를 기록한다. 수주 줄은 rows 그대로 */
function orderListRoute(ownHqDesigns = [], rows = [{ id: 'O1' }]) {
  return baseRoute({
    extra: (u, method) => {
      if (method === 'GET' && u.includes('/designs?select=id')) return json(ownHqDesigns.map((id) => ({ id })));
      if (method === 'GET' && u.includes('/orders?')) return json(rows);
      return null;
    },
  });
}
const orderQueries = (calls) => calls.filter((c) => c.url.includes('/orders?')).map((c) => new URL(c.url).searchParams);
const row = (id, companyId, designId) => ({ id, company_id: companyId, design_id: designId, contract_amount: 1100000, received_amount: 500000, status: 'confirmed' });

test('수주 목록 — 협력업체 owner 는 그 업체 수주 전부 + 내가 만든 본사 설계 수주, 수금액까지', async () => {
  await withFetch(orderListRoute(['d-mine'], [row('O1', PARTNER, 'd-p'), row('O2', HQ, 'd-mine')]), async (calls) => {
    const items = await listOrders(ENV, { user: { id: P_OWNER } });
    const [q] = orderQueries(calls);
    assert.equal(q.get('or'), `(company_id.in.(${PARTNER}),design_id.in.(d-mine))`);
    const designs = calls.find((c) => c.url.includes('/designs?select=id')).url;
    assert.ok(designs.includes(`user_id=eq.${P_OWNER}`) && designs.includes(`company_id=eq.${HQ}`));
    // 업체 칸은 줄마다 권한을 보는 데만 읽고 응답에서는 뺀다 — 응답 칸은 예전 그대로 (+ 구분)
    assert.equal(q.get('select'), 'id,order_no,design_id,document_id,snapshot_id,customer_name,contract_amount,received_amount,status,ordered_at,delivered_at,completed_at,note,created_at,company_id,price_tier');
    assert.equal(q.get('order'), 'ordered_at.desc');
    assert.equal(q.get('limit'), '200');
    assert.deepEqual(items.map((o) => [o.id, o.received_amount, 'company_id' in o]), [['O1', 500000, false], ['O2', 500000, false]]);
  });
});

test('수주 목록 — staff 는 업체 수주를 보되 수금액은 빠진다 (상태 · 계약금은 그대로)', async () => {
  await withFetch(orderListRoute([], [row('O1', PARTNER, 'd-p')]), async (calls) => {
    const items = await listOrders(ENV, { user: { id: P_STAFF } });
    assert.equal(orderQueries(calls)[0].get('or'), `(company_id.in.(${PARTNER}))`);
    assert.equal(items[0].contract_amount, 1100000);
    assert.equal(items[0].status, 'confirmed');
    assert.ok(!('received_amount' in items[0]));
  });
});

test('수주 목록 — 본사 staff 는 본사 수주 전부, 수금액은 내가 만든 설계 줄만', async () => {
  await withFetch(orderListRoute(['d-own'], [row('O1', HQ, 'd-hq'), row('O2', HQ, 'd-own')]), async (calls) => {
    const items = await listOrders(ENV, { user: { id: HQ_STAFF } });
    assert.equal(orderQueries(calls)[0].get('or'), `(company_id.in.(${HQ}))`);
    assert.deepEqual(items.map((o) => [o.id, o.received_amount]), [['O1', undefined], ['O2', 500000]]);
  });
});

test('수주 목록 — 관리자는 본사 수주 전부 (설계 주인 질의 없이)', async () => {
  await withFetch(orderListRoute([], [row('O1', HQ, 'd-hq')]), async (calls) => {
    const items = await listOrders(ENV, { user: { id: ADMIN } });
    const [q] = orderQueries(calls);
    assert.equal(q.get('or'), `(company_id.in.(${HQ}))`);
    assert.ok(!calls.some((c) => c.url.includes('/designs?select=id')));
    assert.equal(items[0].received_amount, 500000);
  });
});

test('수주 목록 — 구성원 · 관리자가 아니면 내가 만든 본사 설계의 수주만 (예전과 같다)', async () => {
  await withFetch(orderListRoute(['d-hq'], [row('O1', HQ, 'd-hq')]), async (calls) => {
    const items = await listOrders(ENV, { user: { id: CREATOR } });
    const [q] = orderQueries(calls);
    assert.equal(q.get('or'), '(design_id.in.(d-hq))');
    assert.equal(items[0].received_amount, 500000);
  });
  await withFetch(orderListRoute([]), async (calls) => {
    assert.deepEqual(await listOrders(ENV, { user: { id: STRANGER } }), []);
    assert.equal(orderQueries(calls).length, 0);
  });
});

test('수주 목록 — 설계를 고르면 그 설계의 권한으로, staff 는 수금액만 빠진다', async () => {
  await withFetch(orderListRoute([], [row('O1', PARTNER, 'd-p')]), async (calls) => {
    const forManager = await listOrders(ENV, { user: { id: P_MANAGER }, designId: 'd-p' });
    assert.equal(orderQueries(calls)[0].get('design_id'), 'eq.d-p');
    assert.equal(forManager[0].received_amount, 500000);
    const forStaff = await listOrders(ENV, { user: { id: P_STAFF }, designId: 'd-p' });
    assert.ok(!('received_amount' in forStaff[0]));
    await assert.rejects(listOrders(ENV, { user: { id: OTHER_OWNER }, designId: 'd-p' }), (e) => e.statusCode === 403);
  });
});

test('생산 계획 입력 — 내가 만든 본사 설계의 본사 수주만 (본사 Slack 으로 나간다)', async () => {
  await withFetch(orderListRoute(['d-hq']), async (calls) => {
    await listOwnHqOrders(ENV, { user: { id: ADMIN } });
    const [q] = orderQueries(calls);
    assert.equal(q.get('company_id'), `eq.${HQ}`);
    assert.equal(q.get('design_id'), 'in.(d-hq)');
    const designs = calls.find((c) => c.url.includes('/designs?select=id')).url;
    assert.ok(designs.includes(`user_id=eq.${ADMIN}`) && designs.includes(`company_id=eq.${HQ}`));
  });
  await withFetch(orderListRoute([]), async (calls) => {
    assert.deepEqual(await listOwnHqOrders(ENV, { user: { id: P_OWNER } }), []);
    assert.equal(orderQueries(calls).length, 0);
  });
});

/** 수주 상세 · 고치기 가짜 — 협력업체 설계의 수주 하나 + 원가 · 견적 · 재작업 · 문항 · 수금 */
function orderDetailRoute() {
  return baseRoute({
    extra: (u, method, body) => {
      if (method === 'GET' && u.includes('/orders?id=eq.')) return json([{ id: 'O1', order_no: 'SO-1', design_id: 'd-p', company_id: PARTNER, snapshot_id: 'S1', contract_amount: 1100000, received_amount: 500000, status: 'confirmed' }]);
      if (method === 'PATCH' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'd-p', company_id: PARTNER, contract_amount: 1100000, received_amount: 500000, ...body }]);
      // 상태가 바뀌면 기록 한 줄 (src/order-events.js)
      if (method === 'POST' && u.endsWith('/order_events')) return json([{ id: 'E1', ...body }], 201);
      if (u.includes('/order_costs?')) return json([{ id: 'C1', category: 'material', amount: 300000 }]);
      if (u.includes('/design_snapshots?')) return json([{ rev: 1, quote_payload: { total: 1100000, items: [] } }]);
      if (u.includes('/rework_logs?')) return json([{ id: 'R1', kind: 'as', cause: 'install', cost: 20000 }]);
      if (u.includes('/install_feedback?')) return json([]);
      if (u.includes('/order_payments?')) return json([{ id: 'P1', stage: 'deposit', amount: 500000 }]);
      return null;
    },
  });
}

test('GET /orders/:id — staff 는 수주 기본 정보만 (원가 · 마진 · 수금 · 재작업 비용 없음), 실장은 전부', async () => {
  const staff = await callWorker('/orders/O1', P_STAFF, orderDetailRoute());
  assert.equal(staff.status, 200, staff.text);
  const s = JSON.parse(staff.text).data;
  assert.equal(s.order.contract_amount, 1100000);
  assert.equal(s.order.status, 'confirmed');
  assert.ok(!('received_amount' in s.order));
  for (const k of ['costs', 'margin', 'payments', 'money']) assert.ok(!(k in s), `${k} 없음`);
  assert.deepEqual(s.reworks, [{ id: 'R1', kind: 'as', cause: 'install' }]);
  assert.ok(!staff.calls.some((c) => c.url.includes('/order_costs?') || c.url.includes('/order_payments?')), '원가 · 수금 표를 읽지도 않는다');

  const manager = await callWorker('/orders/O1', P_MANAGER, orderDetailRoute());
  const m = JSON.parse(manager.text).data;
  assert.equal(m.order.received_amount, 500000);
  assert.equal(m.costs.length, 1);
  assert.equal(m.margin.cost_total, 300000);
  assert.equal(m.payments.length, 1);
  assert.equal(m.reworks[0].cost, 20000);
  assert.ok(!('money' in m));
});

test('PATCH /orders/:id — staff 는 상태는 고치고 수금액은 403, 응답에 수금액 없음', async () => {
  const ok = await callWorker('/orders/O1', P_STAFF, orderDetailRoute(), { method: 'PATCH', body: { status: 'in_production' } });
  assert.equal(ok.status, 200, ok.text);
  const data = JSON.parse(ok.text).data;
  assert.equal(data.status, 'in_production');
  assert.ok(!('received_amount' in data));
  const denied = await callWorker('/orders/O1', P_STAFF, orderDetailRoute(), { method: 'PATCH', body: { received_amount: 600000 } });
  assert.equal(denied.status, 403);
  assert.ok(!denied.calls.some((c) => c.method === 'PATCH'));
  const owner = await callWorker('/orders/O1', P_OWNER, orderDetailRoute(), { method: 'PATCH', body: { received_amount: 600000 } });
  assert.equal(owner.status, 200);
  assert.equal(JSON.parse(owner.text).data.received_amount, 600000);
});

test('원가 · 수금 · 재작업 비용을 바꾸는 경로는 staff 403', async () => {
  for (const [method, path, body] of [
    ['POST', '/orders/O1/costs', { category: 'material', amount: 1000 }],
    ['DELETE', '/orders/O1/costs/C1', undefined],
    ['POST', '/orders/O1/payments', { stage: 'deposit', amount: 1000, due_on: '2026-11-01' }],
    ['POST', '/orders/O1/reworks', { kind: 'as', cause: 'install' }],
  ]) {
    const r = await callWorker(path, P_STAFF, orderDetailRoute(), { method, body });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.ok(!r.calls.some((c) => c.method !== 'GET' && !c.url.includes('/auth/')), `${method} ${path} 쓰기 없음`);
  }
});

// ── 견적 · 문서 ──────────────────────────────────────────────────

const FULL_QUOTE = {
  method: 'sheet', items: [{ name: '싱크대', amount: 1000000 }], subtotal: 1000000, vat: 100000, total: 1100000, margin_rate: 0.2,
  partner: { items: [], subtotal: 900000, vat: 90000, total: 990000, margin_rate: 0.1 },
  cost: { total: 800000, margin_amount: 200000, fixed_recovery: 50000 },
  settings_missing: false,
  settings_used: { standards: {}, crew: {}, costs: { assemblerDay: 200000 }, quote: { marginRate: 0.2 } },
};

test('quoteForViewer — 원가 · 수금 권한이 없으면 원가 내역 · 마진율 · 동결 설정만 뺀다 (고객 금액은 그대로)', () => {
  assert.equal(quoteForViewer(FULL_QUOTE, true), FULL_QUOTE);
  const q = quoteForViewer(FULL_QUOTE, false);
  assert.deepEqual(Object.keys(q).sort(), ['items', 'method', 'partner', 'settings_missing', 'subtotal', 'total', 'vat']);
  assert.deepEqual(q.partner, { items: [], subtotal: 900000, vat: 90000, total: 990000 });
  assert.equal(FULL_QUOTE.cost.total, 800000, '원본은 그대로');
  assert.equal(quoteForViewer(null, false), null);
  // 본사 견적이 아니면 거래처 금액이 null — 그대로 둔다
  assert.equal(quoteForViewer({ ...FULL_QUOTE, partner: null }, false).partner, null);
  // 옛 스냅샷의 legacy 합계는 손대지 않는다
  assert.deepEqual(quoteForViewer({ total: 1, legacy: { method: 'per_meter', total: 2 } }, false).legacy, { method: 'per_meter', total: 2 });
});

function docRoute(designId, docType) {
  return baseRoute({
    extra: (u) => {
      if (u.includes('/design_documents?')) {
        return json([{ id: 'DOC1', design_id: designId, snapshot_id: 'S1', doc_type: docType, totals: { total: 1100000 }, render_payload: { quote: FULL_QUOTE, price_tier: 'customer' } }]);
      }
      if (u.includes('/design_snapshots?')) return json([{ id: 'S1', design_id: designId, rev: 1, content_hash: 'h', quote_payload: FULL_QUOTE }]);
      return null;
    },
  });
}

test('스냅샷 · 문서 — staff 도 읽는다 (견적 · totals 는 그대로, 원가 · 마진만 빠진다)', async () => {
  await withFetch(docRoute('d-p', 'customer_confirmation'), async () => {
    const forStaff = await getDocumentForOwner(ENV, { documentId: 'DOC1', user: { id: P_STAFF } });
    assert.equal(forStaff.money, false);
    const view = documentForViewer(forStaff.doc, forStaff.money);
    assert.equal(view.totals.total, 1100000);
    assert.equal(view.render_payload.quote.total, 1100000);
    assert.ok(!('cost' in view.render_payload.quote));
    assert.equal(view.render_payload.price_tier, 'customer');
    const forManager = await getDocumentForOwner(ENV, { documentId: 'DOC1', user: { id: P_MANAGER } });
    assert.equal(forManager.money, true);
    assert.equal(documentForViewer(forManager.doc, true).render_payload.quote.cost.total, 800000);

    const snap = await getSnapshotForViewer(ENV, { snapshotId: 'S1', user: { id: P_STAFF } });
    assert.equal(snap.quote_payload.total, 1100000);
    assert.ok(!('cost' in snap.quote_payload));
    // 서버 안(문서 발행)에서 쓰는 getSnapshot 은 그대로 — 발행된 문서에 견적 전체가 동결된다
    assert.equal((await getSnapshot(ENV, { snapshotId: 'S1', user: { id: P_STAFF } })).quote_payload.cost.total, 800000);
    await assert.rejects(getSnapshot(ENV, { snapshotId: 'S1', user: { id: OTHER_OWNER } }), (e) => e.statusCode === 403);
  });
});

/**
 * worker.fetch 로 — JWT 확인(/auth/v1/user)은 토큰 이름을 사용자 id 로 돌려준다.
 * 응답 뒤 일(waitUntil)까지 기다린 다음 호출 기록을 돌려준다.
 */
async function callWorker(path, token, route, { method = 'GET', body } = {}) {
  const auth = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: token }) : route(u, m, b));
  return withFetch(auth, async (calls) => {
    const pending = [];
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      ENV,
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    return { status: res.status, text: await res.text(), calls };
  });
}

test('GET /documents/:id/print — staff 도 확인서를 인쇄한다, 관리자는 협력업체 문서 403 (예전 관리자 우회 없음)', async () => {
  const staff = await callWorker('/documents/DOC1/print', P_STAFF, docRoute('d-p', 'customer_confirmation'));
  assert.equal(staff.status, 200, staff.text);
  const partner = await callWorker('/documents/DOC1/print', ADMIN, docRoute('d-p', 'work_order'));
  assert.equal(partner.status, 403);
});

test('GET /documents/:id — staff 도 200, 견적의 원가 · 마진만 빠진다', async () => {
  const r = await callWorker('/documents/DOC1', P_STAFF, docRoute('d-p', 'customer_confirmation'));
  assert.equal(r.status, 200, r.text);
  const quote = JSON.parse(r.text).data.render_payload.quote;
  assert.equal(quote.total, 1100000);
  assert.ok(!('cost' in quote) && !('margin_rate' in quote));
  const ok = await callWorker('/documents/DOC1', P_MANAGER, docRoute('d-p', 'customer_confirmation'));
  assert.equal(JSON.parse(ok.text).data.render_payload.quote.cost.total, 800000);
});

test('GET /snapshots/:id — staff 도 200, 견적의 원가 · 마진만 빠진다', async () => {
  const r = await callWorker('/snapshots/S1', P_STAFF, docRoute('d-p', 'customer_confirmation'));
  assert.equal(r.status, 200, r.text);
  const q = JSON.parse(r.text).data.quote_payload;
  assert.equal(q.total, 1100000);
  assert.ok(!('cost' in q));
  const owner = await callWorker('/snapshots/S1', P_OWNER, docRoute('d-p', 'customer_confirmation'));
  assert.equal(JSON.parse(owner.text).data.quote_payload.cost.total, 800000);
});

// ── 본사 Slack ───────────────────────────────────────────────────

function scheduleRoute() {
  return baseRoute({
    extra: (u, method, body) => {
      if (u === ENV.SLACK_WEBHOOK_URL) return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok', json: async () => ({}) };
      if (method === 'POST' && u.endsWith('/design_schedules')) return json(body.map((r, i) => ({ id: `SC${i}`, ...r })), 201);
      if (method === 'POST' && u.endsWith('/slack_notifications')) return json([{ id: 'N1', ...body }], 201);
      if (method === 'PATCH' && u.includes('/slack_notifications?')) return json([{ id: 'N1' }]);
      if (method === 'GET' && u.includes('/design_snapshots?')) return json([{ design_title: '주방', quote_payload: { total: 1100000 } }]);
      if (method === 'GET' && u.includes('/design_documents?')) return json([]);
      return null;
    },
  });
}
const ITEMS = [{ type: 'measurement', scheduled_at: '2026-11-03T01:00:00Z' }];

test('일정 등록 — 협력업체 설계면 일정만 넣고 본사 Slack 은 보내지 않는다 (알림 기록도 없음)', async () => {
  await withFetch(scheduleRoute(), async (calls) => {
    const out = await createSchedules(ENV, null, { designId: 'd-p', user: { id: P_STAFF }, body: { items: ITEMS } });
    assert.equal(out.schedules.length, 1);
    assert.equal(out.slack, null);
    assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/design_schedules')));
    assert.ok(!calls.some((c) => c.url.includes('slack_notifications')));
    assert.ok(!calls.some((c) => c.url === ENV.SLACK_WEBHOOK_URL));
  });
});

test('일정 등록 — 본사 설계면 예전처럼 알림 기록 + 본사 Slack', async () => {
  await withFetch(scheduleRoute(), async (calls) => {
    const out = await createSchedules(ENV, null, { designId: 'd-hq', user: { id: CREATOR }, body: { items: ITEMS } });
    assert.equal(out.slack.status, 'pending');
    assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/slack_notifications')));
    assert.equal(calls.filter((c) => c.url === ENV.SLACK_WEBHOOK_URL).length, 1);
  });
});

/** 생산 계획까지 도는 경로 — 나머지 표는 비어 있고, 쓰기는 받은 그대로 돌려준다 */
function planRoute(designId) {
  const inner = orderCreateRoute(designId);
  return (u, method, body) => {
    if (u === ENV.SLACK_WEBHOOK_URL) return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok', json: async () => ({}) };
    const hit = inner(u, method, body);
    if (hit) return hit;
    if (!u.includes('/rest/v1/')) return null;
    if (method === 'POST') return json([{ id: 'X1', ...(Array.isArray(body) ? body[0] : body) }], 201);
    return json([]);
  };
}
const slackPosts = (calls) => calls.filter((c) => c.url === ENV.SLACK_WEBHOOK_URL);
const proposals = (calls) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/production_proposals'));

test('새 수주 → 생산 계획 제안(본사 Slack)은 본사 수주일 때만 — 협력업체 수주면 고객 이름이 본사 Slack 으로 가지 않는다', async () => {
  const partner = await callWorker('/documents/DOC1/order', P_OWNER, planRoute('d-p'), { method: 'POST' });
  assert.equal(partner.status, 201, partner.text);
  assert.equal(slackPosts(partner.calls).length, 0);
  assert.equal(proposals(partner.calls).length, 0);

  const hq = await callWorker('/documents/DOC1/order', CREATOR, planRoute('d-hq'), { method: 'POST' });
  assert.equal(hq.status, 201, hq.text);
  assert.equal(proposals(hq.calls).length, 1);
  assert.equal(slackPosts(hq.calls).length, 1);
});

test('설치 일정 등록 → 다시 계획하기도 본사 설계일 때만', async () => {
  const items = [{ type: 'installation', scheduled_at: '2026-11-10T01:00:00Z' }];
  const route = (u, method, body) => scheduleRoute()(u, method, body) || planRoute('d-hq')(u, method, body);
  const partner = await callWorker('/designs/d-p/schedules', P_STAFF, route, { method: 'POST', body: { items } });
  assert.equal(partner.status, 201, partner.text);
  assert.equal(slackPosts(partner.calls).length, 0, '일정 알림도 계획 제안도 없다');
  assert.equal(proposals(partner.calls).length, 0);

  const hq = await callWorker('/designs/d-hq/schedules', CREATOR, route, { method: 'POST', body: { items } });
  assert.equal(hq.status, 201, hq.text);
  assert.equal(proposals(hq.calls).length, 1);
  assert.equal(slackPosts(hq.calls).length, 2, '일정 알림 + 계획 제안');
});

// ── 경영 대시보드 ────────────────────────────────────────────────

test('본사 거르기 도우미 — 수주 · 설계에 붙은 표는 내장 조인(!inner)으로', () => {
  assert.deepEqual(hqByOrder({ select: 'order_id,amount', limit: '5' }, HQ), {
    select: 'order_id,amount,orders!inner(company_id)', limit: '5', 'orders.company_id': `eq.${HQ}`,
  });
  assert.deepEqual(hqByDesign({ select: 'design_id' }, HQ), { select: 'design_id,designs!inner(company_id)', 'designs.company_id': `eq.${HQ}` });
});

test('경영 대시보드 — 수주 · 상담 · 연출컷 · 설계와 거기 붙은 표는 본사 것만 읽는다', async () => {
  const route = baseRoute({ extra: (u) => (u.includes('/rest/v1/') ? json([]) : null) });
  await withFetch(route, async (calls) => {
    await getManagementSummary(ENV, { user: { id: ADMIN }, month: '2026-10' });
    const reads = calls.filter((c) => c.method === 'GET').map((c) => {
      const url = new URL(c.url);
      return { table: url.pathname.replace('/rest/v1/', ''), q: url.searchParams };
    });
    const of = (t) => reads.filter((r) => r.table === t);
    for (const t of ['orders', 'consultations', 'generations', 'designs']) {
      assert.ok(of(t).length > 0, `${t} 를 읽는다`);
      for (const r of of(t)) assert.equal(r.q.get('company_id'), `eq.${HQ}`, `${t} 는 본사만`);
    }
    for (const t of ['order_costs', 'order_payments', 'rework_logs', 'install_feedback']) {
      assert.ok(of(t).length > 0, `${t} 를 읽는다`);
      for (const r of of(t)) {
        assert.ok(r.q.get('select').endsWith(',orders!inner(company_id)'), `${t} 는 본사 수주로 거른다`);
        assert.equal(r.q.get('orders.company_id'), `eq.${HQ}`);
      }
    }
    for (const t of ['design_documents', 'design_schedules']) {
      assert.ok(of(t).length > 0, `${t} 를 읽는다`);
      for (const r of of(t)) {
        // 일정(설치일)은 본사 수주의 설계 id 로 읽는 경우도 있다 — 그때는 설계 id 가 이미 본사 것
        if (r.q.get('design_id')) continue;
        assert.ok(r.q.get('select').endsWith(',designs!inner(company_id)'), `${t} 는 본사 설계로 거른다`);
        assert.equal(r.q.get('designs.company_id'), `eq.${HQ}`);
      }
    }
    // 원가 설정은 본사 줄 — 보는 사람 개인 설정(production_settings)은 읽지 않는다
    assert.ok(of('company_settings').length > 0, 'company_settings 를 읽는다');
    for (const r of of('company_settings')) assert.equal(r.q.get('company_id'), `eq.${HQ}`);
    assert.equal(of('production_settings').length, 0);
  });
});

test('경영 대시보드 — 본사 행이 없으면 숫자를 내지 않는다', async () => {
  const route = baseRoute({ hq: null, extra: (u) => (u.includes('/rest/v1/') ? json([]) : null) });
  await withFetch(route, async () => {
    await assert.rejects(getManagementSummary(ENV, { user: { id: ADMIN }, month: '2026-10' }), DbError);
  });
});
