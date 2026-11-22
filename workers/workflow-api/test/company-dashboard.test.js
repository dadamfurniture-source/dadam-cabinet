/**
 * 프로젝트 관리 대시보드 — src/company-dashboard.js
 *   GET /company/dashboard
 * 숫자는 순수 함수(dashboardOf · stayOf)로 보고, 권한은 가짜 Supabase 로 워커를 불러 보고,
 * 조회가 내 업체로 걸러지는지는 가짜 fetch 로 본다. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { dashboardOf, stayOf, mondayOf, getCompanyDashboard, STUCK_DAYS, DASH_STEPS } from '../src/company-dashboard.js';
import { funnelOf } from '../src/management/summary.js';
import { createFake, callWorker, writesOf, ENV } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const did = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const oid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER_A = uid(11);
const MANAGER_A = uid(12);
const STAFF_A = uid(13);
const OWNER_S = uid(51);
const PLATFORM_STAFF = uid(61);
const ADMIN = uid(71);
const NOBODY = uid(90);
const PLATFORM = cid(100);
const A = cid(1);
const S = cid(3);

const TODAY = '2026-11-23'; // 월요일
const NOW = Date.parse('2026-11-23T03:00:00.000Z'); // 한국 시간 2026-11-23 12시

// ── 머문 날 ───────────────────────────────────────────────────

test('대표님이 정한 날수 — 상담 2/7 · 실측 2/7 · 설계 3/7 · 견적 3/7 · 계약 3/7, 생산 · 설치는 날수가 없다', () => {
  assert.deepEqual(STUCK_DAYS, {
    consult: { slow: 2, stuck: 7 },
    measure: { slow: 2, stuck: 7 },
    design: { slow: 3, stuck: 7 },
    quote: { slow: 3, stuck: 7 },
    contract: { slow: 3, stuck: 7 },
  });
  assert.deepEqual(DASH_STEPS, ['consult', 'measure', 'design', 'quote', 'contract', 'make', 'install']);
});

test('stayOf — 단계마다 세기 시작하는 날과 느림 · 멈춤', () => {
  const at = (day) => `${day}T03:00:00Z`;
  const ctx = { today: TODAY };
  const state = (item, c = ctx) => {
    const s = stayOf(item, c);
    return [s.days, s.state];
  };
  // 상담 — 만든 날부터
  assert.deepEqual(state({ step: 'consult', created_at: at('2026-11-22') }), [1, 'fresh']);
  assert.deepEqual(state({ step: 'consult', created_at: at('2026-11-21') }), [2, 'slow']);
  assert.deepEqual(state({ step: 'consult', created_at: at('2026-11-16') }), [7, 'stuck']);
  // 실측 — 예정일 전에는 0일, 지나면 그날부터, 끝냈으면 끝낸 날부터
  const visit = (status, day, done) => ({ status, scheduled_at: at(day), done_at: done ? at(done) : null });
  assert.deepEqual(state({ step: 'measure', created_at: at('2026-11-01'), visit: visit('scheduled', '2026-11-25') }), [0, 'fresh']);
  assert.deepEqual(state({ step: 'measure', created_at: at('2026-11-01'), visit: visit('scheduled', '2026-11-20') }), [3, 'slow']);
  assert.deepEqual(state({ step: 'measure', created_at: at('2026-11-01'), visit: visit('done', '2026-11-10', '2026-11-15') }), [8, 'stuck']);
  // 설계 — 실측을 끝낸 날부터, 실측이 없으면 만든 날부터
  assert.deepEqual(state({ step: 'design', created_at: at('2026-11-01'), visit: visit('done', '2026-11-19', '2026-11-20') }), [3, 'slow']);
  assert.deepEqual(state({ step: 'design', created_at: at('2026-11-22') }), [1, 'fresh']);
  // 견적 — 다음 할 일의 since (보낸 날 · 답 받은 날)
  assert.deepEqual(state({ step: 'quote', created_at: at('2026-10-01'), next: { since: at('2026-11-19') } }), [4, 'slow']);
  // 계약 — 계약을 만든 날부터
  const orderOf = new Map([['p', { ordered_at: at('2026-11-10') }]]);
  assert.deepEqual(state({ id: 'p', step: 'contract', created_at: at('2026-10-01') }, { today: TODAY, orderOf }), [13, 'stuck']);
  // 생산 · 설치 — 잡아 둔 날이 지났을 때만 멈춤
  assert.equal(stayOf({ id: 'm', step: 'make' }, { today: TODAY, lateMake: new Set(['m']) }).state, 'stuck');
  assert.equal(stayOf({ id: 'm', step: 'make' }, ctx).state, 'fresh');
  assert.equal(stayOf({ id: 'i', step: 'install' }, { today: TODAY, lateInstall: new Set(['i']) }).state, 'stuck');
  assert.equal(stayOf({ id: 'i', step: 'install' }, { today: TODAY, lateMake: new Set(['i']) }).state, 'fresh');
});

test('mondayOf — 그 주의 월요일', () => {
  assert.equal(mondayOf('2026-11-23'), '2026-11-23');
  assert.equal(mondayOf('2026-11-29'), '2026-11-23');
  assert.equal(mondayOf('2026-11-30'), '2026-11-30');
  assert.equal(mondayOf('2026-11-25'), '2026-11-23');
});

// ── 숫자 (순수) ───────────────────────────────────────────────

const t = (day, hh = '00') => `${day}T${hh}:00:00Z`;
const P = (n) => pid(n);
const ITEMS = [
  { id: P(1), status: 'active', step: 'consult', created_at: t('2026-11-22', '01') },
  { id: P(2), status: 'active', step: 'consult', created_at: t('2026-11-10', '01') },
  { id: P(3), status: 'active', step: 'measure', created_at: t('2026-11-16', '02'), visit: { status: 'scheduled', scheduled_at: t('2026-11-20', '05'), done_at: null } },
  { id: P(4), status: 'active', step: 'design', created_at: t('2026-11-18'), visit: { status: 'done', scheduled_at: t('2026-11-21', '02'), done_at: t('2026-11-21', '05') } },
  { id: P(5), status: 'active', step: 'quote', created_at: t('2026-11-05'), next: { key: 'customer', since: t('2026-11-12') } },
  { id: P(6), status: 'active', step: 'contract', created_at: t('2026-11-08'), next: { key: 'deposit', since: t('2026-11-20') } },
  { id: P(7), status: 'active', step: 'make', created_at: t('2026-10-01') },
  { id: P(8), status: 'active', step: 'install', created_at: t('2026-09-20') },
  { id: P(9), status: 'on_hold', step: 'design', created_at: t('2026-10-10') },
  { id: P(10), status: 'completed', step: 'done', created_at: t('2026-07-10') },
];
const ORDERS = [
  { id: oid(6), project_id: P(6), design_id: did(6), status: 'confirmed', contract_amount: 5000000, ordered_at: t('2026-11-20'), delivered_at: null, completed_at: null },
  { id: oid(7), project_id: P(7), design_id: did(7), status: 'in_production', contract_amount: 8000000, ordered_at: t('2026-10-15'), delivered_at: null, completed_at: null },
  { id: oid(8), project_id: P(8), design_id: did(8), status: 'delivered', contract_amount: 3000000, ordered_at: t('2026-10-20'), delivered_at: t('2026-11-18'), completed_at: null },
  { id: oid(10), project_id: P(10), design_id: did(10), status: 'completed', contract_amount: 4000000, ordered_at: t('2026-08-01'), delivered_at: t('2026-08-20'), completed_at: t('2026-08-25') },
  { id: oid(11), project_id: P(2), design_id: did(11), status: 'cancelled', contract_amount: 9999999, ordered_at: t('2026-11-05'), delivered_at: null, completed_at: null },
];
const PAYMENTS = [
  { order_id: oid(6), stage: 'deposit', amount: 1500000, due_on: '2026-11-25', paid_on: null }, // 이번 주
  { order_id: oid(6), stage: 'balance', amount: 3500000, due_on: '2027-02-01', paid_on: null }, // 8주 밖
  { order_id: oid(7), stage: 'deposit', amount: 2400000, due_on: '2026-10-16', paid_on: '2026-10-16' }, // 받음
  { order_id: oid(7), stage: 'interim', amount: 2000000, due_on: '2026-11-10', paid_on: null }, // 13일 지남
  { order_id: oid(8), stage: 'balance', amount: 1000000, due_on: '2026-09-30', paid_on: null }, // 54일 지남
  { order_id: oid(8), stage: 'other', amount: 300000, due_on: '2026-12-09', paid_on: null }, // 셋째 주
  { order_id: oid(10), stage: 'balance', amount: 700000, due_on: '2026-08-30', paid_on: null }, // 85일 지남
  { order_id: oid(11), stage: 'deposit', amount: 5000000, due_on: '2026-11-01', paid_on: null }, // 취소 수주
];
const doc = (n, day, decision, decided) => ({
  design_id: did(n),
  doc_type: 'customer_confirmation',
  status: decision === 'approved' ? 'approved' : 'issued',
  decision: decision || null,
  created_at: t(day),
  first_viewed_at: null,
  decided_at: decided ? t(decided) : null,
  designs: { company_id: A, project_id: P(n) },
});
const DOCS = [
  doc(10, '2026-07-20', 'approved', '2026-07-30'),
  doc(7, '2026-10-05', 'approved', '2026-10-14'),
  doc(5, '2026-11-12'),
  doc(6, '2026-11-14', 'approved', '2026-11-19'),
];
const sched = (n, type, day, over = {}) => ({
  design_id: did(n),
  type,
  status: 'scheduled',
  scheduled_at: t(day),
  planned_at: t(day),
  completed_at: null,
  designs: { company_id: A, project_id: P(n) },
  ...over,
});
const SCHEDULES = [
  sched(7, 'manufacturing_end', '2026-11-20'), // 지났는데 안 끝남 → 생산 멈춤
  sched(7, 'manufacturing_start', '2026-11-25'), // 이번 주
  sched(8, 'installation', '2026-11-28', { scheduled_at: t('2026-11-28', '01') }), // 이번 주
  sched(6, 'installation', '2026-12-02', { status: 'cancelled' }),
  sched(6, 'manufacturing_start', '2026-12-15'), // 넷째 주
  sched(10, 'installation', '2026-08-25', { status: 'done', completed_at: t('2026-08-25') }),
];
const VISITS = [
  { project_id: P(3), status: 'scheduled', scheduled_at: t('2026-11-20', '05'), done_at: null, created_at: t('2026-11-18', '02') },
  { project_id: P(4), status: 'done', scheduled_at: t('2026-11-21', '02'), done_at: t('2026-11-21', '05'), created_at: t('2026-11-19') },
  { project_id: P(6), status: 'done', scheduled_at: t('2026-11-11'), done_at: t('2026-11-11'), created_at: t('2026-11-09') },
];
const STARTS = [
  { order_id: oid(7), at: t('2026-10-18') },
  { order_id: oid(8), at: t('2026-10-22') },
  { order_id: oid(10), at: t('2026-08-03') },
];
const AS_ROWS = [
  { state: 'requested', created_at: t('2026-11-01') },
  { state: 'cancelled', created_at: t('2026-11-02') },
  { state: 'done', created_at: t('2026-04-01') }, // 반년 밖
];
const ROWS = { items: ITEMS, orders: ORDERS, payments: PAYMENTS, docs: DOCS, schedules: SCHEDULES, visits: VISITS, starts: STARTS, asRows: AS_ROWS };

test('단계마다 쌓인 프로젝트 — 진행 중인 것만, 머문 날로 나눈다', () => {
  const out = dashboardOf(ROWS, TODAY);
  assert.equal(out.today, TODAY);
  assert.deepEqual(
    out.steps.map((s) => [s.key, s.label, s.count, s.fresh, s.slow, s.stuck]),
    [
      ['consult', '상담', 2, 1, 0, 1],
      ['measure', '실측', 1, 0, 1, 0],
      ['design', '설계', 1, 1, 0, 0],
      ['quote', '견적', 1, 0, 0, 1],
      ['contract', '계약', 1, 0, 1, 0],
      ['make', '생산', 1, 0, 0, 1],
      ['install', '설치', 1, 1, 0, 0],
    ]
  );
  // 보류 · 끝난 프로젝트는 세지 않는다 — 보류 수만 따로
  assert.deepEqual(out.active, { count: 8, stuck: 3, held: 1 });
});

test('돈 — 수주 잔고 · 받을 날이 지난 미수금 · 앞 8주 받을 돈 · 이번 달 계약 (취소 수주 뺌)', () => {
  const { money } = dashboardOf(ROWS, TODAY);
  assert.deepEqual(money.backlog, { amount: 16000000, count: 3 });
  assert.deepEqual(money.overdue, {
    amount: 3700000,
    count: 3,
    orders: 3,
    oldestDays: 85,
    buckets: [
      { key: '1-30', label: '1 ~ 30일', amount: 2000000, count: 1 },
      { key: '31-60', label: '31 ~ 60일', amount: 1000000, count: 1 },
      { key: '61+', label: '61일 넘음', amount: 700000, count: 1 },
    ],
  });
  assert.equal(money.upcoming.amount, 1800000);
  assert.deepEqual(
    money.upcoming.weeks.map((w) => [w.start, w.amount, w.count]),
    [
      ['2026-11-23', 1500000, 1],
      ['2026-11-30', 0, 0],
      ['2026-12-07', 300000, 1],
      ['2026-12-14', 0, 0],
      ['2026-12-21', 0, 0],
      ['2026-12-28', 0, 0],
      ['2027-01-04', 0, 0],
      ['2027-01-11', 0, 0],
    ]
  );
  assert.deepEqual(money.month, { month: '2026-11', count: 1, amount: 5000000, prevCount: 2, prevAmount: 11000000 });
});

test('앞 8주 일정 — 오늘부터의 제작 착수 · 설치 (취소 뺌)', () => {
  const { load } = dashboardOf(ROWS, TODAY);
  assert.deepEqual(
    load.weeks.map((w) => [w.start, w.make, w.install]).slice(0, 4),
    [
      ['2026-11-23', 1, 1],
      ['2026-11-30', 0, 0],
      ['2026-12-07', 0, 0],
      ['2026-12-14', 1, 0],
    ]
  );
  assert.equal(load.weeks.length, 8);
});

test('단계마다 걸린 날 — 지난 석 달의 가운데 값, 그 앞 석 달과 견준다', () => {
  const { days } = dashboardOf(ROWS, TODAY);
  assert.deepEqual(days.window, { days: 90, start: '2026-08-26', end: TODAY });
  const by = Object.fromEntries(days.steps.map((s) => [s.key, s]));
  // 상담: 3번 2일 · 4번 1일 · 6번 1일
  assert.deepEqual([by.consult.n, by.consult.medianDays, by.consult.prevDays, by.consult.delta], [3, 1, null, null]);
  // 실측: 4번 2일 5시간 · 6번 2일
  assert.deepEqual([by.measure.n, by.measure.medianDays], [2, 2.1]);
  // 설계: 6번 3일(실측 끝 → 견적) · 7번 4일 · 5번 7일(실측 없음 — 만든 때부터). 앞 석 달은 10번 10일
  assert.deepEqual([by.design.n, by.design.medianDays, by.design.prevDays, by.design.delta], [3, 4, 10, -6]);
  // 견적: 6번 6일 · 7번 10일. 앞 석 달 12일
  assert.deepEqual([by.quote.n, by.quote.medianDays, by.quote.prevDays, by.quote.delta], [2, 8, 12, -4]);
  // 계약: 7번 3일 · 8번 2일. 앞 석 달 2일
  assert.deepEqual([by.contract.n, by.contract.medianDays, by.contract.prevDays, by.contract.delta], [2, 2.5, 2, 0.5]);
  // 생산: 8번 27일. 앞 석 달 17일
  assert.deepEqual([by.make.n, by.make.medianDays, by.make.prevDays, by.make.delta], [1, 27, 17, 10]);
  // 설치: 이번 창에는 끝낸 것이 없다 (10번은 앞 석 달)
  assert.deepEqual([by.install.n, by.install.medianDays, by.install.prevDays, by.install.delta], [0, null, 5, null]);
  assert.deepEqual(days.worst, { key: 'make', label: '생산', delta: 10 });
});

test('견적 → 계약 여섯 달 · 설치 납기 · A/S 율', () => {
  const out = dashboardOf(ROWS, TODAY);
  assert.deepEqual(
    out.conversion.months.map((m) => [m.month, m.issued, m.ordered, m.rate]),
    [
      ['2026-06', 0, 0, null],
      ['2026-07', 1, 1, 100],
      ['2026-08', 0, 0, null],
      ['2026-09', 0, 0, null],
      ['2026-10', 1, 1, 100],
      ['2026-11', 2, 1, 50],
    ]
  );
  // 경영 요약과 같은 함수
  const f = funnelOf({ documents: DOCS, consultations: null, orders: ORDERS }, '2026-11');
  assert.deepEqual([out.conversion.months[5].issued, out.conversion.months[5].ordered], [f.issued, f.ordered]);
  assert.deepEqual(out.install, { done: 1, onTime: 1, onTimeRate: 100, overdue: 0 });
  assert.deepEqual(out.as, { installed: 1, requests: 1, rate: 100 });
});

test('자료가 없으면 — 0 과 null 로 채운 같은 모양, 못 읽은 칸은 null', () => {
  const out = dashboardOf({}, TODAY);
  assert.deepEqual(out.active, { count: 0, stuck: 0, held: 0 });
  assert.equal(out.steps.length, 7);
  assert.ok(out.steps.every((s) => s.count === 0));
  assert.ok(out.days.steps.every((s) => s.medianDays === null && s.n === 0));
  assert.equal(out.days.worst, null);
  assert.deepEqual(out.money.backlog, { amount: 0, count: 0 });
  assert.equal(out.money.overdue.oldestDays, null);
  assert.equal(out.money.upcoming.weeks.length, 8);
  assert.equal(out.load, null);
  assert.equal(out.install, null);
  assert.equal(out.as, null);
  assert.ok(out.conversion.months.every((m) => m.rate === null));
  // 일정은 읽었지만 비어 있을 때
  const empty = dashboardOf({ schedules: [], asRows: [] }, TODAY);
  assert.deepEqual(empty.load.weeks.map((w) => w.make + w.install), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(empty.install, { done: 0, onTime: 0, onTimeRate: null, overdue: 0 });
  assert.deepEqual(empty.as, { installed: 0, requests: 0, rate: null });
});

// ── 권한 (워커) ───────────────────────────────────────────────

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: S, kind: 'partner', name: '멈춘 가구', plan: 'expert', status: 'suspended' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: S, user_id: OWNER_S, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
    ],
    profiles: [],
  };
}

test('대표 · 실장만 — 직원은 403 not_manager, 구성원이 아니면 not_member, 본사 · 멈춘 업체는 not_project_company', async () => {
  const fake = createFake({ tables: tables(), admins: [ADMIN], nowMs: NOW });
  const call = (token) => callWorker(worker, fake, '/company/dashboard', token);
  const staff = await call(STAFF_A);
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_manager');
  for (const who of [NOBODY, ADMIN]) {
    const r = await call(who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_member');
  }
  for (const who of [PLATFORM_STAFF, OWNER_S]) {
    const r = await call(who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'not_project_company');
  }
  assert.equal((await call(null)).status, 401);
  // 막힌 사람에게는 재료를 읽지도 않는다
  for (const table of ['projects', 'orders', 'order_payments', 'design_documents', 'design_schedules'])
    assert.equal(fake.calls.some((c) => c.table === table), false, table);
  assert.deepEqual(writesOf(fake), []);
});

test('대표 · 실장은 200 — 읽기만 하고, 캐시하지 않는다', async () => {
  for (const who of [OWNER_A, MANAGER_A]) {
    const fake = createFake({ tables: tables(), admins: [ADMIN], nowMs: NOW });
    const r = await callWorker(worker, fake, '/company/dashboard', who);
    assert.equal(r.status, 200, who);
    const d = r.json.data;
    assert.deepEqual(d.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
    assert.deepEqual(d.active, { count: 0, stuck: 0, held: 0 });
    assert.equal(d.steps.length, 7);
    assert.match(r.headers.get('Cache-Control') || '', /no-store/);
    assert.deepEqual(writesOf(fake), []);
  }
});

// ── 조회 (가짜 fetch) ─────────────────────────────────────────

const json = (rows, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET' });
    return route(u);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const route = (over = {}) => (u) => {
  const table = (u.match(/\/rest\/v1\/(\w+)\?/) || [])[1];
  if (table in over) return over[table];
  if (table === 'company_members') return json([{ company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' }]);
  if (table === 'companies') return json([{ id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' }]);
  if (table === 'projects') return json([{ id: P(6), customer_id: null, title: '주방', status: 'active', created_at: t('2026-11-08'), closed_at: null, assignee_id: null }]);
  if (table === 'orders') return json(ORDERS.filter((o) => o.project_id === P(6)).map((o) => ({ ...o, document_id: null, order_no: 'D-1' })));
  if (table === 'order_payments') return json(PAYMENTS.filter((p) => p.order_id === oid(6)));
  if (table === 'design_documents') return json(DOCS);
  if (table === 'design_schedules') return json(SCHEDULES);
  return json([]);
};
const run = (over) =>
  withFetch(route(over), async (calls) => ({ out: await getCompanyDashboard(ENV, { user: { id: OWNER_A }, nowMs: NOW }), calls }));

test('조회 — 모두 내 업체로 거르고, 고객 · 원가는 읽지도 싣지도 않는다', async () => {
  const { out, calls } = await run();
  assert.equal(out.today, TODAY);
  assert.deepEqual(out.company, { id: A, name: '가나 인테리어', kind: 'partner', plan: 'agent' });
  // 단계는 프로젝트 목록이 정한 것 — 접수 상태 수주가 있는 프로젝트는 「계약」
  assert.deepEqual(out.steps.filter((s) => s.count).map((s) => [s.key, s.count, s.slow]), [['contract', 1, 1]]);
  assert.deepEqual(out.money.backlog, { amount: 5000000, count: 1 });
  const mine = (table, word) => calls.filter((c) => c.url.includes(`/${table}?`)).every((c) => c.url.includes(word));
  assert.ok(mine('orders', `company_id=eq.${A}`));
  // 수금 줄 — 금액을 읽는 조회는 내 업체 수주 것만 (프로젝트 목록의 계약금 확인은 수주 번호로 묻는다)
  const pay = calls.filter((c) => c.url.includes('/order_payments?') && c.url.includes('amount'));
  assert.equal(pay.length, 1);
  assert.ok(pay[0].url.includes(`orders.company_id=eq.${A}`));
  assert.ok(mine('order_events', `company_id=eq.${A}`));
  assert.ok(mine('project_visits', `company_id=eq.${A}`));
  assert.ok(mine('as_requests', `company_id=eq.${A}`));
  const docs = calls.find((c) => c.url.includes('/design_documents?') && c.url.includes('first_viewed_at')).url;
  assert.ok(docs.includes(`designs.company_id=eq.${A}`));
  assert.ok(docs.includes('designs!inner(company_id,project_id)'));
  const schedules = calls.find((c) => c.url.includes('/design_schedules?')).url;
  assert.ok(schedules.includes(`designs.company_id=eq.${A}`));
  assert.ok(schedules.includes('scheduled_at=gte.2026-01-27T00:00:00+09:00'));
  for (const c of calls) {
    assert.equal(c.method, 'GET', c.url.slice(0, 80));
    for (const word of ['received_amount', 'quote_payload', 'render_payload', 'totals', 'select=*', 'signer_name', 'address'])
      assert.equal(c.url.includes(word), false, `${word} — ${c.url.slice(0, 80)}`);
  }
  const text = JSON.stringify(out);
  for (const word of ['customer', 'phone', 'cost', 'margin', '주방']) assert.equal(text.includes(word), false, word);
});

test('못 읽은 재료 — 일정 · 실측 · 생산 시작 · A/S 는 그 칸만 비우고, 수주 · 수금 · 견적을 못 읽으면 던진다', async () => {
  const bad = json({ message: 'boom' }, 500);
  const missing = json({ code: '42P01', message: 'relation "x" does not exist' }, 404);
  const a = await run({ design_schedules: bad, order_events: bad, as_requests: missing });
  assert.equal(a.out.load, null);
  assert.equal(a.out.install, null);
  assert.equal(a.out.as, null);
  assert.equal(a.out.money.backlog.count, 1);
  await assert.rejects(run({ order_payments: bad }));
});
