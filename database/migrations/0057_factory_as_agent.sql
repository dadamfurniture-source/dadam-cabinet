-- =============================================
-- 0057 — 다담 공장(companies.kind = 'hq')을 Agent 등급처럼 (크레딧 · 장부 · 사진 AI 읽기 · 비서 · 등급 표시)
--
-- 2026-11-10 대표님 결정: 다담 공장은 Agent 등급과 같이 취급하고, 다담 본사(platform)와는 별개로 친다.
-- 플래너 · 문서 · 프로젝트 · 상담 풀 · 제작 의뢰함 · A/S함은 이미 공장을 등급 없이 연다(워커 코드).
-- 아래 넷만 공장을 빼고 있었다 — 시험 예외(assistant_settings.trial)가 켜져 있어야 열리거나, 업체 통장이 없었다.
--
-- 정해 둔 값
--   company_entitled  base · books 에 활성 다담 공장을 더한다 (활성 협력업체 plan agent 와 같은 자리)
--                     ledger      full = Agent · 다담 공장 · 다담 본사 · 시험 예외. read · none 은 그대로
--                     ledger_ai   full = Agent · 다담 공장 · 다담 본사 · 시험 예외
--                     assistant   Agent · 다담 공장 · 시험 예외 + 업체 켬(enabled) + 전체 켬 — 다담 본사는 그대로 아니다
--   consume_credit    다담 공장 active 구성원도 업체 통장(company_credits)에서 쓴다. 월 지급 = credit_plans['agent']
--   my_credit_wallet  화면용 통장도 같다 — scope company · plan agent
--   company_tier_sync 활동 중인 다담 공장의 active 구성원 → profiles.tier = 'agent' (tier_source company).
--                     다담 공장에서 나가면(협력업체도 아니면) 지금처럼 standard · manual 로 돌린다
--   지금 공장 구성원  위 등급 맞추기를 한 번 돌린다 (아래 4)
--
-- 바꾸지 않는 것
--   협력업체 · 다담 본사 자격, refund_credit(_svc)(줄의 company_id 로 돌려준다 — 공장 줄도 그대로 맞다),
--   company_credits_reset_on_plan(공장은 plan 이 없다), 표 · 정책 · 권한
--
-- 다시 돌려도 된다 (OR REPLACE · 같은 값으로 UPDATE).
-- =============================================

-- 1) 업체 기능 자격 — base · books 에 활성 다담 공장 -----------------------------------------

CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR co.kind = 'hq' OR coalesce(s.trial, false)) AS base,
           co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR co.kind = 'hq' OR coalesce(s.trial, false)) AS books,
           co.status = 'active' AND co.kind = 'platform' AS platform,
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
             CASE WHEN (SELECT books OR platform FROM c) THEN 'full'
                  WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company)
                    OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read'
                  ELSE 'none' END
           WHEN p_feature = 'ledger_ai' THEN
             CASE WHEN (SELECT base OR platform FROM c) THEN 'full' ELSE 'none' END
           ELSE 'none'
         END;
$function$;

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none (Agent · 다담 공장 · 시험 — 다담 본사는 아니다), ledger: full(Agent · 다담 공장 · 다담 본사 · 시험) | read(장부 줄 · 사진이 있는 업체 — 등급이 내려가도 보기 · 내보내기, Expert 로 쓰던 업체 포함) | none, ledger_ai(사진 AI 읽기): full(Agent · 다담 공장 · 다담 본사 · 시험) | none. 공장 · 본사는 active 일 때만. 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;

-- 2) 크레딧 — 다담 공장 구성원도 업체 통장 (월 지급 = Agent) ---------------------------------

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

  -- 협력업체 · 다담 공장 구성원이면 업체 통장에서 쓴다 (한 사람은 한 업체에서만 active).
  -- 다담 공장은 plan 이 없어 Agent 로 친다 (0057)
  SELECT c.id, c.status, CASE WHEN c.kind = 'hq' THEN 'agent' ELSE c.plan END
    INTO v_company, v_company_status, v_plan
    FROM company_members m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = v_user
     AND m.status = 'active'
     AND c.kind IN ('partner', 'hq')
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

-- 화면용: 지금 쓰는 통장. 기간이 끝났으면 다음 사용 때 채워질 월 지급을 잔액으로 보인다 (period_end NULL).
-- 다담 공장 구성원도 company · plan agent (0057)
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

  SELECT c.id, c.status, CASE WHEN c.kind = 'hq' THEN 'agent' ELSE c.plan END
    INTO v_company, v_status, v_plan
    FROM company_members m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = v_user
     AND m.status = 'active'
     AND c.kind IN ('partner', 'hq')
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

REVOKE ALL ON FUNCTION public.my_credit_wallet() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_credit_wallet() TO authenticated, service_role;

-- 3) 등급 맞추기 — 활동 중인 다담 공장 구성원은 Agent -----------------------------------------

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

  -- 활동 중인 협력업체 · 다담 공장의 active 구성원 → 업체 등급 (공장은 agent — 0057)
  UPDATE public.profiles p
     SET tier = t.plan, tier_source = 'company'
    FROM (
      SELECT DISTINCT ON (m.user_id) m.user_id, CASE WHEN c.kind = 'hq' THEN 'agent' ELSE c.plan END AS plan
        FROM public.company_members m
        JOIN public.companies c ON c.id = m.company_id
       WHERE m.user_id = ANY (v_users)
         AND m.status = 'active'
         AND c.kind IN ('partner', 'hq')
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
          AND c.kind IN ('partner', 'hq')
          AND c.status = 'active');

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.company_tier_sync() FROM PUBLIC, anon, authenticated, service_role;

-- 4) 지금 다담 공장 구성원 — 등급을 한 번 맞춘다 (트리거와 같은 식) ---------------------------

UPDATE public.profiles p
   SET tier = 'agent', tier_source = 'company'
  FROM public.company_members m
  JOIN public.companies c ON c.id = m.company_id
 WHERE m.user_id = p.id
   AND m.status = 'active'
   AND c.kind = 'hq'
   AND c.status = 'active'
   AND (p.tier IS DISTINCT FROM 'agent' OR p.tier_source IS DISTINCT FROM 'company');
