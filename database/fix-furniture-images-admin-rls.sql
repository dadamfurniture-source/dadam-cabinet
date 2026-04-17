-- =============================================
-- FIX: furniture_images 테이블 + furniture-images Storage 버킷
--      관리자 쓰기 정책 (is_admin() 기반)
--
-- 문제:
--   기존 정책은 auth.role() = 'service_role' 만 쓰기 허용. admin 세션은
--   'authenticated' 역할이라 INSERT/UPDATE/DELETE 가 조용히 0 rows 로
--   차단되어 관리자 페이지에서 업로드/삭제가 동작하지 않음.
--
-- 해결:
--   public.is_admin() (SECURITY DEFINER, admin_roles 기반) 통해 관리자만
--   쓰기 허용. Storage 버킷 정책도 동일하게 설정.
--
-- 전제:
--   public.is_admin() 함수가 존재해야 함 (fix-admin-rls-recursion.sql).
--   'furniture-images' 버킷이 public 으로 존재해야 함.
--
-- 재실행 안전(idempotent).
-- =============================================

-- 1. 버킷 보장 (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('furniture-images', 'furniture-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- =============================================
-- 2. furniture_images 테이블 RLS
-- =============================================

ALTER TABLE furniture_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "furniture_images_read" ON furniture_images;
DROP POLICY IF EXISTS "furniture_images_write" ON furniture_images;
DROP POLICY IF EXISTS "furniture_images_admin_insert" ON furniture_images;
DROP POLICY IF EXISTS "furniture_images_admin_update" ON furniture_images;
DROP POLICY IF EXISTS "furniture_images_admin_delete" ON furniture_images;

-- 2-1. 읽기: 공개
CREATE POLICY "furniture_images_read" ON furniture_images
  FOR SELECT USING (true);

-- 2-2. 쓰기: 관리자만
CREATE POLICY "furniture_images_admin_insert" ON furniture_images
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "furniture_images_admin_update" ON furniture_images
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "furniture_images_admin_delete" ON furniture_images
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- =============================================
-- 3. Storage 버킷 RLS (storage.objects)
-- =============================================

DROP POLICY IF EXISTS "furniture-images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "furniture-images_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "furniture-images_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "furniture-images_delete_admin" ON storage.objects;

-- 3-1. SELECT (읽기/다운로드): public
CREATE POLICY "furniture-images_select_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'furniture-images');

-- 3-2. INSERT (업로드): 관리자만
CREATE POLICY "furniture-images_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'furniture-images'
    AND public.is_admin()
  );

-- 3-3. UPDATE: 관리자만
CREATE POLICY "furniture-images_update_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'furniture-images'
    AND public.is_admin()
  )
  WITH CHECK (
    bucket_id = 'furniture-images'
    AND public.is_admin()
  );

-- 3-4. DELETE: 관리자만
CREATE POLICY "furniture-images_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'furniture-images'
    AND public.is_admin()
  );

-- =============================================
-- 4. 확인
-- =============================================

SELECT policyname, cmd, roles
FROM pg_policies
WHERE (schemaname = 'public' AND tablename = 'furniture_images')
   OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'furniture-images%')
ORDER BY schemaname, tablename, policyname;

DO $$
BEGIN
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'furniture_images + furniture-images 버킷 admin RLS 설정 완료';
  RAISE NOTICE '=============================================';
END $$;
