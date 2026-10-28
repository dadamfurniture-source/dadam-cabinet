/**
 * Dadam Payments API — Cloudflare Worker
 *
 * 라우트:
 *   GET  /health
 *   GET  /plans                  — 플랜 + Toss client_key (공개)
 *   GET  /subscription           — 현재 구독 (인증). 협력업체 구성원이면 업체 구독 · 업체
 *   POST /issue-billing-key      — authKey → billingKey + 첫 과금 = 업체 구독 시작 (인증)
 *   POST /subscription/retry     — 지금 다시 결제 (인증, 결제 실패 재시도 중일 때만)
 *   POST /subscription/card      — 카드 바꾸기: authKey → 새 billingKey, 재시도 중이면 바로 결제 (인증)
 *   POST /charge                 — 예전 경로. /subscription/retry 와 같다
 *   POST /cancel                 — 구독 취소 (인증)
 *   POST /admin/refund           — 결제 1건 환불 (관리자, is_admin())
 *   POST /webhook                — Toss 웹훅 (공개, 결제 조회 API 로 재확인)
 *   업체 구독의 결제 · 카드 · 해지는 업체 대표(owner)만 한다.
 *
 * cron (wrangler.toml [triggers]) — 하루 한 번 src/lifecycle.js:
 *   정기 결제(30일) · 실패 재시도(1일 · 3일) · 해지 만료 강등
 *
 * customerKey 규칙: `dadam-${supabase_user.id}`
 * 첫 과금: 빌링키 발급 즉시 1회차 + next_charge_at = now+30d
 * Expert · Agent 결제는 모두 업체 구독이다 (src/company.js). 등급은 DB 트리거가 맞춘다 — profiles 를 쓰지 않는다.
 */

import { handleOptions, jsonResponse } from './cors.js';
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
  deleteBy,
} from './supabase.js';
import { PLAN_NAMES, PAID_PLANS, priceFor } from './plans.js';
import {
  runDailyLifecycle,
  refundPayment,
  RefundError,
  historyRow,
  chargePastDueNow,
  SUB_COLUMNS_FOR_CHARGE,
  lockFreeFilter,
} from './lifecycle.js';
import {
  readMembership,
  publicCompany,
  liveCompanySubscription,
  resetCompanyCredits,
} from './company.js';

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

/** 브라우저에 돌려줄 구독 — 위 칸만. billing_key · 잠금 · 주문번호 같은 내부 값은 싣지 않는다. */
function publicSubscription(row) {
  if (!row) return null;
  const out = {};
  for (const k of SUBSCRIPTION_COLUMNS.split(',')) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

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

/**
 * 협력업체 구성원이면 업체 구독. 대표는 구독 + company, 실장 · 직원은 구독 칸 없이 company · role.
 * 그 밖(본사 구성원 · 구성원 아님)은 예전처럼 본인 구독 — 업체 구독 행은 빼고 본다.
 */
async function handleSubscription(request, env) {
  const user = await verifyJwt(request, env);
  const member = await readMembership(env, user.id);
  if (member && member.company.kind === 'partner') {
    const company = publicCompany(member.company);
    if (member.role !== 'owner') {
      return jsonResponse(request, env, { success: true, data: null, company, role: member.role });
    }
    const companySub = await selectOne(env, 'subscriptions', {
      company_id: `eq.${member.company.id}`,
      select: SUBSCRIPTION_COLUMNS,
      order: 'created_at.desc',
    });
    return jsonResponse(request, env, {
      success: true,
      data: publicSubscription(companySub),
      company,
      role: member.role,
    });
  }
  const sub = await selectOne(env, 'subscriptions', {
    user_id: `eq.${user.id}`,
    company_id: 'is.null',
    select: SUBSCRIPTION_COLUMNS,
    order: 'created_at.desc',
  });
  if (!sub) {
    return jsonResponse(request, env, {
      success: true,
      data: { plan: 'free', status: 'active', provider: null },
    });
  }
  return jsonResponse(request, env, { success: true, data: publicSubscription(sub) });
}

// 업체 이름 · 지역 길이 (companies · partner_applications 의 CHECK 와 같다)
const COMPANY_INPUT_MAX = { name: 100, sido: 20, gugun: 40 };

/** body.company → { value: {name, sido, gugun} } 또는 { field } (앞뒤 공백은 자른다). */
function readCompanyInput(raw) {
  const value = {};
  for (const [field, max] of Object.entries(COMPANY_INPUT_MAX)) {
    const v =
      raw && typeof raw === 'object' && typeof raw[field] === 'string' ? raw[field].trim() : '';
    if (!v || v.length > max) return { field };
    value[field] = v;
  }
  return { value };
}

function refuse(status, code, message, extra = {}) {
  return { refuse: { status, body: { success: false, code, message, ...extra } } };
}

/**
 * 결제 전 판단 — 어느 업체로 결제하는가. 막을 것은 모두 여기서 막는다 (결제 뒤에 막으면 되돌릴 일이 생긴다).
 *   본사 구성원 → hq_member
 *   협력업체 구성원 → 대표만, 살아 있는 구독이 없고, 업체 등급과 같은 plan 일 때 그 업체로 (다시 시작 · 관리자가 만든 업체)
 *   구성원 아님 → 새 업체. Expert 는 body.company (이름 · 시·도 · 시·군·구),
 *                 Agent 는 승인된 새 업체 신청(아직 안 씀)이 있어야 하고 이름 · 지역은 신청 값.
 * 돌려주는 값: { refuse } | { company } (기존 업체) | { create, application? } (새 업체)
 */
async function resolveCompanyForPayment(env, user, plan, body) {
  const member = await readMembership(env, user.id);
  if (member) {
    const c = member.company;
    if (c.kind !== 'partner') {
      return refuse(409, 'hq_member', '본사 구성원은 협력업체 구독을 시작할 수 없습니다.');
    }
    if (member.role !== 'owner') {
      return refuse(403, 'not_owner', '업체 구독은 대표만 결제할 수 있습니다.');
    }
    if (await liveCompanySubscription(env, c.id)) {
      return refuse(409, 'already_subscribed', '이미 이용 중인 업체 구독이 있습니다.');
    }
    if (c.plan !== plan) {
      return refuse(409, 'plan_mismatch', '업체 등급과 같은 등급으로만 결제할 수 있습니다.');
    }
    return { company: c };
  }
  if (plan === 'agent') {
    const application = await selectOne(env, 'partner_applications', {
      user_id: `eq.${user.id}`,
      kind: 'eq.new',
      status: 'eq.approved',
      used_at: 'is.null',
      select: 'id,company_name,sido,gugun',
      order: 'created_at.desc',
    });
    if (!application) {
      return refuse(403, 'agent_not_approved', 'Agent 는 본사 승인을 받은 뒤 결제할 수 있습니다.');
    }
    return {
      create: { name: application.company_name, sido: application.sido, gugun: application.gugun },
      application,
    };
  }
  const input = readCompanyInput(body.company);
  if (!input.value) {
    return refuse(422, 'invalid', '업체 이름과 지역(시·도, 시·군·구)을 확인해 주세요.', {
      field: input.field,
    });
  }
  return { create: input.value };
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
  const target = await resolveCompanyForPayment(env, user, body.plan, body);
  if (target.refuse) {
    return jsonResponse(request, env, target.refuse.body, target.refuse.status);
  }
  // 새 업체의 id 는 여기서 정한다 — 저장 응답을 못 받아도 되돌릴 행을 찾을 수 있게.
  const companyId = target.company ? target.company.id : crypto.randomUUID();

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

  // 3. 저장. 여기서 실패하면 방금 한 결제를 토스에서 취소하고 만든 행을 지운다 —
  //    카드는 긁혔는데 구독이 없는 상태를 남기지 않는다.
  //    순서: 결제 기록 → (새 업체) 업체 → 대표 구성원 → (Agent) 신청 씀 / (기존 업체) 다시 active
  //          → 구독 행(마지막).
  //    구독 행은 cron 이 다음 달에 결제하는 근거다. 마지막에 써야, 중간에 실패해서
  //    결제를 취소했는데 구독 행만 남아 다음 달에 다시 결제되는 일이 없다.
  //    등급(profiles.tier)은 쓰지 않는다 — 구성원 · 업체가 바뀌면 트리거가 맞춘다.
  //    업체 이력(company_events)은 지울 수 없어 저장이 다 끝난 뒤에 넣는다 (아래 4).
  const start = nowIso();
  const next = plus30dIso();
  const done = {
    historyId: null,
    companyAttempted: false,
    memberAttempted: false,
    applicationId: null,
    prevStatus: null,
    subscriptionAttempted: false,
  };
  let subId = null;
  try {
    const hist = await insertOne(
      env,
      'payment_history',
      historyRow({ userId: user.id, orderId, plan: body.plan, amount, charge })
    );
    done.historyId = hist?.id || null;

    if (target.create) {
      done.companyAttempted = true;
      await insertOne(env, 'companies', {
        id: companyId,
        kind: 'partner',
        name: target.create.name,
        plan: body.plan,
        status: 'active',
        sido: target.create.sido,
        gugun: target.create.gugun,
        created_by: user.id,
      });
      done.memberAttempted = true;
      await insertOne(env, 'company_members', {
        company_id: companyId,
        user_id: user.id,
        role: 'owner',
        status: 'active',
      });
      if (target.application) {
        done.applicationId = target.application.id;
        const used = await updateBy(
          env,
          'partner_applications',
          { id: `eq.${target.application.id}`, status: 'eq.approved', used_at: 'is.null' },
          { company_id: companyId, used_at: start }
        );
        if (!used || !used.length) throw new Error('application is no longer usable');
      }
    } else if (target.company.status !== 'active') {
      // 정지 · 해지된 업체를 다시 시작한다
      done.prevStatus = target.company.status;
      const reopened = await updateBy(
        env,
        'companies',
        { id: `eq.${companyId}`, status: `eq.${target.company.status}` },
        { status: 'active' }
      );
      if (!reopened || !reopened.length) throw new Error('company status changed');
    }

    const subData = {
      company_id: companyId,
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
      charge_lock_until: null,
      charge_order_id: null,
      updated_at: start,
    };
    done.subscriptionAttempted = true;
    const inserted = await insertOne(env, 'subscriptions', subData);
    subId = inserted?.id || null;
  } catch (e) {
    const undone = await undoFirstPayment(env, {
      user,
      orderId,
      charge,
      billingKey,
      companyId,
      done,
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
  if (subId && done.historyId) {
    await bestEffort('link history to subscription', () =>
      updateById(env, 'payment_history', done.historyId, { subscription_id: subId })
    );
  }
  //    다시 시작한 업체: 결제한 달의 크레딧이 시작되도록 업체 통장 기간을 끊는다 (새 업체는 통장이 아직 없다).
  //    개인 크레딧(user_credits)은 건드리지 않는다.
  if (target.company) {
    await bestEffort('company credit period reset', () =>
      resetCompanyCredits(env, companyId, Date.now())
    );
  }
  //    업체 이력 — 맨 마지막 (지울 수 없다)
  await bestEffort('company event', () =>
    insertOne(env, 'company_events', {
      company_id: companyId,
      actor_user_id: user.id,
      actor_kind: 'member',
      type: 'subscribed',
      subject_type: 'company',
      subject_id: companyId,
      payload: { plan: body.plan },
    })
  );

  const company = target.company
    ? { ...publicCompany(target.company), status: 'active' }
    : publicCompany({ id: companyId, name: target.create.name, plan: body.plan, status: 'active' });
  return jsonResponse(request, env, {
    success: true,
    message: `${body.plan} 플랜 구독이 시작되었습니다.`,
    data: {
      plan: body.plan,
      amount_krw: amount,
      next_charge_at: next,
      receipt_url: charge.receipt?.url || null,
      company,
    },
  });
}

/**
 * 첫 결제 뒤 저장이 실패했을 때: 토스 결제를 취소하고, 써 둔 것을 되돌린다.
 * 지우는 순서는 FK 를 따른다: 구독 → 신청 되돌림 → 업체 status 되돌림 → 구성원 → 업체.
 * 취소가 됐으면 true. 취소마저 실패하면 false — 로그에 남기고 사람이 환불한다.
 */
async function undoFirstPayment(
  env,
  { user, orderId, charge, billingKey, companyId, done, cause }
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
  // 응답을 못 받았어도 행이 써졌을 수 있다 — 시도한 것은 모두 지운다. 새 빌링키 · 이 업체 id 로 거른다.
  const now = nowIso();
  if (done.subscriptionAttempted) {
    // 구독 행이 남으면 다음 달에 결제된다
    await bestEffort('undo subscription', () =>
      deleteBy(env, 'subscriptions', {
        company_id: `eq.${companyId}`,
        billing_key: `eq.${billingKey}`,
      })
    );
  }
  if (done.applicationId) {
    await bestEffort('undo application', () =>
      updateBy(
        env,
        'partner_applications',
        { id: `eq.${done.applicationId}`, company_id: `eq.${companyId}` },
        { company_id: null, used_at: null }
      )
    );
  }
  if (done.prevStatus) {
    await bestEffort('undo company status', () =>
      updateBy(
        env,
        'companies',
        { id: `eq.${companyId}`, status: 'eq.active' },
        { status: done.prevStatus }
      )
    );
  }
  if (done.memberAttempted) {
    await bestEffort('undo member', () =>
      deleteBy(env, 'company_members', {
        company_id: `eq.${companyId}`,
        user_id: `eq.${user.id}`,
      })
    );
  }
  if (done.companyAttempted) {
    await bestEffort('undo company', () => deleteBy(env, 'companies', { id: `eq.${companyId}` }));
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

// 고객이 직접 누르는 결제(지금 다시 결제 · 카드 바꾼 뒤 결제)의 결과 → 응답.
// 실패해도 재시도 일정(+1일 · +3일)·횟수·등급은 그대로다 (lifecycle.js chargePastDueNow).
const NOW_CHARGE_REPLY = {
  charged: { status: 200, message: '결제했습니다. 구독을 다시 이용하실 수 있습니다.' },
  declined: { status: 402, message: null }, // 토스 실패 문구를 그대로 보여 준다
  merchant: {
    status: 502,
    message: '결제 서비스에 문제가 있어 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
  uncertain: {
    status: 202,
    message:
      '결제 결과를 아직 확인하지 못했습니다. 몇 분 뒤 이 화면을 새로 고쳐 확인해 주세요. 다시 누르셔도 두 번 결제되지 않습니다.',
  },
  busy: { status: 409, message: '결제를 처리하고 있습니다. 잠시 후 다시 확인해 주세요.' },
  not_past_due: {
    status: 409,
    message: '결제 실패로 재시도 중인 구독만 지금 다시 결제할 수 있습니다.',
  },
};

function nowChargeSummary(r) {
  const reply = NOW_CHARGE_REPLY[r.outcome] || NOW_CHARGE_REPLY.uncertain;
  const summary = {
    result: r.outcome,
    message: reply.message || (r.error && r.error.message) || '결제가 거절되었습니다.',
  };
  if (r.outcome === 'declined' && r.error && r.error.code) summary.code = r.error.code;
  return { reply, summary };
}

/**
 * 결제 · 카드 · 해지가 다룰 구독의 필터.
 * 협력업체 구성원이면 그 업체의 구독 — 대표만 (아니면 null → 403 not_owner).
 * 그 밖은 본인 구독 (업체 구독 행은 빼고).
 */
async function ownSubscriptionFilter(env, user) {
  const member = await readMembership(env, user.id);
  if (member && member.company.kind === 'partner') {
    if (member.role !== 'owner') return null;
    return { company_id: `eq.${member.company.id}` };
  }
  return { user_id: `eq.${user.id}`, company_id: 'is.null' };
}

function notOwner(request, env) {
  return jsonResponse(
    request,
    env,
    { success: false, code: 'not_owner', message: '업체 구독은 대표만 관리할 수 있습니다.' },
    403
  );
}

async function readOwnSubscription(env, filter, statuses, select = SUB_COLUMNS_FOR_CHARGE) {
  return selectOne(env, 'subscriptions', {
    ...filter,
    provider: 'eq.toss',
    status: `in.(${statuses.join(',')})`,
    select,
    order: 'created_at.desc',
  });
}

async function readPublicSubscription(env, subId) {
  return publicSubscription(
    await selectOne(env, 'subscriptions', { id: `eq.${subId}`, select: SUBSCRIPTION_COLUMNS })
  );
}

/**
 * 지금 다시 결제. 결제 실패로 재시도 중(past_due)인 본인 구독만.
 * 저장된 빌링키로 cron 과 같은 길(chargePastDueNow → 잠금 · 멱등키 · 같은 결제 기록)로 결제한다.
 */
async function handleRetry(request, env) {
  const user = await verifyJwt(request, env);
  const filter = await ownSubscriptionFilter(env, user);
  if (!filter) return notOwner(request, env);
  const sub = await readOwnSubscription(env, filter, ['active', 'past_due']);
  if (!sub || sub.status !== 'past_due') {
    const { reply, summary } = nowChargeSummary({ outcome: 'not_past_due' });
    return jsonResponse(
      request,
      env,
      { success: false, code: 'NOT_PAST_DUE', message: summary.message },
      reply.status
    );
  }
  const r = await chargePastDueNow(env, sub, { profile: { email: user.email, name: user.name } });
  const { reply, summary } = nowChargeSummary(r);
  return jsonResponse(
    request,
    env,
    {
      success: r.outcome === 'charged',
      code: summary.code,
      message: summary.message,
      data: { charge: summary, subscription: await readPublicSubscription(env, sub.id) },
    },
    reply.status
  );
}

/**
 * 카드 바꾸기. billing.html → 토스 requestBillingAuth → billing.html?card=ok&authKey&customerKey →
 * 여기로 { auth_key, customer_key }.
 * customerKey 는 이 구독의 고객 키와 같아야 한다(아니면 거절, 토스를 부르지 않는다).
 * 새 빌링키로 바꾸고, 재시도 중(past_due)이면 그 자리에서 새 카드로 결제해 본다.
 * 예전 빌링키는 응답에 싣지도, 로그에 남기지도 않는다.
 */
async function handleCardChange(request, env) {
  const user = await verifyJwt(request, env);
  const body = await readJson(request);
  if (!body || typeof body.auth_key !== 'string' || typeof body.customer_key !== 'string') {
    return jsonResponse(request, env, { success: false, message: '필수 필드 누락' }, 400);
  }
  const filter = await ownSubscriptionFilter(env, user);
  if (!filter) return notOwner(request, env);
  const sub = await readOwnSubscription(env, filter, ['active', 'past_due']);
  if (!sub) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '카드를 바꿀 구독이 없습니다.' },
      400
    );
  }
  if (
    body.customer_key !== sub.provider_customer_id ||
    body.customer_key !== customerKeyFor(user)
  ) {
    return jsonResponse(
      request,
      env,
      { success: false, code: 'CUSTOMER_KEY_MISMATCH', message: 'customerKey 불일치' },
      400
    );
  }

  const issued = await issueBillingKey(env, {
    authKey: body.auth_key,
    customerKey: body.customer_key,
  });
  if (!issued || !issued.billingKey) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '새 카드를 등록하지 못했습니다.' },
      502
    );
  }

  // 결제 중(잠금)이면 바꾸지 않는다 — 결제 한 건이 어느 카드로 나갔는지 흐려진다.
  const rows = await updateBy(
    env,
    'subscriptions',
    {
      id: `eq.${sub.id}`,
      status: 'in.(active,past_due)',
      or: lockFreeFilter(),
    },
    {
      billing_key: issued.billingKey,
      provider_subscription_id: issued.billingKey,
      updated_at: nowIso(),
    }
  );
  const updated = rows && rows.length ? rows[0] : null;
  if (!updated) {
    return jsonResponse(
      request,
      env,
      {
        success: false,
        code: 'BUSY',
        message: '결제를 처리하고 있어 지금은 카드를 바꿀 수 없습니다. 잠시 후 다시 시도해 주세요.',
      },
      409
    );
  }
  console.log(`[payments] card changed: sub=${sub.id} user=${user.id}`);

  let charge = null;
  if (updated.status === 'past_due') {
    const r = await chargePastDueNow(env, updated, {
      profile: { email: user.email, name: user.name },
    });
    charge = nowChargeSummary(r).summary;
  }
  return jsonResponse(request, env, {
    success: true,
    message: charge
      ? charge.result === 'charged'
        ? '카드를 바꾸고 결제했습니다. 구독을 다시 이용하실 수 있습니다.'
        : `카드를 바꿨습니다. 다만 결제는 되지 않았습니다: ${charge.message}`
      : '카드를 바꿨습니다. 다음 결제부터 새 카드로 결제됩니다.',
    data: {
      card_changed: true,
      charge,
      subscription: await readPublicSubscription(env, sub.id),
    },
  });
}

async function handleCancel(request, env) {
  const user = await verifyJwt(request, env);
  const body = (await readJson(request)) || {};
  const filter = await ownSubscriptionFilter(env, user);
  if (!filter) return notOwner(request, env);
  // 결제 실패로 재시도 중(past_due)인 구독도 해지할 수 있다 — 해지하면 더는 결제하지 않는다.
  const sub = await readOwnSubscription(env, filter, ['active', 'past_due'], '*');
  if (!sub) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '활성 Toss 구독이 없습니다.' },
      400
    );
  }
  // 결제 중(잠금)이면 해지하지 않는다 — 그 결제가 성공하면 해지가 덮인다.
  const cancelled = await updateBy(
    env,
    'subscriptions',
    {
      id: `eq.${sub.id}`,
      status: 'in.(active,past_due)',
      or: lockFreeFilter(),
    },
    {
      status: 'cancelled',
      cancel_reason: 'user_request',
      cancel_at: sub.current_period_end,
      next_charge_at: null,
      updated_at: nowIso(),
    }
  );
  if (!cancelled || !cancelled.length) {
    return jsonResponse(
      request,
      env,
      { success: false, message: '결제를 처리하고 있습니다. 잠시 후 다시 시도해 주세요.' },
      409
    );
  }

  // 등급은 지금 내리지 않는다 — 이번 기간까지는 이미 낸 값이다 (약관 제9조).
  // 기간이 끝나면 하루 한 번 도는 cron(lifecycle.js expireCancelled)이 내린다.
  // 결제로 받은 등급(tier_source='subscription')일 때만. 업체 구독은 그때 업체를 closed 로.
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
  { method: 'POST', path: '/subscription/retry', handler: handleRetry },
  { method: 'POST', path: '/subscription/card', handler: handleCardChange },
  // 예전 「수동 재시도」 경로. 잠금 없는 결제 길을 남기지 않으려고 같은 처리로 보낸다.
  { method: 'POST', path: '/charge', handler: handleRetry },
  { method: 'POST', path: '/cancel', handler: handleCancel },
  { method: 'POST', path: '/admin/refund', handler: handleAdminRefund },
  { method: 'POST', path: '/webhook', handler: handleWebhook },
];

export default {
  async fetch(request, env) {
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
