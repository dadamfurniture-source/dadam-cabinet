/**
 * 플랜 = 등급이다. profiles.tier 와 같은 낱말을 쓴다 —
 * 어휘가 둘이면 결제한 등급과 표시되는 등급이 어긋난다.
 * standard 는 무료 기본이라 결제 대상이 아니다.
 * 결제 등급은 낮은 것부터: manager < expert < agent.
 * company_members.role 의 'manager'(실장)는 업체 안 직책이라 이 목록과 섞지 않는다.
 */
export const PLAN_NAMES = {
  manager: '다담가구 Manager 등급 (월간)',
  expert: '다담가구 Expert 등급 (월간)',
  agent: '다담가구 Agent 등급 (월간)',
};

/** 화면에 보이는 짧은 이름 (GET /plans · 안내 문구) */
export const PLAN_LABELS = {
  manager: 'Manager',
  expert: 'Expert',
  agent: 'Agent',
};

export const PAID_PLANS = ['manager', 'expert', 'agent'];

/**
 * 결제 전에 본사 승인(새 업체 신청 approved · 아직 안 씀)이 있어야 하는 등급.
 * 여기 없는 결제 등급(Manager · Expert)은 신청 없이 바로 결제하고 시작한다.
 */
export const APPROVAL_PLANS = ['agent'];

export function priceFor(env, plan) {
  // 'constructor' 같은 이름이 객체 프로토타입 값을 집지 않게, 결제 플랜만 받는다.
  if (!PAID_PLANS.includes(plan)) return undefined;
  const map = {
    manager: parseInt(env.TOSS_PRICE_MANAGER_KRW || '99000', 10),
    expert: parseInt(env.TOSS_PRICE_EXPERT_KRW || '199000', 10),
    agent: parseInt(env.TOSS_PRICE_AGENT_KRW || '299000', 10),
  };
  return map[plan];
}

export function orderNameFor(plan) {
  return PLAN_NAMES[plan] || '다담가구 구독';
}
