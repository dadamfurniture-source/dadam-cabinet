/**
 * 구독 수명주기 cron (src/lifecycle.js · worker.scheduled).
 *
 * 고정하는 것:
 *   1) 정기 결제 성공 — 결제 기록 done, 기간 +30일(지난 기간 끝에서), 등급 유지, 새 달 크레딧(기간 끊기)
 *   2) 실패 재시도 — 첫 실패 1일 뒤 · 3일 뒤, 그동안 past_due + 등급 유지
 *   3) 마지막 재시도 실패 — 해지(payment_failed) + standard (결제로 받은 등급만)
 *   4) 해지 만료 — 기간 끝까지 유지, 끝나면 standard, 한 번만
 *   5) 결과를 모르는 오류는 세지 않고 같은 주문번호·멱등키로 다음 날 다시 보낸다
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
import worker from '../src/worker.js';

const realClock = clock.now;
/** cron 한 번. 결제 잠금의 벽시계도 그날로 옮긴다 (cron 은 실제로 하루씩 떨어져 돈다). */
function run(t) {
  clock.now = () => t + 1000;
  return runDailyLifecycle(ENV, t);
}

const U1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
// cron 이 잡히는 시각: KST 04:00 = UTC 19:00
const T0 = Date.UTC(2026, 10, 25, 19, 0, 0);
// 이번 기간 끝: cron 보다 5시간 앞 (첫 결제가 오후 2시였던 경우)
const PERIOD_END = iso(T0 - 5 * 3600_000);

let be;
let restoreFetch;
let quiet;

function seed({
  tierSource = 'subscription',
  status = 'active',
  periodEnd = PERIOD_END,
  extra = {},
} = {}) {
  be.db.profiles.push({
    id: U1,
    email: 'customer@example.com',
    name: '고객',
    tier: 'expert',
    tier_source: tierSource,
  });
  be.db.subscriptions.push({
    id: S1,
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
  be.db.user_credits.push({
    user_id: U1,
    balance: 120,
    period_start: iso(T0 - 10 * DAY),
    period_end: iso(T0 + 20 * DAY),
  });
}

const sub = () => be.db.subscriptions.find((s) => s.id === S1);
const profile = () => be.db.profiles.find((p) => p.id === U1);
const decline = { status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과 또는 잔액 부족' };

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

test('정기 결제 성공: 기록 · 기간 +30일 · 등급 유지 · 새 달 크레딧', async () => {
  seed();
  const orderId = renewalOrderId(sub());
  const summary = await run(T0);

  assert.equal(summary.charged, 1);
  const charges = be.charges();
  assert.equal(charges.length, 1);
  assert.equal(charges[0].path, '/v1/billing/bk_1');
  assert.equal(charges[0].body.amount, 99000);
  assert.equal(charges[0].body.customerKey, `dadam-${U1}`);
  assert.equal(charges[0].body.orderId, orderId);
  assert.ok(orderId.length <= 64 && /^[A-Za-z0-9_-]+$/.test(orderId), 'Toss orderId 규칙');
  assert.equal(charges[0].idempotencyKey, orderId, '주문번호를 멱등키로');
  assert.equal(charges[0].body.customerEmail, 'customer@example.com');

  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'done');
  assert.equal(be.db.payment_history[0].order_id, orderId);
  assert.equal(be.db.payment_history[0].subscription_id, S1);

  const s = sub();
  assert.equal(s.status, 'active');
  assert.equal(s.current_period_start, PERIOD_END, '새 기간은 지난 기간 끝에서 시작');
  assert.equal(s.current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(s.next_charge_at, s.current_period_end);
  assert.equal(s.failed_attempts, 0);

  assert.equal(profile().tier, 'expert', '등급 유지');
  assert.equal(
    be.db.user_credits[0].period_end,
    iso(T0),
    '크레딧 기간을 끊어 다음 사용 때 월 지급량으로 채운다'
  );
  assert.equal(be.db.user_credits[0].balance, 120, '잔액은 직접 건드리지 않는다');
});

test('결제일이 아직이면 아무것도 하지 않는다', async () => {
  seed({ periodEnd: iso(T0 + 3600_000) });
  const summary = await run(T0);
  assert.equal(summary.due, 0);
  assert.equal(be.charges().length, 0);
});

test('실패 재시도: 첫 실패 1일 뒤 · 3일 뒤, 그동안 past_due + 등급 유지 → 마지막 실패면 해지 + standard', async () => {
  seed();
  be.state.chargeQueue = [decline, decline, decline];

  // 첫 실패
  let summary = await run(T0);
  assert.equal(summary.retry_scheduled, 1);
  let s = sub();
  assert.equal(s.status, 'past_due');
  assert.equal(s.failed_attempts, 1);
  assert.equal(s.first_failed_at, iso(T0));
  assert.equal(s.next_charge_at, iso(T0 + 1 * DAY));
  assert.equal(profile().tier, 'expert', '재시도 동안 등급 유지');
  assert.equal(be.db.payment_history.at(-1).status, 'failed');
  assert.equal(be.db.payment_history.at(-1).failure_code, 'REJECT_CARD_PAYMENT');

  // 1일 뒤 — 두 번째 실패
  summary = await run(T0 + 1 * DAY);
  assert.equal(summary.retry_scheduled, 1);
  s = sub();
  assert.equal(s.failed_attempts, 2);
  assert.equal(s.next_charge_at, iso(T0 + 3 * DAY), '두 번째 재시도는 첫 실패 3일 뒤');
  assert.equal(profile().tier, 'expert');

  // 2일 뒤 — 걸지 않는다
  await run(T0 + 2 * DAY);
  assert.equal(be.charges().length, 2);

  // 3일 뒤 — 마지막 실패
  summary = await run(T0 + 3 * DAY);
  assert.equal(summary.cancelled_payment_failed, 1);
  assert.equal(summary.ended, 1, '같은 실행에서 등급까지 내린다');
  s = sub();
  assert.equal(s.status, 'cancelled');
  assert.equal(s.cancel_reason, 'payment_failed');
  assert.equal(s.next_charge_at, null);
  assert.equal(s.ended_at, iso(T0 + 3 * DAY));
  assert.equal(s.failed_attempts, 3);
  assert.equal(profile().tier, 'standard');
  assert.equal(profile().tier_source, 'manual', '내리면서 결제 표식도 기본값으로');

  const orders = be.charges().map((c) => c.body.orderId);
  assert.equal(new Set(orders).size, 3, '회차마다 다른 주문번호');
  assert.deepEqual(
    orders.map((o) => o.slice(-2)),
    ['-1', '-2', '-3']
  );
  assert.equal(be.db.payment_history.filter((h) => h.status === 'failed').length, 3);

  // 그 뒤로는 결제하지 않는다
  await run(T0 + 4 * DAY);
  await run(T0 + 30 * DAY);
  assert.equal(be.charges().length, 3);
});

test('마지막 실패여도 본사 승인 등급(manual)은 내리지 않는다', async () => {
  seed({ tierSource: 'manual' });
  be.state.chargeQueue = [decline, decline, decline];
  await run(T0);
  await run(T0 + 1 * DAY);
  await run(T0 + 3 * DAY);
  assert.equal(sub().status, 'cancelled');
  assert.ok(sub().ended_at);
  assert.equal(profile().tier, 'expert');
});

test('재시도에서 성공하면 정상으로 돌아오고 결제일은 밀리지 않는다', async () => {
  seed();
  be.state.chargeQueue = [decline, 'ok'];
  await run(T0);
  const summary = await run(T0 + 1 * DAY);
  assert.equal(summary.charged, 1);
  const s = sub();
  assert.equal(s.status, 'active');
  assert.equal(s.failed_attempts, 0);
  assert.equal(s.first_failed_at, null);
  assert.equal(s.current_period_start, PERIOD_END);
  assert.equal(s.current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
  assert.equal(be.db.user_credits[0].period_end, iso(T0 + 1 * DAY));
  assert.equal(profile().tier, 'expert');
});

test('결과를 모르는 오류(연결 끊김)는 실패로 세지 않고, 다음 날 같은 주문번호·멱등키로 다시 보낸다', async () => {
  seed();
  be.state.chargeQueue = [{ throw: new TypeError('network connection lost') }, 'ok'];
  const first = await run(T0);
  assert.equal(first.skipped, 1);
  assert.equal(sub().status, 'active');
  assert.equal(sub().failed_attempts, 0);
  assert.equal(be.db.payment_history.length, 0);

  await run(T0 + 1 * DAY);
  const [a, b] = be.charges();
  assert.equal(a.body.orderId, b.body.orderId);
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
});

test('가맹점 키 오류(UNAUTHORIZED_KEY)는 고객 카드 실패로 세지 않는다', async () => {
  seed();
  be.state.chargeQueue = [{ status: 401, code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 키' }];
  const summary = await run(T0);
  assert.equal(summary.skipped, 1);
  assert.equal(sub().status, 'active');
  assert.equal(sub().failed_attempts, 0);
});

test('이미 승인된 주문번호(DUPLICATED_ORDER_ID)면 다시 결제하지 않고 그 결제를 찾아 기록한다', async () => {
  seed();
  const orderId = renewalOrderId(sub());
  be.state.ordersById[orderId] = {
    paymentKey: 'pk_prev',
    orderId,
    status: 'DONE',
    totalAmount: 99000,
  };
  be.state.chargeQueue = [
    { status: 400, code: 'DUPLICATED_ORDER_ID', message: '이미 승인된 주문번호' },
  ];
  const summary = await run(T0);
  assert.equal(summary.charged, 1);
  assert.equal(be.db.payment_history[0].payment_key, 'pk_prev');
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
});

test('같은 결제가 두 번 기록되지 않는다 (이미 기록된 주문번호면 넘기고 기간만 넘긴다)', async () => {
  seed();
  const orderId = renewalOrderId(sub());
  be.db.payment_history.push({
    id: 'h0',
    provider: 'toss',
    order_id: orderId,
    status: 'done',
    user_id: U1,
  });
  await run(T0);
  assert.equal(be.db.payment_history.length, 1);
  assert.equal(sub().current_period_end, iso(Date.parse(PERIOD_END) + 30 * DAY));
});

test('해지: 이번 기간 끝까지는 등급 유지, 끝나면 standard (한 번만)', async () => {
  const end = iso(T0 + 2 * DAY);
  seed({
    status: 'cancelled',
    periodEnd: end,
    extra: { cancel_reason: 'user_request', cancel_at: end },
  });

  let summary = await run(T0);
  assert.equal(summary.ended, 0);
  assert.equal(profile().tier, 'expert');
  assert.equal(be.charges().length, 0, '해지한 구독은 결제하지 않는다');

  summary = await run(T0 + 2 * DAY);
  assert.equal(summary.ended, 1);
  assert.equal(profile().tier, 'standard');
  assert.equal(profile().tier_source, 'manual');
  assert.equal(sub().ended_at, iso(T0 + 2 * DAY));

  const patchesBefore = be.calls.rest.filter((c) => c.method === 'PATCH').length;
  summary = await run(T0 + 3 * DAY);
  assert.equal(summary.ended, 0);
  assert.equal(
    be.calls.rest.filter((c) => c.method === 'PATCH').length,
    patchesBefore,
    '끝난 구독은 다시 손대지 않는다'
  );
  assert.equal(be.charges().length, 0);
});

test('해지 만료여도 본사 승인 등급(manual)은 그대로', async () => {
  const end = iso(T0 - DAY);
  seed({
    status: 'cancelled',
    tierSource: 'manual',
    periodEnd: end,
    extra: { cancel_reason: 'user_request' },
  });
  await run(T0);
  assert.equal(profile().tier, 'expert');
  assert.equal(profile().tier_source, 'manual');
  assert.ok(sub().ended_at);
});

test('이미 standard 인데 결제 표식만 남아 있으면 표식을 manual 로 돌린다', async () => {
  const end = iso(T0 - DAY);
  seed({ status: 'cancelled', periodEnd: end, extra: { cancel_reason: 'user_request' } });
  profile().tier = 'standard';
  await run(T0);
  assert.equal(profile().tier, 'standard');
  assert.equal(profile().tier_source, 'manual');
  assert.ok(sub().ended_at);
});

test('정기 결제 성공 · 재시도 중에는 등급과 결제 표식을 그대로 둔다', async () => {
  seed();
  be.state.chargeQueue = [decline, 'ok'];
  await run(T0);
  assert.equal(profile().tier, 'expert');
  assert.equal(profile().tier_source, 'subscription');
  await run(T0 + DAY);
  assert.equal(profile().tier, 'expert');
  assert.equal(profile().tier_source, 'subscription');
  assert.equal(
    be.calls.rest.filter((c) => c.method === 'PATCH' && c.path === 'profiles').length,
    0,
    '프로필은 손대지 않는다'
  );
});

test('등급 내리기가 실패하면 ended_at 을 찍지 않고 다음 날 다시 한다', async () => {
  const end = iso(T0 - DAY);
  seed({ status: 'cancelled', periodEnd: end, extra: { cancel_reason: 'user_request' } });
  be.state.failDb = (method, table) => method === 'PATCH' && table === 'profiles';
  const first = await run(T0);
  assert.equal(first.errors, 1);
  assert.equal(sub().ended_at, null);
  assert.equal(profile().tier, 'expert');

  be.state.failDb = null;
  await run(T0 + DAY);
  assert.equal(profile().tier, 'standard');
  assert.equal(profile().tier_source, 'manual');
  assert.ok(sub().ended_at);
});

test('worker.scheduled 는 cron 이 잡힌 시각(scheduledTime)을 기준으로 돈다', async () => {
  seed();
  be.state.chargeQueue = [decline];
  const waits = [];
  await worker.scheduled({ scheduledTime: T0, cron: '0 19 * * *' }, ENV, {
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits);
  assert.equal(sub().first_failed_at, iso(T0));
  assert.equal(sub().next_charge_at, iso(T0 + DAY));
});
