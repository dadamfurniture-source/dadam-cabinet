-- ============================================================
-- 냉장고 모델 대량 수집 — 칸 추가 · 가져오기 함수 (2026-10-19 사장님 요청)
--
--   "냉장고 모델을 최대한 많이 데이터베이스화"
--   범위: 냉장고 · 김치냉장고 · 와인셀러 · 소형 냉장고, 삼성 · LG 먼저
--   치수: 목록은 가격비교, W·D·H 는 제조사 공식 값으로 확인 (verified)
--   단위: 크기가 같으면 한 행 — 색상 · 마감만 다른 모델 코드는 model_codes 에 모두 기록
--
-- 김치냉장고 · 와인셀러도 category = 'refrigerator' 로 둔다 — 플래너 냉장고 칸이 그대로 고른다.
-- 세부 구분은 subtype 칸.
--
-- 적용: Supabase SQL 편집기에서 이 파일 → 그 뒤 수집기가 만든 import SQL.
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS · CREATE OR REPLACE · 빈 값만 채움).
-- ============================================================

ALTER TABLE appliance_models
  ADD COLUMN IF NOT EXISTS subtype      TEXT,
  ADD COLUMN IF NOT EXISTS line         TEXT,
  ADD COLUMN IF NOT EXISTS install_type TEXT,
  ADD COLUMN IF NOT EXISTS model_codes  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS back_gap_mm  INT CHECK (back_gap_mm >= 0),
  ADD COLUMN IF NOT EXISTS discontinued BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_subtype_chk CHECK (subtype IS NULL OR subtype IN (
  'french_4door',   -- 4도어 (상냉장 하냉동 · 비스포크 4도어 등)
  'side_by_side',   -- 양문형
  'two_door',       -- 일반 2도어 (상냉동 하냉장)
  'one_door',       -- 1도어 (냉장 · 냉동 · 김치 단품, 키친핏 1도어)
  'built_in',       -- 완전 빌트인 (가구 도어 부착형)
  'kimchi_stand',   -- 김치냉장고 스탠드형
  'kimchi_lid',     -- 김치냉장고 뚜껑형
  'wine',           -- 와인셀러
  'small'           -- 소형 · 미니 냉장고
));

ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_install_type_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_install_type_chk CHECK (
  install_type IS NULL OR install_type IN ('freestanding', 'kitchen_fit', 'built_in')
);

COMMENT ON COLUMN appliance_models.subtype      IS '냉장고 세부 구분 — french_4door | side_by_side | two_door | one_door | built_in | kimchi_stand | kimchi_lid | wine | small';
COMMENT ON COLUMN appliance_models.line         IS '제품 라인 — BESPOKE · 키친핏 · 인피니트 · 오브제컬렉션 · 핏앤맥스 · 디오스 …';
COMMENT ON COLUMN appliance_models.install_type IS 'freestanding(일반) | kitchen_fit(가구 깊이 맞춤) | built_in(가구 도어 부착)';
COMMENT ON COLUMN appliance_models.model_codes  IS '크기가 같은 모든 모델 코드 (색상 · 마감 변형). model_code 는 대표 코드';
COMMENT ON COLUMN appliance_models.back_gap_mm  IS '설치 여유 — 뒤 (mm). 제조사가 공개한 경우만';
COMMENT ON COLUMN appliance_models.discontinued IS '단종 — 목록에서 사라진 모델. 지우지 않는다 (예전 설계가 가리킨다)';
COMMENT ON COLUMN appliance_models.collected_at IS '수집기가 마지막으로 제조사 공식 값을 확인한 때';

CREATE INDEX IF NOT EXISTS idx_appliance_subtype     ON appliance_models(subtype);
CREATE INDEX IF NOT EXISTS idx_appliance_model_codes ON appliance_models USING GIN (model_codes);

-- 기존 행 채우기 (빈 칸만)
UPDATE appliance_models SET model_codes = ARRAY[model_code]
WHERE model_code IS NOT NULL AND model_codes = '{}';

UPDATE appliance_models SET install_type = CASE
    WHEN model_name LIKE '%키친핏%' OR model_name ILIKE '%kitchen fit%' THEN 'kitchen_fit'
    WHEN model_name LIKE '%빌트인%' OR model_name ILIKE '%built%in%'   THEN 'built_in'
    ELSE 'freestanding' END
WHERE category = 'refrigerator' AND install_type IS NULL;

UPDATE appliance_models SET subtype = CASE
    WHEN model_name LIKE '%양문%'  THEN 'side_by_side'
    WHEN model_name LIKE '%4도어%' THEN 'french_4door'
    WHEN model_name LIKE '%1도어%' THEN 'one_door'
    ELSE NULL END
WHERE category = 'refrigerator' AND subtype IS NULL;

-- ── 가져오기 ─────────────────────────────────────────────
-- 수집기(scripts/fridge-catalog)가 만든 import SQL 이 부른다:
--   SELECT import_appliance_models('[{...}, …]'::jsonb);
-- 같은 브랜드에서 모델 코드가 하나라도 겹치면 그 행을 갱신, 없으면 새로 만든다 (여러 번 실행해도 중복 없음).
-- 갱신 규칙:
--   치수 · 용량 · 이름 · 구분 · 라인 · 출처  ← 수집값 (제조사 공식)
--   모델 코드                                ← 합집합
--   설치 여유(옆 · 위 · 뒤)                  ← 기존 값 우선 — 관리 화면에서 사장님이 고친 값을 덮지 않는다
--   verified                                ← 기존 OR 수집
-- 반환: { inserted, updated, skipped }
CREATE OR REPLACE FUNCTION import_appliance_models(rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  r       JSONB;
  codes   TEXT[];
  hit     UUID;
  n_ins   INT := 0;
  n_upd   INT := 0;
  n_skip  INT := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    codes := ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'model_codes', '[]'::jsonb)));
    IF (r->>'model_code') IS NOT NULL AND NOT ((r->>'model_code') = ANY(codes)) THEN
      codes := array_prepend(r->>'model_code', codes);
    END IF;
    IF array_length(codes, 1) IS NULL
       OR COALESCE((r->>'width_mm')::INT, 0) <= 0
       OR COALESCE((r->>'depth_mm')::INT, 0) <= 0
       OR COALESCE((r->>'height_mm')::INT, 0) <= 0 THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    SELECT id INTO hit FROM appliance_models
     WHERE brand = r->>'brand'
       AND (model_codes && codes OR model_code = ANY(codes))
     ORDER BY verified DESC, updated_at DESC
     LIMIT 1;

    IF hit IS NULL THEN
      INSERT INTO appliance_models (
        category, brand, model_name, model_code, model_codes, width_mm, depth_mm, height_mm, capacity_l,
        subtype, line, install_type, side_gap_mm, top_gap_mm, back_gap_mm,
        verified, source_url, notes, collected_at
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        (r->>'width_mm')::INT, (r->>'depth_mm')::INT, (r->>'height_mm')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', r->>'notes', NOW()
      );
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_models SET
        model_name   = COALESCE(r->>'model_name', model_name),
        model_codes  = ARRAY(SELECT DISTINCT unnest(model_codes || codes)),
        width_mm     = (r->>'width_mm')::INT,
        depth_mm     = (r->>'depth_mm')::INT,
        height_mm    = (r->>'height_mm')::INT,
        capacity_l   = COALESCE(NULLIF(r->>'capacity_l', '')::INT, capacity_l),
        subtype      = COALESCE(r->>'subtype', subtype),
        line         = COALESCE(r->>'line', line),
        install_type = COALESCE(r->>'install_type', install_type),
        side_gap_mm  = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT),
        top_gap_mm   = COALESCE(top_gap_mm,  NULLIF(r->>'top_gap_mm', '')::INT),
        back_gap_mm  = COALESCE(back_gap_mm, NULLIF(r->>'back_gap_mm', '')::INT),
        verified     = verified OR COALESCE((r->>'verified')::BOOLEAN, false),
        source_url   = COALESCE(r->>'source_url', source_url),
        discontinued = false,
        collected_at = NOW()
      WHERE id = hit;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip);
END;
$$;

-- SQL 편집기(관리자)만 부른다 — 웹 · 익명 사용자는 못 부른다
REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;

-- 확인:
--   SELECT subtype, brand, count(*) FROM appliance_models WHERE category = 'refrigerator' GROUP BY 1, 2 ORDER BY 1, 2;
