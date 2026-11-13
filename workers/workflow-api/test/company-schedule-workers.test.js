/**
 * 일정 줄에서 작업자 배정 (src/work/schedule-link.js · schedule-names.js) — 2026-11-13 「작업자 한 길」, DB 0064.
 *   GET|POST /company/schedules/:id/workers · POST /company/work/assignments/:id/accept|revision|remove
 *   + 작업자의 답 · 보고가 팩토리 대표 · 실장에게 가는 알림, 일정 ↔ 작업 시각 · 취소 맞추기, 설치 · A/S 표의 workers
 *
 *   - 설치 · A/S 방문 일정에만. 일정 하나에 작업 하나 (지정 방식 — 모집 목록에 뜨지 않는다), 제목은 일정 종류 이름뿐
 *   - 고를 수 있는 사람 = 내 팩토리와 연결이 승인됨 + 계정 승인 + 종류 맞음. 작업자를 가리키는 값은 연결 id
 *   - 배정 → 수락 대기 → 작업자가 수락해야 확정. 담당 글(assignee_name)은 배정된 작업자 이름
 *   - 다른 팩토리의 일정 · 연결 · 배정은 404
 * 가짜 Supabase 는 test/helpers/push-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { ASSIGNMENT_LABEL, ASSIGN_MAX, SCHEDULE_JOB_KIND, jobTimesOf } from '../src/work/schedule-link.js';
import { ASSIGNEE_NAME_MAX, assigneeNameOf } from '../src/work/schedule-names.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service', PUBLIC_BASE_URL: 'https://app.test' };
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const C = (i) => id('c0', i);
const U = (i) => id('a0', i);
const W = (i) => id('b0', i);
const L = (i) => id('d0', i);
const D = (i) => id('0d', i);
const S = (i) => id('05', i);
const O = (i) => id('0a', i);
const AS = (i) => id('07', i);
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-13T12:00:00');

const HQ = C(100);
const A = C(1);
const B = C(2);
const E = C(3);
const OWNER_A = U(11);
const MANAGER_A = U(12);
const STAFF_A = U(13);
const OWNER_B = U(21);
const OWNER_E = U(31);
const U_W1 = U(101);
const U_W2 = U(102);
const PHONE = '010-0000-0001';
const ADDR = '시험시 시험구 시험로 1';

const person = (n, status = 'approved', kinds = ['install']) => ({
  id: W(n), user_id: U(100 + n), display_name: `시험기사${n}`, phone: PHONE, kinds, region_label: '시험시 시험구', status,
});
const link = (n, company_id, worker_id, status = 'approved', kinds = ['install']) => ({
  id: L(n), company_id, worker_id, status, kinds, via: 'invite', created_at: iso(`2026-11-0${n}T09:00:00`),
});

function tables() {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
      { id: E, kind: 'partner', name: '엑스퍼트 업체', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER_A, company_id: A, role: 'owner', status: 'active' },
      { user_id: MANAGER_A, company_id: A, role: 'manager', status: 'active' },
      { user_id: STAFF_A, company_id: A, role: 'staff', status: 'active' },
      { user_id: OWNER_B, company_id: B, role: 'owner', status: 'active' },
      { user_id: OWNER_E, company_id: E, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    workers: [person(1), person(2, 'approved', ['install', 'as']), person(3), person(4, 'suspended'), person(5)],
    worker_companies: [
      link(1, A, W(1)),
      link(2, A, W(2), 'approved', ['as']), // 이 팩토리는 A/S 만 맡긴다
      link(3, A, W(3), 'pending'),
      link(4, A, W(4)), // 계정이 전역 정지
      link(5, B, W(1)),
      link(6, A, W(5)),
    ],
    designs: [
      { id: D(1), company_id: A, user_id: OWNER_A, name: '김고객 주방', project_id: null },
      { id: D(9), company_id: B, user_id: OWNER_B, name: '남의 설계', project_id: null },
      { id: D(3), company_id: E, user_id: OWNER_E, name: '엑스퍼트 설계', project_id: null },
    ],
    design_site_info: [
      { design_id: D(1), address: ADDR, address_detail: '1동 1호', contact_name: '김고객', contact_phone: '010-9999-9999', access_notes: '공동현관 0000', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, geo_address: ADDR },
    ],
    design_schedules: [
      { id: S(1), design_id: D(1), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-20T09:00:00'), duration_min: 120, assignee_name: '설치 1팀' },
      { id: S(2), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-19T14:00:00'), duration_min: 60, assignee_name: null },
      { id: S(3), design_id: D(1), type: 'as_visit', title: 'A/S 방문', status: 'scheduled', scheduled_at: iso('2026-11-25T15:00:00'), duration_min: null, assignee_name: null },
      { id: S(4), design_id: D(1), type: 'installation', title: '설치', status: 'completed', scheduled_at: iso('2026-11-01T09:00:00'), duration_min: 60, assignee_name: null },
      { id: S(9), design_id: D(9), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-20T09:00:00'), duration_min: 60, assignee_name: null },
      { id: S(30), design_id: D(3), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-20T09:00:00'), duration_min: 60, assignee_name: null },
    ],
    orders: [
      { id: O(1), company_id: A, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: null, customer_name: '김고객', created_at: iso('2026-11-01T09:00:00') },
      { id: O(2), company_id: A, order_no: 'SO-20261001-BBBB', status: 'completed', design_id: D(1), project_id: null, customer_name: '김고객', created_at: iso('2026-10-01T09:00:00') },
    ],
    as_requests: [{ id: AS(1), company_id: A, order_id: O(2), state: 'received', created_at: iso('2026-11-10T09:00:00'), body: 'x', visit_schedule_id: S(3) }],
    projects: [],
    work_jobs: [],
    work_assignments: [],
    work_applications: [],
    work_updates: [],
    work_job_events: [],
    worker_events: [],
    // 완료 보고의 필수 확인 (work/check-state.js) — 이 시험의 수주에는 작업지시서가 없다
    design_documents: [],
    design_snapshots: [],
    work_checks: [],
  };
}

const USERS = {
  t_owner: { id: OWNER_A },
  t_manager: { id: MANAGER_A },
  t_staff: { id: STAFF_A },
  t_other: { id: OWNER_B },
  t_expert: { id: OWNER_E },
  t_nobody: { id: U(90) },
  t_w1: { id: U_W1 },
  t_w2: { id: U_W2 },
  t_w5: { id: U(105) },
};
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

/** 워커를 부른다 — 응답 뒤에 도는 일(알림 넣기 · 담당 글 맞추기)까지 기다린다 */
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
      return { status: res.status, json: text ? JSON.parse(text) : null };
    });
  } finally {
    Date.now = realNow;
  }
}
const post = (fake, token, path, body = {}) => call(fake, token, path, { method: 'POST', body });
const view = (fake, token, s) => call(fake, token, `/company/schedules/${s}/workers`);
const assign = (fake, token, s, links) => post(fake, token, `/company/schedules/${s}/workers`, { link_ids: links });
const scheduleRow = (fake, s) => fake.db.design_schedules.find((r) => r.id === s);
const jobOf = (fake, s) => fake.db.work_jobs.find((j) => j.schedule_id === s && j.status !== 'cancelled');
const asgOf = (fake, workerId) => fake.db.work_assignments.filter((a) => a.worker_id === workerId).pop();
const outbox = (fake, kind) => fake.db.notification_outbox.filter((n) => n.kind === kind);
/** DB 0064 적용 전 — 작업의 일정 칸 · 연결 표가 없다 */
function before0064(fake) {
  const inner = fake.fetch;
  fake.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
    if (url.includes('/rest/v1/') && (/schedule_id/.test(url) || /schedule_id/.test(String(init.body || '')) || url.includes('/rest/v1/worker_companies'))) {
      return new Response(JSON.stringify({ code: '42703', message: 'column does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  return fake;
}

// ── 순수 ──────────────────────────────────────────────────────────

test('순수 — 배정할 수 있는 일정 종류 · 작업 시각 · 담당 글 · 상태 이름', () => {
  assert.deepEqual(SCHEDULE_JOB_KIND, { installation: 'install', as_visit: 'as' });
  assert.equal(ASSIGN_MAX, 10);
  assert.deepEqual(jobTimesOf({ scheduled_at: '2026-11-20T00:00:00+00:00', duration_min: 90 }), { starts_at: '2026-11-20T00:00:00.000Z', ends_at: '2026-11-20T01:30:00.000Z' });
  // 걸리는 시간을 모르면 끝 시각을 지어내지 않는다
  assert.deepEqual(jobTimesOf({ scheduled_at: '2026-11-20T00:00:00Z', duration_min: null }), { starts_at: '2026-11-20T00:00:00.000Z', ends_at: null });
  assert.deepEqual(jobTimesOf({ scheduled_at: 'x' }), { starts_at: null, ends_at: null });

  const a = (name, status) => ({ worker_name_snapshot: name, status });
  assert.equal(assigneeNameOf([a('가', 'offered'), a('나', 'confirmed'), a('다', 'declined'), a('라', 'removed'), a('마', 'accepted'), a('가', 'started')]), '가 · 나 · 마');
  assert.equal(assigneeNameOf([a('가', 'declined'), a('나', 'released')]), null);
  assert.equal(assigneeNameOf([]), null);
  const long = assigneeNameOf(Array.from({ length: 30 }, (_, i) => a(`시험작업자${i}`, 'confirmed')));
  assert.ok(long.length <= ASSIGNEE_NAME_MAX && !long.endsWith(' · '));
  assert.deepEqual(Object.keys(ASSIGNMENT_LABEL), ['offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted', 'declined', 'released', 'removed']);
  assert.equal(ASSIGNMENT_LABEL.offered, '수락 대기');
});

// ── 읽기 ──────────────────────────────────────────────────────────

test('읽기 — 고를 수 있는 사람은 연결 승인 + 계정 승인 + 종류 맞음. 작업자 id · 전화는 없다', async () => {
  const fake = world();
  const r = await view(fake, 't_owner', S(1));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, {
    schedule: { id: S(1), type: 'installation', label: '설치', at: iso('2026-11-20T09:00:00'), status: 'scheduled' },
    kind: 'install',
    can_manage: true,
    can_assign: true,
    job: null,
    workers: [],
    // 2번은 이 팩토리가 A/S 만 맡김 · 3번은 연결 대기 · 4번은 계정 정지
    candidates: [
      { link_id: L(1), name: '시험기사1', kinds: ['install'], region: '시험시 시험구' },
      { link_id: L(6), name: '시험기사5', kinds: ['install'], region: '시험시 시험구' },
    ],
  });
  const text = JSON.stringify(r.json);
  for (const leak of [W(1), PHONE, U_W1, '김고객', ADDR]) assert.equal(text.includes(leak), false, leak);

  const visit = await view(fake, 't_owner', S(3));
  assert.deepEqual([visit.json.data.kind, visit.json.data.candidates.map((c) => c.link_id)], ['as', [L(2)]]);
  // 납품 줄 · 끝난 일정 — 배정할 수 없다
  const delivery = await view(fake, 't_owner', S(2));
  assert.deepEqual([delivery.json.data.kind, delivery.json.data.can_assign, delivery.json.data.candidates], [null, false, []]);
  assert.equal((await view(fake, 't_owner', S(4))).json.data.can_assign, false);
  // 직원은 보기만
  const staff = await view(fake, 't_staff', S(1));
  assert.deepEqual([staff.status, staff.json.data.can_manage, staff.json.data.can_assign], [200, false, false]);
  // 등급이 인사를 못 쓰면 새 배정은 못 한다 (읽기는 된다)
  const expert = await view(fake, 't_expert', S(30));
  assert.deepEqual([expert.status, expert.json.data.can_manage, expert.json.data.can_assign], [200, true, false]);
});

test('읽기 — 남의 팩토리 일정은 404, 구성원이 아니면 403, id 가 틀리면 422', async () => {
  const fake = world();
  assert.equal((await view(fake, 't_owner', S(9))).status, 404);
  assert.equal((await view(fake, 't_other', S(1))).status, 404);
  assert.equal((await view(fake, 't_nobody', S(1))).status, 403);
  assert.equal((await view(fake, 't_owner', 'nope')).status, 422);
});

// ── 배정 ──────────────────────────────────────────────────────────

test('배정 — 작업이 없으면 만들고 수락 대기로 넣는다. 제목은 일정 종류 이름뿐, 담당 글은 작업자 이름', async () => {
  const fake = world();
  const r = await assign(fake, 't_owner', S(1), [L(1)]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const job = jobOf(fake, S(1));
  assert.deepEqual(
    { kind: job.kind, title: job.title, mode: job.mode, status: job.status, slots: job.slots, company_id: job.company_id, design_id: job.design_id, order_id: job.order_id, region_label: job.region_label, starts_at: job.starts_at, ends_at: job.ends_at, pay_visible: job.pay_visible, created_by: job.created_by },
    { kind: 'install', title: '설치', mode: 'invite', status: 'open', slots: 1, company_id: A, design_id: D(1), order_id: O(1), region_label: '시험시 시험구', starts_at: iso('2026-11-20T09:00:00'), ends_at: iso('2026-11-20T11:00:00'), pay_visible: false, created_by: OWNER_A },
  );
  // 설계 이름(고객 이름이 들어 있을 수 있다) · 주소는 작업에 싣지 않는다
  assert.equal(JSON.stringify(job).includes('김고객'), false);
  assert.equal(JSON.stringify(job).includes(ADDR), false);
  const a = asgOf(fake, W(1));
  assert.deepEqual([a.job_id, a.status, a.via, a.worker_name_snapshot, a.created_by], [job.id, 'offered', 'invite', '시험기사1', OWNER_A]);
  assert.deepEqual(r.json.data.workers.map((w) => [w.assignment_id, w.name, w.status, w.label]), [[a.id, '시험기사1', 'offered', '수락 대기']]);
  assert.deepEqual(r.json.data.job, { id: job.id, status: 'open' });
  assert.deepEqual(r.json.data.candidates.map((c) => c.link_id), [L(6)]);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1');
  // 기록 — 팩토리 구성원이 한 일
  const events = fake.db.work_job_events.filter((e) => e.job_id === job.id).map((e) => [e.type, e.actor_kind]);
  assert.deepEqual(events, [['job_created', 'member'], ['assignment_offered', 'member']]);
  // 작업자에게 초대 알림 (업체 없이)
  assert.deepEqual(outbox(fake, 'work_invited').map((n) => [n.user_id, n.company_id, n.ref_id]), [[U_W1, null, a.id]]);

  // 같은 사람을 또 넣으면 409, 다른 사람을 더 넣으면 정원이 늘고 같은 작업에 들어간다
  assert.equal((await assign(fake, 't_owner', S(1), [L(1)])).status, 409);
  const more = await assign(fake, 't_manager', S(1), [L(6), L(1)]);
  assert.equal(more.status, 200, JSON.stringify(more.json));
  assert.equal(fake.db.work_jobs.length, 1);
  assert.equal(jobOf(fake, S(1)).slots, 2);
  assert.deepEqual(more.json.data.workers.map((w) => w.name), ['시험기사1', '시험기사5']);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1 · 시험기사5');
  assert.deepEqual(more.json.data.candidates, []);
});

test('배정 — A/S 방문은 A/S 작업으로, 수주는 그 접수의 수주. 걸리는 시간이 없으면 끝 시각을 비운다', async () => {
  const fake = world();
  const r = await assign(fake, 't_owner', S(3), [L(2)]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const job = jobOf(fake, S(3));
  assert.deepEqual([job.kind, job.title, job.order_id, job.starts_at, job.ends_at], ['as', 'A/S 방문', O(2), iso('2026-11-25T15:00:00'), null]);
});

test('배정 — 누가 · 무엇을 못 하나', async () => {
  const fake = world();
  const no = async (token, s, links, status, code) => {
    const r = await assign(fake, token, s, links);
    assert.equal(r.status, status, `${token} ${s} ${JSON.stringify(r.json)}`);
    if (code) assert.equal(r.json.code, code);
  };
  await no('t_staff', S(1), [L(1)], 403, 'not_manager');
  await no('t_expert', S(30), [L(1)], 403, 'not_people_company');
  await no('t_other', S(1), [L(5)], 404); // 남의 일정
  await no('t_owner', S(1), [L(5)], 404); // 남의 연결
  await no('t_owner', S(1), [L(3)], 409, 'not_linked'); // 연결 대기
  await no('t_owner', S(1), [L(4)], 409); // 계정 정지
  await no('t_owner', S(1), [L(2)], 409); // 이 팩토리는 A/S 만 맡김
  await no('t_owner', S(2), [L(1)], 409, 'not_assignable'); // 납품 줄
  await no('t_owner', S(4), [L(1)], 409, 'closed'); // 끝난 일정
  await no('t_owner', S(1), [], 422);
  await no('t_owner', S(1), ['nope'], 422);
  await no('t_owner', S(1), Array.from({ length: ASSIGN_MAX + 1 }, (_, i) => L(200 + i)), 422);
  assert.equal(fake.db.work_jobs.length, 0);
  assert.equal(fake.db.work_assignments.length, 0);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '설치 1팀', '실패하면 손으로 적은 담당 글을 건드리지 않는다');
});

// ── 작업자의 답 · 보고 → 팩토리 ──────────────────────────────────────

test('수락 · 거절 — 팩토리 대표 · 실장에게 알리고(직원 제외 · 이름 없음) 담당 글을 맞춘다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  const a1 = asgOf(fake, W(1));
  const a5 = asgOf(fake, W(5));

  const yes = await post(fake, 't_w1', `/work/assignments/${a1.id}/confirm`);
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  const replies = outbox(fake, 'work_reply');
  assert.deepEqual(replies.map((n) => [n.user_id, n.company_id, n.ref_id]).sort(), [[OWNER_A, A, a1.id], [MANAGER_A, A, a1.id]].sort());
  assert.equal(replies[0].body, '작업자가 11/20(금) 설치 작업 배정을 수락했습니다. 일정에서 확인해 주세요.');
  assert.equal(replies[0].url, '/segan/me.html#p-install');
  for (const n of replies) assert.equal(n.body.includes('시험기사'), false);

  const nope = await post(fake, 't_w5', `/work/assignments/${a5.id}/decline`, { reason: '그날은 어렵습니다' });
  assert.equal(nope.status, 200, JSON.stringify(nope.json));
  assert.equal(outbox(fake, 'work_reply').length, 4);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1', '거절한 사람 이름은 뺀다');

  const r = await view(fake, 't_staff', S(1));
  assert.deepEqual(r.json.data.workers.map((w) => [w.name, w.label, w.reason]), [['시험기사1', '확정', null], ['시험기사5', '거절', '그날은 어렵습니다']]);
  // 거절한 사람은 다시 고를 수 있다 — 정원은 그대로 (확정 1 + 새로 1 = 2)
  assert.deepEqual(r.json.data.candidates.map((c) => c.link_id), [L(6)]);
  assert.equal((await assign(fake, 't_owner', S(1), [L(6)])).status, 200);
  assert.equal(jobOf(fake, S(1)).slots, 2);
});

test('완료 보고 → 확인 · 보완요청 · 빼기 — 대표 · 실장만, 남의 팩토리 배정은 404', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  const a1 = asgOf(fake, W(1));
  await post(fake, 't_w1', `/work/assignments/${a1.id}/confirm`);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/start`);
  const report = await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'result', body: '설치를 마쳤습니다' });
  assert.equal(report.status, 201, JSON.stringify(report.json));
  const told = outbox(fake, 'work_report');
  assert.deepEqual(told.map((n) => n.user_id).sort(), [OWNER_A, MANAGER_A].sort());
  assert.equal(told[0].body, '11/20(금) 설치 작업 완료 보고가 왔습니다. 일정에서 확인해 주세요.');
  assert.equal(told[0].body.includes('마쳤습니다'), false);

  const seen = await view(fake, 't_owner', S(1));
  assert.deepEqual(seen.json.data.workers[0].reports, [{ kind: 'result', by: 'worker', body: '설치를 마쳤습니다', issue_chips: [], at: seen.json.data.workers[0].reports[0].at }]);
  assert.equal(seen.json.data.workers[0].label, '완료 보고');
  assert.equal(seen.json.data.job.status, 'review');

  // 누가
  assert.equal((await post(fake, 't_staff', `/company/work/assignments/${a1.id}/accept`)).status, 403);
  assert.equal((await post(fake, 't_other', `/company/work/assignments/${a1.id}/accept`)).status, 404);
  assert.equal((await post(fake, 't_owner', `/company/work/assignments/${a1.id}/revision`, {})).status, 422, '보완요청은 사유가 있어야 한다');
  assert.equal(a1.status === 'submitted' || asgOf(fake, W(1)).status === 'submitted', true);

  // 보완요청 → 작업자에게 보이는 메모 한 줄 → 다시 보고 → 확인
  const back = await post(fake, 't_manager', `/company/work/assignments/${a1.id}/revision`, { reason: '걸레받이 마감을 다시 봐 주세요' });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual([back.json.data.assignment.status, back.json.data.workers[0].label, back.json.data.workers[0].revision_count], ['revision', '보완 요청', 1]);
  const memo = fake.db.work_updates.find((u) => u.author_role === 'company');
  assert.deepEqual([memo.body, memo.visible_to_worker], ['보완 요청: 걸레받이 마감을 다시 봐 주세요', true]);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'result', body: '다시 마쳤습니다' });
  const done = await post(fake, 't_owner', `/company/work/assignments/${a1.id}/accept`);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual([done.json.data.assignment, done.json.data.job.status], [{ id: a1.id, status: 'accepted', label: '확인함' }, 'done']);
  assert.ok(asgOf(fake, W(1)).accepted_at);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1', '끝난 뒤에도 누가 했는지 남는다');
  const kinds = fake.db.work_job_events.filter((e) => e.actor_kind === 'member').map((e) => e.type);
  assert.deepEqual(kinds, ['job_created', 'assignment_offered', 'assignment_revision', 'assignment_accepted']);
  // 끝난 작업에는 사람을 더 못 넣는다
  assert.equal(done.json.data.can_assign, false);
  assert.equal((await assign(fake, 't_owner', S(1), [L(6)])).status, 409);
});

test('빼기 — 사유가 있어야 하고, 뺀 사람 이름은 담당 글에서 빠진다 (모두 빠지면 비운다)', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  const a1 = asgOf(fake, W(1));
  assert.equal((await post(fake, 't_owner', `/company/work/assignments/${a1.id}/remove`, {})).status, 422);
  const r = await post(fake, 't_owner', `/company/work/assignments/${a1.id}/remove`, { reason: '일정이 바뀌었습니다', no_show: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([asgOf(fake, W(1)).status, r.json.data.workers[0].label, r.json.data.workers[0].reason], ['removed', '뺌', null]);
  assert.equal(scheduleRow(fake, S(1)).assignee_name, null);
  assert.deepEqual(r.json.data.candidates.map((c) => c.link_id), [L(1), L(6)]);
  // 사유는 이력에만 — 작업자 화면에 나가는 칸(release_reason)에는 없다
  assert.equal(asgOf(fake, W(1)).release_reason || null, null);
});

test('문제 보고도 팩토리에 알린다 · 진행 보고는 알리지 않는다 · 일정에서 생기지 않은 작업은 팩토리 알림이 없다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  const a1 = asgOf(fake, W(1));
  await post(fake, 't_w1', `/work/assignments/${a1.id}/confirm`);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'progress', body: '가는 중' });
  assert.equal(outbox(fake, 'work_report').length, 0);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'issue', body: '벽이 휘었습니다' });
  assert.equal(outbox(fake, 'work_report')[0].title, '작업 문제 보고');

  // 관리자가 만든 옛 작업(일정 칸 없음)
  const before = fake.db.notification_outbox.length;
  fake.db.work_jobs.push({ id: id('0f', 1), company_id: A, kind: 'install', title: '옛 작업', status: 'open', mode: 'invite', slots: 1, version: 0, schedule_id: null, starts_at: iso('2026-11-21T09:00:00') });
  fake.db.work_assignments.push({ id: id('0f', 2), job_id: id('0f', 1), worker_id: W(1), status: 'offered', via: 'invite', worker_name_snapshot: '시험기사1' });
  assert.equal((await post(fake, 't_w1', `/work/assignments/${id('0f', 2)}/confirm`)).status, 200);
  assert.equal(fake.db.notification_outbox.length, before);
});

// ── 일정 ↔ 작업 ──────────────────────────────────────────────────

test('일정 시각을 고치면 작업 시각이 따라가고 작업자에게 알린다. 담당 글을 손으로 고쳐도 작업자 이름으로 둔다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  const moved = await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { scheduled_at: iso('2026-11-21T13:00:00'), assignee_name: '설치 2팀' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const job = jobOf(fake, S(1));
  assert.deepEqual([job.starts_at, job.ends_at, job.version], [iso('2026-11-21T13:00:00'), iso('2026-11-21T15:00:00'), 1]);
  assert.deepEqual(outbox(fake, 'work_schedule').map((n) => [n.user_id, n.company_id]), [[U_W1, null]]);
  assert.equal(moved.json.data.assignee_name, '시험기사1');
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1');
  // 시각이 그대로면 작업을 건드리지 않는다
  await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { notes: '메모' } });
  assert.equal(jobOf(fake, S(1)).version, 1);
  // 배정이 없는 일정은 손으로 적은 담당 글 그대로
  const free = await call(fake, 't_owner', `/schedules/${S(2)}`, { method: 'PATCH', body: { assignee_name: '배송 1팀' } });
  assert.equal(free.json.data.assignee_name, '배송 1팀');
});

test('일정을 취소하면 작업도 취소되고 답 없는 초대는 끝난다. 다시 배정하면 새 작업이 생긴다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  await post(fake, 't_w1', `/work/assignments/${asgOf(fake, W(1)).id}/confirm`);
  const first = jobOf(fake, S(1));
  const off = await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'cancelled' } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  const gone = fake.db.work_jobs.find((j) => j.id === first.id);
  assert.deepEqual([gone.status, gone.cancel_reason], ['cancelled', '일정이 취소되었습니다']);
  assert.deepEqual([asgOf(fake, W(1)).status, asgOf(fake, W(5)).status], ['confirmed', 'declined']);
  assert.equal(asgOf(fake, W(5)).release_reason, '작업이 취소돼 초대가 끝났습니다');
  // 취소한 일정에는 배정할 수 없다
  assert.equal((await assign(fake, 't_owner', S(1), [L(6)])).status, 409);
  const v = await view(fake, 't_owner', S(1));
  assert.deepEqual([v.json.data.job, v.json.data.workers, v.json.data.can_assign], [null, [], false]);
  // 일정을 되살려 다시 배정 — 새 작업
  await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'scheduled' } });
  assert.equal((await assign(fake, 't_owner', S(1), [L(6)])).status, 200);
  assert.notEqual(jobOf(fake, S(1)).id, first.id);
});

test('A/S 방문일을 고치면 그 방문의 작업 시각도 따라가고 담당 글은 작업자 이름으로 남는다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(3), [L(2)]);
  const r = await call(fake, 't_owner', `/company/as-requests/${AS(1)}/visit`, { method: 'PUT', body: { visit_at: '2026-11-26T10:00:00+09:00' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(jobOf(fake, S(3)).starts_at, iso('2026-11-26T10:00:00'));
  assert.deepEqual([r.json.data.visit.assignee_name, r.json.data.visit.workers], ['시험기사2', [{ name: '시험기사2', status: 'offered', label: '수락 대기' }]]);
  assert.equal(scheduleRow(fake, S(3)).assignee_name, '시험기사2');
});

test('설치 · A/S 표 — 줄마다 배정된 작업자(이름 · 상태). 뺀 사람 · 남의 팩토리 작업은 없다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  await post(fake, 't_w1', `/work/assignments/${asgOf(fake, W(1)).id}/confirm`);
  await post(fake, 't_owner', `/company/work/assignments/${asgOf(fake, W(5)).id}/remove`, { reason: '시험' });
  await assign(fake, 't_owner', S(3), [L(2)]);
  const install = await call(fake, 't_staff', '/company/sites?kind=install');
  assert.equal(install.status, 200, JSON.stringify(install.json));
  const rows = Object.fromEntries(install.json.data.items.map((i) => [i.schedule_id, i.workers]));
  assert.deepEqual(rows[S(1)], [{ name: '시험기사1', status: 'confirmed', label: '확정' }]);
  assert.deepEqual(rows[S(2)], []);
  const as = await call(fake, 't_staff', '/company/sites?kind=as');
  assert.deepEqual(as.json.data.items[0].visit.workers, [{ name: '시험기사2', status: 'offered', label: '수락 대기' }]);
  assert.equal(JSON.stringify([install.json, as.json]).includes(W(1)), false);
});

test('DB 0064 적용 전 — 배정 경로는 409 db_pending, 설치 표는 workers 없이 그대로, 일정 고치기도 그대로', async () => {
  const fake = before0064(world());
  for (const r of [await view(fake, 't_owner', S(1)), await assign(fake, 't_owner', S(1), [L(1)])]) {
    assert.deepEqual([r.status, r.json.code], [409, 'db_pending'], JSON.stringify(r.json));
  }
  const install = await call(fake, 't_owner', '/company/sites?kind=install');
  assert.equal(install.status, 200, JSON.stringify(install.json));
  assert.deepEqual(install.json.data.items.find((i) => i.schedule_id === S(1)).workers, []);
  const moved = await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { scheduled_at: iso('2026-11-21T13:00:00'), assignee_name: '설치 2팀' } });
  assert.deepEqual([moved.status, moved.json.data.assignee_name], [200, '설치 2팀']);
});
