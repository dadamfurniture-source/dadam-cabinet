/**
 * 업체 구독 — Expert · Agent 결제는 모두 협력업체(companies.kind = 'partner')의 구독이다.
 *
 *   - 등급(profiles.tier)은 DB 트리거가 업체 plan · status 에 맞춘다 (database/migrations/0011).
 *     이 워커는 profiles.tier 를 쓰지 않는다.
 *   - 업체 크레딧은 company_credits 하나를 구성원이 함께 쓴다. 새 달 크레딧 = 이번 기간을 지금 끝낸다
 *     (다음 consume_credit 이 credit_plans[업체 plan] 만큼 채운다). 아직 통장이 없으면 할 일이 없다.
 *   - 업체 status: active → suspended(결제가 끝내 안 됨, 읽기만) | closed(해지 기간 끝 · 환불).
 *   - 한 업체에 살아 있는 구독(active · past_due · trialing)은 하나뿐이다 (DB 부분 유니크).
 */

import { selectOne, updateBy } from './supabase.js';

export const LIVE_SUB_STATUSES = ['active', 'past_due', 'trialing'];

const COMPANY_COLUMNS = 'id,kind,name,plan,next_plan,status';

/** 내가 active 구성원인 회사와 역할. 한 사람은 한 회사에서만 active 다. 구성원이 아니면 null. */
export async function readMembership(env, userId) {
  const member = await selectOne(env, 'company_members', {
    user_id: `eq.${userId}`,
    status: 'eq.active',
    select: 'company_id,role',
  });
  if (!member) return null;
  const company = await selectOne(env, 'companies', {
    id: `eq.${member.company_id}`,
    select: COMPANY_COLUMNS,
  });
  if (!company) throw new Error(`company ${member.company_id} not found`);
  return { role: member.role, company };
}

/** 브라우저에 돌려줄 업체 칸. */
export function publicCompany(c) {
  return { id: c.id, name: c.name, plan: c.plan, next_plan: c.next_plan ?? null, status: c.status };
}

/** 업체의 살아 있는 구독 (없으면 null). */
export function liveCompanySubscription(env, companyId) {
  return selectOne(env, 'subscriptions', {
    company_id: `eq.${companyId}`,
    status: `in.(${LIVE_SUB_STATUSES.join(',')})`,
    select: 'id',
  });
}

/** 업체 통장의 이번 기간을 끝낸다 — 다음 사용 때 업체 등급의 월 지급량으로 채워진다. */
export function resetCompanyCredits(env, companyId, nowMs) {
  const now = new Date(nowMs).toISOString();
  return updateBy(
    env,
    'company_credits',
    { company_id: `eq.${companyId}` },
    { period_end: now, updated_at: now }
  );
}

/**
 * 구독이 끝난 업체를 정지(suspended) 또는 해지(closed)로.
 * 그 업체에 살아 있는 다른 구독이 있으면(다시 결제했다) 손대지 않는다.
 * 정지는 active 에서만, 해지는 active · suspended 에서.
 * 돌려주는 값: 이번에 업체 상태를 바꿨으면 true (이미 바뀌어 있었거나 손대지 않았으면 false).
 */
export async function endCompany(env, companyId, status) {
  if (await liveCompanySubscription(env, companyId)) {
    console.warn(`[payments] company ${companyId} has a live subscription — left as is`);
    return false;
  }
  const rows = await updateBy(
    env,
    'companies',
    {
      id: `eq.${companyId}`,
      status: status === 'suspended' ? 'eq.active' : 'in.(active,suspended)',
    },
    { status }
  );
  return Array.isArray(rows) && rows.length > 0;
}
