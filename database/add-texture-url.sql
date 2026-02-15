-- ═══════════════════════════════════════════════════════════════
-- furniture_options: texture_url 컬럼 추가
-- 텍스처 이미지 URL (Canvas createPattern 렌더링용)
-- Supabase Dashboard > SQL Editor에서 실행
-- ═══════════════════════════════════════════════════════════════

-- 1. texture_url 컬럼 추가
ALTER TABLE furniture_options
ADD COLUMN IF NOT EXISTS texture_url TEXT;

COMMENT ON COLUMN furniture_options.texture_url IS
  'Tileable texture image URL for Canvas createPattern() rendering. Stored in Supabase Storage option-images/textures/';

-- 2. 텍스처 URL 업데이트 (Supabase Storage에 이미지 업로드 후 URL 수정)
-- 도어 색상 텍스처
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/door_white_matte.jpg'
--   WHERE category = 'door_color' AND name_en = 'white';
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/door_walnut.jpg'
--   WHERE category = 'door_color' AND name_en = 'walnut';
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/door_oak.jpg'
--   WHERE category = 'door_color' AND name_en = 'oak';

-- 상판 텍스처
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/countertop_snow.jpg'
--   WHERE category = 'countertop' AND name_en = 'snow white';
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/countertop_marble_white.jpg'
--   WHERE category = 'countertop' AND name_en = 'marble white';
-- UPDATE furniture_options SET texture_url = 'https://<project>.supabase.co/storage/v1/object/public/option-images/textures/countertop_gray_marble.jpg'
--   WHERE category = 'countertop' AND name_en = 'gray marble';
