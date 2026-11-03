-- =============================================
-- 0033 — 장부 사진 확인 · 거래처 기억 · 장부 알림 (회계장부)
--
-- 거래처 기억은 따로 쌓지 않는다. 대표 · 실장이 올린 장부 줄(취소 안 한 지출 · 자산 사기)과 수주 원가에서 그때그때 센다
-- — 줄을 취소하거나 고치면 기억도 바로 바뀐다. 읽은 값(AI)이 아니라 올린 값으로 센다.
--
-- 같은 거래처: 사업자번호(숫자 10자리 · 검증 숫자 맞음)가 둘 다 있으면 번호가 같을 때, 한쪽이라도 없으면 다듬은 상호가 같을 때.
--   상호 다듬기: 소문자 · 「주식회사」 「(주)」 「㈜」 빼기 · 한글 · 영문 · 숫자 밖의 글자(띄어쓰기 · 기호) 빼기.
--   사진 쪽 번호는 읽은 번호가 검사 ok(checks.biz_no)일 때만 쓴다.
--
-- 정해 둔 값 (대표님 확인 — 2026-11-03 계획)
--   믿을 만한 거래처   장부 줄로 3번 이상, 마지막 3번이 같은 계정 · 같은 증빙
--   큰 금액           그 거래처 최근 6번 합계의 중앙값보다 2배 넘게 큼 (3번 이상일 때)
--   중복 의심         같은 거래처 · 날짜 · 합계 (승인번호가 둘 다 있으면 그것도 같음) — 확인 기다림 · 올린 사진, 사진 없는 장부 줄
--   증빙 경고         합계 3만원 넘는 지출이 간이영수증 · 명세표 (올린 값은 + 증빙 없음)
--   단가 변동         같은 거래처 · 같은 품목 이름(다듬은)의 단가가 지난번 올린 사진과 다름 — 품목 합 검사 ok 인 사진끼리, 읽은 값 기준
--   국세청            30일 지나면 다시 조회. 처음 조회 때 이미 휴업 · 폐업이어도 알린다
--   알림 시작         이 파일을 적용한 뒤 생긴 일만 (커서 처음 값 = 적용 시각). 읽기 알림은 그 사진의 첫 「읽음」에서만
--
-- 표 (RLS 켬, 정책 없음, 서버 service_role 만)
--   ledger_notices        장부 알림 — 업체 · 종류 · 사진/줄 · 숫자(data) · dedupe_key(업체 안에서 하나).
--                         urgency now(중복 · 큰 금액 — 생길 때마다) · digest(나머지 — 아침 8시 묶음).
--                         지우지 않는다. 바꿀 수 있는 것은 pushed_at(한 번) · seen_at/seen_by(한 번, 업체에 하나)뿐
--   ledger_notice_cursor  알림을 어디까지 봤나 — read(첫 읽음) · post(올림) 두 줄
--
-- 함수 (서버만)
--   ledger_biz_key(번호) · ledger_name_key(상호) · ledger_same_supplier(...) · ledger_try_date(글)   다듬기 (IMMUTABLE)
--   ledger_supplier_history(업체)       올린 지출 줄 · 수주 원가 — 거래처 열쇠 · 계정 · 원가 종류 · 증빙 · 결제 수단 · 합계 · 날짜
--   ledger_doc_posted(사진)             올린 사진의 거래처(올린 값)
--   ledger_doc_items(사진)              마지막 읽음의 품목 단가 (품목 합 검사 ok 일 때만)
--   ledger_doc_signals(사진)            확인 화면 힌트 한 장 — 기억 · 믿을 만함 · 처음 거래처 · 큰 금액 · 중복 · 증빙 · 국세청
--   ledger_review_hints(업체, 사진들)   여러 장 (확인 목록 한 쪽, 100장까지)
--   ledger_notices_scan()               커서 뒤 1분 지난 일까지 보고 알림을 넣고 커서를 옮긴다 (한 번에 종류마다 200건)
--   ledger_notices_claim(급함, 업체 수) 앱 알림을 보낼 알림을 잡는다 → 업체마다 수 · 아직 안 본 수
--   ledger_nts_due(몇 개, 묵은 날)      다시 조회할 사업자번호
--   ledger_nts_record(결과들)           국세청 결과를 캐시 · 거래처에 적고, 휴업 · 폐업 · 과세 유형이 바뀌면 그 번호를 쓴 업체에 알림
--
-- notification_outbox.kind 에 ledger_notice 를 더한다 (0030 목록 그대로 + 하나).
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 다듬기 --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_biz_key(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- 10자리일 때만 숫자로 바꾼다 (CASE 안에 CASE — AND 는 차례를 지키지 않는다)
  SELECT CASE WHEN s.d ~ '^[0-9]{10}$' THEN
           CASE WHEN (10 - ((substr(s.d, 1, 1)::int * 1 + substr(s.d, 2, 1)::int * 3 + substr(s.d, 3, 1)::int * 7
                            + substr(s.d, 4, 1)::int * 1 + substr(s.d, 5, 1)::int * 3 + substr(s.d, 6, 1)::int * 7
                            + substr(s.d, 7, 1)::int * 1 + substr(s.d, 8, 1)::int * 3 + substr(s.d, 9, 1)::int * 5
                            + (substr(s.d, 9, 1)::int * 5) / 10) % 10)) % 10 = substr(s.d, 10, 1)::int
                THEN s.d END
         END
    FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) s
$function$;

COMMENT ON FUNCTION public.ledger_biz_key(text) IS '사업자번호 → 숫자 10자리 (국세청 검증 숫자가 맞을 때만, 아니면 NULL)';

CREATE OR REPLACE FUNCTION public.ledger_name_key(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT nullif(regexp_replace(regexp_replace(lower(coalesce(p, '')), '주식회사|\(주\)|㈜', '', 'g'),
                               '[^0-9a-z가-힣]', '', 'g'), '')
$function$;

COMMENT ON FUNCTION public.ledger_name_key(text) IS '상호 · 품목 이름 다듬기 — 소문자, 주식회사 · (주) · ㈜ 빼기, 한글 · 영문 · 숫자만';

CREATE OR REPLACE FUNCTION public.ledger_same_supplier(a_biz text, a_name text, b_biz text, b_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN a_biz IS NOT NULL AND b_biz IS NOT NULL THEN a_biz = b_biz
              ELSE coalesce(a_name IS NOT NULL AND a_name = b_name, false) END
$function$;

COMMENT ON FUNCTION public.ledger_same_supplier(text, text, text, text) IS '같은 거래처 — 번호가 둘 다 있으면 번호, 한쪽이라도 없으면 다듬은 상호';

CREATE OR REPLACE FUNCTION public.ledger_try_date(p text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN p::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.ledger_try_date(text) IS 'YYYY-MM-DD 글 → 날짜 (없는 날짜면 NULL)';

-- 2) 올린 값 · 읽은 값 --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_supplier_history(p_company uuid)
 RETURNS TABLE(src text, row_id uuid, document_id uuid, biz text, name_key text, display_name text, account text,
               category text, evidence_type text, payment_method text, total bigint, on_date date, at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT 'entry'::text, e.id, ev.document_id, public.ledger_biz_key(e.counterparty_biz_no), public.ledger_name_key(e.counterparty_name),
         e.counterparty_name, e.account, NULL::text, e.evidence_type, e.payment_method, e.amount + e.vat_amount, e.entry_date, e.created_at
    FROM public.ledger_entries e
    LEFT JOIN public.ledger_evidence ev ON ev.entry_id = e.id AND ev.role = 'primary'
   WHERE e.company_id = p_company AND e.voided_at IS NULL AND e.direction IN ('expense', 'asset_buy')
  UNION ALL
  SELECT 'cost'::text, c.id, ev.document_id, public.ledger_biz_key(cp.biz_no), public.ledger_name_key(coalesce(cp.name, c.vendor_name)),
         coalesce(cp.name, c.vendor_name), NULL::text, c.category, c.evidence_type, NULL::text, c.amount + coalesce(c.vat_amount, 0),
         coalesce(c.spent_on, (c.created_at AT TIME ZONE 'Asia/Seoul')::date), c.created_at
    FROM public.order_costs c
    JOIN public.orders o ON o.id = c.order_id
    LEFT JOIN public.counterparties cp ON cp.id = c.counterparty_id
    LEFT JOIN public.ledger_evidence ev ON ev.cost_id = c.id AND ev.role = 'primary'
   WHERE o.company_id = p_company
$function$;

COMMENT ON FUNCTION public.ledger_supplier_history(uuid) IS '업체가 올린 지출 · 자산 장부 줄(취소 제외)과 수주 원가 — 거래처 열쇠 · 계정 · 원가 종류 · 증빙 · 결제 수단 · 합계(금액 + 부가세) · 날짜. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_doc_posted(p_document uuid)
 RETURNS TABLE(biz text, name_key text, display_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM (
    SELECT public.ledger_biz_key(e.counterparty_biz_no), public.ledger_name_key(e.counterparty_name), e.counterparty_name
      FROM public.ledger_evidence ev
      JOIN public.ledger_entries e ON e.id = ev.entry_id
     WHERE ev.document_id = p_document AND ev.role = 'primary'
    UNION ALL
    SELECT public.ledger_biz_key(cp.biz_no), public.ledger_name_key(coalesce(cp.name, c.vendor_name)), coalesce(cp.name, c.vendor_name)
      FROM public.ledger_evidence ev
      JOIN public.order_costs c ON c.id = ev.cost_id
      LEFT JOIN public.counterparties cp ON cp.id = c.counterparty_id
     WHERE ev.document_id = p_document AND ev.role = 'primary'
  ) s
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.ledger_doc_posted(uuid) IS '올린 사진의 거래처 — 올린 장부 줄 · 원가 줄의 값. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_doc_items(p_document uuid)
 RETURNS TABLE(item_key text, item_name text, unit_price bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT DISTINCT ON (k.item_key) k.item_key, k.item_name, k.unit_price
    FROM (
      SELECT public.ledger_name_key(i.value->>'name') AS item_key, i.value->>'name' AS item_name,
             CASE WHEN jsonb_typeof(i.value->'unit_price') = 'number' THEN (i.value->>'unit_price')::numeric::bigint END AS unit_price,
             i.ordinality AS ord
        FROM (SELECT x.result, x.checks FROM public.ledger_extractions x
               WHERE x.document_id = p_document AND x.status = 'done' ORDER BY x.attempt DESC LIMIT 1) lx
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(lx.result->'items') = 'array' THEN lx.result->'items' ELSE '[]'::jsonb END) WITH ORDINALITY i
       WHERE lx.checks->>'items' = 'ok'
    ) k
   WHERE k.item_key IS NOT NULL AND k.unit_price IS NOT NULL
   ORDER BY k.item_key, k.ord
$function$;

COMMENT ON FUNCTION public.ledger_doc_items(uuid) IS '사진의 마지막 읽음에서 품목 단가 — 품목 합 검사가 ok 일 때만 (읽은 값). 서버만';

-- 3) 확인 화면 힌트 ------------------------------------------------------------------

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
    'memory', jsonb_build_object(
      'posts', v_n,
      'entry_posts', v_entry_n,
      'last', CASE WHEN v_n > 0 THEN (v_hist->0) - 'row_id' - 'document_id' - 'biz' - 'name_key' END,
      'last_entry', CASE WHEN v_entry_n > 0 THEN (v_entries->0) - 'row_id' - 'document_id' - 'biz' - 'name_key' END),
    'trusted', coalesce(v_trusted, false),
    'first_time', v_first,
    'large', v_large,
    'duplicate', v_dup,
    'evidence_risk', coalesce(v_total > c_evidence_min AND v_ev IN ('simple_receipt', 'statement'), false),
    'nts', v_nts);
END;
$function$;

COMMENT ON FUNCTION public.ledger_doc_signals(uuid) IS '사진 한 장의 확인 힌트 — 거래처 기억(올린 값) · 믿을 만함 · 처음 거래처 · 큰 금액 · 중복 의심 · 증빙 경고 · 국세청 상태. 서버만';

CREATE OR REPLACE FUNCTION public.ledger_review_hints(p_company uuid, p_documents uuid[])
 RETURNS TABLE(document_id uuid, hints jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_company IS NULL OR p_documents IS NULL OR cardinality(p_documents) > 100 THEN
    RAISE EXCEPTION 'p_company and up to 100 p_documents';
  END IF;
  RETURN QUERY
  SELECT d.id, public.ledger_doc_signals(d.id)
    FROM public.ledger_documents d
   WHERE d.company_id = p_company AND d.id = ANY (p_documents);
END;
$function$;

COMMENT ON FUNCTION public.ledger_review_hints(uuid, uuid[]) IS '확인 목록 한 쪽의 힌트 — 그 업체 사진만, 100장까지. service_role 전용';

-- 4) 장부 알림 ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    kind text NOT NULL,
    urgency text NOT NULL,
    document_id uuid,
    entry_id uuid,
    cost_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pushed_at timestamp with time zone,
    seen_at timestamp with time zone,
    seen_by uuid,
    CONSTRAINT ledger_notices_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_notices_dedupe_key UNIQUE (company_id, dedupe_key),
    CONSTRAINT ledger_notices_kind_check CHECK (kind = ANY (ARRAY['duplicate'::text, 'large_amount'::text, 'new_supplier'::text, 'supplier_status'::text, 'price_change'::text, 'evidence_risk'::text])),
    CONSTRAINT ledger_notices_urgency_check CHECK (urgency = (CASE WHEN kind = ANY (ARRAY['duplicate'::text, 'large_amount'::text]) THEN 'now'::text ELSE 'digest'::text END)),
    CONSTRAINT ledger_notices_data_check CHECK ((jsonb_typeof(data) = 'object'::text) AND (octet_length(data::text) <= 8192) AND (length(dedupe_key) BETWEEN 1 AND 200)),
    CONSTRAINT ledger_notices_seen_check CHECK ((seen_at IS NULL) = (seen_by IS NULL)),
    CONSTRAINT ledger_notices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT ledger_notices_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.ledger_documents(id),
    CONSTRAINT ledger_notices_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.ledger_entries(id)
);

COMMENT ON TABLE public.ledger_notices IS '장부 알림 — now(중복 · 큰 금액, 생길 때마다) · digest(아침 8시 묶음). 숫자는 서버 계산. 지우지 않는다. pushed_at · seen_at 만 한 번 바꾼다. cost_id 는 원가 줄이 다시 쓰여도 남게 FK 없음. 서버만';

CREATE INDEX IF NOT EXISTS idx_ledger_notices_company ON public.ledger_notices USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_notices_unpushed ON public.ledger_notices USING btree (urgency, company_id) WHERE (pushed_at IS NULL);

CREATE OR REPLACE FUNCTION public.ledger_notices_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_notices are never deleted';
  END IF;
  IF (NEW.id, NEW.company_id, NEW.kind, NEW.urgency, NEW.document_id, NEW.entry_id, NEW.cost_id, NEW.data, NEW.dedupe_key, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.kind, OLD.urgency, OLD.document_id, OLD.entry_id, OLD.cost_id, OLD.data, OLD.dedupe_key, OLD.created_at) THEN
    RAISE EXCEPTION 'ledger_notices only change pushed_at and seen_at';
  END IF;
  IF OLD.pushed_at IS NOT NULL AND NEW.pushed_at IS DISTINCT FROM OLD.pushed_at THEN
    RAISE EXCEPTION 'ledger_notices pushed_at is set once';
  END IF;
  IF OLD.seen_at IS NOT NULL AND (NEW.seen_at, NEW.seen_by) IS DISTINCT FROM (OLD.seen_at, OLD.seen_by) THEN
    RAISE EXCEPTION 'ledger_notices seen_at is set once';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledger_notices_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_notices_guard ON public.ledger_notices;
CREATE TRIGGER trg_ledger_notices_guard BEFORE UPDATE OR DELETE ON public.ledger_notices FOR EACH ROW EXECUTE FUNCTION public.ledger_notices_guard();

CREATE TABLE IF NOT EXISTS public.ledger_notice_cursor (
    kind text NOT NULL,
    at timestamp with time zone NOT NULL,
    CONSTRAINT ledger_notice_cursor_pkey PRIMARY KEY (kind),
    CONSTRAINT ledger_notice_cursor_kind_check CHECK (kind = ANY (ARRAY['read'::text, 'post'::text]))
);

COMMENT ON TABLE public.ledger_notice_cursor IS '장부 알림을 어디까지 봤나 — read(첫 읽음 finished_at) · post(올림 decided_at). 처음 값은 이 파일을 적용한 시각. 서버만';

-- 처음 값 = 적용 시각 (이미 있으면 그대로) — 그전 일로는 알리지 않는다
INSERT INTO public.ledger_notice_cursor (kind, at) VALUES ('read', now()), ('post', now()) ON CONFLICT (kind) DO NOTHING;

-- 알림이 보는 때 (매분 · 5분마다 훑는다)
CREATE INDEX IF NOT EXISTS idx_ledger_extractions_done_finished ON public.ledger_extractions USING btree (finished_at) WHERE (status = 'done'::text);
CREATE INDEX IF NOT EXISTS idx_ledger_documents_posted_decided ON public.ledger_documents USING btree (decided_at) WHERE (review_status = 'posted'::text);

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

  -- 올림 → 증빙 경고 · 단가 변동 (digest)
  FOR r IN
    SELECT d.id AS document_id, d.company_id, d.decided_at, ev.entry_id, ev.cost_id
      FROM public.ledger_documents d
      JOIN public.ledger_evidence ev ON ev.document_id = d.id AND ev.role = 'primary'
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
          JOIN public.ledger_evidence e2 ON e2.document_id = d2.id AND e2.role = 'primary'
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

COMMENT ON FUNCTION public.ledger_notices_scan() IS '장부 알림 훑기 — 커서 뒤 1분 지난 첫 읽음(중복 · 큰 금액 · 처음 거래처) · 올림(증빙 경고 · 단가 변동)을 보고 알림을 넣고 커서를 옮긴다. 다시 돌려도 같은 알림은 하나. service_role 전용';

CREATE OR REPLACE FUNCTION public.ledger_notices_claim(p_urgency text, p_companies integer)
 RETURNS TABLE(company_id uuid, notices integer, unseen integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF p_urgency IS NULL OR p_urgency NOT IN ('now', 'digest') THEN
    RAISE EXCEPTION 'p_urgency must be now or digest';
  END IF;
  IF p_companies IS NULL OR p_companies NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_companies must be 1..200';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM public.ledger_notices n
     WHERE n.pushed_at IS NULL AND n.urgency = p_urgency
       AND n.company_id IN (SELECT DISTINCT n2.company_id FROM public.ledger_notices n2
                             WHERE n2.pushed_at IS NULL AND n2.urgency = p_urgency
                             ORDER BY n2.company_id LIMIT p_companies)
       FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.ledger_notices n SET pushed_at = now()
      FROM picked WHERE n.id = picked.id
    RETURNING n.company_id AS cid, n.seen_at AS seen
  )
  SELECT upd.cid, count(*)::integer, (count(*) FILTER (WHERE upd.seen IS NULL))::integer
    FROM upd GROUP BY upd.cid;
END;
$function$;

COMMENT ON FUNCTION public.ledger_notices_claim(text, integer) IS '앱 알림으로 보낼 장부 알림을 잡는다 (pushed_at) — 업체마다 수 · 아직 안 본 수. service_role 전용';

-- 5) 국세청 상태 --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_nts_due(p_limit integer, p_stale_days integer)
 RETURNS TABLE(biz_no text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be 1..100';
  END IF;
  IF p_stale_days IS NULL OR p_stale_days < 1 THEN
    RAISE EXCEPTION 'p_stale_days must be >= 1';
  END IF;
  RETURN QUERY
  SELECT k.biz
    FROM (
      SELECT public.ledger_biz_key(lx.result->>'supplier_biz_no') AS biz
        FROM public.ledger_documents d
        JOIN LATERAL (SELECT x.result, x.checks FROM public.ledger_extractions x
                       WHERE x.document_id = d.id AND x.status = 'done' ORDER BY x.attempt DESC LIMIT 1) lx ON true
       WHERE d.review_status IN ('pending', 'posted') AND lx.checks->>'biz_no' = 'ok'
      UNION
      SELECT public.ledger_biz_key(e.counterparty_biz_no)
        FROM public.ledger_entries e
       WHERE e.voided_at IS NULL AND e.counterparty_biz_no IS NOT NULL
    ) k
    LEFT JOIN public.nts_business_status s ON s.biz_no = k.biz
   WHERE k.biz IS NOT NULL
     AND (s.biz_no IS NULL OR s.checked_at < now() - make_interval(days => p_stale_days))
   ORDER BY s.checked_at NULLS FIRST, k.biz
   LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.ledger_nts_due(integer, integer) IS '국세청에 다시 물을 사업자번호 — 사진(확인 기다림 · 올림)과 장부 줄에 나온 번호 중 캐시가 없거나 묵은 것. service_role 전용';

CREATE OR REPLACE FUNCTION public.ledger_nts_record(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  r jsonb;
  v_old public.nts_business_status%ROWTYPE;
  v_had boolean;
  v_biz text;
  v_status text;
  v_tax text;
  v_closed date;
  v_saved integer := 0;
  v_added integer := 0;
  v_n integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'p_rows must be an array of up to 100';
  END IF;
  FOR r IN SELECT e.value FROM jsonb_array_elements(p_rows) e
  LOOP
    v_biz := r->>'biz_no';
    v_status := r->>'status';
    v_tax := nullif(btrim(coalesce(r->>'tax_type', '')), '');
    v_closed := public.ledger_try_date(r->>'closed_on');
    IF public.ledger_biz_key(v_biz) IS DISTINCT FROM v_biz THEN
      RAISE EXCEPTION 'bad biz_no';
    END IF;

    SELECT * INTO v_old FROM public.nts_business_status s WHERE s.biz_no = v_biz FOR UPDATE;
    v_had := FOUND;
    INSERT INTO public.nts_business_status (biz_no, status, tax_type, closed_on, checked_at)
    VALUES (v_biz, v_status, v_tax, v_closed, now())
    ON CONFLICT (biz_no) DO UPDATE SET status = EXCLUDED.status, tax_type = EXCLUDED.tax_type,
                                       closed_on = EXCLUDED.closed_on, checked_at = EXCLUDED.checked_at;
    UPDATE public.counterparties cp SET nts_status = v_status, tax_type = v_tax, nts_checked_at = now()
     WHERE cp.biz_no = v_biz;
    v_saved := v_saved + 1;

    -- 휴업 · 폐업이 됐거나(처음 조회 포함), 과세 유형이 바뀌었으면 이 번호를 쓴 업체에 알림
    IF (v_status IN ('suspended', 'closed') AND (NOT v_had OR v_old.status IS DISTINCT FROM v_status))
       OR (v_had AND v_old.tax_type IS NOT NULL AND v_tax IS NOT NULL AND v_old.tax_type <> v_tax) THEN
      INSERT INTO public.ledger_notices (company_id, kind, urgency, document_id, data, dedupe_key)
      SELECT u.company_id, 'supplier_status', 'digest', u.document_id,
             jsonb_build_object('biz_no', v_biz, 'supplier', u.display_name, 'status', v_status,
                                'old_status', CASE WHEN v_had THEN v_old.status END, 'tax_type', v_tax,
                                'old_tax_type', CASE WHEN v_had THEN v_old.tax_type END, 'closed_on', v_closed),
             'nts:' || v_biz || ':' || v_status || ':' || left(coalesce(v_tax, '-'), 60)
        FROM (
          SELECT DISTINCT ON (w.company_id) w.company_id, w.display_name, w.document_id
            FROM (
              SELECT d.company_id, lx.result->>'supplier_name' AS display_name, d.id AS document_id, d.created_at AS at
                FROM public.ledger_documents d
                JOIN LATERAL (SELECT x.result, x.checks FROM public.ledger_extractions x
                               WHERE x.document_id = d.id AND x.status = 'done' ORDER BY x.attempt DESC LIMIT 1) lx ON true
               WHERE d.review_status IN ('pending', 'posted') AND lx.checks->>'biz_no' = 'ok'
                 AND public.ledger_biz_key(lx.result->>'supplier_biz_no') = v_biz
              UNION ALL
              SELECT e.company_id, e.counterparty_name, NULL::uuid, e.created_at
                FROM public.ledger_entries e
               WHERE e.voided_at IS NULL AND e.counterparty_biz_no = v_biz
            ) w
           ORDER BY w.company_id, w.at DESC
        ) u
      ON CONFLICT (company_id, dedupe_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_added := v_added + v_n;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('saved', v_saved, 'added', v_added);
END;
$function$;

COMMENT ON FUNCTION public.ledger_nts_record(jsonb) IS '국세청 상태 결과 [{biz_no, status, tax_type, closed_on}] — 캐시 · 거래처에 적고, 휴업 · 폐업(처음 조회 포함) · 과세 유형 바뀜이면 그 번호를 쓴 업체에 알림. service_role 전용';

-- 6) 앱 알림 종류 -------------------------------------------------------------------

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text]));

-- 7) 권한 — 서버만 ------------------------------------------------------------------

ALTER TABLE public.ledger_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_notice_cursor ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ledger_notices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_notices TO service_role;

REVOKE ALL ON TABLE public.ledger_notice_cursor FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.ledger_notice_cursor TO service_role;

REVOKE ALL ON FUNCTION public.ledger_biz_key(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_biz_key(text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_name_key(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_name_key(text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_same_supplier(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_same_supplier(text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_try_date(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_try_date(text) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_supplier_history(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_supplier_history(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_posted(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_posted(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_items(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_items(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_doc_signals(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_doc_signals(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_review_hints(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_review_hints(uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_notices_scan() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_notices_scan() TO service_role;
REVOKE ALL ON FUNCTION public.ledger_notices_claim(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_notices_claim(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_nts_due(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_nts_due(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ledger_nts_record(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_nts_record(jsonb) TO service_role;
