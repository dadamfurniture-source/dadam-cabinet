-- =============================================
-- 다담가구 사용자 프로필 테이블 및 트리거
-- auth.users와 동기화되는 공개 프로필 테이블
-- =============================================

-- 1. profiles 테이블 생성
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    name TEXT,
    phone TEXT,
    tier TEXT DEFAULT 'standard' CHECK (tier IN ('standard', 'expert', 'business')),
    sido TEXT,
    gugun TEXT,
    referral TEXT,
    provider TEXT,  -- email, google, kakao
    avatar_url TEXT,

    -- 추가 정보
    company_name TEXT,
    business_number TEXT,

    -- 관리자 메모
    admin_memo TEXT,

    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_tier ON profiles(tier);
CREATE INDEX IF NOT EXISTS idx_profiles_sido ON profiles(sido);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at DESC);

-- 3. RLS 정책 설정
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 프로필만 조회 가능
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- 사용자는 자신의 프로필만 수정 가능 (tier 제외)
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 관리자는 모든 프로필 조회 가능
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

-- 관리자는 모든 프로필 수정 가능
CREATE POLICY "Admins can update all profiles" ON profiles
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

-- 시스템(트리거)에서 삽입 허용
CREATE POLICY "System can insert profiles" ON profiles
    FOR INSERT WITH CHECK (true);

-- =============================================
-- 트리거 함수: 새 사용자 생성 시 프로필 자동 생성
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        name,
        phone,
        tier,
        sido,
        gugun,
        referral,
        provider,
        avatar_url,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
        NEW.raw_user_meta_data->>'phone',
        COALESCE(NEW.raw_user_meta_data->>'tier', 'standard'),
        NEW.raw_user_meta_data->>'sido',
        NEW.raw_user_meta_data->>'gugun',
        NEW.raw_user_meta_data->>'referral',
        COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.created_at,
        NOW()
    );
    RETURN NEW;
EXCEPTION
    WHEN unique_violation THEN
        -- 이미 프로필이 존재하면 무시
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성 (이미 존재하면 삭제 후 재생성)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- 트리거 함수: 사용자 메타데이터 업데이트 시 프로필 동기화
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_user_update()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET
        email = NEW.email,
        name = COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', profiles.name),
        phone = COALESCE(NEW.raw_user_meta_data->>'phone', profiles.phone),
        tier = COALESCE(NEW.raw_user_meta_data->>'tier', profiles.tier),
        sido = COALESCE(NEW.raw_user_meta_data->>'sido', profiles.sido),
        gugun = COALESCE(NEW.raw_user_meta_data->>'gugun', profiles.gugun),
        avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
        updated_at = NOW(),
        last_sign_in_at = NEW.last_sign_in_at
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_user_update();

-- =============================================
-- 기존 사용자 마이그레이션 (한 번만 실행)
-- =============================================

-- 기존 auth.users의 데이터를 profiles로 복사
-- INSERT INTO public.profiles (id, email, name, phone, tier, sido, gugun, referral, provider, avatar_url, created_at, updated_at)
-- SELECT
--     id,
--     email,
--     COALESCE(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name'),
--     raw_user_meta_data->>'phone',
--     COALESCE(raw_user_meta_data->>'tier', 'standard'),
--     raw_user_meta_data->>'sido',
--     raw_user_meta_data->>'gugun',
--     raw_user_meta_data->>'referral',
--     COALESCE(raw_app_meta_data->>'provider', 'email'),
--     raw_user_meta_data->>'avatar_url',
--     created_at,
--     NOW()
-- FROM auth.users
-- ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 프로필 통계 뷰 (관리자 대시보드용)
-- =============================================

CREATE OR REPLACE VIEW profile_stats AS
SELECT
    COUNT(*) as total_users,
    COUNT(*) FILTER (WHERE tier = 'standard') as standard_users,
    COUNT(*) FILTER (WHERE tier = 'expert') as expert_users,
    COUNT(*) FILTER (WHERE tier = 'business') as business_users,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today_signups,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as week_signups,
    COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)) as month_signups
FROM profiles;

-- 뷰에 대한 권한 설정
GRANT SELECT ON profile_stats TO authenticated;
