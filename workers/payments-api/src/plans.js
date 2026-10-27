/**
 * 플랜 = 등급이다. profiles.tier 와 같은 낱말을 쓴다 —
 * 어휘가 둘이면 결제한 등급과 표시되는 등급이 어긋난다.
 * standard 는 무료 기본이라 결제 대상이 아니다.
 */
export const PLAN_NAMES = {
  expert: '다담가구 Expert 등급 (월간)',
  agent: '다담가구 Agent 등급 (월간)',
};

export const PAID_PLANS = ['expert', 'agent'];

export function priceFor(env, plan) {
  // 'constructor' 같은 이름이 객체 프로토타입 값을 집지 않게, 결제 플랜만 받는다.
  if (!PAID_PLANS.includes(plan)) return undefined;
  const map = {
    expert: parseInt(env.TOSS_PRICE_EXPERT_KRW || '99000', 10),
    agent: parseInt(env.TOSS_PRICE_AGENT_KRW || '199000', 10),
  };
  return map[plan];
}

export function orderNameFor(plan) {
  return PLAN_NAMES[plan] || '다담가구 구독';
}
