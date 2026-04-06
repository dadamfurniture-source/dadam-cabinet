-- =============================================
-- 사용자 저장 파트너 (추천 업체 북마크)
-- =============================================

CREATE TABLE IF NOT EXISTS saved_partners (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    context_json JSONB DEFAULT '{}',  -- 저장 시점의 견적/품목 컨텍스트
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, partner_id)  -- 같은 업체 중복 저장 방지
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_saved_partners_user ON saved_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_partners_partner ON saved_partners(partner_id);

-- RLS
ALTER TABLE saved_partners ENABLE ROW LEVEL SECURITY;

-- 자신의 저장만 조회 가능
CREATE POLICY "Users can view own saved partners" ON saved_partners
    FOR SELECT USING (auth.uid() = user_id);

-- 자신만 저장 가능
CREATE POLICY "Users can save partners" ON saved_partners
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 자신의 저장만 삭제 가능
CREATE POLICY "Users can delete own saved partners" ON saved_partners
    FOR DELETE USING (auth.uid() = user_id);
