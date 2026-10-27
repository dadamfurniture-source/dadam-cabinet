-- =============================================
-- 시공사례 자동 게시 — AI 스튜디오 연출컷 (2026-10-27)
--
-- 워커(workers/generate-api/src/collection-post.js)가 AI 스튜디오 연출컷이 done 이 되면 대표 연출컷(기본안) 한 장을
-- 공개 버킷 collection 의 '{user_id}/gen-{generation_id}.{ext}' 에 복사하고 collection_posts 행을 만든다.
-- 그 행을 실제 시공 사진과 가르고(source), 같은 연출컷이 두 번 올라가지 않게 하고(generation_id UNIQUE),
-- 관리자가 어느 게시물이든 내릴 수 있게 한다.
--
-- 바꾸는 것:
--   1) collection_posts.source       'upload'(직접 올린 사진, 기본값 — 기존 행 전부) | 'ai_render'(자동 게시)
--   2) collection_posts.generation_id 원본 연출컷. UNIQUE — 워커가 ON CONFLICT (generation_id) DO NOTHING 으로 넣는다.
--                                     연출컷 행이 지워지면 게시물 행도 지워진다 (ON DELETE CASCADE).
--                                     복사한 파일은 워커의 DELETE /api/generate/:id 가 먼저 지운다.
--   3) 관리자 삭제 — collection_posts 행(collection_posts_delete_admin) · collection 버킷 파일(collection_delete_admin).
--      collection.html 의 관리자 「내리기」가 쓴다. 본인 삭제 정책(collection_posts_delete · collection_delete_own)은 그대로.
--
-- 그대로 두는 것: 읽기(누구나), 본인 쓰기 정책, 버킷 공개 설정 (database/collection-schema.sql).
--   자동 게시 행의 consent_training 은 NULL 이다 — 데이터셋 수집(workers/dataset-api)은 true 인 행만 넣는다.
--
-- 순서: 이 파일을 먼저 적용하고 코드를 머지한다. 화면(collection.html · my-designs.html · mypage.html · ai-design.html)이
--   source · generation_id 를 읽는다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 실행. 여러 번 돌려도 같다.
--   선행: database/collection-schema.sql (collection_posts · collection 버킷), database/generations-schema.sql
--   (generations), public.is_admin() (database/fix-admin-rls-recursion.sql).
-- =============================================

BEGIN;

-- 1) 출처
ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'collection_posts_source_check'
       AND conrelid = 'public.collection_posts'::regclass
  ) THEN
    ALTER TABLE public.collection_posts
      ADD CONSTRAINT collection_posts_source_check CHECK (source IN ('upload', 'ai_render'));
  END IF;
END $$;

-- 2) 원본 연출컷 — 하나에 게시물 하나
ALTER TABLE public.collection_posts
  ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'collection_posts_generation_id_key'
       AND conrelid = 'public.collection_posts'::regclass
  ) THEN
    -- 부분 인덱스가 아니라 제약이어야 한다 — PostgREST on_conflict=generation_id 가 ON CONFLICT (generation_id) 로 간다.
    -- NULL 은 서로 다르므로 직접 올린 사진(generation_id NULL)은 몇 장이든 된다.
    ALTER TABLE public.collection_posts
      ADD CONSTRAINT collection_posts_generation_id_key UNIQUE (generation_id);
  END IF;
END $$;

-- 3) 관리자 삭제 — 행
DROP POLICY IF EXISTS "collection_posts_delete_admin" ON public.collection_posts;
CREATE POLICY "collection_posts_delete_admin" ON public.collection_posts
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 3) 관리자 삭제 — collection 버킷 파일
DROP POLICY IF EXISTS "collection_delete_admin" ON storage.objects;
CREATE POLICY "collection_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'collection' AND public.is_admin());

COMMIT;

-- =============================================
-- 확인 (필요할 때 따로 돌린다)
-- =============================================
--
-- ① 열 · 제약
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'collection_posts' AND column_name IN ('source', 'generation_id');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.collection_posts'::regclass
--      AND conname IN ('collection_posts_source_check', 'collection_posts_generation_id_key', 'collection_posts_generation_id_fkey');
--
-- ② 정책
--   SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
--    WHERE (schemaname = 'public' AND tablename = 'collection_posts')
--       OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'collection_%')
--    ORDER BY tablename, policyname;
--
-- ③ 기존 행은 전부 'upload'
--   SELECT source, count(*) FROM public.collection_posts GROUP BY source;
--
-- ④ 배포 뒤 — AI 스튜디오 연출컷 하나가 done 이 되면 행 하나, 파일 하나
--   SELECT id, user_id, generation_id, storage_path, category, created_at
--     FROM public.collection_posts WHERE source = 'ai_render' ORDER BY created_at DESC LIMIT 5;
--
-- =============================================
-- 되돌리기
-- =============================================
--   DROP POLICY IF EXISTS "collection_delete_admin" ON storage.objects;
--   DROP POLICY IF EXISTS "collection_posts_delete_admin" ON public.collection_posts;
--   (자동 게시 행을 지우려면 먼저 파일을 지운다 — storage_path 가 collection 버킷 경로다)
--   ALTER TABLE public.collection_posts DROP CONSTRAINT IF EXISTS collection_posts_generation_id_key;
--   ALTER TABLE public.collection_posts DROP COLUMN IF EXISTS generation_id;
--   ALTER TABLE public.collection_posts DROP CONSTRAINT IF EXISTS collection_posts_source_check;
--   ALTER TABLE public.collection_posts DROP COLUMN IF EXISTS source;
