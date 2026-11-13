/**
 * 프로젝트의 작업 배정 (src/work/project-work.js · invite-job.js) — 2026-11-13 「작업자 한 길」 둘째 묶음, DB 0065.
 *   GET|POST /company/projects/:id/work · PATCH …/work/:kind · POST …/work/invite
 *
 *   - 한 길: 작업 종류(철거 · 재단 · 엣지 · 조립 · 설치 · A/S) → 작업자 → 배정 → 승인(작업자 수락) → 연결
 *   - 철거 · 재단 · 엣지 · 조립은 프로젝트에 붙는 작업(프로젝트 하나 · 종류 하나), 설치 · A/S 는 일정 줄
 *   - 현장 일(철거)은 팩토리가 「확인」해야 끝나고 현장이 열린다. 공장 일(재단 · 엣지 · 조립)은 완료 보고로 끝난다
 *   - 「이 일로 바로」 초대: 처음 보는 작업자는 팩토리가 연결을 승인하면 그 작업에 배정 제안, 이미 연결된 작업자는 바로
 *   - 다른 팩토리의 프로젝트 · 연결은 404
 * 가짜 Supabase 는 test/helpers/push-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { ConflictError, clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { KIND_LABEL, PROJECT_KINDS, WORK_KINDS, kindsPending } from '../src/work/validate.js';
import { needsReview } from '../src/work/jobs.js';
import { SITE_KINDS } from '../src/work/reveal.js';
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
const AS = (i) => id('07', i);
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-13T12:00:00');
const FAR = '2099-01-01T00:00:00.000Z';

const HQ = C(100);
const A = C(1);
const B = C(2);
const E = C(3);
const OWNER_A = U(11);
const MANAGER_A = U(12);
const STAFF_A = U(13);
const OWNER_B = U(21);
const OWNER_E = U(31);
const U_NEW = U(200);
const PHONE = '010-0000-0001';
const ADDR = '시험시 시험구 시험로 1';

const person = (n, kinds, status = 'approved') => ({
  id: W(n), user_id: U(100 + n), display_name: `시험기사${n}`, phone: PHONE, kinds, region_label: '시험시 시험구', status, consent_version: 'v1',
});
const link = (n, company_id, worker_id, status = 'approved', kinds = []) => ({
  id: L(n), company_id, worker_id, status, kinds, via: 'invite', invite_id: null, created_at: iso(`2026-11-0${n}T09:00:00`),
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
    workers: [
      person(1, ['install', 'demolition']),
      person(2, ['cutting', 'edge']),
      person(3, ['assembly', 'cutting']),
      person(4, ['demolition'], 'suspended'),
      person(5, ['as', 'install']),
    ],
    worker_companies: [
      link(1, A, W(1)),
      link(2, A, W(2)),
      link(3, A, W(3), 'approved', ['assembly']), // 이 팩토리는 조립만 맡긴다
      link(4, A, W(4)), // 계정이 전역 정지
      link(5, A, W(5)),
      link(6, B, W(1)),
    ],
    customers: [{ id: id('0c', 1), company_id: A, name: '김고객', phone: '010-9999-9999' }],
    projects: [
      { id: P(1), company_id: A, customer_id: id('0c', 1), title: '김고객 주방', status: 'active' },
      { id: P(2), company_id: A, customer_id: id('0c', 1), title: '끝난 프로젝트', status: 'closed' },
      { id: P(9), company_id: B, customer_id: null, title: '남의 프로젝트', status: 'active' },
      { id: P(3), company_id: E, customer_id: null, title: '엑스퍼트 프로젝트', status: 'active' },
    ],
    designs: [
      { id: D(1), company_id: A, user_id: OWNER_A, name: '김고객 주방 설계', project_id: P(1) },
      { id: D(2), company_id: A, user_id: OWNER_A, name: '김고객 붙박이장', project_id: P(1) },
      { id: D(9), company_id: B, user_id: OWNER_B, name: '남의 설계', project_id: P(9) },
    ],
    design_site_info: [
      { design_id: D(1), address: ADDR, address_detail: '1동 1호', floor: '3', has_elevator: true, contact_name: '김고객', contact_phone: '010-9999-9999', access_note: '공동현관 0000', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, geo_address: ADDR },
    ],
    design_schedules: [
      { id: S(1), design_id: D(1), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-22T09:00:00'), duration_min: 120, assignee_name: null },
      { id: S(2), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-21T14:00:00'), duration_min: 60, assignee_name: null },
      { id: S(3), design_id: D(2), type: 'as_visit', title: 'A/S 방문', status: 'scheduled', scheduled_at: iso('2026-11-25T15:00:00'), duration_min: null, assignee_name: null },
      { id: S(4), design_id: D(1), type: 'installation', title: '설치', status: 'cancelled', scheduled_at: iso('2026-11-20T09:00:00'), duration_min: 60, assignee_name: null },
      { id: S(9), design_id: D(9), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-22T09:00:00'), duration_min: 60, assignee_name: null },
    ],
    orders: [
      { id: O(1), company_id: A, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', created_at: iso('2026-11-01T09:00:00') },
    ],
    as_requests: [{ id: AS(1), company_id: A, order_id: O(1), state: 'received', created_at: iso('2026-11-10T09:00:00'), body: 'x', visit_schedule_id: S(3) }],
    worker_invites: [],
    work_jobs: [],
    work_assignments: [],
    work_applications: [],
    work_updates: [],
    work_job_events: [],
    worker_events: [],
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
  t_w1: { id: U(101) },
  t_w2: { id: U(102) },
  t_w3: { id: U(103) },
  t_w5: { id: U(105) },
  t_new: { id: U_NEW },
};
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
      return { status: res.status, json: text ? JSON.parse(text) : null };
    });
  } finally {
    Date.now = realNow;
  }
}
const post = (fake, token, path, body = {}) => call(fake, token, path, { method: 'POST', body });
const view = (fake, token, p = P(1)) => call(fake, token, `/company/projects/${p}/work`);
const assign = (fake, token, body, p = P(1)) => post(fake, token, `/company/projects/${p}/work`, body);
const rowOf = (r, key) => r.json.data.rows.find((x) => x.key === key);
const jobOf = (fake, kind) => fake.db.work_jobs.find((j) => j.kind === kind && j.status !== 'cancelled');
const asgOf = (fake, workerId) => fake.db.work_assignments.filter((a) => a.worker_id === workerId).pop();
const outbox = (fake, kind) => fake.db.notification_outbox.filter((n) => n.kind === kind);
const tokenOf = (url) => url.split('#invite=')[1];
/** DB 0065 적용 전 — 작업의 프로젝트 칸 · 초대의 작업 칸이 없다 */
function before0065(fake) {
  const inner = fake.fetch;
  fake.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
    const rest = url.includes('/rest/v1/') ? url.split('/rest/v1/')[1] : '';
    const body = String(init.body || '');
    const newCol =
      (rest.startsWith('work_jobs') && (rest.includes('project_id') || body.includes('"project_id"'))) ||
      (rest.startsWith('worker_invites') && (rest.includes('job_id') || body.includes('"job_id"')));
    if (newCol) {
      return new Response(JSON.stringify({ code: '42703', message: 'column does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
  return fake;
}

// ── 순수 ──────────────────────────────────────────────────────────

test('순수 — 종류 여섯, 프로젝트 줄 차례는 일하는 차례. 현장 일은 확인 · 현장 공개, 공장 일은 완료 보고로 끝', () => {
  assert.deepEqual([...WORK_KINDS], ['install', 'as', 'assembly', 'cutting', 'edge', 'demolition']);
  assert.deepEqual([...PROJECT_KINDS], ['demolition', 'cutting', 'edge', 'assembly']);
  assert.deepEqual(PROJECT_KINDS.map((k) => KIND_LABEL[k]), ['철거', '재단', '엣지', '조립']);
  assert.deepEqual(WORK_KINDS.filter((k) => needsReview(k)), ['install', 'as', 'demolition']);
  assert.deepEqual([...SITE_KINDS], ['install', 'as', 'demolition']);
  // DB 가 새 종류 · 새 칸을 모르면 409 db_pending, 그 밖의 오류는 그대로
  for (const text of ['23514 violates check constraint', '42703 column does not exist', 'PGRST204']) {
    const e = kindsPending(new Error(text));
    assert.ok(e instanceof ConflictError && e.code === 'db_pending', text);
  }
  const other = new Error('23505 duplicate');
  assert.equal(kindsPending(other), other);
});

// ── 읽기 ──────────────────────────────────────────────────────────

test('읽기 — 철거 · 재단 · 엣지 · 조립 줄 + 그 프로젝트의 설치 · A/S 일정 줄. 종류마다 고를 수 있는 작업자', async () => {
  const fake = world();
  const r = await view(fake, 't_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual(d.project, { id: P(1), title: '김고객 주방', status: 'active' });
  assert.deepEqual([d.can_manage, d.can_assign], [true, true]);
  assert.deepEqual(d.rows.map((x) => [x.key, x.label, x.source, x.at]), [
    ['kind:demolition', '철거', 'project', null],
    ['kind:cutting', '재단', 'project', null],
    ['kind:edge', '엣지', 'project', null],
    ['kind:assembly', '조립', 'project', null],
    [`schedule:${S(1)}`, '설치', 'schedule', iso('2026-11-22T09:00:00')],
    [`schedule:${S(3)}`, 'A/S 방문', 'schedule', iso('2026-11-25T15:00:00')],
  ]);
  // 종류가 맞는 사람만 (3번은 이 팩토리가 조립만 맡김 · 4번은 계정 정지)
  const cands = Object.fromEntries(d.rows.map((x) => [x.kind, x.candidates.map((c) => c.link_id)]));
  assert.deepEqual(cands, { demolition: [L(1)], cutting: [L(2)], edge: [L(2)], assembly: [L(3)], install: [L(1), L(5)], as: [L(5)] });
  for (const x of d.rows) assert.deepEqual([x.job, x.workers, x.can_assign], [null, [], true], x.key);
  const text = JSON.stringify(r.json);
  for (const leak of [W(1), PHONE, U(101), '010-9999', ADDR]) assert.equal(text.includes(leak), false, leak);

  // 직원은 보기만 · 인사를 못 쓰는 등급은 새 배정을 못 한다 · 끝난 프로젝트도
  const staff = await view(fake, 't_staff');
  assert.deepEqual([staff.status, staff.json.data.can_manage, staff.json.data.can_assign], [200, false, false]);
  const expert = await view(fake, 't_expert', P(3));
  assert.deepEqual([expert.status, expert.json.data.can_assign, expert.json.data.rows.length], [200, false, 4]);
  assert.equal((await view(fake, 't_owner', P(2))).json.data.can_assign, false);
  // 남의 프로젝트 · 구성원 아님 · 틀린 id
  assert.equal((await view(fake, 't_owner', P(9))).status, 404);
  assert.equal((await view(fake, 't_other', P(1))).status, 404);
  assert.equal((await view(fake, 't_nobody', P(1))).status, 403);
  assert.equal((await view(fake, 't_owner', 'nope')).status, 422);
});

// ── 배정 ──────────────────────────────────────────────────────────

test('배정 — 철거: 작업이 없으면 만들고 수락 대기로. 제목은 종류 이름뿐, 프로젝트 · 가장 새 수주의 설계에 잇는다', async () => {
  const fake = world();
  const r = await assign(fake, 't_owner', { kind: 'demolition', link_ids: [L(1)], at: '2026-11-18T09:00:00+09:00' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const job = jobOf(fake, 'demolition');
  assert.deepEqual(
    { kind: job.kind, title: job.title, mode: job.mode, status: job.status, slots: job.slots, company_id: job.company_id, project_id: job.project_id, design_id: job.design_id, order_id: job.order_id, starts_at: job.starts_at, ends_at: job.ends_at, region_label: job.region_label, schedule_id: job.schedule_id || null },
    { kind: 'demolition', title: '철거', mode: 'invite', status: 'open', slots: 1, company_id: A, project_id: P(1), design_id: D(1), order_id: O(1), starts_at: iso('2026-11-18T09:00:00'), ends_at: null, region_label: '시험시 시험구', schedule_id: null },
  );
  assert.equal(JSON.stringify(job).includes('김고객'), false, '프로젝트 · 설계 이름(고객 이름이 들어 있을 수 있다)은 작업에 싣지 않는다');
  const a = asgOf(fake, W(1));
  assert.deepEqual([a.job_id, a.status, a.via, a.worker_name_snapshot], [job.id, 'offered', 'invite', '시험기사1']);
  const row = rowOf(r, 'kind:demolition');
  assert.deepEqual([row.at, row.job, row.workers.map((w) => [w.name, w.label]), row.candidates], [iso('2026-11-18T09:00:00'), { id: job.id, status: 'open' }, [['시험기사1', '수락 대기']], []]);
  assert.deepEqual(outbox(fake, 'work_invited').map((n) => [n.user_id, n.body]), [[U(101), '11/18(수) 철거 작업에 초대받았습니다. 수락하거나 거절해 주세요.']]);
  assert.deepEqual(fake.db.work_job_events.map((e) => [e.type, e.actor_kind]), [['job_created', 'member'], ['assignment_offered', 'member']]);
  // 같은 사람 또 → 409, 같은 종류에 작업이 둘 생기지 않는다
  assert.equal((await assign(fake, 't_owner', { kind: 'demolition', link_ids: [L(1)] })).status, 409);
  assert.equal(fake.db.work_jobs.length, 1);
});

test('배정 — 누가 · 무엇을 못 하나', async () => {
  const fake = world();
  const no = async (token, body, status, code, p) => {
    const r = await assign(fake, token, body, p);
    assert.equal(r.status, status, `${token} ${JSON.stringify(body)} ${JSON.stringify(r.json)}`);
    if (code) assert.equal(r.json.code, code);
  };
  await no('t_staff', { kind: 'cutting', link_ids: [L(2)] }, 403, 'not_manager');
  await no('t_expert', { kind: 'cutting', link_ids: [L(2)] }, 403, 'not_people_company', P(3));
  await no('t_other', { kind: 'cutting', link_ids: [L(6)] }, 404); // 남의 프로젝트
  await no('t_owner', { kind: 'demolition', link_ids: [L(6)] }, 404); // 남의 연결
  await no('t_owner', { kind: 'demolition', link_ids: [L(4)] }, 409); // 계정 정지
  await no('t_owner', { kind: 'cutting', link_ids: [L(3)] }, 409); // 이 팩토리는 조립만 맡김
  await no('t_owner', { kind: 'edge', link_ids: [L(1)] }, 409); // 종류가 다름
  await no('t_owner', { kind: 'install', link_ids: [L(1)] }, 422); // 설치 · A/S 는 일정 줄에서
  await no('t_owner', { kind: 'paint', link_ids: [L(1)] }, 422);
  await no('t_owner', { kind: 'cutting', link_ids: [] }, 422);
  await no('t_owner', { kind: 'cutting', link_ids: [L(2)], at: 'nope' }, 422);
  await no('t_owner', { kind: 'cutting', link_ids: [L(2)] }, 409, 'closed', P(2)); // 끝난 프로젝트
  assert.equal(fake.db.work_jobs.length, 0);
  assert.equal(fake.db.work_assignments.length, 0);
});

// ── 작업자의 수락 → 연결 ────────────────────────────────────────────

test('공장 일(재단) — 작업자가 수락하면 연결, 완료 보고로 끝난다. 팩토리 알림은 프로젝트 화면으로', async () => {
  const fake = world();
  await assign(fake, 't_owner', { kind: 'cutting', link_ids: [L(2)] });
  const a = asgOf(fake, W(2));
  assert.equal((await post(fake, 't_w2', `/work/assignments/${a.id}/confirm`)).status, 200);
  const reply = outbox(fake, 'work_reply');
  assert.deepEqual(reply.map((n) => [n.user_id, n.company_id]).sort(), [[OWNER_A, A], [MANAGER_A, A]].sort());
  assert.deepEqual([reply[0].body, reply[0].url], ['작업자가 재단 작업 배정을 수락했습니다. 프로젝트에서 확인해 주세요.', '/segan/me.html#dash-project']);
  // 현장이 없는 종류 — 수락해도 현장 칸 · 안내가 없다
  const detail = await call(fake, 't_w2', `/work/jobs/${a.job_id}`);
  assert.deepEqual([detail.status, detail.json.data.kind, detail.json.data.site, detail.json.data.site_note], [200, 'cutting', null, null]);
  await post(fake, 't_w2', `/work/assignments/${a.id}/start`);
  const done = await post(fake, 't_w2', `/work/assignments/${a.id}/updates`, { kind: 'result', body: '재단을 마쳤습니다' });
  assert.equal(done.status, 201, JSON.stringify(done.json));
  assert.deepEqual([asgOf(fake, W(2)).status, jobOf(fake, 'cutting').status], ['accepted', 'done'], '검수 없이 끝난다');
  assert.equal(outbox(fake, 'work_report')[0].body, '재단 작업 완료 보고가 왔습니다. 프로젝트에서 확인해 주세요.');
  const row = rowOf(await view(fake, 't_staff'), 'kind:cutting');
  assert.deepEqual([row.workers[0].label, row.workers[0].reports.map((u) => u.body), row.can_assign], ['확인함', ['재단을 마쳤습니다'], false]);
});

test('현장 일(철거) — 수락하면 현장이 열리고, 완료 보고를 팩토리가 「확인」해야 끝난다', async () => {
  const fake = world();
  await assign(fake, 't_owner', { kind: 'demolition', link_ids: [L(1)], at: '2026-11-18T09:00:00+09:00' });
  const a = asgOf(fake, W(1));
  const detail = () => call(fake, 't_w1', `/work/jobs/${a.job_id}`);
  assert.equal((await detail()).json.data.site, null, '수락 전에는 닫힘');
  await post(fake, 't_w1', `/work/assignments/${a.id}/confirm`);
  assert.equal((await detail()).json.data.site.address, ADDR);
  await post(fake, 't_w1', `/work/assignments/${a.id}/start`);
  await post(fake, 't_w1', `/work/assignments/${a.id}/updates`, { kind: 'result', body: '철거를 마쳤습니다' });
  assert.deepEqual([asgOf(fake, W(1)).status, jobOf(fake, 'demolition').status], ['submitted', 'review']);
  // 확인을 기다리는 완료 보고 — 인사 › 작업자 응답에 「프로젝트의 작업」으로 (종류 · 시각만)
  const waiting = await call(fake, 't_owner', '/company/workers');
  assert.equal(waiting.status, 200, JSON.stringify(waiting.json));
  assert.deepEqual(waiting.json.data.unconfirmed, { total: 1, items: [{ kind: 'demolition', at: new Date('2026-11-18T09:00:00+09:00').toISOString(), where: 'project' }] });
  const ok = await post(fake, 't_manager', `/company/work/assignments/${a.id}/accept`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([asgOf(fake, W(1)).status, jobOf(fake, 'demolition').status], ['accepted', 'done']);
  assert.equal((await call(fake, 't_owner', '/company/workers')).json.data.unconfirmed.total, 0);
  // 남의 팩토리 대표는 이 배정을 못 건드린다
  assert.equal((await post(fake, 't_other', `/company/work/assignments/${a.id}/remove`, { reason: 'x' })).status, 404);
});

// ── 날짜 ──────────────────────────────────────────────────────────

test('날짜 — 줄의 날짜를 정하면 작업이 생기고, 바꾸면 배정된 작업자에게 알린다', async () => {
  const fake = world();
  const set = (kind, at, token = 't_owner') => call(fake, token, `/company/projects/${P(1)}/work/${kind}`, { method: 'PATCH', body: { at } });
  const first = await set('assembly', '2026-11-20T09:00:00+09:00');
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual([rowOf(first, 'kind:assembly').at, jobOf(fake, 'assembly').slots, fake.db.work_assignments.length], [iso('2026-11-20T09:00:00'), 1, 0]);
  await assign(fake, 't_owner', { kind: 'assembly', link_ids: [L(3)] });
  assert.equal(fake.db.work_jobs.length, 1, '날짜로 만든 작업에 그대로 배정한다');
  const moved = await set('assembly', '2026-11-21T13:00:00+09:00');
  assert.equal(rowOf(moved, 'kind:assembly').at, iso('2026-11-21T13:00:00'));
  assert.deepEqual(outbox(fake, 'work_schedule').map((n) => n.user_id), [U(103)]);
  // 같은 날짜면 건드리지 않는다 · 날짜 비우기
  const v = jobOf(fake, 'assembly').version;
  await set('assembly', '2026-11-21T13:00:00+09:00');
  assert.equal(jobOf(fake, 'assembly').version, v);
  assert.equal(rowOf(await set('assembly', null), 'kind:assembly').at, null);
  // 누가 · 무엇을
  assert.equal((await set('assembly', '2026-11-20T09:00:00+09:00', 't_staff')).status, 403);
  assert.equal((await set('install', '2026-11-20T09:00:00+09:00')).status, 422, '설치 날짜는 일정에서');
  assert.equal((await call(fake, 't_owner', `/company/projects/${P(1)}/work/edge`, { method: 'PATCH', body: {} })).status, 422);
  assert.equal(jobOf(fake, 'edge'), undefined, '날짜가 비면 작업을 만들지 않는다');
});

// ── 「이 일로 바로」 초대 ───────────────────────────────────────────

test('이 일로 바로 — 처음 보는 작업자: 초대 → 연결 신청 → 팩토리 승인 → 그 작업에 배정 제안 → 작업자 수락 → 연결', async () => {
  const fake = world();
  const made = await post(fake, 't_owner', `/company/projects/${P(1)}/work/invite`, { kind: 'demolition', expires_at: FAR, display_name_preset: '시험새' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const job = jobOf(fake, 'demolition');
  const invite = fake.db.worker_invites[0];
  assert.deepEqual([invite.company_id, invite.job_id, invite.kinds_preset, job.project_id, fake.db.work_assignments.length], [A, job.id, ['demolition'], P(1), 0]);
  assert.match(made.json.data.url, /^https:\/\/app\.test\/segan\/work\.html#invite=/);
  const token = tokenOf(made.json.data.url);

  // 누르기 전 — 어느 팩토리의 어떤 일인지 (종류 · 날짜만)
  const peek = await post(fake, 't_new', '/work/invites/peek', { token });
  assert.deepEqual(peek.json.data, { company_name: '가나 인테리어', kinds_preset: ['demolition'], expires_at: FAR, already_worker: false, link_status: null, job: { kind: 'demolition', label: '철거', starts_at: null } });

  const claim = await post(fake, 't_new', '/work/claim-invite', { token, consent_version: 'v1' });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  const me = fake.db.workers.find((w) => w.user_id === U_NEW);
  const myLink = fake.db.worker_companies.find((l) => l.worker_id === me.id);
  assert.deepEqual([me.status, me.kinds, myLink.status, myLink.invite_id, fake.db.work_assignments.length], ['pending', ['demolition'], 'pending', invite.id, 0], '승인 전에는 배정이 없다');

  // 팩토리가 승인 → 계정 승인 + 그 작업에 배정 제안
  const ok = await call(fake, 't_owner', `/company/workers/${myLink.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const a = asgOf(fake, me.id);
  assert.deepEqual([a.job_id, a.status, a.created_by], [job.id, 'offered', OWNER_A]);
  assert.deepEqual(outbox(fake, 'work_invited').map((n) => n.user_id), [U_NEW]);
  assert.deepEqual(rowOf(await view(fake, 't_owner'), 'kind:demolition').workers.map((w) => [w.name, w.label]), [['시험새', '수락 대기']]);

  // 작업자가 수락 → 확정(연결)
  const yes = await post(fake, 't_new', `/work/assignments/${a.id}/confirm`);
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  assert.equal(asgOf(fake, me.id).status, 'confirmed');
});

test('이 일로 바로 — 이미 연결된 작업자가 열면 바로 배정 제안. 설치는 그 프로젝트의 일정에 붙는다', async () => {
  const fake = world();
  const made = await post(fake, 't_manager', `/company/projects/${P(1)}/work/invite`, { kind: 'install', schedule_id: S(1), expires_at: FAR });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const job = jobOf(fake, 'install');
  assert.deepEqual([job.schedule_id, job.title, fake.db.worker_invites[0].job_id], [S(1), '설치', job.id]);
  const token = tokenOf(made.json.data.url);
  const peek = await post(fake, 't_w5', '/work/invites/peek', { token });
  assert.deepEqual([peek.json.data.link_status, peek.json.data.job], ['approved', { kind: 'install', label: '설치', starts_at: iso('2026-11-22T09:00:00') }]);
  const claim = await post(fake, 't_w5', '/work/claim-invite', { token });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  assert.deepEqual([claim.json.data.linked, claim.json.data.offered_job_id], [{ company_name: '가나 인테리어', status: 'approved' }, job.id]);
  assert.deepEqual([asgOf(fake, W(5)).status, fake.db.design_schedules.find((s) => s.id === S(1)).assignee_name], ['offered', '시험기사5']);
  assert.ok(fake.db.worker_invites[0].used_at, '초대는 한 번만 쓴다');
  assert.equal((await post(fake, 't_w1', '/work/claim-invite', { token })).status, 410);

  // 못 하는 것 — 직원 · 남의 일정 · 납품 줄 · 취소한 일정 · 종류가 다른 일정 · 만료 없음
  const bad = async (token2, body, status) => assert.equal((await post(fake, token2, `/company/projects/${P(1)}/work/invite`, body)).status, status, JSON.stringify(body));
  await bad('t_staff', { kind: 'cutting', expires_at: FAR }, 403);
  await bad('t_owner', { kind: 'install', schedule_id: S(9), expires_at: FAR }, 404);
  await bad('t_owner', { kind: 'install', schedule_id: S(2), expires_at: FAR }, 404);
  await bad('t_owner', { kind: 'install', schedule_id: S(4), expires_at: FAR }, 409);
  await bad('t_owner', { kind: 'as', schedule_id: S(1), expires_at: FAR }, 404);
  await bad('t_owner', { kind: 'cutting' }, 422);
});

test('DB 0065 적용 전 — 프로젝트 작업 경로는 409 db_pending. 일정 줄 배정은 그대로 된다', async () => {
  const fake = before0065(world());
  for (const r of [
    await view(fake, 't_owner'),
    await assign(fake, 't_owner', { kind: 'cutting', link_ids: [L(2)] }),
    await post(fake, 't_owner', `/company/projects/${P(1)}/work/invite`, { kind: 'cutting', expires_at: FAR }),
  ]) {
    assert.deepEqual([r.status, r.json.code], [409, 'db_pending'], JSON.stringify(r.json));
  }
  const sched = await post(fake, 't_owner', `/company/schedules/${S(1)}/workers`, { link_ids: [L(1)] });
  assert.equal(sched.status, 200, JSON.stringify(sched.json));
});
