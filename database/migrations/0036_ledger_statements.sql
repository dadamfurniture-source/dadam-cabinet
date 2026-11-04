-- =============================================
-- 0036 — 거래명세표 모아 붙이기 (회계장부)
--
-- 거래명세표의 부가세는 그 명세표로 공제되지 않는다. 공제는 거래처가 따로 주는 세금계산서(보통 한 달 치를 묶은 월합계)로 받는다.
-- 명세표와 세금계산서를 둘 다 장부 줄로 올리면 매입이 두 번 잡히므로, 거래처마다 한 번 고른다.
--   separate        세금계산서 따로 줌 — 명세표는 모아 두었다가(held) 세금계산서 장부 줄에 증빙(supporting)으로 붙인다
--   statement_only  명세표만 줌 — 명세표를 지금처럼 장부 줄로 올린다 (합계 전부 · 부가세 0)
--   안 고름          명세표는 바로 올리기에서 빠지고 확인 화면이 묻는다 (워커 hints.js)
--
-- 정해 둔 값 (대표님 확인 — 2026-11-04 계획)
--   거래처 열쇠       'b' + 사업자번호(검증 숫자 맞음) 또는 'n' + 다듬은 상호 (0033 다듬기 · 같은 거래처 규칙)
--   맞춰 보기         그 줄에 붙은 명세표 모두에 공급가가 있고 세금계산서 줄에 부가세가 있으면 공급가 합 = 줄 금액(1원도 같아야).
--                     아니면 합계 합 vs 줄 금액 + 부가세, 장 수만큼의 원 차이까지는 같다고 본다 (명세표마다 부가세를 반올림)
--   다름 알림         붙인 뒤 맞지 않으면 statement_mismatch (아침 묶음) — 줄 · 붙은 장 수마다 하나
--   세금계산서 없음   그 달 명세표가 다음 달 11일 아침까지 모아 둔 채면 invoice_missing (아침 묶음) — 거래처 · 달마다 하나.
--                     월합계 세금계산서 발급 기한 = 다음 달 10일 (부가가치세법 제34조 제3항). 워커가 11일부터 그 달 말까지 매일 부른다
--   증빙 경고         separate 거래처의 명세표는 3만원 넘어도 힌트에서 경고하지 않는다 (올린 줄 경고는 그대로 — 붙인 명세표는 줄이 아니다)
--   단가 변동         세금계산서 줄에 붙인 명세표(supporting)의 품목 단가도 비교한다
--   줄 취소           세금계산서 줄을 취소하면 붙은 명세표는 연결을 풀고 다시 held (커밋 때 — 고치기는 같은 트랜잭션에서 증빙을 새 줄로 옮긴다)
--
-- 표 (RLS 켬, 정책 없음, 서버 service_role 만)
--   ledger_supplier_modes   업체 · 거래처 열쇠마다 고른 것 하나 — 바꾼 사람 · 때
--   ledger_documents        review_status 에 held(세금계산서 기다림)를 더한다
--   ledger_notices          kind 에 statement_mismatch · invoice_missing 을 더한다 (둘 다 digest)
--
-- 함수 (서버만)
--   ledger_supplier_mode(업체, 번호, 상호 열쇠)       고른 것 (없으면 NULL)
--   ledger_doc_supplier(사진)                       사진의 거래처 — 마지막 읽음에서 (번호는 검사 ok 일 때만)
--   ledger_set_supplier_mode(업체, 사람, 사진, 열쇠, 고른 것)
--                                                   사진 또는 열쇠로 고른다. statement_only 면 그 거래처의 held 를 pending 으로,
--                                                   separate 면 모아 둘 후보(그 거래처의 확인 기다리는 명세표)를 돌려준다
--   ledger_hold_documents(업체, 사람, 사진들) · ledger_unhold_documents(업체, 사람, 사진들)   pending ↔ held
--   ledger_held_documents(업체)                      모아 둔 명세표 — 거래처 · 읽은 날짜 · 공급가 · 부가세 · 합계
--   ledger_supplier_entries(업체, 번호, 상호 열쇠, 몇)   그 거래처의 장부 줄(붙일 세금계산서 고르기) — 붙은 명세표 수
--   ledger_statements_compare(줄, 사진들)             그 줄에 붙은 명세표 + 붙일 명세표 맞춰 보기 (쓰지 않는다)
--   ledger_attach_statements(줄, 사람, 사진들)          한 번에 붙이고 맞춰 보기, 다르면 알림
--   ledger_invoice_missing_scan(달)                  세금계산서 없음 알림 넣기
--   ledger_doc_posted(사진)                         올린 사진의 거래처 — 붙인(supporting) 사진도 (단가 변동)
--   ledger_doc_signals(사진)                        0033 + supplier_key · invoice_mode, separate 명세표는 증빙 경고 아님
--   ledger_notices_scan()                           0033 + 붙인 명세표도 단가 변동
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 모아 둠 상태 · 알림 종류 ---------------------------------------------------------

ALTER TABLE public.ledger_documents DROP CONSTRAINT IF EXISTS ledger_documents_status_check;
ALTER TABLE public.ledger_documents
    ADD CONSTRAINT ledger_documents_status_check CHECK (review_status = ANY (ARRAY['pending'::text, 'posted'::text, 'returned'::text, 'rejected'::text, 'skipped_budget'::text, 'held'::text]));

ALTER TABLE public.ledger_notices DROP CONSTRAINT IF EXISTS ledger_notices_kind_check;
ALTER TABLE public.ledger_notices
    ADD CONSTRAINT ledger_notices_kind_check CHECK (kind = ANY (ARRAY['duplicate'::text, 'large_amount'::text, 'new_supplier'::text, 'supplier_status'::text, 'price_change'::text, 'evidence_risk'::text, 'statement_mismatch'::text, 'invoice_missing'::text]));

-- 2) 거래처 고르기 --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_supplier_modes (
    company_id uuid NOT NULL,
    supplier_key text NOT NULL,
    biz_no text,
    name_key text,
    name text,
    mode text NOT NULL,
    set_by uuid NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_supplier_modes_pkey PRIMARY KEY (company_id, supplier_key),
    CONSTRAINT ledger_supplier_modes_mode_check CHECK (mode = ANY (ARRAY['separate'::text, 'statement_only'::text])),
    CONSTRAINT ledger_supplier_modes_key_check CHECK (supplier_key = coalesce('b' || biz_no, 'n' || name_key)),
    CONSTRAINT ledger_supplier_modes_name_check CHECK (name IS NULL OR length(name) <= 100),
    CONSTRAINT ledger_supplier_modes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.ledger_supplier_modes IS '거래처마다 세금계산서를 따로 주나 — separate(따로 줌 · 명세표는 모아 붙임) · statement_only(명세표만 줌). 열쇠는 b+사업자번호 또는 n+다듬은 상호. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_supplier_mode(p_company uuid, p_biz text, p_name_key text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT m.mode FROM public.ledger_supplier_modes m
   WHERE m.company_id = p_company AND (p_biz IS NOT NULL OR p_name_key IS NOT NULL)
     AND public.ledger_same_supplier(p_biz, p_name_key, m.biz_no, m.name_key)
   ORDER BY m.set_at DESC
   LIMIT 1
$function$;

COMMENT ON FUNCTION public.ledger_supplier_mode(uuid, text, text) IS '그 거래처에 고른 것 (같은 거래처 규칙 — 여럿이면 마지막에 고른 것). 없으면 NULL. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_doc_supplier(p_document uuid)
 RETURNS TABLE(biz text, name_key text, name text, evidence_type text, issue_date date,
               supply_amount bigint, vat_amount bigint, total_amount bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN x.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(x.result->>'supplier_biz_no') END,
         public.ledger_name_key(x.result->>'supplier_name'),
         left(nullif(btrim(x.result->>'supplier_name'), ''), 100),
         x.result->>'evidence_type',
         public.ledger_try_date(x.result->>'issue_date'),
         CASE WHEN jsonb_typeof(x.result->'supply_amount') = 'number' THEN (x.result->>'supply_amount')::numeric::bigint END,
         CASE WHEN jsonb_typeof(x.result->'vat_amount') = 'number' THEN (x.result->>'vat_amount')::numeric::bigint END,
         CASE WHEN jsonb_typeof(x.result->'total_amount') = 'number' THEN (x.result->>'total_amount')::numeric::bigint END
    FROM public.ledger_extractions x
   WHERE x.document_id = p_document AND x.status = 'done'
   ORDER BY x.attempt DESC
   LIMIT 1
$function$;

COMMENT ON FUNCTION public.ledger_doc_supplier(uuid) IS '사진의 거래처 · 증빙 · 날짜 · 금액 — 마지막 읽음(읽은 값), 사업자번호는 검사 ok 일 때만. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_set_supplier_mode(p_company uuid, p_actor uuid, p_document uuid, p_key text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  c_max constant integer := 200;
  v_biz text;
  v_name text;
  v_display text;
  v_key text;
  v_released integer := 0;
  v_candidates jsonb := '[]'::jsonb;
BEGIN
  IF p_company IS NULL OR p_actor IS NULL OR p_mode IS NULL OR p_mode NOT IN ('separate', 'statement_only')
     OR (p_document IS NULL) = (p_key IS NULL) THEN
    RAISE EXCEPTION 'p_company, p_actor, p_mode and one of p_document or p_key';
  END IF;
  IF p_document IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.id = p_document AND d.company_id = p_company) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT s.biz, s.name_key, s.name INTO v_biz, v_name, v_display FROM public.ledger_doc_supplier(p_document) s;
  ELSE
    SELECT m.biz_no, m.name_key, m.name INTO v_biz, v_name, v_display
      FROM public.ledger_supplier_modes m WHERE m.company_id = p_company AND m.supplier_key = p_key;
  END IF;
  v_key := coalesce('b' || v_biz, 'n' || v_name);
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_supplier');
  END IF;

  INSERT INTO public.ledger_supplier_modes AS m (company_id, supplier_key, biz_no, name_key, name, mode, set_by, set_at)
  VALUES (p_company, v_key, v_biz, v_name, v_display, p_mode, p_actor, now())
  ON CONFLICT (company_id, supplier_key) DO UPDATE
     SET mode = EXCLUDED.mode, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at,
         name = coalesce(EXCLUDED.name, m.name);

  IF p_mode = 'statement_only' THEN
    -- 명세표만 주는 곳으로 바꾸면 모아 둔 명세표는 확인할 사진으로 돌아간다
    UPDATE public.ledger_documents d
       SET review_status = 'pending', decided_by = NULL, decided_at = NULL, decision_reason = NULL
     WHERE d.id IN (SELECT d2.id FROM public.ledger_documents d2
                    CROSS JOIN LATERAL public.ledger_doc_supplier(d2.id) s
                    WHERE d2.company_id = p_company AND d2.review_status = 'held'
                      AND public.ledger_same_supplier(v_biz, v_name, s.biz, s.name_key));
    GET DIAGNOSTICS v_released = ROW_COUNT;
  ELSE
    -- 모아 둘 후보 — 그 거래처의 확인 기다리는 명세표 (모아 두기는 사람이 한 번 더 누른다)
    SELECT coalesce(jsonb_agg(c.id ORDER BY c.created_at), '[]'::jsonb) INTO v_candidates
      FROM (SELECT d.id, d.created_at
              FROM public.ledger_documents d
              CROSS JOIN LATERAL public.ledger_doc_supplier(d.id) s
             WHERE d.company_id = p_company AND d.review_status = 'pending' AND s.evidence_type = 'statement'
               AND public.ledger_same_supplier(v_biz, v_name, s.biz, s.name_key)
             ORDER BY d.created_at
             LIMIT c_max) c;
  END IF;

  RETURN jsonb_build_object('ok', true, 'key', v_key, 'mode', p_mode, 'name', v_display, 'released', v_released, 'candidates', v_candidates);
END;
$function$;

COMMENT ON FUNCTION public.ledger_set_supplier_mode(uuid, uuid, uuid, text, text) IS '거래처 고르기 — 사진(읽은 거래처) 또는 열쇠로. statement_only 면 그 거래처 held → pending, separate 면 모아 둘 후보(확인 기다리는 명세표, 200장까지). 서버만';

-- 3) 모아 두기 ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_hold_documents(p_company uuid, p_actor uuid, p_documents uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_company IS NULL OR p_actor IS NULL OR p_documents IS NULL OR cardinality(p_documents) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_company, p_actor and 1 to 200 p_documents';
  END IF;
  UPDATE public.ledger_documents d
     SET review_status = 'held', decided_by = p_actor, decided_at = now(), decision_reason = NULL
   WHERE d.company_id = p_company AND d.id = ANY (p_documents) AND d.review_status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.ledger_hold_documents(uuid, uuid, uuid[]) IS '확인 기다리는 사진을 모아 둠(held, 세금계산서 기다림)으로 — 그 업체 pending 만, 200장까지. 바꾼 수. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_unhold_documents(p_company uuid, p_actor uuid, p_documents uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_company IS NULL OR p_actor IS NULL OR p_documents IS NULL OR cardinality(p_documents) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_company, p_actor and 1 to 200 p_documents';
  END IF;
  UPDATE public.ledger_documents d
     SET review_status = 'pending', decided_by = NULL, decided_at = NULL, decision_reason = NULL
   WHERE d.company_id = p_company AND d.id = ANY (p_documents) AND d.review_status = 'held';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.ledger_unhold_documents(uuid, uuid, uuid[]) IS '모아 둔 사진을 확인 기다림(pending)으로 되돌림 — 그 업체 held 만, 200장까지. 바꾼 수. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_held_documents(p_company uuid)
 RETURNS TABLE(document_id uuid, created_at timestamp with time zone, held_at timestamp with time zone, supplier_key text,
               supplier_name text, biz_no text, name_key text, issue_date date, supply_amount bigint, vat_amount bigint,
               total_amount bigint, evidence_type text, invoice_mode text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT d.id, d.created_at, d.decided_at, coalesce('b' || s.biz, 'n' || s.name_key), s.name, s.biz, s.name_key,
         s.issue_date, s.supply_amount, s.vat_amount, s.total_amount, s.evidence_type,
         public.ledger_supplier_mode(p_company, s.biz, s.name_key)
    FROM public.ledger_documents d
    LEFT JOIN LATERAL public.ledger_doc_supplier(d.id) s ON true
   WHERE d.company_id = p_company AND d.review_status = 'held'
   ORDER BY s.issue_date NULLS LAST, d.created_at
   LIMIT 500
$function$;

COMMENT ON FUNCTION public.ledger_held_documents(uuid) IS '모아 둔 명세표 — 거래처 열쇠 · 읽은 상호 · 날짜 · 공급가 · 부가세 · 합계 · 고른 것 (읽은 값, 500장까지). 서버만';

-- 4) 세금계산서 줄에 붙이기 ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_supplier_entries(p_company uuid, p_biz text, p_name_key text, p_limit integer)
 RETURNS TABLE(entry_id uuid, entry_date date, amount bigint, vat_amount bigint, evidence_type text, counterparty_name text,
               supporting integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT e.id, e.entry_date, e.amount, e.vat_amount, e.evidence_type, e.counterparty_name,
         (SELECT count(*)::integer FROM public.ledger_evidence ev WHERE ev.entry_id = e.id AND ev.role = 'supporting')
    FROM public.ledger_entries e
   WHERE e.company_id = p_company AND e.voided_at IS NULL AND e.direction IN ('expense', 'asset_buy')
     AND (p_biz IS NOT NULL OR p_name_key IS NOT NULL)
     AND public.ledger_same_supplier(p_biz, p_name_key, public.ledger_biz_key(e.counterparty_biz_no), public.ledger_name_key(e.counterparty_name))
   ORDER BY e.entry_date DESC, e.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
$function$;

COMMENT ON FUNCTION public.ledger_supplier_entries(uuid, text, text, integer) IS '그 거래처의 취소 안 한 지출 · 자산 장부 줄 (최근부터, 50줄까지) — 붙일 세금계산서 줄 고르기. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_statements_compare(p_entry uuid, p_documents uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_e public.ledger_entries%ROWTYPE;
  v_n integer;
  v_supply_n integer;
  v_total_n integer;
  v_supply bigint;
  v_total bigint;
  v_basis text;
  v_statements bigint;
  v_invoice bigint;
  v_tolerance bigint;
BEGIN
  SELECT * INTO v_e FROM public.ledger_entries e WHERE e.id = p_entry;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'entry_not_found');
  END IF;
  -- 그 줄에 이미 붙은 명세표 + 새로 붙일 명세표 (읽은 값, 그 줄과 같은 업체 사진만)
  SELECT count(*), count(s.supply_amount), count(s.total_amount), sum(s.supply_amount), sum(s.total_amount)
    INTO v_n, v_supply_n, v_total_n, v_supply, v_total
    FROM (SELECT DISTINCT u.id FROM (
            SELECT ev.document_id AS id FROM public.ledger_evidence ev WHERE ev.entry_id = p_entry AND ev.role = 'supporting'
            UNION ALL
            SELECT unnest(coalesce(p_documents, ARRAY[]::uuid[]))) u
           JOIN public.ledger_documents d ON d.id = u.id AND d.company_id = v_e.company_id) docs
    LEFT JOIN LATERAL public.ledger_doc_supplier(docs.id) s ON true;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'n', 0);
  END IF;
  IF v_supply_n = v_n AND v_e.vat_amount > 0 THEN
    v_basis := 'supply';
    v_statements := v_supply;
    v_invoice := v_e.amount;
    v_tolerance := 0;
  ELSE
    v_basis := 'total';
    v_statements := CASE WHEN v_total_n = v_n THEN v_total END;
    v_invoice := v_e.amount + v_e.vat_amount;
    v_tolerance := v_n;
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'n', v_n,
    'basis', v_basis,
    'statements', v_statements,
    'invoice', v_invoice,
    'diff', v_statements - v_invoice,
    'match', CASE WHEN v_statements IS NULL THEN NULL ELSE abs(v_statements - v_invoice) <= v_tolerance END,
    'missing', v_n - CASE WHEN v_basis = 'supply' THEN v_supply_n ELSE v_total_n END);
END;
$function$;

COMMENT ON FUNCTION public.ledger_statements_compare(uuid, uuid[]) IS '세금계산서 줄과 명세표 맞춰 보기 — 붙은 명세표 + 붙일 명세표. 모두 공급가가 있고 줄에 부가세가 있으면 공급가 합 = 줄 금액(같아야), 아니면 합계 합 vs 금액 + 부가세(장 수만큼 원 차이까지). 쓰지 않는다. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_attach_statements(p_entry uuid, p_actor uuid, p_documents uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_e public.ledger_entries%ROWTYPE;
  v_ids uuid[];
  v_ok uuid[];
  v_cmp jsonb;
BEGIN
  IF p_entry IS NULL OR p_actor IS NULL OR p_documents IS NULL OR cardinality(p_documents) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_entry, p_actor and 1 to 100 p_documents';
  END IF;
  SELECT * INTO v_e FROM public.ledger_entries e WHERE e.id = p_entry FOR UPDATE;
  IF NOT FOUND OR v_e.voided_at IS NOT NULL OR v_e.direction NOT IN ('expense', 'asset_buy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'entry_not_found');
  END IF;
  SELECT array_agg(DISTINCT u) INTO v_ids FROM unnest(p_documents) u;
  -- 모두 붙일 수 있어야 붙인다 — 같은 업체 · 모아 둠 또는 확인 기다림
  SELECT array_agg(d.id) INTO v_ok
    FROM (SELECT d.id FROM public.ledger_documents d
           WHERE d.id = ANY (v_ids) AND d.company_id = v_e.company_id AND d.review_status IN ('held', 'pending')
           ORDER BY d.id
           FOR UPDATE) d;
  IF coalesce(cardinality(v_ok), 0) <> cardinality(v_ids) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_attachable',
                              'documents', (SELECT coalesce(jsonb_agg(u), '[]'::jsonb) FROM unnest(v_ids) u WHERE NOT (u = ANY (coalesce(v_ok, ARRAY[]::uuid[])))));
  END IF;

  INSERT INTO public.ledger_evidence (company_id, document_id, entry_id, cost_id, role, created_by)
  SELECT v_e.company_id, u, v_e.id, NULL, 'supporting', p_actor FROM unnest(v_ids) u;
  UPDATE public.ledger_documents d
     SET review_status = 'posted', decided_by = p_actor, decided_at = now(), decision_reason = NULL
   WHERE d.id = ANY (v_ids);

  v_cmp := public.ledger_statements_compare(v_e.id, NULL);
  IF v_cmp->>'match' = 'false' THEN
    INSERT INTO public.ledger_notices (company_id, kind, urgency, entry_id, data, dedupe_key)
    VALUES (v_e.company_id, 'statement_mismatch', 'digest', v_e.id,
            jsonb_build_object('supplier', v_e.counterparty_name, 'on_date', v_e.entry_date) || (v_cmp - 'ok'),
            'stm:' || v_e.id || ':' || (v_cmp->>'n'))
    ON CONFLICT (company_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'attached', cardinality(v_ids), 'compare', v_cmp - 'ok');
END;
$function$;

COMMENT ON FUNCTION public.ledger_attach_statements(uuid, uuid, uuid[]) IS '명세표를 세금계산서 장부 줄에 증빙(supporting)으로 한 번에 붙인다 — 모두 그 업체 held · pending 일 때만, 100장까지. 맞춰 보기가 다르면 statement_mismatch 알림. 서버만';

-- 5) 세금계산서 줄 취소 → 붙은 명세표는 다시 모아 둠 ------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_entry_void_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- 커밋 때 본다 — 고치기(ledger_correct_entry)는 줄을 취소한 뒤 같은 트랜잭션에서 증빙을 새 줄로 옮긴다
  IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    UPDATE public.ledger_documents d
       SET review_status = 'held', decided_by = public.ledger_actor(), decided_at = now(), decision_reason = NULL
     WHERE d.review_status = 'posted'
       AND d.id IN (SELECT ev.document_id FROM public.ledger_evidence ev WHERE ev.entry_id = NEW.id AND ev.role = 'supporting');
    DELETE FROM public.ledger_evidence ev WHERE ev.entry_id = NEW.id AND ev.role = 'supporting';
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.ledger_entry_void_release() IS '장부 줄을 취소하면(커밋 때) 아직 그 줄에 붙은 명세표(supporting)의 연결을 풀고 held 로 돌린다 — 고치기로 새 줄에 옮긴 것은 그대로';

REVOKE ALL ON FUNCTION public.ledger_entry_void_release() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_entries_void_release ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_entries_void_release AFTER UPDATE ON public.ledger_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_entry_void_release();

-- 6) 세금계산서 없음 알림 ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_invoice_missing_scan(p_month date)
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
  v_to := (v_from + interval '1 month')::date;
  INSERT INTO public.ledger_notices (company_id, kind, urgency, data, dedupe_key)
  SELECT g.company_id, 'invoice_missing', 'digest',
         jsonb_build_object('supplier', g.name, 'month', to_char(v_from, 'YYYY-MM'), 'count', g.n, 'supply', g.supply, 'total', g.total),
         'inv:' || g.k || ':' || to_char(v_from, 'YYYY-MM')
    FROM (SELECT d.company_id, coalesce('b' || s.biz, 'n' || s.name_key, '-') AS k, max(s.name) AS name, count(*)::integer AS n,
                 sum(s.supply_amount) AS supply, sum(s.total_amount) AS total
            FROM public.ledger_documents d
            LEFT JOIN LATERAL public.ledger_doc_supplier(d.id) s ON true
           WHERE d.review_status = 'held'
             AND coalesce(s.issue_date, (d.created_at AT TIME ZONE 'Asia/Seoul')::date) >= v_from
             AND coalesce(s.issue_date, (d.created_at AT TIME ZONE 'Asia/Seoul')::date) < v_to
           GROUP BY 1, 2) g
  ON CONFLICT (company_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$function$;

COMMENT ON FUNCTION public.ledger_invoice_missing_scan(date) IS '그 달(읽은 날짜, 없으면 올린 날) 명세표가 아직 모아 둔 채면 거래처마다 invoice_missing 알림 (거래처 · 달마다 하나). 워커가 다음 달 11일부터 부른다. 서버만';

-- 7) 붙인 명세표도 단가 변동 · separate 명세표는 증빙 경고 아님 ---------------------------

CREATE OR REPLACE FUNCTION public.ledger_doc_posted(p_document uuid)
 RETURNS TABLE(biz text, name_key text, display_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT s.biz, s.name_key, s.display_name FROM (
    SELECT public.ledger_biz_key(e.counterparty_biz_no) AS biz, public.ledger_name_key(e.counterparty_name) AS name_key,
           e.counterparty_name AS display_name, ev.role = 'primary' AS prim
      FROM public.ledger_evidence ev
      JOIN public.ledger_entries e ON e.id = ev.entry_id
     WHERE ev.document_id = p_document AND ev.role IN ('primary', 'supporting')
    UNION ALL
    SELECT public.ledger_biz_key(cp.biz_no), public.ledger_name_key(coalesce(cp.name, c.vendor_name)), coalesce(cp.name, c.vendor_name),
           ev.role = 'primary'
      FROM public.ledger_evidence ev
      JOIN public.order_costs c ON c.id = ev.cost_id
      LEFT JOIN public.counterparties cp ON cp.id = c.counterparty_id
     WHERE ev.document_id = p_document AND ev.role IN ('primary', 'supporting')
  ) s
  ORDER BY s.prim DESC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.ledger_doc_posted(uuid) IS '올린 사진의 거래처 — 올린 장부 줄 · 원가 줄의 값 (붙인 supporting 사진은 그 줄의 거래처). 서버만';

CREATE OR REPLACE FUNCTION public.ledger_doc_signals(p_document uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  -- 정해 둔 값 (위 머리글)
  c_trust_posts constant integer := 3;
  c_large_min constant integer := 3;
  c_large_window constant integer := 6;
  c_large_ratio constant numeric := 2;
  c_evidence_min constant bigint := 30000;
  v_doc public.ledger_documents%ROWTYPE;
  v_x public.ledger_extractions%ROWTYPE;
  v_biz text;
  v_name text;
  v_total bigint;
  v_date date;
  v_appr text;
  v_ev text;
  v_hist jsonb;
  v_entries jsonb;
  v_n integer;
  v_entry_n integer;
  v_trusted boolean := false;
  v_median numeric;
  v_window integer;
  v_large jsonb;
  v_dup jsonb;
  v_first boolean;
  v_nts jsonb;
  v_mode text;
BEGIN
  SELECT * INTO v_doc FROM public.ledger_documents d WHERE d.id = p_document;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_x FROM public.ledger_extractions x
   WHERE x.document_id = p_document AND x.status = 'done' ORDER BY x.attempt DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('document_id', p_document, 'read', false);
  END IF;

  v_biz := CASE WHEN v_x.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(v_x.result->>'supplier_biz_no') END;
  v_name := public.ledger_name_key(v_x.result->>'supplier_name');
  v_total := CASE WHEN jsonb_typeof(v_x.result->'total_amount') = 'number' THEN (v_x.result->>'total_amount')::numeric::bigint END;
  v_date := public.ledger_try_date(v_x.result->>'issue_date');
  v_appr := nullif(btrim(v_x.result->>'approval_no'), '');
  v_ev := v_x.result->>'evidence_type';
  -- 거래처 고르기 (0036) — 세금계산서를 따로 주는 거래처의 명세표는 증빙 경고가 아니다
  v_mode := public.ledger_supplier_mode(v_doc.company_id, v_biz, v_name);

  -- 이 거래처로 올린 줄 (이 사진에 붙은 줄은 빼고) — 최근 것부터 50줄
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.on_date DESC, h.at DESC), '[]'::jsonb) INTO v_hist
    FROM (SELECT s.* FROM public.ledger_supplier_history(v_doc.company_id) s
           WHERE (v_biz IS NOT NULL OR v_name IS NOT NULL)
             AND public.ledger_same_supplier(v_biz, v_name, s.biz, s.name_key)
             AND s.document_id IS DISTINCT FROM p_document
           ORDER BY s.on_date DESC, s.at DESC
           LIMIT 50) h;
  v_n := jsonb_array_length(v_hist);
  SELECT coalesce(jsonb_agg(t.e ORDER BY t.ord), '[]'::jsonb) INTO v_entries
    FROM jsonb_array_elements(v_hist) WITH ORDINALITY t(e, ord)
   WHERE t.e->>'src' = 'entry';
  v_entry_n := jsonb_array_length(v_entries);

  -- 믿을 만한 거래처: 장부 줄 3번 이상, 마지막 3번이 같은 계정 · 같은 증빙
  IF v_entry_n >= c_trust_posts THEN
    SELECT count(DISTINCT (t.e->>'account', t.e->>'evidence_type')) = 1 INTO v_trusted
      FROM jsonb_array_elements(v_entries) WITH ORDINALITY t(e, ord)
     WHERE t.ord <= c_trust_posts;
  END IF;

  -- 큰 금액: 최근 6번 합계의 중앙값보다 2배 넘게 (3번 이상일 때)
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (t.e->>'total')::numeric), count(*) INTO v_median, v_window
    FROM (SELECT u.e FROM jsonb_array_elements(v_hist) WITH ORDINALITY u(e, ord)
           WHERE jsonb_typeof(u.e->'total') = 'number' ORDER BY u.ord LIMIT c_large_window) t;
  IF v_window >= c_large_min AND v_total IS NOT NULL AND v_median > 0 AND v_total > c_large_ratio * v_median THEN
    v_large := jsonb_build_object('median', round(v_median), 'n', v_window, 'ratio', round(v_total / v_median, 1));
  END IF;

  -- 중복 의심: 같은 거래처 · 날짜 · 합계 (승인번호가 둘 다 있으면 같아야)
  IF v_total IS NOT NULL AND v_date IS NOT NULL AND (v_biz IS NOT NULL OR v_name IS NOT NULL) THEN
    SELECT jsonb_build_object('document_id', d2.id, 'review_status', d2.review_status, 'created_at', d2.created_at) INTO v_dup
      FROM public.ledger_documents d2
      JOIN LATERAL (SELECT x2.result, x2.checks FROM public.ledger_extractions x2
                     WHERE x2.document_id = d2.id AND x2.status = 'done' ORDER BY x2.attempt DESC LIMIT 1) l2 ON true
     WHERE d2.company_id = v_doc.company_id AND d2.id <> p_document AND d2.review_status IN ('pending', 'posted')
       AND public.ledger_same_supplier(v_biz, v_name,
             CASE WHEN l2.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(l2.result->>'supplier_biz_no') END,
             public.ledger_name_key(l2.result->>'supplier_name'))
       AND public.ledger_try_date(l2.result->>'issue_date') = v_date
       AND jsonb_typeof(l2.result->'total_amount') = 'number' AND (l2.result->>'total_amount')::numeric = v_total
       AND (v_appr IS NULL OR nullif(btrim(l2.result->>'approval_no'), '') IS NULL OR nullif(btrim(l2.result->>'approval_no'), '') = v_appr)
     ORDER BY d2.created_at
     LIMIT 1;
    IF v_dup IS NULL THEN
      SELECT jsonb_build_object(CASE WHEN t.e->>'src' = 'entry' THEN 'entry_id' ELSE 'cost_id' END, t.e->'row_id', 'on_date', t.e->'on_date') INTO v_dup
        FROM jsonb_array_elements(v_hist) t(e)
       WHERE jsonb_typeof(t.e->'document_id') = 'null'
         AND public.ledger_try_date(t.e->>'on_date') = v_date
         AND jsonb_typeof(t.e->'total') = 'number' AND (t.e->>'total')::numeric = v_total
       LIMIT 1;
    END IF;
  END IF;

  -- 처음 보는 거래처: 올린 줄이 없고, 먼저 올라온 같은 거래처 사진도 없음
  IF v_biz IS NOT NULL OR v_name IS NOT NULL THEN
    v_first := v_n = 0 AND NOT EXISTS (
      SELECT 1 FROM public.ledger_documents d3
      JOIN LATERAL (SELECT x3.result, x3.checks FROM public.ledger_extractions x3
                     WHERE x3.document_id = d3.id AND x3.status = 'done' ORDER BY x3.attempt DESC LIMIT 1) l3 ON true
       WHERE d3.company_id = v_doc.company_id AND d3.id <> p_document AND d3.review_status IN ('pending', 'posted')
         AND d3.created_at < v_doc.created_at
         AND public.ledger_same_supplier(v_biz, v_name,
               CASE WHEN l3.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(l3.result->>'supplier_biz_no') END,
               public.ledger_name_key(l3.result->>'supplier_name')));
  END IF;

  IF v_biz IS NOT NULL THEN
    SELECT jsonb_build_object('status', s.status, 'tax_type', s.tax_type, 'closed_on', s.closed_on, 'checked_at', s.checked_at) INTO v_nts
      FROM public.nts_business_status s WHERE s.biz_no = v_biz;
  END IF;

  RETURN jsonb_build_object(
    'document_id', p_document,
    'read', true,
    'extraction_id', v_x.id,
    'supplier', jsonb_build_object('biz_no', v_biz, 'name_key', v_name, 'name', v_x.result->>'supplier_name'),
    'supplier_key', coalesce('b' || v_biz, 'n' || v_name),
    'invoice_mode', v_mode,
    'memory', jsonb_build_object(
      'posts', v_n,
      'entry_posts', v_entry_n,
      'last', CASE WHEN v_n > 0 THEN (v_hist->0) - 'row_id' - 'document_id' - 'biz' - 'name_key' END,
      'last_entry', CASE WHEN v_entry_n > 0 THEN (v_entries->0) - 'row_id' - 'document_id' - 'biz' - 'name_key' END),
    'trusted', coalesce(v_trusted, false),
    'first_time', v_first,
    'large', v_large,
    'duplicate', v_dup,
    'evidence_risk', coalesce(v_total > c_evidence_min AND v_ev IN ('simple_receipt', 'statement')
                              AND NOT (v_ev = 'statement' AND v_mode IS NOT DISTINCT FROM 'separate'), false),
    'nts', v_nts);
END;
$function$;

COMMENT ON FUNCTION public.ledger_doc_signals(uuid) IS '사진 한 장의 확인 힌트 — 거래처 기억(올린 값) · 믿을 만함 · 처음 거래처 · 큰 금액 · 중복 의심 · 증빙 경고(separate 거래처 명세표는 아님) · 국세청 상태 · 거래처 열쇠 · 고른 것(invoice_mode). 서버만';

CREATE OR REPLACE FUNCTION public.ledger_notices_scan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  c_batch constant integer := 200;
  c_evidence_min constant bigint := 30000;
  -- 1분 늦게 본다 — 그 사이 끝난 트랜잭션도 빠짐없이 보이게
  v_until timestamp with time zone := now() - interval '1 minute';
  v_read timestamp with time zone;
  v_post timestamp with time zone;
  v_read_to timestamp with time zone;
  v_post_to timestamp with time zone;
  v_reads integer := 0;
  v_posts integer := 0;
  v_added integer := 0;
  v_n integer;
  r record;
  s jsonb;
  v_key text;
BEGIN
  SELECT c.at INTO v_read FROM public.ledger_notice_cursor c WHERE c.kind = 'read' FOR UPDATE;
  SELECT c.at INTO v_post FROM public.ledger_notice_cursor c WHERE c.kind = 'post' FOR UPDATE;
  IF v_read IS NULL OR v_post IS NULL THEN
    RAISE EXCEPTION 'ledger_notice_cursor rows missing';
  END IF;
  v_read_to := greatest(v_read, v_until);
  v_post_to := greatest(v_post, v_until);

  -- 첫 읽음 → 중복 · 큰 금액(now), 처음 거래처(digest)
  FOR r IN
    SELECT x.document_id, x.finished_at, d.company_id, d.created_at
      FROM public.ledger_extractions x
      JOIN public.ledger_documents d ON d.id = x.document_id
     WHERE x.status = 'done' AND x.finished_at > v_read AND x.finished_at <= v_until
       AND d.review_status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.ledger_extractions y
                        WHERE y.document_id = x.document_id AND y.status = 'done' AND y.attempt < x.attempt)
     ORDER BY x.finished_at
     LIMIT c_batch
  LOOP
    v_reads := v_reads + 1;
    v_read_to := r.finished_at;
    s := public.ledger_doc_signals(r.document_id);
    IF s IS NULL OR NOT coalesce((s->>'read')::boolean, false) THEN
      CONTINUE;
    END IF;
    -- 두 사진이 서로 중복이면 나중에 올라온 사진에만 알린다
    IF jsonb_typeof(s->'duplicate') = 'object'
       AND NOT coalesce((s#>>'{duplicate,created_at}')::timestamp with time zone > r.created_at, false) THEN
      INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, data, dedupe_key)
      VALUES (r.company_id, 'duplicate', 'now', r.document_id,
              jsonb_build_object('supplier', s#>'{supplier,name}', 'of', s->'duplicate'), 'dup:' || r.document_id)
      ON CONFLICT (company_id, dedupe_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_added := v_added + v_n;
    END IF;
    IF jsonb_typeof(s->'large') = 'object' THEN
      INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, data, dedupe_key)
      SELECT r.company_id, 'large_amount', 'now', r.document_id,
             jsonb_build_object('supplier', s#>'{supplier,name}', 'total', x.result->'total_amount') || (s->'large'),
             'large:' || r.document_id
        FROM public.ledger_extractions x WHERE x.id = (s->>'extraction_id')::uuid
      ON CONFLICT (company_id, dedupe_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_added := v_added + v_n;
    END IF;
    IF coalesce((s->>'first_time')::boolean, false) THEN
      v_key := coalesce('b' || (s#>>'{supplier,biz_no}'), 'n' || (s#>>'{supplier,name_key}'));
      INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, data, dedupe_key)
      VALUES (r.company_id, 'new_supplier', 'digest', r.document_id,
              jsonb_build_object('supplier', s#>'{supplier,name}', 'biz_no', s#>'{supplier,biz_no}'), 'new:' || v_key)
      ON CONFLICT (company_id, dedupe_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_added := v_added + v_n;
    END IF;
  END LOOP;
  IF v_reads < c_batch THEN
    v_read_to := greatest(v_read, v_until);
  END IF;

  -- 올림 → 증빙 경고 · 단가 변동 (digest). 세금계산서 줄에 붙인 명세표(supporting)도 단가를 본다 (0036)
  FOR r IN
    SELECT d.id AS document_id, d.company_id, d.decided_at, ev.entry_id, ev.cost_id
      FROM public.ledger_documents d
      JOIN public.ledger_evidence ev ON ev.document_id = d.id AND ev.role IN ('primary', 'supporting')
     WHERE d.review_status = 'posted' AND d.decided_at > v_post AND d.decided_at <= v_until
     ORDER BY d.decided_at
     LIMIT c_batch
  LOOP
    v_posts := v_posts + 1;
    v_post_to := r.decided_at;

    INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, entry_id, data, dedupe_key)
    SELECT r.company_id, 'evidence_risk', 'digest', r.document_id, e.id,
           jsonb_build_object('supplier', e.counterparty_name, 'total', e.amount + e.vat_amount, 'evidence_type', e.evidence_type, 'on_date', e.entry_date),
           'evid:e:' || e.id
      FROM public.ledger_entries e
     WHERE e.id = r.entry_id AND e.voided_at IS NULL AND e.direction = 'expense'
       AND e.amount + e.vat_amount > c_evidence_min AND e.evidence_type IN ('simple_receipt', 'statement', 'none')
    ON CONFLICT (company_id, dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_added := v_added + v_n;

    INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, cost_id, data, dedupe_key)
    SELECT r.company_id, 'evidence_risk', 'digest', r.document_id, c.id,
           jsonb_build_object('supplier', c.vendor_name, 'total', c.amount + coalesce(c.vat_amount, 0), 'evidence_type', c.evidence_type, 'on_date', c.spent_on),
           'evid:c:' || c.id
      FROM public.order_costs c
     WHERE c.id = r.cost_id AND c.amount + coalesce(c.vat_amount, 0) > c_evidence_min
       AND c.evidence_type IN ('simple_receipt', 'statement', 'none')
    ON CONFLICT (company_id, dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_added := v_added + v_n;

    INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, entry_id, cost_id, data, dedupe_key)
    SELECT r.company_id, 'price_change', 'digest', r.document_id, r.entry_id, r.cost_id,
           jsonb_build_object('supplier', ps.display_name, 'item', cur.item_name, 'old', prev.unit_price, 'new', cur.unit_price,
                              'old_document_id', prev.document_id, 'basis', 'read'),
           'price:' || r.document_id || ':' || left(cur.item_key, 120)
      FROM public.ledger_doc_posted(r.document_id) ps
      CROSS JOIN LATERAL public.ledger_doc_items(r.document_id) cur
      CROSS JOIN LATERAL (
        SELECT pi.unit_price, d2.id AS document_id
          FROM public.ledger_documents d2
          JOIN public.ledger_evidence e2 ON e2.document_id = d2.id AND e2.role IN ('primary', 'supporting')
          CROSS JOIN LATERAL public.ledger_doc_posted(d2.id) p2
          CROSS JOIN LATERAL public.ledger_doc_items(d2.id) pi
         WHERE d2.company_id = r.company_id AND d2.review_status = 'posted' AND d2.id <> r.document_id
           AND d2.decided_at < r.decided_at
           AND public.ledger_same_supplier(ps.biz, ps.name_key, p2.biz, p2.name_key)
           AND pi.item_key = cur.item_key
         ORDER BY d2.decided_at DESC
         LIMIT 1) prev
     WHERE prev.unit_price <> cur.unit_price
    ON CONFLICT (company_id, dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_added := v_added + v_n;
  END LOOP;
  IF v_posts < c_batch THEN
    v_post_to := greatest(v_post, v_until);
  END IF;

  UPDATE public.ledger_notice_cursor c SET at = v_read_to WHERE c.kind = 'read';
  UPDATE public.ledger_notice_cursor c SET at = v_post_to WHERE c.kind = 'post';
  RETURN jsonb_build_object('reads', v_reads, 'posts', v_posts, 'added', v_added);
END;
$function$;

COMMENT ON FUNCTION public.ledger_notices_scan() IS '장부 알림 훑기 — 커서 뒤 1분 지난 첫 읽음(중복 · 큰 금액 · 처음 거래처) · 올림(증빙 경고 · 단가 변동, 붙인 명세표도 단가)을 보고 알림을 넣고 커서를 옮긴다. 다시 돌려도 같은 알림은 하나. service_role 전용';

-- 8) 권한 — 서버만 ------------------------------------------------------------------

ALTER TABLE public.ledger_supplier_modes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ledger_supplier_modes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_supplier_modes TO service_role;

REVOKE ALL ON FUNCTION public.ledger_supplier_mode(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_supplier_mode(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_supplier(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_supplier(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_set_supplier_mode(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_set_supplier_mode(uuid, uuid, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_hold_documents(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_hold_documents(uuid, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_unhold_documents(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_unhold_documents(uuid, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_held_documents(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_held_documents(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_supplier_entries(uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_supplier_entries(uuid, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_statements_compare(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_statements_compare(uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_attach_statements(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_attach_statements(uuid, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_invoice_missing_scan(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_invoice_missing_scan(date) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_posted(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_posted(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_signals(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_signals(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_notices_scan() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_notices_scan() TO service_role;
