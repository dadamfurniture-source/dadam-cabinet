-- =============================================
-- 0076 시공사례 — 앱에 넣어 둔 AI 연출 사진 36장을 게시물로 (2026-11-21 대표님 「하트 달아주고」)
--
-- 앱 시공사례 탭(segan/collection.js)은 DB 게시물 뒤에 AI 연출 사진 36장(STATIC — app/portfolio/luxe-manifest.json)을 붙여 보였다.
-- 그 사진들은 게시물 행이 없어 좋아요(collection_likes.post_id)를 저장할 곳이 없었다 — 화면에 ♡ 가 한 칸도 없었다.
-- 36장을 collection_posts 행으로 넣는다. 그러면 ♡ · 좋아요 수 · 마이페이지 「좋아요」가 다른 게시물과 똑같이 돈다.
--
-- 넣는 값
--   source 'ai_render' · hq_picked_at now() — 탭이 읽는 조건(직접 올린 사진 또는 본사가 고른 연출컷, 0075)에 든다.
--                      실제 시공 사진이 아니므로 화면의 업체 칸은 「AI 연출」(연출컷 규칙 그대로)
--   image_url         사이트의 그 파일 주소 (https://dadamfurniture.com/app/portfolio/<이름>.jpg). 앱은 이 주소를 알아보고
--                      가벼운 사본(app/portfolio/display/)을 칸에 쓴다 (segan/collection-view.js fromRow)
--   category          목록 파일의 구분 (kitchen · builtin · storage · interior · other)
--   place_label       품목 이름 (「일자형 주방」) — 지역은 없다
--   door_color        자재 이름 「이름 · 이름」 (예림 도어 자재, 20자 안)
--   created_at        2026-11-20 00:00 UTC 에서 1분씩 앞으로 — 앱에서 보이던 차례 그대로(최신순), 나중에 올라오는 게시물이 위에 온다
--   consent_training  false — AI 로 만든 사진이다. 시공 사진 학습 자료(workers/dataset-api)로 쓰지 않는다
--   user_id · company_id · generation_id · storage_path · hq_picked_by  비움 (올린 회원 · 업체 · 연출컷 · 버킷 파일이 없다)
--
-- 그대로 두는 것: 칸 · 정책 · 권한 · 함수 · 트리거. 행만 넣는다.
-- 다시 돌려도 된다 — 같은 image_url 이 이미 있으면 넣지 않는다 (누가 내린 사진은 다시 돌리면 돌아온다).
-- 되돌리기: DELETE FROM public.collection_posts WHERE image_url LIKE 'https://dadamfurniture.com/app/portfolio/%' AND generation_id IS NULL;
--           (좋아요 줄은 collection_likes 의 ON DELETE CASCADE 로 같이 지워진다)
-- =============================================

INSERT INTO public.collection_posts
    (image_url, category, place_label, door_color, source, hq_picked_at, consent_training, created_at, updated_at)
SELECT v.image_url, v.category, v.place_label, v.door_color, 'ai_render', now(), false,
       timestamptz '2026-11-20 00:00:00+00' - make_interval(mins => v.ord),
       now()
  FROM (VALUES
    ( 0, 'https://dadamfurniture.com/app/portfolio/mix-01.jpg', 'kitchen', '일자형 주방', '매트 딥그린 · 카카오월넛'),
    ( 1, 'https://dadamfurniture.com/app/portfolio/mix-10.jpg', 'builtin', '안방 붙박이장', '매트 카페브라운 · 매트 아이보리'),
    ( 2, 'https://dadamfurniture.com/app/portfolio/luxe-01.jpg', 'kitchen', '아일랜드 주방', '매트 화이트 · 세이오크'),
    ( 3, 'https://dadamfurniture.com/app/portfolio/mix-16.jpg', 'storage', '홈카페장', '아크 마멀레이드 · 매트 아이보리'),
    ( 4, 'https://dadamfurniture.com/app/portfolio/mix-02.jpg', 'kitchen', '아일랜드 주방', '매트 블랙 · 카타니아 오크'),
    ( 5, 'https://dadamfurniture.com/app/portfolio/luxe-10.jpg', 'builtin', '안방 붙박이장', '매트 캐시미어 · 세이오크'),
    ( 6, 'https://dadamfurniture.com/app/portfolio/luxe-02.jpg', 'kitchen', '일자형 주방', '매트 아이보리 · 슈가엘름'),
    ( 7, 'https://dadamfurniture.com/app/portfolio/luxe-13.jpg', 'storage', '홈카페장', '매트 밀크화이트 · 세이오크'),
    ( 8, 'https://dadamfurniture.com/app/portfolio/mix-03.jpg', 'kitchen', 'ㄱ자형 주방', '매트 인디고 · 매트 화이트'),
    ( 9, 'https://dadamfurniture.com/app/portfolio/mix-11.jpg', 'builtin', '드레스룸', '그레이쉬 오크 · 매트 다크그레이'),
    (10, 'https://dadamfurniture.com/app/portfolio/luxe-03.jpg', 'kitchen', 'ㄱ자형 주방', '매트 밀크화이트 · 매트 샌드그레이'),
    (11, 'https://dadamfurniture.com/app/portfolio/mix-17.jpg', 'storage', '거실 수납장', '매트 다크그레이 · 소프트월넛'),
    (12, 'https://dadamfurniture.com/app/portfolio/mix-04.jpg', 'kitchen', 'ㄷ자형 주방', '매트 미스트그린 · 매트 아이보리'),
    (13, 'https://dadamfurniture.com/app/portfolio/luxe-11.jpg', 'builtin', '드레스룸', '매트 화이트 · 프렌치오크'),
    (14, 'https://dadamfurniture.com/app/portfolio/luxe-04.jpg', 'kitchen', 'ㄷ자형 주방', '매트 캐시미어 · 프렌치오크'),
    (15, 'https://dadamfurniture.com/app/portfolio/luxe-14.jpg', 'storage', '다이닝 수납장', '매트 샌드그레이 · 매트 밀크화이트'),
    (16, 'https://dadamfurniture.com/app/portfolio/mix-05.jpg', 'kitchen', '대면형 주방', '매트 타우니레드 · 매트 샌드그레이'),
    (17, 'https://dadamfurniture.com/app/portfolio/mix-12.jpg', 'builtin', '아이방 붙박이장', '매트 스카이브리즈 · 슈가엘름'),
    (18, 'https://dadamfurniture.com/app/portfolio/luxe-05.jpg', 'kitchen', '대면형 주방', '매트 화이트 · 아크 샌드듄'),
    (19, 'https://dadamfurniture.com/app/portfolio/mix-18.jpg', 'storage', '다이닝 수납장', '아크 포레스트그린 · 네이처 오크'),
    (20, 'https://dadamfurniture.com/app/portfolio/mix-06.jpg', 'kitchen', '일자형 주방', '아크 플라워블루 · 매트 화이트'),
    (21, 'https://dadamfurniture.com/app/portfolio/luxe-12.jpg', 'builtin', '드레스룸', '매트 아이보리 · 슈가엘름'),
    (22, 'https://dadamfurniture.com/app/portfolio/luxe-06.jpg', 'kitchen', '아일랜드 주방', '매트 샌드그레이 · 매트 화이트'),
    (23, 'https://dadamfurniture.com/app/portfolio/luxe-15.jpg', 'storage', '거실 수납장', '아크 샌드듄 · 프렌치오크'),
    (24, 'https://dadamfurniture.com/app/portfolio/mix-07.jpg', 'kitchen', '11자 주방', '콘크리트 그레이 · 네이처 오크'),
    (25, 'https://dadamfurniture.com/app/portfolio/mix-13.jpg', 'builtin', '현관 신발장', '매트 그레이 · 네이처 오크'),
    (26, 'https://dadamfurniture.com/app/portfolio/luxe-07.jpg', 'kitchen', '냉장고장', '매트 아이보리 · 세이오크'),
    (27, 'https://dadamfurniture.com/app/portfolio/mix-19.jpg', 'storage', '세탁실장', '매트 버터스카치 · 매트 화이트'),
    (28, 'https://dadamfurniture.com/app/portfolio/mix-08.jpg', 'kitchen', '아일랜드 주방', '글로시 화이트 · 윈체스터월넛'),
    (29, 'https://dadamfurniture.com/app/portfolio/mix-14.jpg', 'builtin', '드레스룸', '매트 로지핑크 · 매트 화이트'),
    (30, 'https://dadamfurniture.com/app/portfolio/luxe-08.jpg', 'kitchen', '11자 주방', '매트 밀크화이트 · 프렌치오크'),
    (31, 'https://dadamfurniture.com/app/portfolio/mix-20.jpg', 'interior', '화장대', '세라믹 문 브릭 · 매트 밀크화이트'),
    (32, 'https://dadamfurniture.com/app/portfolio/mix-09.jpg', 'kitchen', '냉장고장', '매트 스모키올리브 · 피넛오크'),
    (33, 'https://dadamfurniture.com/app/portfolio/mix-15.jpg', 'builtin', '작은방 붙박이장', '아크 미드나잇블루 · 카카오월넛'),
    (34, 'https://dadamfurniture.com/app/portfolio/luxe-09.jpg', 'kitchen', '주방 디테일', '매트 화이트 · 세이오크'),
    (35, 'https://dadamfurniture.com/app/portfolio/mix-21.jpg', 'other', '서재 책장', '카카오월넛 · 매트 블랙')
  ) AS v(ord, image_url, category, place_label, door_color)
 WHERE NOT EXISTS (SELECT 1 FROM public.collection_posts p WHERE p.image_url = v.image_url)
 ORDER BY v.ord;
