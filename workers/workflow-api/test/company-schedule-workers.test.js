/**
 * 일정 줄에서 작업자 배정 (src/work/schedule-link.js · schedule-names.js) — 2026-11-13 「작업자 한 길」, DB 0064.
 *   GET|POST /company/schedules/:id/workers · POST /company/work/assignments/:id/accept|revision|remove
 *   + 작업자의 답 · 보고가 팩토리 대표 · 실장에게 가는 알림, 일정 ↔ 작업 시각 · 취소 맞추기, 설치 · A/S 표의 workers
 *
 *   - 납품 · 설치 · A/S 방문 일정에만 (납품은 2026-11-14 — 종류 「납품」, DB 0066). 일정 하나에 작업 하나, 제목은 일정 종류 이름뿐
 *   - 모집 올리기(2026-11-14 — src/work/recruit.js): 공개 모집으로 돌려 연결된 작업자가 신청 → 팩토리가 뽑으면 확정
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
import { ASSIGNMENT_LABEL, ASSIGN_MAX, SCHEDULE_JOB_KIND, jobTimesOf, recruitFields } from '../src/work/schedule-link.js';
import { RECRUIT_CLOSED } from '../src/work/recruit.js';
import { ASSIGNEE_NAME_MAX, OPEN_SCHEDULE_STATUSES, assigneeNameOf, completeScheduleOf } from '../src/work/schedule-names.js';
import { UNCONFIRMED_MAX, unconfirmedOf } from '../src/work/company.js';
import { SITE_EMPTY_NOTE, SITE_NOTE, findForbiddenKeys } from '../src/work/reveal.js';
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
      { design_id: D(1), address: ADDR, address_detail: '1동 1호', floor: '3', has_elevator: true, elevator_note: null, contact_name: '김고객', contact_phone: '010-9999-9999', access_note: '공동현관 0000', install_order: '내부 차례 메모', notes: '내부 특기 메모', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, geo_address: ADDR },
      { design_id: D(9), address: '남의 주소 9', address_detail: null, contact_name: '남의고객', contact_phone: '010-8888-8888' },
    ],
    design_schedules: [
      { id: S(1), design_id: D(1), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-20T09:00:00'), duration_min: 120, assignee_name: '설치 1팀' },
      { id: S(2), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-19T14:00:00'), duration_min: 60, assignee_name: null },
      { id: S(3), design_id: D(1), type: 'as_visit', title: 'A/S 방문', status: 'scheduled', scheduled_at: iso('2026-11-25T15:00:00'), duration_min: null, assignee_name: null },
      { id: S(4), design_id: D(1), type: 'installation', title: '설치', status: 'completed', scheduled_at: iso('2026-11-01T09:00:00'), duration_min: 60, assignee_name: null },
      { id: S(5), design_id: D(1), type: 'measurement', title: '실측', status: 'scheduled', scheduled_at: iso('2026-11-15T09:00:00'), duration_min: 60, assignee_name: null },
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
    worker_invites: [], // 인사 › 작업자 응답(GET /company/workers)의 남은 초대
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
  t_w3: { id: U(103) },
  t_w6: { id: U(106) },
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
const recruit = (fake, token, s, body) => post(fake, token, `/company/schedules/${s}/workers/recruit`, body);
/** 납품을 하는 작업자 한 명(6번)을 팩토리 A 와 연결해 둔다 */
function withDriver(fake) {
  fake.db.workers.push(person(6, 'approved', ['delivery']));
  fake.db.worker_companies.push(link(7, A, W(6), 'approved', ['delivery']));
  return fake;
}
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
  assert.deepEqual(SCHEDULE_JOB_KIND, { delivery: 'delivery', installation: 'install', as_visit: 'as' });
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
    recruit: null,
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
  // 납품 줄 — 종류는 납품. 납품을 하는 작업자만 고를 수 있다 (설치 작업자는 후보가 아니다)
  const delivery = await view(fake, 't_owner', S(2));
  assert.deepEqual([delivery.json.data.kind, delivery.json.data.can_assign, delivery.json.data.candidates], ['delivery', true, []]);
  // 배정할 수 없는 일정 종류(실측) · 끝난 일정
  const measure = await view(fake, 't_owner', S(5));
  assert.deepEqual([measure.json.data.kind, measure.json.data.can_assign, measure.json.data.candidates, measure.json.data.recruit], [null, false, [], null]);
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
  await no('t_owner', S(2), [L(1)], 409); // 납품 줄에 설치 작업자 — 종류가 안 맞는다
  await no('t_owner', S(5), [L(1)], 409, 'not_assignable'); // 실측 일정
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
  assert.equal(scheduleRow(fake, S(1)).status, 'scheduled', '확인 전에는 일정 상태를 건드리지 않는다');
  const done = await post(fake, 't_owner', `/company/work/assignments/${a1.id}/accept`);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  // 맡은 사람이 모두 확인됐다 → 그 일정도 「끝남」 (응답도 그 모습)
  assert.deepEqual([scheduleRow(fake, S(1)).status, done.json.data.schedule.status], ['completed', 'completed']);
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

// ── 현장 공개 (작업자 화면) ──────────────────────────────────────────

test('현장 공개 — 수락 전에는 닫힘, 수락하면 주소 · 층 · 출입 · 연락처가 열리고, 끝나고 7일 뒤 닫힌다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  const job = jobOf(fake, S(1));
  const a1 = asgOf(fake, W(1));
  const detail = (token) => call(fake, token, `/work/jobs/${job.id}`);
  const SECRET = [ADDR, '1동 1호', '공동현관 0000', '김고객', '010-9999-9999'];
  const closed = (r, note = SITE_NOTE) => {
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.data.site, r.json.data.site_note], [null, note]);
    for (const v of SECRET) assert.equal(JSON.stringify(r.json).includes(v), false, v);
  };

  // 초대만 받음 — 닫힘
  closed(await detail('t_w1'));
  // 수락 — 열림. 싣는 칸은 여덟 개뿐 (내부 메모 · 좌표 · 시공 순서는 없다)
  await post(fake, 't_w1', `/work/assignments/${a1.id}/confirm`);
  const open = await detail('t_w1');
  assert.deepEqual(open.json.data.site, {
    address: ADDR, address_detail: '1동 1호', floor: '3', has_elevator: true, elevator_note: null,
    access_note: '공동현관 0000', contact_name: '김고객', contact_phone: '010-9999-9999',
  });
  assert.equal(open.json.data.site_note, null);
  assert.equal(JSON.stringify(open.json).includes('내부'), false);
  assert.deepEqual(findForbiddenKeys(open.json, { allowSiteAt: ['$.data.site'] }), []);
  // 같이 초대받았지만 수락하지 않은 사람 · 거절한 사람은 못 본다
  closed(await detail('t_w5'));
  await post(fake, 't_w5', `/work/assignments/${asgOf(fake, W(5)).id}/decline`, {});
  closed(await detail('t_w5'));
  // 목록 카드에는 현장이 없다
  const mine = await call(fake, 't_w1', '/work/jobs?tab=mine');
  for (const v of SECRET) assert.equal(JSON.stringify(mine.json).includes(v), false, v);

  // 작업 중 · 완료 보고 · 확인 — 계속 열림, 확인한 때부터 7일
  await post(fake, 't_w1', `/work/assignments/${a1.id}/start`);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'result', body: '마쳤습니다' });
  assert.ok((await detail('t_w1')).json.data.site);
  await post(fake, 't_owner', `/company/work/assignments/${a1.id}/accept`);
  const row = asgOf(fake, W(1));
  row.accepted_at = new Date(AT - 6 * 86400000).toISOString();
  assert.equal((await detail('t_w1')).json.data.site.address, ADDR);
  row.accepted_at = new Date(AT - 7 * 86400000 - 1000).toISOString();
  closed(await detail('t_w1'));
});

test('현장 공개 — 포기 · 뺌 · 취소된 일정은 닫힌다. 작업의 설계가 그 팩토리 것이 아니면 열지 않는다. 안 적었으면 그 안내', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  const job = jobOf(fake, S(1));
  const a1 = asgOf(fake, W(1));
  const detail = () => call(fake, 't_w1', `/work/jobs/${job.id}`);
  await post(fake, 't_w1', `/work/assignments/${a1.id}/confirm`);
  assert.ok((await detail()).json.data.site);

  // 남의 팩토리 설계 번호가 적힌 작업 — 열지 않는다
  job.design_id = D(9);
  const wrong = await detail();
  assert.deepEqual([wrong.json.data.site, wrong.json.data.site_note], [null, SITE_EMPTY_NOTE]);
  assert.equal(JSON.stringify(wrong.json).includes('남의'), false);
  job.design_id = D(1);
  // 현장 정보를 아직 안 적었다
  const saved = fake.db.design_site_info.splice(0, 1)[0];
  assert.deepEqual([(await detail()).json.data.site, (await detail()).json.data.site_note], [null, SITE_EMPTY_NOTE]);
  fake.db.design_site_info.unshift(saved);

  // 일정을 취소하면 (작업 취소) 확정했던 사람에게도 닫힌다
  await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'cancelled' } });
  const off = await detail();
  assert.deepEqual([off.json.data.site, off.json.data.site_note], [null, SITE_NOTE]);

  // 포기 · 뺌
  const two = world();
  await assign(two, 't_owner', S(1), [L(1), L(6)]);
  const j2 = jobOf(two, S(1));
  await post(two, 't_w1', `/work/assignments/${asgOf(two, W(1)).id}/confirm`);
  await post(two, 't_w5', `/work/assignments/${asgOf(two, W(5)).id}/confirm`);
  await post(two, 't_w1', `/work/assignments/${asgOf(two, W(1)).id}/release`, { reason: '사정이 생겼습니다' });
  await post(two, 't_owner', `/company/work/assignments/${asgOf(two, W(5)).id}/remove`, { reason: '시험' });
  for (const token of ['t_w1', 't_w5']) {
    const r = await call(two, token, `/work/jobs/${j2.id}`);
    assert.deepEqual([r.status, r.json.data.site], [200, null], token);
    assert.equal(JSON.stringify(r.json).includes(ADDR), false);
  }
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
  // 그때 맡고 있던 사람(확정 · 수락 대기)에게 알린다 — 작업 종류 · 날짜만, 업체 칸 없이, 그 작업으로 열린다
  const told = outbox(fake, 'work_schedule');
  assert.deepEqual(told.map((n) => n.user_id).sort(), [U_W1, U(105)].sort());
  for (const n of told) {
    assert.deepEqual(
      [n.title, n.body, n.url, n.company_id, n.ref_id],
      ['작업 취소', '11/20(금) 설치 작업이 취소되었습니다. 작업 탭에서 확인해 주세요.', `/segan/work.html#job=${first.id}`, null, first.id],
    );
  }
  // 이미 취소한 일정을 다시 취소로 저장해도 또 알리지 않는다
  await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'cancelled' } });
  assert.equal(outbox(fake, 'work_schedule').length, 2);
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

// ── 2026-11-13 빈틈 메우기 — 취소 알림 받는 사람 · 일정 끝남 · 확인을 기다리는 완료 보고 ──

test('일정 취소 알림 — 거절 · 포기 · 뺀 사람에게는 가지 않는다. 배정이 없으면 아무에게도', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  await post(fake, 't_w5', `/work/assignments/${asgOf(fake, W(5)).id}/decline`, { reason: '어렵습니다' });
  await call(fake, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'cancelled' } });
  assert.deepEqual(outbox(fake, 'work_schedule').map((n) => [n.user_id, n.title]), [[U_W1, '작업 취소']]);
  // 작업자를 배정한 적 없는 일정을 취소하면 알림이 없다
  const bare = world();
  await call(bare, 't_owner', `/schedules/${S(1)}`, { method: 'PATCH', body: { status: 'cancelled' } });
  assert.deepEqual(bare.db.notification_outbox || [], []);
});

test('일정 끝남 — 맡은 사람이 모두 확인돼야 끝난다. 한 사람이 남아 있으면 그대로, 그 사람을 빼면 끝남', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1), L(6)]);
  const a1 = asgOf(fake, W(1));
  const a5 = asgOf(fake, W(5));
  for (const [tok, a] of [['t_w1', a1], ['t_w5', a5]]) {
    await post(fake, tok, `/work/assignments/${a.id}/confirm`);
    await post(fake, tok, `/work/assignments/${a.id}/start`);
  }
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'result', body: '설치를 마쳤습니다' });
  const one = await post(fake, 't_owner', `/company/work/assignments/${a1.id}/accept`);
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.deepEqual([jobOf(fake, S(1)).status, scheduleRow(fake, S(1)).status], ['in_progress', 'scheduled']);
  const out = await post(fake, 't_owner', `/company/work/assignments/${a5.id}/remove`, { reason: '한 사람으로 끝냈습니다' });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.deepEqual([jobOf(fake, S(1)).status, scheduleRow(fake, S(1)).status], ['done', 'completed']);

  // 순수 쪽 — 끝나지 않은 작업 · 일정 없는 작업은 건드리지 않고, 취소했거나 이미 끝난 일정은 그대로 둔다
  assert.deepEqual([...OPEN_SCHEDULE_STATUSES], ['scheduled', 'confirmed', 'in_progress']);
  const w = world();
  const run = (job) => withFake(w, () => completeScheduleOf(ENV, job));
  assert.equal(await run({ id: 'j', status: 'review', schedule_id: S(1) }), false);
  assert.equal(await run({ id: 'j', status: 'done', schedule_id: null }), false);
  assert.equal(await run({ id: 'j', status: 'done', schedule_id: S(4) }), false, '이미 끝난 일정');
  scheduleRow(w, S(2)).status = 'cancelled';
  assert.equal(await run({ id: 'j', status: 'done', schedule_id: S(2) }), false, '취소한 일정');
  assert.equal(scheduleRow(w, S(2)).status, 'cancelled');
  assert.equal(await run({ id: 'j', status: 'done', schedule_id: S(3) }), true);
  assert.equal(scheduleRow(w, S(3)).status, 'completed');
});

test('확인을 기다리는 완료 보고 — 인사 › 작업자 응답에 건수와 종류 · 시각만. 확인하면 줄어든다', async () => {
  const fake = world();
  await assign(fake, 't_owner', S(1), [L(1)]);
  await assign(fake, 't_owner', S(3), [L(2)]);
  const a1 = asgOf(fake, W(1));
  const a2 = asgOf(fake, W(2));
  for (const [tok, a] of [['t_w1', a1], ['t_w2', a2]]) {
    await post(fake, tok, `/work/assignments/${a.id}/confirm`);
    await post(fake, tok, `/work/assignments/${a.id}/start`);
  }
  const none = await call(fake, 't_owner', '/company/workers');
  assert.equal(none.status, 200, JSON.stringify(none.json));
  assert.deepEqual(none.json.data.unconfirmed, { total: 0, items: [] });

  await post(fake, 't_w2', `/work/assignments/${a2.id}/updates`, { kind: 'result', body: '방문 수리를 마쳤습니다' });
  await post(fake, 't_w1', `/work/assignments/${a1.id}/updates`, { kind: 'result', body: '설치를 마쳤습니다' });
  // 직원도 본다 (확인은 대표 · 실장). 작업 시각 순
  const two = await call(fake, 't_staff', '/company/workers');
  assert.deepEqual(two.json.data.unconfirmed, {
    total: 2,
    items: [
      { kind: 'install', at: iso('2026-11-20T09:00:00'), where: 'install' },
      { kind: 'as', at: iso('2026-11-25T15:00:00'), where: 'as' },
    ],
  });
  // 작업자 · 고객 · 일정 · 작업을 가리키는 값은 없다
  const text = JSON.stringify(two.json.data.unconfirmed);
  for (const bad of [W(1), W(2), a1.id, a2.id, S(1), S(3), ADDR, '김고객', '마쳤습니다']) assert.equal(text.includes(bad), false, bad);
  // 남의 팩토리 것은 세지 않는다
  assert.deepEqual((await call(fake, 't_other', '/company/workers')).json.data.unconfirmed, { total: 0, items: [] });

  await post(fake, 't_owner', `/company/work/assignments/${a2.id}/accept`);
  const left = await call(fake, 't_owner', '/company/workers');
  assert.deepEqual(left.json.data.unconfirmed, { total: 1, items: [{ kind: 'install', at: iso('2026-11-20T09:00:00'), where: 'install' }] });
  assert.deepEqual([scheduleRow(fake, S(3)).status, scheduleRow(fake, S(1)).status], ['completed', 'scheduled']);
});

test('확인을 기다리는 완료 보고 (순수) — 앱에서 배정한 작업만, 프로젝트 작업은 project, 줄 수는 상한까지', () => {
  const jobs = [
    { id: 'j1', kind: 'demolition', project_id: 'p1', schedule_id: null, starts_at: '2026-11-14T00:00:00Z' },
    { id: 'j2', kind: 'install', project_id: null, schedule_id: 's1', starts_at: '2026-11-12T00:00:00Z' },
    { id: 'j3', kind: 'install', project_id: null, schedule_id: null, starts_at: '2026-11-10T00:00:00Z' }, // PC 관리자 화면에서 만든 작업
    { id: 'j4', kind: 'as', project_id: 'p1', schedule_id: 's2', starts_at: null },
  ];
  const a = (job_id, status) => ({ job_id, status, worker_id: 'w' });
  assert.deepEqual(unconfirmedOf(jobs, [a('j1', 'submitted'), a('j2', 'submitted'), a('j2', 'started'), a('j3', 'submitted'), a('j4', 'submitted'), a('nope', 'submitted')]), {
    total: 3,
    items: [
      { kind: 'install', at: '2026-11-12T00:00:00Z', where: 'install' },
      { kind: 'demolition', at: '2026-11-14T00:00:00Z', where: 'project' },
      { kind: 'as', at: null, where: 'as' },
    ],
  });
  assert.deepEqual(unconfirmedOf(null, null), { total: 0, items: [] });
  const many = unconfirmedOf([jobs[1]], Array.from({ length: UNCONFIRMED_MAX + 5 }, () => a('j2', 'submitted')));
  assert.deepEqual([many.total, many.items.length], [UNCONFIRMED_MAX + 5, UNCONFIRMED_MAX]);
});

// ── 2026-11-14 납품 줄 배정 (종류 「납품」, DB 0066) ─────────────────────

test('납품 줄 — 납품 작업자를 배정한다. 현장 일이라 수락하면 현장이 열리고 팩토리가 확인해야 끝난다. 설치 표에 작업자가 실린다', async () => {
  const fake = withDriver(world());
  const v = await view(fake, 't_owner', S(2));
  assert.deepEqual([v.json.data.kind, v.json.data.candidates.map((c) => [c.link_id, c.name, c.kinds])], ['delivery', [[L(7), '시험기사6', ['delivery']]]]);
  const r = await assign(fake, 't_owner', S(2), [L(7)]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const job = jobOf(fake, S(2));
  assert.deepEqual([job.kind, job.title, job.mode, job.company_id, job.design_id, job.starts_at], ['delivery', '납품', 'invite', A, D(1), iso('2026-11-19T14:00:00')]);
  assert.equal(scheduleRow(fake, S(2)).assignee_name, '시험기사6');
  // 작업자에게 초대 알림 — 「납품 작업」
  const invited = outbox(fake, 'work_invited');
  assert.deepEqual(invited.map((n) => [n.user_id, n.body]), [[U(106), '11/19(목) 납품 작업에 초대받았습니다. 수락하거나 거절해 주세요.']]);

  const a = asgOf(fake, W(6));
  const detail = () => call(fake, 't_w6', `/work/jobs/${job.id}`);
  assert.deepEqual([(await detail()).json.data.site, (await detail()).json.data.site_note], [null, SITE_NOTE]);
  await post(fake, 't_w6', `/work/assignments/${a.id}/confirm`);
  assert.equal((await detail()).json.data.site.address, ADDR, '수락하면 현장이 열린다');
  // 팩토리 알림은 설치 화면으로
  assert.deepEqual(outbox(fake, 'work_reply').map((n) => [n.body, n.url])[0], ['작업자가 11/19(목) 납품 작업 배정을 수락했습니다. 일정에서 확인해 주세요.', '/segan/me.html#p-install']);
  // 완료 보고 → 팩토리가 확인해야 끝난다 (현장 일)
  await post(fake, 't_w6', `/work/assignments/${a.id}/start`);
  const done = await post(fake, 't_w6', `/work/assignments/${a.id}/updates`, { kind: 'result', body: '납품 끝' });
  assert.equal(done.status, 201, JSON.stringify(done.json));
  assert.deepEqual([asgOf(fake, W(6)).status, jobOf(fake, S(2)).status], ['submitted', 'review']);
  const wait = (await call(fake, 't_owner', '/company/workers')).json.data.unconfirmed;
  assert.deepEqual(wait, { total: 1, items: [{ kind: 'delivery', at: iso('2026-11-19T14:00:00'), where: 'install' }] });
  // 설치 표 — 납품 줄에도 작업자
  const install = await call(fake, 't_staff', '/company/sites?kind=install');
  assert.deepEqual(install.json.data.items.find((i) => i.schedule_id === S(2)).workers, [{ name: '시험기사6', status: 'submitted', label: '완료 보고' }]);
  assert.equal((await post(fake, 't_owner', `/company/work/assignments/${a.id}/accept`)).status, 200);
  assert.deepEqual([jobOf(fake, S(2)).status, scheduleRow(fake, S(2)).status], ['done', 'completed']);
});

test('DB 0066 적용 전 — 납품 줄 배정만 409 db_pending, 설치 줄은 그대로 된다', async () => {
  const fake = withDriver(world());
  const inner = fake.fetch;
  fake.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
    if (url.includes('/rest/v1/work_jobs') && /"kind":"delivery"/.test(String(init.body || ''))) {
      return new Response(JSON.stringify({ code: '23514', message: 'new row violates check constraint "work_jobs_kind_chk" (23514)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  const r = await assign(fake, 't_owner', S(2), [L(7)]);
  assert.deepEqual([r.status, r.json.code], [409, 'db_pending'], JSON.stringify(r.json));
  assert.match(r.json.message, /납품은 0066/);
  assert.equal((await assign(fake, 't_owner', S(1), [L(1)])).status, 200);
});

// ── 2026-11-14 모집 게시 (src/work/recruit.js) ─────────────────────────

test('모집 칸 (순수) — 인원은 꼭 적는다(1 ~ 상한), 지원 종료일은 비워도 되고 지금보다 뒤여야 한다', () => {
  const realNow = Date.now;
  Date.now = () => AT;
  try {
    assert.deepEqual(recruitFields({ stop: true, people: 3 }), { stop: true });
    assert.deepEqual(recruitFields({ people: 2 }), { stop: false, people: 2, deadline: null });
    assert.deepEqual(recruitFields({ people: '3', apply_deadline: iso('2026-11-15T18:00:00') }), { stop: false, people: 3, deadline: iso('2026-11-15T18:00:00') });
    for (const bad of [{}, { people: 0 }, { people: 1.5 }, { people: ASSIGN_MAX + 1 }, { people: 1, apply_deadline: iso('2026-11-13T11:00:00') }, { people: 1, apply_deadline: 'x' }]) {
      assert.throws(() => recruitFields(bad), (e) => e.statusCode === 422, JSON.stringify(bad));
    }
  } finally {
    Date.now = realNow;
  }
});

test('모집 올리기 — 연결된(그 종류를 맡긴) 작업자에게 알림 → 신청 → 팩토리가 뽑으면 확정 · 현장이 열린다. 신청만 한 사람에게는 닫혀 있다', async () => {
  const fake = world();
  // 3번의 연결을 승인해 둔다 (설치) — 신청자가 둘이 되게
  fake.db.worker_companies.find((l) => l.id === L(3)).status = 'approved';
  await assign(fake, 't_owner', S(1), [L(1)]);
  const up = await recruit(fake, 't_owner', S(1), { people: 1, apply_deadline: iso('2026-11-18T18:00:00') });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const job = jobOf(fake, S(1));
  // 정원 = 지금 배정된 사람(수락 대기 1) + 모집 1
  assert.deepEqual([job.mode, job.slots, job.status, job.apply_deadline], ['open', 2, 'open', iso('2026-11-18T18:00:00')]);
  assert.deepEqual(up.json.data.recruit, { on: true, state: 'open', slots: 2, filled: 0, deadline: iso('2026-11-18T18:00:00'), applications: [] });
  // 알림 — 연결 승인 + 계정 승인 + 이 팩토리가 설치를 맡긴 사람 가운데 아직 배정 안 된 사람만 (3번 · 5번).
  //   1번은 이미 배정됨 · 2번은 이 팩토리가 A/S 만 맡김 · 4번은 계정 정지
  const posted = outbox(fake, 'work_invited').filter((n) => n.title === '작업 모집');
  assert.deepEqual(posted.map((n) => n.user_id).sort(), [U(103), U(105)].sort());
  assert.deepEqual([posted[0].body, posted[0].company_id, posted[0].url], ['11/20(금) 설치 작업 모집이 올라왔습니다. 작업 탭에서 보고 신청해 주세요.', null, `/segan/work.html#job=${job.id}`]);
  // 다시 올려도 같은 작업의 모집 알림은 한 번
  await recruit(fake, 't_owner', S(1), { people: 1 });
  assert.equal(outbox(fake, 'work_invited').filter((n) => n.title === '작업 모집').length, 2);

  // 작업자 화면 — 모집중 탭에 종류 · 날짜 · 지역 · 팩토리 이름만. 주소 · 고객은 없다
  const open = await call(fake, 't_w5', '/work/jobs?tab=open');
  assert.deepEqual(open.json.data.items.map((j) => [j.id, j.title, j.company_name, j.region_label, j.slots]), [[job.id, '설치', '가나 인테리어', '시험시 시험구', 2]]);
  for (const leak of [ADDR, '김고객', '010-9999', '공동현관']) assert.equal(JSON.stringify(open.json).includes(leak), false, leak);
  // 이 팩토리가 A/S 만 맡긴 2번에게는 설치 모집이 보이지 않고 신청도 안 된다
  assert.deepEqual((await call(fake, 't_w2', '/work/jobs?tab=open')).json.data.items, []);
  assert.equal((await call(fake, 't_w2', `/work/jobs/${job.id}`)).status, 404);
  assert.equal((await post(fake, 't_w2', `/work/jobs/${job.id}/apply`, {})).status, 409);

  // 신청 — 팩토리 대표 · 실장에게 알림 (이름 · 남긴 글 없음)
  const a5 = await post(fake, 't_w5', `/work/jobs/${job.id}/apply`, { message: '오전부터 가능합니다' });
  const a3 = await post(fake, 't_w3', `/work/jobs/${job.id}/apply`, {});
  assert.deepEqual([a5.status, a3.status], [201, 201], JSON.stringify([a5.json, a3.json]));
  const told = outbox(fake, 'work_reply').filter((n) => n.title === '작업 신청');
  assert.deepEqual(told.map((n) => n.user_id).sort(), [OWNER_A, OWNER_A, MANAGER_A, MANAGER_A].sort());
  for (const n of told) assert.equal(/시험기사|오전부터/.test(n.title + n.body), false);
  assert.equal(told[0].body, '작업자가 11/20(금) 설치 작업 모집에 신청했습니다. 일정에서 확인해 주세요.');

  // 팩토리 화면 — 신청한 순서대로 이름 · 남긴 글 · 때만 (작업자 id · 전화 없음)
  const seen = (await view(fake, 't_staff', S(1))).json.data.recruit;
  assert.deepEqual(seen.applications.map((x) => [x.application_id, x.name, x.message]), [[a5.json.data.id, '시험기사5', '오전부터 가능합니다'], [a3.json.data.id, '시험기사3', null]]);
  for (const leak of [W(5), W(3), PHONE, U(105)]) assert.equal(JSON.stringify(seen).includes(leak), false, leak);
  // 신청만 한 작업자에게 현장은 닫혀 있다
  const detail = (token) => call(fake, token, `/work/jobs/${job.id}`);
  assert.deepEqual([(await detail('t_w5')).json.data.site, (await detail('t_w5')).json.data.site_note], [null, SITE_NOTE]);

  // 뽑기 — 대표 · 실장만, 남의 팩토리는 404
  const pick = (token, id) => post(fake, token, `/company/work/applications/${id}/approve`);
  assert.deepEqual([(await pick('t_staff', a5.json.data.id)).json.code, (await pick('t_other', a5.json.data.id)).status], ['not_manager', 404]);
  const ok = await pick('t_owner', a5.json.data.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.data.application.status, ok.json.data.assignment.status], ['approved', 'confirmed']);
  assert.equal(asgOf(fake, W(5)).status, 'confirmed', '신청이 곧 수락 — 뽑으면 바로 확정');
  assert.equal(scheduleRow(fake, S(1)).assignee_name, '시험기사1 · 시험기사5');
  assert.deepEqual(outbox(fake, 'work_assigned').map((n) => [n.user_id, n.title]), [[U(105), '작업 확정']]);
  // 뽑힌 사람에게는 현장이 열리고, 신청만 한 3번에게는 여전히 닫혀 있다
  assert.equal((await detail('t_w5')).json.data.site.address, ADDR);
  assert.equal((await detail('t_w3')).json.data.site, null);
  assert.equal(JSON.stringify((await detail('t_w3')).json).includes(ADDR), false);

  // 1번도 수락하면 정원이 찬다 → 모집중 탭에서 사라지고 state full, 더 뽑으면 409
  await post(fake, 't_w1', `/work/assignments/${asgOf(fake, W(1)).id}/confirm`);
  const full = (await view(fake, 't_owner', S(1))).json.data;
  assert.deepEqual([full.job.status, full.recruit.state, full.recruit.filled, full.recruit.applications.length], ['filled', 'full', 2, 1]);
  assert.deepEqual((await call(fake, 't_w3', '/work/jobs?tab=open')).json.data.items, []);
  assert.equal((await pick('t_owner', a3.json.data.id)).status, 409);
  // 반려 — 대표 · 실장
  const no = await post(fake, 't_manager', `/company/work/applications/${a3.json.data.id}/reject`, { reason: '정원이 찼습니다' });
  assert.deepEqual([no.status, no.json.data.application.status], [200, 'rejected']);
  assert.deepEqual((await view(fake, 't_owner', S(1))).json.data.recruit.applications, []);
});

test('모집 내리기 — 지정으로 돌아가고 답을 기다리던 신청은 반려로 끝난다. 지원 종료일이 지나면 expired', async () => {
  const fake = world();
  await recruit(fake, 't_owner', S(1), { people: 2 });
  const job = jobOf(fake, S(1));
  assert.deepEqual([job.mode, job.slots, job.title, job.schedule_id], ['open', 2, '설치', S(1)]);
  const a5 = await post(fake, 't_w5', `/work/jobs/${job.id}/apply`, {});
  assert.equal(a5.status, 201, JSON.stringify(a5.json));
  // 지원 종료일이 지나면 작업자에게 안 보이고 팩토리 화면은 expired
  job.apply_deadline = iso('2026-11-13T09:00:00');
  assert.equal((await view(fake, 't_owner', S(1))).json.data.recruit.state, 'expired');
  assert.deepEqual((await call(fake, 't_w1', '/work/jobs?tab=open')).json.data.items, []);

  const down = await recruit(fake, 't_owner', S(1), { stop: true });
  assert.equal(down.status, 200, JSON.stringify(down.json));
  assert.deepEqual([jobOf(fake, S(1)).mode, jobOf(fake, S(1)).slots, jobOf(fake, S(1)).apply_deadline], ['invite', 1, null]);
  assert.deepEqual(down.json.data.recruit, { on: false, state: null, slots: 1, filled: 0, deadline: null, applications: [] });
  const app = fake.db.work_applications.find((x) => x.id === a5.json.data.id);
  assert.deepEqual([app.status, app.decide_reason, app.decided_by], ['rejected', RECRUIT_CLOSED, OWNER_A]);
  // 결정 사유는 작업자에게 나가지 않는다
  assert.equal(JSON.stringify((await call(fake, 't_w5', `/work/jobs/${job.id}`)).json).includes(RECRUIT_CLOSED), false);
  // 내린 뒤에는 모집중 탭에 없다 · 한 번 더 내려도 같은 결과
  assert.deepEqual((await call(fake, 't_w1', '/work/jobs?tab=open')).json.data.items, []);
  assert.equal((await recruit(fake, 't_owner', S(1), { stop: true })).status, 200);
  // 작업이 없는 줄에서 내리기 — 아무 일도 없다
  const none = await recruit(fake, 't_owner', S(3), { stop: true });
  assert.deepEqual([none.status, none.json.data.recruit, fake.db.work_jobs.length], [200, null, 1]);
});

test('모집 — 누가 · 무엇을 못 하나', async () => {
  const fake = world();
  const no = async (token, s, body, status, code) => {
    const r = await recruit(fake, token, s, body);
    assert.equal(r.status, status, `${token} ${s} ${JSON.stringify(r.json)}`);
    if (code) assert.equal(r.json.code, code);
  };
  await no('t_staff', S(1), { people: 1 }, 403, 'not_manager');
  await no('t_expert', S(30), { people: 1 }, 403, 'not_people_company');
  await no('t_other', S(1), { people: 1 }, 404); // 남의 일정
  await no('t_owner', S(5), { people: 1 }, 409, 'not_assignable'); // 실측 일정
  await no('t_owner', S(4), { people: 1 }, 409, 'closed'); // 끝난 일정
  await no('t_owner', S(1), {}, 422);
  await no('t_owner', S(1), { people: ASSIGN_MAX + 1 }, 422);
  await no('t_owner', S(1), { people: 1, apply_deadline: iso('2026-11-13T11:00:00') }, 422);
  await no('t_nobody', S(1), { people: 1 }, 403);
  assert.equal(fake.db.work_jobs.length, 0);
  // 남의 팩토리 작업의 신청 · 없는 신청 · 틀린 id
  await recruit(fake, 't_owner', S(1), { people: 1 });
  const app = await post(fake, 't_w5', `/work/jobs/${jobOf(fake, S(1)).id}/apply`, {});
  for (const act of ['approve', 'reject']) {
    assert.equal((await post(fake, 't_other', `/company/work/applications/${app.json.data.id}/${act}`)).status, 404, act);
    assert.equal((await post(fake, 't_owner', `/company/work/applications/${L(999)}/${act}`)).status, 404, act);
    assert.equal((await post(fake, 't_owner', `/company/work/applications/nope/${act}`)).status, 422, act);
    assert.equal((await post(fake, 't_staff', `/company/work/applications/${app.json.data.id}/${act}`)).json.code, 'not_manager', act);
  }
  // 신청한 뒤 연결이 끊긴 작업자는 뽑지 못한다
  fake.db.worker_companies.find((l) => l.id === L(6)).status = 'ended';
  const gone = await post(fake, 't_owner', `/company/work/applications/${app.json.data.id}/approve`);
  assert.equal(gone.status, 409, JSON.stringify(gone.json));
  assert.equal(fake.db.work_assignments.length, 0);
});

test('작업자가 연결을 끊으면 그 팩토리의 모집에 낸 대기 신청도 거둔다', async () => {
  const fake = world();
  await recruit(fake, 't_owner', S(1), { people: 1 });
  const job = jobOf(fake, S(1));
  const app = await post(fake, 't_w5', `/work/jobs/${job.id}/apply`, {});
  assert.equal(app.status, 201);
  const left = await post(fake, 't_w5', `/work/links/${L(6)}/leave`);
  assert.equal(left.status, 200, JSON.stringify(left.json));
  assert.equal(fake.db.work_applications.find((x) => x.id === app.json.data.id).status, 'withdrawn');
  assert.deepEqual((await view(fake, 't_owner', S(1))).json.data.recruit.applications, []);
});
