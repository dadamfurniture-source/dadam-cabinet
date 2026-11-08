-- =============================================
-- 0052 — 시공사례 사진(collection 버킷) 경로에서 회원 id 를 뺀다
--
-- collection 은 공개 버킷이다. 지금 파일 경로의 첫 칸이 올린 사람 id 라 공개 주소(collection_posts.image_url)만
-- 보고도 사진을 올린 사람마다 묶을 수 있다 — 0051 이 user_id 칸을 anon 에서 감췄어도 주소에 남는다:
--   직접 올린 사진    '<user_id>/<시각>-<무작위>.<확장자>'    segan/activity.js (버킷 정책이 첫 칸 = 본인 id 를 본다)
--   AI 연출컷 복사본  '<user_id>/gen-<generation_id>.<확장자>' workers/generate-api collection-post.js (service_role)
-- 새 경로에는 사람 · 연출컷을 알아볼 것이 없다 — 앞 칸 하나 + 무작위 UUID:
--   직접 올린 사진    'p/<uuid>.<jpg|png>'    회원이 올린다. 주인은 storage.objects.owner_id (Storage 가 올린 사람으로 채운다)
--   AI 연출컷 복사본  'ai/<uuid>.<확장자>'    서버가 올린다. 주인은 그 게시물 행이 정한다 (아래 2)
--
-- 1) storage 정책 둘을 더한다 (bucket 'collection') — 옛 정책은 그대로 둔다 (지금 앱은 아직 옛 경로로 올린다)
--      collection_insert_photo  넣기 TO authenticated — 이름은 'p/<uuid 소문자>.(jpg|png)' 한 칸, owner_id = 본인
--      collection_delete_owner  지우기 TO authenticated — 'p/…' · 'ai/…' 중 owner_id = 본인
--                               (내리기 · 탈퇴 전 정리 · 줄을 못 넣었을 때 올린 파일 되돌리기)
--    'ai/' 에는 회원이 넣지 못한다. 새 경로에 고치기(upsert)는 주지 않는다 (앱은 upsert: false 로 올린다).
--    읽기 collection_select_public · 관리자 지우기 collection_delete_admin 은 그대로 (버킷 전체).
-- 2) AI 연출컷 복사본의 주인 — 트리거 trg_collection_posts_ai_owner (AFTER INSERT OR UPDATE OF storage_path)
--      source 'ai_render' 게시물이 'ai/…' 파일을 가리키면 그 파일의 owner_id 를 게시물 user_id 로 (주인이 비었을 때만).
--      서버(service_role)가 올린 파일은 주인이 비어 있다. 회원이 「시공사례에서 내리기」(segan/make.js unpost —
--      행을 지운 뒤 파일을 지운다)를 하면 1) 의 지우기 정책으로 지운다. 옛 경로에서 첫 칸 = 본인 id 가 하던 일이다.
--      ai_render 행은 서버만 넣는다 (넣기 정책은 source 'upload' 만, 고치기는 지킴이 0049 가 source 를 못 바꾸게 해
--      ai_render 행에는 정책 WITH CHECK 가 걸린다) — 회원이 이 트리거로 남의 파일 주인이 될 길이 없다.
--      채우기: 이미 있는 'ai/…' 복사본 중 주인이 빈 것 (워커 배포가 이 파일보다 먼저였을 때)
-- 3) collection_owned_objects(회원) — 회원이 주인인 'p/…' · 'ai/…' 파일 경로. service_role 만
--      (탈퇴 정리 workers/account-api — 새 경로에는 회원 폴더가 없어 Storage 목록으로 찾지 못한다).
--      옛 '<user_id>/…' 는 넣지 않는다 (그 폴더는 탈퇴 정리가 목록으로 따로 지운다).
--
-- 그대로 두는 것: 옛 정책 collection_insert_own · collection_update_own · collection_delete_own (첫 칸 = 본인 id) —
--   앱이 새 경로로 올리고 옛 파일을 옮겨 지운 뒤 다음 번호에서 거둔다. collection_posts 표 · 정책 · 권한 · 지킴이, 버킷 정의.
-- 이 파일은 파일을 옮기지 않는다 (옛 게시물의 경로 · 주소는 그대로다).
-- 다시 돌려도 된다 (DROP … IF EXISTS 다음 CREATE · OR REPLACE · 채우기는 주인이 빈 것만).
-- =============================================

-- 1) storage 정책 ---------------------------------------------------------------------

DROP POLICY IF EXISTS collection_insert_photo ON storage.objects;
CREATE POLICY collection_insert_photo ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'collection'
        AND name ~ '^p/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
        AND owner_id = ((SELECT auth.uid()))::text
    );

DROP POLICY IF EXISTS collection_delete_owner ON storage.objects;
CREATE POLICY collection_delete_owner ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'collection'
        AND (storage.foldername(name))[1] IN ('p', 'ai')
        AND owner_id = ((SELECT auth.uid()))::text
    );

-- 2) AI 연출컷 복사본의 주인 ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_posts_ai_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE storage.objects o
     SET owner_id = NEW.user_id::text
   WHERE o.bucket_id = 'collection'
     AND o.name = NEW.storage_path
     AND o.owner_id IS NULL;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.collection_posts_ai_owner() IS 'AI 연출컷 게시물(ai_render)이 가리키는 collection 버킷 ''ai/…'' 파일의 owner_id 를 게시물 user_id 로 — 주인이 빈 파일만. 회원이 내리기로 그 파일을 지울 수 있게 (트리거 전용, 0052)';

REVOKE ALL ON FUNCTION public.collection_posts_ai_owner() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_collection_posts_ai_owner ON public.collection_posts;
CREATE TRIGGER trg_collection_posts_ai_owner AFTER INSERT OR UPDATE OF storage_path ON public.collection_posts FOR EACH ROW WHEN (((new.source = 'ai_render'::text) AND (new.user_id IS NOT NULL) AND (new.storage_path ~~ 'ai/%'::text))) EXECUTE FUNCTION public.collection_posts_ai_owner();

-- 채우기 — 이미 있는 'ai/…' 복사본 중 주인이 빈 것
UPDATE storage.objects o
   SET owner_id = p.user_id::text
  FROM public.collection_posts p
 WHERE p.source = 'ai_render'
   AND p.user_id IS NOT NULL
   AND p.storage_path LIKE 'ai/%'
   AND o.bucket_id = 'collection'
   AND o.name = p.storage_path
   AND o.owner_id IS NULL;

-- 3) 탈퇴 정리용 — 회원이 주인인 새 경로 파일 ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_owned_objects(p_user_id uuid)
 RETURNS TABLE(path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'collection'
     AND o.owner_id = p_user_id::text
     AND (storage.foldername(o.name))[1] IN ('p', 'ai')
   ORDER BY o.name;
$function$;

COMMENT ON FUNCTION public.collection_owned_objects(uuid) IS '회원이 주인(owner_id)인 collection 버킷 새 경로 파일 — ''p/…'' · ''ai/…'' 만 (옛 ''<user_id>/…'' 빼고). 탈퇴 정리(workers/account-api)용, service_role 만 (0052)';

REVOKE ALL ON FUNCTION public.collection_owned_objects(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_owned_objects(uuid) TO service_role;
