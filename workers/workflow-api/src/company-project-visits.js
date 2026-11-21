/**
 * 프로젝트 방문 일정 — 실측 (2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 2차).
 * 대표님: 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」 — 실측은 상담 다음 · 설계 앞 단계다.
 * 일정 표(design_schedules)는 설계에 붙어 있어 설계 전에는 넣을 수 없다 → 프로젝트에 붙는 표 project_visits(DB 0079)를 쓴다.
 *
 *   PUT   /company/projects/:id/visit  { scheduled_at, assignee_id?, assignee_name?, note? }
 *         예정인 실측이 없으면 새로 잡고, 있으면 그 줄을 고친다 (날짜 · 갈 사람 · 메모)
 *   PATCH /company/projects/:id/visit  { status: 'done' | 'cancelled' }
 *         예정인 실측을 끝내거나 취소한다 (끝난 뒤에는 다시 잡을 수 있다 — 재실측)
 *     → { project_id, visit: { id, status, scheduled_at, assignee_id, assignee_name, note, done_at } | null }
 *
 * 누가: 그 업체의 대표 · 실장, 그리고 그 프로젝트의 담당자 (보류 · 그만둠과 같다 — company-project-status.js).
 * 어느 프로젝트: 진행 중(active)인 프로젝트만. 보류 · 그만둠 · 끝난 프로젝트는 409 not_active.
 * 차례(실측 → 설계)는 다음 할 일 판정(pipeline.js)이 지킨다 — 여기서는 설계가 있는 프로젝트의 실측을 막지 않는다(재실측).
 * DB 0079 적용 전이면 409 db_pending. 끝나면 일지에 한 줄 (project-log.js — 날짜 · 메모 · 이름은 싣지 않는다).
 */

import {
  ConflictError,
  ForbiddenError,
  MONEY_ROLES,
  NotFoundError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { membersOf } from './company-assignee.js';
import { isMissingRelation } from './work-order-data.js';
import { logProject } from './project-log.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** DB 의 글자 수 제약과 같다 (0079 project_visits_len_check) */
export const VISIT_NAME_MAX = 50;
export const VISIT_NOTE_MAX = 200;
/** 지금 종류는 실측 하나 */
export const VISIT_KIND = 'measure';
/** 한 번에 읽는 행 수 상한 */
const ROW_LIMIT = '500';
const VISIT_COLUMNS =
  'id,project_id,status,scheduled_at,assignee_id,assignee_name,note,done_at,created_at';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () =>
  conflict('DB 0079 적용 전입니다 — 실측 일정은 적용 뒤에 쓸 수 있습니다', 'db_pending');
const stale = () => conflict('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');

/** 화면에 주는 한 줄 — 갈 사람이 구성원이면 그 이름 (memberOf: Map(user_id → { name })) */
export function visitOf(row, memberOf = null) {
  if (!row) return null;
  const member =
    row.assignee_id && memberOf && typeof memberOf.get === 'function'
      ? memberOf.get(row.assignee_id)
      : null;
  return {
    id: row.id,
    status: row.status,
    scheduled_at: row.scheduled_at,
    assignee_id: row.assignee_id || null,
    assignee_name: row.assignee_id ? (member && member.name) || null : row.assignee_name || null,
    note: row.note || null,
    done_at: row.done_at || null,
  };
}

/** 실측을 잡고 끝낼 수 있나 — 대표 · 실장 · 그 프로젝트의 담당자 */
export function canVisit(project, viewer) {
  const p = project || {};
  const v = viewer || {};
  return MONEY_ROLES.includes(v.role) || (!!v.user_id && p.assignee_id === v.user_id);
}

/**
 * 프로젝트마다 지금의 실측 — 예정인 것이 먼저, 없으면 가장 최근에 끝낸 것. 취소한 것은 없는 것으로 친다.
 * @returns {Promise<{ ready: boolean, byProject: Map<string, object> }>} ready false = DB 0079 전 (표가 없다)
 */
export async function visitsOf(env, companyId, { projectId = null, limit = null } = {}) {
  let rows;
  try {
    rows =
      (await selectMany(env, 'project_visits', {
        company_id: `eq.${companyId}`,
        ...(projectId ? { project_id: `eq.${projectId}` } : {}),
        kind: `eq.${VISIT_KIND}`,
        status: 'in.(scheduled,done)',
        select: VISIT_COLUMNS,
        order: 'created_at.desc',
        limit: limit || ROW_LIMIT,
      })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, byProject: new Map() };
    throw e;
  }
  const byProject = new Map();
  for (const r of rows) {
    const cur = byProject.get(r.project_id);
    if (!cur) byProject.set(r.project_id, r);
    else if (cur.status !== 'scheduled') {
      // 예정인 것이 먼저, 둘 다 끝난 것이면 더 나중에 끝낸 것
      if (r.status === 'scheduled' || String(r.done_at || '') > String(cur.done_at || ''))
        byProject.set(r.project_id, r);
    }
  }
  return { ready: true, byProject };
}

/** 글 칸 — 없거나 빈 글이면 null, 넘치면 422 */
function optText(body, key, max, label) {
  if (!has(body, key) || body[key] === null) return null;
  if (typeof body[key] !== 'string')
    throw new ValidationError(`${label}이(가) 올바르지 않습니다`, { field: key });
  const text = body[key].trim();
  if (text.length > max)
    throw new ValidationError(`${label}은(는) ${max}자까지입니다`, { field: key });
  return text || null;
}

/** 그 업체의 진행 중인 프로젝트 + 직책 — 못 하면 던진다 */
async function projectFor(env, user, projectId) {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId))
    throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  const { company, role } = await projectCompanyOf(env, user);
  const project = await selectOne(env, 'projects', {
    id: `eq.${projectId}`,
    company_id: `eq.${company.id}`,
    select: 'id,status,assignee_id',
  });
  if (!project) throw new NotFoundError('이 팩토리의 프로젝트를 찾을 수 없습니다');
  if (!canVisit(project, { role, user_id: user.id }))
    throw new ForbiddenError(
      '실측 일정은 대표 · 실장이나 이 프로젝트의 담당자가 잡습니다',
      'not_allowed'
    );
  if (project.status !== 'active')
    throw conflict('진행 중인 프로젝트만 실측 일정을 잡을 수 있습니다', 'not_active');
  return { company, project };
}

/** 그 프로젝트의 예정인 실측 — 없으면 null. 표가 없으면 db_pending */
async function openVisitOf(env, companyId, projectId) {
  try {
    return await selectOne(env, 'project_visits', {
      company_id: `eq.${companyId}`,
      project_id: `eq.${projectId}`,
      kind: `eq.${VISIT_KIND}`,
      status: 'eq.scheduled',
      select: VISIT_COLUMNS,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
}

/** PUT /company/projects/:id/visit — 실측 일정 잡기 · 고치기 */
export async function setProjectVisit(env, { user, params, body, ctx }) {
  if (!isPlainObject(body)) throw new ValidationError('본문이 필요합니다');
  const when = typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : null;
  if (!when || Number.isNaN(when.getTime()))
    throw new ValidationError('실측 날짜 · 시각이 필요합니다', { field: 'scheduled_at' });
  const scheduledAt = when.toISOString();
  const note = optText(body, 'note', VISIT_NOTE_MAX, '메모');
  let assigneeName = optText(body, 'assignee_name', VISIT_NAME_MAX, '갈 사람');
  let assigneeId = null;
  if (has(body, 'assignee_id') && body.assignee_id !== null) {
    if (typeof body.assignee_id !== 'string' || !UUID_RE.test(body.assignee_id))
      throw new ValidationError('갈 사람이 올바르지 않습니다', { field: 'assignee_id' });
    assigneeId = body.assignee_id.toLowerCase();
  }

  const { company, project } = await projectFor(env, user, params && params.id);
  const members = await membersOf(env, company.id);
  const memberOf = new Map(members.map((m) => [m.user_id, m]));
  if (assigneeId) {
    if (!memberOf.has(assigneeId))
      throw new ValidationError('갈 사람은 이 팩토리의 구성원이어야 합니다', {
        field: 'assignee_id',
      });
    assigneeName = null; // 구성원이면 이름은 구성원 목록에서 읽는다
  }
  const fields = {
    scheduled_at: scheduledAt,
    assignee_id: assigneeId,
    assignee_name: assigneeName,
    note,
  };
  const event = (type, visitId, payload) =>
    logProject(env, ctx, {
      companyId: company.id,
      projectId: project.id,
      actor: { id: user.id },
      type,
      subject: { type: 'visit', id: visitId },
      payload,
    });

  const open = await openVisitOf(env, company.id, project.id);
  if (!open) {
    let row;
    try {
      row = await insertOne(env, 'project_visits', {
        company_id: company.id,
        project_id: project.id,
        kind: VISIT_KIND,
        ...fields,
        created_by: user.id,
      });
    } catch (e) {
      if (isMissingRelation(e)) throw dbPending();
      // 그 사이 다른 사람이 잡았다 (예정은 프로젝트에 하나 — DB 유니크)
      if (e instanceof ConflictError) throw stale();
      throw e;
    }
    if (!row || !row.id) throw conflict('실측 일정을 넣지 못했습니다', 'not_saved');
    await event('schedule_added', row.id, { type: 'measurement' });
    return { project_id: project.id, visit: visitOf(row, memberOf) };
  }

  const rows = await updateBy(
    env,
    'project_visits',
    // 예정일 때만 — 그 사이 끝냈거나 취소했으면 한 줄도 안 바뀐다
    { id: `eq.${open.id}`, status: 'eq.scheduled', select: VISIT_COLUMNS },
    fields
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw stale();
  // 일지에는 날짜를 바꾼 것만 (갈 사람 · 메모만 고친 것은 적지 않는다)
  if (Date.parse(open.scheduled_at) !== Date.parse(scheduledAt))
    await event('schedule_changed', open.id, { type: 'measurement', moved: true });
  return { project_id: project.id, visit: visitOf(row, memberOf) };
}

/** PATCH /company/projects/:id/visit — 실측 완료 처리 · 취소 */
export async function changeProjectVisit(env, { user, params, body, ctx }) {
  if (!isPlainObject(body) || (body.status !== 'done' && body.status !== 'cancelled'))
    throw new ValidationError('status 는 done · cancelled 가운데 하나입니다', { field: 'status' });
  const to = body.status;
  const { company, project } = await projectFor(env, user, params && params.id);
  const open = await openVisitOf(env, company.id, project.id);
  if (!open) throw conflict('예정인 실측이 없습니다', 'no_visit');
  const rows = await updateBy(
    env,
    'project_visits',
    { id: `eq.${open.id}`, status: 'eq.scheduled', select: VISIT_COLUMNS },
    to === 'done' ? { status: 'done', done_by: user.id } : { status: 'cancelled' }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw stale();
  await logProject(env, ctx, {
    companyId: company.id,
    projectId: project.id,
    actor: { id: user.id },
    type: to === 'done' ? 'measure_done' : 'schedule_changed',
    subject: { type: 'visit', id: open.id },
    from: 'scheduled',
    to,
    payload: to === 'done' ? {} : { type: 'measurement' },
  });
  // 취소한 방문은 없는 것으로 친다 — 화면은 다시 「실측 일정 잡기」를 낸다
  return { project_id: project.id, visit: to === 'done' ? visitOf(row) : null };
}
