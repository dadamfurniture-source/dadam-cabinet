/**
 * 작업 줄의 지시서 · 사무실 메모 (src/work/job-sheet.js · project-work.js · company-projects.js — 2026-11-17, DB 0068)
 *   GET /company/projects/:id/work 의 줄마다 sheet · sheet_memo · PATCH …/work/:kind { sheet_memo } · PUT /company/work/jobs/:id/sheet-memo ·
 *   GET /designs/:id/work-sheets · GET /documents/:id/print?job= · PUT /designs/:id/project (처음 붙이기는 수주가 있어도).
 *
 *   - 작업 종류마다 그 설계의 지금 문서: 철거 → 철거 지시서 · 재단 · 엣지 · 조립 → 작업지시서 · 납품 → 납품 지시서 · 설치 → 설치 지시서, A/S 는 없음
 *   - 메모는 대표 · 실장만, 내 팩토리 작업만. 0068 전이면 409 db_pending
 *   - 응답에 고객 정보 · 설계 id 가 없다
 * 가짜 Supabase 는 test/helpers/push-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { frozenCheckList } from '../src/work/check-items.js';
import { SHEET_KINDS, SHEET_MEMO_MAX, memoOf, sheetKindOf } from '../src/work/job-sheet.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service', PUBLIC_BASE_URL: 'https://app.test', SHARE_TOKEN_PEPPER: 'pepper-for-tests' };
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const C = (i) => id('c0', i);
const U = (i) => id('a0', i);
const W = (i) => id('b0', i);
const L = (i) => id('d0', i);
const D = (i) => id('0d', i);
const S = (i) => id('05', i);
const O = (i) => id('0a', i);
const P = (i) => id('0e', i);
const DOC = (i) => id('0f', i);
const SNAP = id('09', 1);
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-17T12:00:00');

const HQ = C(100);
const A = C(1);
const B = C(2);
const OWNER_A = U(11);
const STAFF_A = U(13);
const OWNER_B = U(21);

const SNAPSHOT = {
  id: SNAP, design_id: D(1), rev: 2, content_hash: 'hash-2',
  design_payload: { items: [{ labelName: '싱크대', categoryId: 'sink', w: 2400, h: 2300, d: 600, modules: [{ pos: 'lower', name: '도어장', w: 900, h: 708, d: 550, doorCount: 2 }] }] },
  bom_payload: { materials: [{ partId: 'a|1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 }] },
  cut_plan_payload: null,
};
const SHEET = (color) => ({
  no: 1, material: 'PB', thickness: 15, partClass: '본체', ...(color ? { color } : {}), size: { w: 1220, h: 2440 }, trim: 10,
  layout: { no: 1, stack: 1, index: 1, dir: 'V', rotated: false }, strips: [],
  parts: [{ partId: 'a|1#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false, strip: 1 }], usedArea: 389400, yield: 0.13,
});
const cutPlan = (color) => ({ version: 1, strategy: 'standard', sheets: [SHEET(color)], offcuts: [], groups: [], smallParts: [], unallocated: [], summary: {} });
const docRow = (n, docType, over = {}) => ({
  id: DOC(n), design_id: D(1), snapshot_id: SNAP, doc_type: docType, rev: 1, doc_no: `DD-20261117-AAAA-${n}-r1`, status: 'issued', superseded_by: null,
  title: '김고객 주방', customer_name: '김고객', created_at: iso('2026-11-17T09:00:00'),
  render_payload: { check_list: frozenCheckList('v3'), site_info: { address: '시험시 시험구 시험로 1', floor: '3', contact_name: '김고객', contact_phone: '010-9999-9999' }, schedules: [], ...(docType === 'work_order' ? { work_order_version: 2, cut_plan: cutPlan('화이트') } : {}) },
  ...over,
});

function tables() {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER_A, company_id: A, role: 'owner', status: 'active' },
      { user_id: STAFF_A, company_id: A, role: 'staff', status: 'active' },
      { user_id: OWNER_B, company_id: B, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    workers: [{ id: W(1), user_id: U(101), display_name: '시험기사1', phone: '010-0000-0001', kinds: ['demolition', 'delivery', 'install', 'as'], region_label: '시험시 시험구', status: 'approved', consent_version: 'v1' }],
    worker_companies: [{ id: L(1), company_id: A, worker_id: W(1), status: 'approved', kinds: [], via: 'invite', invite_id: null, created_at: iso('2026-11-01T09:00:00') }],
    customers: [],
    projects: [
      { id: P(1), company_id: A, customer_id: null, title: '김고객 주방', status: 'active' },
      { id: P(2), company_id: A, customer_id: null, title: '둘째 프로젝트', status: 'active' },
      { id: P(9), company_id: B, customer_id: null, title: '남의 프로젝트', status: 'active' },
    ],
    designs: [
      { id: D(1), company_id: A, user_id: OWNER_A, name: '김고객 주방 설계', project_id: P(1) },
      { id: D(3), company_id: A, user_id: OWNER_A, name: '플래너에서 보낸 설계', project_id: null },
      { id: D(9), company_id: B, user_id: OWNER_B, name: '남의 설계', project_id: P(9) },
    ],
    design_site_info: [{ design_id: D(1), address: '시험시 시험구 시험로 1', sido: '시험시', gugun: '시험구' }],
    design_schedules: [
      { id: S(2), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-21T14:00:00'), duration_min: 60, assignee_name: null },
      { id: S(3), design_id: D(1), type: 'as_visit', title: 'A/S 방문', status: 'scheduled', scheduled_at: iso('2026-11-25T15:00:00'), duration_min: null, assignee_name: null },
    ],
    orders: [
      { id: O(1), company_id: A, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', created_at: iso('2026-11-01T09:00:00') },
      { id: O(3), company_id: A, order_no: 'SO-20261102-BBBB', status: 'in_production', design_id: D(3), project_id: null, customer_name: '박고객', created_at: iso('2026-11-02T09:00:00') },
    ],
    as_requests: [],
    worker_invites: [],
    work_jobs: [],
    work_assignments: [],
    work_applications: [],
    work_updates: [],
    work_job_events: [],
    worker_events: [],
    design_documents: [],
    design_snapshots: [SNAPSHOT],
    work_checks: [],
  };
}

const USERS = { t_owner: { id: OWNER_A }, t_staff: { id: STAFF_A }, t_other: { id: OWNER_B } };
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

async function call(fake, token, path, init = {}) {
  const realNow = Date.now;
  Date.now = () => AT;
  const pending = [];
  try {
    return await withFake(fake, async () => {
      const res = await worker.fetch(
        new Request(`https://api.test${path}`, {
          method: init.method || 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: init.body ? JSON.stringify(init.body) : undefined,
        }),
        ENV,
        { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => null)) },
      );
      const text = await res.text();
      await Promise.all(pending);
      const isJson = (res.headers.get('Content-Type') || '').includes('json');
      return { status: res.status, json: isJson && text ? JSON.parse(text) : null, text };
    });
  } finally {
    Date.now = realNow;
  }
}
const view = (fake, token = 't_owner', p = P(1)) => call(fake, token, `/company/projects/${p}/work`);
const rowOf = (r, key) => r.json.data.rows.find((x) => x.key === key);
const patchKind = (fake, token, kind, body) => call(fake, token, `/company/projects/${P(1)}/work/${kind}`, { method: 'PATCH', body });
const jobOf = (fake, kind) => fake.db.work_jobs.find((j) => j.kind === kind && j.status !== 'cancelled');
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** DB 0068 적용 전 — work_jobs.sheet_memo 칸이 없다 */
function before0068(fake) {
  const inner = fake.fetch;
  fake.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
    if (url.includes('/rest/v1/work_jobs') && String(init.body || '').includes('"sheet_memo"')) {
      return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'sheet_memo' column of 'work_jobs' in the schema cache" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  return fake;
}

// ── 순수 ──────────────────────────────────────────────────────────

test('순수 — 작업 종류마다 문서 · 꾸러미, A/S 는 지시서가 없다. 메모는 2000자까지', () => {
  assert.deepEqual([...SHEET_KINDS], ['demolition', 'cutting', 'edge', 'assembly', 'delivery', 'install']);
  assert.deepEqual(SHEET_KINDS.map((k) => [sheetKindOf(k).doc_type, sheetKindOf(k).doc_label, sheetKindOf(k).packs]), [
    ['demolition_order', '철거 지시서', ['demolition']],
    ['work_order', '작업지시서', ['cut', 'labels']],
    ['work_order', '작업지시서', ['cut', 'labels']],
    ['work_order', '작업지시서', ['assembly']],
    ['delivery_order', '납품 지시서', ['delivery']],
    ['installation_order', '설치 지시서', ['install']],
  ]);
  assert.equal(sheetKindOf('as'), null);
  assert.equal(memoOf('  오전에 끝내 주세요  '), '오전에 끝내 주세요');
  assert.equal(memoOf(''), null);
  assert.equal(memoOf('   '), null);
  assert.equal(memoOf(null), null);
  assert.equal(memoOf('가'.repeat(SHEET_MEMO_MAX)).length, SHEET_MEMO_MAX);
  assert.throws(() => memoOf('가'.repeat(SHEET_MEMO_MAX + 1)), (e) => e.statusCode === 422);
  assert.throws(() => memoOf(7), (e) => e.statusCode === 422);
});

// ── 작업 배정 줄 ──────────────────────────────────────────────────

test('작업 배정 — 줄마다 지시서: 아직 안 냈으면 none, 냈으면 문서 번호 · 판 · 필수 확인 수. A/S 줄은 없음', async () => {
  const fake = world();
  const r0 = await view(fake);
  assert.equal(r0.status, 200);
  assert.deepEqual(r0.json.data.rows.map((x) => [x.kind, x.sheet ? x.sheet.doc_type : null, x.sheet ? x.sheet.state : null]), [
    ['demolition', 'demolition_order', 'none'],
    ['cutting', 'work_order', 'none'],
    ['edge', 'work_order', 'none'],
    ['assembly', 'work_order', 'none'],
    ['delivery', 'delivery_order', 'none'],
    ['as', null, null],
  ]);
  r0.json.data.rows.forEach((x) => {
    assert.equal(x.sheet_memo, null);
    assert.equal('design_id' in x, false, '설계 id 는 싣지 않는다');
  });

  fake.db.design_documents.push(docRow(1, 'demolition_order'), docRow(2, 'work_order'), docRow(3, 'work_order', { id: DOC(4), rev: 0, superseded_by: DOC(2) }));
  fake.db.work_checks.push({ id: id('0b', 1), document_id: DOC(1), role: 'demolition', scope_key: '', item_key: 'demo-order-photo', checked: true, photo_path: 'x', created_at: iso('2026-11-17T10:00:00') });
  const r1 = await view(fake);
  const dm = rowOf(r1, 'kind:demolition').sheet;
  assert.deepEqual([dm.state, dm.doc_label, dm.role, dm.packs], ['issued', '철거 지시서', 'demolition', ['demolition']]);
  assert.deepEqual(dm.document, { id: DOC(1), doc_no: 'DD-20261117-AAAA-1-r1', rev: 1, created_at: iso('2026-11-17T09:00:00') });
  assert.deepEqual(dm.checks, { done: 1, total: 1, must_left: 0 });
  const cut = rowOf(r1, 'kind:cutting').sheet;
  assert.deepEqual([cut.state, cut.document.id, cut.packs], ['issued', DOC(2), ['cut', 'labels']], '새 판에 밀린 문서가 아니라 지금 문서');
  assert.ok(cut.checks.total > 0 && cut.checks.done === 0);
  assert.equal(rowOf(r1, 'kind:edge').sheet.checks, null, '엣지 역할은 목록에 항목이 없다');
  assert.equal(rowOf(r1, `schedule:${S(2)}`).sheet.state, 'none', '납품 지시서는 아직');
  // 응답에 문서 내용 · 고객 정보가 없다 (프로젝트 이름은 예전부터 싣는다)
  assert.doesNotMatch(JSON.stringify(r1.json.data.rows), /render_payload|site_info|customer_name|김고객|010-9999|시험로/);
  // 직원도 본다 (읽기)
  assert.equal((await view(fake, 't_staff')).status, 200);
});

test('작업 배정 — 설계가 없는 프로젝트의 줄은 no_design', async () => {
  const fake = world();
  const r = await view(fake, 't_owner', P(2));
  assert.deepEqual(r.json.data.rows.map((x) => [x.kind, x.sheet.state]), [['demolition', 'no_design'], ['cutting', 'no_design'], ['edge', 'no_design'], ['assembly', 'no_design']]);
});

test('작업 배정 — 작업을 만든 뒤 수주가 생기면, 볼 때 그 작업의 수주 · 설계 칸을 채운다 (비어 있는 칸만)', async () => {
  const t = tables();
  t.orders = t.orders.filter((o) => o.id !== O(1));
  const fake = world(t);
  assert.equal((await patchKind(fake, 't_owner', 'demolition', { at: iso('2026-11-19T09:00:00') })).status, 200);
  assert.deepEqual([jobOf(fake, 'demolition').design_id, jobOf(fake, 'demolition').order_id], [D(1), null]);
  fake.db.orders.push({ id: O(1), company_id: A, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', created_at: iso('2026-11-18T09:00:00') });
  await view(fake);
  assert.equal(jobOf(fake, 'demolition').order_id, O(1));
  // 이미 이어진 수주는 바꾸지 않는다
  fake.db.orders.push({ id: O(2), company_id: A, order_no: 'SO-20261119-CCCC', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', created_at: iso('2026-11-19T09:00:00') });
  await view(fake);
  assert.equal(jobOf(fake, 'demolition').order_id, O(1));
});

// ── 메모 ──────────────────────────────────────────────────────────

test('메모 — 철거 · 재단 · 엣지 · 조립 줄: PATCH { sheet_memo } (작업이 없으면 만든다), 대표 · 실장만', async () => {
  const fake = world();
  const r = await patchKind(fake, 't_owner', 'demolition', { sheet_memo: '  기존 상부장은 남깁니다  ' });
  assert.equal(r.status, 200);
  assert.equal(rowOf(r, 'kind:demolition').sheet_memo, '기존 상부장은 남깁니다');
  const job = jobOf(fake, 'demolition');
  assert.equal(job.sheet_memo, '기존 상부장은 남깁니다');
  assert.deepEqual([job.project_id, job.design_id, job.order_id, job.starts_at], [P(1), D(1), O(1), null]);
  assert.ok(fake.db.work_job_events.some((e) => e.job_id === job.id && e.type === 'job_updated' && JSON.stringify(e.payload).includes('sheet_memo')));
  // 날짜와 같이
  const both = await patchKind(fake, 't_owner', 'demolition', { at: iso('2026-11-19T09:00:00'), sheet_memo: '바뀐 메모' });
  assert.equal(rowOf(both, 'kind:demolition').sheet_memo, '바뀐 메모');
  assert.equal(rowOf(both, 'kind:demolition').at, iso('2026-11-19T09:00:00'));
  // 지우기
  const cleared = await patchKind(fake, 't_owner', 'demolition', { sheet_memo: '' });
  assert.equal(rowOf(cleared, 'kind:demolition').sheet_memo, null);
  assert.equal(jobOf(fake, 'demolition').sheet_memo, null);
  // 빈 메모만으로는 작업을 만들지 않는다
  await patchKind(fake, 't_owner', 'edge', { sheet_memo: '   ' });
  assert.equal(jobOf(fake, 'edge'), undefined);
  // 직원은 못 쓴다 · 너무 긴 글 · 글자가 아닌 값
  assert.equal((await patchKind(fake, 't_staff', 'cutting', { sheet_memo: '메모' })).status, 403);
  assert.equal((await patchKind(fake, 't_owner', 'cutting', { sheet_memo: '가'.repeat(SHEET_MEMO_MAX + 1) })).status, 422);
  assert.equal((await patchKind(fake, 't_owner', 'cutting', { sheet_memo: 3 })).status, 422);
  assert.equal((await patchKind(fake, 't_owner', 'cutting', {})).status, 422);
  assert.equal(jobOf(fake, 'cutting'), undefined);
});

test('메모 — 작업 id 로: PUT /company/work/jobs/:id/sheet-memo (일정 줄 납품 · 설치), 남의 작업 404 · A/S 409', async () => {
  const t = tables();
  t.work_jobs.push(
    { id: id('0c', 1), kind: 'delivery', title: '납품', company_id: A, design_id: D(1), order_id: O(1), schedule_id: S(2), status: 'open', slots: 1, version: 0, mode: 'invite' },
    { id: id('0c', 2), kind: 'as', title: 'A/S 방문', company_id: A, design_id: D(1), order_id: O(1), schedule_id: S(3), status: 'open', slots: 1, version: 0, mode: 'invite' },
    { id: id('0c', 9), kind: 'delivery', title: '납품', company_id: B, design_id: D(9), order_id: null, schedule_id: null, status: 'open', slots: 1, version: 0, mode: 'invite' },
  );
  const fake = world(t);
  const put = (token, jobId, body) => call(fake, token, `/company/work/jobs/${jobId}/sheet-memo`, { method: 'PUT', body });
  const ok = await put('t_owner', id('0c', 1), { memo: ' 1층 로비에 내려 주세요 ' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, { job_id: id('0c', 1), sheet_memo: '1층 로비에 내려 주세요' });
  assert.equal(fake.db.work_jobs[0].sheet_memo, '1층 로비에 내려 주세요');
  assert.equal(fake.db.work_jobs[0].version, 1);
  // 줄에도 보인다
  assert.equal(rowOf(await view(fake), `schedule:${S(2)}`).sheet_memo, '1층 로비에 내려 주세요');
  // 같은 값이면 쓰지 않는다 (줄을 볼 때 일정 시각을 맞추느라 판 번호는 이미 올라 있을 수 있다)
  const before = fake.db.work_jobs[0].version;
  await put('t_owner', id('0c', 1), { memo: '1층 로비에 내려 주세요' });
  assert.equal(fake.db.work_jobs[0].version, before);
  assert.equal((await put('t_owner', id('0c', 1), { memo: null })).json.data.sheet_memo, null);
  assert.equal((await put('t_staff', id('0c', 1), { memo: '직원' })).status, 403);
  assert.equal((await put('t_owner', id('0c', 9), { memo: '남의 작업' })).status, 404);
  assert.equal((await put('t_other', id('0c', 1), { memo: '남의 작업' })).status, 404);
  assert.equal((await put('t_owner', id('0c', 2), { memo: 'A/S' })).status, 409);
  assert.equal((await put('t_owner', id('0c', 1), {})).status, 422);
  assert.equal((await put('t_owner', 'not-a-uuid', { memo: 'x' })).status, 422);
  assert.equal(fake.db.work_jobs[2].sheet_memo, undefined);
});

test('메모 — DB 0068 적용 전이면 409 db_pending, 읽기는 그대로', async () => {
  const t = tables();
  t.work_jobs.push({ id: id('0c', 1), kind: 'delivery', title: '납품', company_id: A, design_id: D(1), order_id: O(1), schedule_id: S(2), status: 'open', slots: 1, version: 0, mode: 'invite' });
  const fake = before0068(world(t));
  const put = await call(fake, 't_owner', `/company/work/jobs/${id('0c', 1)}/sheet-memo`, { method: 'PUT', body: { memo: '메모' } });
  assert.equal(put.status, 409);
  assert.equal(put.json.code, 'db_pending');
  assert.match(put.json.message || put.json.error, /0068/);
  const patch = await patchKind(fake, 't_owner', 'demolition', { sheet_memo: '메모', at: iso('2026-11-19T09:00:00') });
  assert.equal(patch.status, 409);
  assert.equal(patch.json.code, 'db_pending');
  const r = await view(fake);
  assert.equal(r.status, 200);
  assert.equal(rowOf(r, `schedule:${S(2)}`).sheet_memo, null);
});

// ── 설계의 작업지시서 목록 (간편 플래너 「작업지시서」 탭) ──────────

test('설계의 작업지시서 — 종류 여섯 줄 (일하는 차례), 프로젝트 · 수주 여부. 다른 팩토리 설계는 못 본다', async () => {
  const fake = world();
  fake.db.design_documents.push(docRow(1, 'demolition_order'), docRow(2, 'work_order'));
  const r = await call(fake, 't_owner', `/designs/${D(1)}/work-sheets`);
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.deepEqual([d.design_id, d.has_order, d.project], [D(1), true, { id: P(1), title: '김고객 주방', status: 'active' }]);
  assert.deepEqual(d.sheets.map((x) => [x.kind, x.label, x.doc_type, x.state]), [
    ['demolition', '철거', 'demolition_order', 'issued'],
    ['cutting', '재단', 'work_order', 'issued'],
    ['edge', '엣지', 'work_order', 'issued'],
    ['assembly', '조립', 'work_order', 'issued'],
    ['delivery', '납품', 'delivery_order', 'none'],
    ['install', '설치', 'installation_order', 'none'],
  ]);
  assert.equal(d.sheets[0].document.id, DOC(1));
  assert.deepEqual(d.sheets[3].packs, ['assembly']);
  assert.doesNotMatch(JSON.stringify(r.json), /render_payload|김고객 주방 설계|010-9999|시험로/);
  // 프로젝트 없이 수주까지 간 설계
  const lone = await call(fake, 't_owner', `/designs/${D(3)}/work-sheets`);
  assert.deepEqual([lone.json.data.project, lone.json.data.has_order], [null, true]);
  assert.ok(lone.json.data.sheets.every((x) => x.state === 'none'));
  // 직원도 본다, 다른 팩토리는 못 본다
  assert.equal((await call(fake, 't_staff', `/designs/${D(1)}/work-sheets`)).status, 200);
  assert.ok([403, 404].includes((await call(fake, 't_other', `/designs/${D(1)}/work-sheets`)).status));
  assert.equal((await call(fake, 't_owner', '/designs/not-a-uuid/work-sheets')).status, 422);
});

// ── 인쇄 화면의 메모 ──────────────────────────────────────────────

test('인쇄 — 철거 지시서 ?job= 이면 그 작업 줄의 메모가 같이 나온다 (그 설계 · 그 종류의 작업일 때만)', async () => {
  const t = tables();
  t.design_documents.push(docRow(1, 'demolition_order'));
  t.work_jobs.push(
    { id: id('0c', 1), kind: 'demolition', title: '철거', company_id: A, project_id: P(1), design_id: D(1), order_id: O(1), status: 'open', slots: 1, version: 0, mode: 'invite', sheet_memo: '기존 상부장은 남깁니다' },
    { id: id('0c', 2), kind: 'delivery', title: '납품', company_id: A, design_id: D(1), order_id: O(1), schedule_id: S(2), status: 'open', slots: 1, version: 0, mode: 'invite', sheet_memo: '납품 메모' },
    { id: id('0c', 3), kind: 'demolition', title: '철거', company_id: A, project_id: P(2), design_id: D(3), order_id: O(3), status: 'open', slots: 1, version: 0, mode: 'invite', sheet_memo: '다른 설계 메모' },
  );
  const fake = world(t);
  const print = (q) => call(fake, 't_owner', `/documents/${DOC(1)}/print${q}`);
  const withMemo = await print(`?job=${id('0c', 1)}`);
  assert.equal(withMemo.status, 200);
  assert.match(strip(withMemo.text), /철거 지시서 .*사무실 메모 기존 상부장은 남깁니다 현장 정보/);
  // 사무실 인쇄는 주소 · 고객 이름을 그대로 본다 (설계를 볼 수 있는 사람)
  assert.match(strip(withMemo.text), /고객 김고객 .*주소 시험시 시험구 시험로 1/);
  assert.doesNotMatch(strip((await print('')).text), /사무실 메모/);
  assert.doesNotMatch(strip((await print(`?job=${id('0c', 2)}`)).text), /사무실 메모|납품 메모/, '다른 종류의 작업');
  assert.doesNotMatch(strip((await print(`?job=${id('0c', 3)}`)).text), /사무실 메모|다른 설계 메모/, '다른 설계의 작업');
  assert.equal((await print('?job=not-a-uuid')).status, 422);
  assert.ok([403, 404].includes((await call(fake, 't_other', `/documents/${DOC(1)}/print?job=${id('0c', 1)}`)).status));
});

// ── 인쇄 화면의 현장 사진 (철거 지시서) ──────────────────────────

test('인쇄 — 철거 지시서에 그 설계의 현장 사진이 실린다 (내 팩토리 플래너 설계의 현장사진만 · 지운 것 빼고), 납품 지시서에는 없다', async () => {
  const DRAFT = 'kitchen-ab12';
  const t = tables();
  Object.assign(t.designs.find((d) => d.id === D(1)), { source: 'planner-lite', source_ref: DRAFT });
  const photo = (company, file, extra = {}) => ({ company_id: company, draft_id: DRAFT, file, mime: 'image/jpeg', bytes: 1000, width: 4000, height: 3000, deleted_at: null, ...extra });
  t.planner_drafts = [
    {
      company_id: A, id: DRAFT, name: '김고객 주방', discarded_at: null,
      model: {
        id: DRAFT, walls: [{ id: 'w1' }],
        photos: [
          { id: 'p1', kind: 'site', file: 'photo-aaaa-0001.jpg', note: '현관 비밀번호 같은 글' },
          { id: 'p2', kind: 'ai', file: 'photo-aaaa-0002.jpg' },
          { id: 'p3', kind: 'site', file: 'photo-aaaa-0003.jpg' },
          { id: 'p4', kind: 'complete', file: 'photo-aaaa-0004.jpg' },
          { id: 'p5', kind: 'site', file: 'photo-aaaa-0005.jpg' },
        ],
      },
    },
    // 같은 id 의 다른 팩토리 플래너 설계 — 섞이지 않는다
    { company_id: B, id: DRAFT, name: '남의 설계', discarded_at: null, model: { photos: [{ id: 'x1', kind: 'site', file: 'photo-bbbb-0001.jpg' }] } },
  ];
  t.planner_draft_photos = [
    photo(A, 'photo-aaaa-0001.jpg'), photo(A, 'photo-aaaa-0002.jpg'), photo(A, 'photo-aaaa-0004.jpg'), photo(A, 'photo-aaaa-0005.jpg'),
    photo(A, 'photo-aaaa-0003.jpg', { deleted_at: iso('2026-11-17T10:00:00') }),
    photo(B, 'photo-bbbb-0001.jpg'),
  ];
  t.design_documents.push(docRow(1, 'demolition_order'), docRow(2, 'delivery_order'));
  const signs = [];
  const fake = createFake({
    tables: t, users: USERS, nowMs: AT,
    external: async (url, init) => {
      if (url.origin !== SB || url.pathname !== '/storage/v1/object/sign/planner-photos') return null;
      const body = JSON.parse(init.body);
      signs.push(body);
      return new Response(JSON.stringify(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/planner-photos/${p}?token=T` }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const imgs = (html) => [...html.matchAll(/<img src="([^"]+)" alt="현장 사진 \d+">/g)].map((m) => m[1]);
  const urlOf = (file) => `${SB}/storage/v1/object/sign/planner-photos/${A}/${DRAFT}/${file}?token=T`;

  const res = await call(fake, 't_owner', `/documents/${DOC(1)}/print`);
  assert.equal(res.status, 200);
  assert.deepEqual(imgs(res.text), [urlOf('photo-aaaa-0001.jpg'), urlOf('photo-aaaa-0005.jpg')], '현장사진만 · 지운 것 빼고 · 올린 차례');
  assert.deepEqual(signs, [{ expiresIn: 3600, paths: [`${A}/${DRAFT}/photo-aaaa-0001.jpg`, `${A}/${DRAFT}/photo-aaaa-0005.jpg`] }]);
  assert.match(strip(res.text), /현장 사진 2장 — 다음 장/);
  assert.doesNotMatch(res.text, /현관 비밀번호 같은 글|photo-bbbb/, '사진 글 · 다른 팩토리 사진은 없다');
  // 플래너 설계는 사진 목록 칸만 읽는다
  assert.ok(fake.calls.rest.some((c) => c.path === 'planner_drafts' && /select=id,photos:model->photos/.test(c.query)));
  // 직원도 본다 (설계를 볼 수 있는 사람) · 다른 팩토리는 문서부터 못 연다
  assert.equal(imgs((await call(fake, 't_staff', `/documents/${DOC(1)}/print`)).text).length, 2);
  const before = signs.length;
  assert.ok([403, 404].includes((await call(fake, 't_other', `/documents/${DOC(1)}/print`)).status));
  // 납품 지시서 — 사진을 읽지 않는다
  const dv = await call(fake, 't_owner', `/documents/${DOC(2)}/print`);
  assert.equal(dv.status, 200);
  assert.deepEqual(imgs(dv.text), []);
  assert.doesNotMatch(strip(dv.text), /현장 사진/);
  assert.equal(signs.length, before, '다른 팩토리 · 납품 지시서는 서명 주소를 만들지 않는다');

  // 플래너 설계를 버렸다 → 사진 없이 「없음」
  fake.db.planner_drafts.find((d) => d.company_id === A).discarded_at = iso('2026-11-17T11:00:00');
  const gone = await call(fake, 't_owner', `/documents/${DOC(1)}/print`);
  assert.deepEqual(imgs(gone.text), []);
  assert.match(strip(gone.text), /현장 사진 없음/);
  assert.equal(signs.length, before);
});

// ── 처음 붙이는 프로젝트 ──────────────────────────────────────────

test('프로젝트 잇기 — 프로젝트 없이 수주까지 간 설계도 처음 한 번은 붙는다 (수주도 같은 프로젝트로), 그 뒤로는 못 바꾼다', async () => {
  const fake = world();
  const link = (body, designId = D(3)) => call(fake, 't_owner', `/designs/${designId}/project`, { method: 'PUT', body });
  const first = await link({ project_id: P(2) });
  assert.equal(first.status, 200);
  assert.equal(fake.db.designs.find((d) => d.id === D(3)).project_id, P(2));
  assert.equal(fake.db.orders.find((o) => o.id === O(3)).project_id, P(2), '프로젝트가 비어 있던 수주도 잇는다');
  assert.equal(fake.db.orders.find((o) => o.id === O(1)).project_id, P(1), '다른 설계의 수주는 그대로');
  // 그 프로젝트의 작업 배정이 이제 이 설계 · 수주를 찾는다
  await call(fake, 't_owner', `/company/projects/${P(2)}/work/demolition`, { method: 'PATCH', body: { at: iso('2026-11-20T09:00:00') } });
  const job = fake.db.work_jobs.find((j) => j.project_id === P(2));
  assert.deepEqual([job.design_id, job.order_id], [D(3), O(3)]);
  // 이미 붙은 뒤에는 바꾸기 · 풀기 409 has_order
  const move = await link({ project_id: P(1) });
  assert.deepEqual([move.status, move.json.code], [409, 'has_order']);
  const off = await link({ project_id: null });
  assert.deepEqual([off.status, off.json.code], [409, 'has_order']);
  assert.equal(fake.db.designs.find((d) => d.id === D(3)).project_id, P(2));
  // 수주가 있고 프로젝트도 있던 설계는 예전 그대로 못 바꾼다
  const moved = await link({ project_id: P(2) }, D(1));
  assert.deepEqual([moved.status, moved.json.code], [409, 'has_order']);
  // 남의 프로젝트에는 못 붙인다
  fake.db.designs.find((d) => d.id === D(3)).project_id = null;
  assert.equal((await link({ project_id: P(9) })).status, 404);
});

// ── 재단 꾸러미 원장 색 ────────────────────────────────────────────

test('재단 꾸러미 — 원장에 색이 있으면 원장 머리에 색을 적는다 (없으면 예전 그대로)', () => {
  const doc = (color) => docRow(2, 'work_order', { render_payload: { work_order_version: 2, check_list: frozenCheckList('v3'), cut_plan: cutPlan(color) } });
  const head = (html) => strip(html.slice(html.indexOf('class="cut-head"'), html.indexOf('class="cut-sheet"')));
  const colored = head(renderWorkOrder(doc('화이트 <b>'), SNAPSHOT, { toolbar: false, pack: 'cut' }));
  assert.match(colored, /시트 #1 PB 15T · 본체 · 화이트 &lt;b&gt; · 원판 1,220 × 2,440/);
  const plain = head(renderWorkOrder(doc(null), SNAPSHOT, { toolbar: false, pack: 'cut' }));
  assert.match(plain, /시트 #1 PB 15T · 본체 · 원판 1,220 × 2,440/);
});
