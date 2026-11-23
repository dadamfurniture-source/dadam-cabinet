/**
 * 머문 날 — 느림 · 멈춤 (src/project-stay.js)
 * 2026-11-23 대표님 답 「상담 2/7 실측 2/7 설계 3/7 견적 3/7 계약 3/7 (느림/멈춤 일)」 · 생산 · 설치는 잡은 날이 지나면 멈춤.
 *
 * 고정하는 것
 *   1) 목록 줄 · 프로젝트 한 건 · 대시보드가 같은 판정을 쓴다 (줄의 stay 와 대시보드의 막대가 같은 수)
 *   2) 진행 중이고 단계를 아는 줄에만 stay 를 싣는다 — 보류 · 끝난 줄에는 없다
 *   3) 생산 · 설치는 잡아 둔 제작 완료일 · 설치일이 지났는데 끝내지 않았을 때만 멈춤
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { STAY_STEPS, STUCK_DAYS, lateProjects, stayRow } from '../src/project-stay.js';
import { DASH_STEPS, STUCK_DAYS as DASH_DAYS, dashboardOf } from '../src/company-dashboard.js';
import { createFake, callWorker, writesOf } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (d, h = 0) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const TODAY = '2026-11-23';
const NOW = Date.parse(at(23, 3));

// 워커는 「오늘」을 실제 시계(Date.now)로 잰다 — 시계를 NOW 에 세워 둔다. 세우지 않으면 날짜가 바뀌는 순간 날수가 달라져 시험이 틀린다
// (2026-11-24 에 실제로 그랬다: 상담 0일이 1일로). 가짜 Supabase 의 nowMs 는 DB 의 now() 일 뿐이다.
const realNow = Date.now;
before(() => {
  Date.now = () => NOW;
});
after(() => {
  Date.now = realNow;
});

test('대시보드와 같은 값을 쓴다 — 단계 · 날수', () => {
  assert.equal(DASH_STEPS, STAY_STEPS);
  assert.equal(DASH_DAYS, STUCK_DAYS);
});

test('stayRow — 진행 중이고 재는 단계일 때만 { days, state }', () => {
  const ctx = { today: TODAY };
  assert.deepEqual(stayRow({ id: 'a', status: 'active', step: 'consult', created_at: at(21) }, ctx), { days: 2, state: 'slow' });
  assert.deepEqual(stayRow({ id: 'a', step: 'consult', created_at: at(23) }, ctx), { days: 0, state: 'fresh' });
  assert.deepEqual(stayRow({ id: 'a', status: 'active', step: 'make' }, { today: TODAY, lateMake: new Set(['a']) }), { days: null, state: 'stuck' });
  assert.equal(stayRow({ id: 'a', status: 'on_hold', step: 'consult', created_at: at(1) }, ctx), null);
  assert.equal(stayRow({ id: 'a', status: 'active', step: 'done', created_at: at(1) }, ctx), null);
  assert.equal(stayRow({ id: 'a', status: 'active', created_at: at(1) }, ctx), null);
  assert.equal(stayRow(null, ctx), null);
});

test('lateProjects — 날이 지났는데 끝내지 않은 일정만 (취소 · 끝난 것 · 오늘 것은 아니다)', () => {
  const s = (project_id, type, day, over = {}) => ({ project_id, type, status: 'scheduled', scheduled_at: at(day), completed_at: null, ...over });
  const rows = [
    s('late', 'installation', 20),
    s('today', 'installation', 23, { scheduled_at: at(23, 1) }),
    s('done', 'installation', 20, { completed_at: at(20, 5) }),
    s('cancelled', 'installation', 20, { status: 'cancelled' }),
    s('make', 'manufacturing_end', 20),
    { type: 'installation', status: 'scheduled', scheduled_at: at(19), completed_at: null, designs: { project_id: 'joined' } },
  ];
  assert.deepEqual([...lateProjects(rows, 'installation', TODAY)].sort(), ['joined', 'late']);
  assert.deepEqual([...lateProjects(rows, 'manufacturing_end', TODAY)], ['make']);
});

test('대시보드 — 줄에 실린 stay 가 있으면 그것으로 센다', () => {
  const out = dashboardOf(
    {
      items: [
        // 만든 지 오래됐지만 목록이 「여유」라고 판정해 실었다 → 그대로 센다
        { id: 'a', status: 'active', step: 'consult', created_at: at(1), stay: { days: 0, state: 'fresh' } },
        { id: 'b', status: 'active', step: 'consult', created_at: at(1) },
      ],
    },
    TODAY
  );
  const consult = out.steps.find((s) => s.key === 'consult');
  assert.deepEqual([consult.count, consult.fresh, consult.stuck], [2, 1, 1]);
});

// ── 목록 · 한 건 (워커) ───────────────────────────────────────

const A = cid(1);
const OWNER = uid(11);
const P_NEW = rid(1); // 상담 — 오늘 만든 것
const P_OLD = rid(2); // 상담 — 9일 전
const P_HELD = rid(3); // 보류
const P_MAKE = rid(4); // 생산 — 제작 완료 예정일이 지났다
const P_PACT = rid(5); // 계약 — 4일 전에 만든 수주, 계약금 전
const D_MAKE = rid(14);
const D_PACT = rid(15);
const O_MAKE = rid(24);
const O_PACT = rid(25);

function tables({ schedules = true } = {}) {
  const project = (id, title, day, extra = {}) => ({ id, company_id: A, customer_id: null, title, status: 'active', created_at: at(day), ...extra });
  return {
    companies: [{ id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' }],
    company_members: [{ company_id: A, user_id: OWNER, role: 'owner', status: 'active' }],
    profiles: [{ id: OWNER, name: '가대표' }],
    projects: [
      project(P_NEW, '새 상담', 23),
      project(P_OLD, '묵은 상담', 14),
      project(P_HELD, '보류한 것', 1, { status: 'on_hold' }),
      project(P_MAKE, '생산 중', 2),
      project(P_PACT, '계약', 3),
    ],
    designs: [
      { id: D_MAKE, company_id: A, project_id: P_MAKE, name: '주방', created_at: at(3), updated_at: at(3) },
      { id: D_PACT, company_id: A, project_id: P_PACT, name: '신발장', created_at: at(4), updated_at: at(4) },
    ],
    orders: [
      { id: O_MAKE, company_id: A, project_id: P_MAKE, design_id: D_MAKE, order_no: 'A-1', status: 'in_production', ordered_at: at(5), created_at: at(5) },
      { id: O_PACT, company_id: A, project_id: P_PACT, design_id: D_PACT, order_no: 'A-2', status: 'confirmed', ordered_at: at(19), created_at: at(19) },
    ],
    order_payments: [{ order_id: O_PACT, stage: 'deposit', amount: 1, due_on: '2026-11-30', paid_on: null }],
    ...(schedules
      ? {
          design_schedules: [
            { id: rid(31), design_id: D_MAKE, type: 'manufacturing_end', status: 'scheduled', scheduled_at: at(20), completed_at: null },
            { id: rid(32), design_id: D_PACT, type: 'installation', status: 'scheduled', scheduled_at: at(1), completed_at: null },
          ],
        }
      : {}),
  };
}

test('목록 — 진행 중인 줄에 stay: 상담 날수 · 계약은 수주를 만든 날부터 · 생산은 잡은 날이 지나면 멈춤. 보류 줄에는 없다', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW });
  const r = await callWorker(worker, fake, '/company/projects', OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const by = Object.fromEntries(r.json.data.items.map((p) => [p.id, p]));
  assert.deepEqual(by[P_NEW].stay, { days: 0, state: 'fresh' });
  assert.deepEqual(by[P_OLD].stay, { days: 9, state: 'stuck' });
  assert.equal('stay' in by[P_HELD], false);
  assert.deepEqual([by[P_MAKE].step, by[P_MAKE].stay], ['make', { days: null, state: 'stuck' }]);
  // 계약 — 프로젝트는 20일 전에 만들었지만 수주는 4일 전
  assert.deepEqual([by[P_PACT].step, by[P_PACT].stay], ['contract', { days: 4, state: 'slow' }]);
  // 일정은 생산 · 설치 단계 프로젝트의 설계로만 묻는다 (계약 단계 설계의 지난 설치 일정은 읽지 않는다)
  const asked = fake.calls.filter((c) => c.table === 'design_schedules');
  assert.equal(asked.length, 1);
  assert.deepEqual(writesOf(fake), []);
});

test('목록 — 일정을 못 읽어도 줄은 그대로 준다 (생산 줄은 여유로)', async () => {
  const fake = createFake({ tables: tables({ schedules: false }), nowMs: NOW });
  const r = await callWorker(worker, fake, '/company/projects', OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const make = r.json.data.items.find((p) => p.id === P_MAKE);
  assert.deepEqual(make.stay, { days: null, state: 'fresh' });
  assert.equal(r.json.data.items.length, 5);
});

test('프로젝트 한 건 — project 는 목록의 그 줄과 같다 (stay 포함)', async () => {
  const fake = createFake({ tables: { ...tables(), project_events: [] }, nowMs: NOW });
  const list = await callWorker(worker, fake, '/company/projects', OWNER);
  for (const id of [P_OLD, P_MAKE, P_PACT, P_HELD]) {
    const one = await callWorker(worker, fake, `/company/projects/${id}`, OWNER);
    assert.equal(one.status, 200, JSON.stringify(one.json));
    assert.deepEqual(one.json.data.project, list.json.data.items.find((p) => p.id === id), id);
  }
});
