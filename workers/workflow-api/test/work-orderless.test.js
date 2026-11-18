/**
 * 수주 없이도 작업 · 한 작업에 모든 설계 — src/work/job-links.js · src/work/checks.js · src/work/check-state.js · src/work/reveal.js
 *
 *   작업자의 지시서 · 필수 확인은 그 작업의 설계로 찾는다:
 *     프로젝트 「작업 배정」의 작업 → 그 프로젝트에 이은 설계 모두 (?design= 로 고른다), 수주가 없어도 연다 (이름표 「수주 전 · 문서 번호」)
 *     일정에서 생긴 작업 → 그 일정의 설계 (수주가 없으면 프로젝트에 이은 설계일 때만)
 *   체크는 수주 칸을 비우고 작업 칸을 적는다 (DB 0072 — 그 전이면 수주가 있는 체크만 예전처럼, 수주 없는 체크는 409 db_pending).
 *   완료는 그 작업이 여는 설계 모두의 필수 확인이 끝나야 한다.
 * 사람 · 주문 · 주소는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { SITE_NOTE, jobDetail, findForbiddenKeys } from '../src/work/reveal.js';
import { frozenCheckList } from '../src/work/check-items.js';
import { assignmentPack, getAssignmentChecks, postAssignmentCheck, orderlessLabel } from '../src/work/checks.js';
import { assertJobChecksDone, sheetTargetsOf, workerSheetsOf, isProjectJob } from '../src/work/job-links.js';
import { HQ, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ_OWNER = 'a0000000-0000-4000-8000-000000000001';
const U_WORKER = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'a9000000-0000-4000-8000-000000000009';
const W1 = 'd0000000-0000-4000-8000-000000000001';
const P1 = 'f0000000-0000-4000-8000-000000000001';
const D1 = 'd1000000-0000-4000-8000-000000000001';
const D2 = 'd1000000-0000-4000-8000-000000000002';
const D_OTHER = 'd1000000-0000-4000-8000-000000000003';
const D_FREE = 'd1000000-0000-4000-8000-000000000004';
const O_FREE = 'e0000000-0000-4000-8000-000000000004';
const DOC_WO1 = 'c3000000-0000-4000-8000-000000000011';
const DOC_WO2 = 'c3000000-0000-4000-8000-000000000012';
const DOC_DM1 = 'c3000000-0000-4000-8000-000000000013';
const DOC_DM2 = 'c3000000-0000-4000-8000-000000000014';
const DOC_DV1 = 'c3000000-0000-4000-8000-000000000015';
const DOC_DVF = 'c3000000-0000-4000-8000-000000000016';
const A_CUT = 'c4000000-0000-4000-8000-000000000011';
const A_DM = 'c4000000-0000-4000-8000-000000000012';
const A_DV = 'c4000000-0000-4000-8000-000000000013';
const A_DVF = 'c4000000-0000-4000-8000-000000000014';
const A_OFFER = 'c4000000-0000-4000-8000-000000000015';
const A_OLD = 'c4000000-0000-4000-8000-000000000016';
const MEMBERS = [{ user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' }];

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const snapshot = (id, designId, categoryId, labelName) => ({
  id, design_id: designId, rev: 1, content_hash: `hash-${id}`,
  // 가짜 DB 는 select 를 보지 않는다 — 실제는 design_payload->items->0->>categoryId 를 category_id 로 읽는다
  category_id: categoryId,
  design_payload: {
    items: [{
      labelName, categoryId, w: 2400, h: 2310, d: 650,
      modules: [{ pos: 'lower', name: '도어장', w: 900, h: 708, d: 550, doorCount: 2, totalH: 870 }],
    }],
  },
  bom_payload: {
    materials: [{ partId: 'a|1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2, module: '#1 도어장', note: '' }],
    hardware: [],
  },
  cut_plan_payload: null,
});
const SHEET = (no) => ({
  no, material: 'PB', thickness: 15, partClass: '본체', size: { w: 1220, h: 2440 }, trim: 10,
  layout: { no: 1, stack: 1, index: 1, dir: 'V', rotated: false }, strips: [],
  parts: [{ partId: 'a|1#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false, strip: 1 }], usedArea: 389400, yield: 0.13,
});
const SITE = { address: '서울시 시험구 시험로 1', address_detail: '101동 1203호', contact_name: '홍길동', contact_phone: '010-0000-0000' };
const workOrder = (id, designId, snapId, no) => ({
  id, design_id: designId, snapshot_id: snapId, doc_type: 'work_order', rev: 1, doc_no: no, status: 'issued', superseded_by: null, title: '홍길동 주방', customer_name: '홍길동', created_at: '2026-11-19T00:00:00Z',
  render_payload: { work_order_version: 2, check_list: frozenCheckList('v3'), cut_plan: { version: 1, strategy: 'standard', sheets: [SHEET(1)], offcuts: [], groups: [], smallParts: [], unallocated: [], summary: {} } },
});
const siteOrder = (id, designId, snapId, docType, no) => ({
  id, design_id: designId, snapshot_id: snapId, doc_type: docType, rev: 1, doc_no: no, status: 'issued', superseded_by: null, title: '홍길동 주방', customer_name: '홍길동', created_at: '2026-11-19T00:00:00Z',
  render_payload: { site_info: SITE, schedules: [], check_list: frozenCheckList('v3') },
});

function makeDb(over = {}) {
  const job = (id, kind, extra = {}) => ({ id, kind, order_id: null, design_id: D1, company_id: HQ, project_id: P1, schedule_id: null, status: 'in_progress', slots: 1, ...extra });
  return {
    workers: [{ id: W1, user_id: U_WORKER, display_name: '김현장', kinds: ['demolition', 'delivery', 'cutting'], status: 'approved' }],
    orders: [],
    designs: [
      { id: D1, user_id: HQ_OWNER, company_id: HQ, project_id: P1, created_at: '2026-11-01T00:00:00Z' },
      { id: D2, user_id: HQ_OWNER, company_id: HQ, project_id: P1, created_at: '2026-11-02T00:00:00Z' },
      // 같은 프로젝트 번호가 적힌 다른 팩토리의 설계 — 섞이지 않는다
      { id: D_OTHER, user_id: HQ_OWNER, company_id: OTHER, project_id: P1, created_at: '2026-10-01T00:00:00Z' },
      // 프로젝트에 잇지 않은 설계
      { id: D_FREE, user_id: HQ_OWNER, company_id: HQ, project_id: null, created_at: '2026-11-03T00:00:00Z' },
    ],
    design_snapshots: [snapshot('S1', D1, 'sink', '싱크대 #1'), snapshot('S2', D2, 'wardrobe', '붙박이장 #1'), snapshot('SF', D_FREE, 'sink', '싱크대 #1')],
    design_documents: [
      workOrder(DOC_WO1, D1, 'S1', 'DD-20261119-AAAA-WO-r1'),
      workOrder(DOC_WO2, D2, 'S2', 'DD-20261119-BBBB-WO-r1'),
      siteOrder(DOC_DM1, D1, 'S1', 'demolition_order', 'DD-20261119-AAAA-DM-r1'),
      siteOrder(DOC_DM2, D2, 'S2', 'demolition_order', 'DD-20261119-BBBB-DM-r1'),
      siteOrder(DOC_DV1, D1, 'S1', 'delivery_order', 'DD-20261119-AAAA-DV-r1'),
      siteOrder(DOC_DVF, D_FREE, 'SF', 'delivery_order', 'DD-20261119-FFFF-DV-r1'),
    ],
    work_jobs: [
      job('J-CUT', 'cutting'),
      job('J-DM', 'demolition'),
      // 일정에서 생긴 납품 — 프로젝트에 이은 설계 / 잇지 않은 설계
      job('J-DV', 'delivery', { project_id: null, schedule_id: 'SC1', design_id: D1 }),
      job('J-DVF', 'delivery', { project_id: null, schedule_id: 'SC2', design_id: D_FREE }),
      job('J-OLD', 'demolition', { project_id: null, schedule_id: 'SC3', design_id: D1 }),
    ],
    work_assignments: [
      { id: A_CUT, job_id: 'J-CUT', worker_id: W1, status: 'confirmed' },
      { id: A_DM, job_id: 'J-DM', worker_id: W1, status: 'confirmed' },
      { id: A_DV, job_id: 'J-DV', worker_id: W1, status: 'started' },
      { id: A_DVF, job_id: 'J-DVF', worker_id: W1, status: 'confirmed' },
      { id: A_OFFER, job_id: 'J-CUT', worker_id: W1, status: 'offered' },
      // 확인하고 여드레가 지난 배정 — 현장이 닫혔다
      { id: A_OLD, job_id: 'J-OLD', worker_id: W1, status: 'accepted', accepted_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() },
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

/**
 * 가짜 DB.
 *   noJobColumn  work_checks 에 작업 칸이 없다 (DB 0072 전) — 그 칸을 읽거나 적으면 PGRST204
 *   orderRequired work_checks.order_id 가 꼭 있어야 한다 (DB 0072 전) — 비우면 23502
 */
async function withDb(db, fn, { noJobColumn = false, orderRequired = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const noColumn = () => json({ code: 'PGRST204', message: "Could not find the 'job_id' column of 'work_checks' in the schema cache" }, 400);
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
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    if (method === 'GET') {
      if (noJobColumn && table === 'work_checks' && /(^|,)job_id(,|$)/.test(q.get('select') || '')) return noColumn();
      let rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      const ord = q.get('order');
      if (ord) {
        const [col, dir] = ord.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      if (table === 'work_checks') {
        if (noJobColumn && Object.prototype.hasOwnProperty.call(body, 'job_id')) return noColumn();
        if (orderRequired && !body.order_id) return json({ code: '23502', message: 'null value in column "order_id" of relation "work_checks" violates not-null constraint' }, 400);
      }
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
const me = { id: U_WORKER };
const pack = (id, query) => assignmentPack(ENV, { user: me, params: { id }, query });
const pend = (no) => (e) => e.statusCode === 409 && e.details && e.details.code === 'db_pending' && new RegExp(no).test(e.message);

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

test('프로젝트 작업의 설계 — 그 팩토리가 그 프로젝트에 이은 설계 모두, 먼저 만든 것부터 (다른 팩토리 · 잇지 않은 설계는 없다)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const job = db.work_jobs.find((j) => j.id === 'J-CUT');
    assert.equal(isProjectJob(job), true);
    assert.deepEqual((await sheetTargetsOf(ENV, job)).map((t) => [t.design.id, t.order]), [[D1, null], [D2, null]]);
    // 일정에서 생긴 작업 — 그 일정의 설계 하나
    assert.deepEqual((await sheetTargetsOf(ENV, db.work_jobs.find((j) => j.id === 'J-DV'))).map((t) => t.design.id), [D1]);
    // 프로젝트에 잇지 않은 설계는 수주가 있을 때만
    const free = db.work_jobs.find((j) => j.id === 'J-DVF');
    assert.equal(isProjectJob(free), false);
    assert.deepEqual(await sheetTargetsOf(ENV, free), []);
    db.orders.push({ id: O_FREE, order_no: 'SO-9', customer_name: '홍길동', design_id: D_FREE, company_id: HQ, status: 'confirmed', created_at: '2026-11-19T00:00:00Z' });
    assert.deepEqual((await sheetTargetsOf(ENV, free)).map((t) => [t.design.id, t.order.id]), [[D_FREE, O_FREE]]);
    // 취소한 수주는 수주가 아니다
    db.orders[0].status = 'cancelled';
    assert.deepEqual(await sheetTargetsOf(ENV, free), []);
  });
});

test('작업자 꾸러미 — 수주가 없어도 프로젝트에 이은 설계의 지시서를 연다 (이름표 「수주 전 · 문서 번호」, 고객 이름 없음)', async () => {
  await withDb(makeDb(), async (calls) => {
    const first = strip(await pack(A_CUT));
    assert.match(first, /수주 전 · DD-20261119-AAAA-WO-r1/);
    assert.doesNotMatch(first, /홍길동|시험로 1|010-0000-0000/, '수주 전 꾸러미에도 고객 이름 · 주소 · 연락처가 없다');
    assert.match(await pack(A_CUT), /원장/);
    // 설계를 고른다 — 그 작업의 설계만
    const second = strip(await pack(A_CUT, { design: D2 }));
    assert.match(second, /수주 전 · DD-20261119-BBBB-WO-r1/);
    assert.doesNotMatch(second, /홍길동/);
    assert.equal(strip(await pack(A_CUT, { design: D1 })), first);
    await assert.rejects(() => pack(A_CUT, { design: D_OTHER }), (e) => e.statusCode === 404 && /이 작업의 설계가 아닙니다/.test(e.message));
    await assert.rejects(() => pack(A_CUT, { design: D_FREE }), (e) => e.statusCode === 404);
    await assert.rejects(() => pack(A_CUT, { design: 'D1' }), (e) => e.statusCode === 422);
    // 꾸러미 권한은 그대로 — 남의 공정은 403, 수락 전은 403
    await assert.rejects(() => pack(A_CUT, { pack: 'assembly' }), (e) => e.statusCode === 403 && e.code === 'not_my_pack');
    await assert.rejects(() => pack(A_OFFER), (e) => e.statusCode === 403 && e.code === 'not_confirmed');
    assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, '읽기만');
  });
  // 한 번 여는 데 바깥 호출이 한도(50)에 한참 못 미친다
  await withDb(makeDb(), async (calls) => {
    await pack(A_CUT, { design: D2 });
    assert.ok(calls.length < 20, `바깥 호출 ${calls.length}번`);
  });
});

test('작업자 꾸러미 — 수주 전 현장 문서: 주소는 수락한 때부터 끝나고 7일까지만, 프로젝트에 이은 설계가 없으면 404', async () => {
  await withDb(makeDb(), async () => {
    const dm = strip(await pack(A_DM));
    assert.match(dm, /^철거 지시서 /);
    assert.match(dm, /수주 전 · DD-20261119-AAAA-DM-r1/);
    assert.doesNotMatch(dm, /고객 홍길동/);
    assert.match(dm, /주소 서울시 시험구 시험로 1/);   // 수락한 배정 — 현장이 열려 있다
    assert.match(strip(await pack(A_DM, { design: D2 })), /수주 전 · DD-20261119-BBBB-DM-r1/);
    // 일정에서 생긴 납품 — 프로젝트에 이은 설계면 수주 없이 연다
    assert.match(strip(await pack(A_DV)), /^납품 지시서 /);
    // 끝나고 7일이 지나면 닫힌다
    const old = strip(await pack(A_OLD));
    assert.equal(old.split(SITE_NOTE).length - 1, 2);
    assert.doesNotMatch(old, /시험로 1|010-0000-0000/);
    // 프로젝트에 잇지 않은 설계 + 수주 없음 → 예전 그대로
    await assert.rejects(() => pack(A_DVF), (e) => e.statusCode === 404 && /연결된 주문이 없습니다/.test(e.message));
  });
  // 그 설계에 수주가 생기면 가린 주문 이름으로 연다
  const db = makeDb({ orders: [{ id: O_FREE, order_no: 'SO-9', customer_name: '홍길동', design_id: D_FREE, company_id: HQ, status: 'confirmed', created_at: '2026-11-19T00:00:00Z' }] });
  await withDb(db, async () => {
    const dv = strip(await pack(A_DVF));
    assert.match(dv, /고객 홍\*동/);
    assert.doesNotMatch(dv, /수주 전|고객 홍길동/);
  });
  // 프로젝트에 이은 설계가 하나도 없다
  await withDb(makeDb({ designs: [] }), async () => {
    await assert.rejects(() => pack(A_CUT), (e) => e.statusCode === 404 && /이 프로젝트에 이은 설계가 없습니다/.test(e.message));
  });
  // 지시서를 아직 내지 않았다
  await withDb(makeDb({ design_documents: [] }), async () => {
    await assert.rejects(() => pack(A_CUT), (e) => e.statusCode === 404 && /^작업지시서가 아직 없습니다/.test(e.message));
  });
});

/** 그 역할의 첫 칸에서 사진이 필요 없고 주문 끝이 아닌 항목 하나 */
const plainItem = (view) => {
  const cell = view.roles[0].cells.find((c) => c.items.some((x) => x.photo !== 'need' && !x.finish));
  return { scope_key: cell.scope_key, item_key: cell.items.find((x) => x.photo !== 'need' && !x.finish).key };
};

test('필수 확인 — 수주 전 작업: 설계마다 따로, 체크 줄은 수주 칸을 비우고 작업 칸을 적는다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const v1 = await getAssignmentChecks(ENV, { user: me, params: { id: A_CUT } });
    assert.equal(v1.order_label, orderlessLabel({ doc_no: 'DD-20261119-AAAA-WO-r1' }));
    assert.equal(v1.design, D1);
    assert.equal(v1.document.id, DOC_WO1);
    const v2 = await getAssignmentChecks(ENV, { user: me, params: { id: A_CUT }, query: { design: D2 } });
    assert.deepEqual([v2.design, v2.document.id, v2.order_label], [D2, DOC_WO2, '수주 전 · DD-20261119-BBBB-WO-r1']);
    const item = plainItem(v1);
    const body = { document_id: DOC_WO1, role: 'cut', ...item, checked: true };
    await postAssignmentCheck(ENV, { user: me, params: { id: A_CUT }, body });
    assert.equal(db.work_checks.length, 1);
    const row = db.work_checks[0];
    assert.deepEqual([row.company_id, row.order_id, row.job_id, row.document_id, row.worker_id], [HQ, null, 'J-CUT', DOC_WO1, W1]);
    // 다른 설계의 문서 번호로는 체크하지 못한다 — 설계를 골라야 한다
    await assert.rejects(() => postAssignmentCheck(ENV, { user: me, params: { id: A_CUT }, body: { ...body, document_id: DOC_WO2 } }), (e) => e.statusCode === 409 && e.details.code === 'superseded');
    await postAssignmentCheck(ENV, { user: me, params: { id: A_CUT }, query: { design: D2 }, body: { ...body, document_id: DOC_WO2 } });
    assert.deepEqual(db.work_checks.map((r) => r.document_id), [DOC_WO1, DOC_WO2]);
    // 설계마다 따로 센다
    const after = await getAssignmentChecks(ENV, { user: me, params: { id: A_CUT } });
    assert.equal(after.roles[0].done, 1);
  });
});

test('필수 확인 — DB 0072 전: 수주가 있는 체크는 작업 칸 없이 예전처럼, 수주 없는 체크는 409 db_pending', async () => {
  // 수주 없는 작업 — 작업 칸이 없다
  await withDb(makeDb(), async () => {
    const view = await getAssignmentChecks(ENV, { user: me, params: { id: A_CUT } });
    const body = { document_id: DOC_WO1, role: 'cut', ...plainItem(view), checked: true };
    await assert.rejects(() => postAssignmentCheck(ENV, { user: me, params: { id: A_CUT }, body }), pend('0072'));
  }, { noJobColumn: true, orderRequired: true });
  // 수주 없는 작업 — 칸은 있는데 수주 칸을 비울 수 없다 (있을 수 없는 조합이지만 막는다)
  const half = makeDb();
  await withDb(half, async () => {
    const view = await getAssignmentChecks(ENV, { user: me, params: { id: A_CUT } });
    const body = { document_id: DOC_WO1, role: 'cut', ...plainItem(view), checked: true };
    await assert.rejects(() => postAssignmentCheck(ENV, { user: me, params: { id: A_CUT }, body }), pend('0072'));
    assert.equal(half.work_checks.length, 0);
  }, { orderRequired: true });
  // 수주가 있는 작업 — 작업 칸 없이 적는다
  const db = makeDb({ orders: [{ id: O_FREE, order_no: 'SO-9', customer_name: '홍길동', design_id: D_FREE, company_id: HQ, status: 'confirmed', created_at: '2026-11-19T00:00:00Z' }] });
  await withDb(db, async (calls) => {
    const view = await getAssignmentChecks(ENV, { user: me, params: { id: A_DVF } });
    assert.match(view.order_label, /홍\*동/);
    const item = view.roles[0].cells[0].items.find((x) => x.photo !== 'need');
    await postAssignmentCheck(ENV, { user: me, params: { id: A_DVF }, body: { document_id: DOC_DVF, role: 'delivery', scope_key: '', item_key: item.key, checked: true } });
    assert.equal(db.work_checks.length, 1);
    assert.equal(db.work_checks[0].order_id, O_FREE);
    assert.equal(Object.prototype.hasOwnProperty.call(db.work_checks[0], 'job_id'), false);
    assert.equal(calls.filter((c) => c.method === 'POST' && /work_checks/.test(c.url)).length, 2, '작업 칸을 싣고 한 번, 빼고 한 번');
  }, { noJobColumn: true, orderRequired: true });
});

test('완료 막기 — 그 작업이 여는 설계 모두의 필수 확인이 끝나야 한다 (수주 전 작업은 DB 0072 전이면 막지 않는다)', async () => {
  const db = makeDb();
  const job = db.work_jobs.find((j) => j.id === 'J-DM');
  const check = (documentId) => ({ id: randomUUID(), document_id: documentId, role: 'demolition', scope_key: '', item_key: 'demo-order-photo', checked: true, photo_path: 'x', created_at: new Date().toISOString() });
  await withDb(db, async () => {
    await assert.rejects(() => assertJobChecksDone(ENV, job), (e) => e.statusCode === 409 && e.details.code === 'checks_left' && e.details.left === 1);
    db.work_checks.push(check(DOC_DM1));
    // 첫 설계는 끝났지만 둘째 설계가 남았다
    await assert.rejects(() => assertJobChecksDone(ENV, job), (e) => e.details.code === 'checks_left');
    db.work_checks.push(check(DOC_DM2));
    await assertJobChecksDone(ENV, job);
    // 지시서가 없는 종류 · 지시서를 안 낸 설계는 막지 않는다
    await assertJobChecksDone(ENV, { ...job, kind: 'as' });
  });
  await withDb(makeDb({ design_documents: [] }), async () => { await assertJobChecksDone(ENV, job); });
  // DB 0072 전 — 수주 없는 체크를 적을 수 없으므로 막지 않는다
  await withDb(makeDb(), async () => { await assertJobChecksDone(ENV, job); }, { noJobColumn: true });
  // 수주가 있는 설계는 0072 전에도 막는다
  const withOrder = makeDb({ orders: [{ id: O_FREE, order_no: 'SO-1', customer_name: '홍길동', design_id: D1, company_id: HQ, status: 'confirmed', created_at: '2026-11-19T00:00:00Z' }] });
  await withDb(withOrder, async () => {
    await assert.rejects(() => assertJobChecksDone(ENV, job), (e) => e.details.code === 'checks_left');
  }, { noJobColumn: true });
});

test('작업자 상세의 지시서 목록 — 설계마다 품목 이름 · 문서 번호 · 판, 확정된 배정에만 싣는다', async () => {
  const db = makeDb({ design_documents: [workOrder(DOC_WO1, D1, 'S1', 'DD-20261119-AAAA-WO-r1')] });
  await withDb(db, async () => {
    const job = db.work_jobs.find((j) => j.id === 'J-CUT');
    const sheets = await workerSheetsOf(ENV, job);
    assert.deepEqual(sheets, [
      { design: D1, label: '싱크대', state: 'issued', doc_no: 'DD-20261119-AAAA-WO-r1', rev: 1, packs: ['cut', 'labels'] },
      { design: D2, label: '붙박이장', state: 'none', doc_no: null, rev: null, packs: ['cut', 'labels'] },
    ]);
    assert.equal(await workerSheetsOf(ENV, { ...job, kind: 'as' }), null);
    assert.deepEqual(await workerSheetsOf(ENV, db.work_jobs.find((j) => j.id === 'J-DVF')), []);
    const confirmed = jobDetail(job, { assignment: { id: A_CUT, status: 'confirmed' }, sheets });
    assert.deepEqual(confirmed.sheets, sheets);
    assert.deepEqual(findForbiddenKeys(confirmed), []);
    assert.equal(Object.prototype.hasOwnProperty.call(jobDetail(job, { assignment: { id: A_OFFER, status: 'offered' }, sheets }), 'sheets'), false, '수락 전에는 싣지 않는다');
    assert.equal(Object.prototype.hasOwnProperty.call(jobDetail(job, { assignment: { id: A_CUT, status: 'confirmed' } }), 'sheets'), false);
  });
  // 같은 품목이 둘이면 번호를 붙인다
  const twin = makeDb();
  twin.design_snapshots[1].category_id = 'sink';
  await withDb(twin, async () => {
    assert.deepEqual((await workerSheetsOf(ENV, twin.work_jobs[0])).map((s) => s.label), ['싱크대', '싱크대 2']);
  });
});
