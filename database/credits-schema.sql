-- ═══════════════════════════════════════════════════════════════
-- 생성 크레딧
--
-- 스튜디오가 "1회 차감"이라고 말해왔지만 차감하는 곳이 없었다.
--
-- 설계 요점
--   · 잔액만 두면 왜 줄었는지 못 밝힌다 → 원장(credit_ledger)을 함께 둔다.
--   · 차감은 반드시 서버에서. 다만 generate-api 에는 service_role 을 두지
--     않는다(이미지 생성 워커가 DB 전권을 가질 이유가 없다).
--     대신 SECURITY DEFINER RPC 를 **사용자 토큰으로** 부른다 —
--     권한은 함수가 갖고, 누구인지는 함수 안의 auth.uid() 가 정한다.
--   · 월 리셋은 크론 없이 지연 갱신한다. consume 이 불릴 때 기간이 지났으면
--     그 자리에서 채운다. 스케줄러가 죽어도 크레딧이 멈추지 않는다.
--
-- 재실행 안전(idempotent).
-- ═══════════════════════════════════════════════════════════════

-- 1. 등급별 월 지급량
CREATE TABLE IF NOT EXISTS credit_plans (
  tier TEXT PRIMARY KEY CHECK (tier IN ('standard', 'expert', 'agent')),
  monthly_credits INT NOT NULL CHECK (monthly_credits >= 0),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 초기값. 운영하면서 이 표만 바꾸면 된다 (코드 수정 불필요).
INSERT INTO credit_plans (tier, monthly_credits) VALUES
  ('standard', 3),
  ('expert', 30),
  ('agent', 100)
ON CONFLICT (tier) DO NOTHING;

-- 2. 사용자별 잔액
CREATE TABLE IF NOT EXISTS user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 month'),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 원장 — 잔액이 왜 그 값인지 설명하는 유일한 근거
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INT NOT NULL,                    -- 차감은 -1, 환불·지급은 +n
  reason TEXT NOT NULL,                  -- consume | refund | grant | plan_reset
  ref UUID,                              -- 차감 1건을 가리키는 열쇠. 환불이 이걸 찾는다
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  balance_after INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_ref ON credit_ledger(ref) WHERE ref IS NOT NULL;

-- 4. RLS — 본인 것만 읽는다. 쓰기는 아무도 직접 못 한다(함수만)
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own credits" ON user_credits;
DROP POLICY IF EXISTS "admin credits" ON user_credits;
DROP POLICY IF EXISTS "own ledger" ON credit_ledger;
DROP POLICY IF EXISTS "admin ledger" ON credit_ledger;
DROP POLICY IF EXISTS "plans readable" ON credit_plans;

CREATE POLICY "own credits" ON user_credits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admin credits" ON user_credits FOR SELECT USING (public.is_admin());
CREATE POLICY "own ledger" ON credit_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admin ledger" ON credit_ledger FOR SELECT USING (public.is_admin());
CREATE POLICY "plans readable" ON credit_plans FOR SELECT USING (true);

-- INSERT/UPDATE 정책은 만들지 않는다 — RLS 가 켜져 있고 정책이 없으면 막힌다.
-- 잔액을 바꾸는 길은 아래 두 함수뿐이다.

-- ref 는 숨긴다.
-- 사용자가 자기 원장을 읽을 수 있으므로, ref 가 보이면 그걸로 refund_credit 을
-- 직접 불러 자기 차감을 되돌릴 수 있다 — 무한 무료 생성이 된다.
--
-- 컬럼 단위 REVOKE 만으로는 안 된다: 테이블 단위 SELECT 권한이 남아 있으면
-- 그게 모든 컬럼을 덮어 컬럼 회수가 무효가 된다(실측으로 확인).
-- 테이블 권한을 먼저 걷어내고 필요한 컬럼만 다시 준다.
REVOKE SELECT ON credit_ledger FROM authenticated, anon;
GRANT SELECT (id, user_id, delta, reason, refunded, balance_after, created_at)
  ON credit_ledger TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5. 차감
--    잔액 확인·차감·원장 기록이 한 문장 안에서 끝나야 한다.
--    나눠 쓰면 동시에 들어온 요청이 같은 잔액을 보고 둘 다 통과한다.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_credit(p_reason TEXT DEFAULT 'consume')
RETURNS TABLE (ref UUID, balance INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_tier TEXT;
  v_grant INT;
  v_ref UUID := gen_random_uuid();
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT p.tier INTO v_tier FROM profiles p WHERE p.id = v_user;
  SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = COALESCE(v_tier, 'standard');
  v_grant := COALESCE(v_grant, 0);

  -- 첫 사용이면 이 자리에서 만든다. 가입 시점에 만들지 않는 이유는
  -- 등급이 바뀌어도 지급량이 따라가야 하기 때문이다.
  INSERT INTO user_credits (user_id, balance, period_start, period_end)
  VALUES (v_user, v_grant, now(), now() + INTERVAL '1 month')
  ON CONFLICT (user_id) DO NOTHING;

  -- 행을 잠그고 시작한다. 잠그지 않으면 동시 요청이 같은 잔액을 읽는다.
  SELECT uc.balance INTO v_balance FROM user_credits uc WHERE uc.user_id = v_user FOR UPDATE;

  -- 기간이 지났으면 지금 채운다 (크론 없이)
  IF (SELECT uc.period_end FROM user_credits uc WHERE uc.user_id = v_user) <= now() THEN
    UPDATE user_credits uc
      SET balance = v_grant, period_start = now(), period_end = now() + INTERVAL '1 month', updated_at = now()
      WHERE uc.user_id = v_user;
    v_balance := v_grant;
    INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
    VALUES (v_user, v_grant, 'plan_reset', v_grant);
  END IF;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'insufficient_credit';
  END IF;

  UPDATE user_credits uc
    SET balance = uc.balance - 1, updated_at = now()
    WHERE uc.user_id = v_user
    RETURNING uc.balance INTO v_balance;

  INSERT INTO credit_ledger (user_id, delta, reason, ref, balance_after)
  VALUES (v_user, -1, p_reason, v_ref, v_balance);

  RETURN QUERY SELECT v_ref, v_balance;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6. 환불 — 생성이 통째로 실패했을 때만
--    ref 를 아는 쪽(워커)만 부를 수 있다. 사용자에게는 ref 가 안 보인다.
--    한 번 환불한 건 다시 환불되지 않는다(refunded 플래그).
-- ═══════════════════════════════════════════════════════════════
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
      -- 오래된 건 환불하지 않는다. 실패 직후에만 의미가 있다.
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  UPDATE user_credits uc SET balance = uc.balance + 1, updated_at = now()
    WHERE uc.user_id = v_user RETURNING uc.balance INTO v_balance;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
  VALUES (v_user, 1, 'refund', v_balance);

  RETURN v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_credit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit(UUID) TO authenticated;

-- 등급이 바뀌면 지급량이 달라진다. 다음 기간부터 반영되도록 기간을 끊는다.
-- (즉시 채우지 않는 이유: 등급을 올렸다 내렸다 하며 잔액을 부풀릴 수 있다)
CREATE OR REPLACE FUNCTION public.reset_credits_on_tier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier THEN
    UPDATE user_credits SET period_end = now(), updated_at = now() WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_reset_credits_on_tier_change ON profiles;
CREATE TRIGGER trg_reset_credits_on_tier_change
  AFTER UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.reset_credits_on_tier_change();
