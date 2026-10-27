-- =============================================
-- 동의 기록 — 이용약관 · 개인정보처리방침 · 만 14세 이상 · 마케팅 수신 · 상담 신청 개인정보 수집
--
-- 더하기만 한다: 빈 값(NULL)을 허용하는 시각 칸만 새로 만든다. 지우거나 바꾸는 문장은 없다.
-- 두 번 실행해도 안전하다 (ADD COLUMN IF NOT EXISTS).
--
-- 누가 쓰나 — 화면이 회원 본인 세션으로 쓴다. 새 정책·트리거는 없다.
--   profiles       기존 정책 "Users can update own profile" (auth.uid() = id).
--                  등급·승인 트리거(block_self_tier_change · block_self_dd_approval)는
--                  tier · tier_source · detaildesign_* 만 막으므로 이 칸들과 상관없다.
--                  · signup.html  이메일 가입 때 동의 시각을 가입 메타데이터에 실어 두고,
--                  · js/consent.js 첫 로그인(세션이 처음 생길 때) 그 값을 이 칸들로 옮긴다.
--                  · mypage.html  마케팅 수신 동의를 켜고 끈다.
--   consultations  기존 정책 "Users can insert consultations" (비회원 포함).
--                  · consultation.html 신청할 때 개인정보 수집·이용 동의 시각을 함께 넣는다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행. 이 칸들을 쓰는 화면보다 먼저 적용한다
--       (칸이 없으면 상담 신청 저장이 실패한다).
-- 확인:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles'
--      AND column_name IN ('terms_agreed_at', 'privacy_agreed_at', 'age_confirmed_at',
--                          'marketing_agreed_at', 'marketing_withdrawn_at');        -- 5행
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'consultations' AND column_name = 'privacy_agreed_at';
-- =============================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_agreed_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS privacy_agreed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS age_confirmed_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS marketing_agreed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS marketing_withdrawn_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.terms_agreed_at IS '이용약관 동의 시각';
COMMENT ON COLUMN public.profiles.privacy_agreed_at IS '개인정보처리방침 동의 시각';
COMMENT ON COLUMN public.profiles.age_confirmed_at IS '만 14세 이상 확인 시각';
COMMENT ON COLUMN public.profiles.marketing_agreed_at IS '마케팅 수신 동의 시각 (NULL = 동의 안 함)';
COMMENT ON COLUMN public.profiles.marketing_withdrawn_at IS '마케팅 수신 동의를 마지막으로 철회한 시각';

ALTER TABLE public.consultations
    ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.consultations.privacy_agreed_at IS '상담 신청 개인정보 수집·이용 동의 시각';
