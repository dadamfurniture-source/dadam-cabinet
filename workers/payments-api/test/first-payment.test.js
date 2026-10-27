/**
 * 첫 결제 (POST /issue-billing-key) · 해지 (POST /cancel).
 *
 * 고정하는 것:
 *   - 결제 뒤 DB 저장이 실패하면 그 결제를 토스에서 취소한다 (카드만 긁히고 구독이 없는 상태 금지)
 *   - 구독 행은 맨 마지막에 쓴다 — 저장이 중간에 실패하면 다음 달 결제 근거가 남지 않는다
 *   - 해지: 등급은 그대로, 결제 실패 재시도 중(past_due)에도 해지할 수 있다
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

let be;
let restoreFetch;
let quiet;

function seed({ tier = 'standard', tierSource = 'manual' } = {}) {
  be.state.users['user-token'] = { id: U1, email: 'c@example.com', name: '고객' };
  be.db.profiles.push({ id: U1, email: 'c@example.com', tier, tier_source: tierSource });
  be.db.user_credits.push({ user_id: U1, balance: 40, period_end: iso(Date.now() + 10 * DAY) });
}

function call(path, body) {
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

const subscribe = () =>
  call('/issue-billing-key', { auth_key: 'ak', customer_key: `dadam-${U1}`, plan: 'expert' });
const profile = () => be.db.profiles.find((p) => p.id === U1);

beforeEach(() => {
  be = createBackend();
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
});

test('첫 결제 성공: 결제 기록 · 등급 · 구독 · 기록↔구독 연결 · 크레딧 기간', async () => {
  seed();
  const res = await subscribe();
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const [charge] = be.charges();
  assert.equal(charge.body.amount, 99000);
  assert.equal(charge.idempotencyKey, charge.body.orderId);

  assert.equal(be.db.subscriptions.length, 1);
  const sub = be.db.subscriptions[0];
  assert.equal(sub.status, 'active');
  assert.equal(sub.billing_key, 'bk_new');
  assert.equal(sub.failed_attempts, 0);
  assert.ok(sub.next_charge_at);

  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'done');
  assert.equal(be.db.payment_history[0].subscription_id, sub.id);

  assert.equal(profile().tier, 'expert');
  assert.equal(profile().tier_source, 'subscription');
  assert.ok(Date.parse(be.db.user_credits[0].period_end) <= Date.now(), '크레딧 기간을 끊는다');
  assert.equal(be.cancels().length, 0);
});

test('구독 저장이 실패하면 결제를 토스에서 취소하고 등급·기록을 되돌린다', async () => {
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
  assert.equal(profile().tier, 'standard', '등급 되돌림');
  assert.equal(profile().tier_source, 'manual');
  assert.equal(be.db.payment_history[0].status, 'refunded');
  assert.ok(
    quiet.lines.some(([, l]) => l.includes('auto-cancelled')),
    '로그를 남긴다'
  );
});

test('결제 기록부터 실패해도 결제를 취소한다 (등급·구독은 손대지 않음)', async () => {
  seed();
  be.state.failDb = (method, table) => method === 'POST' && table === 'payment_history';
  const res = await subscribe();
  assert.equal(res.status, 500);
  assert.equal(be.cancels().length, 1);
  assert.equal(profile().tier, 'standard');
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

test('결제가 거절되면 아무것도 쓰지 않는다', async () => {
  seed();
  be.state.chargeQueue = [{ status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과' }];
  const res = await subscribe();
  assert.equal(res.status, 403);
  assert.equal(be.db.subscriptions.length, 0);
  assert.equal(be.db.payment_history.length, 0);
  assert.equal(profile().tier, 'standard');
  assert.equal(be.cancels().length, 0);
});

test('다시 구독하면 지난 해지·재시도 표식을 지운다', async () => {
  seed({ tier: 'expert', tierSource: 'subscription' });
  be.db.subscriptions.push({
    id: 'old',
    user_id: U1,
    plan: 'expert',
    provider: 'toss',
    status: 'cancelled',
    cancel_reason: 'payment_failed',
    cancel_at: iso(Date.now() - DAY),
    ended_at: iso(Date.now() - DAY),
    failed_attempts: 3,
    first_failed_at: iso(Date.now() - 4 * DAY),
    created_at: iso(Date.now() - 40 * DAY),
  });
  const res = await subscribe();
  assert.equal(res.status, 200);
  const s = be.db.subscriptions[0];
  assert.equal(s.status, 'active');
  assert.equal(s.cancel_reason, null);
  assert.equal(s.ended_at, null);
  assert.equal(s.failed_attempts, 0);
  assert.equal(s.first_failed_at, null);
  assert.equal(be.db.payment_history[0].subscription_id, 'old');
});

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
  assert.equal(profile().tier, 'expert');
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
