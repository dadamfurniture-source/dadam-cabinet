-- ============================================================
-- 냉장고 모델 대표 사진 칸 (2026-10-20 사장님 — "각 모델의 대표 사진 찾아줘")
--
--   제조사 공식 사이트의 대표 이미지 **주소만** 저장한다 (파일을 복사 · 재호스팅하지 않는다).
--   수집기(scripts/fridge-catalog)가 공식 목록 · 상품 페이지에서 꺼낸 주소를 import 함수가 넣는다.
--   다시 가져오면 새 주소로 바뀐다 (제조사가 사진을 바꾸면 따라간다). 비어 있으면 기존 값을 둔다.
--
-- 적용: Supabase SQL 편집기에서 이 파일 → 그 뒤 수집기가 만든 import SQL.
-- 여러 번 실행해도 안전하다. 먼저 appliance-models-catalog.sql · appliance-models-niche.sql 이 실행돼 있어야 한다.
-- ============================================================

ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS image_url TEXT CHECK (image_url IS NULL OR image_url ~ '^https://');
COMMENT ON COLUMN appliance_models.image_url IS '제조사 공식 대표 이미지 주소 (https, 주소만 저장 — 재호스팅 안 함)';

-- 가져오기 함수 — appliance-models-niche.sql 과 같고 image_url 만 더했다.
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
        verified, source_url, notes, collected_at, image_url
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        (r->>'width_mm')::INT, (r->>'depth_mm')::INT, (r->>'height_mm')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        NULLIF(r->>'niche_min_w_mm', '')::INT, NULLIF(r->>'niche_min_h_mm', '')::INT, NULLIF(r->>'niche_min_d_mm', '')::INT,
        NULLIF(r->>'niche_max_w_mm', '')::INT, NULLIF(r->>'niche_max_h_mm', '')::INT, NULLIF(r->>'niche_max_d_mm', '')::INT,
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', r->>'notes', NOW(), NULLIF(r->>'image_url', '')
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
        image_url      = COALESCE(NULLIF(r->>'image_url', ''), image_url),
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


-- 확인: SELECT brand, count(image_url) FROM appliance_models WHERE category = 'refrigerator' GROUP BY 1;
