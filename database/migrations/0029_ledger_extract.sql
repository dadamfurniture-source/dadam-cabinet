-- =============================================
-- 0029 — 영수증 · 거래명세표 사진 읽기 (회계장부)
--
-- 흐름: 사진이 올라오면(workflow-api) assistant-api 가 Claude 로 읽고 시도마다 한 줄을 남긴다.
--       대표 · 실장이 확인 화면에서 고쳐 올리면(ledger_post_document) 읽은 값과 다른 칸을 남긴다 — 다음 평가 자료.
--       사진 상태(ledger_documents.review_status)는 읽기와 따로다 — 읽기를 못 해도 확인 기다림(pending)이라 직접 입력은 된다.
--
-- 표 (모두 RLS 켬, 정책 없음, 서버 service_role 만)
--   ledger_extractions          읽기 시도마다 한 줄 (attempt 1부터, 사진마다 MAX 5). status running → done(읽음) · failed(실패)
--                               · refused(Claude 거절) · skipped_budget(월 한도로 읽지 않음). 쓰는 쪽은 assistant-api 하나.
--                               result = 읽은 칸(스키마 판 schema_version), checks = 정해진 검사(사업자번호 검증 숫자 · 금액 합
--                               · 날짜 · 문서 수), usage · cost_micros = 그 시도의 사용량 · 비용(US 달러 백만분의 1).
--                               카드번호 · 고객 이름 · 주소 · 전화는 스키마에 칸이 없다 (assistant-api).
--                               지우지 않는다. 끝난 시도는 고치지 않는다 (트리거)
--   ledger_extraction_feedback  올린 사진마다 한 줄 — fields { 칸: { read, posted } } 는 읽은 값과 올린 값이 다른 칸만.
--                               덧붙이기만. 쓰는 쪽은 workflow-api (확인 화면 올리기)
--   nts_business_status         국세청 사업자 상태 조회 캐시 — 사업자번호마다 한 줄 (공개 정보라 업체와 무관).
--                               status active 계속 · suspended 휴업 · closed 폐업 · unregistered 미등록 (counterparties.nts_status 와 같다)
--
-- 함수 (서버만)
--   ledger_extract_begin(사진, 최대 시도, 다시)  읽기 시작 — 사진 줄을 잠그고, 확인 기다리는 사진이면 running 시도 한 줄을 만든다.
--                               막는 것: 도는 시도가 있음(running) · 이미 읽음(done) · 마지막이 거절 · 한도(refused · skipped_budget,
--                               다시 = true 면 된다) · 최대 시도. 같은 사진을 두 곳(올린 직후 · 매분 cron)이 불러도 하나만 돈다
--   ledger_extract_due(몇 개, 기다린 초, 멈춘 초, 최대 시도)  매분 cron(workflow-api)이 다시 걸 사진.
--                               먼저 멈춘 초 넘게 running 인 시도를 failed(stuck)로 닫는다. 그다음 확인 기다리는 사진 중
--                               올린 지 기다린 초가 지났고 시도가 없거나, 마지막 시도가 failed 이고 최대 시도보다 적은 것 — 오래된 것부터
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 읽기 시도 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    attempt smallint NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    model text,
    schema_version smallint,
    result jsonb,
    checks jsonb,
    usage jsonb,
    cost_micros bigint,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT ledger_extractions_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_extractions_attempt_key UNIQUE (document_id, attempt),
    CONSTRAINT ledger_extractions_attempt_check CHECK (attempt BETWEEN 1 AND 5),
    CONSTRAINT ledger_extractions_status_check CHECK (status = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text, 'refused'::text, 'skipped_budget'::text])),
    CONSTRAINT ledger_extractions_finished_check CHECK ((status = 'running'::text) = (finished_at IS NULL)),
    CONSTRAINT ledger_extractions_json_check CHECK (((result IS NULL) OR (jsonb_typeof(result) = 'object'::text)) AND ((checks IS NULL) OR (jsonb_typeof(checks) = 'object'::text)) AND ((usage IS NULL) OR (jsonb_typeof(usage) = 'object'::text))),
    CONSTRAINT ledger_extractions_len_check CHECK (((model IS NULL) OR (length(model) <= 100)) AND ((error IS NULL) OR (length(error) <= 200)) AND ((schema_version IS NULL) OR (schema_version > 0)) AND ((cost_micros IS NULL) OR (cost_micros >= 0))),
    CONSTRAINT ledger_extractions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.ledger_documents(id),
    CONSTRAINT ledger_extractions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.ledger_extractions IS '영수증 · 거래명세표 사진 읽기 시도 — 시도마다 한 줄. 끝난 시도는 고치지 않고 지우지 않는다. 쓰는 쪽은 assistant-api. 서버만';
COMMENT ON COLUMN public.ledger_extractions.result IS '읽은 칸 (schema_version 판). 카드번호 · 고객 이름 · 주소 · 전화 칸은 없다';
COMMENT ON COLUMN public.ledger_extractions.checks IS '정해진 검사 결과 — 사업자번호 검증 숫자 · 금액 합 · 날짜 · 문서 수 (AI 가 아니라 서버 계산)';
COMMENT ON COLUMN public.ledger_extractions.cost_micros IS '이 시도의 Claude 비용, US 달러 백만분의 1 (assistant_usage 와 같은 값)';

-- 한 사진에 도는 시도는 하나
CREATE UNIQUE INDEX IF NOT EXISTS ledger_extractions_one_running ON public.ledger_extractions USING btree (document_id) WHERE (status = 'running'::text);
CREATE INDEX IF NOT EXISTS idx_ledger_extractions_company ON public.ledger_extractions USING btree (company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_extractions_running ON public.ledger_extractions USING btree (started_at) WHERE (status = 'running'::text);

CREATE OR REPLACE FUNCTION public.ledger_extractions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_extractions are never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'ledger_extractions start as running';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.document_id, NEW.company_id, NEW.attempt, NEW.started_at)
     IS DISTINCT FROM (OLD.id, OLD.document_id, OLD.company_id, OLD.attempt, OLD.started_at) THEN
    RAISE EXCEPTION 'ledger_extractions key columns do not change';
  END IF;
  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'finished ledger_extractions do not change (%)', OLD.status;
  END IF;
  IF NEW.status <> 'running' AND NEW.finished_at IS NULL THEN
    NEW.finished_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledger_extractions_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_extractions_guard ON public.ledger_extractions;
CREATE TRIGGER trg_ledger_extractions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_extractions FOR EACH ROW EXECUTE FUNCTION public.ledger_extractions_guard();

-- 2) 고친 칸 ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_extraction_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    extraction_id uuid,
    target text NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    changed_count integer NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_extraction_feedback_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_extraction_feedback_document_key UNIQUE (document_id),
    CONSTRAINT ledger_extraction_feedback_target_check CHECK (target = ANY (ARRAY['entry'::text, 'order_cost'::text, 'attach'::text])),
    CONSTRAINT ledger_extraction_feedback_fields_check CHECK ((jsonb_typeof(fields) = 'object'::text) AND (changed_count >= 0)),
    CONSTRAINT ledger_extraction_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT ledger_extraction_feedback_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.ledger_documents(id),
    CONSTRAINT ledger_extraction_feedback_extraction_id_fkey FOREIGN KEY (extraction_id) REFERENCES public.ledger_extractions(id)
);

COMMENT ON TABLE public.ledger_extraction_feedback IS '올린 사진마다 읽은 값과 올린 값이 다른 칸 — 사진 읽기 평가 자료. 덧붙이기만. 쓰는 쪽은 workflow-api. 서버만';

CREATE INDEX IF NOT EXISTS idx_ledger_extraction_feedback_company ON public.ledger_extraction_feedback USING btree (company_id, created_at DESC);

-- 3) 국세청 사업자 상태 캐시 ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.nts_business_status (
    biz_no text NOT NULL,
    status text NOT NULL,
    tax_type text,
    closed_on date,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nts_business_status_pkey PRIMARY KEY (biz_no),
    CONSTRAINT nts_business_status_biz_check CHECK (biz_no ~ '^[0-9]{10}$'),
    CONSTRAINT nts_business_status_status_check CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text, 'unregistered'::text])),
    CONSTRAINT nts_business_status_tax_check CHECK ((tax_type IS NULL) OR (length(tax_type) <= 60))
);

COMMENT ON TABLE public.nts_business_status IS '국세청 사업자 상태 조회 캐시 (공공데이터포털 사업자등록정보 상태조회) — 사업자번호마다 한 줄. 서버만';

-- 4) 읽기 시작 · 다시 걸 사진 --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_extract_begin(p_document uuid, p_max_attempts integer, p_again boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_doc public.ledger_documents%ROWTYPE;
  v_last public.ledger_extractions%ROWTYPE;
  v_attempt integer := 1;
  v_cap integer;
  v_id uuid;
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'p_max_attempts must be 1..5';
  END IF;
  SELECT * INTO v_doc FROM public.ledger_documents d WHERE d.id = p_document FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_doc.review_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_doc.review_status);
  END IF;

  SELECT * INTO v_last FROM public.ledger_extractions x
   WHERE x.document_id = p_document ORDER BY x.attempt DESC LIMIT 1;
  IF FOUND THEN
    IF v_last.status = 'running' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'running', 'id', v_last.id);
    END IF;
    IF v_last.status = 'done' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'done', 'id', v_last.id);
    END IF;
    IF v_last.status IN ('refused', 'skipped_budget') AND NOT coalesce(p_again, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', v_last.status, 'id', v_last.id);
    END IF;
    v_cap := CASE WHEN coalesce(p_again, false) THEN 5 ELSE p_max_attempts END;
    IF v_last.attempt >= v_cap THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'max_attempts', 'id', v_last.id);
    END IF;
    v_attempt := v_last.attempt + 1;
  END IF;

  INSERT INTO public.ledger_extractions (document_id, company_id, attempt, status)
  VALUES (v_doc.id, v_doc.company_id, v_attempt, 'running')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'attempt', v_attempt, 'company_id', v_doc.company_id,
                            'storage_path', v_doc.storage_path, 'mime', v_doc.mime, 'uploaded_by', v_doc.uploaded_by);
END;
$function$;

COMMENT ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean) IS '사진 읽기 시작 — 확인 기다리는 사진에 running 시도 한 줄 (도는 것 · 읽은 것 · 최대 시도면 막음, p_again 은 거절 · 한도 뒤 다시 읽기). service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_extract_due(p_limit integer, p_wait_sec integer, p_stuck_sec integer, p_max_attempts integer)
 RETURNS TABLE(document_id uuid, company_id uuid)
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

  UPDATE public.ledger_extractions x
     SET status = 'failed', error = 'stuck'
   WHERE x.status = 'running' AND x.started_at < now() - make_interval(secs => p_stuck_sec);

  RETURN QUERY
  SELECT d.id, d.company_id
    FROM public.ledger_documents d
    LEFT JOIN LATERAL (
      SELECT x.status, x.attempt FROM public.ledger_extractions x
       WHERE x.document_id = d.id ORDER BY x.attempt DESC LIMIT 1) lx ON true
   WHERE d.review_status = 'pending'
     AND d.created_at < now() - make_interval(secs => p_wait_sec)
     AND (lx.status IS NULL OR (lx.status = 'failed' AND lx.attempt < p_max_attempts))
   ORDER BY d.created_at
   LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer) IS '매분 cron 이 다시 걸 사진 — 멈춘 running 을 failed(stuck)로 닫고, 시도가 없거나 마지막이 failed(최대 시도 아래)인 확인 기다리는 사진. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer) TO service_role;

-- 5) 권한 — 서버만 ------------------------------------------------------------------

ALTER TABLE public.ledger_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_extraction_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nts_business_status ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ledger_extractions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_extractions TO service_role;

REVOKE ALL ON TABLE public.ledger_extraction_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ledger_extraction_feedback TO service_role;

REVOKE ALL ON TABLE public.nts_business_status FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nts_business_status TO service_role;
