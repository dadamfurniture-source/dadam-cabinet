-- =============================================
-- 0084 프로젝트 작업의 차수 — 끝난 작업 뒤에 온 품목은 같은 종류의 새 작업 (2026-11-24 대표님 「추천대로 진행」 — 작업 배정 ①)
--
--   대표님이 정한 것 (2026-11-24, 설명 페이지의 ①):
--     · 철거 · 재단 · 엣지 · 조립 작업 하나가 그때 프로젝트에 있는 품목(설계)들을 함께 맡는다 — 지금처럼.
--     · 그 작업이 끝난 뒤에 새 품목이 오면 같은 종류의 작업을 하나 더(2차) 만들 수 있다.
--       지금은 「프로젝트 하나 · 종류 하나에 살아 있는 작업 하나」(0065)라 끝난 작업이 있으면 새 작업을 넣지 못했다.
--
-- 바꾸는 것:
--   1) work_jobs.design_ids — 프로젝트 작업이 끝날 때(완료 · 마감) 그 작업이 맡은 설계들을 적어 둔다.
--        비어 있는(null) 작업은 「같은 종류의 끝난 작업이 맡지 않은 설계 모두」를 맡는다 (서버 work/job-links.js).
--        프로젝트 작업(일정에서 생기지 않은 것)에만 적는다 · 50개까지.
--   2) uq_work_jobs_project_kind_live — 프로젝트 · 종류마다 **진행 중인** 작업 하나. 완료(done) · 마감(closed) · 취소한 작업은 세지 않는다.
--   3) 이미 끝난 프로젝트 작업에는 지금 그 프로젝트의 설계를 모두 적어 둔다 (예전처럼 그 설계들은 그 작업 것).
--
-- 읽기 · 쓰기 · 정책은 그대로다 (새 칸은 서버가 쓴다).
-- =============================================

-- 1) 끝난 작업이 맡은 설계 ---------------------------------------------------------

ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS design_ids uuid[];
ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_design_ids_check;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_design_ids_check CHECK ((design_ids IS NULL)
        OR ((project_id IS NOT NULL) AND (schedule_id IS NULL) AND (cardinality(design_ids) <= 50)));
COMMENT ON COLUMN public.work_jobs.design_ids IS '프로젝트 작업이 끝날 때 맡았던 설계들 (0084). null 이면 같은 종류의 끝난 작업이 맡지 않은 그 프로젝트의 설계 모두 — 끝난 뒤 온 품목은 같은 종류의 새 작업(2차)이 맡는다';

-- 2) 프로젝트 · 종류마다 진행 중인 작업 하나 -------------------------------------------

DROP INDEX IF EXISTS public.uq_work_jobs_project_kind_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_jobs_project_kind_live ON public.work_jobs USING btree (project_id, kind)
    WHERE ((project_id IS NOT NULL) AND (schedule_id IS NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'done'::text, 'closed'::text])));
COMMENT ON COLUMN public.work_jobs.project_id IS '이 작업이 속한 프로젝트 — 프로젝트 「작업 배정」에서 만든 작업. 프로젝트 하나 · 종류 하나에 진행 중인 작업 하나 (완료 · 마감 · 취소한 작업과 일정에서 생긴 작업은 세지 않는다 — 0084)';

-- 3) 이미 끝난 프로젝트 작업 — 지금 그 프로젝트의 설계를 모두 적는다 ------------------------

UPDATE public.work_jobs j
   SET design_ids = COALESCE(
         (SELECT array_agg(d.id ORDER BY d.created_at, d.id)
            FROM public.designs d
           WHERE d.project_id = j.project_id AND d.company_id = j.company_id),
         '{}'::uuid[])
 WHERE j.project_id IS NOT NULL
   AND j.schedule_id IS NULL
   AND j.status IN ('done', 'closed')
   AND j.design_ids IS NULL;
