/**
 * 모집 게시 — 팩토리가 작업을 올리면 연결된 작업자들이 보고 신청하고, 팩토리가 그중에서 뽑는다.
 * (2026-11-14 사장님 결정: 「작업 배정」 줄에 「모집 올리기」 — 프로젝트의 종류 줄 · 납품 · 설치 · A/S 일정 줄.
 *  프로젝트나 일정에 붙지 않은 작업은 만들지 않는다. 지금까지는 팩토리가 작업자를 골라 제안하는 「지정」뿐이었다)
 *
 *   모집 올리기   POST /company/projects/:id/work/recruit { kind, people, apply_deadline?, at? }   (work/project-work.js)
 *                POST /company/schedules/:id/workers/recruit { people, apply_deadline? }           (work/schedule-link.js)
 *     작업을 「공개 모집」(mode open)으로 돌리고 정원을 「지금 배정된 사람 + people」로 둔다.
 *     그 팩토리와 연결이 승인된 작업자 가운데 그 종류를 하는 사람에게 앱 알림 (작업마다 사람마다 한 번).
 *     작업자 화면의 「모집중」 탭에는 종류 · 날짜 · 지역(시 · 구) · 팩토리 이름만 보인다 — 주소 · 고객 정보는 없다.
 *   모집 내리기   같은 경로 { stop: true } — 「지정」으로 되돌리고, 답을 기다리던 신청은 반려로 끝낸다.
 *   뽑기 · 반려   POST /company/work/applications/:id/approve | reject (대표 · 실장)
 *     뽑으면 그 작업자의 배정이 바로 확정된다 — 작업자가 스스로 신청했으므로 따로 수락을 받지 않는다 (선착순은 없다, 팩토리가 고른다).
 *     현장 일(설치 · A/S · 철거 · 납품)이면 그때부터 현장 정보가 열린다 (reveal.js siteOpenFor · 처리방침 「신청해서 뽑힌 작업자」).
 *     신청만 하고 뽑히지 않은 작업자에게는 열리지 않는다.
 *
 * 누가       모집 올리기 · 뽑기는 대표 · 실장, 인사를 쓰는 팩토리(다담 공장 · active Agent)만. 내리기 · 반려는 등급이 내려가도 된다.
 * 다른 업체   신청 · 작업을 company_id 로 거른다. 남의 팩토리 작업의 신청 id 는 404.
 *            작업자는 연결이 승인된 팩토리의 모집만 본다 (work/jobs.js openJobsFor · applications.js applyToJob).
 * 고객 정보   팩토리 화면의 신청 줄은 작업자 이름 · 남긴 글 · 신청한 때만 싣는다 (작업자 id · 전화는 싣지 않는다).
 */

import { NotFoundError, selectMany, selectOne, updateBy } from '../supabase.js';
import { approveApplicationCore, rejectApplicationCore } from './applications.js';
import { workersCompanyOf } from './company.js';
import { recordEvent } from './events.js';
import { computeJobStatus, countFilled, loadJobAssignments, lockJob } from './jobs.js';
import { kindsFor } from './links.js';
import { ACTIVE_STATUSES, effectiveStatus } from './reveal.js';
import { syncAssigneeName } from './schedule-names.js';
import { later, notifyWorkRecruit } from '../push/work-hooks.js';
import { assertUuid, optText } from './validate.js';

/** 모집을 내려 끝난 신청에 남기는 사유 (결정 사유는 작업자에게 내보내지 않는다 — reveal.js workerApplication) */
export const RECRUIT_CLOSED = '모집이 끝났습니다';
/** 끝난 작업 — 모집을 켜지 못한다 */
const FINISHED_JOB = Object.freeze(['done', 'closed', 'cancelled']);
/** 팩토리 화면에 싣는 신청 수 */
const APPLICATIONS_LIMIT = 100;

const nowIso = () => new Date().toISOString();

/**
 * 그 작업의 모집 모습 — 팩토리 화면용 (GET · 쓰기 뒤 응답).
 *   { on, state, slots, filled, deadline, applications [{ application_id, name, message, at }] }
 *   on    = 공개 모집으로 올려 둔 작업인가 (끝난 작업은 아니다)
 *   state = open 모집 중 · full 정원이 참(모집중 탭에 안 보인다) · expired 지원 종료일이 지남 · null 모집 아님
 * 작업이 없으면 null.
 */
export async function recruitOf(env, job, all) {
  if (!job) return null;
  const on = job.mode === 'open' && !FINISHED_JOB.includes(job.status);
  const applied =
    (await selectMany(env, 'work_applications', {
      job_id: `eq.${job.id}`, status: 'eq.applied', select: 'id,worker_id,message,created_at', order: 'created_at.asc', limit: String(APPLICATIONS_LIMIT),
    })) || [];
  const ids = [...new Set(applied.map((a) => a.worker_id))];
  const people = ids.length ? (await selectMany(env, 'workers', { id: `in.(${ids.join(',')})`, select: 'id,display_name' })) || [] : [];
  const nameOf = new Map(people.map((w) => [w.id, w.display_name || null]));
  const state = !on ? null : effectiveStatus(job) === 'expired' ? 'expired' : job.status === 'open' ? 'open' : 'full';
  return {
    on,
    state,
    slots: job.slots,
    filled: countFilled(all || []),
    deadline: on ? job.apply_deadline || null : null,
    applications: applied.map((a) => ({ application_id: a.id, name: nameOf.get(a.worker_id) || null, message: a.message || null, at: a.created_at || null })),
  };
}

/** 그 팩토리와 연결이 승인됐고 그 종류를 하는 승인된 작업자의 계정들 — 이미 그 작업에 배정된 사람은 뺀다 */
async function recruitAudience(env, job, all) {
  const links = (await selectMany(env, 'worker_companies', { company_id: `eq.${job.company_id}`, status: 'eq.approved', select: 'worker_id,kinds', limit: '500' })) || [];
  const taken = new Set((all || []).filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.worker_id));
  const linkOf = new Map(links.map((l) => [l.worker_id, l]));
  const ids = [...linkOf.keys()].filter((id) => !taken.has(id));
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const rows = (await selectMany(env, 'workers', { id: `in.(${ids.slice(i, i + 100).join(',')})`, status: 'eq.approved', select: 'id,user_id,kinds' })) || [];
    // 모집중 탭이 보는 것과 같은 판정 — 이 팩토리가 그 작업자에게 맡기는 종류에 그 작업 종류가 있어야 보인다 (jobs.js isBrowsableVia)
    for (const w of rows) if (w.user_id && kindsFor(linkOf.get(w.id), w).includes(job.kind)) out.push(w.user_id);
  }
  return out;
}

/**
 * 모집 올리기 — 작업을 공개 모집으로 돌린다. 정원 = 지금 배정된 사람(수락 대기 포함) + people.
 * 작업 상태(끝나지 않았는지) · 권한은 부르는 쪽이 본다.
 * @returns {Promise<object>} 바뀐 작업
 */
export async function openRecruit(env, { user, job, people, deadline = null, ctx }) {
  const all = await loadJobAssignments(env, job.id);
  const active = all.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;
  const patch = { mode: 'open', slots: active + people, apply_deadline: deadline || null };
  const locked = await lockJob(env, job, { ...patch, status: computeJobStatus({ ...job, ...patch }, all) });
  await recordEvent(env, {
    jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'job_recruit_opened', from: job.status, to: locked.status,
    payload: { people, slots: patch.slots },
  });
  // 연결된 작업자에게 앱 알림 — 응답 뒤에. 못 보내도 모집은 올라간다
  await later(
    ctx,
    recruitAudience(env, locked, all)
      .then((userIds) => notifyWorkRecruit(env, { job: locked, userIds }))
      .catch((e) => {
        console.warn('[work] 모집 알림 실패:', e && e.message);
        return 0;
      }),
  );
  return locked;
}

/**
 * 모집 내리기 — 지정 방식으로 되돌리고(정원 = 지금 배정된 사람, 적어도 1), 답을 기다리던 신청은 반려로 끝낸다.
 * @returns {Promise<{ job: object, rejected: number }>}
 */
export async function closeRecruit(env, { user, job }) {
  const all = await loadJobAssignments(env, job.id);
  const active = all.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;
  const patch = { mode: 'invite', slots: Math.max(active, 1), apply_deadline: null };
  const locked = await lockJob(env, job, { ...patch, status: computeJobStatus({ ...job, ...patch }, all) });
  await recordEvent(env, { jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'job_recruit_closed', from: job.status, to: locked.status });
  const rows =
    (await updateBy(env, 'work_applications', { job_id: `eq.${job.id}`, status: 'eq.applied' }, { status: 'rejected', decided_by: user.id, decided_at: nowIso(), decide_reason: RECRUIT_CLOSED })) || [];
  for (const a of rows) {
    await recordEvent(env, {
      jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'application_rejected', from: 'applied', to: 'rejected',
      note: RECRUIT_CLOSED, payload: { worker_id: a.worker_id, application_id: a.id },
    });
  }
  return { job: locked, rejected: rows.length };
}

/** 내 팩토리 작업의 신청 한 줄 — 없거나 남의 것이면 404. fresh 면 인사를 쓰는 팩토리여야 한다 (뽑기) */
async function loadCompanyApplication(env, user, rawId, { fresh = false } = {}) {
  const id = assertUuid(rawId, '신청 id');
  const scope = await workersCompanyOf(env, user, { manage: true, fresh });
  const gone = () => new NotFoundError('신청을 찾을 수 없습니다');
  const app = await selectOne(env, 'work_applications', { id: `eq.${id}`, select: '*' });
  if (!app) throw gone();
  const job = await selectOne(env, 'work_jobs', { id: `eq.${app.job_id}`, company_id: `eq.${scope.company.id}`, select: '*' });
  if (!job) throw gone();
  return { ...scope, app, job };
}

/** POST /company/work/applications/:id/approve — 신청한 작업자를 뽑는다 (배정 확정) */
export async function approveCompanyApplication(env, { user, params, ctx }) {
  const c = await loadCompanyApplication(env, user, params.id, { fresh: true });
  const r = await approveApplicationCore(env, { user, app: c.app, job: c.job, actorKind: 'member', linked: true, ctx });
  // 일정에서 생긴 작업이면 일정의 담당 글을 뽑힌 작업자 이름으로 맞춘다
  await syncAssigneeName(env, c.job);
  return { application: { id: r.application.id, status: r.application.status }, assignment: { id: r.assignment.id, status: r.assignment.status } };
}

/** POST /company/work/applications/:id/reject { reason? } — 신청을 반려한다 */
export async function rejectCompanyApplication(env, { user, params, body }) {
  const reason = optText(body && body.reason, 200, '사유');
  const c = await loadCompanyApplication(env, user, params.id);
  const r = await rejectApplicationCore(env, { user, app: c.app, reason, actorKind: 'member' });
  return { application: { id: r.application.id, status: r.application.status } };
}
