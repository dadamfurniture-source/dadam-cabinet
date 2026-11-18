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

// ── 철거 지시서의 현장 사진 (틀) ─────────────────────────────────

const DRAFT = 'kitchen-ab12';
const SIGNED = (file) => `https://x.supabase.co/storage/v1/object/sign/planner-photos/${HQ}/${DRAFT}/${file}?token=T`;
const imgs = (html) => [...html.matchAll(/<img src="([^"]+)" alt="현장 사진 \d+">/g)].map((m) => m[1]);
const sheetCount = (html) => html.split('<div class="sheet">').length - 1;

test('철거 지시서 — 현장 사진: 있으면 다음 장에 싣고 없으면 표지에 「없음」 한 줄, 납품 지시서에는 없다', () => {
  const photos = [{ url: `${SIGNED('photo-aaaa-0001.jpg')}&n=1`, w: 4000, h: 3000 }, { url: SIGNED('photo-aaaa-0002.png') }, { url: '' }, null];
  const html = renderDocument(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false, sitePhotos: photos });
  assert.deepEqual(imgs(html), [`${SIGNED('photo-aaaa-0001.jpg')}&amp;n=1`, SIGNED('photo-aaaa-0002.png')], '주소는 글자로 (& 는 바꿔 싣는다)');
  assert.match(strip(html), /특기 사항 주말 작업 불가 현장 사진 2장 — 다음 장 품목 /);
  assert.match(strip(html), /현장 사진 철거할 자리 — 팩토리가 설계에 올려 둔 사진 현장 사진 1 현장 사진 2 /);
  const none = renderDocument(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false, sitePhotos: [] });
  assert.equal(sheetCount(html), sheetCount(none) + 1, '사진 장은 사진이 있을 때만');
  assert.match(strip(none), /현장 사진 없음 품목 /);
  assert.deepEqual(imgs(none), []);
  // 사진을 넘기지 않아도 (못 읽었을 때) 같은 「없음」
  assert.equal(renderDocument(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false }), none);
  // 납품 지시서는 사진을 넘겨도 싣지 않는다 (처리방침에 적은 것은 철거 작업자뿐)
  const dv = renderDocument(siteDoc('delivery_order'), SNAPSHOT, { toolbar: false, sitePhotos: photos });
  assert.equal(dv, renderDocument(siteDoc('delivery_order'), SNAPSHOT, { toolbar: false }));
  assert.doesNotMatch(strip(dv), /현장 사진/);
});

test('철거 지시서 — 작업자 보기: 현장 사진은 주소와 같은 때에만 (닫혀 있으면 사진도 「없음」 글도 없다)', () => {
  const photos = [{ url: SIGNED('photo-aaaa-0001.jpg') }];
  const view = (siteOpen) => renderSiteOrder(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false, sitePhotos: photos, worker: { orderLabel: '홍*동 · SO-1', siteOpen } });
  const closed = view(false);
  assert.deepEqual(imgs(closed), []);
  assert.doesNotMatch(closed, /planner-photos/);
  assert.doesNotMatch(strip(closed), /현장 사진/);
  assert.equal(closed, renderSiteOrder(siteDoc('demolition_order'), SNAPSHOT, { toolbar: false, worker: { orderLabel: '홍*동 · SO-1', siteOpen: false } }), '닫힌 보기는 사진이 있든 없든 같다');
  const open = view(true);
  assert.deepEqual(imgs(open), [SIGNED('photo-aaaa-0001.jpg')]);
  assert.match(strip(open), /현장 사진 1장 — 다음 장/);
});

// ── 발행 ─────────────────────────────────────────────────────────

/** 발행 가짜 DB — 본사 설계. reject = DB 가 새 문서 종류를 거절한다 (0068 적용 전) */
function issueRoute({ reject = false, renders = [] } = {}) {
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
    // 발행 때 고정하는 그림 (납품 = 정면 렌더 · ISO, 철거 = 배치 평면 — 2026-11-19)
    if (u.includes('/design_renders?')) return json(renders.filter((r) => u.includes(`kind=eq.${r.kind}`)));
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
    // 비공개 버킷 서명 주소 (현장 사진) — signFail 이면 저장소가 거절한다
    if (method === 'POST' && u === `${ENV.SUPABASE_URL}/storage/v1/object/sign/planner-photos`) {
      if (db.signFail) return json({ message: 'boom' }, 500);
      return json(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/planner-photos/${p}?token=T` })));
    }
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
  // 작업에 주문이 없고 그 설계에도 수주가 없다 (프로젝트에 잇지 않은 설계) — 열지 않는다
  const noOrderJob = [{ id: 'J-DM', kind: 'demolition', order_id: null, design_id: 'D1', company_id: HQ, status: 'open', slots: 1 }];
  await withDb(makeDb({ work_jobs: noOrderJob, orders: [] }), async () => {
    await assert.rejects(() => pack(A_DM), (e) => e.statusCode === 404 && /연결된 주문이 없습니다/.test(e.message));
  });
  // 작업에는 주문이 안 적혀 있어도 그 설계의 수주가 (나중에) 있으면 그 수주로 연다
  await withDb(makeDb({ work_jobs: noOrderJob }), async () => {
    assert.match(strip(await pack(A_DM)), /고객 홍\*동/);
  });
});

// ── 작업자 꾸러미의 현장 사진 ────────────────────────────────────

/** 간편 플래너로 보낸 설계 + 그 플래너 설계의 사진 (가짜 DB 는 select 를 보지 않아 photos 를 바로 둔다 — 실제는 model->photos) */
function plannerDb(over = {}) {
  const photo = (file, extra = {}) => ({ company_id: HQ, draft_id: DRAFT, file, width: 4000, height: 3000, deleted_at: null, ...extra });
  return makeDb({
    designs: [{ id: 'D1', user_id: HQ_OWNER, company_id: HQ, source: 'planner-lite', source_ref: DRAFT }],
    planner_drafts: [{
      company_id: HQ, id: DRAFT, discarded_at: null,
      photos: [
        { id: 'p1', kind: 'site', file: 'photo-aaaa-0001.jpg', note: '고객 메모가 섞일 수 있는 글' },
        { id: 'p2', kind: 'ai', file: 'photo-aaaa-0002.png' },
        { id: 'p3', kind: 'site', file: 'photo-aaaa-0003.webp' },
        { id: 'p4', kind: 'complete', file: 'photo-aaaa-0004.jpg' },
        { id: 'p5', kind: 'site', file: '../other/photo-aaaa-0005.jpg' },
        { id: 'p6', kind: 'site', file: 'photo-aaaa-0006.jpg' },
        { id: 'p1b', kind: 'site', file: 'photo-aaaa-0001.jpg' },
      ],
    }],
    planner_draft_photos: [
      photo('photo-aaaa-0001.jpg'), photo('photo-aaaa-0002.png'), photo('photo-aaaa-0004.jpg'), photo('photo-aaaa-0006.jpg', { width: null, height: null }),
      photo('photo-aaaa-0003.webp', { deleted_at: '2026-11-17T00:00:00.000Z' }),   // 플래너에서 지운 사진
    ],
    ...over,
  });
}
const photoCalls = (calls) => calls.filter((c) => /planner_drafts|planner_draft_photos|\/storage\//.test(c.url));

test('작업자 꾸러미 — 철거 지시서의 현장 사진: 현장사진만 · 지운 것 빼고, 주소와 같은 때에만 읽는다', async () => {
  await withDb(plannerDb(), async (calls) => {
    const dm = await pack(A_DM);
    assert.deepEqual(imgs(dm), [SIGNED('photo-aaaa-0001.jpg'), SIGNED('photo-aaaa-0006.jpg')], '플래너에 올린 차례 · 같은 파일은 한 번');
    assert.doesNotMatch(dm, /고객 메모가 섞일 수 있는 글/, '사진 글은 싣지 않는다');
    const sign = calls.filter((c) => /\/storage\//.test(c.url));
    assert.equal(sign.length, 1);
    assert.deepEqual(sign[0].body, { expiresIn: 3600, paths: [`${HQ}/${DRAFT}/photo-aaaa-0001.jpg`, `${HQ}/${DRAFT}/photo-aaaa-0006.jpg`] });
    // 플래너 설계는 사진 목록 칸만 읽는다 (설계 본문 전체를 읽지 않는다)
    assert.match(calls.find((c) => /\/planner_drafts\?/.test(c.url)).url, /select=id,photos:model->photos/);
    // 끝나고 7일이 지난 배정 — 사진을 읽지도 않는다
    let mark = calls.length;
    const old = await pack(A_OLD);
    assert.deepEqual(imgs(old), []);
    assert.doesNotMatch(strip(old), /현장 사진/);
    assert.deepEqual(photoCalls(calls.slice(mark)), []);
    // 납품 지시서에는 없다
    mark = calls.length;
    assert.deepEqual(imgs(await pack(A_DV)), []);
    assert.deepEqual(photoCalls(calls.slice(mark)), []);
    assert.equal(calls.filter((c) => c.method !== 'GET' && !/\/storage\//.test(c.url)).length, 0, '읽기만');
  });
});

test('작업자 꾸러미 — 현장 사진이 없는 경우: PC 플래너 설계 · 버린 플래너 설계 · 다른 팩토리의 플래너 설계 · 서명 실패 → 사진 없이 열린다', async () => {
  const none = async (db, why) => {
    await withDb(db, async (calls) => {
      const html = await pack(A_DM);
      assert.deepEqual(imgs(html), [], why);
      assert.match(strip(html), /^철거 지시서 .*현장 사진 없음 /, why);
      assert.match(strip(html), /주소 서울시 시험구 시험로 1/, why);
      assert.equal(calls.filter((c) => /\/storage\//.test(c.url)).length, db.signFail ? 1 : 0, why);
    });
  };
  // 상세설계 화면에서 만든 설계 (플래너 설계가 아니다) — 플래너 표를 읽지 않는다
  await withDb(plannerDb({ designs: [{ id: 'D1', user_id: HQ_OWNER, company_id: HQ }] }), async (calls) => {
    assert.deepEqual(imgs(await pack(A_DM)), []);
    assert.deepEqual(photoCalls(calls), []);
  });
  await none(plannerDb({ planner_drafts: [] }), 'PC 플래너 — 앱에 플래너 설계가 없다');
  await none(plannerDb({ planner_drafts: [{ company_id: HQ, id: DRAFT, discarded_at: '2026-11-17T00:00:00.000Z', photos: [{ kind: 'site', file: 'photo-aaaa-0001.jpg' }] }] }), '버린 플래너 설계');
  const other = 'f0000000-0000-4000-8000-000000000009';
  await none(plannerDb({ planner_drafts: [{ company_id: other, id: DRAFT, discarded_at: null, photos: [{ kind: 'site', file: 'photo-aaaa-0001.jpg' }] }] }), '같은 id 의 다른 팩토리 플래너 설계');
  await none(plannerDb({ planner_draft_photos: [] }), '사진 줄이 없다 (모두 지웠다)');
  await none(plannerDb({ signFail: true }), '서명 주소를 못 만들었다');
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

test('발행 — 그림을 문서에 고정한다: 납품 = 정면 렌더 · ISO, 철거 = 배치 평면, 그 동결본과 같이 온 그림만 (2026-11-19)', async () => {
  const hash = fx.snapshot({ id: 's1', design_id: 'd-hq' }).content_hash;
  const uid = Math.floor(fx.snapshot().design_payload.items[0].uniqueId);   // 품목 번호는 정수로 읽는다 (itemUniqueIdOf)
  const row = (kind, path, snapshot = hash) => ({ item_unique_id: uid, kind, path, width: null, height: null, camera: { source: 'planner-lite', snapshot }, created_at: '2026-11-19T03:00:00Z' });
  const renders = [row('front', 'd-hq/1/front.png'), row('iso', 'd-hq/1/iso.svg'), row('layout', 'd-hq/1/layout.svg'), row('inside', 'd-hq/1/inside.svg')];
  const issued = async (docType, list) => withFetch(issueRoute({ renders: list }), async (calls) => {
    await issueDocument(ENV, { user: { id: HQ_OWNER, email: 'owner@example.test' }, body: { doc_type: docType, snapshot_id: 's1' } });
    return calls.find((c) => c.method === 'POST' && /\/design_documents$/.test(c.url.split('?')[0])).body.render_payload;
  });
  const dv = await issued('delivery_order', renders);
  assert.equal(dv.drawing_version, 1);
  assert.deepEqual([dv.renders[0].path, dv.iso_renders[0].path], ['d-hq/1/front.png', 'd-hq/1/iso.svg']);
  assert.equal('layout_renders' in dv, false);
  const dm = await issued('demolition_order', renders);
  assert.equal(dm.drawing_version, 1);
  assert.equal(dm.layout_renders[0].path, 'd-hq/1/layout.svg');
  ['renders', 'iso_renders', 'inside_renders'].forEach((k) => assert.equal(k in dm, false, k));
  // 다른 판의 그림뿐이면 싣지 않고 그 사실만 남긴다
  const old = await issued('demolition_order', [row('layout', 'd-hq/1/layout-old.svg', 'other-hash')]);
  assert.deepEqual([old.layout_renders[0].path, old.layout_renders[0].stale], [null, true]);
  // 그림이 하나도 없으면 칸을 싣지 않는다 — 판 표시만
  const none = await issued('delivery_order', []);
  assert.equal(none.drawing_version, 1);
  ['renders', 'iso_renders'].forEach((k) => assert.equal(k in none, false, k));
  // 설치 지시서 — 상판 탑뷰 · 배치 평면 · 속 구조 정면도까지
  const inst = await issued('installation_order', [...renders, row('plan', 'd-hq/1/plan.svg')]);
  assert.equal(inst.drawing_version, 1);
  assert.deepEqual([inst.plan_renders[0].path, inst.layout_renders[0].path, inst.inside_renders[0].path], ['d-hq/1/plan.svg', 'd-hq/1/layout.svg', 'd-hq/1/inside.svg']);
});

// ── 지시서의 그림 (2026-11-19 — 그림 묶음 판이 있는 문서만) ───────

const PLANNER_SNAPSHOT = { ...SNAPSHOT, design_payload: { ...SNAPSHOT.design_payload, source: 'planner-lite' } };
const URLS = new Map([
  ['D1/1/layout.svg', 'https://x.supabase.co/sign/layout.svg?token=T'],
  ['D1/1/iso.svg', 'https://x.supabase.co/sign/iso.svg?token=T'],
  ['D1/1/front.png', 'https://x.supabase.co/sign/front.png?token=T'],
  ['D1/1/inside.svg', 'https://x.supabase.co/sign/inside.svg?token=T'],
]);
const entry = (path, extra = {}) => ({ item_index: 0, item_unique_id: 1, path, width: null, height: null, created_at: null, ...extra });

test('철거 지시서 — 배치 평면: 그림이 있으면 싣고, 없으면 까닭 한 줄 (없음 · 다른 판 · 못 불러옴). 옛 문서 · 플래너 설계가 아니면 장이 없다', () => {
  const rp = (extra) => ({ site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3'), drawing_version: 1, ...extra });
  const html = (payload, snapshot = PLANNER_SNAPSHOT, urls = URLS) => renderSiteOrder(siteDoc('demolition_order', { render_payload: payload }), snapshot, { toolbar: false, renderUrls: urls });
  const withPlan = html(rp({ layout_renders: [entry('D1/1/layout.svg')] }));
  assert.match(withPlan, /<h2>배치 평면/);
  assert.match(withPlan, /<img src="https:\/\/x\.supabase\.co\/sign\/layout\.svg\?token=T" alt="배치 평면"/);
  assert.match(strip(html(rp({}))), /배치 평면 없음 — 플래너에서 다시 보내고 지시서를 다시 내 주세요/);
  assert.match(strip(html(rp({ layout_renders: [entry(null, { stale: true })] }))), /배치 평면 — 이 설계 판의 그림이 아님/);
  assert.match(strip(html(rp({ layout_renders: [entry('D1/1/layout.svg')] }), PLANNER_SNAPSHOT, new Map())), /배치 평면 — 그림을 불러올 수 없음/);
  // 그림 장은 표지 다음 · 현장 사진 앞
  const withPhotos = renderSiteOrder(siteDoc('demolition_order', { render_payload: rp({ layout_renders: [entry('D1/1/layout.svg')] }) }), PLANNER_SNAPSHOT, { toolbar: false, renderUrls: URLS, sitePhotos: [{ url: 'https://x.test/p1.jpg' }] });
  assert.ok(withPhotos.indexOf('<h2>배치 평면') < withPhotos.lastIndexOf('<h2>현장 사진'));
  // 옛 문서(그림 묶음 판 없음) · 플래너에서 오지 않은 설계 — 장이 없다
  const old = { site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3') };
  assert.doesNotMatch(html(old), /배치 평면/);
  assert.equal(html(old), renderSiteOrder(siteDoc('demolition_order', { render_payload: old }), PLANNER_SNAPSHOT, { toolbar: false }), '옛 문서는 그림 주소를 줘도 그대로');
  assert.doesNotMatch(html(rp({ layout_renders: [entry('D1/1/layout.svg')] }), SNAPSHOT), /배치 평면/);
  // 작업자 보기 — 현장이 닫혀 있어도 그림은 보인다 (주소 · 사진만 닫힌다), 고객 이름은 없다
  const worker = renderSiteOrder(siteDoc('demolition_order', { render_payload: rp({ layout_renders: [entry('D1/1/layout.svg')] }) }), PLANNER_SNAPSHOT, { toolbar: false, renderUrls: URLS, worker: { orderLabel: '수주 전 · DD-1', siteOpen: false } });
  assert.match(worker, /sign\/layout\.svg/);
  assert.doesNotMatch(strip(worker), /홍길동|시험로 1/);
});

test('납품 지시서 — 벽마다 ISO 도면 · 3D 앞모습 (번호 = 싣는 품목 번호), ISO 가 없으면 앱 정면도. 옛 문서는 그대로', () => {
  const rp = (extra) => ({ site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3'), drawing_version: 1, ...extra });
  const html = (payload) => renderSiteOrder(siteDoc('delivery_order', { render_payload: payload }), PLANNER_SNAPSHOT, { toolbar: false, renderUrls: URLS });
  const full = html(rp({ renders: [entry('D1/1/front.png')], iso_renders: [entry('D1/1/iso.svg')] }));
  assert.match(full, /sign\/iso\.svg\?token=T" alt="싱크대 #1 ISO 도면"/);
  assert.match(full, /<h2>3D 앞모습<\/h2>/);
  assert.match(full, /sign\/front\.png/);
  assert.match(strip(full), /번호 = 싣는 품목 번호/);
  assert.ok(full.indexOf('ISO 도면') < full.indexOf('싣는 품목 — 모듈'), '그림 장이 품목 표 앞');
  // ISO 가 없으면 앱이 그린 정면도 — 3D 앞모습이 없으면 그 칸을 그리지 않는다
  const plain = html(rp({}));
  assert.match(plain, /<svg[^>]*>/);
  assert.match(strip(plain), /정면도/);
  assert.doesNotMatch(plain, /3D 앞모습/);
  const old = { site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3') };
  assert.doesNotMatch(html(old), /번호 = 싣는 품목 번호|ISO 도면|<svg/);
  // 철거 지시서에는 품목 그림을 싣지 않는다
  assert.doesNotMatch(renderSiteOrder(siteDoc('demolition_order', { render_payload: rp({ renders: [entry('D1/1/front.png')] }) }), PLANNER_SNAPSHOT, { toolbar: false, renderUrls: URLS }), /3D 앞모습/);
});

test('설치 지시서 — 그림 묶음 판이 있으면 배치 평면 · 상판 탑뷰 · 속 구조 정면도 장이 이어진다 (옛 문서의 지문은 위 시험이 지킨다)', () => {
  const base = { doc_no: 'DD-20261119-AAAA-IO-r1', doc_type: 'installation_order', created_at: '2026-11-19T02:00:00.000Z', customer_name: '홍길동' };
  const topRow = { partId: 'line|0-ep-top-0', slot: 'top', part: '상판', material: '인조대리석', thickness: 12, w: 2400, h: 600, qty: 1, module: '줄 부재' };
  const withTop = { ...PLANNER_SNAPSHOT, bom_payload: { ...PLANNER_SNAPSHOT.bom_payload, materials: [...PLANNER_SNAPSHOT.bom_payload.materials, topRow] } };
  const rp = (extra) => ({ site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3'), renders: [], drawing_version: 1, ...extra });
  const html = (payload, snapshot = withTop, opts = {}) => renderInstallationOrder({ ...base, render_payload: payload }, snapshot, { toolbar: false, renderUrls: URLS, ...opts });
  const full = html(rp({ layout_renders: [entry('D1/1/layout.svg')], inside_renders: [entry('D1/1/inside.svg', { view: { w: 900, h: 400 }, boxes: [] })] }));
  assert.match(full, /<h2>배치 평면<\/h2>/);
  assert.match(full, /sign\/layout\.svg/);
  assert.match(full, /<h2>상판 탑뷰<\/h2>/);
  assert.match(full, /class="top-plan"/, '일자 상판은 앱이 그린 탑뷰');
  assert.match(full, /<h2>속 구조 정면도/);
  assert.match(full, /sign\/inside\.svg\?token=T" alt="싱크대 #1 속 구조 정면도"/);
  assert.ok(full.indexOf('<h2>배치 평면') < full.indexOf('<h2>상판 탑뷰') && full.indexOf('<h2>상판 탑뷰') < full.indexOf('<h2>속 구조 정면도'));
  // 그림이 없으면 까닭 한 줄
  assert.match(strip(html(rp({}))), /배치 평면 없음 — 플래너에서 다시 보내고 지시서를 다시 내 주세요/);
  assert.match(strip(html(rp({ inside_renders: [entry(null, { stale: true })] }))), /싱크대 #1 속 구조 정면도 — 이 설계 판의 그림이 아님/);
  // 상판이 없는 설계 — 탑뷰 장이 없다. 플래너에서 오지 않은 설계 — 플래너 그림 장이 없다 (상판 탑뷰는 그린다)
  assert.doesNotMatch(html(rp({}), PLANNER_SNAPSHOT), /<h2>상판 탑뷰/);
  const app = html(rp({}), { ...withTop, design_payload: SNAPSHOT.design_payload });
  assert.doesNotMatch(app, /<h2>배치 평면|<h2>속 구조 정면도/);
  assert.match(app, /<h2>상판 탑뷰/);
  // 옛 문서 (그림 묶음 판 없음) — 새 장이 없다
  assert.doesNotMatch(html({ site_info: SITE, schedules: SCHEDULES, check_list: frozenCheckList('v3'), renders: [] }), /배치 평면|상판 탑뷰|속 구조 정면도/);
});
