/**
 * 프로젝트의 작업 배정 — 프로젝트 한 화면에서 종류 줄마다 작업자를 배정한다 (마이페이지 프로젝트 › 「작업 배정」).
 * (2026-11-13 사장님 결정: 「작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결」을 한 길에서.
 *  종류는 철거 · 재단 · 엣지 · 조립 · 설치 · A/S. 승인은 작업자가 「수락」, 처음 보는 작업자만 팩토리가 한 번 승인)
 *
 *   GET   /company/projects/:id/work                 그 프로젝트의 종류 줄 · 배정 · 고를 수 있는 작업자 (구성원)
 *     { project { id, title, status }, can_manage, can_assign,
 *       rows [{ key, kind, label, source: 'project' | 'schedule', schedule_id, schedule_status, at, job { id, status } | null,
 *               sheet { doc_type, doc_label, role, packs, state: 'no_design' | 'none' | 'issued', document { id, doc_no, rev, created_at } | null,
 *                       checks { done, total, must_left } | null, pack_labels, stale, site_stale } | null (A/S),  sheet_memo,  (2026-11-17 — work/job-sheet.js)
 *               sheets [{ label(품목 이름), …sheet }] — 그 줄이 여는 설계마다 (프로젝트 줄 = 그 프로젝트에 이은 설계 모두, 일정 줄 = 그 일정의 설계).
 *                       sheet 는 그 가운데 첫 설계 (예전 화면이 읽는다). 둘째부터는 checks 가 null 이다 (2026-11-19 「한 작업에 모든 설계」)
 *       designs [{ label, order_sheets [{ kind: door_order | top_order, label, packs, pack_labels, state, stale, applies, document }] }],
 *       design_count, site { missing }
 *               can_assign, workers [{ assignment_id, name, status, label, reason, …, reports[] }], candidates [{ link_id, name, kinds, region }],
 *               recruit { on, state, slots, filled, deadline, applications [{ application_id, name, message, at }] } | null }] }
 *     줄: 철거 · 재단 · 엣지 · 조립은 종류마다 한 줄(프로젝트에 붙는 작업), 납품 · 설치 · A/S 방문은 그 프로젝트 설계의 일정마다 한 줄.
 *       차수 (2026-11-24 대표님 「추천대로 진행」 — 작업 배정 ①, DB 0084): 그 종류의 작업이 끝난 뒤 프로젝트에 새 설계(품목)가 오면
 *       같은 종류의 새 작업을 만든다 — 줄은 「재단」(끝 — 맡은 설계만, 읽기만 · key job:<id> · ended) + 「재단 2차」(새 설계 — 배정).
 *       줄마다 round(차수). 진행 중인 작업이 있으면 새 설계는 그 작업이 함께 맡는다 (지금처럼).
 *   POST  /company/projects/:id/work                 { kind, link_ids[], at? } — 철거 · 재단 · 엣지 · 조립 줄에 배정 (대표 · 실장)
 *     작업이 없으면 만들고(지정 방식 · 제목은 종류 이름뿐) 작업자마다 수락 대기로 넣는다. at = 작업 날짜 · 시각 (없어도 된다).
 *     납품 · 설치 · A/S 줄은 일정에 붙는다 → POST /company/schedules/:id/workers (work/schedule-link.js).
 *   POST  /company/projects/:id/work/recruit         { kind, people, apply_deadline?, at? } | { kind, stop: true } — 그 종류 줄의 모집 올리기 · 내리기
 *     (대표 · 실장, work/recruit.js). 일정 줄의 모집은 POST /company/schedules/:id/workers/recruit.
 *   PATCH /company/projects/:id/work/:kind           { at?, sheet_memo? } — 그 종류 줄의 날짜 · 시각 · 지시서 메모 (대표 · 실장). 작업이 없으면 빈 작업을 만든다.
 *     시각이 바뀌면 그 작업의 작업자에게 알린다. 일정 줄(납품 · 설치)의 메모는 PUT /company/work/jobs/:id/sheet-memo (work/job-sheet.js).
 *   POST  /company/projects/:id/work/invite          { kind, schedule_id?, display_name_preset?, expires_at } — 「이 일로 바로」 초대 (대표 · 실장)
 *     → { id, url, expires_at }. 초대로 온 작업자의 연결을 승인하면 그 작업에 배정 제안이 들어간다 (work/invite-job.js).
 *   확인 · 보완요청 · 빼기는 POST /company/work/assignments/:id/accept | revision | remove (work/schedule-link.js) 그대로.
 *
 * 누가       그 팩토리의 구성원이면 읽는다. 배정 · 날짜 · 초대는 대표 · 실장, 인사를 쓰는 팩토리(다담 공장 · active Agent)만.
 * 다른 업체   프로젝트 · 설계 · 일정 · 작업 · 연결을 모두 company_id 로 거른다. 남의 것은 404.
 * 고객 정보   이 응답에는 없다 (프로젝트 이름 · 작업자 이름 · 보고 글만). 작업의 제목은 종류 이름뿐이다.
 * DB 0064 · 0065 적용 전이면 409 db_pending.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { SCHEDULE_LABELS } from '../slack.js';
import { assertAssignable } from './access.js';
import { inviteWorkerCore } from './assignments.js';
import { workersCompanyOf } from './company.js';
import { recordEvent } from './events.js';
import { createInviteCore } from './invites.js';
import { computeJobStatus, loadJobAssignments, lockJob } from './jobs.js';
import { memoOf, orderSheetsOf, sheetMemoOf, sheetOf, sheetReader, writeSheetMemo } from './job-sheet.js';
import { JOB_DESIGN_MAX, designLabels, projectCover, projectDesignIds, projectJobsOfKind } from './job-links.js';
import { closeRecruit, openRecruit, recruitOf } from './recruit.js';
import { ACTIVE_STATUSES } from './reveal.js';
import {
  ASSIGN_MAX, SCHEDULE_COLS, SCHEDULE_JOB_KIND, createJobFor, kindsFor, liveJobOf, recruitFields, regionOf, syncJobWithSchedule, workerRow,
} from './schedule-link.js';
import { syncAssigneeName } from './schedule-names.js';
import { later, notifyWorkSchedule } from '../push/work-hooks.js';
import { KIND_LABEL, PROJECT_KINDS, assertUuid, kindsPending, oneOf, optIso } from './validate.js';

/** 사람을 새로 들일 수 있는 작업 상태 */
const STAFFABLE = ['draft', 'open', 'filled', 'in_progress'];
const ENDED_SCHEDULE = ['cancelled', 'completed'];
const SCHEDULE_TYPES = Object.keys(SCHEDULE_JOB_KIND);
/** 줄마다 지시서를 보이는 설계 수 — 그보다 많으면 앞의 것만 (design_count 로 알린다) */
const SHEET_DESIGN_MAX = 6;

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}

/** 0064 · 0065 전(연결 표 · 작업의 프로젝트 칸 · 새 종류 없음)이면 409 db_pending 으로 */
async function ready(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw kindsPending({ message: '42703' });
    throw kindsPending(e);
  }
}

const msOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

/** 내 팩토리의 프로젝트 한 줄 — 없거나 남의 것이면 404 */
async function loadProject(env, company, rawId) {
  const id = assertUuid(rawId, '프로젝트 id');
  const row = await selectOne(env, 'projects', { id: `eq.${id}`, company_id: `eq.${company.id}`, select: 'id,title,status' });
  if (!row) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  return row;
}

/** 그 프로젝트의 설계 id 들 · 가장 새 수주 (취소 뺌). only = 그 설계들 가운데서만 고른다 (차수 — 새 작업이 맡을 설계) */
async function linksOfProject(env, company, project, only = null) {
  const co = `eq.${company.id}`;
  const [designs, orders] = await Promise.all([
    // 먼저 만든 설계부터 — 작업자의 지시서 목록(work/job-links.js)과 같은 차례
    selectMany(env, 'designs', { project_id: `eq.${project.id}`, company_id: co, select: 'id', order: 'created_at.asc', limit: '100' }),
    selectMany(env, 'orders', { project_id: `eq.${project.id}`, company_id: co, status: 'neq.cancelled', select: 'id,design_id', order: 'created_at.desc', limit: '20' }),
  ]);
  const designIds = (designs || []).map((d) => d.id);
  const pool = Array.isArray(only) ? designIds.filter((id) => only.includes(id)) : designIds;
  const order = (orders || []).find((o) => o.design_id && pool.includes(o.design_id)) || (only ? null : (orders || [])[0] || null);
  // 작업에 잇는 설계 — 가장 새 수주의 설계, 없으면 프로젝트의 설계 하나
  const designId = order && order.design_id && pool.includes(order.design_id) ? order.design_id : pool[0] || null;
  return { designIds, orderId: order ? order.id : null, designId };
}

/**
 * 그 프로젝트 · 종류의 작업 (일정에서 생긴 작업은 아니다) — 진행 중인 작업, 없으면:
 *   끝난 작업들이 맡지 않은 설계가 있다 → null (새 작업 — 다음 차수를 만든다, DB 0084)
 *   그런 설계가 없다 → 마지막 끝난 작업 (사람을 더 받지 않는다 — 부르는 쪽이 「끝난 작업」으로 막는다)
 *   작업이 하나도 없다 → null
 */
async function projectJobOf(env, company, project, kind) {
  const [jobs, designIds] = await Promise.all([projectJobsOfKind(env, company.id, project.id, kind), projectDesignIds(env, company.id, project.id)]);
  const { rounds, live, rest } = projectCover(jobs, designIds);
  if (live) return live;
  if (!rounds.length || rest.length) return null;
  return rounds[rounds.length - 1].job;
}

/** 새 작업이 맡을 설계 — 같은 종류의 끝난 작업이 맡지 않은 설계 */
async function restOf(env, company, project, kind) {
  const [jobs, designIds] = await Promise.all([projectJobsOfKind(env, company.id, project.id, kind), projectDesignIds(env, company.id, project.id)]);
  return projectCover(jobs, designIds).rest;
}

/** 프로젝트에 붙는 작업을 만든다 — 그 사이 다른 사람이 만들었으면 그 작업을 쓴다 */
async function createProjectJob(env, { user, company, project, kind, at, slots }) {
  // 작업에 잇는 설계 · 수주 — 이 작업이 맡을 설계 가운데서 (2차부터는 끝난 작업 뒤에 온 설계)
  const { orderId, designId } = await linksOfProject(env, company, project, await restOf(env, company, project, kind));
  const row = {
    kind,
    title: KIND_LABEL[kind] || kind,
    region_label: designId ? await regionOf(env, designId) : null,
    starts_at: at || null,
    ends_at: null,
    slots,
    mode: 'invite',
    pay_visible: false,
    status: 'open',
    version: 0,
    company_id: company.id,
    project_id: project.id,
    design_id: designId,
    order_id: orderId,
    created_by: user.id,
  };
  let job;
  try {
    job = await insertOne(env, 'work_jobs', row);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    job = await projectJobOf(env, company, project, kind);
    if (!job) throw e;
    return job;
  }
  await recordEvent(env, { jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'job_created', to: 'open', payload: { project_id: project.id } });
  return job;
}

/**
 * 작업의 설계 · 수주 칸을 채운다 — 작업을 만든 뒤에 프로젝트에 설계가 붙거나 수주가 생긴 경우 (지시서 · 필수 확인은 수주로 찾는다).
 *   비어 있는 칸만 채운다 (이미 이어진 설계 · 수주는 바꾸지 않는다). 실패해도 화면은 그대로 — 원래 작업을 돌려준다.
 */
async function fillJobLinks(env, job, { designId, orderId }) {
  const patch = {};
  if (!job.design_id && designId) patch.design_id = designId;
  if (!job.order_id && orderId) patch.order_id = orderId;
  if (!Object.keys(patch).length) return job;
  try {
    return await lockJob(env, job, patch);
  } catch (e) {
    console.warn('[project-work] 작업의 설계 · 수주 채우기 실패 — 그대로 둡니다:', e && e.message);
    return job;
  }
}

/** 작업의 날짜 · 시각을 맞춘다 — 바뀌었으면 그 작업의 작업자에게 알린다 */
async function setJobTime(env, ctx, job, at) {
  if (msOf(job.starts_at) === msOf(at)) return job;
  const locked = await lockJob(env, job, { starts_at: at || null, ends_at: null });
  await recordEvent(env, { jobId: job.id, actorKind: 'system', type: 'job_updated', from: job.status, to: locked.status, payload: { fields: ['starts_at'] } });
  await later(ctx, notifyWorkSchedule(env, { before: job, after: locked }));
  return locked;
}

/** 그 프로젝트의 지금 모습 (GET · 쓰기 뒤 응답) */
async function viewOf(env, ctx, { company, canAct, holds, project }) {
  const co = `eq.${company.id}`;
  const { designIds, designId: projectDesignId, orderId: projectOrderId } = await linksOfProject(env, company, project);
  const reader = sheetReader(env);
  // 줄이 여는 설계들 — 먼저 만든 것부터 (작업자의 지시서 목록과 같은 차례 · 같은 품목 이름, work/job-links.js)
  const shown = designIds.slice(0, SHEET_DESIGN_MAX);
  const named = designIds.slice(0, JOB_DESIGN_MAX);
  const labels = named.length ? await designLabels(env, named) : [];
  const labelOf = (designId) => (named.indexOf(designId) >= 0 ? labels[named.indexOf(designId)] : null);
  const [links, projectJobs, schedules] = await Promise.all([
    selectMany(env, 'worker_companies', { company_id: co, status: 'eq.approved', select: 'id,worker_id,kinds,created_at', order: 'created_at.asc', limit: '500' }),
    selectMany(env, 'work_jobs', { project_id: `eq.${project.id}`, company_id: co, schedule_id: 'is.null', status: 'neq.cancelled', select: '*', order: 'created_at.desc', limit: '50' }),
    designIds.length
      ? selectMany(env, 'design_schedules', {
        design_id: `in.(${designIds.join(',')})`, type: `in.(${SCHEDULE_TYPES.join(',')})`, status: 'neq.cancelled',
        select: SCHEDULE_COLS, 'designs.company_id': co, order: 'scheduled_at.asc', limit: '50',
      })
      : [],
  ]);
  const workerIds = [...new Set((links || []).map((l) => l.worker_id))];
  const people = workerIds.length
    ? (await selectMany(env, 'workers', { id: `in.(${workerIds.join(',')})`, status: 'eq.approved', select: 'id,display_name,kinds,region_label' })) || []
    : [];
  const byId = new Map(people.map((w) => [w.id, w]));
  const open = project.status === 'active';
  const mayAssign = canAct && holds && open;

  /** 작업 한 건 → 줄의 배정 · 후보 */
  const rowOf = async (base, job, rowOpen) => {
    const all = job ? await loadJobAssignments(env, job.id) : [];
    const updates = job
      ? (await selectMany(env, 'work_updates', { job_id: `eq.${job.id}`, select: 'id,assignment_id,author_role,kind,body,issue_chips,created_at', order: 'created_at.asc', limit: '300' })) || []
      : [];
    const taken = new Set(all.filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.worker_id));
    const reportsOf = (assignmentId) =>
      updates
        .filter((u) => u.assignment_id === assignmentId)
        .map((u) => ({ kind: u.kind, by: u.author_role, body: u.body, issue_chips: Array.isArray(u.issue_chips) ? u.issue_chips : [], at: u.created_at || null }));
    const active = (a) => (ACTIVE_STATUSES.includes(a.status) ? 0 : 1);
    // 지시서 — 프로젝트 줄은 그 프로젝트에 이은 설계마다, 일정 줄은 그 일정의 설계. 첫 설계는 필수 확인 수까지. A/S 는 null
    // 프로젝트 줄은 그 작업이 맡는 설계 (차수 — 끝난 작업은 맡았던 설계, 진행 중 · 새 작업은 그 뒤 설계)
    const sheetDesigns = base.source === 'project' ? (base.designs || shown).slice(0, SHEET_DESIGN_MAX) : base.design_id ? [base.design_id] : [];
    const firstId = sheetDesigns[0] || null;
    const first = await sheetOf(reader, { kind: base.kind, designId: firstId });
    const sheets = first === null
      ? null
      : [
        ...(firstId ? [{ label: labelOf(firstId), ...first }] : []),
        ...(await Promise.all(sheetDesigns.slice(1).map(async (d) => ({ label: labelOf(d), ...(await sheetOf(reader, { kind: base.kind, designId: d, checks: false })) })))),
      ];
    return {
      ...base,
      job: job ? { id: job.id, status: job.status } : null,
      sheet: first,
      sheets,
      sheet_memo: sheetMemoOf(job),
      can_assign: mayAssign && rowOpen && (!job || STAFFABLE.includes(job.status)),
      recruit: await recruitOf(env, job, all),
      workers: all.slice().sort((a, b) => active(a) - active(b)).map((a) => workerRow(a, reportsOf(a.id))),
      candidates: (links || [])
        .filter((l) => byId.has(l.worker_id) && !taken.has(l.worker_id) && kindsFor(l, byId.get(l.worker_id)).includes(base.kind))
        .map((l) => {
          const w = byId.get(l.worker_id);
          return { link_id: l.id, name: w.display_name, kinds: kindsFor(l, w), region: w.region_label || null };
        }),
    };
  };

  const rows = [];
  for (const kind of PROJECT_KINDS) {
    const { rounds, live, rest } = projectCover((projectJobs || []).filter((j) => j.kind === kind), designIds);
    // 끝난 작업만 있고 그 뒤 온 설계가 있으면 새 줄(다음 차수)
    const next = !live && (!rounds.length || rest.length) ? rounds.length + 1 : 0;
    const many = rounds.length + (next ? 1 : 0) > 1;
    const labelAt = (round) => (many && round > 1 ? `${KIND_LABEL[kind]} ${round}차` : KIND_LABEL[kind]);
    const base = (round, extra) => ({ kind, label: labelAt(round), round, source: 'project', schedule_id: null, schedule_status: null, ...extra });
    for (const r of rounds) {
      if (!r.ended) continue;
      // 끝난 작업 — 맡았던 설계만, 읽기만 (사람 · 날짜 · 메모를 바꾸지 않는다)
      rows.push(await rowOf(base(r.round, { key: `job:${r.job.id}`, ended: true, at: r.job.starts_at || null, design_id: r.cover[0] || null, designs: r.cover }), r.job, false));
    }
    if (live) {
      const round = rounds.find((r) => r.job.id === live.id).round;
      const links = await linksOfProject(env, company, project, rest);
      const job = await fillJobLinks(env, live, { designId: links.designId || projectDesignId, orderId: links.orderId || projectOrderId });
      rows.push(await rowOf(base(round, { key: `kind:${kind}`, at: job.starts_at || null, design_id: rest[0] || projectDesignId, designs: rest }), job, true));
    } else if (next) {
      rows.push(await rowOf(base(next, { key: `kind:${kind}`, at: null, design_id: rest[0] || projectDesignId, designs: rest }), null, true));
    }
  }
  for (const s of schedules || []) {
    const kind = SCHEDULE_JOB_KIND[s.type];
    let job = await liveJobOf(env, s.id, company.id);
    if (job) job = (await syncJobWithSchedule(env, ctx, s)) || job;
    if (job && job.status === 'cancelled') job = null;
    rows.push(await rowOf(
      { key: `schedule:${s.id}`, kind, label: SCHEDULE_LABELS[s.type] || KIND_LABEL[kind], source: 'schedule', schedule_id: s.id, schedule_status: s.status, at: s.scheduled_at, design_id: s.design_id },
      job,
      !ENDED_SCHEDULE.includes(s.status),
    ));
  }
  // 설계마다 발주 줄 (도어재 · 상판 — 작업자 없이 사무실이 연다)
  const designs = [];
  for (let i = 0; i < shown.length; i++) designs.push({ label: labels[i], order_sheets: await orderSheetsOf(reader, { designId: shown[i] }) });
  const site = projectDesignId ? await reader.siteOf(projectDesignId) : null;
  return {
    project: { id: project.id, title: project.title || null, status: project.status },
    can_manage: canAct,
    can_assign: mayAssign,
    // 줄의 design_id 는 지시서를 찾는 데만 쓴다 — 응답에는 싣지 않는다
    rows: rows.map(({ design_id, designs: _designs, ...row }) => row),
    designs,
    design_count: designIds.length,
    site: { missing: !!projectDesignId && !(site && site.info && typeof site.info.address === 'string' && site.info.address.trim()) },
  };
}

/** GET /company/projects/:id/work */
export async function listProjectWork(env, { user, params, ctx }) {
  const { company, canAct, holds } = await workersCompanyOf(env, user);
  const project = await loadProject(env, company, params.id);
  return ready(() => viewOf(env, ctx, { company, canAct, holds, project }));
}

/** 본문의 link_ids — 1 ~ ASSIGN_MAX 개, 중복 없이 */
function linkIdsOf(body) {
  const raw = body && body.link_ids;
  if (!Array.isArray(raw) || !raw.length) throw new ValidationError('배정할 작업자를 골라 주세요', { field: 'link_ids' });
  if (raw.length > ASSIGN_MAX) throw new ValidationError(`한 번에 ${ASSIGN_MAX}명까지 배정할 수 있습니다`, { field: 'link_ids' });
  return [...new Set(raw.map((v) => assertUuid(v, '연결 id')))];
}

/** 쓰기의 앞부분 — 대표 · 실장 · 인사를 쓰는 팩토리 · 진행 중 프로젝트 */
async function manageScope(env, user, rawProjectId) {
  const scope = await workersCompanyOf(env, user, { manage: true, fresh: true });
  const project = await loadProject(env, scope.company, rawProjectId);
  if (project.status === 'on_hold')
    throw conflict('보류 중인 프로젝트에는 배정할 수 없습니다 — 다시 진행한 뒤 배정해 주세요', 'closed');
  if (project.status !== 'active') throw conflict('끝났거나 넘긴 프로젝트에는 배정할 수 없습니다', 'closed');
  return { ...scope, project };
}

/** POST /company/projects/:id/work */
export async function assignProjectWork(env, { user, params, body, ctx }) {
  const b = body || {};
  const kind = oneOf(b.kind, PROJECT_KINDS, 'kind');
  const linkIds = linkIdsOf(b);
  const at = b.at === undefined ? undefined : optIso(b.at, '날짜');
  const { company, canAct, holds, project } = await manageScope(env, user, params.id);

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

    let job = await projectJobOf(env, company, project, kind);
    if (!job) job = await createProjectJob(env, { user, company, project, kind, at: at || null, slots: picked.length });
    else if (at !== undefined) job = await setJobTime(env, ctx, job, at);
    const all = await loadJobAssignments(env, job.id);
    const taken = new Set(all.filter((a) => ACTIVE_STATUSES.includes(a.status)).map((a) => a.worker_id));
    const fresh = picked.filter((w) => !taken.has(w.id));
    if (!fresh.length) throw new ConflictError('이미 배정된 작업자입니다');
    const need = taken.size + fresh.length;
    if (job.slots < need) job = await lockJob(env, job, { slots: need, status: computeJobStatus({ ...job, slots: need }, all) });
    for (const w of fresh) await inviteWorkerCore(env, { user, job, worker: w, actorKind: 'member', ctx });
    return viewOf(env, ctx, { company, canAct, holds, project });
  });
}

/** POST /company/projects/:id/work/recruit — 그 종류 줄의 모집 올리기 · 내리기 (철거 · 재단 · 엣지 · 조립) */
export async function recruitProjectWork(env, { user, params, body, ctx }) {
  const b = body || {};
  const kind = oneOf(b.kind, PROJECT_KINDS, 'kind');
  const f = recruitFields(b);
  const at = b.at === undefined ? undefined : optIso(b.at, '날짜');
  if (f.stop) {
    // 내리기는 끝난 프로젝트 · 등급이 내려간 팩토리도 한다 (정리)
    const scope = await workersCompanyOf(env, user, { manage: true });
    const project = await loadProject(env, scope.company, params.id);
    return ready(async () => {
      const job = await projectJobOf(env, scope.company, project, kind);
      if (job && job.mode === 'open') await closeRecruit(env, { user, job });
      return viewOf(env, ctx, { ...scope, project });
    });
  }
  const { company, canAct, holds, project } = await manageScope(env, user, params.id);
  return ready(async () => {
    let job = await projectJobOf(env, company, project, kind);
    if (!job) job = await createProjectJob(env, { user, company, project, kind, at: at || null, slots: f.people });
    else if (at !== undefined) job = await setJobTime(env, ctx, job, at);
    if (!STAFFABLE.includes(job.status)) throw conflict('끝난 작업에는 모집할 수 없습니다', 'closed');
    await openRecruit(env, { user, job, people: f.people, deadline: f.deadline, ctx });
    return viewOf(env, ctx, { company, canAct, holds, project });
  });
}

/** PATCH /company/projects/:id/work/:kind */
export async function patchProjectWork(env, { user, params, body, ctx }) {
  const kind = oneOf(params.kind, PROJECT_KINDS, 'kind');
  const b = body || {};
  const hasAt = b.at !== undefined;
  const hasMemo = Object.prototype.hasOwnProperty.call(b, 'sheet_memo');
  if (!hasAt && !hasMemo) throw new ValidationError('바꿀 칸이 없습니다');
  const at = hasAt ? optIso(b.at, '날짜') : null;
  const memo = hasMemo ? memoOf(b.sheet_memo) : null;
  const { company, canAct, holds, project } = await manageScope(env, user, params.id);
  return ready(async () => {
    let job = await projectJobOf(env, company, project, kind);
    if (job) {
      if (!STAFFABLE.includes(job.status)) throw conflict(hasAt ? '끝난 작업의 날짜는 바꿀 수 없습니다' : '끝난 작업의 메모는 바꿀 수 없습니다', 'closed');
      if (hasAt) job = await setJobTime(env, ctx, job, at);
    } else if ((hasAt && at) || (hasMemo && memo)) {
      // 날짜 · 메모부터 정해 둔다 — 작업자는 나중에 배정
      job = await createProjectJob(env, { user, company, project, kind, at: hasAt ? at : null, slots: 1 });
    }
    // 지시서 메모 — 철거 · 재단 · 엣지 · 조립 줄 (0068 전이면 409 db_pending)
    if (hasMemo && job) await writeSheetMemo(env, { user, job, memo });
    return viewOf(env, ctx, { company, canAct, holds, project });
  });
}

/** POST /company/projects/:id/work/invite — 「이 일로 바로」 초대 */
export async function inviteProjectWork(env, { user, params, body }) {
  const b = body || {};
  const kind = oneOf(b.kind, [...PROJECT_KINDS, ...Object.values(SCHEDULE_JOB_KIND)], 'kind');
  const { company, project } = await manageScope(env, user, params.id);
  return ready(async () => {
    let job;
    if (PROJECT_KINDS.includes(kind)) {
      job = (await projectJobOf(env, company, project, kind)) || (await createProjectJob(env, { user, company, project, kind, at: null, slots: 1 }));
    } else {
      // 설치 · A/S — 그 프로젝트 설계의 일정에 붙는다
      const scheduleId = assertUuid(b.schedule_id, '일정 id');
      const { designIds } = await linksOfProject(env, company, project);
      const schedule = await selectOne(env, 'design_schedules', { id: `eq.${scheduleId}`, select: SCHEDULE_COLS, 'designs.company_id': `eq.${company.id}` });
      if (!schedule || !designIds.includes(schedule.design_id) || SCHEDULE_JOB_KIND[schedule.type] !== kind) throw new NotFoundError('일정을 찾을 수 없습니다');
      if (ENDED_SCHEDULE.includes(schedule.status)) throw conflict('취소했거나 끝난 일정에는 배정할 수 없습니다', 'closed');
      job = (await liveJobOf(env, schedule.id, company.id)) || (await createJobFor(env, { user, company, schedule, kind, slots: 1 }));
      await syncAssigneeName(env, job);
    }
    if (!STAFFABLE.includes(job.status)) throw conflict('끝난 작업에는 사람을 더 넣을 수 없습니다', 'closed');
    // 초대는 그 종류로 — 신청서의 종류가 미리 골라진다. 링크는 이 응답에서만 보인다
    return createInviteCore(env, {
      user,
      body: { kinds_preset: [kind], display_name_preset: b.display_name_preset, expires_at: b.expires_at },
      companyId: company.id,
      jobId: job.id,
    });
  });
}
