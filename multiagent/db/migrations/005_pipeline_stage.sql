-- ============================================================
-- 다담 SaaS: Pipeline Stage + Completed At
-- 백그라운드 파이프라인 진행 상황 추적을 위한 컬럼 추가
-- ============================================================

-- 파이프라인 스테이지 (SSE 폴링용)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT NULL;

-- 완료 시각
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

-- processing 상태 추가 (기존 CHECK 제약에 포함)
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (status IN (
    'created', 'processing', 'analyzing', 'designing', 'generating',
    'quoting', 'completed', 'failed'
  ));

COMMENT ON COLUMN public.projects.pipeline_stage IS '현재 파이프라인 단계 (started, space_analysis, design, image_gen, quote, completed, failed)';
COMMENT ON COLUMN public.projects.completed_at IS '파이프라인 완료 시각';
