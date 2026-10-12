-- ============================================================
-- 생산 계획 · 인력 추가 추천
--
-- 주문이 들어오면 진행 중인 주문 전체를 다시 계획해 "누구를 언제 더 부를지" 를 제안한다
-- (workers/workflow-api/src/production/*). 제안은 대표가 승인해야 작업자에게 지시로 나간다.
--
--   production_settings     계정별 표준시간·인력·단가·공휴일 (없으면 코드 기본값)
--   production_proposals    계획 결과 + 추천 (승인 대기 / 승인 / 무시)
--   production_assignments  승인된 지시 (날짜 · 담당 · 인원/시간)
--
-- 멱등: 두 번 실행해도 안전하다.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS production_settings (
  user_id     UUID PRIMARY KEY,
  -- { standards, crew, costs, leads, holidays } — 빠진 키는 코드 기본값
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_settings IS
  '생산 계획 설정. 표준시간(재단 7분/장 등)·인력·단가·공휴일. 실측으로 고친다.';

CREATE TABLE IF NOT EXISTS production_proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  -- order_created | manual
  trigger          TEXT NOT NULL CHECK (trigger IN ('order_created', 'manual')),
  trigger_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  plan             JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'dismissed', 'superseded')),
  decided_at       TIMESTAMPTZ,
  slack_status     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_proposals IS
  '생산 계획 제안. 새 제안이 생기면 이전 pending 은 superseded 가 된다 — 승인 화면엔 늘 최신 하나.';

CREATE INDEX IF NOT EXISTS idx_prod_proposals_user ON production_proposals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS production_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  proposal_id  UUID REFERENCES production_proposals(id) ON DELETE SET NULL,
  work_date    DATE,
  -- asm_call | asm_extra | edge_overtime | edge_outsource | door_order | reschedule
  kind         TEXT NOT NULL,
  role         TEXT,
  people       INT,
  hours        NUMERIC(5, 2),
  order_label  TEXT,
  text         TEXT NOT NULL,
  cost         BIGINT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'instructed'
               CHECK (status IN ('instructed', 'done', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE production_assignments DROP CONSTRAINT IF EXISTS production_assignments_text_len_chk;
ALTER TABLE production_assignments ADD CONSTRAINT production_assignments_text_len_chk
  CHECK (length(text) <= 500 AND coalesce(length(order_label), 0) <= 200);

CREATE INDEX IF NOT EXISTS idx_prod_assign_user_date ON production_assignments (user_id, work_date);

-- ── RLS — 소유자 읽기만, 쓰기는 Worker(service_role)만 ──────
ALTER TABLE production_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_proposals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON production_settings    FROM anon;
REVOKE ALL ON production_proposals   FROM anon;
REVOKE ALL ON production_assignments FROM anon;

DROP POLICY IF EXISTS "Users read own production settings" ON production_settings;
CREATE POLICY "Users read own production settings" ON production_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own production proposals" ON production_proposals;
CREATE POLICY "Users read own production proposals" ON production_proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own production assignments" ON production_assignments;
CREATE POLICY "Users read own production assignments" ON production_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

COMMIT;
