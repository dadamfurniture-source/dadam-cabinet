-- =============================================
-- 0026 — 업체 설계 학습 공유 동의
--
-- 간편 플래너의 설계 제안은 다른 업체 설계를 재료로 쓸 때, 그 업체가 「설계 학습 공유」를 켠 것만 쓴다.
-- 동의하지 않은 업체도 자기 설계로 자기 제안은 받는다. 기본은 꺼짐.
--   company_design_sharing      업체당 한 줄 — 지금 상태 (줄이 없으면 꺼짐)
--     shared                    켜짐 · 꺼짐
--     shared_since              켠 시각 (꺼져 있으면 비움)
--     changed_by · changed_at   마지막으로 바꾼 사람 · 시각
--   company_design_sharing_log  켜고 끈 기록 — 상태가 바뀔 때마다 트리거가 한 줄 넣는다. 고치기 · 지우기 없음
-- 읽기 · 쓰기는 서버(service_role)만 — 앱은 업무 서버를 거친다 (바꾸는 사람은 업체 대표 · 실장).
-- 바꾼 사람이 탈퇴하면 사람 칸만 비고 기록은 남는다.
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 지금 상태 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_design_sharing (
    company_id uuid NOT NULL,
    shared boolean DEFAULT false NOT NULL,
    shared_since timestamp with time zone,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_design_sharing_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_design_sharing_since_check CHECK (shared = (shared_since IS NOT NULL)),
    CONSTRAINT company_design_sharing_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT company_design_sharing_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_design_sharing IS '업체 설계 학습 공유 동의 — 업체당 한 줄, 줄이 없으면 꺼짐. 켠 업체 설계만 다른 업체 설계 제안의 재료. 서버만 읽고 씀';

-- 2) 켜고 끈 기록 --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_design_sharing_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    shared boolean NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone NOT NULL,
    CONSTRAINT company_design_sharing_log_pkey PRIMARY KEY (id),
    CONSTRAINT company_design_sharing_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT company_design_sharing_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_design_sharing_log IS '업체 설계 학습 공유 켜고 끈 기록 — company_design_sharing 트리거만 넣는다. 서버는 읽기만';

CREATE INDEX IF NOT EXISTS idx_company_design_sharing_log_company ON public.company_design_sharing_log USING btree (company_id, changed_at DESC);

-- 상태가 바뀔 때만 (처음 줄은 늘) 기록 한 줄
CREATE OR REPLACE FUNCTION public.company_design_sharing_log_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.shared IS DISTINCT FROM OLD.shared THEN
    INSERT INTO public.company_design_sharing_log (company_id, shared, changed_by, changed_at)
    VALUES (NEW.company_id, NEW.shared, NEW.changed_by, NEW.changed_at);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_design_sharing_log_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_company_design_sharing_log ON public.company_design_sharing;
CREATE TRIGGER trg_company_design_sharing_log AFTER INSERT OR UPDATE ON public.company_design_sharing FOR EACH ROW EXECUTE FUNCTION public.company_design_sharing_log_change();

-- 3) 권한 ----------------------------------------------------------------------------

ALTER TABLE public.company_design_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_design_sharing_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_design_sharing FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.company_design_sharing TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.company_design_sharing FROM service_role;

REVOKE ALL ON TABLE public.company_design_sharing_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.company_design_sharing_log TO service_role;
