/**
 * 누가 비서를 쓰나.
 *
 *   업체 active 구성원만 (한 사람에 업체 하나 — 0003 company_members_one_active_company). 아니면 403 not_member.
 *   업체 자격은 DB 함수 company_entitled(업체, 'assistant', 사람) 하나로 본다 (database/migrations/0026):
 *     full  협력업체 Agent(또는 시험 예외) · active · 업체 비서 켬 · 전체 스위치 켬
 *     none  그 밖 — 대화를 새로 만들거나 보낼 수 없다 (403 not_entitled). 지난 대화 읽기는 된다
 *   대표 · 실장 · 직원 모두 쓴다. 직원에게는 돈 정보를 주지 않는다 (money — 도구가 붙을 때 그 값으로 가린다)
 */
import { selectMany, selectOne, callRpc } from './db.js';
import { forbidden, notFound } from './http.js';

/** 원가 · 마진 · 수금 · 장부를 보는 역할 (workflow-api supabase.js MONEY_ROLES 와 같다) */
export const MONEY_ROLES = Object.freeze(['owner', 'manager']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

/** company_entitled(업체, 'assistant', 사람) → 'full' | 'none' */
export async function entitledLevel(env, companyId, userId) {
  const level = await callRpc(env, 'company_entitled', {
    p_company: companyId,
    p_feature: 'assistant',
    p_user: userId,
  });
  return level === 'full' ? 'full' : 'none';
}

/**
 * @param {{ chat?: boolean }} [opts] chat — 대화를 만들거나 보낼 때(자격 full 이어야 한다)
 * @returns {{ companyId, role, money, level }}
 */
export async function assistantAccess(env, user, { chat = false } = {}) {
  const [m] = await selectMany(env, 'company_members', {
    user_id: `eq.${user.id}`,
    status: 'eq.active',
    select: 'company_id,role',
  });
  if (!m) throw forbidden('비서는 업체 구성원만 씁니다', 'not_member');
  const level = await entitledLevel(env, m.company_id, user.id);
  if (chat && level !== 'full') throw forbidden('이 업체는 비서를 쓸 수 없습니다', 'not_entitled');
  return { companyId: m.company_id, role: m.role, money: MONEY_ROLES.includes(m.role), level };
}

/** 내 대화 — 다른 사람 · 다른 업체 대화는 없는 것과 같다 (404) */
export async function ownConversation(env, access, user, id) {
  if (!isUuid(id)) throw notFound('대화가 없습니다');
  const row = await selectOne(env, 'assistant_conversations', {
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
    company_id: `eq.${access.companyId}`,
    select: 'id,company_id,user_id,title,created_at,updated_at',
  });
  if (!row) throw notFound('대화가 없습니다');
  return row;
}
