-- =============================================
-- 0045 고객 A/S 접수 (2026-11-06 사장님 결정 · A/S 접수 묶음)
--
--   구조 답 6: 고객 앱 A/S 신청 → 본사 시스템 기록 → 그 수주의 팩토리 담당자(또는 연계 MANAGER)에게 바로. 본사가 손으로 넘기지 않는다.
--   ① 연계 MANAGER 와 팩토리 담당자가 둘 다 있을 때 — 메모 「MANAGER 와 팩토리 담당자가 같이 있을 수 없음」(한 수주에 한쪽만)
--   ② 수주에 담당자가 없으면 그 팩토리 대표 · 실장에게
--   ③ 본사는 기록 + 늦으면 알림 — 접수 · 처리 시간과 A/S 율을 모으고, 48시간 넘게 아무도 안 받으면 본사 관리자에게 알림
--   ④ 앱 상담으로 시작한 수주만 — 고객 계정과 이어진 수주
--
-- 바꾸는 것:
--   1) as_requests — 접수 한 번 = 한 줄.
--        state     requested 접수 → received 팩토리가 받음 → done 끝 (requested 에서 cancelled — 고객이 거둠)
--        route     접수 때 간 곳: assignee 그 수주 프로젝트의 담당자 · owners 팩토리 대표 · 실장 (manager 연계 MANAGER — MANAGER 등급 뒤)
--        assignee_id  route assignee 면 그때의 담당자
--        body · photos  고객이 적은 내용(1~1000자) · 사진 경로(5장까지, 버킷 as-request-photos)
--        received_by · received_at · done_report_id(완료 보고 0043) · done_at · cancelled_at · alerted_at(48시간 본사 알림을 보낸 때)
--      같은 팩토리 수주만 (orders (id, company_id) 복합 FK). 고객 칸은 auth.users — 고객이 지워지면 비운다.
--   2) 지킴이 트리거 — 만든 칸은 그대로, 상태는 정해진 차례로만 (requested → received · cancelled, received → done), 때는 트리거가 찍는다.
--   3) 비공개 버킷 as-request-photos (5MB · JPEG · PNG, 정책 없음 — 서버만)
--
-- 읽기: 고객은 자기 접수, 팩토리 구성원은 자기 팩토리 접수 (RLS). 본사 기록 · 알림은 서버(service_role). 쓰기는 서버만. 지우기 없음.
-- =============================================

-- 1) 접수 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.as_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    customer_user_id uuid,
    body text NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    state text DEFAULT 'requested'::text NOT NULL,
    route text NOT NULL,
    assignee_id uuid,
    received_by uuid,
    received_at timestamp with time zone,
    done_report_id uuid,
    done_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    alerted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT as_requests_pkey PRIMARY KEY (id),
    CONSTRAINT as_requests_state_check CHECK (state = ANY (ARRAY['requested'::text, 'received'::text, 'done'::text, 'cancelled'::text])),
    CONSTRAINT as_requests_route_check CHECK (route = ANY (ARRAY['assignee'::text, 'owners'::text, 'manager'::text])),
    CONSTRAINT as_requests_assignee_check CHECK ((route = 'assignee'::text) = (assignee_id IS NOT NULL)),
    CONSTRAINT as_requests_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
    CONSTRAINT as_requests_photos_check CHECK ((jsonb_typeof(photos) = 'array'::text) AND (jsonb_array_length(photos) <= 5)
        AND (octet_length(photos::text) <= 2000)),
    CONSTRAINT as_requests_times_check CHECK (
        ((state = 'requested'::text) AND received_at IS NULL AND done_at IS NULL AND cancelled_at IS NULL)
        OR ((state = 'received'::text) AND received_at IS NOT NULL AND done_at IS NULL AND cancelled_at IS NULL)
        OR ((state = 'done'::text) AND received_at IS NOT NULL AND done_at IS NOT NULL AND cancelled_at IS NULL)
        OR ((state = 'cancelled'::text) AND received_at IS NULL AND done_at IS NULL AND cancelled_at IS NOT NULL)),
    CONSTRAINT as_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT as_requests_order_fkey FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT as_requests_customer_fkey FOREIGN KEY (customer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT as_requests_assignee_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT as_requests_received_by_fkey FOREIGN KEY (received_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT as_requests_done_report_fkey FOREIGN KEY (done_report_id) REFERENCES public.order_reports(id)
);

COMMENT ON TABLE public.as_requests IS '고객 A/S 접수 — 앱 → 본사 기록 → 그 수주 팩토리 담당자(없으면 대표 · 실장)에게 바로 (2026-11-06 A/S 접수 묶음). 상태는 requested → received → done (requested → cancelled). 쓰기는 service_role 만, 지우지 않는다';

CREATE INDEX IF NOT EXISTS idx_as_requests_company ON public.as_requests USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_as_requests_customer ON public.as_requests USING btree (customer_user_id, created_at DESC) WHERE (customer_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_as_requests_waiting ON public.as_requests USING btree (created_at) WHERE ((state = 'requested'::text) AND (alerted_at IS NULL));

-- 2) 지킴이 ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.as_requests_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.order_id, NEW.body, NEW.photos, NEW.route, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.order_id, OLD.body, OLD.photos, OLD.route, OLD.created_at)
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

COMMENT ON FUNCTION public.as_requests_guard() IS 'A/S 접수 지킴이 — 만든 칸 그대로, requested → received · cancelled, received → done, 때는 여기서 찍는다 (0045)';

REVOKE ALL ON FUNCTION public.as_requests_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_as_requests_guard ON public.as_requests;
CREATE TRIGGER trg_as_requests_guard BEFORE UPDATE ON public.as_requests FOR EACH ROW EXECUTE FUNCTION public.as_requests_guard();

ALTER TABLE public.as_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.as_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.as_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.as_requests TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.as_requests FROM service_role;

DROP POLICY IF EXISTS as_requests_customer_read ON public.as_requests;
CREATE POLICY as_requests_customer_read ON public.as_requests
    FOR SELECT
    TO authenticated
    USING (customer_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS as_requests_member_read ON public.as_requests;
CREATE POLICY as_requests_member_read ON public.as_requests
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

-- 3) 사진 버킷 ------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('as-request-photos', 'as-request-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
