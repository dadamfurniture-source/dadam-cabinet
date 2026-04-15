-- =============================================
-- 상세설계(detaildesign) 본사 승인 시스템
-- 로그인 사용자 중 본사(홍회장)의 승인을 받은 사람만 detaildesign 기능 접근 가능.
--
-- 실행: Supabase SQL Editor 에서 파일 내용을 붙여넣어 실행.
-- 재실행 안전: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS 사용.
-- =============================================

-- 1. profiles 테이블에 승인 컬럼 추가
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS detaildesign_approved BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS detaildesign_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS detaildesign_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS detaildesign_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_dd_approved ON profiles(detaildesign_approved);
CREATE INDEX IF NOT EXISTS idx_profiles_dd_requested
    ON profiles(detaildesign_requested_at)
    WHERE detaildesign_requested_at IS NOT NULL;

-- 2. consultations 테이블에 주문제작 상세 항목 추가 (상담 품질 향상)
ALTER TABLE consultations
    ADD COLUMN IF NOT EXISTS furniture_categories TEXT[] DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS space_type TEXT,                   -- 주방/거실/침실/드레스룸/현관/기타
    ADD COLUMN IF NOT EXISTS space_width_mm INTEGER,
    ADD COLUMN IF NOT EXISTS space_height_mm INTEGER,
    ADD COLUMN IF NOT EXISTS space_depth_mm INTEGER,
    ADD COLUMN IF NOT EXISTS budget_range TEXT,                 -- under_300 / 300_500 / 500_1000 / over_1000
    ADD COLUMN IF NOT EXISTS style_preference TEXT,             -- modern / classic / natural / luxury / scandinavian / other
    ADD COLUMN IF NOT EXISTS request_detail_design BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_consultations_request_dd
    ON consultations(request_detail_design)
    WHERE request_detail_design = TRUE;

-- 3. RLS: 사용자는 자신의 detaildesign_approved 를 직접 true 로 바꿀 수 없음.
--    실제 승인은 관리자 전용 "Admins can update all profiles" 정책을 통해서만 가능.
--    기존 "Users can update own profile" 정책을 유지하되, detaildesign_approved 컬럼
--    자체의 변경은 방지하기 위한 트리거 보호 추가.

CREATE OR REPLACE FUNCTION public.block_self_dd_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- 관리자(admin_roles 에 등록된 사용자) 가 아닐 때 detaildesign_approved 변경 시 차단
    IF OLD.detaildesign_approved IS DISTINCT FROM NEW.detaildesign_approved THEN
        IF NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()) THEN
            RAISE EXCEPTION
                'detaildesign_approved can only be changed by administrators';
        END IF;
    END IF;
    -- detaildesign_approved_at / _by 도 마찬가지
    IF OLD.detaildesign_approved_at IS DISTINCT FROM NEW.detaildesign_approved_at
        OR OLD.detaildesign_approved_by IS DISTINCT FROM NEW.detaildesign_approved_by THEN
        IF NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()) THEN
            RAISE EXCEPTION
                'detaildesign_approved_at / _by can only be changed by administrators';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_block_self_dd_approval ON profiles;
CREATE TRIGGER trg_block_self_dd_approval
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.block_self_dd_approval();

-- 4. 승인 신청/승인 현황 집계 뷰 (관리자용)
CREATE OR REPLACE VIEW detail_design_approval_requests AS
SELECT
    p.id                          AS user_id,
    p.email,
    p.name,
    p.phone,
    p.tier,
    p.detaildesign_approved,
    p.detaildesign_requested_at,
    p.detaildesign_approved_at,
    p.detaildesign_approved_by,
    (
        SELECT c.id
        FROM consultations c
        WHERE c.user_id = p.id
          AND c.request_detail_design = TRUE
        ORDER BY c.created_at DESC
        LIMIT 1
    ) AS latest_consultation_id
FROM profiles p
WHERE p.detaildesign_requested_at IS NOT NULL
   OR p.detaildesign_approved = TRUE;

GRANT SELECT ON detail_design_approval_requests TO authenticated;
