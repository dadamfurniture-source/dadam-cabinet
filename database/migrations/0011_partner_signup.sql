-- =============================================
-- 0011 — 협력업체 가입: 신청 · 업체 크레딧 · 업체 구독 · 직원 초대 · 등급 맞추기
--
-- 업체는 첫 결제 때 만든다 (payments-api). Expert 는 바로 결제, Agent 는 승인된 신청이 있어야 결제한다.
--
--   companies              sido · gugun (지역), next_plan (다음 결제일부터 바꿀 등급), created_by.
--                          협력업체(partner)는 plan 이 꼭 있다.
--   partner_applications   Agent 신청. kind new(새 업체) | upgrade(Expert 업체가 Agent 로).
--                          status applied → meeting → approved | held, 신청자가 거두면 withdrawn.
--                          used_at = 승인된 신청을 쓴 때 (new: 결제로 업체를 만든 때 / upgrade: next_plan 을 넣은 때).
--                          한 사람이 열린 신청(applied · meeting · 아직 안 쓴 approved)은 하나만.
--                          쓰기는 service_role 만 (account-api). 읽기는 신청자 본인 · 관리자.
--                          대표자 이름 · 연락처 · 사업자번호가 있어 신청자 계정을 지우면 함께 지운다 (CASCADE).
--   company_credits        업체 크레딧 통장 하나 — 구성원이 함께 쓴다. 쓰기는 함수만. 읽기는 구성원 · 관리자.
--   credit_ledger          company_id 칸 — 업체 통장에서 쓴 줄. user_id 는 쓴 사람.
--   subscriptions          company_id 칸 — 업체 구독. user_id 는 결제한 사람(대표).
--                          한 업체에 살아 있는 구독(active · past_due · trialing)은 하나만. 대표는 자기 업체 구독을 읽는다.
--   company_invites        직원 초대. 링크 토큰은 sha256 hex 만 저장한다. 쓰기는 service_role 만. 대표는 토큰 없이 읽는다.
--
--   consume_credit         활동 중인 협력업체 구성원이면 업체 통장에서 쓴다 (월 지급 = credit_plans[업체 plan]).
--                          업체가 active 가 아니면(정지 · 해지) 'company_inactive'. 그 밖의 사람은 지금처럼 자기 통장.
--   refund_credit(_svc)    줄에 company_id 가 있으면 업체 통장으로 돌려준다.
--   my_credit_wallet()     화면용 — 지금 쓰는 통장(company | personal) · 잔액 · 월 지급 · 다음 리셋 · 쓸 수 있는지.
--   claim_partner_application_notices
--                          새 신청 Slack 알림 잡기 (workflow-api cron, service_role). 건수와 종류만 돌려준다.
--
--   등급 맞추기 (옛 관문 profiles.tier 용)
--     활동 중인 협력업체(status active)의 active 구성원 → profiles.tier = 업체 plan, tier_source = 'company'.
--     그렇지 않게 되면(내보냄 · 정지 · 해지) tier_source 가 'company' 인 사람만 standard · manual 로 돌린다.
--     company_members 넣기 · 바꾸기 · 지우기, companies 의 status · plan 바꾸기 뒤에 트리거가 맞춘다.
--     block_self_tier_change 는 service_role · 관리자에 더해 DB 소유자(postgres — 이 트리거 · 마이그레이션)도 허용한다.
--     회원(authenticated)이 자기 등급을 바꾸는 길은 그대로 막혀 있다.
--   업체 plan 이 바뀌면 업체 통장의 이번 기간을 끝내 다음 사용 때 새 등급만큼 채운다 (사람 등급과 같은 방식).
--
-- 다시 돌려도 된다 (IF NOT EXISTS · OR REPLACE · DROP … IF EXISTS 다음 CREATE).
-- =============================================

-- 1) companies 칸 ------------------------------------------------------------

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS sido text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS gugun text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS next_plan text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_partner_plan_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_partner_plan_check CHECK (kind = 'hq'::text OR plan IS NOT NULL);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_next_plan_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_next_plan_check CHECK (
    next_plan IS NULL OR (kind = 'partner'::text AND next_plan = ANY (ARRAY['expert'::text, 'agent'::text]) AND next_plan IS DISTINCT FROM plan));
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_region_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_region_check CHECK (
    coalesce(length(sido), 0) <= 20 AND coalesce(length(gugun), 0) <= 40);
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_created_by_fkey;
ALTER TABLE public.companies ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.companies.next_plan IS '다음 결제일부터 바꿀 등급 (expert | agent). 결제 서버가 갱신 때 plan 으로 옮기고 비운다';

-- 2) partner_applications ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.partner_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid,
    kind text NOT NULL,
    plan text DEFAULT 'agent'::text NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    company_name text NOT NULL,
    representative_name text NOT NULL,
    contact_phone text NOT NULL,
    sido text NOT NULL,
    gugun text NOT NULL,
    business_number text NOT NULL,
    intro text NOT NULL,
    meeting_at timestamp with time zone,
    decided_by uuid,
    decided_at timestamp with time zone,
    used_at timestamp with time zone,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_applications_pkey PRIMARY KEY (id),
    CONSTRAINT partner_applications_kind_check CHECK (kind = ANY (ARRAY['new'::text, 'upgrade'::text])),
    CONSTRAINT partner_applications_plan_check CHECK (plan = 'agent'::text),
    CONSTRAINT partner_applications_status_check CHECK (status = ANY (ARRAY['applied'::text, 'meeting'::text, 'approved'::text, 'held'::text, 'withdrawn'::text])),
    CONSTRAINT partner_applications_upgrade_company_check CHECK (kind = 'new'::text OR company_id IS NOT NULL),
    CONSTRAINT partner_applications_used_check CHECK (used_at IS NULL OR (status = 'approved'::text AND company_id IS NOT NULL)),
    CONSTRAINT partner_applications_len_check CHECK (
        length(company_name) BETWEEN 1 AND 100
        AND length(representative_name) BETWEEN 1 AND 50
        AND length(sido) BETWEEN 1 AND 20
        AND length(gugun) BETWEEN 1 AND 40
        AND length(intro) BETWEEN 1 AND 200),
    CONSTRAINT partner_applications_phone_check CHECK (contact_phone ~ '^[0-9][0-9-]{7,19}$'),
    CONSTRAINT partner_applications_bizno_check CHECK (business_number ~ '^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$'),
    CONSTRAINT partner_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT partner_applications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT partner_applications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.partner_applications IS 'Agent 신청 (new | upgrade). 쓰기는 service_role 만. 신청자 계정을 지우면 함께 지운다';

CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_one_open ON public.partner_applications USING btree (user_id)
    WHERE (status = ANY (ARRAY['applied'::text, 'meeting'::text]) OR (status = 'approved'::text AND used_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_partner_applications_status ON public.partner_applications USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_applications_unnotified ON public.partner_applications USING btree (created_at) WHERE (notified_at IS NULL);

DROP TRIGGER IF EXISTS trg_partner_applications_touch ON public.partner_applications;
CREATE TRIGGER trg_partner_applications_touch BEFORE UPDATE ON public.partner_applications FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

-- 3) company_credits · credit_ledger.company_id ------------------------------

CREATE TABLE IF NOT EXISTS public.company_credits (
    company_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    period_start timestamp with time zone DEFAULT now() NOT NULL,
    period_end timestamp with time zone DEFAULT (now() + '1 mon'::interval) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_credits_pkey PRIMARY KEY (company_id),
    CONSTRAINT company_credits_balance_check CHECK (balance >= 0),
    CONSTRAINT company_credits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.company_credits IS '업체 크레딧 통장 — 구성원이 함께 쓴다. 쓰기는 consume_credit · refund 함수 · service_role 만';

ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_company_id_fkey;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_company ON public.credit_ledger USING btree (company_id, created_at DESC) WHERE (company_id IS NOT NULL);

-- 4) subscriptions.company_id -------------------------------------------------

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_company_id_fkey;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_company ON public.subscriptions USING btree (company_id)
    WHERE (company_id IS NOT NULL AND status = ANY (ARRAY['active'::text, 'past_due'::text, 'trialing'::text]));

-- 5) company_invites ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT company_invites_pkey PRIMARY KEY (id),
    CONSTRAINT company_invites_token_hash_key UNIQUE (token_hash),
    CONSTRAINT company_invites_role_check CHECK (role = ANY (ARRAY['manager'::text, 'staff'::text])),
    CONSTRAINT company_invites_token_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT company_invites_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT company_invites_accept_check CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
    CONSTRAINT company_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT company_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT company_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_invites IS '업체 직원 초대. 토큰은 sha256 hex 만. 쓰기는 service_role 만';

CREATE INDEX IF NOT EXISTS idx_company_invites_company ON public.company_invites USING btree (company_id, created_at DESC);

-- 6) 등급 맞추기 --------------------------------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tier_source_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tier_source_check CHECK ((tier_source = ANY (ARRAY['manual'::text, 'subscription'::text, 'company'::text])));

CREATE OR REPLACE FUNCTION public.block_self_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier
     OR OLD.tier_source IS DISTINCT FROM NEW.tier_source THEN
    -- postgres: DB 소유자 — 업체 등급 맞추기 트리거(SECURITY DEFINER) · 마이그레이션. 회원은 이 역할이 될 수 없다
    IF current_user NOT IN ('service_role', 'postgres') AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'tier / tier_source 는 관리자 또는 결제 서비스만 변경할 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_tier_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_users uuid[];
BEGIN
  IF TG_TABLE_NAME = 'company_members' THEN
    IF TG_OP = 'DELETE' THEN
      v_users := ARRAY[OLD.user_id];
    ELSIF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      v_users := ARRAY[NEW.user_id, OLD.user_id];
    ELSE
      v_users := ARRAY[NEW.user_id];
    END IF;
  ELSE
    SELECT coalesce(array_agg(m.user_id), ARRAY[]::uuid[]) INTO v_users
      FROM public.company_members m
     WHERE m.company_id = NEW.id;
  END IF;

  -- 활동 중인 협력업체의 active 구성원 → 업체 등급
  UPDATE public.profiles p
     SET tier = t.plan, tier_source = 'company'
    FROM (
      SELECT DISTINCT ON (m.user_id) m.user_id, c.plan
        FROM public.company_members m
        JOIN public.companies c ON c.id = m.company_id
       WHERE m.user_id = ANY (v_users)
         AND m.status = 'active'
         AND c.kind = 'partner'
         AND c.status = 'active'
       ORDER BY m.user_id, m.created_at
    ) t
   WHERE p.id = t.user_id
     AND (p.tier IS DISTINCT FROM t.plan OR p.tier_source IS DISTINCT FROM 'company');

  -- 업체로 받은 등급인데 이제 그런 업체가 없으면 standard
  UPDATE public.profiles p
     SET tier = 'standard', tier_source = 'manual'
   WHERE p.id = ANY (v_users)
     AND p.tier_source = 'company'
     AND NOT EXISTS (
       SELECT 1
         FROM public.company_members m
         JOIN public.companies c ON c.id = m.company_id
        WHERE m.user_id = p.id
          AND m.status = 'active'
          AND c.kind = 'partner'
          AND c.status = 'active');

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_company_members_tier_sync ON public.company_members;
CREATE TRIGGER trg_company_members_tier_sync AFTER INSERT OR DELETE OR UPDATE OF user_id, status, company_id ON public.company_members
    FOR EACH ROW EXECUTE FUNCTION public.company_tier_sync();
DROP TRIGGER IF EXISTS trg_companies_tier_sync ON public.companies;
CREATE TRIGGER trg_companies_tier_sync AFTER UPDATE OF status, plan ON public.companies
    FOR EACH ROW WHEN ((OLD.status IS DISTINCT FROM NEW.status) OR (OLD.plan IS DISTINCT FROM NEW.plan))
    EXECUTE FUNCTION public.company_tier_sync();

CREATE OR REPLACE FUNCTION public.company_credits_reset_on_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.company_credits w SET period_end = now(), updated_at = now() WHERE w.company_id = NEW.id;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_companies_credits_reset ON public.companies;
CREATE TRIGGER trg_companies_credits_reset AFTER UPDATE OF plan ON public.companies
    FOR EACH ROW WHEN (OLD.plan IS DISTINCT FROM NEW.plan)
    EXECUTE FUNCTION public.company_credits_reset_on_plan();

-- 7) 크레딧 함수 --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_credit(p_reason text DEFAULT 'generate'::text)
 RETURNS TABLE(ref uuid, balance integer, cost integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_tier TEXT;
  v_grant INT;
  v_cost INT;
  v_ref UUID := gen_random_uuid();
  v_balance INT;
  v_company UUID;
  v_company_status TEXT;
  v_plan TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 등록되지 않은 동작은 기본 단가로 받는다. 0 이나 NULL 로 떨어뜨리면
  -- 오타 하나에 공짜 생성이 열린다.
  SELECT cc.credits INTO v_cost FROM credit_costs cc WHERE cc.action = p_reason;
  v_cost := COALESCE(v_cost, (SELECT cc.credits FROM credit_costs cc WHERE cc.action = 'generate'), 20);

  -- 협력업체 구성원이면 업체 통장에서 쓴다 (한 사람은 한 업체에서만 active)
  SELECT c.id, c.status, c.plan INTO v_company, v_company_status, v_plan
    FROM company_members m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = v_user
     AND m.status = 'active'
     AND c.kind = 'partner'
   LIMIT 1;

  IF v_company IS NOT NULL THEN
    IF v_company_status <> 'active' THEN
      RAISE EXCEPTION 'company_inactive';
    END IF;

    SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = v_plan;
    v_grant := COALESCE(v_grant, 0);

    INSERT INTO company_credits (company_id, balance, period_start, period_end)
    VALUES (v_company, v_grant, now(), now() + INTERVAL '1 month')
    ON CONFLICT (company_id) DO NOTHING;

    SELECT w.balance INTO v_balance FROM company_credits w WHERE w.company_id = v_company FOR UPDATE;

    IF (SELECT w.period_end FROM company_credits w WHERE w.company_id = v_company) <= now() THEN
      UPDATE company_credits w
        SET balance = v_grant, period_start = now(), period_end = now() + INTERVAL '1 month', updated_at = now()
        WHERE w.company_id = v_company;
      v_balance := v_grant;
      INSERT INTO credit_ledger (user_id, company_id, delta, reason, balance_after)
      VALUES (v_user, v_company, v_grant, 'plan_reset', v_grant);
    END IF;

    IF v_balance < v_cost THEN
      RAISE EXCEPTION 'insufficient_credit';
    END IF;

    UPDATE company_credits w
      SET balance = w.balance - v_cost, updated_at = now()
      WHERE w.company_id = v_company
      RETURNING w.balance INTO v_balance;

    INSERT INTO credit_ledger (user_id, company_id, delta, reason, ref, balance_after)
    VALUES (v_user, v_company, -v_cost, p_reason, v_ref, v_balance);

    RETURN QUERY SELECT v_ref, v_balance, v_cost;
    RETURN;
  END IF;

  SELECT p.tier INTO v_tier FROM profiles p WHERE p.id = v_user;
  SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = COALESCE(v_tier, 'standard');
  v_grant := COALESCE(v_grant, 0);

  INSERT INTO user_credits (user_id, balance, period_start, period_end)
  VALUES (v_user, v_grant, now(), now() + INTERVAL '1 month')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT uc.balance INTO v_balance FROM user_credits uc WHERE uc.user_id = v_user FOR UPDATE;

  IF (SELECT uc.period_end FROM user_credits uc WHERE uc.user_id = v_user) <= now() THEN
    UPDATE user_credits uc
      SET balance = v_grant, period_start = now(), period_end = now() + INTERVAL '1 month', updated_at = now()
      WHERE uc.user_id = v_user;
    v_balance := v_grant;
    INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
    VALUES (v_user, v_grant, 'plan_reset', v_grant);
  END IF;

  -- 남은 게 단가보다 적으면 못 쓴다. 0 보다 큰지가 아니라 단가와 견준다 —
  -- 안 그러면 5 크레딧 남은 사람이 20짜리 생성을 하고 잔액이 음수가 된다.
  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credit';
  END IF;

  UPDATE user_credits uc
    SET balance = uc.balance - v_cost, updated_at = now()
    WHERE uc.user_id = v_user
    RETURNING uc.balance INTO v_balance;

  INSERT INTO credit_ledger (user_id, delta, reason, ref, balance_after)
  VALUES (v_user, -v_cost, p_reason, v_ref, v_balance);

  RETURN QUERY SELECT v_ref, v_balance, v_cost;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credit(p_ref uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row credit_ledger%ROWTYPE;
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_row FROM credit_ledger
    WHERE credit_ledger.ref = p_ref
      AND credit_ledger.user_id = v_user
      AND credit_ledger.delta < 0
      AND credit_ledger.refunded = FALSE
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  IF v_row.company_id IS NOT NULL THEN
    UPDATE company_credits w SET balance = w.balance + (-v_row.delta), updated_at = now()
      WHERE w.company_id = v_row.company_id RETURNING w.balance INTO v_balance;
  ELSE
    UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
      WHERE uc.user_id = v_user RETURNING uc.balance INTO v_balance;
  END IF;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, company_id, delta, reason, balance_after)
  VALUES (v_user, v_row.company_id, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credit_svc(p_ref uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row credit_ledger%ROWTYPE;
  v_balance INT;
BEGIN
  SELECT * INTO v_row FROM credit_ledger
    WHERE credit_ledger.ref = p_ref
      AND credit_ledger.delta < 0
      AND credit_ledger.refunded = FALSE
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  IF v_row.company_id IS NOT NULL THEN
    UPDATE company_credits w SET balance = w.balance + (-v_row.delta), updated_at = now()
      WHERE w.company_id = v_row.company_id RETURNING w.balance INTO v_balance;
  ELSE
    UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
      WHERE uc.user_id = v_row.user_id RETURNING uc.balance INTO v_balance;
  END IF;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, company_id, delta, reason, balance_after)
  VALUES (v_row.user_id, v_row.company_id, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$function$;

-- 화면용: 지금 쓰는 통장. 기간이 끝났으면 다음 사용 때 채워질 월 지급을 잔액으로 보인다 (period_end NULL).
CREATE OR REPLACE FUNCTION public.my_credit_wallet()
 RETURNS TABLE(scope text, company_id uuid, plan text, balance integer, monthly integer, period_end timestamp with time zone, usable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid;
  v_status text;
  v_plan text;
  v_grant int;
  v_bal int;
  v_end timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT c.id, c.status, c.plan INTO v_company, v_status, v_plan
    FROM company_members m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = v_user
     AND m.status = 'active'
     AND c.kind = 'partner'
   LIMIT 1;

  IF v_company IS NOT NULL THEN
    SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = v_plan;
    SELECT w.balance, w.period_end INTO v_bal, v_end FROM company_credits w WHERE w.company_id = v_company;
    IF v_end IS NULL OR v_end <= now() THEN
      v_bal := COALESCE(v_grant, 0);
      v_end := NULL;
    END IF;
    RETURN QUERY SELECT 'company'::text, v_company, v_plan, v_bal, COALESCE(v_grant, 0), v_end, (v_status = 'active');
    RETURN;
  END IF;

  SELECT p.tier INTO v_plan FROM profiles p WHERE p.id = v_user;
  v_plan := COALESCE(v_plan, 'standard');
  SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = v_plan;
  SELECT uc.balance, uc.period_end INTO v_bal, v_end FROM user_credits uc WHERE uc.user_id = v_user;
  IF v_end IS NULL OR v_end <= now() THEN
    v_bal := COALESCE(v_grant, 0);
    v_end := NULL;
  END IF;
  RETURN QUERY SELECT 'personal'::text, NULL::uuid, v_plan, v_bal, COALESCE(v_grant, 0), v_end, true;
END;
$function$;

-- 8) 새 신청 알림 잡기 (claim_consultation_notices 와 같은 모양) ---------------
--   p_fresh_since 보다 오래된 행은 알리지 않고 표시만 한다 → 'stale'
--   그 뒤 행은 오래된 것부터 p_limit 건(1~50)을 표시하고 돌려준다 → 'rows' (created_at · kind 만)
--   이름 · 대표자 · 연락처 · 사업자번호 · 소개는 돌려주지 않는다. SECURITY INVOKER — service_role 만 부른다.
CREATE OR REPLACE FUNCTION public.claim_partner_application_notices(p_fresh_since timestamp with time zone, p_limit integer DEFAULT 20)
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
    UPDATE public.partner_applications a
       SET notified_at = now()
     WHERE a.id IN (
             SELECT s.id
               FROM public.partner_applications s
              WHERE s.notified_at IS NULL
                AND s.created_at < p_fresh_since
                FOR UPDATE SKIP LOCKED)
    RETURNING a.id
  )
  SELECT count(*)::integer INTO v_stale FROM stale;

  WITH claimed AS (
    UPDATE public.partner_applications a
       SET notified_at = now()
     WHERE a.id IN (
             SELECT f.id
               FROM public.partner_applications f
              WHERE f.notified_at IS NULL
                AND f.created_at >= p_fresh_since
              ORDER BY f.created_at, f.id
              LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
                FOR UPDATE SKIP LOCKED)
    RETURNING a.created_at, a.kind
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('created_at', k.created_at, 'kind', k.kind) ORDER BY k.created_at), '[]'::jsonb)
    INTO v_rows
    FROM claimed k;

  RETURN jsonb_build_object('stale', v_stale, 'rows', v_rows);
END;
$function$;

-- 9) 함수 권한 ----------------------------------------------------------------

REVOKE ALL ON FUNCTION public.company_tier_sync() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.company_credits_reset_on_plan() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_credit_wallet() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_credit_wallet() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_partner_application_notices(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_partner_application_notices(timestamp with time zone, integer) TO service_role;
-- consume_credit · refund_credit · refund_credit_svc 는 CREATE OR REPLACE 라 기존 권한 그대로

-- 10) RLS · 권한 ---------------------------------------------------------------

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_applications, public.company_credits, public.company_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.partner_applications, public.company_credits TO authenticated;
-- 초대: 토큰 해시는 읽지 못한다
GRANT SELECT (id, company_id, role, created_by, created_at, expires_at, accepted_by, accepted_at, revoked_at) ON TABLE public.company_invites TO authenticated;
GRANT ALL ON TABLE public.partner_applications, public.company_credits, public.company_invites TO service_role;
-- 업체 통장 줄: 기존 열 권한에 company_id 를 더한다
GRANT SELECT (company_id) ON TABLE public.credit_ledger TO authenticated;

-- partner_applications
DROP POLICY IF EXISTS partner_applications_own_read ON public.partner_applications;
CREATE POLICY partner_applications_own_read ON public.partner_applications
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS partner_applications_admin_read ON public.partner_applications;
CREATE POLICY partner_applications_admin_read ON public.partner_applications
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

-- company_credits
DROP POLICY IF EXISTS company_credits_member_read ON public.company_credits;
CREATE POLICY company_credits_member_read ON public.company_credits
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS company_credits_admin_read ON public.company_credits;
CREATE POLICY company_credits_admin_read ON public.company_credits
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

-- company_invites
DROP POLICY IF EXISTS company_invites_owner_read ON public.company_invites;
CREATE POLICY company_invites_owner_read ON public.company_invites
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text])));

DROP POLICY IF EXISTS company_invites_admin_read ON public.company_invites;
CREATE POLICY company_invites_admin_read ON public.company_invites
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

-- subscriptions: 대표는 자기 업체 구독을 읽는다
DROP POLICY IF EXISTS subscriptions_company_owner_select ON public.subscriptions;
CREATE POLICY subscriptions_company_owner_select ON public.subscriptions
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text])));
