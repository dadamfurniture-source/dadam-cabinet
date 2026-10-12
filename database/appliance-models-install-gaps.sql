-- ============================================================
-- 냉장고 설치 여유 (2026-10-12 사장님 결정)
--   위장 폭   = 냉장고 폭 + 양옆 여유 × 2      예) 10 + 595 + 10 = 615
--   위장 아랫선 = 냉장고 높이 + 위 여유
--
-- 적용 순서: 사장님 확인 → Supabase SQL 편집기에서 이 파일 실행.
-- 적용 전에도 플래너는 동작한다 — mockup-shell.html fetchApplianceModels 가 이 칸을 먼저 읽고,
--   칸이 없어 400 이 오면 예전 칸만 다시 읽어 브랜드 라인 기본값(fridgeGapsOf)을 쓴다.
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS · 빈 값만 채움).
-- ============================================================

ALTER TABLE appliance_models
  ADD COLUMN IF NOT EXISTS side_gap_mm INT CHECK (side_gap_mm >= 0),
  ADD COLUMN IF NOT EXISTS top_gap_mm  INT CHECK (top_gap_mm  >= 0);

COMMENT ON COLUMN appliance_models.side_gap_mm IS
  '설치 여유 — 냉장고 한쪽 옆 (mm). 위장 폭 = width_mm + 2 × side_gap_mm. 정본은 제조사 설치 가이드';
COMMENT ON COLUMN appliance_models.top_gap_mm IS
  '설치 여유 — 냉장고 위 (mm). 위장 아랫선 = height_mm + top_gap_mm';

-- 기본값 — 브랜드 라인. js/detaildesign/data-constants.js FRIDGE_RULES.DEFAULT_GAPS ·
-- mockup-shell.html FRIDGE_DEFAULT_GAPS 와 같은 수다 (셋이 갈라지면 화면과 표가 다르게 계산한다).
--   삼성 키친핏(비스포크) 12 · 삼성 인피니트 5 · LG 빌트인(핏앤맥스) 4 · 그 밖(프리스탠딩) 50 · 위 15
-- 설치 가이드를 확인하는 대로 모델별로 고쳐 나간다 — 아래는 **비어 있는 칸만** 채운다.
UPDATE appliance_models SET
  side_gap_mm = CASE
    WHEN model_name LIKE '%키친핏%'  OR model_name ILIKE '%kitchen fit%' THEN 12
    WHEN model_name LIKE '%인피니트%' OR model_name ILIKE '%infinite%'    THEN 5
    WHEN model_name LIKE '%빌트인%'  OR model_name ILIKE '%built%in%'
      OR model_name ILIKE '%fit%max%'                                      THEN 4
    ELSE 50
  END
WHERE category = 'refrigerator' AND side_gap_mm IS NULL;

UPDATE appliance_models SET top_gap_mm = 15
WHERE category = 'refrigerator' AND top_gap_mm IS NULL;

-- 확인: SELECT brand, model_name, width_mm, side_gap_mm, width_mm + 2 * side_gap_mm AS upper_w, top_gap_mm
--         FROM appliance_models WHERE category = 'refrigerator' ORDER BY brand, model_name;
