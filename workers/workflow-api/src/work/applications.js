/**
 * 작업자 포털 — 신청 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   applied → approved(편집자 선정 → 배정 confirmed) / rejected / withdrawn(작업자)
 *   한 작업에 한 사람 한 번 (UNIQUE job_id, worker_id) — 중복은 409. 선착순은 없다 (★4).
 */

import { ConflictError, NotFoundError, insertOne, restDelete, selectOne, updateBy } from '../supabase.js';
import { assertAssignable, assertMine, requireAdminEditor, requireApprovedWorker, requireWorker } from './access.js';
import { recordEvent, recordJobStatusChange } from './events.js';
import { computeJobStatus, countFilled, loadJob, loadJobAssignments, lockJob } from './jobs.js';
import { notifyWork } from './notify.js';
import { ACTIVE_STATUSES, effectiveStatus, workerApplication } from './reveal.js';
import { assertUuid, optText } from './validate.js';

const nowIso = () => new Date().toISOString();

async function loadApplication(env, id) {
  const app = await selectOne(env, 'work_applications', { id: `eq.${id}`, select: '*' });
  if (!app) throw new NotFoundError('신청을 찾을 수 없습니다');
  return app;
}

// ── 작업자 ───────────────────────────────────────────────────────

/** POST /work/jobs/:id/apply — 모집 중 · 지원 종료일 전 · 내 종류인 공개 모집 작업에만. 정지된 작업자는 403 */
export async function applyToJob(env, { user, params, body, ctx }) {
  const jobId = assertUuid(params.id, '작업 id');
  const worker = await requireApprovedWorker(env, user, 'apply');
  const message = optText(body && body.message, 300, '메시지');
  const job = await loadJob(env, jobId);
  if (job.status !== 'open' || job.mode !== 'open') throw new ConflictError('모집 중인 작업이 아닙니다');
  if (effectiveStatus(job) !== 'open') throw new ConflictError('지원 종료일이 지났습니다');
  if (!(worker.kinds || []).includes(job.kind)) throw new ConflictError('내 작업 종류와 맞지 않는 작업입니다');
  const dup = await selectOne(env, 'work_applications', { job_id: `eq.${jobId}`, worker_id: `eq.${worker.id}`, select: 'id' });
  if (dup) throw new ConflictError('이미 신청한 작업입니다');

  let app;
  try {
    app = await insertOne(env, 'work_applications', { job_id: jobId, worker_id: worker.id, status: 'applied', message });
  } catch (err) {
    if (err instanceof ConflictError) throw new ConflictError('이미 신청한 작업입니다');
    throw err;
  }
  await recordEvent(env, {
    jobId, actorUserId: user.id, actorKind: 'worker', type: 'application_created', to: 'applied',
    payload: { worker_id: worker.id, application_id: app.id },
  });
  notifyWork(env, ctx, 'application_created', { job, workerName: worker.display_name });
  return workerApplication(app);
}

/** POST /work/applications/:id/withdraw — 대기(applied) 신청만 (정지된 작업자도 정리할 수 있다) */
export async function withdrawApplication(env, { user, params, ctx }) {
  const id = assertUuid(params.id, '신청 id');
  const worker = await requireWorker(env, user);
  const app = assertMine(await selectOne(env, 'work_applications', { id: `eq.${id}`, select: '*' }), worker, '신청');
  if (app.status !== 'applied') throw new ConflictError('대기 중인 신청만 철회할 수 있습니다');
  const rows = await updateBy(env, 'work_applications', { id: `eq.${id}`, status: 'eq.applied' }, { status: 'withdrawn' });
  if (!rows || !rows.length) throw new ConflictError('신청 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  // 알림은 본사 작업일 때만 — 업체 칸까지 읽는다 (src/work/notify.js)
  const job = await selectOne(env, 'work_jobs', { id: `eq.${app.job_id}`, select: 'id,kind,title,company_id' });
  await recordEvent(env, {
    jobId: app.job_id, actorUserId: user.id, actorKind: 'worker', type: 'application_withdrawn', from: 'applied', to: 'withdrawn',
    payload: { worker_id: worker.id, application_id: id },
  });
  notifyWork(env, ctx, 'application_withdrawn', { job, workerName: worker.display_name });
  return workerApplication(rows[0]);
}

// ── 관리자 ───────────────────────────────────────────────────────

/**
 * POST /work/admin/applications/:id/approve — 신청 승인 → 배정 confirmed.
 * 정원이 찼으면 409. 동시에 두 관리자가 승인하면 version 잠금에 진 쪽이 배정 · 신청을 되돌리고 409.
 */
export async function approveApplication(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '신청 id');
  const reason = optText(body && body.reason, 200, '사유');
  const app = await loadApplication(env, id);
  if (app.status !== 'applied') throw new ConflictError('대기 중인 신청만 승인할 수 있습니다');
  const job = await loadJob(env, app.job_id);
  if (!['open', 'filled', 'in_progress'].includes(job.status)) throw new ConflictError('모집 · 진행 중인 작업에서만 승인할 수 있습니다');
  const worker = assertAssignable(await selectOne(env, 'workers', { id: `eq.${app.worker_id}`, select: 'id,status,display_name' }));
  const all = await loadJobAssignments(env, job.id);
  if (countFilled(all) >= job.slots) throw new ConflictError('정원이 찼습니다');
  if (all.some((a) => a.worker_id === worker.id && ACTIVE_STATUSES.includes(a.status))) throw new ConflictError('이미 배정된 작업자입니다');

  // 1) 신청 → approved (applied 일 때만)
  const decided = await updateBy(env, 'work_applications', { id: `eq.${id}`, status: 'eq.applied' },
    { status: 'approved', decided_by: user.id, decided_at: nowIso(), decide_reason: reason });
  if (!decided || !decided.length) throw new ConflictError('신청 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  const revertApplication = () => updateBy(env, 'work_applications', { id: `eq.${id}`, status: 'eq.approved' },
    { status: 'applied', decided_by: null, decided_at: null, decide_reason: null })
    .catch((e) => console.warn('[work] 신청 되돌리기 실패:', e && e.message));

  // 2) 배정 confirmed
  let assignment;
  try {
    assignment = await insertOne(env, 'work_assignments', {
      job_id: job.id, worker_id: worker.id, application_id: id, via: 'application', status: 'confirmed',
      worker_name_snapshot: worker.display_name, created_by: user.id,
    });
  } catch (err) {
    await revertApplication();
    if (err instanceof ConflictError) throw new ConflictError('이미 배정된 작업자입니다');
    throw err;
  }

  // 3) 작업 잠금 — 지면 배정 · 신청을 되돌린다
  let locked;
  try {
    locked = await lockJob(env, job, { status: computeJobStatus(job, [...all, assignment]) });
  } catch (err) {
    await restDelete(env, 'work_assignments', { id: `eq.${assignment.id}` })
      .catch((e) => console.warn('[work] 배정 되돌리기 실패:', e && e.message));
    await revertApplication();
    throw err;
  }

  await recordEvent(env, {
    jobId: job.id, actorUserId: user.id, actorKind: 'admin', type: 'application_approved', from: 'applied', to: 'approved',
    note: reason, payload: { worker_id: worker.id, application_id: id },
  });
  await recordEvent(env, {
    jobId: job.id, assignmentId: assignment.id, actorUserId: user.id, actorKind: 'admin', type: 'assignment_confirmed', to: 'confirmed',
    payload: { worker_id: worker.id, via: 'application' },
  });
  await recordJobStatusChange(env, job, locked);
  return { application: decided[0], assignment };
}

/** POST /work/admin/applications/:id/reject */
export async function rejectApplication(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '신청 id');
  const reason = optText(body && body.reason, 200, '사유');
  const app = await loadApplication(env, id);
  if (app.status !== 'applied') throw new ConflictError('대기 중인 신청만 반려할 수 있습니다');
  const rows = await updateBy(env, 'work_applications', { id: `eq.${id}`, status: 'eq.applied' },
    { status: 'rejected', decided_by: user.id, decided_at: nowIso(), decide_reason: reason });
  if (!rows || !rows.length) throw new ConflictError('신청 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  await recordEvent(env, {
    jobId: app.job_id, actorUserId: user.id, actorKind: 'admin', type: 'application_rejected', from: 'applied', to: 'rejected',
    note: reason, payload: { worker_id: app.worker_id, application_id: id },
  });
  return { application: rows[0] };
}
