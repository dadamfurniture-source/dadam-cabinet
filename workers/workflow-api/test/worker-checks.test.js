/**
 * 작업자 꾸러미 · 필수 확인 (src/work/checks.js — DB 0035 work_checks, 정본 src/work/check-items.js).
 *
 *   공장: 승인 + 열린 공장 배정, 내 계획 주문만(아니면 404), 내 공정 꾸러미만(아니면 403 not_my_pack), 작업자 보기는 가린 주문 이름
 *   체크: 지금 문서 판만(409 superseded) · 내 역할만(403) · 목록 항목 · 있는 칸 · 도어 · 서랍 조건(422) · 쌓기만 · 0035 전 409 db_pending
 *   설치: 확정 배정만(403 not_confirmed), 시공 지시서는 주소 · 연락처 · 고객 실명이 없다
 *   본사: 설계를 볼 수 있는 사람이 역할 전부
 * 사람 · 주문 · 주소는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { FORBIDDEN_KEYS, SITE_NOTE } from '../src/work/reveal.js';
import { frozenCheckList } from '../src/work/check-items.js';
import {
  factoryPack, getFactoryChecks, postFactoryCheck, assignmentPack, getAssignmentChecks, postAssignmentCheck, getOrderChecks, cellsOf, PACKS_OF_ROLE,
} from '../src/work/checks.js';
import { HQ, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ_OWNER = 'a0000000-0000-4000-8000-000000000001';
const HQ_MANAGER = 'a0000000-0000-4000-8000-000000000002';
const U_CUT = 'b0000000-0000-4000-8000-000000000001';
const U_INSTALL = 'b0000000-0000-4000-8000-000000000002';
const W_CUT = 'd0000000-0000-4000-8000-000000000001';
const W_INSTALL = 'd0000000-0000-4000-8000-000000000002';
const O1 = 'e0000000-0000-4000-8000-000000000001';
const O2 = 'e0000000-0000-4000-8000-000000000002';
const DOC_WO = 'c3000000-0000-4000-8000-000000000002';
const DOC_OLD = 'c3000000-0000-4000-8000-000000000001';
const DOC_IO = 'c3000000-0000-4000-8000-000000000003';
const A_OK = 'c4000000-0000-4000-8000-000000000001';
const A_OFFER = 'c4000000-0000-4000-8000-000000000002';
const MEMBERS = [
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: HQ_MANAGER, company_id: HQ, role: 'manager', status: 'active' },
];

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const missing = () => ({ ok: false, status: 404, headers: { get: () => 'application/json' }, text: async () => '{"code":"PGRST205","message":"Could not find the table \'public.work_checks\' in the schema cache"}' });

const SHEET = (no) => ({
  no, material: 'PB', thickness: 15, partClass: '본체', size: { w: 1220, h: 2440 }, trim: 10,
  layout: { no: 1, stack: 1, index: 1, dir: 'H', rotated: false }, strips: [],
  parts: [{ partId: 'p1#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false, strip: 1 }], usedArea: 389400, yield: 0.13,
});

function makeDb(over = {}) {
  const wo = (id, rev, superseded) => ({
    id, design_id: 'D1', snapshot_id: 'S1', doc_type: 'work_order', rev, doc_no: `WO-${rev}`, status: 'issued', superseded_by: superseded,
    title: '홍길동 싱크대', created_at: '2026-11-04T00:00:00Z',
    render_payload: { work_order_version: 2, check_list: frozenCheckList('v0'), cut_plan: { version: 1, sheets: [SHEET(1), SHEET(2)], offcuts: [], groups: [], smallParts: [], unallocated: [], summary: {} } },
  });
  return {
    workers: [
      { id: W_CUT, user_id: U_CUT, display_name: '김재단', kinds: ['cutting', 'assembly'], status: 'approved' },
      { id: W_INSTALL, user_id: U_INSTALL, display_name: '이설치', kinds: ['install'], status: 'approved' },
    ],
    factory_workers: [{ id: randomUUID(), worker_id: W_CUT, plan_user_id: HQ_OWNER, ended_at: null }],
    orders: [
      { id: O1, order_no: 'SO-1', customer_name: '홍길동', design_id: 'D1', company_id: HQ },
      { id: O2, order_no: 'SO-2', customer_name: '김철수', design_id: 'D2', company_id: HQ },
    ],
    designs: [
      { id: 'D1', user_id: HQ_OWNER, company_id: HQ },
      { id: 'D2', user_id: HQ_MANAGER, company_id: HQ },
    ],
    design_documents: [
      wo(DOC_OLD, 1, DOC_WO),
      wo(DOC_WO, 2, null),
      {
        id: DOC_IO, design_id: 'D1', snapshot_id: 'S1', doc_type: 'installation_order', rev: 1, doc_no: 'IO-1', status: 'issued', superseded_by: null,
        title: '홍길동 싱크대', customer_name: '홍길동', created_at: '2026-11-04T00:00:00Z',
        render_payload: { check_list: frozenCheckList('v0'), site_info: { address: '서울시 시험구 1', address_detail: '101호', floor: '3', contact_name: '홍길동', contact_phone: '010-0000-0009' }, schedules: [{ type: 'install', scheduled_at: '2026-11-10T00:00:00Z', assignee_name: '다른기사', location: '서울시 시험구 1', status: 'planned' }] },
      },
    ],
    design_snapshots: [{
      id: 'S1', rev: 3, content_hash: 'h',
      design_payload: { items: [{ categoryId: 'sink', w: 1800, h: 870, d: 600, modules: [{ pos: 'lower', name: '도어장', w: 900, h: 708, doorCount: 2 }, { pos: 'lower', name: '서랍장', w: 900, h: 708, isDrawer: true }] }] },
      bom_payload: { materials: [{ partId: 'p1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 1 }] },
      cut_plan_payload: null,
    }],
    work_jobs: [{ id: 'J1', kind: 'install', order_id: O1, design_id: 'D1', status: 'in_progress', slots: 1 }],
    work_assignments: [
      { id: A_OK, job_id: 'J1', worker_id: W_INSTALL, status: 'confirmed' },
      { id: A_OFFER, job_id: 'J1', worker_id: W_INSTALL, status: 'offered' },
    ],
    work_checks: [],
    ...over,
  };
}

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|neq|in)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'neq') return String(v) !== m[2];
  return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(v));
}

async function withDb(db, fn, { noChecksTable = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    const hit = companyRoute(u, { members: MEMBERS }) || (u.includes('/admin_roles?') ? json([]) : null);
    if (hit) return hit;
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(u);
    if (!m || !db[m[1]]) throw new Error(`unexpected fetch ${method} ${u}`);
    const [, table, qs = ''] = m;
    if (noChecksTable && table === 'work_checks') return missing();
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    if (method === 'GET') {
      let rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      const ord = q.get('order');
      if (ord) {
        const [col, dir] = ord.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const row = { id: randomUUID(), created_at: new Date(Date.now() + db[table].length).toISOString(), ...body };
      db[table].push(row);
      return json([row], 201);
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const cut = { id: U_CUT };
const inst = { id: U_INSTALL };

function deepKeys(x, out = new Set()) {
  if (Array.isArray(x)) x.forEach((v) => deepKeys(v, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => { out.add(k); deepKeys(v, out); });
  return out;
}

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

test('역할 → 꾸러미 · 칸 (원장 = 고정된 재단 배치, 모듈 = 동결 설계, 주문 = 하나)', () => {
  assert.deepEqual(PACKS_OF_ROLE, { cut: ['cut', 'labels'], edge: ['cut', 'labels'], assembly: ['assembly'], install: ['install'] });
  const db = makeDb();
  const doc = db.design_documents[1];
  const snap = db.design_snapshots[0];
  assert.deepEqual(cellsOf(doc, snap, 'sheet').map((c) => c.scope_key), ['sheet:1', 'sheet:2']);
  assert.deepEqual(cellsOf(doc, snap, 'module').map((c) => c.scope_key), ['module:0:0', 'module:0:1']);
  assert.deepEqual(cellsOf(doc, snap, 'order').map((c) => c.scope_key), ['']);
});

test('공장 꾸러미 — 지금 판 작업지시서의 내 공정 꾸러미, 설계 제목 대신 가린 주문 이름, 종이 칸은 정본 목록', async () => {
  await withDb(makeDb(), async (calls) => {
    const html = await factoryPack(ENV, { user: cut, params: { orderId: O1 }, query: { pack: 'cut' } });
    assert.match(html, /홍\*동 \(SO-1\)/);
    assert.doesNotMatch(html, /홍길동/);
    assert.match(html, /재단 ☐ 엣지 표시 ☐/);
    assert.match(html, /WO-2/, '지금 판 (rev 2)');
    assert.match(await factoryPack(ENV, { user: cut, params: { orderId: O1 }, query: {} }), /재단·엣지 지시서/, 'pack 이 없으면 내 첫 꾸러미');
    await assert.rejects(() => factoryPack(ENV, { user: cut, params: { orderId: O1 }, query: { pack: 'door' } }), (e) => e.code === 'not_my_pack');
    await assert.rejects(() => factoryPack(ENV, { user: cut, params: { orderId: O2 }, query: { pack: 'cut' } }), (e) => e.statusCode === 404, '다른 계획 주문');
    assert.equal(writes(calls).length, 0);
  });
});

test('공장 필수 확인 — 내 역할(재단 · 조립) 칸 × 항목, 도어 · 서랍 조건, 응답에 금지 키 없음', async () => {
  await withDb(makeDb(), async () => {
    const v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.deepEqual([v.order_label, v.document.id, v.list_version, v.db_ready], ['홍*동 (SO-1)', DOC_WO, 'v0', true]);
    assert.deepEqual(v.roles.map((r) => [r.role, r.total, r.done, r.must_left]), [['cut', 4, 0, 4], ['assembly', 10, 0, 10]]);
    const asm = v.roles[1];
    assert.deepEqual(asm.cells[0].items.map((x) => x.label), ['재단', '엣지', '조립', '도어 달기', '검수·포장'], '도어장 — 서랍 칸 없음');
    assert.deepEqual(asm.cells[1].items.map((x) => x.label), ['재단', '엣지', '조립', '서랍', '검수·포장'], '서랍장 — 도어 칸 없음');
    const keys = deepKeys(v);
    FORBIDDEN_KEYS.forEach((k) => assert.ok(!keys.has(k), `금지 키 ${k}`));
  });
});

test('체크 — 쌓기만 (마지막 줄이 지금 값), 지금 판 · 내 역할 · 목록 항목 · 있는 칸만', async () => {
  const db = makeDb();
  await withDb(db, async (calls) => {
    const ok = { document_id: DOC_WO, role: 'cut', scope_key: 'sheet:1', item_key: 'cut-sheet-cut', checked: true, memo: ' 확인 ' };
    await postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: ok });
    const row = db.work_checks[0];
    assert.deepEqual([row.company_id, row.order_id, row.worker_id, row.actor_user_id, row.list_version, row.memo], [HQ, O1, W_CUT, U_CUT, 'v0', '확인']);
    let v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.equal(v.roles[0].done, 1);
    await postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, checked: false, memo: null } });
    v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.equal(v.roles[0].done, 0, '마지막 줄이 지금 값');
    assert.equal(db.work_checks.length, 2, '지우거나 고치지 않고 쌓는다');
    const before = writes(calls).length;
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, document_id: DOC_OLD } }), (e) => e.statusCode === 409 && e.details.code === 'superseded');
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, role: 'install', item_key: 'inst-order-sign', scope_key: '' } }), (e) => e.code === 'not_my_role');
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, item_key: 'cut-sheet-paint' } }), (e) => e.statusCode === 422);
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, scope_key: 'sheet:9' } }), (e) => e.statusCode === 422);
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { document_id: DOC_WO, role: 'assembly', scope_key: 'module:0:0', item_key: 'asm-module-drawer', checked: true } }), (e) => e.statusCode === 422, '도어장에 서랍 칸 없음');
    await assert.rejects(() => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { ...ok, checked: 'yes' } }), (e) => e.statusCode === 422);
    assert.equal(writes(calls).length, before, '거절은 쓰지 않는다');
  });
});

test('DB 0035 적용 전 — 보기는 db_ready false, 체크는 409 db_pending', async () => {
  await withDb(makeDb(), async () => {
    const v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.equal(v.db_ready, false);
    await assert.rejects(
      () => postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { document_id: DOC_WO, role: 'cut', scope_key: 'sheet:1', item_key: 'cut-sheet-cut', checked: true } }),
      (e) => e.statusCode === 409 && e.details.code === 'db_pending',
    );
  }, { noChecksTable: true });
});

test('설치 — 확정 배정만, 시공 지시서에 주소 · 연락처 · 고객 실명 · 다른 기사 이름이 없다, 주문 칸 셋', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const html = await assignmentPack(ENV, { user: inst, params: { id: A_OK } });
    assert.match(html, /홍\*동 \(SO-1\)/);
    assert.ok(html.includes(SITE_NOTE));
    ['서울시 시험구', '010-0000-0009', '홍길동', '다른기사'].forEach((s) => assert.ok(!html.includes(s), `작업자에게 ${s}`));
    assert.match(html, /설치 담당/);
    const v = await getAssignmentChecks(ENV, { user: inst, params: { id: A_OK } });
    assert.deepEqual(v.roles.map((r) => [r.role, r.total]), [['install', 3]]);
    assert.equal(v.document.id, DOC_IO);
    await postAssignmentCheck(ENV, { user: inst, params: { id: A_OK }, body: { document_id: DOC_IO, role: 'install', scope_key: '', item_key: 'inst-order-sign', checked: true } });
    assert.equal(db.work_checks[0].worker_id, W_INSTALL);
    await assert.rejects(() => assignmentPack(ENV, { user: inst, params: { id: A_OFFER } }), (e) => e.code === 'not_confirmed');
  });
});

test('설치 — 작업을 낸 팩토리의 주문이면 수락한 배정의 시공 지시서에 주소 · 연락처가 열린다 (끝나고 7일 뒤 · 남의 주문은 닫힘)', async () => {
  const db = makeDb();
  db.work_jobs[0].company_id = HQ;
  await withDb(db, async () => {
    const open = await assignmentPack(ENV, { user: inst, params: { id: A_OK } });
    ['서울시 시험구 1', '101호', '010-0000-0009'].forEach((s) => assert.ok(open.includes(s), `열린 지시서에 ${s}`));
    assert.ok(!open.includes(SITE_NOTE));
    assert.match(open, /홍\*동 \(SO-1\)/, '고객 칸은 그대로 가린 이름');
    assert.ok(!open.includes('다른기사'));

    // 확인하고 7일이 지난 배정 — 다시 닫힌다
    const a = db.work_assignments.find((x) => x.id === A_OK);
    Object.assign(a, { status: 'accepted', accepted_at: new Date(Date.now() - 8 * 86400000).toISOString() });
    const late = await assignmentPack(ENV, { user: inst, params: { id: A_OK } });
    assert.ok(late.includes(SITE_NOTE) && !late.includes('서울시 시험구') && !late.includes('010-0000-0009'));
    Object.assign(a, { status: 'confirmed', accepted_at: null });

    // 작업을 낸 팩토리와 주문의 팩토리가 다르면 열지 않는다
    db.work_jobs[0].company_id = 'c9000000-0000-4000-8000-000000000009';
    const other = await assignmentPack(ENV, { user: inst, params: { id: A_OK } });
    assert.ok(other.includes(SITE_NOTE) && !other.includes('서울시 시험구'));
  });
});

test('본사 — 설계를 볼 수 있는 사람이 역할 전부 (작업지시서 판 · 시공 지시서 판)', async () => {
  const db = makeDb({ work_checks: [{ id: 'x', document_id: DOC_WO, role: 'assembly', scope_key: 'module:0:1', item_key: 'asm-module-drawer', checked: true, created_at: '2026-11-04T01:00:00Z' }] });
  await withDb(db, async () => {
    const v = await getOrderChecks(ENV, { user: { id: HQ_OWNER }, params: { orderId: O1 } });
    assert.equal(v.order_label, '홍길동 (SO-1)');
    assert.deepEqual(v.roles.map((r) => [r.role, r.total, r.done]), [['cut', 4, 0], ['edge', 0, 0], ['assembly', 10, 1], ['install', 3, 0]]);
    await assert.rejects(() => getOrderChecks(ENV, { user: { id: U_CUT }, params: { orderId: O1 } }), (e) => e.statusCode === 403);
  });
});
