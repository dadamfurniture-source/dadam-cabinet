-- =============================================
-- 0063 작업지시 자재 ↔ 재고 잇기 — 짝표 · 수주 자재 출고 (2026-11-12 사장님 결정)
--
--   작업지시서의 자재(판재 = 재질 + 두께, 철물 = 분류 + 이름)에는 재고 품목 번호가 없다.
--   「이 자재 = 재고의 이 품목」을 한 번 정해 두는 짝표와, 수주마다 자재를 한 번에 출고한 기록을 둔다.
--   결정: 판재는 재질 + 두께로 짝짓는다 · 출고는 사람이 누를 때 · (자투리는 후보만 — 표가 필요 없다)
--
-- 바꾸는 것:
--   1) stock_links — 자재 키 하나 = 한 줄 (업체마다).
--        match_key  'B|PB|15' (판재: 재질|두께) · 'H|경첩|H052W-5 105도 저압 경첩' (철물: 분류|이름)
--        item_id    짝지은 재고 품목 (같은 업체) · ignored  재고에서 다루지 않는 자재(짝 없음으로 세지 않는다)
--        둘 중 하나만: 품목이 있거나, 다루지 않거나. 짝을 풀려면 줄을 지운다 (설정이라 서버는 지울 수 있다)
--   2) stock_issues — 수주 한 건의 자재 출고 = 한 줄. 같은 수주는 한 번만 (두 번 빼기 막기).
--        같은 업체의 수주만 (orders (id, company_id) 복합 FK). 추가만 — 고치기 · 지우기 없음
--   3) stock_issue() — 출고 기록 한 줄을 넣고, 줄마다 stock_move('out') 으로 재고에서 뺀다 (한 번에).
--        이미 출고한 수주면 23505, 재고가 모자라면 22023 (아무것도 바뀌지 않는다). 서버(service_role)만 부른다
--
-- 읽기 · 쓰기: 두 표 모두 서버만. 정책이 없어 브라우저는 읽지 못한다.
-- =============================================

-- 1) 짝표 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    kind text NOT NULL,
    match_key text NOT NULL,
    label text NOT NULL,
    item_id uuid,
    ignored boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_links_pkey PRIMARY KEY (id),
    CONSTRAINT stock_links_key UNIQUE (company_id, match_key),
    CONSTRAINT stock_links_kind_check CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text])),
    CONSTRAINT stock_links_text_check CHECK ((length(match_key) BETWEEN 3 AND 200) AND (length(btrim(label)) BETWEEN 1 AND 200)),
    CONSTRAINT stock_links_target_check CHECK (ignored = (item_id IS NULL)),
    CONSTRAINT stock_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_links_item_fkey FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_links_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_links IS '작업지시 자재 ↔ 재고 품목 짝표 (2026-11-12). match_key = 판재 B|재질|두께 · 철물 H|분류|이름. 품목이 있거나(item_id) 다루지 않거나(ignored). 서버만';

CREATE INDEX IF NOT EXISTS idx_stock_links_item ON public.stock_links USING btree (item_id) WHERE (item_id IS NOT NULL);

ALTER TABLE public.stock_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_links TO service_role;
REVOKE TRUNCATE ON TABLE public.stock_links FROM service_role;

-- 2) 수주 자재 출고 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    line_count integer NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_issues_pkey PRIMARY KEY (id),
    CONSTRAINT stock_issues_order_key UNIQUE (company_id, order_id),
    CONSTRAINT stock_issues_lines_check CHECK (line_count BETWEEN 1 AND 100),
    CONSTRAINT stock_issues_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT stock_issues_order_fkey FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT stock_issues_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.stock_issues IS '수주 한 건의 자재 출고 (2026-11-12) — 같은 수주는 한 번만. 뺀 수량은 stock_moves 에 수주 번호와 함께 남는다. stock_issue() 로만 넣는다. 추가만, 서버만';

ALTER TABLE public.stock_issues ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.stock_issues TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_issues FROM service_role;

-- 3) 수주 자재 출고 한 번 — p_lines = [{"item_id": uuid, "qty": 수}] (1 ~ 100줄) ------------------
CREATE OR REPLACE FUNCTION public.stock_issue(p_company uuid, p_order uuid, p_ref text, p_lines jsonb, p_actor uuid)
 RETURNS public.stock_issues
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_issue public.stock_issues;
  v_line jsonb;
  v_item uuid;
  v_qty numeric(12,2);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'stock_issue: 품목 1 ~ 100줄이 필요합니다' USING ERRCODE = '22023';
  END IF;
  -- 같은 수주를 두 번 빼지 않는다 (고유 제약 — 겹치면 23505)
  INSERT INTO public.stock_issues (company_id, order_id, line_count, created_by)
  VALUES (p_company, p_order, jsonb_array_length(p_lines), p_actor)
  RETURNING * INTO v_issue;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'qty')::numeric;
    IF v_item IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'stock_issue: 품목 또는 수량이 맞지 않습니다' USING ERRCODE = '22023';
    END IF;
    PERFORM public.stock_move(p_company, v_item, 'out', v_qty, NULLIF(btrim(p_ref), ''), NULL, p_actor);
  END LOOP;
  RETURN v_issue;
END;
$function$;

COMMENT ON FUNCTION public.stock_issue(uuid, uuid, text, jsonb, uuid) IS '수주 자재 출고 한 번 — 출고 기록 한 줄 + 줄마다 stock_move(out). 이미 출고한 수주면 23505, 재고가 모자라면 22023 (0063)';

REVOKE ALL ON FUNCTION public.stock_issue(uuid, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_issue(uuid, uuid, text, jsonb, uuid) TO service_role;
