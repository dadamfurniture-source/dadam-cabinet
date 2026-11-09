-- =============================================
-- 0054 — 시공사례 사진(collection 버킷) 옛 경로 정책을 거둔다 (첫 칸 = 회원 id)
--
-- 0052 는 새 경로 'p/<uuid>' · 'ai/<uuid>' 를 열면서 옛 정책 셋을 남겨 두었다 — 그때 앱은 아직 옛 경로
-- '<user_id>/…' 로 올렸다. 이제 옛 경로를 쓰는 곳이 없다:
--   직접 올린 사진    segan/activity.js 가 'p/<uuid>.<jpg|png>' 로 올린다 (넣기 collection_insert_photo)
--   AI 연출컷 복사본  workers/generate-api collection-post.js 가 'ai/<uuid>.<확장자>' 로 올린다 (service_role)
--   옛 게시물         'ai/…' 로 옮겼고, 옛 경로 파일은 지웠다 (남은 것 없음)
--
-- 1) storage 정책 셋을 지운다 (bucket 'collection', 셋 다 첫 칸 = 본인 id 를 본다)
--      collection_insert_own   넣기 TO authenticated
--      collection_update_own   고치기 TO authenticated
--      collection_delete_own   지우기 TO authenticated
--
-- 남는 collection 버킷 정책 (손대지 않는다):
--   collection_select_public  읽기 TO public — 버킷 전체 (공개 버킷)
--   collection_delete_admin   지우기 TO authenticated — 관리자, 버킷 전체 (collection.html 관리자 「내리기」)
--   collection_insert_photo   넣기 TO authenticated — 'p/<uuid 소문자>.(jpg|png)' 한 칸, owner_id = 본인 (0052)
--   collection_delete_owner   지우기 TO authenticated — 'p/…' · 'ai/…' 중 owner_id = 본인 (0052)
--   → 회원은 'p/' 에 새로 넣고, 주인인 자기 파일을 지우기만 한다. 고치기(upsert) 정책은 남지 않는다
--     (앱은 upsert: false 로 올린다). 'ai/' 에는 서버만 넣는다.
--
-- 그대로 두는 것: 0052 의 트리거 trg_collection_posts_ai_owner · 함수 collection_owned_objects,
--   collection_posts 표 · 정책 · 권한 · 지킴이, 버킷 정의, 다른 버킷의 정책.
-- 이 파일은 파일 · 행을 건드리지 않는다.
--
-- 알고 둔 것: 쓰지 않는 사이트 페이지 mypage.html (_redirects 가 /segan/me 로 보낸다) 에는 옛 경로
--   '<user_id>/…' 로 올리는 코드가 남아 있다 — 이 파일 뒤로는 그 올리기가 정책에 막혀 실패한다.
--   그 페이지는 고치지 않는다.
-- 다시 돌려도 된다 (DROP POLICY IF EXISTS).
-- =============================================

DROP POLICY IF EXISTS collection_insert_own ON storage.objects;
DROP POLICY IF EXISTS collection_update_own ON storage.objects;
DROP POLICY IF EXISTS collection_delete_own ON storage.objects;
