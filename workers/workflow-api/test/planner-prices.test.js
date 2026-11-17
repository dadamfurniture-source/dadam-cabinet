/**
 * 간편 플래너 BOM 요약 — 품목 단가 · 몸통 / 우라 색 목록 (src/planner-prices.js, 2026-11-17)
 *
 *   단가: 재고 단가(자재 잇기로 이어진 품목)가 먼저, 없으면 생산 설정 단가, 둘 다 없으면 단가 없음
 *   금액은 대표 · 실장(· 관리자)에게만 — 직원에게는 값이 실리지 않는다
 *   색 목록: 팩토리 대표 · 실장이 생산 설정에 적고, 플래너 구성원 누구나 읽는다. 색 칸이 없는 화면이 저장해도 지워지지 않는다
 * 사람 · 팩토리 · 값은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { ForbiddenError, ValidationError, clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { PRICE_LINES_MAX, SETTINGS_EDGE_T, SETTINGS_TOP_MATERIAL, plannerColors, plannerPrices, priceLines, stockPricesOf } from '../src/planner-prices.js';
import { COLOR_NAMES_MAX, COLOR_NAME_MAX, mergeSettings, sanitizeSettings, writeCompanySettings } from '../src/production/service.js';
import { DEFAULT_QUOTE } from '../src/production/standards.js';
import { HARDWARE_PRICE_KEYS, areaSheets, boardPriceKeyOf, hardwareCounts } from '../src/quote-sheet.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P1 = 'f0000000-0000-4000-8000-0000000000b1';
const P2 = 'f0000000-0000-4000-8000-0000000000b2';
const PM = 'f0000000-0000-4000-8000-0000000000b3';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const OTHER_OWNER = 'a0000000-0000-4000-8000-000000000004';
const M_OWNER = 'a0000000-0000-4000-8000-000000000005';
const NOBODY = 'a0000000-0000-4000-8000-000000000009';
const u = (id) => ({ id });

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

function makeDb({ stock = true, price = true } = {}) {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
      { id: P2, kind: 'partner', name: '다라 팩토리', plan: 'agent', status: 'active' },
      { id: PM, kind: 'partner', name: '마바 팩토리', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: P1, role: 'owner', status: 'active' },
      { user_id: MANAGER, company_id: P1, role: 'manager', status: 'active' },
      { user_id: STAFF, company_id: P1, role: 'staff', status: 'active' },
      { user_id: OTHER_OWNER, company_id: P2, role: 'owner', status: 'active' },
      { user_id: M_OWNER, company_id: PM, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    company_settings: [],
    stock_links: stock ? [
      { company_id: P1, match_key: 'B|PB|15', kind: 'board', item_id: 'it-pb15', ignored: false },
      { company_id: P1, match_key: 'B|MDF|3', kind: 'board', item_id: 'it-back', ignored: false },          // 단가를 안 적은 품목
      { company_id: P1, match_key: 'B|PB|18', kind: 'board', item_id: null, ignored: true },                 // 재고에서 다루지 않음
      { company_id: P1, match_key: 'H|경첩|H052W-5 105도 저압 경첩', kind: 'hardware', item_id: 'it-hinge', ignored: false },
      { company_id: P1, match_key: 'H|가스쇼바|가스쇼바 7kg', kind: 'hardware', item_id: 'it-gas', ignored: false },
      { company_id: P2, match_key: 'B|PB|15', kind: 'board', item_id: 'it-other', ignored: false },            // 남의 팩토리
    ] : null,
    stock_items: stock ? [
      { company_id: P1, id: 'it-pb15', unit: '장', unit_price: price ? 30500 : undefined },
      { company_id: P1, id: 'it-back', unit: '장', unit_price: price ? null : undefined },
      { company_id: P1, id: 'it-hinge', unit: '개', unit_price: price ? 520 : undefined },
      { company_id: P1, id: 'it-gas', unit: '개', unit_price: price ? 4200 : undefined },
      { company_id: P2, id: 'it-other', unit: '장', unit_price: price ? 99999 : undefined },
    ] : null,
    priceColumn: price,
    writes: [],
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
    // 단가 칸이 아직 없는 DB (0061 전)
    if (table === 'stock_items' && !db.priceColumn && (q.get('unit_price') || /unit_price/.test(q.get('select') || ''))) {
      return json({ code: '42703', message: 'column stock_items.unit_price does not exist' }, 400);
    }
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
    if (method === 'GET') return json(db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e))));
    if (method === 'POST' && table === 'company_settings') {
      const body = JSON.parse(init.body);
      const row = Array.isArray(body) ? body[0] : body;
      const at = db.company_settings.findIndex((r) => r.company_id === row.company_id);
      if (at >= 0) db.company_settings[at] = { ...db.company_settings[at], ...row };
      else db.company_settings.push(row);
      db.writes.push({ table, method });
      return json([row], 201);
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

const BODY = {
  boards: [
    { material: 'PB', thickness: 15 },   // 재고 단가가 있다
    { material: 'MDF', thickness: 3 },   // 재고에 이어져 있지만 단가를 안 적었다 → 생산 설정 (뒷판)
    { material: 'PB', thickness: 18 },   // 재고에서 다루지 않음 → 생산 설정 (PB)
    { material: 'MDF', thickness: 18 },  // 재고 없음 → 생산 설정 (도어)
    { material: '알루미늄 프레임 유리', thickness: 18 },   // 어디에도 없다
  ],
  hardware: [
    { category: '경첩', item: 'H052W-5 105도 저압 경첩' },   // 재고 단가
    { category: '레일', item: '문주 언더레일' },               // 생산 설정
    { category: '가스쇼바', item: '가스쇼바 7kg' },            // 재고 단가 (생산 설정에는 없는 분류)
    { category: '손잡이', item: '목찬넬' },                    // 어디에도 없다
  ],
  edge: [{ t: 0.6 }, { t: 1 }],
  tops: [{ material: '인조대리석', thickness: 12 }, { material: '세라믹', thickness: 12 }],
};

test('단가 — 재고 단가가 먼저, 없으면 생산 설정, 둘 다 없으면 단가 없음 (대표)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const r = await plannerPrices(ENV, { user: u(OWNER), body: BODY });
    assert.equal(r.money, true);
    assert.deepEqual(r.company, { id: P1, name: '가나 팩토리' });
    assert.equal(r.settings_missing, true, '저장된 생산 설정이 없다 — 기본값');
    assert.deepEqual(r.boards.map((b) => [b.material, b.thickness, b.unit_price, b.unit, b.source]), [
      ['PB', 15, 30500, '장', 'stock'],
      ['MDF', 3, DEFAULT_QUOTE.backSheet, '장', 'settings'],
      ['PB', 18, DEFAULT_QUOTE.pbSheet, '장', 'settings'],
      ['MDF', 18, DEFAULT_QUOTE.doorSheet, '장', 'settings'],
      ['알루미늄 프레임 유리', 18, null, null, null],
    ]);
    assert.deepEqual(r.hardware.map((h) => [h.category, h.unit_price, h.source]), [
      ['경첩', 520, 'stock'],
      ['레일', DEFAULT_QUOTE.rail, 'settings'],
      ['가스쇼바', 4200, 'stock'],
      ['손잡이', null, null],
    ]);
    assert.deepEqual(r.edge, [
      { t: 0.6, unit_price: DEFAULT_QUOTE.edgeRoll / DEFAULT_QUOTE.edgeRollMeters, unit: 'm', source: 'settings' },
      { t: 1, unit_price: null, unit: null, source: null },
    ]);
    assert.deepEqual(r.tops, [
      { material: '인조대리석', thickness: 12, unit_price: DEFAULT_QUOTE.countertopPerMeter, unit: 'm', source: 'settings' },
      { material: '세라믹', thickness: 12, unit_price: null, unit: null, source: null },
    ]);
    assert.equal(db.writes.length, 0, '읽기만 한다');
  });
});

test('단가 — 팩토리가 저장한 생산 설정 값을 쓴다, 남의 팩토리 재고 단가는 섞이지 않는다', async () => {
  const db = makeDb();
  db.company_settings.push({ company_id: P1, settings: { quote: { pbSheet: 28000, hinge: 500, edgeRoll: 20000, edgeRollMeters: 100 } }, updated_at: '2026-11-17T00:00:00Z' });
  await withDb(db, async () => {
    const r = await plannerPrices(ENV, { user: u(MANAGER), body: BODY });
    assert.equal(r.settings_missing, false);
    assert.equal(r.boards[0].unit_price, 30500, '재고 단가가 먼저다');
    assert.equal(r.boards[2].unit_price, 28000, 'PB 18T — 저장한 생산 설정');
    assert.equal(r.hardware[0].unit_price, 520, '경첩 — 재고 단가가 생산 설정(500)보다 먼저');
    assert.equal(r.edge[0].unit_price, 200);
    // 다른 팩토리 대표 — 자기 재고(99999)와 기본 설정만
    const other = await plannerPrices(ENV, { user: u(OTHER_OWNER), body: { boards: [{ material: 'PB', thickness: 15 }], hardware: [{ category: '경첩', item: 'H052W-5 105도 저압 경첩' }] } });
    assert.deepEqual([other.boards[0].unit_price, other.boards[0].source], [99999, 'stock']);
    assert.deepEqual([other.hardware[0].unit_price, other.hardware[0].source], [DEFAULT_QUOTE.hinge, 'settings']);
  });
});

test('금액은 대표 · 실장에게만 — 직원에게는 값이 실리지 않고 재고 · 설정을 읽지도 않는다', async () => {
  const db = makeDb();
  db.stock_links = undefined;   // 읽으면 「unexpected table」 로 던진다
  db.stock_items = undefined;
  await withDb(db, async () => {
    const r = await plannerPrices(ENV, { user: u(STAFF), body: BODY });
    assert.deepEqual(r, { money: false, company: { id: P1, name: '가나 팩토리' } });
    // 직원이 보내도 틀린 본문은 422
    await assert.rejects(() => plannerPrices(ENV, { user: u(STAFF), body: { boards: 'x' } }), ValidationError);
  });
  await withDb(makeDb(), async () => {
    await assert.rejects(() => plannerPrices(ENV, { user: u(NOBODY), body: BODY }), ForbiddenError);
  });
});

test('재고를 쓰지 않는 팩토리(Manager) · 재고 표나 단가 칸이 아직 없는 DB — 생산 설정 단가로', async () => {
  await withDb(makeDb(), async () => {
    const r = await plannerPrices(ENV, { user: u(M_OWNER), body: { boards: [{ material: 'PB', thickness: 15 }] } });
    assert.deepEqual([r.money, r.boards[0].unit_price, r.boards[0].source], [true, DEFAULT_QUOTE.pbSheet, 'settings']);
  });
  for (const opt of [{ stock: false }, { price: false }]) {
    await withDb(makeDb(opt), async () => {
      const r = await plannerPrices(ENV, { user: u(OWNER), body: { boards: [{ material: 'PB', thickness: 15 }], hardware: [{ category: '가스쇼바', item: '가스쇼바 7kg' }] } });
      assert.deepEqual([r.boards[0].unit_price, r.boards[0].source], [DEFAULT_QUOTE.pbSheet, 'settings'], JSON.stringify(opt));
      assert.deepEqual([r.hardware[0].unit_price, r.hardware[0].source], [null, null]);
    });
  }
  // 표가 없으면 빈 Map
  await withDb(makeDb({ stock: false }), async () => {
    assert.equal((await stockPricesOf(ENV, { id: P1, kind: 'partner', plan: 'expert', status: 'active' })).size, 0);
  });
});

test('본문 — 묶음마다 줄 목록, PRICE_LINES_MAX 까지, 비우면 빈 목록', async () => {
  await withDb(makeDb(), async () => {
    const r = await plannerPrices(ENV, { user: u(OWNER), body: {} });
    assert.deepEqual([r.boards, r.hardware, r.edge, r.tops], [[], [], [], []]);
    const many = Array.from({ length: PRICE_LINES_MAX + 1 }, () => ({ material: 'PB', thickness: 15 }));
    await assert.rejects(() => plannerPrices(ENV, { user: u(OWNER), body: { boards: many } }), ValidationError);
    await assert.rejects(() => plannerPrices(ENV, { user: u(OWNER), body: { hardware: [1] } }), ValidationError);
    await assert.rejects(() => plannerPrices(ENV, { user: u(OWNER), body: { edge: {} } }), ValidationError);
  });
});

test('priceLines — 생산 설정 단가는 견적이 가르는 조건 그대로 (판재 · 철물 다섯 · 0.6T 엣지 · 인조대리석 상판)', () => {
  const none = new Map();
  const r = priceLines({
    boards: [{ material: 'pb', thickness: 15 }, { material: 'PB(E0)', thickness: 18 }, { material: 'MDF', thickness: 2.7 }, { material: 'MDF', thickness: 9 }, { material: 'MDF', thickness: 15 }],
    hardware: Object.keys(HARDWARE_PRICE_KEYS).map((category) => ({ category, item: 'x' })).concat([{ category: '전기', item: '콘센트 2구' }]),
  }, none, DEFAULT_QUOTE);
  assert.deepEqual(r.boards.map((b) => b.unit_price), [DEFAULT_QUOTE.pbSheet, DEFAULT_QUOTE.pbSheet, DEFAULT_QUOTE.backSheet, null, DEFAULT_QUOTE.doorSheet]);
  assert.deepEqual(r.boards.map((b) => boardPriceKeyOf(b.material, b.thickness)), ['pbSheet', 'pbSheet', 'backSheet', null, 'doorSheet']);
  assert.deepEqual(r.hardware.map((h) => h.unit_price), [DEFAULT_QUOTE.hinge, DEFAULT_QUOTE.rail, DEFAULT_QUOTE.leg, DEFAULT_QUOTE.shelfPin, DEFAULT_QUOTE.rod, null]);
  assert.equal(SETTINGS_EDGE_T, 0.6);
  assert.equal(SETTINGS_TOP_MATERIAL, '인조대리석');
  // 견적의 장수 · 철물 셈이 같은 조건을 쓴다 — 값이 예전과 같다
  const bom = {
    materials: [
      { material: 'PB', thickness: 15, w: 1000, h: 1000, qty: 2 }, { material: 'MDF', thickness: 3, w: 1000, h: 1000, qty: 1 },
      { material: 'MDF', thickness: 18, w: 500, h: 1000, qty: 2 }, { material: 'MDF', thickness: 9, w: 1000, h: 1000, qty: 5 },
    ],
    hardware: [{ category: '경첩', qty: 4 }, { category: '레일', qty: 2 }, { category: '다리발', qty: 8 }, { category: '브라켓', qty: 16 }, { category: '옷봉', qty: 1 }, { category: '전기', qty: 3 }],
  };
  assert.deepEqual(areaSheets(bom, DEFAULT_QUOTE).areaM2, { pb: 2, back: 1, door: 1 });
  assert.deepEqual(hardwareCounts(bom), { hinge: 4, rail: 2, leg: 8, shelfPin: 16, rod: 1 });
});

test('색 목록 — 대표 · 실장이 생산 설정에 적고, 플래너 구성원 누구나 읽는다 (없으면 빈 목록)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    assert.deepEqual(await plannerColors(ENV, { user: u(STAFF) }), { company: { id: P1, name: '가나 팩토리' }, body: [], back: [], updated_at: null });
    await writeCompanySettings(ENV, { companyId: P1, user: u(OWNER), body: { colors: { body: ['화이트', ' 오크 ', '화이트', '라이트  그레이'], back: ['화이트'] } } });
    const r = await plannerColors(ENV, { user: u(STAFF) });
    assert.deepEqual([r.body, r.back], [['화이트', '오크', '라이트 그레이'], ['화이트']], '앞뒤 빈칸 · 겹친 이름 · 겹친 빈칸은 정리한다');
    // 색 칸이 없는 화면이 저장해도 목록은 그대로다 (장부 과세 묶음과 같은 방식)
    await writeCompanySettings(ENV, { companyId: P1, user: u(OWNER), body: { quote: { pbSheet: 31000 } } });
    assert.deepEqual((await plannerColors(ENV, { user: u(MANAGER) })).body, ['화이트', '오크', '라이트 그레이']);
    // 비우려면 빈 목록을 보낸다
    await writeCompanySettings(ENV, { companyId: P1, user: u(OWNER), body: { colors: { body: [], back: ['화이트'] } } });
    assert.deepEqual((await plannerColors(ENV, { user: u(STAFF) })).body, []);
    // 다른 팩토리 목록은 섞이지 않는다
    assert.deepEqual((await plannerColors(ENV, { user: u(OTHER_OWNER) })).back, []);
    await assert.rejects(() => plannerColors(ENV, { user: u(NOBODY) }), ForbiddenError);
  });
});

test('색 목록 검증 — 아는 묶음(body · back)만, 이름 1 ~ 40자, 100개까지', () => {
  assert.deepEqual(sanitizeSettings({ colors: { body: ['화이트'] } }), { colors: { body: ['화이트'] } });
  assert.deepEqual(mergeSettings({ colors: { body: ['a', 3, ' '], door: ['x'] } }).colors, { body: ['a'], back: [] });
  assert.deepEqual(mergeSettings(null).colors, { body: [], back: [] });
  assert.throws(() => sanitizeSettings({ colors: { door: ['x'] } }), /알 수 없는 설정: colors\.door/);
  assert.throws(() => sanitizeSettings({ colors: ['화이트'] }), ValidationError);
  assert.throws(() => sanitizeSettings({ colors: { body: '화이트' } }), ValidationError);
  assert.throws(() => sanitizeSettings({ colors: { body: [''] } }), ValidationError);
  assert.throws(() => sanitizeSettings({ colors: { body: [5] } }), ValidationError);
  assert.throws(() => sanitizeSettings({ colors: { body: ['가'.repeat(COLOR_NAME_MAX + 1)] } }), ValidationError);
  assert.throws(() => sanitizeSettings({ colors: { back: Array.from({ length: COLOR_NAMES_MAX + 1 }, (_, i) => `색${i}`) } }), ValidationError);
  assert.equal(sanitizeSettings({ colors: { back: Array.from({ length: COLOR_NAMES_MAX }, (_, i) => `색${i}`) } }).colors.back.length, COLOR_NAMES_MAX);
});

test('라우트 — POST /planner/prices · GET /planner/colors 는 로그인이 있어야 한다', async () => {
  const a = await worker.fetch(new Request('https://w.example/planner/prices', { method: 'POST', body: '{}' }), ENV, { waitUntil() {} });
  const b = await worker.fetch(new Request('https://w.example/planner/colors'), ENV, { waitUntil() {} });
  assert.deepEqual([a.status, b.status], [401, 401]);
});
