-- =============================================
-- 다담가구 관리자 시스템 DB 스키마
-- =============================================

-- 1. Expert 승급 신청 테이블
CREATE TABLE IF NOT EXISTS expert_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    user_name TEXT,
    current_tier TEXT DEFAULT 'standard',
    requested_tier TEXT DEFAULT 'expert',

    -- 신청자 정보
    company_name TEXT,                    -- 회사/상호명
    business_type TEXT,                   -- 업종 (인테리어, 시공, 설계 등)
    business_number TEXT,                 -- 사업자등록번호
    career_years INTEGER,                 -- 경력 연수
    portfolio_url TEXT,                   -- 포트폴리오 링크

    -- 신청 상태
    status TEXT DEFAULT 'pending',        -- pending, approved, rejected
    admin_memo TEXT,                      -- 관리자 메모
    reviewed_by UUID,                     -- 검토한 관리자
    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 상담 신청 테이블
CREATE TABLE IF NOT EXISTS consultations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- 신청자 정보
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,

    -- 상담 내용
    consultation_type TEXT,               -- ai-design, detail-design, estimate, other
    title TEXT NOT NULL,
    description TEXT,
    preferred_date DATE,
    preferred_time TEXT,

    -- 상태 관리
    status TEXT DEFAULT 'pending',        -- pending, confirmed, completed, cancelled
    assigned_to UUID,                     -- 담당자
    admin_memo TEXT,
    confirmed_at TIMESTAMPTZ,

    -- 주문제작 가구 상세 정보 (MVP: 상담 품질 향상)
    furniture_categories TEXT[] DEFAULT '{}'::TEXT[],
    space_type TEXT,                      -- 주방/거실/침실/드레스룸/현관/기타
    space_width_mm INTEGER,
    space_height_mm INTEGER,
    space_depth_mm INTEGER,
    budget_range TEXT,                    -- under_300 / 300_500 / 500_1000 / over_1000
    style_preference TEXT,                -- modern / classic / natural / luxury / scandinavian / other
    request_detail_design BOOLEAN DEFAULT FALSE,  -- 상세설계 권한 신청 체크박스

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 관리자 활동 로그
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_email TEXT,

    action_type TEXT NOT NULL,            -- user_update, tier_change, consultation_update, etc.
    target_type TEXT,                     -- user, consultation, expert_request, etc.
    target_id UUID,

    description TEXT,
    old_value JSONB,
    new_value JSONB,
    ip_address TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 관리자 역할 테이블 (user_metadata 대신 별도 관리)
CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    role TEXT DEFAULT 'support',          -- super_admin, admin, manager, support
    permissions JSONB DEFAULT '[]',       -- 세부 권한 배열

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Row Level Security (RLS) 정책
-- =============================================

-- expert_requests RLS
ALTER TABLE expert_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own requests" ON expert_requests
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own requests" ON expert_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all requests" ON expert_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

CREATE POLICY "Admins can update requests" ON expert_requests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

-- consultations RLS
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consultations" ON consultations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert consultations" ON consultations
    FOR INSERT WITH CHECK (true);  -- 비회원도 상담 신청 가능

CREATE POLICY "Admins can view all consultations" ON consultations
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

CREATE POLICY "Admins can update consultations" ON consultations
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

-- admin_logs RLS
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view logs" ON admin_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

CREATE POLICY "Admins can insert logs" ON admin_logs
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );

-- admin_roles RLS
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

-- 자기 자신의 역할은 항상 조회 가능 (재귀 없음)
CREATE POLICY "Users can view own role" ON admin_roles
    FOR SELECT USING (auth.uid() = user_id);

-- 관리자는 모든 역할 조회 가능 (is_admin() 은 SECURITY DEFINER 로 RLS 우회)
-- is_admin() 함수는 database/fix-admin-rls-recursion.sql 에서 정의
CREATE POLICY "Admins can view all roles" ON admin_roles
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Super admins can manage roles" ON admin_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_roles ar
            WHERE ar.user_id = auth.uid() AND ar.role = 'super_admin'
        )
    );

-- =============================================
-- 인덱스
-- =============================================

CREATE INDEX IF NOT EXISTS idx_expert_requests_status ON expert_requests(status);
CREATE INDEX IF NOT EXISTS idx_expert_requests_user ON expert_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations(status);
CREATE INDEX IF NOT EXISTS idx_consultations_user ON consultations(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

-- =============================================
-- 초기 관리자 설정 (수동 실행 필요)
-- dadamfurniture@gmail.com을 super_admin으로 설정
-- =============================================
-- INSERT INTO admin_roles (user_id, role, permissions)
-- SELECT id, 'super_admin', '["all"]'::jsonb
-- FROM auth.users
-- WHERE email = 'dadamfurniture@gmail.com';
