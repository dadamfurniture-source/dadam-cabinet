-- =============================================
-- 다담가구 협력업체(파트너) 테이블
-- 인테리어 업체 + 제조공장 관리
-- =============================================

-- 1. partners 테이블 생성
CREATE TABLE IF NOT EXISTS partners (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- 기본 정보
    company_name TEXT NOT NULL,
    description TEXT,
    partner_type TEXT NOT NULL CHECK (partner_type IN ('interior', 'factory')),

    -- 위치 (한국 행정구역 + GPS 좌표)
    sido TEXT NOT NULL,
    gugun TEXT NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,

    -- 전문 분야
    specialty_categories TEXT[] DEFAULT '{}',   -- sink, wardrobe, fridge, vanity, shoe, storage
    specialty_styles TEXT[] DEFAULT '{}',       -- modern-minimal, scandinavian, classic-luxury 등
    specialty_text TEXT,

    -- 포트폴리오
    portfolio_images JSONB DEFAULT '[]',        -- [{url, caption, category}]
    logo_url TEXT,

    -- 연락처
    phone TEXT,
    email TEXT,
    website TEXT,
    kakao_id TEXT,

    -- 사업 정보
    business_number TEXT,
    established_year INT,
    employee_count TEXT,   -- '1-5', '6-20', '21-50', '50+'

    -- 평점/통계
    rating NUMERIC(2,1) DEFAULT 0,
    review_count INT DEFAULT 0,
    completed_projects INT DEFAULT 0,

    -- 상태
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,

    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 인덱스
CREATE INDEX IF NOT EXISTS idx_partners_type ON partners(partner_type);
CREATE INDEX IF NOT EXISTS idx_partners_sido ON partners(sido);
CREATE INDEX IF NOT EXISTS idx_partners_active ON partners(is_active);
CREATE INDEX IF NOT EXISTS idx_partners_categories ON partners USING GIN(specialty_categories);

-- 3. RLS 정책
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- 누구나 활성 파트너 조회 가능 (공개 비즈니스 정보)
CREATE POLICY "Anyone can view active partners" ON partners
    FOR SELECT USING (is_active = true);

-- 관리자만 파트너 생성/수정/삭제 가능
CREATE POLICY "Admins can manage partners" ON partners
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tier = 'business')
    );

-- 4. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_partners_updated_at
    BEFORE UPDATE ON partners
    FOR EACH ROW
    EXECUTE FUNCTION update_partners_updated_at();
