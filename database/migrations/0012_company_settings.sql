-- =============================================
-- 0012 — 원가 설정을 업체 소유로
--
-- 지금 원가 설정(production_settings)은 사람마다 한 줄(user_id)이다. 견적은 설계를 확정한 사람,
-- 다시 보기는 보는 사람의 설정으로 계산된다.
-- 이제 업체마다 한 줄(company_settings)을 두고, 견적은 설계가 속한 업체의 설정으로 계산한다
-- (workflow-api 가 읽는다). 본사 설정은 본사 대표의 지금 개인 설정을 그대로 옮긴다.
--
--   company_settings   업체당 한 줄. settings 모양은 production_settings.settings 와 같다
--                      ({standards, crew, costs, leads, quote, vendors, countertop, holidays}).
--                      읽기: 그 업체의 대표 · 실장(owner · manager), 관리자는 본사 설정만.
--                      쓰기: service_role 만 (workflow-api 가 역할을 확인한 뒤).
--   옮기기             본사 active owner 의 production_settings 한 줄 → 본사 company_settings.
--                      본사 설정이 이미 있으면 건드리지 않는다. 대표 설정이 없으면 아무것도 넣지 않는다.
--
-- production_settings 는 그대로 둔다 (지우지 않음). 서버가 더는 읽지 않게 된 뒤 따로 정리한다.
-- 다시 돌려도 된다.
-- =============================================

CREATE TABLE IF NOT EXISTS public.company_settings (
    company_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_settings_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_settings_object_check CHECK (jsonb_typeof(settings) = 'object'::text),
    CONSTRAINT company_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT company_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_settings IS '업체 원가 설정 — 견적 · 생산 계획이 읽는다. 쓰기는 service_role 만';

-- 옮기기: 본사 대표의 개인 설정 → 본사 설정 (본사 설정이 없을 때만)
INSERT INTO public.company_settings (company_id, settings, updated_by, updated_at)
SELECT m.company_id, s.settings, s.user_id, s.updated_at
  FROM public.production_settings s
  JOIN public.company_members m
    ON m.user_id = s.user_id
   AND m.company_id = public.hq_company_id()
   AND m.role = 'owner'
   AND m.status = 'active'
 WHERE jsonb_typeof(s.settings) = 'object'
 ORDER BY s.updated_at DESC
 LIMIT 1
ON CONFLICT (company_id) DO NOTHING;

-- RLS · 권한
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_settings TO authenticated;
GRANT ALL ON TABLE public.company_settings TO service_role;

DROP POLICY IF EXISTS company_settings_money_read ON public.company_settings;
CREATE POLICY company_settings_money_read ON public.company_settings
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS company_settings_admin_read ON public.company_settings;
CREATE POLICY company_settings_admin_read ON public.company_settings
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));
