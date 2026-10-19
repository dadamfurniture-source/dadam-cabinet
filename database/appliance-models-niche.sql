-- ============================================================
-- 빌트인 냉장고 장 안쪽 치수(니치) 칸 (2026-10-19 사장님 — 데이코 · LG SKS 수집)
--
--   빌트인은 냉장고 겉 크기보다 "장을 얼마로 짜야 하는지"(니치)가 핵심이다.
--   제조사가 한 값만 주면(데이코 '빌트인 설치 시 권장 공간') 최소 = 그 값, 최대는 비운다.
--   범위로 주면(리페르 · 밀레 1772~1788 등) 최소 · 최대를 모두 넣는다.
--
-- 적용: Supabase SQL 편집기에서 이 파일 → 그 뒤 수집기가 만든 import SQL.
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS · CREATE OR REPLACE).
-- 먼저 database/appliance-models-catalog.sql 이 실행돼 있어야 한다.
-- ============================================================

ALTER TABLE appliance_models
  ADD COLUMN IF NOT EXISTS niche_min_w_mm INT CHECK (niche_min_w_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_min_h_mm INT CHECK (niche_min_h_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_min_d_mm INT CHECK (niche_min_d_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_w_mm INT CHECK (niche_max_w_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_h_mm INT CHECK (niche_max_h_mm > 0),
  ADD COLUMN IF NOT EXISTS niche_max_d_mm INT CHECK (niche_max_d_mm > 0);

COMMENT ON COLUMN appliance_models.niche_min_w_mm IS '빌트인 장 안쪽 치수(니치) 폭 — 제조사 권장 공간 · 설치 공간. 한 값이면 여기만, 범위면 최소';
COMMENT ON COLUMN appliance_models.niche_min_h_mm IS '니치 높이 (최소 또는 한 값)';
COMMENT ON COLUMN appliance_models.niche_min_d_mm IS '니치 깊이 (최소 또는 한 값)';
COMMENT ON COLUMN appliance_models.niche_max_w_mm IS '니치 폭 최대 — 제조사가 범위로 줄 때만';
COMMENT ON COLUMN appliance_models.niche_max_h_mm IS '니치 높이 최대 — 범위일 때만';
COMMENT ON COLUMN appliance_models.niche_max_d_mm IS '니치 깊이 최대 — 범위일 때만';

-- 가져오기 함수 — appliance-models-catalog.sql 과 같고 니치 칸만 더했다.
-- 니치도 설치 여유처럼 기존 값 우선 (관리 화면에서 사장님이 고친 값을 덮지 않는다).
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
        niche_min_w_mm, niche_min_h_mm, niche_min_d_mm, niche_max_w_mm, niche_max_h_mm, niche_max_d_mm,
        verified, source_url, notes, collected_at
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        (r->>'width_mm')::INT, (r->>'depth_mm')::INT, (r->>'height_mm')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        NULLIF(r->>'niche_min_w_mm', '')::INT, NULLIF(r->>'niche_min_h_mm', '')::INT, NULLIF(r->>'niche_min_d_mm', '')::INT,
        NULLIF(r->>'niche_max_w_mm', '')::INT, NULLIF(r->>'niche_max_h_mm', '')::INT, NULLIF(r->>'niche_max_d_mm', '')::INT,
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', r->>'notes', NOW()
      );
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_models SET
        model_name     = COALESCE(r->>'model_name', model_name),
        model_codes    = ARRAY(SELECT DISTINCT unnest(model_codes || codes)),
        width_mm       = (r->>'width_mm')::INT,
        depth_mm       = (r->>'depth_mm')::INT,
        height_mm      = (r->>'height_mm')::INT,
        capacity_l     = COALESCE(NULLIF(r->>'capacity_l', '')::INT, capacity_l),
        subtype        = COALESCE(r->>'subtype', subtype),
        line           = COALESCE(r->>'line', line),
        install_type   = COALESCE(r->>'install_type', install_type),
        side_gap_mm    = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT),
        top_gap_mm     = COALESCE(top_gap_mm,  NULLIF(r->>'top_gap_mm', '')::INT),
        back_gap_mm    = COALESCE(back_gap_mm, NULLIF(r->>'back_gap_mm', '')::INT),
        niche_min_w_mm = COALESCE(niche_min_w_mm, NULLIF(r->>'niche_min_w_mm', '')::INT),
        niche_min_h_mm = COALESCE(niche_min_h_mm, NULLIF(r->>'niche_min_h_mm', '')::INT),
        niche_min_d_mm = COALESCE(niche_min_d_mm, NULLIF(r->>'niche_min_d_mm', '')::INT),
        niche_max_w_mm = COALESCE(niche_max_w_mm, NULLIF(r->>'niche_max_w_mm', '')::INT),
        niche_max_h_mm = COALESCE(niche_max_h_mm, NULLIF(r->>'niche_max_h_mm', '')::INT),
        niche_max_d_mm = COALESCE(niche_max_d_mm, NULLIF(r->>'niche_max_d_mm', '')::INT),
        verified       = verified OR COALESCE((r->>'verified')::BOOLEAN, false),
        source_url     = COALESCE(r->>'source_url', source_url),
        discontinued   = false,
        collected_at   = NOW()
      WHERE id = hit;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip);
END;
$$;

REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;

-- 확인: SELECT brand, model_code, niche_min_w_mm, niche_min_h_mm, niche_min_d_mm FROM appliance_models WHERE niche_min_w_mm IS NOT NULL;
