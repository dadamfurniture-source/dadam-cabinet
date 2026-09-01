-- ═══════════════════════════════════════════════════════════════
-- 크레딧 지급량·소모 단위 변경
--
--   지급량  standard 100 / expert 1000 / agent 5000
--   소모    생성 1회 = 20 크레딧
--
-- 왜 소모 단위를 표로 빼는가:
--   숫자를 함수 안에 박으면 바꿀 때마다 배포가 필요하고, 화면은 그 값을
--   알 길이 없어 "20 크레딧"을 따로 적어두게 된다 — 그 순간 두 곳이 어긋난다.
--   표 하나를 정본으로 두고 함수와 화면이 함께 읽는다.
--
-- 재실행 안전(idempotent).
-- ═══════════════════════════════════════════════════════════════

-- 1. 동작별 소모 크레딧
CREATE TABLE IF NOT EXISTS credit_costs (
  action TEXT PRIMARY KEY,
  credits INT NOT NULL CHECK (credits > 0),
  label TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO credit_costs (action, credits, label) VALUES
  ('generate', 20, '연출컷 생성')
ON CONFLICT (action) DO UPDATE SET credits = EXCLUDED.credits, updated_at = now();

ALTER TABLE credit_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs readable" ON credit_costs;
CREATE POLICY "costs readable" ON credit_costs FOR SELECT USING (true);

-- 2. 지급량
UPDATE credit_plans SET monthly_credits = 100, updated_at = now() WHERE tier = 'standard';
UPDATE credit_plans SET monthly_credits = 1000, updated_at = now() WHERE tier = 'expert';
UPDATE credit_plans SET monthly_credits = 5000, updated_at = now() WHERE tier = 'agent';

-- 3. 차감 — 1 고정에서 동작별 단가로
--    반환형에 cost 를 더했다. CREATE OR REPLACE 로는 반환형을 못 바꾼다
--    ("cannot change return type of existing function") — 먼저 지운다.
DROP FUNCTION IF EXISTS public.consume_credit(TEXT);

CREATE FUNCTION public.consume_credit(p_reason TEXT DEFAULT 'generate')
RETURNS TABLE (ref UUID, balance INT, cost INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_tier TEXT;
  v_grant INT;
  v_cost INT;
  v_ref UUID := gen_random_uuid();
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 등록되지 않은 동작은 기본 단가로 받는다. 0 이나 NULL 로 떨어뜨리면
  -- 오타 하나에 공짜 생성이 열린다.
  SELECT cc.credits INTO v_cost FROM credit_costs cc WHERE cc.action = p_reason;
  v_cost := COALESCE(v_cost, (SELECT cc.credits FROM credit_costs cc WHERE cc.action = 'generate'), 20);

  SELECT p.tier INTO v_tier FROM profiles p WHERE p.id = v_user;
  SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = COALESCE(v_tier, 'standard');
  v_grant := COALESCE(v_grant, 0);

  INSERT INTO user_credits (user_id, balance, period_start, period_end)
  VALUES (v_user, v_grant, now(), now() + INTERVAL '1 month')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT uc.balance INTO v_balance FROM user_credits uc WHERE uc.user_id = v_user FOR UPDATE;

  IF (SELECT uc.period_end FROM user_credits uc WHERE uc.user_id = v_user) <= now() THEN
    UPDATE user_credits uc
      SET balance = v_grant, period_start = now(), period_end = now() + INTERVAL '1 month', updated_at = now()
      WHERE uc.user_id = v_user;
    v_balance := v_grant;
    INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
    VALUES (v_user, v_grant, 'plan_reset', v_grant);
  END IF;

  -- 남은 게 단가보다 적으면 못 쓴다. 0 보다 큰지가 아니라 단가와 견준다 —
  -- 안 그러면 5 크레딧 남은 사람이 20짜리 생성을 하고 잔액이 음수가 된다.
  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credit';
  END IF;

  UPDATE user_credits uc
    SET balance = uc.balance - v_cost, updated_at = now()
    WHERE uc.user_id = v_user
    RETURNING uc.balance INTO v_balance;

  INSERT INTO credit_ledger (user_id, delta, reason, ref, balance_after)
  VALUES (v_user, -v_cost, p_reason, v_ref, v_balance);

  RETURN QUERY SELECT v_ref, v_balance, v_cost;
END;
$$;

-- 4. 환불 — 원장에 적힌 만큼 되돌린다.
--    1 고정으로 두면 단가가 바뀐 뒤 환불이 모자라거나 남는다.
CREATE OR REPLACE FUNCTION public.refund_credit(p_ref UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row credit_ledger%ROWTYPE;
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_row FROM credit_ledger
    WHERE credit_ledger.ref = p_ref
      AND credit_ledger.user_id = v_user
      AND credit_ledger.delta < 0
      AND credit_ledger.refunded = FALSE
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
    WHERE uc.user_id = v_user RETURNING uc.balance INTO v_balance;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
  VALUES (v_user, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_credit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit(UUID) TO authenticated;

-- 5. 이미 옛 지급량(3/30/100)으로 받아둔 잔액은 다음 사용 때 새 값으로 채운다.
--    기간을 끊어두면 consume 이 그 자리에서 갱신한다(크론 불필요).
UPDATE user_credits SET period_end = now(), updated_at = now();
