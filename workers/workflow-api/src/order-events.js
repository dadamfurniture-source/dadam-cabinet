/**
 * 수주 상태 바꾸기 규칙 · 기록 (order_events — database/migrations/0013_order_events.sql).
 *
 * 상태: 접수(confirmed) → 생산 중(in_production) → 배송(delivered) → 완료(completed), 그리고 취소(cancelled).
 * 바꿀 수 있는 짝은 아래 TRANSITIONS 표 하나로 정한다. 표에 없는 짝은 422 와 함께 바꿀 수 있는 상태를 알려 준다.
 *   바로      — 수주를 고칠 수 있는 사람이면 바로 바뀐다. 취소 · 한 단계 뒤로는 사유가 있어야 한다.
 *   대표 승인 — 완료 되돌리기(완료 → 배송) · 되살리기(취소 → 접수). 사유가 있어야 한다.
 *              그 업체 대표(active owner)가 하면 바로, 다른 사람이 하면 요청(pending)만 남고 수주는 그대로다.
 *              대표가 승인하면 그때 바뀐다 — 수주 상태가 요청 때(from_status)와 같을 때만 (아니면 409 stale).
 *              한 수주에 기다리는 요청은 하나뿐이다. 요청이 기다리는 동안에는 그 수주의 상태를 아무도
 *              (대표도) 바꾸지 못한다 — 먼저 승인 · 반려한다 (409 pending_exists).
 * 바뀐 상태는 모두 order_events 에 한 줄씩 남는다. 표는 지우기를 막고, 쓰기는 이 워커(service_role)만 한다.
 *
 * 고객 확인서 승인 전 작업지시서도 같은 표에 남는다 (kind early_work_order — 수주가 없어 설계에 단다).
 */

import {
  selectOne,
  selectMany,
  insertOne,
  updateBy,
  activeMemberships,
  designAccess,
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from './supabase.js';

export const ORDER_STATUS_LABELS = Object.freeze({
  confirmed: '접수',
  in_production: '생산 중',
  delivered: '배송',
  completed: '완료',
  cancelled: '취소',
});

/** 기록 종류 — 화면 이름 */
export const EVENT_KIND_LABELS = Object.freeze({
  status: '상태 바꾸기',
  revive: '되살리기',
  revert: '완료 되돌리기',
  early_work_order: '승인 전 작업지시서',
});

/** 사유 글자 수 상한 (DB order_events_reason_check 와 같다) */
export const REASON_MAX = 500;

const rule = (kind, { approval = false, reason = false } = {}) => Object.freeze({ kind, approval, reason });
const NOW = rule('status');
const NOW_WITH_REASON = rule('status', { reason: true });

/** from → to → { kind, approval(대표 승인), reason(사유 필수) }. 여기 없는 짝은 못 바꾼다 */
export const TRANSITIONS = Object.freeze({
  confirmed: Object.freeze({ in_production: NOW, delivered: NOW, completed: NOW, cancelled: NOW_WITH_REASON }),
  in_production: Object.freeze({ delivered: NOW, completed: NOW, cancelled: NOW_WITH_REASON, confirmed: NOW_WITH_REASON }),
  delivered: Object.freeze({ completed: NOW, cancelled: NOW_WITH_REASON, in_production: NOW_WITH_REASON }),
  // 완료 뒤에는 되돌리기만 — 취소하려면 먼저 되돌린다
  completed: Object.freeze({ delivered: rule('revert', { approval: true, reason: true }) }),
  cancelled: Object.freeze({ confirmed: rule('revive', { approval: true, reason: true }) }),
});

/** 기록 한 줄에서 화면 · 응답에 싣는 칸 (금액 칸은 표에 없다) */
const EVENT_SELECT = 'id,company_id,order_id,design_id,kind,from_status,to_status,reason,state,requested_by,decided_by,decided_at,created_at';

const nowIso = () => new Date().toISOString();
const label = (status) => ORDER_STATUS_LABELS[status] || status || '없음';

/** 화면이 사유를 가를 때 쓰는 code 를 붙인 오류 (응답의 code 칸) */
function codedError(Err, message, code, details = null) {
  const e = new Err(message, details);
  e.code = code;
  return e;
}

export function reasonRequiredError(message = '사유를 적어 주세요') {
  return codedError(ValidationError, message, 'reason_required');
}

function staleError(message = '그 사이 수주 상태가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요') {
  return codedError(ConflictError, message, 'stale');
}

/** 승인을 기다리는 요청이 있는 수주의 상태 바꾸기 — 대표도 먼저 승인 · 반려해야 한다 */
function pendingExistsError() {
  return codedError(ConflictError, '기다리는 요청을 먼저 승인 · 반려해 주세요', 'pending_exists');
}

function alreadyDecidedError() {
  return codedError(ConflictError, '이미 결정된 요청입니다', 'already_decided');
}

/** 사유 — 앞뒤 공백을 떼고 500자까지. 없으면 '' */
export function cleanReason(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, REASON_MAX).trim();
}

/** 지금 상태에서 바꿀 수 있는 상태들 — [{ to, label, kind, approval, reason }] */
export function allowedMoves(from) {
  const row = TRANSITIONS[from] || {};
  return Object.keys(row).map((to) => ({ to, label: ORDER_STATUS_LABELS[to], ...row[to] }));
}

/** from → to 규칙. 표에 없으면 422 transition_not_allowed (바꿀 수 있는 상태를 알려 준다) */
export function transitionRule(from, to) {
  const found = TRANSITIONS[from] && TRANSITIONS[from][to];
  if (found) return found;
  const moves = allowedMoves(from);
  const list = moves.length ? moves.map((m) => m.label + (m.approval ? '(대표 승인)' : '')).join(' · ') : '없음';
  throw codedError(
    ValidationError,
    `${label(from)} → ${label(to)} 로는 바꿀 수 없습니다. 지금 바꿀 수 있는 상태: ${list}`,
    'transition_not_allowed',
    { from, to, allowed: moves.map((m) => m.to) },
  );
}

/**
 * 상태에 들어갈 때 찍는 날짜 — 배송일 · 완료일이 비어 있으면 지금 (요청이 날짜를 직접 주면 그 값).
 * 완료로 옮길 때 완료일은 DB(orders_completed_chk)가 요구한다.
 */
export function statusPatch(order, to, patch = {}) {
  const out = { status: to };
  if (to === 'completed' && !order.completed_at && patch.completed_at === undefined) out.completed_at = nowIso();
  if (to === 'delivered' && !order.delivered_at && patch.delivered_at === undefined) out.delivered_at = nowIso();
  return out;
}

/**
 * 상태에서 나갈 때 지우는 날짜 — 완료를 되돌리면 완료일, 배송에서 생산 중으로 돌아가면 배송일,
 * 되살리면(취소 → 접수) 배송일 (완료일은 취소된 수주에 이미 없다).
 */
export function statusClears(from, to) {
  const out = {};
  if (from === 'completed' && to !== 'completed') out.completed_at = null;
  if (from === 'delivered' && to === 'in_production') out.delivered_at = null;
  if (from === 'cancelled' && to === 'confirmed') out.delivered_at = null;
  return out;
}

/** 호출자의 대표(active owner) 업체 id 들 */
async function ownerCompanyIds(env, user) {
  return (await activeMemberships(env, user)).filter((m) => m.role === 'owner').map((m) => m.company_id);
}

/** 이 업체의 대표(active owner)인가 */
export async function isCompanyOwner(env, user, companyId) {
  if (!user || !user.id || !companyId) return false;
  return (await ownerCompanyIds(env, user)).includes(companyId);
}

/** 응답 · 화면용 기록 한 줄 (업체 id 는 뺀다) */
function eventView(row) {
  if (!row) return row;
  const out = {};
  for (const k of EVENT_SELECT.split(',')) if (k !== 'company_id' && row[k] !== undefined) out[k] = row[k];
  return out;
}

function eventRow(order, user, plan, state) {
  return {
    company_id: order.company_id,
    order_id: order.id,
    kind: plan.kind,
    from_status: plan.from,
    to_status: plan.to,
    reason: plan.reason || null,
    state,
    requested_by: user.id,
  };
}

/**
 * 상태 바꾸기 계획 — 규칙 · 사유 · 대표 여부를 확인한다 (아무것도 쓰지 않는다).
 * pending: 대표 승인이 필요한데 호출자가 그 업체 대표가 아니다 → 요청만 남긴다.
 */
export async function planStatusChange(env, { order, user, to, reason }) {
  const from = order.status;
  const found = transitionRule(from, to);
  const why = cleanReason(reason);
  if (found.reason && !why) {
    throw reasonRequiredError(`${label(from)} → ${label(to)} 는 사유가 있어야 합니다`);
  }
  const owner = found.approval ? await isCompanyOwner(env, user, order.company_id) : false;
  return { from, to, kind: found.kind, reason: why || null, approval: found.approval, pending: found.approval && !owner };
}

/** 이 수주에서 승인을 기다리는 요청 (없으면 null) */
export async function findPendingEvent(env, orderId) {
  return selectOne(env, 'order_events', { order_id: `eq.${orderId}`, state: 'eq.pending', select: EVENT_SELECT });
}

/** 기다리는 요청이 있으면 409 pending_exists — 상태 바꾸기(바로 · 요청) 앞에서 누구에게나 (대표도) */
export async function assertNoPendingEvent(env, orderId) {
  if (await findPendingEvent(env, orderId)) throw pendingExistsError();
}

/** 대표가 아닌 사람의 요청 — 수주는 그대로 두고 pending 한 줄. 이미 기다리는 요청이 있으면 409 */
export async function requestStatusChange(env, { order, user, plan }) {
  await assertNoPendingEvent(env, order.id);
  return eventView(await insertOne(env, 'order_events', eventRow(order, user, plan, 'pending')));
}

/**
 * 수주를 바꾼 값 되돌리기 — 기록을 못 남겼을 때. 기록 없는 상태 변경을 남기지 않으려는 것이라
 * 실패해도 원래 오류를 던지게 둔다 (로그만).
 */
async function restoreOrder(env, order, patch) {
  const back = {};
  for (const k of Object.keys(patch)) back[k] = order[k] === undefined ? null : order[k];
  try {
    await updateBy(env, 'orders', { id: `eq.${order.id}`, status: `eq.${patch.status}` }, back);
  } catch (e) {
    console.error('order restore failed:', e && e.message);
  }
}

/**
 * 바로 바꾸기 — 수주 상태가 아직 from 일 때만 고치고(겹치면 409 stale) 기록을 한 줄 남긴다.
 * patch: 수주에 쓸 칸 전부 (상태 · 날짜 · 같이 보낸 다른 칸). 기록을 못 남기면 수주를 되돌리고 던진다.
 */
export async function applyStatusChange(env, { order, user, plan, patch }) {
  const rows = await updateBy(env, 'orders', { id: `eq.${order.id}`, status: `eq.${plan.from}` }, patch);
  if (!rows || !rows.length) throw staleError();
  let event;
  try {
    event = await insertOne(env, 'order_events', eventRow(order, user, plan, 'done'));
  } catch (e) {
    await restoreOrder(env, order, patch);
    throw e;
  }
  return { order: rows[0], event: eventView(event) };
}

/**
 * 수주 기록 — 수주를 볼 수 있는 사람 누구나 (최근 것 먼저).
 * 화면이 쓰도록 지금 바꿀 수 있는 상태(moves)와 승인 권한(can_decide)도 함께 준다.
 *   moves[].request — 이 사람이 고르면 바로 바뀌지 않고 대표 승인 요청이 된다
 */
export async function listOrderEvents(env, { orderId, user }) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'id,status,company_id,design_id' });
  if (!order) throw new NotFoundError('수주를 찾을 수 없습니다');
  await designAccess(env, order.design_id, user);
  const rows = (await selectMany(env, 'order_events', {
    order_id: `eq.${orderId}`,
    select: EVENT_SELECT,
    order: 'created_at.desc',
    limit: '200',
  })) || [];
  const owner = await isCompanyOwner(env, user, order.company_id);
  const items = rows.map(eventView);
  return {
    status: order.status,
    can_decide: owner,
    pending: items.find((e) => e.state === 'pending') || null,
    moves: allowedMoves(order.status).map((m) => ({
      to: m.to,
      label: m.label,
      kind: m.kind,
      approval: m.approval,
      reason_required: m.reason,
      request: m.approval && !owner,
    })),
    items,
  };
}

/** 내가 대표인 업체의 기다리는 요청 — 수주번호 · 고객 이름만 붙인다 (오래된 것 먼저) */
export async function listOrderRequests(env, { user, state = 'pending' }) {
  if (state !== 'pending') throw new ValidationError('state 는 pending 만 됩니다');
  const companies = await ownerCompanyIds(env, user);
  if (!companies.length) return [];
  const rows = (await selectMany(env, 'order_events', {
    company_id: `in.(${companies.join(',')})`,
    state: 'eq.pending',
    select: EVENT_SELECT,
    order: 'created_at.asc',
    limit: '200',
  })) || [];
  const ids = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  if (!ids.length) return [];
  const orders = (await selectMany(env, 'orders', { id: `in.(${ids.join(',')})`, select: 'id,order_no,customer_name' })) || [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  return rows
    .filter((r) => r.order_id)
    .map((r) => {
      const o = byId.get(r.order_id) || {};
      return { ...eventView(r), order_no: o.order_no || null, customer_name: o.customer_name || null };
    });
}

/**
 * 대표의 승인 · 반려. 그 업체 대표가 아니면 403 not_owner.
 *   승인 — 수주 상태가 아직 요청 때(from_status)와 같을 때만 바꾸고 approved (아니면 409 stale, 요청은 그대로)
 *   반려 — rejected. 수주는 그대로
 */
export async function decideOrderEvent(env, { eventId, user, decision }) {
  const event = await selectOne(env, 'order_events', { id: `eq.${eventId}`, select: EVENT_SELECT });
  if (!event || !event.order_id) throw new NotFoundError('요청을 찾을 수 없습니다');
  if (!(await isCompanyOwner(env, user, event.company_id))) {
    throw new ForbiddenError('대표만 승인 · 반려할 수 있습니다', 'not_owner');
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new ValidationError('decision 은 approved 또는 rejected 여야 합니다');
  }
  if (event.state !== 'pending') throw alreadyDecidedError();
  const decided = { state: decision, decided_by: user.id, decided_at: nowIso() };
  const pendingFilter = { id: `eq.${event.id}`, state: 'eq.pending' };

  if (decision === 'rejected') {
    const rows = await updateBy(env, 'order_events', pendingFilter, decided);
    if (!rows || !rows.length) throw alreadyDecidedError();
    return { event: eventView(rows[0]), order: null };
  }

  const order = await selectOne(env, 'orders', { id: `eq.${event.order_id}`, select: '*' });
  if (!order) throw new NotFoundError('수주를 찾을 수 없습니다');
  const staleMessage = (now) =>
    `수주가 지금 ${label(now)} 상태라 이 요청(${label(event.from_status)} → ${label(event.to_status)})을 적용할 수 없습니다`;
  if (order.status !== event.from_status) throw staleError(staleMessage(order.status));
  const patch = { ...statusPatch(order, event.to_status), ...statusClears(event.from_status, event.to_status) };
  const rows = await updateBy(env, 'orders', { id: `eq.${order.id}`, status: `eq.${event.from_status}` }, patch);
  if (!rows || !rows.length) throw staleError();
  let marked;
  try {
    marked = await updateBy(env, 'order_events', pendingFilter, decided);
  } catch (e) {
    await restoreOrder(env, order, patch);
    throw e;
  }
  if (!marked || !marked.length) {
    await restoreOrder(env, order, patch);
    throw alreadyDecidedError();
  }
  return { event: eventView(marked[0]), order: rows[0] };
}

/** 고객 확인서 승인 전 작업지시서 — 설계에 다는 기록 한 줄 (바로 처리됨) */
export async function recordEarlyWorkOrder(env, { design, user, reason }) {
  return eventView(
    await insertOne(env, 'order_events', {
      company_id: design.company_id,
      design_id: design.id,
      kind: 'early_work_order',
      reason,
      state: 'done',
      requested_by: user.id,
    }),
  );
}
