/**
 * 재고 — src/stock.js 를 워커로 부른다.
 *   GET|POST /stock/items · PATCH /stock/items/:id · POST /stock/items/:id/moves · GET /stock/moves
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. stock_move() 는 DB 함수라 가짜가 같은 셈을 흉내 낸다.
 * 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { itemInput, moveInput, qtyOf, canHoldStock, NAME_MAX, QTY_MAX } from '../src/stock.js';
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
const OWNER_M = uid(31);
const OWNER_S = uid(51);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const ADMIN = uid(71);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const S = cid(3);
const M = cid(4);

const HINGE = rid(1);
const RAIL = rid(2);
const OLD = rid(3);
const PB_B = rid(4);
const SUP_A = rid(21);
const SUP_B = rid(22);
const PARTNER_A = rid(23);

const NOW = Date.parse('2026-11-12T03:00:00.000Z');
// 서버는 지금 시각을 Date.now() 로 읽는다 — 시험이 실제 날짜에 흔들리지 않게 고정한다 (파일마다 따로 도는 프로세스)
Date.now = () => NOW;
const at = (d) => `2026-11-${String(d).padStart(2, '0')}T09:00:00.000Z`;

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
      { id: S, kind: 'partner', name: '멈춘 가구', plan: 'expert', status: 'suspended' },
      { id: M, kind: 'partner', name: '매니저 업체', plan: 'manager', status: 'active' },
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
    profiles: [
      { id: OWNER_A, name: '김대표' },
      { id: STAFF_A, name: '이직원' },
    ],
    counterparties: [
      { id: SUP_A, company_id: A, kind: 'supplier', name: '철물 업체 C', active: true },
      { id: PARTNER_A, company_id: A, kind: 'partner', name: '거래처 가', active: true },
      { id: SUP_B, company_id: B, kind: 'supplier', name: 'B 공급처', active: true },
    ],
    stock_items: [
      { id: HINGE, company_id: A, kind: 'hardware', name: '경첩 110° 연결형', spec: '35 컵', unit: '개', qty: 40, safety_qty: 120, supplier_id: SUP_A, expected_qty: 100, expected_on: '2026-11-15', memo: null, active: true, updated_at: at(1), unit_price: 850 },
      { id: RAIL, company_id: A, kind: 'hardware', name: '서랍 레일 언더 450', spec: '450', unit: '쌍', qty: 30, safety_qty: 20, supplier_id: null, expected_qty: null, expected_on: null, memo: null, active: true, updated_at: at(1) },
      { id: OLD, company_id: A, kind: 'board', name: '옛 판재', spec: '', unit: '장', qty: 0, safety_qty: 5, supplier_id: null, expected_qty: null, expected_on: null, memo: null, active: false, updated_at: at(1) },
      { id: PB_B, company_id: B, kind: 'board', name: 'PB 18T 화이트', spec: '18T', unit: '장', qty: 12, safety_qty: 0, supplier_id: null, expected_qty: null, expected_on: null, memo: null, active: true, updated_at: at(1) },
    ],
    stock_moves: [
      { id: rid(31), company_id: A, item_id: HINGE, kind: 'in', qty: 200, qty_after: 200, ref_label: null, note: '철물 업체 C', actor_user_id: OWNER_A, created_at: at(5) },
      { id: rid(32), company_id: A, item_id: HINGE, kind: 'out', qty: 160, qty_after: 40, ref_label: 'W-2611-005', note: null, actor_user_id: NOBODY, created_at: at(8) },
      { id: rid(33), company_id: B, item_id: PB_B, kind: 'in', qty: 12, qty_after: 12, ref_label: null, note: null, actor_user_id: OWNER_B, created_at: at(9) },
    ],
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** stock_move() 흉내 — 0059 함수와 같은 셈. fake.db 를 직접 바꾼다 */
function fakeOf(opts = {}) {
  const box = {};
  const fake = createFake({
    tables: tables(),
    admins: [ADMIN],
    nowMs: NOW,
    before(method, table, params, body) {
      if (opts.before) {
        const r = opts.before(method, table, params, body);
        if (r) return r;
      }
      if (table !== 'rpc/stock_move') return null;
      box.rpc = (box.rpc || 0) + 1;
      const item = box.fake.db.stock_items.find((i) => i.id === body.p_item && i.company_id === body.p_company);
      if (!item) return json({ code: 'P0002', message: 'stock_move: 품목이 없습니다' }, 400);
      const after = (item.qty || 0) + (body.p_kind === 'out' ? -body.p_qty : body.p_qty);
      if (after < 0) return json({ code: '22023', message: 'stock_move: 남은 수량보다 많이 뺄 수 없습니다' }, 400);
      item.qty = after;
      if (body.p_kind === 'in' && item.expected_qty !== null) {
        const left = item.expected_qty - body.p_qty;
        item.expected_qty = left > 0 ? left : null;
        if (left <= 0) item.expected_on = null;
      }
      const row = { id: rid(900 + box.rpc), company_id: body.p_company, item_id: body.p_item, kind: body.p_kind, qty: body.p_qty, qty_after: after, ref_label: body.p_ref, note: body.p_note, actor_user_id: body.p_actor, created_at: new Date(NOW).toISOString() };
      box.fake.db.stock_moves.push(row);
      return json(row);
    },
  });
  box.fake = fake;
  fake.box = box;
  return fake;
}

const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const post = (fake, path, body, token = OWNER_A) => call(fake, path, token, { method: 'POST', body });
const patch = (fake, id, body, token = OWNER_A) => call(fake, `/stock/items/${id}`, token, { method: 'PATCH', body });

// ── 순수 ──────────────────────────────────────────────────────

test('qtyOf — 숫자 · 소수 둘째 자리 · 한도, 양수 · 0 아님 가르기', () => {
  assert.equal(qtyOf(3, 'q'), 3);
  assert.equal(qtyOf('2.5', 'q'), 2.5);
  assert.equal(qtyOf(1.005, 'q'), 1);
  assert.equal(qtyOf(0, 'q'), 0);
  assert.equal(qtyOf(-4, 'q', { signed: true }), -4);
  for (const bad of [null, undefined, '', 'x', NaN, Infinity, {}, -1, QTY_MAX + 1]) assert.throws(() => qtyOf(bad, 'q'), /수량/, String(bad));
  assert.throws(() => qtyOf(0, 'q', { positive: true }), /0 보다/);
  assert.throws(() => qtyOf(0, 'q', { signed: true }), /0 이 될 수 없/);
});

test('itemInput — 더하기는 종류 · 이름 · 단위가 있어야 하고, 고치기는 온 칸만 · 남은 수량은 못 바꾼다', () => {
  assert.deepEqual(itemInput({ kind: 'hardware', name: ' 경첩 ', unit: '개' }), { kind: 'hardware', name: '경첩', unit: '개' });
  assert.deepEqual(itemInput({ kind: 'board', name: 'PB', unit: '장', spec: ' 18T ', safety_qty: '10', supplier_id: null, memo: '' }), {
    kind: 'board', name: 'PB', unit: '장', spec: '18T', safety_qty: 10, supplier_id: null, memo: null,
  });
  for (const bad of [null, [], {}, { kind: 'x', name: '가', unit: '개' }, { kind: 'board', unit: '개' }, { kind: 'board', name: '가' }, { kind: 'board', name: '가'.repeat(NAME_MAX + 1), unit: '개' }, { kind: 'board', name: '가', unit: '아주아주긴단위이름' }, { kind: 'board', name: '가', unit: '개', supplier_id: 'x' }])
    assert.throws(() => itemInput(bad), Error, JSON.stringify(bad));
  assert.deepEqual(itemInput({ safety_qty: 5, qty: 999, kind: 'board', company_id: 'x' }, { partial: true }), { safety_qty: 5 }, '수량 · 종류 · 업체는 버린다');
  assert.deepEqual(itemInput({ active: false }, { partial: true }), { active: false });
  assert.deepEqual(itemInput({ expected_qty: 50, expected_on: '2026-11-20' }, { partial: true }), { expected_qty: 50, expected_on: '2026-11-20' });
  assert.deepEqual(itemInput({ expected_qty: null, expected_on: null }, { partial: true }), { expected_qty: null, expected_on: null });
  assert.throws(() => itemInput({ expected_qty: 50 }, { partial: true }), /받을 날/);
  assert.throws(() => itemInput({ expected_qty: 0, expected_on: '2026-11-20' }, { partial: true }), /0 보다/);
  assert.throws(() => itemInput({ expected_qty: 5, expected_on: '11.20' }, { partial: true }), /받을 날/);
  assert.throws(() => itemInput({ qty: 3 }, { partial: true }), /바꿀 칸/);
  assert.throws(() => itemInput({ active: 'no' }, { partial: true }), /active/);
});

test('moveInput — 입고 · 출고는 양수, 실사 조정은 빼기도 된다', () => {
  assert.deepEqual(moveInput({ kind: 'in', qty: 10 }), { kind: 'in', qty: 10, ref: null, note: null });
  assert.deepEqual(moveInput({ kind: 'out', qty: '3', ref: ' W-1 ', note: ' 메모 ' }), { kind: 'out', qty: 3, ref: 'W-1', note: '메모' });
  assert.deepEqual(moveInput({ kind: 'adjust', qty: -2 }), { kind: 'adjust', qty: -2, ref: null, note: null });
  for (const bad of [null, {}, { kind: 'move', qty: 1 }, { kind: 'in', qty: 0 }, { kind: 'out', qty: -1 }, { kind: 'adjust', qty: 0 }, { kind: 'in', qty: 1, ref: 'x'.repeat(61) }])
    assert.throws(() => moveInput(bad), Error, JSON.stringify(bad));
});

test('canHoldStock — 다담 공장 · active Expert · Agent 만', () => {
  assert.equal(canHoldStock({ kind: 'hq', status: 'active' }), true);
  assert.equal(canHoldStock({ kind: 'partner', plan: 'expert', status: 'active' }), true);
  assert.equal(canHoldStock({ kind: 'partner', plan: 'agent', status: 'active' }), true);
  for (const c of [null, { kind: 'platform', status: 'active' }, { kind: 'partner', plan: 'manager', status: 'active' }, { kind: 'partner', plan: 'agent', status: 'suspended' }])
    assert.equal(canHoldStock(c), false);
});

// ── 누가 ──────────────────────────────────────────────────────

test('구성원이 아니면 403 not_member, 다담 본사 · Manager · 멈춘 업체는 403 not_stock_company, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  for (const path of ['/stock/items', '/stock/moves']) {
    for (const who of [NOBODY, ADMIN]) {
      const r = await call(fake, path, who);
      assert.equal(r.status, 403, path + who);
      assert.equal(r.json.code, 'not_member');
    }
    for (const who of [PLATFORM_STAFF, OWNER_M, OWNER_S]) {
      const r = await call(fake, path, who);
      assert.equal(r.status, 403, path + who);
      assert.equal(r.json.code, 'not_stock_company');
    }
    assert.equal((await call(fake, path, null)).status, 401);
  }
  assert.equal((await call(fake, '/stock/items', FACTORY_OWNER)).status, 200, '다담 공장은 쓴다');
});

// ── 목록 ──────────────────────────────────────────────────────

test('품목 목록 — 내 업체 것만. 대표는 숨긴 품목 · 공급처 목록도, 직원은 쓰는 품목만', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/stock/items', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const d = r.json.data;
  assert.deepEqual(d.company, { id: A, name: '가나 인테리어' });
  assert.equal(d.can_manage, true);
  assert.deepEqual(d.suppliers, [{ id: SUP_A, name: '철물 업체 C' }], '거래처(partner) · 남의 공급처는 없다');
  assert.deepEqual(d.items.map((i) => i.id).sort(), [HINGE, OLD, RAIL].sort());
  const hinge = d.items.find((i) => i.id === HINGE);
  assert.deepEqual(hinge, {
    unit_price: 850,
    id: HINGE, kind: 'hardware', name: '경첩 110° 연결형', spec: '35 컵', unit: '개', qty: 40, safety_qty: 120, short: true,
    supplier: { id: SUP_A, name: '철물 업체 C' }, expected_qty: 100, expected_on: '2026-11-15', memo: null, active: true, updated_at: at(1),
  });
  assert.equal(d.items.find((i) => i.id === RAIL).short, false);
  assert.equal(d.items.find((i) => i.id === OLD).short, false, '숨긴 품목은 부족으로 세지 않는다');
  assert.equal(JSON.stringify(d).includes(PB_B), false);

  const s = (await call(fake, '/stock/items?kind=hardware', STAFF_A)).json.data;
  assert.equal(s.can_manage, false);
  assert.deepEqual(s.suppliers, []);
  assert.deepEqual(s.items.map((i) => i.id).sort(), [HINGE, RAIL].sort());
  assert.equal((await call(fake, '/stock/items?kind=board', STAFF_A)).json.data.items.length, 0, '숨긴 판재는 직원에게 없다');
  assert.equal((await call(fake, '/stock/items?kind=nope', OWNER_A)).status, 422);
  assert.equal(writesOf(fake).length, 0);
});

// ── 더하기 · 고치기 ───────────────────────────────────────────

test('품목 더하기 — 대표 · 실장만. 처음 수량은 실사 조정 기록으로 들어간다', async () => {
  const fake = fakeOf();
  const body = { kind: 'hardware', name: '손잡이 바 160', spec: '블랙', unit: '개', safety_qty: 40, supplier_id: SUP_A, qty: 64 };
  const no = await post(fake, '/stock/items', body, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');
  const r = await post(fake, '/stock/items', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.qty, 64);
  assert.deepEqual(r.json.data.supplier, { id: SUP_A, name: '철물 업체 C' });
  const row = fake.db.stock_items.find((i) => i.name === '손잡이 바 160');
  assert.equal(row.company_id, A);
  assert.equal(row.created_by, OWNER_A);
  const mv = fake.db.stock_moves.at(-1);
  assert.deepEqual([mv.item_id, mv.kind, mv.qty, mv.note, mv.actor_user_id], [row.id, 'adjust', 64, '처음 수량', OWNER_A]);

  const plain = await post(fake, '/stock/items', { kind: 'board', name: 'MDF 18T', unit: '장' });
  assert.equal(plain.status, 201);
  assert.equal(fake.box.rpc, 1, '처음 수량이 없으면 기록을 넣지 않는다');
});

test('품목 더하기 — 남의 공급처 · 거래처 id 는 422, 같은 이름 · 규격은 409 duplicate', async () => {
  const fake = fakeOf({
    before: (m, t, p, b) => (m === 'POST' && t === 'stock_items' && b.name === '겹침' ? json({ code: '23505', message: 'duplicate key' }, 409) : null),
  });
  for (const supplier_id of [SUP_B, PARTNER_A]) {
    const r = await post(fake, '/stock/items', { kind: 'board', name: 'PB', unit: '장', supplier_id });
    assert.equal(r.status, 422, supplier_id);
    assert.equal(r.json.details.field, 'supplier_id');
  }
  const dup = await post(fake, '/stock/items', { kind: 'board', name: '겹침', unit: '장' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'duplicate');
  assert.equal(fake.db.stock_items.length, 4);
});

test('품목 고치기 — 대표 · 실장만, 내 업체 것만(남의 것 404). 안전 재고 · 입고 예정 · 숨기기', async () => {
  const fake = fakeOf();
  assert.equal((await patch(fake, HINGE, { safety_qty: 150 }, STAFF_A)).status, 403);
  assert.equal((await patch(fake, PB_B, { safety_qty: 1 })).status, 404);
  assert.equal((await patch(fake, 'nope', { safety_qty: 1 })).status, 404);
  assert.equal(fake.db.stock_items.find((i) => i.id === PB_B).safety_qty, 0);

  const r = await patch(fake, HINGE, { safety_qty: 150, expected_qty: 80, expected_on: '2026-11-20', qty: 9999 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.safety_qty, r.json.data.expected_qty, r.json.data.expected_on, r.json.data.qty], [150, 80, '2026-11-20', 40]);
  assert.equal(fake.db.stock_items.find((i) => i.id === HINGE).qty, 40, '남은 수량은 고치기로 안 바뀐다');

  const clear = await patch(fake, HINGE, { expected_qty: null, expected_on: null, active: false });
  assert.deepEqual([clear.json.data.expected_qty, clear.json.data.active, clear.json.data.short], [null, false, false]);
  assert.equal((await patch(fake, HINGE, { supplier_id: SUP_B })).status, 422);
  assert.equal((await patch(fake, HINGE, {})).status, 422);
});

// ── 입출고 ────────────────────────────────────────────────────

test('입고 · 출고 — 직원도 적는다. 수량과 기록이 같이 바뀌고, 입고는 입고 예정을 줄인다', async () => {
  const fake = fakeOf();
  const r = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'in', qty: 60, note: '철물 업체 C' }, STAFF_A);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.item, { id: HINGE, qty: 100, expected_qty: 40, expected_on: '2026-11-15' });
  assert.deepEqual(
    { ...r.json.data.move, id: 0, created_at: 0 },
    { id: 0, kind: 'in', qty: 60, qty_after: 100, ref: null, note: '철물 업체 C', created_at: 0 }
  );
  const call1 = fake.calls.find((c) => c.table === 'rpc/stock_move');
  assert.deepEqual(call1.body, { p_company: A, p_item: HINGE, p_kind: 'in', p_qty: 60, p_ref: null, p_note: '철물 업체 C', p_actor: STAFF_A });

  const out = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'out', qty: 30, ref: 'W-2611-009' }, STAFF_A);
  assert.equal(out.json.data.item.qty, 70);
  assert.equal(out.json.data.move.ref, 'W-2611-009');
});

test('출고 — 남은 수량보다 많으면 422 (qty), 아무것도 안 바뀐다', async () => {
  const fake = fakeOf();
  const r = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'out', qty: 41 });
  assert.equal(r.status, 422);
  assert.equal(r.json.details.field, 'qty');
  assert.match(JSON.stringify(r.json), /남은 수량/);
  assert.equal(fake.db.stock_items.find((i) => i.id === HINGE).qty, 40);
  assert.equal(fake.db.stock_moves.length, 3);
});

test('실사 조정은 대표 · 실장만 · 남의 품목은 404 · 숨긴 품목은 409 inactive · 틀린 본문은 422', async () => {
  const fake = fakeOf();
  const no = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'adjust', qty: -5 }, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');
  const ok = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'adjust', qty: -5, note: '세어 보니 모자람' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.item.qty, 35);
  assert.equal((await post(fake, `/stock/items/${PB_B}/moves`, { kind: 'in', qty: 1 })).status, 404);
  assert.equal(fake.db.stock_items.find((i) => i.id === PB_B).qty, 12);
  const old = await post(fake, `/stock/items/${OLD}/moves`, { kind: 'in', qty: 1 });
  assert.equal(old.status, 409);
  assert.equal(old.json.code, 'inactive');
  assert.equal((await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'in', qty: 0 })).status, 422);
  assert.equal(fake.box.rpc, 1);
});

// ── 기록 ──────────────────────────────────────────────────────

test('입출고 기록 — 내 업체 것만 새 것부터. 품목 이름을 붙이고, 적은 사람은 지금 구성원 이름만 (계정 id 없음)', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/stock/moves', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.data.items;
  assert.deepEqual(items.map((i) => i.id), [rid(32), rid(31)]);
  assert.deepEqual(items[0], {
    id: rid(32), kind: 'out', qty: 160, qty_after: 40, ref: 'W-2611-005', note: null, created_at: at(8),
    item_id: HINGE, item_name: '경첩 110° 연결형', item_spec: '35 컵', unit: '개', by: null,
  });
  assert.equal(items[1].by, '김대표');
  const text = JSON.stringify(r.json);
  for (const secret of [OWNER_A, NOBODY, PB_B]) assert.equal(text.includes(secret), false);
  assert.equal((await call(fake, `/stock/moves?item=${RAIL}`, STAFF_A)).json.data.items.length, 0);
  assert.equal((await call(fake, `/stock/moves?item=${PB_B}`, STAFF_A)).json.data.items.length, 0, '남의 품목 기록은 없다');
  assert.equal((await call(fake, '/stock/moves?item=x', STAFF_A)).status, 422);
});

// ── DB 적용 전 ────────────────────────────────────────────────

test('DB 0059 적용 전이면 409 db_pending (표 · 함수가 없다)', async () => {
  const missing = (m, t) => (t.startsWith('stock_') ? json({ code: 'PGRST205', message: "Could not find the table 'public.stock_items'" }, 404) : null);
  const fake = fakeOf({ before: missing });
  for (const path of ['/stock/items', '/stock/moves']) {
    const r = await call(fake, path, OWNER_A);
    assert.equal(r.status, 409, path);
    assert.equal(r.json.code, 'db_pending');
  }
  const add = await post(fake, '/stock/items', { kind: 'board', name: 'PB', unit: '장' });
  assert.equal(add.json.code, 'db_pending');
  const noFn = fakeOf({ before: (m, t) => (t === 'rpc/stock_move' ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : null) });
  const mv = await post(noFn, `/stock/items/${HINGE}/moves`, { kind: 'in', qty: 1 });
  assert.equal(mv.status, 409);
  assert.equal(mv.json.code, 'db_pending');
});

// ── 단가 (DB 0061) ────────────────────────────────────────────

test('단가 — 대표 · 실장에게만 싣는다. 직원 답에는 칸이 없다', async () => {
  const fake = fakeOf();
  const o = (await call(fake, '/stock/items', OWNER_A)).json.data;
  assert.equal(o.priced, true);
  assert.equal(o.items.find((i) => i.id === HINGE).unit_price, 850);
  assert.equal(o.items.find((i) => i.id === RAIL).unit_price, null);
  const s = (await call(fake, '/stock/items', STAFF_A)).json;
  assert.equal(JSON.stringify(s).includes('unit_price'), false);
  assert.equal('priced' in s.data, false);
  assert.equal(fake.calls.filter((c) => c.table === 'stock_items').pop().params.get('select').includes('unit_price'), false, '직원 읽기는 단가 칸을 읽지도 않는다');
});

test('단가 — 더하기 · 고치기로 적는다. 비우면 지우고, 음수 · 소수 · 글자는 422', async () => {
  const fake = fakeOf();
  const add = await post(fake, '/stock/items', { kind: 'board', name: 'PB', unit: '장', unit_price: 18500 });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(fake.db.stock_items.at(-1).unit_price, 18500);
  const p = await patch(fake, HINGE, { unit_price: '900' });
  assert.equal(p.json.data.unit_price, 900);
  assert.equal((await patch(fake, HINGE, { unit_price: null })).json.data.unit_price, null);
  for (const bad of [-1, 10.5, 'abc', 100000001, {}]) {
    const r = await patch(fake, HINGE, { unit_price: bad });
    assert.equal(r.status, 422, String(bad));
    assert.equal(r.json.details.field, 'unit_price');
  }
  assert.throws(() => itemInput({ unit_price: -1 }, { partial: true }), /단가/);
});

test('DB 0061 적용 전(단가 칸 없음) — 재고는 단가 없이 그대로 돈다. 단가를 보내면 409 db_pending', async () => {
  const noCol = (m, t, params, body) => {
    if (t !== 'stock_items') return null;
    const sel = (params.get('select') || '').includes('unit_price');
    const sent = body && !Array.isArray(body) && 'unit_price' in body;
    return sel || sent ? json({ code: '42703', message: 'column stock_items.unit_price does not exist' }, 400) : null;
  };
  const fake = fakeOf({ before: noCol });
  const r = await call(fake, '/stock/items', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.priced, false);
  assert.equal(r.json.data.items.length, 3);
  assert.equal(JSON.stringify(r.json.data.items).includes('unit_price'), false);
  const ok = await patch(fake, HINGE, { safety_qty: 150 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const no = await patch(fake, HINGE, { unit_price: 900 });
  assert.equal(no.status, 409);
  assert.equal(no.json.code, 'db_pending');
  assert.match(JSON.stringify(no.json), /0061/);
  const mv = await post(fake, `/stock/items/${HINGE}/moves`, { kind: 'in', qty: 1 });
  assert.equal(mv.status, 201, JSON.stringify(mv.json));
});
