/**
 * 자재 가격표 (src/price-lists.js · planner-prices.js — DB 0070, 2026-11-18 사장님 「도어용 보드까지 색마다」)
 *
 *   올리기: 대표 · 실장만, 줄마다 검증(용도 · 글 길이 · 단가 · 색상명이나 코드), 줄을 다 넣은 뒤 ready
 *   지금 가격표: 공급처마다 가장 최근 ready 줄 — 넣다 만 것(loading) · 옛 것 · 다른 팩토리 것은 읽지 않는다
 *   플래너: 색 목록(몸통 · 우라 이름, 도어 코드) · 판재 단가(용도 · 색 · 두께가 맞고 값이 하나일 때만, 가격표 → 재고 → 생산 설정)
 * 사람 · 팩토리 · 색 · 값은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import worker from '../src/worker.js';
import { ForbiddenError, ValidationError, clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  BOARD_PRICE_KINDS, DOOR_CODE_RE, PRICE_ITEMS_MAX, PRICE_KINDS, PRICE_LIST_BODY_MAX_BYTES, PRICE_MAX, PRICE_TEXT_MAX,
  cleanPriceItem, currentPriceItems, currentPriceLists, listBoardPrice, listPriceItems, listPriceLists, priceColorsOf, priceLabelOf, thicknessOf, uploadPriceList,
} from '../src/price-lists.js';
import { plannerColors, plannerPrices, priceLines } from '../src/planner-prices.js';
import { COLOR_NAME_MAX, writeCompanySettings } from '../src/production/service.js';
import { DEFAULT_QUOTE } from '../src/production/standards.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P1 = 'f0000000-0000-4000-8000-0000000000b1';
const P2 = 'f0000000-0000-4000-8000-0000000000b2';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const OTHER_OWNER = 'a0000000-0000-4000-8000-000000000004';
const NOBODY = 'a0000000-0000-4000-8000-000000000009';
const u = (id) => ({ id });
const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

function makeDb({ tables = true } = {}) {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
      { id: P2, kind: 'partner', name: '다라 팩토리', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: P1, role: 'owner', status: 'active' },
      { user_id: STAFF, company_id: P1, role: 'staff', status: 'active' },
      { user_id: OTHER_OWNER, company_id: P2, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    company_settings: [],
    stock_links: [{ company_id: P1, match_key: 'B|PB|15', kind: 'board', item_id: 'it-pb15', ignored: false }],
    stock_items: [{ company_id: P1, id: 'it-pb15', unit: '장', unit_price: 30500 }],
    price_lists: tables ? [] : null,
    price_list_items: tables ? [] : null,
    clock: Date.parse('2026-11-18T00:00:00Z'),
    writes: [],
    failItems: false,
  };
}

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'not.is.null') return v !== null && v !== undefined;
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^eq\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  return String(v) === m[1];
}

/** 가짜 DB — 읽기(eq · 차례 · limit · offset) · 넣기 · 고치기. price_list_items 는 한 번에 PAGE_CAP 줄까지만 준다 (서버 한도 흉내) */
const PAGE_CAP = 1000;
async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    if (method === 'GET') {
      let rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      const ord = q.get('order');
      if (ord) {
        const [col, dir] = ord.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const offset = Number(q.get('offset')) || 0;
      const limit = Math.min(Number(q.get('limit')) || rows.length, table === 'price_list_items' ? PAGE_CAP : Infinity);
      return json(rows.slice(offset, offset + limit));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      if (table === 'company_settings') {
        const at = db.company_settings.findIndex((r) => r.company_id === list[0].company_id);
        if (at >= 0) db.company_settings[at] = { ...db.company_settings[at], ...list[0] };
        else db.company_settings.push(list[0]);
        return json([list[0]], 201);
      }
      if (table === 'price_list_items' && db.failItems) return json({ code: 'XX000', message: 'boom' }, 500);
      const out = list.map((r) => {
        const row = table === 'price_lists' ? { id: randomUUID(), state: 'loading', created_at: new Date((db.clock += 1000)).toISOString(), ...r } : { ...r };
        db[table].push(row);
        return row;
      });
      db.writes.push({ table, method, n: out.length });
      return json(out, 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const hit = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      hit.forEach((r) => Object.assign(r, patch));
      db.writes.push({ table, method, n: hit.length, patch });
      return json(hit, 200);
    }
    throw new Error(`unexpected ${method} ${s}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// 공급처 가격표의 꼴 — 몸통 PB 15T · 18T, 우라 MDF 2.7T, 도어 보드 18T, 엣지
const ITEMS = [
  { kind: 'body', category: '보드', product: 'PB(국산)', spec: '15T 솔리드', color_name: '화이트엠보', code: 'BS-01', size_text: '15*1220*2440', unit_price: 32000 },
  { kind: 'body', category: '보드', product: 'PB(국산)', spec: '18T 솔리드', color_name: '화이트엠보', code: 'BS-01', size_text: '18*1220*2440', unit_price: 34000 },
  { kind: 'body', category: '보드', product: 'PB(국산)', spec: '15T 항균', color_name: '항균 화이트', code: 'AM-50', size_text: '15*1220*2440', unit_price: 33000 },
  { kind: 'back', category: 'MDF', product: 'MDF 2.7T', spec: '솔리드', color_name: '화이트엠보', code: 'BS-01', size_text: '2.7*1220*2440', unit_price: 19500 },
  { kind: 'door', category: '보드', product: '슈프림', spec: 'PET(SM)', color_name: '매트 화이트', code: 'SM-01', size_text: '18*1220*2440', unit_price: 67000 },
  { kind: 'door', category: '보드', product: '프레스티지', spec: 'PP', color_name: '세이 오크', code: 'YPW-04', size_text: '18*1220*2440', unit_price: 98000 },
  { kind: 'door', category: '보드', product: '데코', spec: '-', color_name: '소문자 코드', code: 'dk-01', size_text: '18*1220*2440', unit_price: 63000 },
  { kind: 'edge', category: '에지', product: '에지 18mm 0.6T', spec: 'PVC', color_name: '화이트엠보', code: 'BS-01', size_text: '0.6*18*100', unit_price: 16500 },
  { kind: 'other', category: '핫멜트', product: '핫멜트', spec: '-', color_name: '', code: 'JK-702', size_text: '0*0*0', unit_price: 83000 },
];
const upload = (user, body) => uploadPriceList(ENV, { user: u(user), body });

test('줄 다듬기 — 용도 다섯 · 글 길이 · 색상명이나 코드 · 단가(정수 원) · 두께는 규격의 첫 숫자', () => {
  assert.deepEqual([...PRICE_KINDS], ['body', 'back', 'door', 'edge', 'other']);
  assert.deepEqual(cleanPriceItem({ kind: 'body', color_name: '  화이트   엠보 ', code: 'BS-01', size_text: '15*1220*2440', unit_price: '32,000' }, 0), {
    kind: 'body', category: '', product: '', spec: '', color_name: '화이트 엠보', code: 'BS-01', size_text: '15*1220*2440', unit_price: 32000, thickness: 15,
  });
  assert.equal(thicknessOf(undefined, '2.7*1220*2440'), 2.7);
  assert.equal(thicknessOf(undefined, '0.6*18*100'), 0.6);
  assert.equal(thicknessOf(undefined, '0*0*0'), null);
  assert.equal(thicknessOf(undefined, '18 x 1220 x 2440'), 18);
  assert.equal(thicknessOf(18, '15*1220*2440'), 18, '보낸 숫자가 먼저');
  assert.equal(thicknessOf(undefined, '규격 없음'), null);
  assert.equal(thicknessOf(500, ''), null);
  const bad = (raw, re) => assert.throws(() => cleanPriceItem(raw, 4), (e) => e instanceof ValidationError && re.test(e.message) && e.details.row === 5);
  bad({ kind: 'top', code: 'A', unit_price: 1 }, /5번째 줄: 용도는/);
  bad(null, /줄 모양이 아닙니다/);
  bad({ kind: 'body', unit_price: 1 }, /색상명이나 코드/);
  bad({ kind: 'body', code: 'A', unit_price: -1 }, /단가는/);
  bad({ kind: 'body', code: 'A', unit_price: 1.5 }, /단가는/);
  bad({ kind: 'body', code: 'A', unit_price: PRICE_MAX + 1 }, /단가는/);
  bad({ kind: 'body', code: 'A', unit_price: '' }, /단가는/);
  bad({ kind: 'body', code: 'A' }, /단가는/);
  bad({ kind: 'body', code: 'A'.repeat(PRICE_TEXT_MAX.code + 1), unit_price: 1 }, /code 는 40자까지/);
  bad({ kind: 'body', color_name: '가'.repeat(PRICE_TEXT_MAX.color_name + 1), unit_price: 1 }, /color_name 는 40자까지/);
  assert.equal(cleanPriceItem({ kind: 'other', code: 'A', unit_price: 0 }, 0).unit_price, 0);
});

test('올리기 — 대표 · 실장만, 줄을 다 넣은 뒤 ready · 다시 올리면 그 공급처의 지금 가격표가 바뀐다 (옛 것은 남는다)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await assert.rejects(() => upload(STAFF, { supplier: '가나 보드', items: ITEMS }), (e) => e instanceof ForbiddenError && e.code === 'not_manager');
    await assert.rejects(() => upload(NOBODY, { supplier: '가나 보드', items: ITEMS }), ForbiddenError);
    for (const body of [null, [], { items: ITEMS }, { supplier: ' ', items: ITEMS }, { supplier: '가'.repeat(41), items: ITEMS }, { supplier: '가나 보드' }, { supplier: '가나 보드', items: [] },
      { supplier: '가나 보드', items: Array.from({ length: PRICE_ITEMS_MAX + 1 }, () => ITEMS[0]) }, { supplier: '가나 보드', items: [ITEMS[0], { kind: 'x' }] }]) {
      await assert.rejects(() => upload(OWNER, body), ValidationError, JSON.stringify(body).slice(0, 60));
    }
    assert.equal(db.writes.length, 0, '틀린 본문은 아무것도 넣지 않는다');

    const r = await upload(OWNER, { supplier: ' 가나  보드 ', source_name: '가격표.xlsx', items: ITEMS });
    assert.deepEqual(r.company, { id: P1, name: '가나 팩토리' });
    assert.deepEqual([r.list.supplier, r.list.source_name, r.list.row_count], ['가나 보드', '가격표.xlsx', ITEMS.length]);
    assert.deepEqual(r.list.counts, { body: 3, back: 1, door: 3, edge: 1, other: 1 });
    // 넣는 차례 — 머리(loading) → 줄 → ready
    assert.deepEqual(db.writes.map((w) => `${w.table}:${w.method}`), ['price_lists:POST', 'price_list_items:POST', 'price_lists:PATCH']);
    assert.deepEqual(db.writes[2].patch, { state: 'ready' });
    const head = db.price_lists[0];
    assert.deepEqual([head.company_id, head.state, head.created_by, head.row_count], [P1, 'ready', OWNER, ITEMS.length]);
    assert.deepEqual(db.price_list_items.map((x) => x.seq), ITEMS.map((_, i) => i + 1));
    assert.ok(db.price_list_items.every((x) => x.list_id === head.id && x.company_id === P1));
    assert.deepEqual(db.price_list_items.map((x) => x.thickness), [15, 18, 15, 2.7, 18, 18, 18, 0.6, null]);

    // 같은 공급처를 다시 올림 → 새 것이 지금 가격표 · 다른 공급처는 따로
    await upload(OWNER, { supplier: '가나 보드', items: [ITEMS[0]] });
    await upload(OWNER, { supplier: '다른 공급처', items: [ITEMS[4]] });
    const lists = await currentPriceLists(ENV, P1);
    assert.deepEqual(lists.map((l) => [l.supplier, l.row_count]), [['다른 공급처', 1], ['가나 보드', 1]]);
    assert.equal(db.price_lists.length, 3, '옛 가격표는 지우지 않는다');
    const items = await currentPriceItems(ENV, P1);
    assert.deepEqual(items.map((x) => [x.supplier, x.code]), [['다른 공급처', 'SM-01'], ['가나 보드', 'BS-01']]);
    // 다른 팩토리에는 없다
    assert.deepEqual(await currentPriceItems(ENV, P2), []);
  });
});

test('올리기 — 줄을 넣다 실패하면 그 가격표는 loading 으로 남아 아무도 읽지 않는다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await upload(OWNER, { supplier: '가나 보드', items: [ITEMS[0]] });
    db.failItems = true;
    await assert.rejects(() => upload(OWNER, { supplier: '가나 보드', items: ITEMS }));
    assert.deepEqual(db.price_lists.map((l) => l.state), ['ready', 'loading']);
    const lists = await currentPriceLists(ENV, P1);
    assert.deepEqual(lists.map((l) => l.row_count), [1], '넣다 만 가격표는 지금 가격표가 아니다');
  });
});

test('많은 줄 — 500줄씩 넣고, 한 번에 1000줄만 주는 DB 에서도 다 읽는다', async () => {
  const db = makeDb();
  const many = Array.from({ length: 2300 }, (_, i) => ({ kind: 'body', color_name: `색 ${i + 1}`, code: `C-${i + 1}`, size_text: '15*1220*2440', unit_price: 30000 + i }));
  await withDb(db, async () => {
    await upload(OWNER, { supplier: '가나 보드', items: many });
    assert.deepEqual(db.writes.filter((w) => w.table === 'price_list_items').map((w) => w.n), [500, 500, 500, 500, 300]);
    const items = await currentPriceItems(ENV, P1);
    assert.equal(items.length, 2300);
    assert.deepEqual([items[0].seq, items[2299].seq, items[2299].unit_price], [1, 2300, 32299]);
  });
});

test('목록 — 지금 가격표와 줄 (대표 · 실장만 — 단가가 들어 있다), 용도 · 글로 거른다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    assert.deepEqual((await listPriceLists(ENV, { user: u(OWNER) })).lists, []);
    await upload(OWNER, { supplier: '가나 보드', source_name: 'a.xlsx', items: ITEMS });
    const lists = await listPriceLists(ENV, { user: u(OWNER) });
    assert.deepEqual(lists.lists.map((l) => [l.supplier, l.source_name, l.row_count, l.counts.door]), [['가나 보드', 'a.xlsx', 9, 3]]);
    await assert.rejects(() => listPriceLists(ENV, { user: u(STAFF) }), (e) => e instanceof ForbiddenError && e.code === 'not_manager');
    await assert.rejects(() => listPriceItems(ENV, { user: u(STAFF), query: {} }), ForbiddenError);
    const all = await listPriceItems(ENV, { user: u(OWNER), query: {} });
    assert.equal(all.total, 9);
    assert.deepEqual(Object.keys(all.items[0]), ['supplier', 'seq', 'kind', 'category', 'product', 'spec', 'color_name', 'code', 'size_text', 'thickness', 'unit_price']);
    assert.deepEqual(all.items[0], { supplier: '가나 보드', seq: 1, kind: 'body', category: '보드', product: 'PB(국산)', spec: '15T 솔리드', color_name: '화이트엠보', code: 'BS-01', size_text: '15*1220*2440', thickness: 15, unit_price: 32000 });
    assert.deepEqual((await listPriceItems(ENV, { user: u(OWNER), query: { kind: 'door' } })).items.map((x) => x.code), ['SM-01', 'YPW-04', 'dk-01']);
    assert.deepEqual((await listPriceItems(ENV, { user: u(OWNER), query: { q: 'bs-01' } })).items.map((x) => x.kind), ['body', 'body', 'back', 'edge']);
    assert.deepEqual((await listPriceItems(ENV, { user: u(OWNER), query: { q: '오크', limit: '1' } })).items.map((x) => x.code), ['YPW-04']);
    const cut = await listPriceItems(ENV, { user: u(OWNER), query: { limit: '2' } });
    assert.deepEqual([cut.total, cut.items.length], [9, 2]);
    for (const query of [{ kind: 'top' }, { limit: '0' }, { limit: '1001' }, { limit: 'x' }]) await assert.rejects(() => listPriceItems(ENV, { user: u(OWNER), query }), ValidationError);
    // 다른 팩토리 대표에게는 빈 목록
    assert.deepEqual((await listPriceLists(ENV, { user: u(OTHER_OWNER) })).lists, []);
    assert.equal((await listPriceItems(ENV, { user: u(OTHER_OWNER), query: {} })).total, 0);
  });
});

test('DB 0070 적용 전 — 올리기 · 목록은 409 db_pending, 플래너 쪽 읽기는 빈 목록', async () => {
  await withDb(makeDb({ tables: false }), async () => {
    await assert.rejects(() => upload(OWNER, { supplier: '가나 보드', items: ITEMS }), (e) => e.statusCode === 409 && e.code === 'db_pending' && /0070/.test(e.message));
    await assert.rejects(() => listPriceLists(ENV, { user: u(OWNER) }), (e) => e.code === 'db_pending');
    await assert.rejects(() => listPriceItems(ENV, { user: u(OWNER), query: {} }), (e) => e.code === 'db_pending');
    assert.deepEqual(await currentPriceItems(ENV, P1), []);
    const colors = await plannerColors(ENV, { user: u(STAFF) });
    assert.deepEqual([colors.body, colors.back, colors.door], [[], [], []]);
    const r = await plannerPrices(ENV, { user: u(OWNER), body: { boards: [{ material: 'PB', thickness: 15, kind: 'body', color: '화이트엠보 BS-01' }] } });
    assert.deepEqual(r.boards, [{ material: 'PB', thickness: 15, unit_price: 30500, unit: '장', source: 'stock' }]);
  });
});

test('순수 — 색 목록: 몸통 · 우라는 「색상명 코드」 이름, 도어는 코드가 엔진이 받는 꼴일 때만', () => {
  assert.equal(priceLabelOf({ color_name: '화이트엠보', code: 'BS-01' }), '화이트엠보 BS-01');
  assert.equal(priceLabelOf({ color_name: '', code: 'JK-702' }), 'JK-702');
  assert.equal(priceLabelOf({ color_name: '이름만', code: '' }), '이름만');
  const c = priceColorsOf(ITEMS);
  assert.deepEqual(c.body, ['화이트엠보 BS-01', '항균 화이트 AM-50'], '같은 색(15T · 18T)은 한 번');
  assert.deepEqual(c.back, ['화이트엠보 BS-01']);
  assert.deepEqual(c.door, [{ code: 'SM-01', name: '매트 화이트', group: '슈프림 PET(SM)' }, { code: 'YPW-04', name: '세이 오크', group: '프레스티지 PP' }]);
  assert.ok(!DOOR_CODE_RE.test('dk-01') && DOOR_CODE_RE.test('SM-01') && DOOR_CODE_RE.test('S100') && !DOOR_CODE_RE.test('1A'));
  // 너무 긴 이름은 플래너에서 고를 수 없어 뺀다
  const long = priceColorsOf([{ kind: 'body', color_name: '가'.repeat(30), code: 'B'.repeat(20), unit_price: 1 }]);
  assert.deepEqual(long.body, []);
  assert.ok(COLOR_NAME_MAX === 40);
  assert.deepEqual(priceColorsOf(null), { body: [], back: [], door: [] });
});

test('순수 — 판재 단가: 용도 · 색이 맞고 (몸통 · 도어는 두께도) 값이 하나일 때만', () => {
  const items = ITEMS.map((x, i) => cleanPriceItem(x, i));
  const price = (kind, thickness, color) => listBoardPrice(items, { kind, thickness, color });
  assert.deepEqual([...BOARD_PRICE_KINDS], ['body', 'back', 'door']);
  assert.deepEqual(price('body', 15, '화이트엠보 BS-01'), { unit_price: 32000, unit: '장' });
  assert.deepEqual(price('body', 18, '화이트엠보 BS-01'), { unit_price: 34000, unit: '장' });
  assert.deepEqual(price('body', 15, '항균 화이트 AM-50'), { unit_price: 33000, unit: '장' });
  assert.equal(price('body', 18, '항균 화이트 AM-50'), null, '그 두께의 줄이 없다');
  assert.equal(price('body', 15, '없는 색'), null);
  assert.equal(price('body', 15, ''), null, '색을 안 정한 줄');
  assert.equal(price('body', 15, 'BS-01'), null, '몸통은 이름으로 맞춘다 (코드만으로는 아니다)');
  // 우라 — BOM 은 3T, 가격표는 2.7T: 두께를 가리지 않는다
  assert.deepEqual(price('back', 3, '화이트엠보 BS-01'), { unit_price: 19500, unit: '장' });
  assert.deepEqual(price('back', 2.7, '화이트엠보 BS-01'), { unit_price: 19500, unit: '장' });
  // 도어 — 색 = 코드
  assert.deepEqual(price('door', 18, 'SM-01'), { unit_price: 67000, unit: '장' });
  assert.deepEqual(price('door', 18, 'YPW-04'), { unit_price: 98000, unit: '장' });
  assert.equal(price('door', 15, 'SM-01'), null);
  assert.equal(price('door', 18, '매트 화이트'), null, '도어는 코드로 맞춘다');
  assert.equal(price('edge', 0.6, '화이트엠보 BS-01'), null, '판재 종류만');
  assert.equal(price(undefined, 15, '화이트엠보 BS-01'), null);
  // 같은 색 · 두께에 값이 둘 (두 제품군을 다 몸통으로 정한 가격표) → 고르지 않는다
  const two = items.concat([cleanPriceItem({ kind: 'body', product: 'PB(수입)', color_name: '화이트엠보', code: 'BS-01', size_text: '15*1220*2440', unit_price: 30000 }, 0)]);
  assert.equal(listBoardPrice(two, { kind: 'body', thickness: 15, color: '화이트엠보 BS-01' }), null);
  // 값이 같으면 하나로 본다
  const same = items.concat([cleanPriceItem({ kind: 'body', product: 'PB(다른 줄)', color_name: '화이트엠보', code: 'BS-01', size_text: '15*1220*2440', unit_price: 32000 }, 0)]);
  assert.deepEqual(listBoardPrice(same, { kind: 'body', thickness: 15, color: '화이트엠보 BS-01' }), { unit_price: 32000, unit: '장' });
});

test('단가 차례 — 색까지 맞는 가격표 값 → 재고 → 생산 설정 (색이 없거나 가격표에 없는 색은 예전 그대로)', () => {
  const items = ITEMS.map((x, i) => cleanPriceItem(x, i));
  const stock = new Map([['B|PB|15', { unit_price: 30500, unit: '장' }]]);
  const r = priceLines({
    boards: [
      { material: 'PB', thickness: 15, kind: 'body', color: '화이트엠보 BS-01' },   // 가격표
      { material: 'PB', thickness: 15, kind: 'body', color: '없는 색' },             // 재고
      { material: 'PB', thickness: 15 },                                              // 재고 (색 없음 — 예전 본문)
      { material: 'PB', thickness: 18, kind: 'body', color: '화이트엠보 BS-01' },   // 가격표 (18T)
      { material: 'MDF', thickness: 3, kind: 'back', color: '화이트엠보 BS-01' },   // 가격표 (우라)
      { material: 'MDF', thickness: 18, kind: 'door', color: 'SM-01' },              // 가격표 (도어)
      { material: 'MDF', thickness: 18, kind: 'door', color: 'PET-WHT-M' },          // 생산 설정 (도어 외주 단가)
      { material: 'MDF', thickness: 18, kind: 'door', color: '' },                   // 생산 설정
    ],
  }, stock, DEFAULT_QUOTE, items);
  assert.deepEqual(r.boards.map((b) => [b.unit_price, b.source]), [
    [32000, 'list'], [30500, 'stock'], [30500, 'stock'], [34000, 'list'], [19500, 'list'], [67000, 'list'], [DEFAULT_QUOTE.doorSheet, 'settings'], [DEFAULT_QUOTE.doorSheet, 'settings'],
  ]);
  assert.ok(r.boards.every((b) => Object.keys(b).join() === 'material,thickness,unit_price,unit,source'), '색 · 용도는 답에 싣지 않는다 (보낸 차례로 맞춘다)');
  // 가격표를 주지 않으면 예전과 같다
  const old = priceLines({ boards: [{ material: 'PB', thickness: 15, kind: 'body', color: '화이트엠보 BS-01' }] }, stock, DEFAULT_QUOTE);
  assert.deepEqual(old.boards, [{ material: 'PB', thickness: 15, unit_price: 30500, unit: '장', source: 'stock' }]);
});

test('플래너 — 색 목록은 생산 설정 이름 뒤에 가격표 색 · 도어 색 목록 (직원도 읽는다, 단가는 없다) · 단가는 대표 · 실장만', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await writeCompanySettings(ENV, { companyId: P1, user: u(OWNER), body: { colors: { body: ['화이트', '화이트엠보 BS-01'], back: [] } } });
    await upload(OWNER, { supplier: '가나 보드', items: ITEMS });
    const c = await plannerColors(ENV, { user: u(STAFF) });
    assert.deepEqual(c.body, ['화이트', '화이트엠보 BS-01', '항균 화이트 AM-50'], '적은 이름이 먼저 · 같은 이름은 한 번');
    assert.deepEqual(c.back, ['화이트엠보 BS-01']);
    assert.deepEqual(c.door.map((d) => d.code), ['SM-01', 'YPW-04']);
    assert.ok(!JSON.stringify(c).includes('32000') && !JSON.stringify(c).includes('unit_price'), '색 목록에 단가가 없다');
    const body = { boards: [{ material: 'MDF', thickness: 18, kind: 'door', color: 'YPW-04' }, { material: 'PB', thickness: 15, kind: 'body', color: '화이트' }] };
    const priced = await plannerPrices(ENV, { user: u(OWNER), body });
    assert.deepEqual(priced.boards.map((b) => [b.unit_price, b.source]), [[98000, 'list'], [30500, 'stock']]);
    assert.deepEqual(await plannerPrices(ENV, { user: u(STAFF), body }), { money: false, company: { id: P1, name: '가나 팩토리' } });
    // 다른 팩토리는 그 가격표를 보지 못한다
    const other = await plannerColors(ENV, { user: u(OTHER_OWNER) });
    assert.deepEqual([other.body, other.door], [[], []]);
    const otherPrice = await plannerPrices(ENV, { user: u(OTHER_OWNER), body });
    assert.deepEqual(otherPrice.boards.map((b) => b.source), ['settings', 'settings']);
  });
});

test('라우트 · DB 와 같은 값 — 로그인이 있어야 한다, 본문 2MB 까지, 용도 · 한도가 0070 과 같다', async () => {
  const call = (path, init) => worker.fetch(new Request(`https://w.example${path}`, init), ENV, { waitUntil() {} });
  const st = await Promise.all([call('/planner/price-lists', { method: 'POST', body: '{}' }), call('/planner/price-lists'), call('/planner/price-lists/items')]);
  assert.deepEqual(st.map((r) => r.status), [401, 401, 401]);
  assert.equal(PRICE_LIST_BODY_MAX_BYTES, 2 * 1024 * 1024);
  const sql = fs.readFileSync(new URL('../../../database/migrations/0070_price_lists.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes(`CHECK (kind = ANY (ARRAY[${PRICE_KINDS.map((k) => `'${k}'::text`).join(', ')}]))`));
  assert.ok(sql.includes(`(row_count <= ${PRICE_ITEMS_MAX})`) && sql.includes(`(seq <= ${PRICE_ITEMS_MAX})`));
  assert.ok(sql.includes(`(unit_price <= ${PRICE_MAX})`));
  assert.ok(sql.includes(`(length(supplier) <= ${PRICE_TEXT_MAX.supplier})`) && sql.includes(`length(source_name) <= ${PRICE_TEXT_MAX.source_name}`));
  for (const k of ['category', 'product', 'spec', 'color_name', 'code', 'size_text']) assert.ok(sql.includes(`(length(${k}) <= ${PRICE_TEXT_MAX[k]})`), k);
});
