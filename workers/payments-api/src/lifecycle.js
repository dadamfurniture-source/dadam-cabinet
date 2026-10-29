/**
 * 구독 수명주기 — 정기 결제 · 실패 재시도 · 해지 만료 · 환불.
 *
 * 규칙 출처 (여기서 새로 정한 값은 없다):
 *   - 정기 결제: 30일마다, 저장한 빌링키로. next_charge_at <= 지금 인 활성 구독.
 *     하루 한 번 cron 이 돈다 (wrangler.toml [triggers]).
 *   - 결제 실패: 1일 뒤 재시도, 첫 실패 3일 뒤 마지막 재시도.
 *     고객이 「지금 다시 결제」·「카드 바꾸기」로 직접 결제할 수 있다 — 실패해도 이 일정은 그대로.
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
 *
 * 업체 구독(company_id 가 있는 구독, src/company.js):
 *   - 등급은 DB 트리거가 업체 plan · status 로 맞춘다 — 여기서 profiles 를 쓰지 않는다.
 *   - 결제 금액은 업체가 다음 기간에 쓸 등급(next_plan, 없으면 plan)의 값이다 (chargeTerms).
 *     성공하면 구독 행 plan · amount 와 업체 plan 을 그 등급으로 바꾸고 next_plan 을 비운다. 실패면 그대로.
 *   - 새 달 크레딧은 업체 통장(company_credits)의 기간을 끊는다.
 *   - 만료 단계: 결제가 끝내 안 됐으면 업체 suspended, 해지 기간이 끝났으면 closed. 환불도 closed.
 */

import { chargeBillingKey, cancelPayment, getPaymentByOrderId, TossError } from './toss.js';
import { selectOne, selectMany, insertIgnoreDuplicate, updateBy } from './supabase.js';
import { orderNameFor, priceFor } from './plans.js';
import { endCompany, resetCompanyCredits } from './company.js';
import {
  notifyCompanyOwners,
  billingFailedMessage,
  companySuspendedMessage,
} from './push-outbox.js';

export const DAY_MS = 86_400_000;
export const PERIOD_DAYS = 30;
/** 첫 실패로부터 며칠 뒤에 다시 거는가. 길이 = 재시도 횟수. */
export const RETRY_AFTER_FIRST_FAILURE_DAYS = [1, 3];
export const REFUND_WINDOW_DAYS = 7;

/** 결제에 필요한 구독 칸 — 서버 안에서만 쓴다(billing_key 포함, 응답에 싣지 않는다). */
export const SUB_COLUMNS_FOR_CHARGE = [
  'id',
  'user_id',
  'company_id',
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
  'charge_lock_until',
  'charge_order_id',
].join(',');

/**
 * 결제 잠금 시간. 토스 자동결제 승인은 최대 60초가 걸린다 — 넉넉히 5분.
 * 워커가 결제 도중 죽어도 5분 뒤에는 풀린다.
 */
export const CHARGE_LOCK_MS = 5 * 60_000;

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
  return `dadam-sub-${sub.user_id}-${periodStamp(sub)}-${(sub.failed_attempts || 0) + 1}`;
}

/** 이번 기간 끝 시각 YYYYMMDDHHmm — 주문번호 · 알림 dedupe 키가 같은 기간을 가를 때 쓴다 */
function periodStamp(sub) {
  return iso(toMs(sub.current_period_end)).replace(/[-:T]/g, '').slice(0, 12);
}

/**
 * 업체 구독의 결제 실패 앱 알림 — 대표에게 (재시도 시작 · 마지막 실패). 이 기간 · 이 단계에 한 번.
 * 바꾼 줄이 없으면(다른 실행이 먼저 옮겼다) 알리지 않는다. 실패해도 결제 처리는 그대로다.
 */
async function notifyBillingFailed(env, sub, rows, final) {
  if (!sub.company_id || !Array.isArray(rows) || !rows.length) return;
  await notifyCompanyOwners(env, {
    companyId: sub.company_id,
    kind: 'billing_failed',
    refId: sub.id,
    suffix: `${periodStamp(sub)}:${final ? 'final' : 'past_due'}`,
    message: billingFailedMessage({ final }),
  });
}

/**
 * 고객이 직접 누른 결제(지금 다시 결제 · 카드 바꾼 뒤 결제)의 주문번호. 누를 때마다 새로 만든다.
 * 정기 결제 주문번호와 겹치지 않아야 한다 — 겹치면 수동 결제의 실패 응답이 멱등키에 남아
 * 예정된 재시도가 실제로 카드를 다시 긁지 못한다.
 * 길이: 10 + 36 + 1 + 12 = 59.
 */
export function manualOrderId(userId) {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `dadam-sub-${userId}-${rand}`;
}

/**
 * 결제 오류를 세 갈래로 나눈다.
 *   declined  카드사·토스가 거절했다 — 결제되지 않은 것이 확실하다
 *   merchant  가맹점 키 문제(설정 누락·UNAUTHORIZED_KEY·INCORRECT_BASIC_AUTH_FORMAT) — 고객 카드 탓이 아니다.
 *             정기 결제에서 이걸 실패로 세면 키 하나 잘못 넣은 날 모든 구독자가 사흘 뒤 강등된다
 *   uncertain 토스가 받았는지 모른다 — 연결 끊김 · JSON 아닌 응답 · IDEMPOTENT_REQUEST_PROCESSING(409)
 */
const MERCHANT_SIDE_CODES = new Set([
  'CONFIG_MISSING',
  'UNAUTHORIZED_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
]);
export function classifyChargeError(err) {
  if (!(err instanceof TossError)) return 'uncertain';
  if (err.code === 'INVALID_RESPONSE' || err.code === 'IDEMPOTENT_REQUEST_PROCESSING') {
    return 'uncertain';
  }
  if (MERCHANT_SIDE_CODES.has(err.code)) return 'merchant';
  return 'declined';
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
 * 표식이 남지 않게. 이미 standard 인데 표식만 남은 경우도 같이 고친다.
 */
export async function downgradeIfSubscriptionTier(env, userId, nowMs) {
  return updateBy(
    env,
    'profiles',
    { id: `eq.${userId}`, tier_source: 'eq.subscription' },
    { tier: 'standard', tier_source: 'manual', updated_at: iso(nowMs) }
  );
}

// ───────────────────────── 결제 잠금 ─────────────────────────
//
// 결제는 모두(정기 결제 cron · 지금 다시 결제 · 카드 바꾼 뒤 결제) 구독 행의 잠금을 먼저 잡는다.
// 잠금 = 조건부 PATCH 한 번: 「잠금이 비었거나 지났고, 구독 상태가 기대한 그대로이고,
// 앞선 결제 주문번호(charge_order_id)도 읽은 그대로일 때만」 charge_lock_until · charge_order_id 를 쓴다.
// 0행이면 다른 요청이 이미 결제 중이다(두 번 누름 · cron 과 겹침) — 결제하지 않는다.
// 결과가 확정되면(성공·거절) 같은 PATCH 안에서 잠금을 푼다. 결과를 모르면 잠금을 두고
// 주문번호를 남긴다 — 다음 결제는 그 주문번호부터 토스에 물어 본다(reconcileOrder).
// 잠금 시각은 벽시계(Date.now)로 잰다 — cron 의 기준 시각(scheduledTime)은 실행 내내 고정이라 맞지 않다.

const UNLOCK = { charge_lock_until: null, charge_order_id: null };

/** 잠금용 벽시계. 시험이 날짜를 건너뛸 때만 갈아 끼운다. */
export const clock = { now: () => Date.now() };

/** PostgREST 필터: 결제 잠금이 비었거나 지났다. 해지·카드 바꾸기도 이 조건으로 결제 중인 행을 피한다. */
export function lockFreeFilter() {
  return `(charge_lock_until.is.null,charge_lock_until.lt."${iso(clock.now())}")`;
}

async function acquireChargeLock(env, sub, orderId, stateFilter) {
  const rows = await updateBy(
    env,
    'subscriptions',
    {
      id: `eq.${sub.id}`,
      ...stateFilter,
      or: lockFreeFilter(),
      charge_order_id: sub.charge_order_id ? `eq.${sub.charge_order_id}` : 'is.null',
    },
    { charge_lock_until: iso(clock.now() + CHARGE_LOCK_MS), charge_order_id: orderId }
  );
  return rows && rows.length ? rows[0] : null;
}

/** 잠금을 푼다. keepOrderId 를 주면 그 주문번호는 남긴다(결과를 아직 모르는 결제). */
async function releaseChargeLock(env, subId, orderId, keepOrderId = null) {
  return updateBy(
    env,
    'subscriptions',
    { id: `eq.${subId}`, charge_order_id: `eq.${orderId}` },
    { charge_lock_until: null, charge_order_id: keepOrderId }
  );
}

/**
 * 이번 결제의 등급 · 금액. 개인 구독은 구독 행 그대로.
 * 업체 구독은 업체가 다음 기간에 쓸 등급(next_plan, 없으면 plan) — 구독 행과 같으면 구독 행 금액,
 * 다르면 그 등급의 값(plans.js). company 는 결제가 되면 업체 등급을 옮길 때 쓴다.
 */
async function chargeTerms(env, sub) {
  const base = { plan: sub.plan, amount: sub.amount_krw, company: null };
  if (!sub.company_id) return base;
  const company = await selectOne(env, 'companies', {
    id: `eq.${sub.company_id}`,
    select: 'id,plan,next_plan',
  });
  if (!company) return base;
  const plan = company.next_plan || company.plan;
  const amount = plan === sub.plan ? sub.amount_krw : priceFor(env, plan);
  if (!plan || !amount) return { ...base, company };
  return { plan, amount, company };
}

/**
 * 이미 된 결제(앞서 결과를 몰랐던 주문)의 금액이 어느 조건인가.
 * 이번 조건과 같거나 구독 행 그대로의 금액이면 그 조건. 둘 다 아니면 null (우리가 건 금액이 아니다).
 */
function paidTerms(sub, terms, amount) {
  if (amount === terms.amount) return terms;
  if (amount === sub.amount_krw) return { ...terms, plan: sub.plan, amount: sub.amount_krw };
  return null;
}

/** 결과를 모른 채 끝난 결제를 토스에 묻는다. */
async function reconcileOrder(env, sub, terms, orderId) {
  try {
    const p = await getPaymentByOrderId(env, orderId);
    const paid = p && p.status === 'DONE' ? paidTerms(sub, terms, p.totalAmount) : null;
    if (paid) return { done: p, terms: paid };
    return { none: true };
  } catch (e) {
    if (e instanceof TossError && e.statusCode === 404) return { none: true };
    return { unknown: e };
  }
}

// ───────────────────────── 결제 한 번 ─────────────────────────

async function recordChargeSuccess(env, sub, orderId, charge, nowMs, terms) {
  // 1. 결제 기록. 같은 주문번호가 이미 있으면(앞선 실행이 남김) 넘긴다.
  await insertIgnoreDuplicate(
    env,
    'payment_history',
    historyRow({
      userId: sub.user_id,
      subscriptionId: sub.id,
      orderId,
      plan: terms.plan,
      amount: terms.amount,
      charge,
    }),
    'provider,order_id'
  );

  // 2. 업체 등급을 결제한 등급으로 (next_plan 을 비운다). 구성원 등급 · 업체 통장은 트리거가 맞춘다.
  //    구독 행보다 먼저 — 여기서 실패하면 잠금 · 주문번호가 남아 다음 결제가 이 결제를 찾아 다시 한다.
  if (terms.company && terms.company.plan !== terms.plan) {
    await updateBy(
      env,
      'companies',
      { id: `eq.${terms.company.id}` },
      { plan: terms.plan, next_plan: null }
    );
  }

  // 3. 기간을 30일 넘긴다. 시작은 지난 기간의 끝 — 재시도 끝에 성공해도 결제일은 밀리지 않는다.
  //    읽은 그대로일 때만 바꾼다(다른 실행이 먼저 넘겼으면 0행).
  const start = sub.current_period_end;
  const end = plusDays(sub.current_period_end, PERIOD_DAYS);
  const planChange =
    terms.plan !== sub.plan || terms.amount !== sub.amount_krw
      ? { plan: terms.plan, amount_krw: terms.amount }
      : {};
  const rows = await updateBy(
    env,
    'subscriptions',
    { id: `eq.${sub.id}`, current_period_end: `eq.${sub.current_period_end}` },
    {
      status: 'active',
      ...planChange,
      current_period_start: start,
      current_period_end: end,
      next_charge_at: end,
      failed_attempts: 0,
      first_failed_at: null,
      ...UNLOCK,
      updated_at: iso(nowMs),
    }
  );
  if (!rows || !rows.length) {
    console.warn(
      `[payments] renewal: subscription ${sub.id} already moved — skipped period update`
    );
    // sub 는 잠근 행이다 — 잠금의 주문번호는 sub.charge_order_id (정리한 앞선 결제면 orderId 와 다르다).
    await releaseChargeLock(env, sub.id, sub.charge_order_id || orderId);
    return 'charged';
  }

  // 4. 새 달 크레딧. 개인 구독은 등급을 그대로 둔다.
  if (sub.company_id) await resetCompanyCredits(env, sub.company_id, nowMs);
  else await grantMonthlyCredits(env, sub.user_id, nowMs);
  return 'charged';
}

async function recordRenewalFailure(env, sub, orderId, err, nowMs, terms) {
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
      plan: terms ? terms.plan : sub.plan,
      amount: terms ? terms.amount : sub.amount_krw,
      error: err,
    }),
    'provider,order_id'
  );

  const guard = { id: `eq.${sub.id}`, failed_attempts: `eq.${prevAttempts}` };

  if (attempts <= RETRY_AFTER_FIRST_FAILURE_DAYS.length) {
    // 재시도 예약. 등급은 그대로(past_due 동안 유지).
    const rows = await updateBy(env, 'subscriptions', guard, {
      status: 'past_due',
      failed_attempts: attempts,
      first_failed_at: firstFailedAt,
      next_charge_at: plusDays(firstFailedAt, RETRY_AFTER_FIRST_FAILURE_DAYS[attempts - 1]),
      ...UNLOCK,
      updated_at: now,
    });
    // 재시도가 시작될 때(첫 실패) 업체 대표에게 앱 알림
    if (attempts === 1) await notifyBillingFailed(env, sub, rows, false);
    return 'retry_scheduled';
  }

  // 마지막 재시도도 실패 → 해지. 등급 내리기(업체 구독은 업체 정지)는 만료 단계(expireCancelled)가 한다.
  // 이 구독의 current_period_end 는 이미 지났으므로 같은 실행에서 바로 처리된다.
  const rows = await updateBy(env, 'subscriptions', guard, {
    status: 'cancelled',
    cancel_reason: 'payment_failed',
    cancel_at: now,
    next_charge_at: null,
    failed_attempts: attempts,
    ...UNLOCK,
    updated_at: now,
  });
  await notifyBillingFailed(env, sub, rows, true);
  return 'cancelled_payment_failed';
}

/**
 * 결제 한 번 — 정기 결제 cron · 지금 다시 결제 · 카드 바꾼 뒤 결제가 모두 이 길로 간다.
 *   1. 잠금 (acquireChargeLock). 못 잡으면 busy
 *   2. 앞서 결과를 모른 결제(charge_order_id)가 있으면 토스에 묻는다 — 이미 됐으면 그걸로 끝낸다
 *   3. 저장된 빌링키로 결제. 주문번호 = 토스 멱등키. 금액은 chargeTerms (업체 구독은 다음 기간 등급)
 *   4. 성공이면 기록 · (업체 등급 옮김) · 기간 +30일 · 재시도 기록 지움 · 새 달 크레딧 · 잠금 풂
 *      (recordChargeSuccess)
 * 실패를 재시도 횟수로 셀지는 부르는 쪽이 정한다 — cron 은 세고, 고객이 누른 결제는 세지 않는다.
 *
 * outcome: charged | declined | merchant | uncertain | busy
 */
async function chargeOnce(env, sub, { orderId, stateFilter, nowMs, profile }) {
  const prevOrderId = sub.charge_order_id || null;
  // 잠그기 전에 읽는다 — 읽다 실패해도 잠금 · 앞선 주문번호가 그대로 남는다.
  const terms = await chargeTerms(env, sub);
  const locked = await acquireChargeLock(env, sub, orderId, stateFilter);
  if (!locked) return { outcome: 'busy', orderId };
  const cur = { ...sub, ...locked };

  // 같은 주문번호(정기 결제 같은 회차)여도 먼저 묻는다 — 업체 구독은 그 사이 금액(next_plan)이 바뀌었을 수 있어,
  // 같은 멱등키로 다른 금액을 보내지 않는다.
  if (prevOrderId) {
    const r = await reconcileOrder(env, cur, terms, prevOrderId);
    if (r.done) {
      console.warn(
        `[payments] charge: earlier order ${prevOrderId} turned out DONE — recorded, not charged again`
      );
      await recordChargeSuccess(env, cur, prevOrderId, r.done, nowMs, r.terms);
      return { outcome: 'charged', orderId: prevOrderId, recovered: true };
    }
    if (r.unknown) {
      // 아직도 모른다 — 앞선 주문번호를 남긴 채 잠금만 푼다. 새로 결제하지 않는다.
      await releaseChargeLock(env, cur.id, orderId, prevOrderId);
      return { outcome: 'uncertain', orderId: prevOrderId, error: r.unknown };
    }
  }

  let charge;
  let paid = terms;
  try {
    charge = await chargeBillingKey(env, {
      billingKey: cur.billing_key,
      customerKey: cur.provider_customer_id,
      amount: terms.amount,
      orderId,
      orderName: orderNameFor(terms.plan),
      customerEmail: profile?.email || undefined,
      customerName: profile?.name || undefined,
      idempotencyKey: orderId,
    });
  } catch (e) {
    if (e instanceof TossError && e.code === 'DUPLICATED_ORDER_ID') {
      // 이 주문번호는 이미 승인됐다 — 앞선 실행이 결제하고 기록 전에 끊겼다(멱등키 15일이 지난 경우).
      // 다시 결제하지 않고, 그 결제를 찾아 기록을 잇는다.
      const found = await getPaymentByOrderId(env, orderId);
      paid = found && found.status === 'DONE' ? paidTerms(cur, terms, found.totalAmount) : null;
      if (paid) {
        charge = found;
      } else {
        console.error(
          `[payments] charge: duplicated order ${orderId} is not DONE — needs a manual check`
        );
        return { outcome: 'uncertain', orderId, error: e, sub: cur, terms };
      }
    } else {
      const kind = classifyChargeError(e);
      if (kind === 'merchant') await releaseChargeLock(env, cur.id, orderId);
      // uncertain: 잠금과 주문번호를 그대로 둔다 — 5분 뒤 다음 결제가 이 주문번호부터 토스에 묻는다.
      console.warn(
        `[payments] charge ${kind}: sub=${cur.id} order=${orderId} code=${e.code || '-'}`
      );
      return { outcome: kind, orderId, error: e, sub: cur, terms };
    }
  }
  // 기록은 실제로 결제된 금액의 조건으로 (멱등키가 앞선 응답을 돌려준 경우)
  if (paid === terms && typeof charge.totalAmount === 'number') {
    paid = paidTerms(cur, terms, charge.totalAmount) || terms;
  }
  await recordChargeSuccess(env, cur, orderId, charge, nowMs, paid);
  return { outcome: 'charged', orderId, charge };
}

/** 정기 결제 (cron). 돌려주는 값은 요약 칸 이름. 거절은 재시도 횟수로 센다. */
export async function renewSubscription(env, sub, nowMs, profile) {
  if (!sub.billing_key || !sub.amount_krw || !sub.provider_customer_id) {
    console.error(`[payments] renewal: subscription ${sub.id} has no billing key/amount — skipped`);
    return 'skipped';
  }
  const orderId = renewalOrderId(sub);
  const r = await chargeOnce(env, sub, {
    orderId,
    nowMs,
    profile,
    // 읽은 상태 그대로일 때만 — 주문번호가 이 기간·회차에서 나왔다
    stateFilter: {
      status: 'in.(active,past_due)',
      next_charge_at: `lte.${iso(nowMs)}`,
      current_period_end: `eq.${sub.current_period_end}`,
      failed_attempts: `eq.${sub.failed_attempts || 0}`,
    },
  });
  if (r.outcome === 'charged') return 'charged';
  if (r.outcome === 'declined') {
    return recordRenewalFailure(env, r.sub, r.orderId, r.error, nowMs, r.terms);
  }
  if (r.outcome === 'uncertain') {
    console.error(
      `[payments] renewal: uncertain result sub=${sub.id} order=${r.orderId} — left as is, next run checks this order first`
    );
  }
  return 'skipped'; // busy · merchant · uncertain
}

/**
 * 고객이 누른 결제 — 「지금 다시 결제」·「카드 바꾸기」 뒤 결제. 결제 실패 재시도 중(past_due)일 때만.
 * 성공하면 cron 재시도 성공과 같다. 거절되면 결제 기록만 남기고 재시도 일정(+1일 · +3일)·
 * 횟수·등급은 그대로 둔다.
 * 돌려주는 값: { outcome, error? }  outcome = charged | declined | merchant | uncertain | busy | not_past_due
 */
export async function chargePastDueNow(env, sub, { nowMs = Date.now(), profile } = {}) {
  if (!sub || sub.status !== 'past_due') return { outcome: 'not_past_due' };
  const orderId = manualOrderId(sub.user_id);
  const r = await chargeOnce(env, sub, {
    orderId,
    nowMs,
    profile,
    stateFilter: { status: 'eq.past_due' },
  });
  if (r.outcome === 'declined') {
    try {
      await insertIgnoreDuplicate(
        env,
        'payment_history',
        historyRow({
          userId: sub.user_id,
          subscriptionId: sub.id,
          orderId: r.orderId,
          plan: r.terms ? r.terms.plan : sub.plan,
          amount: r.terms ? r.terms.amount : sub.amount_krw,
          error: r.error,
        }),
        'provider,order_id'
      );
    } finally {
      await releaseChargeLock(env, sub.id, r.orderId);
    }
  }
  return r;
}

// ───────────────────────── 해지 만료 ─────────────────────────

/**
 * 해지된 구독의 기간이 끝났으면 등급을 내리고 ended_at 을 찍는다.
 * 순서: 등급 먼저, ended_at 나중 — 등급 내리기가 실패하면 다음 날 다시 한다.
 * 업체 구독은 등급 대신 업체 status 를 바꾼다 (구성원 등급은 트리거가 맞춘다) —
 * 결제가 끝내 안 됐으면 suspended, 해지면 closed.
 */
export async function expireCancelled(env, sub, nowMs) {
  if (sub.company_id) {
    const suspend = sub.cancel_reason === 'payment_failed';
    const changed = await endCompany(env, sub.company_id, suspend ? 'suspended' : 'closed');
    // 이번에 정지됐으면 업체 대표에게 앱 알림 (구독 하나에 한 번)
    if (suspend && changed) {
      await notifyCompanyOwners(env, {
        companyId: sub.company_id,
        kind: 'company_suspended',
        refId: sub.id,
        message: companySuspendedMessage(),
      });
    }
  } else {
    await downgradeIfSubscriptionTier(env, sub.user_id, nowMs);
  }
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
      select: 'id,user_id,company_id,plan,current_period_end,cancel_reason',
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
 * 업체 구독의 결제(companyId)는 업체 통장 줄(credit_ledger.company_id)로 본다 — 구성원 누가 썼든.
 */
export async function checkRefundEligibility(env, payment, nowMs, companyId = null) {
  const reasons = [];
  const ageMs = nowMs - toMs(payment.created_at);
  const ageDays = Math.floor(ageMs / DAY_MS);
  if (ageMs > REFUND_WINDOW_DAYS * DAY_MS) {
    reasons.push(`결제 후 ${REFUND_WINDOW_DAYS}일이 지났습니다 (${ageDays}일 경과).`);
  }
  // 탈퇴한 회원의 결제는 user_id 가 비어 있다 (database/withdrawal-retention.sql). 원장도 회원과 떨어져
  //   (withdrawal-contract-records.sql) 누가 썼는지 알 수 없다 — 「확인할 수 없음」을 이유로 남긴다 (관리자 예외로만 환불).
  if (!companyId && !payment.user_id) {
    reasons.push('탈퇴한 회원의 결제라 크레딧 사용을 확인할 수 없습니다.');
    return { eligible: false, reasons, age_days: ageDays, credits_used: null };
  }
  const used =
    (await selectMany(env, 'credit_ledger', {
      ...(companyId ? { company_id: `eq.${companyId}` } : { user_id: `eq.${payment.user_id}` }),
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
 * 업체 구독의 결제면 등급 대신 업체를 closed 로 (구성원 등급은 트리거가 맞춘다).
 * 조건을 벗어나면 override 가 없으면 거절한다(이유를 돌려준다).
 *
 * 순서: 토스 취소 → 구독 끝 → 등급(업체 closed) → 결제 기록 refunded (마지막).
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

  // 탈퇴한 회원(user_id 없음)은 결제에 적힌 구독만 본다 — user_id 로 찾을 수 없다
  const sub = payment.subscription_id
    ? await selectOne(env, 'subscriptions', {
        id: `eq.${payment.subscription_id}`,
        select: 'id,status,ended_at,company_id',
      })
    : payment.user_id
      ? await selectOne(env, 'subscriptions', {
          user_id: `eq.${payment.user_id}`,
          provider: 'eq.toss',
          select: 'id,status,ended_at,company_id',
          order: 'created_at.desc',
        })
      : null;
  const companyId = (sub && sub.company_id) || null;

  const check = await checkRefundEligibility(env, payment, nowMs, companyId);
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
  // 업체 구독이면 업체를 닫는다. 등급을 내릴 회원이 없으면(탈퇴) 건너뛴다
  if (companyId) await endCompany(env, companyId, 'closed');
  else if (payment.user_id) await downgradeIfSubscriptionTier(env, payment.user_id, nowMs);

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
