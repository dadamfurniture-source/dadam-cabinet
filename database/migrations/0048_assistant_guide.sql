-- =============================================
-- 0048 — AI 비서 안내 모드 (로그인한 모든 사람 · 사람마다 하루 질문 수)
--
-- 2026-11-08 대표님 결정 — 비서는 두 모드다.
--   업무 모드  지금 비서 그대로 (Agent · 시험 업체, company_entitled 'assistant'). 이 파일은 건드리지 않는다
--   안내 모드  로그인한 누구나(고객 · 팩토리 구성원 · 작업자 · 본사) SEGAN 앱 쓰는 법을 묻는다. 도구 · 업체 자료 없음.
--              사람마다 한국 시간 하루 질문 수에 한도가 있다(기본 20). 로그인하지 않은 사람은 AI 를 쓰지 않는다
--
-- 안내 대화 글은 DB 에 넣지 않는다 — 지난 몇 차례는 화면이 보내고(workers/assistant-api src/guide.js), 이 파일은 숫자만 센다.
-- 그래서 업체가 없는 사람도 쓸 수 있고(assistant_conversations · assistant_usage 는 업체 열이 필수), 90일 보관 · 지우기가 필요 없다.
--
-- 1) assistant_global 에 두 칸
--      guide_on           안내 모드 전체 스위치 (기본 켬). 끄면 새 질문을 받지 않는다 — 업무 모드 assistant_on 과 따로
--      guide_daily_limit  사람마다 하루(한국 시간) 질문 수 (기본 20, 0~1000). 바꾸면 그 순간부터 모두에게 — 배포 없이
-- 2) assistant_guide_usage   사람 × 한국 날짜 한 줄 — 쓴 질문 수 · 토큰 · 비용(US 달러 백만분의 1). 글은 넣지 않는다.
--      계정을 지우면 함께 지운다. 쓰기는 아래 함수로만 (서버 service_role 은 읽기만)
-- 3) 함수 (서버 service_role 만, SECURITY DEFINER)
--      assistant_guide_status(사람)                    → { on, used, limit, day, reset_at }   (세지 않는다)
--      assistant_guide_take(사람)                      → 한도 안이면 한 개 세고 { ok true, used, limit, day, reset_at },
--                                                        아니면 { ok false, reason off | over_limit, … }.
--                                                        INSERT … ON CONFLICT DO UPDATE … WHERE used < 한도 — 한 줄을 잠가 동시에 보내도 한도를 넘지 않는다
--      assistant_guide_settle(사람, 날짜, 비용, 사용량, 돌려주기)
--                                                      → 그 날 줄에 토큰 · 비용을 더한다. 돌려주기면 센 질문 하나를 돌려준다
--                                                        (서버 쪽 실패 — Claude 오류 · 빈 답. 사람 쪽 끊김 · 거절은 돌려주지 않는다)
--      reset_at 은 다음 한국 0시 (그 날 + 1일 00:00 Asia/Seoul)
--
-- 0047(새 등급 manager)의 객체는 쓰지 않는다 — 0026 의 assistant_global 만 고친다.
-- 다시 돌려도 된다 (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS 다음 ADD · CREATE TABLE IF NOT EXISTS · OR REPLACE).
-- =============================================

-- 1) 전체 스위치 · 하루 한도 ------------------------------------------------------------

ALTER TABLE public.assistant_global ADD COLUMN IF NOT EXISTS guide_on boolean DEFAULT true NOT NULL;
ALTER TABLE public.assistant_global ADD COLUMN IF NOT EXISTS guide_daily_limit integer DEFAULT 20 NOT NULL;

ALTER TABLE public.assistant_global DROP CONSTRAINT IF EXISTS assistant_global_guide_limit_check;
ALTER TABLE public.assistant_global
    ADD CONSTRAINT assistant_global_guide_limit_check CHECK ((guide_daily_limit >= 0) AND (guide_daily_limit <= 1000));

COMMENT ON TABLE public.assistant_global IS 'AI 비서 전체 스위치 한 줄 — assistant_on(업무 비서) · extract_on(영수증 사진 읽기) · guide_on(안내 모드) · guide_daily_limit(안내 모드 사람마다 하루 질문 수). 서버만';
COMMENT ON COLUMN public.assistant_global.guide_on IS '안내 모드 전체 스위치 — 끄면 새 안내 질문을 받지 않는다 (업무 모드와 따로)';
COMMENT ON COLUMN public.assistant_global.guide_daily_limit IS '안내 모드 — 사람마다 하루(한국 시간) 질문 수, 0~1000. 0 이면 아무도 묻지 못한다';

-- 2) 사람 × 날짜 사용량 -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assistant_guide_usage (
    user_id uuid NOT NULL,
    day date NOT NULL,
    used integer DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cache_read_tokens bigint DEFAULT 0 NOT NULL,
    cache_write_tokens bigint DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assistant_guide_usage_pkey PRIMARY KEY (user_id, day),
    CONSTRAINT assistant_guide_usage_used_check CHECK ((used >= 0) AND (used <= 1000)),
    CONSTRAINT assistant_guide_usage_amount_check CHECK ((input_tokens >= 0) AND (output_tokens >= 0) AND (cache_read_tokens >= 0) AND (cache_write_tokens >= 0) AND (cost_micros >= 0)),
    CONSTRAINT assistant_guide_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.assistant_guide_usage IS 'AI 비서 안내 모드 사용량 — 사람 × 한국 날짜 한 줄 (질문 수 · 토큰 · 비용 US 달러 백만분의 1). 글은 넣지 않는다. 쓰기는 assistant_guide_take · assistant_guide_settle 로만. 서버만';
COMMENT ON COLUMN public.assistant_guide_usage.day IS '한국 시간 날짜 — 하루 한도는 이 날짜마다 센다';
COMMENT ON COLUMN public.assistant_guide_usage.used IS '이 날 받은 질문 수 (서버 쪽 실패는 돌려준다)';

CREATE INDEX IF NOT EXISTS idx_assistant_guide_usage_day ON public.assistant_guide_usage USING btree (day);

-- 3) 함수 --------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assistant_guide_status(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_on boolean;
  v_limit integer;
  v_used integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required';
  END IF;
  SELECT g.guide_on, g.guide_daily_limit INTO v_on, v_limit FROM public.assistant_global g WHERE g.id;
  SELECT u.used INTO v_used FROM public.assistant_guide_usage u WHERE u.user_id = p_user AND u.day = v_day;
  RETURN jsonb_build_object('on', coalesce(v_on, false), 'used', coalesce(v_used, 0), 'limit', coalesce(v_limit, 0),
                            'day', v_day, 'reset_at', ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul'));
END;
$function$;

COMMENT ON FUNCTION public.assistant_guide_status(uuid) IS 'AI 비서 안내 모드 — 오늘(한국 시간) 쓴 질문 수 · 한도 · 스위치 · 다음 한국 0시. 세지 않는다. service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_guide_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_guide_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assistant_guide_take(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_reset timestamp with time zone;
  v_on boolean;
  v_limit integer;
  v_used integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required';
  END IF;
  v_reset := (v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul';

  SELECT g.guide_on, g.guide_daily_limit INTO v_on, v_limit FROM public.assistant_global g WHERE g.id;
  IF NOT coalesce(v_on, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off', 'day', v_day, 'reset_at', v_reset);
  END IF;
  v_limit := coalesce(v_limit, 0);

  IF v_limit >= 1 THEN
    -- 한 줄을 잠그고 한도 안일 때만 하나 센다 (동시에 와도 한도를 넘지 않는다)
    INSERT INTO public.assistant_guide_usage AS u (user_id, day, used)
    VALUES (p_user, v_day, 1)
    ON CONFLICT (user_id, day) DO UPDATE
       SET used = u.used + 1, updated_at = now()
     WHERE u.used < v_limit
    RETURNING u.used INTO v_used;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit, 'day', v_day, 'reset_at', v_reset);
    END IF;
  END IF;

  SELECT u.used INTO v_used FROM public.assistant_guide_usage u WHERE u.user_id = p_user AND u.day = v_day;
  RETURN jsonb_build_object('ok', false, 'reason', 'over_limit', 'used', coalesce(v_used, 0), 'limit', v_limit,
                            'day', v_day, 'reset_at', v_reset);
END;
$function$;

COMMENT ON FUNCTION public.assistant_guide_take(uuid) IS 'AI 비서 안내 모드 — 스위치가 켜 있고 오늘(한국 시간) 쓴 질문이 한도보다 적으면 하나 센다 (줄을 잠가 동시에 와도 한도 안). 아니면 off · over_limit. service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_guide_take(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_guide_take(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assistant_guide_settle(p_user uuid, p_day date, p_cost_micros bigint, p_usage jsonb DEFAULT '{}'::jsonb, p_give_back boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_usage jsonb := coalesce(p_usage, '{}'::jsonb);
  v_used integer;
BEGIN
  IF p_user IS NULL OR p_day IS NULL THEN
    RAISE EXCEPTION 'p_user and p_day are required';
  END IF;
  IF p_cost_micros IS NULL OR p_cost_micros < 0 THEN
    RAISE EXCEPTION 'p_cost_micros must be zero or more';
  END IF;
  IF jsonb_typeof(v_usage) <> 'object' THEN
    RAISE EXCEPTION 'p_usage must be an object';
  END IF;

  UPDATE public.assistant_guide_usage u
     SET used = CASE WHEN coalesce(p_give_back, false) THEN greatest(u.used - 1, 0) ELSE u.used END,
         input_tokens = u.input_tokens + greatest(coalesce((v_usage->>'input_tokens')::bigint, 0), 0),
         output_tokens = u.output_tokens + greatest(coalesce((v_usage->>'output_tokens')::bigint, 0), 0),
         cache_read_tokens = u.cache_read_tokens + greatest(coalesce((v_usage->>'cache_read_input_tokens')::bigint, 0), 0),
         cache_write_tokens = u.cache_write_tokens + greatest(coalesce((v_usage->>'cache_creation_input_tokens')::bigint, 0), 0),
         cost_micros = u.cost_micros + p_cost_micros,
         updated_at = now()
   WHERE u.user_id = p_user AND u.day = p_day
  RETURNING u.used INTO v_used;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'used', v_used);
END;
$function$;

COMMENT ON FUNCTION public.assistant_guide_settle(uuid, date, bigint, jsonb, boolean) IS 'AI 비서 안내 모드 정산 — 그 날 줄에 토큰(Claude usage 칸 이름) · 비용을 더한다. 돌려주기면 센 질문 하나를 돌려준다 (서버 쪽 실패). service_role 전용';

REVOKE ALL ON FUNCTION public.assistant_guide_settle(uuid, date, bigint, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_guide_settle(uuid, date, bigint, jsonb, boolean) TO service_role;

-- 4) 권한 — 서버만, 읽기만 (쓰기는 함수로만) -------------------------------------------

ALTER TABLE public.assistant_guide_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assistant_guide_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.assistant_guide_usage TO service_role;
