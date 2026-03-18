-- style_references: 스타일별 참고 이미지 테이블
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.style_references (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,          -- sink, island, closet, etc.
  style       TEXT NOT NULL,          -- modern, nordic, classic, etc.
  image_url   TEXT NOT NULL,          -- Supabase Storage URL
  description TEXT,                   -- 이미지 설명 (선택)
  is_active   BOOLEAN DEFAULT true,   -- 활성 여부
  created_at  TIMESTAMPTZ DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id)
);

-- 인덱스: 카테고리+스타일로 빠른 조회
CREATE INDEX IF NOT EXISTS idx_style_refs_cat_style
  ON public.style_references(category, style)
  WHERE is_active = true;

-- RLS 정책
ALTER TABLE public.style_references ENABLE ROW LEVEL SECURITY;

-- 모든 인증 사용자가 조회 가능
CREATE POLICY "style_refs_select" ON public.style_references
  FOR SELECT TO authenticated USING (true);

-- 관리자만 삽입/수정/삭제 가능 (service_role로 처리)

-- Storage: references 버킷 생성 (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('references', 'references', true)
ON CONFLICT (id) DO NOTHING;
