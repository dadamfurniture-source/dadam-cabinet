-- ═══════════════════════════════════════════════════════════════
-- 경영 대시보드 3단계 — 내다보고 다듬는다   (2026-10-19)
-- ═══════════════════════════════════════════════════════════════
-- 이력이 쌓여야 제 뜻을 내는 도구들의 칸:
--   일정의 처음 잡은 날 · 실제 완료 시각  design_schedules.planned_at · completed_at  → 7 리드타임 · 납기 준수
--   과거 월 매출                            sales_history                              → 21 계절 지수 · 수주 예측
--   분기 목표                               okrs                                       → 18 분기 OKR
-- (15 원판 수율은 작업 실측 · 견적 수량으로 돌아가 새 칸이 없다)
--
-- 여러 번 실행해도 안전하다. Supabase SQL Editor 에서 한 번 실행한다.

BEGIN;

-- ── 1. 일정: 처음 잡은 날 · 실제 완료 시각 ─────────────────────
-- 일정은 미뤄지면 scheduled_at 이 바뀐다. 약속을 지켰는지 보려면 처음 잡은 날이 남아 있어야 하고,
-- 단계 사이에 며칠 기다렸는지 보려면 '완료' 를 누른 시각이 남아 있어야 한다.
-- 앱 어느 경로로 바꿔도 빠지지 않게 DB 트리거가 채운다.
ALTER TABLE design_schedules ADD COLUMN IF NOT EXISTS planned_at   TIMESTAMPTZ;
ALTER TABLE design_schedules ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
COMMENT ON COLUMN design_schedules.planned_at IS '처음 잡은 날 — 일정을 미뤄도 바뀌지 않는다 (납기 준수의 기준)';
COMMENT ON COLUMN design_schedules.completed_at IS '완료로 바꾼 시각 — 완료가 아니게 되면 비운다 (리드타임의 기준)';

-- 옛 일정: 완료 시각은 마지막으로 고친 시각으로, 처음 잡은 날은 지금 날짜로 근사.
-- 완료 시각을 먼저 채운다 — updated_at 을 고치는 트리거(trg_dsched_touch)가 다음 UPDATE 에서 updated_at 을 now() 로 바꾸기 때문
UPDATE design_schedules SET completed_at = updated_at WHERE status = 'completed' AND completed_at IS NULL;
UPDATE design_schedules SET planned_at = scheduled_at WHERE planned_at IS NULL;

CREATE OR REPLACE FUNCTION public.dsched_track_times() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.planned_at IS NULL THEN NEW.planned_at := NEW.scheduled_at; END IF;
    IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    RETURN NEW;
  END IF;
  -- 처음 잡은 날은 바뀌지 않는다
  NEW.planned_at := COALESCE(OLD.planned_at, OLD.scheduled_at);
  IF NEW.status = 'completed' THEN
    IF OLD.status IS DISTINCT FROM 'completed' OR NEW.completed_at IS NULL THEN
      NEW.completed_at := COALESCE(OLD.completed_at, now());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dsched_track_times ON design_schedules;
CREATE TRIGGER trg_dsched_track_times BEFORE INSERT OR UPDATE ON design_schedules
  FOR EACH ROW EXECUTE FUNCTION public.dsched_track_times();

-- ── 2. 과거 월 매출 ──────────────────────────────────────────
-- 시스템 수주가 쌓이기 전의 장사를 사장님이 달마다 적는다 (거래명세서 · 장부 기준, VAT 제외).
-- 시스템 수주가 있는 달은 시스템 숫자가 먼저다 — 이 표는 그 전의 달을 메운다.
CREATE TABLE IF NOT EXISTS sales_history (
  month       DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
  revenue     BIGINT NOT NULL CHECK (revenue >= 0),
  orders      INT CHECK (orders IS NULL OR orders >= 0),
  memo        TEXT CHECK (memo IS NULL OR length(memo) <= 300),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sales_history IS '과거 월 매출(VAT 제외) — 계절 지수 · 수주 예측. 달의 1일로 적는다';

-- ── 3. 분기 목표 ─────────────────────────────────────────────
-- 석 달에 셋. 대시보드 숫자(매출 · 순이익 · 전환율 · NPS · A/S 율 · 납기 준수 …)에 묶으면 저절로 진도가 난다.
-- 묶을 숫자가 없는 목표는 manual — 사장님이 지금 값을 적는다.
CREATE TABLE IF NOT EXISTS okrs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter       TEXT NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  objective     TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 200),
  metric        TEXT NOT NULL,
  target        NUMERIC NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up', 'down')),
  manual_value  NUMERIC,
  sort          SMALLINT NOT NULL DEFAULT 0,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_okrs_quarter ON okrs (quarter, sort);
COMMENT ON TABLE okrs IS '분기 목표 — metric 은 대시보드 숫자 이름(워커 OKR_METRICS) 또는 manual';

-- ── RLS — 관리자만 읽기, 쓰기는 Worker(service_role) ─────────
ALTER TABLE sales_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE okrs          ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_history, okrs FROM anon;
DROP POLICY IF EXISTS "Admin read sales history" ON sales_history;
CREATE POLICY "Admin read sales history" ON sales_history FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin read okrs" ON okrs;
CREATE POLICY "Admin read okrs" ON okrs FOR SELECT TO authenticated USING (public.is_admin());

DROP TRIGGER IF EXISTS trg_okrs_touch ON okrs;
CREATE TRIGGER trg_okrs_touch BEFORE UPDATE ON okrs
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

COMMIT;
