/**
 * 팩토리의 작업자 — src/work/company.js 를 워커로 부른다 (2026-11-13 「작업자 한 길」, DB 0064).
 *   GET /company/workers · POST /company/workers/invites · POST …/invites/:id/revoke · PATCH /company/workers/:linkId
 *   + 작업자 쪽: POST /work/invites/peek · POST /work/claim-invite (팩토리 초대)
 *   + 작업자가 스스로 끊기: POST /work/links/:id/leave (2026-11-14)
 *   + 작업자 한 명 — 이력 · 메모: GET /company/workers/:linkId · POST …/notes (src/work/company-worker.js, DB 0066)
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { LINK_TRANSITIONS, LINK_STATUSES } from '../src/work/links.js';
import { hashInviteToken } from '../src/work/invites.js';
import { createFake, callWorker, ENV } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER_A = uid(11);
const MANAGER_A = uid(12);
const STAFF_A = uid(13);
const OWNER_B = uid(21);
const OWNER_E = uid(31);
const OWNER_HELD = uid(41);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(71);
const NOBODY = uid(90);
const U_W1 = uid(101);
const U_W2 = uid(102);
const U_W3 = uid(103);
const U_NEW = uid(104);
const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const E = cid(3);
const HELD = cid(4);
const W1 = rid(1);
const W2 = rid(2);
const W3 = rid(3);
const L_A1 = rid(11);
const L_A2 = rid(12);
const L_B1 = rid(13);
const L_A3 = rid(14);
const L_HELD = rid(15);
const JOB_A = rid(21);
const JOB_B = rid(22);
const INV_A = rid(31);
const INV_B = rid(32);
const JOB_A2 = rid(23);
const JOB_A3 = rid(24);
const PROJ_A = rid(51);
const MEMO = '주말에도 가능 · 상부장 설치가 꼼꼼하다';
const PHONE = '010-0000-0001';
const FAR = '2099-01-01T00:00:00.000Z';

const person = (id, user_id, display_name, status, kinds = ['install']) => ({
  id, user_id, display_name, phone: PHONE, kinds, region_label: '시험시 시험구', status, consent_version: 'v1',
  approved_by: null, approved_at: null, reject_reason: null, invited_via: null, created_at: '2026-11-01T00:00:00.000Z',
});
const link = (id, company_id, worker_id, status, patch = {}) => ({
  id, company_id, worker_id, status, kinds: ['install'], via: 'invite', invite_id: null, decided_by: null, decided_at: null, reason: null,
  created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z', ...patch,
});

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
      { id: E, kind: 'partner', name: '엑스퍼트 업체', plan: 'expert', status: 'active' },
      { id: HELD, kind: 'partner', name: '멈춘 업체', plan: 'agent', status: 'suspended' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: E, user_id: OWNER_E, role: 'owner', status: 'active' },
      { company_id: HELD, user_id: OWNER_HELD, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
    ],
    workers: [
      person(W1, U_W1, '시험기사A', 'approved'),
      person(W2, U_W2, '시험기사B', 'pending', ['as']),
      person(W3, U_W3, '시험기사C', 'suspended'),
    ],
    worker_companies: [
      link(L_A1, A, W1, 'approved'),
      link(L_A2, A, W2, 'pending', { kinds: ['as'], created_at: '2026-11-12T00:00:00.000Z' }),
      link(L_A3, A, W3, 'pending', { created_at: '2026-11-11T00:00:00.000Z' }),
      link(L_B1, B, W1, 'approved'),
      link(L_HELD, HELD, W1, 'pending'),
    ],
    worker_invites: [
      { id: INV_A, token_hash: 'hash-a', kinds_preset: ['install'], display_name_preset: null, expires_at: FAR, used_at: null, used_by: null, revoked_at: null, company_id: A, created_at: '2026-11-12T00:00:00.000Z' },
      { id: INV_B, token_hash: 'hash-b', kinds_preset: [], display_name_preset: null, expires_at: FAR, used_at: null, used_by: null, revoked_at: null, company_id: B, created_at: '2026-11-12T00:00:00.000Z' },
      { id: rid(33), token_hash: 'hash-old', kinds_preset: [], display_name_preset: null, expires_at: '2020-01-01T00:00:00.000Z', used_at: null, used_by: null, revoked_at: null, company_id: A, created_at: '2020-01-01T00:00:00.000Z' },
    ],
    work_jobs: [
      { id: JOB_A, company_id: A, kind: 'install', status: 'filled', title: '시험 설치', slots: 1, version: 0, starts_at: '2026-11-20T01:00:00.000Z', schedule_id: rid(61), project_id: null },
      { id: JOB_B, company_id: B, kind: 'install', status: 'filled', title: '남의 설치', slots: 2, version: 0, starts_at: '2026-11-21T01:00:00.000Z', schedule_id: rid(62), project_id: null },
    ],
    work_assignments: [
      { id: rid(41), job_id: JOB_A, worker_id: W1, status: 'confirmed' },
      { id: rid(42), job_id: JOB_B, worker_id: W1, status: 'started' },
      { id: rid(43), job_id: JOB_B, worker_id: W1, status: 'offered' },
    ],
    worker_events: [],
    work_job_events: [],
    work_applications: [],
    work_updates: [],
    factory_workers: [],
    worker_company_notes: [],
    projects: [{ id: PROJ_A, company_id: A, title: '시험 프로젝트' }],
    profiles: [{ id: OWNER_A, name: '시험대표' }, { id: MANAGER_A, name: null }],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeOf = (opts = {}) => createFake({ tables: tables(), ...opts });
const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const list = (fake, token) => call(fake, '/company/workers', token);
const patch = (fake, id, body, token = OWNER_A) => call(fake, `/company/workers/${id}`, token, { method: 'PATCH', body });
const invite = (fake, body, token = OWNER_A) => call(fake, '/company/workers/invites', token, { method: 'POST', body });
const linkRow = (fake, id) => fake.db.worker_companies.find((l) => l.id === id);
const outbox = (fake) => fake.db.notification_outbox;
const leave = (fake, id, token) => call(fake, `/work/links/${id}/leave`, token, { method: 'POST', body: {} });
const one = (fake, id, token = OWNER_A) => call(fake, `/company/workers/${id}`, token);
const note = (fake, id, body, token = OWNER_A) => call(fake, `/company/workers/${id}/notes`, token, { method: 'POST', body });

// ── 순수 ──────────────────────────────────────────────────────

test('연결 상태 — 대기 → 승인 · 반려, 승인 ↔ 정지, 승인 · 정지 → 끝. 반려 · 끝은 막다른 상태', () => {
  assert.deepEqual(LINK_STATUSES, ['pending', 'approved', 'suspended', 'rejected', 'ended']);
  assert.deepEqual(LINK_TRANSITIONS, {
    pending: ['approved', 'rejected'],
    approved: ['suspended', 'ended'],
    suspended: ['approved', 'ended'],
    rejected: [],
    ended: [],
  });
});

// ── 누가 ──────────────────────────────────────────────────────

test('구성원이 아니면 not_member, 다담 본사는 not_people_company, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  assert.equal((await list(fake, null)).status, 401);
  const n = await list(fake, NOBODY);
  assert.deepEqual([n.status, n.json.code], [403, 'not_member']);
  const p = await list(fake, PLATFORM_STAFF);
  assert.deepEqual([p.status, p.json.code], [403, 'not_people_company']);
});

test('목록 — 내 팩토리와 연결된 작업자만. 전화 · 초대는 대표 · 실장 답에만, 진행 중 배정은 내 팩토리 작업만 센다', async () => {
  const fake = fakeOf();
  const r = await list(fake, OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual([d.company, d.can_manage, d.can_invite], [{ name: '가나 인테리어' }, true, true]);
  // 새 것부터 — 대기(11-12) · 대기(11-11) · 승인(11-10)
  assert.deepEqual(d.workers.map((w) => [w.link_id, w.name, w.status, w.account_status, w.active]), [
    [L_A2, '시험기사B', 'pending', 'pending', 0],
    [L_A3, '시험기사C', 'pending', 'suspended', 0],
    [L_A1, '시험기사A', 'approved', 'approved', 1],
  ]);
  assert.deepEqual(d.workers[2], {
    link_id: L_A1, name: '시험기사A', kinds: ['install'], region: '시험시 시험구', status: 'approved', account_status: 'approved',
    via: 'invite', since: '2026-11-10T00:00:00.000Z', decided_at: null, reason: null, active: 1, phone: PHONE,
  });
  // 남은 초대 — 내 팩토리 것 · 안 쓴 것 · 기한 안 지난 것만
  assert.deepEqual(d.invites.map((i) => i.id), [INV_A]);
  assert.equal(JSON.stringify(d).includes('hash-a'), false, '토큰 해시는 싣지 않는다');
  for (const banned of [B, JOB_B, L_B1, INV_B, W1, U_W1]) assert.equal(JSON.stringify(d).includes(banned), false, banned);

  // 직원 — 보기만. 전화 · 초대가 없다
  const s = (await list(fake, STAFF_A)).json.data;
  assert.deepEqual([s.can_manage, s.can_invite, s.invites], [false, false, []]);
  assert.equal(s.workers.length, 3);
  assert.equal(JSON.stringify(s).includes(PHONE), false);

  // 남의 팩토리 — 자기 것만
  const b = (await list(fake, OWNER_B)).json.data;
  assert.deepEqual(b.workers.map((w) => [w.link_id, w.active]), [[L_B1, 2]]);
  assert.deepEqual(b.invites.map((i) => i.id), [INV_B]);
  // 다담 공장 — 연결이 없으면 빈 목록
  assert.deepEqual((await list(fake, FACTORY_OWNER)).json.data.workers, []);
});

test('Expert · 멈춘 팩토리 — 읽기는 되고(진행 중인 일 마무리) 새 초대 · 승인은 못 한다', async () => {
  const fake = fakeOf();
  const e = (await list(fake, OWNER_E)).json.data;
  assert.deepEqual([e.can_manage, e.can_invite, e.workers], [true, false, []]);
  const made = await invite(fake, { kinds_preset: ['install'], expires_at: FAR }, OWNER_E);
  assert.deepEqual([made.status, made.json.code], [403, 'not_people_company']);
  const h = (await list(fake, OWNER_HELD)).json.data;
  assert.deepEqual([h.can_invite, h.workers.map((w) => w.status)], [false, ['pending']]);
  const ok = await patch(fake, L_HELD, { status: 'approved' }, OWNER_HELD);
  assert.deepEqual([ok.status, ok.json.code], [403, 'not_people_company']);
  // 반려는 된다
  const no = await patch(fake, L_HELD, { status: 'rejected', reason: '연락이 닿지 않음' }, OWNER_HELD);
  assert.deepEqual([no.status, no.json.data.status, no.json.data.reason], [200, 'rejected', '연락이 닿지 않음']);
});

// ── 초대 ──────────────────────────────────────────────────────

test('초대 만들기 — 대표 · 실장만. 링크는 응답에서만, DB 에는 해시와 팩토리 칸. 만료일이 있어야 한다', async () => {
  const fake = fakeOf();
  assert.deepEqual([(await invite(fake, { kinds_preset: ['install'], expires_at: FAR }, STAFF_A)).json.code], ['not_manager']);
  assert.equal((await invite(fake, { kinds_preset: ['install'] })).status, 422, '만료일 없음');
  assert.equal((await invite(fake, { kinds_preset: ['install'], expires_at: '2020-01-01T00:00:00Z' })).status, 422, '지난 만료일');
  assert.equal((await invite(fake, { kinds_preset: ['welding'], expires_at: FAR })).status, 422, '모르는 종류');

  const r = await invite(fake, { kinds_preset: ['install', 'as'], display_name_preset: '시험초대', expires_at: FAR }, MANAGER_A);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.data.url, /\/segan\/work\.html#invite=[A-Za-z0-9_-]{30,}$/);
  const token = r.json.data.url.split('#invite=')[1];
  const row = fake.db.worker_invites.find((i) => i.id === r.json.data.id);
  assert.deepEqual([row.company_id, row.kinds_preset, row.display_name_preset, row.created_by], [A, ['install', 'as'], '시험초대', MANAGER_A]);
  assert.equal(row.token_hash, await hashInviteToken(ENV, token));
  assert.equal(JSON.stringify(fake.db.worker_invites).includes(token), false, '평문 토큰은 저장하지 않는다');
});

test('초대 거두기 — 내 팩토리 것만(남의 것 404), 여러 번 눌러도 같은 결과. 거둔 초대는 410', async () => {
  const fake = fakeOf();
  const revoke = (id, token = OWNER_A) => call(fake, `/company/workers/invites/${id}/revoke`, token, { method: 'POST' });
  assert.equal((await revoke(INV_B)).status, 404);
  assert.equal((await revoke(INV_A, STAFF_A)).json.code, 'not_manager');
  assert.equal((await revoke('nope')).status, 422);
  assert.deepEqual((await revoke(INV_A)).json.data, { id: INV_A, revoked: true });
  assert.ok(fake.db.worker_invites.find((i) => i.id === INV_A).revoked_at);
  assert.deepEqual((await revoke(INV_A)).json.data, { id: INV_A, revoked: true, used: false });
  assert.equal(fake.db.worker_invites.find((i) => i.id === INV_B).revoked_at, null);
  assert.deepEqual((await list(fake, OWNER_A)).json.data.invites, []);
});

test('팩토리 초대로 오면 — 처음인 사람은 작업자 대기 + 그 팩토리 연결 대기, 대표 · 실장에게 알림. 공장 Slack 은 안 간다', async () => {
  const fake = fakeOf();
  const made = await invite(fake, { kinds_preset: ['as'], display_name_preset: '새기사', expires_at: FAR });
  const token = made.json.data.url.split('#invite=')[1];

  const peek = await call(fake, '/work/invites/peek', U_NEW, { method: 'POST', body: { token } });
  assert.deepEqual(peek.json.data, { company_name: '가나 인테리어', kinds_preset: ['as'], expires_at: FAR, already_worker: false, link_status: null, job: null });
  assert.ok(!fake.db.worker_invites.find((i) => i.id === made.json.data.id).used_at, '미리보기는 초대를 쓰지 않는다');

  const claim = await call(fake, '/work/claim-invite', U_NEW, { method: 'POST', body: { token, consent_version: 'v1' } });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  assert.deepEqual([claim.json.data.status, claim.json.data.display_name, claim.json.data.kinds, claim.json.data.linked], ['pending', '새기사', ['as'], { company_name: '가나 인테리어', status: 'pending' }]);
  const w = fake.db.workers.find((x) => x.user_id === U_NEW);
  assert.deepEqual(fake.db.worker_companies.filter((l) => l.worker_id === w.id).map((l) => [l.company_id, l.status, l.via, l.kinds]), [[A, 'pending', 'invite', ['as']]]);
  // 대표 · 실장에게만, 업체 칸과 함께. 글에 이름 · 전화가 없다
  const sent = outbox(fake).filter((n) => n.kind === 'work_link_request');
  assert.deepEqual(sent.map((n) => [n.user_id, n.company_id]).sort(), [[OWNER_A, A], [MANAGER_A, A]].sort());
  for (const n of sent) assert.equal(/새기사|010/.test(n.title + n.body), false);
  assert.equal(sent[0].url, '/segan/me.html#workers');
  // 쓴 초대 · 없는 초대
  assert.equal((await call(fake, '/work/claim-invite', U_W2, { method: 'POST', body: { token } })).status, 410);
  assert.equal((await call(fake, '/work/invites/peek', U_NEW, { method: 'POST', body: { token: 'z'.repeat(32) } })).status, 404);
});

test('이미 작업자인 사람 — 신청서 없이 새 팩토리와 연결만 대기로. 이미 연결돼 있으면 409 already_linked (초대는 안 쓴다)', async () => {
  const fake = fakeOf();
  // W2(대기 계정)는 B 와 연결이 없다 → B 의 초대로 연결 신청
  const mk = async (token) => {
    const r = await invite(fake, { kinds_preset: ['install'], expires_at: FAR }, token);
    return [r.json.data.id, r.json.data.url.split('#invite=')[1]];
  };
  const [idB, tokB] = await mk(OWNER_B);
  const peek = await call(fake, '/work/invites/peek', U_W2, { method: 'POST', body: { token: tokB } });
  assert.deepEqual([peek.json.data.company_name, peek.json.data.already_worker, peek.json.data.link_status], ['다라 가구', true, null]);
  const claim = await call(fake, '/work/claim-invite', U_W2, { method: 'POST', body: { token: tokB } });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  assert.deepEqual(claim.json.data.linked, { company_name: '다라 가구', status: 'pending' });
  assert.equal(fake.db.workers.filter((w) => w.user_id === U_W2).length, 1, '작업자 행은 그대로 하나');
  assert.deepEqual(fake.db.worker_companies.filter((l) => l.worker_id === W2).map((l) => [l.company_id, l.status, l.invite_id]).sort(), [[A, 'pending', null], [B, 'pending', idB]].sort());

  // W1 은 A 와 이미 승인 연결 → 409, 초대는 그대로 남는다
  const [idA, tokA] = await mk(OWNER_A);
  const dup = await call(fake, '/work/claim-invite', U_W1, { method: 'POST', body: { token: tokA } });
  assert.deepEqual([dup.status, dup.json.code], [409, 'already_linked']);
  assert.ok(!fake.db.worker_invites.find((i) => i.id === idA).used_at);
  assert.equal((await call(fake, '/work/invites/peek', U_W1, { method: 'POST', body: { token: tokA } })).json.data.link_status, 'approved');
});

// ── 승인 · 반려 · 정지 · 끝 ─────────────────────────────────────

test('승인 — 대표 · 실장만. 처음 승인하면 계정도 승인, 작업자에게 팩토리 이름으로 알림, 이력에 member', async () => {
  const fake = fakeOf();
  assert.equal((await patch(fake, L_A2, { status: 'approved' }, STAFF_A)).json.code, 'not_manager');
  const r = await patch(fake, L_A2, { status: 'approved' }, MANAGER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.link_id, r.json.data.status, r.json.data.kinds], [L_A2, 'approved', ['as']]);
  assert.equal('company_id' in r.json.data || 'worker_id' in r.json.data, false);
  assert.deepEqual([linkRow(fake, L_A2).status, linkRow(fake, L_A2).decided_by], ['approved', MANAGER_A]);
  const w = fake.db.workers.find((x) => x.id === W2);
  assert.deepEqual([w.status, w.approved_by], ['approved', MANAGER_A]);
  const note = outbox(fake).filter((n) => n.kind === 'work_registration');
  assert.deepEqual(note.map((n) => [n.user_id, n.company_id || null, n.title, n.body]), [[U_W2, null, '팩토리 연결', '가나 인테리어 연결이 승인되었습니다. 작업 탭에서 확인해 주세요.']]);
  assert.deepEqual(fake.db.worker_events.map((e) => [e.worker_id, e.actor_kind, e.type, e.from_status, e.to_status]), [[W2, 'member', 'link_status_changed', 'pending', 'approved']]);
});

test('승인 — 본사가 전역 정지한 계정은 409 account_suspended (아무것도 안 바뀐다)', async () => {
  const fake = fakeOf();
  const r = await patch(fake, L_A3, { status: 'approved' });
  assert.deepEqual([r.status, r.json.code], [409, 'account_suspended']);
  assert.equal(linkRow(fake, L_A3).status, 'pending');
  assert.equal(fake.db.workers.find((x) => x.id === W3).status, 'suspended');
});

test('반려 · 정지 · 끝 · 종류 — 사유는 200자, 잘못된 전이는 409, 남의 연결은 404, 계정 상태는 건드리지 않는다', async () => {
  const fake = fakeOf();
  assert.equal((await patch(fake, L_B1, { status: 'suspended' })).status, 404, '남의 팩토리 연결');
  assert.equal((await patch(fake, 'nope', { status: 'suspended' })).status, 422);
  assert.equal((await patch(fake, L_A1, {})).status, 422, '바꿀 칸 없음');
  assert.equal((await patch(fake, L_A1, { status: 'gone' })).status, 422);
  assert.equal((await patch(fake, L_A1, { status: 'suspended', reason: 'x'.repeat(201) })).status, 422);
  const bad = await patch(fake, L_A1, { status: 'rejected' });
  assert.deepEqual([bad.status, bad.json.code], [409, 'bad_transition']);

  const s = await patch(fake, L_A1, { status: 'suspended', reason: '두 번 늦음' });
  assert.deepEqual([s.json.data.status, s.json.data.reason], ['suspended', '두 번 늦음']);
  assert.equal(fake.db.workers.find((x) => x.id === W1).status, 'approved', '계정은 그대로 — 다른 팩토리 일은 계속한다');
  assert.equal(linkRow(fake, L_B1).status, 'approved');
  const back = await patch(fake, L_A1, { status: 'approved' });
  assert.deepEqual([back.json.data.status, back.json.data.reason], ['approved', null]);
  const kinds = await patch(fake, L_A1, { kinds: ['install', 'as'] });
  assert.deepEqual([kinds.json.data.status, kinds.json.data.kinds], ['approved', ['install', 'as']]);
  const end = await patch(fake, L_A1, { status: 'ended' });
  assert.equal(end.json.data.status, 'ended');
  assert.equal((await patch(fake, L_A1, { status: 'approved' })).json.code, 'bad_transition', '끝난 연결은 다시 초대로');
  // 승인(정지를 푼 것 포함) · 반려는 알림이 간다, 정지 · 끝은 안 간다
  const r = await patch(fake, L_A2, { status: 'rejected', reason: '지역이 멀다' });
  assert.equal(r.json.data.status, 'rejected');
  assert.deepEqual(outbox(fake).filter((n) => n.kind === 'work_registration').map((n) => [n.user_id, n.body]), [
    [U_W1, '가나 인테리어 연결이 승인되었습니다. 작업 탭에서 확인해 주세요.'],
    [U_W2, '가나 인테리어 연결이 승인되지 않았습니다. 작업 탭에서 확인해 주세요.'],
  ]);
});

test('반려 · 끝난 연결은 다시 초대하면 같은 줄이 대기로 돌아간다', async () => {
  const fake = fakeOf();
  await patch(fake, L_A2, { status: 'rejected', reason: '지역이 멀다' });
  const made = await invite(fake, { kinds_preset: ['install'], expires_at: FAR });
  const token = made.json.data.url.split('#invite=')[1];
  const claim = await call(fake, '/work/claim-invite', U_W2, { method: 'POST', body: { token } });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  const rows = fake.db.worker_companies.filter((l) => l.worker_id === W2 && l.company_id === A);
  assert.deepEqual(rows.map((l) => [l.id, l.status, l.reason, l.kinds, l.invite_id]), [[L_A2, 'pending', null, ['install'], made.json.data.id]]);
});

// ── DB 전 · 겹침 ───────────────────────────────────────────────

test('DB 0064 적용 전이면 팩토리 경로는 409 db_pending', async () => {
  const fake = fakeOf({ before: (m, t) => (t === 'worker_companies' ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  for (const r of [await list(fake, OWNER_A), await patch(fake, L_A1, { status: 'suspended' })]) assert.deepEqual([r.status, r.json.code], [409, 'db_pending']);
});

test('그 사이 다른 사람이 바꿨으면 409 stale', async () => {
  let once = true;
  const fake = fakeOf({
    before: (m, t) => {
      if (m === 'PATCH' && t === 'worker_companies' && once) {
        once = false;
        fake.db.worker_companies.find((l) => l.id === L_A2).status = 'rejected';
      }
      return null;
    },
  });
  const r = await patch(fake, L_A2, { status: 'approved' });
  assert.deepEqual([r.status, r.json.code], [409, 'stale']);
  assert.equal(fake.db.workers.find((x) => x.id === W2).status, 'pending');
});

// ── 작업자가 스스로 끊기 (2026-11-14) ───────────────────────────

test('작업자가 스스로 연결을 끊는다 — 연결은 끝, 답 안 한 제안은 거절로, 수락한 작업은 그대로. 대표 · 실장에게 알림', async () => {
  const fake = fakeOf();
  // 팩토리 A 의 다른 작업에 답 안 한 제안이 하나 있다
  fake.db.work_jobs.push({ id: JOB_A2, company_id: A, kind: 'install', status: 'open', title: '설치', slots: 1, version: 0, starts_at: null, schedule_id: null, project_id: PROJ_A });
  fake.db.work_assignments.push({ id: rid(44), job_id: JOB_A2, worker_id: W1, status: 'offered', worker_name_snapshot: '시험기사A', created_at: '2026-11-13T00:00:00.000Z' });

  // 끊기 전 — 내 연결 목록에 연결 id 와 맡은 일 수 (팩토리 id 는 없다)
  const me = (await call(fake, '/work/me', U_W1)).json.data.links;
  assert.deepEqual(me.map((l) => [l.id, l.company_name, l.status, l.offered, l.working]).sort(), [
    [L_A1, '가나 인테리어', 'approved', 1, 1],
    [L_B1, '다라 가구', 'approved', 1, 1],
    [L_HELD, '멈춘 업체', 'pending', 0, 0],
  ].sort());
  for (const banned of [A, B, HELD]) assert.equal(JSON.stringify(me).includes(banned), false);

  const r = await leave(fake, L_A1, U_W1);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { id: L_A1, status: 'ended', company_name: '가나 인테리어', declined: 1, working: 1 });
  const row = linkRow(fake, L_A1);
  assert.deepEqual([row.status, row.decided_by, row.reason, !!row.decided_at], ['ended', U_W1, null, true]);
  // 답 안 한 제안은 거절로 끝나고 사유가 남는다 — 수락한 작업(확정)은 그대로, 남의 팩토리 제안도 그대로
  const asg = (id) => fake.db.work_assignments.find((x) => x.id === id);
  assert.deepEqual([asg(rid(44)).status, asg(rid(44)).release_reason], ['declined', '팩토리와의 연결을 끊어 제안이 끝났습니다']);
  assert.equal(asg(rid(41)).status, 'confirmed');
  assert.deepEqual([asg(rid(42)).status, asg(rid(43)).status], ['started', 'offered']);
  assert.equal(linkRow(fake, L_B1).status, 'approved', '다른 팩토리와의 연결은 그대로');
  // 이력 — 작업자 본인이 끊었다
  assert.deepEqual(fake.db.worker_events.map((e) => [e.type, e.actor_kind, e.from_status, e.to_status, e.payload.link_id]), [['link_left', 'worker', 'approved', 'ended', L_A1]]);
  // 대표 · 실장에게만 — 글에 이름 · 전화가 없다
  const sent = outbox(fake).filter((n) => n.kind === 'work_link_request');
  assert.deepEqual(sent.map((n) => [n.user_id, n.company_id, n.title]).sort(), [[OWNER_A, A, '작업자 연결 끊김'], [MANAGER_A, A, '작업자 연결 끊김']].sort());
  for (const n of sent) assert.equal(/시험기사|010/.test(n.title + n.body), false);
  assert.equal(outbox(fake).filter((n) => n.kind === 'work_reply').length, 0, '제안마다 따로 알리지 않는다');

  // 팩토리 화면 — 「작업자가 끊음」
  const w = (await list(fake, OWNER_A)).json.data.workers.find((x) => x.link_id === L_A1);
  assert.deepEqual([w.status, w.ended_by, w.active], ['ended', 'worker', 1]);
  // 내 연결 목록에서는 사라진다
  assert.deepEqual((await call(fake, '/work/me', U_W1)).json.data.links.map((l) => l.id).sort(), [L_B1, L_HELD].sort());

  // 한 번 더 눌러도 같은 결과 — 알림은 다시 가지 않는다
  const again = await leave(fake, L_A1, U_W1);
  assert.deepEqual([again.status, again.json.data.status], [200, 'ended']);
  assert.equal(outbox(fake).filter((n) => n.kind === 'work_link_request').length, 2);
});

test('연결 끊기 — 남의 연결 · 작업자가 아닌 사람 404, 대기는 신청 거두기(알림 없음), 반려는 409, 팩토리가 끊은 것은 company', async () => {
  const fake = fakeOf();
  assert.equal((await leave(fake, L_A2, U_W1)).status, 404, '남의 연결');
  assert.equal((await leave(fake, L_A1, NOBODY)).status, 404, '작업자가 아니다');
  assert.equal((await leave(fake, L_A1, OWNER_A)).status, 404, '팩토리 대표도 이 경로로는 못 끊는다');
  assert.equal((await leave(fake, 'not-a-uuid', U_W1)).status, 422);
  assert.equal((await leave(fake, L_A1, null)).status, 401);
  assert.equal(linkRow(fake, L_A1).status, 'approved');

  // 대기 중인 신청을 거둔다 (계정이 대기여도 된다) — 팩토리에 알리지 않는다
  const w = await leave(fake, L_A2, U_W2);
  assert.deepEqual([w.status, w.json.data.status, linkRow(fake, L_A2).status], [200, 'ended', 'ended']);
  assert.equal(outbox(fake).length, 0);
  // 정지된 계정도 정리는 된다
  assert.equal((await leave(fake, L_A3, U_W3)).status, 200);

  // 반려된 연결은 끊을 것이 없다
  const f2 = fakeOf();
  await patch(f2, L_A2, { status: 'rejected' });
  const no = await leave(f2, L_A2, U_W2);
  assert.equal(no.status, 409);
  // 팩토리가 끊은 연결은 company
  await patch(f2, L_A1, { status: 'ended' });
  assert.equal((await list(f2, OWNER_A)).json.data.workers.find((x) => x.link_id === L_A1).ended_by, 'company');
  // 끝나지 않은 연결에는 ended_by 가 없다
  assert.equal('ended_by' in (await list(f2, OWNER_A)).json.data.workers.find((x) => x.link_id === L_A3), false);
});

test('끊은 뒤 다시 초대하면 같은 줄이 대기로 돌아오고, 연결 신청 알림도 다시 간다', async () => {
  const fake = fakeOf();
  await leave(fake, L_A1, U_W1);
  const made = await invite(fake, { kinds_preset: ['install'], expires_at: FAR });
  const claim = await call(fake, '/work/claim-invite', U_W1, { method: 'POST', body: { token: made.json.data.url.split('#invite=')[1] } });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  assert.deepEqual([linkRow(fake, L_A1).status, linkRow(fake, L_A1).decided_by], ['pending', null]);
  const titles = outbox(fake).filter((n) => n.kind === 'work_link_request' && n.user_id === OWNER_A).map((n) => n.title);
  assert.deepEqual(titles, ['작업자 연결 끊김', '작업자 연결 신청']);
  // 다시 끊고 다시 신청해도 — 끊을 때마다 · 신청할 때마다 한 번씩
  await patch(fake, L_A1, { status: 'approved' });
  await new Promise((r) => setTimeout(r, 5));
  await leave(fake, L_A1, U_W1);
  assert.equal(outbox(fake).filter((n) => n.kind === 'work_link_request' && n.user_id === OWNER_A && n.title === '작업자 연결 끊김').length, 2);
});

// ── 작업자 한 명 — 이력 · 메모 (2026-11-14, DB 0066) ───────────────

function historyFake(opts) {
  const fake = fakeOf(opts);
  // 팩토리 A: 설치 일정 작업(확정 — 위에서) + 프로젝트 재단(확인함) + 프로젝트 조립(거절). 팩토리 B 작업은 A 에게 보이지 않는다
  fake.db.work_jobs.push(
    { id: JOB_A2, company_id: A, kind: 'cutting', status: 'done', title: '재단', slots: 1, version: 0, starts_at: '2026-11-05T01:00:00.000Z', schedule_id: null, project_id: PROJ_A },
    { id: JOB_A3, company_id: A, kind: 'assembly', status: 'open', title: '조립', slots: 1, version: 0, starts_at: null, schedule_id: null, project_id: PROJ_A },
  );
  fake.db.work_assignments.push(
    { id: rid(45), job_id: JOB_A2, worker_id: W1, status: 'accepted', no_show: false, created_at: '2026-11-04T00:00:00.000Z' },
    { id: rid(46), job_id: JOB_A3, worker_id: W1, status: 'declined', no_show: false, created_at: '2026-11-12T00:00:00.000Z' },
    { id: rid(47), job_id: JOB_A3, worker_id: W2, status: 'removed', no_show: true, created_at: '2026-11-12T00:00:00.000Z' },
  );
  fake.db.worker_events.push(
    { worker_id: W1, type: 'link_status_changed', actor_kind: 'member', from_status: 'pending', to_status: 'approved', payload: { link_id: L_A1 }, created_at: '2026-11-10T02:00:00.000Z' },
    { worker_id: W1, type: 'link_status_changed', actor_kind: 'member', from_status: 'pending', to_status: 'approved', payload: { link_id: L_B1 }, created_at: '2026-11-10T03:00:00.000Z' },
    { worker_id: W1, type: 'status_changed', actor_kind: 'admin', from_status: 'pending', to_status: 'approved', payload: {}, created_at: '2026-11-01T00:00:00.000Z' },
  );
  return fake;
}

test('작업자 한 명 — 내 팩토리에서 한 일만 · 이 연결의 이력만. 전화 · 메모는 대표 · 실장 답에만', async () => {
  const fake = historyFake();
  const r = await one(fake, L_A1);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual(
    [d.link_id, d.name, d.status, d.account_status, d.via, d.since, d.can_manage, d.phone],
    [L_A1, '시험기사A', 'approved', 'approved', 'invite', '2026-11-10T00:00:00.000Z', true, PHONE],
  );
  assert.deepEqual(d.counts, { done: 1, working: 1, offered: 0, declined: 1, released: 0, removed: 0, no_show: 0 });
  // 작업 날짜가 새 것부터 (날짜가 없으면 배정한 때) — 종류 · 날짜 · 상태 · 어디서 · 프로젝트 이름만
  assert.deepEqual(d.jobs, [
    { kind: 'install', label: '설치', at: '2026-11-20T01:00:00.000Z', status: 'confirmed', status_label: '확정', where: 'install', project: null, no_show: false },
    { kind: 'assembly', label: '조립', at: null, status: 'declined', status_label: '거절', where: 'project', project: '시험 프로젝트', no_show: false },
    { kind: 'cutting', label: '재단', at: '2026-11-05T01:00:00.000Z', status: 'accepted', status_label: '확인함', where: 'project', project: '시험 프로젝트', no_show: false },
  ]);
  // 이 연결의 이력만 — 다른 팩토리(B)와의 연결 · 계정 이력은 없다
  assert.deepEqual(d.events, [{ type: 'link_status_changed', from: 'pending', to: 'approved', by: 'member', at: '2026-11-10T02:00:00.000Z' }]);
  assert.deepEqual([d.notes, d.notes_pending], [[], false]);
  for (const banned of [B, JOB_B, L_B1, W1, U_W1, '남의 설치', '시험 설치']) assert.equal(JSON.stringify(d).includes(banned), false, banned);

  // 직원 — 이력은 보지만 전화 · 메모는 없다
  const s = (await one(fake, L_A1, STAFF_A)).json.data;
  assert.deepEqual([s.can_manage, 'phone' in s, 'notes' in s, s.jobs.length], [false, false, false, 3]);
  // 노쇼로 뺀 작업자
  const w2 = (await one(fake, L_A2)).json.data;
  assert.deepEqual([w2.counts.removed, w2.counts.no_show, w2.jobs.map((j) => [j.status, j.no_show])], [1, 1, [['removed', true]]]);
  // 남의 연결 · 없는 연결 · 본사 구성원
  assert.equal((await one(fake, L_A1, OWNER_B)).status, 404);
  assert.equal((await one(fake, rid(999))).status, 404);
  assert.equal((await one(fake, 'nope')).status, 422);
  assert.deepEqual([(await one(fake, L_A1, PLATFORM_STAFF)).json.code, (await one(fake, L_A1, NOBODY)).json.code], ['not_people_company', 'not_member']);
  // 팩토리 B 는 같은 작업자의 B 일만 본다
  const b = (await one(fake, L_B1, OWNER_B)).json.data;
  assert.deepEqual([b.jobs.map((j) => j.status).sort(), b.events.length], [['offered', 'started'], 1]);
});

test('메모 — 대표 · 실장만 남기고 읽는다. 쌓기만, 팩토리마다 따로, 작업자 본인에게는 나가지 않는다', async () => {
  const fake = historyFake();
  const made = await note(fake, L_A1, { body: `  ${MEMO}  ` });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(made.json.data.notes.map((n) => [n.body, n.by, n.mine]), [[MEMO, '시험대표', true]]);
  assert.deepEqual(fake.db.worker_company_notes.map((n) => [n.link_id, n.company_id, n.author, n.note]), [[L_A1, A, OWNER_A, MEMO]]);
  // 실장이 하나 더 — 새 것부터, 내가 남긴 것만 mine. 이름이 없는 구성원은 by 가 비어 있다
  fake.db.worker_company_notes[0].created_at = '2026-11-13T00:00:00.000Z';
  const second = await note(fake, L_A1, { body: '11월 설치 한 건 맡김' }, MANAGER_A);
  assert.equal(second.status, 201);
  fake.db.worker_company_notes[1].created_at = '2026-11-14T00:00:00.000Z';
  const seen = (await one(fake, L_A1)).json.data.notes;
  assert.deepEqual(seen.map((n) => [n.body, n.by, n.mine]), [['11월 설치 한 건 맡김', null, false], [MEMO, '시험대표', true]]);
  assert.equal(JSON.stringify(seen).includes(OWNER_A), false, '남긴 사람의 계정 id 는 싣지 않는다');

  // 직원은 못 남기고 못 읽는다 · 빈 글 · 1001자 · 남의 연결
  assert.deepEqual([(await note(fake, L_A1, { body: '직원 메모' }, STAFF_A)).json.code], ['not_manager']);
  assert.equal((await note(fake, L_A1, { body: '   ' })).status, 422);
  assert.equal((await note(fake, L_A1, { body: '가'.repeat(1001) })).status, 422);
  assert.equal((await note(fake, L_A1, { body: '가'.repeat(1000) })).status, 201);
  assert.equal((await note(fake, L_A1, { body: '남의 연결' }, OWNER_B)).status, 404);
  assert.equal(fake.db.worker_company_notes.length, 3);

  // 같은 작업자라도 팩토리 B 는 A 의 메모를 못 본다
  assert.deepEqual((await one(fake, L_B1, OWNER_B)).json.data.notes, []);
  // 작업자 본인 · 목록 응답에는 메모가 없다
  for (const path of ['/work/me', '/work/jobs?tab=mine', '/work/jobs?tab=done']) {
    assert.equal(JSON.stringify((await call(fake, path, U_W1)).json).includes('주말에도'), false, path);
  }
  assert.equal(JSON.stringify((await list(fake, OWNER_A)).json).includes('주말에도'), false);
  // 등급이 내려간 팩토리도 메모는 남긴다 (지난 일 정리) — 멈춘 팩토리의 대표
  assert.equal((await note(fake, L_HELD, { body: '멈춘 팩토리 메모' }, OWNER_HELD)).status, 201);
});

test('DB 0066 적용 전 — 이력은 그대로 보이고 메모는 「준비 중」(읽기 null · 쓰기 409 db_pending)', async () => {
  const fake = historyFake({ before: (m, t) => (t === 'worker_company_notes' ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  const d = (await one(fake, L_A1)).json.data;
  assert.deepEqual([d.notes, d.notes_pending, d.jobs.length, d.counts.done], [null, true, 3, 1]);
  const w = await note(fake, L_A1, { body: MEMO });
  assert.deepEqual([w.status, w.json.code], [409, 'db_pending']);
  // 연결 표도 없으면(0064 전) 전체가 db_pending
  const old = fakeOf({ before: (m, t) => (t === 'worker_companies' ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  assert.deepEqual([(await one(old, L_A1)).json.code, (await note(old, L_A1, { body: MEMO })).json.code], ['db_pending', 'db_pending']);
});
