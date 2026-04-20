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
 *   POST /webhook                — Toss 웹훅 (공개)
 *
 * customerKey 규칙: `dadam-${supabase_user.id}`
 * 첫 과금: 빌링키 발급 즉시 1회차 + next_charge_at = now+30d
 */

import { handleOptions, jsonResponse, corsHeaders } from './cors.js';
import { issueBillingKey, chargeBillingKey, TossError } from './toss.js';
import {
  AuthError,
  DbError,
  verifyJwt,
  selectOne,
  insertOne,
  updateById,
  updateBy,
} from './supabase.js';

const PLAN_NAMES = {
  basic: '다담가구 Basic 플랜 (월간)',
  pro: '다담가구 Pro 플랜 (월간)',
  enterprise: '다담가구 Enterprise 플랜 (월간)',
};

function priceFor(env, plan) {
  const map = {
    basic: parseInt(env.TOSS_PRICE_BASIC_KRW || '99000', 10),
    pro: parseInt(env.TOSS_PRICE_PRO_KRW || '199000', 10),
    enterprise: parseInt(env.TOSS_PRICE_ENTERPRISE_KRW || '299000', 10),
  };
  return map[plan];
}

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

// ===== 핸들러 =====

async function handlePlans(request, env) {
  return jsonResponse(request, env, {
    success: true,
    data: {
      client_key: env.TOSS_CLIENT_KEY || '',
      plans: [
        { id: 'basic', name: 'Basic', price_krw: priceFor(env, 'basic'), order_name: PLAN_NAMES.basic },
        { id: 'pro', name: 'Pro', price_krw: priceFor(env, 'pro'), order_name: PLAN_NAMES.pro },
        { id: 'enterprise', name: 'Enterprise', price_krw: priceFor(env, 'enterprise'), order_name: PLAN_NAMES.enterprise },
      ],
    },
  });
}

async function handleSubscription(request, env) {
  const user = await verifyJwt(request, env);
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    select: '*',
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
    return jsonResponse(request, env, { success: false, message: `유효하지 않은 플랜: ${body.plan}` }, 400);
  }
  const expectedKey = customerKeyFor(user);
  if (body.customer_key !== expectedKey) {
    return jsonResponse(request, env, { success: false, message: 'customerKey 불일치' }, 400);
  }

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
  });

  // 3. subscriptions upsert
  const start = nowIso();
  const next = plus30dIso();
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
    updated_at: start,
  };

  const existing = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    select: 'id',
    order: 'created_at.desc',
  });
  let subId;
  if (existing) {
    const updated = await updateById(env, 'subscriptions', existing.id, subData);
    subId = updated?.id || existing.id;
  } else {
    const inserted = await insertOne(env, 'subscriptions', subData);
    subId = inserted?.id;
  }

  // 4. profiles.plan 동기화
  await updateBy(env, 'profiles', { id: `eq.${user.id}` }, { plan: body.plan });

  // 5. payment_history 기록
  await insertOne(env, 'payment_history', {
    user_id: user.id,
    subscription_id: subId,
    provider: 'toss',
    order_id: orderId,
    payment_key: charge.paymentKey || null,
    plan: body.plan,
    amount_krw: amount,
    status: charge.status === 'DONE' ? 'done' : 'pending',
    method: charge.method || null,
    receipt_url: charge.receipt?.url || null,
    raw_response: charge,
  });

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
    return jsonResponse(request, env, { success: false, message: '활성 Toss 구독이 없습니다.' }, 400);
  }

  const orderId = genOrderId(user.id);
  try {
    const charge = await chargeBillingKey(env, {
      billingKey: sub.billing_key,
      customerKey: sub.provider_customer_id,
      amount: sub.amount_krw,
      orderId,
      orderName: PLAN_NAMES[sub.plan] || '다담가구 구독',
      customerEmail: user.email,
    });
    const next = plus30dIso();
    await updateById(env, 'subscriptions', sub.id, {
      status: 'active',
      current_period_start: nowIso(),
      current_period_end: next,
      next_charge_at: next,
    });
    await insertOne(env, 'payment_history', {
      user_id: user.id,
      subscription_id: sub.id,
      provider: 'toss',
      order_id: orderId,
      payment_key: charge.paymentKey || null,
      plan: sub.plan,
      amount_krw: sub.amount_krw,
      status: charge.status === 'DONE' ? 'done' : 'pending',
      method: charge.method || null,
      receipt_url: charge.receipt?.url || null,
      raw_response: charge,
    });
    return jsonResponse(request, env, {
      success: true,
      message: '결제 재시도 성공',
      data: { next_charge_at: next },
    });
  } catch (e) {
    if (e instanceof TossError) {
      await insertOne(env, 'payment_history', {
        user_id: user.id,
        subscription_id: sub.id,
        provider: 'toss',
        order_id: orderId,
        plan: sub.plan,
        amount_krw: sub.amount_krw,
        status: 'failed',
        failure_code: e.code,
        failure_message: e.message,
      });
    }
    throw e;
  }
}

async function handleCancel(request, env) {
  const user = await verifyJwt(request, env);
  const body = (await readJson(request)) || {};
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    provider: 'eq.toss',
    status: 'eq.active',
    select: '*',
    order: 'created_at.desc',
  });
  if (!sub) {
    return jsonResponse(request, env, { success: false, message: '활성 Toss 구독이 없습니다.' }, 400);
  }
  await updateById(env, 'subscriptions', sub.id, {
    status: 'cancelled',
    cancel_at: sub.current_period_end,
    next_charge_at: null,
  });
  console.log(`Toss subscription cancelled: user=${user.id} reason=${body.reason || '-'}`);
  return jsonResponse(request, env, {
    success: true,
    message: '구독이 현재 기간 종료 후 취소됩니다.',
    data: { cancel_at: sub.current_period_end },
  });
}

async function handleWebhook(request, env) {
  const payload = await readJson(request);
  if (!payload) {
    return jsonResponse(request, env, { status: 'invalid_payload' }, 400);
  }
  const eventId = payload.eventId || payload.transactionKey || crypto.randomUUID();
  const eventType = payload.eventType || payload.status || 'unknown';

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
    payload,
  });
  console.log(`Toss webhook: type=${eventType} id=${eventId}`);
  return jsonResponse(request, env, { status: 'ok' });
}

// ===== 라우터 =====

const ROUTES = [
  { method: 'GET', path: '/health', handler: (req, env) => jsonResponse(req, env, { status: 'ok', service: 'dadam-payments-api', worker: true }) },
  { method: 'GET', path: '/plans', handler: handlePlans },
  { method: 'GET', path: '/subscription', handler: handleSubscription },
  { method: 'POST', path: '/issue-billing-key', handler: handleIssueBillingKey },
  { method: 'POST', path: '/charge', handler: handleManualCharge },
  { method: 'POST', path: '/cancel', handler: handleCancel },
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
        return jsonResponse(request, env, { success: false, message: err.message }, 401);
      }
      if (err instanceof TossError) {
        return jsonResponse(request, env, { success: false, code: err.code, message: err.message }, err.statusCode);
      }
      if (err instanceof DbError) {
        console.error('DB error:', err.message);
        return jsonResponse(request, env, { success: false, message: 'DB 오류' }, err.statusCode);
      }
      console.error('Unhandled:', err && err.stack ? err.stack : String(err));
      return jsonResponse(request, env, { success: false, message: '서버 오류' }, 500);
    }
  },
};
