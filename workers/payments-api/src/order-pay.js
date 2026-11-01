/**
 * 수주 온라인 결제 — 고객이 수금 줄(order_payments: 계약금 · 중도금 · 잔금)을 토스 결제창 · 가상계좌로 낸다.
 * 기록은 payment_transactions (DB 0025) — 결제창 한 번 = 한 줄, 수금 줄마다 열린 결제(ready · waiting_deposit)는 하나.
 *
 * 다담 공장 수주(orders.company_id = companies.kind 'hq')만 받는다. 협력업체 수주는 업체가 직접 받는다
 * (중개 구조 — 다담은 협력업체 고객 돈을 쥐지 않는다).
 *
 *   POST /order-payments/checkout { payment_id }
 *     그 수주 프로젝트의 고객 본인만 (아니면 404). 받은 줄 · 취소 수주 · 협력업체 수주는 막는다.
 *     열린 ready 결제는 닫고 새로 연다(금액이 바뀌었을 수 있다). 가상계좌 입금 기다림이 있으면 409 + 입금 안내.
 *     → { order_id, amount, order_name, customer_key, client_key } — 앱이 토스 결제창을 연다
 *   POST /order-payments/confirm { paymentKey, orderId, amount }
 *     결제창이 돌아오면. 연 사람 본인 · 금액이 같을 때만 토스 승인(멱등키 orderId). 카드 · 간편결제는 바로 DONE,
 *     가상계좌는 WAITING_FOR_DEPOSIT (입금 안내를 남긴다)
 *   토스 웹훅 (worker.js handleWebhook) — 조회 API 로 다시 확인한 결제로 applyTossPayment
 *
 * 「받음」: 결제사가 받은 금액이 수금 줄 금액과 같고 아직 안 받은 줄일 때만 수금 줄을 받음(paid_on · method)으로 적는다.
 * 다르면 check_needed — 사람이 ERP 에서 보고 처리한다 (자동으로 나누거나 남는 돈을 다른 줄에 넣지 않는다).
 */

import { selectOne, selectMany, insertOne, updateById, updateBy, DbError } from './supabase.js';
import { confirmPayment, TossError } from './toss.js';

/** 토스에 보내는 주문 번호 머리 — 웹훅이 구독 결제와 가른다 */
export const ORDER_PAY_PREFIX = 'dadampay-';
export const STAGE_LABEL = Object.freeze({
  deposit: '계약금',
  interim: '중도금',
  balance: '잔금',
  other: '기타',
});
/** 토스 결제 수단 → 기록 값 (DB 0025 method) */
export const TOSS_METHOD = Object.freeze({
  카드: 'card',
  간편결제: 'easy_pay',
  가상계좌: 'virtual_account',
  계좌이체: 'transfer',
});
const OPEN = ['ready', 'waiting_deposit'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KST_MS = 9 * 3600 * 1000;

export class OrderPayError extends Error {
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

const nowIso = () => new Date().toISOString();
/** 시각 → 한국 날짜 'YYYY-MM-DD' */
export const kstDay = (iso) =>
  new Date((Date.parse(iso) || Date.now()) + KST_MS).toISOString().slice(0, 10);

/** 고객에게 보여 줄 가상계좌 입금 안내 (토스 virtualAccount → DB 0025 virtual_account) */
export function virtualAccountOf(payment) {
  const va = payment && payment.virtualAccount;
  if (!va) return null;
  return {
    bank: va.bankCode || va.bank || null,
    account_number: va.accountNumber || null,
    holder: va.customerName || null,
    due_at: va.dueDate || null,
  };
}

/** 앱 · ERP 에 내보내는 결제 한 줄 */
export function publicTx(tx) {
  if (!tx) return null;
  return {
    id: tx.id,
    status: tx.status,
    method: tx.method || null,
    amount_requested: tx.amount_requested,
    amount_received: tx.amount_received ?? null,
    virtual_account: tx.virtual_account || null,
    status_note: tx.status_note || null,
    paid_at: tx.paid_at || null,
    created_at: tx.created_at,
  };
}

async function hqCompanyId(env) {
  const row = await selectOne(env, 'companies', { kind: 'eq.hq', select: 'id' });
  if (!row || !row.id) throw new DbError('다담 공장(companies.kind=hq)을 찾을 수 없습니다');
  return row.id;
}

/** 수금 줄 + 수주 + 고객 본인 확인. 아니면 404 (있는지 알리지 않는다) */
async function loadOwnLine(env, user, paymentId) {
  const notFound = () =>
    new OrderPayError(404, 'not_found', '결제할 수금 일정을 찾을 수 없습니다.');
  if (!UUID_RE.test(String(paymentId || ''))) throw notFound();
  const line = await selectOne(env, 'order_payments', {
    id: `eq.${paymentId}`,
    select: 'id,order_id,stage,amount,due_on,paid_on',
  });
  if (!line) throw notFound();
  const order = await selectOne(env, 'orders', {
    id: `eq.${line.order_id}`,
    select: 'id,order_no,company_id,project_id,status',
  });
  if (!order || !order.project_id) throw notFound();
  const project = await selectOne(env, 'projects', {
    id: `eq.${order.project_id}`,
    select: 'id,customer_id',
  });
  const customer =
    project && project.customer_id
      ? await selectOne(env, 'customers', { id: `eq.${project.customer_id}`, select: 'id,user_id' })
      : null;
  if (!customer || customer.user_id !== user.id) throw notFound();
  return { line, order };
}

/** 수주의 수금액 = 받은 줄의 합 (workflow-api payments.js syncReceived 와 같다) */
async function syncReceived(env, orderId) {
  const rows =
    (await selectMany(env, 'order_payments', {
      order_id: `eq.${orderId}`,
      select: 'amount,paid_on',
    })) || [];
  const received = rows.filter((r) => r.paid_on).reduce((s, r) => s + Number(r.amount || 0), 0);
  await updateById(env, 'orders', orderId, { received_amount: received });
  return received;
}

/** POST /order-payments/checkout */
export async function startCheckout(env, { user, body }) {
  const { line, order } = await loadOwnLine(env, user, body && body.payment_id);
  if (order.company_id !== (await hqCompanyId(env))) {
    throw new OrderPayError(403, 'not_payable', '이 수주는 시공 업체에 직접 내 주세요.');
  }
  if (order.status === 'cancelled')
    throw new OrderPayError(409, 'order_cancelled', '취소된 수주입니다.');
  if (line.paid_on) throw new OrderPayError(409, 'already_paid', '이미 받은 수금 일정입니다.');

  const open =
    (await selectMany(env, 'payment_transactions', {
      payment_id: `eq.${line.id}`,
      status: `in.(${OPEN.join(',')})`,
      select: '*',
    })) || [];
  const waiting = open.find((t) => t.status === 'waiting_deposit');
  if (waiting) {
    throw new OrderPayError(
      409,
      'waiting_deposit',
      '가상계좌 입금을 기다리는 중입니다. 안내된 계좌로 입금해 주세요.',
      { transaction: publicTx(waiting) }
    );
  }
  if (open.length) {
    await updateBy(
      env,
      'payment_transactions',
      { payment_id: `eq.${line.id}`, status: 'eq.ready' },
      { status: 'canceled', status_note: '새 결제창을 열어 닫음' }
    );
  }

  const ref = `${ORDER_PAY_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`;
  let tx;
  try {
    tx = await insertOne(env, 'payment_transactions', {
      payment_id: line.id,
      order_id: order.id,
      company_id: order.company_id,
      provider: 'toss',
      provider_ref: ref,
      status: 'ready',
      amount_requested: Number(line.amount),
      requested_by: user.id,
    });
  } catch (e) {
    if (e instanceof DbError && e.statusCode === 409) {
      throw new OrderPayError(
        409,
        'busy',
        '다른 결제가 진행 중입니다. 잠시 뒤 다시 시도해 주세요.'
      );
    }
    throw e;
  }
  return {
    order_id: tx.provider_ref,
    amount: tx.amount_requested,
    order_name: `다담 ${STAGE_LABEL[line.stage] || '결제'} · ${order.order_no}`.slice(0, 100),
    customer_key: `dadam-${user.id}`,
    client_key: env.TOSS_CLIENT_KEY || '',
  };
}

/**
 * 토스 결제(조회 · 승인 응답)를 결제 기록 · 수금 줄에 반영한다 — 승인 응답 · 웹훅 모두 여기로. 같은 상태는 다시 와도 그대로.
 * @returns 고친 결제 기록 (publicTx)
 */
export async function applyTossPayment(env, tx, payment) {
  if (!tx || !payment || payment.orderId !== tx.provider_ref) return publicTx(tx);
  const method = TOSS_METHOD[payment.method] || tx.method || null;
  const base = {
    provider_payment_ref: payment.paymentKey || tx.provider_payment_ref || null,
    method,
  };
  let patch = null;

  switch (payment.status) {
    case 'WAITING_FOR_DEPOSIT':
      if (tx.status === 'ready')
        patch = { ...base, status: 'waiting_deposit', virtual_account: virtualAccountOf(payment) };
      break;
    case 'DONE': {
      if (tx.status === 'paid' || tx.status === 'check_needed') break;
      const received = Number(payment.totalAmount);
      const paidAt = payment.approvedAt || nowIso();
      const line = tx.payment_id
        ? await selectOne(env, 'order_payments', {
            id: `eq.${tx.payment_id}`,
            select: 'id,order_id,amount,paid_on',
          })
        : null;
      let note = null;
      if (!line) note = '수금 일정이 지워졌습니다';
      else if (line.paid_on) note = '이미 받음으로 적힌 수금 일정입니다';
      else if (received !== Number(line.amount) || received !== Number(tx.amount_requested))
        note = '받은 금액이 수금 일정과 다릅니다';
      if (note) {
        patch = {
          ...base,
          status: 'check_needed',
          amount_received: received,
          paid_at: paidAt,
          status_note: note,
        };
        break;
      }
      await updateById(env, 'order_payments', line.id, {
        paid_on: kstDay(paidAt),
        method: method || 'other',
      });
      await syncReceived(env, line.order_id);
      patch = { ...base, status: 'paid', amount_received: received, paid_at: paidAt };
      break;
    }
    case 'CANCELED':
    case 'PARTIAL_CANCELED':
      // 받음으로 적은 뒤 결제사에서 취소됐으면 사람이 본다 (수금 줄을 저절로 되돌리지 않는다)
      if (tx.status === 'paid')
        patch = {
          ...base,
          status: 'check_needed',
          status_note: '결제사에서 취소됐습니다 — 받음을 확인해 주세요',
        };
      else if (tx.status !== 'canceled' && tx.status !== 'check_needed')
        patch = { ...base, status: 'canceled' };
      break;
    case 'EXPIRED':
      if (OPEN.includes(tx.status))
        patch = { ...base, status: 'expired', status_note: '입금 기한이 지났습니다' };
      break;
    case 'ABORTED':
      if (OPEN.includes(tx.status))
        patch = { ...base, status: 'failed', status_note: '결제가 승인되지 않았습니다' };
      break;
    default:
      break;
  }
  if (!patch) return publicTx(tx);
  const row = await updateById(env, 'payment_transactions', tx.id, patch);
  return publicTx(row || { ...tx, ...patch });
}

/** POST /order-payments/confirm */
export async function confirmCheckout(env, { user, body }) {
  const b = body || {};
  const paymentKey = typeof b.paymentKey === 'string' ? b.paymentKey : '';
  const orderId = typeof b.orderId === 'string' ? b.orderId : '';
  const amount = Number(b.amount);
  if (
    !paymentKey ||
    paymentKey.length > 200 ||
    !orderId.startsWith(ORDER_PAY_PREFIX) ||
    orderId.length > 64
  ) {
    throw new OrderPayError(422, 'invalid', '결제 정보가 올바르지 않습니다.');
  }
  const tx = await selectOne(env, 'payment_transactions', {
    provider: 'eq.toss',
    provider_ref: `eq.${orderId}`,
    select: '*',
  });
  if (!tx || tx.requested_by !== user.id)
    throw new OrderPayError(404, 'not_found', '결제를 찾을 수 없습니다.');
  if (tx.status !== 'ready') return { transaction: publicTx(tx) }; // 이미 승인 · 처리됨 — 그대로
  if (!Number.isInteger(amount) || amount !== Number(tx.amount_requested)) {
    await updateById(env, 'payment_transactions', tx.id, {
      status: 'failed',
      status_note: '결제창 금액이 수금 일정과 다릅니다',
    });
    throw new OrderPayError(
      422,
      'amount_mismatch',
      '결제 금액이 수금 일정과 다릅니다. 다시 결제해 주세요.'
    );
  }
  let payment;
  try {
    payment = await confirmPayment(env, { paymentKey, orderId, amount });
  } catch (e) {
    if (e instanceof TossError && e.statusCode < 500) {
      await updateById(env, 'payment_transactions', tx.id, {
        status: 'failed',
        provider_payment_ref: paymentKey,
        status_note: String(e.message || e.code).slice(0, 300),
      });
    }
    throw e;
  }
  return { transaction: await applyTossPayment(env, tx, payment) };
}

/** 웹훅 — 조회한 토스 결제가 수주 결제면 반영한다. 수주 결제가 아니면 false */
export async function applyOrderPaymentWebhook(env, payment) {
  if (
    !payment ||
    typeof payment.orderId !== 'string' ||
    !payment.orderId.startsWith(ORDER_PAY_PREFIX)
  )
    return false;
  const tx = await selectOne(env, 'payment_transactions', {
    provider: 'eq.toss',
    provider_ref: `eq.${payment.orderId}`,
    select: '*',
  });
  if (!tx) return false;
  await applyTossPayment(env, tx, payment);
  return true;
}
