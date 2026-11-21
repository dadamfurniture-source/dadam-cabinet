-- =============================================
-- 0077 사업자등록증 등록 시 첫 달 무료 (2026-11-21 대표님 계획 승인)
--
-- 대표님이 고른 것: 새로 시작하는 업체 · 모든 등급 / 카드를 먼저 받고 30일 뒤 자동 결제 /
--                   자동 확인, 의심 건만 본사 검토 / 사업자번호당 1회 · 계속사업자만.
--
-- 흐름: 사업자등록증 사진을 올린다(account-api POST /partner/cert) → AI 가 읽은 값을 사람이 확인한다
--       → 자동 확인(검증 숫자 · 국세청 상태 · 진위 · 이미 받은 번호인가) → verified | review | rejected
--       → verified 면 카드 등록 때 첫 결제를 건너뛰고 구독을 trialing 으로 시작한다(payments-api POST /issue-billing-key)
--       → 30일째 cron 이 첫 결제. subscriptions.status 의 trialing 값은 기준선부터 있었다(쓰는 코드가 없었을 뿐).
--
-- 1) 표 business_certificates — 올린 사업자등록증 한 장 = 한 줄. 서버만 읽고 쓴다.
--      상태 status
--        uploaded    올렸다 (AI 가 읽는 중이거나 읽은 값을 사람이 아직 확인하지 않음)
--        verified    자동 확인 통과 또는 본사 승인 — 무료를 시작할 수 있다
--        review      본사 검토를 기다림 (review_reason 에 까닭 코드)
--        rejected    자동 확인에서 막혔거나 본사가 반려 (decision_reason)
--        superseded  같은 사람이 새로 올려 옛 것이 됨
--      한 사람에게 살아 있는 줄(uploaded · verified · review)은 하나 — 새로 올리면 옛 줄을 superseded 로 돌린 뒤 넣는다.
--      extracted = AI 가 읽은 값(번호 · 상호 · 대표자 · 개업일), 사람이 확인한 값은 biz_no · company_name ·
--      representative_name · open_date 칸. checks = 자동 확인 결과(검증 숫자 · 국세청 상태 · 진위 · 겹침).
--      사진은 비공개 버킷 business-certs (5) — 주소는 서버가 서명해 10분만 준다.
-- 2) 표 trial_grants — 첫 달 무료를 준 기록. biz_no 유니크 = 사업자번호당 1회 (해지 뒤 다시 와도 못 받는다).
--      지우지 않는다. 구독 저장이 실패해 되돌릴 때만 서버가 그 줄을 지운다 (payments-api undo).
-- 3) companies 칸 셋 — biz_no(숫자 10자리) · representative_name · biz_verified_at.
--      무료로 시작한 업체에 확인된 사업자 정보를 남긴다. 다른 업체는 비어 있다.
-- 4) 앱 알림 종류 셋 — 0074 목록(25개) 그대로 + 셋 = 28개
--      trial_ending        무료가 곧 끝난다 (7일 전 · 1일 전) → 업체 대표
--      biz_cert_review     검토할 사업자등록증이 생겼다 → 본사 대표 · 실장
--      biz_cert_decided    검토 결과(승인 · 반려) → 올린 사람 (업체가 아직 없을 수 있다 — 업체 없이 넣을 수 있는 종류에 더한다)
-- 5) 비공개 버킷 business-certs — 5MB · jpeg · png, 정책 없음(서버만). 0027 ledger-evidence 와 같은 꼴.
--
-- 그대로 두는 것: subscriptions 의 칸 · 제약(trialing 은 이미 허용, 업체당 살아 있는 구독 하나에도 이미 든다),
--                 등급 관문(업체가 active 이고 등급이 있으면 열린다), 결제 · 환불 규칙.
-- 다시 돌려도 된다 (IF NOT EXISTS · DROP … IF EXISTS 다음 ADD · ON CONFLICT).
-- =============================================

-- 1) 사업자등록증 ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    storage_path text NOT NULL,
    mime text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    extracted jsonb,
    biz_no text,
    company_name text,
    representative_name text,
    open_date date,
    checks jsonb,
    review_reason text,
    confirmed_at timestamp with time zone,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_certificates_pkey PRIMARY KEY (id),
    CONSTRAINT business_certificates_path_key UNIQUE (storage_path),
    CONSTRAINT business_certificates_mime_check CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text])),
    CONSTRAINT business_certificates_size_check CHECK (size_bytes BETWEEN 1 AND 5242880),
    CONSTRAINT business_certificates_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT business_certificates_status_check CHECK (status = ANY (ARRAY['uploaded'::text, 'verified'::text, 'review'::text, 'rejected'::text, 'superseded'::text])),
    CONSTRAINT business_certificates_biz_no_check CHECK ((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$')),
    CONSTRAINT business_certificates_len_check CHECK (
        (length(storage_path) BETWEEN 1 AND 300)
        AND ((company_name IS NULL) OR (length(company_name) BETWEEN 1 AND 100))
        AND ((representative_name IS NULL) OR (length(representative_name) BETWEEN 1 AND 60))
        AND ((review_reason IS NULL) OR (length(review_reason) BETWEEN 1 AND 60))
        AND ((decision_reason IS NULL) OR (length(decision_reason) BETWEEN 1 AND 300))),
    -- 통과 · 검토로 간 줄에는 사람이 확인한 번호가 있다
    CONSTRAINT business_certificates_confirmed_check CHECK ((status <> ALL (ARRAY['verified'::text, 'review'::text])) OR (biz_no IS NOT NULL)),
    CONSTRAINT business_certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT business_certificates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL,
    CONSTRAINT business_certificates_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.business_certificates IS '사업자등록증 — 올린 사진 한 장 = 한 줄. 비공개 버킷 business-certs. 상태 uploaded(올림) · verified(확인됨) · review(본사 검토) · rejected(반려) · superseded(새로 올려 옛 것). 한 사람에게 살아 있는 줄은 하나. 서버만 (0077)';
COMMENT ON COLUMN public.business_certificates.extracted IS 'AI 가 사진에서 읽은 값 { biz_no, company_name, representative_name, open_date } — 사람이 확인하기 전 값';
COMMENT ON COLUMN public.business_certificates.checks IS '자동 확인 결과 { checksum, nts_status, nts_valid, duplicate, edited } — 왜 통과 · 검토 · 반려인지';
COMMENT ON COLUMN public.business_certificates.review_reason IS '본사 검토로 넘긴 까닭 코드 (unreadable · edited · nts_mismatch · nts_unavailable)';

-- 한 사람에게 살아 있는 줄은 하나
CREATE UNIQUE INDEX IF NOT EXISTS business_certificates_one_live_per_user
    ON public.business_certificates USING btree (user_id)
    WHERE (status = ANY (ARRAY['uploaded'::text, 'verified'::text, 'review'::text]));
-- 본사 검토 목록 — 기다리는 것부터
CREATE INDEX IF NOT EXISTS idx_business_certificates_status ON public.business_certificates USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_certificates_biz_no ON public.business_certificates USING btree (biz_no) WHERE (biz_no IS NOT NULL);

ALTER TABLE public.business_certificates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_certificates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_certificates TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.business_certificates FROM service_role;

-- 2) 첫 달 무료를 준 기록 — 사업자번호당 1회 ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.trial_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    biz_no text NOT NULL,
    certificate_id uuid,
    user_id uuid,
    company_id uuid,
    subscription_id uuid,
    plan text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_grants_pkey PRIMARY KEY (id),
    CONSTRAINT trial_grants_biz_no_key UNIQUE (biz_no),
    CONSTRAINT trial_grants_biz_no_check CHECK (biz_no ~ '^[0-9]{10}$'),
    CONSTRAINT trial_grants_plan_check CHECK (plan = ANY (ARRAY['manager'::text, 'expert'::text, 'agent'::text])),
    CONSTRAINT trial_grants_period_check CHECK (ends_at > started_at),
    CONSTRAINT trial_grants_certificate_id_fkey FOREIGN KEY (certificate_id) REFERENCES public.business_certificates(id) ON DELETE SET NULL,
    CONSTRAINT trial_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT trial_grants_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL,
    CONSTRAINT trial_grants_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.trial_grants IS '첫 달 무료를 준 기록 — biz_no 유니크 = 사업자번호당 1회 (회원 · 업체 · 구독이 지워져도 번호는 남는다). 구독 저장을 되돌릴 때만 서버가 지운다. 서버만 (0077)';

CREATE INDEX IF NOT EXISTS idx_trial_grants_company ON public.trial_grants USING btree (company_id) WHERE (company_id IS NOT NULL);

ALTER TABLE public.trial_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trial_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trial_grants TO service_role;
REVOKE TRUNCATE ON TABLE public.trial_grants FROM service_role;

-- 3) 업체의 사업자 정보 -------------------------------------------------------------------

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS biz_no text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS representative_name text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS biz_verified_at timestamp with time zone;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_biz_no_check;
ALTER TABLE public.companies
    ADD CONSTRAINT companies_biz_no_check CHECK (
        ((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$'))
        AND ((representative_name IS NULL) OR (length(representative_name) BETWEEN 1 AND 60)));

COMMENT ON COLUMN public.companies.biz_no IS '확인된 사업자등록번호 — 숫자 10자리. 사업자등록증으로 무료를 시작한 업체에만 있다 (0077)';
COMMENT ON COLUMN public.companies.representative_name IS '사업자등록증의 대표자 이름 (0077)';
COMMENT ON COLUMN public.companies.biz_verified_at IS '사업자등록증을 확인한 때 (0077)';

-- 4) 앱 알림 종류 — 0074 목록(25개) 그대로 + 셋 = 28개 ---------------------------------------

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text, 'work_link_request'::text, 'work_reply'::text, 'work_report'::text, 'system_check_failed'::text, 'stock_band_low'::text, 'trial_ending'::text, 'biz_cert_review'::text, 'biz_cert_decided'::text]));

-- 업체 없이 넣을 수 있는 종류 — 0023 목록 그대로 + 검토 결과(올린 사람에게 업체가 아직 없다)
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_company_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_company_check CHECK (company_id IS NOT NULL OR kind = ANY (ARRAY['partner_application'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'biz_cert_decided'::text]));

COMMENT ON TABLE public.notification_outbox IS '보낼 앱 알림 — 한 줄 = 받는 사람 한 명. 업체 없이는 업체 신청 · 작업자 알림 · 사업자등록증 검토 결과만. 글에 고객 이름 · 전화 · 주소 · 금액 없음, 열 곳은 /segan/ 만. 서버(service_role)만';

-- 5) 사진 버킷 (비공개, 정책 없음 — 서버만) -------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('business-certs', 'business-certs', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
