-- =============================================
-- 0039 — 장부 줄에 거래처 사업자번호 · 회계 지출 상대 10곳
--
-- 세무사용 매입장(CSV)에 거래처 사업자번호 칸을 싣는다 — ledger_book(0027) 이 사업자번호를 내보내지 않았다.
-- 인쇄용 월 보고서에 매입처 10곳을 싣는다 — ledger_summary(0034) 가 달마다 5곳까지만 줬다 (회계 한눈에는 화면이 5곳만 그린다).
--
-- 바꾸는 것
--   ledger_book(업체, 처음 날, 끝 날, 취소 포함)  0027 본문 + 맨 끝 칸 counterparty_biz_no
--        장부 줄 = 적은 사업자번호(ledger_entries.counterparty_biz_no) · 원가 = 고른 거래처(counterparties.biz_no) · 수금 = NULL (고객)
--        돌려주는 칸이 늘어 CREATE OR REPLACE 로는 바뀌지 않으므로 지우고 다시 만든다 (권한도 다시 — service_role 만).
--        ledger_summary · ledger_month_report_scan 은 칸 이름으로 읽으므로 그대로 돈다
--   ledger_summary(업체, 처음 날, 끝 날)          0034 본문, 달마다 지출 상대 상위 5 → 10
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 장부 줄 + 사업자번호 -----------------------------------------------------------

DROP FUNCTION IF EXISTS public.ledger_book(uuid, date, date, boolean);

CREATE OR REPLACE FUNCTION public.ledger_book(p_company uuid, p_from date, p_to date, p_include_void boolean DEFAULT false)
 RETURNS TABLE(source text, id uuid, entry_date date, seq bigint, direction text, account text, description text,
               counterparty_name text, amount bigint, vat_amount bigint, vat_computed boolean, evidence_type text,
               order_id uuid, order_no text, voided_at timestamp with time zone, counterparty_biz_no text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH s AS (
    SELECT coalesce(cs.settings #>> '{tax,vat_type}', '') AS vat_type,
           coalesce(cs.settings #>> '{tax,business_kind}', '') AS business_kind
      FROM (SELECT 1) AS one
      LEFT JOIN public.company_settings cs ON cs.company_id = p_company
  )
  SELECT 'entry'::text, e.id, e.entry_date, e.seq, e.direction, e.account, e.description,
         e.counterparty_name, e.amount, e.vat_amount, false, e.evidence_type,
         NULL::uuid, NULL::text, e.voided_at, e.counterparty_biz_no
    FROM public.ledger_entries e
   WHERE e.company_id = p_company
     AND e.entry_date BETWEEN p_from AND p_to
     AND (p_include_void OR e.voided_at IS NULL)
  UNION ALL
  SELECT 'payment'::text, p.id, p.paid_on, NULL::bigint, 'income'::text, 'income.sales'::text, p.stage,
         o.customer_name,
         CASE WHEN s.vat_type = 'general' THEN round(p.amount::numeric / 1.1)::bigint ELSE p.amount END,
         CASE WHEN s.vat_type = 'general' THEN p.amount - round(p.amount::numeric / 1.1)::bigint END,
         s.vat_type = 'general', NULL::text,
         p.order_id, o.order_no, NULL::timestamp with time zone, NULL::text
    FROM public.order_payments p
    JOIN public.orders o ON o.id = p.order_id
   CROSS JOIN s
   WHERE o.company_id = p_company
     AND p.paid_on BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'cost'::text, c.id, c.spent_on, NULL::bigint, 'expense'::text, m.account, c.description,
         coalesce(cp.name, c.vendor_name), c.amount, c.vat_amount, false, c.evidence_type,
         c.order_id, o.order_no, NULL::timestamp with time zone, cp.biz_no
    FROM public.order_costs c
    JOIN public.orders o ON o.id = c.order_id
   CROSS JOIN s
    LEFT JOIN public.ledger_cost_accounts m ON m.category = c.category AND m.business_kind IN (s.business_kind, 'any')
    LEFT JOIN public.counterparties cp ON cp.id = c.counterparty_id
   WHERE o.company_id = p_company
     AND c.spent_on BETWEEN p_from AND p_to;
$function$;

COMMENT ON FUNCTION public.ledger_book(uuid, date, date, boolean) IS '장부 줄 — 장부 줄(entry) + 받은 수금(payment, 일반과세는 공급가 · 부가세 계산값) + 낸 원가(cost, 계정은 업종 잇기 · 없으면 NULL). 낸 날이 빈 원가는 넣지 않는다. counterparty_biz_no = 장부 줄은 적은 번호 · 원가는 고른 거래처 번호 · 수금은 NULL. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_book(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_book(uuid, date, date, boolean) TO service_role;

-- 2) 지출 상대 상위 10 --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_summary(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  -- 정해 둔 값 — 적격증빙 기준(3만원 넘음) · 달마다 상대 몇 곳
  c_evidence_min constant bigint := 30000;
  c_top constant integer := 10;
  v jsonb;
BEGIN
  IF p_company IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'p_from <= p_to and up to 400 days';
  END IF;

  WITH b AS (
    SELECT to_char(x.entry_date, 'YYYY-MM') AS month, x.source, x.direction, x.account, x.counterparty_name,
           x.amount, x.vat_amount, x.evidence_type
      FROM public.ledger_book(p_company, p_from, p_to, false) x
  ), m AS (
    SELECT b.month,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'income'), 0) AS income,
           coalesce(sum(b.vat_amount) FILTER (WHERE b.direction = 'income'), 0) AS income_vat,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'expense'), 0) AS expense,
           coalesce(sum(b.vat_amount) FILTER (WHERE b.direction = 'expense'), 0) AS expense_vat,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'asset_buy'), 0) AS asset_buy,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'asset_sell'), 0) AS asset_sell,
           count(*) FILTER (WHERE b.account IS NULL) AS account_unknown,
           count(*) FILTER (WHERE b.source = 'cost' AND b.vat_amount IS NULL) AS vat_unknown,
           count(*) FILTER (WHERE b.direction = 'expense' AND b.amount + coalesce(b.vat_amount, 0) > c_evidence_min
                             AND b.evidence_type IN ('simple_receipt', 'statement', 'none')) AS evidence_risk
      FROM b
     GROUP BY b.month
  ), a AS (
    SELECT b.month, b.direction, b.account, sum(b.amount) AS amount, coalesce(sum(b.vat_amount), 0) AS vat_amount, count(*) AS n
      FROM b
     WHERE b.direction IN ('expense', 'asset_buy')
     GROUP BY b.month, b.direction, b.account
  ), s AS (
    SELECT q.month, q.name, q.amount, q.n
      FROM (
        SELECT b.month, min(b.counterparty_name) AS name, sum(b.amount) AS amount, count(*) AS n,
               row_number() OVER (PARTITION BY b.month ORDER BY sum(b.amount) DESC, min(b.counterparty_name)) AS rk
          FROM b
         WHERE b.direction IN ('expense', 'asset_buy') AND public.ledger_name_key(b.counterparty_name) IS NOT NULL
         GROUP BY b.month, public.ledger_name_key(b.counterparty_name)
      ) q
     WHERE q.rk <= c_top
  )
  SELECT jsonb_build_object(
           'from', p_from,
           'to', p_to,
           'months', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month) FROM m), '[]'::jsonb),
           'accounts', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.month, a.amount DESC, a.account) FROM a), '[]'::jsonb),
           'suppliers', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.month, s.amount DESC, s.name) FROM s), '[]'::jsonb))
    INTO v;
  RETURN v;
END;
$function$;

COMMENT ON FUNCTION public.ledger_summary(uuid, date, date) IS '회계 한눈에 — ledger_book 을 달 · 계정 · 지출 상대(상위 10)로 묶은 jsonb (돈이 오간 날 기준, 취소 줄 뺌, 400일까지). service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_summary(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_summary(uuid, date, date) TO service_role;
