-- =============================================
-- 0066 납품 작업자 · 팩토리의 작업자 메모
--      (2026-11-14 사장님 결정 · 「작업자 한 길」 2차로 미뤄 둔 것)
--
--   설치 · A/S 표의 「납품」 일정 줄에도 작업자를 배정한다 — 납품은 따로 종류를 둔다 (설치 작업자와 가른다).
--   팩토리 대표 · 실장이 연결된 작업자에 대해 메모를 남긴다 (인사 › 작업자).
--
-- 바꾸는 것:
--   1) 작업자 · 작업 종류에 delivery(납품) — 넷 모두 같은 일곱
--        install 설치 · as A/S · assembly 조립 · cutting 재단 · edge 엣지 · demolition 철거 · delivery 납품
--        workers.kinds · worker_invites.kinds_preset · worker_companies.kinds · work_jobs.kind
--   2) worker_company_notes — 팩토리가 연결된 작업자에 대해 남기는 메모. 한 줄 = 메모 한 번.
--        연결 줄(worker_companies)에 붙는다. 같은 팩토리의 연결에만 붙는다 ((link_id, company_id) 외래 키)
--        — 그래서 worker_companies 에 UNIQUE (id, company_id) 를 더한다 (projects · designs 와 같은 방식, 0006).
--        쌓기만 한다 — 서버도 고치거나 지우지 못한다 (PC 관리자 메모 worker_notes 와 같다).
--        연결 줄이 지워지면(작업자 탈퇴) 메모도 같이 지워진다.
--
-- 바꾸지 않는 것
--   일정 종류(design_schedules.type — 납품 delivery 는 이미 있다), 알림 종류, 작업 표들의 권한 · 정책,
--   PC 관리자 메모(worker_notes — 사이트 관리자의 것 그대로).
--
-- 읽기 · 쓰기: worker_company_notes 는 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다.
--   서버는 그 팩토리의 대표 · 실장에게만 돌려준다 — 작업자 본인 · 다른 팩토리 · 사이트 관리자 화면에는 나가지 않는다.
-- 0064 · 0065 를 먼저 적용해야 한다. 다시 돌려도 된다.
-- =============================================

-- 1) 작업자 · 작업 종류에 납품 ----------------------------------------------------------

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_kinds_chk;
ALTER TABLE public.workers
    ADD CONSTRAINT workers_kinds_chk CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text, 'delivery'::text]);

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_kinds_chk;
ALTER TABLE public.worker_invites
    ADD CONSTRAINT worker_invites_kinds_chk CHECK (kinds_preset <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text, 'delivery'::text]);

ALTER TABLE public.worker_companies DROP CONSTRAINT IF EXISTS worker_companies_kinds_check;
ALTER TABLE public.worker_companies
    ADD CONSTRAINT worker_companies_kinds_check CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text, 'delivery'::text]);

ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_kind_chk;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_kind_chk CHECK (kind = ANY (ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text, 'delivery'::text]));

-- 2) 팩토리의 작업자 메모 ----------------------------------------------------------------

-- 다시 돌릴 때: 메모 표의 외래 키가 아래 유니크에 기대므로 먼저 뗀다 (표가 아직 없으면 지나간다)
ALTER TABLE IF EXISTS public.worker_company_notes DROP CONSTRAINT IF EXISTS worker_company_notes_link_fkey;

ALTER TABLE public.worker_companies DROP CONSTRAINT IF EXISTS worker_companies_id_company_id_key;
ALTER TABLE public.worker_companies ADD CONSTRAINT worker_companies_id_company_id_key UNIQUE (id, company_id);

CREATE TABLE IF NOT EXISTS public.worker_company_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    link_id uuid NOT NULL,
    company_id uuid NOT NULL,
    author uuid,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_company_notes_pkey PRIMARY KEY (id),
    CONSTRAINT worker_company_notes_len_chk CHECK ((length(note) >= 1) AND (length(note) <= 1000)),
    CONSTRAINT worker_company_notes_author_fkey FOREIGN KEY (author) REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.worker_company_notes
    ADD CONSTRAINT worker_company_notes_link_fkey FOREIGN KEY (link_id, company_id) REFERENCES public.worker_companies(id, company_id) ON DELETE CASCADE;

COMMENT ON TABLE public.worker_company_notes IS '팩토리가 연결된 작업자에 대해 남기는 메모 — 한 줄 = 메모 한 번 (2026-11-14). 그 팩토리의 대표 · 실장만 읽는다 (서버가 거른다). 작업자 본인 · 다른 팩토리에는 나가지 않는다. 쌓기만 한다 (고치기 · 지우기 없음). 고객 이름 · 전화 · 주소를 넣지 않는다. 서버만';
COMMENT ON COLUMN public.worker_company_notes.link_id IS '메모가 붙는 연결 줄 (worker_companies) — 같은 팩토리의 연결에만 붙는다. 연결 줄이 지워지면 같이 지워진다';
COMMENT ON COLUMN public.worker_company_notes.author IS '메모를 남긴 구성원 — 계정이 지워지면 비운다';

CREATE INDEX IF NOT EXISTS idx_worker_company_notes_link ON public.worker_company_notes USING btree (link_id, created_at DESC);

ALTER TABLE public.worker_company_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_company_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.worker_company_notes TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.worker_company_notes FROM service_role;
