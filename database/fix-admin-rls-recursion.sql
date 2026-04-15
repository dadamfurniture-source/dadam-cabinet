-- =============================================
-- FIX: admin_roles RLS 무한 재귀 해결
--
-- 증상: profiles UPDATE 시 "infinite recursion detected in policy for
--      relation 'admin_roles'" 에러.
--
-- 원인: admin-schema.sql 의 "Admins can view roles" 정책이 admin_roles 를
--      스스로 참조 → 정책 평가가 다시 정책 평가를 호출 → 무한 루프.
--
-- 해결: SECURITY DEFINER 함수 is_admin() 를 만들어 RLS 를 우회하고,
--      모든 관리자 체크 정책이 이 함수를 호출하도록 교체.
--
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE POLICY 패턴 사용.
-- =============================================

-- 1. is_admin 헬퍼 함수 (RLS 우회)
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_roles WHERE user_id = uid);
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. admin_roles 자기참조 정책 제거 + 자신의 역할만 조회 가능하도록 교체
DROP POLICY IF EXISTS "Admins can view roles" ON admin_roles;
DROP POLICY IF EXISTS "Super admins can manage roles" ON admin_roles;

CREATE POLICY "Users can view own role" ON admin_roles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles" ON admin_roles
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Super admins can manage roles" ON admin_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_roles ar
            WHERE ar.user_id = auth.uid() AND ar.role = 'super_admin'
        )
    );
-- 위 ALL 정책은 super_admin 에만 해당되고 Postgres 가 동일 테이블 직접 참조를
-- 허용함 (정책 재귀는 EXISTS 서브쿼리가 RLS 를 또 타지 않음 — SECURITY DEFINER
-- 함수 없이도 ALL/UPDATE/DELETE 에서 안전). SELECT 만 문제였음.

-- 3. profiles 정책: admin_roles 서브쿼리 → is_admin() 함수 호출로 교체
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can update all profiles" ON profiles
    FOR UPDATE USING (public.is_admin());

-- 4. expert_requests 정책
DROP POLICY IF EXISTS "Admins can view all requests" ON expert_requests;
DROP POLICY IF EXISTS "Admins can update requests" ON expert_requests;

CREATE POLICY "Admins can view all requests" ON expert_requests
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can update requests" ON expert_requests
    FOR UPDATE USING (public.is_admin());

-- 5. consultations 정책
DROP POLICY IF EXISTS "Admins can view all consultations" ON consultations;
DROP POLICY IF EXISTS "Admins can update consultations" ON consultations;

CREATE POLICY "Admins can view all consultations" ON consultations
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can update consultations" ON consultations
    FOR UPDATE USING (public.is_admin());

-- 6. admin_logs 정책
DROP POLICY IF EXISTS "Admins can view logs" ON admin_logs;
DROP POLICY IF EXISTS "Admins can insert logs" ON admin_logs;

CREATE POLICY "Admins can view logs" ON admin_logs
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can insert logs" ON admin_logs
    FOR INSERT WITH CHECK (public.is_admin());

-- 7. 상세설계 승인 가드 트리거도 is_admin() 사용하도록 교체
CREATE OR REPLACE FUNCTION public.block_self_dd_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.detaildesign_approved IS DISTINCT FROM NEW.detaildesign_approved THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'detaildesign_approved can only be changed by administrators';
        END IF;
    END IF;
    IF OLD.detaildesign_approved_at IS DISTINCT FROM NEW.detaildesign_approved_at
        OR OLD.detaildesign_approved_by IS DISTINCT FROM NEW.detaildesign_approved_by THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'detaildesign_approved_at / _by can only be changed by administrators';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
