-- =============================================
-- 0013 — 수주 기록 (order_events)
--
-- 수주 상태가 바뀔 때마다 한 줄씩 쌓는다. 지우지 않는다.
--   kind status            보통 상태 바꾸기 (접수 · 생산 중 · 배송 · 완료 · 취소 사이)
--        revive            취소된 수주 되살리기 (from_status = cancelled)
--        revert            완료 되돌리기 (from_status = completed)
--        early_work_order  고객 확인서 승인 전 작업지시서 발행 — 아직 수주가 없으므로 설계(design_id)에 단다
--   state done              바로 처리됨
--         pending           승인 기다림 (대표가 아닌 사람의 요청)
--         approved | rejected  대표가 결정함 (decided_by · decided_at)
--   되살리기 · 되돌리기 · 승인 전 작업지시서는 사유가 꼭 있어야 한다.
--   어느 전이를 바로 / 승인으로 할지는 서버(workflow-api)가 정한다 — 이 표는 기록만 지킨다.
--
-- 쓰기는 service_role 만. 고칠 수 있는 것은 pending 줄의 결정(state · decided_by · decided_at)뿐이고,
-- 지우기는 아무도 못 한다 (service_role 포함).
-- 읽기: 그 업체의 active 구성원, 관리자는 본사 기록만. 고객은 읽지 않는다.
--
-- orders 에 (id, company_id) 유니크를 더한다 — 기록의 (order_id, company_id) 가 같은 업체 수주만 가리키게.
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_id_company_key;
ALTER TABLE public.orders ADD CONSTRAINT orders_id_company_key UNIQUE (id, company_id);

CREATE TABLE IF NOT EXISTS public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid,
    design_id uuid,
    kind text NOT NULL,
    from_status text,
    to_status text,
    reason text,
    state text DEFAULT 'done'::text NOT NULL,
    requested_by uuid,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_events_pkey PRIMARY KEY (id),
    CONSTRAINT order_events_kind_check CHECK (kind = ANY (ARRAY['status'::text, 'revive'::text, 'revert'::text, 'early_work_order'::text])),
    CONSTRAINT order_events_state_check CHECK (state = ANY (ARRAY['done'::text, 'pending'::text, 'approved'::text, 'rejected'::text])),
    CONSTRAINT order_events_status_values_check CHECK (
        (from_status IS NULL OR from_status = ANY (ARRAY['confirmed'::text, 'in_production'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text]))
        AND (to_status IS NULL OR to_status = ANY (ARRAY['confirmed'::text, 'in_production'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT order_events_target_check CHECK (
        (kind = 'early_work_order'::text AND design_id IS NOT NULL AND order_id IS NULL)
        OR (kind <> 'early_work_order'::text AND order_id IS NOT NULL AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status)),
    CONSTRAINT order_events_revive_check CHECK (kind <> 'revive'::text OR from_status = 'cancelled'::text),
    CONSTRAINT order_events_revert_check CHECK (kind <> 'revert'::text OR from_status = 'completed'::text),
    CONSTRAINT order_events_reason_check CHECK (
        (reason IS NULL OR length(reason) <= 500)
        AND (kind = 'status'::text OR length(btrim(coalesce(reason, ''))) >= 1)),
    CONSTRAINT order_events_decision_check CHECK (
        (state = 'pending'::text AND decided_at IS NULL AND decided_by IS NULL)
        OR (state = ANY (ARRAY['approved'::text, 'rejected'::text]) AND decided_at IS NOT NULL)
        OR state = 'done'::text),
    CONSTRAINT order_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT order_events_order_fkey FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT order_events_design_fkey FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT order_events_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT order_events_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.order_events IS '수주 기록 — 상태 바꾸기 · 되살리기 · 되돌리기 · 승인 전 작업지시서. 추가만 하고 지우지 않는다. 쓰기는 service_role 만';

CREATE INDEX IF NOT EXISTS idx_order_events_order ON public.order_events USING btree (order_id, created_at DESC) WHERE (order_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_events_design ON public.order_events USING btree (design_id, created_at DESC) WHERE (design_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_events_pending ON public.order_events USING btree (company_id, created_at) WHERE (state = 'pending'::text);

-- 고칠 수 있는 것: pending → approved | rejected 결정 칸만
CREATE OR REPLACE FUNCTION public.order_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'order_events: 기다리는 요청의 결정만 바꿀 수 있습니다';
  END IF;
  IF (NEW.id, NEW.company_id, NEW.order_id, NEW.design_id, NEW.kind, NEW.from_status, NEW.to_status, NEW.reason, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.order_id, OLD.design_id, OLD.kind, OLD.from_status, OLD.to_status, OLD.reason, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'order_events: 기록 내용은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_events_guard ON public.order_events;
CREATE TRIGGER trg_order_events_guard BEFORE UPDATE ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.order_events_guard();

REVOKE ALL ON FUNCTION public.order_events_guard() FROM PUBLIC, anon, authenticated, service_role;

-- RLS · 권한
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_events TO service_role;
-- 지우기 · 비우기는 아무도 못 한다
REVOKE DELETE, TRUNCATE ON TABLE public.order_events FROM service_role;

DROP POLICY IF EXISTS order_events_member_read ON public.order_events;
CREATE POLICY order_events_member_read ON public.order_events
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS order_events_admin_read ON public.order_events;
CREATE POLICY order_events_admin_read ON public.order_events
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));
