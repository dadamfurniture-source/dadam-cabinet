/**
 * 밴드 재고 — src/stock-bands.js · src/stock-needs.js 밴드 줄 · 출고 뒤 「밴드 만들기」 요청 (2026-11-19 사장님 「빼기는 밴드 재고 운영,
 *   60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청.」). DB 함수 셋(stock_band_request · make · cancel)과
 *   stock_issue · stock_move 는 가짜가 흉내 낸다. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { bandStripsOf, bandItemRow, requestCode, needsRequest, colorName, colorLabel, BAND_COLOR_MAX } from '../src/stock-bands.js';
import { bandKey, bandNeeds } from '../src/stock-needs.js';
import { buildMessage, isValidMessage } from '../src/push/messages.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

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
const OWNER_B = uid(21);
const A = cid(1);
const B = cid(2);
const PB15 = rid(1);
const HINGE = rid(2);
const BAND_W = rid(3);
const D1 = rid(11);
const S1 = rid(21);
const O1 = rid(31);
const NOW = Date.parse('2026-11-20T03:00:00.000Z');
Date.now = () => NOW;

/** 지금 작업지시서 — 재고 밴드: 화이트 2본 · 색 없음 1본 */
const BANDS = [
  { material: 'PB', thickness: 15, color: '화이트', strips: 2, parts: [], cuts: [{ no: 1, pieces: [] }, { no: 2, pieces: [] }] },
  { material: 'PB', thickness: 15, color: '', strips: 1, parts: [], cuts: [{ no: 1, pieces: [] }] },
];

function tables({ mode = 'stock', bandQty = 10 } = {}) {
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    company_settings: [{ company_id: A, settings: { band: { mode }, colors: { body: ['화이트', '그레이'], back: [] } }, updated_at: '2026-11-20T00:00:00Z' }],
    orders: [{ id: O1, company_id: A, order_no: 'W-2611-010', design_id: D1, status: 'in_production', ordered_at: '2026-11-03T00:00:00Z' }],
    designs: [{ id: D1, name: '싱크대', company_id: A }],
    design_schedules: [],
    stock_items: [
      { id: PB15, company_id: A, kind: 'board', name: 'PB 15T', spec: '', unit: '장', qty: 4, expected_qty: null, active: true, band_color: null },
      { id: HINGE, company_id: A, kind: 'hardware', name: '경첩', spec: '', unit: '개', qty: 14, expected_qty: null, active: true, band_color: null },
      { id: BAND_W, company_id: A, kind: 'band', name: '밴드 60×2440', spec: 'PB 15T · 화이트', unit: '본', qty: bandQty, expected_qty: null, active: true, band_color: '화이트' },
    ],
    stock_links: [],
    stock_issues: [],
    stock_moves: [],
    stock_band_requests: [],
    notification_outbox: [],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ids = (v) => String(v || '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',');

function fakeOf(opts) {
  const box = { rpc: [] };
  const fake = createFake({
    tables: tables(opts),
    nowMs: NOW,
    before(method, table, params, body) {
      const db = box.fake.db;
      if (method === 'GET' && table === 'design_documents') {
        const want = ids(params.get('design_id'));
        return json(want.includes(D1) ? [{ design_id: D1, snapshot_id: S1, rev: 1, sheets: { PB_15: 1 }, bands: BANDS }] : []);
      }
      if (method === 'GET' && table === 'design_snapshots') return json([{ id: S1, hardware: [], sheets: null, bands: null }]);
      if (!table.startsWith('rpc/')) return null;
      box.rpc.push({ table, body });
      const move = (item, kind, q) => {
        if (kind === 'out' && item.qty < q) return false;
        item.qty += kind === 'out' ? -q : q;
        if (kind === 'in' && item.expected_qty != null) item.expected_qty = item.expected_qty - q > 0 ? item.expected_qty - q : null;
        db.stock_moves.push({ id: rid(900 + db.stock_moves.length), company_id: body.p_company, item_id: item.id, kind, qty: q });
        return true;
      };
      if (table === 'rpc/stock_issue') {
        for (const l of body.p_lines) {
          const item = db.stock_items.find((i) => i.id === l.item_id && i.company_id === body.p_company);
          if (!item || item.qty < l.qty) return json({ code: '22023', message: 'x' }, 400);
        }
        for (const l of body.p_lines) move(db.stock_items.find((i) => i.id === l.item_id), 'out', l.qty);
        const row = { id: rid(800), company_id: body.p_company, order_id: body.p_order, created_at: new Date(NOW).toISOString() };
        db.stock_issues.push(row);
        return json(row);
      }
      if (table === 'rpc/stock_move') {
        const item = db.stock_items.find((i) => i.id === body.p_item && i.company_id === body.p_company);
        if (!move(item, body.p_kind === 'adjust' ? 'in' : body.p_kind, body.p_qty)) return json({ code: '22023', message: 'x' }, 400);
        return json({ id: rid(700), company_id: body.p_company, item_id: item.id, kind: body.p_kind, qty: body.p_qty, qty_after: item.qty, created_at: new Date(NOW).toISOString() });
      }
      if (table === 'rpc/stock_band_request') {
        const item = db.stock_items.find((i) => i.id === body.p_item && i.company_id === body.p_company && i.kind === 'band' && i.active !== false);
        if (!item) return json({ code: 'P0002', message: 'x' }, 400);
        const open = db.stock_band_requests.find((r) => r.item_id === item.id && r.state === 'requested');
        if (open) return json(open);
        const seq = db.stock_band_requests.filter((r) => r.company_id === body.p_company).length + 1;
        const row = { id: rid(600 + db.stock_band_requests.length), company_id: body.p_company, seq, item_id: item.id, qty: body.p_qty, state: 'requested', created_at: new Date(NOW).toISOString(), closed_at: null };
        db.stock_band_requests.push(row);
        item.expected_qty = (item.expected_qty || 0) + body.p_qty;
        return json(row);
      }
      if (table === 'rpc/stock_band_make') {
        const req = db.stock_band_requests.find((r) => r.id === body.p_request && r.company_id === body.p_company);
        if (!req) return json({ code: 'P0002', message: 'x' }, 400);
        if (req.state !== 'requested') return json({ code: '22023', message: 'x' }, 400);
        const sheet = body.p_sheet_item ? db.stock_items.find((i) => i.id === body.p_sheet_item && i.kind === 'board') : null;
        if (body.p_sheet_item && !sheet) return json({ code: 'P0002', message: 'x' }, 400);
        if (sheet && sheet.qty < 1) return json({ code: '22023', message: 'x' }, 400);
        move(db.stock_items.find((i) => i.id === req.item_id), 'in', req.qty);
        if (sheet) move(sheet, 'out', 1);
        Object.assign(req, { state: 'made', sheet_item_id: body.p_sheet_item, closed_at: new Date(NOW).toISOString() });
        return json(req);
      }
      if (table === 'rpc/stock_band_cancel') {
        const req = db.stock_band_requests.find((r) => r.id === body.p_request && r.company_id === body.p_company);
        if (!req || req.state !== 'requested') return json({ code: '22023', message: 'x' }, 400);
        Object.assign(req, { state: 'cancelled', closed_at: new Date(NOW).toISOString() });
        return json(req);
      }
      return null;
    },
  });
  box.fake = fake;
  fake.box = box;
  return fake;
}

const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const bodyOf = async (r) => r.json.data;

// ── 순수 ──────────────────────────────────────────────────────

test('밴드 줄 · 품목 이름 · 요청 번호 · 「8개가 남으면」', () => {
  assert.deepEqual(bandStripsOf(BANDS.concat([{ color: '화이트', strips: 1 }, { color: 'x'.repeat(BAND_COLOR_MAX + 1), strips: 3 }, { color: '그레이', strips: 0 }, null])), [
    { color: '화이트', strips: 3 },
    { color: '', strips: 1 },
  ]);
  assert.deepEqual(bandNeeds(BANDS), [
    { key: 'S|화이트', label: '밴드 · 화이트', kind: 'band', need: 2, unit: '본' },
    { key: 'S|', label: '밴드 · 색 없음', kind: 'band', need: 1, unit: '본' },
  ]);
  assert.equal(bandKey('a|b').key, 'S|a/b');
  assert.deepEqual(bandItemRow(A, '화이트', { width: 60, length: 2440, material: 'PB', thickness: 15 }, OWNER_A), {
    company_id: A, kind: 'band', band_color: '화이트', name: '밴드 60×2440', spec: 'PB 15T · 화이트', unit: '본', created_by: OWNER_A,
  });
  assert.equal(requestCode(7), 'BM-0007');
  assert.deepEqual([needsRequest(8, 8), needsRequest(9, 8), needsRequest(0, 8)], [true, false, true]);
  assert.deepEqual([colorName('  화이트   오크 '), colorName(5), colorLabel('')], ['화이트 오크', null, '색 없음']);
  const m = buildMessage('stock_band_low', { color: '화이트', qty: 8, make: 18 });
  assert.deepEqual(m, { title: '밴드 만들기', body: '화이트 밴드가 8본 남았습니다. 18본을 만들어 주세요 — 재고에서 「만들었음」을 누르면 들어옵니다.', url: '/segan/me.html#stock-board' });
  assert.ok(isValidMessage(m));
  assert.equal(buildMessage('stock_band_low', { color: '', qty: 0, make: 18 }).body.startsWith('색 없음 밴드가 0본'), true);
  assert.equal(buildMessage('stock_band_low', { color: '화이트', qty: 8 }), null);
});

// ── 길 ────────────────────────────────────────────────────────

test('GET /stock/bands — 설정(빼기 · 60 × 2440 · 18 · 8) · 밴드 품목 · 열린 요청. 다른 팩토리 것은 없다', async () => {
  const fake = fakeOf({ bandQty: 8 });
  fake.db.stock_band_requests.push({ id: rid(601), company_id: A, seq: 1, item_id: BAND_W, qty: 18, state: 'requested', created_at: '2026-11-19T00:00:00Z', closed_at: null });
  const r = await call(fake, '/stock/bands', STAFF_A);
  assert.equal(r.status, 200);
  const d = await bodyOf(r);
  assert.equal(d.mode, 'stock');
  assert.deepEqual(d.band, { width: 60, length: 2440, material: 'PB', thickness: 15, base: 18, reorder: 8 });
  assert.equal(d.can_manage, false);
  assert.deepEqual(d.items.map((i) => [i.color, i.qty, i.short, i.request && i.request.code]), [['화이트', 8, true, 'BM-0001']]);
  assert.deepEqual(d.requests.map((x) => [x.code, x.color, x.state]), [['BM-0001', '화이트', 'requested']]);
  const other = await bodyOf(await call(fake, '/stock/bands', OWNER_B));
  assert.deepEqual([other.mode, other.items], ['place', []]);
});

test('POST /stock/bands/items — 대표 · 실장만, 몸통 색 목록 + 색 없음 가운데 없는 색만, 새 품목마다 18본 만들기 요청 + 알림', async () => {
  const fake = fakeOf();
  assert.equal((await call(fake, '/stock/bands/items', STAFF_A, { method: 'POST', body: {} })).status, 403);
  const r = await call(fake, '/stock/bands/items', MANAGER_A, { method: 'POST', body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const d = await bodyOf(r);
  assert.deepEqual(d.made.map((m) => m.color), ['그레이', '']);   // 화이트는 이미 있다
  assert.equal(d.skipped, 1);
  const bands = fake.db.stock_items.filter((i) => i.kind === 'band');
  assert.deepEqual(bands.map((i) => [i.band_color, i.spec, i.unit, i.qty || 0]), [['화이트', 'PB 15T · 화이트', '본', 10], ['그레이', 'PB 15T · 그레이', '본', 0], ['', 'PB 15T · 색 없음', '본', 0]]);
  assert.deepEqual(fake.db.stock_band_requests.map((x) => [x.seq, x.qty, x.state]), [[1, 18, 'requested'], [2, 18, 'requested']]);
  const notes = fake.db.notification_outbox;
  assert.ok(notes.length >= 2 && notes.every((n) => n.kind === 'stock_band_low'));
  assert.deepEqual([...new Set(notes.map((n) => n.user_id))].sort(), [OWNER_A, MANAGER_A].sort(), '대표 · 실장에게만');
  // 색을 주면 그 색만 · 다시 부르면 건너뛴다
  const again = await bodyOf(await call(fake, '/stock/bands/items', OWNER_A, { method: 'POST', body: { colors: ['그레이', '오크'] } }));
  assert.deepEqual([again.made.map((m) => m.color), again.skipped], [['오크'], 1]);
  assert.equal((await call(fake, '/stock/bands/items', OWNER_A, { method: 'POST', body: { colors: [] } })).status, 422);
});

test('만들었음 — 밴드 입고 + 원장 1장 출고, 끝난 요청은 409 · 원장이 모자라면 422 · 취소는 대표 · 실장', async () => {
  const fake = fakeOf({ bandQty: 2 });
  fake.db.stock_band_requests.push({ id: rid(601), company_id: A, seq: 1, item_id: BAND_W, qty: 18, state: 'requested', created_at: '2026-11-19T00:00:00Z', closed_at: null });
  fake.db.stock_band_requests.push({ id: rid(602), company_id: A, seq: 2, item_id: BAND_W, qty: 18, state: 'requested', created_at: '2026-11-19T00:00:00Z', closed_at: null });
  const r = await call(fake, `/stock/bands/requests/${rid(601)}/made`, STAFF_A, { method: 'POST', body: { sheet_item_id: PB15 } });
  assert.equal(r.status, 200);
  assert.deepEqual(await bodyOf(r), { id: rid(601), code: 'BM-0001', state: 'made', qty: 18 });
  assert.deepEqual([fake.db.stock_items.find((i) => i.id === BAND_W).qty, fake.db.stock_items.find((i) => i.id === PB15).qty], [20, 3]);
  assert.equal((await call(fake, `/stock/bands/requests/${rid(601)}/made`, STAFF_A, { method: 'POST', body: {} })).status, 409);
  fake.db.stock_items.find((i) => i.id === PB15).qty = 0;
  assert.equal((await call(fake, `/stock/bands/requests/${rid(602)}/made`, STAFF_A, { method: 'POST', body: { sheet_item_id: PB15 } })).status, 422);
  assert.equal((await call(fake, `/stock/bands/requests/${rid(602)}/made`, STAFF_A, { method: 'POST', body: { sheet_item_id: 'x' } })).status, 422);
  assert.equal((await call(fake, `/stock/bands/requests/${rid(602)}/cancel`, STAFF_A, { method: 'POST' })).status, 403);
  assert.equal((await call(fake, `/stock/bands/requests/${rid(602)}/cancel`, OWNER_A, { method: 'POST' })).status, 200);
  assert.equal((await call(fake, `/stock/bands/requests/${rid(999)}/made`, OWNER_B, { method: 'POST', body: {} })).status, 404);
});

test('작업 자재 — 재고 밴드 색마다 본 수 줄, 그 색 밴드 품목과 바로 짝 (없는 색은 짝 없음)', async () => {
  const fake = fakeOf();
  const d = await bodyOf(await call(fake, '/stock/needs', STAFF_A));
  const lines = d.orders[0].lines.filter((l) => l.kind === 'band');
  assert.deepEqual(lines.map((l) => [l.key, l.label, l.need, l.unit, l.state, l.item && l.item.id]), [
    ['S|화이트', '밴드 · 화이트', 2, '본', 'ok', BAND_W],
    ['S|', '밴드 · 색 없음', 1, '본', 'unlinked', null],
  ]);
  // 자재 목록 차례 — 판재 · 밴드 · 철물
  assert.deepEqual([...new Set(d.materials.map((m) => m.kind))], ['board', 'band']);
});

test('출고 뒤 — 밴드가 요청 수 이하로 남으면 「밴드 만들기」 요청 + 알림 (한 번만), 더하기 팩토리 · 남은 수가 많으면 없음', async () => {
  const fake = fakeOf({ bandQty: 10 });
  const r = await call(fake, `/stock/needs/${O1}/issue`, STAFF_A, { method: 'POST', body: { lines: [{ item_id: BAND_W, qty: 2 }, { item_id: PB15, qty: 1 }] } });
  assert.equal(r.status, 201);
  assert.equal((await bodyOf(r)).band_requests, 1);
  assert.deepEqual(fake.db.stock_band_requests.map((x) => [x.item_id, x.qty, x.state]), [[BAND_W, 18, 'requested']]);
  assert.ok(fake.db.notification_outbox.some((n) => n.kind === 'stock_band_low' && /화이트 밴드가 8본 남았습니다/.test(n.body)));
  // 입출고에서 한 본 더 빼도 요청은 하나
  const m = await call(fake, `/stock/items/${BAND_W}/moves`, STAFF_A, { method: 'POST', body: { kind: 'out', qty: 1 } });
  assert.equal(m.status, 201);
  assert.equal(fake.db.stock_band_requests.length, 1);
  // 더하기 팩토리 — 요청 없음
  const place = fakeOf({ mode: 'place', bandQty: 3 });
  await call(place, `/stock/items/${BAND_W}/moves`, STAFF_A, { method: 'POST', body: { kind: 'out', qty: 1 } });
  assert.equal(place.db.stock_band_requests.length, 0);
  // 남은 수가 많으면 없음
  const many = fakeOf({ bandQty: 30 });
  await call(many, `/stock/items/${BAND_W}/moves`, STAFF_A, { method: 'POST', body: { kind: 'out', qty: 1 } });
  assert.equal(many.db.stock_band_requests.length, 0);
});
