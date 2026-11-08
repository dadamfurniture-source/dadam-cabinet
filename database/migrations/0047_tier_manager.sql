-- =============================================
-- 0047 — 새 등급 manager (standard < manager < expert < agent) · 회계장부 full 은 Agent 만
--
-- 등급 목록에 manager 를 더한다. 사람 등급 · 크레딧 지급표 · 구독 · 업체 plan 이 모두 받는다.
-- 회계장부(ledger) full 은 Agent(와 시험 업체)로 좁힌다 — 0038 에서 Expert 로 넓힌 books 조건을 agent 하나로.
--
-- 정해 둔 값
--   등급 목록      profiles.tier · credit_plans.tier            standard · manager · expert · agent
--                  subscriptions.plan                           free · manager · expert · agent
--                  companies.plan · companies.next_plan (협력업체) manager · expert · agent (next_plan 은 plan 과 달라야 — 그대로)
--                  partner_applications.plan 은 그대로 agent 만 (Manager · Expert 는 신청 없이 바로 결제한다)
--   월 크레딧      manager 500. standard · expert · agent 줄은 건드리지 않는다. manager 줄이 이미 있으면 그대로 둔다
--   ledger         full = 활성 협력업체 plan agent, 또는 시험 예외(assistant_settings.trial) — 0038 의 expert · agent 에서 agent 만
--                  read · none 은 0028 · 0038 그대로: 장부 줄 · 사진이 있는 업체는 등급이 무엇이든 read(보기 · 내보내기).
--                  그래서 Expert 로 장부를 쓰던 업체는 read 로 내려가고 줄 · 사진은 지우지 않는다. 줄 · 사진이 없는 Expert · Manager 업체는 none
--   ledger_ai · assistant   그대로 (Agent · 시험)
--   월 보고        ledger_month_report_scan(0038) 은 ledger 자격 full 업체만 돈다 — 함수는 그대로라, 이 파일 뒤로 Expert 업체(시험 예외 빼고)는
--                  month_report 알림을 받지 않는다. 이미 쌓인 알림은 그대로
--   profile_stats  manager_users 를 맨 끝 열로 (CREATE OR REPLACE VIEW 는 끝에만 열을 더할 수 있다). security_invoker · 권한은 0000 그대로
--
-- 바꾸지 않는 것
--   company_members.role 의 'manager' 는 업체 안 직책(실장)이다 — 등급과 다른 값. 역할 제약 · 정책 · 함수는 건드리지 않는다
--
-- 바꾸는 것
--   profiles_tier_check · credit_plans_tier_check · subscriptions_plan_check     0000 정의 + manager (지우고 같은 이름으로)
--   companies_plan_check (0003) · companies_next_plan_check (0011)             + manager (지우고 같은 이름으로)
--   credit_plans                         manager 줄 (500)
--   company_entitled(업체, 기능, 사람)    0038 본문에서 books 조건만 plan agent
--   profile_stats                        manager_users 열
--   설명(COMMENT)                         companies · companies.next_plan · company_entitled 의 값 목록
--
-- 다시 돌려도 된다 (DROP CONSTRAINT IF EXISTS 다음 ADD · ON CONFLICT DO NOTHING · OR REPLACE).
-- =============================================

-- 1) 등급 · plan 값 목록에 manager -------------------------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'manager'::text, 'expert'::text, 'agent'::text])));

ALTER TABLE public.credit_plans DROP CONSTRAINT IF EXISTS credit_plans_tier_check;
ALTER TABLE public.credit_plans
    ADD CONSTRAINT credit_plans_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'manager'::text, 'expert'::text, 'agent'::text])));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'manager'::text, 'expert'::text, 'agent'::text])));

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_plan_check;
ALTER TABLE public.companies
    ADD CONSTRAINT companies_plan_check CHECK (plan IS NULL OR (kind = 'partner'::text AND plan = ANY (ARRAY['manager'::text, 'expert'::text, 'agent'::text])));

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_next_plan_check;
ALTER TABLE public.companies
    ADD CONSTRAINT companies_next_plan_check CHECK (
    next_plan IS NULL OR (kind = 'partner'::text AND next_plan = ANY (ARRAY['manager'::text, 'expert'::text, 'agent'::text]) AND next_plan IS DISTINCT FROM plan));

COMMENT ON TABLE public.companies IS '회사 — 본사(hq, 하나뿐)와 파트너(partner, plan manager | expert | agent)';
COMMENT ON COLUMN public.companies.next_plan IS '다음 결제일부터 바꿀 등급 (manager | expert | agent). 결제 서버가 갱신 때 plan 으로 옮기고 비운다';

-- 2) 월 크레딧 — manager 500 ----------------------------------------------------------------

INSERT INTO public.credit_plans (tier, monthly_credits, updated_at)
VALUES ('manager', 500, now())
ON CONFLICT (tier) DO NOTHING;

-- 3) 업체 기능 자격 — 장부 full 은 Agent · 시험만 (read 는 그대로) ------------------------

CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)) AS base,
           co.status = 'active'
           AND ((co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)) AS books,
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
             CASE WHEN (SELECT books FROM c) THEN 'full'
                  WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company)
                    OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read'
                  ELSE 'none' END
           WHEN p_feature = 'ledger_ai' THEN
             CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'none' END
           ELSE 'none'
         END;
$function$;

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none (Agent · 시험), ledger: full(Agent · 시험) | read(장부 줄 · 사진이 있는 업체 — 등급이 내려가도 보기 · 내보내기, Expert 로 쓰던 업체 포함) | none, ledger_ai(사진 AI 읽기): full(Agent · 시험) | none. 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;

-- 4) 회원 통계 뷰 — manager_users 를 끝에 --------------------------------------------------

CREATE OR REPLACE VIEW public.profile_stats WITH (security_invoker='on') AS
SELECT count(*) AS total_users,
    count(*) FILTER (WHERE (tier = 'standard'::text)) AS standard_users,
    count(*) FILTER (WHERE (tier = 'expert'::text)) AS expert_users,
    count(*) FILTER (WHERE (tier = 'agent'::text)) AS agent_users,
    count(*) FILTER (WHERE (tier_source = 'subscription'::text)) AS paid_users,
    count(*) FILTER (WHERE (created_at >= CURRENT_DATE)) AS today_signups,
    count(*) FILTER (WHERE (created_at >= (CURRENT_DATE - '7 days'::interval))) AS week_signups,
    count(*) FILTER (WHERE (created_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))) AS month_signups,
    count(*) FILTER (WHERE (tier = 'manager'::text)) AS manager_users
   FROM public.profiles;

REVOKE ALL ON TABLE public.profile_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profile_stats TO authenticated, service_role;
