/**
 * 회계장부 — 누가 무엇을 하나.
 *
 *   업체 active 구성원만 (한 사람에 업체 하나 — 0003 company_members_one_active_company). 아니면 403 not_member.
 *     관리자여도 구성원이 아니면 못 본다 — 장부는 그 업체 것이다.
 *   업체 자격은 DB 함수 company_entitled(업체, 'ledger', 사람) 하나로 본다 (database/migrations/0026):
 *     full  Agent 협력업체(또는 시험 예외) · active — 쓰기 · 읽기 (DB 0038 의 Expert · Agent 에서 DB 0047 로 Agent 만)
 *     read  등급이 내려감 — 보기 · 내보내기만 (장부 · 증빙 5년 보관). 쓰면 403 read_only
 *     none  403 not_entitled
 *   사진 AI 읽기는 따로 company_entitled(업체, 'ledger_ai') — Agent · 시험 업체만 (ledgerAi, DB 0038).
 *   대표 · 실장(MONEY_ROLES): 장부 · 금액 · 설정. 직원: 사진 올리기와 자기가 올린 사진의 상태만 — 금액 · 장부는 403 not_money
 *
 *   다른 업체 장부 보기 (?company=) — 다담 본사(platform) 대표 · 실장만 다담 공장(hq) 장부를 본다.
 *     보기만 (level read · viewing). 공장 장부 자격은 사람 없이 본다 (본사 사람은 공장 구성원이 아니다).
 *     쓰기 주소는 company 를 받지 않는다 — 언제나 자기 업체에 쓴다.
 *   협력업체 월 보고서 (?company= + report) — 본사 대표 · 실장은 협력업체(kind partner)의 월 보고서도 본다.
 *     report 는 보고서 주소만 넘긴다: GET /ledger/me(?company= 가 있을 때) · /ledger/dashboard · /ledger/receivables ·
 *     /ledger/payables · /ledger/close-memo. 그 밖의 장부 주소(장부 · 사진 · 확인 · 명세표 · 거래처 · 알림 · 설정 …)는 지금처럼 403 not_member.
 *     보기만 (level read · viewing · report). 자격은 공장처럼 사람 없이 본다 — full · read 면 열고, none 이면 403 no_ledger.
 *     협력업체가 아니거나 없는 업체, 본사 직원 · 본사 밖 사람은 403 not_member. ledgerList 에는 넣지 않는다 (목록은 그대로).
 */
import { activeMemberships, callRpc, selectOne, selectMany, platformCompanyId, hqCompanyId, ForbiddenError, MONEY_ROLES } from '../supabase.js';
import { isUuid } from './checks.js';

export const LEDGER_LEVELS = Object.freeze(['full', 'read']);

async function entitled(env, companyId, userId) {
  const args = { p_company: companyId, p_feature: 'ledger' };
  if (userId) args.p_user = userId;
  return callRpc(env, 'company_entitled', args);
}

/** 본사 대표 · 실장이 함께 보는 공장 장부 — 볼 수 있으면 공장 id, 아니면 null */
async function viewableHq(env, m) {
  if (!m || !MONEY_ROLES.includes(m.role)) return null;
  const [platform, hq] = await Promise.all([platformCompanyId(env), hqCompanyId(env)]);
  if (m.company_id !== platform || hq === platform) return null;
  return LEDGER_LEVELS.includes(await entitled(env, hq)) ? hq : null;
}

/**
 * 본사 대표 · 실장이 보는 협력업체 월 보고서 — 볼 수 있으면 그 업체 id, 아니면 null.
 * 협력업체인데 장부 자격이 none 이면 403 no_ledger.
 */
async function reportablePartner(env, m, company) {
  if (!m || !MONEY_ROLES.includes(m.role)) return null;
  if (m.company_id !== (await platformCompanyId(env))) return null;
  const target = await selectOne(env, 'companies', { id: `eq.${company}`, select: 'id,kind' });
  if (!target || target.kind !== 'partner') return null;
  if (!LEDGER_LEVELS.includes(await entitled(env, company))) throw new ForbiddenError('이 팩토리는 장부가 없습니다', 'no_ledger');
  return company;
}

/**
 * @param {{ company?: string, report?: boolean }} [opts] — 보려는 업체 (비우면 자기 업체) · report 협력업체 월 보고서 주소
 * @returns {{ companyId, role, money, level, viewing, report? }}
 */
export async function ledgerAccess(env, user, { company, report } = {}) {
  const [m] = await activeMemberships(env, user);
  if (!m) throw new ForbiddenError('장부는 팩토리 구성원만 씁니다', 'not_member');
  if (company && company !== m.company_id) {
    const hq = isUuid(company) ? await viewableHq(env, m) : null;
    if (hq && company === hq) return { companyId: hq, role: m.role, money: true, level: 'read', viewing: true };
    const partner = report === true && isUuid(company) ? await reportablePartner(env, m, company) : null;
    if (!partner) throw new ForbiddenError('이 팩토리 장부는 열 수 없습니다', 'not_member');
    return { companyId: partner, role: m.role, money: true, level: 'read', viewing: true, report: true };
  }
  const level = await entitled(env, m.company_id, user.id);
  if (!LEDGER_LEVELS.includes(level)) throw new ForbiddenError('이 팩토리는 장부를 쓸 수 없습니다', 'not_entitled');
  return { companyId: m.company_id, role: m.role, money: MONEY_ROLES.includes(m.role), level, viewing: false };
}

/**
 * 이 사람이 여는 장부들 — [{ company_id, name, kind, own }] (자기 업체 먼저).
 * 자기 업체는 자격(full · read)이 있을 때, 본사 대표 · 실장이면 공장 장부를 더한다.
 */
export async function ledgerList(env, user) {
  const [m] = await activeMemberships(env, user);
  if (!m) return [];
  const [ownLevel, hq] = await Promise.all([entitled(env, m.company_id, user.id), viewableHq(env, m)]);
  const list = [];
  if (LEDGER_LEVELS.includes(ownLevel)) list.push({ company_id: m.company_id, own: true });
  if (hq) list.push({ company_id: hq, own: false });
  if (!list.length) return [];
  const rows = (await selectMany(env, 'companies', { id: `in.(${list.map((x) => x.company_id).join(',')})`, select: 'id,name,kind' })) || [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((x) => ({ company_id: x.company_id, name: (byId.get(x.company_id) || {}).name || null, kind: (byId.get(x.company_id) || {}).kind || null, own: x.own }));
}

/** 금액 · 장부 · 설정 — 대표 · 실장만 */
export function assertMoney(access) {
  if (!access.money) throw new ForbiddenError('장부는 팩토리 대표 · 실장만 봅니다', 'not_money');
}

/** 사진 AI 읽기 자격 — DB 0038 company_entitled(업체, 'ledger_ai') 가 full (Agent · 시험 업체) */
export async function ledgerAi(env, companyId) {
  return (await callRpc(env, 'company_entitled', { p_company: companyId, p_feature: 'ledger_ai' })) === 'full';
}

/** 쓰기 — 자격이 full 일 때만 (다른 업체 장부 보기는 늘 read) */
export function assertWritable(access) {
  if (access.level !== 'full') throw new ForbiddenError('지금 등급에서는 장부를 보기 · 내보내기만 할 수 있습니다', 'read_only');
}
