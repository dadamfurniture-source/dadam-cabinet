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
 * 온라인 결제(payments-api — 고객 결제창 · 가상계좌, DB 0025 payment_transactions)는 수금 줄마다 가장 최근 것을
 * online 으로 붙인다 (ERP 가 「확인 필요」 · 「입금 대기」를 보인다). 결제창만 열고 닫은 것(ready · canceled)은 뺀다.
 */
import { selectOne, selectMany, insertOne, updateById, restDelete, asActor, ValidationError, NotFoundError, ForbiddenError, ConflictError } from './supabase.js';
import { loadOwnedOrder } from './orders.js';
import { staleError } from './order-events.js';
import { idempotencyKeyOf } from './ledger/checks.js';
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

/** ERP 에 보이는 온라인 결제 상태 (ready · canceled 는 뺀다) */
export const ERP_PAY_STATUSES = Object.freeze(['waiting_deposit', 'paid', 'check_needed', 'expired', 'failed']);

/** 수주 상세용 — 표가 아직 없으면 null. online 이면 수금 줄마다 가장 최근 온라인 결제를 붙인다 */
export async function listPayments(env, orderId, { online = false } = {}) {
  let rows;
  try {
    rows = (await selectMany(env, 'order_payments', { order_id: `eq.${orderId}`, select: '*', order: 'due_on.asc.nullslast,created_at.asc', limit: '100' })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
  if (!online || !rows.length) return rows;
  let txs = [];
  try {
    txs = (await selectMany(env, 'payment_transactions', {
      order_id: `eq.${orderId}`,
      status: `in.(${ERP_PAY_STATUSES.join(',')})`,
      select: 'payment_id,status,method,amount_requested,amount_received,virtual_account,status_note,paid_at,created_at',
      order: 'created_at.desc',
      limit: '200',
    })) || [];
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  const latest = new Map();
  for (const t of txs) if (t.payment_id && !latest.has(t.payment_id)) latest.set(t.payment_id, t);
  return rows.map((p) => {
    const t = latest.get(p.id);
    if (!t) return { ...p, online: null };
    const online = { ...t };
    delete online.payment_id;
    return { ...p, online };
  });
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

/** 같은 수주 · 같은 키로 이미 넣은 수금 줄 (DB 0041 order_payments.idempotency_key) */
function paymentByKey(env, orderId, key) {
  return write(() => selectOne(env, 'order_payments', { order_id: `eq.${orderId}`, idempotency_key: `eq.${key}`, select: '*' }));
}

/** 수금 줄 넣기 → { payment, received, reused } — X-Idempotency-Key 가 같으면 먼저 넣은 줄을 그대로 돌려준다 */
export async function addPayment(env, { orderId, user, body, idempotencyKey }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  const key = idempotencyKeyOf(idempotencyKey);
  if (key) {
    const prev = await paymentByKey(env, orderId, key);
    if (prev) return { payment: prev, received: await syncReceived(env, orderId), reused: true };
  }
  const input = { ...validatePayment(body), order_id: orderId, created_by: user.id };
  if (key) input.idempotency_key = key;
  let row;
  try {
    row = await write(() => insertOne(asActor(env, user), 'order_payments', input));
  } catch (e) {
    // 같은 키로 동시에 두 번 — 먼저 들어간 줄
    const prev = e instanceof ConflictError && key ? await paymentByKey(env, orderId, key) : null;
    if (!prev) throw e;
    return { payment: prev, received: await syncReceived(env, orderId), reused: true };
  }
  const received = await syncReceived(env, orderId);
  return { payment: row, received, reused: false };
}

async function ownedPayment(env, orderId, paymentId) {
  const row = await write(() => selectOne(env, 'order_payments', { id: `eq.${paymentId}`, select: '*' }));
  if (!row || row.order_id !== orderId) throw new NotFoundError('수금 일정을 찾을 수 없습니다');
  return row;
}

/**
 * 수금 일정 고치기. expect_unpaid true (AI 비서 승인 카드 「수금 받음」) — 아직 안 받은 일정일 때만.
 * 이미 받은 날이 보낸 날과 같으면 그대로 성공(끊겨 다시 보낸 승인), 다르면 409 stale.
 */
export async function updatePayment(env, { orderId, paymentId, user, body }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  const current = await ownedPayment(env, orderId, paymentId);
  const expectUnpaid = body && body.expect_unpaid !== undefined;
  if (expectUnpaid && body.expect_unpaid !== true) throw new ValidationError('expect_unpaid 는 true 만 됩니다');
  const input = expectUnpaid ? { ...body } : body;
  if (expectUnpaid) delete input.expect_unpaid;
  const patch = validatePayment(input, { partial: true });
  if (expectUnpaid && current.paid_on) {
    if (patch.paid_on === current.paid_on) return { payment: current, received: await syncReceived(env, orderId) };
    throw staleError('그 사이 이 수금 일정이 받음으로 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
  }
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  const row = await write(() => updateById(asActor(env, user), 'order_payments', paymentId, patch));
  const received = await syncReceived(env, orderId);
  return { payment: row, received };
}

export async function deletePayment(env, { orderId, paymentId, user }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  await ownedPayment(env, orderId, paymentId);
  await restDelete(asActor(env, user), 'order_payments', { id: `eq.${paymentId}` });
  const received = await syncReceived(env, orderId);
  return { deleted: paymentId, received };
}

/** 지급: 원가 줄의 낸 날 · 낼 날을 고친다 ("냈음" 단추) */
export async function updateCostDates(env, { orderId, costId, user, body }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  const cost = await selectOne(env, 'order_costs', { id: `eq.${costId}`, select: 'id,order_id' });
  if (!cost || cost.order_id !== orderId) throw new NotFoundError('원가 항목을 찾을 수 없습니다');
  const patch = {};
  const spent = day((body || {}).spent_on, 'spent_on');
  const due = day((body || {}).due_on, 'due_on');
  if (spent !== undefined) patch.spent_on = spent;
  if (due !== undefined) patch.due_on = due;
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  return write(() => updateById(asActor(env, user), 'order_costs', costId, patch));
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
