/**
 * 아침 브리핑 (src/brief.js) — 비서를 쓰는 업체 구성원의 「오늘 볼 것」.
 *
 *   - 볼 것: 상담(응답 기다림) · 수금(오늘 · 늦음) · 7일 안 납품 · 설치 · 대표 결정 요청 · 확인할 사진 · 안 본 장부 알림
 *   - 역할마다: 대표는 모두, 실장은 요청 빼고, 직원은 일정만 (돈 · 상담 · 회계 없음)
 *   - 현황: 수주 없는 프로젝트 단계 · 수주 상태별 수 · 제작 중 수주의 재단 · 엣지 · 조립 · 설치 필수 확인 진행
 *   - GET /brief/today — 비서 자격 full 업체 구성원만, 고객 이름 없음
 *   - 매분 cron — 08:00 부터 업체마다 정해진 분에 한 번, 볼 것이 있는 사람에게만 「오늘 볼 것 N건」 (하루 한 번)
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  briefKeysFor,
  consultsOf,
  dueOf,
  schedulesOf,
  stagesOf,
  briefFor,
  briefSlot,
  slotOf,
  runMorningBrief,
  BRIEF_MINUTES,
} from '../src/brief.js';
import { buildMessage, isValidMessage } from '../src/push/messages.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const OTHER = 'a0000000-0000-4000-8000-000000000004';
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const O = (i) => id('0a', i);
const D = (i) => id('0d', i);
const P = (i) => id('0e', i);
const WO = id('0f', 1);
const SNAP = id('0b', 1);
/** 한국 시간 → ms */
const kst = (s) => Date.parse(`${s}+09:00`);
// CO 는 id 앞 8자리(c0000000)로 08:02 에 센다
const AT = kst('2026-11-05T08:02:00');

const CHECK_LIST = {
  version: 'v1',
  block: 'must',
  roles: {
    cut: [
      { key: 'c1', label: '원장 확인', scope: 'order', must: true },
      { key: 'c2', label: '재단 치수', scope: 'order', must: false },
    ],
    assembly: [{ key: 'a1', label: '조립 확인', scope: 'order', must: true }],
  },
};

function tables() {
  return {
    companies: [
      { id: CO, kind: 'partner', plan: 'agent', status: 'active' },
      { id: CO2, kind: 'partner', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
      { user_id: MANAGER, company_id: CO, role: 'manager', status: 'active' },
      { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
      { user_id: OTHER, company_id: CO2, role: 'owner', status: 'active' },
    ],
    assistant_settings: [
      { company_id: CO, enabled: true },
      { company_id: CO2, enabled: true },
    ],
    consult_assignments: [
      { id: id('01', 1), company_id: CO, state: 'assigned', assigned_at: '2026-11-04T23:30:00Z' },
      { id: id('01', 2), company_id: CO, state: 'assigned', assigned_at: '2026-11-05T01:00:00Z' },
      { id: id('01', 3), company_id: CO, state: 'accepted', assigned_at: '2026-11-04T20:00:00Z' },
      { id: id('01', 4), company_id: CO2, state: 'assigned', assigned_at: '2026-11-04T22:00:00Z' },
    ],
    orders: [
      { id: O(1), company_id: CO, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', ordered_at: '2026-11-01T00:00:00Z' },
      { id: O(2), company_id: CO, order_no: 'SO-20261102-BBBB', status: 'confirmed', design_id: D(2), project_id: P(2), customer_name: '이고객', ordered_at: '2026-11-02T00:00:00Z' },
      { id: O(3), company_id: CO, order_no: 'SO-20261020-CCCC', status: 'cancelled', design_id: D(3), project_id: null, customer_name: '박고객', ordered_at: '2026-10-20T00:00:00Z' },
      { id: O(9), company_id: CO2, order_no: 'SO-20261101-ZZZZ', status: 'in_production', design_id: D(9), project_id: null, customer_name: '남의 고객', ordered_at: '2026-11-01T00:00:00Z' },
    ],
    order_payments: [
      { id: id('02', 1), order_id: O(1), stage: 'interim', amount: 300000, due_on: '2026-11-01', paid_on: null },
      { id: id('02', 2), order_id: O(2), stage: 'deposit', amount: 200000, due_on: '2026-11-05', paid_on: null },
      { id: id('02', 3), order_id: O(2), stage: 'balance', amount: 900000, due_on: '2026-11-20', paid_on: null },
      { id: id('02', 4), order_id: O(1), stage: 'deposit', amount: 100000, due_on: '2026-10-01', paid_on: '2026-10-01' },
      { id: id('02', 5), order_id: O(3), stage: 'balance', amount: 7, due_on: '2026-11-01', paid_on: null },
      { id: id('02', 6), order_id: O(9), stage: 'balance', amount: 8, due_on: '2026-11-01', paid_on: null },
    ],
    designs: [
      { id: D(1), company_id: CO, project_id: P(1) },
      { id: D(2), company_id: CO, project_id: P(2) },
      { id: D(3), company_id: CO, project_id: P(3) },
      { id: D(6), company_id: CO, project_id: P(6) },
      { id: D(9), company_id: CO2, project_id: null },
    ],
    design_schedules: [
      { id: id('03', 1), design_id: D(1), type: 'delivery', status: 'scheduled', scheduled_at: '2026-11-06T01:00:00Z' },
      { id: id('03', 2), design_id: D(2), type: 'installation', status: 'confirmed', scheduled_at: '2026-11-11T01:00:00Z' },
      { id: id('03', 3), design_id: D(2), type: 'installation', status: 'scheduled', scheduled_at: '2026-11-13T01:00:00Z' },
      { id: id('03', 4), design_id: D(1), type: 'delivery', status: 'cancelled', scheduled_at: '2026-11-07T01:00:00Z' },
      { id: id('03', 5), design_id: D(1), type: 'measurement', status: 'scheduled', scheduled_at: '2026-11-06T02:00:00Z' },
      { id: id('03', 6), design_id: D(9), type: 'delivery', status: 'scheduled', scheduled_at: '2026-11-06T01:00:00Z' },
      { id: id('03', 7), design_id: D(1), type: 'installation', status: 'scheduled', scheduled_at: '2026-11-04T05:00:00Z' },
    ],
    order_events: [
      { id: id('04', 1), company_id: CO, order_id: O(1), state: 'pending' },
      { id: id('04', 2), company_id: CO, order_id: O(2), state: 'done' },
      { id: id('04', 3), company_id: CO2, order_id: O(9), state: 'pending' },
    ],
    ledger_documents: [
      { id: id('05', 1), company_id: CO, review_status: 'pending' },
      { id: id('05', 2), company_id: CO, review_status: 'pending' },
      { id: id('05', 3), company_id: CO, review_status: 'posted' },
    ],
    ledger_notices: [
      { id: id('06', 1), company_id: CO, seen_at: null },
      { id: id('06', 2), company_id: CO, seen_at: '2026-11-04T00:00:00Z' },
    ],
    projects: [
      { id: P(1), company_id: CO, status: 'active', created_at: '2026-10-01T00:00:00Z' },
      { id: P(2), company_id: CO, status: 'active', created_at: '2026-10-02T00:00:00Z' },
      { id: P(3), company_id: CO, status: 'active', created_at: '2026-10-03T00:00:00Z' },
      { id: P(4), company_id: CO, status: 'active', created_at: '2026-10-04T00:00:00Z' },
      { id: P(5), company_id: CO, status: 'active', created_at: '2026-10-05T00:00:00Z' },
      { id: P(6), company_id: CO, status: 'active', created_at: '2026-10-06T00:00:00Z' },
      { id: P(7), company_id: CO, status: 'closed', created_at: '2026-10-07T00:00:00Z' },
    ],
    generations: [{ id: id('07', 1), project_id: P(5) }],
    design_documents: [
      { id: id('08', 1), design_id: D(6), doc_type: 'customer_confirmation', status: 'issued', rev: 1, superseded_by: null },
      { id: WO, design_id: D(1), doc_type: 'work_order', status: 'issued', rev: 1, superseded_by: null, snapshot_id: SNAP, render_payload: { check_list: CHECK_LIST } },
    ],
    design_snapshots: [{ id: SNAP, design_id: D(1), design_payload: { items: [] }, bom_payload: {} }],
    work_checks: [
      { document_id: WO, role: 'cut', scope_key: '', item_key: 'c1', checked: true, created_at: '2026-11-04T01:00:00Z' },
    ],
  };
}

const entitled = (name, body) => {
  if (name !== 'company_entitled') return undefined;
  return body.p_company === CO ? 'full' : 'none';
};

function world(t = tables()) {
  return createFake({
    tables: t,
    users: { t_owner: { id: OWNER }, t_manager: { id: MANAGER }, t_staff: { id: STAFF }, t_other: { id: OTHER }, t_nobody: { id: id('a9', 1) } },
    nowMs: AT,
    rpc: entitled,
  });
}

async function call(fake, token) {
  return withFake(fake, async () => {
    const res = await worker.fetch(new Request('https://api.test/brief/today', { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control') };
  });
}

// ── 순수 ─────────────────────────────────────────────────

test('역할마다 볼 것 — 대표는 모두, 실장은 요청 빼고, 직원은 일정만', () => {
  assert.deepEqual(briefKeysFor('owner').sort(), ['consults', 'notices', 'photos', 'receivables', 'requests', 'schedules']);
  assert.deepEqual(briefKeysFor('manager').sort(), ['consults', 'notices', 'photos', 'receivables', 'schedules']);
  assert.deepEqual(briefKeysFor('staff'), ['schedules']);
});

test('상담 · 수금 · 일정 셈 — 가장 이른 마감 24시간, 오늘 · 늦음 따로, 창 안 납품 · 설치만 이른 차례', () => {
  assert.deepEqual(consultsOf([{ assigned_at: '2026-11-05T01:00:00Z' }, { assigned_at: '2026-11-04T23:30:00Z' }]), {
    count: 2,
    next_deadline: '2026-11-05T23:30:00.000Z',
  });
  assert.deepEqual(consultsOf([]), { count: 0, next_deadline: null });
  assert.deepEqual(
    dueOf(
      [
        { amount: 300000, due_on: '2026-11-01', paid_on: null },
        { amount: 200000, due_on: '2026-11-05', paid_on: null },
        { amount: 900000, due_on: '2026-11-20', paid_on: null },
        { amount: 5, due_on: '2026-11-01', paid_on: '2026-11-02' },
      ],
      '2026-11-05',
    ),
    { count: 2, total: 500000, late_count: 1, late_total: 300000, today_count: 1, today_total: 200000 },
  );
  const range = { from: '2026-11-04T15:00:00.000Z', to: '2026-11-11T15:00:00.000Z' };
  const s = schedulesOf(
    [
      { type: 'installation', scheduled_at: '2026-11-11T01:00:00Z', status: 'confirmed', design_id: D(2) },
      { type: 'delivery', scheduled_at: '2026-11-06T01:00:00Z', status: 'scheduled', design_id: D(1) },
      { type: 'delivery', scheduled_at: '2026-11-11T15:00:00Z', status: 'scheduled', design_id: D(1) },
      { type: 'measurement', scheduled_at: '2026-11-06T02:00:00Z', status: 'scheduled', design_id: D(1) },
    ],
    range,
    (d) => (d === D(1) ? 'SO-1' : null),
  );
  assert.deepEqual(s, {
    count: 2,
    items: [
      { type: 'delivery', at: '2026-11-06T01:00:00Z', status: 'scheduled', order_no: 'SO-1' },
      { type: 'installation', at: '2026-11-11T01:00:00Z', status: 'confirmed', order_no: null },
    ],
  });
});

test('단계 현황 — 수주 없는 프로젝트만 단계로 (견적 > 설계 > 연출 > 상담), 수주는 상태별', () => {
  const st = stagesOf({
    projects: [{ id: P(1) }, { id: P(3) }, { id: P(4) }, { id: P(5) }, { id: P(6) }],
    projectOrders: [{ project_id: P(1), status: 'in_production' }],
    designs: [{ project_id: P(3) }, { project_id: P(6) }],
    quotes: [{ designs: { project_id: P(6) } }],
    renders: [{ project_id: P(5) }, { project_id: P(3) }],
    orders: [{ status: 'confirmed' }, { status: 'in_production' }, { status: 'in_production' }, { status: 'delivered' }],
  });
  assert.deepEqual(st, {
    projects: { consult: 1, render: 1, design: 1, quote: 1 },
    orders: { confirmed: 1, in_production: 2, delivered: 1 },
  });
});

test('한 사람 몫 — 역할에 없는 볼 것은 null, 수는 볼 것만 더한다 (현황은 빼고)', () => {
  const data = {
    consults: { count: 2 },
    receivables: { count: 2 },
    schedules: { count: 3 },
    requests: { count: 1 },
    photos: { count: 4 },
    notices: null,
    stages: { projects: {}, orders: {} },
  };
  assert.equal(briefFor(data, 'owner').count, 12);
  assert.equal(briefFor(data, 'manager').count, 11);
  const staff = briefFor(data, 'staff');
  assert.equal(staff.count, 3);
  assert.equal(staff.money, false);
  assert.deepEqual(Object.entries(staff.items).filter(([, v]) => v).map(([k]) => k), ['schedules']);
});

test('cron 분 — 08:00 부터 BRIEF_MINUTES 분, 업체마다 id 로 정한 분 하나', () => {
  assert.equal(briefSlot(kst('2026-11-05T08:00:00')), 0);
  assert.equal(briefSlot(kst('2026-11-05T08:09:00')), 9);
  assert.equal(briefSlot(kst('2026-11-05T08:10:00')), null);
  assert.equal(briefSlot(kst('2026-11-05T07:59:00')), null);
  assert.equal(BRIEF_MINUTES, 10);
  assert.equal(slotOf(CO), 2);
  assert.equal(slotOf('00000009-0000-4000-8000-000000000000'), 9);
});

test('알림 글 — 수 하나만, 비서 탭으로, 999 넘으면 「넘게」, 0 이면 없음', () => {
  const m = buildMessage('assistant_brief', { count: 10 });
  assert.deepEqual(m, { title: '오늘 브리핑', body: '오늘 볼 것이 10건 있습니다. 비서 탭에서 확인해 주세요.', url: '/segan/assistant.html' });
  assert.ok(isValidMessage(m));
  assert.match(buildMessage('assistant_brief', { count: 1200 }).body, /999건 넘게/);
  assert.equal(buildMessage('assistant_brief', { count: 0 }), null);
});

// ── 주소 ─────────────────────────────────────────────────

test('GET /brief/today — 대표: 볼 것 모두 · 단계 현황 · 작업 진행, 그 업체 것만, 고객 이름 없음, 캐시 없음', async () => {
  const r = await call(world(), 't_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.cache, 'no-store, private');
  const d = r.json.data;
  assert.equal(d.date, '2026-11-05');
  assert.equal(d.role, 'owner');
  assert.equal(d.money, true);
  assert.deepEqual(d.items.consults, { count: 2, next_deadline: '2026-11-05T23:30:00.000Z' });
  assert.deepEqual(d.items.receivables, { count: 2, total: 500000, late_count: 1, late_total: 300000, today_count: 1, today_total: 200000 });
  assert.deepEqual(d.items.schedules, {
    count: 2,
    items: [
      { type: 'delivery', at: '2026-11-06T01:00:00Z', status: 'scheduled', order_no: 'SO-20261101-AAAA' },
      { type: 'installation', at: '2026-11-11T01:00:00Z', status: 'confirmed', order_no: 'SO-20261102-BBBB' },
    ],
  });
  assert.deepEqual(d.items.requests, { count: 1 });
  assert.deepEqual(d.items.photos, { count: 2 });
  assert.deepEqual(d.items.notices, { count: 1 });
  assert.equal(d.count, 10);
  assert.deepEqual(d.stages, {
    projects: { consult: 1, render: 1, design: 1, quote: 1 },
    orders: { confirmed: 1, in_production: 1, delivered: 0 },
  });
  assert.deepEqual(d.work, [
    {
      order_no: 'SO-20261101-AAAA',
      status: 'in_production',
      roles: { cut: { done: 1, total: 2, must_left: 0 }, edge: null, assembly: { done: 0, total: 1, must_left: 1 }, install: null },
    },
  ]);
  const text = JSON.stringify(d);
  for (const name of ['김고객', '이고객', '남의 고객']) assert.ok(!text.includes(name), name);
});

test('GET /brief/today — 실장은 요청 없이, 직원은 일정 · 현황만 (돈 · 상담 · 회계 칸을 읽지도 않는다)', async () => {
  const m = await call(world(), 't_manager');
  assert.equal(m.status, 200);
  assert.equal(m.json.data.items.requests, null);
  assert.equal(m.json.data.count, 9);

  const fake = world();
  const s = await call(fake, 't_staff');
  assert.equal(s.status, 200);
  const d = s.json.data;
  assert.equal(d.money, false);
  assert.equal(d.count, 2);
  for (const k of ['consults', 'receivables', 'requests', 'photos', 'notices']) assert.equal(d.items[k], null, k);
  assert.ok(d.stages && Array.isArray(d.work));
  const read = new Set(fake.calls.rest.map((c) => c.path));
  for (const t of ['consult_assignments', 'order_payments', 'order_events', 'ledger_documents', 'ledger_notices']) assert.ok(!read.has(t), t);
});

test('GET /brief/today — 비서 자격이 없는 업체는 403 not_entitled, 구성원이 아니면 not_member', async () => {
  const a = await call(world(), 't_other');
  assert.equal(a.status, 403);
  assert.equal(a.json.code, 'not_entitled');
  const b = await call(world(), 't_nobody');
  assert.equal(b.status, 403);
  assert.equal(b.json.code, 'not_member');
});

// ── 매분 cron ───────────────────────────────────────────

test('cron — 그 업체의 분에 볼 것이 있는 사람마다 「오늘 볼 것 N건」, 하루 한 번, 자격 없는 업체 · 다른 분은 아무것도', async () => {
  const fake = world();
  const out = await withFake(fake, () => runMorningBrief(ENV, { nowMs: AT }));
  assert.deepEqual(out, { companies: 1, sent: 3 });
  const box = fake.db.notification_outbox;
  assert.deepEqual(
    box.map((r) => [r.user_id, r.kind, r.body]).sort(),
    [
      [OWNER, 'assistant_brief', '오늘 볼 것이 10건 있습니다. 비서 탭에서 확인해 주세요.'],
      [MANAGER, 'assistant_brief', '오늘 볼 것이 9건 있습니다. 비서 탭에서 확인해 주세요.'],
      [STAFF, 'assistant_brief', '오늘 볼 것이 2건 있습니다. 비서 탭에서 확인해 주세요.'],
    ].sort(),
  );
  assert.ok(box.every((r) => r.company_id === CO && r.url === '/segan/assistant.html' && r.dedupe_key === `assistant_brief:${CO}:${r.user_id}:d20261105`));
  // 알림은 작업 진행 · 단계 현황을 읽지 않는다
  assert.ok(!fake.calls.rest.some((c) => ['work_checks', 'design_snapshots', 'projects'].includes(c.path)));

  await withFake(fake, () => runMorningBrief(ENV, { nowMs: AT + 30 * 1000 }));
  assert.equal(fake.db.notification_outbox.length, 3);
  assert.deepEqual(await withFake(fake, () => runMorningBrief(ENV, { nowMs: kst('2026-11-05T08:03:00') })), { companies: 0, sent: 0 });
  assert.deepEqual(await withFake(fake, () => runMorningBrief(ENV, { nowMs: kst('2026-11-05T14:02:00') })), { skipped: 'not_now' });
  assert.equal(fake.db.notification_outbox.length, 3);
});

test('cron — 볼 것이 0 인 사람에게는 보내지 않는다 (직원은 일정이 없으면 안 받는다)', async () => {
  const t = tables();
  t.design_schedules = [];
  const fake = world(t);
  const out = await withFake(fake, () => runMorningBrief(ENV, { nowMs: AT }));
  assert.equal(out.sent, 2);
  assert.ok(!fake.db.notification_outbox.some((r) => r.user_id === STAFF));
});
