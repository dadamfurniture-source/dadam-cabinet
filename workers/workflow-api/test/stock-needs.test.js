/**
 * 작업지시 자재 ↔ 재고 — src/stock-needs.js 를 워커로 부른다.
 *   GET /stock/needs · PUT /stock/links · POST /stock/needs/:orderId/issue · GET /stock/needs/:orderId/offcuts
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 문서 · 스냅샷은 JSON 안쪽을 꺼내 읽으므로(중첩 ->)
 * 가짜가 그 두 표의 읽기를 before 훅에서 답한다. stock_issue() 도 DB 함수라 흉내 낸다. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { boardKey, hardwareKey, boardNeeds, hardwareNeeds, allocate, offcutCandidates, linkInput, issueInput, ISSUE_LINES_MAX } from '../src/stock-needs.js';
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

const PB15 = rid(1);
const HINGE = rid(2);
const RAIL = rid(3);
const ITEM_B = rid(4);
const D1 = rid(11);
const D2 = rid(12);
const D3 = rid(13);
const D_B = rid(14);
const S1 = rid(21);
const S2 = rid(22);
const O1 = rid(31);
const O2 = rid(32);
const O3 = rid(33);
const O_DONE = rid(34);
const O_B = rid(35);

const NOW = Date.parse('2026-11-12T03:00:00.000Z');
// 서버는 지금 시각을 Date.now() 로 읽는다 — 시험이 실제 날짜에 흔들리지 않게 고정한다 (파일마다 따로 도는 프로세스)
Date.now = () => NOW;
const HW = (qty) => [
  { category: '경첩', item: 'H052W-5 105도 저압 경첩', spec: '2구', qty, unit: 'EA', module: '#1' },
  { category: '경첩', item: 'H052W-5 105도 저압 경첩', spec: '2구', qty: 2, unit: 'EA', module: '#2' },
  { category: '레일', item: '언더 450', qty: 3, unit: '쌍' },
  { category: '기타', item: '실리콘', qty: 1, unit: 'EA' },
];
const PLAN = {
  summary: { sheetsByMaterial: { PB_15: 3, MDF_18: 1 } },
  sheets: [
    { no: 1, material: 'PB', thickness: 15 },
    { no: 2, material: 'MDF', thickness: 18 },
  ],
  offcuts: [
    { sheetNo: 1, kind: 'sheet', x: 0, y: 0, w: 1220, h: 640.4, free: 640 },
    { sheetNo: 1, kind: 'strip', x: 0, y: 0, w: 300, h: 550, free: 300 },
    { sheetNo: 2, kind: 'sheet', x: 0, y: 0, w: 410, h: 2000, free: 410 },
    { sheetNo: 9, kind: 'sheet', x: 0, y: 0, w: 900, h: 900, free: 900 },
  ],
};
/** 지금 작업지시서 — 설계 1 은 문서에 배치가 고정, 설계 2 는 스냅샷의 배치, 설계 3 은 문서 없음 */
const DOCS = [
  { design_id: D1, snapshot_id: S1, rev: 1, sheets: { PB_15: 9 }, plan: { summary: { sheetsByMaterial: { PB_15: 9 } } } },
  { design_id: D1, snapshot_id: S1, rev: 2, sheets: PLAN.summary.sheetsByMaterial, plan: PLAN },
  { design_id: D2, snapshot_id: S2, rev: 1, sheets: null, plan: null },
];
const SNAPS = [
  { id: S1, hardware: HW(10), sheets: { PB_15: 99 }, plan: null },
  { id: S2, hardware: HW(4), sheets: { PB_15: 2 }, plan: PLAN },
];

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
    orders: [
      { id: O1, company_id: A, order_no: 'W-2611-001', design_id: D1, status: 'in_production', ordered_at: '2026-11-03T00:00:00Z', customer_name: '김고객' },
      { id: O2, company_id: A, order_no: 'W-2611-002', design_id: D2, status: 'confirmed', ordered_at: '2026-11-01T00:00:00Z', customer_name: '박고객' },
      { id: O3, company_id: A, order_no: 'W-2611-003', design_id: D3, status: 'confirmed', ordered_at: '2026-11-05T00:00:00Z', customer_name: '이고객' },
      { id: O_DONE, company_id: A, order_no: 'W-2610-009', design_id: D1, status: 'delivered', ordered_at: '2026-10-01T00:00:00Z' },
      { id: O_B, company_id: B, order_no: 'B-1', design_id: D_B, status: 'confirmed', ordered_at: '2026-11-01T00:00:00Z' },
    ],
    designs: [
      { id: D1, name: '싱크대 ㄱ자', company_id: A },
      { id: D2, name: '붙박이장', company_id: A },
      { id: D3, name: '신발장', company_id: A },
    ],
    design_schedules: [
      { id: rid(41), design_id: D1, type: 'installation', status: 'scheduled', scheduled_at: '2026-11-20T01:00:00Z' },
      { id: rid(42), design_id: D2, type: 'installation', status: 'scheduled', scheduled_at: '2026-11-25T01:00:00Z' },
      { id: rid(43), design_id: D2, type: 'installation', status: 'cancelled', scheduled_at: '2026-11-10T01:00:00Z' },
    ],
    stock_items: [
      { id: PB15, company_id: A, kind: 'board', name: 'PB 15T', spec: '', unit: '장', qty: 4, expected_qty: null, active: true },
      { id: HINGE, company_id: A, kind: 'hardware', name: '경첩 105도', spec: '', unit: '개', qty: 14, expected_qty: 10, active: true },
      { id: RAIL, company_id: A, kind: 'hardware', name: '레일 450', spec: '', unit: '쌍', qty: 3, expected_qty: null, active: true },
      { id: ITEM_B, company_id: B, kind: 'board', name: 'B PB', spec: '', unit: '장', qty: 50, expected_qty: null, active: true },
    ],
    stock_links: [
      { id: rid(51), company_id: A, kind: 'board', match_key: 'B|PB|15', label: 'PB 15T', item_id: PB15, ignored: false },
      { id: rid(52), company_id: A, kind: 'hardware', match_key: 'H|경첩|H052W-5 105도 저압 경첩', label: '경첩 · H052W-5 105도 저압 경첩', item_id: HINGE, ignored: false },
      { id: rid(53), company_id: A, kind: 'hardware', match_key: 'H|기타|실리콘', label: '기타 · 실리콘', item_id: null, ignored: true },
      { id: rid(54), company_id: A, kind: 'hardware', match_key: 'H|옷봉|옛 옷봉', label: '옷봉 · 옛 옷봉', item_id: RAIL, ignored: false },
      { id: rid(55), company_id: B, kind: 'board', match_key: 'B|PB|15', label: 'PB 15T', item_id: ITEM_B, ignored: false },
    ],
    stock_issues: [],
    stock_moves: [],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ids = (v) => String(v || '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',');

function fakeOf(opts = {}) {
  const box = { rpc: [] };
  const fake = createFake({
    tables: tables(),
    nowMs: NOW,
    before(method, table, params, body) {
      if (opts.before) {
        const r = opts.before(method, table, params, body);
        if (r) return r;
      }
      if (method === 'GET' && table === 'design_documents') {
        const want = ids(params.get('design_id'));
        const rows = DOCS.filter((d) => want.includes(d.design_id)).sort((a, b) => b.rev - a.rev);
        return json(rows.map((d) => ({ design_id: d.design_id, snapshot_id: d.snapshot_id, rev: d.rev, sheets: d.sheets, plan: d.plan })));
      }
      if (method === 'GET' && table === 'design_snapshots') {
        const want = ids(params.get('id'));
        return json(SNAPS.filter((s) => want.includes(s.id)));
      }
      if (table !== 'rpc/stock_issue') return null;
      box.rpc.push(body);
      const db = box.fake.db;
      if (db.stock_issues.some((i) => i.order_id === body.p_order)) return json({ code: '23505', message: 'duplicate key' }, 409);
      const plan = [];
      for (const l of body.p_lines) {
        const item = db.stock_items.find((i) => i.id === l.item_id && i.company_id === body.p_company);
        if (!item) return json({ code: 'P0002', message: 'stock_move: 품목이 없습니다' }, 400);
        if (item.qty < l.qty) return json({ code: '22023', message: 'stock_move: 남은 수량보다 많이 뺄 수 없습니다' }, 400);
        plan.push([item, l.qty]);
      }
      for (const [item, q] of plan) {
        item.qty -= q;
        db.stock_moves.push({ id: rid(900 + db.stock_moves.length), company_id: body.p_company, item_id: item.id, kind: 'out', qty: q, ref_label: body.p_ref, actor_user_id: body.p_actor });
      }
      const row = { id: rid(800), company_id: body.p_company, order_id: body.p_order, line_count: body.p_lines.length, created_by: body.p_actor, created_at: new Date(NOW).toISOString() };
      db.stock_issues.push(row);
      return json(row);
    },
  });
  box.fake = fake;
  fake.box = box;
  return fake;
}

const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const put = (fake, body, token = OWNER_A) => call(fake, '/stock/links', token, { method: 'PUT', body });
const issue = (fake, order, body, token = STAFF_A) => call(fake, `/stock/needs/${order}/issue`, token, { method: 'POST', body });

// ── 순수 ──────────────────────────────────────────────────────

test('키 — 판재는 재질 + 두께, 철물은 분류 + 이름. 세로줄(|)은 키를 깨지 않게 바꾼다', () => {
  assert.deepEqual(boardKey('PB', 15), { key: 'B|PB|15', label: 'PB 15T' });
  assert.deepEqual(boardKey(' MDF ', '18'), { key: 'B|MDF|18', label: 'MDF 18T' });
  assert.equal(boardKey('', 18), null);
  assert.equal(boardKey('PB', 0), null);
  assert.deepEqual(hardwareKey('경첩', ' H052W-5  105도 '), { key: 'H|경첩|H052W-5 105도', label: '경첩 · H052W-5 105도' });
  assert.deepEqual(hardwareKey('', '옷봉'), { key: 'H||옷봉', label: '옷봉' });
  assert.equal(hardwareKey('경첩', ''), null);
  assert.equal(hardwareKey('a|b', 'c|d').key, 'H|a/b|c/d');
});

test('boardNeeds · hardwareNeeds — 요약에서 판재 장수, 철물은 같은 분류 + 이름끼리 더한다', () => {
  assert.deepEqual(boardNeeds({ PB_15: 3, MDF_18: 1.5, PET_OAK_18: 2, bad: 4, PB_9: 0 }), [
    { key: 'B|PB|15', label: 'PB 15T', kind: 'board', need: 3, unit: '장' },
    { key: 'B|MDF|18', label: 'MDF 18T', kind: 'board', need: 1.5, unit: '장' },
    { key: 'B|PET_OAK|18', label: 'PET_OAK 18T', kind: 'board', need: 2, unit: '장' },
  ]);
  assert.deepEqual(boardNeeds(null), []);
  assert.deepEqual(hardwareNeeds(HW(10)), [
    { key: 'H|경첩|H052W-5 105도 저압 경첩', label: '경첩 · H052W-5 105도 저압 경첩', kind: 'hardware', need: 12, unit: '개' },
    { key: 'H|레일|언더 450', label: '레일 · 언더 450', kind: 'hardware', need: 3, unit: '쌍' },
    { key: 'H|기타|실리콘', label: '기타 · 실리콘', kind: 'hardware', need: 1, unit: '개' },
  ]);
  assert.deepEqual(hardwareNeeds([null, { item: 'x', qty: 0 }, { category: 'c', qty: 3 }, 'x']), []);
});

test('allocate — 차례대로 채운다: 재고 있음 → 입고 예정 → 없음. 모자란 수주가 남은 것을 잡는다. 출고한 수주는 다시 잡지 않는다', () => {
  const need = (n) => [{ key: 'k', kind: 'hardware', label: 'k', need: n, unit: '개' }];
  const links = new Map([['k', { item_id: 'i', ignored: false }], ['skip', { item_id: null, ignored: true }]]);
  const items = () => new Map([['i', { qty: 10, expected_qty: 5 }]]);
  const run = (orders) => allocate(orders, links, items()).map((o) => [o.state, ...o.lines.map((l) => l.state)]);
  const o = (n, extra = {}) => ({ id: 'o' + n, issued: false, has_doc: true, needs: need(n), ...extra });
  assert.deepEqual(run([o(6), o(6), o(6)]), [['ok', 'ok'], ['expected', 'expected'], ['short', 'short']]);
  assert.deepEqual(run([o(20), o(1)]), [['short', 'short'], ['short', 'short']], '모자란 앞 수주가 남은 것을 잡는다');
  assert.deepEqual(run([o(8, { issued: true }), o(10)]), [['issued', 'ok'], ['ok', 'ok']]);
  assert.deepEqual(run([o(1, { has_doc: false, needs: [] })]), [['nodoc']]);
  const mixed = allocate([{ id: 'x', issued: false, has_doc: true, needs: [...need(1), { key: 'none', kind: 'board', label: 'n', need: 1, unit: '장' }, { key: 'skip', kind: 'hardware', label: 's', need: 1, unit: '개' }] }], links, items())[0];
  assert.deepEqual([mixed.state, ...mixed.lines.map((l) => l.state)], ['unlinked', 'ok', 'unlinked', 'ignored']);
  assert.equal(allocate([{ id: 'y', issued: false, has_doc: true, needs: [{ key: 'skip', kind: 'hardware', label: 's', need: 1, unit: '개' }] }], links, items())[0].state, 'ok');
});

test('offcutCandidates — 긴 변 600 · 짧은 변 400 이상만, 재질 · 두께는 그 원판 것', () => {
  assert.deepEqual(offcutCandidates(PLAN), [
    { material: 'PB', thickness_mm: 15, width_mm: 1220, height_mm: 640, sheet_no: 1 },
    { material: 'MDF', thickness_mm: 18, width_mm: 410, height_mm: 2000, sheet_no: 2 },
  ]);
  assert.deepEqual(offcutCandidates(null), []);
  assert.deepEqual(offcutCandidates({ offcuts: 'x' }), []);
});

test('linkInput · issueInput', () => {
  assert.deepEqual(linkInput({ key: 'B|PB|15', label: ' PB 15T ', item_id: PB15 }), { key: 'B|PB|15', kind: 'board', label: 'PB 15T', item_id: PB15, ignored: false });
  assert.deepEqual(linkInput({ key: 'H|기타|실리콘', ignored: true }), { key: 'H|기타|실리콘', kind: 'hardware', label: '기타 · 실리콘', item_id: null, ignored: true });
  assert.deepEqual(linkInput({ key: 'B|PB|15' }), { key: 'B|PB|15', kind: 'board', label: 'PB · 15', item_id: null, ignored: false });
  for (const bad of [null, {}, { key: 'X|a|b' }, { key: 'B|' }, { key: 'B|PB|15', item_id: 'x' }, { key: 'B|PB|15', item_id: PB15, ignored: true }, { key: 'H|' + 'x'.repeat(300) }])
    assert.throws(() => linkInput(bad), Error, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(issueInput({ lines: [{ item_id: PB15, qty: '3' }] }), [{ item_id: PB15, qty: 3 }]);
  const many = Array.from({ length: ISSUE_LINES_MAX + 1 }, (_, i) => ({ item_id: rid(500 + i), qty: 1 }));
  for (const bad of [null, {}, { lines: [] }, { lines: many }, { lines: [{ item_id: 'x', qty: 1 }] }, { lines: [{ item_id: PB15, qty: 0 }] }, { lines: [{ item_id: PB15, qty: 1 }, { item_id: PB15, qty: 1 }] }])
    assert.throws(() => issueInput(bad), Error, JSON.stringify(bad).slice(0, 60));
});

// ── 자재 상태 ─────────────────────────────────────────────────

test('누가 — 구성원이 아니면 not_member, Manager 는 not_stock_company, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  assert.equal((await call(fake, '/stock/needs', NOBODY)).json.code, 'not_member');
  assert.equal((await call(fake, '/stock/needs', OWNER_M)).json.code, 'not_stock_company');
  assert.equal((await call(fake, '/stock/needs', null)).status, 401);
});

test('자재 상태 — 진행 중 수주만, 납기 빠른 차례로 재고를 채운다. 고객 이름 · 금액은 없다', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/stock/needs', STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.can_manage, false);
  // 납기: O1 11-20 · O2 11-25(취소한 일정은 안 본다) · O3 일정 없음 → 수주한 날 11-05 가 가장 앞
  assert.deepEqual(d.orders.map((o) => [o.order_no, o.state, o.has_doc, o.has_plan]), [
    ['W-2611-003', 'nodoc', false, false],
    ['W-2611-001', 'unlinked', true, true],
    ['W-2611-002', 'short', true, true],
  ]);
  const o1 = d.orders[1];
  assert.deepEqual([o1.name, o1.status, o1.due, o1.issued], ['싱크대 ㄱ자', 'in_production', '2026-11-20T01:00:00Z', false]);
  // 문서에 고정된 배치(가장 높은 rev)를 쓴다 — 스냅샷의 99장이 아니다
  assert.deepEqual(o1.lines.map((l) => [l.label, l.need, l.unit, l.state, l.item && l.item.name]), [
    ['PB 15T', 3, '장', 'ok', 'PB 15T'],
    ['MDF 18T', 1, '장', 'unlinked', null],
    ['경첩 · H052W-5 105도 저압 경첩', 12, '개', 'ok', '경첩 105도'],
    ['레일 · 언더 450', 3, '쌍', 'unlinked', null],
    ['기타 · 실리콘', 1, '개', 'ignored', null],
  ]);
  assert.deepEqual(o1.lines[0].item, { id: PB15, name: 'PB 15T', spec: '', unit: '장', qty: 4 });
  // O2: 문서에 배치가 없어 스냅샷 것(2장) — PB 는 4 − 3 = 1 남아 모자람, 경첩은 14 − 12 = 2 + 입고 예정 10 으로 6개
  assert.deepEqual(d.orders[2].lines.slice(0, 3).map((l) => [l.label, l.need, l.state]), [
    ['PB 15T', 2, 'short'],
    ['경첩 · H052W-5 105도 저압 경첩', 6, 'expected'],
    ['레일 · 언더 450', 3, 'unlinked'],
  ]);
  assert.deepEqual(d.counts, { ok: 0, expected: 0, short: 1, unlinked: 1, nodoc: 1, issued: 0 });
  const text = JSON.stringify(r.json);
  for (const secret of ['김고객', '박고객', 'W-2610-009', 'B-1', ITEM_B, 'contract']) assert.equal(text.includes(secret), false, secret);
});

test('자재 목록 — 자재마다 필요한 양 · 수주 수 · 짝. 지금 수주에 안 나오는 짝도 싣는다', async () => {
  const fake = fakeOf();
  const m = (await call(fake, '/stock/needs', OWNER_A)).json.data.materials;
  assert.deepEqual(m.map((x) => [x.kind, x.label, x.need, x.orders, x.ignored, x.item && x.item.name]), [
    ['board', 'MDF 18T', 1, 1, false, null],
    ['board', 'PB 15T', 5, 2, false, 'PB 15T'],
    ['hardware', '경첩 · H052W-5 105도 저압 경첩', 18, 2, false, '경첩 105도'],
    ['hardware', '기타 · 실리콘', 2, 2, true, null],
    ['hardware', '레일 · 언더 450', 6, 2, false, null],
    ['hardware', '옷봉 · 옛 옷봉', 0, 0, false, '레일 450'],
  ]);
  assert.equal('qty' in m[1].item, false);
});

// ── 짝표 ──────────────────────────────────────────────────────

test('짝 정하기 — 대표 · 실장만. 넣고 · 바꾸고 · 다루지 않음 · 풀기', async () => {
  const fake = fakeOf();
  const no = await put(fake, { key: 'H|레일|언더 450', label: '레일 · 언더 450', item_id: RAIL }, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');
  const add = await put(fake, { key: 'H|레일|언더 450', label: '레일 · 언더 450', item_id: RAIL });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const row = fake.db.stock_links.at(-1);
  assert.deepEqual([row.company_id, row.kind, row.match_key, row.item_id, row.ignored, row.updated_by], [A, 'hardware', 'H|레일|언더 450', RAIL, false, OWNER_A]);
  const n = fake.db.stock_links.length;
  await put(fake, { key: 'H|레일|언더 450', ignored: true });
  assert.equal(fake.db.stock_links.length, n);
  assert.deepEqual([fake.db.stock_links.at(-1).item_id, fake.db.stock_links.at(-1).ignored], [null, true]);
  const off = await put(fake, { key: 'H|레일|언더 450' });
  assert.deepEqual(off.json.data, { key: 'H|레일|언더 450', item_id: null, ignored: false });
  assert.equal(fake.db.stock_links.length, n - 1);
  assert.equal(fake.db.stock_links.some((l) => l.company_id === B), true, '남의 짝은 그대로');
});

test('짝 정하기 — 남의 품목 · 종류가 다른 품목은 422', async () => {
  const fake = fakeOf();
  const other = await put(fake, { key: 'B|MDF|18', item_id: ITEM_B });
  assert.equal(other.status, 422);
  assert.equal(other.json.details.field, 'item_id');
  const kind = await put(fake, { key: 'B|MDF|18', item_id: HINGE });
  assert.equal(kind.status, 422);
  assert.match(JSON.stringify(kind.json), /기본 자재 품목/);
  assert.equal(fake.db.stock_links.length, 5);
});

// ── 출고 ──────────────────────────────────────────────────────

test('수주 자재 출고 — 직원도 한다. 한 번에 빼고 기록에 수주 번호가 남는다. 상태 목록에 「출고함」', async () => {
  const fake = fakeOf();
  const r = await issue(fake, O1, { lines: [{ item_id: PB15, qty: 3 }, { item_id: HINGE, qty: 12 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.order_no, r.json.data.lines], ['W-2611-001', 2]);
  assert.deepEqual(fake.box.rpc[0], { p_company: A, p_order: O1, p_ref: 'W-2611-001', p_lines: [{ item_id: PB15, qty: 3 }, { item_id: HINGE, qty: 12 }], p_actor: STAFF_A });
  assert.deepEqual(fake.db.stock_items.filter((i) => i.company_id === A).map((i) => i.qty), [1, 2, 3]);
  assert.deepEqual(fake.db.stock_moves.map((m) => [m.kind, m.qty, m.ref_label]), [['out', 3, 'W-2611-001'], ['out', 12, 'W-2611-001']]);
  const d = (await call(fake, '/stock/needs', STAFF_A)).json.data;
  assert.deepEqual(d.orders.find((o) => o.id === O1).state, 'issued');
  assert.equal(d.counts.issued, 1);
});

test('출고 — 같은 수주 두 번은 409 issued, 모자라면 422(아무것도 안 바뀜), 끝난 수주는 409 not_open, 남의 수주는 404', async () => {
  const fake = fakeOf();
  await issue(fake, O1, { lines: [{ item_id: PB15, qty: 1 }] });
  const again = await issue(fake, O1, { lines: [{ item_id: PB15, qty: 1 }] });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'issued');
  const short = await issue(fake, O2, { lines: [{ item_id: HINGE, qty: 1 }, { item_id: PB15, qty: 99 }] });
  assert.equal(short.status, 422);
  assert.match(JSON.stringify(short.json), /아무것도 빼지 않았습니다/);
  assert.equal(fake.db.stock_items.find((i) => i.id === HINGE).qty, 14);
  const done = await issue(fake, O_DONE, { lines: [{ item_id: PB15, qty: 1 }] });
  assert.equal(done.status, 409);
  assert.equal(done.json.code, 'not_open');
  assert.equal((await issue(fake, O_B, { lines: [{ item_id: PB15, qty: 1 }] })).status, 404);
  assert.equal((await issue(fake, 'nope', { lines: [{ item_id: PB15, qty: 1 }] })).status, 404);
  assert.equal((await issue(fake, O2, { lines: [{ item_id: ITEM_B, qty: 1 }] })).status, 422, '남의 품목');
  assert.equal((await issue(fake, O2, { lines: [] })).status, 422);
});

// ── 자투리 후보 ───────────────────────────────────────────────

test('자투리 후보 — 그 수주의 배치에서 남을 조각. 문서에 없으면 스냅샷의 배치, 남의 수주는 404', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/stock/needs/${O1}/offcuts`, STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, {
    order_no: 'W-2611-001',
    items: [
      { material: 'PB', thickness_mm: 15, width_mm: 1220, height_mm: 640, sheet_no: 1 },
      { material: 'MDF', thickness_mm: 18, width_mm: 410, height_mm: 2000, sheet_no: 2 },
    ],
  });
  assert.equal((await call(fake, `/stock/needs/${O2}/offcuts`, STAFF_A)).json.data.items.length, 2);
  assert.deepEqual((await call(fake, `/stock/needs/${O3}/offcuts`, STAFF_A)).json.data.items, []);
  assert.equal((await call(fake, `/stock/needs/${O_B}/offcuts`, STAFF_A)).status, 404);
});

test('DB 0063 적용 전이면 409 db_pending', async () => {
  const fake = fakeOf({ before: (m, t) => (t === 'stock_links' || t === 'stock_issues' ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  assert.equal((await call(fake, '/stock/needs', OWNER_A)).json.code, 'db_pending');
  assert.equal((await put(fake, { key: 'B|MDF|18', ignored: true })).json.code, 'db_pending');
  const noFn = fakeOf({ before: (m, t) => (t === 'rpc/stock_issue' ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : null) });
  assert.equal((await issue(noFn, O1, { lines: [{ item_id: PB15, qty: 1 }] })).json.code, 'db_pending');
});
