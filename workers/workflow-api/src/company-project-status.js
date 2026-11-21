/**
 * 프로젝트 상태 바꾸기 — 보류 · 그만둠 · 다시 진행 (2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차).
 * 지금까지는 projects.status 를 바꾸는 길이 없어, 고객이 멈추거나 포기한 프로젝트가 단계 줄에 그대로 남았다.
 *
 *   PATCH /company/projects/:id/status
 *     { status: 'on_hold' | 'cancelled' | 'active', expect_status?, hold_until?: 'YYYY-MM-DD' | null, note?: string | null }
 *     → { project_id, status, hold_until, status_note, status_at }
 *
 * 누가: 그 업체의 대표 · 실장, 그리고 그 프로젝트의 담당자. 되살리기(그만둠 → 진행)는 대표 · 실장만.
 * 바뀌는 길: 진행 → 보류 | 그만둠 · 보류 → 진행 | 그만둠 · 그만둠 → 진행. 끝남(closed) · 넘김(handed_over)은 바꾸지 못한다.
 *
 * 규칙
 *   · **계약금을 받으면 보류 · 그만둠은 작동하지 않는다** (대표님 2026-11-21) — 취소 아닌 수주에 입금된 계약금 줄이 있으면 409 deposit_paid.
 *     「다시 진행」은 언제든 된다.
 *   · 그만둠은 살아 있는 수주(계약금 전)가 있으면 수주 취소부터 — 409 has_order.
 *   · 다시 볼 날(hold_until)은 보류일 때만, 오늘(한국 날짜)부터. 메모는 200자까지. 보류가 아니게 되면 다시 볼 날은 비운다.
 *   · expect_status — 화면이 본 상태. 그 사이 바뀌었으면 409 stale. 쓰기도 지금 상태를 조건으로 건다.
 * DB 0078 적용 전이면 409 db_pending. 끝나면 일지에 한 줄 (project-log.js).
 */

import {
  ConflictError,
  ForbiddenError,
  MONEY_ROLES,
  NotFoundError,
  ValidationError,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { isMissingRelation } from './work-order-data.js';
import { logProject } from './project-log.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_MS = 9 * 3600 * 1000;
export const STATUS_NOTE_MAX = 200;
/** 이 길로 갈 수 있는 상태 */
export const SETTABLE = Object.freeze(['on_hold', 'cancelled', 'active']);
/** from → 갈 수 있는 곳 */
export const MOVES = Object.freeze({
  active: ['on_hold', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  cancelled: ['active'],
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () =>
  conflict('DB 0078 적용 전입니다 — 보류 · 그만둠은 적용 뒤에 쓸 수 있습니다', 'db_pending');

/** 오늘 (한국 날짜) */
export function todayKst(nowMs) {
  return new Date(nowMs + KST_MS).toISOString().slice(0, 10);
}

/**
 * 이 프로젝트에서 할 수 있는 상태 일 — 프로젝트 창이 단추를 낼지 정한다 (서버의 판정과 같은 함수).
 * @param {{ status: string, assignee_id?: string|null }} project
 * @param {{ role: string|null, user_id: string }} viewer
 * @param {{ live: number, deposit: boolean }} orders  취소 아닌 수주 수 · 그 가운데 계약금이 들어온 것이 있나
 * @returns {{ hold: boolean, cancel: boolean, resume: boolean, blocked: null | 'deposit' | 'order' | 'role' }}
 */
export function statusActions(project, viewer, orders) {
  const p = project || {};
  const v = viewer || {};
  const o = orders || { live: 0, deposit: false };
  const manage = MONEY_ROLES.includes(v.role);
  const mine = !!v.user_id && p.assignee_id === v.user_id;
  const none = { hold: false, cancel: false, resume: false, blocked: null };
  if (!manage && !mine) return { ...none, blocked: 'role' };
  if (p.status === 'on_hold') return { ...none, resume: true, cancel: !o.deposit && !o.live };
  if (p.status === 'cancelled') return { ...none, resume: manage };
  if (p.status !== 'active') return none;
  // 계약금을 받은 프로젝트 — 보류 · 그만둠 없음
  if (o.deposit) return { ...none, blocked: 'deposit' };
  return { ...none, hold: true, cancel: !o.live, blocked: o.live ? 'order' : null };
}

/** 그 프로젝트의 수주 사정 — 취소 아닌 수주 수 · 계약금이 들어온 것이 있나 */
export async function orderFactsOf(env, companyId, projectId) {
  const orders =
    (await selectMany(env, 'orders', {
      project_id: `eq.${projectId}`,
      company_id: `eq.${companyId}`,
      status: 'neq.cancelled',
      select: 'id',
      limit: '100',
    })) || [];
  if (!orders.length) return { live: 0, deposit: false };
  const paid =
    (await selectMany(env, 'order_payments', {
      order_id: `in.(${orders.map((o) => o.id).join(',')})`,
      stage: 'eq.deposit',
      paid_on: 'not.is.null',
      select: 'order_id',
      limit: '1',
    })) || [];
  return { live: orders.length, deposit: paid.length > 0 };
}

/** PATCH /company/projects/:id/status */
export async function setProjectStatus(env, { user, params, body, ctx, nowMs = Date.now() }) {
  const projectId = params && params.id;
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId))
    throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  if (!isPlainObject(body) || !SETTABLE.includes(body.status))
    throw new ValidationError('status 는 on_hold · cancelled · active 가운데 하나입니다', {
      field: 'status',
    });
  const to = body.status;
  let holdUntil = null;
  if (has(body, 'hold_until') && body.hold_until !== null) {
    if (to !== 'on_hold')
      throw new ValidationError('다시 볼 날은 보류일 때만 적습니다', { field: 'hold_until' });
    const d = body.hold_until;
    if (typeof d !== 'string' || !DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))
      throw new ValidationError('다시 볼 날이 올바르지 않습니다 (YYYY-MM-DD)', {
        field: 'hold_until',
      });
    if (d < todayKst(nowMs))
      throw new ValidationError('다시 볼 날은 오늘부터입니다', { field: 'hold_until' });
    holdUntil = d;
  }
  let note = null;
  if (has(body, 'note') && body.note !== null) {
    if (typeof body.note !== 'string')
      throw new ValidationError('메모가 올바르지 않습니다', { field: 'note' });
    note = body.note.trim() || null;
    if (note && note.length > STATUS_NOTE_MAX)
      throw new ValidationError(`메모는 ${STATUS_NOTE_MAX}자까지입니다`, { field: 'note' });
  }

  const { company, role } = await projectCompanyOf(env, user);
  let project;
  try {
    project = await selectOne(env, 'projects', {
      id: `eq.${projectId}`,
      company_id: `eq.${company.id}`,
      select: 'id,status,assignee_id,hold_until,status_note,status_at',
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!project) throw new NotFoundError('이 팩토리의 프로젝트를 찾을 수 없습니다');
  const from = project.status;
  if (has(body, 'expect_status') && body.expect_status !== from)
    throw conflict('그 사이 상태가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  if (from === to)
    return {
      project_id: project.id,
      status: from,
      hold_until: project.hold_until || null,
      status_note: project.status_note || null,
      status_at: project.status_at || null,
    };
  if (!(MOVES[from] || []).includes(to))
    throw conflict('이 프로젝트의 상태는 바꿀 수 없습니다', 'not_movable');

  const viewer = { role, user_id: user.id };
  const facts =
    to === 'active' ? { live: 0, deposit: false } : await orderFactsOf(env, company.id, project.id);
  const can = statusActions(project, viewer, facts);
  const ok = to === 'on_hold' ? can.hold : to === 'cancelled' ? can.cancel : can.resume;
  if (!ok) {
    if (can.blocked === 'role' || (to === 'active' && !can.resume))
      throw new ForbiddenError(
        from === 'cancelled'
          ? '그만둔 프로젝트는 대표 · 실장이 되살립니다'
          : '대표 · 실장이나 이 프로젝트의 담당자만 바꿀 수 있습니다',
        'not_allowed'
      );
    if (facts.deposit)
      throw conflict('계약금을 받은 프로젝트는 보류하거나 그만둘 수 없습니다', 'deposit_paid');
    throw conflict('살아 있는 계약이 있습니다 — 계약(수주)을 먼저 취소해 주세요', 'has_order');
  }

  const at = new Date(nowMs).toISOString();
  let rows;
  try {
    rows = await updateBy(
      env,
      'projects',
      // 지금 상태를 조건으로 — 그 사이 다른 사람이 바꿨으면 한 줄도 안 바뀐다
      {
        id: `eq.${project.id}`,
        company_id: `eq.${company.id}`,
        status: `eq.${from}`,
        select: 'id,status,hold_until,status_note,status_at',
      },
      {
        status: to,
        hold_until: to === 'on_hold' ? holdUntil : null,
        status_note: note,
        status_at: at,
        status_by: user.id,
      }
    );
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw conflict('그 사이 상태가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  await logProject(env, ctx, {
    companyId: company.id,
    projectId: project.id,
    actor: { id: user.id },
    type: 'status_changed',
    subject: { type: 'project', id: project.id },
    from,
    to,
    payload: holdUntil ? { hold_until: holdUntil } : {},
  });
  return {
    project_id: project.id,
    status: row.status || to,
    hold_until: row.hold_until || null,
    status_note: row.status_note || null,
    status_at: row.status_at || at,
  };
}
