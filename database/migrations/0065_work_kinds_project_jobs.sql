-- =============================================
-- 0065 작업 종류 넓히기 · 프로젝트의 작업 — 철거 · 재단 · 엣지 · 조립 · 설치 · A/S 를 한 길에서
--      (2026-11-13 사장님 결정 · 「작업자 한 길」 둘째 묶음)
--
--   「작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결」을 프로젝트 한 화면에서 한다.
--   지금까지 작업(work_jobs)의 종류는 설치 · A/S · 조립 셋이었고, 일정 줄(설치 · A/S 방문)에서만 배정했다.
--   이제 프로젝트마다 종류 줄(철거 · 재단 · 엣지 · 조립)에도 작업자를 배정한다.
--
-- 바꾸는 것:
--   1) 작업자 종류에 demolition(철거) — workers.kinds · worker_invites.kinds_preset · worker_companies.kinds
--        install 설치 · as A/S · assembly 조립 · cutting 재단 · edge 엣지 · demolition 철거
--   2) 작업 종류(work_jobs.kind)에 cutting · edge · demolition — 작업자 종류와 같은 여섯
--   3) work_jobs.project_id — 그 작업이 속한 프로젝트(projects). 같은 업체의 프로젝트만 (designs · orders 와 같은
--        (project_id, company_id) 외래 키). 프로젝트가 지워지면 비운다.
--        프로젝트 하나 · 종류 하나에 살아 있는(취소 아님) 작업은 하나 — 일정에서 생긴 작업(schedule_id 있음)은 세지 않는다
--        (설치 · A/S 는 일정마다 작업 하나 — 0064 uq_work_jobs_schedule_live).
--   4) worker_invites.job_id — 「이 일로 바로」 초대. 초대로 온 작업자의 연결을 팩토리가 승인하면
--        서버가 그 작업에 배정 제안을 넣는다. 작업이 지워지면 비운다.
--
-- 바꾸지 않는 것
--   권한 · 정책 (작업 표들은 서버가 쓴다), 공장 배정(factory_workers — 재단 · 엣지 · 조립의 상시 배정은 그대로),
--   일정 종류(design_schedules.type — 철거 일정 종류는 만들지 않는다. 철거 · 재단 · 엣지 · 조립의 날짜는 작업의 starts_at).
--
-- 0064 를 먼저 적용해야 한다 (worker_companies 가 있어야 한다). 다시 돌려도 된다.
-- =============================================

-- 1) 작업자 종류에 철거 --------------------------------------------------------------

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_kinds_chk;
ALTER TABLE public.workers
    ADD CONSTRAINT workers_kinds_chk CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text]);

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_kinds_chk;
ALTER TABLE public.worker_invites
    ADD CONSTRAINT worker_invites_kinds_chk CHECK (kinds_preset <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text]);

ALTER TABLE public.worker_companies DROP CONSTRAINT IF EXISTS worker_companies_kinds_check;
ALTER TABLE public.worker_companies
    ADD CONSTRAINT worker_companies_kinds_check CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text]);

-- 2) 작업 종류 여섯 ------------------------------------------------------------------

ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_kind_chk;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_kind_chk CHECK (kind = ANY (ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text]));

-- 3) 작업의 프로젝트 칸 ----------------------------------------------------------------

ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_project_id_fkey;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_project_id_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id);
CREATE INDEX IF NOT EXISTS idx_work_jobs_project ON public.work_jobs USING btree (project_id, kind) WHERE (project_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_jobs_project_kind_live ON public.work_jobs USING btree (project_id, kind) WHERE ((project_id IS NOT NULL) AND (schedule_id IS NULL) AND (status <> 'cancelled'::text));
COMMENT ON COLUMN public.work_jobs.project_id IS '이 작업이 속한 프로젝트 — 프로젝트 「작업 배정」에서 만든 작업. 프로젝트 하나 · 종류 하나에 살아 있는 작업 하나 (일정에서 생긴 작업은 세지 않는다). 프로젝트가 지워지면 비운다';

-- 4) 「이 일로 바로」 초대 --------------------------------------------------------------

ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_job_id_fkey;
ALTER TABLE public.worker_invites
    ADD CONSTRAINT worker_invites_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.worker_invites.job_id IS '이 초대가 이어지는 작업 — 초대로 온 작업자의 연결을 팩토리가 승인하면 서버가 이 작업에 배정 제안을 넣는다. 비면 연결만';
