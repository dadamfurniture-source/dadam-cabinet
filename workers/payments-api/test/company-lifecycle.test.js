/**
 * 업체 구독의 수명주기 (src/lifecycle.js · src/company.js) · 업체 구독 결제 · 카드 · 환불.
 *
 * 고정하는 것:
 *   1) 정기 결제 성공 — 업체 통장 기간을 끊는다. profiles · user_credits 는 건드리지 않는다
 *   2) next_plan 이 있으면 그 등급 금액으로 결제 → 성공하면 구독 plan · amount, 업체 plan 을 옮기고 next_plan 을 비운다.
 *      실패면 아무것도 바꾸지 않는다 (재시도도 next_plan 금액)
 *   3) 마지막 실패 → 업체 suspended, 해지 기간 끝 → closed (같은 업체에 살아 있는 구독이 있으면 그대로)
 *   4) 결과를 모르던 결제는 실제로 결제된 금액으로 기록한다 — 두 번 결제하지 않는다.
 *      업체 등급 옮기기 · 기간 넘기기가 중간에 실패해도 다음 실행이 이어서 한다
 *   5) 지금 다시 결제 · 카드 바꾸기는 업체 대표만 (실장 · 직원 403 not_owner)
 *   6) 환불 — 크레딧 사용은 업체 통장 줄로 보고, 환불되면 업체 closed
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
import { runDailyLifecycle, renewalOrderId, clock } from '../src/lifecycle.js';
import { PLAN_NAMES } from '../src/plans.js';
import worker from '../src/worker.js';

const realClock = clock.now;
function run(t) {
  clock.now = () => t + 1000;
  return runDailyLifecycle(ENV, t);
}

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '55555555-5555-4555-8555-555555555555';
const S1 = '22222222-2222-4222-8222-222222222222';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T0 = Date.UTC(2026, 10, 25, 19, 0, 0);
const PERIOD_END = iso(T0 - 5 * 3600_000);

let be;
let restoreFetch;
let quiet;

function seed({ nextPlan = null, status = 'active', periodEnd = PERIOD_END, extra = {} } = {}) {
  be.db.profiles.push({
    id: U1,
    email: 'owner@example.com',
    name: '대표',
    tier: 'expert',
    tier_source: 'company',
  });
  be.db.companies.push({
    id: C1,
    kind: 'partner',
    name: '좋은가구',
    plan: 'expert',
    next_plan: nextPlan,
    status: 'active',
  });
  be.db.company_members.push({
    id: 'm1',
    company_id: C1,
    user_id: U1,
    role: 'owner',
    status: 'active',
  });
  be.db.company_members.push({
    id: 'm2',
    company_id: C1,
    user_id: U2,
    role: 'staff',
    status: 'active',
  });
  be.db.subscriptions.push({
    id: S1,
    company_id: C1,
    user_id: U1,
    plan: 'expert',
    status,
    provider: 'toss',
    billing_key: 'bk_1',
    provider_customer_id: `dadam-${U1}`,
    amount_krw: 99000,
    current_period_start: iso(Date.parse(periodEnd) - 30 * DAY),
    current_period_end: periodEnd,
    next_charge_at: status === 'cancelled' ? null : periodEnd,
    cancel_at: null,
    cancel_reason: null,
    ended_at: null,
    failed_attempts: 0,
    first_failed_at: null,
    created_at: iso(Date.parse(periodEnd) - 30 * DAY),
    ...extra,
  });
  be.db.company_credits.push({
    company_id: C1,
    balance: 600,
    period_start: iso(T0 - 10 * DAY),
    period_end: iso(T0 + 20 * DAY),
  });
  be.db.user_credits.push({ user_id: U1, balance: 30, period_end: iso(T0 + 20 * DAY) });
}

const sub = () => be.db.subscriptions.find((s) => s.id === S1);
const company = () => be.db.companies.find((c) => c.id === C1);
const decline = { status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과 또는 잔액 부족' };
const restCalls = (path, method) =>
  be.calls.rest.filter((c) => c.path === path && (!method || c.method === method));
function assertNoTierOrPersonalCredit() {
  assert.equal(restCalls('profiles', 'PATCH').length, 0, '등급은 트리거가 맞춘다');
  assert.equal(restCalls('user_credits').length, 0, '개인 크레딧을 건드리지 않는다');
  assert.equal(be.db.user_credits[0].period_end, iso(T0 + 20 * DAY));
}

beforeEach(() => {
  be = createBackend({ nowMs: T0 });
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
  clock.now = realClock;
});

// ───────────── 정기 결제 ─────────────

test('정기 결제 성공: 기간 +30일 · 업체 통장 기간 끊기 · 등급 · 개인 크레딧은 손대지 않는다', async () => {
  seed();
  const summary = await run(T0);
  assert.equal(summary.charged, 1);
  const [charge] = be.charges();
  assert.equal(charge.body.amount, 99000);
  assert.equal(charge.body.orderName, PLAN_NAMES.expert);

  assert.equal(sub().status, 'active');
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(sub().plan, 'expert');
  assert.equal(be.db.company_credits[0].period_end, iso(T0));
  assert.equal(be.db.company_credits[0].balance, 600, '잔액은 직접 건드리지 않는다');
  assert.equal(restCalls('companies', 'PATCH').length, 0);
  assertNoTierOrPersonalCredit();
});

test('next_plan 이 있으면 그 등급 금액으로 결제 → 구독 plan · amount, 업체 plan 을 옮기고 next_plan 을 비운다', async () => {
  seed({ nextPlan: 'agent' });
  const summary = await run(T0);
  assert.equal(summary.charged, 1);
  const [charge] = be.charges();
  assert.equal(charge.body.amount, 199000);
  assert.equal(charge.body.orderName, PLAN_NAMES.agent);

  assert.equal(sub().plan, 'agent');
  assert.equal(sub().amount_krw, 199000);
  assert.equal(company().plan, 'agent');
  assert.equal(company().next_plan, null);
  const h = be.db.payment_history[0];
  assert.equal(h.plan, 'agent');
  assert.equal(h.amount_krw, 199000);
  assert.equal(be.db.company_credits[0].period_end, iso(T0));
  assertNoTierOrPersonalCredit();
});

test('Agent → Expert 내리기도 다음 결제일부터 (Expert 금액)', async () => {
  seed();
  Object.assign(company(), { plan: 'agent', next_plan: 'expert' });
  Object.assign(sub(), { plan: 'agent', amount_krw: 199000 });
  await run(T0);
  assert.equal(be.charges()[0].body.amount, 99000);
  assert.equal(company().plan, 'expert');
  assert.equal(company().next_plan, null);
  assert.equal(sub().plan, 'expert');
  assert.equal(sub().amount_krw, 99000);
});

test('next_plan 결제가 거절되면 아무것도 바꾸지 않고, 재시도도 next_plan 금액 → 성공하면 옮긴다', async () => {
  seed({ nextPlan: 'agent' });
  be.state.chargeQueue = [decline, 'ok'];
  let summary = await run(T0);
  assert.equal(summary.retry_scheduled, 1);
  assert.equal(sub().status, 'past_due');
  assert.equal(sub().plan, 'expert');
  assert.equal(sub().amount_krw, 99000);
  assert.equal(company().plan, 'expert');
  assert.equal(company().next_plan, 'agent');
  assert.equal(company().status, 'active', '재시도 동안 업체는 그대로');
  assert.equal(be.db.payment_history[0].status, 'failed');
  assert.equal(be.db.payment_history[0].amount_krw, 199000);
  assert.equal(be.db.company_credits[0].period_end, iso(T0 + 20 * DAY));

  summary = await run(T0 + DAY);
  assert.equal(summary.charged, 1);
  assert.equal(be.charges()[1].body.amount, 199000);
  assert.equal(sub().plan, 'agent');
  assert.equal(company().plan, 'agent');
  assert.equal(company().next_plan, null);
  assertNoTierOrPersonalCredit();
});

test('마지막 재시도도 실패하면 업체 suspended (같은 실행), 등급은 손대지 않는다', async () => {
  seed();
  be.state.chargeQueue = [decline, decline, decline];
  await run(T0);
  await run(T0 + DAY);
  assert.equal(company().status, 'active');
  const summary = await run(T0 + 3 * DAY);
  assert.equal(summary.cancelled_payment_failed, 1);
  assert.equal(summary.ended, 1);
  assert.equal(sub().status, 'cancelled');
  assert.equal(sub().cancel_reason, 'payment_failed');
  assert.ok(sub().ended_at);
  assert.equal(company().status, 'suspended');
  assertNoTierOrPersonalCredit();
});

test('대표가 해지하면 기간 끝에 업체 closed (한 번만)', async () => {
  const end = iso(T0 + 2 * DAY);
  seed({
    status: 'cancelled',
    periodEnd: end,
    extra: { cancel_reason: 'user_request', cancel_at: end },
  });
  await run(T0);
  assert.equal(company().status, 'active', '기간 끝까지는 그대로');
  const summary = await run(T0 + 2 * DAY);
  assert.equal(summary.ended, 1);
  assert.equal(company().status, 'closed');
  assert.equal(sub().ended_at, iso(T0 + 2 * DAY));
  assert.equal((await run(T0 + 3 * DAY)).ended, 0);
  assertNoTierOrPersonalCredit();
});

test('해지한 구독이 끝나도 업체가 다시 결제해 살아 있는 구독이 있으면 업체는 그대로', async () => {
  const end = iso(T0 - DAY);
  seed({ status: 'cancelled', periodEnd: end, extra: { cancel_reason: 'user_request' } });
  be.db.subscriptions.push({
    id: 'new-live',
    company_id: C1,
    user_id: U1,
    plan: 'expert',
    status: 'active',
    provider: 'toss',
    next_charge_at: iso(T0 + 29 * DAY),
    current_period_end: iso(T0 + 29 * DAY),
  });
  await run(T0);
  assert.ok(sub().ended_at);
  assert.equal(company().status, 'active');
});

// ───────────── 결과를 모르는 결제 · 중간 실패 ─────────────

test('결과를 모르던 결제(Expert 금액)가 실제로 됐으면, 그 사이 next_plan 이 생겨도 그 금액으로 기록하고 다시 결제하지 않는다', async () => {
  seed();
  const orderId = renewalOrderId(sub());
  be.state.chargeQueue = [
    (body) => {
      be.state.ordersById[body.orderId] = {
        paymentKey: `pk_${body.orderId}`,
        orderId: body.orderId,
        status: 'DONE',
        totalAmount: body.amount,
      };
      return { throw: new TypeError('network connection lost') };
    },
  ];
  assert.equal((await run(T0)).skipped, 1);
  assert.equal(sub().charge_order_id, orderId);

  company().next_plan = 'agent'; // 그 사이 승인됨
  const summary = await run(T0 + DAY);
  assert.equal(summary.charged, 1);
  assert.equal(be.charges().length, 1, '다시 결제하지 않는다');
  assert.equal(be.db.payment_history[0].amount_krw, 99000);
  assert.equal(be.db.payment_history[0].plan, 'expert');
  assert.equal(sub().plan, 'expert');
  assert.equal(company().plan, 'expert');
  assert.equal(company().next_plan, 'agent', '다음 결제일에 옮긴다');
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
});

test('업체 등급 옮기기가 실패하면 기간을 넘기지 않고, 다음 실행이 결제를 찾아 이어서 한다 (다시 결제하지 않는다)', async () => {
  seed({ nextPlan: 'agent' });
  be.state.failDb = (method, table) => method === 'PATCH' && table === 'companies';
  const first = await run(T0);
  assert.equal(first.errors, 1);
  assert.equal(be.charges().length, 1);
  assert.equal(sub().current_period_end, PERIOD_END);
  assert.equal(company().plan, 'expert');

  be.state.failDb = null;
  const second = await run(T0 + DAY);
  assert.equal(second.charged, 1);
  assert.equal(be.charges().length, 1, '다시 결제하지 않는다');
  assert.equal(company().plan, 'agent');
  assert.equal(company().next_plan, null);
  assert.equal(sub().plan, 'agent');
  assert.equal(sub().amount_krw, 199000);
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(be.db.payment_history.length, 1);
});

test('업체 등급은 옮겼는데 기간 넘기기가 실패해도, 다음 실행이 Agent 금액 결제를 찾아 이어서 한다', async () => {
  seed({ nextPlan: 'agent' });
  be.state.failDb = (method, table, body) =>
    method === 'PATCH' && table === 'subscriptions' && body && 'current_period_start' in body;
  const first = await run(T0);
  assert.equal(first.errors, 1);
  assert.equal(company().plan, 'agent');
  assert.equal(sub().plan, 'expert');

  be.state.failDb = null;
  const second = await run(T0 + DAY);
  assert.equal(second.charged, 1);
  assert.equal(be.charges().length, 1, '다시 결제하지 않는다');
  assert.equal(sub().plan, 'agent');
  assert.equal(sub().amount_krw, 199000);
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
});

// ───────────── 지금 다시 결제 · 카드 바꾸기 (대표만) ─────────────

function post(path, token, body = {}) {
  return worker.fetch(
    new Request(`https://payments.example${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    ENV,
    {}
  );
}

function seedPastDue({ nextPlan = null } = {}) {
  const now = Date.now();
  seed({
    nextPlan,
    status: 'past_due',
    periodEnd: iso(now - 2 * DAY),
    extra: {
      failed_attempts: 1,
      first_failed_at: iso(now - DAY),
      next_charge_at: iso(now + DAY),
    },
  });
  be.state.users['owner-token'] = { id: U1, email: 'owner@example.com' };
  be.state.users['staff-token'] = { id: U2, email: 'staff@example.com' };
}

test('업체 구독의 지금 다시 결제 · 카드 바꾸기는 대표만 — 직원은 403 not_owner, 토스를 부르지 않는다', async () => {
  seedPastDue();
  for (const [path, body] of [
    ['/subscription/retry', {}],
    ['/charge', {}],
    ['/subscription/card', { auth_key: 'ak', customer_key: `dadam-${U2}` }],
  ]) {
    const res = await post(path, 'staff-token', body);
    assert.equal(res.status, 403, path);
    assert.equal((await res.json()).code, 'not_owner');
  }
  assert.equal(be.calls.toss.length, 0);
  assert.equal(sub().status, 'past_due');
});

test('대표의 지금 다시 결제: next_plan 금액으로 결제하고 등급을 옮긴다', async () => {
  seedPastDue({ nextPlan: 'agent' });
  const res = await post('/subscription/retry', 'owner-token');
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(be.charges()[0].body.amount, 199000);
  assert.equal(sub().status, 'active');
  assert.equal(sub().plan, 'agent');
  assert.equal(company().plan, 'agent');
  assert.equal(company().next_plan, null);
  assert.ok(Date.parse(be.db.company_credits[0].period_end) <= Date.now());
  assert.equal(restCalls('user_credits').length, 0);
});

test('대표의 카드 바꾸기: 업체 구독의 빌링키를 바꾸고 재시도 중이면 바로 결제', async () => {
  seedPastDue();
  be.state.issueResult = { billingKey: 'bk_card2' };
  const res = await post('/subscription/card', 'owner-token', {
    auth_key: 'ak',
    customer_key: `dadam-${U1}`,
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.charge.result, 'charged');
  assert.equal(sub().billing_key, 'bk_card2');
  assert.equal(be.charges()[0].path, '/v1/billing/bk_card2');
  assert.equal(sub().status, 'active');
});

// ───────────── 환불 ─────────────

const P1 = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';

function seedPayment(ledger = []) {
  const now = Date.now();
  const paidAt = iso(now - 2 * DAY);
  seed({ periodEnd: iso(Date.parse(paidAt) + 30 * DAY) });
  be.db.payment_history.push({
    id: P1,
    user_id: U1,
    subscription_id: S1,
    provider: 'toss',
    order_id: 'dadam-sub-x',
    payment_key: 'pk_1',
    plan: 'expert',
    amount_krw: 99000,
    status: 'done',
    created_at: paidAt,
  });
  ledger.forEach((l) =>
    be.db.credit_ledger.push({
      id: crypto.randomUUID(),
      refunded: false,
      ...l,
      created_at: iso(Date.parse(paidAt) + 3600_000),
    })
  );
  be.state.users['admin-token'] = { id: ADMIN, email: 'admin@example.com' };
  be.state.admins.add('admin-token');
}

function refund(body) {
  return post('/admin/refund', 'admin-token', body);
}

test('환불: 업체 통장에서 다른 구성원이 썼어도 「사용」— 409', async () => {
  seedPayment([{ user_id: U2, company_id: C1, delta: -20, reason: 'generate' }]);
  const res = await refund({ payment_id: P1 });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.credits_used, 20);
  assert.equal(be.cancels().length, 0);
});

test('환불: 업체 구독은 업체 통장 줄만 본다 (대표의 개인 통장 줄은 세지 않는다)', async () => {
  seedPayment([{ user_id: U1, company_id: null, delta: -20, reason: 'generate' }]);
  const res = await refund({ payment_id: P1 });
  assert.equal(res.status, 200, await res.clone().text());
});

test('환불되면 구독 즉시 종료 + 업체 closed, 등급은 손대지 않는다', async () => {
  seedPayment();
  const res = await refund({ payment_id: P1 });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(be.cancels().length, 1);
  assert.equal(sub().status, 'cancelled');
  assert.equal(sub().cancel_reason, 'refunded');
  assert.ok(sub().ended_at);
  assert.equal(company().status, 'closed');
  assert.equal(be.db.payment_history[0].status, 'refunded');
  assert.equal(restCalls('profiles', 'PATCH').length, 0);
});
