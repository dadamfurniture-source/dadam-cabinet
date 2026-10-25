-- ============================================================
-- 가전 모델 — 주방가전 수집 (2026-10-25 사장님 "전자레인지 및 주방가전 데이터 수집")
--
--   품목: 전자레인지 · 광파오븐 · 빌트인 오븐 · 식기세척기 · 쿡탑 · 후드 · 밥솥(새 종류)
--   수집기: scripts/kitchen-catalog (삼성 · LG 공식 상품 사양, 밥솥은 쿠첸 · 쿠쿠 공식 몰)
--
--   1. 종류에 'rice_cooker'(밥솥)를 더한다 (appliance-models-microwave.sql 의 'microwave' 도 함께 들어 있다)
--   2. 세부 구분(subtype) 검사를 종류별로 — 냉장고 9가지는 그대로, 주방가전 종류마다 따로
--   3. 가져오기 함수 import_appliance_models() 가 쿡탑 · 싱크볼 타공(cutout_w/d/r_mm)과 싱크볼 수전 구멍(faucet_hole_mm)도 넣는다
--      (2026-10-25 사장님 "하츠나, 백조 등등도" — 싱크볼 수집)
--   4. 2026-10-25 사장님 답: 종류 'range'(빌트인 가스오븐레인지 — 위 버너 + 아래 오븐)와 'faucet'(주방 수전 — 수전 구멍은 수전 기준),
--      가스 쿡탑 · 가스오븐레인지가 쓸 수 있는 가스 gas_types ('LNG' · 'LPG', "가스레인지는 LPG, LNG(도시가스) 두 가지로 나눠야함")
--
-- 적용: Supabase SQL 편집기에서 이 파일 한 번 → 그 뒤 수집기가 만든 import-kitchen.sql.
--   이 파일만 돌려도 되도록 함수가 쓰는 칸을 모두 IF NOT EXISTS 로 둔다 (먼저 돌린 다른 파일과 같은 정의).
--   여러 번 실행해도 안전하다 (IF NOT EXISTS · 제약은 지우고 다시 건다 · CREATE OR REPLACE).
-- ============================================================

-- ── 1. 종류 ───────────────────────────────────────────────
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_category_check;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_category_check CHECK (
  category IN ('refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine', 'microwave', 'rice_cooker', 'range', 'faucet')
);
COMMENT ON COLUMN appliance_models.category IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine | microwave | rice_cooker | range | faucet';

-- ── 칸 (먼저 돌린 파일이 있으면 그대로 둔다) ─────────────────
ALTER TABLE appliance_models
  -- appliance-models-catalog.sql
  ADD COLUMN IF NOT EXISTS subtype      TEXT,
  ADD COLUMN IF NOT EXISTS line         TEXT,
  ADD COLUMN IF NOT EXISTS install_type TEXT,
  ADD COLUMN IF NOT EXISTS model_codes  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS back_gap_mm  INT CHECK (back_gap_mm >= 0),
  ADD COLUMN IF NOT EXISTS discontinued BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  -- appliance-models-install-gaps.sql
  ADD COLUMN IF NOT EXISTS side_gap_mm INT CHECK (side_gap_mm >= 0),
  ADD COLUMN IF NOT EXISTS top_gap_mm  INT CHECK (top_gap_mm  >= 0),
  -- appliance-models-niche.sql
  ADD COLUMN IF NOT EXISTS niche_min_w_mm INT CHECK (niche_min_w_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_min_h_mm INT CHECK (niche_min_h_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_min_d_mm INT CHECK (niche_min_d_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_w_mm INT CHECK (niche_max_w_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_h_mm INT CHECK (niche_max_h_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_d_mm INT CHECK (niche_max_d_mm > 0),
  -- appliance-models-images.sql (원본 주소 칸만 — 버킷 · 가져온 사진 칸은 그 파일)
  ADD COLUMN IF NOT EXISTS image_source_url TEXT,
  -- work-reports.sql (상판 발주 요청서 타공 규격)
  ADD COLUMN IF NOT EXISTS cutout_w_mm INT CHECK (cutout_w_mm IS NULL OR cutout_w_mm > 0),
  ADD COLUMN IF NOT EXISTS cutout_d_mm INT CHECK (cutout_d_mm IS NULL OR cutout_d_mm > 0),
  ADD COLUMN IF NOT EXISTS cutout_r_mm INT CHECK (cutout_r_mm IS NULL OR cutout_r_mm >= 0),
  ADD COLUMN IF NOT EXISTS faucet_hole_mm INT CHECK (faucet_hole_mm IS NULL OR faucet_hole_mm > 0),
  ADD COLUMN IF NOT EXISTS gas_types TEXT[] CHECK (gas_types IS NULL OR gas_types <@ ARRAY['LNG', 'LPG']::TEXT[]);

COMMENT ON COLUMN appliance_models.gas_types IS '가스 쿡탑 · 가스오븐레인지가 쓸 수 있는 가스 — LNG(도시가스) · LPG. 제조사가 적은 것만';

ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_install_type_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_install_type_chk CHECK (
  install_type IS NULL OR install_type IN ('freestanding', 'kitchen_fit', 'built_in')
);
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_image_source_url_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_image_source_url_chk CHECK (
  image_source_url IS NULL OR image_source_url ~ '^https?://'
);

-- 수전은 치수 없이 수전 구멍 지름만으로도 받는다 (2026-10-25 — 수전 회사 대부분이 본체 폭을 공개하지 않는다).
--   다른 종류는 지금처럼 W · H · D 필수. 첫 스키마의 열 CHECK(Postgres 기본 이름 appliance_models_<칸>_check)와 NOT NULL 을
--   종류 조건 하나로 바꾼다. 수전은 수전 구멍이 있거나 W · H · D 가 다 있어야 한다.
ALTER TABLE appliance_models ALTER COLUMN width_mm DROP NOT NULL, ALTER COLUMN depth_mm DROP NOT NULL, ALTER COLUMN height_mm DROP NOT NULL;
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_width_mm_check;
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_depth_mm_check;
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_height_mm_check;
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_dims_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_dims_chk CHECK (
  (width_mm IS NULL OR width_mm > 0) AND (depth_mm IS NULL OR depth_mm > 0) AND (height_mm IS NULL OR height_mm > 0)
  AND (category = 'faucet' OR (width_mm IS NOT NULL AND depth_mm IS NOT NULL AND height_mm IS NOT NULL))
  AND (category <> 'faucet' OR faucet_hole_mm IS NOT NULL OR (width_mm IS NOT NULL AND depth_mm IS NOT NULL AND height_mm IS NOT NULL))
);

-- ── 2. 세부 구분 — 종류별 (appliance-models-catalog.sql 과 같은 정의) ──
-- 종류는 제조사 메뉴가 정한다 (전자레인지 · 광파오븐 메뉴 → microwave, 오븐 메뉴 → oven).
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_subtype_chk CHECK (subtype IS NULL OR CASE category
  WHEN 'refrigerator' THEN subtype IN (
    'french_4door',   -- 4도어 (상냉장 하냉동 · 비스포크 4도어 등)
    'side_by_side',   -- 양문형
    'two_door',       -- 일반 2도어 (상냉동 하냉장)
    'one_door',       -- 1도어 (냉장 · 냉동 · 김치 단품, 키친핏 1도어)
    'built_in',       -- 완전 빌트인 (가구 도어 부착형)
    'kimchi_stand',   -- 김치냉장고 스탠드형
    'kimchi_lid',     -- 김치냉장고 뚜껑형
    'wine',           -- 와인셀러
    'small')          -- 소형 · 미니 냉장고
  WHEN 'microwave' THEN subtype IN (
    'solo',           -- 전자레인지
    'combi')          -- 광파 · 오븐 겸용 (큐커 포함)
  WHEN 'oven' THEN subtype IN (
    'oven',           -- 오븐
    'steam_oven',     -- 스팀오븐
    'combi')          -- 빌트인 복합오븐 (전자레인지 겸용)
  WHEN 'dishwasher' THEN subtype IN (
    'built_in',       -- 빌트인
    'freestanding',   -- 프리스탠딩
    'countertop')     -- 카운터탑 (식탁 위)
  WHEN 'cooktop' THEN subtype IN (
    'induction',      -- 인덕션
    'highlight',      -- 하이라이트
    'hybrid',         -- 하이브리드 (인덕션 + 하이라이트)
    'gas')            -- 가스
  WHEN 'hood' THEN subtype IN (
    'chimney',        -- 침니형
    'slim',           -- 슬림형
    'built_in',       -- 빌트인 (매립)
    'island')         -- 아일랜드
  WHEN 'rice_cooker' THEN subtype IN (
    'pressure_ih',    -- IH 압력
    'ih',             -- IH
    'pressure',       -- 열판 압력
    'electric')       -- 일반 전기 (마이컴)
  WHEN 'range' THEN subtype IN (   -- 빌트인 가스오븐레인지 — 위 화구 방식 (쿡탑과 같은 목록)
    'gas',
    'induction',
    'hybrid',
    'highlight')
  ELSE false END);

COMMENT ON COLUMN appliance_models.subtype IS '세부 구분 — 종류별 목록은 appliance_models_subtype_chk (database/appliance-models-kitchen.sql)';

-- ── 3. 가져오기 ─────────────────────────────────────────────
-- 수집기(scripts/fridge-catalog · scripts/kitchen-catalog)가 만든 import SQL 이 부른다:
--   SELECT import_appliance_models('[{...}, …]'::jsonb);
-- 같은 브랜드에서 모델 코드가 하나라도 겹치면 그 행을 갱신, 없으면 새로 만든다 (여러 번 실행해도 중복 없음).
-- 갱신 규칙 (appliance-models-images.sql 의 정의 + 타공):
--   치수 · 용량 · 이름 · 구분 · 라인 · 출처            ← 수집값 (제조사 공식)
--   모델 코드                                          ← 합집합
--   설치 여유 · 니치 · 타공 · 수전 구멍                  ← 기존 값 우선 — 관리 화면에서 고친 값을 덮지 않는다
--   verified                                          ← 기존 OR 수집
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
    -- W · H · D 필수 — 수전만 수전 구멍 지름이 있으면 치수 없이도 (appliance_models_dims_chk 와 같은 조건)
    IF array_length(codes, 1) IS NULL
       OR ((COALESCE((r->>'width_mm')::INT, 0) <= 0
            OR COALESCE((r->>'depth_mm')::INT, 0) <= 0
            OR COALESCE((r->>'height_mm')::INT, 0) <= 0)
           AND NOT (r->>'category' = 'faucet' AND COALESCE(NULLIF(r->>'faucet_hole_mm', '')::INT, 0) > 0)) THEN
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
        niche_min_w_mm, niche_min_h_mm, niche_min_d_mm, niche_max_w_mm, niche_max_h_mm, niche_max_d_mm,
        cutout_w_mm, cutout_d_mm, cutout_r_mm, faucet_hole_mm, gas_types,
        verified, source_url, image_source_url, notes, collected_at
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        NULLIF(r->>'width_mm', '')::INT, NULLIF(r->>'depth_mm', '')::INT, NULLIF(r->>'height_mm', '')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        NULLIF(r->>'niche_min_w_mm', '')::INT, NULLIF(r->>'niche_min_h_mm', '')::INT, NULLIF(r->>'niche_min_d_mm', '')::INT,
        NULLIF(r->>'niche_max_w_mm', '')::INT, NULLIF(r->>'niche_max_h_mm', '')::INT, NULLIF(r->>'niche_max_d_mm', '')::INT,
        NULLIF(r->>'cutout_w_mm', '')::INT, NULLIF(r->>'cutout_d_mm', '')::INT, NULLIF(r->>'cutout_r_mm', '')::INT,
        NULLIF(r->>'faucet_hole_mm', '')::INT,
        NULLIF(ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'gas_types', '[]'::jsonb))), '{}'),
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', NULLIF(r->>'image_source_url', ''), r->>'notes', NOW()
      );
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_models SET
        model_name       = COALESCE(r->>'model_name', model_name),
        model_codes      = ARRAY(SELECT DISTINCT unnest(model_codes || codes)),
        width_mm         = COALESCE(NULLIF(r->>'width_mm', '')::INT, width_mm),     -- 수전은 치수가 비어 올 수 있다
        depth_mm         = COALESCE(NULLIF(r->>'depth_mm', '')::INT, depth_mm),
        height_mm        = COALESCE(NULLIF(r->>'height_mm', '')::INT, height_mm),
        capacity_l       = COALESCE(NULLIF(r->>'capacity_l', '')::INT, capacity_l),
        subtype          = COALESCE(r->>'subtype', subtype),
        line             = COALESCE(r->>'line', line),
        install_type     = COALESCE(r->>'install_type', install_type),
        side_gap_mm      = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT),
        top_gap_mm       = COALESCE(top_gap_mm,  NULLIF(r->>'top_gap_mm', '')::INT),
        back_gap_mm      = COALESCE(back_gap_mm, NULLIF(r->>'back_gap_mm', '')::INT),
        niche_min_w_mm   = COALESCE(niche_min_w_mm, NULLIF(r->>'niche_min_w_mm', '')::INT),
        niche_min_h_mm   = COALESCE(niche_min_h_mm, NULLIF(r->>'niche_min_h_mm', '')::INT),
        niche_min_d_mm   = COALESCE(niche_min_d_mm, NULLIF(r->>'niche_min_d_mm', '')::INT),
        niche_max_w_mm   = COALESCE(niche_max_w_mm, NULLIF(r->>'niche_max_w_mm', '')::INT),
        niche_max_h_mm   = COALESCE(niche_max_h_mm, NULLIF(r->>'niche_max_h_mm', '')::INT),
        niche_max_d_mm   = COALESCE(niche_max_d_mm, NULLIF(r->>'niche_max_d_mm', '')::INT),
        cutout_w_mm      = COALESCE(cutout_w_mm, NULLIF(r->>'cutout_w_mm', '')::INT),
        cutout_d_mm      = COALESCE(cutout_d_mm, NULLIF(r->>'cutout_d_mm', '')::INT),
        cutout_r_mm      = COALESCE(cutout_r_mm, NULLIF(r->>'cutout_r_mm', '')::INT),
        faucet_hole_mm   = COALESCE(faucet_hole_mm, NULLIF(r->>'faucet_hole_mm', '')::INT),
        gas_types        = COALESCE(NULLIF(ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'gas_types', '[]'::jsonb))), '{}'), gas_types),
        verified         = verified OR COALESCE((r->>'verified')::BOOLEAN, false),
        source_url       = COALESCE(r->>'source_url', source_url),
        image_source_url = COALESCE(NULLIF(r->>'image_source_url', ''), image_source_url),
        discontinued     = false,
        collected_at     = NOW()
      WHERE id = hit;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip);
END;
$$;

REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;

-- 확인:
--   SELECT category, subtype, brand, count(*) FROM appliance_models
--    WHERE category <> 'refrigerator' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
