-- =============================================
-- 0008 — 탈퇴 때 남길 설계: 회사 설계는 지우지 않는다
--
-- public.withdrawal_designs(p_user_id) 는 탈퇴하는 회원이 만든 설계마다 남길지(contract = true)를 돌려준다.
-- 지금까지: 확인서나 수주가 딸린 설계만 남긴다.
-- 이제: 본사가 아닌 회사의 설계도 남긴다 — 회사 자료라 만든 사람이 나가도 그대로 두고,
--       auth 사용자를 지울 때 designs.user_id 가 NULL 이 되어 만든 사람만 떨어진다.
-- 돌려주는 모양 · 권한(service_role 만 실행)은 그대로다 (CREATE OR REPLACE 는 권한을 유지한다).
-- 다시 돌려도 된다.
-- =============================================

CREATE OR REPLACE FUNCTION public.withdrawal_designs(p_user_id uuid)
 RETURNS TABLE(design_id uuid, contract boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT d.id,
         d.company_id IS DISTINCT FROM public.hq_company_id()
      OR EXISTS (SELECT 1 FROM public.design_documents x WHERE x.design_id = d.id)
      OR EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id)
    FROM public.designs d
   WHERE d.user_id = p_user_id
$function$;
