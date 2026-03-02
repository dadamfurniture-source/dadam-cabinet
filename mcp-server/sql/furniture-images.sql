-- ═══════════════════════════════════════════════════════════════
-- furniture_images - 가구 이미지 저장 + 벡터 검색
-- ═══════════════════════════════════════════════════════════════

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS furniture_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,             -- 'sink', 'hood', 'cooktop', 'door', 'countertop', 'handle', 'faucet'
  subcategory TEXT,                   -- 'single_bowl', 'island_hood', 'push_open' 등
  style TEXT,                         -- 'modern', 'classic', 'natural', 'vintage'
  material TEXT,                      -- 'matte_white', 'wood_grain', 'marble' 등
  color_hex TEXT,                     -- '#FFFFFF'
  description TEXT,                   -- 한국어 상세 설명 (프롬프트 주입용)
  image_url TEXT NOT NULL,            -- Supabase Storage public URL
  storage_path TEXT NOT NULL,         -- Storage bucket 내 경로
  thumbnail_url TEXT,                 -- 썸네일 URL (선택)
  embedding vector(512),             -- CLIP ViT-B/32 임베딩
  tags TEXT[] DEFAULT '{}',          -- 자유 태그
  source TEXT DEFAULT 'photo',        -- 'photo', 'render', 'catalog'
  is_training BOOLEAN DEFAULT false,  -- LoRA 학습용 선별 여부
  lora_model_id TEXT,                -- 학습된 LoRA 모델 ID (Replicate)
  width_px INT,                      -- 원본 이미지 너비
  height_px INT,                     -- 원본 이미지 높이
  file_size_bytes INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 인덱스
CREATE INDEX idx_furniture_images_category ON furniture_images(category);
CREATE INDEX idx_furniture_images_category_style ON furniture_images(category, style);
CREATE INDEX idx_furniture_images_training ON furniture_images(category, is_training) WHERE is_training = true;

-- 벡터 검색 인덱스 (CLIP 임베딩)
CREATE INDEX idx_furniture_images_embedding ON furniture_images
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

-- 3. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_furniture_images_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_furniture_images_updated
  BEFORE UPDATE ON furniture_images
  FOR EACH ROW EXECUTE FUNCTION update_furniture_images_timestamp();

-- 4. 카테고리+스타일 기반 검색 함수
CREATE OR REPLACE FUNCTION search_furniture_by_category(
  p_category TEXT,
  p_style TEXT DEFAULT NULL,
  p_training_only BOOLEAN DEFAULT false,
  p_limit INT DEFAULT 10
)
RETURNS SETOF furniture_images
LANGUAGE sql STABLE
AS $$
  SELECT * FROM furniture_images
  WHERE category = p_category
    AND (p_style IS NULL OR style = p_style)
    AND (NOT p_training_only OR is_training = true)
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

-- 5. 벡터 유사도 검색 함수
CREATE OR REPLACE FUNCTION search_furniture_by_embedding(
  p_embedding vector(512),
  p_category TEXT DEFAULT NULL,
  p_limit INT DEFAULT 5,
  p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE(
  id UUID,
  category TEXT,
  subcategory TEXT,
  style TEXT,
  description TEXT,
  image_url TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    fi.id, fi.category, fi.subcategory, fi.style,
    fi.description, fi.image_url,
    1 - (fi.embedding <=> p_embedding) AS similarity
  FROM furniture_images fi
  WHERE fi.embedding IS NOT NULL
    AND (p_category IS NULL OR fi.category = p_category)
    AND 1 - (fi.embedding <=> p_embedding) >= p_threshold
  ORDER BY fi.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- 6. LoRA 모델 추적 테이블
CREATE TABLE IF NOT EXISTS lora_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,             -- 학습 대상 품목
  model_id TEXT NOT NULL,             -- Replicate 모델 ID
  model_version TEXT,                 -- Replicate 모델 버전
  trigger_word TEXT NOT NULL,         -- 'DADAM_SINK' 등
  training_images_count INT,
  training_steps INT,
  training_cost_usd NUMERIC(6,4),
  status TEXT DEFAULT 'training',     -- 'training', 'ready', 'deprecated'
  replicate_training_id TEXT,         -- Replicate training ID
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lora_models_category ON lora_models(category);
CREATE INDEX idx_lora_models_status ON lora_models(status) WHERE status = 'ready';

-- 7. RLS 정책 (관리자만 쓰기, 모두 읽기)
ALTER TABLE furniture_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE lora_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "furniture_images_read" ON furniture_images
  FOR SELECT USING (true);

CREATE POLICY "furniture_images_write" ON furniture_images
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "lora_models_read" ON lora_models
  FOR SELECT USING (true);

CREATE POLICY "lora_models_write" ON lora_models
  FOR ALL USING (auth.role() = 'service_role');

-- 8. Storage 버킷 (Supabase 대시보드에서 생성 또는 API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('furniture-images', 'furniture-images', true);
