-- =============================================
-- 0071 철물 · 부속 카탈로그
--      (2026-11-18 사장님 「키친가이드 사이트 제품들도 정리해서 DB에 넣으려고」 · 「키친가이드, 무림상사, 모아가구 철물 처럼 회사별로 구분」
--       · 「구매 · 재고 아래 메뉴로, 다담 공장만 따로 보게」)
--
--   공급 회사마다 파는 상품(씽크볼 · 후드 · 수전 · 쿡탑 · 서랍재 · 레일 · 경첩 · 손잡이 · 하드웨어 · 악세사리 …)을 팩토리가 모아 두는 표.
--   마이페이지 구매 · 재고 › 「철물 · 부속 카탈로그」 화면의 바탕. 지금까지 이런 표가 없었다
--   (재고 stock_items 는 가진 수량, 자재 가격표 price_lists 는 판재 · 엣지 단가).
--
-- 만드는 것:
--   1) part_vendors — 공급 회사 한 곳 = 한 줄 (팩토리마다). 이름 · 사이트 주소 · 메모. 같은 팩토리에 같은 이름은 하나.
--   2) part_items — 상품 한 가지 = 한 줄. 공급 회사 · 그 회사의 상품 번호 · 분류 · 작은 분류 · 브랜드 · 이름
--        · 참고가(공급 회사의 판매가)와 그 값을 본 날 · 매입가(우리가 사는 값)와 그 값을 본 날
--        · 옵션(이름 · 더하고 빼는 금액) · 추가상품 · 사양(읽어 뽑은 값)과 사람이 확인했는지 · 폭 · 깊이 · 높이
--        · 원래 상품 주소 · 설명 글 · 사진 자리 · 쓰는지.
--        같은 팩토리의 공급 회사에만 붙는다 ((vendor_id, company_id) 외래 키).
--        같은 공급 회사에 같은 상품 번호는 하나 — 번호가 없는 상품(거래명세표에서 온 것)은 같은 이름이 하나.
--   3) part_items_guard() — 상품의 팩토리 · 공급 회사 · 만든 때는 바꾸지 못한다.
--   4) 사진 버킷 part-photos — 비공개 (정책 없음 = 서버만). 경로 <팩토리>/<상품>.<확장자>
--
-- 읽기 · 쓰기: 두 표 모두 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다.
--   서버는 다담 공장의 구성원과 본사 구성원에게만 돌려준다 (다른 팩토리에는 메뉴도 없다). 매입가는 대표 · 실장에게만.
-- 지우기 없음 — 쓰지 않는 상품은 active 로 숨긴다.
-- 다시 돌려도 된다.
-- =============================================

-- 1) 공급 회사 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.part_vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    site_url text DEFAULT ''::text NOT NULL,
    memo text DEFAULT ''::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT part_vendors_pkey PRIMARY KEY (id),
    CONSTRAINT part_vendors_id_company_key UNIQUE (id, company_id),
    CONSTRAINT part_vendors_name_check CHECK ((length(btrim(name)) >= 1) AND (length(name) <= 40)),
    CONSTRAINT part_vendors_text_check CHECK ((length(site_url) <= 200) AND (length(memo) <= 300)),
    CONSTRAINT part_vendors_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT part_vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.part_vendors IS '철물 · 부속 카탈로그의 공급 회사 — 팩토리마다 (2026-11-18). 서버만';
COMMENT ON COLUMN public.part_vendors.name IS '공급 회사 이름 (1 ~ 40자) — 같은 팩토리에 같은 이름은 하나';
COMMENT ON COLUMN public.part_vendors.site_url IS '사이트 주소 (200자까지 — 없으면 빈 글)';
COMMENT ON COLUMN public.part_vendors.memo IS '메모 (300자까지)';
COMMENT ON COLUMN public.part_vendors.created_by IS '만든 구성원 — 계정이 지워지면 비운다';

CREATE UNIQUE INDEX IF NOT EXISTS uq_part_vendors_name ON public.part_vendors USING btree (company_id, lower(btrim(name)));

ALTER TABLE public.part_vendors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.part_vendors TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.part_vendors FROM service_role;

-- 2) 상품 ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.part_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    vendor_item_no text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    sub_category text DEFAULT ''::text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    name text NOT NULL,
    ref_price bigint,
    ref_price_on date,
    buy_price bigint,
    buy_price_on date,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    addons jsonb DEFAULT '[]'::jsonb NOT NULL,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    specs_checked boolean DEFAULT false NOT NULL,
    width_mm integer,
    depth_mm integer,
    height_mm integer,
    source_url text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    photo_path text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT part_items_pkey PRIMARY KEY (id),
    CONSTRAINT part_items_name_check CHECK ((length(btrim(name)) >= 1) AND (length(name) <= 120)),
    CONSTRAINT part_items_text_check CHECK ((length(vendor_item_no) <= 60) AND (length(category) <= 40) AND (length(sub_category) <= 80)
        AND (length(brand) <= 40) AND (length(source_url) <= 300) AND (length(note) <= 300) AND (COALESCE(length(photo_path), 0) <= 200)),
    CONSTRAINT part_items_ref_price_check CHECK ((ref_price IS NULL) OR ((ref_price >= 0) AND (ref_price <= 100000000) AND (ref_price_on IS NOT NULL))),
    CONSTRAINT part_items_buy_price_check CHECK ((buy_price IS NULL) OR ((buy_price >= 0) AND (buy_price <= 100000000) AND (buy_price_on IS NOT NULL))),
    CONSTRAINT part_items_json_check CHECK ((jsonb_typeof(options) = 'array'::text) AND (jsonb_typeof(addons) = 'array'::text)
        AND (jsonb_typeof(specs) = 'object'::text) AND (length((options)::text) <= 20000) AND (length((addons)::text) <= 8000)
        AND (length((specs)::text) <= 20000)),
    CONSTRAINT part_items_size_check CHECK (((width_mm IS NULL) OR ((width_mm > 0) AND (width_mm <= 10000)))
        AND ((depth_mm IS NULL) OR ((depth_mm > 0) AND (depth_mm <= 10000))) AND ((height_mm IS NULL) OR ((height_mm > 0) AND (height_mm <= 10000)))),
    CONSTRAINT part_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT part_items_vendor_fkey FOREIGN KEY (vendor_id, company_id) REFERENCES public.part_vendors(id, company_id),
    CONSTRAINT part_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.part_items IS '철물 · 부속 카탈로그의 상품 — 공급 회사마다 (2026-11-18). 지우지 않고 active 로 숨긴다. 서버만';
COMMENT ON COLUMN public.part_items.vendor_item_no IS '공급 회사의 상품 번호 (60자까지) — 없으면 빈 글. 같은 공급 회사에 같은 번호는 하나';
COMMENT ON COLUMN public.part_items.category IS '분류 (공급 회사가 나눈 큰 분류 글 — 예 씽크볼 · 경첩)';
COMMENT ON COLUMN public.part_items.sub_category IS '작은 분류 글';
COMMENT ON COLUMN public.part_items.brand IS '브랜드 — 공급 회사가 적지 않은 곳은 이름 · 분류에서 어림한 값';
COMMENT ON COLUMN public.part_items.name IS '상품 이름 (1 ~ 120자)';
COMMENT ON COLUMN public.part_items.ref_price IS '참고가 (원) — 공급 회사의 판매가. 값이 있으면 본 날(ref_price_on)도 있다';
COMMENT ON COLUMN public.part_items.ref_price_on IS '참고가를 본 날';
COMMENT ON COLUMN public.part_items.buy_price IS '매입가 (원) — 우리가 사는 값. 대표 · 실장에게만 보인다. 값이 있으면 본 날(buy_price_on)도 있다';
COMMENT ON COLUMN public.part_items.buy_price_on IS '매입가를 본 날 (적은 날 · 거래명세표의 날)';
COMMENT ON COLUMN public.part_items.options IS '옵션 — [{g 묶음 이름, l 옵션 이름, d 더하고 빼는 금액(원), x 품절}] (공급 회사에 적힌 그대로)';
COMMENT ON COLUMN public.part_items.addons IS '추가상품 — [{l 이름, p 금액(원)}]';
COMMENT ON COLUMN public.part_items.specs IS '사양 — 상세 그림 · 글에서 읽어 뽑은 값(이름: 글). 사람이 확인하기 전에는 specs_checked = false';
COMMENT ON COLUMN public.part_items.specs_checked IS '사양 · 치수를 사람이 확인했는지';
COMMENT ON COLUMN public.part_items.width_mm IS '폭 mm (읽지 못했으면 비운다)';
COMMENT ON COLUMN public.part_items.depth_mm IS '깊이 mm';
COMMENT ON COLUMN public.part_items.height_mm IS '높이 mm';
COMMENT ON COLUMN public.part_items.source_url IS '원래 상품 주소 (300자까지)';
COMMENT ON COLUMN public.part_items.note IS '설명 글 (300자까지)';
COMMENT ON COLUMN public.part_items.photo_path IS '사진 자리 — 버킷 part-photos 안 경로 <팩토리>/<상품>.<확장자>. 없으면 비운다';
COMMENT ON COLUMN public.part_items.active IS '쓰는지 — 지우지 않고 숨긴다';
COMMENT ON COLUMN public.part_items.created_by IS '넣은 구성원 — 계정이 지워지면 비운다';

CREATE UNIQUE INDEX IF NOT EXISTS uq_part_items_vendor_no ON public.part_items USING btree (vendor_id, vendor_item_no) WHERE (vendor_item_no <> ''::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_part_items_vendor_name ON public.part_items USING btree (vendor_id, lower(btrim(name))) WHERE (vendor_item_no = ''::text);
CREATE INDEX IF NOT EXISTS idx_part_items_company ON public.part_items USING btree (company_id, vendor_id, category) WHERE (active);

-- 3) 지킴이 — 상품의 팩토리 · 공급 회사 · 만든 때는 그대로
CREATE OR REPLACE FUNCTION public.part_items_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.vendor_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.vendor_id, OLD.created_at) THEN
    RAISE EXCEPTION 'part_items: 상품의 팩토리 · 공급 회사는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.part_items_guard() IS '카탈로그 상품 지킴이 — 팩토리 · 공급 회사 · 만든 때는 그대로, 고친 때를 적는다 (0071)';

REVOKE ALL ON FUNCTION public.part_items_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_part_items_guard ON public.part_items;
CREATE TRIGGER trg_part_items_guard BEFORE UPDATE ON public.part_items FOR EACH ROW EXECUTE FUNCTION public.part_items_guard();

ALTER TABLE public.part_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.part_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.part_items TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.part_items FROM service_role;

-- 4) 사진 버킷 ------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('part-photos', 'part-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
