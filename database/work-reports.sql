-- ============================================================
-- 작업 지시 보고 보관함 (docs/01-plan/work-reports-archive.plan.md §3)
--
-- 생산 계획 · 인력 승인 · 아침 요약 · 작업지시서 · 설치 지시서 · 외주 발주 · 상판 발주 · 월 마감 · 메모를
-- 보고가 생기는 순간 동결해 한 행씩 쌓는다. 쓰기는 Worker(service_role)만, 읽기는 주인 또는 관리자(is_admin).
--
--   work_reports        보고 1건 = 1행 (추가 전용 — body·metrics 는 만든 뒤 바꾸지 않는다)
--   appliance_models    + 타공 칸 (상판 발주 요청서 — 싱크볼 · 쿡탑 · 수전 타공 규격, §8.1 Q10)
--
-- 사장님 결정 (2026-10-18): 관리자 전원이 본다 · 영구 보관(지우지 않고 '보관 처리') · PDF 파일은 보관하지 않는다.
-- 멱등: 두 번 실행해도 안전하다.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS work_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  period_start  DATE,
  period_end    DATE,
  -- 원천 상태 사본: pending/approved/dismissed/superseded · issued/superseded · sent/failed · ordered/received/cancelled
  status        TEXT,
  source_table  TEXT,
  source_id     UUID,
  order_ids     UUID[] NOT NULL DEFAULT '{}',
  design_ids    UUID[] NOT NULL DEFAULT '{}',
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  body          JSONB NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  pinned        BOOLEAN NOT NULL DEFAULT false,
  archived_at   TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_reports DROP CONSTRAINT IF EXISTS work_reports_kind_chk;
ALTER TABLE work_reports ADD CONSTRAINT work_reports_kind_chk CHECK (kind IN (
  'production_plan', 'staffing_decision', 'daily_brief', 'work_order', 'installation_order',
  'outsource_order', 'countertop_order', 'monthly_close', 'note'
));

ALTER TABLE work_reports DROP CONSTRAINT IF EXISTS work_reports_text_len_chk;
ALTER TABLE work_reports ADD CONSTRAINT work_reports_text_len_chk
  CHECK (length(title) <= 300 AND coalesce(length(note), 0) <= 4000);

-- 같은 원본은 한 번만 (백필·재시도 멱등). 원본 없는 보고(아침 요약·월 마감·메모)는 source_id 가 null 이라 걸리지 않는다
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_reports_source ON work_reports (kind, source_id) WHERE source_id IS NOT NULL;
-- 아침 요약은 주인 × 날짜 하나, 월 마감은 주인 × 달 하나
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_reports_daily ON work_reports (owner_id, period_start) WHERE kind = 'daily_brief';
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_reports_monthly ON work_reports (owner_id, period_start) WHERE kind = 'monthly_close';

CREATE INDEX IF NOT EXISTS idx_work_reports_owner ON work_reports (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_reports_kind ON work_reports (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_reports_orders ON work_reports USING GIN (order_ids);

COMMENT ON TABLE work_reports IS
  '작업 지시 보고 보관함. 보고가 생길 때 Worker 가 동결해 쌓는다. 지우지 않는다 — archived_at 으로 숨김.';

-- ── RLS — 주인 또는 관리자 읽기, 쓰기는 Worker(service_role)만 ──
ALTER TABLE work_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_reports FROM anon;

DROP POLICY IF EXISTS "Owner or admin read work reports" ON work_reports;
CREATE POLICY "Owner or admin read work reports" ON work_reports
  FOR SELECT TO authenticated USING (owner_id = auth.uid() OR public.is_admin());

-- ── 상판 발주 요청서 — 가전 모델 타공 규격 (관리자 가전 모델 화면에서 입력) ──
ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS cutout_w_mm   INT CHECK (cutout_w_mm IS NULL OR cutout_w_mm > 0);
ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS cutout_d_mm   INT CHECK (cutout_d_mm IS NULL OR cutout_d_mm > 0);
ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS cutout_r_mm   INT CHECK (cutout_r_mm IS NULL OR cutout_r_mm >= 0);
ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS faucet_hole_mm INT CHECK (faucet_hole_mm IS NULL OR faucet_hole_mm > 0);

COMMENT ON COLUMN appliance_models.cutout_w_mm IS '상판 타공 가로(mm) — 싱크볼·쿡탑. 상판 발주 요청서에 그대로 실린다';
COMMENT ON COLUMN appliance_models.cutout_d_mm IS '상판 타공 세로(mm)';
COMMENT ON COLUMN appliance_models.cutout_r_mm IS '상판 타공 모서리 R(mm), 0 이면 각';
COMMENT ON COLUMN appliance_models.faucet_hole_mm IS '수전 타공 지름(mm) — 싱크볼 모델에 적는다';

COMMIT;
