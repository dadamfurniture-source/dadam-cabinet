/**
 * 일정의 담당 글(design_schedules.assignee_name) ← 그 일정에서 생긴 작업의 배정된 작업자 이름.
 * (2026-11-13 「작업자 한 길」 — 달력 · 지도 핀 · 표의 「담당」이 그대로 작업자 이름을 보이게 한다)
 *
 * 배정이 바뀔 때마다 부른다 (배정 · 수락 · 거절 · 포기 · 빼기). 일정에서 생긴 작업(job.schedule_id)만 다룬다.
 * 남은 배정이 하나도 없으면 담당 글을 비운다 — 거절 · 뺀 사람 이름이 일정에 남지 않게.
 *
 * 일정의 상태(design_schedules.status) ← 그 작업이 끝났으면(done — 맡은 사람이 모두 확인됨) 「끝남」(completed).
 * (팩토리가 「확인」을 눌렀는데 일정은 「예정」으로 남던 것. work/jobs.js transitionAssignment 가 부른다)
 * 원래 일을 막지 않는다 — 던지지 않는다.
 */

import { selectMany, updateBy } from '../supabase.js';
import { ACTIVE_STATUSES } from './reveal.js';

/** design_schedules.assignee_name 길이 (schedules.js toRow 와 같다) */
export const ASSIGNEE_NAME_MAX = 100;
/** 아직 끝나지 않은 일정 상태 — 이때만 「끝남」으로 바꾼다 (취소했거나 이미 끝난 일정은 그대로) */
export const OPEN_SCHEDULE_STATUSES = Object.freeze(['scheduled', 'confirmed', 'in_progress']);

/** 배정 목록 → 담당 글 (순수). 활성 배정(수락 대기 ~ 확인함)의 이름을 넣은 차례로, 없으면 null */
export function assigneeNameOf(assignments) {
  const names = [];
  for (const a of assignments || []) {
    const name = a && ACTIVE_STATUSES.includes(a.status) ? String(a.worker_name_snapshot || '').trim() : '';
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return null;
  let out = '';
  for (const n of names) {
    const next = out ? `${out} · ${n}` : n;
    if (next.length > ASSIGNEE_NAME_MAX) break;
    out = next;
  }
  return out || names[0].slice(0, ASSIGNEE_NAME_MAX);
}

/** 그 작업의 일정 담당 글을 지금 배정에 맞춘다. 바꾼 글(또는 null) · 일정이 없으면 undefined */
export async function syncAssigneeName(env, job) {
  try {
    if (!job || !job.schedule_id) return undefined;
    const rows =
      (await selectMany(env, 'work_assignments', {
        job_id: `eq.${job.id}`,
        select: 'status,worker_name_snapshot,created_at',
        order: 'created_at.asc',
        limit: '200',
      })) || [];
    const name = assigneeNameOf(rows);
    await updateBy(env, 'design_schedules', { id: `eq.${job.schedule_id}` }, { assignee_name: name });
    return name;
  } catch (e) {
    console.warn('[work] 일정 담당 글 맞추기 실패:', e && e.message);
    return undefined;
  }
}

/**
 * 그 작업이 끝났으면(done) 그 일정을 「끝남」으로 둔다. 바꿨으면 true.
 * 설치 · A/S 표에서 사람이 상태를 「끝남」으로 고르는 것과 같은 칸만 쓴다 (status — 완료 시각은 DB 트리거가 적는다).
 * 취소했거나 이미 끝난 일정은 건드리지 않는다. 던지지 않는다.
 */
export async function completeScheduleOf(env, job) {
  try {
    if (!job || !job.schedule_id || job.status !== 'done') return false;
    const rows = await updateBy(
      env,
      'design_schedules',
      { id: `eq.${job.schedule_id}`, status: `in.(${OPEN_SCHEDULE_STATUSES.join(',')})` },
      { status: 'completed' },
    );
    return !!(rows && rows.length);
  } catch (e) {
    console.warn('[work] 일정을 끝남으로 두기 실패:', e && e.message);
    return false;
  }
}
