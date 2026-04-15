-- =============================================
-- FIX: admin_roles RLS 무한 재귀 + is_admin 오버로드 모호성 해결
--
-- 이 파일은 재실행 안전(idempotent)함. Supabase SQL Editor 에 통째로
-- 붙여넣고 Run 하세요.
--
-- 핵심:
--   - is_admin() 오버로드를 전부 DROP 후 0-인자 단일 시그니처로 재생성
--   - 모든 정책 / 트리거를 public.is_admin() 호출로 통일 (ambiguity 제거)
--   - admin_roles 자기참조 SELECT 정책 제거 → 무한 재귀 차단
-- =============================================

-- 0. 기존 is_admin 오버로드 전부 제거 (CASCADE 는 의존 정책도 함께 삭제)
--    아래 CREATE POLICY 로 곧바로 재생성하므로 권한 공백은 단일 트랜잭션 안에서 없음.
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;

-- 1. 단일 is_admin() — 내부에서 auth.uid() 사용, RLS 우회
CREATE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- 2. admin_roles 자기참조 정책 제거 + 교체
DROP POLICY IF EXISTS "Admins can view roles" ON admin_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON admin_roles;
DROP POLICY IF EXISTS "Users can view own role" ON admin_roles;
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

-- 3. profiles 정책
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

-- 7. 상세설계 승인 트리거 — is_admin() 호출
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
