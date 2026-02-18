-- =====================================================================
-- styles + materials 테이블: Supabase 연동 동적 프롬프트 시스템 v3
-- Supabase Dashboard > SQL Editor에서 실행
-- =====================================================================

-- =====================================================================
-- 1. styles 테이블 (ai-design.html 스타일 테마)
-- =====================================================================
CREATE TABLE IF NOT EXISTS styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- 'modern-minimal', 'scandinavian' 등
  name TEXT NOT NULL,                     -- '모던 미니멀'
  mood_prompt TEXT NOT NULL,              -- 영문 분위기 프롬프트
  door_color_name TEXT,                   -- 추천 도어 색상명
  door_color_hex TEXT,
  door_finish TEXT,                       -- 'matte' / 'high-gloss'
  countertop_prompt TEXT,                 -- 상판 질감 영문 프롬프트
  handle_prompt TEXT,                     -- 손잡이 영문 프롬프트
  accent_prompt TEXT,                     -- 악센트 소품 영문 프롬프트
  thumbnail_url TEXT,                     -- 스타일 대표 이미지 (Supabase Storage)
  sort_order INT DEFAULT 0,
  is_active BOOL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_styles_active ON styles(is_active, sort_order) WHERE is_active = TRUE;

-- RLS: 공개 읽기, 서비스 역할만 쓰기
ALTER TABLE styles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read styles" ON styles FOR SELECT USING (true);
CREATE POLICY "Service write styles" ON styles FOR ALL USING (auth.role() = 'service_role');

-- =====================================================================
-- 2. materials 테이블 (detaildesign.html 자재 옵션 — furniture_options 확장)
-- =====================================================================
CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                 -- 'door' / 'countertop' / 'handle' / 'body' / 'hood' / 'cooktop' / 'sink' / 'faucet'
  color_name TEXT NOT NULL,               -- '화이트', '네이비' 등
  color_name_en TEXT,                     -- 'white', 'navy'
  color_hex TEXT,                         -- '#f5f5f5'
  finish TEXT,                            -- 'matte' / 'glossy' / 'embossed'
  texture_prompt TEXT NOT NULL,           -- AI에게 전달할 상세 질감 영문 프롬프트
  thumbnail_url TEXT,                     -- 자재 미리보기 이미지 (Supabase Storage)
  applicable_to TEXT[] DEFAULT '{}',      -- 적용 가능 가구 타입 ['sink','wardrobe']
  sort_order INT DEFAULT 0,
  is_active BOOL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_materials_category_active ON materials(category, is_active) WHERE is_active = TRUE;

-- RLS: 공개 읽기, 서비스 역할만 쓰기
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read materials" ON materials FOR SELECT USING (true);
CREATE POLICY "Service write materials" ON materials FOR ALL USING (auth.role() = 'service_role');

-- =====================================================================
-- 3. styles 시드 데이터 (5개 스타일)
-- =====================================================================
INSERT INTO styles (slug, name, mood_prompt, door_color_name, door_color_hex, door_finish, countertop_prompt, handle_prompt, accent_prompt, sort_order) VALUES

('modern-minimal', '모던 미니멀',
 'clean contemporary minimalist aesthetic, sharp straight lines, flat surfaces, monochrome palette with subtle warm undertone, uncluttered and serene',
 '화이트', '#f5f5f5', 'matte',
 'pure white engineered stone countertop with subtle quartz flecks, polished surface, clean bullnose edge',
 'handleless push-to-open, flat surface, 3mm shadow gap between doors only',
 'matte black faucet, minimal white backsplash, no decorative items on countertop',
 1),

('scandinavian', '스칸디나비안',
 'warm minimalist Scandinavian aesthetic, clean lines, natural materials, cozy but uncluttered, hygge comfort with soft natural light',
 '화이트', '#f8fafc', 'matte',
 'light oak butcher block countertop, visible natural wood grain, matte oiled finish',
 'handleless push-to-open, flat surface, 3mm shadow gap between doors only',
 'matte black faucet, white subway tile backsplash, open shelf with ceramic pots and wooden cutting board',
 2),

('industrial', '인더스트리얼',
 'urban industrial aesthetic, raw and bold, dark tones with metal accents, exposed elements, vintage fixtures with modern function',
 '블랙', '#2c2c2c', 'matte',
 'dark charcoal concrete-look engineered stone countertop, subtle aggregate texture, matte honed finish',
 'matte black iron bar handle, square profile, 160mm center-to-center',
 'matte black industrial faucet, dark grout subway tile backsplash, exposed shelf bracket in black iron',
 3),

('classic', '클래식',
 'sophisticated traditional Korean-European blend, elegant crown molding, warm neutral palette, timeless refined details',
 '아이보리', '#f5ebe0', 'matte',
 'white marble-look engineered stone countertop with subtle grey veining, polished ogee edge',
 'antique brass cup pull handle, 96mm center-to-center, warm brushed finish',
 'warm brass faucet, cream ceramic backsplash with subtle pattern, glass-front upper cabinet doors',
 4),

('luxury', '럭셔리',
 'premium high-end luxury aesthetic, rich materials, gold and brass accents, marble and stone, opulent glamorous atmosphere',
 '네이비', '#1e3a5f', 'high-gloss',
 'Calacatta gold marble-look countertop, dramatic white with gold-toned veining, high-polish mirror finish',
 'brushed gold bar handle, slender rectangular profile, 224mm center-to-center',
 'brushed gold faucet, full-height marble backsplash, integrated LED under-cabinet lighting, crystal pendant over island',
 5);

-- =====================================================================
-- 4. materials 시드 데이터 (furniture_options에서 마이그레이션 + texture_prompt 강화)
-- =====================================================================

-- 도어 색상 (7개) — category: 'door'
INSERT INTO materials (category, color_name, color_name_en, color_hex, finish, texture_prompt, sort_order, applicable_to) VALUES
('door', '화이트', 'white', '#f5f5f5', 'matte',
 'pure white, smooth flat surface with zero wood grain, dead matte finish with no reflection, uniform solid color',
 1, '{sink,wardrobe,fridge}'),
('door', '그레이', 'gray', '#9e9e9e', 'matte',
 'neutral medium gray, smooth flat surface with zero wood grain, matte finish, uniform solid color without warm or cool cast',
 2, '{sink,wardrobe,fridge}'),
('door', '베이지', 'beige', '#d4c4b0', 'matte',
 'warm beige with subtle sand undertone, smooth flat surface with zero wood grain, soft matte finish, uniform solid color',
 3, '{sink,wardrobe,fridge}'),
('door', '월넛', 'walnut', '#5d4037', 'matte',
 'dark walnut wood grain laminate, realistic horizontal wood grain pattern, rich brown tones, matte natural wood finish',
 4, '{sink,wardrobe}'),
('door', '오크', 'oak', '#c4a35a', 'matte',
 'natural light oak wood grain laminate, visible straight grain pattern, warm honey tones, matte oiled wood finish',
 5, '{sink,wardrobe}'),
('door', '네이비', 'navy', '#1a237e', 'matte',
 'deep navy blue, smooth flat surface with zero wood grain, dead matte finish with no reflection, rich saturated color',
 6, '{sink}'),
('door', '블랙', 'black', '#2c2c2c', 'matte',
 'matte black, smooth flat surface with zero wood grain, dead matte finish absorbing light, deep solid black',
 7, '{sink,wardrobe,fridge}');

-- 도어 마감 오버라이드 (3개) — category: 'door_finish'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order, applicable_to) VALUES
('door_finish', '무광', 'matte',
 'dead matte finish with zero reflection, smooth flat surface, no sheen under any lighting angle',
 1, '{sink,wardrobe,fridge}'),
('door_finish', '유광', 'glossy',
 'high-gloss mirror-like finish with sharp reflections, smooth polished surface, visible light bounce',
 2, '{sink,wardrobe,fridge}'),
('door_finish', '엠보', 'embossed',
 'textured embossed surface with subtle tactile pattern, low sheen satin finish, visible micro-texture under raking light',
 3, '{sink,wardrobe}');

-- 손잡이 (4개) — category: 'handle'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order, applicable_to) VALUES
('handle', '찬넬 (목찬넬)', 'channel',
 'routed wooden channel handle at door top edge, 52mm front depth x 40mm underside grip, shadow gap underneath, same finish as door face',
 1, '{sink}'),
('handle', 'C찬넬', 'c-channel',
 'aluminum C-channel recessed handle at door top edge, anodized silver finish, slim integrated profile creating shadow line',
 2, '{sink}'),
('handle', '스마트바', 'smartbar',
 'aluminum smart bar handle, slim rectangular cross-section, matte silver anodized finish, 128mm center-to-center mounting',
 3, '{sink,wardrobe}'),
('handle', '푸쉬 도어', 'push-open',
 'handleless push-to-open mechanism, completely flat door surface, no visible hardware, 3mm shadow gap between doors',
 4, '{sink,wardrobe}');

-- 싱크볼 (3개) — category: 'sink'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order) VALUES
('sink', '사각볼 850', 'square-850',
 'stainless steel rectangular undermount sink bowl 850mm wide, brushed satin finish, sharp square corners, single deep basin',
 1),
('sink', '사각볼 800', 'square-800',
 'stainless steel rectangular undermount sink bowl 800mm wide, brushed satin finish, sharp square corners, single deep basin',
 2),
('sink', '라운드볼', 'round',
 'stainless steel round undermount sink bowl 480mm diameter, brushed satin finish, smooth curved basin',
 3);

-- 수전 (3개) — category: 'faucet'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order) VALUES
('faucet', '거위목 수전', 'gooseneck',
 'tall gooseneck kitchen faucet, arched spout, chrome or matte black finish, single lever pull-down sprayer',
 1),
('faucet', 'ㄱ자 수전', 'l-shaped',
 'L-shaped angular kitchen faucet, 90-degree bent spout, chrome finish, single lever control',
 2),
('faucet', '일반 수전', 'standard',
 'standard straight kitchen faucet, simple upright spout, chrome finish, single lever control',
 3);

-- 후드 (3개) — category: 'hood'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order) VALUES
('hood', '히든 후드', 'hidden',
 'built-in concealed range hood hidden inside upper cabinet, NOT visible externally, cabinet door covers the hood completely',
 1),
('hood', '침니 후드', 'chimney',
 'wall-mounted chimney range hood, stainless steel canopy with vertical duct cover to ceiling, modern pyramid shape',
 2),
('hood', '슬라이딩 후드', 'sliding',
 'slide-out range hood under upper cabinet, thin profile, pull-out visor panel, stainless steel or matching cabinet finish',
 3);

-- 쿡탑 (3개) — category: 'cooktop'
INSERT INTO materials (category, color_name, color_name_en, texture_prompt, sort_order) VALUES
('cooktop', '인덕션', 'induction',
 'flush-mount induction cooktop with smooth black ceramic glass surface, white printed zone markings, touch controls at front edge',
 1),
('cooktop', '가스쿡탑', 'gas',
 'built-in gas cooktop with cast iron grates, stainless steel surface, 3 or 4 burners with metal knob controls',
 2),
('cooktop', '하이라이트', 'highlight',
 'electric radiant highlight cooktop with smooth black ceramic glass surface, glowing red heating zones, touch controls',
 3);

-- 상판 (4개) — category: 'countertop'
INSERT INTO materials (category, color_name, color_name_en, color_hex, texture_prompt, sort_order) VALUES
('countertop', '스노우', 'snow white', '#FAFAFA',
 'pure white engineered quartz countertop with subtle micro-flecks, polished surface, clean bullnose edge profile, 20mm overhang',
 1),
('countertop', '마블화이트', 'marble white', '#F0F0F0',
 'white marble-look engineered stone countertop with delicate grey veining, polished surface, natural stone appearance, bullnose edge',
 2),
('countertop', '그레이마블', 'gray marble', '#B0B0B0',
 'gray marble-look engineered stone countertop with dramatic white and charcoal veining, polished surface, bullnose edge',
 3),
('countertop', '차콜', 'charcoal', '#404040',
 'dark charcoal engineered stone countertop, near-black with subtle aggregate texture, matte honed finish, bullnose edge',
 4);
