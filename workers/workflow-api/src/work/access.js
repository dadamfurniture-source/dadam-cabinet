/**
 * 작업자 포털 — 호출자 확인 (docs/01-plan/worker-portal-contract.md §3 공통).
 *
 * service_role 은 RLS 를 우회하므로 라우트마다 직접 행을 불러와 호출자와 비교한다.
 *   - 작업자 라우트: 호출자의 workers 행이 approved 여야 한다 — 아니면 403
 *     (/work/me · /work/register · /work/claim-invite 는 예외)
 *   - 관리자 라우트: 읽기 isAdmin (admin_roles 아무 역할), 쓰기 assertAdminEditor (super_admin · admin)
 *   - 남의 행 · 없는 행은 404 (있는지조차 알리지 않는다)
 */

import { ForbiddenError, NotFoundError, selectOne } from '../supabase.js';
import { isAdmin, assertAdminEditor } from '../reports/admin.js';

/** 호출자의 작업자 행 (없으면 null). 표가 없으면 DbError 를 그대로 던진다 — 부르는 쪽이 isMissingRelation 으로 내려앉힌다. */
export async function loadSelfWorker(env, user) {
  if (!user || !user.id) return null;
  return selectOne(env, 'workers', { user_id: `eq.${user.id}`, select: '*' });
}

/** 승인된 작업자만 — 대기 · 반려 · 정지 · 미등록은 403 */
export async function requireApprovedWorker(env, user) {
  const worker = await loadSelfWorker(env, user);
  if (!worker || worker.status !== 'approved') throw new ForbiddenError('승인된 작업자만 할 수 있습니다');
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

/** 작업자 본인 행인지 — 아니면 404 (403 아님: 남의 배정 · 신청은 있는지도 모르게) */
export function assertMine(row, worker, what) {
  if (!row || !worker || row.worker_id !== worker.id) throw new NotFoundError(`${what}을(를) 찾을 수 없습니다`);
  return row;
}
