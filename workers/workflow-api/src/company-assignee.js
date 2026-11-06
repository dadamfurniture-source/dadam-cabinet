/**
 * 프로젝트 담당자 — 팩토리 안 담당자 칸 (2026-11-06 사장님 결정 · 작업 분배 묶음, DB 0042 projects.assignee_id).
 *   ① Expert · Agent 모두 — Expert 는 대표 · 실장이 손으로 고르고, Agent 는 비서가 추천 → 대표 · 실장 승인 (승인 카드 project_assign)
 *   ② 프로젝트에 한 명 ③ 그 업체의 대표 · 실장 · 직원 모두 (지금 구성원)
 *   ④ 비서 추천 기준 「일감 고르게 + 일정」 — 추천만 하고 사람이 승인해야 정해진다. 카드에 근거 숫자를 함께 보인다.
 *
 *   PUT /company/projects/:id/assignee              대표 · 실장 { assignee_id | null, expect_assignee_id? }
 *       → { project_id, assignee_id, assigned_at }. 같은 사람이면 그대로 성공. expect_assignee_id(승인 카드가 본 담당자)가
 *       지금과 다르면 409 stale. 지금 구성원이 아니면 422 not_member (DB 지킴이도 23514 로 막는다).
 *   GET /company/projects/:id/assignee-candidates   대표 · 실장 — 고를 구성원 + 근거 숫자, 추천 차례
 *       차례: 진행 중 담당이 적은 사람 → 앞으로 CANDIDATE_DAYS 일 일정이 적은 사람 → 이름 (이름 없는 사람은 뒤)
 *         진행 중 담당 = 그 사람이 담당자인 active 프로젝트 수
 *         일정 = 그 사람이 담당자인 active 프로젝트에 이은 설계의 일정(끝남 · 취소 뺌) 중 오늘(한국 시간)부터 CANDIDATE_DAYS 일 안
 *   DB 0042 적용 전이면 409 db_pending (목록은 company-projects.js 가 담당자 없이 보인다).
 *
 * 이름은 profiles.name (없으면 null — 화면이 역할로 부른다). 쓰기는 이 워커(service_role)만 — 구성원 쓰기 정책은 없다.
 */
import { ConflictError, NotFoundError, ValidationError, selectMany, selectOne, updateBy } from './supabase.js';
import { companyOf } from './distribution/company.js';
import { isMissingRelation } from './work-order-data.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 추천 근거 — 일정을 보는 날 수 (아침 브리핑 SCHEDULE_DAYS 와 같은 이레) */
export const CANDIDATE_DAYS = 7;
/** 끝나지 않은 일정 (아침 브리핑 OPEN_SCHEDULE 과 같다) */
const OPEN_SCHEDULE = '(scheduled,confirmed,in_progress)';
/** 역할 차례 — 이름이 같을 때 */
const ROLE_ORDER = { owner: 0, manager: 1, staff: 2 };
const FETCH = '1000';

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
/** 한국 날짜 0시(UTC ISO) — plusDays 날 뒤 */
export function kstDayStart(nowMs, plusDays = 0) {
  const date = new Date(nowMs + KST_MS).toISOString().slice(0, 10);
  return new Date(Date.parse(`${date}T00:00:00Z`) - KST_MS + plusDays * DAY_MS).toISOString();
}

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () => conflict('DB 0042 적용 전입니다 — 담당자는 적용 뒤에 정할 수 있습니다', 'db_pending');

/** 그 업체의 지금 구성원 — [{ user_id, name, role }] (이름은 profiles, 역할 차례 → 이름) */
export async function membersOf(env, companyId) {
  const rows =
    (await selectMany(env, 'company_members', {
      company_id: `eq.${companyId}`,
      status: 'eq.active',
      select: 'user_id,role',
      limit: '200',
    })) || [];
  const ids = rows.map((r) => r.user_id).filter(isUuid);
  const profiles = ids.length ? (await selectMany(env, 'profiles', { id: `in.(${ids.join(',')})`, select: 'id,name' })) || [] : [];
  const nameOf = new Map(profiles.map((p) => [p.id, (p.name && String(p.name).trim()) || null]));
  return rows
    .map((r) => ({ user_id: r.user_id, name: nameOf.get(r.user_id) || null, role: r.role }))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name ? 0 : 1) - (b.name ? 0 : 1) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}

/** 그 업체의 프로젝트 하나 (담당자 칸 포함). 0042 전이면 db_pending */
async function projectOf(env, companyId, projectId) {
  if (!isUuid(projectId)) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  let project;
  try {
    project = await selectOne(env, 'projects', {
      id: `eq.${projectId}`,
      company_id: `eq.${companyId}`,
      select: 'id,status,assignee_id,assigned_at',
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!project) throw new NotFoundError('이 업체의 프로젝트를 찾을 수 없습니다');
  return project;
}

/**
 * 추천 차례 (순수) — members: membersOf, projects: 그 업체 active 프로젝트 [{ id, assignee_id }],
 * schedules: 앞으로 며칠 일정 [{ design_id }], designs: [{ id, project_id }]
 */
export function rankCandidates(members, projects, schedules, designs) {
  const load = new Map();
  const ownerOfProject = new Map();
  for (const p of projects || []) {
    if (!p || !p.assignee_id) continue;
    load.set(p.assignee_id, (load.get(p.assignee_id) || 0) + 1);
    ownerOfProject.set(p.id, p.assignee_id);
  }
  const projectOfDesign = new Map((designs || []).map((d) => [d.id, d.project_id]));
  const week = new Map();
  for (const s of schedules || []) {
    const who = ownerOfProject.get(projectOfDesign.get(s && s.design_id));
    if (who) week.set(who, (week.get(who) || 0) + 1);
  }
  return (members || [])
    .map((m) => ({ ...m, active_projects: load.get(m.user_id) || 0, week_schedules: week.get(m.user_id) || 0 }))
    .sort(
      (a, b) =>
        a.active_projects - b.active_projects ||
        a.week_schedules - b.week_schedules ||
        (a.name ? 0 : 1) - (b.name ? 0 : 1) ||
        String(a.name || '').localeCompare(String(b.name || ''), 'ko') ||
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );
}

/** GET /company/projects/:id/assignee-candidates */
export async function assigneeCandidates(env, { user, projectId, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const project = await projectOf(env, companyId, projectId);
  const members = await membersOf(env, companyId);
  const projects =
    (await selectMany(env, 'projects', {
      company_id: `eq.${companyId}`,
      status: 'eq.active',
      assignee_id: 'not.is.null',
      select: 'id,assignee_id',
      limit: FETCH,
    })) || [];
  const ids = projects.map((p) => p.id);
  const designs = ids.length
    ? (await selectMany(env, 'designs', { project_id: `in.(${ids.join(',')})`, company_id: `eq.${companyId}`, select: 'id,project_id', limit: FETCH })) || []
    : [];
  const designIds = designs.map((d) => d.id);
  const schedules = designIds.length
    ? (await selectMany(env, 'design_schedules', {
        design_id: `in.(${designIds.join(',')})`,
        status: `in.${OPEN_SCHEDULE}`,
        scheduled_at: `gte.${kstDayStart(nowMs)}`,
        select: 'id,design_id,scheduled_at',
        limit: FETCH,
      })) || []
    : [];
  const until = Date.parse(kstDayStart(nowMs, CANDIDATE_DAYS));
  const inWindow = schedules.filter((s) => Date.parse(s.scheduled_at) < until);
  return {
    project_id: project.id,
    assignee_id: project.assignee_id || null,
    days: CANDIDATE_DAYS,
    candidates: rankCandidates(members, projects, inWindow, designs),
  };
}

/** PUT /company/projects/:id/assignee */
export async function setProjectAssignee(env, { user, projectId, body }) {
  if (!isPlainObject(body) || !has(body, 'assignee_id'))
    throw new ValidationError('assignee_id 가 필요합니다 (비우려면 null)', { field: 'assignee_id' });
  const target = body.assignee_id;
  if (target !== null && !isUuid(target)) throw new ValidationError('assignee_id 가 올바르지 않습니다', { field: 'assignee_id' });
  const { companyId } = await companyOf(env, user, { manage: true });
  const project = await projectOf(env, companyId, projectId);
  const current = project.assignee_id || null;
  if (current === target) return { project_id: project.id, assignee_id: target, assigned_at: project.assigned_at || null };
  // expect_assignee_id (AI 비서 승인 카드) — 카드를 만들 때 본 담당자. 그 사이 바뀌었으면 409 stale
  if (has(body, 'expect_assignee_id')) {
    const expect = body.expect_assignee_id;
    if (expect !== null && !isUuid(expect)) throw new ValidationError('expect_assignee_id 가 올바르지 않습니다', { field: 'expect_assignee_id' });
    if (current !== expect) throw conflict('그 사이 담당자가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  }
  if (target !== null) {
    const member = await selectOne(env, 'company_members', {
      company_id: `eq.${companyId}`,
      user_id: `eq.${target}`,
      status: 'eq.active',
      select: 'user_id',
    });
    if (!member) throw new ValidationError('이 업체의 지금 구성원만 담당자가 됩니다', { field: 'assignee_id', code: 'not_member' });
  }
  let rows;
  try {
    rows = await updateBy(
      env,
      'projects',
      { id: `eq.${project.id}`, company_id: `eq.${companyId}`, select: 'id,assignee_id,assigned_at' },
      { assignee_id: target, assigned_by: user.id }
    );
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { project_id: project.id, assignee_id: target, assigned_at: (row && row.assigned_at) || null };
}
