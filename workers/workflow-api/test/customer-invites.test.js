/**
 * 고객 초대 링크 (src/customer-invites.js · DB 0082) · 고객이 앱에서 설치 날 확인 · 바꿔 달라고 요청 (src/my-schedules.js).
 * 2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 — 「진행」.
 *
 * 고정하는 것
 *   1) DB 0082 전 — 목록 invite_ready false, 초대 만들기 409 db_pending
 *   2) 만들기 — 대표 · 실장 · 담당자, 진행 중 프로젝트만, 링크는 한 번만 보이고 DB 에는 해시만, 옛 링크는 거둔다,
 *      이미 이어진 고객 409, 남의 업체 404, 일지에 토큰 · 이름이 없다
 *   3) 미리보기 — 로그인 없이 업체 이름만 · 쓰지 않는다
 *   4) 잇기 — 로그인한 계정과 고객 줄을 잇고 한 번만, 거둠 · 만료 · 사용됨 410, 다른 계정 409, 그 업체의 다른 고객 줄 409 (링크는 그대로)
 *   5) 고객의 설치 날 — 「이 날 좋아요」 · 「바꿔 주세요」(업체 대표 · 실장 · 담당자 알림, 글 · 날짜는 알림에 없다) · 남의 일정 404 ·
 *      취소 일정 409 · 0082 전이면 요청만 409 · 업체가 날짜를 바꾸면 요청이 지워진다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { INVITE_DAYS, hashCustomerToken } from '../src/customer-invites.js';
import { CHANGE_NOTE_MAX } from '../src/my-schedules.js';
import { createFake, callWorker, ENV } from './helpers/distribution-fake.js';

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
const ME = uid(31); // 고객 계정
const OTHER = uid(32); // 다른 고객 계정
const CUS = rid(1); // 앱 계정 없는 고객
const CUS_LINKED = rid(2); // 이미 OTHER 와 이어진 고객
const CUS_B = rid(3);
const P1 = rid(11); // 진행 중 · 담당 STAFF
const P2 = rid(12); // 고객이 이미 이어졌다
const P3 = rid(13); // 보류
const PB = rid(15); // 남의 업체
const D1 = rid(21); // P1 의 설계
const S1 = rid(31); // P1 의 설치 일정
const S2 = rid(32); // P1 의 납품 일정
const S3 = rid(33); // P1 의 취소한 설치 일정

const FAR = '2099-01-05T05:00:00.000Z';

function tables({ invites = true } = {}) {
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
  const sched = (id, extra = {}) => ({
    id,
    design_id: D1,
    type: 'installation',
    status: 'scheduled',
    scheduled_at: FAR,
    customer_confirmed_at: null,
    customer_confirmed_by: null,
    customer_change_requested_at: null,
    customer_change_by: null,
    customer_change_note: null,
    ...extra,
  });
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
      { id: cid(9), kind: 'hq', name: '다담 공장', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    profiles: [{ id: OWNER, name: '가대표' }],
    customers: [
      { id: CUS, company_id: A, user_id: null, name: '김고객', phone: '010-1111-2222' },
      { id: CUS_LINKED, company_id: A, user_id: OTHER, name: '이고객', phone: null },
      { id: CUS_B, company_id: B, user_id: null, name: '박고객', phone: null },
    ],
    projects: [
      project(P1, { assignee_id: STAFF }),
      project(P2, { customer_id: CUS_LINKED }),
      project(P3, { status: 'on_hold' }),
      project(PB, { company_id: B, customer_id: CUS_B }),
    ],
    designs: [{ id: D1, company_id: A, project_id: P1, name: '예시 설계', user_id: OWNER }],
    design_schedules: [sched(S1), sched(S2, { type: 'delivery' }), sched(S3, { status: 'cancelled' })],
    project_events: [],
    ...(invites ? { customer_invites: [] } : {}),
  };
}

const call = (fake, path, token, opts) => callWorker(worker, fake, path, token, opts);
const invite = (fake, id = P1, token = OWNER) =>
  call(fake, `/company/projects/${id}/customer-invite`, token, { method: 'POST' });
const tokenOf = (url) => decodeURIComponent(String(url).split('#customer-invite=')[1] || '');
const accept = (fake, token, who = ME) => call(fake, '/customer-invites/accept', who, { method: 'POST', body: { token } });
const events = (fake) => fake.db.project_events.map((e) => e.type);

test('DB 0082 전 — 목록 invite_ready false, 초대 만들기 · 잇기 409 db_pending', async () => {
  const fake = createFake({ tables: tables({ invites: false }) });
  const l = await call(fake, '/company/projects', OWNER);
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.equal(l.json.data.invite_ready, false);
  const r = await invite(fake);
  assert.deepEqual([r.status, r.json.code], [409, 'db_pending']);
  const a = await accept(fake, 'x'.repeat(32));
  assert.deepEqual([a.status, a.json.code], [409, 'db_pending']);
});

test('만들기 — 링크는 한 번만 보이고 DB 에는 해시만, 만료 14일, 옛 링크는 거둔다, 일지에 토큰이 없다', async () => {
  const fake = createFake({ tables: tables() });
  const l = await call(fake, '/company/projects', OWNER);
  assert.equal(l.json.data.invite_ready, true);
  assert.equal(l.json.data.items.find((p) => p.id === P1).customer.app, false);
  assert.equal(l.json.data.items.find((p) => p.id === P2).customer.app, true);
  const r = await invite(fake);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const tok = tokenOf(r.json.data.url);
  assert.ok(r.json.data.url.includes('/segan/me.html#customer-invite='));
  assert.ok(tok.length >= 20);
  const [row] = fake.db.customer_invites;
  assert.equal(row.token_hash, await hashCustomerToken(ENV, tok));
  assert.ok(!JSON.stringify(row).includes(tok), 'DB 에는 평문 토큰이 없다');
  assert.deepEqual([row.company_id, row.customer_id, row.project_id, row.created_by], [A, CUS, P1, OWNER]);
  const days = (Date.parse(row.expires_at) - Date.now()) / 86400000;
  assert.ok(Math.abs(days - INVITE_DAYS) < 0.01, String(days));
  // 다시 만들면 옛 링크는 거둔다 — 살아 있는 것은 하나
  const again = await invite(fake, P1, STAFF);
  assert.equal(again.status, 201, '담당자도 만든다');
  assert.equal(fake.db.customer_invites.filter((x) => !x.revoked_at && !x.used_at).length, 1);
  assert.ok(fake.db.customer_invites[0].revoked_at);
  const gone = await accept(fake, tok);
  assert.deepEqual([gone.status], [410]);
  // 일지 — 종류 · id 만
  assert.deepEqual(events(fake), ['customer_invited', 'customer_invited']);
  for (const e of fake.db.project_events) {
    const text = JSON.stringify(e);
    assert.ok(!text.includes(tok) && !text.includes('김고객') && !text.includes('010'));
  }
});

test('만들기 — 누가 · 어느 프로젝트: 직원(담당 아님) 403, 보류 409, 이미 이어진 고객 409, 남의 업체 404, 실장 됨', async () => {
  const fake = createFake({ tables: tables() });
  const r = (id, who) => invite(fake, id, who).then((x) => [x.status, x.json.code || null]);
  assert.deepEqual(await r(P1, STAFF2), [403, 'not_allowed']);
  assert.deepEqual(await r(P3, OWNER), [409, 'not_active']);
  assert.deepEqual(await r(P2, OWNER), [409, 'already_linked']);
  assert.deepEqual((await r(PB, OWNER))[0], 404);
  assert.deepEqual((await r(P1, OWNER_B))[0], 404);
  assert.deepEqual(await r(P1, MANAGER), [201, null]);
});

test('미리보기 — 로그인 없이 업체 이름 · 만료만, 쓰지 않는다. 모르는 토큰 404 · 이상한 토큰 422', async () => {
  const fake = createFake({ tables: tables() });
  const tok = tokenOf((await invite(fake)).json.data.url);
  const p = await call(fake, '/customer-invites/peek', null, { method: 'POST', body: { token: tok } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.deepEqual(Object.keys(p.json.data).sort(), ['company_name', 'expires_at']);
  assert.equal(p.json.data.company_name, '가나 팩토리');
  assert.equal(fake.db.customer_invites[0].used_at || null, null);
  const unknown = await call(fake, '/customer-invites/peek', null, { method: 'POST', body: { token: 'y'.repeat(32) } });
  assert.equal(unknown.status, 404);
  const bad = await call(fake, '/customer-invites/peek', null, { method: 'POST', body: { token: 'short' } });
  assert.equal(bad.status, 422);
});

test('잇기 — 로그인한 계정과 고객 줄을 잇고 한 번만, 내 프로젝트에 보인다, 일지는 고객이', async () => {
  const fake = createFake({ tables: tables() });
  const tok = tokenOf((await invite(fake)).json.data.url);
  const noLogin = await call(fake, '/customer-invites/accept', null, { method: 'POST', body: { token: tok } });
  assert.equal(noLogin.status, 401);
  const a = await accept(fake, tok);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual(a.json.data, { project_id: P1, company_name: '가나 팩토리' });
  assert.equal(fake.db.customers.find((c) => c.id === CUS).user_id, ME);
  assert.deepEqual([fake.db.customer_invites[0].used_by, !!fake.db.customer_invites[0].used_at], [ME, true]);
  const twice = await accept(fake, tok, OTHER);
  assert.equal(twice.status, 410);
  const ev = fake.db.project_events.find((e) => e.type === 'customer_joined');
  assert.deepEqual([ev.actor_kind, ev.actor_user_id, ev.project_id], ['customer', ME, P1]);
  const mine = await call(fake, '/me/projects', ME);
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  // 그 고객 줄의 프로젝트가 모두 보인다 (P3 도 같은 고객)
  assert.deepEqual(mine.json.data.map((p) => p.id).sort(), [P1, P3].sort());
  // 그 줄의 설치 날 한 줄은 test/projects.test.js 가 본다 (이 가짜 DB 는 설계 잇기 읽기를 흉내 내지 않는다)
  // 목록에서 고객이 앱과 이어졌다
  const l = await call(fake, '/company/projects', OWNER);
  assert.equal(l.json.data.items.find((p) => p.id === P1).customer.app, true);
});

test('잇기 — 만료 410, 그 업체에 이 계정의 고객 줄이 따로 있으면 409 already_customer (링크는 다시 쓸 수 있다)', async () => {
  const fake = createFake({ tables: tables() });
  const tok = tokenOf((await invite(fake)).json.data.url);
  // OTHER 는 이미 이 업체의 다른 고객 줄(CUS_LINKED)과 이어져 있다
  const dup = await accept(fake, tok, OTHER);
  assert.deepEqual([dup.status, dup.json.code], [409, 'already_customer']);
  assert.equal(fake.db.customers.find((c) => c.id === CUS).user_id, null);
  assert.equal(fake.db.customer_invites[0].used_at || null, null, '링크는 쓰지 않았다');
  assert.equal((await accept(fake, tok)).status, 200);
  // 만료
  const old = createFake({ tables: tables() });
  const t2 = tokenOf((await invite(old)).json.data.url);
  old.db.customer_invites[0].expires_at = '2020-01-01T00:00:00Z';
  assert.equal((await accept(old, t2)).status, 410);
});

test('고객의 설치 날 — 「이 날 좋아요」는 확인 표시를 고객이, 「바꿔 주세요」는 요청 · 확인 지움 · 대표 · 실장 · 담당자 알림', async () => {
  const fake = createFake({ tables: tables() });
  fake.db.customers.find((c) => c.id === CUS).user_id = ME;
  const ok = await call(fake, `/me/schedules/${S1}/confirm`, ME, { method: 'POST' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const s = () => fake.db.design_schedules.find((x) => x.id === S1);
  assert.deepEqual([!!s().customer_confirmed_at, s().customer_confirmed_by], [true, ME]);
  const ev = fake.db.project_events.find((e) => e.type === 'schedule_confirmed');
  assert.deepEqual([ev.actor_kind, ev.payload && ev.payload.type], ['customer', 'installation']);

  const note = '오후 2시 뒤로 바꿔 주세요';
  const ch = await call(fake, `/me/schedules/${S1}/change`, ME, { method: 'POST', body: { note } });
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  assert.deepEqual(
    [!!s().customer_change_requested_at, s().customer_change_by, s().customer_change_note, s().customer_confirmed_at],
    [true, ME, note, null]
  );
  assert.equal(ch.json.data.customer_change_note, note);
  const sent = fake.db.notification_outbox.filter((n) => n.kind === 'install_change');
  assert.deepEqual(sent.map((n) => n.user_id).sort(), [OWNER, MANAGER, STAFF].sort());
  for (const n of sent) assert.ok(!JSON.stringify(n).includes(note) && !JSON.stringify(n).includes('2099'));
  assert.ok(events(fake).includes('install_change_requested'));
  for (const e of fake.db.project_events) assert.ok(!JSON.stringify(e).includes(note), '일지에 글이 없다');
  // 다시 요청하면 다시 알린다
  await call(fake, `/me/schedules/${S1}/change`, ME, { method: 'POST', body: {} });
  assert.equal(fake.db.notification_outbox.filter((n) => n.kind === 'install_change').length, 6);
  assert.equal(s().customer_change_note, null);
  // 다시 「좋아요」를 누르면 요청이 지워진다
  await call(fake, `/me/schedules/${S1}/confirm`, ME, { method: 'POST' });
  assert.deepEqual([s().customer_change_requested_at, !!s().customer_confirmed_at], [null, true]);
});

test('고객의 설치 날 — 남의 일정 · 납품 일정 404, 취소 일정 409, 글 200자, 0082 전이면 요청만 409', async () => {
  const fake = createFake({ tables: tables() });
  fake.db.customers.find((c) => c.id === CUS).user_id = ME;
  const post = (id, what, who = ME, body) => call(fake, `/me/schedules/${id}/${what}`, who, { method: 'POST', body });
  assert.equal((await post(S1, 'confirm', OTHER)).status, 404);
  assert.equal((await post(S1, 'confirm', OWNER)).status, 404, '업체 구성원도 이 길로는 못 한다');
  assert.equal((await post(S2, 'confirm')).status, 404);
  assert.deepEqual([(await post(S3, 'change')).status], [409]);
  assert.equal((await post(S1, 'change', ME, { note: '가'.repeat(CHANGE_NOTE_MAX + 1) })).status, 422);
  assert.equal((await post(S1, 'change', ME, { note: 3 })).status, 422);
  assert.equal((await post('bad', 'confirm')).status, 422);
  // 0082 전 — 요청 칸이 없다 (PGRST204)
  const before = createFake({
    tables: tables(),
    before: (method, table, params, body) =>
      table === 'design_schedules' && method === 'PATCH' && body && 'customer_change_requested_at' in body
        ? new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'customer_change_requested_at' column" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        : null,
  });
  before.db.customers.find((c) => c.id === CUS).user_id = ME;
  const ch = await call(before, `/me/schedules/${S1}/change`, ME, { method: 'POST', body: {} });
  assert.deepEqual([ch.status, ch.json.code], [409, 'db_pending']);
  const ok = await call(before, `/me/schedules/${S1}/confirm`, ME, { method: 'POST' });
  assert.equal(ok.status, 200, '확인은 된다');
  assert.ok(before.db.design_schedules.find((x) => x.id === S1).customer_confirmed_at);
});

test('업체가 설치 날을 바꾸거나 고객 확인을 표시하면 고객의 변경 요청이 지워진다', async () => {
  const fake = createFake({ tables: tables() });
  const s = () => fake.db.design_schedules.find((x) => x.id === S1);
  Object.assign(s(), { customer_change_requested_at: '2026-11-20T00:00:00Z', customer_change_by: ME, customer_change_note: '오후로' });
  const memo = await call(fake, `/schedules/${S1}`, OWNER, { method: 'PATCH', body: { notes: '메모만' } });
  assert.equal(memo.status, 200, JSON.stringify(memo.json));
  assert.ok(s().customer_change_requested_at, '날짜를 안 바꾸면 그대로');
  const moved = await call(fake, `/schedules/${S1}`, OWNER, { method: 'PATCH', body: { scheduled_at: '2099-01-06T05:00:00.000Z' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.deepEqual([s().customer_change_requested_at, s().customer_change_by, s().customer_change_note], [null, null, null]);
  Object.assign(s(), { customer_change_requested_at: '2026-11-21T00:00:00Z', customer_change_by: ME });
  const marked = await call(fake, `/schedules/${S1}`, OWNER, { method: 'PATCH', body: { customer_confirmed: true } });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  assert.deepEqual([s().customer_change_requested_at, !!s().customer_confirmed_at], [null, true]);
});
