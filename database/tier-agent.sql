-- ═══════════════════════════════════════════════════════════════
-- 등급 개편: standard · expert · agent
--
--   business → agent 로 이름 변경
--   tier_source 추가 — 결제로 얻은 등급인지 본사 승인으로 얻은 등급인지
--   등급을 사용자가 스스로 올리던 구멍 차단
--
-- 왜 tier_source 가 필요한가:
--   expert 를 유료 구독 등급으로 열면서도, 지금 본사 승인으로 expert 인
--   사람들이 결제하지 않았다는 이유로 강등되면 안 된다.
--   구독 만료 강등은 tier_source='subscription' 일 때만 건다.
--
-- 재실행 안전(idempotent). exec-sql.mjs 가 한 트랜잭션으로 실행한다.
-- ═══════════════════════════════════════════════════════════════

-- 1. CHECK 제약을 먼저 푼다 — 안 그러면 UPDATE 가 옛 제약에 걸린다
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;

-- 2. 데이터 이관
UPDATE profiles SET tier = 'agent' WHERE tier = 'business';

-- 3. 새 제약
ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_check CHECK (tier IN ('standard', 'expert', 'agent'));

-- 4. tier_source
--    'manual'       본사 승인·관리자 지정 (기본값 — 기존 행은 전부 이쪽이다)
--    'subscription' 결제로 얻음. 구독이 끝나면 standard 로 내린다
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tier_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_tier_source_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_source_check CHECK (tier_source IN ('manual', 'subscription'));

-- ═══════════════════════════════════════════════════════════════
-- 5. 등급 자가 승급 차단  ← 이번 개편의 핵심 보안 수정
--
--    지금까지 등급은 **사용자가 보낸 metadata 에서 왔다**:
--      handle_new_user  : tier = COALESCE(raw_user_meta_data->>'tier', 'standard')
--      handle_user_update: tier = COALESCE(raw_user_meta_data->>'tier', profiles.tier)
--    signup.html 은 실제로 tier 를 그 metadata 에 실어 보내고 있었다.
--    즉 가입할 때 등급을 스스로 고르고, 그 뒤에도
--    auth.updateUser({ data: { tier: 'agent' } }) 로 바꿀 수 있었다.
--    등급이 유료가 되는 순간 이건 그대로 결제 우회다.
--
--    등급은 이제 관리자나 결제 서비스만 정한다.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone, tier, sido, gugun, referral, provider, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    NEW.raw_user_meta_data->>'phone',
    'standard',   -- 가입은 항상 standard. metadata 의 tier 는 신뢰하지 않는다
    NEW.raw_user_meta_data->>'sido',
    NEW.raw_user_meta_data->>'gugun',
    NEW.raw_user_meta_data->>'referral',
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET
    email = NEW.email,
    name = COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', profiles.name),
    phone = COALESCE(NEW.raw_user_meta_data->>'phone', profiles.phone),
    -- tier 는 여기서 건드리지 않는다. metadata 는 사용자가 쓸 수 있는 값이다
    sido = COALESCE(NEW.raw_user_meta_data->>'sido', profiles.sido),
    gugun = COALESCE(NEW.raw_user_meta_data->>'gugun', profiles.gugun),
    avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
    updated_at = NOW(),
    last_sign_in_at = NEW.last_sign_in_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- profiles 를 직접 UPDATE 하는 경로도 막는다.
-- 사용자는 자기 프로필 UPDATE 권한이 있으므로, 이게 없으면 tier 를 직접 쓰거나
-- tier_source 를 'manual' 로 바꿔 구독 만료 강등을 피할 수 있다.
--
-- SECURITY INVOKER(기본)로 둔다 — current_user 가 호출자의 역할이어야
-- service_role(결제 워커)을 통과시킬 수 있다. DEFINER 면 항상 소유자가 된다.
CREATE OR REPLACE FUNCTION public.block_self_tier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier
     OR OLD.tier_source IS DISTINCT FROM NEW.tier_source THEN
    IF current_user <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'tier / tier_source 는 관리자 또는 결제 서비스만 변경할 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_self_tier_change ON profiles;
CREATE TRIGGER trg_block_self_tier_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_self_tier_change();

-- 6. partners 정책
--    전에는 tier = 'business' 인 사람이 협력업체 데이터를 관리했다.
--    agent 가 유료 구독 등급이 되는 순간 그건 "돈만 내면 협력업체를 관리한다"가 된다.
--    관리자 전용으로 바꾼다. (그 권한을 쓰던 1명이 곧 super_admin 이라 손실 없음)
DROP POLICY IF EXISTS "Admins can manage partners" ON partners;
CREATE POLICY "Admins can manage partners" ON partners
  FOR ALL USING (public.is_admin());

-- 7. 통계 뷰 재생성 — business_users → agent_users, 유료 사용자 수 추가
DROP VIEW IF EXISTS profile_stats;
CREATE VIEW profile_stats AS
SELECT
  count(*) AS total_users,
  count(*) FILTER (WHERE tier = 'standard') AS standard_users,
  count(*) FILTER (WHERE tier = 'expert') AS expert_users,
  count(*) FILTER (WHERE tier = 'agent') AS agent_users,
  count(*) FILTER (WHERE tier_source = 'subscription') AS paid_users,
  count(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_signups,
  count(*) FILTER (WHERE created_at >= (CURRENT_DATE - '7 days'::interval)) AS week_signups,
  count(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE::timestamptz)) AS month_signups
FROM profiles;
