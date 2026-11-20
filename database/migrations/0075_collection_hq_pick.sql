-- =============================================
-- 0075 시공사례 — 본사가 고른 연출컷만 공개 (2026-11-20 대표님 「연출컷은 본사에서 정하고 올릴 수 있도록」)
--
-- 연출컷(AI 스튜디오) 자동 게시는 끔 (workers/generate-api/wrangler.toml COLLECTION_AUTO_POST "off", #1663).
-- 이제 다담 본사 대표 · 실장(또는 사이트 관리자)이 연출컷을 골라 올린다 — generate-api POST /api/hq/collection/:id.
-- 고른 게시물만 앱 시공사례 탭에 보인다: source 'upload' 이거나 hq_picked_at 이 있는 것.
-- 예전에 자동으로 올라간 연출컷 행(hq_picked_at 없음)은 그대로 두되 탭에 안 보인다 — 본사 목록에 「안 올림」으로 나온다.
--
-- 1) 칸  hq_picked_at timestamptz — 본사가 고른 때 (없으면 안 고름)
--        hq_picked_by uuid       — 고른 사람 (본사 화면 기록용 — 공개 화면은 읽지 않는다)
-- 2) 지킴이 collection_posts_info_guard — 회원(anon · authenticated)이 직접 쓸 때 두 칸은 넣기 = 비움, 고치기 = 그대로.
--    회원은 자기 게시물을 고칠 수 있으므로(collection_posts_update) 스스로 「본사가 고름」을 켜는 길을 막는다.
--    서버(service_role) · 마이그레이션은 그대로 둔다. 0049 의 나머지 규칙은 그대로 옮겨 적는다.
-- 3) 찾기 줄 idx_collection_posts_hq_picked — 고른 게시물만 (부분 색인)
--
-- 그대로 두는 것: 정책 · 권한 · 버킷 · 다른 칸. 다시 돌려도 된다 (ADD COLUMN IF NOT EXISTS · OR REPLACE · IF NOT EXISTS).
-- =============================================

-- 1) 칸 ---------------------------------------------------------------------------------

ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS hq_picked_at timestamptz;
ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS hq_picked_by uuid;

COMMENT ON COLUMN public.collection_posts.hq_picked_at IS '본사가 시공사례에 올리기로 고른 때 — AI 연출컷(ai_render)은 이것이 있어야 공개 탭에 보인다 (0075)';
COMMENT ON COLUMN public.collection_posts.hq_picked_by IS '고른 본사 사람 (auth.users id) — 본사 화면 기록용 (0075)';

-- 2) 지킴이 -------------------------------------------------------------------------------

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
    NEW.hq_picked_at := NULL;
    NEW.hq_picked_by := NULL;
  ELSE
    NEW.like_count := OLD.like_count;
    NEW.source := OLD.source;
    NEW.generation_id := OLD.generation_id;
    NEW.company_id := CASE
                        WHEN NEW.design_id IS DISTINCT FROM OLD.design_id AND current_user = 'authenticated'
                          THEN public.collection_my_post_company(NEW.design_id)
                        ELSE OLD.company_id
                      END;
    NEW.hq_picked_at := OLD.hq_picked_at;
    NEW.hq_picked_by := OLD.hq_picked_by;
  END IF;
  NEW.place_label := public.collection_place_label(NEW.region, NEW.category);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.collection_posts_info_guard() IS '시공사례 지킴이 — 회원(anon · authenticated)이 직접 쓸 때 like_count · source · generation_id · company_id · hq_picked_at · hq_picked_by 는 서버 값, place_label 은 region · category 로 다시 만든다 (0049 · 0075)';

-- 3) 찾기 줄 -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_collection_posts_hq_picked
    ON public.collection_posts USING btree (hq_picked_at DESC)
    WHERE (hq_picked_at IS NOT NULL);
