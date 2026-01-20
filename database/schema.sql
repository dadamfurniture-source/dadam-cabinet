-- ============================================================
-- 다담 캐비넷 데이터베이스 스키마
-- 딥러닝 친화적 설계 (v1.0)
-- ============================================================

-- 1. 사용자 프로필 (역할 관리)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  name TEXT,
  phone TEXT,
  role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'expert', 'admin')),
  upgraded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 새 사용자 자동 등록 트리거
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'customer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 생성 (이미 존재하면 무시)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. 설계 프로젝트 (메타 정보)
CREATE TABLE IF NOT EXISTS designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,

  -- 기본 정보
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'in_review', 'completed', 'feedback_done')),

  -- 통계 정보
  total_items INT DEFAULT 0,
  total_modules INT DEFAULT 0,

  -- 학습용 라벨 (나중에 입력)
  estimated_price INT,          -- 예상 견적
  final_price INT,              -- 최종 시공 가격
  customer_satisfaction INT CHECK (customer_satisfaction BETWEEN 1 AND 5),
  revision_count INT DEFAULT 0, -- 수정 횟수

  -- 메타데이터
  app_version TEXT,             -- 사용된 앱 버전
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 3. 설계 아이템 (가구별 상세)
CREATE TABLE IF NOT EXISTS design_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id UUID REFERENCES designs ON DELETE CASCADE,

  -- 카테고리 정보
  category TEXT NOT NULL,       -- sink, wardrobe, fridge, island, etc.
  name TEXT,
  unique_id BIGINT,             -- 클라이언트 측 고유 ID

  -- 치수 (수치형 feature)
  width INT,
  height INT,
  depth INT,

  -- 구조화된 상세 (JSON)
  specs JSONB DEFAULT '{}',     -- 전체 스펙
  modules JSONB DEFAULT '[]',   -- 모듈 배열

  -- 텍스트 (NLP용)
  customer_notes TEXT,          -- 고객 요청사항

  -- 메타데이터
  item_order INT DEFAULT 0,     -- 아이템 순서
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 설계 이미지 (Vision AI용)
CREATE TABLE IF NOT EXISTS design_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id UUID REFERENCES designs ON DELETE CASCADE,
  item_id UUID REFERENCES design_items ON DELETE CASCADE,

  -- 이미지 정보
  storage_path TEXT NOT NULL,   -- Supabase Storage 경로
  original_filename TEXT,
  file_size INT,
  mime_type TEXT,

  -- 이미지 분류 (학습 라벨)
  image_type TEXT DEFAULT 'site_photo' CHECK (image_type IN ('site_photo', 'reference', 'sketch', 'result')),

  -- 메타데이터
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 피드백 (강화학습용)
CREATE TABLE IF NOT EXISTS design_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id UUID REFERENCES designs ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users,

  -- 피드백 유형
  feedback_type TEXT CHECK (feedback_type IN ('revision', 'completion', 'complaint', 'praise')),

  -- 결과 라벨
  was_modified BOOLEAN DEFAULT FALSE,
  modification_reason TEXT,

  -- 품질 점수
  accuracy_score INT CHECK (accuracy_score BETWEEN 1 AND 5),
  usability_score INT CHECK (usability_score BETWEEN 1 AND 5),

  -- 상세 피드백
  feedback_text TEXT,

  -- 메타데이터
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 벡터 임베딩 (RAG/검색용) - pgvector 확장 필요
-- CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS design_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id UUID REFERENCES designs ON DELETE CASCADE,
  item_id UUID REFERENCES design_items ON DELETE CASCADE,

  -- 임베딩 (pgvector 설치 후 활성화)
  -- embedding VECTOR(1536),     -- OpenAI ada-002
  embedding_json JSONB,          -- 임시: JSON으로 저장

  -- 검색용 텍스트
  searchable_text TEXT,
  embedding_model TEXT DEFAULT 'text-embedding-ada-002',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. 전문가 전환 요청
CREATE TABLE IF NOT EXISTS expert_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,

  -- 요청 정보
  request_reason TEXT,
  company_name TEXT,
  experience_years INT,

  -- 상태
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 인덱스 생성 (검색 성능 최적화)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_designs_user_id ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_designs_status ON designs(status);
CREATE INDEX IF NOT EXISTS idx_designs_created_at ON designs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_items_design_id ON design_items(design_id);
CREATE INDEX IF NOT EXISTS idx_design_items_category ON design_items(category);

CREATE INDEX IF NOT EXISTS idx_design_images_design_id ON design_images(design_id);
CREATE INDEX IF NOT EXISTS idx_design_images_item_id ON design_images(item_id);

CREATE INDEX IF NOT EXISTS idx_design_feedback_design_id ON design_feedback(design_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- ============================================================
-- Row Level Security (RLS) 정책
-- ============================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE expert_requests ENABLE ROW LEVEL SECURITY;

-- 사용자 프로필: 본인 것만 조회/수정
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- 설계: 본인 것만 조회/생성/수정
CREATE POLICY "Users can view own designs" ON designs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own designs" ON designs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own designs" ON designs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own designs" ON designs
  FOR DELETE USING (auth.uid() = user_id);

-- 설계 아이템: 부모 설계 소유자만
CREATE POLICY "Users can manage own design items" ON design_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM designs
      WHERE designs.id = design_items.design_id
      AND designs.user_id = auth.uid()
    )
  );

-- 설계 이미지: 부모 설계 소유자만
CREATE POLICY "Users can manage own design images" ON design_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM designs
      WHERE designs.id = design_images.design_id
      AND designs.user_id = auth.uid()
    )
  );

-- 피드백: 본인 것만
CREATE POLICY "Users can manage own feedback" ON design_feedback
  FOR ALL USING (auth.uid() = user_id);

-- 전문가 요청: 본인 것만
CREATE POLICY "Users can view own expert requests" ON expert_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create expert request" ON expert_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 유틸리티 함수
-- ============================================================

-- 설계 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_design_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE designs SET
    total_items = (SELECT COUNT(*) FROM design_items WHERE design_id = NEW.design_id),
    total_modules = (
      SELECT COALESCE(SUM(jsonb_array_length(modules)), 0)
      FROM design_items
      WHERE design_id = NEW.design_id
    ),
    updated_at = NOW()
  WHERE id = NEW.design_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_design_stats_trigger
  AFTER INSERT OR UPDATE OR DELETE ON design_items
  FOR EACH ROW EXECUTE FUNCTION update_design_stats();

-- 사용자 역할 확인 함수
CREATE OR REPLACE FUNCTION get_user_role(user_uuid UUID)
RETURNS TEXT AS $$
  SELECT role FROM user_profiles WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- 전문가 승급 함수 (관리자용)
CREATE OR REPLACE FUNCTION approve_expert(request_id UUID, admin_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  target_user_id UUID;
BEGIN
  -- 요청 조회
  SELECT user_id INTO target_user_id
  FROM expert_requests
  WHERE id = request_id AND status = 'pending';

  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 사용자 역할 업데이트
  UPDATE user_profiles
  SET role = 'expert', upgraded_at = NOW(), updated_at = NOW()
  WHERE id = target_user_id;

  -- 요청 상태 업데이트
  UPDATE expert_requests
  SET status = 'approved', reviewed_by = admin_id, reviewed_at = NOW()
  WHERE id = request_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
