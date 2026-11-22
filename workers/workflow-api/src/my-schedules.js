/**
 * 고객이 앱에서 설치 날을 확인 · 바꿔 달라고 요청 (DB 0079 customer_confirmed_* · 0082 customer_change_* —
 * 2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차).
 *
 *   POST /me/schedules/:id/confirm   「이 날 좋아요」 — 고객 확인 표시를 고객이 직접 (업체 화면의 「고객 확인」이 저절로 켜진다).
 *                                    변경 요청이 있었으면 지운다.
 *   POST /me/schedules/:id/change    { note? } 「바꿔 주세요」 — 요청만 남긴다. 날짜는 업체가 고친다
 *                                    (날짜가 바뀌면 생산 계획 · 작업자 일정이 같이 움직이므로). 고객 확인 표시는 지운다.
 *                                    업체 대표 · 실장(과 그 프로젝트 담당자)에게 앱 알림 install_change (날짜 · 이름 · 글은 싣지 않는다).
 *     → { id, scheduled_at, customer_confirmed_at, customer_change_requested_at, customer_change_note }
 *
 * 누가: 그 일정의 설계가 이어진 프로젝트의 고객 계정 (customers.user_id) — 남의 일정은 404 (있는지도 모르게).
 * 어느 일정: 설치 일정(installation) · 취소 · 끝나지 않은 것만 (409 not_open).
 * 0079 전이면 409 db_pending. 0082 전이면 「바꿔 주세요」만 409 db_pending (확인은 된다).
 * 일지: schedule_confirmed(고객 — 「설치 날을 고객과 확인했습니다」) · install_change_requested(고객).
 */

import { ConflictError, NotFoundError, ValidationError, selectOne, updateById } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { logProject } from './project-log.js';
import { notifyRoles } from './push/outbox.js';
import { buildMessage } from './push/messages.js';

export const CHANGE_NOTE_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ['scheduled', 'confirmed', 'in_progress'];

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = (no) => conflict(`DB ${no} 적용 전입니다 — 적용 뒤에 쓸 수 있습니다`, 'db_pending');

/** 고객 본인의 설치 일정 — { schedule, design, project } (아니면 404) */
async function myInstallOf(env, user, rawId) {
  const id = String(rawId || '');
  if (!UUID_RE.test(id)) throw new ValidationError('일정 id 가 올바르지 않습니다');
  const missing = () => new NotFoundError('일정을 찾을 수 없습니다');
  const schedule = await selectOne(env, 'design_schedules', {
    id: `eq.${id}`,
    select: 'id,design_id,type,status,scheduled_at',
  });
  if (!schedule || schedule.type !== 'installation') throw missing();
  const design = await selectOne(env, 'designs', { id: `eq.${schedule.design_id}`, select: 'id,company_id,project_id' });
  if (!design || !design.project_id || !design.company_id) throw missing();
  const project = await selectOne(env, 'projects', {
    id: `eq.${design.project_id}`,
    company_id: `eq.${design.company_id}`,
    select: 'id,customer_id,assignee_id',
  });
  if (!project || !project.customer_id) throw missing();
  const customer = await selectOne(env, 'customers', { id: `eq.${project.customer_id}`, select: 'user_id' });
  if (!customer || !user || customer.user_id !== user.id) throw missing();
  if (!OPEN.includes(schedule.status)) throw conflict('취소했거나 끝난 일정입니다', 'not_open');
  return { schedule, design, project };
}

const view = (row, fallback) => ({
  id: row.id || fallback.id,
  scheduled_at: row.scheduled_at || fallback.scheduled_at,
  customer_confirmed_at: row.customer_confirmed_at || null,
  customer_change_requested_at: row.customer_change_requested_at || null,
  customer_change_note: row.customer_change_note || null,
});

/** POST /me/schedules/:id/confirm */
export async function confirmMySchedule(env, { user, params, ctx }) {
  const { schedule, design, project } = await myInstallOf(env, user, params && params.id);
  const now = new Date().toISOString();
  const confirm = { customer_confirmed_at: now, customer_confirmed_by: user.id };
  let row;
  try {
    row = await updateById(env, 'design_schedules', schedule.id, {
      ...confirm,
      customer_change_requested_at: null,
      customer_change_by: null,
      customer_change_note: null,
    });
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    // 0082 전 — 요청 칸 없이 확인만
    try {
      row = await updateById(env, 'design_schedules', schedule.id, confirm);
    } catch (e2) {
      if (isMissingRelation(e2)) throw dbPending('0079');
      throw e2;
    }
  }
  await logProject(env, ctx, {
    companyId: design.company_id,
    projectId: project.id,
    actor: { id: user.id, kind: 'customer' },
    type: 'schedule_confirmed',
    subject: { type: 'schedule', id: schedule.id },
    payload: { type: 'installation' },
  });
  return view(row || {}, schedule);
}

/** POST /me/schedules/:id/change */
export async function requestMyScheduleChange(env, { user, params, body, ctx }) {
  const { schedule, design, project } = await myInstallOf(env, user, params && params.id);
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body.note : undefined;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new ValidationError('note 는 글입니다');
  const note = typeof raw === 'string' ? raw.trim() : '';
  if ([...note].length > CHANGE_NOTE_MAX)
    throw new ValidationError(`바라는 것은 ${CHANGE_NOTE_MAX}자까지입니다`, { field: 'note' });
  const at = new Date().toISOString();
  let row;
  try {
    row = await updateById(env, 'design_schedules', schedule.id, {
      customer_change_requested_at: at,
      customer_change_by: user.id,
      customer_change_note: note || null,
      customer_confirmed_at: null,
      customer_confirmed_by: null,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending('0082');
    throw e;
  }
  await logProject(env, ctx, {
    companyId: design.company_id,
    projectId: project.id,
    actor: { id: user.id, kind: 'customer' },
    type: 'install_change_requested',
    subject: { type: 'schedule', id: schedule.id },
  });
  const msg = buildMessage('install_change', {});
  if (msg) {
    const send = notifyRoles(env, {
      companyId: design.company_id,
      roles: ['owner', 'manager'],
      userIds: project.assignee_id ? [project.assignee_id] : [],
      kind: 'install_change',
      ...msg,
      refId: schedule.id,
      dedupeSuffix: at,
    }).catch((e) => console.error('install_change notify failed:', e && e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
    else await send;
  }
  return view(row || {}, schedule);
}
