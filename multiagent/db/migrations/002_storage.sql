-- ============================================================
-- Storage Buckets 설정
-- ============================================================

-- 원본 사진 (고객 업로드)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'originals',
  'originals',
  false,
  10485760,  -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

-- 생성된 이미지 (AI 시뮬레이션 결과)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated-images',
  'generated-images',
  true,      -- 결과 이미지는 공개 (URL 공유 가능)
  20971520,  -- 20MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
);

-- 설계도/문서 (Pro+)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'designs',
  'designs',
  false,
  52428800,  -- 50MB
  ARRAY['image/svg+xml', 'application/pdf', 'application/dxf', 'image/png']
);

-- A/S 사진
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'as-photos',
  'as-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

-- 시공 완료 사진
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'installation-photos',
  'installation-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

-- ============================================================
-- Storage RLS 정책
-- ============================================================

-- 원본 사진: 업로드한 본인만 접근
CREATE POLICY originals_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'originals'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

CREATE POLICY originals_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'originals'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

-- 생성 이미지: 프로젝트 소유자 접근 (공개 URL은 별도)
CREATE POLICY generated_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'generated-images'
  );

-- 설계도: 프로젝트 소유자만
CREATE POLICY designs_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'designs'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );
