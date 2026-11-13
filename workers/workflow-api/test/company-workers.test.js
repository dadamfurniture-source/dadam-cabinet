/**
 * 팩토리의 작업자 — src/work/company.js 를 워커로 부른다 (2026-11-13 「작업자 한 길」, DB 0064).
 *   GET /company/workers · POST /company/workers/invites · POST …/invites/:id/revoke · PATCH /company/workers/:linkId
 *   + 작업자 쪽: POST /work/invites/peek · POST /work/claim-invite (팩토리 초대)
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
      { id: JOB_A, company_id: A, kind: 'install', status: 'filled', title: '시험 설치' },
      { id: JOB_B, company_id: B, kind: 'install', status: 'filled', title: '남의 설치' },
    ],
    work_assignments: [
      { id: rid(41), job_id: JOB_A, worker_id: W1, status: 'confirmed' },
      { id: rid(42), job_id: JOB_B, worker_id: W1, status: 'started' },
      { id: rid(43), job_id: JOB_B, worker_id: W1, status: 'offered' },
    ],
    worker_events: [],
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
