-- agent 등급 월 크레딧 5000 → 3000 (2026-09-10)
--
-- 왜: 연출컷 1건 원가가 약 0.55~0.69달러(≈800~970원)인데 agent 는 199,000원에 5000 크레딧
--     = 250회 → 건당 796원이라 다 쓰면 원가와 같거나 손해였다. 3000 = 150회, 건당 1,327원.
-- 적용 범위: 다음 지급 주기부터. 이미 받아 둔 잔액(user_credits.balance)은 건드리지 않는다.
-- pricing.html 은 credit_plans 를 읽어 그리므로 화면은 따로 고칠 것이 없다.
UPDATE credit_plans SET monthly_credits = 3000, updated_at = now() WHERE tier = 'agent';
