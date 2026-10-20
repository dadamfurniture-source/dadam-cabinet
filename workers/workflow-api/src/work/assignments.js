/**
 * 작업자 포털 — 배정 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   신청 승인 → confirmed · 직접 지정(초대) → offered → confirmed / declined
 *   confirmed → started → submitted → accepted (install · as 는 편집자 승인, assembly 는 완료 보고 즉시 — updates.js)
 *   submitted → revision → submitted · confirmed/started → released(작업자 포기) · 편집자 → removed(no_show 표시 가능)
 * 포기 · 노쇼는 사실만 기록한다 — 마감 시각 · 수수료 · 제재 규칙은 정하지 않았다 (결정 14).
 */

import { ConflictError, NotFoundError, insertOne, selectOne } from '../supabase.js';
import { assertAssignable, assertMine, requireAdminEditor, requireApprovedWorker, requireWorker } from './access.js';
import { recordEvent } from './events.js';
import {
  countFilled, declineOffersIfEnded, loadJob, loadJobAssignments, needsReview, recordAssignmentChange, transitionAssignment,
} from './jobs.js';
import { notifyWork } from './notify.js';
import { ACTIVE_STATUSES, workerAssignment } from './reveal.js';
import { assertUuid, optBool, optText, reqText } from './validate.js';

const nowIso = () => new Date().toISOString();
/** 사람을 새로 들일 수 있는 작업 상태 */
const STAFFABLE = ['draft', 'open', 'filled', 'in_progress'];
const ENDED_JOB = ['closed', 'cancelled'];

/**
 * 작업자 본인 배정 + 작업 + 그 작업의 모든 배정. 남의 배정은 404.
 * 정지된 작업자도 진행 중인 일을 정리할 수 있다 (거절 · 시작 · 포기 · 보고). approvedFor 를 주면 승인된 작업자만 (초대 수락).
 */
export async function loadMyAssignment(env, user, rawId, { approvedFor = null } = {}) {
  const id = assertUuid(rawId, '배정 id');
  const worker = approvedFor ? await requireApprovedWorker(env, user, approvedFor) : await requireWorker(env, user);
  const assignment = assertMine(await selectOne(env, 'work_assignments', { id: `eq.${id}`, select: '*' }), worker, '배정');
  const job = await loadJob(env, assignment.job_id);
  const all = await loadJobAssignments(env, job.id);
  return { worker, assignment, job, all };
}

async function loadAssignmentAdmin(env, rawId) {
  const id = assertUuid(rawId, '배정 id');
  const assignment = await selectOne(env, 'work_assignments', { id: `eq.${id}`, select: '*' });
  if (!assignment) throw new NotFoundError('배정을 찾을 수 없습니다');
  const job = await loadJob(env, assignment.job_id);
  const all = await loadJobAssignments(env, job.id);
  return { assignment, job, all };
}

// ── 작업자 ───────────────────────────────────────────────────────

/** POST /work/assignments/:id/confirm — 초대(offered) 수락. 정원이 찼으면 409, 정지된 작업자는 403 */
export async function confirmAssignment(env, { user, params }) {
  const { assignment, job, all } = await loadMyAssignment(env, user, params.id, { approvedFor: 'confirm' });
  if (assignment.status !== 'offered') throw new ConflictError('초대받은 배정만 수락할 수 있습니다');
  if (!STAFFABLE.includes(job.status)) throw new ConflictError('더 이상 사람을 받지 않는 작업입니다');
  if (countFilled(all) >= job.slots) throw new ConflictError('정원이 찼습니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['offered'], patch: { status: 'confirmed' } });
  await recordAssignmentChange(env, { user, actorKind: 'worker', type: 'assignment_confirmed', before: assignment, after: r.assignment, job, lockedJob: r.job });
  return workerAssignment(r.assignment);
}

/** POST /work/assignments/:id/decline — 초대 거절 (사유 선택) */
export async function declineAssignment(env, { user, params, body, ctx }) {
  const reason = optText(body && body.reason, 200, '사유');
  const { worker, assignment, job, all } = await loadMyAssignment(env, user, params.id);
  if (assignment.status !== 'offered') throw new ConflictError('초대받은 배정만 거절할 수 있습니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['offered'], patch: { status: 'declined', release_reason: reason } });
  await recordAssignmentChange(env, { user, actorKind: 'worker', type: 'assignment_declined', before: assignment, after: r.assignment, job, lockedJob: r.job, note: reason });
  notifyWork(env, ctx, 'assignment_declined', { job, workerName: worker.display_name });
  return workerAssignment(r.assignment);
}

/** POST /work/assignments/:id/start — confirmed → started (작업 → in_progress) */
export async function startAssignment(env, { user, params }) {
  const { assignment, job, all } = await loadMyAssignment(env, user, params.id);
  if (assignment.status !== 'confirmed') throw new ConflictError('확정된 배정만 시작할 수 있습니다');
  if (!['open', 'filled', 'in_progress'].includes(job.status)) throw new ConflictError('시작할 수 없는 작업 상태입니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['confirmed'], patch: { status: 'started', started_at: nowIso() } });
  await recordAssignmentChange(env, { user, actorKind: 'worker', type: 'assignment_started', before: assignment, after: r.assignment, job, lockedJob: r.job });
  return workerAssignment(r.assignment);
}

/** POST /work/assignments/:id/release — 작업자 포기 (사유 필수). 자리가 비면 작업이 다시 open */
export async function releaseAssignment(env, { user, params, body, ctx }) {
  const reason = reqText(body && body.reason, 200, '포기 사유');
  const { worker, assignment, job, all } = await loadMyAssignment(env, user, params.id);
  if (!['confirmed', 'started'].includes(assignment.status)) throw new ConflictError('확정 · 진행 중인 배정만 포기할 수 있습니다');
  if (ENDED_JOB.includes(job.status)) throw new ConflictError('닫히거나 취소된 작업입니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['confirmed', 'started'], patch: { status: 'released', release_reason: reason } });
  await recordAssignmentChange(env, { user, actorKind: 'worker', type: 'assignment_released', before: assignment, after: r.assignment, job, lockedJob: r.job, note: reason });
  notifyWork(env, ctx, 'assignment_released', { job, workerName: worker.display_name });
  return workerAssignment(r.assignment);
}

// ── 관리자 ───────────────────────────────────────────────────────

/** POST /work/admin/jobs/:id/invite — 직접 지정 (offered). 승인된 작업자(정지 · 대기는 409) · 종류가 맞아야 */
export async function inviteWorker(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const jobId = assertUuid(params.id, '작업 id');
  const workerId = assertUuid(body && body.worker_id, '작업자 id');
  const job = await loadJob(env, jobId);
  if (!STAFFABLE.includes(job.status)) throw new ConflictError('더 이상 사람을 받지 않는 작업입니다');
  const worker = await selectOne(env, 'workers', { id: `eq.${workerId}`, select: 'id,status,kinds,display_name' });
  if (!worker) throw new NotFoundError('작업자를 찾을 수 없습니다');
  assertAssignable(worker);
  if (!(worker.kinds || []).includes(job.kind)) throw new ConflictError('작업 종류가 맞지 않는 작업자입니다');
  const all = await loadJobAssignments(env, jobId);
  if (all.some((a) => a.worker_id === workerId && ACTIVE_STATUSES.includes(a.status))) throw new ConflictError('이미 배정된 작업자입니다');
  let row;
  try {
    row = await insertOne(env, 'work_assignments', {
      job_id: jobId, worker_id: workerId, via: 'invite', status: 'offered',
      worker_name_snapshot: worker.display_name, created_by: user.id,
    });
  } catch (err) {
    if (err instanceof ConflictError) throw new ConflictError('이미 배정된 작업자입니다');
    throw err;
  }
  await recordEvent(env, {
    jobId, assignmentId: row.id, actorUserId: user.id, actorKind: 'admin', type: 'assignment_offered', to: 'offered',
    payload: { worker_id: workerId, via: 'invite' },
  });
  // 상태 확인과 넣기 사이에 작업이 닫히거나 취소됐으면 그쪽의 자동 정리는 이 초대를 보지 못했다 — 같은 문구로 끝내고 409
  const ended = await declineOffersIfEnded(env, jobId)
    .catch((e) => { console.warn('[work] 남은 초대 정리 실패:', e && e.message); return null; });
  if (ended !== null) throw new ConflictError('더 이상 사람을 받지 않는 작업입니다');
  return row;
}

/** POST /work/admin/assignments/:id/accept — submitted → accepted (install · as) */
export async function acceptAssignment(env, { user, params }) {
  await requireAdminEditor(env, user);
  const { assignment, job, all } = await loadAssignmentAdmin(env, params.id);
  if (!needsReview(job.kind)) throw new ConflictError('조립 작업은 검수 단계가 없습니다');
  if (assignment.status !== 'submitted') throw new ConflictError('완료 보고된 배정만 승인할 수 있습니다');
  if (ENDED_JOB.includes(job.status)) throw new ConflictError('닫히거나 취소된 작업입니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['submitted'], patch: { status: 'accepted', accepted_at: nowIso() } });
  await recordAssignmentChange(env, { user, actorKind: 'admin', type: 'assignment_accepted', before: assignment, after: r.assignment, job, lockedJob: r.job });
  return r.assignment;
}

/**
 * POST /work/admin/assignments/:id/revision — submitted → revision (사유 필수).
 * 작업자가 사유를 볼 수 있게 같은 배정의 회사 메모(note)로도 한 줄 남긴다 (기록은 추가만).
 */
export async function requestRevision(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const reason = reqText(body && body.reason, 200, '보완 요청 사유');
  const { assignment, job, all } = await loadAssignmentAdmin(env, params.id);
  if (assignment.status !== 'submitted') throw new ConflictError('완료 보고된 배정만 보완 요청할 수 있습니다');
  if (ENDED_JOB.includes(job.status)) throw new ConflictError('닫히거나 취소된 작업입니다');
  const r = await transitionAssignment(env, {
    job, assignment, jobAssignments: all, from: ['submitted'],
    patch: { status: 'revision', revision_count: (Number(assignment.revision_count) || 0) + 1 },
  });
  await recordAssignmentChange(env, { user, actorKind: 'admin', type: 'assignment_revision', before: assignment, after: r.assignment, job, lockedJob: r.job, note: reason });
  await insertOne(env, 'work_updates', {
    job_id: job.id, assignment_id: assignment.id, author_user_id: user.id, author_role: 'company',
    kind: 'note', body: `보완 요청: ${reason}`, visible_to_worker: true,
  }).catch((e) => console.warn('[work] 보완 요청 메모 기록 실패:', e && e.message));
  return r.assignment;
}

/** POST /work/admin/assignments/:id/remove — 편집자 제외 (사유 필수, 노쇼 표시 선택). 사유는 이벤트에만 (작업자 화면에 안 나간다) */
export async function removeAssignment(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const reason = reqText(body && body.reason, 200, '제외 사유');
  const noShow = optBool(body && body.no_show, false, 'no_show');
  const { assignment, job, all } = await loadAssignmentAdmin(env, params.id);
  const from = ['offered', 'confirmed', 'started', 'submitted', 'revision'];
  if (!from.includes(assignment.status)) throw new ConflictError('진행 중인 배정만 제외할 수 있습니다');
  if (job.status === 'closed') throw new ConflictError('마감된 작업입니다');
  const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from, patch: { status: 'removed', no_show: noShow } });
  await recordAssignmentChange(env, {
    user, actorKind: 'admin', type: 'assignment_removed', before: assignment, after: r.assignment, job, lockedJob: r.job,
    note: reason, payload: { no_show: noShow },
  });
  return r.assignment;
}
