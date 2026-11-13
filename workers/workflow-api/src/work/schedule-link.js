/**
 * 일정 ↔ 작업 잇기 — 설치 · A/S 방문 일정 줄에서 작업자를 배정한다 (마이페이지 프로젝트 관리 › 설치 · A/S).
 * (2026-11-13 사장님 결정 「작업자 한 길」 ③ 배정은 설치 · A/S 일정 줄에서 ⑥ 배정 → 수락 대기 → 작업자가 수락해야 확정)
 *
 *   GET  /company/schedules/:id/workers                   그 일정의 작업 · 배정 상태 · 고를 수 있는 작업자 (구성원)
 *     { schedule { id, type, label, at, status }, kind, can_manage, can_assign, job { id, status } | null,
 *       workers [{ assignment_id, name, status, label, reason, started_at, submitted_at, accepted_at, revision_count,
 *                  reports [{ kind, by, body, issue_chips, at }] }],
 *       candidates [{ link_id, name, kinds, region }] }
 *   POST /company/schedules/:id/workers { link_ids[] }    배정 (대표 · 실장) — 작업이 없으면 만들고 작업자마다 수락 대기로 넣는다
 *   POST /company/work/assignments/:id/accept             완료 보고 확인 (대표 · 실장)
 *   POST /company/work/assignments/:id/revision { reason } 보완요청 (대표 · 실장)
 *   POST /company/work/assignments/:id/remove { reason, no_show? }  빼기 (대표 · 실장)
 *
 * 일정 하나에 살아 있는 작업 하나 (DB 0064 uq_work_jobs_schedule_live). 작업은 종류 = 설치 / A/S, 시각 = 일정,
 * 방식 = 지정(invite — 모집 목록에 뜨지 않는다), 제목 = 일정 종류 이름만 (설계 이름 · 고객 이름을 싣지 않는다).
 * 작업자를 가리키는 값은 연결 id(link_id) — 작업자 id 는 팩토리에 내보내지 않는다.
 *
 * 누가       그 팩토리의 구성원이면 읽는다. 배정 · 확인 · 보완요청 · 빼기는 대표 · 실장.
 *            새 배정은 「인사를 쓰는 팩토리」(다담 공장 · active Agent)만 — 확인 · 보완요청 · 빼기는 등급이 내려가도 된다.
 * 다른 업체   일정은 designs!inner(company_id) 로, 작업 · 연결은 company_id 로 거른다. 남의 것은 404.
 * 일정 동기   일정 시각이 바뀌면 작업 시각을 맞추고 작업자에게 알린다. 일정이 취소되면 작업도 취소한다 (syncJobWithSchedule —
 *            schedules.js updateSchedule · company-sites.js setAsVisit 가 부른다). 실패해도 일정 저장을 막지 않고, 다음 읽기에서 다시 맞춘다.
 * 고객 정보   이 응답에는 없다 (작업자 이름 · 보고 글만). DB 0064 적용 전이면 409 db_pending.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { SCHEDULE_LABELS } from '../slack.js';
import { assertAssignable } from './access.js';
import {
  acceptAssignmentCore, inviteWorkerCore, loadAssignmentAdmin, removeAssignmentCore, requestRevisionCore,
} from './assignments.js';
import { workersCompanyOf } from './company.js';
import { recordEvent } from './events.js';
import { computeJobStatus, declineOffersIfEnded, loadJobAssignments, lockJob } from './jobs.js';
import { linksPending } from './links.js';
import { ACTIVE_STATUSES } from './reveal.js';
import { syncAssigneeName } from './schedule-names.js';
import { later, notifyWorkSchedule } from '../push/work-hooks.js';
import { assertUuid, optBool, reqText } from './validate.js';

/** 작업자를 배정할 수 있는 일정 종류 → 작업 종류 (납품 줄은 2차) */
export const SCHEDULE_JOB_KIND = Object.freeze({ installation: 'install', as_visit: 'as' });
/** 한 번에 배정하는 사람 수 */
export const ASSIGN_MAX = 10;
/** 팩토리 화면의 배정 상태 이름 */
export const ASSIGNMENT_LABEL = Object.freeze({
  offered: '수락 대기', confirmed: '확정', started: '작업 중', submitted: '완료 보고', revision: '보완 요청',
  accepted: '확인함', declined: '거절', released: '포기', removed: '뺌',
});
/** 일정이 취소돼 작업을 닫을 때 남기는 사유 */
export const SCHEDULE_CANCELLED = '일정이 취소되었습니다';

export const SCHEDULE_COLS = 'id,type,status,scheduled_at,duration_min,assignee_name,design_id,designs!inner(company_id)';
const ENDED_SCHEDULE = ['cancelled', 'completed'];
const FINISHED_JOB = ['done', 'closed', 'cancelled'];
const REASON_STATUSES = ['declined', 'released'];

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}

/** 0064 전(작업의 일정 칸 · 연결 표 없음)이면 409 db_pending 으로 */
async function ready(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw linksPending();
    throw e;
  }
}

const msOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

/** 일정 → 작업의 시작 · 끝 시각 (걸리는 시간이 없으면 끝은 비운다) */
export function jobTimesOf(schedule) {
  const start = msOf(schedule && schedule.scheduled_at);
  if (start === null) return { starts_at: null, ends_at: null };
  const min = Number(schedule.duration_min);
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: min > 0 ? new Date(start + Math.round(min) * 60000).toISOString() : null,
  };
}

/** 내 팩토리의 일정 한 줄 — 없거나 남의 것이면 404 */
async function loadSchedule(env, company, rawId) {
  const id = assertUuid(rawId, '일정 id');
  const row = await selectOne(env, 'design_schedules', {
    id: `eq.${id}`,
    select: SCHEDULE_COLS,
    'designs.company_id': `eq.${company.id}`,
  });
  if (!row) throw new NotFoundError('일정을 찾을 수 없습니다');
  return row;
}

/** 그 일정의 살아 있는 작업 (없으면 null) */
export async function liveJobOf(env, scheduleId, companyId) {
  const q = { schedule_id: `eq.${scheduleId}`, status: 'neq.cancelled', select: '*', order: 'created_at.desc' };
  if (companyId) q.company_id = `eq.${companyId}`;
  return (await selectOne(env, 'work_jobs', q)) || null;
}

/** 이 팩토리가 그 작업자에게 맡기는 종류 — 연결에 적은 것, 없으면 작업자가 적은 것 */
export const kindsFor = (link, worker) => (link.kinds && link.kinds.length ? link.kinds : (worker && worker.kinds) || []);

/** 현장의 시 · 구 (좌표를 바꾼 그때의 주소가 지금 주소와 같을 때만 — company-sites.js siteOf 와 같은 판정). 없으면 null */
export async function regionOf(env, designId) {
  try {
    const s = await selectOne(env, 'design_site_info', { design_id: `eq.${designId}`, select: 'address,sido,gugun,geo_address' });
    if (!s || !s.address || s.geo_address !== s.address) return null;
    return [s.sido, s.gugun].filter(Boolean).join(' ').slice(0, 40) || null;
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 그 일정의 수주 — A/S 방문은 접수의 수주, 그 밖은 설계의 가장 새 수주 (취소 뺌). 없으면 null */
async function orderIdOf(env, company, schedule) {
  const co = `eq.${company.id}`;
  try {
    if (schedule.type === 'as_visit') {
      const req = await selectOne(env, 'as_requests', { visit_schedule_id: `eq.${schedule.id}`, company_id: co, select: 'order_id' });
      if (req && req.order_id) return req.order_id;
    }
    const order = await selectOne(env, 'orders', {
      design_id: `eq.${schedule.design_id}`, company_id: co, status: 'neq.cancelled', select: 'id', order: 'created_at.desc',
    });
    return order ? order.id : null;
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 일정에서 작업을 만든다 — 그 사이 다른 사람이 만들었으면 그 작업을 쓴다 */
export async function createJobFor(env, { user, company, schedule, kind, slots }) {
  const [region, orderId] = await Promise.all([regionOf(env, schedule.design_id), orderIdOf(env, company, schedule)]);
  const row = {
    kind,
    title: SCHEDULE_LABELS[schedule.type] || kind,
    region_label: region,
    ...jobTimesOf(schedule),
    slots,
    mode: 'invite',
    pay_visible: false,
    status: 'open',
    version: 0,
    company_id: company.id,
    design_id: schedule.design_id,
    order_id: orderId,
    schedule_id: schedule.id,
    created_by: user.id,
  };
  let job;
  try {
    job = await insertOne(env, 'work_jobs', row);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    job = await liveJobOf(env, schedule.id, company.id);
    if (!job) throw e;
    return job;
  }
  await recordEvent(env, { jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'job_created', to: 'open', payload: { schedule_id: schedule.id } });
  return job;
}

/**
 * 일정 시각 · 취소를 그 일정의 작업에 맞춘다. 맞출 것이 없으면 null, 바꿨으면 바뀐 작업.
 * 원래 일을 막지 않는다 — 던지지 않는다 (0064 전이면 조용히 지나간다).
 * @param {object} schedule design_schedules 한 줄 (id · type · status · scheduled_at · duration_min)
 */
export async function syncJobWithSchedule(env, ctx, schedule) {
  try {
    if (!schedule || !SCHEDULE_JOB_KIND[schedule.type]) return null;
    const job = await liveJobOf(env, schedule.id, null);
    if (!job || FINISHED_JOB.includes(job.status)) return null;
    if (schedule.status === 'cancelled') {
      const locked = await lockJob(env, job, { status: 'cancelled', cancel_reason: SCHEDULE_CANCELLED });
      await recordEvent(env, { jobId: job.id, actorKind: 'system', type: 'job_cancelled', from: job.status, to: 'cancelled', note: SCHEDULE_CANCELLED });
      // 답 없는 초대는 끝낸다 (확정 · 진행 중 배정은 그대로 — 관리자 취소와 같다)
      await declineOffersIfEnded(env, job.id);
      return locked;
    }
    const times = jobTimesOf(schedule);
    if (msOf(job.starts_at) === msOf(times.starts_at) && msOf(job.ends_at) === msOf(times.ends_at)) return null;
    const locked = await lockJob(env, job, times);
    await recordEvent(env, { jobId: job.id, actorKind: 'system', type: 'job_updated', from: job.status, to: locked.status, payload: { fields: ['starts_at', 'ends_at'], schedule_id: schedule.id } });
    // 그 작업의 작업자(수락 대기 · 확정 · 작업 중)에게 앱 알림 — 응답 뒤에
    await later(ctx, notifyWorkSchedule(env, { before: job, after: locked }));
    return locked;
  } catch (e) {
    if (!isMissingRelation(e)) console.warn('[work] 일정 → 작업 맞추기 실패:', e && e.message);
    return null;
  }
}

/**
 * 일정의 담당 글을 손으로 고쳤을 때 — 그 일정에 배정된 작업자가 있으면 작업자 이름으로 되돌린다.
 * 배정된 사람이 없으면(작업이 없거나 모두 거절 · 뺌) 손으로 적은 글을 그대로 둔다 → undefined.
 */
export async function keepAssigneeName(env, schedule) {
  try {
    if (!schedule || !SCHEDULE_JOB_KIND[schedule.type]) return undefined;
    const job = await liveJobOf(env, schedule.id, null);
    if (!job) return undefined;
    const all = await loadJobAssignments(env, job.id);
    if (!all.some((a) => ACTIVE_STATUSES.includes(a.status))) return undefined;
    return await syncAssigneeName(env, job);
  } catch (e) {
    if (!isMissingRelation(e)) console.warn('[work] 일정 담당 글 지키기 실패:', e && e.message);
    return undefined;
  }
}

/**
 * 일정들의 배정된 작업자 — 설치 · A/S 표에 싣는다 (company-sites.js). Map(일정 id → [{ name, status, label }]).
 * 활성 배정만 (수락 대기 ~ 확인함). 0064 전이면 빈 Map.
 */
export async function workersOfSchedules(env, companyId, scheduleIds) {
  const out = new Map();
  const ids = [...new Set((scheduleIds || []).filter(Boolean))];
  if (!ids.length) return out;
  try {
    const jobs = [];
    for (let i = 0; i < ids.length; i += 100) {
      jobs.push(...((await selectMany(env, 'work_jobs', {
        schedule_id: `in.(${ids.slice(i, i + 100).join(',')})`, company_id: `eq.${companyId}`, status: 'neq.cancelled', select: 'id,schedule_id',
      })) || []));
    }
    if (!jobs.length) return out;
    const scheduleOf = new Map(jobs.map((j) => [j.id, j.schedule_id]));
    const jobIds = [...scheduleOf.keys()];
    for (let i = 0; i < jobIds.length; i += 100) {
      const rows = (await selectMany(env, 'work_assignments', {
        job_id: `in.(${jobIds.slice(i, i + 100).join(',')})`, status: `in.(${ACTIVE_STATUSES.join(',')})`,
        select: 'job_id,status,worker_name_snapshot,created_at', order: 'created_at.asc', limit: '1000',
      })) || [];
      for (const a of rows) {
        const sid = scheduleOf.get(a.job_id);
        if (!out.has(sid)) out.set(sid, []);
        out.get(sid).push({ name: a.worker_name_snapshot || null, status: a.status, label: ASSIGNMENT_LABEL[a.status] || a.status });
      }
    }
    return out;
  } catch (e) {
    if (isMissingRelation(e)) return new Map();
    throw e;
  }
}

/** 배정 한 줄 → 팩토리 화면 줄 (작업자 id 는 싣지 않는다) */
export function workerRow(a, reports) {
  return {
    assignment_id: a.id,
    name: a.worker_name_snapshot || null,
    status: a.status,
    label: ASSIGNMENT_LABEL[a.status] || a.status,
    reason: REASON_STATUSES.includes(a.status) ? a.release_reason || null : null,
    started_at: a.started_at || null,
    submitted_at: a.submitted_at || null,
    accepted_at: a.accepted_at || null,
    revision_count: Number(a.revision_count) || 0,
    reports,
  };
}

/** 그 일정의 지금 모습 (GET · 쓰기 뒤 응답) */
async function viewOf(env, ctx, { company, canAct, holds, schedule }) {
  const kind = SCHEDULE_JOB_KIND[schedule.type] || null;
  const co = `eq.${company.id}`;
  let job = kind ? await liveJobOf(env, schedule.id, company.id) : null;
  // 앞선 동기가 실패했으면 여기서 다시 맞춘다 (시각 · 취소)
  if (job) job = (await syncJobWithSchedule(env, ctx, schedule)) || job;
  if (job && job.status === 'cancelled') job = null;
  const all = job ? await loadJobAssignments(env, job.id) : [];
  const [links, updates] = await Promise.all([
    kind
      ? selectMany(env, 'worker_companies', { company_id: co, status: 'eq.approved', select: 'id,worker_id,kinds,created_at', order: 'created_at.asc', limit: '500' })
      : [],
    job
      ? selectMany(env, 'work_updates', { job_id: `eq.${job.id}`, select: 'id,assignment_id,author_role,kind,body,issue_chips,created_at', order: 'created_at.asc', limit: '300' })
      : [],
  ]);
  const ids = [...new Set((links || []).map((l) => l.worker_id))];
  const people = ids.length
    ? (await selectMany(env, 'workers', { id: `in.(${ids.join(',')})`, status: 'eq.approved', select: 'id,display_name,kinds,region_label' })) || []
    : [];
  const byId = new Map(people.map((w) => [w.id, w]));
  const taken = new Set(all.filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.worker_id));
  const reportsOf = (assignmentId) =>
    (updates || [])
      .filter((u) => u.assignment_id === assignmentId)
      .map((u) => ({ kind: u.kind, by: u.author_role, body: u.body, issue_chips: Array.isArray(u.issue_chips) ? u.issue_chips : [], at: u.created_at || null }));
  const active = (a) => (ACTIVE_STATUSES.includes(a.status) ? 0 : 1);
  const open = !ENDED_SCHEDULE.includes(schedule.status);

  return {
    schedule: { id: schedule.id, type: schedule.type, label: SCHEDULE_LABELS[schedule.type] || schedule.type, at: schedule.scheduled_at, status: schedule.status },
    kind,
    can_manage: canAct,
    can_assign: canAct && holds && !!kind && open && (!job || !['review', ...FINISHED_JOB].includes(job.status)),
    job: job ? { id: job.id, status: job.status } : null,
    workers: all.slice().sort((a, b) => active(a) - active(b)).map((a) => workerRow(a, reportsOf(a.id))),
    candidates: (links || [])
      .filter((l) => byId.has(l.worker_id) && !taken.has(l.worker_id) && kindsFor(l, byId.get(l.worker_id)).includes(kind))
      .map((l) => {
        const w = byId.get(l.worker_id);
        return { link_id: l.id, name: w.display_name, kinds: kindsFor(l, w), region: w.region_label || null };
      }),
  };
}

/** GET /company/schedules/:id/workers */
export async function listScheduleWorkers(env, { user, params, ctx }) {
  const { company, canAct, holds } = await workersCompanyOf(env, user);
  const schedule = await loadSchedule(env, company, params.id);
  return ready(() => viewOf(env, ctx, { company, canAct, holds, schedule }));
}

/** 본문의 link_ids — 1 ~ ASSIGN_MAX 개, 중복 없이 */
function linkIdsOf(body) {
  const raw = body && body.link_ids;
  if (!Array.isArray(raw) || !raw.length) throw new ValidationError('배정할 작업자를 골라 주세요', { field: 'link_ids' });
  if (raw.length > ASSIGN_MAX) throw new ValidationError(`한 번에 ${ASSIGN_MAX}명까지 배정할 수 있습니다`, { field: 'link_ids' });
  return [...new Set(raw.map((v) => assertUuid(v, '연결 id')))];
}

/** POST /company/schedules/:id/workers */
export async function assignScheduleWorkers(env, { user, params, body, ctx }) {
  const linkIds = linkIdsOf(body);
  const { company, canAct, holds } = await workersCompanyOf(env, user, { manage: true, fresh: true });
  const schedule = await loadSchedule(env, company, params.id);
  const kind = SCHEDULE_JOB_KIND[schedule.type];
  if (!kind) throw conflict('설치 · A/S 방문 일정에만 작업자를 배정할 수 있습니다', 'not_assignable');
  if (ENDED_SCHEDULE.includes(schedule.status)) throw conflict('취소했거나 끝난 일정에는 배정할 수 없습니다', 'closed');

  return ready(async () => {
    const links = (await selectMany(env, 'worker_companies', { id: `in.(${linkIds.join(',')})`, company_id: `eq.${company.id}`, select: 'id,worker_id,status,kinds' })) || [];
    if (links.length !== linkIds.length) throw new NotFoundError('연결을 찾을 수 없습니다');
    if (links.some((l) => l.status !== 'approved')) throw conflict('연결이 승인된 작업자만 배정할 수 있습니다', 'not_linked');
    const people = (await selectMany(env, 'workers', { id: `in.(${links.map((l) => l.worker_id).join(',')})`, select: 'id,status,kinds,display_name' })) || [];
    const byId = new Map(people.map((w) => [w.id, w]));
    const picked = links.map((l) => {
      const w = byId.get(l.worker_id);
      if (!w) throw new NotFoundError('작업자를 찾을 수 없습니다');
      assertAssignable(w);
      if (!kindsFor(l, w).includes(kind)) throw new ConflictError('작업 종류가 맞지 않는 작업자입니다');
      return w;
    });

    let job = await liveJobOf(env, schedule.id, company.id);
    if (job) job = (await syncJobWithSchedule(env, ctx, schedule)) || job;
    if (!job) job = await createJobFor(env, { user, company, schedule, kind, slots: picked.length });
    const all = await loadJobAssignments(env, job.id);
    const taken = new Set(all.filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.worker_id));
    const fresh = picked.filter((w) => !taken.has(w.id));
    if (!fresh.length) throw new ConflictError('이미 배정된 작업자입니다');
    // 정원 = 지금 배정(수락 대기 포함) + 새로 넣는 사람 — 모자라면 늘린다 (수락할 때 「정원이 찼습니다」가 나지 않게)
    const need = taken.size + fresh.length;
    if (job.slots < need) job = await lockJob(env, job, { slots: need, status: computeJobStatus({ ...job, slots: need }, all) });
    for (const w of fresh) await inviteWorkerCore(env, { user, job, worker: w, actorKind: 'member', ctx });
    await syncAssigneeName(env, job);
    return viewOf(env, ctx, { company, canAct, holds, schedule });
  });
}

/** 내 팩토리 작업의 배정 한 줄 — 없거나 남의 것이면 404 */
async function loadCompanyAssignment(env, user, rawId) {
  const scope = await workersCompanyOf(env, user, { manage: true });
  const found = await ready(() => loadAssignmentAdmin(env, rawId));
  if (found.job.company_id !== scope.company.id) throw new NotFoundError('배정을 찾을 수 없습니다');
  return { ...scope, ...found };
}

/** 바꾼 뒤 응답 — 일정에서 생긴 작업이면 그 일정의 지금 모습, 아니면 배정 한 줄 */
async function afterChange(env, ctx, { company, canAct, holds, job, assignment }) {
  const out = { assignment: { id: assignment.id, status: assignment.status, label: ASSIGNMENT_LABEL[assignment.status] || assignment.status } };
  if (!job.schedule_id) return out;
  const schedule = await selectOne(env, 'design_schedules', { id: `eq.${job.schedule_id}`, select: SCHEDULE_COLS, 'designs.company_id': `eq.${company.id}` });
  if (!schedule) return out;
  return { ...out, ...(await viewOf(env, ctx, { company, canAct, holds, schedule })) };
}

/** POST /company/work/assignments/:id/accept — 완료 보고 확인 (submitted → accepted) */
export async function acceptCompanyAssignment(env, { user, params, ctx }) {
  const c = await loadCompanyAssignment(env, user, params.id);
  const assignment = await acceptAssignmentCore(env, { user, assignment: c.assignment, job: c.job, all: c.all, actorKind: 'member' });
  return afterChange(env, ctx, { ...c, assignment });
}

/** POST /company/work/assignments/:id/revision { reason } — 보완요청 (submitted → revision) */
export async function reviseCompanyAssignment(env, { user, params, body, ctx }) {
  const reason = reqText(body && body.reason, 200, '보완 요청 사유');
  const c = await loadCompanyAssignment(env, user, params.id);
  const assignment = await requestRevisionCore(env, { user, assignment: c.assignment, job: c.job, all: c.all, reason, actorKind: 'member' });
  return afterChange(env, ctx, { ...c, assignment });
}

/** POST /company/work/assignments/:id/remove { reason, no_show? } — 빼기 */
export async function removeCompanyAssignment(env, { user, params, body, ctx }) {
  const reason = reqText(body && body.reason, 200, '빼는 사유');
  const noShow = optBool(body && body.no_show, false, 'no_show');
  const c = await loadCompanyAssignment(env, user, params.id);
  const assignment = await removeAssignmentCore(env, { user, assignment: c.assignment, job: c.job, all: c.all, reason, noShow, actorKind: 'member' });
  await syncAssigneeName(env, c.job);
  return afterChange(env, ctx, { ...c, assignment });
}
