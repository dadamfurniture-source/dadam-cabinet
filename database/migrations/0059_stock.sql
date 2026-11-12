-- =============================================
-- 0059 재고 — 품목 · 입출고 기록 · 자투리 · 자투리 기록 (2026-11-12 마이페이지 6단계 · 사장님 결정 넷)
--
--   마이페이지 구매 · 재고 › 기본 자재 · 철물 · 자투리 자재 · 입출고 화면의 바탕. 지금까지 표가 없었다.
--   ① 입고 · 출고 · 자투리 등록은 업체 구성원 누구나, 품목 더하기 · 안전 재고 · 실사 조정은 대표 · 실장만 (서버가 가른다)
--   ② 자투리는 번호(S-0001, 업체마다 차례) + QR 라벨 인쇄 — 번호 칸(seq)만 둔다
--   ③ 입고 예정은 품목에 손으로 적는다 (수량 · 받을 날). 발주서와 잇는 것은 다음에
--
-- 바꾸는 것:
--   1) stock_items — 판재(board) 또는 철물(hardware) 한 종류 = 한 줄.
--        qty  남은 수량 (0 이상). 입출고 기록을 넣을 때 stock_move() 가 같이 바꾼다
--        safety_qty  안전 재고 · supplier_id  공급처(counterparties) · expected_qty · expected_on  입고 예정(둘 다 있거나 둘 다 없다)
--        지우지 않는다 — active 로 숨긴다
--   2) stock_moves — 들어옴(in) · 나감(out) · 실사 조정(adjust) 한 번 = 한 줄. 추가만 (서버도 고치기 · 지우기 권한 없음).
--        qty  in · out 은 양수, adjust 는 더하거나 빼는 양(0 아님) · qty_after  넣은 뒤 남은 수량
--        ref_label  어디에 썼는지(작업 번호 글자) — 고객 이름 · 전화 · 주소를 넣지 않는다
--   3) stock_move() — 품목 줄을 잠그고, 남은 수량을 셈해 바꾸고, 기록을 넣는다 (한 번에). 입고면 입고 예정을 그만큼 줄인다.
--        남은 수량보다 많이 나가면 거절(22023). 서버(service_role)만 부른다
--   4) stock_offcuts — 남은 조각 하나 = 한 줄. 상태 left 남음 ↔ reserved 예약 → used 씀 · discarded 버림 (끝).
--        재질 · 두께 · 크기 · 번호는 만든 뒤 바꾸지 못한다 (지킴이). 바꾸는 것은 상태 · 자리 · 메모뿐
--   5) stock_offcut_events — 자투리에 일어난 일(등록 · 예약 · 예약 풂 · 씀 · 버림 · 자리 옮김 · 라벨 인쇄). 추가만
--
-- 읽기 · 쓰기: 네 표 모두 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다. 지우기 없음.
-- =============================================

-- 1) 품목 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    spec text DEFAULT ''::text NOT NULL,
    unit text NOT NULL,
    qty numeric(12,2) DEFAULT 0 NOT NULL,
    safety_qty numeric(12,2) DEFAULT 0 NOT NULL,
    supplier_id uuid,
    expected_qty numeric(12,2),
    expected_on date,
    memo text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_items_pkey PRIMARY KEY (id),
    CONSTRAINT stock_items_id_company_key UNIQUE (id, company_id),
    CONSTRAINT stock_items_kind_check CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text])),
    CONSTRAINT stock_items_text_check CHECK ((length(btrim(name)) BETWEEN 1 AND 80) AND (length(spec) <= 80)
        AND (length(btrim(unit)) BETWEEN 1 AND 8) AND (COALESCE(length(memo), 0) <= 300)),
    CONSTRAINT stock_items_qty_check CHECK ((qty >= 0) AND (safety_qty >= 0)),
    CONSTRAINT stock_items_expected_check CHECK (((expected_qty IS NULL) AND (expected_on IS NULL))
        OR ((expected_qty > 0) AND (expected_on IS NOT NULL))),
    CONSTRAINT stock_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.counterparties(id) ON DELETE SET NULL,
    CONSTRAINT stock_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_items IS '재고 품목 — 판재(board) · 철물(hardware) 한 종류 (2026-11-12 마이페이지 6단계). qty 는 stock_move() 가 입출고 기록과 같이 바꾼다. 지우지 않고 active 로 숨긴다. 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_name ON public.stock_items USING btree (company_id, kind, lower(name), lower(spec));
CREATE INDEX IF NOT EXISTS idx_stock_items_company ON public.stock_items USING btree (company_id, kind) WHERE (active);

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_items TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.stock_items FROM service_role;

-- 2) 입출고 기록 ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    kind text NOT NULL,
    qty numeric(12,2) NOT NULL,
    qty_after numeric(12,2) NOT NULL,
    ref_label text,
    note text,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_moves_pkey PRIMARY KEY (id),
    CONSTRAINT stock_moves_kind_check CHECK (kind = ANY (ARRAY['in'::text, 'out'::text, 'adjust'::text])),
    CONSTRAINT stock_moves_qty_check CHECK ((((kind = 'adjust'::text) AND (qty <> 0)) OR ((kind <> 'adjust'::text) AND (qty > 0)))
        AND (qty_after >= 0)),
    CONSTRAINT stock_moves_text_check CHECK ((COALESCE(length(ref_label), 0) <= 60) AND (COALESCE(length(note), 0) <= 200)),
    CONSTRAINT stock_moves_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_moves_item_fkey FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_moves_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_moves IS '재고 입출고 기록 — 입고(in) · 출고(out) · 실사 조정(adjust) (2026-11-12 마이페이지 6단계). 추가만 한다 — 잘못 적었으면 반대 기록을 더 넣는다. ref_label 에 고객 이름 · 전화 · 주소를 넣지 않는다. stock_move() 로만 넣는다';

CREATE INDEX IF NOT EXISTS idx_stock_moves_company ON public.stock_moves USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_moves_item ON public.stock_moves USING btree (item_id, created_at DESC);

ALTER TABLE public.stock_moves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_moves FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.stock_moves TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_moves FROM service_role;

-- 3) 입출고 한 번 — 수량과 기록을 같이 ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_move(p_company uuid, p_item uuid, p_kind text, p_qty numeric, p_ref text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS public.stock_moves
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_item public.stock_items;
  v_delta numeric(12,2);
  v_after numeric(12,2);
  v_expected numeric(12,2);
  v_row public.stock_moves;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('in', 'out', 'adjust') OR p_qty IS NULL
     OR (p_kind = 'adjust' AND p_qty = 0) OR (p_kind <> 'adjust' AND p_qty <= 0) THEN
    RAISE EXCEPTION 'stock_move: 종류 또는 수량이 맞지 않습니다' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.stock_items WHERE id = p_item AND company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_move: 품목이 없습니다' USING ERRCODE = 'P0002';
  END IF;
  v_delta := CASE p_kind WHEN 'out' THEN -p_qty ELSE p_qty END;
  v_after := v_item.qty + v_delta;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'stock_move: 남은 수량보다 많이 뺄 수 없습니다' USING ERRCODE = '22023';
  END IF;
  v_expected := v_item.expected_qty;
  IF p_kind = 'in' AND v_expected IS NOT NULL THEN
    v_expected := v_expected - p_qty;
    IF v_expected <= 0 THEN v_expected := NULL; END IF;
  END IF;
  UPDATE public.stock_items
     SET qty = v_after,
         expected_qty = v_expected,
         expected_on = CASE WHEN v_expected IS NULL THEN NULL ELSE expected_on END,
         updated_at = now()
   WHERE id = v_item.id;
  INSERT INTO public.stock_moves (company_id, item_id, kind, qty, qty_after, ref_label, note, actor_user_id)
  VALUES (p_company, p_item, p_kind, p_qty, v_after, NULLIF(btrim(p_ref), ''), NULLIF(btrim(p_note), ''), p_actor)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid) IS '재고 입출고 한 번 — 품목 줄을 잠그고 남은 수량과 기록을 같이 바꾼다. 입고면 입고 예정을 그만큼 줄인다. 남은 수량보다 많이 빼면 22023 (0059)';

REVOKE ALL ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid) TO service_role;

-- 4) 자투리 --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_offcuts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    seq integer NOT NULL,
    material text NOT NULL,
    thickness_mm numeric(5,1) NOT NULL,
    width_mm integer NOT NULL,
    height_mm integer NOT NULL,
    place text,
    state text DEFAULT 'left'::text NOT NULL,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT stock_offcuts_pkey PRIMARY KEY (id),
    CONSTRAINT stock_offcuts_id_company_key UNIQUE (id, company_id),
    CONSTRAINT stock_offcuts_seq_key UNIQUE (company_id, seq),
    CONSTRAINT stock_offcuts_seq_check CHECK (seq BETWEEN 1 AND 999999),
    CONSTRAINT stock_offcuts_state_check CHECK (state = ANY (ARRAY['left'::text, 'reserved'::text, 'used'::text, 'discarded'::text])),
    CONSTRAINT stock_offcuts_closed_check CHECK ((state = ANY (ARRAY['used'::text, 'discarded'::text])) = (closed_at IS NOT NULL)),
    CONSTRAINT stock_offcuts_size_check CHECK ((thickness_mm > 0) AND (thickness_mm <= 100)
        AND (width_mm BETWEEN 1 AND 3000) AND (height_mm BETWEEN 1 AND 3000)),
    CONSTRAINT stock_offcuts_text_check CHECK ((length(btrim(material)) BETWEEN 1 AND 40) AND (COALESCE(length(place), 0) <= 20)
        AND (COALESCE(length(memo), 0) <= 200)),
    CONSTRAINT stock_offcuts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_offcuts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_offcuts IS '자투리 자재 — 남은 조각 하나 (2026-11-12 마이페이지 6단계). 번호 seq 는 업체마다 차례(S-0001). left 남음 ↔ reserved 예약 → used 씀 · discarded 버림. 재질 · 두께 · 크기는 바꾸지 못한다. 서버만, 지우지 않는다';

CREATE INDEX IF NOT EXISTS idx_stock_offcuts_open ON public.stock_offcuts USING btree (company_id, created_at DESC) WHERE (closed_at IS NULL);

CREATE OR REPLACE FUNCTION public.stock_offcuts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.seq, NEW.material, NEW.thickness_mm, NEW.width_mm, NEW.height_mm, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.seq, OLD.material, OLD.thickness_mm, OLD.width_mm, OLD.height_mm, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'stock_offcuts: 번호 · 재질 · 두께 · 크기는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state NOT IN ('left', 'reserved') THEN
      RAISE EXCEPTION 'stock_offcuts: % -> % 는 안 됩니다', OLD.state, NEW.state USING ERRCODE = '22023';
    END IF;
    IF NEW.state IN ('used', 'discarded') THEN NEW.closed_at := now(); END IF;
  ELSIF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'stock_offcuts: 끝난 때는 상태가 바뀔 때만 찍힌다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.stock_offcuts_guard() IS '자투리 지킴이 — 번호 · 재질 · 두께 · 크기 그대로, 씀 · 버림은 끝(되돌리지 못함), 끝난 때는 여기서 찍는다 (0059)';

REVOKE ALL ON FUNCTION public.stock_offcuts_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_stock_offcuts_guard ON public.stock_offcuts;
CREATE TRIGGER trg_stock_offcuts_guard BEFORE UPDATE ON public.stock_offcuts FOR EACH ROW EXECUTE FUNCTION public.stock_offcuts_guard();

ALTER TABLE public.stock_offcuts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_offcuts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_offcuts TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.stock_offcuts FROM service_role;

-- 5) 자투리 기록 ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_offcut_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    offcut_id uuid NOT NULL,
    type text NOT NULL,
    detail text,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_offcut_events_pkey PRIMARY KEY (id),
    CONSTRAINT stock_offcut_events_type_check CHECK (type = ANY (ARRAY['added'::text, 'reserved'::text, 'released'::text, 'used'::text, 'discarded'::text, 'moved'::text, 'label'::text])),
    CONSTRAINT stock_offcut_events_detail_check CHECK (COALESCE(length(detail), 0) <= 60),
    CONSTRAINT stock_offcut_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_offcut_events_offcut_fkey FOREIGN KEY (offcut_id, company_id) REFERENCES public.stock_offcuts(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_offcut_events_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_offcut_events IS '자투리 기록 — 등록 · 예약 · 예약 풂 · 씀 · 버림 · 자리 옮김 · 라벨 인쇄 (2026-11-12 마이페이지 6단계). 추가만. detail 에 고객 이름 · 전화 · 주소를 넣지 않는다. 서버만';

CREATE INDEX IF NOT EXISTS idx_stock_offcut_events_offcut ON public.stock_offcut_events USING btree (offcut_id, created_at DESC);

ALTER TABLE public.stock_offcut_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_offcut_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.stock_offcut_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_offcut_events FROM service_role;
