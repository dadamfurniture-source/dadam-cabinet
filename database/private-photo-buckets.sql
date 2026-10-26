-- =============================================
-- 고객 사진 버킷 비공개 전환 — generations · design-images (+ training-zips)
--
-- 왜: 두 버킷이 공개라 주소만 알면 누구나 열 수 있고, 공개 SELECT 정책 때문에 anon 키로
--   파일 목록(LIST)까지 볼 수 있다. 고객이 올린 방 사진과 연출컷이 들어 있다.
--
-- 바꾸는 것:
--   1) generations · design-images 를 비공개로 (public = false)
--   2) 공개 SELECT 정책을 이름으로 지운다
--        generations_objects_select_public   (database/generations-schema.sql)
--        design-images_select_public         (database/storage-policies.sql)
--   3) SELECT 정책 둘씩 더한다 — 본인(첫 폴더 = auth.uid()) · 관리자(public.is_admin())
--        경로가 둘 다 '<user uuid>/…' 이다:
--          generations    '<user uuid>/<generation id>/<file>'  (workers/generate-api 가 service_role 로 올린다)
--          design-images  '<user uuid>/…'                       (js/supabase-utils.js · 본인 세션으로 올린다)
--   4) training-zips 도 비공개로 + 공개 SELECT 정책(training-zips_select_public)을 지운다.
--        사이트 코드가 읽지도 쓰지도 않는다 — LoRA 학습 파이프라인(#183)이 Replicate 에 넘기려고 공개로 만들었고
--        #192 에서 파이프라인째 되돌렸다. 들어 있는 것은 카탈로그 사진(furniture_images) 묶음이다.
--        읽는 곳이 없으므로 새 SELECT 정책은 두지 않는다 (대시보드·service_role 은 RLS 를 거치지 않는다).
--
-- 그대로 두는 것: 쓰기 정책 (design-images_insert_own · _update_own · _delete_own, training-zips_*_admin),
--   generations 쓰기는 원래 service_role 만이다. 공개로 남는 버킷: theme-images · furniture-images ·
--   reference-images · fridge-refs · collection · appliance-images.
--
-- 순서: 코드 PR(서명 URL)이 배포된 뒤에 실행한다. 코드는 버킷이 공개든 비공개든 같은 화면을 낸다 —
--   본인 화면·관리자 화면은 로그인 세션으로 서명 URL 을 만들고(js/storage-urls.js),
--   공유 열람(GET /api/share)·본인 조회(GET /api/generate/:id)는 워커가 service_role 로 서명한다.
--   DB 행의 공개 URL 은 옮기지 않는다 — 읽을 때 경로를 꺼내 서명한다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 실행. 여러 번 돌려도 같다.
--   SQL Editor 역할이 storage.buckets 를 못 고치는 프로젝트면(권한 오류) 대시보드 Storage 에서
--   세 버킷의 Public 을 끄고, 아래 1) 의 UPDATE 를 지운 뒤 나머지를 실행한다.
--
-- 주의: database/generations-schema.sql · database/storage-policies.sql 을 다시 돌리면
--   두 버킷이 public = TRUE 와 공개 SELECT 정책으로 돌아간다. 이 파일을 적용한 뒤에는 그 두 파일의
--   버킷 부분을 돌리지 않는다.
-- =============================================

BEGIN;

-- 1) 비공개로
UPDATE storage.buckets
   SET public = FALSE
 WHERE id IN ('generations', 'design-images', 'training-zips');

-- 2) 공개 SELECT 정책 지우기 (이름 그대로)
DROP POLICY IF EXISTS "generations_objects_select_public" ON storage.objects;
DROP POLICY IF EXISTS "design-images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "training-zips_select_public" ON storage.objects;

-- 3) 읽기 = 본인 · 관리자 (서명 URL 발급도 이 SELECT 정책을 본다)
DROP POLICY IF EXISTS "generations_objects_select_own" ON storage.objects;
CREATE POLICY "generations_objects_select_own" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'generations'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "generations_objects_select_admin" ON storage.objects;
CREATE POLICY "generations_objects_select_admin" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'generations'
        AND public.is_admin()
    );

DROP POLICY IF EXISTS "design-images_select_own" ON storage.objects;
CREATE POLICY "design-images_select_own" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'design-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "design-images_select_admin" ON storage.objects;
CREATE POLICY "design-images_select_admin" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'design-images'
        AND public.is_admin()
    );

COMMIT;

-- =============================================
-- 확인 (실행하지 않고 필요할 때 따로 돌린다)
-- =============================================
--
-- ① 버킷 — 셋 다 public = false
--   SELECT id, public FROM storage.buckets
--    WHERE id IN ('generations', 'design-images', 'training-zips') ORDER BY id;
--
-- ② 세 버킷의 정책 — SELECT 는 *_select_own · *_select_admin 넷만 남고, roles 에 {public} 인 SELECT 가 없어야 한다
--    (training-zips 는 SELECT 가 하나도 없어야 한다. 이름이 다른 공개 정책이 남아 있으면 여기서 보인다)
--   SELECT policyname, cmd, roles, qual
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND (   coalesce(qual, '') || coalesce(with_check, '') LIKE '%generations%'
--           OR coalesce(qual, '') || coalesce(with_check, '') LIKE '%design-images%'
--           OR coalesce(qual, '') || coalesce(with_check, '') LIKE '%training-zips%')
--    ORDER BY policyname;
--
-- ③ 공개 주소가 닫혔는지 — 저장된 공개 URL 하나를 로그인 없이 열면 400/404 (예전엔 200)
--   SELECT images->0->>'url' FROM public.generations WHERE status = 'done' ORDER BY created_at DESC LIMIT 1;
--   → 그 주소를 브라우저 시크릿 창에서 연다
--
-- ④ 목록이 닫혔는지 — anon 키로 LIST 하면 빈 배열
--   curl -s -X POST "https://<project>.supabase.co/storage/v1/object/list/generations" \
--     -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
--     -d '{"prefix":"","limit":5}'
--
-- ⑤ 화면 — 로그인해서 my-designs.html 썸네일·상세, ai-design.html?g=<id>, 공유 링크(design-share.html#t=…),
--   관리자 admin/dataset.html 검수 사진이 보이는지
--
-- =============================================
-- 되돌리기 (문제가 생기면)
-- =============================================
--   UPDATE storage.buckets SET public = TRUE WHERE id IN ('generations', 'design-images', 'training-zips');
--   CREATE POLICY "generations_objects_select_public" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'generations');
--   CREATE POLICY "design-images_select_public" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'design-images');
--   CREATE POLICY "training-zips_select_public" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'training-zips');
--   (본인·관리자 정책은 남겨 두어도 된다)
