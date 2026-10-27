-- =============================================
-- 0007 — 회사 기준 읽기 규칙, 개인 기준 쓰기는 본사 행으로 좁힘
--
-- 1. 회사 구성원 읽기 (TO authenticated, 새 정책만 — 기존 「본인」 정책은 그대로 둔다)
--      designs · orders · consultations          company_id 가 내 회사
--      design_snapshots · design_documents · design_schedules · design_site_info · design_renders
--      · design_items · design_images · planner_snapshots   그 설계가 내 회사 것
--      order_costs · order_payments               그 수주가 내 회사 것이고 내가 owner · manager
--      generations                                내 회사 것 중 회사가 만든 것(origin = 'company')이거나
--                                                 프로젝트에 이어진 것 — 고객이 혼자 만든 연출컷은 고객만 본다
--    my_company_ids() 는 active 구성원만 돌려준다 (removed 는 못 본다).
--
-- 2. 개인 기준 쓰기는 본사 행에만
--      designs 넣기     본인 + 본사 + 프로젝트 비움
--      designs 고치기   본인 + 본사 (USING 이 새 행 검사도 한다 — 회사를 못 바꾼다)
--      consultations 넣기  기존 조건 + 본사 + 고객 · 프로젝트 비움 (비로그인 신청 그대로)
--
-- 3. keep_owner_links() — designs · consultations BEFORE UPDATE
--      company_id 는 누구도 바꾸지 못한다 (넘기기는 새 프로젝트로 한다).
--      project_id · customer_id 는 anon · authenticated 가 바꾸지 못한다 — 잇기는 서버(service_role)가 한다.
--
-- 기존 정책 이름은 그대로 두고 DROP … IF EXISTS 다음 다시 만든다. 다시 돌려도 된다.
-- =============================================

-- 1) 회사 구성원 읽기 ---------------------------------------------------------

DROP POLICY IF EXISTS designs_member_read ON public.designs;
CREATE POLICY designs_member_read ON public.designs
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS orders_member_read ON public.orders;
CREATE POLICY orders_member_read ON public.orders
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS consultations_member_read ON public.consultations;
CREATE POLICY consultations_member_read ON public.consultations
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS generations_member_read ON public.generations;
CREATE POLICY generations_member_read ON public.generations
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()) AND (origin = 'company'::text OR project_id IS NOT NULL));

DROP POLICY IF EXISTS design_snapshots_member_read ON public.design_snapshots;
CREATE POLICY design_snapshots_member_read ON public.design_snapshots
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_snapshots.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_documents_member_read ON public.design_documents;
CREATE POLICY design_documents_member_read ON public.design_documents
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_documents.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_schedules_member_read ON public.design_schedules;
CREATE POLICY design_schedules_member_read ON public.design_schedules
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_schedules.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_site_info_member_read ON public.design_site_info;
CREATE POLICY design_site_info_member_read ON public.design_site_info
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_site_info.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_renders_member_read ON public.design_renders;
CREATE POLICY design_renders_member_read ON public.design_renders
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_renders.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_items_member_read ON public.design_items;
CREATE POLICY design_items_member_read ON public.design_items
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_items.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS design_images_member_read ON public.design_images;
CREATE POLICY design_images_member_read ON public.design_images
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = design_images.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS planner_snapshots_member_read ON public.planner_snapshots;
CREATE POLICY planner_snapshots_member_read ON public.planner_snapshots
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = planner_snapshots.design_id AND d.company_id IN (SELECT public.my_company_ids())));

DROP POLICY IF EXISTS order_costs_manager_read ON public.order_costs;
CREATE POLICY order_costs_manager_read ON public.order_costs
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_costs.order_id AND o.company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text]))));

DROP POLICY IF EXISTS order_payments_manager_read ON public.order_payments;
CREATE POLICY order_payments_manager_read ON public.order_payments
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_payments.order_id AND o.company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text]))));

-- 2) 개인 기준 쓰기는 본사 행에만 ---------------------------------------------

DROP POLICY IF EXISTS "Users can create own designs" ON public.designs;
CREATE POLICY "Users can create own designs" ON public.designs
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id) AND company_id = (SELECT public.hq_company_id()) AND project_id IS NULL);

DROP POLICY IF EXISTS "Users can update own designs" ON public.designs;
CREATE POLICY "Users can update own designs" ON public.designs
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = user_id) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL))
        AND company_id = (SELECT public.hq_company_id()) AND customer_id IS NULL AND project_id IS NULL);

-- 3) 회사 · 연결 칸 지키기 ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.keep_owner_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_id 는 바꿀 수 없다 (%)', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF current_user IN ('anon', 'authenticated')
     AND ((to_jsonb(NEW) ->> 'project_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'project_id')
       OR (to_jsonb(NEW) ->> 'customer_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'customer_id')) THEN
    RAISE EXCEPTION '프로젝트 · 고객 연결은 서버만 바꾼다 (%)', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- 트리거로만 돈다.
REVOKE ALL ON FUNCTION public.keep_owner_links() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_designs_keep_owner_links ON public.designs;
CREATE TRIGGER trg_designs_keep_owner_links BEFORE UPDATE ON public.designs FOR EACH ROW EXECUTE FUNCTION public.keep_owner_links();
DROP TRIGGER IF EXISTS trg_consultations_keep_owner_links ON public.consultations;
CREATE TRIGGER trg_consultations_keep_owner_links BEFORE UPDATE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.keep_owner_links();
