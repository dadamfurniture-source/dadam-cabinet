-- =============================================
-- 0041 — AI 비서 승인 카드 (assistant_actions) · 두 번 실행 막기 키 (프로젝트 · 수금 · 원가)
--
-- 2026-11-05 대표님 결정 — 비서는 바꾸는 일을 「승인 카드」로만 제안하고, 대화한 사람이 본인 권한 안에서 승인하면
-- 서버가 그 사람의 토큰으로 기존 주소를 부른다. 카드는 만든 뒤 24시간 안에만 승인할 수 있다.
-- 카드 종류: 상담 받기 · 거절, 수주 상태 바꾸기, 영수증 사진 장부에 올리기, 프로젝트 만들기 · 설계 잇기 · 수금 받음 · 원가 줄,
-- 고객 연락 초안(실행 없음 — 복사만).
--
-- 1) assistant_actions  카드 한 장 = 한 줄. 서버(service_role)만 읽고 쓴다. 대화를 지우면 함께 지운다 (90일 보관 — 대화와 같다)
--      kind     consult_accept · consult_decline · order_status · ledger_post · project_create · design_link
--               · payment_received · cost_add · draft(고객 연락 초안)
--      state    proposed(승인 기다림) → running(실행 중 — 한 번만 잡는다) → done · failed · unknown(끊겨 결과를 모름)
--               proposed → rejected(거절) · expired(기한 지남). draft 는 처음부터 끝까지 draft (실행이 없다)
--      params   실행에 넘길 값 (서버가 검사한 것) · expect  카드를 만들 때의 상태 (낡음 비교) · card  화면에 보일 줄 (DB 값으로 만든 것)
--      result   실행 결과 (만든 id · 서버 문구) — running 에서 끝날 때만 쓴다
--      지킴이 트리거: 만든 뒤 바뀌지 않는 칸(종류 · 값 · 카드 · 사람 · 기한), 정해진 상태 이동만, decided_at · finished_at 자동
-- 2) projects · order_payments · order_costs.idempotency_key  같은 키로 두 번 와도 한 줄 (ledger_entries 와 같은 방식).
--      프로젝트는 업체 안에서, 수금 · 원가는 수주 안에서 하나. 키 모양은 서버가 본다 (1~200자)
-- 3) assistant_audit.kind 에 action 을 더한다 (만듦 · 승인 · 거절 · 실행 결과 — 종류 · 상태만)
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 승인 카드 -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'proposed'::text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    expect jsonb DEFAULT '{}'::jsonb NOT NULL,
    card jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    decided_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT assistant_actions_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_actions_kind_check CHECK (kind = ANY (ARRAY['consult_accept'::text, 'consult_decline'::text, 'order_status'::text, 'ledger_post'::text, 'project_create'::text, 'design_link'::text, 'payment_received'::text, 'cost_add'::text, 'draft'::text])),
    CONSTRAINT assistant_actions_state_check CHECK (state = ANY (ARRAY['proposed'::text, 'running'::text, 'done'::text, 'failed'::text, 'unknown'::text, 'rejected'::text, 'expired'::text, 'draft'::text])),
    CONSTRAINT assistant_actions_draft_check CHECK ((kind = 'draft'::text) = (state = 'draft'::text)),
    CONSTRAINT assistant_actions_json_check CHECK ((jsonb_typeof(params) = 'object'::text) AND (jsonb_typeof(expect) = 'object'::text) AND (jsonb_typeof(card) = 'object'::text)
        AND ((result IS NULL) OR (jsonb_typeof(result) = 'object'::text))
        AND (octet_length(params::text) <= 8000) AND (octet_length(expect::text) <= 4000) AND (octet_length(card::text) <= 8000)
        AND ((result IS NULL) OR (octet_length(result::text) <= 4000))),
    CONSTRAINT assistant_actions_expires_check CHECK (expires_at > created_at),
    CONSTRAINT assistant_actions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT assistant_actions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
    CONSTRAINT assistant_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.assistant_actions IS 'AI 비서 승인 카드 — 카드 한 장 = 한 줄. 대화한 사람만 본인 권한 안에서 승인, 만든 뒤 24시간. 실행은 한 번만(running 을 한 번 잡는다). 대화를 지우면 함께 지운다. 서버만';
COMMENT ON COLUMN public.assistant_actions.expect IS '카드를 만들 때의 상태 — 승인할 때 지금 상태와 견줘 다르면 실행하지 않는다 (낡은 카드)';
COMMENT ON COLUMN public.assistant_actions.card IS '화면에 보일 줄 — AI 글이 아니라 서버가 DB 값으로 만든 것';

CREATE INDEX IF NOT EXISTS idx_assistant_actions_conversation ON public.assistant_actions USING btree (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_user ON public.assistant_actions USING btree (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.assistant_actions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.params IS DISTINCT FROM OLD.params OR NEW.expect IS DISTINCT FROM OLD.expect
     OR NEW.card IS DISTINCT FROM OLD.card OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'assistant_actions: only state and result change' USING ERRCODE = '22023';
  END IF;
  IF NEW.state = OLD.state THEN
    IF NEW.result IS DISTINCT FROM OLD.result OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
      RAISE EXCEPTION 'assistant_actions: nothing changes without a state move' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.state = 'proposed' AND NEW.state IN ('running', 'rejected', 'expired'))
          OR (OLD.state = 'running' AND NEW.state IN ('done', 'failed', 'unknown'))) THEN
    RAISE EXCEPTION 'assistant_actions: % -> % not allowed', OLD.state, NEW.state USING ERRCODE = '22023';
  END IF;
  IF OLD.state = 'proposed' THEN
    IF NEW.result IS DISTINCT FROM OLD.result THEN
      RAISE EXCEPTION 'assistant_actions: result only when a run ends' USING ERRCODE = '22023';
    END IF;
    NEW.decided_at := now();
  ELSE
    NEW.finished_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.assistant_actions_guard() IS '승인 카드 지킴이 — 만든 뒤 바뀌지 않는 칸, proposed → running · rejected · expired, running → done · failed · unknown 만. decided_at · finished_at 은 여기서 찍는다';

REVOKE ALL ON FUNCTION public.assistant_actions_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_assistant_actions_guard ON public.assistant_actions;
CREATE TRIGGER trg_assistant_actions_guard BEFORE UPDATE ON public.assistant_actions FOR EACH ROW EXECUTE FUNCTION public.assistant_actions_guard();

ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assistant_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.assistant_actions TO service_role;

-- 2) 두 번 실행 막기 키 -------------------------------------------------------------------

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.order_costs ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_idempotency_key_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_idempotency_key_check CHECK ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200));
ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_idempotency_key_check;
ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_idempotency_key_check CHECK ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200));
ALTER TABLE public.order_costs DROP CONSTRAINT IF EXISTS order_costs_idempotency_key_check;
ALTER TABLE public.order_costs ADD CONSTRAINT order_costs_idempotency_key_check CHECK ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200));

CREATE UNIQUE INDEX IF NOT EXISTS projects_company_idem ON public.projects USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS order_payments_order_idem ON public.order_payments USING btree (order_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS order_costs_order_idem ON public.order_costs USING btree (order_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

COMMENT ON COLUMN public.projects.idempotency_key IS '두 번 실행 막기 키 (X-Idempotency-Key) — 같은 업체 안에서 하나. 같은 키로 다시 오면 이 줄을 돌려준다';
COMMENT ON COLUMN public.order_payments.idempotency_key IS '두 번 실행 막기 키 (X-Idempotency-Key) — 같은 수주 안에서 하나';
COMMENT ON COLUMN public.order_costs.idempotency_key IS '두 번 실행 막기 키 (X-Idempotency-Key) — 같은 수주 안에서 하나';

-- 3) 기록 종류 --------------------------------------------------------------------------

ALTER TABLE public.assistant_audit DROP CONSTRAINT IF EXISTS assistant_audit_kind_check;
ALTER TABLE public.assistant_audit
    ADD CONSTRAINT assistant_audit_kind_check CHECK (kind = ANY (ARRAY['turn'::text, 'tool'::text, 'blocked'::text, 'error'::text, 'setting'::text, 'action'::text]));
