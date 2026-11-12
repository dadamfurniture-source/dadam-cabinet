/**
 * 일이 생길 때 앱 알림 넣기 — 수주 승인 요청 · 요청 결과 · 고객 확인서 결정.
 *
 *   order_request          대표 승인이 필요한 요청(되살리기 · 완료 되돌리기)이 생기면 → 그 업체 대표들 (요청한 사람 빼고)
 *   order_request_decided  대표가 승인 · 반려하면 → 요청한 사람 (스스로 결정한 경우 빼고)
 *   confirmation_decided   고객이 확인서를 승인 · 반려하면 → 설계 업체 대표 · 실장 + 설계를 만든 사람 (그 업체 구성원일 때)
 *
 * ref_id 는 그 일의 행(요청 = order_events, 확인서 = design_documents) — 같은 일은 한 번만 들어간다.
 * 글은 src/push/messages.js — 수주 번호는 서버 모양일 때만, 고객 이름 · 설계 제목은 싣지 않는다.
 * 넣기는 원래 일을 막지 않는다 — 던지지 않고 종류 · 상태 코드만 경고한다. 부르는 쪽은 응답 뒤(waitUntil)에 돌린다.
 */

import { selectOne } from '../supabase.js';
import { buildMessage } from './messages.js';
import { enqueueNotification, notifyRoles, dedupeKeyOf, isUuid } from './outbox.js';

const statusOf = (e) => (e && (e.statusCode || e.status)) || 'error';

/** 수주 번호 · 업체 (요청 줄의 화면용 모양에는 업체 칸이 없다) */
async function orderOf(env, orderId) {
  if (!orderId) return null;
  return selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'order_no,company_id' });
}

/**
 * 대표 승인을 기다리는 요청이 생겼다 → 그 업체 대표들에게.
 * @param {object} event  order_events 한 줄 (id · order_id · kind · state · requested_by)
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function notifyOrderRequest(env, event) {
  try {
    if (!event || event.state !== 'pending' || !event.id || !event.order_id) return 0;
    // 대표 승인이 필요한 종류(되살리기 · 완료 되돌리기)만 — 아니면 글이 없다
    if (!buildMessage('order_request', { eventKind: event.kind })) return 0;
    const order = await orderOf(env, event.order_id);
    if (!order || !order.company_id) return 0;
    return await notifyRoles(env, {
      companyId: order.company_id,
      roles: ['owner'],
      excludeUserIds: [event.requested_by],
      kind: 'order_request',
      ...buildMessage('order_request', { eventKind: event.kind, orderNo: order.order_no }),
      refId: event.id,
    });
  } catch (e) {
    console.warn('[push] order_request hook failed:', statusOf(e));
    return 0;
  }
}

/**
 * 대표가 요청을 승인 · 반려했다 → 요청한 사람에게.
 * @param {object} event  결정된 order_events 한 줄 (id · order_id · kind · state approved|rejected · requested_by · decided_by)
 */
export async function notifyOrderRequestDecided(env, event) {
  try {
    if (!event || !event.id || !event.order_id) return 0;
    if (event.state !== 'approved' && event.state !== 'rejected') return 0;
    const requester = event.requested_by;
    if (!isUuid(requester) || requester === event.decided_by) return 0;
    const order = await orderOf(env, event.order_id);
    if (!order || !order.company_id) return 0;
    const msg = buildMessage('order_request_decided', {
      eventKind: event.kind,
      orderNo: order.order_no,
      approved: event.state === 'approved',
    });
    if (!msg) return 0;
    const ok = await enqueueNotification(env, {
      userId: requester,
      companyId: order.company_id,
      kind: 'order_request_decided',
      ...msg,
      refId: event.id,
      dedupeKey: dedupeKeyOf('order_request_decided', event.id, requester),
    });
    return ok ? 1 : 0;
  } catch (e) {
    console.warn('[push] order_request_decided hook failed:', statusOf(e));
    return 0;
  }
}

/**
 * 고객이 확인서를 승인 · 반려했다 → 설계 업체 대표 · 실장 + 설계를 만든 사람.
 * @param {object} doc  결정된 design_documents 한 줄 (id · design_id · doc_type · decision)
 */
export async function notifyConfirmationDecided(env, doc) {
  try {
    if (!doc || doc.doc_type !== 'customer_confirmation' || !doc.id || !doc.design_id) return 0;
    if (doc.decision !== 'approved' && doc.decision !== 'rejected') return 0;
    const design = await selectOne(env, 'designs', { id: `eq.${doc.design_id}`, select: 'company_id,user_id' });
    if (!design || !design.company_id) return 0;
    return await notifyRoles(env, {
      companyId: design.company_id,
      roles: ['owner', 'manager'],
      userIds: design.user_id ? [design.user_id] : [],
      kind: 'confirmation_decided',
      ...buildMessage('confirmation_decided', { approved: doc.decision === 'approved' }),
      refId: doc.id,
      dedupeSuffix: doc.decision,
    });
  } catch (e) {
    console.warn('[push] confirmation_decided hook failed:', statusOf(e));
    return 0;
  }
}
