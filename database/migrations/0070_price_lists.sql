-- =============================================
-- 0070 자재 가격표
--      (2026-11-18 사장님 「자재 가격 정보 … 파악해서 적용」 · 「도어용 보드까지 색마다」)
--
--   팩토리가 공급처 가격표(엑셀)를 앱에 올려 두면, 간편 플래너가 색 · 코드마다 단가를 읽어 BOM 금액을 셈하고
--   색상 탭에서 몸통 · 우라 · 도어 색을 그 가격표의 색으로 고른다.
--
-- 만드는 것:
--   1) price_lists — 올린 가격표 한 벌 = 한 줄. 공급처 이름 · 올린 파일 이름 · 줄 수 · 상태(loading → ready).
--        같은 공급처의 가격표를 다시 올리면 새 줄이 생긴다 — 읽는 쪽은 공급처마다 가장 최근 ready 줄만 쓴다 (옛 줄은 기록으로 남는다).
--        줄을 다 넣은 뒤에 ready 로 바꾼다 — 넣다 만 가격표(loading)는 읽지 않는다.
--   2) price_list_items — 가격표의 줄 (가격표 안 차례 seq). 용도 kind · 분류 · 제품군 · 사양 · 색상명 · 코드 · 규격 글 · 두께 · 단가.
--        kind: body 몸통 · back 우라 · door 도어 · edge 엣지 · other 그 밖 — 올릴 때 팩토리가 제품군마다 정한다.
--        같은 팩토리의 가격표에만 붙는다 ((list_id, company_id) 외래 키).
--
-- 읽기 · 쓰기: 둘 다 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다.
--   서버는 단가를 그 팩토리의 대표 · 실장에게만, 색 이름 · 코드는 플래너를 쓰는 구성원에게 돌려준다. 다른 팩토리에는 나가지 않는다.
-- 지우기 없음. price_lists 는 상태만 loading → ready 로 한 번 바꾼다 (지킴이). price_list_items 는 넣기만 — 서버도 고치거나 지우지 못한다.
-- 다시 돌려도 된다.
-- =============================================

-- 1) 가격표 -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.price_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    supplier text NOT NULL,
    source_name text DEFAULT ''::text NOT NULL,
    row_count integer NOT NULL,
    state text DEFAULT 'loading'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT price_lists_pkey PRIMARY KEY (id),
    CONSTRAINT price_lists_id_company_key UNIQUE (id, company_id),
    CONSTRAINT price_lists_supplier_check CHECK ((length(btrim(supplier)) >= 1) AND (length(supplier) <= 40)),
    CONSTRAINT price_lists_source_check CHECK (length(source_name) <= 120),
    CONSTRAINT price_lists_rows_check CHECK ((row_count >= 1) AND (row_count <= 5000)),
    CONSTRAINT price_lists_state_check CHECK (state = ANY (ARRAY['loading'::text, 'ready'::text])),
    CONSTRAINT price_lists_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT price_lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.price_lists IS '자재 가격표 — 팩토리가 올린 공급처 가격표 한 벌 (2026-11-18). 공급처마다 가장 최근 ready 줄이 지금 가격표다. 서버만';
COMMENT ON COLUMN public.price_lists.supplier IS '공급처 이름 (1 ~ 40자)';
COMMENT ON COLUMN public.price_lists.source_name IS '올린 파일 이름 (120자까지 — 기록용)';
COMMENT ON COLUMN public.price_lists.row_count IS '줄 수 (1 ~ 5000)';
COMMENT ON COLUMN public.price_lists.state IS 'loading 줄을 넣는 중 · ready 다 넣음 — 읽는 쪽은 ready 만 쓴다';
COMMENT ON COLUMN public.price_lists.created_by IS '올린 구성원 — 계정이 지워지면 비운다';

CREATE INDEX IF NOT EXISTS idx_price_lists_company ON public.price_lists USING btree (company_id, created_at DESC);

-- 지킴이 — 올린 가격표의 내용은 그대로, 상태만 loading → ready 로 한 번
CREATE OR REPLACE FUNCTION public.price_lists_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.supplier, NEW.source_name, NEW.row_count, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.supplier, OLD.source_name, OLD.row_count, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'price_lists: 올린 가격표의 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'loading' AND NEW.state = 'ready') THEN
    RAISE EXCEPTION 'price_lists: % -> % 는 안 됩니다', OLD.state, NEW.state USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.price_lists_guard() IS '가격표 지킴이 — 내용 그대로, 상태만 loading → ready 한 번 (0070)';

REVOKE ALL ON FUNCTION public.price_lists_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_price_lists_guard ON public.price_lists;
CREATE TRIGGER trg_price_lists_guard BEFORE UPDATE ON public.price_lists FOR EACH ROW EXECUTE FUNCTION public.price_lists_guard();

ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.price_lists FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.price_lists TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.price_lists FROM service_role;

-- 2) 가격표의 줄 --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.price_list_items (
    list_id uuid NOT NULL,
    seq integer NOT NULL,
    company_id uuid NOT NULL,
    kind text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    product text DEFAULT ''::text NOT NULL,
    spec text DEFAULT ''::text NOT NULL,
    color_name text DEFAULT ''::text NOT NULL,
    code text DEFAULT ''::text NOT NULL,
    size_text text DEFAULT ''::text NOT NULL,
    thickness numeric,
    unit_price bigint NOT NULL,
    CONSTRAINT price_list_items_pkey PRIMARY KEY (list_id, seq),
    CONSTRAINT price_list_items_seq_check CHECK ((seq >= 1) AND (seq <= 5000)),
    CONSTRAINT price_list_items_kind_check CHECK (kind = ANY (ARRAY['body'::text, 'back'::text, 'door'::text, 'edge'::text, 'other'::text])),
    CONSTRAINT price_list_items_text_check CHECK ((length(category) <= 40) AND (length(product) <= 60) AND (length(spec) <= 60) AND (length(color_name) <= 40) AND (length(code) <= 40) AND (length(size_text) <= 40)),
    CONSTRAINT price_list_items_name_check CHECK ((length(btrim(color_name)) >= 1) OR (length(btrim(code)) >= 1)),
    CONSTRAINT price_list_items_thickness_check CHECK ((thickness IS NULL) OR ((thickness > (0)::numeric) AND (thickness <= (100)::numeric))),
    CONSTRAINT price_list_items_price_check CHECK ((unit_price >= 0) AND (unit_price <= 100000000)),
    CONSTRAINT price_list_items_list_fkey FOREIGN KEY (list_id, company_id) REFERENCES public.price_lists(id, company_id)
);

COMMENT ON TABLE public.price_list_items IS '자재 가격표의 줄 (2026-11-18) — 가격표 안 차례 seq. 넣기만 한다 (서버도 고치거나 지우지 못한다). 서버만';
COMMENT ON COLUMN public.price_list_items.kind IS '용도 — body 몸통 · back 우라 · door 도어 · edge 엣지 · other 그 밖. 올릴 때 팩토리가 제품군마다 정한다';
COMMENT ON COLUMN public.price_list_items.category IS '분류 (가격표의 대분류 글)';
COMMENT ON COLUMN public.price_list_items.product IS '제품군';
COMMENT ON COLUMN public.price_list_items.spec IS '사양 · 소재';
COMMENT ON COLUMN public.price_list_items.color_name IS '색상명 — 색상명과 코드 가운데 하나는 있어야 한다';
COMMENT ON COLUMN public.price_list_items.code IS '색 코드';
COMMENT ON COLUMN public.price_list_items.size_text IS '규격 글 (가격표에 적힌 그대로 — 예 18*1220*2440)';
COMMENT ON COLUMN public.price_list_items.thickness IS '두께 mm (규격의 첫 숫자 — 읽지 못했으면 비운다)';
COMMENT ON COLUMN public.price_list_items.unit_price IS '단가 (원) — 팩토리 대표 · 실장에게만 보인다';

CREATE INDEX IF NOT EXISTS idx_price_list_items_kind ON public.price_list_items USING btree (list_id, kind, seq);

ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.price_list_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.price_list_items TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.price_list_items FROM service_role;
