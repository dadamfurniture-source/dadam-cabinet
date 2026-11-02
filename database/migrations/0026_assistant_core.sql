-- =============================================
-- 0026 — AI 비서 바탕 (Agent 업체)
--
-- 비서 서버(workers/assistant-api)만 읽고 쓴다 — 모든 표 RLS 켬, 정책 없음, anon · authenticated 권한 없음.
--   assistant_global        전체 스위치 한 줄. assistant_on(비서) · extract_on(영수증 사진 읽기). 끄면 바로 멈춘다
--   assistant_settings      업체마다 한 줄. enabled(비서 켬) · trial(시험 예외 — 다담 공장 · 시험 업체)
--                           · monthly_limit_micros(월 한도, US 달러 백만분의 1. 비우면 쓸 수 없음)
--                           · extract_floor_micros(사진 읽기 몫 — 대화 · 브리핑이 이만큼은 남겨 둔다)
--   assistant_conversations 대화. 사람마다. 계정이 지워지면 함께 지운다
--   assistant_messages      대화의 메시지 — Claude 내용 블록 그대로(jsonb 배열). 고치지 않는다
--   assistant_usage         Claude 부르기 한 번 = 한 줄. 부르기 전에 예산을 잡고(reserve) 끝나면 실제 비용으로 정산(settle).
--                           달(period)은 한국 시간 기준. 같은 잡기 키는 한 줄 — 다시 불러도 두 번 깎지 않는다.
--                           쓰기는 아래 두 함수로만 한다
--   assistant_audit         기록 — 차례 · 도구 부르기 · 막힘 · 오류 · 설정 바꿈. 덧붙이기만. 이름 · 연락처 · 주소를 넣지 않는다
--   assistant_playbooks     플레이북(상담 응대 · 회계 점검 · 작업 분배 · 사용법). 승인한 판만 넣는다 — 판마다 한 줄, 고치지 않는다
--
-- 함수 (서버 service_role 만)
--   company_entitled(업체, 기능, 사람 = NULL) → 'full' | 'read' | 'none'
--     기본 조건: 업체 상태 active 이고 (협력업체 · Agent 이거나 시험 예외). 사람을 주면 그 업체 active 구성원이어야 한다.
--     assistant  기본 조건 + 업체 비서 켬 + 전체 스위치 켬 → full, 아니면 none
--     ledger     기본 조건 → full, 아니면 read (등급이 내려가도 장부는 보기 · 내보내기만 — 장부 · 증빙 5년 보관)
--   assistant_budget_reserve(업체, 목적, 키, 금액, 사람, 모델)  예산 잡기. 업체 설정 줄을 잠가 동시에 잡아도 한도를 넘지 않는다.
--     목적 chat · brief 은 비서 자격, extract 는 장부 자격과 사진 읽기 스위치를 본다.
--     chat · brief 은 사진 읽기 몫(바닥선 − 이번 달 사진 읽기 사용)을 남겨 둔다.
--   assistant_budget_settle(잡기 id, 비용, 사용량)  정산 — 한 번만.
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 전체 스위치 ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_global (
    id boolean DEFAULT true NOT NULL,
    assistant_on boolean DEFAULT true NOT NULL,
    extract_on boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_global_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_global_one_row CHECK (id),
    CONSTRAINT assistant_global_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.assistant_global IS 'AI 비서 전체 스위치 한 줄 — assistant_on(비서) · extract_on(영수증 사진 읽기). 서버만';

INSERT INTO public.assistant_global (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_assistant_global_touch ON public.assistant_global;
CREATE TRIGGER trg_assistant_global_touch BEFORE UPDATE ON public.assistant_global FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

-- 2) 업체 설정 -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_settings (
    company_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    trial boolean DEFAULT false NOT NULL,
    monthly_limit_micros bigint,
    extract_floor_micros bigint DEFAULT 0 NOT NULL,
    note text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_settings_pkey PRIMARY KEY (company_id),
    CONSTRAINT assistant_settings_limit_check CHECK ((monthly_limit_micros IS NULL) OR (monthly_limit_micros >= 0)),
    CONSTRAINT assistant_settings_floor_check CHECK ((extract_floor_micros >= 0) AND ((monthly_limit_micros IS NULL) OR (extract_floor_micros <= monthly_limit_micros))),
    CONSTRAINT assistant_settings_note_check CHECK ((note IS NULL) OR (length(note) <= 300)),
    CONSTRAINT assistant_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT assistant_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.assistant_settings IS 'AI 비서 업체 설정 — 켬 · 시험 예외 · 월 한도(US 달러 백만분의 1, 비우면 쓸 수 없음) · 사진 읽기 몫. 서버만';
COMMENT ON COLUMN public.assistant_settings.trial IS '시험 예외 — Agent 가 아니어도 비서 · 장부를 연다 (다담 공장 · 시험 업체)';
COMMENT ON COLUMN public.assistant_settings.monthly_limit_micros IS '월 한도, US 달러 백만분의 1 (1달러 = 1000000). NULL 이면 예산을 잡지 않는다';
COMMENT ON COLUMN public.assistant_settings.extract_floor_micros IS '사진 읽기 몫 — 대화 · 브리핑은 (이 값 − 이번 달 사진 읽기 사용)만큼 남겨 둔다';

DROP TRIGGER IF EXISTS trg_assistant_settings_touch ON public.assistant_settings;
CREATE TRIGGER trg_assistant_settings_touch BEFORE UPDATE ON public.assistant_settings FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

-- 3) 대화 · 메시지 -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_conversations_title_check CHECK ((title IS NULL) OR (length(title) <= 100)),
    CONSTRAINT assistant_conversations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT assistant_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.assistant_conversations IS 'AI 비서 대화 — 사람마다. 계정을 지우면 함께 지운다. 메시지는 90일 보관. 서버만';

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user ON public.assistant_conversations USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_company ON public.assistant_conversations USING btree (company_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_assistant_conversations_touch ON public.assistant_conversations;
CREATE TRIGGER trg_assistant_conversations_touch BEFORE UPDATE ON public.assistant_conversations FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.assistant_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    seq integer NOT NULL,
    role text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_messages_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_messages_seq_key UNIQUE (conversation_id, seq),
    CONSTRAINT assistant_messages_seq_check CHECK (seq > 0),
    CONSTRAINT assistant_messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
    CONSTRAINT assistant_messages_content_check CHECK ((jsonb_typeof(content) = 'array'::text) AND (octet_length(content::text) <= 1000000)),
    CONSTRAINT assistant_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.assistant_conversations(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.assistant_messages IS 'AI 비서 메시지 — Claude 내용 블록 그대로(jsonb 배열), 대화 안 차례 seq. 고치지 않는다. 90일 지나면 지운다. 서버만';

CREATE INDEX IF NOT EXISTS idx_assistant_messages_created ON public.assistant_messages USING btree (created_at);

-- 4) 사용량 (예산) --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid,
    purpose text NOT NULL,
    reservation_key text NOT NULL,
    period date NOT NULL,
    model text,
    reserved_micros bigint NOT NULL,
    cost_micros bigint,
    input_tokens integer,
    output_tokens integer,
    cache_read_tokens integer,
    cache_write_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT assistant_usage_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_usage_key UNIQUE (reservation_key),
    CONSTRAINT assistant_usage_purpose_check CHECK (purpose = ANY (ARRAY['chat'::text, 'brief'::text, 'extract'::text])),
    CONSTRAINT assistant_usage_key_check CHECK (length(reservation_key) BETWEEN 1 AND 200),
    CONSTRAINT assistant_usage_model_check CHECK ((model IS NULL) OR (length(model) <= 80)),
    CONSTRAINT assistant_usage_amount_check CHECK ((reserved_micros > 0) AND ((cost_micros IS NULL) OR (cost_micros >= 0))),
    CONSTRAINT assistant_usage_tokens_check CHECK ((coalesce(input_tokens, 0) >= 0) AND (coalesce(output_tokens, 0) >= 0) AND (coalesce(cache_read_tokens, 0) >= 0) AND (coalesce(cache_write_tokens, 0) >= 0)),
    CONSTRAINT assistant_usage_settled_check CHECK ((settled_at IS NULL) = (cost_micros IS NULL)),
    CONSTRAINT assistant_usage_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT assistant_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.assistant_usage IS 'Claude 부르기 한 번 = 한 줄 — 잡은 금액(reserved) → 정산 비용(cost). 달은 한국 시간. 쓰기는 assistant_budget_reserve · assistant_budget_settle 로만';
COMMENT ON COLUMN public.assistant_usage.reservation_key IS '잡기 키 — 서버가 차례 · 추출마다 만든다. 같은 키는 한 줄(다시 불러도 두 번 깎지 않음)';

CREATE INDEX IF NOT EXISTS idx_assistant_usage_company_period ON public.assistant_usage USING btree (company_id, period);

-- 5) 기록 ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_audit (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid,
    conversation_id uuid,
    kind text NOT NULL,
    name text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_audit_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_audit_kind_check CHECK (kind = ANY (ARRAY['turn'::text, 'tool'::text, 'blocked'::text, 'error'::text, 'setting'::text])),
    CONSTRAINT assistant_audit_name_check CHECK ((name IS NULL) OR (length(name) <= 80)),
    CONSTRAINT assistant_audit_detail_check CHECK ((jsonb_typeof(detail) = 'object'::text) AND (octet_length(detail::text) <= 8000)),
    CONSTRAINT assistant_audit_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT assistant_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.assistant_audit IS 'AI 비서 기록 — 차례 · 도구 부르기(이름 · 인자 요약 · 결과 크기) · 막힘 · 오류 · 설정 바꿈. 덧붙이기만. 이름 · 연락처 · 주소를 넣지 않는다';
COMMENT ON COLUMN public.assistant_audit.conversation_id IS '대화 id — 대화를 지워도 기록은 남도록 잇지 않는다';

CREATE INDEX IF NOT EXISTS idx_assistant_audit_company ON public.assistant_audit USING btree (company_id, created_at DESC);

-- 6) 플레이북 -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_playbooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    version integer NOT NULL,
    body text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_playbooks_pkey PRIMARY KEY (id),
    CONSTRAINT assistant_playbooks_key_version UNIQUE (key, version),
    CONSTRAINT assistant_playbooks_key_check CHECK (key = ANY (ARRAY['consult'::text, 'accounting'::text, 'dispatch'::text, 'usage'::text])),
    CONSTRAINT assistant_playbooks_version_check CHECK (version > 0),
    CONSTRAINT assistant_playbooks_body_check CHECK (length(body) BETWEEN 1 AND 20000),
    CONSTRAINT assistant_playbooks_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.assistant_playbooks IS 'AI 비서 플레이북 — consult(상담 응대) · accounting(회계 점검) · dispatch(작업 분배) · usage(사용법). 승인한 판만, 판마다 한 줄. 서버만';

-- 7) 자격 ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)) AS base,
           coalesce(s.enabled, false) AS enabled
      FROM public.companies co
      LEFT JOIN public.assistant_settings s ON s.company_id = co.id
     WHERE co.id = p_company
  ), m AS (
    SELECT p_user IS NULL OR EXISTS (
             SELECT 1 FROM public.company_members cm
              WHERE cm.company_id = p_company AND cm.user_id = p_user AND cm.status = 'active') AS ok
  )
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM c) OR NOT (SELECT ok FROM m) THEN 'none'
           WHEN p_feature = 'assistant' THEN
             CASE WHEN (SELECT base AND enabled FROM c)
                       AND coalesce((SELECT g.assistant_on FROM public.assistant_global g WHERE g.id), false)
                  THEN 'full' ELSE 'none' END
           WHEN p_feature = 'ledger' THEN
             CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'read' END
           ELSE 'none'
         END;
$function$;

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none, ledger: full | read(등급이 내려가도 보기 · 내보내기). 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;

-- 8) 예산 잡기 · 정산 ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assistant_budget_reserve(p_company uuid, p_purpose text, p_key text, p_micros bigint, p_user uuid DEFAULT NULL::uuid, p_model text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_set public.assistant_settings%ROWTYPE;
  v_row public.assistant_usage%ROWTYPE;
  v_on boolean;
  v_period date := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::date;
  v_used bigint;
  v_extract_used bigint;
  v_floor bigint;
BEGIN
  IF p_purpose IS NULL OR p_purpose <> ALL (ARRAY['chat', 'brief', 'extract']) THEN
    RAISE EXCEPTION 'p_purpose must be chat, brief or extract';
  END IF;
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'p_key is required';
  END IF;
  IF p_micros IS NULL OR p_micros <= 0 THEN
    RAISE EXCEPTION 'p_micros must be positive';
  END IF;

  -- 업체 줄을 잠가 같은 업체의 잡기를 한 줄로 세운다
  SELECT * INTO v_set FROM public.assistant_settings s WHERE s.company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_limit');
  END IF;

  SELECT * INTO v_row FROM public.assistant_usage u WHERE u.reservation_key = p_key;
  IF FOUND THEN
    IF v_row.company_id <> p_company OR v_row.purpose <> p_purpose THEN
      RAISE EXCEPTION 'p_key belongs to another reservation';
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'repeat', true, 'settled', v_row.settled_at IS NOT NULL);
  END IF;

  IF public.company_entitled(p_company, CASE WHEN p_purpose = 'extract' THEN 'ledger' ELSE 'assistant' END, p_user) <> 'full' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_entitled');
  END IF;
  IF p_purpose = 'extract' THEN
    SELECT g.extract_on INTO v_on FROM public.assistant_global g WHERE g.id;
    IF NOT coalesce(v_on, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'off');
    END IF;
  END IF;
  IF v_set.monthly_limit_micros IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_limit');
  END IF;

  SELECT coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)), 0),
         coalesce(sum(coalesce(u.cost_micros, u.reserved_micros)) FILTER (WHERE u.purpose = 'extract'), 0)
    INTO v_used, v_extract_used
    FROM public.assistant_usage u
   WHERE u.company_id = p_company AND u.period = v_period;

  v_floor := CASE WHEN p_purpose = 'extract' THEN 0 ELSE greatest(v_set.extract_floor_micros - v_extract_used, 0) END;
  IF v_used + v_floor + p_micros > v_set.monthly_limit_micros THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'over_limit',
                              'used', v_used, 'limit', v_set.monthly_limit_micros, 'kept_for_extract', v_floor);
  END IF;

  INSERT INTO public.assistant_usage (company_id, user_id, purpose, reservation_key, period, model, reserved_micros)
  VALUES (p_company, p_user, p_purpose, p_key, v_period, p_model, p_micros)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'repeat', false);
END;
$function$;

COMMENT ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) IS 'AI 비서 예산 잡기 — 업체 설정 줄을 잠그고 이번 달(한국 시간) 사용 + 사진 읽기 몫 + 이번 금액이 한도 안이면 한 줄. 같은 키는 그 줄을 돌려준다. service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_budget_reserve(uuid, text, text, bigint, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.assistant_budget_settle(p_id uuid, p_cost_micros bigint, p_usage jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.assistant_usage%ROWTYPE;
  v_usage jsonb := coalesce(p_usage, '{}'::jsonb);
BEGIN
  IF p_cost_micros IS NULL OR p_cost_micros < 0 THEN
    RAISE EXCEPTION 'p_cost_micros must be zero or more';
  END IF;
  IF jsonb_typeof(v_usage) <> 'object' THEN
    RAISE EXCEPTION 'p_usage must be an object';
  END IF;

  UPDATE public.assistant_usage u
     SET cost_micros = p_cost_micros,
         model = coalesce(left(v_usage->>'model', 80), u.model),
         input_tokens = (v_usage->>'input_tokens')::integer,
         output_tokens = (v_usage->>'output_tokens')::integer,
         cache_read_tokens = (v_usage->>'cache_read_input_tokens')::integer,
         cache_write_tokens = (v_usage->>'cache_creation_input_tokens')::integer,
         settled_at = now()
   WHERE u.id = p_id AND u.settled_at IS NULL
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repeat', false);
  END IF;

  IF EXISTS (SELECT 1 FROM public.assistant_usage u WHERE u.id = p_id) THEN
    RETURN jsonb_build_object('ok', true, 'repeat', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
END;
$function$;

COMMENT ON FUNCTION public.assistant_budget_settle(uuid, bigint, jsonb) IS 'AI 비서 예산 정산 — 잡은 줄에 실제 비용 · 토큰(Claude usage 칸 이름)을 한 번만 적는다. service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_budget_settle(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_budget_settle(uuid, bigint, jsonb) TO service_role;

-- 9) 권한 — 서버만 -------------------------------------------------------------------

ALTER TABLE public.assistant_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_playbooks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assistant_global FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.assistant_global TO service_role;

REVOKE ALL ON TABLE public.assistant_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.assistant_settings TO service_role;

-- 대화 · 메시지는 90일 지난 것을 지운다 (메시지는 고치지 않는다)
REVOKE ALL ON TABLE public.assistant_conversations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_conversations TO service_role;

REVOKE ALL ON TABLE public.assistant_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.assistant_messages TO service_role;

-- 사용량은 읽기만 — 쓰기는 잡기 · 정산 함수(SECURITY DEFINER)로만
REVOKE ALL ON TABLE public.assistant_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.assistant_usage TO service_role;

REVOKE ALL ON TABLE public.assistant_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.assistant_audit TO service_role;

REVOKE ALL ON TABLE public.assistant_playbooks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.assistant_playbooks TO service_role;
