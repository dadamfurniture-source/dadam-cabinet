-- ============================================================
-- 가전 모델 제품 사진 — 칸 · 버킷 · 가져오기 함수 (2026-10-20 사장님 결정)
--
--   "모델 사진 = 선택지 (b)": 확인(승인)한 모델의 제조사 제품 사진을 우리 Storage 로 복사해 경로를 저장하고,
--   연출컷(플래너 모드) 생성 때 그 냉장고의 참고 이미지로 넣는다.
--   ※ 제조사 사진 사용 약관 확인은 사장님 몫이다.
--
-- 칸:
--   image_source_url   제조사 원본 주소 — 수집기(scripts/fridge-catalog)가 넣는다. 사람이 보는 출처이자 복사할 주소.
--   image_path         우리 버킷 `appliance-images` 안의 경로 — 관리자 화면 「사진 가져오기」(워커 관리자 경로)가 채운다.
--                      이 칸이 있는 모델만 생성 때 참고 이미지로 쓴다. 남의 서버 링크로 생성하지 않는다.
--   image_approved_at  관리자가 사진을 가져온(승인한) 때. 표에 따로 승인 개념이 없어 「가져오기 = 승인」 으로 본다.
--   image_approved_by  가져온 관리자 (auth.users)
--
-- 버킷 `appliance-images` (공개 읽기) — {모델 id}/photo.{jpg|png|webp}
--   쓰기는 워커(service_role, RLS 우회)와 관리자(is_admin())만.
--
-- 적용 순서: appliance-models-schema.sql → appliance-models-catalog.sql → appliance-models-niche.sql → **이 파일**
--   → (그 뒤) 수집기가 만든 import SQL (image_source_url 이 함께 들어간다)
-- 여러 번 실행해도 안전하다 (IF NOT EXISTS · CREATE OR REPLACE · DROP … IF EXISTS 뒤 재생성).
-- 실행 전에도 코드가 깨지지 않는다: 워커·관리 화면은 칸·버킷이 없으면 지금처럼(글만) 동작한다.
-- ============================================================

ALTER TABLE appliance_models
  ADD COLUMN IF NOT EXISTS image_source_url  TEXT,
  ADD COLUMN IF NOT EXISTS image_path        TEXT,
  ADD COLUMN IF NOT EXISTS image_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS image_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 원본 주소는 http(s) 만. 경로는 버킷 안 상대 경로 ({id}/photo.ext) — 외부 링크를 넣지 못하게.
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_image_source_url_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_image_source_url_chk CHECK (
  image_source_url IS NULL OR image_source_url ~ '^https?://'
);
ALTER TABLE appliance_models DROP CONSTRAINT IF EXISTS appliance_models_image_path_chk;
ALTER TABLE appliance_models ADD CONSTRAINT appliance_models_image_path_chk CHECK (
  image_path IS NULL OR (image_path !~ '^[a-z]+:' AND image_path !~ '^/' AND image_path !~ '\.\.')
);

COMMENT ON COLUMN appliance_models.image_source_url  IS '제조사 제품 사진 원본 주소 (수집기). 생성에는 직접 쓰지 않는다 — 관리자가 가져와야 image_path 가 생긴다';
COMMENT ON COLUMN appliance_models.image_path        IS '버킷 appliance-images 안 경로 ({id}/photo.ext). 있으면 연출컷 생성 때 이 냉장고의 참고 이미지';
COMMENT ON COLUMN appliance_models.image_approved_at IS '관리자가 사진을 가져온(승인한) 때';
COMMENT ON COLUMN appliance_models.image_approved_by IS '사진을 가져온 관리자';

-- 워커가 모델 코드로 사진을 찾는다 (model_codes GIN 은 catalog SQL 에 있다)
CREATE INDEX IF NOT EXISTS idx_appliance_image_path ON appliance_models(image_path) WHERE image_path IS NOT NULL;


-- ── Storage 버킷 `appliance-images` — 공개 읽기, 쓰기는 관리자 · service_role ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('appliance-images', 'appliance-images', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "appliance_images_obj_read"   ON storage.objects;
DROP POLICY IF EXISTS "appliance_images_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "appliance_images_obj_update" ON storage.objects;
DROP POLICY IF EXISTS "appliance_images_obj_delete" ON storage.objects;

CREATE POLICY "appliance_images_obj_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'appliance-images');

CREATE POLICY "appliance_images_obj_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'appliance-images' AND public.is_admin());

CREATE POLICY "appliance_images_obj_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'appliance-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'appliance-images' AND public.is_admin());

CREATE POLICY "appliance_images_obj_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'appliance-images' AND public.is_admin());


-- ── 가져오기 함수 — appliance-models-niche.sql 과 같고 image_source_url 만 더했다 ──
-- 원본 주소는 수집값으로 갱신(없으면 기존 유지). image_path · 승인 칸은 건드리지 않는다 — 관리자가 가져온 사진을 덮지 않는다.
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
        verified, source_url, image_source_url, notes, collected_at
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        (r->>'width_mm')::INT, (r->>'depth_mm')::INT, (r->>'height_mm')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        NULLIF(r->>'niche_min_w_mm', '')::INT, NULLIF(r->>'niche_min_h_mm', '')::INT, NULLIF(r->>'niche_min_d_mm', '')::INT,
        NULLIF(r->>'niche_max_w_mm', '')::INT, NULLIF(r->>'niche_max_h_mm', '')::INT, NULLIF(r->>'niche_max_d_mm', '')::INT,
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', NULLIF(r->>'image_source_url', ''), r->>'notes', NOW()
      );
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_models SET
        model_name       = COALESCE(r->>'model_name', model_name),
        model_codes      = ARRAY(SELECT DISTINCT unnest(model_codes || codes)),
        width_mm         = (r->>'width_mm')::INT,
        depth_mm         = (r->>'depth_mm')::INT,
        height_mm        = (r->>'height_mm')::INT,
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
--   SELECT brand, count(*) FILTER (WHERE image_source_url IS NOT NULL) AS src, count(*) FILTER (WHERE image_path IS NOT NULL) AS copied
--     FROM appliance_models WHERE category = 'refrigerator' GROUP BY 1 ORDER BY 1;
