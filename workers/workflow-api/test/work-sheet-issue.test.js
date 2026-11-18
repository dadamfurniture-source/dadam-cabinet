/**
 * 지시서를 지금 판으로 맞추기 · 설계 바뀜 · 줄의 작업자 상태 · 발주 줄
 *   — src/work/sheet-issue.js (POST /designs/:id/work-sheets/issue) · src/work/job-sheet.js (GET /designs/:id/work-sheets[?snapshot_id=]) ·
 *     src/work/project-work.js (GET /company/projects/:id/work 의 설계마다 지시서 · 발주 줄)
 *
 *   - 한 번에 문서 한 종류: 지금 문서가 그 동결본의 것이면 그대로(kept), 없거나 · 다른 동결본이거나 · 현장이 바뀌었으면 새 판(issued)
 *   - 고객 승인 전 작업지시서의 사유는 「수주 전 작업」, 앞 판의 사무실 특별 지시 · 특기사항은 잇는다
 *   - 앞 판이 있었으면 그 작업을 맡은 작업자(확정 · 작업 중)에게 알린다
 *   - 한 요청의 바깥 호출은 50번을 넘지 않는다
 * 가짜 Supabase 는 test/helpers/push-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { frozenCheckList } from '../src/work/check-items.js';
import { ORDER_SHEETS, PACK_LABELS, jobSummaryOf, siteChanged } from '../src/work/job-sheet.js';
import { AUTO_EARLY_REASON, SHEET_DOC_TYPES, carriedInstructions } from '../src/work/sheet-issue.js';
import { officeNotesOfDoc } from '../src/work/special-notes.js';
import { EARLY_WORK_ORDER_PREFIX } from '../src/documents.js';
import { buildMessage } from '../src/push/messages.js';
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
const D = (i) => id('0d', i);
const S = (i) => id('05', i);
const P = (i) => id('0e', i);
const DOC = (i) => id('0f', i);
const J = (i) => id('07', i);
const AS = (i) => id('08', i);
const SNAP = (i) => id('09', i);
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-19T12:00:00');

const HQ = C(100);
const A = C(1);
const B = C(2);
const M = C(3);
const OWNER_A = U(11);
const STAFF_A = U(13);
const OWNER_B = U(21);
const OWNER_M = U(31);

const snapshot = (n, designId, rev, at, over = {}) => ({
  id: SNAP(n), design_id: designId, rev, content_hash: `hash-${n}`, created_at: iso(at), design_title: '김고객 주방',
  design_payload: { items: [{ labelName: '싱크대', categoryId: 'sink', w: 2400, h: 2300, d: 600, modules: [{ pos: 'lower', name: '도어장', w: 900, h: 708, d: 550, doorCount: 2 }] }] },
  bom_payload: { materials: [{ partId: 'a|1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 }], hardware: [] },
  cut_plan_payload: null, quote_payload: null,
  ...over,
});
const SITE = { address: '시험시 시험구 시험로 1', floor: '3', contact_name: '김고객', contact_phone: '010-9999-9999' };
const docRow = (n, docType, over = {}) => ({
  id: DOC(n), design_id: D(1), snapshot_id: SNAP(1), doc_type: docType, rev: 1, doc_no: `DD-20261119-AAAA-${n}-r1`, status: 'issued', superseded_by: null,
  title: '김고객 주방', customer_name: '김고객', created_at: iso('2026-11-19T09:00:00'),
  render_payload: { check_list: frozenCheckList('v3'), site_info: SITE, schedules: [{ type: 'delivery', scheduled_at: iso('2026-11-21T14:00:00'), status: 'scheduled' }], ...(docType === 'work_order' ? { work_order_version: 2, instructions: '' } : {}) },
  ...over,
});

function tables() {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
      { id: M, kind: 'partner', name: '마바 가구', plan: 'manager', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER_A, company_id: A, role: 'owner', status: 'active' },
      { user_id: STAFF_A, company_id: A, role: 'staff', status: 'active' },
      { user_id: OWNER_B, company_id: B, role: 'owner', status: 'active' },
      { user_id: OWNER_M, company_id: M, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    workers: [
      { id: W(1), user_id: U(101), display_name: '시험기사1', phone: '010-0000-0001', kinds: ['cutting', 'demolition'], region_label: '시험시', status: 'approved' },
      { id: W(2), user_id: U(102), display_name: '시험기사2', phone: '010-0000-0002', kinds: ['cutting'], region_label: '시험시', status: 'approved' },
    ],
    worker_companies: [],
    customers: [],
    projects: [
      { id: P(1), company_id: A, customer_id: null, title: '김고객 주방', status: 'active' },
      { id: P(7), company_id: M, customer_id: null, title: '등급 낮은 팩토리', status: 'active' },
    ],
    designs: [
      { id: D(1), company_id: A, user_id: OWNER_A, name: '김고객 주방 설계', project_id: P(1), created_at: iso('2026-11-01T09:00:00') },
      { id: D(2), company_id: A, user_id: OWNER_A, name: '김고객 붙박이장 설계', project_id: P(1), created_at: iso('2026-11-02T09:00:00') },
      { id: D(3), company_id: A, user_id: OWNER_A, name: '프로젝트 없는 설계', project_id: null, created_at: iso('2026-11-03T09:00:00') },
      { id: D(7), company_id: M, user_id: OWNER_M, name: '등급 낮은 팩토리 설계', project_id: P(7), created_at: iso('2026-11-03T09:00:00') },
    ],
    design_site_info: [{ design_id: D(1), ...SITE }],
    design_schedules: [
      { id: S(2), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-21T14:00:00'), duration_min: 60, assignee_name: null },
    ],
    orders: [],
    as_requests: [],
    worker_invites: [],
    work_jobs: [],
    work_assignments: [],
    work_applications: [],
    work_updates: [],
    work_job_events: [],
    worker_events: [],
    design_documents: [],
    design_snapshots: [
      snapshot(1, D(1), 1, '2026-11-18T09:00:00'),
      snapshot(2, D(2), 1, '2026-11-18T09:00:00'),
      snapshot(3, D(3), 1, '2026-11-18T09:00:00'),
      snapshot(7, D(7), 1, '2026-11-18T09:00:00'),
    ],
    design_renders: [],
    design_events: [],
    order_events: [],
    work_reports: [],
    materials: [],
    work_checks: [],
  };
}

const USERS = { t_owner: { id: OWNER_A, email: 'owner@a.test' }, t_staff: { id: STAFF_A }, t_other: { id: OWNER_B }, t_manager: { id: OWNER_M } };
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

async function call(fake, token, path, init = {}) {
  const realNow = Date.now;
  Date.now = () => AT;
  const pending = [];
  const before = fake.calls.rest.length;
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
      const inRequest = fake.calls.rest.length - before;
      await Promise.all(pending);
      const isJson = (res.headers.get('Content-Type') || '').includes('json');
      return { status: res.status, json: isJson && text ? JSON.parse(text) : null, text, calls: inRequest, callsWithLater: fake.calls.rest.length - before };
    });
  } finally {
    Date.now = realNow;
  }
}
const sheetsOf = (fake, token, designId, snapshotId) => call(fake, token, `/designs/${designId}/work-sheets${snapshotId ? `?snapshot_id=${snapshotId}` : ''}`);
const issue = (fake, token, designId, body) => call(fake, token, `/designs/${designId}/work-sheets/issue`, { method: 'POST', body });
const sheet = (r, kind) => r.json.data.sheets.find((x) => x.kind === kind);
const liveDocs = (fake, docType, designId = D(1)) => fake.db.design_documents.filter((d) => d.design_id === designId && d.doc_type === docType && !d.superseded_by);

// ── 순수 ──────────────────────────────────────────────────────────

test('순수 — 현장이 바뀌었나: 인쇄하는 현장 칸 · 일정의 종류와 시각만 견준다', () => {
  const doc = { render_payload: { site_info: SITE, schedules: [{ type: 'delivery', scheduled_at: 'T1', assignee_name: '김기사', status: 'scheduled' }] } };
  const same = { info: { ...SITE, sido: '시험시', updated_at: 'x' }, schedules: [{ type: 'delivery', scheduled_at: 'T1', assignee_name: '박기사', status: 'in_progress' }] };
  assert.equal(siteChanged(doc, same), false, '담당 글 · 상태 · 인쇄하지 않는 칸은 보지 않는다');
  assert.equal(siteChanged(doc, { ...same, info: { ...SITE, address: '시험시 다른구 1' } }), true);
  assert.equal(siteChanged(doc, { ...same, schedules: [{ type: 'delivery', scheduled_at: 'T2' }] }), true);
  assert.equal(siteChanged(doc, { ...same, schedules: [...same.schedules, { type: 'installation', scheduled_at: 'T3', status: 'cancelled' }] }), false, '취소한 일정은 뺀다');
  assert.equal(siteChanged({ render_payload: {} }, { info: null, schedules: [] }), false);
  assert.equal(siteChanged({ render_payload: {} }, { info: SITE, schedules: [] }), true, '주소 없이 낸 문서 — 주소를 적으면 바뀐 것');
});

test('순수 — 줄의 작업자 상태 · 꾸러미 이름 · 이어 쓰는 특기사항과 사무실 글', () => {
  const names = new Map([[W(1), '시험기사1'], [W(2), '시험기사2']]);
  const job = { id: J(1), status: 'open' };
  const a = (workerId, status) => ({ job_id: J(1), worker_id: workerId, status });
  assert.equal(jobSummaryOf([], [], names).state, 'none');
  assert.deepEqual(jobSummaryOf([job], [], names), { state: 'unassigned', jobs: 1, offered: 0, linked: 0, done: 0, names: [] });
  assert.deepEqual(jobSummaryOf([job], [a(W(1), 'offered'), a(W(2), 'declined')], names), { state: 'offered', jobs: 1, offered: 1, linked: 0, done: 0, names: ['시험기사1'] });
  assert.deepEqual(jobSummaryOf([job], [a(W(1), 'offered'), a(W(2), 'started')], names), { state: 'linked', jobs: 1, offered: 1, linked: 1, done: 0, names: ['시험기사2', '시험기사1'] });
  assert.equal(jobSummaryOf([job], [a(W(1), 'accepted')], names).state, 'done');
  assert.equal(jobSummaryOf([{ id: J(1), status: 'done' }], [a(W(1), 'submitted')], names).state, 'done');
  // 다른 작업의 배정은 세지 않는다
  assert.equal(jobSummaryOf([job], [{ job_id: J(9), worker_id: W(1), status: 'confirmed' }], names).state, 'unassigned');

  assert.deepEqual(ORDER_SHEETS.map((o) => [o.kind, o.label, o.pack]), [['door_order', '도어재 발주', 'door'], ['top_order', '상판 발주', 'top']]);
  assert.deepEqual(Object.keys(PACK_LABELS), ['cut', 'labels', 'assembly', 'door', 'top']);
  assert.deepEqual(SHEET_DOC_TYPES, ['work_order', 'installation_order', 'demolition_order', 'delivery_order']);

  const early = { render_payload: { instructions: `${EARLY_WORK_ORDER_PREFIX}${AUTO_EARLY_REASON}\n몰딩은 현장에서 재단` } };
  assert.equal(carriedInstructions(early), '몰딩은 현장에서 재단');
  assert.equal(carriedInstructions({ render_payload: { instructions: `${EARLY_WORK_ORDER_PREFIX}급한 현장` } }), '');
  assert.equal(carriedInstructions({ render_payload: { instructions: '그냥 특기사항' } }), '그냥 특기사항');
  assert.equal(carriedInstructions({}), '');
  const notes = { cut: [{ text: '자투리 보관', src: 'auto' }, { text: '화이트 원장 먼저', src: 'office' }], door: [{ text: '색 확인', src: 'auto' }] };
  assert.deepEqual(officeNotesOfDoc({ render_payload: { special_notes: notes } }), { cut: ['화이트 원장 먼저'] });
  assert.deepEqual(officeNotesOfDoc({}), {});

  // 알림 글 — 고객 이름 · 설계 이름 없이 종류와 날짜만
  const msg = buildMessage('work_schedule', { jobKind: 'cutting', startsAt: null, jobId: J(1), sheet: true });
  assert.equal(msg.title, '지시서 바뀜');
  assert.match(msg.body, /재단 작업의 지시서가 새 판으로 바뀌었습니다/);
});

// ── 읽기: 설계 바뀜 · 작업자 상태 · 발주 줄 ───────────────────────

test('설계의 작업지시서 — 설계 바뀜: 플래너가 보낸 동결본이 기준, 없으면 가장 새 판이 문서보다 뒤에 만들어졌을 때만', async () => {
  const fake = world();
  fake.db.design_documents.push(docRow(1, 'work_order'), docRow(2, 'demolition_order'));
  // 문서를 낸 뒤에 새 판(rev 2)이 생겼다
  fake.db.design_snapshots.push(snapshot(11, D(1), 2, '2026-11-19T10:00:00'));
  const unpinned = await sheetsOf(fake, 't_owner', D(1));
  assert.equal(unpinned.status, 200);
  assert.deepEqual(['cutting', 'edge', 'assembly', 'demolition'].map((k) => sheet(unpinned, k).stale), [true, true, true, true]);
  assert.deepEqual(unpinned.json.data.snapshot, { id: SNAP(11), rev: 2, created_at: iso('2026-11-19T10:00:00') });
  assert.equal(sheet(unpinned, 'delivery').stale, false, '안 낸 문서는 낡지 않았다');
  // 플래너가 옛 판(rev 1)으로 되돌려 보냈다 — 그 판으로 낸 문서는 낡지 않았다
  const back = await sheetsOf(fake, 't_owner', D(1), SNAP(1));
  assert.ok(back.json.data.sheets.every((x) => x.stale === false));
  assert.equal(back.json.data.snapshot.rev, 1);
  // 플래너가 새 판을 보냈다
  assert.equal(sheet(await sheetsOf(fake, 't_owner', D(1), SNAP(11)), 'cutting').stale, true);
  // 가장 새 판이 문서보다 먼저 만들어졌으면 (옛 판으로 되돌린 뒤 낸 문서) 낡았다고 하지 않는다
  fake.db.design_snapshots.find((s) => s.id === SNAP(11)).created_at = iso('2026-11-19T08:00:00');
  assert.equal(sheet(await sheetsOf(fake, 't_owner', D(1)), 'cutting').stale, false);
  // 남의 설계의 동결본 번호 · 모양이 틀린 번호
  assert.equal(sheet(await sheetsOf(fake, 't_owner', D(1), SNAP(2)), 'cutting').stale, false, '그 설계 것이 아니면 가장 새 판으로 본다');
  assert.equal((await sheetsOf(fake, 't_owner', D(1), 'nope')).status, 422);
});

test('설계의 작업지시서 — 현장 바뀜 · 현장 미입력 · 등급 · 승인 · 발주 줄 · 덧붙인 칸, 옛 칸은 그대로', async () => {
  const fake = world();
  fake.db.design_documents.push(docRow(1, 'work_order'), docRow(2, 'demolition_order'));
  const r = await sheetsOf(fake, 't_owner', D(1), SNAP(1));
  const d = r.json.data;
  assert.deepEqual([d.design_id, d.has_order, d.approved, d.project.id], [D(1), false, false, P(1)]);
  assert.deepEqual(d.issue, { allowed: true, block: null });
  assert.deepEqual(d.site, { missing: false });
  assert.deepEqual(d.sheets.map((x) => [x.kind, x.state, x.stale, x.site_stale]), [
    ['demolition', 'issued', false, false],
    ['cutting', 'issued', false, false],
    ['edge', 'issued', false, false],
    ['assembly', 'issued', false, false],
    ['delivery', 'none', false, false],
    ['install', 'none', false, false],
  ]);
  assert.deepEqual(sheet(r, 'cutting').pack_labels, { cut: '재단 지시서', labels: '부재 라벨' });
  assert.deepEqual(sheet(r, 'demolition').pack_labels, {});
  assert.deepEqual(d.order_sheets.map((x) => [x.kind, x.label, x.packs, x.state, x.stale, x.applies, x.document.id]), [
    ['door_order', '도어재 발주', ['door'], 'issued', false, false, DOC(1)],
    ['top_order', '상판 발주', ['top'], 'issued', false, false, DOC(1)],
  ]);
  assert.deepEqual(d.order_sheets[0].pack_labels, { door: '도어재 발주서' });
  assert.ok(r.calls < 50, `바깥 호출 ${r.calls}번`);
  // 프로젝트 이름은 예전부터 싣는다 — 문서 내용 · 설계 이름 · 연락처 · 주소는 없다
  assert.doesNotMatch(JSON.stringify(r.json), /render_payload|site_info|김고객 주방 설계|010-9999|시험로/);

  // 현장 주소가 바뀌었다 — 현장 문서만
  fake.db.design_site_info[0].address = '시험시 다른구 2';
  const moved = await sheetsOf(fake, 't_owner', D(1), SNAP(1));
  assert.equal(sheet(moved, 'demolition').site_stale, true);
  assert.equal(sheet(moved, 'cutting').site_stale, false);
  // 도어재가 있는 설계 · 승인된 확인서
  fake.db.design_snapshots[0].bom_payload.materials.push({ partId: 'd|1', part: '도어', material: 'MDF', thickness: 18, w: 446, h: 716, qty: 2 });
  fake.db.design_documents.push(docRow(9, 'customer_confirmation', { decision: 'approved' }));
  const more = await sheetsOf(fake, 't_owner', D(1), SNAP(1));
  assert.deepEqual(more.json.data.order_sheets.map((x) => x.applies), [true, false]);
  assert.equal(more.json.data.approved, true);

  // 프로젝트 없는 설계 — 현장 미입력, 작업지시서가 없어 발주 줄도 「없음」
  const lone = (await sheetsOf(fake, 't_owner', D(3))).json.data;
  assert.deepEqual([lone.project, lone.site, lone.order_sheets.map((x) => [x.state, x.applies, x.document])], [null, { missing: true }, [['none', null, null], ['none', null, null]]]);
  // 등급이 모자란 팩토리 — 읽기는 되고 발행은 막힌다고 알린다
  const low = (await sheetsOf(fake, 't_manager', D(7))).json.data;
  assert.deepEqual(low.issue, { allowed: false, block: 'plan_required', min_plan: 'expert' });
  // 다른 팩토리는 못 본다
  assert.ok([403, 404].includes((await sheetsOf(fake, 't_other', D(1))).status));
});

test('설계의 작업지시서 — 줄마다 작업자 상태: 프로젝트 없음 · 일정 없음 · 작업 없음 · 작업자 없음 · 수락 대기 · 연결됨', async () => {
  const fake = world();
  const states = (r) => Object.fromEntries(r.json.data.sheets.map((x) => [x.kind, x.job.state]));
  assert.deepEqual(states(await sheetsOf(fake, 't_owner', D(1))), { demolition: 'none', cutting: 'none', edge: 'none', assembly: 'none', delivery: 'none', install: 'no_schedule' });
  assert.deepEqual(states(await sheetsOf(fake, 't_owner', D(3))), { demolition: 'no_project', cutting: 'no_project', edge: 'no_project', assembly: 'no_project', delivery: 'no_schedule', install: 'no_schedule' });

  fake.db.work_jobs.push(
    { id: J(1), kind: 'cutting', status: 'open', company_id: A, project_id: P(1), schedule_id: null, design_id: D(1) },
    { id: J(2), kind: 'demolition', status: 'open', company_id: A, project_id: P(1), schedule_id: null, design_id: D(1) },
    { id: J(3), kind: 'delivery', status: 'open', company_id: A, project_id: null, schedule_id: S(2), design_id: D(1) },
    { id: J(4), kind: 'cutting', status: 'cancelled', company_id: A, project_id: P(1), schedule_id: null, design_id: D(1) },
    // 다른 설계의 일정에서 생긴 작업 — 이 설계의 납품 줄이 아니다
    { id: J(5), kind: 'install', status: 'open', company_id: A, project_id: null, schedule_id: S(9), design_id: D(2) },
  );
  fake.db.work_assignments.push(
    { id: AS(1), job_id: J(1), worker_id: W(1), status: 'offered' },
    { id: AS(2), job_id: J(3), worker_id: W(2), status: 'confirmed' },
  );
  const r = await sheetsOf(fake, 't_owner', D(1));
  assert.deepEqual(states(r), { demolition: 'unassigned', cutting: 'offered', edge: 'none', assembly: 'none', delivery: 'linked', install: 'no_schedule' });
  assert.deepEqual(sheet(r, 'cutting').job, { state: 'offered', jobs: 1, offered: 1, linked: 0, done: 0, names: ['시험기사1'] });
  assert.deepEqual(sheet(r, 'delivery').job.names, ['시험기사2']);
  // 프로젝트의 작업은 그 프로젝트의 설계마다 같다 (한 작업에 모든 설계)
  assert.equal(sheet(await sheetsOf(fake, 't_owner', D(2)), 'cutting').job.state, 'offered');
  assert.ok(r.calls < 50, `바깥 호출 ${r.calls}번`);
  // 작업자 전화 · 계정은 싣지 않는다
  assert.doesNotMatch(JSON.stringify(r.json), /010-0000|a0000000-0000-4000-8000-000000000101/);
});

// ── 쓰기: 지시서를 지금 판으로 ────────────────────────────────────

test('지시서 내기 — 없으면 낸다(승인 전 작업지시서의 사유 「수주 전 작업」), 같은 판이면 그대로, 새 판이면 다시 낸다', async () => {
  const fake = world();
  const first = await issue(fake, 't_owner', D(1), { doc_type: 'work_order', snapshot_id: SNAP(1) });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual([first.json.data.doc_type, first.json.data.action, first.json.data.reason, first.json.data.early, first.json.data.carried_notes], ['work_order', 'issued', 'none', true, 0]);
  assert.ok(first.calls < 50, `바깥 호출 ${first.calls}번`);
  const [doc1] = liveDocs(fake, 'work_order');
  assert.equal(doc1.snapshot_id, SNAP(1));
  assert.equal(doc1.render_payload.instructions, `${EARLY_WORK_ORDER_PREFIX}${AUTO_EARLY_REASON}`);
  assert.equal(first.json.data.document.id, doc1.id);
  assert.equal(fake.db.notification_outbox.length, 0, '처음 낸 문서는 알리지 않는다');
  assert.doesNotMatch(JSON.stringify(first.json), /render_payload|김고객/);

  // 같은 판 — 새로 내지 않는다
  const again = await issue(fake, 't_owner', D(1), { doc_type: 'work_order', snapshot_id: SNAP(1) });
  assert.deepEqual([again.json.data.action, again.json.data.reason, again.json.data.document.id], ['kept', null, doc1.id]);
  assert.equal(fake.db.design_documents.filter((d) => d.doc_type === 'work_order').length, 1);

  // 설계가 바뀌어 새 판 — 사무실이 적은 특별 지시 · 특기사항을 잇고, 그 작업을 맡은 작업자에게 알린다
  doc1.render_payload.special_notes = { cut: [{ text: '화이트 원장 먼저', src: 'office' }] };
  doc1.render_payload.instructions = `${EARLY_WORK_ORDER_PREFIX}${AUTO_EARLY_REASON}\n몰딩은 현장에서 재단`;
  fake.db.design_snapshots.push(snapshot(11, D(1), 2, '2026-11-19T10:00:00'));
  fake.db.work_jobs.push({ id: J(1), kind: 'cutting', status: 'open', company_id: A, project_id: P(1), schedule_id: null, design_id: D(1), starts_at: null });
  fake.db.work_assignments.push(
    { id: AS(1), job_id: J(1), worker_id: W(1), status: 'confirmed' },
    { id: AS(2), job_id: J(1), worker_id: W(2), status: 'offered' },
  );
  const next = await issue(fake, 't_owner', D(1), { doc_type: 'work_order', snapshot_id: SNAP(11) });
  assert.deepEqual([next.json.data.action, next.json.data.reason, next.json.data.early, next.json.data.carried_notes, next.json.data.superseded_count], ['issued', 'stale', true, 1, 1]);
  assert.ok(next.callsWithLater < 50, `바깥 호출 ${next.callsWithLater}번 (알림까지)`);
  const [doc2] = liveDocs(fake, 'work_order');
  assert.notEqual(doc2.id, doc1.id);
  assert.equal(doc2.snapshot_id, SNAP(11));
  assert.equal(doc2.render_payload.instructions, `${EARLY_WORK_ORDER_PREFIX}${AUTO_EARLY_REASON}\n몰딩은 현장에서 재단`);
  assert.deepEqual(doc2.render_payload.special_notes.cut.filter((n) => n.src === 'office').map((n) => n.text), ['화이트 원장 먼저']);
  const sent = fake.db.notification_outbox;
  assert.deepEqual(sent.map((n) => [n.user_id, n.kind, n.title]), [[U(101), 'work_schedule', '지시서 바뀜']], '확정된 작업자만 — 답하지 않은 초대는 빼고');
  assert.doesNotMatch(JSON.stringify(sent), /김고객/);

  // 고객이 확인서를 승인한 뒤에는 사유가 없다
  fake.db.design_documents.push(docRow(9, 'customer_confirmation', { decision: 'approved' }));
  fake.db.design_snapshots.push(snapshot(12, D(1), 3, '2026-11-19T11:00:00'));
  const approved = await issue(fake, 't_owner', D(1), { doc_type: 'work_order' });
  assert.deepEqual([approved.json.data.action, approved.json.data.early], ['issued', false]);
  assert.equal(liveDocs(fake, 'work_order')[0].snapshot_id, SNAP(12), 'snapshot_id 가 없으면 가장 새 동결본');
  assert.equal(liveDocs(fake, 'work_order')[0].render_payload.instructions, '몰딩은 현장에서 재단');
});

test('지시서 내기 — 현장 문서: 현장 정보가 바뀌면 다시 낸다 (철거 · 납품 · 시공 지시서)', async () => {
  const fake = world();
  for (const docType of ['demolition_order', 'delivery_order', 'installation_order']) {
    const r = await issue(fake, 't_owner', D(1), { doc_type: docType, snapshot_id: SNAP(1) });
    assert.deepEqual([r.status, r.json.data.action, r.json.data.reason, r.json.data.early], [200, 'issued', 'none', false], docType);
  }
  assert.equal(liveDocs(fake, 'demolition_order')[0].render_payload.site_info.address, SITE.address);
  assert.equal((await issue(fake, 't_owner', D(1), { doc_type: 'demolition_order', snapshot_id: SNAP(1) })).json.data.action, 'kept');
  fake.db.design_site_info[0].address = '시험시 다른구 2';
  const moved = await issue(fake, 't_owner', D(1), { doc_type: 'demolition_order', snapshot_id: SNAP(1) });
  assert.deepEqual([moved.json.data.action, moved.json.data.reason], ['issued', 'site_stale']);
  assert.equal(liveDocs(fake, 'demolition_order')[0].render_payload.site_info.address, '시험시 다른구 2');
  // 일정이 새로 잡혔다
  fake.db.design_schedules.push({ id: S(3), design_id: D(1), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-22T10:00:00'), duration_min: null, assignee_name: null });
  assert.equal((await issue(fake, 't_owner', D(1), { doc_type: 'installation_order', snapshot_id: SNAP(1) })).json.data.reason, 'site_stale');
});

test('지시서 내기 — 못 내는 경우: 프로젝트 없음 · 모르는 종류 · 남의 설계 · 남의 동결본 · 등급', async () => {
  const fake = world();
  const none = await issue(fake, 't_owner', D(3), { doc_type: 'work_order' });
  assert.deepEqual([none.status, none.json.code], [409, 'no_project']);
  assert.equal((await issue(fake, 't_owner', D(1), { doc_type: 'customer_confirmation' })).status, 422);
  assert.equal((await issue(fake, 't_owner', D(1), {})).status, 422);
  assert.ok([403, 404].includes((await issue(fake, 't_other', D(1), { doc_type: 'work_order' })).status));
  assert.equal((await issue(fake, 't_owner', D(1), { doc_type: 'work_order', snapshot_id: SNAP(2) })).status, 404);
  assert.equal((await issue(fake, 't_owner', D(1), { doc_type: 'work_order', snapshot_id: 'nope' })).status, 422);
  const low = await issue(fake, 't_manager', D(7), { doc_type: 'work_order' });
  assert.deepEqual([low.status, low.json.code], [403, 'plan_required']);
  assert.equal(fake.db.design_documents.length, 0, '아무것도 내지 않았다');
  // 직원도 낸다 (문서 발행과 같다)
  assert.equal((await issue(fake, 't_staff', D(1), { doc_type: 'delivery_order' })).status, 200);
});

// ── 작업 배정: 설계마다 지시서 · 발주 줄 ──────────────────────────

test('작업 배정 — 줄마다 그 프로젝트의 설계 모두(먼저 만든 것부터), 설계마다 발주 줄, 현장 미입력', async () => {
  const fake = world();
  fake.db.design_documents.push(docRow(1, 'work_order'), docRow(2, 'work_order', { design_id: D(2), snapshot_id: SNAP(2) }), docRow(3, 'demolition_order'));
  const r = await call(fake, 't_owner', `/company/projects/${P(1)}/work`);
  assert.equal(r.status, 200, r.text);
  const d = r.json.data;
  const row = (key) => d.rows.find((x) => x.key === key);
  // 프로젝트 줄 — 설계 둘
  assert.deepEqual(row('kind:cutting').sheets.map((s) => [s.state, s.document && s.document.id, s.stale]), [['issued', DOC(1), false], ['issued', DOC(2), false]]);
  assert.deepEqual(row('kind:demolition').sheets.map((s) => s.state), ['issued', 'none']);
  assert.equal(row('kind:cutting').sheet.document.id, DOC(1), 'sheet 는 첫 설계 (예전 화면이 읽는다)');
  assert.ok(row('kind:cutting').sheet.checks, '첫 설계는 필수 확인 수까지');
  assert.equal(row('kind:cutting').sheets[1].checks, null);
  assert.equal(row('kind:cutting').sheets.every((s) => typeof s.label === 'string' && s.label), true);
  // 일정 줄 — 그 일정의 설계 하나
  assert.equal(row(`schedule:${S(2)}`).sheets.length, 1);
  assert.deepEqual([d.design_count, d.designs.length, d.site], [2, 2, { missing: false }]);
  assert.deepEqual(d.designs.map((x) => x.order_sheets.map((o) => [o.kind, o.state, o.document && o.document.id])), [
    [['door_order', 'issued', DOC(1)], ['top_order', 'issued', DOC(1)]],
    [['door_order', 'issued', DOC(2)], ['top_order', 'issued', DOC(2)]],
  ]);
  assert.ok(r.calls < 50, `바깥 호출 ${r.calls}번`);
  d.rows.forEach((x) => assert.equal('design_id' in x, false));
  assert.doesNotMatch(JSON.stringify(d), /render_payload|site_info|김고객 주방 설계|010-9999|시험로/);
});
