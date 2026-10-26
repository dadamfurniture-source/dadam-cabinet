/**
 * 구독 수명주기 — 정기 결제 · 실패 재시도 · 해지 만료 · 환불.
 *
 * 규칙 출처 (여기서 새로 정한 값은 없다):
 *   - 정기 결제: 30일마다, 저장한 빌링키로. next_charge_at <= 지금 인 활성 구독.
 *     하루 한 번 cron 이 돈다 (wrangler.toml [triggers]).
 *   - 결제 실패: 1일 뒤 재시도, 첫 실패 3일 뒤 마지막 재시도 (사장님 답 ask_58 = 가, 2026-10-26).
 *     재시도 동안은 등급 유지 + status past_due. 마지막 재시도도 실패하면 해지하고
 *     standard 로 내린다 — 결제로 받은 등급(tier_source='subscription')일 때만.
 *     내릴 때(마지막 실패 · 해지 만료 · 환불) tier_source 도 'manual' 로 돌린다.
 *   - 해지: 이번 기간 끝(current_period_end)까지 등급 유지, 그 뒤 standard (약관 제9조).
 *   - 환불: 결제 후 7일 이내 + 그 뒤 크레딧을 쓰지 않았으면 전액 (약관 제9조).
 *     조건을 벗어나면 관리자 예외 표식(override)이 있어야만 한다.
 *   - 새 달 크레딧: 새 지급 규칙을 만들지 않는다. 등급이 바뀔 때 트리거
 *     reset_credits_on_tier_change 가 하는 일(user_credits.period_end = now())을 그대로 한다.
 *     그러면 다음 consume_credit 이 credit_plans 의 월 지급량으로 채운다
 *     (database/credits-schema.sql — 크론 없는 지연 갱신).
 *
 * 등급을 내리는 길은 한 곳(expireCancelled)뿐이다. 마지막 재시도 실패도 구독을 cancelled 로만
 * 바꾸고, 같은 실행의 만료 단계가 등급을 내린 뒤 ended_at 을 찍는다. 등급 내리기가 실패하면
 * ended_at 이 비어 있으니 다음 날 다시 한다.
 */

import { chargeBillingKey, cancelPayment, getPaymentByOrderId, TossError } from './toss.js';
import { selectOne, selectMany, insertIgnoreDuplicate, updateBy } from './supabase.js';
import { orderNameFor } from './plans.js';

export const DAY_MS = 86_400_000;
export const PERIOD_DAYS = 30;
/** 첫 실패로부터 며칠 뒤에 다시 거는가. 길이 = 재시도 횟수. */
export const RETRY_AFTER_FIRST_FAILURE_DAYS = [1, 3];
export const REFUND_WINDOW_DAYS = 7;

const SUB_COLUMNS_FOR_CHARGE = [
  'id',
  'user_id',
  'plan',
  'status',
  'amount_krw',
  'billing_key',
  'provider_customer_id',
  'current_period_start',
  'current_period_end',
  'next_charge_at',
  'failed_attempts',
  'first_failed_at',
].join(',');

function toMs(v) {
  return typeof v === 'number' ? v : Date.parse(v);
}
function iso(ms) {
  return new Date(ms).toISOString();
}
export function plusDays(v, days) {
  return iso(toMs(v) + days * DAY_MS);
}

/**
 * 정기 결제 주문번호. 같은 기간·같은 회차면 늘 같은 값이고, 토스 멱등키로도 쓴다.
 * 결제는 됐는데 기록 전에 끊기면 다음 실행이 같은 키로 다시 보낸다 → 토스가 첫 응답을
 * 그대로 돌려준다(두 번 결제되지 않는다).
 * 길이: 10 + 36 + 1 + 12 + 1 + 1 = 61 (토스 한도 64, 영문·숫자·-·_ 만).
 */
export function renewalOrderId(sub) {
  const stamp = iso(toMs(sub.current_period_end)).replace(/[-:T]/g, '').slice(0, 12);
  return `dadam-sub-${sub.user_id}-${stamp}-${(sub.failed_attempts || 0) + 1}`;
}

/**
 * 결과를 모르는 오류인가. 이런 오류는 카드 실패로 세지 않고 구독을 그대로 둔다 —
 * 다음 실행이 같은 주문번호·멱등키로 다시 보낸다.
 *   - 연결이 끊김 / JSON 이 아닌 응답: 토스가 받았는지 모른다
 *   - IDEMPOTENT_REQUEST_PROCESSING(409): 같은 키 요청이 아직 처리 중
 *   - 가맹점 키 문제(설정 누락·UNAUTHORIZED_KEY·INCORRECT_BASIC_AUTH_FORMAT): 고객 카드 탓이 아니다.
 *     이걸 실패로 세면 키 하나 잘못 넣은 날 모든 구독자가 사흘 뒤 강등된다.
 */
const MERCHANT_SIDE_CODES = new Set([
  'CONFIG_MISSING',
  'UNAUTHORIZED_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
]);
export function isUncertainChargeError(err) {
  if (!(err instanceof TossError)) return true;
  if (err.code === 'INVALID_RESPONSE') return true;
  if (err.code === 'IDEMPOTENT_REQUEST_PROCESSING') return true;
  if (MERCHANT_SIDE_CODES.has(err.code)) return true;
  return false;
}

/** payment_history 한 줄. 첫 결제·정기 결제·수동 재시도가 같이 쓴다. */
export function historyRow({ userId, subscriptionId, orderId, plan, amount, charge, error }) {
  if (error) {
    return {
      user_id: userId,
      subscription_id: subscriptionId || null,
      provider: 'toss',
      order_id: orderId,
      plan,
      amount_krw: amount,
      status: 'failed',
      failure_code: error.code || null,
      failure_message: error.message || null,
    };
  }
  return {
    user_id: userId,
    subscription_id: subscriptionId || null,
    provider: 'toss',
    order_id: orderId,
    payment_key: charge.paymentKey || null,
    plan,
    amount_krw: amount,
    status: charge.status === 'DONE' ? 'done' : 'pending',
    method: charge.method || null,
    receipt_url: charge.receipt?.url || null,
    raw_response: charge,
  };
}

/**
 * 새 달 크레딧. 등급 변경 트리거(reset_credits_on_tier_change)와 같은 일 —
 * 지금 기간을 끊어 두면 다음 consume_credit 이 그 등급의 월 지급량으로 채운다.
 * 아직 한 번도 안 쓴 사용자는 행이 없다 — 첫 consume 이 지급량으로 만든다(할 일 없음).
 */
export async function grantMonthlyCredits(env, userId, nowMs) {
  const now = iso(nowMs);
  return updateBy(
    env,
    'user_credits',
    { user_id: `eq.${userId}` },
    { period_end: now, updated_at: now }
  );
}

/**
 * standard 로 내린다. 결제로 받은 등급일 때만 — 본사 승인 등급(manual)은 건드리지 않는다.
 * 내리면서 tier_source 도 'manual'(기본값)로 돌린다 — 결제 중이 아닌데 「결제로 받은 등급」
 * 표식이 남지 않게 (2026-10-26 결정). 이미 standard 인데 표식만 남은 경우도 같이 고친다.
 */
export async function downgradeIfSubscriptionTier(env, userId, nowMs) {
  return updateBy(
    env,
    'profiles',
    { id: `eq.${userId}`, tier_source: 'eq.subscription' },
    { tier: 'standard', tier_source: 'manual', updated_at: iso(nowMs) }
  );
}

// ───────────────────────── 정기 결제 ─────────────────────────

async function recordRenewalSuccess(env, sub, orderId, charge, nowMs) {
  // 1. 결제 기록. 같은 주문번호가 이미 있으면(앞선 실행이 남김) 넘긴다.
  await insertIgnoreDuplicate(
    env,
    'payment_history',
    historyRow({
      userId: sub.user_id,
      subscriptionId: sub.id,
      orderId,
      plan: sub.plan,
      amount: sub.amount_krw,
      charge,
    }),
    'provider,order_id'
  );

  // 2. 기간을 30일 넘긴다. 시작은 지난 기간의 끝 — 재시도 끝에 성공해도 결제일은 밀리지 않는다.
  //    읽은 그대로일 때만 바꾼다(다른 실행이 먼저 넘겼으면 0행).
  const start = sub.current_period_end;
  const end = plusDays(sub.current_period_end, PERIOD_DAYS);
  const rows = await updateBy(
    env,
    'subscriptions',
    { id: `eq.${sub.id}`, current_period_end: `eq.${sub.current_period_end}` },
    {
      status: 'active',
      current_period_start: start,
      current_period_end: end,
      next_charge_at: end,
      failed_attempts: 0,
      first_failed_at: null,
      updated_at: iso(nowMs),
    }
  );
  if (!rows || !rows.length) {
    console.warn(
      `[payments] renewal: subscription ${sub.id} already moved — skipped period update`
    );
    return 'charged';
  }

  // 3. 새 달 크레딧. 등급은 그대로 둔다.
  await grantMonthlyCredits(env, sub.user_id, nowMs);
  return 'charged';
}

async function recordRenewalFailure(env, sub, orderId, err, nowMs) {
  const now = iso(nowMs);
  const prevAttempts = sub.failed_attempts || 0;
  const attempts = prevAttempts + 1;
  const firstFailedAt = prevAttempts === 0 ? now : sub.first_failed_at || now;

  await insertIgnoreDuplicate(
    env,
    'payment_history',
    historyRow({
      userId: sub.user_id,
      subscriptionId: sub.id,
      orderId,
      plan: sub.plan,
      amount: sub.amount_krw,
      error: err,
    }),
    'provider,order_id'
  );

  const guard = { id: `eq.${sub.id}`, failed_attempts: `eq.${prevAttempts}` };

  if (attempts <= RETRY_AFTER_FIRST_FAILURE_DAYS.length) {
    // 재시도 예약. 등급은 그대로(past_due 동안 유지).
    await updateBy(env, 'subscriptions', guard, {
      status: 'past_due',
      failed_attempts: attempts,
      first_failed_at: firstFailedAt,
      next_charge_at: plusDays(firstFailedAt, RETRY_AFTER_FIRST_FAILURE_DAYS[attempts - 1]),
      updated_at: now,
    });
    return 'retry_scheduled';
  }

  // 마지막 재시도도 실패 → 해지. 등급 내리기는 만료 단계(expireCancelled)가 한다.
  // 이 구독의 current_period_end 는 이미 지났으므로 같은 실행에서 바로 처리된다.
  await updateBy(env, 'subscriptions', guard, {
    status: 'cancelled',
    cancel_reason: 'payment_failed',
    cancel_at: now,
    next_charge_at: null,
    failed_attempts: attempts,
    updated_at: now,
  });
  return 'cancelled_payment_failed';
}

/** 구독 하나를 결제해 본다. 돌려주는 값은 요약 칸 이름. */
export async function renewSubscription(env, sub, nowMs, profile) {
  if (!sub.billing_key || !sub.amount_krw || !sub.provider_customer_id) {
    console.error(`[payments] renewal: subscription ${sub.id} has no billing key/amount — skipped`);
    return 'skipped';
  }
  const orderId = renewalOrderId(sub);

  let charge;
  try {
    charge = await chargeBillingKey(env, {
      billingKey: sub.billing_key,
      customerKey: sub.provider_customer_id,
      amount: sub.amount_krw,
      orderId,
      orderName: orderNameFor(sub.plan),
      customerEmail: profile?.email || undefined,
      customerName: profile?.name || undefined,
      idempotencyKey: orderId,
    });
  } catch (e) {
    if (e instanceof TossError && e.code === 'DUPLICATED_ORDER_ID') {
      // 이 주문번호는 이미 승인됐다 — 앞선 실행이 결제하고 기록 전에 끊겼다(멱등키 15일이 지난 경우).
      // 다시 결제하지 않고, 그 결제를 찾아 기록을 잇는다.
      const found = await getPaymentByOrderId(env, orderId);
      if (found && found.status === 'DONE' && found.totalAmount === sub.amount_krw) {
        charge = found;
      } else {
        throw e;
      }
    } else if (isUncertainChargeError(e)) {
      console.error(
        `[payments] renewal: uncertain result sub=${sub.id} order=${orderId} code=${e.code || '-'} — left as is, next run retries with the same key`
      );
      return 'skipped';
    } else {
      console.warn(`[payments] renewal failed: sub=${sub.id} order=${orderId} code=${e.code}`);
      return recordRenewalFailure(env, sub, orderId, e, nowMs);
    }
  }
  return recordRenewalSuccess(env, sub, orderId, charge, nowMs);
}

// ───────────────────────── 해지 만료 ─────────────────────────

/**
 * 해지된 구독의 기간이 끝났으면 등급을 내리고 ended_at 을 찍는다.
 * 순서: 등급 먼저, ended_at 나중 — 등급 내리기가 실패하면 다음 날 다시 한다.
 */
export async function expireCancelled(env, sub, nowMs) {
  await downgradeIfSubscriptionTier(env, sub.user_id, nowMs);
  const now = iso(nowMs);
  await updateBy(
    env,
    'subscriptions',
    { id: `eq.${sub.id}`, status: 'eq.cancelled', ended_at: 'is.null' },
    { ended_at: now, next_charge_at: null, updated_at: now }
  );
  return 'ended';
}

async function profilesById(env, userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  try {
    const rows = await selectMany(env, 'profiles', {
      id: `in.(${ids.join(',')})`,
      select: 'id,email,name',
    });
    const map = {};
    (rows || []).forEach((r) => {
      map[r.id] = r;
    });
    return map;
  } catch (e) {
    // 이메일은 토스 영수증 메일용(선택 값)이다. 못 읽어도 결제는 한다.
    console.warn('[payments] profiles lookup failed:', e.message);
    return {};
  }
}

/**
 * 하루 한 번 돈다. nowMs 는 cron 이 잡힌 시각(controller.scheduledTime)이다 —
 * 재시도 시각을 그 값에서 재기 때문에 다음 날 같은 cron 이 정확히 그 시각에 걸린다.
 */
export async function runDailyLifecycle(env, nowMs = Date.now()) {
  const summary = {
    due: 0,
    charged: 0,
    retry_scheduled: 0,
    cancelled_payment_failed: 0,
    skipped: 0,
    ended: 0,
    errors: 0,
  };
  const now = iso(nowMs);

  // 1. 결제할 구독
  const due =
    (await selectMany(env, 'subscriptions', {
      provider: 'eq.toss',
      status: 'in.(active,past_due)',
      next_charge_at: `lte.${now}`,
      select: SUB_COLUMNS_FOR_CHARGE,
      order: 'next_charge_at.asc',
    })) || [];
  summary.due = due.length;
  const profiles = await profilesById(
    env,
    due.map((s) => s.user_id)
  );
  for (const sub of due) {
    try {
      const result = await renewSubscription(env, sub, nowMs, profiles[sub.user_id]);
      summary[result] += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        `[payments] renewal error sub=${sub.id}:`,
        e && e.message ? e.message : String(e)
      );
    }
  }

  // 2. 기간이 끝난 해지 구독 (사용자 해지 + 방금 마지막 재시도에 실패한 것)
  const ending =
    (await selectMany(env, 'subscriptions', {
      provider: 'eq.toss',
      status: 'eq.cancelled',
      ended_at: 'is.null',
      current_period_end: `lte.${now}`,
      select: 'id,user_id,plan,current_period_end,cancel_reason',
      order: 'current_period_end.asc',
    })) || [];
  for (const sub of ending) {
    try {
      summary[await expireCancelled(env, sub, nowMs)] += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        `[payments] expire error sub=${sub.id}:`,
        e && e.message ? e.message : String(e)
      );
    }
  }

  console.log('[payments] lifecycle', JSON.stringify(summary));
  return summary;
}

// ───────────────────────── 환불 ─────────────────────────

export class RefundError extends Error {
  constructor(code, message, statusCode = 400, extra = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

/**
 * 약관 제9조: 결제 후 7일 이내 + 그 뒤 크레딧 사용 없음 → 전액 환불.
 * 「사용」은 원장의 차감(delta < 0) 중 되돌려지지 않은 것이다.
 * 생성이 실패해 환불된 차감(refunded = true)은 쓴 것이 아니다.
 */
export async function checkRefundEligibility(env, payment, nowMs) {
  const reasons = [];
  const ageMs = nowMs - toMs(payment.created_at);
  const ageDays = Math.floor(ageMs / DAY_MS);
  if (ageMs > REFUND_WINDOW_DAYS * DAY_MS) {
    reasons.push(`결제 후 ${REFUND_WINDOW_DAYS}일이 지났습니다 (${ageDays}일 경과).`);
  }
  const used =
    (await selectMany(env, 'credit_ledger', {
      user_id: `eq.${payment.user_id}`,
      delta: 'lt.0',
      refunded: 'is.false',
      created_at: `gte.${payment.created_at}`,
      select: 'delta',
      limit: '1000',
    })) || [];
  const creditsUsed = used.reduce((sum, r) => sum - Number(r.delta || 0), 0);
  if (used.length) {
    reasons.push(`결제 후 크레딧을 사용했습니다 (${used.length}건 · ${creditsUsed} 크레딧).`);
  }
  return { eligible: reasons.length === 0, reasons, age_days: ageDays, credits_used: creditsUsed };
}

/**
 * 관리자 환불. 결제 1건을 토스에서 전액 취소하고, 구독을 바로 끝내고, 결제로 받은 등급이면 standard 로.
 * 조건을 벗어나면 override 가 없으면 거절한다(이유를 돌려준다).
 *
 * 순서: 토스 취소 → 구독 끝 → 등급 → 결제 기록 refunded (마지막).
 * 중간에 DB 가 실패하면 결제 기록이 아직 done 이라 관리자가 다시 누를 수 있고,
 * 토스 취소는 같은 멱등키라 두 번 취소되지 않는다(첫 응답을 그대로 받는다).
 */
export async function refundPayment(
  env,
  { paymentId, adminId, override = false, reason, nowMs = Date.now() }
) {
  if (typeof paymentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
    throw new RefundError('INVALID_REQUEST', 'payment_id 가 올바르지 않습니다.', 400);
  }
  const payment = await selectOne(env, 'payment_history', { id: `eq.${paymentId}`, select: '*' });
  if (!payment) throw new RefundError('NOT_FOUND', '결제 기록을 찾을 수 없습니다.', 404);
  if (payment.provider !== 'toss') {
    throw new RefundError('NOT_TOSS', '토스 결제만 이 화면에서 환불할 수 있습니다.', 400);
  }
  if (payment.status === 'refunded') {
    throw new RefundError('ALREADY_REFUNDED', '이미 환불된 결제입니다.', 409);
  }
  if (payment.status !== 'done' || !payment.payment_key) {
    throw new RefundError('NOT_REFUNDABLE', '완료된 결제만 환불할 수 있습니다.', 400);
  }

  const check = await checkRefundEligibility(env, payment, nowMs);
  if (!check.eligible && override !== true) {
    throw new RefundError(
      'REFUND_NOT_ELIGIBLE',
      `환불 조건(결제 후 ${REFUND_WINDOW_DAYS}일 이내 · 크레딧 미사용)을 벗어났습니다.`,
      409,
      { reasons: check.reasons, age_days: check.age_days, credits_used: check.credits_used }
    );
  }

  const cancelReason = (typeof reason === 'string' && reason.trim()) || '고객 요청 환불';
  const cancelled = await cancelPayment(env, payment.payment_key, {
    cancelReason,
    idempotencyKey: `dadam-refund-${payment.id}`,
  });

  const now = iso(nowMs);
  const sub = payment.subscription_id
    ? await selectOne(env, 'subscriptions', {
        id: `eq.${payment.subscription_id}`,
        select: 'id,status,ended_at',
      })
    : await selectOne(env, 'subscriptions', {
        user_id: `eq.${payment.user_id}`,
        provider: 'eq.toss',
        select: 'id,status,ended_at',
        order: 'created_at.desc',
      });
  if (sub && !(sub.status === 'cancelled' && sub.ended_at)) {
    await updateBy(
      env,
      'subscriptions',
      { id: `eq.${sub.id}` },
      {
        status: 'cancelled',
        cancel_reason: 'refunded',
        cancel_at: now,
        next_charge_at: null,
        failed_attempts: 0,
        first_failed_at: null,
        ended_at: now,
        updated_at: now,
      }
    );
  }
  await downgradeIfSubscriptionTier(env, payment.user_id, nowMs);

  await updateBy(
    env,
    'payment_history',
    { id: `eq.${payment.id}` },
    {
      status: 'refunded',
      refunded_at: now,
      refunded_by: adminId || null,
      refund_reason: cancelReason.slice(0, 200),
      refund_override: !check.eligible,
    }
  );

  console.log(
    `[payments] refund: payment=${payment.id} user=${payment.user_id} override=${!check.eligible} by=${adminId || '-'}`
  );
  return {
    payment_id: payment.id,
    amount_krw: payment.amount_krw,
    override_used: !check.eligible,
    reasons: check.reasons,
    toss_status: cancelled?.status || null,
  };
}
