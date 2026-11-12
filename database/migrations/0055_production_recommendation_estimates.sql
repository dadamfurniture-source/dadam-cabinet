-- =============================================
-- 0055 — 제작 의뢰 본사 추천에 예상 가격대 · 제작 기간 (production_recommendations)
--
--   본사가 팩토리를 추천할 때 팩토리마다 예상 가격대(최소 · 최대, 원)와 제작 기간(일)을 적는다 — 셋 다 비워 둘 수 있다.
--   Manager 추천 카드에 「가격대 1,200만~1,500만 원 · 제작 기간 약 20일」처럼 보인다 (적은 값만, 한쪽만 적으면 그 끝만)
--   (workflow-api production-requests/admin.js recommendFactories · common.js factoryView, 앱 segan/production-requests.js).
--   본사 화면은 만 원 단위로 받아 원으로 보낸다 (segan/admin-production.js). 팩토리 화면에는 싣지 않는다 (factory.js).
--
-- 바꾸는 것:
--   1) production_recommendations 칸 셋
--        price_min  bigint   예상 가격대 최소 (원, 0 이상)
--        price_max  bigint   예상 가격대 최대 (원, 0 이상, 둘 다 있으면 최소 ≤ 최대)
--        lead_days  integer  예상 제작 기간 (일, 1 이상)
--      제약 production_recommendations_price_check · production_recommendations_lead_days_check (지우고 다시 건다)
--   2) 추천 지킴이 production_recommendations_guard — 0050 본문 그대로, 넣은 뒤 바꿀 수 없는 칸(추천 내용)에 셋을 더한다.
--      CREATE OR REPLACE 라 트리거 trg_production_recommendations_guard 는 그대로 이 함수를 부른다.
--
-- 바꾸지 않는 것
--   표 권한(서버만 읽기 · 쓰기, 정책 없음, 지우기 없음 — 0050), 다른 칸 · 제약 · 색인, production_requests 와 그 지킴이,
--   앱 알림 종류(0053). 이미 있는 추천 줄은 셋 다 비어 있다 (행을 고치지 않는다).
--
-- 0054 (열린 PR) 의 객체를 쓰지 않는다. 다시 돌려도 된다.
-- =============================================

-- 1) 칸 셋 · 제약 ---------------------------------------------------------------------
ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS price_min bigint;
ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS price_max bigint;
ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS lead_days integer;

ALTER TABLE public.production_recommendations DROP CONSTRAINT IF EXISTS production_recommendations_price_check;
ALTER TABLE public.production_recommendations
    ADD CONSTRAINT production_recommendations_price_check CHECK ((price_min IS NULL OR price_min >= 0) AND (price_max IS NULL OR price_max >= 0) AND (price_min IS NULL OR price_max IS NULL OR price_min <= price_max));
ALTER TABLE public.production_recommendations DROP CONSTRAINT IF EXISTS production_recommendations_lead_days_check;
ALTER TABLE public.production_recommendations
    ADD CONSTRAINT production_recommendations_lead_days_check CHECK (lead_days IS NULL OR lead_days >= 1);

COMMENT ON COLUMN public.production_recommendations.price_min IS '본사가 적는 이 팩토리의 예상 가격대 최소 (원, 0 이상, 없어도 된다 — Manager 화면에 보인다)';
COMMENT ON COLUMN public.production_recommendations.price_max IS '본사가 적는 이 팩토리의 예상 가격대 최대 (원, 0 이상, 최소가 있으면 최소 이상, 없어도 된다 — Manager 화면에 보인다)';
COMMENT ON COLUMN public.production_recommendations.lead_days IS '본사가 적는 이 팩토리의 예상 제작 기간 (일, 1 이상, 없어도 된다 — Manager 화면에 보인다)';

-- 2) 추천 지킴이 — 0050 그대로 + 가격대 · 제작 기간도 추천 내용 (넣은 뒤 바꿀 수 없다) ----------------
CREATE OR REPLACE FUNCTION public.production_recommendations_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_round integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.round INTO v_round FROM public.production_requests r WHERE r.id = NEW.request_id;
    IF v_round IS NULL OR NEW.round <= v_round THEN
      RAISE EXCEPTION 'production_recommendations: 새 추천은 의뢰의 다음 차례로만 넣습니다' USING ERRCODE = '22023';
    END IF;
    IF NEW.chosen OR NEW.response IS NOT NULL OR NEW.reason IS NOT NULL OR NEW.responded_by IS NOT NULL THEN
      RAISE EXCEPTION 'production_recommendations: 새 추천은 고르기 · 답 없이 넣습니다' USING ERRCODE = '22023';
    END IF;
    NEW.chosen_at := NULL;
    NEW.expires_at := NULL;
    NEW.responded_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.request_id, NEW.company_id, NEW.round, NEW.rank, NEW.note, NEW.price_min, NEW.price_max, NEW.lead_days, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.company_id, OLD.round, OLD.rank, OLD.note, OLD.price_min, OLD.price_max, OLD.lead_days, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by)
     OR (NEW.responded_by IS NOT NULL AND NEW.responded_by IS DISTINCT FROM OLD.responded_by
         AND NEW.response IS NOT DISTINCT FROM OLD.response) THEN
    RAISE EXCEPTION 'production_recommendations: 추천 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.chosen IS DISTINCT FROM OLD.chosen THEN
    IF OLD.chosen THEN
      RAISE EXCEPTION 'production_recommendations: 고른 줄은 되돌릴 수 없습니다' USING ERRCODE = '22023';
    END IF;
    NEW.chosen_at := now();
    NEW.expires_at := now() + interval '24 hours';
  ELSIF (NEW.chosen_at, NEW.expires_at) IS DISTINCT FROM (OLD.chosen_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'production_recommendations: 고른 때 · 기한은 고를 때만 찍힌다' USING ERRCODE = '22023';
  END IF;
  IF NEW.response IS DISTINCT FROM OLD.response THEN
    IF OLD.response IS NOT NULL THEN
      RAISE EXCEPTION 'production_recommendations: 팩토리 답은 한 번만 적습니다' USING ERRCODE = '22023';
    END IF;
    NEW.responded_at := now();
  ELSIF NEW.responded_at IS DISTINCT FROM OLD.responded_at OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'production_recommendations: 답한 때 · 사유는 답할 때만 적습니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.production_recommendations_guard() IS '제작 의뢰 추천 지킴이 — 새 추천은 의뢰의 다음 차례로만 · 고르기 · 답 없이, 추천 내용(소개 · 예상 가격대 · 제작 기간 포함) 그대로, 고르기 · 답은 한 번, 고른 때 · 기한(+24시간) · 답한 때는 여기서 찍는다 (0050 · 0055)';

REVOKE ALL ON FUNCTION public.production_recommendations_guard() FROM PUBLIC, anon, authenticated, service_role;
