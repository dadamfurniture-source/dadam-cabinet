-- =============================================
-- 0028 — 장부 「보기만」 자격은 장부를 쓴 업체만
--
-- 0026 company_entitled 의 ledger 는 기본 조건(Agent 협력업체 · 시험 예외)이 아니면 모두 read 였다.
-- 그래서 장부를 한 번도 쓰지 않은 업체(Expert · 무료 협력업체 · 다담 본사 · 다담 공장)에도 보기만 장부가 열렸다.
-- read 는 등급이 내려간 업체가 장부 · 증빙을 5년 동안 보고 내보내기 위한 것이므로,
-- 그 업체 장부 줄(ledger_entries)이나 사진(ledger_documents)이 하나라도 있을 때만 read, 없으면 none.
-- assistant 판정과 구성원 확인은 그대로.
--
-- 다시 돌려도 된다.
-- =============================================

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
             CASE WHEN (SELECT base FROM c) THEN 'full'
                  WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company)
                    OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read'
                  ELSE 'none' END
           ELSE 'none'
         END;
$function$;

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none, ledger: full | read(장부 줄 · 사진이 있는 업체 — 등급이 내려가도 보기 · 내보내기) | none. 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;
