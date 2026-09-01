-- ═══════════════════════════════════════════════════════════════
-- 관리자가 구독·결제·크레딧을 볼 수 있게
--
-- subscriptions / payment_history 는 본인만 볼 수 있게 돼 있었다.
-- 회원 관리 화면에서 "이 사람이 결제 중인가"를 볼 방법이 없다.
-- 읽기만 연다 — 관리자가 구독 상태를 직접 고치는 길은 만들지 않는다.
-- 결제 상태의 정본은 토스와 payments-api 다.
--
-- 재실행 안전(idempotent).
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "subscriptions_admin_select" ON subscriptions;
CREATE POLICY "subscriptions_admin_select" ON subscriptions
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "payment_history_admin_select" ON payment_history;
CREATE POLICY "payment_history_admin_select" ON payment_history
  FOR SELECT USING (public.is_admin());

-- user_credits / credit_ledger 의 관리자 정책은 credits-schema.sql 에 이미 있다.
