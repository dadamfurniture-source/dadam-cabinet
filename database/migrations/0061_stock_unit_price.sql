-- =============================================
-- 0061 재고 품목 단가 (2026-11-12 마이페이지 6단계 뒤 — 재고 금액)
--
--   구매 · 재고 대시보드의 「재고 금액」(남은 수량 × 단가)을 내려면 품목마다 단가가 있어야 한다.
--   단가는 원가라서 대표 · 실장에게만 보인다 (원가 · 마진은 대표 · 실장 — 서버가 가른다).
--
-- 바꾸는 것:
--   stock_items.unit_price  한 단위(장 · 개 · 쌍)의 값(원, 정수). 없으면 NULL — 재고 금액에서 빠지고 「단가 없는 품목」으로 센다.
--   정책 · 권한 · 다른 칸은 건드리지 않는다 (0059 그대로 서버만).
-- =============================================

ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS unit_price bigint;

ALTER TABLE public.stock_items DROP CONSTRAINT IF EXISTS stock_items_unit_price_check;
ALTER TABLE public.stock_items
    ADD CONSTRAINT stock_items_unit_price_check CHECK ((unit_price IS NULL) OR ((unit_price >= 0) AND (unit_price <= 100000000)));

COMMENT ON COLUMN public.stock_items.unit_price IS '한 단위의 값(원). 없으면 재고 금액에서 빠진다. 대표 · 실장에게만 보인다 (0061)';
