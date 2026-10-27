/**
 * 지금 다시 결제 (POST /subscription/retry) · 카드 바꾸기 (POST /subscription/card).
 *
 * 고정하는 것:
 *   - 결제 실패 재시도 중(past_due)일 때만 결제한다 — 이용 중이면 거절
 *   - 성공 = cron 재시도 성공과 같다 (active · 횟수 0 · 기간 +30일 · 다음 결제일 · 결제 기록 · 크레딧)
 *   - 거절 = 결제 기록만 남고 재시도 일정(+1일 · +3일)·횟수·등급은 그대로, 토스 문구를 돌려준다
 *   - 두 번 누름 · cron 과 겹침: 결제 잠금으로 한 번만 결제한다
 *   - 결과를 모르는 결제는 다시 누르면 토스에 먼저 묻는다 — 이미 됐으면 다시 결제하지 않는다
 *   - 카드 바꾸기: customerKey 가 이 구독의 고객과 다르면 거절, 재시도 중이면 새 카드로 바로 결제
 *   - 응답에 billing_key · 잠금 · 주문번호 같은 내부 값이 없다. 예전 빌링키는 로그에도 없다
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
import { clock, runDailyLifecycle, CHARGE_LOCK_MS } from '../src/lifecycle.js';
import worker from '../src/worker.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = `dadam-${U1}`;
const PUBLIC_FIELDS = new Set([
  'plan',
  'status',
  'amount_krw',
  'current_period_start',
  'current_period_end',
  'next_charge_at',
  'cancel_at',
  'failed_attempts',
  'first_failed_at',
  'cancel_reason',
  'ended_at',
]);

let be;
let restoreFetch;
let quiet;
const realClock = clock.now;

let NOW;
let PERIOD_END;
let FIRST_FAILED;
let NEXT_RETRY;

function seed({ status = 'past_due', extra = {} } = {}) {
  NOW = Date.now();
  PERIOD_END = iso(NOW - 2 * DAY);
  FIRST_FAILED = iso(NOW - 1 * DAY);
  NEXT_RETRY = iso(Date.parse(FIRST_FAILED) + 3 * DAY);
  be.state.users['user-token'] = { id: U1, email: 'c@example.com', name: '고객' };
  be.db.profiles.push({
    id: U1,
    email: 'c@example.com',
    tier: 'expert',
    tier_source: 'subscription',
  });
  be.db.subscriptions.push({
    id: S1,
    user_id: U1,
    plan: 'expert',
    status,
    provider: 'toss',
    billing_key: 'bk_old_secret',
    provider_subscription_id: 'bk_old_secret',
    provider_customer_id: CUSTOMER,
    amount_krw: 99000,
    current_period_start: iso(Date.parse(PERIOD_END) - 30 * DAY),
    current_period_end: status === 'active' ? iso(NOW + 10 * DAY) : PERIOD_END,
    next_charge_at: status === 'active' ? iso(NOW + 10 * DAY) : NEXT_RETRY,
    failed_attempts: status === 'past_due' ? 2 : 0,
    first_failed_at: status === 'past_due' ? FIRST_FAILED : null,
    cancel_at: null,
    cancel_reason: null,
    ended_at: null,
    created_at: iso(NOW - 40 * DAY),
    ...extra,
  });
  be.db.user_credits.push({ user_id: U1, balance: 30, period_end: iso(NOW + 10 * DAY) });
}

function post(path, body = {}) {
  return worker.fetch(
    new Request(`https://payments.example${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-token',
        Origin: 'https://dadamfurniture.com',
      },
      body: JSON.stringify(body),
    }),
    ENV,
    {}
  );
}

async function call(path, body) {
  const res = await post(path, body);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

const sub = () => be.db.subscriptions.find((s) => s.id === S1);
const profile = () => be.db.profiles.find((p) => p.id === U1);
const decline = { status: 403, code: 'REJECT_CARD_PAYMENT', message: '잔액이 부족합니다.' };

function assertNoInternals(text) {
  for (const word of [
    'bk_',
    'billing_key',
    'charge_order_id',
    'charge_lock_until',
    'provider_customer_id',
  ]) {
    assert.ok(!text.includes(word), `응답에 ${word} 가 없어야 한다`);
  }
}
function assertPublicSubscription(s) {
  assert.ok(s, '구독을 돌려준다');
  for (const k of Object.keys(s)) assert.ok(PUBLIC_FIELDS.has(k), `공개 칸이 아님: ${k}`);
}

beforeEach(() => {
  be = createBackend();
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
  clock.now = realClock;
});

// ───────────── 지금 다시 결제 ─────────────

test('이용 중(active)이면 지금 다시 결제를 거절하고 토스를 부르지 않는다', async () => {
  seed({ status: 'active' });
  const { res, body } = await call('/subscription/retry');
  assert.equal(res.status, 409);
  assert.equal(body.code, 'NOT_PAST_DUE');
  assert.equal(be.charges().length, 0);
  assert.equal(sub().status, 'active');
});

test('예전 /charge 도 같은 처리로 간다 (이용 중이면 거절)', async () => {
  seed({ status: 'active' });
  const { res } = await call('/charge');
  assert.equal(res.status, 409);
  assert.equal(be.charges().length, 0);
});

test('지금 다시 결제 성공 = cron 재시도 성공과 같다', async () => {
  seed();
  const { res, text, body } = await call('/subscription/retry');
  assert.equal(res.status, 200, text);
  assert.equal(body.success, true);
  assert.equal(body.data.charge.result, 'charged');

  const [charge] = be.charges();
  assert.equal(be.charges().length, 1);
  assert.equal(charge.path, '/v1/billing/bk_old_secret', '저장된 빌링키로');
  assert.equal(charge.body.amount, 99000);
  assert.equal(charge.idempotencyKey, charge.body.orderId, '주문번호 = 멱등키');
  assert.ok(charge.body.orderId.length <= 64 && /^[A-Za-z0-9_-]+$/.test(charge.body.orderId));

  const s = sub();
  assert.equal(s.status, 'active');
  assert.equal(s.failed_attempts, 0);
  assert.equal(s.first_failed_at, null);
  assert.equal(s.current_period_start, PERIOD_END, '지난 기간 끝에서 시작');
  assert.equal(s.current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(s.next_charge_at, s.current_period_end);
  assert.equal(s.charge_lock_until, null, '잠금을 푼다');
  assert.equal(s.charge_order_id, null);

  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'done');
  assert.equal(be.db.payment_history[0].order_id, charge.body.orderId);
  assert.ok(Date.parse(be.db.user_credits[0].period_end) <= Date.now(), '새 달 크레딧');
  assert.equal(profile().tier, 'expert');

  assertNoInternals(text);
  assertPublicSubscription(body.data.subscription);
  assert.equal(body.data.subscription.status, 'active');
});

test('지금 다시 결제 거절: 결제 기록만 남고 재시도 일정·횟수·등급은 그대로, 토스 문구를 돌려준다', async () => {
  seed();
  be.state.chargeQueue = [decline];
  const before = { ...sub() };
  const { res, text, body } = await call('/subscription/retry');
  assert.equal(res.status, 402);
  assert.equal(body.success, false);
  assert.equal(body.code, 'REJECT_CARD_PAYMENT');
  assert.equal(body.message, '잔액이 부족합니다.');
  assert.equal(body.data.charge.result, 'declined');

  const s = sub();
  for (const k of [
    'status',
    'failed_attempts',
    'first_failed_at',
    'next_charge_at',
    'current_period_end',
  ]) {
    assert.equal(s[k], before[k], `${k} 그대로`);
  }
  assert.equal(s.charge_lock_until, null, '잠금은 푼다');
  assert.equal(s.charge_order_id, null);
  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'failed');
  assert.equal(profile().tier, 'expert');
  assertNoInternals(text);

  // 예정된 재시도는 그대로 돈다 — 그날 cron 이 실제로 다시 결제한다
  const due = Date.parse(NEXT_RETRY);
  clock.now = () => due + 1000;
  be.state.chargeQueue = ['ok'];
  const summary = await runDailyLifecycle(ENV, due);
  assert.equal(summary.charged, 1);
  assert.equal(be.charges().length, 2);
  assert.notEqual(be.charges()[1].body.orderId, be.charges()[0].body.orderId);
});

test('두 번 누름: 결제 중이면 두 번째는 409, 토스 결제는 한 번', async () => {
  seed();
  let release;
  be.state.chargeQueue = [() => new Promise((r) => (release = () => r('ok')))];
  const first = post('/subscription/retry');
  // 첫 요청이 토스 응답을 기다리는 동안
  while (!release) await new Promise((r) => setImmediate(r));
  const second = await call('/subscription/retry');
  assert.equal(second.res.status, 409);
  assert.equal(second.body.data.charge.result, 'busy');
  release();
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  assert.equal(be.charges().length, 1);
  assert.equal(sub().status, 'active');

  // 다 끝난 뒤 또 눌러도 이미 active 라 결제하지 않는다
  const third = await call('/subscription/retry');
  assert.equal(third.res.status, 409);
  assert.equal(be.charges().length, 1);
});

test('결제 중(잠금)이면 그날 cron 도 그 구독을 건너뛴다', async () => {
  seed({
    extra: {
      next_charge_at: iso(Date.now() - 1000),
      charge_lock_until: iso(Date.now() + 60_000),
      charge_order_id: 'dadam-sub-someone-elses-order',
    },
  });
  const summary = await runDailyLifecycle(ENV, Date.now());
  assert.equal(summary.skipped, 1);
  assert.equal(be.charges().length, 0);
  assert.equal(sub().failed_attempts, 2);
});

test('결과를 모르는 결제: 잠금을 두고 202, 나중에 다시 누르면 토스에 먼저 묻는다 — 이미 됐으면 다시 결제하지 않는다', async () => {
  seed();
  // 토스에서는 결제가 됐는데 응답만 끊겼다
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
  const first = await call('/subscription/retry');
  assert.equal(first.res.status, 202);
  assert.equal(first.body.data.charge.result, 'uncertain');
  assert.equal(sub().status, 'past_due');
  assert.ok(sub().charge_order_id, '주문번호를 남긴다');

  // 곧바로 다시 누르면 아직 잠겨 있다
  const again = await call('/subscription/retry');
  assert.equal(again.res.status, 409);

  // 잠금이 지난 뒤
  clock.now = () => Date.now() + CHARGE_LOCK_MS + 1000;
  const later = await call('/subscription/retry');
  assert.equal(later.res.status, 200, later.text);
  assert.equal(be.charges().length, 1, '다시 결제하지 않았다');
  assert.equal(sub().status, 'active');
  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].order_id, be.charges()[0].body.orderId);
});

test('결과를 모르는 결제가 토스에 없으면(404) 새로 결제한다', async () => {
  seed();
  be.state.chargeQueue = [{ throw: new TypeError('network connection lost') }, 'ok'];
  await call('/subscription/retry');
  clock.now = () => Date.now() + CHARGE_LOCK_MS + 1000;
  const later = await call('/subscription/retry');
  assert.equal(later.res.status, 200);
  assert.equal(be.charges().length, 2);
  assert.equal(sub().status, 'active');
});

test('결제 중이면 해지도 잠시 막는다 (결제가 해지를 덮지 않게)', async () => {
  seed({ extra: { charge_lock_until: iso(Date.now() + 60_000), charge_order_id: 'dadam-sub-x' } });
  const { res } = await call('/cancel', {});
  assert.equal(res.status, 409);
  assert.equal(sub().status, 'past_due');
});

// ───────────── 카드 바꾸기 ─────────────

test('카드 바꾸기: customerKey 가 이 구독의 고객과 다르면 거절, 토스를 부르지 않는다', async () => {
  seed();
  const { res, body } = await call('/subscription/card', {
    auth_key: 'ak',
    customer_key: 'dadam-22222222-2222-4222-8222-222222222222',
  });
  assert.equal(res.status, 400);
  assert.equal(body.code, 'CUSTOMER_KEY_MISMATCH');
  assert.equal(be.calls.toss.length, 0);
  assert.equal(sub().billing_key, 'bk_old_secret');
});

test('카드 바꾸기: 구독의 고객 키가 로그인한 사람의 키와 달라도 거절', async () => {
  seed({ extra: { provider_customer_id: 'dadam-legacy-customer' } });
  const { res } = await call('/subscription/card', {
    auth_key: 'ak',
    customer_key: 'dadam-legacy-customer',
  });
  assert.equal(res.status, 400);
  assert.equal(be.calls.toss.length, 0);
});

test('카드 바꾸기 + 바로 결제: 새 빌링키로 바꾸고 새 카드로 결제 → 이용 중', async () => {
  seed();
  be.state.issueResult = { billingKey: 'bk_new_card' };
  const { res, text, body } = await call('/subscription/card', {
    auth_key: 'ak-123',
    customer_key: CUSTOMER,
  });
  assert.equal(res.status, 200, text);
  assert.equal(body.success, true);
  assert.equal(body.data.card_changed, true);
  assert.equal(body.data.charge.result, 'charged');

  const issue = be.calls.toss.find((c) => c.path === '/v1/billing/authorizations/issue');
  assert.deepEqual(issue.body, { authKey: 'ak-123', customerKey: CUSTOMER });
  const charges = be.charges();
  assert.equal(charges.length, 1);
  assert.equal(charges[0].path, '/v1/billing/bk_new_card', '새 카드로 결제');

  const s = sub();
  assert.equal(s.billing_key, 'bk_new_card');
  assert.equal(s.provider_subscription_id, 'bk_new_card');
  assert.equal(s.status, 'active');
  assert.equal(s.failed_attempts, 0);
  assert.equal(s.current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(be.db.payment_history[0].status, 'done');

  assertNoInternals(text);
  assertPublicSubscription(body.data.subscription);
  const logged = quiet.lines.map(([, l]) => l).join('\n');
  assert.ok(!logged.includes('bk_old_secret'), '예전 빌링키를 로그에 남기지 않는다');
  assert.ok(!logged.includes('bk_new_card'), '새 빌링키도 로그에 남기지 않는다');
});

test('카드 바꾸기 + 바로 결제가 거절되면: 카드는 바뀌고, 재시도 일정은 그대로, 문구를 돌려준다', async () => {
  seed();
  be.state.chargeQueue = [decline];
  const before = { ...sub() };
  const { res, text, body } = await call('/subscription/card', {
    auth_key: 'ak',
    customer_key: CUSTOMER,
  });
  assert.equal(res.status, 200, text);
  assert.equal(body.data.card_changed, true);
  assert.equal(body.data.charge.result, 'declined');
  assert.equal(body.data.charge.message, '잔액이 부족합니다.');
  assert.match(body.message, /결제는 되지 않았습니다/);

  const s = sub();
  assert.equal(s.billing_key, 'bk_new');
  for (const k of ['status', 'failed_attempts', 'first_failed_at', 'next_charge_at']) {
    assert.equal(s[k], before[k], `${k} 그대로`);
  }
  assertNoInternals(text);
});

test('이용 중(active) 카드 바꾸기는 결제하지 않고 다음 결제부터 새 카드', async () => {
  seed({ status: 'active' });
  const { res, body } = await call('/subscription/card', {
    auth_key: 'ak',
    customer_key: CUSTOMER,
  });
  assert.equal(res.status, 200);
  assert.equal(body.data.charge, null);
  assert.equal(be.charges().length, 0);
  assert.equal(sub().billing_key, 'bk_new');
  assert.equal(sub().status, 'active');
});

test('해지된 구독은 카드를 바꿀 수 없다', async () => {
  seed({ status: 'cancelled' });
  const { res } = await call('/subscription/card', { auth_key: 'ak', customer_key: CUSTOMER });
  assert.equal(res.status, 400);
  assert.equal(be.calls.toss.length, 0);
});

test('/subscription 응답도 공개 칸만 (잠금·주문번호·빌링키 없음)', async () => {
  seed({ extra: { charge_lock_until: iso(Date.now() + 60_000), charge_order_id: 'dadam-sub-x' } });
  const res = await worker.fetch(
    new Request('https://payments.example/subscription', {
      headers: { Authorization: 'Bearer user-token' },
    }),
    ENV,
    {}
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('bk_old_secret'));
  assert.ok(!text.includes('dadam-sub-x'));
});
