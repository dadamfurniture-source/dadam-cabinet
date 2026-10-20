/**
 * 작업자 포털 — 작업 기록 (★5 "가 · 나 둘 다", docs/01-plan/worker-portal-contract.md §3).
 *
 *   (가) 작업자 보고: progress · issue · result. result 는 started · revision 에서 submitted (assembly 는 바로 accepted).
 *        progress · issue 는 작업이 closed · cancelled 가 아니면 언제든 — 끝난 뒤 추가 보고 포함.
 *   (나) 회사 정정 · 메모: correction · note. 원본은 그대로 두고 amends_id 로 가리킨다. 작업자에게 보일지 매번 고른다.
 * 둘 다 같은 작업 기록에 **추가만** 한다 — 이 API 에는 기록을 고치거나 지우는 경로가 없다.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectOne } from '../supabase.js';
import { requireAdminEditor } from './access.js';
import { loadMyAssignment } from './assignments.js';
import { recordEvent } from './events.js';
import { loadJob, needsReview, recordAssignmentChange, transitionAssignment } from './jobs.js';
import { notifyWork } from './notify.js';
import { COUNTED_STATUSES, workerUpdate } from './reveal.js';
import { assertUuid, oneOf, optUuid, reqText } from './validate.js';

const WORKER_KINDS = ['progress', 'issue', 'result'];
const COMPANY_KINDS = ['correction', 'note'];
const ENDED_JOB = ['closed', 'cancelled'];
// 문제 칩 목록은 아직 정하지 않았다 (결정 8) — 값은 검사하지 않고 크기만 막는다
const MAX_CHIPS = 10;
const MAX_CHIP_LEN = 30;

const nowIso = () => new Date().toISOString();

/** 문제 칩 — 글자 배열, 중복 제거 */
export function chipsOf(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CHIPS) throw new ValidationError(`issue_chips 는 ${MAX_CHIPS}개 이하의 배열이어야 합니다`);
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > MAX_CHIP_LEN) throw new ValidationError(`문제 칩은 ${MAX_CHIP_LEN}자 이하 글자여야 합니다`);
    if (!out.includes(v.trim())) out.push(v.trim());
  }
  return out;
}

/** POST /work/assignments/:id/updates — 작업자 보고 */
export async function addWorkerUpdate(env, { user, params, body, ctx }) {
  const b = body || {};
  const kind = oneOf(b.kind, WORKER_KINDS, 'kind');
  const text = reqText(b.body, 1000, '내용');
  const chips = kind === 'issue' ? chipsOf(b.issue_chips) : [];
  const { worker, assignment, job, all } = await loadMyAssignment(env, user, params.id);
  if (ENDED_JOB.includes(job.status)) throw new ConflictError('닫히거나 취소된 작업에는 보고할 수 없습니다');

  let after = assignment;
  if (kind === 'result') {
    if (!['started', 'revision'].includes(assignment.status)) throw new ConflictError('시작한 작업만 완료 보고할 수 있습니다');
    const t = nowIso();
    // 공장 조립은 검수 없이 완료 보고로 끝난다 (각자 스스로 검수)
    const patch = needsReview(job.kind)
      ? { status: 'submitted', submitted_at: t }
      : { status: 'accepted', submitted_at: t, accepted_at: t };
    const r = await transitionAssignment(env, { job, assignment, jobAssignments: all, from: ['started', 'revision'], patch });
    after = r.assignment;
    await recordAssignmentChange(env, { user, actorKind: 'worker', type: 'assignment_submitted', before: assignment, after, job, lockedJob: r.job });
  } else if (!COUNTED_STATUSES.includes(assignment.status)) {
    throw new ConflictError('확정된 배정에서만 보고할 수 있습니다');
  }

  const row = await insertOne(env, 'work_updates', {
    job_id: job.id, assignment_id: assignment.id, author_user_id: user.id, author_role: 'worker',
    kind, body: text, issue_chips: chips, visible_to_worker: true,
  });
  await recordEvent(env, {
    jobId: job.id, assignmentId: assignment.id, actorUserId: user.id, actorKind: 'worker', type: 'update_added',
    payload: { worker_id: worker.id, update_id: row.id, kind },
  });
  if (kind === 'result') notifyWork(env, ctx, 'result_submitted', { job, workerName: worker.display_name });
  if (kind === 'issue') notifyWork(env, ctx, 'issue_reported', { job, workerName: worker.display_name });
  return workerUpdate(row);
}

/** POST /work/admin/jobs/:id/updates — 회사 정정 · 메모 (원본은 그대로) */
export async function addCompanyUpdate(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const jobId = assertUuid(params.id, '작업 id');
  const b = body || {};
  const kind = oneOf(b.kind, COMPANY_KINDS, 'kind');
  const text = reqText(b.body, 1000, '내용');
  if (typeof b.visible_to_worker !== 'boolean') throw new ValidationError('visible_to_worker(true/false)가 필요합니다');
  const assignmentId = optUuid(b.assignment_id, '배정 id');
  const amendsId = optUuid(b.amends_id, '원본 기록 id');
  const job = await loadJob(env, jobId);

  let assignment = null;
  if (assignmentId) {
    assignment = await selectOne(env, 'work_assignments', { id: `eq.${assignmentId}`, job_id: `eq.${jobId}`, select: 'id,worker_id' });
    if (!assignment) throw new NotFoundError('이 작업의 배정이 아닙니다');
  }
  if (amendsId) {
    const original = await selectOne(env, 'work_updates', { id: `eq.${amendsId}`, job_id: `eq.${jobId}`, select: 'id' });
    if (!original) throw new NotFoundError('이 작업의 기록이 아닙니다');
  }

  const row = await insertOne(env, 'work_updates', {
    job_id: job.id, assignment_id: assignmentId, author_user_id: user.id, author_role: 'company',
    kind, body: text, amends_id: amendsId, visible_to_worker: b.visible_to_worker,
  });
  // 작업자에게 보이는 배정 기록만 그 작업자의 새 소식으로 센다 (payload.worker_id)
  const payload = { update_id: row.id, kind, amends_id: amendsId };
  if (assignment && b.visible_to_worker) payload.worker_id = assignment.worker_id;
  await recordEvent(env, { jobId: job.id, assignmentId, actorUserId: user.id, actorKind: 'admin', type: 'update_added', payload });
  return row;
}
