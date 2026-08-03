/**
 * 일정 등록 + Slack 알림.
 *
 * ★ 순서가 핵심이다.
 *   1) design_schedules 를 먼저 커밋한다
 *   2) slack_notifications 를 pending 으로 기록한다
 *   3) 클라이언트에 201 을 준다 (slack.status='pending')
 *   4) 응답 후 ctx.waitUntil 로 Slack 에 보낸다
 *
 *   Slack 이 죽어도 일정은 남는다. 이게 업무 루프의 생명선이다.
 *   Slack 실패로 500 을 던지면 일정 등록 자체가 실패한 것처럼 보인다.
 */

import {
  ValidationError,
  NotFoundError,
  assertDesignOwner,
  insertOne,
  insertMany,
  selectOne,
  selectMany,
  updateById,
} from './supabase.js';
import { buildScheduleBlocks, postToWebhook, SCHEDULE_LABELS } from './slack.js';

export const SCHEDULE_TYPES = Object.keys(SCHEDULE_LABELS);
const SCHEDULE_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'];
const MAX_ITEMS_PER_BATCH = 50;

function validItem(raw, index) {
  const problems = [];
  if (!raw || typeof raw !== 'object') return { problems: ['항목이 객체가 아님'], index };

  if (!SCHEDULE_TYPES.includes(raw.type)) {
    problems.push(`type 은 ${SCHEDULE_TYPES.join(', ')} 중 하나여야 합니다`);
  }
  const when = new Date(raw.scheduled_at);
  if (!raw.scheduled_at || Number.isNaN(when.getTime())) {
    problems.push('scheduled_at 이 올바른 날짜가 아닙니다');
  }
  if (raw.duration_min !== undefined && !(Number(raw.duration_min) > 0)) {
    problems.push('duration_min 은 양수여야 합니다');
  }
  if (raw.status !== undefined && !SCHEDULE_STATUSES.includes(raw.status)) {
    problems.push(`status 는 ${SCHEDULE_STATUSES.join(', ')} 중 하나여야 합니다`);
  }
  return problems.length ? { problems, index } : null;
}

export function validateScheduleItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items 배열이 필요합니다');
  }
  if (items.length > MAX_ITEMS_PER_BATCH) {
    throw new ValidationError(`한 번에 등록 가능한 일정은 ${MAX_ITEMS_PER_BATCH}건까지입니다`);
  }
  const bad = items.map(validItem).filter(Boolean);
  if (bad.length) throw new ValidationError('일정 항목에 잘못된 값이 있습니다', bad);
}

function toRow(designId, documentId, batchId, userId, raw) {
  return {
    design_id: designId,
    document_id: documentId || null,
    batch_id: batchId,
    type: raw.type,
    title: String(raw.title || SCHEDULE_LABELS[raw.type] || raw.type).slice(0, 200),
    description: raw.description ? String(raw.description).slice(0, 2000) : null,
    scheduled_at: new Date(raw.scheduled_at).toISOString(),
    duration_min: Number(raw.duration_min) > 0 ? Math.round(Number(raw.duration_min)) : 60,
    assignee_name: raw.assignee_name ? String(raw.assignee_name).slice(0, 100) : null,
    location: raw.location ? String(raw.location).slice(0, 300) : null,
    status: SCHEDULE_STATUSES.includes(raw.status) ? raw.status : 'scheduled',
    notes: raw.notes ? String(raw.notes).slice(0, 2000) : null,
    created_by: userId,
  };
}

/**
 * 알림에 실을 링크.
 *
 * ★ Worker 의 /documents/:id/print 를 그대로 걸면 안 된다. 그 경로는 JWT 를
 *   요구하는데 Slack 버튼은 브라우저가 헤더 없이 여는 평범한 링크라 401 이 된다.
 *   고객 공유 링크도 실을 수 없다 — 평문 토큰은 발급 시점에만 존재하고
 *   DB 에는 해시만 남는다(그게 설계 의도다).
 *   그래서 로그인 뒤 워크플로 패널이 열리는 설계 페이지로 보낸다.
 */
async function collectLinks(env, designId, documentId) {
  const docs = await selectMany(env, 'design_documents', {
    design_id: `eq.${designId}`,
    select: 'id,doc_type,doc_no,status,created_at',
    order: 'created_at.desc',
    limit: '20',
  });

  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const list = docs || [];
  const target = documentId ? list.find((d) => d.id === documentId) : null;
  const workOrder = list.find((d) => d.doc_type === 'work_order');
  const confirmation = list.find((d) => d.doc_type === 'customer_confirmation');

  return {
    docNo: (target || confirmation || workOrder || {}).doc_no || null,
    designUrl: base ? `${base}/detaildesign?id=${encodeURIComponent(designId)}` : null,
  };
}

/**
 * 일정 등록. Slack 전송은 응답 후에 한다.
 * @param {Object} ctx Worker ExecutionContext (waitUntil 용)
 */
export async function createSchedules(env, ctx, { designId, user, body }) {
  const design = await assertDesignOwner(env, designId, user.id);
  validateScheduleItems(body.items);

  const batchId = crypto.randomUUID();
  const rows = body.items.map((raw) => toRow(designId, body.document_id, batchId, user.id, raw));

  // 1) 일정 먼저 커밋 — Slack 이 죽어도 남아야 한다
  const created = await insertMany(env, 'design_schedules', rows);

  // 2) 알림 레코드를 pending 으로
  const idempotencyKey = `sched:${batchId}`;
  const snapshot = await selectOne(env, 'design_snapshots', {
    design_id: `eq.${designId}`,
    select: 'design_title,quote_payload',
    order: 'rev.desc',
  });
  const links = await collectLinks(env, designId, body.document_id);

  const payload = buildScheduleBlocks({
    title: (snapshot && snapshot.design_title) || design.name || design.title || '설계',
    customerName: body.customer_name || null,
    schedules: created,
    links,
    totalKrw: snapshot && snapshot.quote_payload ? snapshot.quote_payload.total : null,
  });

  const notification = await insertOne(env, 'slack_notifications', {
    design_id: designId,
    batch_id: batchId,
    idempotency_key: idempotencyKey,
    payload,
    status: 'pending',
  });

  // 3) 응답 후 전송
  const send = deliver(env, notification.id, payload);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  else await send;

  return {
    batch_id: batchId,
    schedules: created,
    slack: { status: 'pending', notification_id: notification.id },
  };
}

/** 실제 전송 + 결과 기록. 예외를 밖으로 던지지 않는다. */
async function deliver(env, notificationId, payload) {
  try {
    const result = await postToWebhook(env, payload);
    await updateById(env, 'slack_notifications', notificationId, {
      status: result.ok ? 'sent' : 'failed',
      attempts: result.attempts,
      last_error: result.ok ? null : String(result.error || '').slice(0, 1000),
      sent_at: result.ok ? new Date().toISOString() : null,
    });
  } catch (e) {
    console.error('slack deliver failed:', e && e.message);
    try {
      await updateById(env, 'slack_notifications', notificationId, {
        status: 'failed',
        last_error: String((e && e.message) || e).slice(0, 1000),
      });
    } catch (_) {
      /* 기록 실패는 삼킨다 */
    }
  }
}

/** 재전송 (멱등). 이미 sent 면 아무것도 하지 않는다. */
export async function resendBatch(env, ctx, { batchId, user }) {
  const notification = await selectOne(env, 'slack_notifications', {
    batch_id: `eq.${batchId}`,
    select: '*',
  });
  if (!notification) throw new NotFoundError('알림 기록을 찾을 수 없습니다');
  await assertDesignOwner(env, notification.design_id, user.id);

  if (notification.status === 'sent') {
    return { status: 'sent', resent: false, sent_at: notification.sent_at };
  }

  const send = deliver(env, notification.id, notification.payload);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  else await send;

  return { status: 'pending', resent: true, notification_id: notification.id };
}

export async function listSchedules(env, { designId, user }) {
  await assertDesignOwner(env, designId, user.id);
  const rows = await selectMany(env, 'design_schedules', {
    design_id: `eq.${designId}`,
    select: '*',
    order: 'scheduled_at.asc',
    limit: '200',
  });
  return rows || [];
}

export async function updateSchedule(env, { scheduleId, user, patch }) {
  const row = await selectOne(env, 'design_schedules', { id: `eq.${scheduleId}`, select: '*' });
  if (!row) throw new NotFoundError('일정을 찾을 수 없습니다');
  await assertDesignOwner(env, row.design_id, user.id);

  const allowed = {};
  if (patch.status !== undefined) {
    if (!SCHEDULE_STATUSES.includes(patch.status)) {
      throw new ValidationError(`status 는 ${SCHEDULE_STATUSES.join(', ')} 중 하나여야 합니다`);
    }
    allowed.status = patch.status;
  }
  if (patch.scheduled_at !== undefined) {
    const when = new Date(patch.scheduled_at);
    if (Number.isNaN(when.getTime())) throw new ValidationError('scheduled_at 이 올바르지 않습니다');
    allowed.scheduled_at = when.toISOString();
  }
  if (patch.duration_min !== undefined) {
    if (!(Number(patch.duration_min) > 0)) throw new ValidationError('duration_min 은 양수여야 합니다');
    allowed.duration_min = Math.round(Number(patch.duration_min));
  }
  for (const k of ['title', 'description', 'assignee_name', 'location', 'notes']) {
    if (patch[k] !== undefined) allowed[k] = patch[k] ? String(patch[k]).slice(0, 2000) : null;
  }

  if (Object.keys(allowed).length === 0) {
    throw new ValidationError('변경할 필드가 없습니다');
  }

  // 일정 변경은 Slack 을 자동으로 다시 보내지 않는다 (스팸 방지).
  // 필요하면 재전송 엔드포인트를 명시적으로 호출한다.
  return updateById(env, 'design_schedules', scheduleId, allowed);
}
