-- ============================================================
-- 가전 모델 — 전자레인지 종류 추가 (2026-10-25 사장님)
--
--   "전자레인지 칸 크기 기준은 DB에 저장된 전자레인지 외경 크기 + 20이 오픈장 내경의 최솟값이면 된다.
--    그 이상은 크게 관계없다."
--
--   appliance_models.category 에 'microwave' 를 더한다. 치수 칸은 그대로 —
--   width_mm · height_mm · depth_mm = 전자레인지 외경 (손잡이 · 다리 포함 바깥 크기).
--   검사 규칙은 엔진 js/detaildesign/bom-open-cabinet-rules.js applianceWarningsOf (오픈장 내경 ≥ 외경 + 20).
--
-- 적용: Supabase SQL 편집기에서 이 파일을 실행한다. 여러 번 실행해도 안전하다 (제약을 지우고 다시 건다).
--   그 뒤 관리 화면(admin/appliances.html) '전자레인지' 탭에서 모델 치수를 넣는다.
-- ============================================================

-- 첫 스키마(appliance-models-schema.sql)의 열 CHECK 은 Postgres 기본 이름 appliance_models_category_check 로 붙어 있다
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_category_check;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_category_check CHECK (
  category IN ('refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine', 'microwave')
);

COMMENT ON COLUMN appliance_models.category IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine | microwave';
