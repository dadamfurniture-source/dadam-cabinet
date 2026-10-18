-- ═══════════════════════════════════════════════════════════════
-- 수주 구분 칸 — 고객(customer) · 거래처(partner)   (2026-10-19 대표 결정)
-- ═══════════════════════════════════════════════════════════════
-- 같은 원가라도 거래처(인테리어 업체)에는 원가 × 1.1, 고객에게는 원가 × 1.2 로 판다.
-- 지금까지는 수주에 "누구에게 판 주문인지" 적을 칸이 없어서, 계약금이 거래처 견적과
-- 1,000원 안이면 거래처로 짐작했다. 이 칸이 생기면 그 짐작 대신 칸을 쓴다.
--
--   새 수주     확인서를 낸 금액 종류(고객용 · 거래처용)를 그대로 옮긴다 (워커)
--   옛 수주     아래 UPDATE 가 확인서에서 채운다
--   고치기      수주 · 원가 · 마진(erp.html) 상세의 '구분'
--
-- 여러 번 실행해도 안전하다. Supabase SQL Editor 에서 한 번 실행한다.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_tier TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_price_tier_chk;
ALTER TABLE orders ADD CONSTRAINT orders_price_tier_chk
  CHECK (price_tier IS NULL OR price_tier IN ('customer', 'partner'));

COMMENT ON COLUMN orders.price_tier IS
  '고객(customer) · 거래처(partner). 수주 때 확인서 금액 종류를 옮기고 erp.html 에서 고친다. NULL 이면 계약금으로 짐작한다';

-- 옛 수주: 그 수주의 확인서가 거래처용이면 partner, 아니면 customer
UPDATE orders o
   SET price_tier = CASE WHEN d.totals->>'price_tier' = 'partner' THEN 'partner' ELSE 'customer' END
  FROM design_documents d
 WHERE d.id = o.document_id
   AND o.price_tier IS NULL;
