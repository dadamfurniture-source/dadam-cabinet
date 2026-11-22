-- =============================================
-- 0082 고객 초대 링크 · 고객이 설치 날을 확인 · 바꿔 달라고 요청 · 영업 사원 업체 고객의 A/S 를 만든 팩토리가 받는다
--      (2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 — 「1번으로 처리」 · 「진행」)
--
--   대표님이 정한 것 (2026-11-23):
--     · 영업 사원 업체(Manager 등급) 고객의 A/S 는 ① 만든 팩토리가 바로 받고, 영업 사원 업체는 알림을 받고 본다.
--
-- 바꾸는 것:
--   1) customer_invites — 업체가 고객에게 보내는 초대 링크. 고객이 링크로 로그인하면 그 고객 줄(customers)이
--        그 계정과 이어지고, 고객은 앱 「내 프로젝트」에서 그 프로젝트를 본다.
--        토큰은 만든 응답에서 한 번만 평문으로 주고 DB 에는 해시만 둔다(작업자 초대 work/invites.js 와 같은 방식).
--        한 번만 쓴다(used_at · used_by). 거두면 revoked_at. 만료(expires_at)는 만든 때보다 뒤.
--        고객 · 프로젝트는 같은 업체의 것만 (복합 FK). 프로젝트가 지워지면 초대도 지워진다.
--        서버(service_role)만 쓰고 읽는다.
--   2) design_schedules — 고객이 앱에서 「바꿔 주세요」를 누른 요청 칸 셋 (날짜는 업체가 고친다)
--        customer_change_requested_at 요청한 때 · customer_change_by 요청한 사람 · customer_change_note 바라는 것(200자까지)
--      「이 날 좋아요」는 0079 의 customer_confirmed_at · _by 를 고객이 직접 채운다(서버가 적는다).
--      날짜를 바꾸면 서버가 확인 · 요청을 모두 지운다.
--   3) as_requests — 처리하는 업체 칸 둘
--        handler_company_id · handler_project_id  영업 사원 업체의 수주에 들어온 A/S 를 받아 처리하는 팩토리와 그 쪽 프로젝트
--        (제작 의뢰를 받은 팩토리 — production_requests.factory_company_id · factory_project_id).
--        비어 있으면 지금처럼 수주한 업체(company_id)가 처리한다. 접수 때 정하고 바꾸지 않는다(지킴이).
--        그 팩토리 구성원도 그 접수를 읽는다 (읽기 정책 하나 더).
--   4) 앱 알림 종류 둘 — as_factory(영업 사원 업체에: 만든 팩토리가 처리합니다) · install_change(고객이 설치 날을 바꿔 달라고)
--
-- 이미 있는 줄은 바뀌지 않는다 (새 칸은 모두 비어 있다).
-- =============================================

-- 1) 고객 초대 링크 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    project_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone,
    used_by uuid,
    revoked_at timestamp with time zone,
    CONSTRAINT customer_invites_pkey PRIMARY KEY (id),
    CONSTRAINT customer_invites_token_hash_key UNIQUE (token_hash),
    CONSTRAINT customer_invites_token_check CHECK (length(token_hash) BETWEEN 32 AND 128),
    CONSTRAINT customer_invites_expires_check CHECK (expires_at > created_at),
    CONSTRAINT customer_invites_used_check CHECK ((used_by IS NULL) OR (used_at IS NOT NULL)),
    CONSTRAINT customer_invites_once_check CHECK ((used_at IS NULL) OR (revoked_at IS NULL)),
    CONSTRAINT customer_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT customer_invites_customer_fkey FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id) ON DELETE CASCADE,
    CONSTRAINT customer_invites_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE,
    CONSTRAINT customer_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT customer_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.customer_invites IS '고객 초대 링크 — 업체가 만들고 고객이 한 번 쓴다 (0082 · 2026-11-23 뒤 공정 3차). 토큰은 해시만. 서버만 쓰고 읽는다';

CREATE INDEX IF NOT EXISTS idx_customer_invites_project ON public.customer_invites USING btree (project_id, created_at DESC);

ALTER TABLE public.customer_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_invites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_invites TO service_role;

-- 2) 고객의 설치 날 변경 요청 -------------------------------------------------------------
ALTER TABLE public.design_schedules
    ADD COLUMN IF NOT EXISTS customer_change_requested_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS customer_change_by uuid,
    ADD COLUMN IF NOT EXISTS customer_change_note text;

ALTER TABLE public.design_schedules DROP CONSTRAINT IF EXISTS design_schedules_customer_change_by_fkey;
ALTER TABLE public.design_schedules
    ADD CONSTRAINT design_schedules_customer_change_by_fkey FOREIGN KEY (customer_change_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.design_schedules DROP CONSTRAINT IF EXISTS design_schedules_customer_change_check;
ALTER TABLE public.design_schedules
    ADD CONSTRAINT design_schedules_customer_change_check CHECK (
        ((customer_change_by IS NULL) AND (customer_change_note IS NULL)) OR (customer_change_requested_at IS NOT NULL));

ALTER TABLE public.design_schedules DROP CONSTRAINT IF EXISTS design_schedules_customer_change_note_check;
ALTER TABLE public.design_schedules
    ADD CONSTRAINT design_schedules_customer_change_note_check CHECK (COALESCE(length(customer_change_note), 0) <= 200);

COMMENT ON COLUMN public.design_schedules.customer_change_requested_at IS '고객이 앱에서 이 날짜를 바꿔 달라고 한 때 (0082). 날짜는 업체가 고치고, 고치면 서버가 지운다';
COMMENT ON COLUMN public.design_schedules.customer_change_by IS '바꿔 달라고 한 고객 계정 — 서버가 적는다';
COMMENT ON COLUMN public.design_schedules.customer_change_note IS '고객이 바라는 것 (200자까지)';

-- 3) A/S 를 처리하는 업체 ----------------------------------------------------------------
ALTER TABLE public.as_requests
    ADD COLUMN IF NOT EXISTS handler_company_id uuid,
    ADD COLUMN IF NOT EXISTS handler_project_id uuid;

ALTER TABLE public.as_requests DROP CONSTRAINT IF EXISTS as_requests_handler_company_fkey;
ALTER TABLE public.as_requests
    ADD CONSTRAINT as_requests_handler_company_fkey FOREIGN KEY (handler_company_id) REFERENCES public.companies(id);

ALTER TABLE public.as_requests DROP CONSTRAINT IF EXISTS as_requests_handler_project_fkey;
ALTER TABLE public.as_requests
    ADD CONSTRAINT as_requests_handler_project_fkey FOREIGN KEY (handler_project_id, handler_company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT;

ALTER TABLE public.as_requests DROP CONSTRAINT IF EXISTS as_requests_handler_check;
ALTER TABLE public.as_requests
    ADD CONSTRAINT as_requests_handler_check CHECK (
        ((handler_project_id IS NULL) OR (handler_company_id IS NOT NULL))
        AND ((handler_company_id IS NULL) OR (handler_company_id <> company_id)));

COMMENT ON COLUMN public.as_requests.handler_company_id IS '받아 처리하는 팩토리 — 영업 사원 업체 수주의 A/S 를 만든 팩토리가 받는다 (0082 · 대표님 2026-11-23 ①). 비면 수주한 업체';
COMMENT ON COLUMN public.as_requests.handler_project_id IS '처리하는 팩토리 쪽 프로젝트 (제작 의뢰를 받아 생긴 프로젝트)';

CREATE INDEX IF NOT EXISTS idx_as_requests_handler ON public.as_requests USING btree (handler_company_id, created_at DESC) WHERE (handler_company_id IS NOT NULL);

-- 지킴이 — 처리하는 업체도 접수 때 정하고 바꾸지 않는다 (0045 지킴이에 두 칸을 더한다)
CREATE OR REPLACE FUNCTION public.as_requests_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.order_id, NEW.body, NEW.photos, NEW.route, NEW.created_at, NEW.handler_company_id, NEW.handler_project_id)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.order_id, OLD.body, OLD.photos, OLD.route, OLD.created_at, OLD.handler_company_id, OLD.handler_project_id)
     OR (NEW.customer_user_id IS NOT NULL AND NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id)
     OR (NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
    RAISE EXCEPTION 'as_requests: 접수 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'requested' AND NEW.state IN ('received', 'cancelled'))
            OR (OLD.state = 'received' AND NEW.state = 'done')) THEN
      RAISE EXCEPTION 'as_requests: % -> % 는 안 됩니다', OLD.state, NEW.state USING ERRCODE = '22023';
    END IF;
    IF NEW.state = 'received' THEN NEW.received_at := now(); END IF;
    IF NEW.state = 'done' THEN NEW.done_at := now(); END IF;
    IF NEW.state = 'cancelled' THEN NEW.cancelled_at := now(); END IF;
  ELSIF (NEW.received_at, NEW.done_at, NEW.cancelled_at) IS DISTINCT FROM (OLD.received_at, OLD.done_at, OLD.cancelled_at) THEN
    RAISE EXCEPTION 'as_requests: 때는 상태가 바뀔 때만 찍힌다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.as_requests_guard() IS 'A/S 접수 지킴이 — 만든 칸(처리하는 업체 포함) 그대로, requested → received · cancelled, received → done, 때는 여기서 찍는다 (0045 · 0082)';

REVOKE ALL ON FUNCTION public.as_requests_guard() FROM PUBLIC, anon, authenticated, service_role;

-- 처리하는 팩토리 구성원도 그 접수를 읽는다
DROP POLICY IF EXISTS as_requests_handler_read ON public.as_requests;
CREATE POLICY as_requests_handler_read ON public.as_requests
    FOR SELECT
    TO authenticated
    USING (handler_company_id IN (SELECT public.my_company_ids()));

-- 4) 앱 알림 종류 -------------------------------------------------------------------------
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text, 'work_link_request'::text, 'work_reply'::text, 'work_report'::text, 'system_check_failed'::text, 'stock_band_low'::text, 'trial_ending'::text, 'biz_cert_review'::text, 'biz_cert_decided'::text, 'as_factory'::text, 'install_change'::text]));
