-- ============================================================
-- user_images 테이블: 사용자 이미지 메타데이터 관리
-- 현장 사진과 AI 생성 이미지를 구분하여 저장
-- ============================================================

-- 테이블 생성
CREATE TABLE IF NOT EXISTS public.user_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 이미지 타입: 'site_photo' (현장 사진) 또는 'ai_generated' (AI 생성)
  image_type VARCHAR(20) NOT NULL CHECK (image_type IN ('site_photo', 'ai_generated')),

  -- Storage 경로 (design-images 버킷 내 경로)
  storage_path TEXT NOT NULL,

  -- 공개 URL
  public_url TEXT NOT NULL,

  -- 파일 정보
  file_name TEXT,
  file_size_bytes INTEGER,
  mime_type VARCHAR(50) DEFAULT 'image/png',

  -- AI 생성 이미지의 경우 관련 설계 ID (선택적)
  design_id UUID REFERENCES public.designs(id) ON DELETE SET NULL,

  -- AI 생성 이미지의 경우 도어 상태
  door_state VARCHAR(10) CHECK (door_state IN ('closed', 'open', NULL)),

  -- 메타데이터 (프롬프트, 스타일 등)
  metadata JSONB DEFAULT '{}',

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_user_images_user_id ON public.user_images(user_id);
CREATE INDEX idx_user_images_type ON public.user_images(image_type);
CREATE INDEX idx_user_images_created_at ON public.user_images(created_at);
CREATE INDEX idx_user_images_user_type ON public.user_images(user_id, image_type);

-- RLS (Row Level Security) 활성화
ALTER TABLE public.user_images ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 사용자는 자신의 이미지만 조회/수정/삭제 가능
CREATE POLICY "Users can view own images" ON public.user_images
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own images" ON public.user_images
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own images" ON public.user_images
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own images" ON public.user_images
  FOR DELETE USING (auth.uid() = user_id);

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_images_updated_at
  BEFORE UPDATE ON public.user_images
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 코멘트
-- ============================================================
COMMENT ON TABLE public.user_images IS '사용자 이미지 메타데이터 (현장 사진, AI 생성 이미지)';
COMMENT ON COLUMN public.user_images.image_type IS 'site_photo: 현장 사진, ai_generated: AI 생성 이미지';
COMMENT ON COLUMN public.user_images.door_state IS 'AI 생성 이미지의 도어 상태 (closed/open)';
