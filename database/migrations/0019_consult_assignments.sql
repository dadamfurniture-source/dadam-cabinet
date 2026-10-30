-- =============================================
-- 0019 — 상담 배정 (다담 본사 → 업체 풀)
--
-- 본사가 상담을 업체(협력업체 · 다담 공장)에 배정하면 서버가 그 업체 company_id 로 상담 사본 행을 넣는다.
--   consultations 칸
--     door_finish           원하는 도어 마감 pet | highgloss | paint | veneer | ceramic | unknown
--     demolition_needed     철거 필요
--     wanted_price_tier     원하는 가격대 basic | mid | high | unknown
--     origin_consultation_id 사본이면 본사 원래 상담 (서버만 넣는다)
--     third_party_agreed_at · consent_version  업체 제공 동의(협력업체 목록 중 본사가 정한 곳) 시각 · 문구 판
--     status 값: pending · confirmed · completed · cancelled + assigned(본사 상담이 업체에 나감) · returned(업체가 못 받거나 무응답으로 돌려보냄)
--   consult_assignments  배정 한 번 = 한 줄. 본사 상담 · 받은 업체 · 업체 사본 · 순위 · 점수 내역 · 결과(assigned → accepted | declined | expired)
--     본사 상담 하나에 기다리는(assigned) 배정은 하나뿐.
--     읽기: 관리자(본사)는 모두, 업체 대표 · 실장은 자기 업체 줄. 순위 · 점수 칸은 화면이 직접 읽지 못한다(서버만).
--   쓰기는 모두 서버(service_role).
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 상담 칸 -----------------------------------------------------------------------

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS door_finish text;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS demolition_needed boolean;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS wanted_price_tier text;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS origin_consultation_id uuid;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS third_party_agreed_at timestamp with time zone;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS consent_version text;

ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_door_finish_check;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_door_finish_check CHECK (door_finish IS NULL OR door_finish = ANY (ARRAY['pet'::text, 'highgloss'::text, 'paint'::text, 'veneer'::text, 'ceramic'::text, 'unknown'::text]));
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_wanted_price_tier_check;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_wanted_price_tier_check CHECK (wanted_price_tier IS NULL OR wanted_price_tier = ANY (ARRAY['basic'::text, 'mid'::text, 'high'::text, 'unknown'::text]));
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_consent_version_check;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_consent_version_check CHECK (consent_version IS NULL OR length(consent_version) <= 40);
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_status_check;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_status_check CHECK (status IS NULL OR status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'assigned'::text, 'returned'::text]));
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_origin_fkey;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_origin_fkey FOREIGN KEY (origin_consultation_id) REFERENCES public.consultations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_consultations_origin ON public.consultations USING btree (origin_consultation_id) WHERE (origin_consultation_id IS NOT NULL);

-- 넣기 정책: 사본 칸은 서버만 (0017 정책에 origin 조건만 더함)
DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL))
        AND company_id = (SELECT public.platform_company_id()) AND customer_id IS NULL AND project_id IS NULL
        AND origin_consultation_id IS NULL);

-- 2) 배정 기록 -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consult_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid NOT NULL,
    company_id uuid NOT NULL,
    copy_consultation_id uuid,
    rank integer,
    total integer,
    score jsonb DEFAULT '{}'::jsonb NOT NULL,
    state text DEFAULT 'assigned'::text NOT NULL,
    reason text,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_by uuid,
    responded_at timestamp with time zone,
    CONSTRAINT consult_assignments_pkey PRIMARY KEY (id),
    CONSTRAINT consult_assignments_state_check CHECK (state = ANY (ARRAY['assigned'::text, 'accepted'::text, 'declined'::text, 'expired'::text])),
    CONSTRAINT consult_assignments_responded_check CHECK ((state = 'assigned'::text) = (responded_at IS NULL)),
    CONSTRAINT consult_assignments_score_check CHECK (jsonb_typeof(score) = 'object' AND (rank IS NULL OR rank >= 1) AND (total IS NULL OR total BETWEEN 0 AND 100)),
    CONSTRAINT consult_assignments_reason_check CHECK (reason IS NULL OR length(reason) <= 500),
    CONSTRAINT consult_assignments_consultation_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE,
    CONSTRAINT consult_assignments_copy_fkey FOREIGN KEY (copy_consultation_id) REFERENCES public.consultations(id) ON DELETE SET NULL,
    CONSTRAINT consult_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT consult_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT consult_assignments_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.consult_assignments IS '상담 배정 — 본사 상담을 업체에 나눈 기록(순위 · 점수 내역 · 결과). 쓰기는 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS consult_assignments_one_open ON public.consult_assignments USING btree (consultation_id) WHERE (state = 'assigned'::text);
CREATE INDEX IF NOT EXISTS idx_consult_assignments_company ON public.consult_assignments USING btree (company_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_assignments_open ON public.consult_assignments USING btree (assigned_at) WHERE (state = 'assigned'::text);

ALTER TABLE public.consult_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.consult_assignments FROM PUBLIC, anon, authenticated;
-- 순위 · 점수 내역(rank · total · score)은 화면이 직접 읽지 못한다 — 서버가 본사 화면에만 준다
GRANT SELECT (id, consultation_id, company_id, copy_consultation_id, state, reason, assigned_by, assigned_at, responded_by, responded_at) ON TABLE public.consult_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.consult_assignments TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.consult_assignments FROM service_role;

DROP POLICY IF EXISTS consult_assignments_admin_read ON public.consult_assignments;
CREATE POLICY consult_assignments_admin_read ON public.consult_assignments
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS consult_assignments_manager_read ON public.consult_assignments;
CREATE POLICY consult_assignments_manager_read ON public.consult_assignments
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));
