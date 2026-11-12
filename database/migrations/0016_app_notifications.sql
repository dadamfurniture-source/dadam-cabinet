-- =============================================
-- 0016 — 앱 알림 (웹 푸시): 기기 등록 · 보낼 알림 · 본사 Slack 은 본사 상담만
--
-- push_subscriptions   기기 한 대 = 한 줄 (endpoint 유일). 사람 + 업체에 묶는다.
--                      company_id 가 비어 있으면 업체가 아직 없는 신청자 — 신청 진행 알림만 받는다.
-- notification_outbox  보낼 알림 한 줄 = 받는 사람 한 명. 서버가 일이 생길 때 넣고, 1분마다 잡아 보낸다.
--                      글(title · body)에는 고객 이름 · 전화 · 주소 · 금액을 넣지 않는다 (서버가 지킨다).
--                      누르면 열 곳(url)은 앱 안(/segan/…)만.
-- 두 표 모두 서버(service_role)만 읽고 쓴다. 화면은 서버 API 로만 닿는다.
--
-- 정리
--   구성원에서 빠지면(removed · 행 삭제) 그 사람의 그 업체 기기 등록과 아직 안 보낸 알림을 지운다.
--   업체가 정지(suspended)되면 대표가 아닌 구성원의 기기 등록 · 안 보낸 알림을 지운다
--     (대표는 정지 · 결제 알림을 받아야 하므로 남긴다). 그 밖에 active 가 아니게 되면 그 업체 것을 모두 지운다.
--   회원 탈퇴(auth.users 삭제)는 FK CASCADE 로 함께 지워진다.
--
-- 본사 Slack 새 상담 알림(claim_consultation_notices, 0002)은 본사 상담(company_id = 본사)만 잡는다.
-- 돌려주는 모양은 그대로.
--
-- 다시 돌려도 된다.
-- =============================================

-- 기기 등록 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    fail_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    CONSTRAINT push_subscriptions_endpoint_check CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
    CONSTRAINT push_subscriptions_keys_check CHECK (length(p256dh) BETWEEN 1 AND 200 AND length(auth) BETWEEN 1 AND 100),
    CONSTRAINT push_subscriptions_user_agent_check CHECK (user_agent IS NULL OR length(user_agent) <= 300),
    CONSTRAINT push_subscriptions_fail_count_check CHECK (fail_count >= 0),
    CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT push_subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.push_subscriptions IS '앱 알림 기기 등록 — 기기 한 대 한 줄. company_id 비면 업체가 아직 없는 신청자. 서버(service_role)만';

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_company ON public.push_subscriptions USING btree (company_id);

-- 보낼 알림 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    url text NOT NULL,
    ref_id uuid,
    dedupe_key text,
    state text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    send_after timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT notification_outbox_dedupe_key UNIQUE (dedupe_key),
    CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text])),
    CONSTRAINT notification_outbox_company_check CHECK (company_id IS NOT NULL OR kind = 'partner_application'::text),
    CONSTRAINT notification_outbox_state_check CHECK (state = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
    CONSTRAINT notification_outbox_text_check CHECK (length(title) BETWEEN 1 AND 60 AND length(body) BETWEEN 1 AND 160 AND (dedupe_key IS NULL OR length(dedupe_key) <= 200) AND (last_error IS NULL OR length(last_error) <= 300)),
    CONSTRAINT notification_outbox_url_check CHECK (url ~ '^/segan/' AND length(url) <= 300),
    CONSTRAINT notification_outbox_attempts_check CHECK (attempts >= 0),
    CONSTRAINT notification_outbox_sent_check CHECK ((state = 'sent'::text) = (sent_at IS NOT NULL)),
    CONSTRAINT notification_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT notification_outbox_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_outbox IS '보낼 앱 알림 — 받는 사람 한 명 한 줄. 글에 고객 개인정보 · 금액 없음, url 은 /segan/ 안. 서버(service_role)만';

CREATE INDEX IF NOT EXISTS idx_notification_outbox_queued ON public.notification_outbox USING btree (send_after, created_at) WHERE (state = 'queued'::text);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user ON public.notification_outbox USING btree (user_id, company_id) WHERE (state = 'queued'::text);

-- 잡기: 보낼 때가 된 queued 줄을 잡아 attempts + 1. 잡은 지 5분 넘게 안 끝난 줄은 다시 잡는다. 5번째까지.
CREATE OR REPLACE FUNCTION public.claim_notifications(p_limit integer DEFAULT 50)
 RETURNS SETOF public.notification_outbox
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  UPDATE public.notification_outbox o
     SET claimed_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
           SELECT q.id
             FROM public.notification_outbox q
            WHERE q.state = 'queued'
              AND q.send_after <= now()
              AND q.attempts < 5
              AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '5 minutes')
            ORDER BY q.send_after, q.created_at, q.id
            LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
              FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$function$;

COMMENT ON FUNCTION public.claim_notifications(integer) IS '보낼 앱 알림 잡기 (attempts + 1, 5분 지나면 다시, 5번까지). service_role 전용 (workflow-api cron)';

REVOKE ALL ON FUNCTION public.claim_notifications(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_notifications(integer) TO service_role;

-- 정리 트리거 --------------------------------------------------------------------

-- 구성원에서 빠지면 그 사람의 그 업체 기기 등록 · 안 보낸 알림을 지운다
CREATE OR REPLACE FUNCTION public.push_cleanup_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.status <> 'active' THEN
    DELETE FROM public.push_subscriptions s WHERE s.user_id = OLD.user_id AND s.company_id = OLD.company_id;
    DELETE FROM public.notification_outbox n WHERE n.user_id = OLD.user_id AND n.company_id = OLD.company_id AND n.state = 'queued';
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_cleanup_member ON public.company_members;
CREATE TRIGGER trg_push_cleanup_member AFTER DELETE OR UPDATE OF status ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.push_cleanup_member();

-- 업체가 active 에서 벗어나면: 정지는 대표 것만 남기고, 그 밖은 모두 지운다
CREATE OR REPLACE FUNCTION public.push_cleanup_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'active' THEN
    IF NEW.status = 'suspended' THEN
      DELETE FROM public.push_subscriptions s
       WHERE s.company_id = NEW.id
         AND NOT EXISTS (SELECT 1 FROM public.company_members m
                          WHERE m.company_id = NEW.id AND m.user_id = s.user_id AND m.role = 'owner' AND m.status = 'active');
      DELETE FROM public.notification_outbox n
       WHERE n.company_id = NEW.id AND n.state = 'queued'
         AND NOT EXISTS (SELECT 1 FROM public.company_members m
                          WHERE m.company_id = NEW.id AND m.user_id = n.user_id AND m.role = 'owner' AND m.status = 'active');
    ELSE
      DELETE FROM public.push_subscriptions s WHERE s.company_id = NEW.id;
      DELETE FROM public.notification_outbox n WHERE n.company_id = NEW.id AND n.state = 'queued';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_cleanup_company ON public.companies;
CREATE TRIGGER trg_push_cleanup_company AFTER UPDATE OF status ON public.companies FOR EACH ROW EXECUTE FUNCTION public.push_cleanup_company();

REVOKE ALL ON FUNCTION public.push_cleanup_member() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.push_cleanup_company() FROM PUBLIC, anon, authenticated, service_role;

-- RLS · 권한: 서버만 ------------------------------------------------------------

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_outbox TO service_role;

-- 본사 Slack 새 상담 알림은 본사 상담만 (0002 함수, 돌려주는 모양 그대로) ---------------------

CREATE OR REPLACE FUNCTION public.claim_consultation_notices(p_fresh_since timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_stale integer;
  v_rows jsonb;
BEGIN
  IF p_fresh_since IS NULL THEN
    RAISE EXCEPTION 'p_fresh_since is required';
  END IF;

  WITH stale AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT s.id
               FROM public.consultations s
              WHERE s.notified_at IS NULL
                AND s.company_id = public.hq_company_id()
                AND (s.created_at IS NULL OR s.created_at < p_fresh_since)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id
  )
  SELECT count(*)::integer INTO v_stale FROM stale;

  WITH claimed AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT f.id
               FROM public.consultations f
              WHERE f.notified_at IS NULL
                AND f.company_id = public.hq_company_id()
                AND f.created_at >= p_fresh_since
              ORDER BY f.created_at, f.id
              LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id, c.created_at, c.consultation_type, c.furniture_categories, c.preferred_date,
              c.preferred_time, c.sido, c.gugun, c.consult_target, c.generation_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', k.created_at,
           'consultation_type', k.consultation_type,
           'furniture_categories', k.furniture_categories,
           'preferred_date', k.preferred_date,
           'preferred_time', k.preferred_time,
           'sido', k.sido,
           'gugun', k.gugun,
           'consult_target', k.consult_target,
           'has_generation', k.generation_id IS NOT NULL,
           'category', g.category)
         ORDER BY k.created_at, k.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed k
    LEFT JOIN public.generations g ON g.id = k.generation_id;

  RETURN jsonb_build_object('stale', v_stale, 'rows', v_rows);
END;
$function$;

COMMENT ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) IS '새 상담 Slack 알림 — 본사 상담(company_id = 본사)의 미알림 행을 잡아 notified_at 표시 (오래된 행은 표시만). service_role 전용 (workflow-api cron)';

REVOKE ALL ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) TO service_role;
