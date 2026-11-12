-- =============================================
-- 0017 — 다담 본사 · 다담 공장 나누기
--
-- 상담은 모두 다담 본사가 먼저 받아 업체 풀(협력업체 + 다담 공장)에 나눠 준다.
--   다담 본사  companies.kind = 'platform' 새 행 하나. 구성원 없이 관리자(is_admin)가 운영한다
--              (한 사람은 한 회사에만 active 구성원이라, 공장 직원이 나누기 전 상담을 보지 않게).
--   다담 공장  지금의 다담 회사(kind = 'hq'). 이름만 「다담 공장」. hq_company_id() 는 그대로 공장이다
--              (생산 · ERP · 월 손익 · 생산 Slack 은 공장 일이라 바꾸지 않는다).
--   platform_company_id() 본사 id.
--
-- 상담
--   새 상담은 본사로 들어온다(기본값 · 넣기 정책). 관리자 읽기 · 고치기는 본사 상담만
--   (업체 · 공장으로 나간 상담은 그 회사 구성원이 읽는다). 새 상담 Slack 은 본사 상담을 잡는다.
-- 가입 고객 줄
--   새 가입은 본사 고객 줄을 만든다. 지금 공장에 있는 가입 고객 줄 중 이름 · 연락처 · 프로젝트 · 상담이
--   없는 것은 본사로 옮긴다(공장 구성원이 모든 가입자 줄을 보지 않게). 관리자는 본사 고객 줄도 읽는다.
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 다담 본사 ------------------------------------------------------------------

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_kind_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_kind_check CHECK (kind = ANY (ARRAY['hq'::text, 'partner'::text, 'platform'::text]));
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_partner_plan_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_partner_plan_check CHECK (kind = ANY (ARRAY['hq'::text, 'platform'::text]) OR plan IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS companies_one_platform ON public.companies USING btree (kind) WHERE (kind = 'platform'::text);

INSERT INTO public.companies (kind, name, status)
SELECT 'platform', '다담 본사', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.companies WHERE kind = 'platform');

UPDATE public.companies SET name = '다담 공장', updated_at = now() WHERE kind = 'hq' AND name <> '다담 공장';

CREATE OR REPLACE FUNCTION public.platform_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id FROM public.companies c WHERE c.kind = 'platform' LIMIT 1;
$function$;

COMMENT ON FUNCTION public.platform_company_id() IS '다담 본사(companies.kind = platform) id — 상담을 받아 나누는 곳. 공장은 hq_company_id()';

REVOKE ALL ON FUNCTION public.platform_company_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_company_id() TO anon, authenticated, service_role;

-- 2) 상담은 본사로 -----------------------------------------------------------------

ALTER TABLE public.consultations ALTER COLUMN company_id SET DEFAULT public.platform_company_id();

DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL))
        AND company_id = (SELECT public.platform_company_id()) AND customer_id IS NULL AND project_id IS NULL);

DROP POLICY IF EXISTS "Admins can view all consultations" ON public.consultations;
DROP POLICY IF EXISTS consultations_admin_read ON public.consultations;
CREATE POLICY consultations_admin_read ON public.consultations
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.platform_company_id()));

DROP POLICY IF EXISTS "Admins can update consultations" ON public.consultations;
DROP POLICY IF EXISTS consultations_admin_update ON public.consultations;
CREATE POLICY consultations_admin_update ON public.consultations
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.platform_company_id()))
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.platform_company_id()));

-- 새 상담 Slack 알림 — 본사 상담을 잡는다 (0016 함수, 돌려주는 모양 그대로)
CREATE OR REPLACE FUNCTION public.claim_consultation_notices(p_fresh_since timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_stale integer;
  v_rows jsonb;
BEGIN
  IF p_fresh_since IS NULL THEN
    RAISE EXCEPTION 'p_fresh_since is required';
  END IF;

  WITH stale AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT s.id
               FROM public.consultations s
              WHERE s.notified_at IS NULL
                AND s.company_id = public.platform_company_id()
                AND (s.created_at IS NULL OR s.created_at < p_fresh_since)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id
  )
  SELECT count(*)::integer INTO v_stale FROM stale;

  WITH claimed AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT f.id
               FROM public.consultations f
              WHERE f.notified_at IS NULL
                AND f.company_id = public.platform_company_id()
                AND f.created_at >= p_fresh_since
              ORDER BY f.created_at, f.id
              LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id, c.created_at, c.consultation_type, c.furniture_categories, c.preferred_date,
              c.preferred_time, c.sido, c.gugun, c.consult_target, c.generation_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', k.created_at,
           'consultation_type', k.consultation_type,
           'furniture_categories', k.furniture_categories,
           'preferred_date', k.preferred_date,
           'preferred_time', k.preferred_time,
           'sido', k.sido,
           'gugun', k.gugun,
           'consult_target', k.consult_target,
           'has_generation', k.generation_id IS NOT NULL,
           'category', g.category)
         ORDER BY k.created_at, k.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed k
    LEFT JOIN public.generations g ON g.id = k.generation_id;

  RETURN jsonb_build_object('stale', v_stale, 'rows', v_rows);
END;
$function$;

COMMENT ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) IS '새 상담 Slack 알림 — 본사(company_id = 다담 본사)의 미알림 행을 잡아 notified_at 표시 (오래된 행은 표시만). service_role 전용 (workflow-api cron)';

REVOKE ALL ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) TO service_role;

-- 3) 가입 고객 줄은 본사 --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_platform_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.customers (company_id, user_id)
  SELECT c.id, NEW.id
    FROM public.companies c
   WHERE c.kind = 'platform'
  ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_platform_customer() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_platform_customer() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created_hq_customer ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_platform_customer ON auth.users;
CREATE TRIGGER on_auth_user_created_platform_customer AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.add_platform_customer();
DROP FUNCTION IF EXISTS public.add_hq_customer();

-- 공장에 있던 가입 고객 줄(이름 · 연락처 · 프로젝트 · 상담 없음)을 본사로
UPDATE public.customers cu
   SET company_id = public.platform_company_id(), updated_at = now()
 WHERE cu.company_id = public.hq_company_id()
   AND cu.user_id IS NOT NULL AND cu.name IS NULL AND cu.phone IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.customer_id = cu.id)
   AND NOT EXISTS (SELECT 1 FROM public.consultations s WHERE s.customer_id = cu.id)
   AND NOT EXISTS (SELECT 1 FROM public.customers x WHERE x.company_id = public.platform_company_id() AND x.user_id = cu.user_id);

-- 빠진 가입자(본사 줄이 없는 계정)는 본사 줄을 채운다
INSERT INTO public.customers (company_id, user_id)
SELECT c.id, u.id
  FROM auth.users u
 CROSS JOIN public.companies c
 WHERE c.kind = 'platform'
ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING;

DROP POLICY IF EXISTS customers_admin_read ON public.customers;
CREATE POLICY customers_admin_read ON public.customers
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id IN ((SELECT public.hq_company_id()), (SELECT public.platform_company_id())));
