/**
 * 관리자 환불 POST /admin/refund (약관 제9조).
 *
 * 고정하는 것:
 *   - 관리자만 (is_admin() 을 호출자 토큰으로)
 *   - 결제 후 7일 이내 + 그 뒤 크레딧 미사용 → 토스 전액 취소 · 결제 refunded · 구독 즉시 종료 · standard
 *   - 조건을 벗어나면 409 + 이유, 토스는 부르지 않는다. override:true 면 진행하고 기록에 남긴다
 *   - 생성 실패로 돌려받은 차감(refunded=true)과 결제 전 사용은 「사용」이 아니다
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
const S1 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';

let be;
let restoreFetch;
let quiet;

function seed({ paidDaysAgo = 2, tierSource = 'subscription', ledger = [] } = {}) {
  const now = Date.now();
  const paidAt = iso(now - paidDaysAgo * DAY);
  be.db.profiles.push({ id: U1, email: 'c@example.com', tier: 'expert', tier_source: tierSource });
  be.db.subscriptions.push({
    id: S1,
    user_id: U1,
    plan: 'expert',
    status: 'active',
    provider: 'toss',
    billing_key: 'bk_1',
    amount_krw: 99000,
    current_period_start: paidAt,
    current_period_end: iso(Date.parse(paidAt) + 30 * DAY),
    next_charge_at: iso(Date.parse(paidAt) + 30 * DAY),
    failed_attempts: 0,
    first_failed_at: null,
    cancel_reason: null,
    ended_at: null,
    created_at: paidAt,
  });
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
      user_id: U1,
      refunded: false,
      ...l,
      created_at: iso(Date.parse(paidAt) + (l.afterPaymentMs ?? 3600_000)),
    })
  );
  be.state.users['admin-token'] = { id: ADMIN, email: 'admin@example.com' };
  be.state.users['user-token'] = { id: U1, email: 'c@example.com' };
  be.state.admins.add('admin-token');
}

function refund(body, token = 'admin-token') {
  const headers = { 'Content-Type': 'application/json', Origin: 'https://dadamfurniture.com' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request('https://payments.example/admin/refund', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    ENV,
    {}
  );
}

const payment = () => be.db.payment_history.find((p) => p.id === P1);
const sub = () => be.db.subscriptions.find((s) => s.id === S1);
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

test('7일 이내 + 크레딧 미사용 → 토스 전액 취소 · refunded · 구독 즉시 종료 · standard', async () => {
  seed();
  const res = await refund({ payment_id: P1, reason: '고객 요청' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.override_used, false);

  const cancels = be.cancels();
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].path, '/v1/payments/pk_1/cancel');
  assert.equal(cancels[0].body.cancelReason, '고객 요청');
  assert.equal(cancels[0].body.cancelAmount, undefined, '금액을 빼면 전액 취소');
  assert.equal(cancels[0].idempotencyKey, `dadam-refund-${P1}`);

  assert.equal(payment().status, 'refunded');
  assert.equal(payment().refunded_by, ADMIN);
  assert.equal(payment().refund_override, false);
  assert.ok(payment().refunded_at);

  assert.equal(sub().status, 'cancelled');
  assert.equal(sub().cancel_reason, 'refunded');
  assert.equal(sub().next_charge_at, null);
  assert.ok(sub().ended_at);
  assert.equal(profile().tier, 'standard');
  assert.equal(profile().tier_source, 'manual', '내리면서 결제 표식도 기본값으로');
});

test('7일이 지났으면 409 + 이유, 토스를 부르지 않는다', async () => {
  seed({ paidDaysAgo: 8 });
  const res = await refund({ payment_id: P1 });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, 'REFUND_NOT_ELIGIBLE');
  assert.ok(
    body.reasons.some((r) => r.includes('7일')),
    body.reasons.join(' / ')
  );
  assert.equal(be.cancels().length, 0);
  assert.equal(payment().status, 'done');
  assert.equal(sub().status, 'active');
  assert.equal(profile().tier, 'expert');
});

test('결제 뒤 크레딧을 썼으면 409 + 이유', async () => {
  seed({ ledger: [{ delta: -20, reason: 'generate' }] });
  const res = await refund({ payment_id: P1 });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.ok(
    body.reasons.some((r) => r.includes('크레딧')),
    body.reasons.join(' / ')
  );
  assert.equal(body.credits_used, 20);
  assert.equal(be.cancels().length, 0);
});

test('생성 실패로 돌려받은 차감 · 결제 전 사용 · 지급(+)은 사용으로 치지 않는다', async () => {
  seed({
    ledger: [
      { delta: -20, reason: 'generate', refunded: true },
      { delta: 20, reason: 'refund' },
      { delta: 1000, reason: 'plan_reset' },
      { delta: -20, reason: 'generate', afterPaymentMs: -3600_000 },
    ],
  });
  const res = await refund({ payment_id: P1 });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(be.cancels().length, 1);
});

test('조건을 벗어나도 override:true 면 환불하고 예외였음을 남긴다', async () => {
  seed({ paidDaysAgo: 10, ledger: [{ delta: -20, reason: 'generate' }] });
  const res = await refund({ payment_id: P1, override: true });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.override_used, true);
  assert.equal(body.data.reasons.length, 2);
  assert.equal(payment().status, 'refunded');
  assert.equal(payment().refund_override, true);
  assert.equal(be.cancels().length, 1);
});

test('override 는 true 그 자체여야 한다 (문자열 "true" 는 무시)', async () => {
  seed({ paidDaysAgo: 10 });
  const res = await refund({ payment_id: P1, override: 'true' });
  assert.equal(res.status, 409);
  assert.equal(be.cancels().length, 0);
});

test('본사 승인 등급(manual)은 환불해도 내리지 않는다', async () => {
  seed({ tierSource: 'manual' });
  const res = await refund({ payment_id: P1 });
  assert.equal(res.status, 200);
  assert.equal(profile().tier, 'expert');
  assert.equal(profile().tier_source, 'manual');
  assert.equal(sub().status, 'cancelled');
});

test('관리자가 아니면 403, 토큰이 없으면 401 — 토스·DB 를 건드리지 않는다', async () => {
  seed();
  const r1 = await refund({ payment_id: P1 }, 'user-token');
  assert.equal(r1.status, 403);
  const r2 = await refund({ payment_id: P1 }, null);
  assert.equal(r2.status, 401);
  assert.equal(be.cancels().length, 0);
  assert.equal(payment().status, 'done');
});

test('이미 환불된 결제 · 실패한 결제 · 없는 결제는 거절', async () => {
  seed();
  payment().status = 'refunded';
  let res = await refund({ payment_id: P1 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'ALREADY_REFUNDED');

  payment().status = 'failed';
  res = await refund({ payment_id: P1 });
  assert.equal(res.status, 400);

  res = await refund({ payment_id: '99999999-9999-4999-8999-999999999999' });
  assert.equal(res.status, 404);

  res = await refund({ payment_id: 'not-a-uuid' });
  assert.equal(res.status, 400);
  assert.equal(be.cancels().length, 0);
});

test('토스 취소가 실패하면 DB 는 그대로 (결제 done · 구독 active · 등급 유지)', async () => {
  seed();
  be.state.cancelResult = {
    status: 403,
    code: 'NOT_CANCELABLE_PAYMENT',
    message: '취소할 수 없는 결제',
  };
  const res = await refund({ payment_id: P1 });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'NOT_CANCELABLE_PAYMENT');
  assert.equal(payment().status, 'done');
  assert.equal(sub().status, 'active');
  assert.equal(profile().tier, 'expert');
});

// ─── 탈퇴한 회원의 결제 (2026-10-27) ───
// 탈퇴하면 payment_history · subscriptions 의 user_id 가 NULL 이 된다 (database/withdrawal-retention.sql).
// 크레딧 원장도 회원과 떨어져 사용을 확인할 수 없다 — 관리자 예외(override)로만 환불하고, 내릴 등급이 없으니 건너뛴다.

function detach() {
  payment().user_id = null;
  Object.assign(sub(), { user_id: null, billing_key: null, status: 'cancelled', cancel_reason: 'user_request', ended_at: iso(Date.now()) });
  be.db.profiles.splice(0, be.db.profiles.length);
}

/** PostgREST 는 user_id=eq.null 을 uuid 로 읽다 400 을 낸다 — 그런 질의를 보내지 않아야 한다 */
function sentNullUserFilter() {
  return be.calls.rest.some((c) => /user_id=eq\.(null|undefined)/.test(decodeURIComponent(c.query || '')));
}

test('탈퇴한 회원의 결제: 크레딧 사용을 확인할 수 없어 409 + 이유 — 토스를 부르지 않는다', async () => {
  seed();
  detach();
  const res = await refund({ payment_id: P1 });
  const body = await res.json();
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.equal(body.code, 'REFUND_NOT_ELIGIBLE');
  assert.ok(body.reasons.some((r) => r.includes('탈퇴')), body.reasons.join(' / '));
  assert.equal(body.credits_used, null);
  assert.equal(be.cancels().length, 0);
  assert.equal(sentNullUserFilter(), false);
});

test('탈퇴한 회원의 결제: override 면 환불한다 — 등급 내리기는 건너뛰고, user_id=eq.null 질의를 보내지 않는다', async () => {
  seed();
  detach();
  const res = await refund({ payment_id: P1, override: true, reason: '탈퇴 회원 요청' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.override_used, true);
  assert.equal(be.cancels().length, 1);
  assert.equal(payment().status, 'refunded');
  assert.equal(payment().refund_override, true);
  assert.equal(be.calls.rest.filter((c) => c.path === 'profiles').length, 0, '등급을 내릴 회원이 없다');
  assert.equal(sentNullUserFilter(), false);
});

test('탈퇴한 회원 + 구독 없는 결제: 구독을 user_id 로 찾지 않는다', async () => {
  seed();
  detach();
  payment().subscription_id = null;
  const res = await refund({ payment_id: P1, override: true });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(be.calls.rest.filter((c) => c.path === 'subscriptions').length, 0);
  assert.equal(payment().status, 'refunded');
  assert.equal(sentNullUserFilter(), false);
});
