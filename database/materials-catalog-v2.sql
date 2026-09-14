-- ═══════════════════════════════════════════════════════════════
-- materials 카탈로그 v2 — 마감 코드 정본 (C0, 계획서 §4.3 / §5 C0)
-- Supabase Dashboard > SQL Editor 에서 실행. 두 번 실행해도 안전(멱등).
--
-- 적용 방법
--   1. database/styles-materials-schema.sql 이 먼저 적용돼 있어야 한다 (materials 표).
--   2. 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
--   3. 확인: SELECT code, category, slot, tone FROM materials WHERE code IS NOT NULL ORDER BY slot, sort;
--      → 도어 매트릭스 70 + 상판 4 + 기존 도어색 7 + 기존 마감 3 = 84 행에 code 가 채워진다.
--   4. 프런트는 이 파일을 적용하기 전에도 동작한다 (FurnitureOptionCatalog 내장 폴백 +
--      bom-finish-color.js 내장 표). 적용 후에는 get_materials_catalog() / materials 를 우선 읽는다.
--
-- 불변조건 (계획서 §3 I6): 값은 더하기만. 기존 행·코드는 이름을 바꾸거나 지우지 않는다.
--   - ALTER 는 전부 ADD COLUMN IF NOT EXISTS
--   - INSERT 는 전부 WHERE NOT EXISTS (code) 로 보호
--   - UPDATE 는 기존 행의 비어 있는(code IS NULL) 컬럼만 채운다
--
-- 코드 체계 (materials.code — 정본)
--   도어 마감×색  {FINISH}-{COLOR}[-{M|G}]   예) PET-OAK-M, MFB-WHT, PNT-BLK-G
--     FINISH: PET(PET 필름) MFB(멜라민) LPM(LPM) PNT(도장) VNR(무늬목)
--     COLOR : CRM OAK WNT GRP WHT BLK SAG (bom-finish-color.js 7색) + GRY BGE NVY (FurnitureOptionCatalog 3색)
--     접미사: tone=matte → -M, gloss → -G, single(단톤 자재) → 없음
--     → js/detaildesign/bom-finish-color.js getFinishColorCode() 출력과 글자 단위로 같다.
--   상판           TOP-{XXX}                 TOP-SNW 스노우, TOP-MWH 마블화이트, TOP-GMB 그레이마블, TOP-CHC 차콜
--   기존 도어색 행  {COLOR}                   WHT GRY BGE WNT OAK NVY BLK (색만, 마감 미정)
--   기존 마감 행    TONE-{M|G|E}              무광/유광/엠보 (톤만, 기판 미정)
--
-- 카테고리
--   'door_material' : 마감×색 매트릭스 (새 카테고리). 기존 'door'(색만) / 'door_finish'(톤만) 행은 그대로 둔다.
--                     FurnitureOptionCatalog 의 door_color / door_finish 셀렉트가 70 행으로 불어나지 않게 하려는 것.
--   'countertop'    : 기존 4 행에 code 를 채우고, 없으면 삽입.
--
-- PBR 기본값 (tone 기준): matte r=0.75 m=0 cc=0 / gloss r=0.25 m=0 cc=0.6 / single r=0.6 m=0 cc=0
-- price_key : bom-finish-color.js FINISH_BASE_PRICE 키 (PET-M, PET-G, MFB, LPM, PNT-M, PNT-G, VNR)
-- vendor_code: 발주 코드가 따로 있을 때 채운다 [확인 필요 — 계획서 §9-4]
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. 컬럼 추가 (전부 IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE materials ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS finish_code TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS color_code TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS tone TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS slot TEXT[];
ALTER TABLE materials ADD COLUMN IF NOT EXISTS roughness NUMERIC;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS metalness NUMERIC;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS clearcoat NUMERIC;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS texture_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS normal_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS tile_mm INT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS grain TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS price_key TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS vendor_code TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sort INT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN materials.code IS '마감 코드 정본. 도어 {FINISH}-{COLOR}[-{M|G}], 상판 TOP-{XXX}. 이름 변경 금지 (I6)';
COMMENT ON COLUMN materials.slot IS '적용 부위: door / drawer_front / body / top / handle / finishing / kick';
COMMENT ON COLUMN materials.price_key IS 'pricing_rules / FINISH_BASE_PRICE 연결 키. 가격 자체는 여기 두지 않는다';
COMMENT ON COLUMN materials.vendor_code IS '실제 발주(업체) 코드. code 와 다를 수 있다';

-- CHECK 제약 (이미 있으면 건너뜀)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_tone_check') THEN
    ALTER TABLE materials ADD CONSTRAINT materials_tone_check
      CHECK (tone IS NULL OR tone IN ('matte', 'gloss', 'single'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_grain_check') THEN
    ALTER TABLE materials ADD CONSTRAINT materials_grain_check
      CHECK (grain IS NULL OR grain IN ('none', 'h', 'v'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_slot_check') THEN
    ALTER TABLE materials ADD CONSTRAINT materials_slot_check
      CHECK (slot IS NULL OR slot <@ ARRAY['door','drawer_front','body','top','handle','finishing','kick']::TEXT[]);
  END IF;
END $$;

-- code 유일 (NULL 은 제외 — 기존 코드 없는 행은 그대로)
CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_code ON materials(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_materials_slot ON materials USING GIN (slot);

-- ─────────────────────────────────────────────────────────────
-- 2. 시드 — 도어 마감 × 색 매트릭스 (7 마감 × 10 색 = 70)
--    category 'door_material', slot {door, drawer_front}
--    WHERE NOT EXISTS (code) 라서 재실행 시 건너뛴다
-- ─────────────────────────────────────────────────────────────
INSERT INTO materials
  (category, slot, applicable_to, is_active, active,
   code, finish_code, color_code, tone, color_name, color_name_en, color_hex, finish,
   texture_prompt,
   roughness, metalness, clearcoat, grain, price_key, sort, sort_order)
SELECT
  'door_material', ARRAY['door','drawer_front']::TEXT[], ARRAY['sink','wardrobe','fridge']::TEXT[], TRUE, TRUE,
  v.code, v.finish_code, v.color_code, v.tone, v.color_name, v.color_name_en, v.color_hex, v.finish,
  v.texture_prompt,
  v.roughness, v.metalness, v.clearcoat, v.grain, v.price_key, v.sort, v.sort
FROM (VALUES
  ('PET-CRM-M', 'PET', 'CRM', 'matte', 'PET 매트 · 크림', 'pet-matte cream', '#f1ede3', 'pet-matte',
   'warm cream off-white, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 1),
  ('PET-OAK-M', 'PET', 'OAK', 'matte', 'PET 매트 · 오크', 'pet-matte oak', '#d1b089', 'pet-matte',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'v', 'PET-M', 2),
  ('PET-WNT-M', 'PET', 'WNT', 'matte', 'PET 매트 · 월넛', 'pet-matte walnut', '#8b6447', 'pet-matte',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'h', 'PET-M', 3),
  ('PET-GRP-M', 'PET', 'GRP', 'matte', 'PET 매트 · 그라파이트', 'pet-matte graphite', '#696a6b', 'pet-matte',
   'dark graphite gray, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 4),
  ('PET-WHT-M', 'PET', 'WHT', 'matte', 'PET 매트 · 화이트', 'pet-matte white', '#ffffff', 'pet-matte',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 5),
  ('PET-BLK-M', 'PET', 'BLK', 'matte', 'PET 매트 · 블랙', 'pet-matte black', '#1a1a1a', 'pet-matte',
   'deep solid black, smooth flat surface with zero wood grain, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 6),
  ('PET-SAG-M', 'PET', 'SAG', 'matte', 'PET 매트 · 세이지', 'pet-matte sage', '#b2bba5', 'pet-matte',
   'muted sage green, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 7),
  ('PET-GRY-M', 'PET', 'GRY', 'matte', 'PET 매트 · 그레이', 'pet-matte gray', '#9e9e9e', 'pet-matte',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 8),
  ('PET-BGE-M', 'PET', 'BGE', 'matte', 'PET 매트 · 베이지', 'pet-matte beige', '#d4c4b0', 'pet-matte',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 9),
  ('PET-NVY-M', 'PET', 'NVY', 'matte', 'PET 매트 · 네이비', 'pet-matte navy', '#1a237e', 'pet-matte',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, PET film laminated door face, dead matte finish with no reflection',
   0.75, 0, 0, 'none', 'PET-M', 10),
  ('PET-CRM-G', 'PET', 'CRM', 'gloss', 'PET 광택 · 크림', 'pet-gloss cream', '#f1ede3', 'pet-gloss',
   'warm cream off-white, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 11),
  ('PET-OAK-G', 'PET', 'OAK', 'gloss', 'PET 광택 · 오크', 'pet-gloss oak', '#d1b089', 'pet-gloss',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'v', 'PET-G', 12),
  ('PET-WNT-G', 'PET', 'WNT', 'gloss', 'PET 광택 · 월넛', 'pet-gloss walnut', '#8b6447', 'pet-gloss',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'h', 'PET-G', 13),
  ('PET-GRP-G', 'PET', 'GRP', 'gloss', 'PET 광택 · 그라파이트', 'pet-gloss graphite', '#696a6b', 'pet-gloss',
   'dark graphite gray, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 14),
  ('PET-WHT-G', 'PET', 'WHT', 'gloss', 'PET 광택 · 화이트', 'pet-gloss white', '#ffffff', 'pet-gloss',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 15),
  ('PET-BLK-G', 'PET', 'BLK', 'gloss', 'PET 광택 · 블랙', 'pet-gloss black', '#1a1a1a', 'pet-gloss',
   'deep solid black, smooth flat surface with zero wood grain, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 16),
  ('PET-SAG-G', 'PET', 'SAG', 'gloss', 'PET 광택 · 세이지', 'pet-gloss sage', '#b2bba5', 'pet-gloss',
   'muted sage green, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 17),
  ('PET-GRY-G', 'PET', 'GRY', 'gloss', 'PET 광택 · 그레이', 'pet-gloss gray', '#9e9e9e', 'pet-gloss',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 18),
  ('PET-BGE-G', 'PET', 'BGE', 'gloss', 'PET 광택 · 베이지', 'pet-gloss beige', '#d4c4b0', 'pet-gloss',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 19),
  ('PET-NVY-G', 'PET', 'NVY', 'gloss', 'PET 광택 · 네이비', 'pet-gloss navy', '#1a237e', 'pet-gloss',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, PET film laminated door face, high-gloss mirror-like finish with sharp reflections',
   0.25, 0, 0.6, 'none', 'PET-G', 20),
  ('MFB-CRM', 'MFB', 'CRM', 'single', 'MFB 멜라민 · 크림', 'mfb cream', '#f1ede3', 'mfb',
   'warm cream off-white, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 21),
  ('MFB-OAK', 'MFB', 'OAK', 'single', 'MFB 멜라민 · 오크', 'mfb oak', '#d1b089', 'mfb',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'v', 'MFB', 22),
  ('MFB-WNT', 'MFB', 'WNT', 'single', 'MFB 멜라민 · 월넛', 'mfb walnut', '#8b6447', 'mfb',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'h', 'MFB', 23),
  ('MFB-GRP', 'MFB', 'GRP', 'single', 'MFB 멜라민 · 그라파이트', 'mfb graphite', '#696a6b', 'mfb',
   'dark graphite gray, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 24),
  ('MFB-WHT', 'MFB', 'WHT', 'single', 'MFB 멜라민 · 화이트', 'mfb white', '#ffffff', 'mfb',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 25),
  ('MFB-BLK', 'MFB', 'BLK', 'single', 'MFB 멜라민 · 블랙', 'mfb black', '#1a1a1a', 'mfb',
   'deep solid black, smooth flat surface with zero wood grain, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 26),
  ('MFB-SAG', 'MFB', 'SAG', 'single', 'MFB 멜라민 · 세이지', 'mfb sage', '#b2bba5', 'mfb',
   'muted sage green, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 27),
  ('MFB-GRY', 'MFB', 'GRY', 'single', 'MFB 멜라민 · 그레이', 'mfb gray', '#9e9e9e', 'mfb',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 28),
  ('MFB-BGE', 'MFB', 'BGE', 'single', 'MFB 멜라민 · 베이지', 'mfb beige', '#d4c4b0', 'mfb',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 29),
  ('MFB-NVY', 'MFB', 'NVY', 'single', 'MFB 멜라민 · 네이비', 'mfb navy', '#1a237e', 'mfb',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, melamine faced board door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'MFB', 30),
  ('LPM-CRM', 'LPM', 'CRM', 'single', 'LPM 라미네이트 · 크림', 'lpm cream', '#f1ede3', 'lpm',
   'warm cream off-white, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 31),
  ('LPM-OAK', 'LPM', 'OAK', 'single', 'LPM 라미네이트 · 오크', 'lpm oak', '#d1b089', 'lpm',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'v', 'LPM', 32),
  ('LPM-WNT', 'LPM', 'WNT', 'single', 'LPM 라미네이트 · 월넛', 'lpm walnut', '#8b6447', 'lpm',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'h', 'LPM', 33),
  ('LPM-GRP', 'LPM', 'GRP', 'single', 'LPM 라미네이트 · 그라파이트', 'lpm graphite', '#696a6b', 'lpm',
   'dark graphite gray, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 34),
  ('LPM-WHT', 'LPM', 'WHT', 'single', 'LPM 라미네이트 · 화이트', 'lpm white', '#ffffff', 'lpm',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 35),
  ('LPM-BLK', 'LPM', 'BLK', 'single', 'LPM 라미네이트 · 블랙', 'lpm black', '#1a1a1a', 'lpm',
   'deep solid black, smooth flat surface with zero wood grain, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 36),
  ('LPM-SAG', 'LPM', 'SAG', 'single', 'LPM 라미네이트 · 세이지', 'lpm sage', '#b2bba5', 'lpm',
   'muted sage green, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 37),
  ('LPM-GRY', 'LPM', 'GRY', 'single', 'LPM 라미네이트 · 그레이', 'lpm gray', '#9e9e9e', 'lpm',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 38),
  ('LPM-BGE', 'LPM', 'BGE', 'single', 'LPM 라미네이트 · 베이지', 'lpm beige', '#d4c4b0', 'lpm',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 39),
  ('LPM-NVY', 'LPM', 'NVY', 'single', 'LPM 라미네이트 · 네이비', 'lpm navy', '#1a237e', 'lpm',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, low-pressure laminate door, low-sheen satin finish',
   0.6, 0, 0, 'none', 'LPM', 40),
  ('PNT-CRM-M', 'PNT', 'CRM', 'matte', '도장 무광 · 크림', 'paint-matte cream', '#f1ede3', 'paint-matte',
   'warm cream off-white, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 41),
  ('PNT-OAK-M', 'PNT', 'OAK', 'matte', '도장 무광 · 오크', 'paint-matte oak', '#d1b089', 'paint-matte',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'v', 'PNT-M', 42),
  ('PNT-WNT-M', 'PNT', 'WNT', 'matte', '도장 무광 · 월넛', 'paint-matte walnut', '#8b6447', 'paint-matte',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'h', 'PNT-M', 43),
  ('PNT-GRP-M', 'PNT', 'GRP', 'matte', '도장 무광 · 그라파이트', 'paint-matte graphite', '#696a6b', 'paint-matte',
   'dark graphite gray, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 44),
  ('PNT-WHT-M', 'PNT', 'WHT', 'matte', '도장 무광 · 화이트', 'paint-matte white', '#ffffff', 'paint-matte',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 45),
  ('PNT-BLK-M', 'PNT', 'BLK', 'matte', '도장 무광 · 블랙', 'paint-matte black', '#1a1a1a', 'paint-matte',
   'deep solid black, smooth flat surface with zero wood grain, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 46),
  ('PNT-SAG-M', 'PNT', 'SAG', 'matte', '도장 무광 · 세이지', 'paint-matte sage', '#b2bba5', 'paint-matte',
   'muted sage green, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 47),
  ('PNT-GRY-M', 'PNT', 'GRY', 'matte', '도장 무광 · 그레이', 'paint-matte gray', '#9e9e9e', 'paint-matte',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 48),
  ('PNT-BGE-M', 'PNT', 'BGE', 'matte', '도장 무광 · 베이지', 'paint-matte beige', '#d4c4b0', 'paint-matte',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 49),
  ('PNT-NVY-M', 'PNT', 'NVY', 'matte', '도장 무광 · 네이비', 'paint-matte navy', '#1a237e', 'paint-matte',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, painted lacquer door, dead matte finish',
   0.75, 0, 0, 'none', 'PNT-M', 50),
  ('PNT-CRM-G', 'PNT', 'CRM', 'gloss', '도장 유광 · 크림', 'paint-gloss cream', '#f1ede3', 'paint-gloss',
   'warm cream off-white, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 51),
  ('PNT-OAK-G', 'PNT', 'OAK', 'gloss', '도장 유광 · 오크', 'paint-gloss oak', '#d1b089', 'paint-gloss',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'v', 'PNT-G', 52),
  ('PNT-WNT-G', 'PNT', 'WNT', 'gloss', '도장 유광 · 월넛', 'paint-gloss walnut', '#8b6447', 'paint-gloss',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'h', 'PNT-G', 53),
  ('PNT-GRP-G', 'PNT', 'GRP', 'gloss', '도장 유광 · 그라파이트', 'paint-gloss graphite', '#696a6b', 'paint-gloss',
   'dark graphite gray, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 54),
  ('PNT-WHT-G', 'PNT', 'WHT', 'gloss', '도장 유광 · 화이트', 'paint-gloss white', '#ffffff', 'paint-gloss',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 55),
  ('PNT-BLK-G', 'PNT', 'BLK', 'gloss', '도장 유광 · 블랙', 'paint-gloss black', '#1a1a1a', 'paint-gloss',
   'deep solid black, smooth flat surface with zero wood grain, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 56),
  ('PNT-SAG-G', 'PNT', 'SAG', 'gloss', '도장 유광 · 세이지', 'paint-gloss sage', '#b2bba5', 'paint-gloss',
   'muted sage green, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 57),
  ('PNT-GRY-G', 'PNT', 'GRY', 'gloss', '도장 유광 · 그레이', 'paint-gloss gray', '#9e9e9e', 'paint-gloss',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 58),
  ('PNT-BGE-G', 'PNT', 'BGE', 'gloss', '도장 유광 · 베이지', 'paint-gloss beige', '#d4c4b0', 'paint-gloss',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 59),
  ('PNT-NVY-G', 'PNT', 'NVY', 'gloss', '도장 유광 · 네이비', 'paint-gloss navy', '#1a237e', 'paint-gloss',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, painted lacquer door, high-gloss polished finish',
   0.25, 0, 0.6, 'none', 'PNT-G', 60),
  ('VNR-CRM', 'VNR', 'CRM', 'single', '무늬목 · 크림', 'veneer cream', '#f1ede3', 'veneer',
   'warm cream off-white, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 61),
  ('VNR-OAK', 'VNR', 'OAK', 'single', '무늬목 · 오크', 'veneer oak', '#d1b089', 'veneer',
   'natural light oak wood grain, visible straight grain pattern, warm honey tones, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'v', 'VNR', 62),
  ('VNR-WNT', 'VNR', 'WNT', 'single', '무늬목 · 월넛', 'veneer walnut', '#8b6447', 'veneer',
   'dark walnut wood grain, realistic horizontal grain pattern, rich brown tones, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'h', 'VNR', 63),
  ('VNR-GRP', 'VNR', 'GRP', 'single', '무늬목 · 그라파이트', 'veneer graphite', '#696a6b', 'veneer',
   'dark graphite gray, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 64),
  ('VNR-WHT', 'VNR', 'WHT', 'single', '무늬목 · 화이트', 'veneer white', '#ffffff', 'veneer',
   'pure white, smooth flat surface with zero wood grain, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 65),
  ('VNR-BLK', 'VNR', 'BLK', 'single', '무늬목 · 블랙', 'veneer black', '#1a1a1a', 'veneer',
   'deep solid black, smooth flat surface with zero wood grain, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 66),
  ('VNR-SAG', 'VNR', 'SAG', 'single', '무늬목 · 세이지', 'veneer sage', '#b2bba5', 'veneer',
   'muted sage green, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 67),
  ('VNR-GRY', 'VNR', 'GRY', 'single', '무늬목 · 그레이', 'veneer gray', '#9e9e9e', 'veneer',
   'neutral medium gray, smooth flat surface with zero wood grain, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 68),
  ('VNR-BGE', 'VNR', 'BGE', 'single', '무늬목 · 베이지', 'veneer beige', '#d4c4b0', 'veneer',
   'warm beige with subtle sand undertone, smooth flat surface, uniform solid color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 69),
  ('VNR-NVY', 'VNR', 'NVY', 'single', '무늬목 · 네이비', 'veneer navy', '#1a237e', 'veneer',
   'deep navy blue, smooth flat surface with zero wood grain, rich saturated color, natural wood veneer door, visible grain, matte oiled finish',
   0.6, 0, 0, 'none', 'VNR', 70)
) AS v(code, finish_code, color_code, tone, color_name, color_name_en, color_hex, finish, texture_prompt, roughness, metalness, clearcoat, grain, price_key, sort)
WHERE NOT EXISTS (SELECT 1 FROM materials m WHERE m.code = v.code);

-- ─────────────────────────────────────────────────────────────
-- 3. 상판 4종 — 기존 countertop 행이 있으면 code 만 채우고, 없으면 삽입
-- ─────────────────────────────────────────────────────────────
UPDATE materials SET code = 'TOP-SNW', tone = 'gloss', slot = ARRAY['top']::TEXT[],
  roughness = 0.25, metalness = 0, clearcoat = 0.6, grain = 'none', sort = 1
  WHERE category = 'countertop' AND color_name = '스노우' AND code IS NULL;
UPDATE materials SET code = 'TOP-MWH', tone = 'gloss', slot = ARRAY['top']::TEXT[],
  roughness = 0.25, metalness = 0, clearcoat = 0.6, grain = 'none', sort = 2
  WHERE category = 'countertop' AND color_name = '마블화이트' AND code IS NULL;
UPDATE materials SET code = 'TOP-GMB', tone = 'gloss', slot = ARRAY['top']::TEXT[],
  roughness = 0.25, metalness = 0, clearcoat = 0.6, grain = 'none', sort = 3
  WHERE category = 'countertop' AND color_name = '그레이마블' AND code IS NULL;
UPDATE materials SET code = 'TOP-CHC', tone = 'matte', slot = ARRAY['top']::TEXT[],
  roughness = 0.75, metalness = 0, clearcoat = 0, grain = 'none', sort = 4
  WHERE category = 'countertop' AND color_name = '차콜' AND code IS NULL;

INSERT INTO materials
  (category, slot, is_active, active, code, tone, color_name, color_name_en, color_hex, texture_prompt,
   roughness, metalness, clearcoat, grain, sort, sort_order)
SELECT
  'countertop', ARRAY['top']::TEXT[], TRUE, TRUE, v.code, v.tone, v.color_name, v.color_name_en, v.color_hex, v.texture_prompt,
  v.roughness, v.metalness, v.clearcoat, 'none', v.sort, v.sort
FROM (VALUES
  ('TOP-SNW', 'gloss', '스노우', 'snow white', '#FAFAFA',
   'pure white engineered quartz countertop with subtle micro-flecks, polished surface, clean bullnose edge profile, 20mm overhang',
   0.25, 0, 0.6, 1),
  ('TOP-MWH', 'gloss', '마블화이트', 'marble white', '#F0F0F0',
   'white marble-look engineered stone countertop with delicate grey veining, polished surface, natural stone appearance, bullnose edge',
   0.25, 0, 0.6, 2),
  ('TOP-GMB', 'gloss', '그레이마블', 'gray marble', '#B0B0B0',
   'gray marble-look engineered stone countertop with dramatic white and charcoal veining, polished surface, bullnose edge',
   0.25, 0, 0.6, 3),
  ('TOP-CHC', 'matte', '차콜', 'charcoal', '#404040',
   'dark charcoal engineered stone countertop, near-black with subtle aggregate texture, matte honed finish, bullnose edge',
   0.75, 0, 0, 4)
) AS v(code, tone, color_name, color_name_en, color_hex, texture_prompt, roughness, metalness, clearcoat, sort)
WHERE NOT EXISTS (SELECT 1 FROM materials m WHERE m.code = v.code);

-- ─────────────────────────────────────────────────────────────
-- 4. 기존 행에 코드 채우기 (styles-materials-schema.sql 시드) — 비어 있을 때만
--    'door'(색만) → 색 코드, 'door_finish'(톤만) → TONE-x. 기판(PET/MFB…)은 모르므로 finish_code 는 비워 둔다 [확인 필요]
-- ─────────────────────────────────────────────────────────────
UPDATE materials SET code = 'WHT', color_code = 'WHT', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '화이트' AND code IS NULL;
UPDATE materials SET code = 'GRY', color_code = 'GRY', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '그레이' AND code IS NULL;
UPDATE materials SET code = 'BGE', color_code = 'BGE', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '베이지' AND code IS NULL;
UPDATE materials SET code = 'WNT', color_code = 'WNT', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '월넛' AND code IS NULL;
UPDATE materials SET code = 'OAK', color_code = 'OAK', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '오크' AND code IS NULL;
UPDATE materials SET code = 'NVY', color_code = 'NVY', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '네이비' AND code IS NULL;
UPDATE materials SET code = 'BLK', color_code = 'BLK', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door' AND color_name = '블랙' AND code IS NULL;
UPDATE materials SET code = 'TONE-M', tone = 'matte', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door_finish' AND color_name = '무광' AND code IS NULL;
UPDATE materials SET code = 'TONE-G', tone = 'gloss', slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door_finish' AND color_name = '유광' AND code IS NULL;
UPDATE materials SET code = 'TONE-E', tone = NULL, slot = ARRAY['door']::TEXT[], sort = sort_order
  WHERE category = 'door_finish' AND color_name = '엠보' AND code IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC — 활성 카탈로그를 slot, sort 순으로
--    RLS 는 styles-materials-schema.sql 의 "Public read materials"(공개 읽기) 를 그대로 따른다.
--    SECURITY INVOKER(기본) 로 두어 RLS 가 그대로 적용된다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_materials_catalog()
RETURNS SETOF materials
LANGUAGE SQL STABLE AS $$
  SELECT * FROM materials
  WHERE is_active = TRUE AND COALESCE(active, TRUE) = TRUE
  ORDER BY slot NULLS LAST, sort NULLS LAST, category, sort_order;
$$;

GRANT EXECUTE ON FUNCTION get_materials_catalog() TO anon, authenticated;
