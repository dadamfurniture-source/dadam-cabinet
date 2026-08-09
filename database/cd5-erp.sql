-- ============================================================
-- CD-5: 자체 ERP — 수주 · 매출 · 실적 원가
--
-- 업무 루프의 마지막 칸. 지금까지 고객이 확인서를 승인해도 그 다음이 없었다.
-- design_documents 와 수주를 잇는 경로가 아예 없어서, 승인 이후는 시스템 밖이었다.
--
-- 동시에 CD-6 의 "견적·원가 정확도" 학습을 닫는다. 견적(snapshot.quote_payload)은
-- 있었지만 **실적 원가를 받는 경로가 없어** 대조가 불가능했다.
--
-- multiagent/db/migrations/001_foundation.sql 에 orders/revenue_entries 골격이
-- 있으나 한 번도 적용된 적이 없고(프로덕션에 테이블 0개) 다른 DB 를 전제한다.
-- 그래서 workflow 도메인에 맞춰 새로 만든다.
--
-- 멱등: 두 번 실행해도 안전하다.
-- ============================================================

BEGIN;

-- ── 수주 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no       TEXT NOT NULL UNIQUE,

  design_id      UUID NOT NULL REFERENCES designs(id) ON DELETE RESTRICT,
  -- 수주의 근거가 되는 **승인된 고객 확인서**. 한 확인서는 한 번만 수주가 된다.
  document_id    UUID NOT NULL UNIQUE REFERENCES design_documents(id) ON DELETE RESTRICT,
  -- 계약 시점의 설계를 못박는다. 이후 설계가 바뀌어도 계약 내용은 그대로다.
  snapshot_id    UUID NOT NULL REFERENCES design_snapshots(id) ON DELETE RESTRICT,

  customer_name  TEXT,
  -- 계약금액 = 승인된 확인서의 합계. 원 단위 정수.
  contract_amount BIGINT NOT NULL CHECK (contract_amount >= 0),
  received_amount BIGINT NOT NULL DEFAULT 0 CHECK (received_amount >= 0),

  status         TEXT NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed','in_production','delivered','completed','cancelled')),

  ordered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at   TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  note           TEXT,

  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE orders IS
  'CD-5 수주. 승인된 고객 확인서 1건 = 수주 1건. document_id UNIQUE 로 중복 전환을 DB 가 막는다.';
COMMENT ON COLUMN orders.snapshot_id IS
  '계약 시점 설계. 이후 설계를 고쳐도 계약 내용은 이 스냅샷이다.';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_note_len_chk;
ALTER TABLE orders ADD CONSTRAINT orders_note_len_chk
  CHECK (coalesce(length(note), 0) <= 2000);

-- 수금이 계약금액을 넘는 건 실무상 있을 수 있어(선수금·추가공사) 막지 않는다.
-- 다만 취소된 수주는 완료로 갈 수 없다.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_completed_chk;
ALTER TABLE orders ADD CONSTRAINT orders_completed_chk
  CHECK (status <> 'completed' OR completed_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_orders_design   ON orders (design_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders (status, ordered_at DESC);


-- ── 실적 원가 ───────────────────────────────────────────────
-- CD-6 "견적·원가 정확도" 의 재료. 견적은 snapshot.quote_payload 에 이미 있고,
-- 여기 실제로 나간 돈을 넣어야 비로소 대조가 된다.
CREATE TABLE IF NOT EXISTS order_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  category    TEXT NOT NULL
              CHECK (category IN ('material','hardware','labor','outsourcing','logistics','other')),
  description TEXT,
  vendor_name TEXT,
  amount      BIGINT NOT NULL CHECK (amount >= 0),
  spent_on    DATE,

  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_costs IS
  'CD-5/CD-6 실적 원가. 견적 대비 실제를 학습하려면 항목이 견적과 같은 축으로 나뉘어야 한다.';

ALTER TABLE order_costs DROP CONSTRAINT IF EXISTS order_costs_len_chk;
ALTER TABLE order_costs ADD CONSTRAINT order_costs_len_chk CHECK (
  coalesce(length(description), 0) <= 300 AND
  coalesce(length(vendor_name), 0) <= 100
);

CREATE INDEX IF NOT EXISTS idx_order_costs_order ON order_costs (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_costs_cat   ON order_costs (category, spent_on DESC);


-- ── RLS — 다른 워크플로 테이블과 동일하게 소유자 읽기만 ─────
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON orders      FROM anon;
REVOKE ALL ON order_costs FROM anon;

DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM designs d WHERE d.id = orders.design_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users read own order costs" ON order_costs;
CREATE POLICY "Users read own order costs" ON order_costs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders o JOIN designs d ON d.id = o.design_id
      WHERE o.id = order_costs.order_id AND d.user_id = auth.uid()
    )
  );

-- 쓰기는 Worker(service_role)만. 프론트가 직접 쓰면 금액·소유권 검증을 건너뛴다.


-- ── updated_at 자동 갱신 ────────────────────────────────────
CREATE OR REPLACE FUNCTION set_orders_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_orders_updated_at();

COMMIT;
