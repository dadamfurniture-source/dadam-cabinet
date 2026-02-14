-- ═══════════════════════════════════════════════════════════════
-- furniture_options 테이블: 세부 옵션 RAG 카탈로그
-- Supabase Dashboard > SQL Editor에서 실행
-- ═══════════════════════════════════════════════════════════════

-- 1. 테이블 생성
CREATE TABLE furniture_options (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,           -- 'door_color', 'door_finish', 'handle', 'sink', 'faucet', 'hood', 'cooktop', 'countertop'
  subcategory TEXT,                 -- 'upper', 'lower', 'wardrobe' 등
  name_ko TEXT NOT NULL,            -- '화이트', '무광', '찬넬 (목찬넬)'
  name_en TEXT,                     -- 'white', 'matte', 'channel handle'
  color_hex TEXT,                   -- '#f5f5f5'
  image_storage_path TEXT,          -- 'option-images/door_color/white_matte.jpg'
  image_public_url TEXT,            -- 프리컴퓨트된 공개 URL
  manufacturer TEXT,                -- 향후: 'Hanssem', 'LG'
  product_code TEXT,                -- 향후: 'YPG-001'
  specs JSONB DEFAULT '{}',         -- { width: 850, series: "Prestige" }
  prompt_description TEXT,          -- 'pure white matte finish MDF panel'
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  applicable_to TEXT[] DEFAULT '{}', -- '{sink,wardrobe,fridge}'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 인덱스
CREATE INDEX idx_fo_category_active ON furniture_options(category, is_active) WHERE is_active = TRUE;

-- 3. RLS: 공개 읽기, 서비스 역할만 쓰기
ALTER TABLE furniture_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON furniture_options FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Service write" ON furniture_options FOR ALL USING (auth.role() = 'service_role');

-- 4. RPC 함수
CREATE OR REPLACE FUNCTION get_furniture_options(
  p_categories TEXT[] DEFAULT NULL,
  p_applicable_to TEXT DEFAULT NULL
)
RETURNS SETOF furniture_options
LANGUAGE SQL STABLE AS $$
  SELECT * FROM furniture_options
  WHERE is_active = TRUE
    AND (p_categories IS NULL OR category = ANY(p_categories))
    AND (p_applicable_to IS NULL OR p_applicable_to = ANY(applicable_to))
  ORDER BY category, sort_order;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 시드 데이터
-- ═══════════════════════════════════════════════════════════════

-- 도어 색상 (7개)
INSERT INTO furniture_options (category, name_ko, name_en, color_hex, prompt_description, is_default, sort_order, applicable_to) VALUES
('door_color', '화이트', 'white', '#f5f5f5', 'pure white', TRUE, 1, '{sink,wardrobe,fridge}'),
('door_color', '그레이', 'gray', '#9e9e9e', 'gray', FALSE, 2, '{sink,wardrobe,fridge}'),
('door_color', '베이지', 'beige', '#d4c4b0', 'warm beige', FALSE, 3, '{sink,wardrobe,fridge}'),
('door_color', '월넛', 'walnut', '#5d4037', 'dark walnut wood', FALSE, 4, '{sink,wardrobe}'),
('door_color', '오크', 'oak', '#c4a35a', 'natural oak wood', FALSE, 5, '{sink,wardrobe}'),
('door_color', '네이비', 'navy', '#1a237e', 'navy blue', FALSE, 6, '{sink}'),
('door_color', '블랙', 'black', '#2c2c2c', 'matte black', FALSE, 7, '{sink,wardrobe,fridge}');

-- 도어 마감 (3개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, is_default, sort_order, applicable_to) VALUES
('door_finish', '무광', 'matte', 'matte finish', TRUE, 1, '{sink,wardrobe,fridge}'),
('door_finish', '유광', 'glossy', 'glossy finish', FALSE, 2, '{sink,wardrobe,fridge}'),
('door_finish', '엠보', 'embossed', 'embossed texture', FALSE, 3, '{sink,wardrobe}');

-- 손잡이 (4개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, is_default, sort_order, applicable_to) VALUES
('handle', '찬넬 (목찬넬)', 'channel', 'wooden channel handle', TRUE, 1, '{sink}'),
('handle', 'C찬넬', 'c-channel', 'C-channel recessed handle', FALSE, 2, '{sink}'),
('handle', '스마트바', 'smartbar', 'aluminum smart bar handle', FALSE, 3, '{sink,wardrobe}'),
('handle', '푸쉬 도어', 'push-open', 'handleless push-to-open doors', FALSE, 4, '{sink,wardrobe}');

-- 싱크볼 (3개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, specs, is_default, sort_order) VALUES
('sink', '사각볼 850', 'square-850', 'stainless steel rectangular sink bowl 850mm', '{"width":850}', TRUE, 1),
('sink', '사각볼 800', 'square-800', 'stainless steel rectangular sink bowl 800mm', '{"width":800}', FALSE, 2),
('sink', '라운드볼', 'round', 'stainless steel round sink bowl', '{"width":480}', FALSE, 3);

-- 수전 (3개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, is_default, sort_order) VALUES
('faucet', '거위목 수전', 'gooseneck', 'gooseneck faucet', TRUE, 1),
('faucet', 'ㄱ자 수전', 'l-shaped', 'L-shaped faucet', FALSE, 2),
('faucet', '일반 수전', 'standard', 'standard faucet', FALSE, 3);

-- 후드 (3개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, is_default, sort_order) VALUES
('hood', '히든 후드', 'hidden', 'built-in concealed range hood (hidden inside upper cabinet, NOT visible externally)', TRUE, 1),
('hood', '침니 후드', 'chimney', 'chimney range hood', FALSE, 2),
('hood', '슬라이딩 후드', 'sliding', 'slide-out range hood', FALSE, 3);

-- 쿡탑 (3개)
INSERT INTO furniture_options (category, name_ko, name_en, prompt_description, is_default, sort_order) VALUES
('cooktop', '인덕션', 'induction', 'induction cooktop with smooth black glass surface', TRUE, 1),
('cooktop', '가스쿡탑', 'gas', 'gas cooktop with burners', FALSE, 2),
('cooktop', '하이라이트', 'highlight', 'electric highlight cooktop', FALSE, 3);

-- 상판 (4개)
INSERT INTO furniture_options (category, name_ko, name_en, color_hex, prompt_description, is_default, sort_order) VALUES
('countertop', '스노우', 'snow white', '#FAFAFA', 'snow white engineered stone countertop', TRUE, 1),
('countertop', '마블화이트', 'marble white', '#F0F0F0', 'white marble countertop', FALSE, 2),
('countertop', '그레이마블', 'gray marble', '#B0B0B0', 'gray marble countertop', FALSE, 3),
('countertop', '차콜', 'charcoal', '#404040', 'charcoal dark countertop', FALSE, 4);

-- ═══════════════════════════════════════════════════════════════
-- Storage 버킷 설정 (Supabase Dashboard > Storage에서 생성)
-- 버킷명: option-images (public)
-- 구조: option-images/{category}/{name}.jpg
-- 제한: 2MB, image/jpeg, image/png, image/webp
-- ═══════════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('option-images', 'option-images', true, 2097152, ARRAY['image/jpeg','image/png','image/webp']);
