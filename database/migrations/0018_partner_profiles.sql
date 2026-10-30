-- =============================================
-- 0018 — 업체 상담 설정 · 본사 업체 평가표
--
-- 다담 본사가 상담을 나눌 때 쓰는 업체 자료. 쓰기는 모두 서버(service_role)만.
--
-- company_service_settings  업체가 정하는 것 (그 업체 대표 · 실장이 앱에서, 서버를 거쳐)
--   regions              상담 받는 지역 [{sido, gugun}] — 비면 업체 주소의 시/군/구 하나
--   items                하는 품목 {품목: do | outsource | no}
--   monthly_limit        한 달 상담 한도
--   next_available_date  다음 가능 날짜
--   읽기: 그 업체 대표 · 실장, 관리자(본사)
--
-- company_evaluations       본사가 매기는 업체 평가표 (회사당 지금 한 줄)
--   grade S | A | B | C · equipment(설비) · staff(직무별 인원) · finishes(마감 · 자재 취급) · design(설계)
--   · install(시공) · price_tier(basic | mid | high) · docs(보험 · 계약서 확인) · A/S · 하자 보증 기간 · 메모
--   항목 이름은 서버 상수 — 표는 jsonb 라 항목을 더해도 DB 를 바꾸지 않는다.
--   읽기: 관리자(본사)만. 업체는 서버가 주는 자기 등급 · 점수만 본다.
-- company_evaluation_history 평가표가 바뀔 때마다 그때 줄 전체를 한 줄씩 쌓는다 (트리거). 고치기 · 지우기 없음.
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 업체 상담 설정 ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_service_settings (
    company_id uuid NOT NULL,
    regions jsonb DEFAULT '[]'::jsonb NOT NULL,
    items jsonb DEFAULT '{}'::jsonb NOT NULL,
    monthly_limit integer,
    next_available_date date,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_service_settings_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_service_settings_shape_check CHECK (jsonb_typeof(regions) = 'array' AND jsonb_typeof(items) = 'object' AND jsonb_array_length(regions) <= 300),
    CONSTRAINT company_service_settings_limit_check CHECK (monthly_limit IS NULL OR (monthly_limit >= 0 AND monthly_limit <= 1000)),
    CONSTRAINT company_service_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT company_service_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_service_settings IS '업체 상담 설정 — 상담 받는 지역 · 하는 품목 · 한 달 한도 · 다음 가능 날짜. 업체 대표 · 실장이 서버를 거쳐 고침';

-- 2) 본사 업체 평가표 ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_evaluations (
    company_id uuid NOT NULL,
    grade text,
    equipment jsonb DEFAULT '{}'::jsonb NOT NULL,
    staff jsonb DEFAULT '{}'::jsonb NOT NULL,
    finishes jsonb DEFAULT '{}'::jsonb NOT NULL,
    design jsonb DEFAULT '{}'::jsonb NOT NULL,
    install jsonb DEFAULT '{}'::jsonb NOT NULL,
    price_tier text,
    docs jsonb DEFAULT '{}'::jsonb NOT NULL,
    as_months integer,
    warranty_months integer,
    note text,
    evaluated_by uuid,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_evaluations_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_evaluations_grade_check CHECK (grade IS NULL OR grade = ANY (ARRAY['S'::text, 'A'::text, 'B'::text, 'C'::text])),
    CONSTRAINT company_evaluations_price_tier_check CHECK (price_tier IS NULL OR price_tier = ANY (ARRAY['basic'::text, 'mid'::text, 'high'::text])),
    CONSTRAINT company_evaluations_shape_check CHECK (jsonb_typeof(equipment) = 'object' AND jsonb_typeof(staff) = 'object' AND jsonb_typeof(finishes) = 'object' AND jsonb_typeof(design) = 'object' AND jsonb_typeof(install) = 'object' AND jsonb_typeof(docs) = 'object'),
    CONSTRAINT company_evaluations_months_check CHECK ((as_months IS NULL OR as_months BETWEEN 0 AND 240) AND (warranty_months IS NULL OR warranty_months BETWEEN 0 AND 240)),
    CONSTRAINT company_evaluations_note_check CHECK (note IS NULL OR length(note) <= 2000),
    CONSTRAINT company_evaluations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT company_evaluations_evaluated_by_fkey FOREIGN KEY (evaluated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_evaluations IS '본사 업체 평가표 — 등급 · 설비 · 인력 · 마감 · 설계 · 시공 · 가격대 · 서류. 본사(관리자)만 읽고, 쓰기는 서버만';

CREATE TABLE IF NOT EXISTS public.company_evaluation_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    evaluated_by uuid,
    evaluated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_evaluation_history_pkey PRIMARY KEY (id),
    CONSTRAINT company_evaluation_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT company_evaluation_history_evaluated_by_fkey FOREIGN KEY (evaluated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_evaluation_history IS '업체 평가표 이력 — 바뀔 때마다 그때 줄 전체. 추가만';

CREATE INDEX IF NOT EXISTS idx_company_evaluation_history_company ON public.company_evaluation_history USING btree (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.company_evaluation_keep_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.company_evaluation_history (company_id, snapshot, evaluated_by, evaluated_at)
  VALUES (NEW.company_id, to_jsonb(NEW), NEW.evaluated_by, NEW.evaluated_at);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_company_evaluation_keep_history ON public.company_evaluations;
CREATE TRIGGER trg_company_evaluation_keep_history AFTER INSERT OR UPDATE ON public.company_evaluations FOR EACH ROW EXECUTE FUNCTION public.company_evaluation_keep_history();

REVOKE ALL ON FUNCTION public.company_evaluation_keep_history() FROM PUBLIC, anon, authenticated, service_role;

-- 3) RLS · 권한 -----------------------------------------------------------------

ALTER TABLE public.company_service_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_evaluation_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_service_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_evaluations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_evaluation_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_service_settings TO authenticated;
GRANT SELECT ON TABLE public.company_evaluations TO authenticated;
GRANT SELECT ON TABLE public.company_evaluation_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_service_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_evaluations TO service_role;
GRANT SELECT, INSERT ON TABLE public.company_evaluation_history TO service_role;
-- 이력은 고치거나 지우지 못한다 (service_role 포함)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.company_evaluation_history FROM service_role;

DROP POLICY IF EXISTS company_service_settings_manager_read ON public.company_service_settings;
CREATE POLICY company_service_settings_manager_read ON public.company_service_settings
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS company_service_settings_admin_read ON public.company_service_settings;
CREATE POLICY company_service_settings_admin_read ON public.company_service_settings
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_evaluations_admin_read ON public.company_evaluations;
CREATE POLICY company_evaluations_admin_read ON public.company_evaluations
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_evaluation_history_admin_read ON public.company_evaluation_history;
CREATE POLICY company_evaluation_history_admin_read ON public.company_evaluation_history
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));
