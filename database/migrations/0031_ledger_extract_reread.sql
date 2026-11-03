-- =============================================
-- 0031 — 사진 읽기 · 새 판으로 다시 읽기 (회계장부)
--
-- 읽은(done) 사진은 같은 판으로 두 번 읽지 않는다 (0029 그대로). 읽는 방법이 바뀌어 판(ledger_extractions.schema_version)이
-- 올라가면, 그보다 낮은 판으로 읽은 확인 기다리는 사진은 새 판으로 다시 읽을 수 있게 한다. 지난 시도는 그대로 남는다.
--
-- 함수 (서버만) — 인자가 늘어 0029 의 함수는 지우고 새로 만든다 (같은 이름이 둘이면 PostgREST 가 고르지 못한다).
--   새 인자는 기본값 NULL 이라 옛 인자로 부르는 워커도 0029 와 똑같이 돈다.
--   ledger_extract_begin(사진, 최대 시도, 다시, 판)  0029 에 판을 더한다. 마지막 시도가 읽음(done)이어도
--                               다시 = true 이고 그 시도의 판이 주어진 판보다 낮으면 다음 시도를 연다 (다시는 시도 5까지).
--                               판이 NULL 이면 0029 와 같다 — 읽은 사진은 막는다
--   ledger_extract_due(몇 개, 기다린 초, 멈춘 초, 최대 시도, 다시 읽을 판)  0029 에 다시 읽을 판을 더한다.
--                               마지막 시도가 읽음이고 그 판이 다시 읽을 판보다 낮은 확인 기다리는 사진도 준다 (시도 5 아래).
--                               그런 사진은 reread = true — 부르는 쪽이 다시(again)로 건다.
--                               차례는 시도 없음 · 실패가 먼저, 다시 읽기는 그 뒤 (각각 오래된 것부터).
--                               다시 읽을 판이 NULL 이면 0029 와 같은 사진만 준다 (reread 는 모두 false)
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 읽기 시작 ----------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ledger_extract_begin(uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.ledger_extract_begin(p_document uuid, p_max_attempts integer, p_again boolean DEFAULT false, p_schema_version integer DEFAULT NULL)
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
  IF p_schema_version IS NOT NULL AND p_schema_version < 1 THEN
    RAISE EXCEPTION 'p_schema_version must be >= 1';
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
    -- 읽은 사진은 막는다 — 다시 읽기로 더 낮은 판에서 새 판으로 올릴 때만 연다
    IF v_last.status = 'done'
       AND NOT (coalesce(p_again, false) AND coalesce(v_last.schema_version, 0) < coalesce(p_schema_version, 0)) THEN
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

COMMENT ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean, integer) IS '사진 읽기 시작 — 확인 기다리는 사진에 running 시도 한 줄 (도는 것 · 읽은 것 · 최대 시도면 막음, p_again 은 거절 · 한도 뒤 다시 읽기, p_again + p_schema_version 은 더 낮은 판으로 읽은 사진을 새 판으로 다시 읽기). service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_extract_begin(uuid, integer, boolean, integer) TO service_role;

-- 2) 다시 걸 사진 -------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ledger_extract_due(integer, integer, integer, integer);

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
     AND (lx.status IS NULL
          OR (lx.status = 'failed' AND lx.attempt < p_max_attempts)
          OR (lx.status = 'done' AND coalesce(lx.schema_version, 0) < coalesce(p_reread_below, 0) AND lx.attempt < 5))
   ORDER BY coalesce(lx.status = 'done', false), d.created_at
   LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) IS '매분 cron 이 다시 걸 사진 — 멈춘 running 을 failed(stuck)로 닫고, 시도가 없거나 마지막이 failed(최대 시도 아래)인 확인 기다리는 사진, 그다음 p_reread_below 보다 낮은 판으로 읽은 사진(reread). service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_extract_due(integer, integer, integer, integer, integer) TO service_role;
