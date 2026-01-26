-- =============================================
-- 다담가구 RLS 정책 강화
-- 보안 취약점 보완 및 성능 최적화
-- =============================================

-- =============================================
-- 1. 관리자 역할 테이블 (없는 경우 생성)
-- =============================================

CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'super_admin', 'moderator')),
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

-- 관리자 역할은 슈퍼 관리자만 조회/수정 가능
CREATE POLICY "Super admins can manage admin roles" ON admin_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_roles ar
            WHERE ar.user_id = auth.uid() AND ar.role = 'super_admin'
        )
    );


-- =============================================
-- 2. 감사 로그 테이블
-- =============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 감사 로그는 관리자만 조회 가능
CREATE POLICY "Admins can view audit logs" ON audit_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid())
    );


-- =============================================
-- 3. 보안 헬퍼 함수
-- =============================================

-- 사용자가 관리자인지 확인
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM admin_roles
        WHERE user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 사용자가 슈퍼 관리자인지 확인
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM admin_roles
        WHERE user_id = auth.uid() AND role = 'super_admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 사용자가 리소스 소유자인지 확인
CREATE OR REPLACE FUNCTION is_owner(resource_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN auth.uid() = resource_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 사용자가 전문가 이상인지 확인
CREATE OR REPLACE FUNCTION is_expert_or_above()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role IN ('expert', 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- =============================================
-- 4. 강화된 RLS 정책 (기존 정책 대체)
-- =============================================

-- designs 테이블 정책 재정의
DROP POLICY IF EXISTS "Users can view own designs" ON designs;
DROP POLICY IF EXISTS "Users can create own designs" ON designs;
DROP POLICY IF EXISTS "Users can update own designs" ON designs;
DROP POLICY IF EXISTS "Users can delete own designs" ON designs;
DROP POLICY IF EXISTS "Admins can view all designs" ON designs;

-- 본인 설계 조회 (최적화된 쿼리)
CREATE POLICY "designs_select_own" ON designs
    FOR SELECT USING (
        user_id = auth.uid() OR is_admin()
    );

-- 본인 설계 생성 (user_id 자동 설정 검증)
CREATE POLICY "designs_insert_own" ON designs
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
    );

-- 본인 설계 수정 (status 변경 제한)
CREATE POLICY "designs_update_own" ON designs
    FOR UPDATE USING (
        user_id = auth.uid()
    ) WITH CHECK (
        user_id = auth.uid() AND
        -- completed 상태에서는 일반 사용자가 수정 불가
        (status != 'completed' OR is_admin())
    );

-- 본인 설계 삭제 (submitted 이후는 삭제 불가)
CREATE POLICY "designs_delete_own" ON designs
    FOR DELETE USING (
        user_id = auth.uid() AND
        status IN ('draft') AND
        NOT is_admin() -- 관리자는 별도 정책
    );

-- 관리자 삭제 권한
CREATE POLICY "designs_delete_admin" ON designs
    FOR DELETE USING (is_admin());


-- =============================================
-- 5. design_items 정책 강화
-- =============================================

DROP POLICY IF EXISTS "Users can manage own design items" ON design_items;

-- 아이템 조회: 부모 설계 소유자 또는 관리자
CREATE POLICY "items_select" ON design_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_id
            AND (d.user_id = auth.uid() OR is_admin())
        )
    );

-- 아이템 생성: 부모 설계 소유자만
CREATE POLICY "items_insert" ON design_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_id
            AND d.user_id = auth.uid()
            AND d.status IN ('draft', 'in_review') -- 진행 중인 설계에만 추가 가능
        )
    );

-- 아이템 수정: 부모 설계 소유자만, 완료된 설계는 수정 불가
CREATE POLICY "items_update" ON design_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_id
            AND d.user_id = auth.uid()
            AND d.status != 'completed'
        )
    );

-- 아이템 삭제: 부모 설계 소유자만, 드래프트에서만
CREATE POLICY "items_delete" ON design_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_id
            AND d.user_id = auth.uid()
            AND d.status = 'draft'
        )
    );


-- =============================================
-- 6. user_profiles 정책 강화
-- =============================================

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

-- 프로필 조회: 본인 또는 관리자
CREATE POLICY "profiles_select" ON user_profiles
    FOR SELECT USING (
        id = auth.uid() OR is_admin()
    );

-- 프로필 수정: 본인만 (역할 변경 불가)
CREATE POLICY "profiles_update_own" ON user_profiles
    FOR UPDATE USING (
        id = auth.uid()
    ) WITH CHECK (
        id = auth.uid() AND
        -- 일반 사용자는 role 변경 불가
        (role = (SELECT role FROM user_profiles WHERE id = auth.uid()) OR is_admin())
    );

-- 관리자 프로필 수정 (역할 변경 포함)
CREATE POLICY "profiles_update_admin" ON user_profiles
    FOR UPDATE USING (is_admin());


-- =============================================
-- 7. Storage 버킷 정책
-- =============================================

-- design-images 버킷 정책
-- (Supabase Dashboard > Storage > Policies 에서도 설정 필요)

-- 본인 폴더만 접근 가능
-- 경로 형식: {user_id}/{filename}
CREATE OR REPLACE FUNCTION storage_is_owner(path TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- 경로의 첫 번째 세그먼트가 user_id와 일치하는지 확인
    RETURN split_part(path, '/', 1) = auth.uid()::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- =============================================
-- 8. Rate Limiting 함수 (선택적)
-- =============================================

CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    request_count INT DEFAULT 1,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, action)
);

-- Rate limit 확인 함수
CREATE OR REPLACE FUNCTION check_rate_limit(
    action_name TEXT,
    max_requests INT DEFAULT 100,
    window_minutes INT DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INT;
    window_start_time TIMESTAMPTZ;
BEGIN
    -- 현재 윈도우 내 요청 수 확인
    SELECT request_count, window_start INTO current_count, window_start_time
    FROM rate_limits
    WHERE user_id = auth.uid() AND action = action_name;

    -- 레코드가 없거나 윈도우 만료된 경우 초기화
    IF current_count IS NULL OR window_start_time < NOW() - (window_minutes || ' minutes')::INTERVAL THEN
        INSERT INTO rate_limits (user_id, action, request_count, window_start)
        VALUES (auth.uid(), action_name, 1, NOW())
        ON CONFLICT (user_id, action)
        DO UPDATE SET request_count = 1, window_start = NOW();
        RETURN TRUE;
    END IF;

    -- 제한 초과 확인
    IF current_count >= max_requests THEN
        RETURN FALSE;
    END IF;

    -- 카운트 증가
    UPDATE rate_limits
    SET request_count = request_count + 1
    WHERE user_id = auth.uid() AND action = action_name;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 9. 감사 로그 트리거
-- =============================================

-- 주요 테이블 변경 시 감사 로그 기록
CREATE OR REPLACE FUNCTION log_audit_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data)
        VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
        VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
        VALUES (auth.uid(), 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- designs 테이블 감사 로그
DROP TRIGGER IF EXISTS audit_designs ON designs;
CREATE TRIGGER audit_designs
    AFTER INSERT OR UPDATE OR DELETE ON designs
    FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- user_profiles 테이블 감사 로그 (역할 변경 추적)
DROP TRIGGER IF EXISTS audit_user_profiles ON user_profiles;
CREATE TRIGGER audit_user_profiles
    AFTER UPDATE ON user_profiles
    FOR EACH ROW
    WHEN (OLD.role IS DISTINCT FROM NEW.role)
    EXECUTE FUNCTION log_audit_change();


-- =============================================
-- 10. 보안 권장 설정
-- =============================================

-- 익명 사용자 제한 (인증된 사용자만)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 기본 권한 설정
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 관리자 전용 테이블 권한
REVOKE ALL ON admin_roles FROM authenticated;
GRANT SELECT ON admin_roles TO authenticated; -- RLS로 제어됨

REVOKE ALL ON audit_logs FROM authenticated;
GRANT SELECT ON audit_logs TO authenticated; -- RLS로 제어됨


-- =============================================
-- 11. 유틸리티 뷰 (사용자 친화적)
-- =============================================

-- 내 설계 요약 뷰
CREATE OR REPLACE VIEW my_designs_summary AS
SELECT
    id,
    name,
    status,
    total_items,
    created_at,
    updated_at
FROM designs
WHERE user_id = auth.uid()
ORDER BY updated_at DESC;

GRANT SELECT ON my_designs_summary TO authenticated;

-- 내 프로필 뷰
CREATE OR REPLACE VIEW my_profile AS
SELECT
    id,
    email,
    name,
    phone,
    role,
    created_at
FROM user_profiles
WHERE id = auth.uid();

GRANT SELECT ON my_profile TO authenticated;


-- =============================================
-- 마이그레이션 완료 메시지
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'RLS 정책 강화 완료';
    RAISE NOTICE '- 관리자 역할 테이블 생성';
    RAISE NOTICE '- 감사 로그 테이블 생성';
    RAISE NOTICE '- 보안 헬퍼 함수 생성';
    RAISE NOTICE '- designs, design_items, user_profiles 정책 강화';
    RAISE NOTICE '- Rate Limiting 함수 생성';
    RAISE NOTICE '- 감사 로그 트리거 설정';
END $$;
