/**
 * 작업자 앱 알림 넣기 — 관리자가 작업자 · 작업을 바꾸면 그 작업자에게 (업체 없는 기기, DB 0023).
 *
 *   work_registration  작업자 신청 승인 · 반려            → 그 작업자          ref = workers.id (상태로 한 번씩)
 *   work_invited       작업에 초대(배정 제안, offered)    → 초대받은 작업자    ref = work_assignments.id
 *   work_assigned      신청한 작업에 뽑힘(배정 confirmed) → 뽑힌 작업자        ref = work_assignments.id
 *   work_schedule      작업의 시작 · 끝 시각이 바뀜       → 그 작업의 제안 · 확정 · 진행 중 작업자
 *                                                          ref = work_jobs.id (새 시작 · 끝 시각으로 한 번씩)
 * 글은 src/push/messages.js — 작업 종류 · 날짜만 (작업 제목 · 지역 · 고객 정보는 싣지 않는다).
 * 받을 사람인지는 보낼 때 다시 본다 (sender.js — 신청 결과는 작업자 행이 있으면, 그 밖은 승인된 작업자만).
 * 넣기는 원래 일을 막지 않는다 — 던지지 않는다. 부르는 쪽은 응답 뒤(waitUntil)에 돌린다 (later).
 */

import { selectMany, selectOne } from '../supabase.js';
import { buildMessage } from './messages.js';
import { enqueueNotification, enqueueNotifications, dedupeKeyOf, isUuid } from './outbox.js';

/** 일정 알림을 받는 배정 (work/jobs.js MINE_STATUSES 중 아직 일을 하지 않은 · 하는 중인 것) */
export const SCHEDULE_ASSIGNMENT_STATUSES = Object.freeze(['offered', 'confirmed', 'started']);

const statusOf = (e) => (e && (e.statusCode || e.status)) || 'error';

/** 응답 뒤에 돌린다 (ctx.waitUntil) — ctx 가 없으면(시험) 기다린다 */
export function later(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
    return Promise.resolve(null);
  }
  return promise;
}

/** 작업자 id → 계정 id (없으면 null) */
async function userOfWorker(env, workerId) {
  if (!isUuid(workerId)) return null;
  const w = await selectOne(env, 'workers', { id: `eq.${workerId}`, select: 'id,user_id' });
  return w && isUuid(w.user_id) ? w.user_id : null;
}

/** 시각 → dedupe 꼬리 (숫자만) */
const stamp = (iso) =>
  String(iso || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 14) || 'none';

/**
 * 작업자 신청 결과 — 승인 · 반려로 바뀌었을 때만.
 * @param {object} worker  workers 한 줄 (id · user_id)
 * @param {string} status  새 상태
 */
export async function notifyWorkerStatus(env, { worker, status }) {
  try {
    if (!worker || !isUuid(worker.id) || !isUuid(worker.user_id)) return 0;
    const message = buildMessage('work_registration', { status });
    if (!message) return 0;
    const ok = await enqueueNotification(env, {
      userId: worker.user_id,
      kind: 'work_registration',
      ...message,
      refId: worker.id,
      dedupeKey: dedupeKeyOf('work_registration', worker.id, worker.user_id, status),
    });
    return ok ? 1 : 0;
  } catch (e) {
    console.warn('[push] work_registration failed:', statusOf(e));
    return 0;
  }
}

/** 초대 · 확정 — 배정 한 줄 → 그 작업자 */
async function notifyAssignment(env, kind, { job, assignment }) {
  try {
    if (!job || !assignment || !isUuid(assignment.id)) return 0;
    const message = buildMessage(kind, {
      jobKind: job.kind,
      startsAt: job.starts_at,
      jobId: job.id,
    });
    if (!message) return 0;
    const userId = await userOfWorker(env, assignment.worker_id);
    if (!userId) return 0;
    const ok = await enqueueNotification(env, {
      userId,
      kind,
      ...message,
      refId: assignment.id,
      dedupeKey: dedupeKeyOf(kind, assignment.id, userId),
    });
    return ok ? 1 : 0;
  } catch (e) {
    console.warn(`[push] ${kind} failed:`, statusOf(e));
    return 0;
  }
}

/** 관리자가 작업에 초대했다 (offered) */
export function notifyWorkInvited(env, { job, assignment }) {
  return notifyAssignment(env, 'work_invited', { job, assignment });
}

/** 신청한 작업에 뽑혔다 (confirmed) */
export function notifyWorkAssigned(env, { job, assignment }) {
  return notifyAssignment(env, 'work_assigned', { job, assignment });
}

/**
 * 작업의 시작 · 끝 시각이 바뀌었다 → 그 작업의 제안 · 확정 · 진행 중 작업자에게 (사람마다 한 줄).
 * @param {object} before  고치기 전 작업
 * @param {object} after   고친 뒤 작업
 */
export async function notifyWorkSchedule(env, { before, after }) {
  try {
    if (!before || !after || !isUuid(after.id)) return 0;
    if (before.starts_at === after.starts_at && before.ends_at === after.ends_at) return 0;
    const message = buildMessage('work_schedule', {
      jobKind: after.kind,
      startsAt: after.starts_at,
      jobId: after.id,
    });
    if (!message) return 0;
    const assignments =
      (await selectMany(env, 'work_assignments', {
        job_id: `eq.${after.id}`,
        status: `in.(${SCHEDULE_ASSIGNMENT_STATUSES.join(',')})`,
        select: 'id,worker_id',
      })) || [];
    const workerIds = [...new Set(assignments.map((a) => a.worker_id).filter(isUuid))];
    if (!workerIds.length) return 0;
    const workers =
      (await selectMany(env, 'workers', {
        id: `in.(${workerIds.join(',')})`,
        select: 'id,user_id',
      })) || [];
    const suffix = `${stamp(after.starts_at)}-${stamp(after.ends_at)}`;
    const rows = [];
    for (const w of workers) {
      if (!isUuid(w.user_id) || rows.some((r) => r.userId === w.user_id)) continue;
      rows.push({
        userId: w.user_id,
        kind: 'work_schedule',
        ...message,
        refId: after.id,
        dedupeKey: dedupeKeyOf('work_schedule', after.id, w.user_id, suffix),
      });
    }
    return await enqueueNotifications(env, rows);
  } catch (e) {
    console.warn('[push] work_schedule failed:', statusOf(e));
    return 0;
  }
}
