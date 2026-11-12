/**
 * 업체 업무 달력 (src/company-schedules.js) — GET /company/schedules.
 *
 *   - 일정 표 · 상담 희망일 · 받을 날 · A/S 접수를 한 목록으로, 한국 날짜로 나눈다
 *   - 종류: 실측 · 상담 희망일 · 받을 날 = 영업, 자재 발주 ~ 검수 = 생산, 납품 · 설치 = 설치, A/S 방문 · 접수 = A/S
 *   - 받을 날(금액)은 대표 · 실장에게만, 다른 업체 줄은 안 나온다
 *   - 설계 마감 = 계약금 입금날 (받았으면 받은 날, 아직이면 받을 날) = 설계. 금액 없이 구성원 모두에게
 *   - 일정 넣기 · 고치기는 대표 · 실장만 (직원 403 not_manager)
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  KIND_OF_TYPE,
  SCHEDULE_KINDS,
  SCHEDULE_RANGE_DAYS,
  scheduleRangeOf,
  listCompanySchedules,
} from '../src/company-schedules.js';
import { SCHEDULE_TYPES } from '../src/schedules.js';
import { ValidationError } from '../src/supabase.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const HQ = 'c0000000-0000-4000-8000-000000000009';
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const FREE = 'c0000000-0000-4000-8000-000000000003';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const OTHER = 'a0000000-0000-4000-8000-000000000004';
const FREE_OWNER = 'a0000000-0000-4000-8000-000000000005';
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const O = (i) => id('0a', i);
const D = (i) => id('0d', i);
const P = (i) => id('0e', i);
const S = (i) => id('05', i);
const C = (i) => id('0c', i);
const PAY = (i) => id('0b', i);
const AS = (i) => id('07', i);
/** 한국 시간 → ms · UTC ISO */
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-10T10:00:00');

function tables() {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '예시 공장', plan: null, status: 'active' },
      { id: CO, kind: 'partner', name: '예시 협력 주방', plan: 'agent', status: 'active' },
      { id: CO2, kind: 'partner', name: '다른 업체', plan: 'agent', status: 'active' },
      { id: FREE, kind: 'partner', name: '무료 업체', plan: 'free', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
      { user_id: MANAGER, company_id: CO, role: 'manager', status: 'active' },
      { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
      { user_id: OTHER, company_id: CO2, role: 'owner', status: 'active' },
      { user_id: FREE_OWNER, company_id: FREE, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    projects: [
      { id: P(1), company_id: CO, title: '예시 프로젝트 1' },
      { id: P(2), company_id: CO, title: '예시 프로젝트 2' },
      { id: P(9), company_id: CO2, title: '남의 프로젝트' },
    ],
    designs: [
      { id: D(1), company_id: CO, user_id: STAFF, name: '예시 설계 1', project_id: P(1) },
      { id: D(2), company_id: CO, user_id: OWNER, name: '예시 설계 2', project_id: null },
      { id: D(9), company_id: CO2, user_id: OTHER, name: '남의 설계', project_id: P(9) },
    ],
    design_schedules: [
      // 11월 1일 08:30 (한국) = 10월 31일 23:30 UTC — 한국 날짜로 11월 1일
      { id: S(1), design_id: D(1), type: 'measurement', title: null, status: 'scheduled', scheduled_at: iso('2026-11-01T08:30:00'), duration_min: 60, assignee_name: '김담당', location: '예시 현장' },
      { id: S(2), design_id: D(1), type: 'manufacturing_start', title: '재단부터', status: 'confirmed', scheduled_at: iso('2026-11-12T09:00:00'), duration_min: 480, assignee_name: null, location: null },
      { id: S(3), design_id: D(2), type: 'installation', title: null, status: 'scheduled', scheduled_at: iso('2026-11-20T10:00:00'), duration_min: 240, assignee_name: null, location: null },
      { id: S(4), design_id: D(2), type: 'as_visit', title: null, status: 'cancelled', scheduled_at: iso('2026-11-25T14:00:00'), duration_min: 60, assignee_name: null, location: null },
      // 기간 밖 — 10월 31일 23:00 (한국), 12월 1일 00:30 (한국)
      { id: S(5), design_id: D(1), type: 'delivery', title: null, status: 'scheduled', scheduled_at: iso('2026-10-31T23:00:00'), duration_min: 60, assignee_name: null, location: null },
      { id: S(6), design_id: D(1), type: 'delivery', title: null, status: 'scheduled', scheduled_at: iso('2026-12-01T00:30:00'), duration_min: 60, assignee_name: null, location: null },
      // 다른 업체
      { id: S(9), design_id: D(9), type: 'installation', title: null, status: 'scheduled', scheduled_at: iso('2026-11-15T10:00:00'), duration_min: 60, assignee_name: null, location: null },
    ],
    consultations: [
      { id: C(1), company_id: CO, status: 'assigned', title: '주방 상담', sido: '대구광역시', gugun: '북구', preferred_date: '2026-11-05', preferred_time: '오후', project_id: P(2), name: '김고객', phone: '010-0000-0000' },
      { id: C(2), company_id: CO, status: 'returned', title: null, sido: null, gugun: null, preferred_date: '2026-11-06', preferred_time: null, project_id: null },
      { id: C(3), company_id: CO, status: 'cancelled', title: null, sido: null, gugun: null, preferred_date: '2026-11-07', preferred_time: null, project_id: null },
      { id: C(4), company_id: CO, status: null, title: null, sido: null, gugun: null, preferred_date: null, preferred_time: null, project_id: null },
      { id: C(5), company_id: CO, status: 'confirmed', title: null, sido: null, gugun: null, preferred_date: '2026-12-02', preferred_time: null, project_id: null },
      { id: C(9), company_id: CO2, status: 'assigned', title: '남의 상담', sido: null, gugun: null, preferred_date: '2026-11-05', preferred_time: null, project_id: null },
    ],
    orders: [
      { id: O(1), company_id: CO, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1) },
      { id: O(2), company_id: CO, order_no: 'SO-20261020-CCCC', status: 'cancelled', design_id: D(2), project_id: null },
      // 계약금을 아직 안 받은 수주 · 계약금을 두 번에 나눠 10월에 먼저 받은 수주
      { id: O(3), company_id: CO, order_no: 'SO-20261109-DDDD', status: 'confirmed', design_id: D(2), project_id: P(2) },
      { id: O(4), company_id: CO, order_no: 'SO-20261019-EEEE', status: 'confirmed', design_id: D(1), project_id: null },
      { id: O(9), company_id: CO2, order_no: 'SO-20261101-ZZZZ', status: 'in_production', design_id: D(9), project_id: P(9) },
    ],
    order_payments: [
      { id: PAY(1), order_id: O(1), stage: 'deposit', amount: 500000, due_on: '2026-11-03', paid_on: '2026-11-03' },
      { id: PAY(2), order_id: O(1), stage: 'interim', amount: 1200000, due_on: '2026-11-14', paid_on: null },
      { id: PAY(3), order_id: O(1), stage: 'balance', amount: 800000, due_on: '2026-12-05', paid_on: null },
      { id: PAY(4), order_id: O(2), stage: 'deposit', amount: 300000, due_on: '2026-11-15', paid_on: null },
      { id: PAY(5), order_id: O(3), stage: 'deposit', amount: 400000, due_on: '2026-11-18', paid_on: null },
      { id: PAY(6), order_id: O(4), stage: 'deposit', amount: 200000, due_on: '2026-10-20', paid_on: '2026-10-20' },
      { id: PAY(7), order_id: O(4), stage: 'deposit', amount: 200000, due_on: '2026-11-22', paid_on: null },
      { id: PAY(9), order_id: O(9), stage: 'deposit', amount: 999999, due_on: '2026-11-14', paid_on: null },
    ],
    as_requests: [
      { id: AS(1), company_id: CO, order_id: O(1), state: 'requested', created_at: iso('2026-11-08T16:20:00'), body: '문짝이 처졌어요' },
      { id: AS(2), company_id: CO, order_id: O(1), state: 'cancelled', created_at: iso('2026-11-09T09:00:00'), body: 'x' },
      { id: AS(9), company_id: CO2, order_id: O(9), state: 'requested', created_at: iso('2026-11-08T10:00:00'), body: 'x' },
    ],
  };
}

const USERS = {
  t_owner: { id: OWNER },
  t_manager: { id: MANAGER },
  t_staff: { id: STAFF },
  t_other: { id: OTHER },
  t_free: { id: FREE_OWNER },
  t_nobody: { id: id('a9', 1) },
};
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

async function call(fake, token, path, init = {}) {
  const realNow = Date.now;
  Date.now = () => AT;
  try {
    return await withFake(fake, async () => {
      const res = await worker.fetch(
        new Request(`https://api.test${path}`, {
          method: init.method || 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: init.body ? JSON.stringify(init.body) : undefined,
        }),
        ENV,
        { waitUntil() {} },
      );
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control') };
    });
  } finally {
    Date.now = realNow;
  }
}
const NOV = '/company/schedules?from=2026-11-01&to=2026-11-30';
const keysOf = (r) => r.json.data.items.map((i) => i.key);

// ── 순수 ──────────────────────────────────────────────────────────

test('종류 — 영업 · 설계 · 생산 · 설치 · A/S 차례, 일정 8종은 모두 그중 하나', () => {
  assert.deepEqual([...SCHEDULE_KINDS], ['sales', 'design', 'make', 'install', 'as']);
  for (const t of SCHEDULE_TYPES) assert.ok(SCHEDULE_KINDS.includes(KIND_OF_TYPE[t]), t);
  assert.equal(KIND_OF_TYPE.measurement, 'sales');
  assert.equal(KIND_OF_TYPE.quality_check, 'make');
  assert.equal(KIND_OF_TYPE.delivery, 'install');
  assert.equal(KIND_OF_TYPE.as_visit, 'as');
});

test('기간 — 없으면 이번 달(한국 날짜), 하나만 있으면 한 달, 잘못된 날짜 · 뒤집힌 기간 · 너무 긴 기간은 422', () => {
  assert.deepEqual(scheduleRangeOf({}, AT), { from: '2026-11-01', to: '2026-11-30' });
  // 한국은 이미 12월 1일 (UTC 11월 30일 16시)
  assert.deepEqual(scheduleRangeOf({}, kst('2026-12-01T01:00:00')), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(scheduleRangeOf({}, kst('2028-02-10T12:00:00')), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(scheduleRangeOf({ from: '2026-11-10' }, AT), { from: '2026-11-10', to: '2026-12-10' });
  assert.deepEqual(scheduleRangeOf({ to: '2026-11-10' }, AT), { from: '2026-10-11', to: '2026-11-10' });
  assert.deepEqual(scheduleRangeOf({ from: '2026-11-10', to: '2026-11-10' }, AT), { from: '2026-11-10', to: '2026-11-10' });
  assert.throws(() => scheduleRangeOf({ from: '2026-13-40' }, AT), ValidationError);
  assert.throws(() => scheduleRangeOf({ from: 'today' }, AT), ValidationError);
  assert.throws(() => scheduleRangeOf({ from: '2026-11-10', to: '2026-11-09' }, AT), ValidationError);
  const far = new Date(Date.parse('2026-11-01T00:00:00Z') + SCHEDULE_RANGE_DAYS * 86400000).toISOString().slice(0, 10);
  assert.throws(() => scheduleRangeOf({ from: '2026-11-01', to: far }, AT), ValidationError);
});

// ── 목록 ──────────────────────────────────────────────────────────

test('대표 — 일정 · 상담 희망일 · 받을 날 · 설계 마감 · A/S 접수가 날짜 차례로, 기간 밖 · 다른 업체 · 돌려보낸 상담 · 받은 돈 · 취소 수주 · 거둔 접수는 빠진다', async () => {
  const r = await call(world(), 't_owner', NOV);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.cache || '', /no-store/);
  const d = r.json.data;
  assert.deepEqual(d.company, { id: CO, name: '예시 협력 주방' });
  assert.equal(d.can_manage, true);
  assert.deepEqual(d.range, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(d.today, '2026-11-10');
  assert.equal(d.truncated, false);
  assert.deepEqual(keysOf(r), [
    `schedule:${S(1)}`,
    `design_due:${O(1)}`,
    `consult:${C(1)}`,
    `as:${AS(1)}`,
    `schedule:${S(2)}`,
    `payment:${PAY(2)}`,
    `payment:${PAY(5)}`,
    `schedule:${S(3)}`,
    `payment:${PAY(7)}`,
    `schedule:${S(4)}`,
  ]);
  const by = Object.fromEntries(d.items.map((i) => [i.key, i]));

  const s1 = by[`schedule:${S(1)}`];
  assert.equal(s1.day, '2026-11-01', '한국 날짜로 센다');
  assert.equal(s1.time, '08:30');
  assert.equal(s1.kind, 'sales');
  assert.equal(s1.label, '실측');
  assert.deepEqual(s1.design, { id: D(1), name: '예시 설계 1' });
  assert.deepEqual(s1.project, { id: P(1), title: '예시 프로젝트 1' });
  assert.equal(s1.assignee_name, '김담당');

  assert.equal(by[`schedule:${S(2)}`].kind, 'make');
  assert.equal(by[`schedule:${S(2)}`].title, '재단부터');
  assert.equal(by[`schedule:${S(3)}`].kind, 'install');
  assert.equal(by[`schedule:${S(3)}`].project, null, '프로젝트에 잇지 않은 설계');
  assert.equal(by[`schedule:${S(4)}`].status, 'cancelled', '취소한 일정도 준다');
  assert.equal(by[`schedule:${S(4)}`].kind, 'as');

  const c1 = by[`consult:${C(1)}`];
  assert.equal(c1.kind, 'sales');
  assert.equal(c1.label, '상담 희망일');
  assert.equal(c1.day, '2026-11-05');
  assert.equal(c1.time, '오후');
  assert.equal(c1.location, '대구광역시 북구');
  assert.deepEqual(c1.project, { id: P(2), title: '예시 프로젝트 2' });

  const pay = by[`payment:${PAY(2)}`];
  assert.equal(pay.kind, 'sales');
  assert.equal(pay.label, '중도금 받을 날');
  assert.equal(pay.day, '2026-11-14');
  assert.equal(pay.amount, 1200000);
  assert.equal(pay.order_no, 'SO-20261101-AAAA');
  assert.deepEqual(pay.project, { id: P(1), title: '예시 프로젝트 1' });

  const as = by[`as:${AS(1)}`];
  assert.equal(as.kind, 'as');
  assert.equal(as.label, 'A/S 접수');
  assert.equal(as.day, '2026-11-08');
  assert.equal(as.time, '16:20');
  assert.equal(as.order_no, 'SO-20261101-AAAA');

  // 설계 마감 — 계약금을 받은 날. 입금된 뒤에만 보인다 (2026-11-10 대표님 결정). 금액은 없다
  const due1 = by[`design_due:${O(1)}`];
  assert.equal(due1.kind, 'design');
  assert.equal(due1.label, '설계 마감');
  assert.equal(due1.day, '2026-11-03', '계약금 받은 날');
  assert.equal(due1.status, 'deposit_paid');
  assert.equal(due1.amount, null);
  assert.equal(due1.order_no, 'SO-20261101-AAAA');
  assert.deepEqual(due1.design, { id: D(1), name: '예시 설계 1' });
  assert.deepEqual(due1.project, { id: P(1), title: '예시 프로젝트 1' });
  assert.ok(!by[`design_due:${O(3)}`], '계약금을 아직 안 받은 수주 — 받을 날에는 마감이 없다');
  assert.ok(d.items.every((i) => i.status !== 'deposit_due'), '「입금 예정」 줄은 없다');
  assert.ok(!by[`design_due:${O(4)}`], '10월에 계약금을 먼저 받은 수주 — 남은 계약금 받을 날은 마감이 아니다');
  assert.ok(!by[`design_due:${O(2)}`], '취소 수주');

  // 고객 이름 · 전화 · A/S 본문은 싣지 않는다
  const text = JSON.stringify(d);
  for (const secret of ['김고객', '010-0000-0000', '문짝이 처졌어요', '남의']) assert.ok(!text.includes(secret), secret);
});

test('실장은 대표와 같다 · 직원은 받을 날(금액)을 못 보고 can_manage 가 false', async () => {
  const manager = await call(world(), 't_manager', NOV);
  assert.equal(manager.json.data.can_manage, true);
  assert.ok(keysOf(manager).includes(`payment:${PAY(2)}`));

  const fake = world();
  const staff = await call(fake, 't_staff', NOV);
  assert.equal(staff.status, 200);
  assert.equal(staff.json.data.can_manage, false);
  assert.deepEqual(keysOf(staff), [
    `schedule:${S(1)}`,
    `design_due:${O(1)}`,
    `consult:${C(1)}`,
    `as:${AS(1)}`,
    `schedule:${S(2)}`,
    `schedule:${S(3)}`,
    `schedule:${S(4)}`,
  ]);
  assert.ok(staff.json.data.items.every((i) => i.amount === null));
  const payCalls = fake.calls.rest.filter((c) => c.path === 'order_payments');
  assert.ok(payCalls.length > 0, '설계 마감 날짜는 직원도 본다');
  assert.ok(payCalls.every((c) => !c.query.includes('amount')), '직원 요청은 금액을 읽지 않는다');
  assert.ok(payCalls.every((c) => c.query.includes('stage=eq.deposit')), '직원 요청은 계약금 줄만 읽는다');
});

test('설계 마감은 입금된 뒤에만 — 받은 날에 생기고, 나눠 받아도 처음 받은 날 하나', async () => {
  const t = tables();
  const pay = (n) => t.order_payments.find((p) => p.id === PAY(n));
  pay(5).paid_on = '2026-11-12'; // 받을 날(18일)보다 먼저 받음
  pay(7).paid_on = '2026-11-22'; // 10월에 먼저 받은 수주의 둘째 계약금
  const r = await call(world(t), 't_staff', NOV);
  const by = Object.fromEntries(r.json.data.items.map((i) => [i.key, i]));
  const due3 = by[`design_due:${O(3)}`];
  assert.equal(due3.day, '2026-11-12', '받을 날이 아니라 받은 날');
  assert.equal(due3.status, 'deposit_paid');
  assert.equal(due3.amount, null);
  assert.deepEqual(due3.design, { id: D(2), name: '예시 설계 2' });
  assert.deepEqual(due3.project, { id: P(2), title: '예시 프로젝트 2' });
  assert.ok(!by[`design_due:${O(4)}`], '처음 받은 날(10월 20일)이 마감 — 11월에 또 받아도 줄이 늘지 않는다');
});

test('기간을 좁히면 그 날만 — 마지막 날은 한국 시간 자정 앞까지', async () => {
  const r = await call(world(), 't_owner', '/company/schedules?from=2026-11-12&to=2026-11-14');
  assert.deepEqual(keysOf(r), [`schedule:${S(2)}`, `payment:${PAY(2)}`]);
  const oct = await call(world(), 't_owner', '/company/schedules?from=2026-10-31&to=2026-10-31');
  assert.deepEqual(keysOf(oct), [`schedule:${S(5)}`], '10월 31일 23시(한국)는 10월 31일');
  const paid = await call(world(), 't_owner', '/company/schedules?from=2026-10-20&to=2026-10-20');
  assert.deepEqual(keysOf(paid), [`design_due:${O(4)}`], '계약금을 나눠 받으면 처음 받은 날이 설계 마감');
  assert.equal(paid.json.data.items[0].status, 'deposit_paid');
  const dec = await call(world(), 't_owner', '/company/schedules?from=2026-12-01&to=2026-12-05');
  assert.deepEqual(keysOf(dec), [`schedule:${S(6)}`, `consult:${C(5)}`, `payment:${PAY(3)}`]);
});

test('기간 없이 부르면 이번 달', async () => {
  const r = await call(world(), 't_owner', '/company/schedules');
  assert.deepEqual(r.json.data.range, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.json.data.items.length, 10);
});

test('잘못된 기간은 422 · 구성원이 아니면 403 not_member · 프로젝트를 못 가지는 업체는 403 not_project_company · 토큰 없으면 401', async () => {
  const bad = await call(world(), 't_owner', '/company/schedules?from=2026-11-10&to=2026-11-01');
  assert.equal(bad.status, 422, JSON.stringify(bad.json));
  const nobody = await call(world(), 't_nobody', NOV);
  assert.equal(nobody.status, 403);
  assert.equal(nobody.json.code, 'not_member');
  const free = await call(world(), 't_free', NOV);
  assert.equal(free.status, 403);
  assert.equal(free.json.code, 'not_project_company');
  const anon = await call(world(), 'nope', NOV);
  assert.equal(anon.status, 401);
});

test('A/S 접수 표가 아직 없으면 (DB 0045 전) 그 줄만 빼고 준다', async () => {
  const fake = world();
  const inner = fake.fetch;
  fake.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/rest/v1/as_requests') {
      return new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.as_requests' in the schema cache" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return inner(input, init);
  };
  const data = await withFake(fake, () => listCompanySchedules(ENV, { user: { id: OWNER }, query: { from: '2026-11-01', to: '2026-11-30' } }, AT));
  assert.equal(data.items.length, 9);
  assert.ok(!data.items.some((i) => i.source === 'as'));
});

// ── 일정 넣기 · 고치기는 대표 · 실장만 ─────────────────────────────

test('일정 고치기 — 직원은 403 not_manager (자기가 만든 설계여도), 대표 · 실장은 된다, 다른 업체는 403', async () => {
  const fake = world();
  const patch = { method: 'PATCH', body: { scheduled_at: '2026-11-13T01:00:00Z' } };
  const staff = await call(fake, 't_staff', `/schedules/${S(2)}`, patch);
  assert.equal(staff.status, 403, JSON.stringify(staff.json));
  assert.equal(staff.json.code, 'not_manager');
  assert.equal(fake.db.design_schedules.find((s) => s.id === S(2)).scheduled_at, iso('2026-11-12T09:00:00'), '바뀌지 않았다');

  const other = await call(fake, 't_other', `/schedules/${S(2)}`, patch);
  assert.equal(other.status, 403);

  const owner = await call(fake, 't_owner', `/schedules/${S(2)}`, patch);
  assert.equal(owner.status, 200, JSON.stringify(owner.json));
  assert.equal(fake.db.design_schedules.find((s) => s.id === S(2)).scheduled_at, '2026-11-13T01:00:00.000Z');

  const manager = await call(fake, 't_manager', `/schedules/${S(4)}`, { method: 'PATCH', body: { status: 'scheduled' } });
  assert.equal(manager.status, 200, JSON.stringify(manager.json));
  assert.equal(fake.db.design_schedules.find((s) => s.id === S(4)).status, 'scheduled', '취소한 일정을 되살린다');
});

test('일정 넣기 — 직원은 403 not_manager, 대표는 201 (협력업체 설계는 본사 Slack 없음) · 보기는 직원도', async () => {
  const fake = world();
  const body = { items: [{ type: 'installation', scheduled_at: '2026-11-21T01:00:00Z' }] };
  const staff = await call(fake, 't_staff', `/designs/${D(1)}/schedules`, { method: 'POST', body });
  assert.equal(staff.status, 403, JSON.stringify(staff.json));
  assert.equal(staff.json.code, 'not_manager');
  assert.equal(fake.db.design_schedules.length, 7);

  const owner = await call(fake, 't_owner', `/designs/${D(1)}/schedules`, { method: 'POST', body });
  assert.equal(owner.status, 201, JSON.stringify(owner.json));
  assert.equal(owner.json.data.slack, null);
  assert.equal(fake.db.design_schedules.length, 8);

  const list = await call(fake, 't_staff', `/designs/${D(1)}/schedules`);
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.length >= 3);
});
