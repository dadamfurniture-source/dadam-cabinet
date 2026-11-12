-- =============================================
-- 0062 재고 구매 발주 (2026-11-12 사장님 결정 — 「구매 발주 만들기」 · 발주서 인쇄 포함)
--
--   철물 · 판재를 공급처에 발주한 것을 적어 두고, 물건이 오면 「입고」 한 번으로 재고를 늘린다.
--   (생산 › 외주 발주는 수주에 딸린 도어 · 상판 외주라 다른 것이다 — 그쪽은 건드리지 않는다)
--
-- 바꾸는 것:
--   1) stock_orders — 발주 한 번 = 한 줄. 번호 seq 는 업체마다 차례(PO-0001).
--        state  ordered 발주함 → received 입고 끝 · cancelled 취소 (둘 다 끝 — 되돌리지 못한다)
--        supplier_id 공급처(counterparties, 없어도 됨) · expected_on 받을 날 · note 메모(고객 정보를 넣지 않는다)
--   2) stock_order_lines — 발주 품목 줄. qty 발주 수량 · received_qty 실제로 들어온 수량(입고 때 적힌다)
--        같은 업체의 발주 · 품목만 (복합 FK). 한 발주에 같은 품목은 한 줄.
--   3) stock_order_place()   발주 넣기 — 번호를 매기고(업체마다 잠금), 줄을 넣고, 품목의 「입고 예정」을 그만큼 늘린다
--      stock_order_receive() 입고 — 줄마다 들어온 수량을 stock_move('in') 으로 넣고(입고 예정이 그만큼 준다),
--                            덜 온 만큼도 입고 예정에서 뺀다. 발주는 received 로 닫힌다. p_qtys 가 없으면 발주 수량 그대로
--      stock_order_cancel()  취소 — 입고 예정에서 발주 수량을 빼고 cancelled 로 닫는다
--      셋 다 한 번에(한 트랜잭션) 하고, 서버(service_role)만 부른다.
--
-- 읽기 · 쓰기: 두 표 모두 서버만. 정책이 없어 브라우저는 읽지 못한다. 지우기 없음.
-- =============================================

-- 1) 발주 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    seq integer NOT NULL,
    supplier_id uuid,
    expected_on date NOT NULL,
    state text DEFAULT 'ordered'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT stock_orders_pkey PRIMARY KEY (id),
    CONSTRAINT stock_orders_id_company_key UNIQUE (id, company_id),
    CONSTRAINT stock_orders_seq_key UNIQUE (company_id, seq),
    CONSTRAINT stock_orders_seq_check CHECK (seq BETWEEN 1 AND 999999),
    CONSTRAINT stock_orders_state_check CHECK (state = ANY (ARRAY['ordered'::text, 'received'::text, 'cancelled'::text])),
    CONSTRAINT stock_orders_closed_check CHECK ((state = 'ordered'::text) = (closed_at IS NULL)),
    CONSTRAINT stock_orders_note_check CHECK (COALESCE(length(note), 0) <= 200),
    CONSTRAINT stock_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.counterparties(id) ON DELETE SET NULL,
    CONSTRAINT stock_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT stock_orders_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_orders IS '재고 구매 발주 — 철물 · 판재를 공급처에 발주한 기록 (2026-11-12). 번호 seq 는 업체마다 차례(PO-0001). ordered → received · cancelled (끝). 함수 stock_order_place · receive · cancel 로만 바꾼다. 서버만, 지우지 않는다';

CREATE INDEX IF NOT EXISTS idx_stock_orders_company ON public.stock_orders USING btree (company_id, created_at DESC);

ALTER TABLE public.stock_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_orders TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.stock_orders FROM service_role;

-- 2) 발주 품목 줄 ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_order_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    item_id uuid NOT NULL,
    qty numeric(12,2) NOT NULL,
    received_qty numeric(12,2),
    CONSTRAINT stock_order_lines_pkey PRIMARY KEY (id),
    CONSTRAINT stock_order_lines_item_key UNIQUE (order_id, item_id),
    CONSTRAINT stock_order_lines_qty_check CHECK ((qty > 0) AND ((received_qty IS NULL) OR (received_qty >= 0))),
    CONSTRAINT stock_order_lines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_order_lines_order_fkey FOREIGN KEY (order_id, company_id) REFERENCES public.stock_orders(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_order_lines_item_fkey FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.stock_order_lines IS '재고 구매 발주의 품목 줄 — qty 발주 수량 · received_qty 들어온 수량(입고 때). 같은 업체의 발주 · 품목만. 서버만';

CREATE INDEX IF NOT EXISTS idx_stock_order_lines_order ON public.stock_order_lines USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_order_lines_item ON public.stock_order_lines USING btree (item_id);

ALTER TABLE public.stock_order_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_order_lines TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.stock_order_lines FROM service_role;

-- 3) 함수 ----------------------------------------------------------------------------

-- 품목의 입고 예정에서 p_qty 만큼 뺀다 (0 이하면 지운다)
CREATE OR REPLACE FUNCTION public.stock_expected_take(p_company uuid, p_item uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.stock_items
     SET expected_qty = CASE WHEN expected_qty - p_qty > 0 THEN expected_qty - p_qty ELSE NULL END,
         expected_on = CASE WHEN expected_qty - p_qty > 0 THEN expected_on ELSE NULL END,
         updated_at = now()
   WHERE id = p_item AND company_id = p_company AND expected_qty IS NOT NULL;
END;
$function$;

COMMENT ON FUNCTION public.stock_expected_take(uuid, uuid, numeric) IS '품목의 입고 예정에서 그만큼 뺀다 — 0 이하면 수량 · 받을 날을 지운다 (0062)';

-- 발주 넣기. p_lines = [{"item_id": uuid, "qty": 수}] (1 ~ 30줄, 같은 품목은 한 번)
CREATE OR REPLACE FUNCTION public.stock_order_place(p_company uuid, p_supplier uuid, p_expected_on date, p_note text, p_lines jsonb, p_actor uuid)
 RETURNS public.stock_orders
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.stock_orders;
  v_seq integer;
  v_line jsonb;
  v_item uuid;
  v_qty numeric(12,2);
BEGIN
  IF p_expected_on IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'stock_order_place: 받을 날과 품목 1 ~ 30줄이 필요합니다' USING ERRCODE = '22023';
  END IF;
  -- 번호 매기기 — 업체마다 한 번에 하나씩
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stock_orders:' || p_company::text, 0));
  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM public.stock_orders WHERE company_id = p_company;
  INSERT INTO public.stock_orders (company_id, seq, supplier_id, expected_on, note, created_by)
  VALUES (p_company, v_seq, p_supplier, p_expected_on, NULLIF(btrim(p_note), ''), p_actor)
  RETURNING * INTO v_order;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'qty')::numeric;
    IF v_item IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'stock_order_place: 품목 또는 수량이 맞지 않습니다' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.stock_order_lines (company_id, order_id, item_id, qty) VALUES (p_company, v_order.id, v_item, v_qty);
    UPDATE public.stock_items
       SET expected_qty = COALESCE(expected_qty, 0) + v_qty,
           expected_on = LEAST(COALESCE(expected_on, p_expected_on), p_expected_on),
           updated_at = now()
     WHERE id = v_item AND company_id = p_company AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock_order_place: 쓰는 품목이 아닙니다' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
  RETURN v_order;
END;
$function$;

COMMENT ON FUNCTION public.stock_order_place(uuid, uuid, date, text, jsonb, uuid) IS '재고 구매 발주 넣기 — 번호 매기기 · 줄 넣기 · 품목 입고 예정 늘리기를 한 번에. 숨긴 · 남의 품목이면 P0002 (0062)';

-- 입고. p_qtys = {"<줄 id>": 들어온 수량} — 없는 줄은 발주 수량 그대로
CREATE OR REPLACE FUNCTION public.stock_order_receive(p_company uuid, p_order uuid, p_actor uuid, p_qtys jsonb DEFAULT NULL::jsonb)
 RETURNS public.stock_orders
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.stock_orders;
  v_line public.stock_order_lines;
  v_got numeric(12,2);
BEGIN
  SELECT * INTO v_order FROM public.stock_orders WHERE id = p_order AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_order_receive: 발주가 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.state <> 'ordered' THEN
    RAISE EXCEPTION 'stock_order_receive: 이미 끝난 발주입니다' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT * FROM public.stock_order_lines WHERE order_id = p_order ORDER BY id LOOP
    v_got := COALESCE((p_qtys ->> v_line.id::text)::numeric, v_line.qty);
    IF v_got < 0 THEN
      RAISE EXCEPTION 'stock_order_receive: 수량이 맞지 않습니다' USING ERRCODE = '22023';
    END IF;
    IF v_got > 0 THEN
      PERFORM public.stock_move(p_company, v_line.item_id, 'in', v_got, 'PO-' || lpad(v_order.seq::text, 4, '0'), NULL, p_actor);
    END IF;
    -- 덜 온 만큼은 더 기다리지 않는다 — 입고 예정에서 뺀다
    IF v_got < v_line.qty THEN
      PERFORM public.stock_expected_take(p_company, v_line.item_id, v_line.qty - v_got);
    END IF;
    UPDATE public.stock_order_lines SET received_qty = v_got WHERE id = v_line.id;
  END LOOP;
  UPDATE public.stock_orders SET state = 'received', closed_at = now(), closed_by = p_actor WHERE id = p_order RETURNING * INTO v_order;
  RETURN v_order;
END;
$function$;

COMMENT ON FUNCTION public.stock_order_receive(uuid, uuid, uuid, jsonb) IS '재고 구매 발주 입고 — 줄마다 들어온 수량을 재고에 넣고 발주를 닫는다. 덜 온 만큼은 입고 예정에서 뺀다. 끝난 발주면 22023 (0062)';

-- 취소
CREATE OR REPLACE FUNCTION public.stock_order_cancel(p_company uuid, p_order uuid, p_actor uuid)
 RETURNS public.stock_orders
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.stock_orders;
  v_line public.stock_order_lines;
BEGIN
  SELECT * INTO v_order FROM public.stock_orders WHERE id = p_order AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_order_cancel: 발주가 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.state <> 'ordered' THEN
    RAISE EXCEPTION 'stock_order_cancel: 이미 끝난 발주입니다' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT * FROM public.stock_order_lines WHERE order_id = p_order LOOP
    PERFORM public.stock_expected_take(p_company, v_line.item_id, v_line.qty);
  END LOOP;
  UPDATE public.stock_orders SET state = 'cancelled', closed_at = now(), closed_by = p_actor WHERE id = p_order RETURNING * INTO v_order;
  RETURN v_order;
END;
$function$;

COMMENT ON FUNCTION public.stock_order_cancel(uuid, uuid, uuid) IS '재고 구매 발주 취소 — 입고 예정에서 발주 수량을 빼고 닫는다. 끝난 발주면 22023 (0062)';

REVOKE ALL ON FUNCTION public.stock_expected_take(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_order_place(uuid, uuid, date, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_order_receive(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_order_cancel(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_expected_take(uuid, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_order_place(uuid, uuid, date, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_order_receive(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_order_cancel(uuid, uuid, uuid) TO service_role;
