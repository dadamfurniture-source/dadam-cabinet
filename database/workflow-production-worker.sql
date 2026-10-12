-- ============================================================
-- 생산 — 작업자 링크 · 실측 작업 기록
--
-- 작업자는 계정이 없다. 대표가 만든 링크(토큰)로 휴대폰에서 production-worker.html 을 열어
-- 오늘 할 일을 보고, 시작·완료로 실제 걸린 시간과 수량을 남긴다.
-- 그 기록으로 표준시간(재단 1장·엣지 1장·조립 1통)을 실측값에 맞춘다.
--
--   production_worker_links  작업자 링크 (토큰은 해시만 저장, 만료·끊기)
--   production_worklogs      실측 기록 (공정 · 수량 · 분)
--
-- 앞선 database/workflow-production.sql 이 먼저 실행돼 있어야 한다. 멱등.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS production_worker_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  label       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE production_worker_links DROP CONSTRAINT IF EXISTS production_worker_links_label_len_chk;
ALTER TABLE production_worker_links ADD CONSTRAINT production_worker_links_label_len_chk
  CHECK (length(label) BETWEEN 1 AND 50);

CREATE INDEX IF NOT EXISTS idx_prod_links_user ON production_worker_links (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS production_worklogs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  link_id      UUID REFERENCES production_worker_links(id) ON DELETE SET NULL,
  worker_label TEXT,
  work_date    DATE NOT NULL,
  -- cutter = 재단(원판 장), edge = 엣지(PB 장), asm = 조립(통·서랍 개)
  role         TEXT NOT NULL CHECK (role IN ('cutter', 'edge', 'asm')),
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_label  TEXT,
  units        NUMERIC(8, 2) NOT NULL CHECK (units > 0 AND units <= 1000),
  minutes      NUMERIC(8, 2) NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE production_worklogs DROP CONSTRAINT IF EXISTS production_worklogs_len_chk;
ALTER TABLE production_worklogs ADD CONSTRAINT production_worklogs_len_chk
  CHECK (coalesce(length(note), 0) <= 300 AND coalesce(length(order_label), 0) <= 200 AND coalesce(length(worker_label), 0) <= 50);

CREATE INDEX IF NOT EXISTS idx_prod_worklogs_user_date ON production_worklogs (user_id, work_date DESC);

-- 지시 완료 시각 (작업자 화면에서 체크)
ALTER TABLE production_assignments ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

-- ── RLS — 소유자 읽기만, 쓰기는 Worker(service_role)만 ──────
ALTER TABLE production_worker_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_worklogs     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON production_worker_links FROM anon;
REVOKE ALL ON production_worklogs     FROM anon;

DROP POLICY IF EXISTS "Users read own worker links" ON production_worker_links;
CREATE POLICY "Users read own worker links" ON production_worker_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own worklogs" ON production_worklogs;
CREATE POLICY "Users read own worklogs" ON production_worklogs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

COMMIT;
