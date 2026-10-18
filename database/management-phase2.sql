-- ═══════════════════════════════════════════════════════════════
-- 경영 대시보드 2단계 — 날짜와 이름을 남긴다   (2026-10-19)
-- ═══════════════════════════════════════════════════════════════
-- 1단계는 있는 데이터로 화면을 만들었다. 2단계는 빈 기록 칸을 채운다.
-- 칸이 생기면 도구 다섯이 열린다:
--   재작업 · A/S        rework_logs          → 14 품질비용 · A/S 율
--   설치 후 한 문항      install_feedback     → 12 만족도 · 소개율
--   거래처 · 공급처      counterparties       → 11 거래처 파레토 · 16 외주 성적표
--   수금 · 지급 날짜     order_payments · order_costs.due_on · cash_balances → 9 13주 현금흐름 · 미수 나이
-- (확인서 거절 사유는 이미 design_documents.render_payload.decision_reasons 에 남는다)
--
-- 쓰기는 모두 Worker(service_role) 가 한다. 화면은 Worker API 로만 읽고 쓴다.
-- 여러 번 실행해도 안전하다. Supabase SQL Editor 에서 한 번 실행한다.

BEGIN;

-- ── 1. 거래처 · 공급처 ───────────────────────────────────────
-- 거래처(partner) = 우리에게 주문하는 인테리어 업체. 공급처(supplier) = 우리가 사는 곳(도어 · 상판 · 원판 · 철물 · 재단 외주).
-- 공개 파트너 디렉터리(partners)와는 따로 둔다 — 이건 장부용이고 관리자만 본다.
CREATE TABLE IF NOT EXISTS counterparties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('partner', 'supplier')),
  name        TEXT NOT NULL,
  -- 공급처 갈래: door 도어 · cut_edge 재단+엣지 · countertop 상판 · board 원판 · hardware 철물 · install 시공 · other
  category    TEXT CHECK (category IS NULL OR category IN ('door', 'cut_edge', 'countertop', 'board', 'hardware', 'install', 'other')),
  phone       TEXT,
  memo        TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE counterparties DROP CONSTRAINT IF EXISTS counterparties_len_chk;
ALTER TABLE counterparties ADD CONSTRAINT counterparties_len_chk CHECK (
  length(name) BETWEEN 1 AND 100 AND coalesce(length(phone), 0) <= 40 AND coalesce(length(memo), 0) <= 1000
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_counterparties_name ON counterparties (kind, lower(name));
COMMENT ON TABLE counterparties IS '장부용 거래처(partner) · 공급처(supplier). 관리자만. 공개 파트너 디렉터리(partners)와 별개';

ALTER TABLE orders      ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES counterparties(id) ON DELETE SET NULL;
ALTER TABLE order_costs ADD COLUMN IF NOT EXISTS counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_partner ON orders (partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_costs_cp ON order_costs (counterparty_id) WHERE counterparty_id IS NOT NULL;
COMMENT ON COLUMN orders.partner_id IS '주문한 거래처(인테리어 업체). price_tier = partner 인 수주에 붙인다';
COMMENT ON COLUMN order_costs.counterparty_id IS '돈을 낸 공급처. vendor_name 은 예전 자유 입력 — 남겨 둔다';

-- ── 2. 수금 · 지급 날짜 ──────────────────────────────────────
-- 수금 일정: 계약금 · 중도금 · 잔금. 받기로 한 날(due_on)과 받은 날(paid_on). paid_on 이 비면 아직 안 받은 돈.
-- 일정이 있는 수주는 orders.received_amount 를 Worker 가 받은 합으로 맞춘다.
CREATE TABLE IF NOT EXISTS order_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('deposit', 'interim', 'balance', 'other')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  due_on      DATE,
  paid_on     DATE,
  method      TEXT CHECK (method IS NULL OR method IN ('transfer', 'card', 'cash', 'other')),
  memo        TEXT CHECK (memo IS NULL OR length(memo) <= 300),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments (order_id, due_on);
CREATE INDEX IF NOT EXISTS idx_order_payments_open ON order_payments (due_on) WHERE paid_on IS NULL;
COMMENT ON TABLE order_payments IS '수금 일정 — 계약금 · 중도금 · 잔금. paid_on 이 비면 미수';

-- 지급: 실적 원가에 '낼 날' 을 더한다. spent_on = 실제로 낸 날, due_on = 내기로 한 날.
-- spent_on 이 비고 due_on 이 있으면 아직 안 낸 돈(현금흐름의 나갈 돈)이다.
ALTER TABLE order_costs ADD COLUMN IF NOT EXISTS due_on DATE;
COMMENT ON COLUMN order_costs.due_on IS '지급 예정일. spent_on 이 비어 있으면 아직 안 낸 돈';

-- 통장 잔액 — 현금흐름의 시작점. 사장님이 적은 날의 잔액, 가장 최근 것을 쓴다
CREATE TABLE IF NOT EXISTS cash_balances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of       DATE NOT NULL,
  amount      BIGINT NOT NULL,
  memo        TEXT CHECK (memo IS NULL OR length(memo) <= 300),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_balances_asof ON cash_balances (as_of DESC, created_at DESC);
COMMENT ON TABLE cash_balances IS '통장 잔액 기록 — 13주 현금흐름의 시작점';

-- ── 3. 설치 후 한 문항 ───────────────────────────────────────
-- 설치가 끝나면 고객에게 링크 하나: "지인에게 다담가구를 소개하시겠어요?" 0~10 + 한 줄.
-- 링크 토큰은 해시만 저장한다 (확인서 공유 링크와 같은 방식).
CREATE TABLE IF NOT EXISTS install_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  score        SMALLINT CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  comment      TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  answered_at  TIMESTAMPTZ,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE install_feedback IS '설치 후 소개 의향 0~10. 수주 하나에 하나';

-- ── 4. 재작업 · A/S ──────────────────────────────────────────
-- rework = 공장 안에서 다시 자르고 만든 것, as = 설치 뒤 고치러 간 것
CREATE TABLE IF NOT EXISTS rework_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('rework', 'as')),
  cause        TEXT NOT NULL CHECK (cause IN ('measure', 'design', 'cutting', 'edge', 'assembly', 'install', 'material', 'outsource', 'customer', 'other')),
  occurred_on  DATE NOT NULL DEFAULT current_date,
  minutes      INT CHECK (minutes IS NULL OR minutes >= 0),
  cost         BIGINT CHECK (cost IS NULL OR cost >= 0),
  parts        TEXT CHECK (parts IS NULL OR length(parts) <= 300),
  memo         TEXT CHECK (memo IS NULL OR length(memo) <= 1000),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rework_logs_order ON rework_logs (order_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_rework_logs_date ON rework_logs (occurred_on DESC);
COMMENT ON TABLE rework_logs IS '재작업(공장) · A/S(설치 뒤). 원인 · 분 · 비용 — 품질비용과 A/S 율의 재료';

-- ── RLS — 관리자만 읽기, 쓰기는 Worker(service_role) ─────────
ALTER TABLE counterparties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_balances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE install_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_logs      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON counterparties, order_payments, cash_balances, install_feedback, rework_logs FROM anon;

DROP POLICY IF EXISTS "Admin read counterparties" ON counterparties;
CREATE POLICY "Admin read counterparties" ON counterparties FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin read order payments" ON order_payments;
CREATE POLICY "Admin read order payments" ON order_payments FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin read cash balances" ON cash_balances;
CREATE POLICY "Admin read cash balances" ON cash_balances FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin read install feedback" ON install_feedback;
CREATE POLICY "Admin read install feedback" ON install_feedback FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin read rework logs" ON rework_logs;
CREATE POLICY "Admin read rework logs" ON rework_logs FOR SELECT TO authenticated USING (public.is_admin());

-- updated_at 자동 갱신 (워크플로 테이블과 같은 함수)
DROP TRIGGER IF EXISTS trg_counterparties_touch ON counterparties;
CREATE TRIGGER trg_counterparties_touch BEFORE UPDATE ON counterparties
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
DROP TRIGGER IF EXISTS trg_order_payments_touch ON order_payments;
CREATE TRIGGER trg_order_payments_touch BEFORE UPDATE ON order_payments
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

COMMIT;
