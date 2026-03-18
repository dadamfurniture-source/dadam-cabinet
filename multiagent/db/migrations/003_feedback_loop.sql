-- ============================================================
-- 피드백 루프 시스템 마이그레이션
-- 4개 루프: RAG + LoRA 재학습 + 가격 보정 + 제약조건 학습
-- ============================================================

-- pgvector 확장 (Supabase에서 지원)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. RAG 루프 — 유사 사례 벡터 DB
-- ============================================================

CREATE TABLE public.case_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  order_id      UUID REFERENCES public.orders(id),
  category      TEXT NOT NULL,
  style         TEXT,
  -- 공간 요약 (검색용 텍스트)
  space_summary TEXT NOT NULL,           -- "2.4m x 1.8m 주방, 좌측 급수배관"
  layout_summary TEXT,                   -- "600mm 개수대 + 900mm 가스대 + 600mm 서랍장"
  -- 평가 데이터
  rating        REAL,                    -- 고객 만족도 1~5
  is_installed  BOOLEAN DEFAULT false,   -- 실제 설치 완료 여부
  has_as_issue  BOOLEAN DEFAULT false,   -- A/S 발생 여부
  -- 벡터 임베딩
  embedding     vector(1536),            -- text-embedding-3-small
  -- 원본 데이터 참조
  space_analysis_json JSONB,
  layout_json   JSONB,
  metadata      JSONB DEFAULT '{}',      -- 추가 컨텍스트
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 벡터 유사도 검색용 인덱스 (IVFFlat)
CREATE INDEX idx_case_embeddings_vector
  ON public.case_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 카테고리 + 평점 필터 인덱스
CREATE INDEX idx_case_embeddings_category ON public.case_embeddings(category);
CREATE INDEX idx_case_embeddings_rating ON public.case_embeddings(rating DESC);

-- 유사 사례 검색 함수
CREATE OR REPLACE FUNCTION public.search_similar_cases(
  query_embedding vector(1536),
  match_category TEXT,
  match_count INT DEFAULT 5,
  min_rating REAL DEFAULT 3.0
)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  category TEXT,
  style TEXT,
  space_summary TEXT,
  layout_summary TEXT,
  rating REAL,
  similarity REAL,
  metadata JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id, ce.project_id, ce.category, ce.style,
    ce.space_summary, ce.layout_summary, ce.rating,
    1 - (ce.embedding <=> query_embedding) AS similarity,
    ce.metadata
  FROM public.case_embeddings ce
  WHERE ce.category = match_category
    AND (ce.rating IS NULL OR ce.rating >= min_rating)
    AND ce.embedding IS NOT NULL
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. LoRA 재학습 루프
-- ============================================================

-- 학습 대기열 (시공 사진 → 재학습용)
CREATE TABLE public.training_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url     TEXT NOT NULL,
  category      TEXT NOT NULL,
  style         TEXT,
  quality_grade TEXT DEFAULT 'normal'
                CHECK (quality_grade IN ('low', 'normal', 'high', 'excellent')),
  source        TEXT NOT NULL
                CHECK (source IN ('installation_photo', 'customer_upload', 'crawled', 'manual')),
  -- 메타데이터
  project_id    UUID REFERENCES public.projects(id),
  order_id      UUID REFERENCES public.orders(id),
  customer_rating REAL,                  -- 해당 프로젝트 고객 평점
  -- 학습 상태
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'training', 'trained', 'rejected')),
  trained_at    TIMESTAMPTZ,
  model_version_id UUID,                 -- 어떤 모델 버전에 학습되었는지
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- LoRA 모델 버전 관리
CREATE TABLE public.lora_model_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category            TEXT NOT NULL,
  version             INT NOT NULL,
  replicate_model_id  TEXT NOT NULL,     -- "dadamfurniture-source/l_shaped_sink:v3"
  trigger_word        TEXT NOT NULL,     -- "DADAM_L_SHAPED_SINK"
  training_images_count INT DEFAULT 0,
  -- 성능 평가
  performance_score   REAL,              -- 자동 평가 점수 (FID 등)
  human_eval_score    REAL,              -- 사람 평가 점수
  avg_customer_rating REAL,              -- 이 모델로 생성된 프로젝트의 평균 평점
  -- 상태
  is_active           BOOLEAN DEFAULT false, -- 프로덕션에서 사용 중
  is_baseline         BOOLEAN DEFAULT false, -- 기본 모델 (롤백용)
  trained_at          TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_training_queue_status ON public.training_queue(status, category);
CREATE INDEX idx_lora_versions_active ON public.lora_model_versions(category, is_active);
CREATE UNIQUE INDEX idx_lora_versions_unique ON public.lora_model_versions(category, version);

-- ============================================================
-- 3. 가격 보정 루프
-- ============================================================

-- 보정 계수 테이블
CREATE TABLE public.price_calibrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,
  module_type     TEXT,                   -- 세부 모듈 (null이면 카테고리 전체)
  region          TEXT DEFAULT 'default', -- 지역별 보정
  -- 보정 데이터
  correction_factor REAL NOT NULL DEFAULT 1.0, -- 1.08 = 8% 상향 보정
  sample_count    INT DEFAULT 0,          -- 보정에 사용된 샘플 수
  avg_error_rate  REAL DEFAULT 0.0,       -- 평균 오차율
  std_error_rate  REAL DEFAULT 0.0,       -- 오차 표준편차
  -- 이력
  last_calibrated_at TIMESTAMPTZ DEFAULT now(),
  calibration_history JSONB DEFAULT '[]', -- [{date, factor, samples}, ...]
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_price_cal_unique
  ON public.price_calibrations(category, COALESCE(module_type, ''), region);

-- 견적 vs 실계약 비교 뷰
CREATE OR REPLACE VIEW public.quote_accuracy AS
SELECT
  q.id AS quote_id,
  p.category,
  q.total_price AS ai_quote,
  o.contract_amount AS actual_amount,
  CASE
    WHEN q.total_price > 0
    THEN ROUND(((o.contract_amount - q.total_price)::NUMERIC / q.total_price) * 100, 2)
    ELSE 0
  END AS error_rate_pct,
  o.created_at AS contract_date
FROM public.quotes q
JOIN public.projects p ON q.project_id = p.id
JOIN public.orders o ON o.quote_id = q.id
WHERE o.contract_amount IS NOT NULL
  AND o.status NOT IN ('consulting', 'quoted');

-- ============================================================
-- 4. 제약조건 학습 루프
-- ============================================================

-- A/S 패턴에서 학습된 제약조건
CREATE TABLE public.learned_constraints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL,
  -- 규칙 정의
  rule_text     TEXT NOT NULL,           -- "개수대 하부장은 최소 700mm 이상"
  rule_json     JSONB,                   -- 구조화된 규칙 {"min_width": 700, "module": "sink_bowl"}
  severity      TEXT DEFAULT 'warning'
                CHECK (severity IN ('info', 'warning', 'error')),
  -- 근거
  source_type   TEXT NOT NULL
                CHECK (source_type IN ('as_pattern', 'installer_feedback', 'measurement_gap', 'manual')),
  source_tickets UUID[],                 -- 근거가 된 A/S 티켓 IDs
  source_count  INT DEFAULT 0,           -- 동일 패턴 발생 건수
  confidence    REAL DEFAULT 0.0,        -- 0.0 ~ 1.0
  -- 승인/적용
  status        TEXT DEFAULT 'proposed'
                CHECK (status IN ('proposed', 'approved', 'applied', 'rejected', 'deprecated')),
  proposed_at   TIMESTAMPTZ DEFAULT now(),
  approved_by   UUID,
  approved_at   TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,             -- Design Planner에 반영된 시점
  rejected_reason TEXT,
  -- 효과 추적
  prevented_count INT DEFAULT 0,         -- 이 규칙으로 방지된 문제 수
  false_positive_count INT DEFAULT 0,    -- 오탐 수
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_constraints_category ON public.learned_constraints(category, status);
CREATE INDEX idx_constraints_applied ON public.learned_constraints(status)
  WHERE status = 'applied';

-- A/S 패턴 분석 뷰
CREATE OR REPLACE VIEW public.as_pattern_analysis AS
SELECT
  ast.type AS as_type,
  p.category,
  COUNT(*) AS occurrence_count,
  ARRAY_AGG(ast.id) AS ticket_ids,
  ARRAY_AGG(DISTINCT ast.description) AS descriptions
FROM public.after_service_tickets ast
JOIN public.orders o ON ast.order_id = o.id
JOIN public.projects p ON o.project_id = p.id
WHERE ast.status IN ('resolved', 'closed')
GROUP BY ast.type, p.category
HAVING COUNT(*) >= 3;

-- ============================================================
-- 5. 고객 피드백 (공통)
-- ============================================================

CREATE TABLE public.customer_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES public.projects(id),
  order_id        UUID REFERENCES public.orders(id),
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  -- 평가
  overall_rating  INT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  design_rating   INT CHECK (design_rating BETWEEN 1 AND 5),
  image_rating    INT CHECK (image_rating BETWEEN 1 AND 5),
  quote_rating    INT CHECK (quote_rating BETWEEN 1 AND 5),
  install_rating  INT CHECK (install_rating BETWEEN 1 AND 5),
  -- 선택/선호
  selected_style  TEXT,                   -- 여러 스타일 중 최종 선택한 것
  preferred_images UUID[],                -- 마음에 든 이미지 ID 목록
  -- 서술 평가
  comment         TEXT,
  improvement_suggestions TEXT,
  -- 시공 사진 (설치 후)
  installation_photos TEXT[],
  -- 메타
  feedback_type   TEXT DEFAULT 'simulation'
                  CHECK (feedback_type IN ('simulation', 'installation', 'as')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_feedback_project ON public.customer_feedback(project_id);
CREATE INDEX idx_feedback_rating ON public.customer_feedback(overall_rating);

-- RLS
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY feedback_insert ON public.customer_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY feedback_select ON public.customer_feedback
  FOR SELECT USING (auth.uid() = user_id);
