-- =============================================
-- 0005 — 가입한 회원을 본사 고객으로
--
--   1. public.add_hq_customer() + auth.users AFTER INSERT 트리거
--        새 계정마다 본사(companies.kind = 'hq') 고객 행 하나를 만든다.
--        본사 행이 없으면 아무것도 넣지 않는다 (INSERT … SELECT 가 0행).
--   2. 지금 있는 계정 모두를 본사 고객으로 채운다.
--
-- 계정과 이어진 고객 행은 company_id · user_id 만 채운다. 이름 · 연락처는 profiles 에 있고 여기에 베끼지 않는다
-- (customers.name · phone 은 회사가 계정 없이 넣는 고객용).
-- 기존 expert · agent 회원도 고객 행만 생긴다 — 회사로 바꾸지 않는다.
-- (company_id, user_id) 부분 유니크 인덱스(0003)로 겹치지 않는다. 다시 돌려도 된다.
-- =============================================

CREATE OR REPLACE FUNCTION public.add_hq_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.customers (company_id, user_id)
  SELECT c.id, NEW.id
    FROM public.companies c
   WHERE c.kind = 'hq'
  ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 트리거로만 돈다. API 역할은 직접 부르지 못하고, auth.users 에 넣는 Supabase Auth 역할에만 연다.
REVOKE ALL ON FUNCTION public.add_hq_customer() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_hq_customer() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created_hq_customer ON auth.users;
CREATE TRIGGER on_auth_user_created_hq_customer AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.add_hq_customer();

INSERT INTO public.customers (company_id, user_id)
SELECT c.id, u.id
  FROM auth.users u
 CROSS JOIN public.companies c
 WHERE c.kind = 'hq'
ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING;
