-- =============================================
-- 0034 — 회계 한눈에 (회계장부 대시보드) 묶음 계산
--
-- ledger_summary(업체, 처음 날, 끝 날)  ledger_book(0027) 의 줄을 DB 안에서 묶는다 — 1년 줄을 워커로 끌어오지 않는다.
--   매출 · 매입은 돈이 오간 날 기준(장부와 같다): 받은 수금(일반과세는 공급가 · 부가세 계산값) · 장부 줄 · 낸 원가.
--   취소한 수주에서 이미 받은 돈 · 쓴 원가도 장부에 있으므로 들어간다 (화면이 그렇게 적는다). 취소한 장부 줄은 뺀다.
--   돌려주는 jsonb
--     months     달마다 { month, income, income_vat, expense, expense_vat, asset_buy, asset_sell,
--                         account_unknown(계정 미정 줄), vat_unknown(부가세 모름 원가 줄 — 옛 줄),
--                         evidence_risk(3만원 넘는 지출이 간이영수증 · 명세표 · 증빙 없음) }
--     accounts   달 × 방향(지출 · 자산 사기) × 계정 { month, direction, account(NULL = 계정 미정), amount, vat_amount, n }
--     suppliers  달마다 지출 · 자산 사기 상대 상위 5 { month, name, amount, n } — 상호는 다듬은 이름(0033 ledger_name_key)으로 묶는다.
--                매출 쪽 상대(고객 이름)는 넣지 않는다
--   기간은 400일까지.
--
-- 다시 돌려도 된다.
-- =============================================

CREATE OR REPLACE FUNCTION public.ledger_summary(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  -- 정해 둔 값 — 적격증빙 기준(3만원 넘음) · 달마다 상대 몇 곳
  c_evidence_min constant bigint := 30000;
  c_top constant integer := 5;
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

COMMENT ON FUNCTION public.ledger_summary(uuid, date, date) IS '회계 한눈에 — ledger_book 을 달 · 계정 · 지출 상대(상위 5)로 묶은 jsonb (돈이 오간 날 기준, 취소 줄 뺌, 400일까지). service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_summary(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_summary(uuid, date, date) TO service_role;
