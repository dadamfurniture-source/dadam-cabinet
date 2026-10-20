/**
 * 플래너 「사진으로 만들기」 등급 관문 (사장님 결정 2026-10-20).
 *
 *   플래너 모드(mode:'planner', 재생성 포함)는 profiles.tier 가 expert · agent 이거나
 *   admin_roles 가 admin · super_admin 인 사용자만 쓴다. 일반 연출컷(ai-design.html, mode 없음)은 관문이 없다.
 *
 * 정본은 여기다 — 화면(js/planner/ai-photo.js)은 같은 순서를 사본으로 들고 버튼만 잠근다.
 *   등급 순서: database/tier-agent.sql profiles_tier_check · js/detaildesign-access.js TIER_RANK 와 같다.
 *   관리자 판정: src/appliance-image.js assertApplianceAdmin 과 같은 admin · super_admin.
 * JWT 의 metadata tier 는 믿지 않는다 — service role 로 profiles 본인 행을 읽는다.
 * profiles 조회 실패는 fail-closed (거절) — 관리자 행이 읽히면 그것으로 통과한다.
 */
import { selectOne, ForbiddenError } from './supabase.js';

/** profiles_tier_check 의 등급 순서 (database/tier-agent.sql). */
export const TIER_RANK = Object.freeze({ standard: 0, expert: 1, agent: 2 });
/** 이 등급 이상에게 연다. */
export const PLANNER_MIN_TIER = 'expert';
export const ADMIN_ROLES = Object.freeze(['admin', 'super_admin']);
export const PLANNER_TIER_CODE = 'planner_tier';
export const PLANNER_TIER_MESSAGE = '사진으로 만들기는 Expert 등급부터 쓸 수 있습니다';

/**
 * 순수 판정. 모르는 등급·역할은 막는다.
 * @param {{tier?:string|null, role?:string|null}} p
 * @returns {boolean}
 */
export function plannerTierAllowed({ tier, role } = {}) {
  if (role && ADMIN_ROLES.includes(role)) return true;
  const rank = Object.prototype.hasOwnProperty.call(TIER_RANK, tier) ? TIER_RANK[tier] : -1;
  return rank >= TIER_RANK[PLANNER_MIN_TIER];
}

/**
 * 관문. 통과하면 {tier, role} 을 돌려주고, 아니면 403 ForbiddenError(code 'planner_tier').
 * 크레딧 차감보다 먼저 불러야 한다 — 거절되면 아무것도 차감되지 않는다.
 */
export async function assertPlannerTier(env, user) {
  let tier = null;
  try {
    const row = await selectOne(env, 'profiles', { id: `eq.${user.id}`, select: 'tier' });
    tier = row && typeof row.tier === 'string' ? row.tier : null;
  } catch (e) {
    console.warn('[Generate] planner tier gate: profiles read failed:', e.message);
  }
  if (plannerTierAllowed({ tier })) return { tier, role: null };

  let role = null;
  try {
    const row = await selectOne(env, 'admin_roles', { user_id: `eq.${user.id}`, select: 'role' });
    role = row && typeof row.role === 'string' ? row.role : null;
  } catch (e) {
    console.warn('[Generate] planner tier gate: admin_roles read failed:', e.message);
  }
  if (plannerTierAllowed({ tier, role })) return { tier, role };

  const err = new ForbiddenError(PLANNER_TIER_MESSAGE);
  err.code = PLANNER_TIER_CODE;
  throw err;
}
