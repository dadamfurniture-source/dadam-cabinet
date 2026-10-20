/**
 * 작업자 포털 — 호출자 확인 (docs/01-plan/worker-portal-contract.md §3 공통).
 *
 * service_role 은 RLS 를 우회하므로 라우트마다 직접 행을 불러와 호출자와 비교한다.
 *   - 작업자 라우트: 호출자의 workers 행이 approved 또는 suspended 여야 한다 — 대기 · 반려 · 미등록은 403
 *     (/work/me · /work/register · /work/claim-invite 는 예외)
 *     정지(suspended)는 새 작업 보기 · 신청 · 초대 수락만 막고(라우트마다 다른 문구로 403),
 *     지난 기록 보기와 진행 중인 일 정리(철회 · 거절 · 포기 · 시작 · 보고)는 그대로 둔다 (1주차 후속 D)
 *   - 관리자 라우트: 읽기 isAdmin (admin_roles 아무 역할), 쓰기 assertAdminEditor (super_admin · admin)
 *   - 남의 행 · 없는 행은 404 (있는지조차 알리지 않는다)
 */

import { ConflictError, ForbiddenError, NotFoundError, selectOne } from '../supabase.js';
import { isAdmin, assertAdminEditor } from '../reports/admin.js';

/** 지난 기록을 볼 수 있는 작업자 상태 */
export const WORKER_ACCESS_STATUSES = Object.freeze(['approved', 'suspended']);

/** 정지된 작업자가 새 일을 하려 할 때의 403 문구 (라우트마다) */
export const SUSPENDED_MESSAGES = Object.freeze({
  browse: '정지된 계정은 새 작업을 볼 수 없습니다',
  apply: '정지된 계정은 새 작업에 신청할 수 없습니다',
  confirm: '정지된 계정은 새 작업을 수락할 수 없습니다',
});

/** 호출자의 작업자 행 (없으면 null). 표가 없으면 DbError 를 그대로 던진다 — 부르는 쪽이 isMissingRelation 으로 내려앉힌다. */
export async function loadSelfWorker(env, user) {
  if (!user || !user.id) return null;
  return selectOne(env, 'workers', { user_id: `eq.${user.id}`, select: '*' });
}

/** 승인 · 정지 작업자 — 지난 기록 보기 · 진행 중인 일 정리. 대기 · 반려 · 미등록은 403 */
export async function requireWorker(env, user) {
  const worker = await loadSelfWorker(env, user);
  if (!worker || !WORKER_ACCESS_STATUSES.includes(worker.status)) throw new ForbiddenError('승인된 작업자만 할 수 있습니다');
  return worker;
}

/**
 * 승인된 작업자만 — 새 작업 보기(browse) · 신청(apply) · 초대 수락(confirm).
 * 정지는 action 의 문구로, 대기 · 반려 · 미등록은 requireWorker 문구로 403.
 */
export async function requireApprovedWorker(env, user, action) {
  const worker = await requireWorker(env, user);
  if (worker.status !== 'approved') throw new ForbiddenError(SUSPENDED_MESSAGES[action] || '승인된 작업자만 할 수 있습니다');
  return worker;
}

/** 관리자 읽기 — admin_roles 에 행이 있으면 (support · moderator 포함) */
export async function requireAdminReader(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 볼 수 있습니다');
}

/** 관리자 쓰기 · 민감 읽기(작업자 메모) — super_admin · admin 만 */
export async function requireAdminEditor(env, user) {
  return assertAdminEditor(env, user);
}

/**
 * 관리자가 사람을 넣을 때 (직접 지정 초대 · 신청 승인) — 승인된 작업자만, 아니면 409.
 * 문구는 정지 · 대기 · 반려(· 행 없음) 모두 "정지된 작업자는 배정할 수 없습니다" (1주차 후속 D 명세 그대로).
 */
export function assertAssignable(worker) {
  if (worker && worker.status === 'approved') return worker;
  throw new ConflictError('정지된 작업자는 배정할 수 없습니다');
}

/** 작업자 본인 행인지 — 아니면 404 (403 아님: 남의 배정 · 신청은 있는지도 모르게) */
export function assertMine(row, worker, what) {
  if (!row || !worker || row.worker_id !== worker.id) throw new NotFoundError(`${what}을(를) 찾을 수 없습니다`);
  return row;
}
