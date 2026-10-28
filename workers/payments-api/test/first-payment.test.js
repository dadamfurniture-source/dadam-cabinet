/**
 * 첫 결제 (POST /issue-billing-key) = 업체 구독 시작 · 해지 (POST /cancel).
 *
 * 고정하는 것:
 *   - Expert · Agent 결제는 모두 업체 구독이다. 결제 전에 막는다: 본사 구성원 · 대표 아님 · 이미 구독 중 ·
 *     업체 등급과 다른 plan · Expert 업체 이름 · 지역 없음 · Agent 승인 없음 — 토스를 부르지 않는다
 *   - 새 업체는 결제가 된 뒤에 만든다: 업체 → 대표 구성원 → (Agent) 신청 씀 → 구독 행 → 업체 이력(맨 끝)
 *   - 기존 업체(다시 시작 · 관리자가 만든 업체)는 업체를 새로 만들지 않고 active 로 · 업체 통장 기간을 끊는다
 *   - profiles(등급) · user_credits(개인 크레딧)는 쓰지 않는다 — 등급은 DB 트리거가 맞춘다
 *   - 결제 뒤 저장이 실패하면 그 결제를 토스에서 취소하고 만든 행을 지운다 (구성원 → 업체 순, 이력은 남기지 않는다)
 *   - 해지: 등급은 그대로, 결제 실패 재시도 중(past_due)에도 해지할 수 있다. 업체 구독은 대표만
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackend,
  installFetch,
  quietConsole,
  ENV,
  DAY,
  iso,
} from './helpers/fake-backend.js';
import worker from '../src/worker.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '55555555-5555-4555-8555-555555555555';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COMPANY = { name: '  좋은가구  ', sido: '서울특별시', gugun: '강남구' };

let be;
let restoreFetch;
let quiet;

function seed({ tier = 'standard', tierSource = 'manual' } = {}) {
  be.state.users['user-token'] = { id: U1, email: 'c@example.com', name: '고객' };
  be.db.profiles.push({ id: U1, email: 'c@example.com', tier, tier_source: tierSource });
  be.db.user_credits.push({ user_id: U1, balance: 40, period_end: iso(Date.now() + 10 * DAY) });
}

/** U1 을 회사 구성원으로 */
function seedCompany({
  id = C1,
  kind = 'partner',
  plan = 'expert',
  nextPlan = null,
  status = 'active',
  role = 'owner',
} = {}) {
  be.db.companies.push({
    id,
    kind,
    name: kind === 'hq' ? '본사' : '좋은가구',
    plan: kind === 'hq' ? null : plan,
    next_plan: nextPlan,
    status,
    sido: '서울특별시',
    gugun: '강남구',
  });
  be.db.company_members.push({
    id: crypto.randomUUID(),
    company_id: id,
    user_id: U1,
    role,
    status: 'active',
    created_at: iso(Date.now() - 40 * DAY),
  });
}

function seedApplication(extra = {}) {
  be.db.partner_applications.push({
    id: A1,
    user_id: U1,
    company_id: null,
    kind: 'new',
    plan: 'agent',
    status: 'approved',
    company_name: '바른인테리어',
    sido: '경기도',
    gugun: '성남시',
    used_at: null,
    created_at: iso(Date.now() - 3 * DAY),
    ...extra,
  });
}

function call(path, body, method = 'POST') {
  return worker.fetch(
    new Request(`https://payments.example${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-token',
        Origin: 'https://dadamfurniture.com',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    }),
    ENV,
    {}
  );
}

const subscribe = (extra = { company: COMPANY }) =>
  call('/issue-billing-key', {
    auth_key: 'ak',
    customer_key: `dadam-${U1}`,
    plan: 'expert',
    ...extra,
  });
const restCalls = (path, method) =>
  be.calls.rest.filter((c) => c.path === path && (!method || c.method === method));
/** 등급 · 개인 크레딧을 건드리지 않았다 */
function assertNoProfileOrPersonalCredit() {
  assert.equal(restCalls('profiles').length, 0, 'profiles 를 읽거나 쓰지 않는다');
  assert.equal(restCalls('user_credits').length, 0, '개인 크레딧을 건드리지 않는다');
}

beforeEach(() => {
  be = createBackend();
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
});

// ───────────── 새 업체 (Expert) ─────────────

test('Expert 첫 결제: 결제 기록 → 업체 → 대표 → 구독 → 이력(맨 끝), 등급 · 개인 크레딧은 쓰지 않는다', async () => {
  seed();
  const res = await subscribe();
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const [charge] = be.charges();
  assert.equal(charge.body.amount, 99000);
  assert.equal(charge.idempotencyKey, charge.body.orderId);

  assert.equal(be.db.companies.length, 1);
  const c = be.db.companies[0];
  assert.equal(c.kind, 'partner');
  assert.equal(c.name, '좋은가구', '앞뒤 공백을 자른다');
  assert.equal(c.plan, 'expert');
  assert.equal(c.status, 'active');
  assert.equal(c.sido, '서울특별시');
  assert.equal(c.gugun, '강남구');
  assert.equal(c.created_by, U1);

  assert.equal(be.db.company_members.length, 1);
  assert.deepEqual(
    (({ company_id, user_id, role, status }) => ({ company_id, user_id, role, status }))(
      be.db.company_members[0]
    ),
    { company_id: c.id, user_id: U1, role: 'owner', status: 'active' }
  );

  assert.equal(be.db.subscriptions.length, 1);
  const sub = be.db.subscriptions[0];
  assert.equal(sub.company_id, c.id);
  assert.equal(sub.user_id, U1);
  assert.equal(sub.plan, 'expert');
  assert.equal(sub.amount_krw, 99000);
  assert.equal(sub.status, 'active');
  assert.equal(sub.billing_key, 'bk_new');
  assert.equal(sub.failed_attempts, 0);
  assert.ok(sub.next_charge_at);

  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'done');
  assert.equal(be.db.payment_history[0].subscription_id, sub.id);

  assert.equal(be.db.company_events.length, 1);
  const ev = be.db.company_events[0];
  assert.equal(ev.company_id, c.id);
  assert.equal(ev.type, 'subscribed');
  assert.equal(ev.actor_kind, 'member');
  assert.equal(ev.actor_user_id, U1);
  assert.deepEqual(ev.payload, { plan: 'expert' }, '이력에 이름 · 연락처를 넣지 않는다');

  const posts = be.calls.rest.filter((x) => x.method === 'POST').map((x) => x.path);
  assert.deepEqual(posts, [
    'payment_history',
    'companies',
    'company_members',
    'subscriptions',
    'company_events',
  ]);

  assertNoProfileOrPersonalCredit();
  assert.equal(be.db.user_credits[0].balance, 40);
  assert.equal(be.cancels().length, 0);

  assert.deepEqual(body.data.company, {
    id: c.id,
    name: '좋은가구',
    plan: 'expert',
    next_plan: null,
    status: 'active',
  });
});

test('Expert: 업체 이름 · 지역이 없거나 길면 422 invalid + field, 토스를 부르지 않는다', async () => {
  seed();
  const cases = [
    [{}, 'name'],
    [{ company: { name: '   ', sido: '서울', gugun: '강남구' } }, 'name'],
    [{ company: { name: 'a'.repeat(101), sido: '서울', gugun: '강남구' } }, 'name'],
    [{ company: { name: '좋은가구', gugun: '강남구' } }, 'sido'],
    [{ company: { name: '좋은가구', sido: 'a'.repeat(21), gugun: '강남구' } }, 'sido'],
    [{ company: { name: '좋은가구', sido: '서울', gugun: 'a'.repeat(41) } }, 'gugun'],
    [{ company: { name: '좋은가구', sido: '서울', gugun: 7 } }, 'gugun'],
  ];
  for (const [extra, field] of cases) {
    const res = await subscribe(extra);
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(extra));
    assert.equal(body.code, 'invalid');
    assert.equal(body.field, field, JSON.stringify(extra));
  }
  assert.equal(be.calls.toss.length, 0);
  assert.equal(be.db.companies.length, 0);
});

// ───────────── 새 업체 (Agent) ─────────────

test('Agent: 승인된 새 업체 신청이 없으면 403 agent_not_approved, 토스를 부르지 않는다', async () => {
  seed();
  for (const extra of [
    null,
    { status: 'meeting' },
    { status: 'held' },
    { kind: 'upgrade', company_id: C1 },
    { used_at: iso(Date.now() - DAY), company_id: C1 },
  ]) {
    be.db.partner_applications.splice(0);
    if (extra) seedApplication(extra);
    const res = await subscribe({ plan: 'agent', company: COMPANY });
    const body = await res.json();
    assert.equal(res.status, 403, JSON.stringify(extra));
    assert.equal(body.code, 'agent_not_approved');
  }
  assert.equal(be.calls.toss.length, 0);
});

test('Agent: 승인된 신청이 있으면 신청 값으로 업체를 만들고 신청을 쓴다 (body 의 업체 값은 무시)', async () => {
  seed();
  seedApplication();
  const res = await subscribe({ plan: 'agent', company: COMPANY });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(be.charges()[0].body.amount, 199000);

  const c = be.db.companies[0];
  assert.equal(c.name, '바른인테리어');
  assert.equal(c.sido, '경기도');
  assert.equal(c.gugun, '성남시');
  assert.equal(c.plan, 'agent');

  const app = be.db.partner_applications[0];
  assert.equal(app.company_id, c.id);
  assert.ok(app.used_at);
  assert.equal(app.status, 'approved');

  assert.equal(be.db.subscriptions[0].plan, 'agent');
  assert.equal(be.db.subscriptions[0].amount_krw, 199000);
  assert.equal(be.db.company_events.at(-1).type, 'subscribed');
  assertNoProfileOrPersonalCredit();
});

// ───────────── 구성원 ─────────────

test('본사 구성원은 409 hq_member — 토스를 부르지 않는다', async () => {
  seed();
  seedCompany({ id: HQ, kind: 'hq' });
  const res = await subscribe();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'hq_member');
  assert.equal(be.calls.toss.length, 0);
});

test('협력업체 실장 · 직원은 403 not_owner', async () => {
  for (const role of ['manager', 'staff']) {
    be = createBackend();
    restoreFetch();
    restoreFetch = installFetch(be);
    seed();
    seedCompany({ role });
    const res = await subscribe();
    assert.equal(res.status, 403, role);
    assert.equal((await res.json()).code, 'not_owner');
    assert.equal(be.calls.toss.length, 0);
  }
});

test('업체에 살아 있는 구독이 있으면 409 already_subscribed', async () => {
  for (const status of ['active', 'past_due', 'trialing']) {
    be = createBackend();
    restoreFetch();
    restoreFetch = installFetch(be);
    seed();
    seedCompany();
    be.db.subscriptions.push({
      id: 's-live',
      company_id: C1,
      user_id: U1,
      status,
      provider: 'toss',
    });
    const res = await subscribe();
    assert.equal(res.status, 409, status);
    assert.equal((await res.json()).code, 'already_subscribed');
    assert.equal(be.calls.toss.length, 0);
  }
});

test('업체 등급과 다른 plan 이면 409 plan_mismatch', async () => {
  seed();
  seedCompany({ plan: 'agent', status: 'closed' });
  const res = await subscribe({ plan: 'expert' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'plan_mismatch');
  assert.equal(be.calls.toss.length, 0);
});

test('정지된 업체 다시 시작: 업체를 새로 만들지 않고 active 로, 업체 통장 기간을 끊는다', async () => {
  seed();
  seedCompany({ status: 'suspended' });
  be.db.company_credits.push({
    company_id: C1,
    balance: 300,
    period_end: iso(Date.now() + 5 * DAY),
  });
  be.db.subscriptions.push({
    id: 'old',
    company_id: C1,
    user_id: U1,
    plan: 'expert',
    provider: 'toss',
    status: 'cancelled',
    cancel_reason: 'payment_failed',
    ended_at: iso(Date.now() - DAY),
    failed_attempts: 3,
    created_at: iso(Date.now() - 40 * DAY),
  });
  const res = await subscribe({});
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(be.db.companies.length, 1, '업체를 새로 만들지 않는다');
  assert.equal(be.db.company_members.length, 1);
  assert.equal(be.db.companies[0].status, 'active');
  assert.ok(
    Date.parse(be.db.company_credits[0].period_end) <= Date.now(),
    '업체 통장 기간을 끊는다'
  );
  assert.equal(be.db.company_credits[0].balance, 300, '잔액은 직접 건드리지 않는다');

  assert.equal(be.db.subscriptions.length, 2, '새 구독 행');
  const s = be.db.subscriptions.find((x) => x.id !== 'old');
  assert.equal(s.company_id, C1);
  assert.equal(s.status, 'active');
  assert.equal(s.failed_attempts, 0);
  assert.equal(be.db.subscriptions.find((x) => x.id === 'old').status, 'cancelled');
  assert.equal(be.db.payment_history[0].subscription_id, s.id);
  assert.equal(be.db.company_events.length, 1);
  assert.equal(body.data.company.status, 'active');
  assertNoProfileOrPersonalCredit();
});

test('관리자가 만든 업체(active, 구독 없음)의 첫 결제: 업체 status 는 그대로', async () => {
  seed();
  seedCompany({ plan: 'agent' });
  const res = await subscribe({ plan: 'agent' });
  assert.equal(res.status, 200);
  assert.equal(be.charges()[0].body.amount, 199000);
  assert.equal(restCalls('companies', 'PATCH').length, 0);
  assert.equal(be.db.subscriptions[0].company_id, C1);
  assert.equal(be.db.subscriptions[0].plan, 'agent');
});

// ───────────── 저장 실패 → 되돌리기 ─────────────

test('구독 저장이 실패하면 결제를 토스에서 취소하고 만든 업체 · 구성원을 지운다 (이력은 남기지 않는다)', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'subscriptions';
  const res = await subscribe();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.code, 'SUBSCRIPTION_SAVE_FAILED');
  assert.match(body.message, /결제를 취소했습니다/);

  const [charge] = be.charges();
  const cancels = be.cancels();
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].path, `/v1/payments/pk_${charge.body.orderId}/cancel`);
  assert.equal(cancels[0].idempotencyKey, `dadam-undo-${charge.body.orderId}`);
  assert.ok(cancels[0].body.cancelReason);

  assert.equal(be.db.subscriptions.length, 0, '다음 달 결제 근거가 남지 않는다');
  assert.equal(be.db.company_members.length, 0);
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.db.company_events.length, 0, '지울 수 없는 이력은 넣지 않았다');
  assert.equal(be.db.payment_history[0].status, 'refunded');
  const deletes = be.calls.rest.filter((x) => x.method === 'DELETE').map((x) => x.path);
  assert.deepEqual(deletes, ['subscriptions', 'company_members', 'companies'], '구성원 → 업체 순');
  assertNoProfileOrPersonalCredit();
  assert.ok(
    quiet.lines.some(([, l]) => l.includes('auto-cancelled')),
    '로그를 남긴다'
  );
});

test('구독 행은 써졌는데 응답만 못 받아도 그 행 · 구성원 · 업체를 지운다', async () => {
  seed();
  const inner = be.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const res = await inner(input, init);
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname === '/rest/v1/subscriptions' && (init.method || 'GET') === 'POST') {
      return new Response('gateway timeout', { status: 504 });
    }
    return res;
  };
  const res = await subscribe();
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  assert.equal(be.db.subscriptions.length, 0);
  assert.equal(be.db.company_members.length, 0);
  assert.equal(be.db.companies.length, 0);
});

test('대표 구성원 저장이 실패해도(다른 업체에 먼저 들어감 등) 결제를 취소하고 업체를 지운다', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'company_members';
  const res = await subscribe();
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.db.subscriptions.length, 0);
});

test('Agent 저장이 실패하면 신청을 되돌린다 (다시 결제할 수 있게)', async () => {
  seed();
  seedApplication();
  be.state.failDb = (method, table) => method === 'POST' && table === 'subscriptions';
  const res = await subscribe({ plan: 'agent' });
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  const app = be.db.partner_applications[0];
  assert.equal(app.company_id, null);
  assert.equal(app.used_at, null);
  assert.equal(be.db.companies.length, 0);
});

test('다시 시작 저장이 실패하면 업체 status 를 되돌린다', async () => {
  seed();
  seedCompany({ status: 'closed' });
  be.state.failDb = (method, table) => method === 'POST' && table === 'subscriptions';
  const res = await subscribe({});
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  assert.equal(be.db.companies.length, 1, '기존 업체는 지우지 않는다');
  assert.equal(be.db.companies[0].status, 'closed');
  assert.equal(be.db.company_members.length, 1, '기존 구성원도 그대로');
  assert.equal(be.db.subscriptions.length, 0);
});

test('결제 기록부터 실패해도 결제를 취소한다 (업체 · 구독은 만들지 않음)', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'payment_history';
  const res = await subscribe();
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.db.subscriptions.length, 0);
});

test('취소마저 실패하면 고객센터 안내 + 수동 환불 로그', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'subscriptions';
  be.state.cancelResult = { status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' };
  const res = await subscribe();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.match(body.message, /고객센터/);
  assert.ok(quiet.lines.some(([k, l]) => k === 'error' && l.includes('AUTO-CANCEL FAILED')));
});

test('업체 이력 저장이 실패해도 구독은 그대로 선다 (결제를 되돌리지 않는다)', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'company_events';
  const res = await subscribe();
  assert.equal(res.status, 200);
  assert.equal(be.cancels().length, 0);
  assert.equal(be.db.subscriptions.length, 1);
  assert.equal(be.db.companies.length, 1);
});

test('결제가 거절되면 아무것도 쓰지 않는다', async () => {
  seed();
  be.state.chargeQueue = [{ status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과' }];
  const res = await subscribe();
  assert.equal(res.status, 403);
  assert.equal(be.db.subscriptions.length, 0);
  assert.equal(be.db.payment_history.length, 0);
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.cancels().length, 0);
});

// ───────────── 해지 ─────────────

test('해지: 등급은 그대로, 다음 결제 없음, 까닭은 user_request', async () => {
  seed({ tier: 'expert', tierSource: 'subscription' });
  const end = iso(Date.now() + 10 * DAY);
  be.db.subscriptions.push({
    id: 's1',
    user_id: U1,
    plan: 'expert',
    provider: 'toss',
    status: 'active',
    current_period_end: end,
    next_charge_at: end,
    created_at: iso(Date.now() - 20 * DAY),
  });
  const res = await call('/cancel', { reason: 'user_request' });
  assert.equal(res.status, 200);
  const s = be.db.subscriptions[0];
  assert.equal(s.status, 'cancelled');
  assert.equal(s.cancel_reason, 'user_request');
  assert.equal(s.cancel_at, end);
  assert.equal(s.next_charge_at, null);
  assert.equal(be.db.profiles[0].tier, 'expert');
});

test('결제 실패 재시도 중(past_due)에도 해지할 수 있다', async () => {
  seed({ tier: 'expert', tierSource: 'subscription' });
  be.db.subscriptions.push({
    id: 's1',
    user_id: U1,
    plan: 'expert',
    provider: 'toss',
    status: 'past_due',
    current_period_end: iso(Date.now() - DAY),
    next_charge_at: iso(Date.now() + DAY),
    failed_attempts: 1,
    created_at: iso(Date.now() - 31 * DAY),
  });
  const res = await call('/cancel', {});
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.past_due, true);
  assert.equal(be.db.subscriptions[0].status, 'cancelled');
  assert.equal(be.db.subscriptions[0].next_charge_at, null);
});

function seedCompanySub(extra = {}) {
  const end = iso(Date.now() + 10 * DAY);
  be.db.subscriptions.push({
    id: 'cs1',
    company_id: C1,
    user_id: U2, // 결제한 사람이 다른 대표여도 업체 대표면 관리한다
    plan: 'expert',
    provider: 'toss',
    status: 'active',
    current_period_end: end,
    next_charge_at: end,
    created_at: iso(Date.now() - 20 * DAY),
    ...extra,
  });
}

test('업체 구독 해지는 대표만 — 실장 · 직원은 403 not_owner', async () => {
  seed();
  seedCompany({ role: 'staff' });
  seedCompanySub();
  const res = await call('/cancel', {});
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'not_owner');
  assert.equal(be.db.subscriptions[0].status, 'active');
});

test('업체 대표의 해지는 업체 구독을 끝낸다 (업체 status 는 기간 끝까지 그대로)', async () => {
  seed();
  seedCompany();
  seedCompanySub();
  const res = await call('/cancel', {});
  assert.equal(res.status, 200);
  assert.equal(be.db.subscriptions[0].status, 'cancelled');
  assert.equal(be.db.subscriptions[0].cancel_reason, 'user_request');
  assert.equal(be.db.companies[0].status, 'active');
});

test('구성원이 아니면 업체 구독 행을 자기 구독으로 보지 않는다', async () => {
  seed();
  be.db.subscriptions.push({
    id: 'cs1',
    company_id: C1,
    user_id: U1, // 예전에 결제한 대표였지만 지금은 구성원이 아니다
    plan: 'expert',
    provider: 'toss',
    status: 'active',
    current_period_end: iso(Date.now() + DAY),
    created_at: iso(Date.now() - 20 * DAY),
  });
  const res = await call('/cancel', {});
  assert.equal(res.status, 400);
  assert.equal(be.db.subscriptions[0].status, 'active');
});

// ───────────── GET /subscription ─────────────

test('GET /subscription: 업체 대표는 업체 구독 + company + role', async () => {
  seed();
  seedCompany({ plan: 'agent', nextPlan: 'expert' });
  seedCompanySub({ plan: 'agent', amount_krw: 199000, billing_key: 'bk_secret' });
  const res = await call('/subscription', undefined, 'GET');
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.equal(body.data.plan, 'agent');
  assert.equal(body.data.status, 'active');
  assert.deepEqual(body.company, {
    id: C1,
    name: '좋은가구',
    plan: 'agent',
    next_plan: 'expert',
    status: 'active',
  });
  assert.equal(body.role, 'owner');
  assert.ok(!text.includes('bk_secret'));
  assert.ok(!text.includes('company_id'));
});

test('GET /subscription: 실장 · 직원은 구독 칸 없이 company · role', async () => {
  seed();
  seedCompany({ role: 'manager' });
  seedCompanySub();
  const res = await call('/subscription', undefined, 'GET');
  const body = await res.json();
  assert.equal(body.data, null);
  assert.equal(body.company.id, C1);
  assert.equal(body.role, 'manager');
});

test('GET /subscription: 구성원이 아니면 예전 그대로 (업체 구독 행은 빼고)', async () => {
  seed();
  seedCompanySub({ user_id: U1 });
  const res = await call('/subscription', undefined, 'GET');
  const body = await res.json();
  assert.deepEqual(body.data, { plan: 'free', status: 'active', provider: null });
  assert.equal(body.company, undefined);
});
