-- =============================================
-- 0038 — Expert 회계 (장부 자격을 Expert 로 넓힘 · 사진 AI 읽기는 Agent) · 월 보고 알림
--
-- 회계장부는 Agent(와 시험 업체)에만 열려 있었다 (0028 company_entitled 'ledger' 의 기본 조건이 plan 'agent').
-- 2026-11-04 대표님 결정 — Expert 는 회계 결과 보고 + 매출 · 매입 관리를 쓰고, AI 비용이 드는 사진 읽기는 Agent 에 남긴다.
--
-- 정해 둔 값
--   ledger      full = 활성 협력업체 plan expert · agent, 또는 시험 예외 (read · none 은 0028 그대로)
--   ledger_ai   full = 활성 협력업체 plan agent, 또는 시험 예외 (= 0028 까지의 ledger 기본 조건) — 사진 AI 읽기
--   등급이 Agent → Expert 로 내려가면 장부는 full 그대로, 사진 읽기만 멈춘다 (남은 사진은 직접 적는다)
--   월 보고    매달 1일 아침 지난달 장부 줄이 하나라도 있는 회계 자격 full 업체마다 month_report 하나 (아침 묶음, 업체 · 달마다 하나).
--              숫자(매출 · 매입 · 장부 손익 · 줄 수)는 회계 한눈에와 같은 셈 — ledger_book 의 금액 합 (취소 줄 뺌)
--
-- 바꾸는 것
--   company_entitled(업체, 기능, 사람)       0028 본문 + books 조건 · ledger_ai
--   assistant_budget_reserve(...)            0026 본문 — 사진 읽기(extract)는 ledger_ai 로 본다
--   ledger_extract_due(...)                  0031 본문 — ledger_ai 업체 사진만 (Expert 사진은 읽기를 걸지 않는다)
--   ledger_notices.kind                      month_report 를 더한다 (급함 규칙은 0033 그대로 — 아침 묶음)
--   ledger_month_report_scan(달)             새 함수 — 워커가 매달 1일 07:50 (한국 시간) 지난달로 부른다
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 업체 기능 자격 — 장부는 Expert 도, 사진 AI 읽기는 Agent ------------------------------

CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)) AS base,
           co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan IN ('expert', 'agent')) OR coalesce(s.trial, false)) AS books,
           coalesce(s.enabled, false) AS enabled
      FROM public.companies co
      LEFT JOIN public.assistant_settings s ON s.company_id = co.id
     WHERE co.id = p_company
  ), m AS (
    SELECT p_user IS NULL OR EXISTS (
             SELECT 1 FROM public.company_members cm
              WHERE cm.company_id = p_company AND cm.user_id = p_user AND cm.status = 'active') AS ok
  )
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM c) OR NOT (SELECT ok FROM m) THEN 'none'
           WHEN p_feature = 'assistant' THEN
             CASE WHEN (SELECT base AND enabled FROM c)
                       AND coalesce((SELECT g.assistant_on FROM public.assistant_global g WHERE g.id), false)
                  THEN 'full' ELSE 'none' END
           WHEN p_feature = 'ledger' THEN
             CASE WHEN (SELECT books FROM c) THEN 'full'
                  WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company)
                    OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read'
                  ELSE 'none' END
           WHEN p_feature = 'ledger_ai' THEN
             CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'none' END
           ELSE 'none'
         END;
$function$;

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none (Agent · 시험), ledger: full(Expert · Agent · 시험) | read(장부 줄 · 사진이 있는 업체 — 등급이 내려가도 보기 · 내보내기) | none, ledger_ai(사진 AI 읽기): full(Agent · 시험) | none. 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;

-- 2) AI 예산 잡기 — 사진 읽기는 ledger_ai ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.assistant_budget_reserve(p_company uuid, p_purpose text, p_key text, p_micros bigint, p_user uuid DEFAULT NULL::uuid, p_model text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_set public.assistant_settings%ROWTYPE;
  v_row public.assistant_usage%ROWTYPE;
  v_on boolean;
  v_period date := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::date;
  v_used bigint;
  v_extract_used bigint;
  v_floor bigint;
BEGIN
  IF p_purpose IS NULL OR p_purpose <> ALL (ARRAY['chat', 'brief', 'extract']) THEN
    RAISE EXCEPTION 'p_purpose must be chat, brief or extract';
  END IF;
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_key is required';
  END IF;
  IF p_micros IS NULL OR p_micros <= 0 THEN
    RAISE EXCEPTION 'p_micros must be positive';
  END IF;

  -- 업체 줄을 잠가 같은 업체의 잡기를 한 줄로 세운다
  SELECT * INTO v_set FROM public.assistant_settings s WHERE s.company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_limit');
  END IF;

  SELECT * INTO v_row FROM public.assistant_usage u WHERE u.reservation_key = p_key;
  IF FOUND THEN
    IF v_row.company_id <> p_company OR v_row.purpose <> p_purpose THEN
      RAISE EXCEPTION 'p_key belongs to another reservation';
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'repeat', true, 'settled', v_row.settled_at IS NOT NULL);
  END IF;

  IF public.company_entitled(p_company, CASE WHEN p_purpose = 'extract' THEN 'ledger_ai' ELSE 'assistant' END, p_user) <> 'full' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_entitled');
  END IF;
  IF p_purpose = 'extract' THEN
    SELECT g.extract_on INTO v_on FROM public.assistant_global g WHERE g.id;
    IF NOT coalesce(v_on, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'off');
    END IF;
  END IF;
  IF v_set.monthly_limit_micros IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_limit');
  END IF;

  SELECT coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)), 0),
         coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)) FILTER (WHERE u.purpose = 'extract'), 0)
    INTO v_used, v_extract_used
    FROM public.assistant_usage u
   WHERE u.company_id = p_company AND u.period = v_period;

  v_floor := CASE WHEN p_purpose = 'extract' THEN 0 ELSE greatest(v_set.extract_floor_micros - v_extract_used, 0) END;
  IF v_used + v_floor + p_micros > v_set.monthly_limit_micros THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'over_limit',
                              'used', v_used, 'limit', v_set.monthly_limit_micros, 'kept_for_extract', v_floor);
  END IF;

  INSERT INTO public.assistant_usage (company_id, user_id, purpose, reservation_key, period, model, reserved_micros)
  VALUES (p_company, p_user, p_purpose, p_key, v_period, p_model, p_micros)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'repeat', false);
END;
$function$;

COMMENT ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) IS 'AI 비서 예산 잡기 — 업체 설정 줄을 잠그고 이번 달(한국 시간) 사용 + 사진 읽기 몫 + 이번 금액이 한도 안이면 한 줄. 같은 키는 그 줄을 돌려준다. service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) TO service_role;

-- 3) 매분 다시 걸 사진 — ledger_ai 업체만 ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_extract_due(p_limit integer, p_wait_sec integer, p_stuck_sec integer, p_max_attempts integer, p_reread_below integer DEFAULT NULL)
 RETURNS TABLE(document_id uuid, company_id uuid, reread boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be 1..100';
  END IF;
  IF p_wait_sec IS NULL OR p_wait_sec < 0 OR p_stuck_sec IS NULL OR p_stuck_sec < 60 THEN
    RAISE EXCEPTION 'p_wait_sec >= 0 and p_stuck_sec >= 60';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'p_max_attempts must be 1..5';
  END IF;
  IF p_reread_below IS NOT NULL AND p_reread_below < 1 THEN
    RAISE EXCEPTION 'p_reread_below must be >= 1';
  END IF;

  UPDATE public.ledger_extractions x
     SET status = 'failed', error = 'stuck'
   WHERE x.status = 'running' AND x.started_at < now() - make_interval(secs => p_stuck_sec);

  RETURN QUERY
  SELECT d.id, d.company_id, coalesce(lx.status = 'done', false)
    FROM public.ledger_documents d
    LEFT JOIN LATERAL (
      SELECT x.status, x.attempt, x.schema_version FROM public.ledger_extractions x
       WHERE x.document_id = d.id ORDER BY x.attempt DESC LIMIT 1) lx ON true
   WHERE d.review_status = 'pending'
     AND d.created_at < now() - make_interval(secs => p_wait_sec)
     AND public.company_entitled(d.company_id, 'ledger_ai') = 'full'
     AND (lx.status IS NULL
          OR (lx.status = 'failed' AND lx.attempt < p_max_attempts)
          OR (lx.status = 'done' AND coalesce(lx.schema_version, 0) < coalesce(p_reread_below, 0) AND lx.attempt < 5))
   ORDER BY coalesce(lx.status = 'done', false), d.created_at
   LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) IS '매분 cron 이 다시 걸 사진 — 멈춘 running 을 failed(stuck)로 닫고, 시도가 없거나 마지막이 failed(최대 시도 아래)인 확인 기다리는 사진, 그다음 p_reread_below 보다 낮은 판으로 읽은 사진(reread). 사진 AI 읽기 자격(ledger_ai — Agent · 시험) 업체만. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) TO service_role;

-- 4) 월 보고 알림 ---------------------------------------------------------------------------

ALTER TABLE public.ledger_notices DROP CONSTRAINT IF EXISTS ledger_notices_kind_check;
ALTER TABLE public.ledger_notices
    ADD CONSTRAINT ledger_notices_kind_check CHECK (kind = ANY (ARRAY['duplicate'::text, 'large_amount'::text, 'new_supplier'::text, 'supplier_status'::text, 'price_change'::text, 'evidence_risk'::text, 'statement_mismatch'::text, 'invoice_missing'::text, 'month_report'::text]));

CREATE OR REPLACE FUNCTION public.ledger_month_report_scan(p_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_added integer;
BEGIN
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'p_month is required';
  END IF;
  v_from := date_trunc('month', p_month)::date;
  v_to := (v_from + interval '1 month')::date - 1;
  INSERT INTO public.ledger_notices (company_id, kind, urgency, data, dedupe_key)
  SELECT c.id, 'month_report', 'digest',
         jsonb_build_object('month', to_char(v_from, 'YYYY-MM'), 'rows', t.n,
                            'income', t.income, 'expense', t.expense, 'profit', t.income - t.expense),
         'month:' || to_char(v_from, 'YYYY-MM')
    FROM (SELECT co.id FROM public.companies co
           WHERE co.status = 'active' AND public.company_entitled(co.id, 'ledger') = 'full') c
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS n,
             coalesce(sum(b.amount) FILTER (WHERE b.direction = 'income'), 0) AS income,
             coalesce(sum(b.amount) FILTER (WHERE b.direction = 'expense'), 0) AS expense
        FROM public.ledger_book(c.id, v_from, v_to, false) b) t
   WHERE t.n > 0
  ON CONFLICT (company_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$function$;

COMMENT ON FUNCTION public.ledger_month_report_scan(date) IS '월 보고 알림 — 그 달(p_month 가 든 달) 장부 줄이 하나라도 있는 회계 자격 full 업체마다 month_report 하나(아침 묶음, 업체 · 달마다 하나). 매출 · 매입 · 장부 손익은 ledger_book 금액 합. 넣은 수. 워커가 매달 1일 지난달로 부른다. 서버만';

REVOKE ALL ON FUNCTION public.ledger_month_report_scan(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_month_report_scan(date) TO service_role;
