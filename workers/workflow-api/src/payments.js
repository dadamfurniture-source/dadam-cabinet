/**
 * 수금 · 지급 날짜 — 경영 대시보드 2단계 (9 13주 현금흐름 · 미수 나이).
 *
 * 일감이 달마다 0.2배~2.4배로 출렁이는 공장에는 이익보다 현금이 먼저다. 지금까지는 수주에
 * '수금액' 누계 한 칸뿐이라 "언제 들어오나 · 얼마나 밀렸나" 를 물을 수 없었다.
 *   수금 일정  계약금 · 중도금 · 잔금 — 받기로 한 날(due_on) · 받은 날(paid_on)
 *              일정이 있는 수주는 수금액(received_amount)을 받은 합으로 맞춘다
 *   지급 예정  실적 원가 줄의 due_on — 낸 날(spent_on)이 비면 아직 안 낸 돈
 *   통장 잔액  현금흐름의 시작점 — 관리자가 적는다
 * 표는 database/management-phase2.sql 이 만든다.
 */
import { selectOne, selectMany, insertOne, updateById, restDelete, ValidationError, NotFoundError, ForbiddenError } from './supabase.js';
import { loadOwnedOrder } from './orders.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';

export const PAYMENT_STAGES = ['deposit', 'interim', 'balance', 'other'];
export const PAYMENT_STAGE_LABEL = Object.freeze({ deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' });
export const PAYMENT_METHODS = ['transfer', 'card', 'cash', 'other'];
export const NEED_SQL = '수금 · 지급 칸이 아직 DB 에 없습니다 — database/management-phase2.sql 을 실행해 주세요';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function day(v, name) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(s))) throw new ValidationError(`${name} 이 올바르지 않습니다 (YYYY-MM-DD)`);
  return s;
}

/** 입력 검증 (순수). partial 이면 온 칸만 */
export function validatePayment(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.stage !== undefined) {
    if (!PAYMENT_STAGES.includes(b.stage)) throw new ValidationError(`stage 는 ${PAYMENT_STAGES.join(', ')} 중 하나여야 합니다`);
    out.stage = b.stage;
  }
  if (!partial || b.amount !== undefined) {
    const n = Number(b.amount);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError('금액은 1원 이상의 정수여야 합니다');
    out.amount = n;
  }
  for (const k of ['due_on', 'paid_on']) {
    const v = day(b[k], k);
    if (v !== undefined) out[k] = v;
  }
  if (b.method !== undefined) {
    if (b.method !== null && b.method !== '' && !PAYMENT_METHODS.includes(b.method)) throw new ValidationError(`method 는 ${PAYMENT_METHODS.join(', ')} 중 하나여야 합니다`);
    out.method = b.method || null;
  }
  if (b.memo !== undefined) out.memo = b.memo ? String(b.memo).trim().slice(0, 300) : null;
  if (!partial && !out.due_on && !out.paid_on) throw new ValidationError('받기로 한 날이나 받은 날 중 하나는 적어 주세요');
  return out;
}

/** 받은 합 (순수) — paid_on 이 있는 것만 */
export function receivedOf(payments) {
  return (payments || []).filter((p) => p.paid_on).reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** 수주 상세용 — 표가 아직 없으면 null */
export async function listPayments(env, orderId) {
  try {
    return (await selectMany(env, 'order_payments', { order_id: `eq.${orderId}`, select: '*', order: 'due_on.asc.nullslast,created_at.asc', limit: '100' })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 일정이 있는 수주는 수금액을 받은 합으로 맞춘다 (화면의 수금 · 미수가 일정과 어긋나지 않게) */
async function syncReceived(env, orderId) {
  const rows = (await listPayments(env, orderId)) || [];
  if (!rows.length) return null;
  const received = receivedOf(rows);
  await updateById(env, 'orders', orderId, { received_amount: received });
  return received;
}

async function write(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw new ValidationError(NEED_SQL);
    throw e;
  }
}

export async function addPayment(env, { orderId, user, body }) {
  await loadOwnedOrder(env, orderId, user);
  const row = await write(() => insertOne(env, 'order_payments', { ...validatePayment(body), order_id: orderId, created_by: user.id }));
  const received = await syncReceived(env, orderId);
  return { payment: row, received };
}

async function ownedPayment(env, orderId, paymentId) {
  const row = await write(() => selectOne(env, 'order_payments', { id: `eq.${paymentId}`, select: 'id,order_id' }));
  if (!row || row.order_id !== orderId) throw new NotFoundError('수금 일정을 찾을 수 없습니다');
  return row;
}

export async function updatePayment(env, { orderId, paymentId, user, body }) {
  await loadOwnedOrder(env, orderId, user);
  await ownedPayment(env, orderId, paymentId);
  const patch = validatePayment(body, { partial: true });
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  const row = await write(() => updateById(env, 'order_payments', paymentId, patch));
  const received = await syncReceived(env, orderId);
  return { payment: row, received };
}

export async function deletePayment(env, { orderId, paymentId, user }) {
  await loadOwnedOrder(env, orderId, user);
  await ownedPayment(env, orderId, paymentId);
  await restDelete(env, 'order_payments', { id: `eq.${paymentId}` });
  const received = await syncReceived(env, orderId);
  return { deleted: paymentId, received };
}

/** 지급: 원가 줄의 낸 날 · 낼 날을 고친다 ("냈음" 단추) */
export async function updateCostDates(env, { orderId, costId, user, body }) {
  await loadOwnedOrder(env, orderId, user);
  const cost = await selectOne(env, 'order_costs', { id: `eq.${costId}`, select: 'id,order_id' });
  if (!cost || cost.order_id !== orderId) throw new NotFoundError('원가 항목을 찾을 수 없습니다');
  const patch = {};
  const spent = day((body || {}).spent_on, 'spent_on');
  const due = day((body || {}).due_on, 'due_on');
  if (spent !== undefined) patch.spent_on = spent;
  if (due !== undefined) patch.due_on = due;
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  return write(() => updateById(env, 'order_costs', costId, patch));
}

/** 통장 잔액 적기 — 관리자만 */
export async function addCashBalance(env, { user, body }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('통장 잔액은 관리자만 적습니다');
  const b = body || {};
  const asOf = day(b.as_of, 'as_of');
  const amount = Number(b.amount);
  if (!asOf) throw new ValidationError('기준일을 적어 주세요');
  if (!Number.isInteger(amount)) throw new ValidationError('잔액은 원 단위 정수여야 합니다');
  return write(() => insertOne(env, 'cash_balances', {
    as_of: asOf, amount, memo: b.memo ? String(b.memo).trim().slice(0, 300) : null, created_by: user.id,
  }));
}
