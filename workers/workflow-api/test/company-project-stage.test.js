/**
 * 프로젝트 한 건의 단계 (src/company-project-stage.js)
 *   timelineOf — 단계 띠의 날짜 · 걸린 날 (GET /company/projects/:id 의 stages)
 *   GET /company/projects/:id/stages/:key — 누른 단계의 정보 · 일정 · 문서 · 사진
 * 2026-11-23 대표님 승인 계획 「프로젝트 관리 새 틀」.
 *
 * 고정하는 것
 *   1) 띠 — 끝난 단계는 걸린 날, 지금 단계는 오늘까지 머문 날, 아직인 단계는 비운다. 실측 칸은 표가 있을 때만
 *   2) 단계 자료는 이 프로젝트 것만. 금액은 대표 · 실장에게만. 사진은 서명 주소로만 (버킷 경로를 싣지 않는다)
 *   3) 고객 주소 · 연락처는 싣지 않는다. 다른 업체 것 · 없는 것은 404, 단계 이름이 틀리면 422. 읽기만 한다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { timelineOf } from '../src/company-project-stage.js';
import { STEPS } from '../src/pipeline.js';
import { createFake, callWorker, writesOf } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const at = (d, h = 0) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const NOW = Date.parse(at(23, 3));

// ── 단계 띠 (순수) ─────────────────────────────────────────────

test('띠 — 생산 중인 프로젝트: 끝난 단계는 걸린 날, 지금 단계는 머문 날, 아직인 단계는 비운다', () => {
  const line = timelineOf(
    {
      step: 'make',
      visit_ready: true,
      created_at: at(2),
      visit: { status: 'done', created_at: at(3), done_at: at(5) },
      design_at: at(6),
      quote_at: at(10),
      order: { ordered_at: at(14), delivered_at: null, completed_at: null },
      make_at: at(16),
    },
    NOW
  );
  assert.deepEqual(
    line.map((s) => [s.key, s.label, s.state, s.days]),
    [
      ['consult', '상담', 'done', 1],
      ['measure', '실측', 'done', 2],
      // 설계는 실측을 끝낸 때부터 (설계가 이어진 때가 아니다)
      ['design', '설계', 'done', 5],
      ['quote', '견적', 'done', 4],
      ['contract', '계약', 'done', 2],
      ['make', '생산', 'now', 7],
      ['install', '설치', 'todo', null],
      ['done', '끝', 'todo', null],
    ]
  );
  const by = Object.fromEntries(line.map((s) => [s.key, s]));
  assert.deepEqual([by.design.from, by.design.to], [at(5), at(10)]);
  assert.deepEqual([by.make.from, by.make.to], [at(16), null]);
  assert.deepEqual([by.install.from, by.install.to], [null, null]);
});

test('띠 — 실측 표가 없으면 일곱 칸. 건너뛴 단계는 때 없이 끝난 것으로, 나간 때는 그 뒤 처음 들어간 단계의 때', () => {
  const line = timelineOf(
    { step: 'contract', created_at: at(2), quote_at: at(10), order: { ordered_at: at(14) } },
    NOW
  );
  assert.deepEqual(line.map((s) => s.key), STEPS.filter((k) => k !== 'measure'));
  const by = Object.fromEntries(line.map((s) => [s.key, s]));
  // 상담 → (설계는 때를 모른다) → 견적
  assert.deepEqual([by.consult.state, by.consult.to, by.consult.days], ['done', at(10), 8]);
  assert.deepEqual([by.design.state, by.design.from, by.design.days], ['done', null, null]);
  assert.deepEqual([by.quote.days, by.contract.state, by.contract.days], [4, 'now', 9]);
});

test('띠 — 지금 단계에 들어간 때를 모르면 다음 할 일의 since 로. 끝난 프로젝트의 「끝」 칸에는 날수를 적지 않는다', () => {
  const draftOnly = timelineOf({ step: 'design', created_at: at(2), since: at(20) }, NOW);
  const design = draftOnly.find((s) => s.key === 'design');
  assert.deepEqual([design.state, design.from, design.days], ['now', at(20), 3]);
  const done = timelineOf(
    {
      step: 'done',
      created_at: at(1),
      quote_at: at(3),
      order: { ordered_at: at(4), delivered_at: at(10), completed_at: at(12) },
      make_at: at(5),
    },
    NOW
  );
  const by = Object.fromEntries(done.map((s) => [s.key, s]));
  assert.deepEqual([by.make.days, by.install.days], [5, 2]);
  assert.deepEqual([by.done.state, by.done.from, by.done.days], ['now', at(12), null]);
  // 단계를 모르면(다음 할 일을 못 모았을 때) 모두 아직
  assert.ok(timelineOf({ created_at: at(1) }, NOW).every((s) => s.state === 'todo' && s.days === null));
  assert.ok(timelineOf(null, NOW).every((s) => s.state === 'todo'));
});

// ── 단계 자료 (워커) ───────────────────────────────────────────

const A = cid(1); // 팩토리 (Agent)
const M = cid(4); // 영업 사원 업체 (Manager 등급)
const B = cid(2); // 다른 팩토리
const OWNER_A = uid(11);
const STAFF_A = uid(13);
const OWNER_M = uid(52);
const OWNER_B = uid(21);
const NOBODY = uid(90);
const P1 = rid(11);
const P2 = rid(12); // 막 생긴 프로젝트 — 아무 자료도 없다
const PM = rid(14);
const PB = rid(15);
const D1 = rid(21);
const DB = rid(29);
const O1 = rid(41);
const OB = rid(49);
const ORIGIN = rid(60);
const GEN = rid(61);
const DRAFT = 'draft-p1-0001';
const DRAFT_OTHER = 'draft-other-01';

function tables() {
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: M, kind: 'partner', name: '사아 영업', plan: 'manager', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    profiles: [
      { id: OWNER_A, name: '가대표' },
      { id: STAFF_A, name: '나직원' },
    ],
    projects: [
      { id: P1, company_id: A, customer_id: null, title: '예시 주방', status: 'active', created_at: at(2) },
      { id: P2, company_id: A, customer_id: null, title: '막 생긴 것', status: 'active', created_at: at(20) },
      { id: PM, company_id: M, customer_id: null, title: '영업 신발장', status: 'active', created_at: at(10) },
      { id: PB, company_id: B, customer_id: null, title: '남의 프로젝트', status: 'active', created_at: at(2) },
    ],
    consultations: [
      { id: ORIGIN, company_id: null, project_id: null, generation_id: GEN, status: 'pending', created_at: at(1) },
      {
        id: rid(62),
        company_id: A,
        project_id: P1,
        origin_consultation_id: ORIGIN,
        status: 'accepted',
        created_at: at(2),
        name: '김고객',
        phone: '010-1111-2222',
        sido: '경기',
        gugun: '성남시',
        furniture_categories: ['sink', 'fridge'],
        door_finish: 'matte',
        demolition_needed: true,
        wanted_price_tier: 'mid',
        preferred_date: '2026-11-05',
        preferred_time: '오후',
        wanted_done_date: '2026-12-10',
        description: 'ㄱ자 주방, 냉장고장 포함',
      },
      { id: rid(63), company_id: A, project_id: P1, origin_consultation_id: null, status: 'returned', created_at: at(2), description: '돌려보낸 것' },
      { id: rid(64), company_id: B, project_id: PB, origin_consultation_id: null, status: 'accepted', created_at: at(2), description: '남의 상담' },
    ],
    project_visits: [
      { id: rid(70), company_id: A, project_id: P1, kind: 'measure', status: 'cancelled', scheduled_at: at(3, 5), assignee_id: null, assignee_name: null, note: null, done_at: null, created_at: at(2, 5) },
      { id: rid(71), company_id: A, project_id: P1, kind: 'measure', status: 'done', scheduled_at: at(5, 5), assignee_id: STAFF_A, assignee_name: null, note: '가스 배관 왼쪽', done_at: at(5, 7), created_at: at(3) },
    ],
    designs: [
      { id: D1, company_id: A, project_id: P1, name: '주방 ㄱ자', source: 'planner-lite', source_ref: DRAFT, created_at: at(6), updated_at: at(10) },
      { id: DB, company_id: B, project_id: PB, name: '남의 설계', source: null, source_ref: null, created_at: at(6), updated_at: at(6) },
    ],
    planner_drafts: [
      {
        company_id: A,
        id: DRAFT,
        name: '주방 ㄱ자',
        updated_at: at(10),
        discarded_at: null,
        summary: { walls: 2, modules: 14, projectId: P1 },
        model: {
          photos: [
            { id: 'site-0001.jpg', kind: 'site', addedAt: at(5, 6), note: '배관 자리' },
            { id: 'ai-0001.jpg', kind: 'ai', addedAt: at(7), note: '' },
            { id: 'done-0001.jpg', kind: 'complete', addedAt: at(21), note: '' },
            { id: 'gone-0001.jpg', kind: 'site', addedAt: at(5), note: '지운 사진' },
          ],
        },
      },
      { company_id: A, id: DRAFT_OTHER, name: '다른 프로젝트 초안', updated_at: at(9), discarded_at: null, summary: { walls: 1, modules: 3, projectId: P2 }, model: { photos: [{ id: 'site-9999.jpg', kind: 'site' }] } },
    ],
    planner_draft_photos: [
      { company_id: A, draft_id: DRAFT, file: 'site-0001.jpg', created_at: at(5, 6), deleted_at: null },
      { company_id: A, draft_id: DRAFT, file: 'ai-0001.jpg', created_at: at(7), deleted_at: null },
      { company_id: A, draft_id: DRAFT, file: 'done-0001.jpg', created_at: at(21), deleted_at: null },
      { company_id: A, draft_id: DRAFT, file: 'gone-0001.jpg', created_at: at(5), deleted_at: at(6) },
      { company_id: A, draft_id: DRAFT_OTHER, file: 'site-9999.jpg', created_at: at(9), deleted_at: null },
    ],
    design_renders: [
      { design_id: D1, item_unique_id: 1, kind: 'front', path: `${D1}/1/front-old.png`, created_at: at(8) },
      { design_id: D1, item_unique_id: 1, kind: 'front', path: `${D1}/1/front-new.png`, created_at: at(10) },
      { design_id: D1, item_unique_id: 1, kind: 'iso', path: `${D1}/1/iso.svg`, created_at: at(10) },
      { design_id: D1, item_unique_id: 1, kind: 'module', path: `${D1}/1/module.png`, created_at: at(10) },
      { design_id: DB, item_unique_id: 1, kind: 'front', path: `${DB}/1/front.png`, created_at: at(10) },
    ],
    design_documents: [
      { id: rid(31), design_id: D1, doc_type: 'customer_confirmation', doc_no: 'CC-1', rev: 1, status: 'superseded', superseded_by: rid(32), decision: 'rejected', decided_at: at(12), first_viewed_at: at(11), view_count: 2, expires_at: at(30), created_at: at(10), totals: { subtotal: 7000000, vat: 700000, total: 7700000 }, render_payload: { decision_reasons: ['price'], cost: 123 }, customer_name: '김고객' },
      { id: rid(32), design_id: D1, doc_type: 'customer_confirmation', doc_no: 'CC-1', rev: 2, status: 'approved', superseded_by: null, decision: 'approved', decided_at: at(14), first_viewed_at: at(13), view_count: 3, expires_at: at(30), created_at: at(13), totals: { subtotal: 7654545, vat: 765455, total: 8420000 }, render_payload: {}, customer_name: '김고객' },
      { id: rid(33), design_id: D1, doc_type: 'customer_confirmation', doc_no: 'CC-1', rev: 3, status: 'revoked', superseded_by: null, decision: null, created_at: at(15), totals: null, render_payload: {} },
      { id: rid(34), design_id: D1, doc_type: 'work_order', doc_no: 'WO-1', rev: 1, status: 'issued', created_at: at(16) },
      { id: rid(35), design_id: D1, doc_type: 'installation_order', doc_no: 'IO-1', rev: 1, status: 'issued', created_at: at(17) },
      { id: rid(36), design_id: DB, doc_type: 'work_order', doc_no: 'WO-B', rev: 1, status: 'issued', created_at: at(16) },
    ],
    orders: [
      { id: O1, company_id: A, project_id: P1, design_id: D1, order_no: 'D-2611-014', status: 'completed', contract_amount: 8420000, received_amount: 2000000, ordered_at: at(14), delivered_at: at(20), completed_at: at(21), created_at: at(14) },
      { id: OB, company_id: B, project_id: PB, design_id: DB, order_no: 'B-1', status: 'confirmed', contract_amount: 1, ordered_at: at(14), created_at: at(14) },
    ],
    order_payments: [
      { order_id: O1, stage: 'deposit', amount: 2000000, due_on: '2026-11-16', paid_on: '2026-11-16' },
      { order_id: O1, stage: 'balance', amount: 6420000, due_on: '2026-11-25', paid_on: null },
      { order_id: OB, stage: 'deposit', amount: 1, due_on: '2026-11-16', paid_on: null },
    ],
    order_events: [
      { id: rid(80), company_id: A, order_id: O1, kind: 'status', from_status: 'confirmed', to_status: 'in_production', state: 'approved', created_at: at(15), decided_at: at(16) },
    ],
    design_schedules: [
      { id: rid(51), design_id: D1, type: 'manufacturing_start', status: 'completed', scheduled_at: at(17), started_at: at(17), completed_at: at(17), assignee_name: '김재단' },
      { id: rid(52), design_id: D1, type: 'installation', status: 'completed', scheduled_at: at(21), started_at: null, completed_at: at(21), assignee_name: '설치 1팀', customer_confirmed_at: at(19) },
      { id: rid(53), design_id: D1, type: 'as_visit', status: 'scheduled', scheduled_at: at(25), started_at: null, completed_at: null, assignee_name: null },
      { id: rid(54), design_id: DB, type: 'installation', status: 'scheduled', scheduled_at: at(22), assignee_name: '남의 팀' },
    ],
    work_checks: [
      { id: rid(91), company_id: A, order_id: O1, role: 'cut', checked: true, photo_path: `${A}/${O1}/cut.jpg`, created_at: at(18) },
      { id: rid(92), company_id: A, order_id: O1, role: 'edge', checked: true, photo_path: null, created_at: at(18) },
      { id: rid(93), company_id: A, order_id: O1, role: 'install', checked: true, photo_path: `${A}/${O1}/install.jpg`, created_at: at(21) },
      { id: rid(94), company_id: B, order_id: OB, role: 'cut', checked: true, photo_path: `${B}/${OB}/cut.jpg`, created_at: at(18) },
    ],
    order_reports: [
      { id: rid(95), company_id: A, order_id: O1, kind: 'install_done', note: '걸레받이 실리콘 마감', photos: [`${A}/${O1}/r1.jpg`, `${A}/${O1}/r2.jpg`], created_at: at(21) },
      { id: rid(96), company_id: A, order_id: O1, kind: 'as_done', note: '경첩 교체', photos: [`${A}/${O1}/r3.jpg`], created_at: at(22, 9) },
      { id: rid(97), company_id: B, order_id: OB, kind: 'install_done', note: '남의 보고', photos: [], created_at: at(21) },
    ],
    as_requests: [
      { id: rid(98), company_id: A, order_id: O1, body: '도어가 처집니다', photos: [`${A}/${O1}/as1.jpg`], state: 'done', created_at: at(22), received_at: at(22, 2), done_at: at(22, 9) },
      { id: rid(99), company_id: A, order_id: O1, body: '거둔 접수', photos: [], state: 'cancelled', created_at: at(22) },
    ],
    production_requests: [],
  };
}

const call = (fake, id, key, token) => callWorker(worker, fake, `/company/projects/${id}/stages/${key}`, token);
const dataOf = async (id, key, token, fake = createFake({ tables: tables(), nowMs: NOW })) => {
  const r = await call(fake, id, key, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  assert.deepEqual(writesOf(fake), []);
  return r.json.data;
};
const signed = (bucket, path) => new RegExp(`/storage/v1/object/sign/${bucket}/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?token=`);

test('상담 — 이 프로젝트의 상담(돌려보낸 것 뺌). 연락처는 싣지 않고, 그림은 있는지만 알린다', async () => {
  const d = await dataOf(P1, 'consult', STAFF_A);
  assert.deepEqual([d.key, d.label], ['consult', '상담']);
  assert.deepEqual(d.consults, [
    {
      id: rid(62),
      created_at: at(2),
      sido: '경기',
      gugun: '성남시',
      categories: ['sink', 'fridge'],
      door_finish: 'matte',
      demolition_needed: true,
      price_tier: 'mid',
      preferred_date: '2026-11-05',
      preferred_time: '오후',
      wanted_done_date: '2026-12-10',
      description: 'ㄱ자 주방, 냉장고장 포함',
      has_image: true,
    },
  ]);
  const text = JSON.stringify(d);
  for (const word of ['김고객', '010-1111', 'generation', 'origin']) assert.equal(text.includes(word), false, word);
  assert.deepEqual((await dataOf(P2, 'consult', OWNER_A)).consults, []);
});

test('실측 — 취소 아닌 가장 새 실측(갈 사람은 구성원 이름)과 플래너의 현장사진', async () => {
  const d = await dataOf(P1, 'measure', STAFF_A);
  assert.equal(d.ready, true);
  assert.deepEqual(d.visit, {
    id: rid(71),
    status: 'done',
    scheduled_at: at(5, 5),
    assignee_id: STAFF_A,
    assignee_name: '나직원',
    note: '가스 배관 왼쪽',
    done_at: at(5, 7),
  });
  // 현장사진만 — 지운 사진 · 다른 프로젝트 초안의 사진은 없다
  assert.equal(d.photos.length, 1);
  assert.deepEqual([d.photos[0].kind, d.photos[0].label, d.photos[0].at, d.photos[0].note], ['site', '현장사진', at(5, 6), '배관 자리']);
  assert.match(d.photos[0].url, signed('planner-photos', `${A}/${DRAFT}/site-0001.jpg`));
  // 실측을 안 잡은 프로젝트 — 실측은 없고, 그 프로젝트 초안의 현장사진만 나온다
  const other = await dataOf(P2, 'measure', OWNER_A);
  assert.equal(other.visit, null);
  assert.equal(other.photos.length, 1);
  assert.match(other.photos[0].url, signed('planner-photos', `${A}/${DRAFT_OTHER}/site-9999.jpg`));
  const none = await dataOf(PM, 'measure', OWNER_M);
  assert.deepEqual([none.visit, none.photos], [null, []]);
});

test('설계 — 설계 · 초안 요약 · 그림(설계 · 종류마다 가장 새 것, 모듈 그림 뺌) · AI 연출 사진', async () => {
  const d = await dataOf(P1, 'design', STAFF_A);
  assert.deepEqual(d.designs, [{ id: D1, name: '주방 ㄱ자', created_at: at(6), updated_at: at(10) }]);
  assert.deepEqual(d.drafts, [{ id: DRAFT, name: '주방 ㄱ자', updated_at: at(10), walls: 2, modules: 14 }]);
  assert.deepEqual(d.renders.map((r) => [r.kind, r.label]).sort(), [['front', '정면도'], ['iso', '입체']]);
  assert.match(d.renders.find((r) => r.kind === 'front').url, signed('renders', `${D1}/1/front-new.png`));
  assert.deepEqual(d.photos.map((p) => p.kind), ['ai']);
  assert.equal(JSON.stringify(d).includes(DB), false);
});

test('견적 — 판마다(거둔 것 뺌, 새 것부터): 지금 판 · 금액 · 본 횟수 · 답 · 수정 요청 사유. 원가는 없다', async () => {
  const d = await dataOf(P1, 'quote', STAFF_A);
  assert.deepEqual(
    d.quotes.map((q) => [q.rev, q.current, q.total, q.view_count, q.decision, q.decided_at, q.reasons]),
    [
      [2, true, 8420000, 3, 'approved', at(14), []],
      [1, false, 7700000, 2, 'rejected', at(12), ['price']],
    ]
  );
  const text = JSON.stringify(d);
  for (const word of ['cost', '김고객', 'render_payload', 'subtotal']) assert.equal(text.includes(word), false, word);
});

test('계약 — 수주와 수금 줄. 금액은 대표 · 실장에게만, 직원에게는 null (읽지도 않는다)', async () => {
  const owner = await dataOf(P1, 'contract', OWNER_A);
  assert.deepEqual(owner.orders, [
    {
      id: O1,
      order_no: 'D-2611-014',
      status: 'completed',
      ordered_at: at(14),
      amount: 8420000,
      payments: [
        { stage: 'deposit', due_on: '2026-11-16', paid_on: '2026-11-16', amount: 2000000 },
        { stage: 'balance', due_on: '2026-11-25', paid_on: null, amount: 6420000 },
      ],
    },
  ]);
  assert.deepEqual(owner.approvals, [{ order_id: O1, state: 'approved', created_at: at(15), decided_at: at(16) }]);
  const fake = createFake({ tables: tables(), nowMs: NOW });
  const staff = await dataOf(P1, 'contract', STAFF_A, fake);
  assert.equal(staff.orders[0].amount, null);
  assert.deepEqual(staff.orders[0].payments.map((p) => [p.stage, p.paid_on, p.amount]), [
    ['deposit', '2026-11-16', null],
    ['balance', null, null],
  ]);
  for (const c of fake.calls.filter((x) => x.table === 'orders' || x.table === 'order_payments'))
    assert.equal(/amount/.test(String(c.params && c.params.get ? c.params.get('select') : '')), false);
  assert.equal(JSON.stringify(staff).includes('8420000'), false);
});

test('생산 — 생산 일정 · 작업지시서 · 작업자 확인 사진(재단 · 엣지 · 조립, 사진이 있는 것만)', async () => {
  const d = await dataOf(P1, 'make', STAFF_A);
  assert.deepEqual(d.schedules, [
    { id: rid(51), type: 'manufacturing_start', label: '제작 착수', status: 'completed', scheduled_at: at(17), started_at: at(17), completed_at: at(17), assignee_name: '김재단' },
  ]);
  assert.deepEqual(d.documents, [
    { id: rid(34), design_id: D1, doc_type: 'work_order', label: '작업지시서', doc_no: 'WO-1', rev: 1, status: 'issued', created_at: at(16) },
  ]);
  assert.deepEqual(d.photos.map((p) => [p.kind, p.label, p.at]), [['check', '재단 확인', at(18)]]);
  assert.match(d.photos[0].url, signed('work-check-photos', `${A}/${O1}/cut.jpg`));
  assert.deepEqual(d.requests, []);
});

test('설치 — 납품 · 설치 일정(고객 확인 포함) · 지시서 · 완료 보고 사진 · 설치 확인 · 시공 완료 사진', async () => {
  const d = await dataOf(P1, 'install', STAFF_A);
  assert.deepEqual(d.schedules.map((s) => [s.type, s.label, s.customer_confirmed_at]), [['installation', '설치', at(19)]]);
  assert.deepEqual(d.documents.map((x) => [x.doc_type, x.label]), [['installation_order', '설치 지시서']]);
  assert.equal(d.reports.length, 1);
  assert.deepEqual([d.reports[0].kind, d.reports[0].label, d.reports[0].note, d.reports[0].photo_urls.length], ['install_done', '설치 완료', '걸레받이 실리콘 마감', 2]);
  assert.match(d.reports[0].photo_urls[0], signed('order-report-photos', `${A}/${O1}/r1.jpg`));
  assert.deepEqual(d.photos.map((p) => p.label), ['설치 확인', '시공 완료']);
});

test('A/S — 접수 글 · 사진(거둔 접수 뺌) · A/S 완료 보고 · 방문 일정', async () => {
  const d = await dataOf(P1, 'done', STAFF_A);
  assert.deepEqual([d.key, d.label], ['done', '끝']);
  assert.equal(d.as.length, 1);
  assert.deepEqual([d.as[0].state, d.as[0].label, d.as[0].body, d.as[0].done_at], ['done', '끝', '도어가 처집니다', at(22, 9)]);
  assert.match(d.as[0].photo_urls[0], signed('as-request-photos', `${A}/${O1}/as1.jpg`));
  assert.deepEqual(d.reports.map((r) => [r.kind, r.note]), [['as_done', '경첩 교체']]);
  assert.deepEqual(d.schedules.map((s) => [s.type, s.label]), [['as_visit', 'A/S 방문']]);
});

test('버킷 경로 · 남의 자료는 어느 단계에도 없다', async () => {
  for (const key of STEPS) {
    const text = JSON.stringify(await dataOf(P1, key, OWNER_A));
    for (const word of ['photo_path', '"path"', '"photos":["', DB, OB, '남의', B])
      assert.equal(text.includes(word), false, `${key} — ${word}`);
  }
});

test('막는 것 — 다른 업체 · 없는 프로젝트는 404, 번호 · 단계 이름이 이상하면 422, 구성원이 아니면 403, 로그인 없으면 401', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW });
  assert.equal((await call(fake, PB, 'make', OWNER_A)).status, 404);
  assert.equal((await call(fake, rid(999), 'make', OWNER_A)).status, 404);
  assert.equal((await call(fake, 'abc', 'make', OWNER_A)).status, 422);
  assert.equal((await call(fake, P1, 'as', OWNER_A)).status, 422);
  assert.equal((await call(fake, P1, 'make', NOBODY)).status, 403);
  assert.equal((await call(fake, P1, 'make', null)).status, 401);
  assert.deepEqual(writesOf(fake), []);
});

test('영업 사원 업체 — A/S 접수는 읽지 않고, 생산 칸에 내가 낸 제작 의뢰가 실린다', async () => {
  const t = tables();
  t.production_requests = [
    { id: rid(81), company_id: M, project_id: PM, status: 'submitted', status_at: at(12), created_at: at(12) },
    { id: rid(82), company_id: M, project_id: PM, status: 'cancelled', status_at: at(11), created_at: at(11) },
  ];
  const fake = createFake({ tables: t, nowMs: NOW });
  const make = await dataOf(PM, 'make', OWNER_M, fake);
  assert.deepEqual(make.requests, [{ id: rid(81), status: 'submitted', status_at: at(12) }]);
  const done = await dataOf(PM, 'done', OWNER_M, fake);
  assert.deepEqual(done.as, []);
  assert.equal(fake.calls.some((c) => c.table === 'as_requests'), false);
});

test('프로젝트 창의 stages — 단계 띠가 목록의 단계와 같은 칸에 선다', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW });
  const r = await callWorker(worker, fake, `/company/projects/${P1}`, OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.project.step, 'done');
  assert.deepEqual(
    d.stages.map((s) => [s.key, s.state, s.days]),
    [
      ['consult', 'done', 1],
      ['measure', 'done', 2],
      ['design', 'done', 5],
      ['quote', 'done', 4],
      ['contract', 'done', 2],
      ['make', 'done', 4],
      ['install', 'done', 1],
      ['done', 'now', null],
    ]
  );
});
