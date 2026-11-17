/**
 * 철거 지시서 · 납품 지시서 (2026-11-17 사장님 「각 작업자에게 보낼 작업지시서 각 작업에 작성되어서 확인」 · 「철거 · 납품 지시서를 새로 · 따로 발행」)
 *   — src/templates/site-order.js · src/documents.js (문서 종류 둘, DB 0068) · src/work/checks.js (작업 종류마다 지시서 · 필수 확인) ·
 *     src/work/check-state.js (완료 막기) · 확인 목록 v3 (src/work/check-items.js).
 *
 *   설치 지시서 출력은 한 글자도 바뀌지 않는다 (현장 정보 칸을 같이 쓰려고 틀만 나눴다) — 지문으로 본다.
 *   작업자 보기: 가린 주문 이름, 주소 · 연락처는 수락한 때부터 작업이 끝나고 7일까지만. 금액은 없다.
 * 사람 · 주문 · 주소는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { SITE_NOTE } from '../src/work/reveal.js';
import { frozenCheckList } from '../src/work/check-items.js';
import { assignmentPack, getAssignmentChecks, postAssignmentCheck, getOrderChecks } from '../src/work/checks.js';
import { assertChecksDone, DOC_TYPE_OF_ROLE, ROLE_OF_JOB_KIND } from '../src/work/check-state.js';
import { DOC_PLANS, DOC_TYPES, SITE_DOC_TYPES, SITE_ORDER_TYPES, issueDocument, renderDocument } from '../src/documents.js';
import { renderInstallationOrder } from '../src/templates/installation-order.js';
import { renderSiteOrder, SITE_ORDERS } from '../src/templates/site-order.js';
import { WORK_KINDS } from '../src/work/validate.js';
import * as fx from './fixtures/work-order-v2.js';
import { HQ, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ_OWNER = 'a0000000-0000-4000-8000-000000000001';
const U_WORKER = 'b0000000-0000-4000-8000-000000000001';
const W1 = 'd0000000-0000-4000-8000-000000000001';
const O1 = 'e0000000-0000-4000-8000-000000000001';
const DOC_DM = 'c3000000-0000-4000-8000-000000000001';
const DOC_DV = 'c3000000-0000-4000-8000-000000000002';
const DOC_WO = 'c3000000-0000-4000-8000-000000000003';
const A_DM = 'c4000000-0000-4000-8000-000000000001';
const A_DV = 'c4000000-0000-4000-8000-000000000002';
const A_AS = 'c4000000-0000-4000-8000-000000000003';
const A_CUT = 'c4000000-0000-4000-8000-000000000004';
const A_OFFER = 'c4000000-0000-4000-8000-000000000005';
const A_OLD = 'c4000000-0000-4000-8000-000000000006';
const MEMBERS = [{ user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' }];

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const sha = (html) => createHash('sha256').update(html).digest('hex');
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const SNAPSHOT = {
  id: 'S1', rev: 3, content_hash: 'abcdef0123456789',
  design_payload: {
    items: [{
      labelName: '싱크대 #1', categoryId: 'sink', w: 3600, h: 2310, d: 650,
      modules: [
        { pos: 'lower', name: '개수대', w: 900, h: 708, d: 550, doorCount: 2, totalH: 870 },
        { pos: 'lower', name: '서랍장', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 3 },
        { pos: 'upper', name: '상부장', w: 900, h: 720, d: 295, doorCount: 2, totalH: 780 },
      ],
    }],
  },
  bom_payload: {
    materials: [
      { partId: 'line|ep-0', part: 'EP', material: 'MDF', thickness: 18, w: 600, h: 2300, qty: 1, module: '줄 부재', note: '' },
      { partId: 'a|1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2, module: '#1 개수대', note: '' },
    ],
    hardware: [{ category: '전기', item: '콘센트 2구', qty: 1 }],
  },
  cut_plan_payload: null,
};
const SITE = {
  address: '서울시 시험구 시험로 1', address_detail: '101동 1203호', floor: '12층', has_elevator: true, elevator_note: '화물용 별도',
  access_note: '지하주차장 진입 높이 2.1m', install_order: '1. 하부장 → 2. 상판 → 3. 상부장', contact_name: '홍길동', contact_phone: '010-0000-0000', notes: '주말 작업 불가',
};
const SCHEDULES = [
  { type: 'delivery', scheduled_at: '2026-08-20T01:00:00.000Z', assignee_name: '김기사', location: '서울시 시험구', status: 'planned' },
  { type: 'installation', scheduled_at: '2026-08-21T00:00:00.000Z', assignee_name: '박팀장', location: '서울시 시험구', status: 'planned' },
];
const siteDoc = (docType, over = {}) => ({
  id: docType === 'demolition_order' ? DOC_DM : DOC_DV, design_id: 'D1', snapshot_id: 'S1', doc_type: docType, rev: 1, status: 'issued', superseded_by: null,
  doc_no: `DD-20261117-AAAA-${docType === 'demolition_order' ? 'DM' : 'DV'}-r1`, created_at: '2026-11-17T02:00:00.000Z', customer_name: '홍길동', title: '홍길동 싱크대',
  render_payload: { site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3') },
  ...over,
});

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

// ── 설치 지시서는 그대로 ─────────────────────────────────────────

test('설치 지시서 출력 — 현장 정보 칸을 나눈 뒤에도 한 글자도 같다 (나누기 전 지문)', () => {
  const DOC = { doc_no: 'DD-20260809-AAAA-IO-r1', doc_type: 'installation_order', created_at: '2026-08-09T02:00:00.000Z', customer_name: '홍길동' };
  const site = { ...SITE, address: '서울시 강남구 테헤란로 1' };
  const sch = SCHEDULES.map((s) => ({ ...s, location: '서울시 강남구' }));
  const doc = (rp) => ({ ...DOC, render_payload: rp });
  const worker = (siteOpen) => ({ orderLabel: '홍*동 · DD-1', siteOpen });
  const full = { site_info: site, schedules: sch, check_list: frozenCheckList('v2') };
  assert.deepEqual({
    office: sha(renderInstallationOrder(doc(full), SNAPSHOT, { toolbar: true })),
    officeOld: sha(renderInstallationOrder(doc({ site_info: site }), SNAPSHOT, { toolbar: false })),
    missing: sha(renderInstallationOrder(doc({ check_list: frozenCheckList('v1') }), SNAPSHOT, { toolbar: false, site: { has_elevator: false } })),
    workerClosed: sha(renderInstallationOrder(doc(full), SNAPSHOT, { toolbar: true, worker: worker(false) })),
    workerOpen: sha(renderInstallationOrder(doc(full), SNAPSHOT, { toolbar: true, worker: worker(true) })),
  }, {
    office: 'd2a51eea5df062252481a965b796c1f305cc29399c2c6b0a87284bd791233195',
    officeOld: '4fa56fa52073a0c03f2553e852a3748fabbdcc061671b37880d0f5bcabd561f1',
    missing: 'f35cf47f3a0c82d830d3ef43c2d5053c29838da1afa586e88688b72876e946ee',
    workerClosed: '892f6b8959386e51ff0130c0e9360562d5d0e9b287ef805ac19bdbfdeaab2893',
    workerOpen: '26582c481ff9eba4b97418133ecaa68b1c6bdbbebec052b37d0004eaffa14f54',
  });
});

// ── 문서 종류 ────────────────────────────────────────────────────

test('문서 종류 — 철거 · 납품 지시서: 등급은 설치 지시서와 같고, 현장 문서로 묶인다', () => {
  assert.deepEqual(DOC_TYPES.slice(-2), ['demolition_order', 'delivery_order']);
  assert.deepEqual([...SITE_ORDER_TYPES], ['demolition_order', 'delivery_order']);
  assert.deepEqual([...SITE_DOC_TYPES], ['installation_order', 'demolition_order', 'delivery_order']);
  SITE_ORDER_TYPES.forEach((t) => assert.deepEqual([...DOC_PLANS[t]], [...DOC_PLANS.installation_order]));
  assert.deepEqual(Object.keys(SITE_ORDERS), [...SITE_ORDER_TYPES]);
  // 작업 종류 → 역할 → 문서 종류. A/S 는 지시서가 없다
  assert.deepEqual(WORK_KINDS.filter((k) => !ROLE_OF_JOB_KIND[k]), ['as']);
  assert.deepEqual(WORK_KINDS.filter((k) => ROLE_OF_JOB_KIND[k]).map((k) => [k, DOC_TYPE_OF_ROLE[ROLE_OF_JOB_KIND[k]]]), [
    ['install', 'installation_order'], ['assembly', 'work_order'], ['cutting', 'work_order'], ['edge', 'work_order'], ['demolition', 'demolition_order'], ['delivery', 'delivery_order'],
  ]);
});

// ── 종이 틀 ──────────────────────────────────────────────────────

test('철거 지시서 — 현장 정보 · 반입 경로 · 일정 · 사무실 메모 · 철거 확인(철거 후 사진), 금액 · 재단 목록 없음', () => {
  const html = renderDocument(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false, memo: '  오전 9시 전에 끝내 주세요 <b> ' });
  const text = strip(html);
  assert.match(html, /<h1>철거 지시서<\/h1>/);
  assert.match(text, /문서번호 DD-20261117-AAAA-DM-r1/);
  assert.match(text, /사무실 메모 오전 9시 전에 끝내 주세요 &lt;b&gt; 현장 정보/);
  assert.doesNotMatch(html, /끝내 주세요 <b>/, '메모는 글자로만');
  assert.match(text, /주소 서울시 시험구 시험로 1 101동 1203호 층 12층/);
  assert.match(text, /연락처 홍길동 010-0000-0000/);
  assert.match(text, /반입 경로 지하주차장 진입 높이 2\.1m/);
  assert.match(text, /철거 확인 철거 후 사진 · 사진 ☐/);
  assert.match(text, /관련 일정 .*납품 .*설치 /);
  // 납품 지시서에만 있는 것 · 설치 지시서에만 있는 것은 없다
  assert.doesNotMatch(text, /싣는 품목|납품 확인|시공 순서|설치 확인|자재 재단/);
  assert.doesNotMatch(text, /원\b|공급가|부가세|합계/);
  // 메모가 없으면 칸도 없다
  assert.doesNotMatch(strip(renderSiteOrder(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false })), /사무실 메모/);
});

test('납품 지시서 — 싣는 품목(모듈 · 줄 부재) · 납품 확인(수량 · 하차 후 사진)', () => {
  const text = strip(renderDocument(siteDoc('delivery_order'), SNAPSHOT, { toolbar: false }));
  assert.match(text, /^납품 지시서 DD-20261117-AAAA-DV-r1 납품 지시서 /);
  assert.match(text, /납품 확인 납품 수량 확인 ☐ 하차 후 사진 · 사진 ☐/);
  assert.match(text, /싣는 품목 — 모듈 .*싱크대 #1 1 하부 개수대 900 × 708 × 550 2 /);
  assert.match(text, /싱크대 #1 3 상부 상부장 900 × 720 × 295 2 /);
  assert.match(text, /줄 부재 모듈과 같이 싣는 것 .*EP MDF 18T 600 × 2,300 1/);
  assert.doesNotMatch(text, /측판/, '모듈 속 판은 싣는 품목 줄이 아니다');
  assert.doesNotMatch(text, /철거 확인|설치 모듈 명세/);
});

test('작업자 보기 — 가린 주문 이름, 주소 · 연락처는 열렸을 때만 · 일정의 담당 · 장소는 가린다', () => {
  const closed = strip(renderSiteOrder(siteDoc('delivery_order'), SNAPSHOT, { toolbar: false, worker: { orderLabel: '홍*동 · SO-1', siteOpen: false } }));
  assert.match(closed, /고객 홍\*동 · SO-1 /);
  assert.equal(closed.split(SITE_NOTE).length - 1, 2, '주소 · 연락처 두 칸에 안내 글');
  assert.doesNotMatch(closed, /시험로 1|010-0000-0000|홍길동|김기사|박팀장|서울시 시험구/);
  const open = strip(renderSiteOrder(siteDoc('delivery_order'), SNAPSHOT, { toolbar: false, worker: { orderLabel: '홍*동 · SO-1', siteOpen: true } }));
  assert.match(open, /주소 서울시 시험구 시험로 1 101동 1203호/);
  assert.match(open, /연락처 홍길동 010-0000-0000/);
  assert.doesNotMatch(open, /김기사|박팀장/, '일정 담당 이름은 작업자에게 보이지 않는다');
  // 확인 목록이 없는 판(v2 까지)으로 낸 문서면 확인 칸을 그리지 않는다
  const old = siteDoc('demolition_order', { render_payload: { site_info: SITE, check_list: frozenCheckList('v2') } });
  assert.doesNotMatch(strip(renderSiteOrder(old, SNAPSHOT, { toolbar: false })), /철거 확인/);
  assert.throws(() => renderSiteOrder({ ...siteDoc('demolition_order'), doc_type: 'work_order' }, SNAPSHOT), /현장 지시서가 아닌/);
});

// ── 발행 ─────────────────────────────────────────────────────────

/** 발행 가짜 DB — 본사 설계. reject = DB 가 새 문서 종류를 거절한다 (0068 적용 전) */
function issueRoute({ reject = false } = {}) {
  return (u, method, body) => {
    const company = companyRoute(u, { hq: HQ, members: MEMBERS });
    if (company) return company;
    const path = u.split('?')[0];
    if (u.includes('/admin_roles?')) return json([]);
    if (/\/designs\?/.test(u)) return json([{ id: 'd-hq', user_id: HQ_OWNER, company_id: HQ, title: '본사 설계' }]);
    if (/\/design_snapshots\?id=eq\./.test(u)) return json([fx.snapshot({ id: 's1', design_id: 'd-hq' })]);
    if (/\/design_snapshots\?/.test(u)) return json([]);
    if (method === 'POST' && /\/design_documents$/.test(path)) {
      if (reject) return json({ code: '23514', message: 'new row for relation "design_documents" violates check constraint "design_documents_doc_type_check"' }, 400);
      return json([{ id: 'DOC-NEW', ...body }], 201);
    }
    if (method === 'PATCH' && /\/design_documents$/.test(path)) return json([]);
    if (/\/design_documents\?/.test(u)) return json([]);
    if (u.includes('/design_site_info?')) return json([{ design_id: 'd-hq', ...SITE }]);
    if (u.includes('/design_schedules?')) return json(SCHEDULES);
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

test('발행 — 철거 · 납품 지시서는 현장 정보 · 일정 · 확인 목록(v3)을 문서에 고정한다', async () => {
  for (const [docType, code] of [['demolition_order', 'DM'], ['delivery_order', 'DV']]) {
    await withFetch(issueRoute(), async (calls) => {
      const r = await issueDocument(ENV, { user: { id: HQ_OWNER, email: 'owner@example.test' }, body: { doc_type: docType, snapshot_id: 's1' } });
      const row = calls.find((c) => c.method === 'POST' && /\/design_documents$/.test(c.url.split('?')[0])).body;
      assert.equal(row.doc_type, docType);
      assert.match(row.doc_no, new RegExp(`^DD-\\d{8}-[0-9A-Z]{1,4}-${code}-r1$`));
      assert.equal(row.render_payload.site_info.address, SITE.address);
      assert.equal(row.render_payload.schedules.length, 2);
      assert.deepEqual(row.render_payload.check_list, frozenCheckList('v3'));
      // 설치 지시서 · 작업지시서에만 있는 것은 싣지 않는다
      ['renders', 'iso_renders', 'special_notes', 'cut_plan', 'label_order'].forEach((k) => assert.equal(k in row.render_payload, false, k));
      assert.equal(row.share_token_hash, undefined, '공유 링크가 없다');
      assert.equal(r.share_url, null);
      assert.equal(r.document.id, 'DOC-NEW');
      // 보관함 색인 · 승인 전 사유 기록은 쓰지 않는다 (작업지시서 · 설치 지시서만)
      assert.equal(calls.some((c) => c.method === 'POST' && /work_reports|order_events/.test(c.url)), false);
    });
  }
});

test('발행 — DB 가 새 문서 종류를 아직 모르면 (0068 적용 전) 409 db_pending', async () => {
  await withFetch(issueRoute({ reject: true }), async () => {
    await assert.rejects(
      () => issueDocument(ENV, { user: { id: HQ_OWNER }, body: { doc_type: 'demolition_order', snapshot_id: 's1' } }),
      (e) => e.statusCode === 409 && e.code === 'db_pending' && /0068/.test(e.message),
    );
  });
});

// ── 작업자 꾸러미 · 필수 확인 ────────────────────────────────────

const SHEET = (no) => ({
  no, material: 'PB', thickness: 15, partClass: '본체', color: '화이트', size: { w: 1220, h: 2440 }, trim: 10,
  layout: { no: 1, stack: 1, index: 1, dir: 'V', rotated: false }, strips: [],
  parts: [{ partId: 'a|1#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false, strip: 1 }], usedArea: 389400, yield: 0.13,
});

function makeDb(over = {}) {
  const job = (id, kind, extra = {}) => ({ id, kind, order_id: O1, design_id: 'D1', company_id: HQ, status: 'in_progress', slots: 1, ...extra });
  return {
    workers: [{ id: W1, user_id: U_WORKER, display_name: '김현장', kinds: ['demolition', 'delivery', 'cutting', 'as'], status: 'approved' }],
    orders: [{ id: O1, order_no: 'SO-1', customer_name: '홍길동', design_id: 'D1', company_id: HQ }],
    designs: [{ id: 'D1', user_id: HQ_OWNER, company_id: HQ }],
    design_documents: [
      siteDoc('demolition_order'),
      siteDoc('delivery_order'),
      {
        id: DOC_WO, design_id: 'D1', snapshot_id: 'S1', doc_type: 'work_order', rev: 1, doc_no: 'WO-1', status: 'issued', superseded_by: null, title: '홍길동 싱크대', created_at: '2026-11-17T00:00:00Z',
        render_payload: { work_order_version: 2, check_list: frozenCheckList('v3'), cut_plan: { version: 1, strategy: 'standard', sheets: [SHEET(1)], offcuts: [], groups: [], smallParts: [], unallocated: [], summary: {} } },
      },
    ],
    design_snapshots: [SNAPSHOT],
    work_jobs: [
      job('J-DM', 'demolition', { sheet_memo: '기존 상부장은 남깁니다' }),
      job('J-DV', 'delivery'),
      job('J-AS', 'as'),
      job('J-CUT', 'cutting'),
      job('J-OLD', 'demolition'),
    ],
    work_assignments: [
      { id: A_DM, job_id: 'J-DM', worker_id: W1, status: 'confirmed' },
      { id: A_DV, job_id: 'J-DV', worker_id: W1, status: 'started' },
      { id: A_AS, job_id: 'J-AS', worker_id: W1, status: 'confirmed' },
      { id: A_CUT, job_id: 'J-CUT', worker_id: W1, status: 'confirmed' },
      { id: A_OFFER, job_id: 'J-DM', worker_id: W1, status: 'offered' },
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

async function withDb(db, fn, { rejectRole = false } = {}) {
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
      if (rejectRole && table === 'work_checks') return json({ code: '23514', message: 'new row for relation "work_checks" violates check constraint "work_checks_role_check"' }, 400);
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
const pack = (id) => assignmentPack(ENV, { user: me, params: { id } });

test('작업자 꾸러미 — 철거 작업 = 철거 지시서(사무실 메모 · 현장 열림), 납품 작업 = 납품 지시서, 재단 작업 = 재단 꾸러미', async () => {
  await withDb(makeDb(), async (calls) => {
    const dm = strip(await pack(A_DM));
    assert.match(dm, /^철거 지시서 /);
    assert.match(dm, /고객 홍\*동/);
    assert.doesNotMatch(dm, /고객 홍길동/);
    assert.match(dm, /사무실 메모 기존 상부장은 남깁니다/);
    assert.match(dm, /주소 서울시 시험구 시험로 1/);   // 수락한 배정 — 현장이 열려 있다
    const dv = strip(await pack(A_DV));
    assert.match(dv, /^납품 지시서 /);
    assert.match(dv, /싣는 품목 — 모듈/);
    assert.doesNotMatch(dv, /사무실 메모/);
    const cut = await pack(A_CUT);
    assert.match(cut, /원장/);
    assert.doesNotMatch(strip(cut), /시험로 1|010-0000-0000/, '공장 일 꾸러미에는 현장이 없다');
    // 재단 작업은 라벨 꾸러미도 고른다 — 남의 공정 꾸러미는 403
    const labels = await assignmentPack(ENV, { user: me, params: { id: A_CUT }, query: { pack: 'labels' } });
    assert.notEqual(labels, cut);
    await assert.rejects(() => assignmentPack(ENV, { user: me, params: { id: A_CUT }, query: { pack: 'assembly' } }), (e) => e.statusCode === 403 && e.code === 'not_my_pack');
    // 현장 문서는 pack 을 보지 않는다
    assert.match(strip(await assignmentPack(ENV, { user: me, params: { id: A_DM }, query: { pack: 'cut' } })), /^철거 지시서 /);
    assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, '읽기만');
  });
});

test('작업자 꾸러미 — 수락 전 · A/S · 끝나고 7일 뒤', async () => {
  await withDb(makeDb(), async () => {
    await assert.rejects(() => pack(A_OFFER), (e) => e.statusCode === 403 && e.code === 'not_confirmed');
    await assert.rejects(() => pack(A_AS), (e) => e.statusCode === 404 && /작업지시서가 없습니다/.test(e.message));
    const old = strip(await pack(A_OLD));
    assert.match(old, /^철거 지시서 /);
    assert.equal(old.split(SITE_NOTE).length - 1, 2, '끝나고 7일이 지나면 주소 · 연락처가 닫힌다');
    assert.doesNotMatch(old, /시험로 1|010-0000-0000/);
  });
  // 지시서를 아직 내지 않았다
  await withDb(makeDb({ design_documents: [] }), async () => {
    await assert.rejects(() => pack(A_DM), (e) => e.statusCode === 404 && /철거 지시서가 아직 없습니다/.test(e.message));
    await assert.rejects(() => pack(A_DV), (e) => e.statusCode === 404 && /납품 지시서가 아직 없습니다/.test(e.message));
  });
  // 작업에 주문이 없다
  await withDb(makeDb({ work_jobs: [{ id: 'J-DM', kind: 'demolition', order_id: null, design_id: 'D1', company_id: HQ, status: 'open', slots: 1 }] }), async () => {
    await assert.rejects(() => pack(A_DM), (e) => e.statusCode === 404 && /연결된 주문이 없습니다/.test(e.message));
  });
});

test('필수 확인 — 철거: 「철거 후 사진」은 사진을 붙여야 체크, 납품: 수량 확인 · 하차 후 사진', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const view = await getAssignmentChecks(ENV, { user: me, params: { id: A_DM } });
    assert.equal(view.list_version, 'v3');
    assert.equal(view.block, 'must');
    assert.deepEqual(view.roles.map((r) => [r.role, r.label, r.packs, r.total, r.must_left]), [['demolition', '철거', ['demolition'], 1, 1]]);
    assert.deepEqual(view.roles[0].cells[0].items.map((x) => [x.key, x.must, x.photo]), [['demo-order-photo', true, 'need']]);
    const base = { document_id: DOC_DM, role: 'demolition', scope_key: '', item_key: 'demo-order-photo', checked: true };
    await assert.rejects(() => postAssignmentCheck(ENV, { user: me, params: { id: A_DM }, body: base }), (e) => e.statusCode === 422 && e.details && e.details.code === 'photo_required');
    const photo = `${HQ}/${O1}/${DOC_DM}/${randomUUID()}.jpg`;
    const done = await postAssignmentCheck(ENV, { user: me, params: { id: A_DM }, body: { ...base, photo_path: photo } });
    assert.deepEqual(done, { role: 'demolition', scope_key: '', item_key: 'demo-order-photo', checked: true, has_photo: true });
    assert.equal(db.work_checks.length, 1);
    assert.deepEqual([db.work_checks[0].role, db.work_checks[0].list_version, db.work_checks[0].order_id, db.work_checks[0].document_id], ['demolition', 'v3', O1, DOC_DM]);
    // 다른 역할의 항목은 체크할 수 없다
    await assert.rejects(() => postAssignmentCheck(ENV, { user: me, params: { id: A_DM }, body: { ...base, role: 'delivery', item_key: 'dlv-order-count' } }), (e) => e.statusCode === 403);

    const dv = await getAssignmentChecks(ENV, { user: me, params: { id: A_DV } });
    assert.deepEqual(dv.roles[0].cells[0].items.map((x) => [x.key, x.photo]), [['dlv-order-count', 'none'], ['dlv-order-photo', 'need']]);
    await postAssignmentCheck(ENV, { user: me, params: { id: A_DV }, body: { document_id: DOC_DV, role: 'delivery', scope_key: '', item_key: 'dlv-order-count', checked: true } });
    const after = await getAssignmentChecks(ENV, { user: me, params: { id: A_DV } });
    assert.deepEqual([after.roles[0].done, after.roles[0].total, after.roles[0].must_left], [1, 2, 1]);
  });
});

test('필수 확인 — DB 가 새 역할을 아직 모르면 (0068 적용 전) 409 db_pending', async () => {
  await withDb(makeDb(), async () => {
    await assert.rejects(
      () => postAssignmentCheck(ENV, { user: me, params: { id: A_DV }, body: { document_id: DOC_DV, role: 'delivery', scope_key: '', item_key: 'dlv-order-count', checked: true } }),
      (e) => e.statusCode === 409 && e.details && e.details.code === 'db_pending' && /0068/.test(e.message),
    );
  }, { rejectRole: true });
});

test('완료 막기 — 철거 · 납품도 필수 확인이 남으면 409 checks_left, 다 하면 지나간다 (v3 문서만)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await assert.rejects(() => assertChecksDone(ENV, { orderId: O1, role: 'demolition' }), (e) => e.statusCode === 409 && e.details.code === 'checks_left' && e.details.left === 1);
    await assert.rejects(() => assertChecksDone(ENV, { orderId: O1, role: 'delivery' }), (e) => e.details.left === 2);
    db.work_checks.push({ id: randomUUID(), document_id: DOC_DM, role: 'demolition', scope_key: '', item_key: 'demo-order-photo', checked: true, photo_path: 'x', created_at: new Date().toISOString() });
    await assertChecksDone(ENV, { orderId: O1, role: 'demolition' });
  });
  // 지시서가 없거나 · 그 역할 항목이 없는 판(v2)이면 막지 않는다
  await withDb(makeDb({ design_documents: [] }), async () => { await assertChecksDone(ENV, { orderId: O1, role: 'demolition' }); });
  const v2doc = siteDoc('demolition_order', { render_payload: { site_info: SITE, check_list: frozenCheckList('v2') } });
  await withDb(makeDb({ design_documents: [v2doc] }), async () => { await assertChecksDone(ENV, { orderId: O1, role: 'demolition' }); });
});

test('본사 · 업체 보기 — 주문의 필수 확인에 철거 · 납품 역할이 그 지시서 판으로 붙는다', async () => {
  await withDb(makeDb(), async () => {
    const out = await getOrderChecks(ENV, { user: { id: HQ_OWNER }, params: { orderId: O1 } });
    const byRole = new Map(out.roles.map((r) => [r.role, r]));
    assert.equal(byRole.get('demolition').document.id, DOC_DM);
    assert.equal(byRole.get('delivery').document.id, DOC_DV);
    assert.equal(byRole.get('cut').document.id, DOC_WO);
    assert.equal(byRole.has('install'), false, '시공 지시서는 아직 없다');
    // 작업지시서 판의 역할에는 철거 · 납품이 겹쳐 붙지 않는다
    assert.equal(out.roles.filter((r) => r.role === 'demolition').length, 1);
  });
});
