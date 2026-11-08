-- =============================================
-- 0051 — 시공사례 게시물(collection_posts)은 칸 단위로 읽는다 (표 전체 SELECT 를 거두고 칸마다 준다)
--
-- 0000 부터 collection_posts 는 anon · authenticated 가 표 전체(GRANT ALL)를 읽었다 — 읽기 정책이 USING (true) 라
-- 누구나 모든 게시물의 user_id · design_id · storage_path · generation_id · 학습 동의를 읽을 수 있었다.
-- 이 파일은 읽기만 칸 단위로 바꾼다. 행(누가 어떤 행을 읽고 쓰나 — RLS 정책) · 넣기 · 고치기 · 지우기 권한은 그대로다.
--
-- 1) 누구나 (anon · authenticated) — 앱이 로그인 없이 쓰는 칸
--      id · image_url · category · region · source · place_label · door_color · company_id · like_count · created_at
--      시공사례 탭 segan/collection.js (id · image_url · place_label · door_color · company_id · like_count · source ·
--      created_at — 정렬 · 키셋), 만들기 ③ 참고 사진 segan/make.js loadCases · addLinkRefs (id · image_url · region ·
--      category · source — source 로 거르고 created_at 으로 정렬), 사이트 ai-design.html loadGallery (같은 칸)
-- 2) 로그인한 사람 (authenticated) 만 더 — 본인 게시물을 다루는 화면이 거르고 읽는 칸
--      user_id · storage_path · generation_id · design_id · consent_training
--      segan/activity.js 내 시공사례 (user_id 로 거름 · storage_path · consent_training · design_id, 평가 창은 design_id 로 거름),
--      segan/renders.js · segan/make.js 결과 관리 (user_id · generation_id 로 거름 · storage_path — 내리기 뒤 파일 지우기),
--      사이트 mypage.html · my-designs.html (같은 칸 — 지금은 _redirects 로 앱에 넘어간다)
--      칸 권한은 사람마다 다르게 줄 수 없어서 로그인한 사람은 남의 게시물의 이 칸도 읽는다 — 본인 행만 돌려주는 함수로
--      옮기기 전까지는 그대로 둔다. 그리고 공개 사진 주소(image_url)가 버킷 경로를 그대로 담는다:
--      직접 올린 사진은 '<user_id>/<시각>-<무작위>.<확장자>' (버킷 정책이 첫 칸 = 본인 id 를 본다),
--      AI 연출컷은 '<user_id>/gen-<generation_id>.<확장자>' — user_id · generation_id · storage_path 는 주소에서도 보인다.
-- 3) 아무도 (서버 말고) — title · description · item_unique_id · updated_at (앱이 읽지 않는다)
--    앞으로 새로 붙이는 칸도 GRANT 하기 전에는 anon · authenticated 가 읽지 못한다 (표 전체 권한이 없으므로).
--    앱이 읽을 칸을 새로 만들면 그 마이그레이션에서 GRANT SELECT (칸) 을 함께 적는다.
--
-- 그대로 두는 것: service_role(서버 — generate-api 자동 게시 · dataset-api 수집 · account-api 탈퇴 정리)은 표 전체,
--   정책 · 넣기 · 고치기 · 지우기 권한 · 함수(collection_post_companies · collection_my_likes 는 SECURITY DEFINER —
--   칸 권한과 상관없다) · 트리거(지킴이 · 좋아요 수 · updated_at).
--   넣기(insert)는 RETURNING 없이 (앱은 select 를 붙이지 않는다), 지우기의 RETURNING id 는 1) 의 id 로 된다.
-- 달라지는 것: anon 이 select=* 나 위 1) 밖의 칸을 물으면 권한 없음(42501). 사이트 collection.html(지금은 _redirects 로
--   앱에 넘어간다)이 관리자 내리기용으로 storage_path 를 함께 묻는데, 로그인 전이면 실패하고 칸을 줄인 다음 질의
--   (id · image_url · created_at)로 그린다.
-- 0049 의 칸(place_label · door_color · company_id)이 있어야 돌아간다 — 0049 뒤에 적용한다.
-- 다시 돌려도 된다 — 표 SELECT 를 거두면 칸 SELECT 도 함께 거둬지고(PostgreSQL REVOKE), 같은 칸을 다시 준다.
-- =============================================

REVOKE SELECT ON TABLE public.collection_posts FROM PUBLIC, anon, authenticated;

-- 1) 누구나
GRANT SELECT (id, image_url, category, region, source, place_label, door_color, company_id, like_count, created_at)
    ON TABLE public.collection_posts TO anon, authenticated;

-- 2) 로그인한 사람만 더 — 본인 게시물 화면
GRANT SELECT (user_id, storage_path, generation_id, design_id, consent_training)
    ON TABLE public.collection_posts TO authenticated;

COMMENT ON TABLE public.collection_posts IS '시공사례 게시물 — 읽기는 칸 단위: 누구나 id · image_url · category · region · source · place_label · door_color · company_id · like_count · created_at, 로그인하면 user_id · storage_path · generation_id · design_id · consent_training 도. 새 칸은 GRANT 해야 앱이 읽는다 (0051)';
