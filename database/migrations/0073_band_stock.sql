-- =============================================
-- 0073 밴드 재고 (2026-11-19 사장님 「빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청.」
--                · 질문 창 「PB 15T · 몸통 색마다 따로」 · 「알림 + 「밴드 만들기」 줄」 · 「「작업 자재」 출고 누를 때 같이」)
--
--   밴드를 작업마다 원장에서 켜지 않고, 미리 켜 둔 밴드(60 × 2440 본)를 재고로 두고 쓴다. 남은 수가 적으면 「밴드 만들기」 요청이 생기고,
--   만들었다고 누르면 밴드가 들어오고(입고) 짝지은 원장 한 장이 나간다(출고) — 한 번에.
--
-- 바꾸는 것:
--   1) stock_items.kind 에 band(밴드 품목) — band_color 칸(몸통 색 이름, 색 없음은 빈 글)은 밴드 품목에만 있고, 업체 · 색마다 하나
--   2) stock_band_requests — 밴드 만들기 요청 한 건. 번호 seq 는 업체마다 차례(BM-0001).
--        state  requested 요청 → made 만들었음 · cancelled 취소 (둘 다 끝). 한 품목에 열린 요청은 하나뿐
--        qty 만들 본 수 · sheet_item_id 만들 때 꺼낸 원장 품목(있으면)
--   3) stock_band_request()  요청 열기 — 열린 요청이 있으면 그것을 돌려준다(새로 열지 않는다). 품목의 「입고 예정」을 그만큼 늘린다
--      stock_band_make()     만들었음 — 밴드 stock_move('in')(입고 예정이 준다) + (원장 품목을 주면) 원장 stock_move('out') 1장, 요청을 닫는다
--      stock_band_cancel()   취소 — 입고 예정에서 빼고 닫는다
--      셋 다 한 번에(한 트랜잭션) 하고, 서버(service_role)만 부른다.
--   4) 앱 알림 종류 — 0067 목록(24개) 그대로 + 밴드 만들기 요청 stock_band_low = 25개
--
-- 읽기 · 쓰기: 새 표는 서버만. 정책이 없어 브라우저는 읽지 못한다. 지우기 없음.
-- 0059 · 0062 · 0067 이 먼저 적용돼 있어야 한다.
-- =============================================

-- 1) 밴드 품목 ------------------------------------------------------------------------
ALTER TABLE public.stock_items DROP CONSTRAINT IF EXISTS stock_items_kind_check;
ALTER TABLE public.stock_items
    ADD CONSTRAINT stock_items_kind_check CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text, 'band'::text]));

ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS band_color text;

ALTER TABLE public.stock_items DROP CONSTRAINT IF EXISTS stock_items_band_check;
ALTER TABLE public.stock_items
    ADD CONSTRAINT stock_items_band_check CHECK (((kind = 'band'::text) = (band_color IS NOT NULL)) AND (COALESCE(length(band_color), 0) <= 40));

COMMENT ON COLUMN public.stock_items.band_color IS '밴드 품목(kind band)의 몸통 색 이름 — 색 없음은 빈 글. 업체 · 색마다 밴드 품목 하나 (2026-11-20, 0073)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_band_color ON public.stock_items USING btree (company_id, band_color) WHERE (kind = 'band'::text);

-- 2) 밴드 만들기 요청 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_band_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    seq integer NOT NULL,
    item_id uuid NOT NULL,
    qty numeric(12,2) NOT NULL,
    state text DEFAULT 'requested'::text NOT NULL,
    sheet_item_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT stock_band_requests_pkey PRIMARY KEY (id),
    CONSTRAINT stock_band_requests_seq_key UNIQUE (company_id, seq),
    CONSTRAINT stock_band_requests_seq_check CHECK (seq BETWEEN 1 AND 999999),
    CONSTRAINT stock_band_requests_qty_check CHECK (qty > 0),
    CONSTRAINT stock_band_requests_state_check CHECK (state = ANY (ARRAY['requested'::text, 'made'::text, 'cancelled'::text])),
    CONSTRAINT stock_band_requests_closed_check CHECK ((state = 'requested'::text) = (closed_at IS NULL)),
    CONSTRAINT stock_band_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_band_requests_item_fkey FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_band_requests_sheet_fkey FOREIGN KEY (sheet_item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_band_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT stock_band_requests_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_band_requests IS '밴드 만들기 요청 — 밴드 품목의 남은 수가 요청 수 이하가 되면 생긴다 (2026-11-20, 0073). 번호 seq 는 업체마다 차례(BM-0001). requested → made · cancelled. 한 품목에 열린 요청 하나. 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_band_requests_open ON public.stock_band_requests USING btree (item_id) WHERE (state = 'requested'::text);
CREATE INDEX IF NOT EXISTS idx_stock_band_requests_company ON public.stock_band_requests USING btree (company_id, created_at DESC);

ALTER TABLE public.stock_band_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_band_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_band_requests TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.stock_band_requests FROM service_role;

-- 3) 함수 ----------------------------------------------------------------------------

-- 요청 열기 — 밴드 품목에만. 열린 요청이 있으면 그것을 그대로 돌려준다
CREATE OR REPLACE FUNCTION public.stock_band_request(p_company uuid, p_item uuid, p_qty numeric, p_actor uuid)
 RETURNS public.stock_band_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.stock_band_requests;
  v_seq integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'stock_band_request: 만들 수가 맞지 않습니다' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.stock_items WHERE id = p_item AND company_id = p_company AND kind = 'band' AND active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_band_request: 쓰는 밴드 품목이 아닙니다' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_row FROM public.stock_band_requests WHERE item_id = p_item AND state = 'requested';
  IF FOUND THEN
    RETURN v_row;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stock_band_requests:' || p_company::text, 0));
  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM public.stock_band_requests WHERE company_id = p_company;
  INSERT INTO public.stock_band_requests (company_id, seq, item_id, qty, created_by)
  VALUES (p_company, v_seq, p_item, p_qty, p_actor)
  RETURNING * INTO v_row;
  UPDATE public.stock_items
     SET expected_qty = COALESCE(expected_qty, 0) + p_qty,
         expected_on = COALESCE(expected_on, current_date),
         updated_at = now()
   WHERE id = p_item;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.stock_band_request(uuid, uuid, numeric, uuid) IS '밴드 만들기 요청 열기 — 밴드 품목에만, 열린 요청이 있으면 그것을 돌려준다. 품목의 입고 예정을 그만큼 늘린다 (0073)';

-- 만들었음 — 밴드 입고 + (원장 품목을 주면) 원장 1장 출고, 요청을 닫는다
CREATE OR REPLACE FUNCTION public.stock_band_make(p_company uuid, p_request uuid, p_actor uuid, p_sheet_item uuid DEFAULT NULL::uuid)
 RETURNS public.stock_band_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.stock_band_requests;
  v_ref text;
BEGIN
  SELECT * INTO v_row FROM public.stock_band_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_band_make: 요청이 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.state <> 'requested' THEN
    RAISE EXCEPTION 'stock_band_make: 이미 끝난 요청입니다' USING ERRCODE = '22023';
  END IF;
  v_ref := 'BM-' || lpad(v_row.seq::text, 4, '0');
  PERFORM public.stock_move(p_company, v_row.item_id, 'in', v_row.qty, v_ref, '밴드 만들기', p_actor);
  IF p_sheet_item IS NOT NULL THEN
    PERFORM 1 FROM public.stock_items WHERE id = p_sheet_item AND company_id = p_company AND kind = 'board';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock_band_make: 원장 품목이 아닙니다' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.stock_move(p_company, p_sheet_item, 'out', 1, v_ref, '밴드 만들기', p_actor);
  END IF;
  UPDATE public.stock_band_requests
     SET state = 'made', sheet_item_id = p_sheet_item, closed_at = now(), closed_by = p_actor
   WHERE id = p_request
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.stock_band_make(uuid, uuid, uuid, uuid) IS '밴드 만들기 끝 — 밴드를 요청 수만큼 입고하고(입고 예정이 준다) 원장 품목을 주면 1장 출고, 요청을 닫는다. 원장이 모자라면 22023 으로 아무것도 바뀌지 않는다 (0073)';

-- 취소
CREATE OR REPLACE FUNCTION public.stock_band_cancel(p_company uuid, p_request uuid, p_actor uuid)
 RETURNS public.stock_band_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.stock_band_requests;
BEGIN
  SELECT * INTO v_row FROM public.stock_band_requests WHERE id = p_request AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_band_cancel: 요청이 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.state <> 'requested' THEN
    RAISE EXCEPTION 'stock_band_cancel: 이미 끝난 요청입니다' USING ERRCODE = '22023';
  END IF;
  PERFORM public.stock_expected_take(p_company, v_row.item_id, v_row.qty);
  UPDATE public.stock_band_requests SET state = 'cancelled', closed_at = now(), closed_by = p_actor WHERE id = p_request RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.stock_band_cancel(uuid, uuid, uuid) IS '밴드 만들기 요청 취소 — 입고 예정에서 빼고 닫는다. 끝난 요청이면 22023 (0073)';

REVOKE ALL ON FUNCTION public.stock_band_request(uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_band_make(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_band_cancel(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_band_request(uuid, uuid, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_band_make(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_band_cancel(uuid, uuid, uuid) TO service_role;

-- 4) 앱 알림 종류 — 0067 목록(24개) 그대로 + 밴드 만들기 요청 하나 = 25개 ----------------------

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text, 'work_link_request'::text, 'work_reply'::text, 'work_report'::text, 'system_check_failed'::text, 'stock_band_low'::text]));
