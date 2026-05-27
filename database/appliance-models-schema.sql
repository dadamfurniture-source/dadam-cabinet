-- ============================================================================
-- W9-44: 가전 모델 카탈로그
-- 냉장고/후드/식세기/분배기 등 가전의 표준 치수 (W/D/H mm) DB 관리
-- ============================================================================

CREATE TABLE IF NOT EXISTS appliance_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine')),
  brand       TEXT NOT NULL,
  model_name  TEXT NOT NULL,
  model_code  TEXT,
  width_mm    INT  NOT NULL CHECK (width_mm  > 0),
  depth_mm    INT  NOT NULL CHECK (depth_mm  > 0),
  height_mm   INT  NOT NULL CHECK (height_mm > 0),
  capacity_l  INT,
  verified    BOOLEAN DEFAULT false,
  source_url  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appliance_category  ON appliance_models(category);
CREATE INDEX IF NOT EXISTS idx_appliance_brand     ON appliance_models(brand);
CREATE INDEX IF NOT EXISTS idx_appliance_verified  ON appliance_models(verified);

-- updated_at 자동 갱신 trigger
CREATE OR REPLACE FUNCTION update_appliance_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appliance_models_updated_at ON appliance_models;
CREATE TRIGGER appliance_models_updated_at
  BEFORE UPDATE ON appliance_models
  FOR EACH ROW EXECUTE FUNCTION update_appliance_models_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
-- 모든 사용자 READ, 관리자만 WRITE (admin_roles 활용)
ALTER TABLE appliance_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appliance_models_read_all"     ON appliance_models;
DROP POLICY IF EXISTS "appliance_models_admin_insert" ON appliance_models;
DROP POLICY IF EXISTS "appliance_models_admin_update" ON appliance_models;
DROP POLICY IF EXISTS "appliance_models_admin_delete" ON appliance_models;

CREATE POLICY "appliance_models_read_all" ON appliance_models
  FOR SELECT USING (true);

CREATE POLICY "appliance_models_admin_insert" ON appliance_models
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'superadmin'))
  );

CREATE POLICY "appliance_models_admin_update" ON appliance_models
  FOR UPDATE USING (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'superadmin'))
  );

CREATE POLICY "appliance_models_admin_delete" ON appliance_models
  FOR DELETE USING (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'superadmin'))
  );

-- ── 코멘트 ─────────────────────────────────────────────────────
COMMENT ON TABLE  appliance_models IS '가전 모델 카탈로그 (냉장고/후드/식세기/분배기) — 도면 배치 시 W/D/H 참조';
COMMENT ON COLUMN appliance_models.category   IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine';
COMMENT ON COLUMN appliance_models.width_mm   IS '도면 가로 (mm)';
COMMENT ON COLUMN appliance_models.depth_mm   IS '도면 깊이 = 평면도 세로 (mm), 후면 핸들 포함';
COMMENT ON COLUMN appliance_models.height_mm  IS '3D 모듈 높이 (mm)';
COMMENT ON COLUMN appliance_models.verified   IS 'true=제조사 공식 사양 / false=카테고리 표준 추정';
