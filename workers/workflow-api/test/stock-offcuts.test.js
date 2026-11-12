/**
 * 재고 — 자투리 · 재고 숫자. src/stock-offcuts.js 를 워커로 부른다.
 *   GET|POST /stock/offcuts · PATCH /stock/offcuts/:id · GET /stock/offcuts/:id/events · POST /stock/offcuts/labels · GET /stock/summary
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { codeOf, labelUrl, offcutInput, offcutPatch, canMove, LABELS_MAX, SIDE_MAX, OFFCUT_OLD_DAYS, kstMonthOf } from '../src/stock-offcuts.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';
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
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const NOBODY = uid(90);
const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const M = cid(4);

const CUT1 = rid(1);
const CUT2 = rid(2);
const CUT3 = rid(3);
const CUT_OLD = rid(4);
const CUT_B = rid(5);

const NOW = Date.parse('2026-11-12T03:00:00.000Z');
// 서버는 지금 시각을 Date.now() 로 읽는다 — 시험이 실제 날짜에 흔들리지 않게 고정한다 (파일마다 따로 도는 프로세스)
Date.now = () => NOW;
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const cut = (id, company_id, seq, patch = {}) => ({
  id, company_id, seq, material: 'PB 화이트', thickness_mm: 18, width_mm: 820, height_mm: 460, place: 'A-2', state: 'left', memo: null,
  created_by: OWNER_A, created_at: daysAgo(seq), closed_at: null, ...patch,
});

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
      { id: M, kind: 'partner', name: '매니저 업체', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
    ],
    profiles: [{ id: STAFF_A, name: '이직원' }],
    stock_offcuts: [
      cut(CUT1, A, 1),
      cut(CUT2, A, 2, { state: 'reserved', material: 'PB 그레이', width_mm: 1240, height_mm: 380, place: 'A-3' }),
      cut(CUT3, A, 3, { state: 'used', closed_at: daysAgo(1) }),
      cut(CUT_OLD, A, 4, { created_at: daysAgo(OFFCUT_OLD_DAYS + 5), place: 'C-4' }),
      cut(CUT_B, B, 1),
    ],
    stock_offcut_events: [
      { id: rid(51), company_id: A, offcut_id: CUT1, type: 'added', detail: 'A-2', actor_user_id: STAFF_A, created_at: daysAgo(1) },
      { id: rid(52), company_id: A, offcut_id: CUT1, type: 'label', detail: null, actor_user_id: NOBODY, created_at: daysAgo(0.5) },
      { id: rid(53), company_id: B, offcut_id: CUT_B, type: 'added', detail: null, actor_user_id: OWNER_B, created_at: daysAgo(1) },
    ],
    stock_items: [
      { id: rid(61), company_id: A, kind: 'hardware', name: '경첩', spec: '', unit: '개', qty: 40, safety_qty: 120, expected_qty: 100, active: true, unit_price: 850 },
      { id: rid(62), company_id: A, kind: 'hardware', name: '레일', spec: '', unit: '쌍', qty: 30, safety_qty: 20, expected_qty: null, active: true },
      { id: rid(63), company_id: A, kind: 'board', name: 'PB 화이트', spec: '18T', unit: '장', qty: 126, safety_qty: 60, expected_qty: null, active: true, unit_price: 18500 },
      { id: rid(64), company_id: A, kind: 'board', name: 'PB 그레이', spec: '18T', unit: '장', qty: 0, safety_qty: 20, expected_qty: 30, active: true },
      { id: rid(65), company_id: A, kind: 'board', name: '옛 판재', spec: '', unit: '장', qty: 0, safety_qty: 9, expected_qty: null, active: false },
      { id: rid(66), company_id: B, kind: 'board', name: 'B 판재', spec: '', unit: '장', qty: 999, safety_qty: 0, expected_qty: null, active: true, unit_price: 99999 },
    ],
    // 지금 = 11-12 12:00 KST. 이번 달은 11-01 00:00 KST(= 10-31 15:00Z)부터
    stock_moves: [
      { id: rid(71), company_id: A, item_id: rid(63), kind: 'in', qty: 10, qty_after: 126, created_at: '2026-11-03T02:00:00.000Z' },
      { id: rid(72), company_id: A, item_id: rid(61), kind: 'in', qty: 100, qty_after: 140, created_at: '2026-10-31T15:00:00.000Z' },
      { id: rid(73), company_id: A, item_id: rid(63), kind: 'in', qty: 50, qty_after: 116, created_at: '2026-10-31T14:59:59.000Z' },
      { id: rid(74), company_id: A, item_id: rid(63), kind: 'out', qty: 4, qty_after: 122, created_at: '2026-11-04T02:00:00.000Z' },
      { id: rid(75), company_id: A, item_id: rid(63), kind: 'adjust', qty: 3, qty_after: 125, created_at: '2026-11-05T02:00:00.000Z' },
      { id: rid(76), company_id: A, item_id: rid(62), kind: 'in', qty: 20, qty_after: 30, created_at: '2026-11-06T02:00:00.000Z' },
      { id: rid(77), company_id: A, item_id: rid(62), kind: 'in', qty: 5, qty_after: 35, created_at: '2026-11-07T02:00:00.000Z' },
      { id: rid(78), company_id: A, item_id: rid(65), kind: 'in', qty: 2, qty_after: 2, created_at: '2026-11-08T02:00:00.000Z' },
      { id: rid(79), company_id: B, item_id: rid(66), kind: 'in', qty: 7, qty_after: 999, created_at: '2026-11-08T02:00:00.000Z' },
    ],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeOf = (opts = {}) => createFake({ tables: tables(), nowMs: NOW, ...opts });
const OWNER_ONLY = uid(15);
const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const post = (fake, path, body, token = STAFF_A) => call(fake, path, token, { method: 'POST', body });
const patch = (fake, id, body, token = STAFF_A) => call(fake, `/stock/offcuts/${id}`, token, { method: 'PATCH', body });
const NEW = { material: 'MDF', thickness_mm: 18, width_mm: 600, height_mm: 400, place: 'B-1', memo: 'W-2611-031 재단에서 남음' };

// ── 순수 ──────────────────────────────────────────────────────

test('codeOf · labelUrl — 번호는 네 자리, QR 주소에는 앱 주소와 번호만', () => {
  assert.equal(codeOf(1), 'S-0001');
  assert.equal(codeOf(581), 'S-0581');
  assert.equal(codeOf(12345), 'S-12345');
  assert.equal(labelUrl(581), 'https://dadamfurniture.com/segan/me.html?cut=581#stock-scrap');
});

test('offcutInput — 재질 · 두께 · 가로 · 세로가 있어야 한다. 한도를 넘으면 거절', () => {
  assert.deepEqual(offcutInput({ material: ' PB 화이트 ', thickness_mm: '18', width_mm: 820, height_mm: 460 }), {
    material: 'PB 화이트', thickness_mm: 18, width_mm: 820, height_mm: 460, place: null, memo: null,
  });
  assert.equal(offcutInput({ ...NEW, thickness_mm: 2.75 }).thickness_mm, 2.8);
  for (const bad of [null, {}, { ...NEW, material: ' ' }, { ...NEW, thickness_mm: 0 }, { ...NEW, thickness_mm: 101 }, { ...NEW, width_mm: 0 }, { ...NEW, width_mm: 820.5 }, { ...NEW, height_mm: SIDE_MAX + 1 }, { ...NEW, place: 'x'.repeat(21) }, { ...NEW, memo: 3 }])
    assert.throws(() => offcutInput(bad), Error, JSON.stringify(bad));
});

test('offcutPatch · canMove — 상태 · 자리 · 메모만. 씀 · 버림에서는 못 돌아온다', () => {
  assert.deepEqual(offcutPatch({ state: 'used', width_mm: 1, material: 'x', seq: 9 }), { state: 'used' });
  assert.deepEqual(offcutPatch({ place: ' C-4 ', memo: '' }), { place: 'C-4', memo: null });
  for (const bad of [null, {}, { state: 'gone' }, { width_mm: 3 }]) assert.throws(() => offcutPatch(bad), Error, JSON.stringify(bad));
  assert.equal(canMove('left', 'reserved'), true);
  assert.equal(canMove('reserved', 'left'), true);
  assert.equal(canMove('reserved', 'discarded'), true);
  assert.equal(canMove('used', 'left'), false);
  assert.equal(canMove('discarded', 'used'), false);
  assert.equal(canMove('used', 'used'), true);
});

// ── 누가 ──────────────────────────────────────────────────────

test('구성원이 아니면 not_member, 다담 본사 · Manager 는 not_stock_company, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  for (const path of ['/stock/offcuts', '/stock/summary', `/stock/offcuts/${CUT1}/events`]) {
    assert.equal((await call(fake, path, NOBODY)).json.code, 'not_member', path);
    for (const who of [PLATFORM_STAFF, OWNER_M]) assert.equal((await call(fake, path, who)).json.code, 'not_stock_company', path);
    assert.equal((await call(fake, path, null)).status, 401);
  }
  assert.equal((await call(fake, '/stock/offcuts', FACTORY_OWNER)).status, 200);
});

// ── 목록 · 등록 ───────────────────────────────────────────────

test('목록 — 내 업체 조각만 새 것부터, 번호를 S-0001 꼴로', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/stock/offcuts', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.can_manage, false);
  assert.deepEqual(r.json.data.items.map((i) => i.code), ['S-0001', 'S-0002', 'S-0003', 'S-0004']);
  assert.deepEqual(r.json.data.items[1], {
    id: CUT2, code: 'S-0002', material: 'PB 그레이', thickness_mm: 18, width_mm: 1240, height_mm: 380, place: 'A-3', state: 'reserved', memo: null,
    created_at: daysAgo(2), closed_at: null,
  });
  assert.equal(JSON.stringify(r.json).includes(CUT_B), false);
  assert.equal(JSON.stringify(r.json).includes(OWNER_A), false, '등록한 사람 id 는 싣지 않는다');
});

test('등록 — 직원도 한다. 번호는 그 업체의 다음 차례, 「등록」 기록이 남는다', async () => {
  const fake = fakeOf();
  const r = await post(fake, '/stock/offcuts', NEW);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.code, 'S-0005');
  const row = fake.db.stock_offcuts.at(-1);
  assert.deepEqual([row.company_id, row.seq, row.material, row.width_mm, row.created_by], [A, 5, 'MDF', 600, STAFF_A]);
  const ev = fake.db.stock_offcut_events.at(-1);
  assert.deepEqual([ev.company_id, ev.offcut_id, ev.type, ev.detail, ev.actor_user_id], [A, row.id, 'added', 'B-1', STAFF_A]);
  const b = await post(fake, '/stock/offcuts', NEW, OWNER_B);
  assert.equal(b.json.data.code, 'S-0002', '번호는 업체마다 따로');
  assert.equal((await post(fake, '/stock/offcuts', { ...NEW, width_mm: 0 })).status, 422);
});

test('등록 — 번호가 겹치면(동시에 등록) 다시 읽어 넣는다. 계속 겹치면 409 busy', async () => {
  let hits = 0;
  const once = fakeOf({
    before: (m, t) => (m === 'POST' && t === 'stock_offcuts' && hits++ === 0 ? json({ code: '23505', message: 'duplicate key' }, 409) : null),
  });
  const r = await post(once, '/stock/offcuts', NEW);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(hits, 2);
  const always = fakeOf({ before: (m, t) => (m === 'POST' && t === 'stock_offcuts' ? json({ code: '23505', message: 'duplicate key' }, 409) : null) });
  const no = await post(always, '/stock/offcuts', NEW);
  assert.equal(no.status, 409);
  assert.equal(no.json.code, 'busy');
  assert.equal(always.db.stock_offcut_events.length, 3, '기록도 남기지 않는다');
});

// ── 바꾸기 ────────────────────────────────────────────────────

test('바꾸기 — 예약 · 씀 · 자리 옮김. 바뀐 것마다 기록이 남고, 크기는 안 바뀐다', async () => {
  const fake = fakeOf();
  const r = await patch(fake, CUT1, { state: 'reserved', place: 'C-4', width_mm: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.state, r.json.data.place, r.json.data.width_mm], ['reserved', 'C-4', 820]);
  assert.deepEqual(fake.db.stock_offcut_events.slice(-2).map((e) => [e.type, e.detail, e.actor_user_id]), [['reserved', null, STAFF_A], ['moved', 'A-2 → C-4', STAFF_A]]);
  await patch(fake, CUT1, { state: 'left' });
  assert.equal(fake.db.stock_offcut_events.at(-1).type, 'released');
  await patch(fake, CUT1, { state: 'used' });
  assert.equal(fake.db.stock_offcut_events.at(-1).type, 'used');
  const n = fake.db.stock_offcut_events.length;
  const same = await patch(fake, CUT2, { state: 'reserved', place: 'A-3' });
  assert.equal(same.status, 200);
  assert.equal(fake.db.stock_offcut_events.length, n, '같은 값이면 쓰지 않는다');
});

test('바꾸기 — 쓴 조각은 409 closed, 남의 조각 · 없는 id 는 404, 틀린 본문은 422', async () => {
  const fake = fakeOf();
  const closed = await patch(fake, CUT3, { state: 'left' });
  assert.equal(closed.status, 409);
  assert.equal(closed.json.code, 'closed');
  assert.equal((await patch(fake, CUT_B, { state: 'used' })).status, 404);
  assert.equal(fake.db.stock_offcuts.find((c) => c.id === CUT_B).state, 'left');
  assert.equal((await patch(fake, 'nope', { state: 'used' })).status, 404);
  assert.equal((await patch(fake, CUT1, { state: 'gone' })).status, 422);
  assert.equal((await patch(fake, CUT1, {})).status, 422);
});

// ── 기록 · 라벨 ───────────────────────────────────────────────

test('기록 — 그 조각 것만 새 것부터. 한 사람은 지금 구성원 이름만', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/stock/offcuts/${CUT1}/events`, OWNER_A);
  assert.deepEqual(r.json.data.items, [
    { type: 'label', detail: null, by: null, created_at: daysAgo(0.5) },
    { type: 'added', detail: 'A-2', by: '이직원', created_at: daysAgo(1) },
  ]);
  assert.equal((await call(fake, `/stock/offcuts/${CUT_B}/events`, OWNER_A)).status, 404);
});

test('라벨 — QR 그림과 주소를 준다. 주소에는 번호만. 조각마다 「라벨 인쇄」 기록', async () => {
  const fake = fakeOf();
  const r = await post(fake, '/stock/offcuts/labels', { ids: [CUT2, CUT1, CUT1] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const labels = r.json.data.labels;
  assert.deepEqual(labels.map((l) => l.code), ['S-0001', 'S-0002']);
  assert.equal(labels[1].url, 'https://dadamfurniture.com/segan/me.html?cut=2#stock-scrap');
  assert.match(labels[0].qr, /^<svg class="so-qr" viewBox="0 0 \d+ \d+"/);
  assert.equal(labels[0].qr.includes('PB'), false, 'QR 그림에 글자가 들어가지 않는다');
  assert.deepEqual([labels[1].material, labels[1].thickness_mm, labels[1].width_mm, labels[1].height_mm, labels[1].place], ['PB 그레이', 18, 1240, 380, 'A-3']);
  assert.deepEqual(fake.db.stock_offcut_events.slice(-2).map((e) => [e.offcut_id, e.type, e.actor_user_id]), [[CUT1, 'label', STAFF_A], [CUT2, 'label', STAFF_A]]);
});

test('라벨 — 남의 조각이 섞이면 404 (아무 기록도 없다), 비거나 너무 많거나 틀린 id 는 422', async () => {
  const fake = fakeOf();
  assert.equal((await post(fake, '/stock/offcuts/labels', { ids: [CUT1, CUT_B] })).status, 404);
  assert.equal(fake.db.stock_offcut_events.length, 3);
  for (const ids of [[], ['x'], null, Array.from({ length: LABELS_MAX + 1 }, (_, i) => rid(1000 + i))])
    assert.equal((await post(fake, '/stock/offcuts/labels', { ids })).status, 422, JSON.stringify(ids).slice(0, 30));
});

// ── 숫자 ──────────────────────────────────────────────────────

test('구매 · 재고 숫자 — 내 업체의 쓰는 품목 · 열린 조각만 센다', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/stock/summary', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, {
    short: { board: 1, hardware: 1 },
    expected: 2,
    offcuts: { left: 2, reserved: 1, old: 1 },
    boards: [
      { name: 'PB 화이트', spec: '18T', unit: '장', qty: 126 },
      { name: 'PB 그레이', spec: '18T', unit: '장', qty: 0 },
    ],
  });
});

test('DB 0059 적용 전이면 409 db_pending', async () => {
  const fake = fakeOf({ before: (m, t) => (t.startsWith('stock_') ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  for (const path of ['/stock/offcuts', '/stock/summary']) assert.equal((await call(fake, path, OWNER_A)).json.code, 'db_pending', path);
  assert.equal((await post(fake, '/stock/offcuts', NEW)).json.code, 'db_pending');
});

test('재고 금액 — 대표 · 실장에게만. 남은 수량 × 단가, 단가 없는 품목은 빼고 센다 (숨긴 품목 · 남의 업체 뺌)', async () => {
  const fake = fakeOf();
  const o = (await call(fake, '/stock/summary', OWNER_A)).json.data;
  // 경첩 40 × 850 = 34,000 · PB 화이트 126 × 18,500 = 2,331,000 · 레일(30개)은 단가 없음 · PB 그레이는 0장이라 세지 않는다
  assert.deepEqual(o.value, { total: 2365000, board: 2331000, hardware: 34000, unpriced: 1 });
  const s = (await call(fake, '/stock/summary', STAFF_A)).json;
  assert.equal(JSON.stringify(s).includes('value'), false);
  assert.equal(JSON.stringify(s).includes('unit_price'), false);
  assert.equal(OWNER_ONLY.length, 36);
});

test('이번 달 매입 — 대표 · 실장에게만. 이번 달(KST) 입고 × 지금 단가, 출고 · 실사 조정 · 지난달 · 남의 업체는 뺀다', async () => {
  assert.deepEqual(kstMonthOf(NOW), { month: '2026-11', fromIso: '2026-10-31T15:00:00.000Z' });
  assert.equal(kstMonthOf(Date.parse('2026-12-31T15:00:00.000Z')).month, '2027-01');
  const fake = fakeOf();
  const o = (await call(fake, '/stock/summary', OWNER_A)).json.data;
  // PB 화이트 10 × 18,500 = 185,000 · 경첩 100 × 850 = 85,000 (11-01 0시 KST 정각은 이번 달) · 레일(단가 없음) · 옛 판재(숨김)는 빼고 센다
  assert.deepEqual(o.bought, { month: '2026-11', total: 270000, unpriced: 2 });
  const s = (await call(fake, '/stock/summary', STAFF_A)).json;
  assert.equal(JSON.stringify(s).includes('bought'), false);
  const b = (await call(fake, '/stock/summary', OWNER_B)).json.data;
  assert.deepEqual(b.bought, { month: '2026-11', total: 699993, unpriced: 0 });
});

test('재고 금액 — DB 0061 적용 전이면 금액 없이 나머지 숫자만', async () => {
  const fake = fakeOf({
    before: (m, t, params) => (t === 'stock_items' && (params.get('select') || '').includes('unit_price') ? json({ code: '42703', message: 'column stock_items.unit_price does not exist' }, 400) : null),
  });
  const r = await call(fake, '/stock/summary', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal('value' in r.json.data, false);
  assert.equal('bought' in r.json.data, false);
  assert.deepEqual(r.json.data.short, { board: 1, hardware: 1 });
});
