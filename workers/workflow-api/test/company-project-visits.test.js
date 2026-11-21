/**
 * 프로젝트 방문 일정 — 실측 (src/company-project-visits.js · DB 0079).
 * 2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 2차 — 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」.
 *
 * 고정하는 것
 *   1) DB 0079 전 — 목록은 visit_ready false · 다음 할 일은 지금처럼 「설계 시작」, 실측 길은 409 db_pending
 *   2) 흐름 — 실측 일정 잡기 → 날짜 바꾸기 → 완료 처리 → 그제야 「설계 시작」. 재실측 · 취소
 *   3) 누가 — 대표 · 실장 · 그 프로젝트의 담당자. 진행 중인 프로젝트만. 남의 업체는 404
 *   4) 검사 — 날짜 · 갈 사람(이 팩토리 구성원) · 글자 수
 *   5) 예정은 프로젝트에 하나 — 그 사이 다른 사람이 잡았으면 409 stale
 *   6) 일지에는 id · 종류 값만 — 날짜 · 메모 · 갈 사람 글이 들어가지 않는다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js (실측 표의 유니크 · 때 찍기를 흉내 낸다). 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  VISIT_KIND,
  VISIT_NAME_MAX,
  VISIT_NOTE_MAX,
  canVisit,
  visitOf,
} from '../src/company-project-visits.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A = cid(1);
const B = cid(2);
const OWNER = uid(11);
const MANAGER = uid(12);
const STAFF = uid(13); // P1 의 담당자
const STAFF2 = uid(14);
const OWNER_B = uid(21);
const CUS = rid(1);
const P1 = rid(11); // 진행 중 · 담당 STAFF · 설계 없음
const P2 = rid(12); // 진행 중 · 플래너 초안이 있다 (이미 설계 단계)
const P3 = rid(13); // 보류
const PB = rid(15); // 남의 업체

const FAR = '2099-01-05T05:00:00.000Z'; // 한참 뒤 — 실측 예정
const PAST = '2020-01-05T05:00:00.000Z'; // 지난 날 — 완료 처리가 뜬다

function tables({ visits = true } = {}) {
  const project = (id, extra = {}) => ({
    id,
    company_id: A,
    customer_id: CUS,
    title: '예시',
    status: 'active',
    created_at: '2026-11-01T00:00:00Z',
    assignee_id: null,
    hold_until: null,
    status_note: null,
    status_at: null,
    ...extra,
  });
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    profiles: [
      { id: OWNER, name: '가대표' },
      { id: STAFF, name: '나직원' },
    ],
    customers: [{ id: CUS, company_id: A, name: '김고객', phone: '010-1111-2222' }],
    projects: [
      project(P1, { assignee_id: STAFF }),
      project(P2),
      project(P3, { status: 'on_hold' }),
      project(PB, { company_id: B }),
    ],
    planner_drafts: [
      {
        company_id: A,
        id: 'd-test-0001',
        created_by: OWNER,
        updated_at: '2026-11-10T00:00:00Z',
        discarded_at: null,
        summary: { projectId: P2 },
      },
    ],
    project_events: [],
    ...(visits ? { project_visits: [] } : {}),
  };
}

const call = (fake, path, token, opts) => callWorker(worker, fake, path, token, opts);
const put = (fake, id, body, token = OWNER) =>
  call(fake, `/company/projects/${id}/visit`, token, { method: 'PUT', body });
const patch = (fake, id, body, token = OWNER) =>
  call(fake, `/company/projects/${id}/visit`, token, { method: 'PATCH', body });
async function rowOf(fake, id, token = OWNER) {
  const r = await call(fake, '/company/projects', token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { data: r.json.data, row: r.json.data.items.find((p) => p.id === id) };
}

test('이름 · 순수 — 종류는 실측 하나 · 글자 수 · 누가 할 수 있나 · 갈 사람 이름', () => {
  assert.deepEqual([VISIT_KIND, VISIT_NAME_MAX, VISIT_NOTE_MAX], ['measure', 50, 200]);
  const p = { assignee_id: STAFF };
  assert.deepEqual(
    [
      canVisit(p, { role: 'owner', user_id: OWNER }),
      canVisit(p, { role: 'manager', user_id: MANAGER }),
      canVisit(p, { role: 'staff', user_id: STAFF }),
      canVisit(p, { role: 'staff', user_id: STAFF2 }),
      canVisit({ assignee_id: null }, { role: 'staff', user_id: null }),
    ],
    [true, true, true, false, false]
  );
  const row = { id: 'v', status: 'scheduled', scheduled_at: FAR, assignee_id: STAFF, assignee_name: null, note: null };
  const memberOf = new Map([[STAFF, { name: '나직원' }]]);
  assert.deepEqual(visitOf(row, memberOf), {
    id: 'v',
    status: 'scheduled',
    scheduled_at: FAR,
    assignee_id: STAFF,
    assignee_name: '나직원',
    note: null,
    done_at: null,
  });
  // 구성원이 아닌 사람은 적어 둔 글 그대로, 나간 구성원이면 이름 없이
  assert.equal(visitOf({ ...row, assignee_id: null, assignee_name: '박기사' }, memberOf).assignee_name, '박기사');
  assert.equal(visitOf({ ...row, assignee_id: STAFF2 }, memberOf).assignee_name, null);
  assert.equal(visitOf(null), null);
});

test('DB 0079 전 — 목록은 visit_ready false · 다음 할 일은 지금처럼 설계 시작, 실측 길은 409 db_pending', async () => {
  const fake = createFake({ tables: tables({ visits: false }) });
  const { data, row } = await rowOf(fake, P1);
  assert.equal(data.visit_ready, false);
  assert.deepEqual([row.step, row.next.key], ['consult', 'design_start']);
  assert.equal('visit' in row, false);
  const r = await put(fake, P1, { scheduled_at: FAR });
  assert.deepEqual([r.status, r.json.code], [409, 'db_pending']);
  const d = await patch(fake, P1, { status: 'done' });
  assert.deepEqual([d.status, d.json.code], [409, 'db_pending']);
});

test('흐름 — 실측 일정 잡기 → 날짜 바꾸기 → 완료 처리 → 그제야 설계 시작. 재실측 · 취소', async () => {
  const fake = createFake({ tables: tables() });
  // 0) 실측 날이 없다 — 「실측 일정 잡기」. 이미 초안이 있는 프로젝트는 그대로 설계 단계
  let { data, row } = await rowOf(fake, P1);
  assert.equal(data.visit_ready, true);
  assert.deepEqual([row.step, row.next.key, row.next.go, row.next.allowed, row.visit], ['consult', 'measure_plan', 'visit', true, null]);
  const p2 = data.items.find((p) => p.id === P2);
  assert.deepEqual([p2.step, p2.next.key], ['design', 'design']);

  // 1) 담당자가 잡는다 — 갈 사람은 구성원, 메모
  const made = await put(fake, P1, { scheduled_at: '2099-01-05T14:00:00+09:00', assignee_id: STAFF, note: ' 현관 비밀번호 1234 ' }, STAFF);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const v1 = made.json.data.visit;
  assert.deepEqual(made.json.data, {
    project_id: P1,
    visit: { id: v1.id, status: 'scheduled', scheduled_at: FAR, assignee_id: STAFF, assignee_name: '나직원', note: '현관 비밀번호 1234', done_at: null },
  });
  assert.deepEqual(
    fake.db.project_visits.map((v) => [v.company_id, v.project_id, v.kind, v.status, v.created_by]),
    [[A, P1, 'measure', 'scheduled', STAFF]]
  );
  ({ row } = await rowOf(fake, P1));
  assert.deepEqual([row.step, row.next.key, row.next.wait, row.next.at], ['measure', 'measure_wait', true, FAR]);
  assert.deepEqual(row.visit, v1);

  // 2) 대표가 고친다 — 같은 줄, 날짜를 지난 날로 · 갈 사람은 글로 (적지 않은 메모는 비운다)
  const moved = await put(fake, P1, { scheduled_at: PAST, assignee_name: ' 박기사 ' });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.deepEqual(moved.json.data.visit, { id: v1.id, status: 'scheduled', scheduled_at: PAST, assignee_id: null, assignee_name: '박기사', note: null, done_at: null });
  assert.equal(fake.db.project_visits.length, 1);
  // 날이 됐다 — 「실측 완료 처리」. 담당자가 아닌 직원에게는 allowed false
  ({ row } = await rowOf(fake, P1));
  assert.deepEqual([row.step, row.next.key, row.next.act, row.next.allowed], ['measure', 'measure_done', { kind: 'visit_done' }, true]);
  assert.equal((await rowOf(fake, P1, STAFF2)).row.next.allowed, false);
  assert.equal((await rowOf(fake, P1, STAFF)).row.next.allowed, true);

  // 3) 끝낸다 — 그제야 「설계 시작」(플래너가 이 프로젝트로 열린다). 단계는 실측 그대로
  const done = await patch(fake, P1, { status: 'done' }, STAFF);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual([done.json.data.visit.status, !!done.json.data.visit.done_at], ['done', true]);
  assert.equal(fake.db.project_visits[0].done_by, STAFF);
  ({ row } = await rowOf(fake, P1, STAFF2));
  assert.deepEqual([row.step, row.next.key, row.next.go, row.next.allowed], ['measure', 'design_start', `planner?project=${P1}`, true]);
  assert.equal(row.visit.status, 'done');
  // 끝난 뒤 또 끝내기 — 예정인 실측이 없다
  const twice = await patch(fake, P1, { status: 'done' });
  assert.deepEqual([twice.status, twice.json.code], [409, 'no_visit']);

  // 4) 재실측 — 새 줄. 예정인 것이 먼저 보이고, 취소하면 끝낸 실측으로 돌아가 다시 「설계 시작」
  const again = await put(fake, P1, { scheduled_at: FAR });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.notEqual(again.json.data.visit.id, v1.id);
  ({ row } = await rowOf(fake, P1));
  assert.deepEqual([row.next.key, row.visit.id], ['measure_wait', again.json.data.visit.id]);
  const off = await patch(fake, P1, { status: 'cancelled' });
  assert.deepEqual([off.status, off.json.data.visit], [200, null]);
  ({ row } = await rowOf(fake, P1));
  assert.deepEqual([row.step, row.next.key, row.visit.id], ['measure', 'design_start', v1.id]);

  // 일지 — 잡음 · 날짜 바꿈 · 끝 · 잡음 · 취소. id 와 종류 값만 (날짜 · 메모 · 갈 사람 글 없음)
  assert.deepEqual(
    fake.db.project_events.map((e) => [e.type, e.actor_user_id, e.subject_type, e.subject_id, e.to_status || null, e.payload]),
    [
      ['schedule_added', STAFF, 'visit', v1.id, null, { type: 'measurement' }],
      ['schedule_changed', OWNER, 'visit', v1.id, null, { type: 'measurement', moved: true }],
      ['measure_done', STAFF, 'visit', v1.id, 'done', {}],
      ['schedule_added', OWNER, 'visit', again.json.data.visit.id, null, { type: 'measurement' }],
      ['schedule_changed', OWNER, 'visit', again.json.data.visit.id, 'cancelled', { type: 'measurement' }],
    ]
  );
  const log = JSON.stringify(fake.db.project_events);
  for (const no of ['1234', '박기사', '2099', '2020-01']) assert.equal(log.includes(no), false, no);

  // 프로젝트 창 — 「일어난 일」에 실측 줄이 누가와 함께, 프로젝트 줄에 실측 칸
  const sheet = await call(fake, `/company/projects/${P1}`, OWNER);
  assert.equal(sheet.status, 200, JSON.stringify(sheet.json));
  assert.equal(sheet.json.data.project.visit.id, v1.id);
  const told = sheet.json.data.history
    .filter((h) => /실측/.test(h.label))
    .map((h) => [h.label, h.who && h.who.name]);
  assert.deepEqual(told.map((t) => t[0]).sort(), [
    '실측 일정을 바꿨습니다',
    '실측 일정을 잡았습니다',
    '실측 일정을 잡았습니다',
    '실측 일정을 취소했습니다',
    '실측을 끝냈습니다',
  ]);
  assert.deepEqual(told.find((t) => t[0] === '실측을 끝냈습니다'), ['실측을 끝냈습니다', '나직원']);
});

test('누가 · 어느 프로젝트 — 담당자가 아닌 직원은 403, 남의 업체는 404, 보류는 409 not_active, 예정이 없으면 409 no_visit', async () => {
  const fake = createFake({ tables: tables() });
  const staff2 = await put(fake, P1, { scheduled_at: FAR }, STAFF2);
  assert.deepEqual([staff2.status, staff2.json.code], [403, 'not_allowed']);
  assert.equal((await put(fake, P1, { scheduled_at: FAR }, MANAGER)).status, 200);
  const staffDone = await patch(fake, P1, { status: 'done' }, STAFF2);
  assert.deepEqual([staffDone.status, staffDone.json.code], [403, 'not_allowed']);
  // 남의 업체 프로젝트 · 없는 프로젝트 · 틀린 번호
  assert.equal((await put(fake, PB, { scheduled_at: FAR })).status, 404);
  assert.equal((await put(fake, rid(999), { scheduled_at: FAR })).status, 404);
  assert.equal((await put(fake, 'nope', { scheduled_at: FAR })).status, 404);
  assert.equal((await put(fake, P1, { scheduled_at: FAR }, OWNER_B)).status, 404);
  // 보류한 프로젝트
  const held = await put(fake, P3, { scheduled_at: FAR });
  assert.deepEqual([held.status, held.json.code], [409, 'not_active']);
  // 예정인 실측이 없는 프로젝트를 끝내려 함 · 설계가 있는 프로젝트도 실측은 잡을 수 있다(막지 않는다)
  const none = await patch(fake, P2, { status: 'done' });
  assert.deepEqual([none.status, none.json.code], [409, 'no_visit']);
  assert.equal((await put(fake, P2, { scheduled_at: FAR })).status, 200);
  assert.equal((await rowOf(fake, P2)).row.step, 'design', '설계가 있으면 단계는 그대로 설계');
  assert.equal(fake.db.project_visits.length, 2);
});

test('검사 — 날짜 · 갈 사람(이 팩토리 구성원) · 글자 수 · 상태 값은 422, 아무것도 넣지 않는다', async () => {
  const fake = createFake({ tables: tables() });
  const bad = async (body, field) => {
    const r = await put(fake, P1, body);
    assert.equal(r.status, 422, JSON.stringify([body, r.json]));
    if (field) assert.equal(r.json.details && r.json.details.field, field);
  };
  await bad({}, 'scheduled_at');
  await bad({ scheduled_at: '내일' }, 'scheduled_at');
  await bad({ scheduled_at: 20261125 }, 'scheduled_at');
  await bad({ scheduled_at: FAR, assignee_id: 'x' }, 'assignee_id');
  await bad({ scheduled_at: FAR, assignee_id: OWNER_B }, 'assignee_id'); // 남의 업체 사람
  await bad({ scheduled_at: FAR, assignee_name: '가'.repeat(VISIT_NAME_MAX + 1) }, 'assignee_name');
  await bad({ scheduled_at: FAR, note: '가'.repeat(VISIT_NOTE_MAX + 1) }, 'note');
  await bad({ scheduled_at: FAR, note: 7 }, 'note');
  for (const body of [{}, { status: 'scheduled' }, { status: 'paused' }]) {
    const r = await patch(fake, P1, body);
    assert.equal(r.status, 422, JSON.stringify(r.json));
  }
  assert.equal(fake.db.project_visits.length, 0);
  assert.equal(fake.db.project_events.length, 0);
  // 글자 수 끝 값은 된다
  const ok = await put(fake, P1, { scheduled_at: FAR, assignee_name: '가'.repeat(VISIT_NAME_MAX), note: '나'.repeat(VISIT_NOTE_MAX) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('예정은 프로젝트에 하나 — 그 사이 다른 사람이 잡았으면 409 stale (줄이 둘이 되지 않는다)', async () => {
  let hide = false;
  const fake = createFake({
    tables: tables(),
    // 내가 「예정 없음」을 읽은 직후 다른 사람이 먼저 넣은 것처럼 — 읽기에만 빈 목록을 준다
    before: (method, table, params) =>
      hide && method === 'GET' && table === 'project_visits' && params.get('status') === 'eq.scheduled'
        ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        : null,
  });
  assert.equal((await put(fake, P1, { scheduled_at: FAR }, MANAGER)).status, 200);
  hide = true;
  const r = await put(fake, P1, { scheduled_at: PAST });
  assert.deepEqual([r.status, r.json.code], [409, 'stale']);
  assert.deepEqual(fake.db.project_visits.map((v) => v.scheduled_at), [FAR]);
});
