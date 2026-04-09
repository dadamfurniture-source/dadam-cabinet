-- =============================================
-- Sink HITL 학습 데이터 테이블
-- AI 싱크대 설계 학습 + 피드백 루프
-- =============================================

-- 1. sink_hitl_cases: 개별 설계안 (generated + corrected 모두)
CREATE TABLE IF NOT EXISTS sink_hitl_cases (
    id TEXT PRIMARY KEY,                          -- sink-{timestamp36}-{seed36}
    version TEXT NOT NULL DEFAULT 'v1',
    env JSONB NOT NULL,                           -- SinkEnv (벽/환경 치수)
    lower JSONB NOT NULL DEFAULT '[]',            -- SinkModule[] 하부장
    upper JSONB NOT NULL DEFAULT '[]',            -- SinkModule[] 상부장
    meta JSONB NOT NULL DEFAULT '{}',             -- { generated_by, parent_id, seed, ... }

    -- 검색/필터용 비정규화 컬럼
    layout_type TEXT GENERATED ALWAYS AS (env->>'layoutType') STORED,
    wall_width INTEGER GENERATED ALWAYS AS ((env->>'width')::int) STORED,
    generated_by TEXT GENERATED ALWAYS AS (meta->>'generated_by') STORED,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sink_hitl_cases_layout ON sink_hitl_cases(layout_type);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_cases_width ON sink_hitl_cases(wall_width);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_cases_generated_by ON sink_hitl_cases(generated_by);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_cases_created ON sink_hitl_cases(created_at DESC);

-- 2. sink_hitl_pairs: generated ↔ corrected 페어 + diff + 평점
CREATE TABLE IF NOT EXISTS sink_hitl_pairs (
    pair_id TEXT PRIMARY KEY,
    generated_id TEXT NOT NULL REFERENCES sink_hitl_cases(id),
    corrected_id TEXT NOT NULL REFERENCES sink_hitl_cases(id),
    diffs JSONB NOT NULL DEFAULT '[]',            -- SinkDiffOp[]
    diff_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(diffs)) STORED,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,

    -- 검색용 비정규화
    layout_type TEXT,                             -- 환경 레이아웃 타입
    wall_width INTEGER,                           -- 환경 주벽 너비

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sink_hitl_pairs_rating ON sink_hitl_pairs(rating);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_pairs_layout ON sink_hitl_pairs(layout_type);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_pairs_width ON sink_hitl_pairs(wall_width);
CREATE INDEX IF NOT EXISTS idx_sink_hitl_pairs_created ON sink_hitl_pairs(created_at DESC);

-- 3. sink_hitl_rules: 마이닝된 학습 규칙 (AI 프롬프트 주입용)
CREATE TABLE IF NOT EXISTS sink_hitl_rules (
    rule_id TEXT PRIMARY KEY,
    tag TEXT NOT NULL UNIQUE,                     -- diff tag (예: lower-cook-kind-fix-door-to-drawer)
    description TEXT,                             -- 사람 읽기용 규칙 설명
    condition JSONB NOT NULL DEFAULT '{}',        -- { section, type, field, ... }
    action JSONB NOT NULL DEFAULT '{}',           -- { field, from, to }
    confidence REAL NOT NULL DEFAULT 0,           -- 0.0 ~ 1.0 (빈도 / 전체 pair 수)
    sample_count INTEGER NOT NULL DEFAULT 0,      -- 해당 규칙 발견 횟수
    is_active BOOLEAN NOT NULL DEFAULT false,     -- true면 AI 프롬프트에 포함
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sink_hitl_rules_active ON sink_hitl_rules(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sink_hitl_rules_confidence ON sink_hitl_rules(confidence DESC);

-- 4. RPC 함수: 통계 집계
CREATE OR REPLACE FUNCTION sink_hitl_get_stats()
RETURNS JSON AS $$
  SELECT json_build_object(
    'totalPairs', (SELECT COUNT(*) FROM sink_hitl_pairs),
    'totalCases', (SELECT COUNT(*) FROM sink_hitl_cases),
    'avgRating', COALESCE((SELECT AVG(rating)::numeric(3,1) FROM sink_hitl_pairs), 0),
    'avgDiffCount', COALESCE((SELECT AVG(diff_count)::numeric(3,1) FROM sink_hitl_pairs), 0),
    'lastWeekPairs', (SELECT COUNT(*) FROM sink_hitl_pairs WHERE created_at >= NOW() - INTERVAL '7 days'),
    'activeRuleCount', (SELECT COUNT(*) FROM sink_hitl_rules WHERE is_active = true),
    'totalRuleCount', (SELECT COUNT(*) FROM sink_hitl_rules)
  );
$$ LANGUAGE SQL STABLE;

-- 5. RPC 함수: 유사 환경 고평점 pair 검색 (few-shot 예시용)
CREATE OR REPLACE FUNCTION sink_hitl_similar_pairs(
    p_layout_type TEXT,
    p_width_min INTEGER,
    p_width_max INTEGER,
    p_min_rating INTEGER DEFAULT 4,
    p_limit INTEGER DEFAULT 3
)
RETURNS TABLE (
    pair_id TEXT,
    generated JSONB,
    corrected JSONB,
    diffs JSONB,
    rating INTEGER
) AS $$
  SELECT
    p.pair_id,
    json_build_object(
        'id', gc.id, 'env', gc.env, 'lower', gc.lower, 'upper', gc.upper
    )::jsonb AS generated,
    json_build_object(
        'id', cc.id, 'env', cc.env, 'lower', cc.lower, 'upper', cc.upper
    )::jsonb AS corrected,
    p.diffs,
    p.rating
  FROM sink_hitl_pairs p
  JOIN sink_hitl_cases gc ON gc.id = p.generated_id
  JOIN sink_hitl_cases cc ON cc.id = p.corrected_id
  WHERE p.rating >= p_min_rating
    AND (p_layout_type IS NULL OR p.layout_type = p_layout_type)
    AND (p_width_min IS NULL OR p.wall_width >= p_width_min)
    AND (p_width_max IS NULL OR p.wall_width <= p_width_max)
  ORDER BY p.rating DESC, p.created_at DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;

-- 6. RLS 비활성 (서버사이드 전용 — 서비스 키 사용)
-- 프론트엔드에서 직접 접근하지 않으므로 RLS 불필요
-- 필요 시 아래 주석 해제:
-- ALTER TABLE sink_hitl_cases ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sink_hitl_pairs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sink_hitl_rules ENABLE ROW LEVEL SECURITY;
