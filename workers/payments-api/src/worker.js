/**
 * Dadam Payments API — Cloudflare Worker
 *
 * 라우트:
 *   GET  /health
 *   GET  /plans                  — 플랜 + Toss client_key (공개)
 *   GET  /subscription           — 현재 구독 (인증)
 *   POST /issue-billing-key      — authKey → billingKey + 첫 과금 (인증)
 *   POST /charge                 — 수동 재시도 (인증)
 *   POST /cancel                 — 구독 취소 (인증)
 *   POST /admin/refund           — 결제 1건 환불 (관리자, is_admin())
 *   POST /webhook                — Toss 웹훅 (공개, 결제 조회 API 로 재확인)
 *
 * cron (wrangler.toml [triggers]) — 하루 한 번 src/lifecycle.js:
 *   정기 결제(30일) · 실패 재시도(1일 · 3일) · 해지 만료 강등
 *
 * customerKey 규칙: `dadam-${supabase_user.id}`
 * 첫 과금: 빌링키 발급 즉시 1회차 + next_charge_at = now+30d
 */

import { handleOptions, jsonResponse, corsHeaders } from './cors.js';
import { issueBillingKey, chargeBillingKey, cancelPayment, getPayment, TossError } from './toss.js';
import {
  AuthError,
  DbError,
  verifyJwt,
  verifyAdmin,
  selectOne,
  insertOne,
  updateById,
  updateBy,
} from './supabase.js';
import { PLAN_NAMES, PAID_PLANS, priceFor, orderNameFor } from './plans.js';
import {
  runDailyLifecycle,
  refundPayment,
  RefundError,
  historyRow,
  grantMonthlyCredits,
} from './lifecycle.js';

// GET /subscription 이 브라우저에 돌려주는 칸. billing.html 이 쓰는 것만 둔다.
// billing_key 는 서버 안에서만 쓰는 값이라 넣지 않는다.
// failed_attempts · first_failed_at · cancel_reason · ended_at 은 결제 실패·해지 안내에 쓴다
// (database/payments-lifecycle.sql).
const SUBSCRIPTION_COLUMNS = [
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
].join(',');

// 웹훅 본문 상한. 결제 객체 하나는 몇 KB 라 넉넉하다.
const WEBHOOK_MAX_BYTES = 64 * 1024;

const UNDO_REASON = '구독 저장 실패로 자동 취소';

function customerKeyFor(user) {
  return `dadam-${user.id}`;
}

function genOrderId(userId) {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `dadam-sub-${userId}-${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

function plus30dIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** 본문을 maxBytes 까지만 읽는다. 넘으면 null. */
async function readTextLimited(request, maxBytes) {
  const declared = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

// ===== 핸들러 =====

async function handlePlans(request, env) {
  return jsonResponse(request, env, {
    success: true,
    data: {
      client_key: env.TOSS_CLIENT_KEY || '',
      plans: PAID_PLANS.map((id) => ({
        id,
        name: id === 'expert' ? 'Expert' : 'Agent',
        price_krw: priceFor(env, id),
        order_name: PLAN_NAMES[id],
      })),
    },
  });
}

async function handleSubscription(request, env) {
  const user = await verifyJwt(request, env);
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    select: SUBSCRIPTION_COLUMNS,
    order: 'created_at.desc',
  });
  if (!sub) {
    return jsonResponse(request, env, {
      success: true,
      data: { plan: 'free', status: 'active', provider: null },
    });
  }
  return jsonResponse(request, env, { success: true, data: sub });
}

async function handleIssueBillingKey(request, env) {
  const user = await verifyJwt(request, env);
  const body = await readJson(request);
  if (!body || !body.auth_key || !body.customer_key || !body.plan) {
    return jsonResponse(request, env, { success: false, message: '필수 필드 누락' }, 400);
  }
  const amount = priceFor(env, body.plan);
  if (!amount) {
    return jsonResponse(
      request,
      env,
      { success: false, message: `유효하지 않은 플랜: ${body.plan}` },
      400
    );
  }
  const expectedKey = customerKeyFor(user);
  if (body.customer_key !== expectedKey) {
    return jsonResponse(request, env, { success: false, message: 'customerKey 불일치' }, 400);
  }

  // 결제 전에 읽을 것은 먼저 읽는다 — 결제 뒤에 읽다 실패하면 되돌릴 일이 생긴다.
  const existing = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    select: 'id',
    order: 'created_at.desc',
  });
  const prevProfile = await selectOne(env, 'profiles', {
    id: `eq.${user.id}`,
    select: 'tier,tier_source',
  });

  // 1. authKey → billingKey
  const billing = await issueBillingKey(env, {
    authKey: body.auth_key,
    customerKey: body.customer_key,
  });
  const billingKey = billing.billingKey;

  // 2. 첫 과금
  const orderId = genOrderId(user.id);
  const charge = await chargeBillingKey(env, {
    billingKey,
    customerKey: body.customer_key,
    amount,
    orderId,
    orderName: PLAN_NAMES[body.plan],
    customerEmail: user.email,
    customerName: user.name,
    idempotencyKey: orderId,
  });

  // 3. 저장. 여기서 실패하면 방금 한 결제를 토스에서 취소한다 —
  //    카드는 긁혔는데 구독이 없는 상태를 남기지 않는다.
  //    순서: 결제 기록 → 등급 → 구독 행(마지막).
  //    구독 행은 cron 이 다음 달에 결제하는 근거다. 마지막에 써야, 중간에 실패해서
  //    결제를 취소했는데 구독 행만 남아 다음 달에 다시 결제되는 일이 없다.
  const start = nowIso();
  const next = plus30dIso();
  const done = { historyId: null, profileChanged: false, subscriptionAttempted: false };
  let subId = existing?.id || null;
  try {
    const hist = await insertOne(
      env,
      'payment_history',
      historyRow({
        userId: user.id,
        subscriptionId: existing?.id,
        orderId,
        plan: body.plan,
        amount,
        charge,
      })
    );
    done.historyId = hist?.id || null;

    // 등급 반영
    //    profiles 에 plan 컬럼은 없다 — tier 다.
    //    tier_source='subscription' 을 함께 남긴다. 구독이 끝났을 때
    //    본사 승인으로 받은 등급까지 내려버리지 않기 위한 표식이다.
    await updateBy(
      env,
      'profiles',
      { id: `eq.${user.id}` },
      { tier: body.plan, tier_source: 'subscription' }
    );
    done.profileChanged = true;

    const subData = {
      user_id: user.id,
      plan: body.plan,
      provider: 'toss',
      provider_customer_id: body.customer_key,
      provider_subscription_id: billingKey,
      billing_key: billingKey,
      amount_krw: amount,
      status: 'active',
      current_period_start: start,
      current_period_end: next,
      next_charge_at: next,
      cancel_at: null,
      cancel_reason: null,
      ended_at: null,
      failed_attempts: 0,
      first_failed_at: null,
      updated_at: start,
    };
    done.subscriptionAttempted = true;
    if (existing) {
      await updateById(env, 'subscriptions', existing.id, subData);
    } else {
      const inserted = await insertOne(env, 'subscriptions', subData);
      subId = inserted?.id || null;
    }
  } catch (e) {
    const undone = await undoFirstPayment(env, {
      user,
      orderId,
      charge,
      billingKey,
      done,
      prevProfile,
      cause: e,
    });
    return jsonResponse(
      request,
      env,
      {
        success: false,
        code: 'SUBSCRIPTION_SAVE_FAILED',
        message: undone
          ? '구독 정보를 저장하지 못해 결제를 취소했습니다. 잠시 후 다시 시도해 주세요.'
          : '결제는 되었지만 구독 정보를 저장하지 못했습니다. 고객센터로 문의해 주세요.',
      },
      500
    );
  }

  // 4. 따라붙는 일. 실패해도 결제를 되돌리지 않는다 — 구독은 이미 섰다.
  if (!existing && subId && done.historyId) {
    await bestEffort('link history to subscription', () =>
      updateById(env, 'payment_history', done.historyId, { subscription_id: subId })
    );
  }
  //    새 달 크레딧 — 등급이 바뀌면 트리거가 이미 한 일이지만, 같은 등급으로 다시 결제한
  //    경우에도 결제한 달의 크레딧이 시작되도록 같은 일을 한 번 더 한다(기간 끊기, 멱등).
  await bestEffort('credit period reset', () => grantMonthlyCredits(env, user.id, Date.now()));

  return jsonResponse(request, env, {
    success: true,
    message: `${body.plan} 플랜 구독이 시작되었습니다.`,
    data: {
      plan: body.plan,
      amount_krw: amount,
      next_charge_at: next,
      receipt_url: charge.receipt?.url || null,
    },
  });
}

/**
 * 첫 결제 뒤 저장이 실패했을 때: 토스 결제를 취소하고, 써 둔 것을 되돌린다.
 * 취소가 됐으면 true. 취소마저 실패하면 false — 로그에 남기고 사람이 환불한다.
 */
async function undoFirstPayment(
  env,
  { user, orderId, charge, billingKey, done, prevProfile, cause }
) {
  console.error(
    `[payments] first payment save failed: user=${user.id} order=${orderId} cause=${cause && cause.message}`
  );
  if (!charge || !charge.paymentKey) {
    console.error(
      `[payments] MANUAL CHECK: no paymentKey to cancel user=${user.id} order=${orderId}`
    );
    return false;
  }
  try {
    await cancelPayment(env, charge.paymentKey, {
      cancelReason: UNDO_REASON,
      idempotencyKey: `dadam-undo-${orderId}`,
    });
    console.error(
      `[payments] first payment auto-cancelled: user=${user.id} order=${orderId} paymentKey=${charge.paymentKey}`
    );
  } catch (e) {
    console.error(
      `[payments] AUTO-CANCEL FAILED — manual refund needed: user=${user.id} order=${orderId} paymentKey=${charge.paymentKey} code=${e.code || '-'}`
    );
    return false;
  }

  // 결제는 취소됐다. 아래는 되돌릴 수 있는 만큼만 (실패해도 고객 카드에는 영향 없다).
  const now = nowIso();
  if (done.subscriptionAttempted) {
    // 구독 행이 실제로 써졌다면(응답만 못 받은 경우) 다음 달 결제가 걸리지 않게 끝낸다.
    // 새 빌링키로 걸러서, 써지지 않았다면 예전 구독은 건드리지 않는다.
    await bestEffort('undo subscription', () =>
      updateBy(
        env,
        'subscriptions',
        { user_id: `eq.${user.id}`, billing_key: `eq.${billingKey}` },
        {
          status: 'cancelled',
          cancel_reason: 'refunded',
          cancel_at: now,
          next_charge_at: null,
          ended_at: now,
          updated_at: now,
        }
      )
    );
  }
  if (done.profileChanged && prevProfile) {
    await bestEffort('undo profile tier', () =>
      updateBy(
        env,
        'profiles',
        { id: `eq.${user.id}` },
        { tier: prevProfile.tier, tier_source: prevProfile.tier_source }
      )
    );
  }
  if (done.historyId) {
    await bestEffort('undo history', () =>
      updateById(env, 'payment_history', done.historyId, {
        status: 'refunded',
        refunded_at: now,
        refund_reason: UNDO_REASON,
      })
    );
  }
  return true;
}

async function bestEffort(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[payments] ${label} failed:`, e && e.message);
  }
}

async function handleManualCharge(request, env) {
  const user = await verifyJwt(request, env);
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    provider: 'eq.toss',
    status: 'in.(active,past_due)',
    select: '*',
    order: 'created_at.desc',
  });
  if (!sub || !sub.billing_key) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '활성 Toss 구독이 없습니다.' },
      400
    );
  }

  const orderId = genOrderId(user.id);
  try {
    const charge = await chargeBillingKey(env, {
      billingKey: sub.billing_key,
      customerKey: sub.provider_customer_id,
      amount: sub.amount_krw,
      orderId,
      orderName: orderNameFor(sub.plan),
      customerEmail: user.email,
      idempotencyKey: orderId,
    });
    const next = plus30dIso();
    await updateById(env, 'subscriptions', sub.id, {
      status: 'active',
      current_period_start: nowIso(),
      current_period_end: next,
      next_charge_at: next,
      // 결제가 됐으니 재시도 기록은 지운다. 안 지우면 다음 달 실패가 2·3회차로 세어진다.
      failed_attempts: 0,
      first_failed_at: null,
      updated_at: nowIso(),
    });
    await insertOne(
      env,
      'payment_history',
      historyRow({
        userId: user.id,
        subscriptionId: sub.id,
        orderId,
        plan: sub.plan,
        amount: sub.amount_krw,
        charge,
      })
    );
    await bestEffort('credit period reset', () => grantMonthlyCredits(env, user.id, Date.now()));
    return jsonResponse(request, env, {
      success: true,
      message: '결제 재시도 성공',
      data: { next_charge_at: next },
    });
  } catch (e) {
    if (e instanceof TossError) {
      await insertOne(
        env,
        'payment_history',
        historyRow({
          userId: user.id,
          subscriptionId: sub.id,
          orderId,
          plan: sub.plan,
          amount: sub.amount_krw,
          error: e,
        })
      );
    }
    throw e;
  }
}

async function handleCancel(request, env) {
  const user = await verifyJwt(request, env);
  const body = (await readJson(request)) || {};
  // 결제 실패로 재시도 중(past_due)인 구독도 해지할 수 있다 — 해지하면 더는 결제하지 않는다.
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    provider: 'eq.toss',
    status: 'in.(active,past_due)',
    select: '*',
    order: 'created_at.desc',
  });
  if (!sub) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '활성 Toss 구독이 없습니다.' },
      400
    );
  }
  await updateById(env, 'subscriptions', sub.id, {
    status: 'cancelled',
    cancel_reason: 'user_request',
    cancel_at: sub.current_period_end,
    next_charge_at: null,
    updated_at: nowIso(),
  });

  // 등급은 지금 내리지 않는다 — 이번 기간까지는 이미 낸 값이다 (약관 제9조).
  // 기간이 끝나면 하루 한 번 도는 cron(lifecycle.js expireCancelled)이 내린다.
  // 결제로 받은 등급(tier_source='subscription')일 때만.
  console.log(`Toss subscription cancelled: user=${user.id} reason=${body.reason || '-'}`);
  const pastDue = sub.status === 'past_due';
  return jsonResponse(request, env, {
    success: true,
    message: pastDue
      ? '구독이 해지되었습니다. 더 이상 결제를 시도하지 않습니다.'
      : '구독이 현재 기간 종료 후 취소됩니다.',
    data: { cancel_at: sub.current_period_end, past_due: pastDue },
  });
}

/**
 * 관리자 환불 — 결제 1건 (payment_history.id).
 * 본문: { payment_id, override?: true, reason?: string }
 * 조건(결제 후 7일 이내 · 크레딧 미사용)을 벗어나면 409 + reasons. override:true 로 다시 보내야 한다.
 */
async function handleAdminRefund(request, env) {
  const admin = await verifyAdmin(request, env);
  const body = (await readJson(request)) || {};
  const result = await refundPayment(env, {
    paymentId: body.payment_id,
    adminId: admin.id,
    override: body.override === true,
    reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined,
  });
  return jsonResponse(request, env, {
    success: true,
    message: result.override_used ? '관리자 예외로 환불했습니다.' : '환불했습니다.',
    data: result,
  });
}

// 토스 웹훅.
//
// 이 워커가 받는 이벤트는 PAYMENT_STATUS_CHANGED 하나다 (자동결제는 승인 때는 오지 않고,
// 취소처럼 결제 상태가 바뀔 때 온다). 이 이벤트에는 서명 헤더가 없다
// (tosspayments-webhook-signature 는 지급대행 payout.changed · seller.changed 에만 붙는다).
// 그래서 본문은 믿지 않고, 본문의 paymentKey 로 결제 조회 API 를 시크릿 키로 다시 불러
// 그 응답만 기록한다. 토스에 없는 결제거나 주문번호·금액이 다르면 401.
//   https://docs.tosspayments.com/reference/using-api/webhook-events
//   https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference
//
// 그 밖의 이벤트는 기록하지 않고 200 으로 넘긴다 — 2xx 가 아니면 토스가 최대 7회 다시 보낸다.
async function handleWebhook(request, env) {
  const text = await readTextLimited(request, WEBHOOK_MAX_BYTES);
  if (text === null) {
    return jsonResponse(request, env, { status: 'payload_too_large' }, 413);
  }
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse(request, env, { status: 'invalid_payload' }, 400);
  }

  const eventType = payload.eventType;
  if (eventType !== 'PAYMENT_STATUS_CHANGED') {
    console.log(`Toss webhook ignored: type=${String(eventType || '-').slice(0, 64)}`);
    return jsonResponse(request, env, { status: 'ignored' });
  }

  const posted = payload.data || {};
  const paymentKey = posted.paymentKey;
  if (typeof paymentKey !== 'string' || !paymentKey || paymentKey.length > 200) {
    return jsonResponse(request, env, { status: 'invalid_payload' }, 400);
  }

  let payment;
  try {
    payment = await getPayment(env, paymentKey);
  } catch (e) {
    // 토스에 없는 결제 = 토스가 보낸 웹훅이 아니다.
    // 그 밖의 오류(토스 장애 등)는 그대로 던져 2xx 가 아니게 한다 → 토스가 다시 보낸다.
    if (e instanceof TossError && e.statusCode === 404) {
      return jsonResponse(request, env, { status: 'unverified' }, 401);
    }
    throw e;
  }
  if (
    !payment ||
    payment.paymentKey !== paymentKey ||
    payment.orderId !== posted.orderId ||
    payment.totalAmount !== posted.totalAmount
  ) {
    return jsonResponse(request, env, { status: 'unverified' }, 401);
  }

  // 같은 결제의 같은 상태는 한 번만 남긴다. 조회한 값으로 만든다 (본문 값이 아니라).
  const eventId = `${payment.paymentKey}:${payment.status}:${payment.lastTransactionKey || '-'}`;

  const existing = await selectOne(env, 'payment_events', {
    provider: 'eq.toss',
    event_id: `eq.${eventId}`,
    select: 'id',
  });
  if (existing) {
    return jsonResponse(request, env, { status: 'duplicate' });
  }
  await insertOne(env, 'payment_events', {
    provider: 'toss',
    event_id: eventId,
    event_type: eventType,
    payload: { eventType, data: payment },
  });
  console.log(`Toss webhook: type=${eventType} id=${eventId}`);
  return jsonResponse(request, env, { status: 'ok' });
}

// ===== 라우터 =====

const ROUTES = [
  {
    method: 'GET',
    path: '/health',
    handler: (req, env) =>
      jsonResponse(req, env, { status: 'ok', service: 'dadam-payments-api', worker: true }),
  },
  { method: 'GET', path: '/plans', handler: handlePlans },
  { method: 'GET', path: '/subscription', handler: handleSubscription },
  { method: 'POST', path: '/issue-billing-key', handler: handleIssueBillingKey },
  { method: 'POST', path: '/charge', handler: handleManualCharge },
  { method: 'POST', path: '/cancel', handler: handleCancel },
  { method: 'POST', path: '/admin/refund', handler: handleAdminRefund },
  { method: 'POST', path: '/webhook', handler: handleWebhook },
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.method === request.method && r.path === url.pathname);
    if (!route) {
      return jsonResponse(request, env, { success: false, message: 'Not found' }, 404);
    }

    try {
      return await route.handler(request, env);
    } catch (err) {
      if (err instanceof AuthError) {
        return jsonResponse(
          request,
          env,
          { success: false, message: err.message },
          err.statusCode || 401
        );
      }
      if (err instanceof RefundError) {
        return jsonResponse(
          request,
          env,
          { success: false, code: err.code, message: err.message, ...err.extra },
          err.statusCode
        );
      }
      if (err instanceof TossError) {
        return jsonResponse(
          request,
          env,
          { success: false, code: err.code, message: err.message },
          err.statusCode
        );
      }
      if (err instanceof DbError) {
        console.error('DB error:', err.message);
        return jsonResponse(request, env, { success: false, message: 'DB 오류' }, err.statusCode);
      }
      console.error('Unhandled:', err && err.stack ? err.stack : String(err));
      return jsonResponse(request, env, { success: false, message: '서버 오류' }, 500);
    }
  },

  /**
   * 하루 한 번 (wrangler.toml [triggers]). 정기 결제 · 실패 재시도 · 해지 만료.
   * 기준 시각은 cron 이 잡힌 시각(scheduledTime) — 재시도 「1일 뒤 · 3일 뒤」가 다음 cron 과 딱 맞는다.
   */
  async scheduled(controller, env, ctx) {
    const nowMs = Number(controller && controller.scheduledTime) || Date.now();
    ctx.waitUntil(
      runDailyLifecycle(env, nowMs).catch((e) => {
        console.error('[payments] lifecycle failed:', e && e.message ? e.message : String(e));
      })
    );
  },
};
