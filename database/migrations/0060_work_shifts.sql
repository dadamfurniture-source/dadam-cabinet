-- =============================================
-- 0060 근무 일정 — 쉬는 날만 적는다 (2026-11-12 마이페이지 6단계 · 사장님 결정 ④)
--
--   마이페이지 인사 › 근무 일정 화면의 바탕. 지금까지 표가 없었다.
--   적지 않은 날은 「근무」로 본다. 적는 것은 쉬는 날뿐 — 휴무(off) · 연차(leave) · 반차(half) · 외근(out).
--   대표 · 실장이 적고 구성원 모두가 본다 (서버가 가른다). 출근 · 퇴근 시간(근태)은 다루지 않는다.
--
-- 바꾸는 것:
--   1) work_shifts — 한 사람의 하루 = 한 줄.
--        사람은 업체 구성원(member_user_id → auth.users) 또는 공장 작업자(worker_id → workers) 가운데 하나만.
--        한 사람 하루에 한 줄 (부분 고유 색인 둘). 사람이 지워지면 그 사람의 줄도 지운다.
--        note  짧은 메모(100자) — 고객 이름 · 전화 · 주소를 넣지 않는다
--
-- 읽기 · 쓰기: 서버(service_role)만. 정책이 없어 브라우저(anon · authenticated)는 읽지 못한다.
--   쉬는 날을 지우면 그날은 다시 「근무」다 — 장부가 아니라서 서버는 지울 수 있다.
-- =============================================

CREATE TABLE IF NOT EXISTS public.work_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    member_user_id uuid,
    worker_id uuid,
    work_date date NOT NULL,
    kind text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_shifts_pkey PRIMARY KEY (id),
    CONSTRAINT work_shifts_person_check CHECK ((member_user_id IS NULL) <> (worker_id IS NULL)),
    CONSTRAINT work_shifts_kind_check CHECK (kind = ANY (ARRAY['off'::text, 'leave'::text, 'half'::text, 'out'::text])),
    CONSTRAINT work_shifts_note_check CHECK (COALESCE(length(note), 0) <= 100),
    CONSTRAINT work_shifts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT work_shifts_member_fkey FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT work_shifts_worker_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE,
    CONSTRAINT work_shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.work_shifts IS '근무 일정 — 쉬는 날만 (휴무 off · 연차 leave · 반차 half · 외근 out). 적지 않은 날은 근무 (2026-11-12 마이페이지 6단계). 사람은 업체 구성원 또는 공장 작업자 하나. note 에 고객 이름 · 전화 · 주소를 넣지 않는다. 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_member_day ON public.work_shifts USING btree (company_id, member_user_id, work_date) WHERE (member_user_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_worker_day ON public.work_shifts USING btree (company_id, worker_id, work_date) WHERE (worker_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_work_shifts_company_day ON public.work_shifts USING btree (company_id, work_date);

ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.work_shifts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.work_shifts TO service_role;
REVOKE TRUNCATE ON TABLE public.work_shifts FROM service_role;
