-- =============================================
-- 0024 — 공장 작업자를 계정으로
--
-- 공장 작업자도 작업자 계정(workers)으로 들어와 공장 일(재단 · 엣지 · 조립 기록)을 한다.
-- 지금까지는 계정 없는 생산 링크(production_worker_links) 하나 = 작업자 이름 하나였다.
--   workers.kinds · worker_invites.kinds_preset   작업자 종류에 cutting(재단) · edge(엣지)를 더한다.
--     공장 조립은 지금 assembly(조립) 종류로 함께 쓴다. 작업(모집) 종류 work_jobs.kind 는 그대로 install · as · assembly.
--   factory_workers  공장 배정 — 어느 작업자가 누구의 생산 계획을 보나 (생산 링크의 user_id 와 같은 뜻).
--     본사가 승인된 작업자를 배정하거나(link_id 비움), 생산 링크를 받은 사람이 「내 계정에 잇기」로 만든다(link_id).
--     작업자 하나에 열린(ended_at 비움) 배정은 하나뿐, 링크 하나는 한 번만 잇는다.
--     읽기 · 쓰기 모두 서버(service_role) — 화면은 서버를 거친다.
--   production_worklogs.worker_id  계정으로 남긴 기록의 작업자 (링크로 남긴 기록은 비움 — 잇기 때 서버가 채운다).
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 작업자 종류 -------------------------------------------------------------------

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_kinds_chk;
ALTER TABLE public.workers
    ADD CONSTRAINT workers_kinds_chk CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text]);

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_kinds_chk;
ALTER TABLE public.worker_invites
    ADD CONSTRAINT worker_invites_kinds_chk CHECK (kinds_preset <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text]);

-- 2) 공장 배정 ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.factory_workers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id uuid NOT NULL,
    plan_user_id uuid NOT NULL,
    link_id uuid,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_by uuid,
    ended_at timestamp with time zone,
    CONSTRAINT factory_workers_pkey PRIMARY KEY (id),
    CONSTRAINT factory_workers_ended_check CHECK (ended_at IS NULL OR ended_at >= assigned_at),
    CONSTRAINT factory_workers_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE,
    CONSTRAINT factory_workers_plan_user_id_fkey FOREIGN KEY (plan_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT factory_workers_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.production_worker_links(id) ON DELETE SET NULL,
    CONSTRAINT factory_workers_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT factory_workers_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.factory_workers IS '공장 배정 — 작업자 계정이 누구의 생산 계획을 보나. 열린 배정은 작업자마다 하나, 링크 하나는 한 번만 잇는다. 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS factory_workers_one_open ON public.factory_workers USING btree (worker_id) WHERE (ended_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS factory_workers_link_once ON public.factory_workers USING btree (link_id) WHERE (link_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_factory_workers_plan ON public.factory_workers USING btree (plan_user_id, assigned_at DESC) WHERE (ended_at IS NULL);

ALTER TABLE public.factory_workers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.factory_workers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.factory_workers TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.factory_workers FROM service_role;

-- 3) 기록의 작업자 -----------------------------------------------------------------

ALTER TABLE public.production_worklogs ADD COLUMN IF NOT EXISTS worker_id uuid;

ALTER TABLE public.production_worklogs DROP CONSTRAINT IF EXISTS production_worklogs_worker_id_fkey;
ALTER TABLE public.production_worklogs
    ADD CONSTRAINT production_worklogs_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prod_worklogs_worker_date ON public.production_worklogs USING btree (worker_id, work_date DESC) WHERE (worker_id IS NOT NULL);

COMMENT ON COLUMN public.production_worklogs.worker_id IS '계정으로 남긴 기록의 작업자 (workers.id). 링크로 남긴 기록은 비움 — 「내 계정에 잇기」 때 서버가 채운다';
