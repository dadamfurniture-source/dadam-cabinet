-- =============================================
-- Supabase Storage 버킷 정책 설정
-- design-images 버킷용 RLS 정책
--
-- 사용법: Supabase Dashboard > SQL Editor에서 실행
-- =============================================

-- 1. design-images 버킷이 없으면 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-images', 'design-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- =============================================
-- 2. 기존 정책 삭제 (재설정용)
-- =============================================

DROP POLICY IF EXISTS "Allow authenticated users to upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update own files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete own files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to design-images" ON storage.objects;
DROP POLICY IF EXISTS "design-images_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "design-images_update_own" ON storage.objects;
DROP POLICY IF EXISTS "design-images_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "design-images_select_public" ON storage.objects;

-- =============================================
-- 3. Storage 정책 생성
-- =============================================

-- 3-1. INSERT (업로드): 인증된 사용자가 본인 폴더에만 업로드 가능
-- 경로 형식: {user_id}/{filename}
CREATE POLICY "design-images_insert_own" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'design-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3-2. UPDATE: 인증된 사용자가 본인 파일만 수정 가능
CREATE POLICY "design-images_update_own" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'design-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'design-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3-3. DELETE: 인증된 사용자가 본인 파일만 삭제 가능
CREATE POLICY "design-images_delete_own" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'design-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3-4. SELECT (읽기/다운로드): 공개 버킷이므로 모든 사용자 허용
CREATE POLICY "design-images_select_public" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'design-images');

-- =============================================
-- 4. 확인 쿼리
-- =============================================

-- 설정된 정책 확인
SELECT
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND policyname LIKE 'design-images%';

-- =============================================
-- 완료 메시지
-- =============================================

DO $$
BEGIN
    RAISE NOTICE '=============================================';
    RAISE NOTICE 'Storage 정책 설정 완료!';
    RAISE NOTICE '';
    RAISE NOTICE '설정된 정책:';
    RAISE NOTICE '  - design-images_insert_own: 본인 폴더 업로드';
    RAISE NOTICE '  - design-images_update_own: 본인 파일 수정';
    RAISE NOTICE '  - design-images_delete_own: 본인 파일 삭제';
    RAISE NOTICE '  - design-images_select_public: 공개 읽기';
    RAISE NOTICE '=============================================';
END $$;
