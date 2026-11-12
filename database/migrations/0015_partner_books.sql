-- =============================================
-- 0015 — 업체 회계: 업체 칸 · 직원 금액 막기 · 관리자 읽기는 본사 것만
--
-- 1) 업체 칸 (company_id, 기존 행 = 본사)
--      counterparties       거래처 · 공급처 목록을 업체마다 따로. 읽기: 그 업체 대표 · 실장, 관리자는 본사 것.
--                           이름 겹침(uq_counterparties_name)은 업체 안에서만
--      work_reports         외주 발주 · 보고. 읽기: 쓴 사람, 관리자는 본사 것
--      production_worklogs  작업 기록. 읽기는 그대로(본인)
--    쓰기는 지금처럼 서버(service_role)만 — 서버가 업체를 넣는다. 안 넣으면 본사.
-- 2) 금액은 서버로만
--      orders.contract_amount · received_amount, design_snapshots.quote_payload(견적 원가 · 단가)를
--      authenticated 가 직접(REST) 읽지 못하게 칸 권한으로 막는다. 서버(service_role)는 그대로 읽는다.
--      나머지 칸은 지금처럼 읽는다. 이 두 표에 칸을 더하면 아래 GRANT SELECT (…) 에도 더해야 읽힌다.
--      (뷰 dataset_chains 는 contract_amount 를 읽는다 — security_invoker 라 서버(dataset-api)만 쓴다. 화면은 안 부른다)
--    수주 원가: 설계 만든 사람 옛 읽기 규칙을 지운다 — 업체 대표 · 실장 읽기(0007)만 남는다.
-- 3) 관리자 읽기는 본사 것만
--      order_payments · rework_logs · install_feedback: 본사 수주의 것만
--      customers · projects: 본사 고객 · 프로젝트만 (0003 TODO — 협력업체가 실제 고객을 받기 전에)
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 업체 칸 ------------------------------------------------------------------

ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS company_id uuid DEFAULT public.hq_company_id() NOT NULL;
ALTER TABLE public.counterparties DROP CONSTRAINT IF EXISTS counterparties_company_id_fkey;
ALTER TABLE public.counterparties ADD CONSTRAINT counterparties_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_counterparties_company ON public.counterparties USING btree (company_id, kind);
-- 이름 겹침은 업체 안에서만 본다 (다른 업체 목록에 같은 이름이 있는지 드러나지 않게). 색인 이름은 그대로
DROP INDEX IF EXISTS public.uq_counterparties_name;
CREATE UNIQUE INDEX uq_counterparties_name ON public.counterparties USING btree (company_id, kind, lower(name));

ALTER TABLE public.work_reports ADD COLUMN IF NOT EXISTS company_id uuid DEFAULT public.hq_company_id() NOT NULL;
ALTER TABLE public.work_reports DROP CONSTRAINT IF EXISTS work_reports_company_id_fkey;
ALTER TABLE public.work_reports ADD CONSTRAINT work_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_work_reports_company ON public.work_reports USING btree (company_id, created_at DESC);

ALTER TABLE public.production_worklogs ADD COLUMN IF NOT EXISTS company_id uuid DEFAULT public.hq_company_id() NOT NULL;
ALTER TABLE public.production_worklogs DROP CONSTRAINT IF EXISTS production_worklogs_company_id_fkey;
ALTER TABLE public.production_worklogs ADD CONSTRAINT production_worklogs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_production_worklogs_company ON public.production_worklogs USING btree (company_id, work_date);

DROP POLICY IF EXISTS "Admin read counterparties" ON public.counterparties;
DROP POLICY IF EXISTS counterparties_admin_read ON public.counterparties;
CREATE POLICY counterparties_admin_read ON public.counterparties
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS counterparties_manager_read ON public.counterparties;
CREATE POLICY counterparties_manager_read ON public.counterparties
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));

DROP POLICY IF EXISTS "Owner or admin read work reports" ON public.work_reports;
DROP POLICY IF EXISTS work_reports_owner_read ON public.work_reports;
CREATE POLICY work_reports_owner_read ON public.work_reports
    FOR SELECT
    TO authenticated
    USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS work_reports_admin_read ON public.work_reports;
CREATE POLICY work_reports_admin_read ON public.work_reports
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

-- 2) 금액은 서버로만 --------------------------------------------------------------

REVOKE SELECT ON TABLE public.orders FROM authenticated;
GRANT SELECT (id, order_no, design_id, document_id, snapshot_id, customer_name, status, ordered_at, delivered_at, completed_at, note, created_by, created_at, updated_at, price_tier, partner_id, company_id, project_id) ON TABLE public.orders TO authenticated;

REVOKE SELECT ON TABLE public.design_snapshots FROM authenticated;
GRANT SELECT (id, design_id, rev, content_hash, created_by, app_version, design_title, design_payload, bom_payload, hardware_payload, pricing_rule_set_id, item_count, module_count, panel_count, note, created_at, cut_plan_payload, sheet_count) ON TABLE public.design_snapshots TO authenticated;

DROP POLICY IF EXISTS "Users read own order costs" ON public.order_costs;

-- 3) 관리자 읽기는 본사 것만 ------------------------------------------------------

DROP POLICY IF EXISTS "Admin read order payments" ON public.order_payments;
DROP POLICY IF EXISTS order_payments_admin_read ON public.order_payments;
CREATE POLICY order_payments_admin_read ON public.order_payments
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_payments.order_id AND o.company_id = (SELECT public.hq_company_id())));

DROP POLICY IF EXISTS "Admin read rework logs" ON public.rework_logs;
DROP POLICY IF EXISTS rework_logs_admin_read ON public.rework_logs;
CREATE POLICY rework_logs_admin_read ON public.rework_logs
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = rework_logs.order_id AND o.company_id = (SELECT public.hq_company_id())));

DROP POLICY IF EXISTS "Admin read install feedback" ON public.install_feedback;
DROP POLICY IF EXISTS install_feedback_admin_read ON public.install_feedback;
CREATE POLICY install_feedback_admin_read ON public.install_feedback
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = install_feedback.order_id AND o.company_id = (SELECT public.hq_company_id())));

DROP POLICY IF EXISTS customers_admin_read ON public.customers;
CREATE POLICY customers_admin_read ON public.customers
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS customers_admin_insert ON public.customers;
CREATE POLICY customers_admin_insert ON public.customers
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS customers_admin_update ON public.customers;
CREATE POLICY customers_admin_update ON public.customers
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()))
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS customers_admin_delete ON public.customers;
CREATE POLICY customers_admin_delete ON public.customers
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS projects_admin_read ON public.projects;
CREATE POLICY projects_admin_read ON public.projects
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS projects_admin_insert ON public.projects;
CREATE POLICY projects_admin_insert ON public.projects
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS projects_admin_update ON public.projects;
CREATE POLICY projects_admin_update ON public.projects
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()))
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));

DROP POLICY IF EXISTS projects_admin_delete ON public.projects;
CREATE POLICY projects_admin_delete ON public.projects
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));
