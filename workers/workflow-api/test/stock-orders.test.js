/**
 * 재고 구매 발주 — src/stock-orders.js 를 워커로 부른다.
 *   GET|POST /stock/orders · POST /stock/orders/:id/receive · POST /stock/orders/:id/cancel
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 함수 셋(stock_order_place · receive · cancel)은 DB 함수라
 * 가짜가 0062 와 같은 셈을 흉내 낸다. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { orderCode, orderInput, receiveInput, ORDER_LINES_MAX } from '../src/stock-orders.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

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
const OWNER_M = uid(31);
const NOBODY = uid(90);
const A = cid(1);
const B = cid(2);
const M = cid(4);
const HINGE = rid(1);
const RAIL = rid(2);
const OLD = rid(3);
const PB_B = rid(4);
const SUP_A = rid(21);
const SUP_B = rid(22);
const PO1 = rid(31);
const PO_DONE = rid(32);
const PO_B = rid(33);
const L1 = rid(41);
const L2 = rid(42);
const L_B = rid(43);
const NOW = Date.parse('2026-11-12T03:00:00.000Z');
// 서버는 지금 시각을 Date.now() 로 읽는다 — 시험이 실제 날짜에 흔들리지 않게 고정한다 (파일마다 따로 도는 프로세스)
Date.now = () => NOW;

function tables() {
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
      { id: M, kind: 'partner', name: '매니저 업체', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
    ],
    profiles: [{ id: OWNER_A, name: '김대표' }],
    counterparties: [
      { id: SUP_A, company_id: A, kind: 'supplier', name: '철물 업체 C', active: true },
      { id: SUP_B, company_id: B, kind: 'supplier', name: 'B 공급처', active: true },
    ],
    stock_items: [
      { id: HINGE, company_id: A, kind: 'hardware', name: '경첩', spec: '35 컵', unit: '개', qty: 40, expected_qty: 100, expected_on: '2026-11-15', active: true },
      { id: RAIL, company_id: A, kind: 'hardware', name: '레일', spec: '', unit: '쌍', qty: 5, expected_qty: 20, expected_on: '2026-11-15', active: true },
      { id: OLD, company_id: A, kind: 'board', name: '옛 판재', spec: '', unit: '장', qty: 0, expected_qty: null, expected_on: null, active: false },
      { id: PB_B, company_id: B, kind: 'board', name: 'B 판재', spec: '', unit: '장', qty: 9, expected_qty: 3, expected_on: '2026-11-20', active: true },
    ],
    stock_orders: [
      { id: PO1, company_id: A, seq: 1, supplier_id: SUP_A, expected_on: '2026-11-15', state: 'ordered', note: '급함', created_by: OWNER_A, created_at: '2026-11-10T01:00:00Z', closed_at: null },
      { id: PO_DONE, company_id: A, seq: 2, supplier_id: null, expected_on: '2026-11-08', state: 'received', note: null, created_by: NOBODY, created_at: '2026-11-11T01:00:00Z', closed_at: '2026-11-11T05:00:00Z' },
      { id: PO_B, company_id: B, seq: 1, supplier_id: SUP_B, expected_on: '2026-11-20', state: 'ordered', note: null, created_by: OWNER_B, created_at: '2026-11-10T01:00:00Z', closed_at: null },
    ],
    stock_order_lines: [
      { id: L1, company_id: A, order_id: PO1, item_id: HINGE, qty: 100, received_qty: null },
      { id: L2, company_id: A, order_id: PO1, item_id: RAIL, qty: 20, received_qty: null },
      { id: L_B, company_id: B, order_id: PO_B, item_id: PB_B, qty: 3, received_qty: null },
    ],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 0062 함수 셋 흉내 */
function fakeOf(opts = {}) {
  const box = { rpc: [] };
  const take = (db, item, qty) => {
    if (item.expected_qty === null) return;
    const left = item.expected_qty - qty;
    item.expected_qty = left > 0 ? left : null;
    if (left <= 0) item.expected_on = null;
  };
  const fake = createFake({
    tables: tables(),
    nowMs: NOW,
    before(method, table, params, body) {
      if (opts.before) {
        const r = opts.before(method, table, params, body);
        if (r) return r;
      }
      if (!table.startsWith('rpc/stock_order_')) return null;
      box.rpc.push({ fn: table.slice(4), body });
      const db = box.fake.db;
      if (table === 'rpc/stock_order_place') {
        const seq = Math.max(0, ...db.stock_orders.filter((o) => o.company_id === body.p_company).map((o) => o.seq)) + 1;
        const order = { id: rid(900 + box.rpc.length), company_id: body.p_company, seq, supplier_id: body.p_supplier, expected_on: body.p_expected_on, state: 'ordered', note: body.p_note, created_by: body.p_actor, created_at: new Date(NOW).toISOString(), closed_at: null };
        for (const l of body.p_lines) {
          const item = db.stock_items.find((i) => i.id === l.item_id && i.company_id === body.p_company && i.active);
          if (!item) return json({ code: 'P0002', message: 'stock_order_place: 쓰는 품목이 아닙니다' }, 400);
          item.expected_qty = (item.expected_qty || 0) + l.qty;
          item.expected_on = !item.expected_on || body.p_expected_on < item.expected_on ? body.p_expected_on : item.expected_on;
          db.stock_order_lines.push({ id: rid(950 + db.stock_order_lines.length), company_id: body.p_company, order_id: order.id, item_id: l.item_id, qty: l.qty, received_qty: null });
        }
        db.stock_orders.push(order);
        return json(order);
      }
      const order = db.stock_orders.find((o) => o.id === body.p_order && o.company_id === body.p_company);
      if (!order) return json({ code: 'P0002', message: '발주가 없습니다' }, 400);
      if (order.state !== 'ordered') return json({ code: '22023', message: '이미 끝난 발주입니다' }, 400);
      for (const l of db.stock_order_lines.filter((x) => x.order_id === order.id)) {
        const item = db.stock_items.find((i) => i.id === l.item_id);
        if (table === 'rpc/stock_order_cancel') take(db, item, l.qty);
        else {
          const got = body.p_qtys && body.p_qtys[l.id] !== undefined ? body.p_qtys[l.id] : l.qty;
          item.qty += got;
          take(db, item, l.qty);
          l.received_qty = got;
        }
      }
      order.state = table === 'rpc/stock_order_cancel' ? 'cancelled' : 'received';
      order.closed_at = new Date(NOW).toISOString();
      return json(order);
    },
  });
  box.fake = fake;
  fake.box = box;
  return fake;
}

const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const post = (fake, path, body, token = OWNER_A) => call(fake, path, token, { method: 'POST', body });
const NEW = { supplier_id: SUP_A, expected_on: '2026-11-20', note: ' 월말 ', lines: [{ item_id: HINGE, qty: 50 }, { item_id: RAIL, qty: '10' }] };

// ── 순수 ──────────────────────────────────────────────────────

test('orderCode · orderInput — 받을 날 · 품목 1 ~ 30줄 · 같은 품목은 한 번 · 수량은 양수', () => {
  assert.equal(orderCode(7), 'PO-0007');
  assert.deepEqual(orderInput(NEW), { supplier_id: SUP_A, expected_on: '2026-11-20', note: '월말', lines: [{ item_id: HINGE, qty: 50 }, { item_id: RAIL, qty: 10 }] });
  assert.equal(orderInput({ expected_on: '2026-11-20', lines: [{ item_id: HINGE, qty: 1 }] }).supplier_id, null);
  const many = Array.from({ length: ORDER_LINES_MAX + 1 }, (_, i) => ({ item_id: rid(500 + i), qty: 1 }));
  for (const bad of [null, {}, { ...NEW, expected_on: '2026-02-30' }, { ...NEW, expected_on: '11.20' }, { ...NEW, supplier_id: 'x' }, { ...NEW, lines: [] }, { ...NEW, lines: many }, { ...NEW, lines: [{ item_id: HINGE, qty: 0 }] }, { ...NEW, lines: [{ item_id: 'x', qty: 1 }] }, { ...NEW, lines: [{ item_id: HINGE, qty: 1 }, { item_id: HINGE, qty: 2 }] }, { ...NEW, note: 'x'.repeat(201) }])
    assert.throws(() => orderInput(bad), Error, JSON.stringify(bad).slice(0, 80));
});

test('receiveInput — 없으면 null(발주 수량 그대로), 있으면 줄마다 0 이상', () => {
  assert.equal(receiveInput(null), null);
  assert.equal(receiveInput({}), null);
  assert.equal(receiveInput({ qtys: {} }), null);
  assert.deepEqual(receiveInput({ qtys: { [L1]: '90', [L2]: 0 } }), { [L1]: 90, [L2]: 0 });
  for (const bad of [[], { qtys: [] }, { qtys: { x: 1 } }, { qtys: { [L1]: -1 } }, { qtys: { [L1]: 'abc' } }])
    assert.throws(() => receiveInput(bad), Error, JSON.stringify(bad));
});

// ── 읽기 ──────────────────────────────────────────────────────

test('목록 — 구성원이 본다. 내 업체 발주만 새 것부터, 줄에 품목 이름. 계정 id · 금액은 없다', async () => {
  const fake = fakeOf();
  assert.equal((await call(fake, '/stock/orders', NOBODY)).json.code, 'not_member');
  assert.equal((await call(fake, '/stock/orders', OWNER_M)).json.code, 'not_stock_company');
  assert.equal((await call(fake, '/stock/orders', null)).status, 401);
  const r = await call(fake, '/stock/orders', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.can_manage, false);
  assert.deepEqual(d.company, { name: '가나 인테리어' });
  assert.deepEqual(d.items.map((o) => [o.code, o.state]), [['PO-0002', 'received'], ['PO-0001', 'ordered']]);
  assert.deepEqual(d.items[1], {
    id: PO1, code: 'PO-0001', state: 'ordered', supplier: { id: SUP_A, name: '철물 업체 C' }, expected_on: '2026-11-15', note: '급함', by: '김대표',
    created_at: '2026-11-10T01:00:00Z', closed_at: null,
    lines: [
      { id: L1, item_id: HINGE, name: '경첩', spec: '35 컵', unit: '개', qty: 100, received_qty: null },
      { id: L2, item_id: RAIL, name: '레일', spec: '', unit: '쌍', qty: 20, received_qty: null },
    ],
  });
  assert.equal(d.items[0].by, null, '지금 구성원이 아닌 사람 이름은 싣지 않는다');
  const text = JSON.stringify(r.json);
  for (const secret of [OWNER_A, NOBODY, PO_B, 'unit_price']) assert.equal(text.includes(secret), false, secret);
});

// ── 넣기 ──────────────────────────────────────────────────────

test('발주 넣기 — 대표 · 실장만. 번호는 다음 차례, 품목 입고 예정이 늘어난다', async () => {
  const fake = fakeOf();
  const no = await post(fake, '/stock/orders', NEW, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');
  const r = await post(fake, '/stock/orders', NEW);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.code, 'PO-0003');
  assert.deepEqual(r.json.data.lines.map((l) => [l.name, l.qty]), [['경첩', 50], ['레일', 10]]);
  assert.deepEqual(fake.box.rpc[0], {
    fn: 'stock_order_place',
    body: { p_company: A, p_supplier: SUP_A, p_expected_on: '2026-11-20', p_note: '월말', p_lines: [{ item_id: HINGE, qty: 50 }, { item_id: RAIL, qty: 10 }], p_actor: OWNER_A },
  });
  const hinge = fake.db.stock_items.find((i) => i.id === HINGE);
  assert.deepEqual([hinge.expected_qty, hinge.expected_on], [150, '2026-11-15'], '받을 날은 더 이른 쪽');
});

test('발주 넣기 — 남의 공급처 · 남의 품목 · 숨긴 품목은 422, 함수를 부르지 않는다', async () => {
  const fake = fakeOf();
  const s = await post(fake, '/stock/orders', { ...NEW, supplier_id: SUP_B });
  assert.equal(s.status, 422);
  assert.equal(s.json.details.field, 'supplier_id');
  for (const item_id of [PB_B, OLD, rid(777)]) {
    const r = await post(fake, '/stock/orders', { ...NEW, lines: [{ item_id, qty: 1 }] });
    assert.equal(r.status, 422, item_id);
    assert.equal(r.json.details.field, 'lines');
  }
  assert.equal(fake.box.rpc.length, 0);
  assert.equal(fake.db.stock_orders.length, 3);
});

// ── 입고 · 취소 ───────────────────────────────────────────────

test('입고 — 직원도 한다. 그대로 받으면 재고가 늘고 입고 예정이 지워지고 발주가 닫힌다', async () => {
  const fake = fakeOf();
  const r = await post(fake, `/stock/orders/${PO1}/receive`, {}, STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.state, 'received');
  assert.deepEqual(r.json.data.lines.map((l) => l.received_qty), [100, 20]);
  assert.deepEqual(fake.box.rpc[0].body, { p_company: A, p_order: PO1, p_actor: STAFF_A, p_qtys: null });
  const hinge = fake.db.stock_items.find((i) => i.id === HINGE);
  assert.deepEqual([hinge.qty, hinge.expected_qty], [140, null]);
});

test('입고 — 덜 온 수량을 줄마다 적는다. 그 발주의 줄이 아니면 422', async () => {
  const fake = fakeOf();
  const bad = await post(fake, `/stock/orders/${PO1}/receive`, { qtys: { [L_B]: 1 } });
  assert.equal(bad.status, 422);
  assert.equal(fake.box.rpc.length, 0);
  const r = await post(fake, `/stock/orders/${PO1}/receive`, { qtys: { [L2]: 5 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.lines.map((l) => l.received_qty), [100, 5]);
  const rail = fake.db.stock_items.find((i) => i.id === RAIL);
  assert.deepEqual([rail.qty, rail.expected_qty], [10, null], '덜 온 만큼은 더 기다리지 않는다');
});

test('취소 — 대표 · 실장만. 입고 예정에서 빠지고 닫힌다. 재고는 그대로', async () => {
  const fake = fakeOf();
  const no = await post(fake, `/stock/orders/${PO1}/cancel`, {}, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');
  const r = await post(fake, `/stock/orders/${PO1}/cancel`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.state, 'cancelled');
  const hinge = fake.db.stock_items.find((i) => i.id === HINGE);
  assert.deepEqual([hinge.qty, hinge.expected_qty], [40, null]);
});

test('끝난 발주는 409 closed · 남의 발주 · 없는 id 는 404 (남의 재고는 그대로)', async () => {
  const fake = fakeOf();
  for (const act of ['receive', 'cancel']) {
    const r = await post(fake, `/stock/orders/${PO_DONE}/${act}`, {});
    assert.equal(r.status, 409, act);
    assert.equal(r.json.code, 'closed');
    assert.equal((await post(fake, `/stock/orders/${PO_B}/${act}`, {})).status, 404, act);
    assert.equal((await post(fake, `/stock/orders/nope/${act}`, {})).status, 404, act);
  }
  assert.equal(fake.db.stock_items.find((i) => i.id === PB_B).qty, 9);
  assert.equal(fake.db.stock_orders.find((o) => o.id === PO_B).state, 'ordered');
});

test('DB 0062 적용 전이면 409 db_pending (표 · 함수가 없다)', async () => {
  const noTable = fakeOf({ before: (m, t) => (t.startsWith('stock_order') ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  assert.equal((await call(noTable, '/stock/orders', OWNER_A)).json.code, 'db_pending');
  const noFn = fakeOf({ before: (m, t) => (t.startsWith('rpc/stock_order') ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : null) });
  assert.equal((await post(noFn, '/stock/orders', NEW)).json.code, 'db_pending');
  assert.equal((await post(noFn, `/stock/orders/${PO1}/receive`, {})).json.code, 'db_pending');
});
