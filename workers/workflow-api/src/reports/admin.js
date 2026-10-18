/**
 * 워커 첫 관리자 검사 — `admin_roles` (database/admin-schema.sql) 를 service_role 로 읽는다.
 * 프론트의 `AdminAccess.isAdmin()` / DB 의 `public.is_admin()` 과 같은 기준: admin_roles 에 행이 있으면 관리자.
 *
 * 사장님 결정 (2026-10-18, work-reports-archive.plan.md §8 Q1): 보관함은 관리자 전원이 보고,
 * 메모 · 고정 · 보관 처리 같은 변경은 admin 이상(super_admin · admin)만 한다.
 */

import { ForbiddenError, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';

const TTL_MS = 60 * 1000;
const cache = new Map(); // user_id → { role, at }

export const EDITOR_ROLES = Object.freeze(['super_admin', 'admin']);

/** 시험용 — 캐시 비우기 */
export function clearAdminCache() {
  cache.clear();
}

/** 관리자 역할 (없으면 null). admin_roles 표가 없는 DB 에서도 null 로 내려앉는다. */
export async function adminRoleOf(env, user) {
  if (!user || !user.id) return null;
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.role;
  let role = null;
  try {
    const row = await selectOne(env, 'admin_roles', { user_id: `eq.${user.id}`, select: 'role' });
    role = row ? row.role || 'admin' : null;
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    role = null;
  }
  cache.set(user.id, { role, at: Date.now() });
  return role;
}

export async function isAdmin(env, user) {
  return Boolean(await adminRoleOf(env, user));
}

export function canEditRole(role) {
  return EDITOR_ROLES.includes(role);
}

/** admin 이상이 아니면 403 */
export async function assertAdminEditor(env, user) {
  const role = await adminRoleOf(env, user);
  if (!canEditRole(role)) throw new ForbiddenError('관리자(admin 이상)만 할 수 있습니다');
  return role;
}
