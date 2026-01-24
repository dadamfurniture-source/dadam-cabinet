-- =============================================
-- 다담가구 설계 저장 테이블
-- 사용자의 AI 설계 결과물 저장
-- =============================================

-- 1. designs 테이블 생성
CREATE TABLE IF NOT EXISTS designs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- 설계 기본 정보
    title TEXT NOT NULL,
    description TEXT,

    -- 설계 유형 및 스타일
    design_type TEXT,                     -- kitchen, wardrobe, vanity, storage, etc.
    style TEXT,                           -- modern, scandinavian, industrial, luxury

    -- 이미지 데이터
    original_image TEXT,                  -- 원본 이미지 URL 또는 Base64
    generated_images JSONB DEFAULT '[]',  -- 생성된 이미지 배열 [{url, type, created_at}]
    thumbnail_url TEXT,                   -- 썸네일 이미지

    -- AI 분석 데이터
    wall_analysis JSONB,                  -- 벽면 분석 결과
    ai_response JSONB,                    -- AI 응답 데이터

    -- 상태
    status TEXT DEFAULT 'draft',          -- draft, submitted, processing, completed
    is_favorite BOOLEAN DEFAULT FALSE,

    -- 메모
    user_memo TEXT,

    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_designs_user ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_designs_status ON designs(status);
CREATE INDEX IF NOT EXISTS idx_designs_type ON designs(design_type);
CREATE INDEX IF NOT EXISTS idx_designs_created ON designs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_designs_favorite ON designs(user_id, is_favorite) WHERE is_favorite = TRUE;

-- 3. RLS 정책 설정
ALTER TABLE designs ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 설계만 조회 가능
CREATE POLICY "Users can view own designs" ON designs
    FOR SELECT USING (auth.uid() = user_id);

-- 사용자는 자신의 설계만 생성 가능
CREATE POLICY "Users can insert own designs" ON designs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 설계만 수정 가능
CREATE POLICY "Users can update own designs" ON designs
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 설계만 삭제 가능
CREATE POLICY "Users can delete own designs" ON designs
    FOR DELETE USING (auth.uid() = user_id);

-- 관리자는 모든 설계 조회 가능
CREATE POLICY "Admins can view all designs" ON designs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );


-- =============================================
-- 4. 트리거: updated_at 자동 갱신
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_designs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_designs_update ON designs;
CREATE TRIGGER on_designs_update
    BEFORE UPDATE ON designs
    FOR EACH ROW EXECUTE FUNCTION public.handle_designs_updated_at();


-- =============================================
-- 5. 설계 통계 뷰
-- =============================================

CREATE OR REPLACE VIEW design_stats AS
SELECT
    user_id,
    COUNT(*) as total_designs,
    COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
    COUNT(*) FILTER (WHERE is_favorite = TRUE) as favorite_count,
    MAX(created_at) as last_design_at
FROM designs
GROUP BY user_id;

-- 뷰에 대한 권한 설정
GRANT SELECT ON design_stats TO authenticated;


-- =============================================
-- 6. 전체 설계 통계 (관리자용)
-- =============================================

CREATE OR REPLACE VIEW admin_design_stats AS
SELECT
    COUNT(*) as total_designs,
    COUNT(DISTINCT user_id) as users_with_designs,
    COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today_designs,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as week_designs
FROM designs;

GRANT SELECT ON admin_design_stats TO authenticated;
