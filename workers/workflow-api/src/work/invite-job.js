/**
 * 「이 일로 바로」 초대 — 초대에 이어진 작업(worker_invites.job_id, DB 0065)에 배정 제안을 넣는다.
 * (2026-11-13 사장님 결정: 작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결. 처음 보는 작업자만 팩토리가 한 번 승인)
 *
 * 부르는 곳
 *   work/company.js  patchCompanyWorker — 초대로 온 작업자의 연결을 팩토리가 승인했을 때
 *   work/invites.js  claimInvite        — 이미 연결이 승인된 작업자가 초대를 열었을 때
 * 넣는 것은 배정 제안(offered)뿐 — 작업자가 「수락」해야 확정된다. 작업이 끝났거나 · 남의 팩토리 작업이거나 ·
 * 작업자가 승인 상태가 아니면 아무것도 하지 않는다. 원래 일(연결 승인 · 초대 쓰기)을 막지 않는다 — 던지지 않는다.
 */

import { selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { inviteWorkerCore } from './assignments.js';
import { computeJobStatus, loadJobAssignments, lockJob } from './jobs.js';
import { ACTIVE_STATUSES } from './reveal.js';
import { syncAssigneeName } from './schedule-names.js';

/** 사람을 새로 들일 수 있는 작업 상태 (work/assignments.js STAFFABLE 과 같다) */
const STAFFABLE = ['draft', 'open', 'filled', 'in_progress'];

/**
 * @param {string} companyId  초대한 팩토리
 * @param {string} workerId   작업자
 * @param {string} inviteId   초대
 * @param {object} [actor]    배정한 사람으로 남길 계정 — 없으면 초대를 만든 사람
 * @returns {Promise<object|null>} 넣은 배정 줄 (없으면 null)
 */
export async function offerInviteJob(env, { companyId, workerId, inviteId, actor = null, ctx = null }) {
  try {
    if (!companyId || !workerId || !inviteId) return null;
    const invite = await selectOne(env, 'worker_invites', { id: `eq.${inviteId}`, select: 'id,job_id,company_id,created_by' });
    if (!invite || !invite.job_id || (invite.company_id && invite.company_id !== companyId)) return null;
    let job = await selectOne(env, 'work_jobs', { id: `eq.${invite.job_id}`, company_id: `eq.${companyId}`, select: '*' });
    if (!job || !STAFFABLE.includes(job.status)) return null;
    const worker = await selectOne(env, 'workers', { id: `eq.${workerId}`, select: 'id,status,kinds,display_name' });
    if (!worker || worker.status !== 'approved') return null;
    const all = await loadJobAssignments(env, job.id);
    const active = all.filter((a) => ACTIVE_STATUSES.includes(a.status));
    if (active.some((a) => a.worker_id === worker.id)) return null;
    // 정원 = 지금 배정(수락 대기 포함) + 이 사람 — 모자라면 늘린다
    const need = active.length + 1;
    if (job.slots < need) job = await lockJob(env, job, { slots: need, status: computeJobStatus({ ...job, slots: need }, all) });
    const user = actor && actor.id ? actor : { id: invite.created_by || null };
    const row = await inviteWorkerCore(env, { user, job, worker, actorKind: 'member', ctx });
    await syncAssigneeName(env, job);
    return row;
  } catch (e) {
    if (!isMissingRelation(e)) console.warn('[work] 초대의 작업에 배정 제안 넣기 실패:', e && e.message);
    return null;
  }
}
