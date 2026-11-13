-- =============================================
-- 0064 작업자 ↔ 팩토리 연결 — 팩토리마다 자기 작업자 (2026-11-13 사장님 결정 · 「작업자 한 길」)
--
--   지금까지 작업자(workers)는 본사가 승인하는 풀 하나였다. 이제 작업자 계정은 하나 그대로 두고,
--   팩토리(다담 공장 · Agent 협력업체)마다 「연결」 줄을 둔다. 한 작업자가 여러 팩토리와 연결될 수 있고,
--   팩토리는 자기와 연결된 작업자만 보고 배정한다. 초대 링크로 와도 초대한 팩토리가 승인해야 연결된다.
--   배정은 설치 · A/S 일정 줄에서 시작한다 — 일정과 작업(work_jobs)을 잇는 칸을 더한다.
--
-- 바꾸는 것:
--   1) worker_companies — 한 줄 = 작업자 한 명 × 팩토리 한 곳.
--        status   pending 대기 · approved 승인 · suspended 정지 · rejected 반려 · ended 연결 끝
--        kinds    그 팩토리가 이 작업자에게 맡기는 종류 (install · as · assembly · cutting · edge)
--        via      invite 초대 링크 · public 초대 없는 공개 신청(다담 공장이 받는다) · migrated 0064 가 옮긴 줄
--        reason   반려 · 정지 사유 (200자) — 고객 이름 · 전화 · 주소를 넣지 않는다
--        작업자가 지워지면 연결도 지운다. 연결 줄을 서버가 지우지는 않는다 (끝은 status ended).
--   2) worker_invites.company_id · revoked_at — 어느 팩토리의 초대인가 (비면 옛 본사 초대 = 다담 공장), 거둔 때.
--   3) work_jobs.schedule_id — 그 작업이 생긴 일정(design_schedules). 일정이 지워지면 비운다.
--        일정 하나에 살아 있는(취소 아님) 작업은 하나.
--   4) 지금 작업자를 모두 다담 공장 연결로 옮긴다 (상태 · 종류 · 승인 기록 그대로). 다시 돌려도 같은 결과.
--   5) 앱 알림 종류 셋 — 팩토리 대표 · 실장에게 간다 (업체 칸이 있어야 한다 — notification_outbox_company_check 그대로)
--        work_link_request  작업자가 연결을 신청함
--        work_reply         작업자가 배정을 수락 · 거절 · 포기함
--        work_report        작업자가 완료 · 문제를 보고함
--   6) 이력의 하는 사람 종류에 member — 팩토리 대표 · 실장 (worker_events · work_job_events)
--
-- 바꾸지 않는 것
--   workers.status — 계정 상태로 남는다 (어느 팩토리든 처음 승인하면 서버가 approved 로, 전역 정지는 사이트 관리자).
--   작업자 표들의 읽기 정책(관리자) · 권한, 공장 배정(factory_workers).
--
-- 읽기 · 쓰기: worker_companies 는 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다.
-- 다시 돌려도 된다.
-- =============================================

-- 1) 작업자 ↔ 팩토리 연결 ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.worker_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    kinds text[] DEFAULT '{}'::text[] NOT NULL,
    via text NOT NULL,
    invite_id uuid,
    decided_by uuid,
    decided_at timestamp with time zone,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_companies_pkey PRIMARY KEY (id),
    CONSTRAINT worker_companies_pair_key UNIQUE (company_id, worker_id),
    CONSTRAINT worker_companies_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text, 'ended'::text])),
    CONSTRAINT worker_companies_kinds_check CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text]),
    CONSTRAINT worker_companies_via_check CHECK (via = ANY (ARRAY['invite'::text, 'public'::text, 'migrated'::text])),
    CONSTRAINT worker_companies_reason_check CHECK (COALESCE(length(reason), 0) <= 200),
    CONSTRAINT worker_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT worker_companies_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE,
    CONSTRAINT worker_companies_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.worker_invites(id) ON DELETE SET NULL,
    CONSTRAINT worker_companies_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.worker_companies IS '작업자 ↔ 팩토리 연결 — 한 줄 = 작업자 한 명 × 팩토리 한 곳 (2026-11-13 작업자 한 길). 대기 pending · 승인 approved · 정지 suspended · 반려 rejected · 끝 ended. 팩토리는 자기와 연결된 작업자만 본다. reason 에 고객 이름 · 전화 · 주소를 넣지 않는다. 서버만';

CREATE INDEX IF NOT EXISTS idx_worker_companies_company ON public.worker_companies USING btree (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_companies_worker ON public.worker_companies USING btree (worker_id, status);

ALTER TABLE public.worker_companies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_companies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_companies TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.worker_companies FROM service_role;

-- 2) 초대 — 어느 팩토리의 초대인가 · 거둔 때 --------------------------------------------

ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone;

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_company_id_fkey;
ALTER TABLE public.worker_invites
    ADD CONSTRAINT worker_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);

CREATE INDEX IF NOT EXISTS idx_worker_invites_company ON public.worker_invites USING btree (company_id, created_at DESC) WHERE (company_id IS NOT NULL);

COMMENT ON COLUMN public.worker_invites.company_id IS '초대한 팩토리 — 비면 옛 본사 초대(다담 공장 연결로 받는다)';
COMMENT ON COLUMN public.worker_invites.revoked_at IS '거둔 때 — 거둔 초대는 못 쓴다';

-- 3) 작업 ↔ 일정 ------------------------------------------------------------------

ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS schedule_id uuid;

ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_schedule_id_fkey;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.design_schedules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_jobs_schedule_live ON public.work_jobs USING btree (schedule_id) WHERE ((schedule_id IS NOT NULL) AND (status <> 'cancelled'::text));

COMMENT ON COLUMN public.work_jobs.schedule_id IS '이 작업이 생긴 일정(설치 · A/S 방문) — 일정 하나에 살아 있는 작업 하나. 일정이 지워지면 비운다';

-- 4) 지금 작업자 → 다담 공장 연결 ------------------------------------------------------

INSERT INTO public.worker_companies (company_id, worker_id, status, kinds, via, invite_id, decided_by, decided_at, reason, created_at)
SELECT public.hq_company_id(), w.id, w.status, w.kinds, 'migrated', w.invited_via, w.approved_by, w.approved_at, w.reject_reason, w.created_at
  FROM public.workers w
 WHERE public.hq_company_id() IS NOT NULL
ON CONFLICT (company_id, worker_id) DO NOTHING;

-- 5) 앱 알림 종류 — 0053 목록(20개) 그대로 + 팩토리 대표 · 실장용 셋 = 23개 ----------------

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text, 'work_link_request'::text, 'work_reply'::text, 'work_report'::text]));

-- 6) 이력 — 하는 사람 종류에 팩토리 대표 · 실장(member) ---------------------------------

ALTER TABLE public.work_job_events DROP CONSTRAINT IF EXISTS work_job_events_actor_chk;
ALTER TABLE public.work_job_events
    ADD CONSTRAINT work_job_events_actor_chk CHECK (actor_kind = ANY (ARRAY['worker'::text, 'admin'::text, 'system'::text, 'member'::text]));

ALTER TABLE public.worker_events DROP CONSTRAINT IF EXISTS worker_events_actor_chk;
ALTER TABLE public.worker_events
    ADD CONSTRAINT worker_events_actor_chk CHECK (actor_kind = ANY (ARRAY['worker'::text, 'admin'::text, 'system'::text, 'member'::text]));
