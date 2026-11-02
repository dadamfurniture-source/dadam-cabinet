/**
 * 회계장부 — 누가 무엇을 하나.
 *
 *   업체 active 구성원만 (한 사람에 업체 하나 — 0003 company_members_one_active_company). 아니면 403 not_member.
 *     관리자여도 구성원이 아니면 못 본다 — 장부는 그 업체 것이다.
 *   업체 자격은 DB 함수 company_entitled(업체, 'ledger', 사람) 하나로 본다 (database/migrations/0026):
 *     full  Agent 협력업체(또는 시험 예외) · active — 쓰기 · 읽기
 *     read  등급이 내려감 — 보기 · 내보내기만 (장부 · 증빙 5년 보관). 쓰면 403 read_only
 *     none  403 not_entitled
 *   대표 · 실장(MONEY_ROLES): 장부 · 금액 · 설정. 직원: 사진 올리기와 자기가 올린 사진의 상태만 — 금액 · 장부는 403 not_money
 */
import { activeMemberships, callRpc, ForbiddenError, MONEY_ROLES } from '../supabase.js';

export const LEDGER_LEVELS = Object.freeze(['full', 'read']);

/** @returns {{ companyId, role, money, level }} */
export async function ledgerAccess(env, user) {
  const [m] = await activeMemberships(env, user);
  if (!m) throw new ForbiddenError('장부는 업체 구성원만 씁니다', 'not_member');
  const level = await callRpc(env, 'company_entitled', { p_company: m.company_id, p_feature: 'ledger', p_user: user.id });
  if (!LEDGER_LEVELS.includes(level)) throw new ForbiddenError('이 업체는 장부를 쓸 수 없습니다', 'not_entitled');
  return { companyId: m.company_id, role: m.role, money: MONEY_ROLES.includes(m.role), level };
}

/** 금액 · 장부 · 설정 — 대표 · 실장만 */
export function assertMoney(access) {
  if (!access.money) throw new ForbiddenError('장부는 업체 대표 · 실장만 봅니다', 'not_money');
}

/** 쓰기 — 자격이 full 일 때만 */
export function assertWritable(access) {
  if (access.level !== 'full') throw new ForbiddenError('지금 등급에서는 장부를 보기 · 내보내기만 할 수 있습니다', 'read_only');
}
