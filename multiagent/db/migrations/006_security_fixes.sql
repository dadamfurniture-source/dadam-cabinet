-- ============================================================
-- 006: Security Fixes — SECURITY DEFINER 뷰 제거 + RLS 활성화
-- ============================================================

-- 1. SECURITY DEFINER 뷰 → SECURITY INVOKER로 재생성
-- (뷰 조회 시 조회자의 RLS 정책이 적용되도록)

CREATE OR REPLACE VIEW public.quote_accuracy
WITH (security_invoker = true) AS
SELECT
  q.id AS quote_id,
  p.category,
  q.total_price AS ai_quote,
  o.contract_amount AS actual_amount,
  CASE
    WHEN q.total_price > 0
    THEN ROUND(((o.contract_amount - q.total_price)::NUMERIC / q.total_price) * 100, 2)
    ELSE 0
  END AS error_rate_pct,
  o.created_at AS contract_date
FROM public.quotes q
JOIN public.projects p ON q.project_id = p.id
JOIN public.orders o ON o.quote_id = q.id
WHERE o.contract_amount IS NOT NULL
  AND o.status NOT IN ('consulting', 'quoted');

CREATE OR REPLACE VIEW public.as_pattern_analysis
WITH (security_invoker = true) AS
SELECT
  ast.type AS as_type,
  p.category,
  COUNT(*) AS occurrence_count,
  ARRAY_AGG(ast.id) AS ticket_ids,
  ARRAY_AGG(DISTINCT ast.description) AS descriptions
FROM public.after_service_tickets ast
JOIN public.orders o ON ast.order_id = o.id
JOIN public.projects p ON o.project_id = p.id
WHERE ast.status IN ('resolved', 'closed')
GROUP BY ast.type, p.category
HAVING COUNT(*) >= 3;

-- 2. RLS 활성화 (13개 테이블)
-- service_role 키로만 접근하는 내부 테이블이므로
-- service_role 전체 접근 정책 + authenticated 읽기 정책 적용

ALTER TABLE public.learned_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.after_service_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lora_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_calibrations ENABLE ROW LEVEL SECURITY;

-- 3. RLS 정책: service_role은 전체 접근
CREATE POLICY "service_role_all" ON public.learned_constraints FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.order_status_history FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.schedules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.resources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.revenue_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.expense_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.vendors FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.purchase_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.after_service_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.case_embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.training_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.lora_model_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.price_calibrations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. RLS 정책: authenticated 사용자는 읽기만
CREATE POLICY "authenticated_read" ON public.learned_constraints FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.order_status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.revenue_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.expense_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.after_service_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.case_embeddings FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.training_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.lora_model_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read" ON public.price_calibrations FOR SELECT TO authenticated USING (true);
