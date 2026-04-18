-- =============================================
-- FIX: lora_models 테이블 + training-zips Storage 버킷
--      관리자 쓰기 정책 (is_admin() 기반) + 학습 zip 업로드용 버킷
--
-- 전제: public.is_admin() 함수가 존재 (database/fix-admin-rls-recursion.sql)
-- 재실행 안전(idempotent).
-- =============================================

-- =============================================
-- 1. lora_models 테이블 admin RLS
-- =============================================

ALTER TABLE lora_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lora_models_read" ON lora_models;
DROP POLICY IF EXISTS "lora_models_write" ON lora_models;
DROP POLICY IF EXISTS "lora_models_admin_insert" ON lora_models;
DROP POLICY IF EXISTS "lora_models_admin_update" ON lora_models;
DROP POLICY IF EXISTS "lora_models_admin_delete" ON lora_models;

-- 1-1. 읽기: 공개 (Worker 가 inference 시 조회)
CREATE POLICY "lora_models_read" ON lora_models
  FOR SELECT USING (true);

-- 1-2. 쓰기: 관리자만 (mcp-server 가 사용자 토큰으로 호출)
CREATE POLICY "lora_models_admin_insert" ON lora_models
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "lora_models_admin_update" ON lora_models
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "lora_models_admin_delete" ON lora_models
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- =============================================
-- 2. training-zips Storage 버킷
--    LoRA 학습용 이미지 zip 을 Replicate 에 넘기기 위해 public URL 필요
-- =============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('training-zips', 'training-zips', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "training-zips_select_public" ON storage.objects;
DROP POLICY IF EXISTS "training-zips_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "training-zips_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "training-zips_delete_admin" ON storage.objects;

-- 2-1. SELECT: public (Replicate 가 zip 을 다운로드)
CREATE POLICY "training-zips_select_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'training-zips');

-- 2-2. INSERT/UPDATE/DELETE: 관리자만
CREATE POLICY "training-zips_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'training-zips'
    AND public.is_admin()
  );

CREATE POLICY "training-zips_update_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'training-zips' AND public.is_admin())
  WITH CHECK (bucket_id = 'training-zips' AND public.is_admin());

CREATE POLICY "training-zips_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'training-zips' AND public.is_admin());

-- =============================================
-- 3. 확인
-- =============================================

SELECT policyname, cmd
FROM pg_policies
WHERE (schemaname = 'public' AND tablename = 'lora_models')
   OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'training-zips%')
ORDER BY schemaname, tablename, policyname;

DO $$
BEGIN
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'lora_models + training-zips 버킷 admin RLS 설정 완료';
  RAISE NOTICE '=============================================';
END $$;
