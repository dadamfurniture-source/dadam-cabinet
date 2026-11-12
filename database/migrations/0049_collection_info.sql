-- =============================================
-- 0049 — 시공사례 사진 정보 (장소 · 색상 · 업체) · 좋아요는 본인 것만 · 업체 이름 · 내 좋아요 함수
--
-- 앱 시공사례: 사진을 인스타그램처럼 늘어놓고, 누르면 장소 정보 · 색상 정보 · 업체 정보를 보이고,
-- 좋아요를 누르면 마이페이지 「좋아요」 에 모인다. 이 파일은 그 DB 쪽이다 (화면은 segan/, 자동 게시는 generate-api).
--
-- 1) collection_posts 칸 셋 — 모두 비어도 된다 (비면 화면은 그 줄을 안 보인다)
--      place_label  장소 표시 「지역 · 공간」
--                   직접 올린 사진(upload): 올린 사람이 고른 region(시/도 줄임 + 시/군/구, segan/activity.js · mypage.html)
--                     + 구분 이름(kitchen 주방 · builtin 붙박이장 · storage 수납장 · interior 인테리어 — 화면 select 글 그대로,
--                     other 기타는 장소가 아니라 뺀다). region 은 한글 두 낱말(공백 하나)까지만 받는다 — 숫자 · 번지 · 동 호수가
--                     섞이면 지역은 빼고 공간만. collection_place_label(region, category)
--                   AI 연출컷(ai_render): 그 연출컷의 품목 이름(싱크대 · 아일랜드 · 냉장고장 · 붙박이장 · 신발장 · 침실 · 수납장 ·
--                     화장대 · 사무실 · 서재 — ai-design.html · segan/make.js KINDS 글 그대로). 지역은 넣지 않는다 — 연출컷의 방은
--                     고객 집이고, 상담 지역(consultations.sido · gugun) · 거주지(profiles)는 고객이 공개한 값이 아니다
--      door_color   문짝 색 이름 — 화면 글 그대로 (화이트 · 크림 · 라이트 그레이 · 그레이지 · 오크 · 월넛 · 차콜,
--                   ai-design.html #doorColor · segan/make.js DOORS). AI 연출컷은 generations.options.door_color 에서.
--                   직접 올린 사진은 비어 있다 (화면이 고르게 하면 같은 이름을 넣는다, 20자까지)
--      company_id   업체 (companies, 지워지면 비움) — 누구의 일인가
--                   ① 직접 올린 사진이 고른 설계가 올린 사람 본인 것이고 시공 완료 수주(orders.status 'completed')가 있으면
--                      그 설계의 업체 (수주 업체 = 설계 업체, 0006 복합 FK)
--                   ② 아니면 올린 사람이 active 구성원인 업체 (본사 · 협력업체 — 한 사람은 active 업체 하나뿐)
--                   ③ 아니면 비움 (고객 혼자 만든 연출컷 · 사진)
--                   AI 연출컷은 ②만 (generate-api collection-post.js 가 같은 규칙으로 넣는다). generations.company_id 는
--                   쓰지 않는다 — 생성 서버가 넣지 않아 모든 행이 기본값 본사다
--
-- 2) 지킴이 collection_posts_info_guard (BEFORE INSERT OR UPDATE) — 회원이 API 로 직접 쓸 때만 (current_user anon · authenticated).
--    서버(service_role), 좋아요 트리거(update_like_count — SECURITY DEFINER 라 소유자 권한), 마이그레이션은 건드리지 않는다.
--      넣기   like_count 0 · company_id 는 위 ① ② (collection_my_post_company) · place_label 은 region · category 로 다시 만든다
--      고치기 like_count · source · generation_id 는 그대로 (자동 게시 행을 직접 올린 사진으로 바꾸는 길이 닫힌다 —
--             정책 WITH CHECK 가 source 'upload' 를 보니 거절), company_id 는 설계를 바꿀 때만 다시, place_label 은 다시 만든다
--      앱이 보내는 place_label · company_id · like_count 는 쓰지 않는다 — 남의 업체 이름을 붙이거나 좋아요 수를 바꾸지 못한다
--
-- 3) collection_likes — 읽기 · 넣기 · 지우기 모두 본인 줄만 (TO authenticated, user_id = auth.uid()).
--    0000 의 읽기 정책은 USING (true) 라 누가 무엇을 좋아했는지 누구나 읽혔다. anon 권한은 없앤다.
--    authenticated 는 SELECT · INSERT · DELETE 만 (고치기 없음 — 좋아요 취소는 지우기). 공개 숫자는 collection_posts.like_count
-- 4) update_like_count — 하는 일 그대로, search_path 비움 · 표 이름 public. · NULL 이면 0 에서 센다. 트리거 그대로
-- 5) 함수
--      collection_post_companies(p_post_ids uuid[])   게시물 id 들(100개까지) → (post_id, company_name, company_kind hq | partner).
--                                                     업체가 본사이거나 활동 중(status active) 협력업체일 때만. 누구나 (anon 포함)
--                                                     — companies 는 구성원 · 관리자만 읽어서 이름은 이 함수로만 나간다
--      collection_my_likes(p_limit 30, p_before)       내 좋아요 최신순 (좋아한 때 liked_at 기준, 1~100개, p_before 보다 앞 것) — authenticated
--      collection_place_label(region, category)        1) 의 직접 올린 사진 장소 표시 (지킴이 · 채우기)
--      collection_my_post_company(design)              2) 의 ① ② — 부른 사람(auth.uid()) 본인 것만 본다 (지킴이) — authenticated
-- 6) 채우기 (기존 행, 빈 칸만)
--      AI 연출컷 place_label · door_color ← 그 연출컷(generations.category · options.door_color)
--      직접 올린 사진 place_label ← region · category
--      company_id ← ① (직접 올린 사진) · ② 는 그 구성원 줄이 게시물보다 먼저 생겼을 때만 (게시 때 구성원이었다고 확실한 것)
--      like_count ← collection_likes 를 다시 센다 (본인이 고쳐 둔 수가 있으면 바로잡는다)
--    채운 행은 updated_at 이 바뀐다 (trg_collection_posts_updated_at) — 데이터셋 수집(dataset-api)이 그 행을 한 번 더 읽는다
--
-- 그대로 두는 것: collection_posts 읽기(누구나) · 넣기 · 고치기 · 지우기 정책과 권한, region · category 칸, 버킷.
-- 공개 읽기에 새로 보이는 것은 위 두 이름 글과 업체 id 뿐이다 (주소 · 사람 이름 · 연락처 없음).
-- 0048 의 객체는 쓰지 않는다.
-- 다시 돌려도 된다 (ADD COLUMN IF NOT EXISTS · DROP … IF EXISTS 다음 ADD/CREATE · OR REPLACE · 채우기는 빈 칸 · 다른 값만).
-- =============================================

-- 1) 칸 ---------------------------------------------------------------------------------

ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS place_label text;
ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS door_color text;
ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.collection_posts DROP CONSTRAINT IF EXISTS collection_posts_place_label_check;
ALTER TABLE public.collection_posts
    ADD CONSTRAINT collection_posts_place_label_check CHECK ((place_label IS NULL) OR ((char_length(place_label) >= 1) AND (char_length(place_label) <= 60)));

ALTER TABLE public.collection_posts DROP CONSTRAINT IF EXISTS collection_posts_door_color_check;
ALTER TABLE public.collection_posts
    ADD CONSTRAINT collection_posts_door_color_check CHECK ((door_color IS NULL) OR ((char_length(door_color) >= 1) AND (char_length(door_color) <= 20)));

ALTER TABLE public.collection_posts DROP CONSTRAINT IF EXISTS collection_posts_company_id_fkey;
ALTER TABLE public.collection_posts
    ADD CONSTRAINT collection_posts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collection_posts_company ON public.collection_posts USING btree (company_id, created_at DESC) WHERE (company_id IS NOT NULL);

COMMENT ON COLUMN public.collection_posts.place_label IS '장소 표시 「지역 · 공간」 — 직접 올린 사진은 region(한글 두 낱말까지) · 구분 이름(collection_place_label), AI 연출컷은 품목 이름만. 주소 · 상담 지역 · 거주지는 넣지 않는다 (0049)';
COMMENT ON COLUMN public.collection_posts.door_color IS '문짝 색 이름 — 화면 글 그대로 (화이트 · 크림 · 라이트 그레이 · 그레이지 · 오크 · 월넛 · 차콜). AI 연출컷은 generations.options.door_color 에서 (0049)';
COMMENT ON COLUMN public.collection_posts.company_id IS '업체 — 직접 올린 사진은 고른 본인 설계에 시공 완료 수주가 있으면 그 업체, 아니면 올린 사람의 active 업체, 아니면 비움. 이름은 collection_post_companies 로만 (0049)';

-- 2) 장소 표시 · 업체 고르기 ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_place_label(p_region text, p_category text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(concat_ws(' · ',
           CASE WHEN btrim(coalesce(p_region, '')) ~ '^[가-힣]{1,8}( [가-힣]{1,8})?$' THEN btrim(p_region) END,
           CASE p_category
             WHEN 'kitchen' THEN '주방'
             WHEN 'builtin' THEN '붙박이장'
             WHEN 'storage' THEN '수납장'
             WHEN 'interior' THEN '인테리어'
           END), '');
$function$;

COMMENT ON FUNCTION public.collection_place_label(text, text) IS '직접 올린 시공사례 사진의 장소 표시 — region(한글 두 낱말까지, 아니면 뺀다) · 구분 이름(주방 · 붙박이장 · 수납장 · 인테리어, other 는 뺀다). 둘 다 없으면 NULL (0049)';

REVOKE ALL ON FUNCTION public.collection_place_label(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_place_label(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collection_my_post_company(p_design uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    (SELECT d.company_id
       FROM public.designs d
      WHERE p_design IS NOT NULL
        AND d.id = p_design
        AND d.user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id AND o.status = 'completed')),
    (SELECT m.company_id
       FROM public.company_members m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
      LIMIT 1));
$function$;

COMMENT ON FUNCTION public.collection_my_post_company(uuid) IS '시공사례 업체 고르기 — 부른 사람 본인 설계에 시공 완료 수주가 있으면 그 설계 업체, 아니면 부른 사람의 active 업체, 아니면 NULL. 본인 것만 본다 (지킴이용, 0049)';

REVOKE ALL ON FUNCTION public.collection_my_post_company(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_my_post_company(uuid) TO authenticated;

-- 3) 지킴이 — 회원이 직접 쓸 때 업체 · 좋아요 수 · 출처는 서버 값, 장소 표시는 region · category 로 ------------------

CREATE OR REPLACE FUNCTION public.collection_posts_info_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- 서버(service_role) · 좋아요 트리거(소유자 권한) · 마이그레이션은 그대로 둔다
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.like_count := 0;
    NEW.company_id := CASE WHEN current_user = 'authenticated' THEN public.collection_my_post_company(NEW.design_id) END;
  ELSE
    NEW.like_count := OLD.like_count;
    NEW.source := OLD.source;
    NEW.generation_id := OLD.generation_id;
    NEW.company_id := CASE
                        WHEN NEW.design_id IS DISTINCT FROM OLD.design_id AND current_user = 'authenticated'
                          THEN public.collection_my_post_company(NEW.design_id)
                        ELSE OLD.company_id
                      END;
  END IF;
  NEW.place_label := public.collection_place_label(NEW.region, NEW.category);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.collection_posts_info_guard() IS '시공사례 지킴이 — 회원(anon · authenticated)이 직접 쓸 때 like_count · source · generation_id · company_id 는 서버 값, place_label 은 region · category 로 다시 만든다 (0049)';

REVOKE ALL ON FUNCTION public.collection_posts_info_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_collection_posts_info_guard ON public.collection_posts;
CREATE TRIGGER trg_collection_posts_info_guard BEFORE INSERT OR UPDATE ON public.collection_posts FOR EACH ROW EXECUTE FUNCTION public.collection_posts_info_guard();

-- 4) 좋아요 — 본인 줄만 ------------------------------------------------------------------

DROP POLICY IF EXISTS collection_likes_select ON public.collection_likes;
CREATE POLICY collection_likes_select ON public.collection_likes
    FOR SELECT
    TO authenticated
    USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS collection_likes_insert ON public.collection_likes;
CREATE POLICY collection_likes_insert ON public.collection_likes
    FOR INSERT
    TO authenticated
    WITH CHECK ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS collection_likes_delete ON public.collection_likes;
CREATE POLICY collection_likes_delete ON public.collection_likes
    FOR DELETE
    TO authenticated
    USING ((user_id = (SELECT auth.uid())));

REVOKE ALL ON TABLE public.collection_likes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.collection_likes TO authenticated;

CREATE INDEX IF NOT EXISTS idx_collection_likes_user_created ON public.collection_likes USING btree (user_id, created_at DESC);

COMMENT ON TABLE public.collection_likes IS '시공사례 좋아요 — 사람 × 게시물 한 줄. 읽기 · 넣기 · 지우기 모두 본인 줄만. 공개 숫자는 collection_posts.like_count (update_like_count) (0049)';

CREATE OR REPLACE FUNCTION public.update_like_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.collection_posts SET like_count = coalesce(like_count, 0) + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.collection_posts SET like_count = GREATEST(0, coalesce(like_count, 0) - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.update_like_count() IS '좋아요를 넣고 지울 때 collection_posts.like_count 를 하나씩 올리고 내린다 (0 아래로 안 간다). 트리거 전용 (0049 search_path 비움)';

REVOKE ALL ON FUNCTION public.update_like_count() FROM PUBLIC, anon, authenticated, service_role;

-- 5) 업체 이름 · 내 좋아요 ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_post_companies(p_post_ids uuid[])
 RETURNS TABLE(post_id uuid, company_name text, company_kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, c.name, c.kind
    FROM public.collection_posts p
    JOIN public.companies c ON c.id = p.company_id
   WHERE p.id = ANY (p_post_ids[1:100])
     AND c.kind IN ('hq', 'partner')
     AND c.status = 'active';
$function$;

COMMENT ON FUNCTION public.collection_post_companies(uuid[]) IS '시공사례 업체 이름 — 게시물 id 들(앞 100개) → (post_id, company_name, company_kind hq | partner). 본사 · 활동 중 협력업체만, 이름과 종류 말고는 내지 않는다. 누구나 (0049)';

REVOKE ALL ON FUNCTION public.collection_post_companies(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_post_companies(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collection_my_likes(p_limit integer DEFAULT 30, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(post_id uuid, liked_at timestamp with time zone, image_url text, category text, source text, place_label text, door_color text, like_count integer, company_name text, company_kind text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, l.created_at, p.image_url, p.category, p.source, p.place_label, p.door_color, p.like_count,
         c.name, c.kind, p.created_at
    FROM public.collection_likes l
    JOIN public.collection_posts p ON p.id = l.post_id
    LEFT JOIN public.companies c ON c.id = p.company_id AND c.kind IN ('hq', 'partner') AND c.status = 'active'
   WHERE l.user_id = auth.uid()
     AND (p_before IS NULL OR l.created_at < p_before)
   ORDER BY l.created_at DESC NULLS LAST, l.id DESC
   LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
$function$;

COMMENT ON FUNCTION public.collection_my_likes(integer, timestamp with time zone) IS '마이페이지 좋아요 — 부른 사람의 좋아요를 좋아한 때(liked_at) 최신순으로 1~100개 (기본 30). 다음 쪽은 마지막 liked_at 을 p_before 로. 업체 이름은 collection_post_companies 와 같은 조건 (0049)';

REVOKE ALL ON FUNCTION public.collection_my_likes(integer, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_my_likes(integer, timestamp with time zone) TO authenticated, service_role;

-- 6) 채우기 — 빈 칸만, 다른 값만 ------------------------------------------------------------

-- AI 연출컷 — 그 연출컷의 품목 이름 · 문짝 색 이름
UPDATE public.collection_posts p
   SET place_label = coalesce(p.place_label, v.place_label),
       door_color = coalesce(p.door_color, v.door_color)
  FROM (
    SELECT p2.id,
           CASE g.category
             WHEN 'sink' THEN '싱크대'
             WHEN 'island' THEN '아일랜드'
             WHEN 'wardrobe' THEN '붙박이장'
             WHEN 'storage' THEN '수납장'
             WHEN 'fridge' THEN '냉장고장'
             WHEN 'vanity' THEN '화장대'
             WHEN 'shoe' THEN '신발장'
             WHEN 'office' THEN '사무실'
             WHEN 'study' THEN '서재'
             WHEN 'bedroom' THEN '침실'
           END AS place_label,
           CASE g.options ->> 'door_color'
             WHEN 'white' THEN '화이트'
             WHEN 'cream' THEN '크림'
             WHEN 'light grey' THEN '라이트 그레이'
             WHEN 'greige' THEN '그레이지'
             WHEN 'oak woodgrain' THEN '오크'
             WHEN 'walnut woodgrain' THEN '월넛'
             WHEN 'charcoal' THEN '차콜'
           END AS door_color
      FROM public.collection_posts p2
      JOIN public.generations g ON g.id = p2.generation_id
     WHERE p2.source = 'ai_render'
  ) v
 WHERE p.id = v.id
   AND ((p.place_label IS NULL AND v.place_label IS NOT NULL) OR (p.door_color IS NULL AND v.door_color IS NOT NULL));

-- 직접 올린 사진 — region · category
UPDATE public.collection_posts p
   SET place_label = public.collection_place_label(p.region, p.category)
 WHERE p.source = 'upload'
   AND p.place_label IS NULL
   AND public.collection_place_label(p.region, p.category) IS NOT NULL;

-- 업체 — ① 본인 설계 + 시공 완료 수주 (직접 올린 사진) ② 게시물보다 먼저 생긴 active 구성원 줄
UPDATE public.collection_posts p
   SET company_id = v.company_id
  FROM (
    SELECT p2.id,
           coalesce(
             (SELECT d.company_id
                FROM public.designs d
               WHERE p2.source = 'upload'
                 AND d.id = p2.design_id
                 AND d.user_id = p2.user_id
                 AND EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id AND o.status = 'completed')),
             (SELECT m.company_id
                FROM public.company_members m
               WHERE m.user_id = p2.user_id
                 AND m.status = 'active'
                 AND m.created_at <= p2.created_at
               LIMIT 1)) AS company_id
      FROM public.collection_posts p2
     WHERE p2.company_id IS NULL
       AND p2.user_id IS NOT NULL
  ) v
 WHERE p.id = v.id
   AND v.company_id IS NOT NULL;

-- 좋아요 수 — 다시 센다
UPDATE public.collection_posts p
   SET like_count = v.n
  FROM (
    SELECT p2.id, (SELECT count(*)::integer FROM public.collection_likes l WHERE l.post_id = p2.id) AS n
      FROM public.collection_posts p2
  ) v
 WHERE p.id = v.id
   AND p.like_count IS DISTINCT FROM v.n;
