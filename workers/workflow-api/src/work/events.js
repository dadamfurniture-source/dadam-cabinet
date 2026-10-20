/**
 * 작업자 포털 — 상태 전이 기록 (work_job_events, 추가만).
 *
 * 모든 전이를 한 줄씩 남긴다: 누가(actor_kind · actor_user_id), 무엇이(type), 어디서 어디로(from → to), 사유(note).
 * payload 에는 id 와 상태 값만 담는다 — 이름 · 연락처 · 주소 · 금액은 넣지 않는다.
 * 기록 실패는 원래 요청을 막지 않는다 (쓰기는 이미 끝났다) — 경고만 남긴다.
 */

import { insertOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';

const clip = (s, n) => (s === undefined || s === null || s === '' ? null : String(s).slice(0, n));

/** 이벤트 행 (순수) */
export function eventRow({ jobId, assignmentId = null, actorUserId = null, actorKind, type, from = null, to = null, note = null, payload = {} }) {
  return {
    job_id: jobId,
    assignment_id: assignmentId || null,
    actor_user_id: actorUserId || null,
    actor_kind: actorKind,
    type: clip(type, 40),
    from_status: clip(from, 20),
    to_status: clip(to, 20),
    note: clip(note, 300),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

export async function recordEvent(env, ev) {
  try {
    return await insertOne(env, 'work_job_events', eventRow(ev));
  } catch (err) {
    console.warn(`[work] 이벤트 기록 실패 (${ev && ev.type}) — 요청은 계속:`, isMissingRelation(err) ? 'work_job_events 표 없음' : err && err.message);
    return null;
  }
}

/** 작업 상태가 자동으로 바뀌었으면 system 이벤트 한 줄 */
export async function recordJobStatusChange(env, before, after) {
  if (!before || !after || before.status === after.status) return null;
  return recordEvent(env, { jobId: after.id, actorKind: 'system', type: 'job_status', from: before.status, to: after.status });
}
