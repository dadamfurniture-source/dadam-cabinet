-- =============================================
-- 0056 — 다담 본사(companies.kind = 'platform')도 회계장부 · 사진 AI 읽기 (company_entitled)
--
-- 다담 본사가 본사 장부를 따로 적는다. 장부(ledger) full · 사진 AI 읽기(ledger_ai) full 에 활성 다담 본사를 더한다.
-- 업무 비서(assistant)는 본사에 열지 않는다 — 0047 그대로.
--
-- 정해 둔 값
--   ledger      full = 활성 협력업체 plan agent, 활성 다담 본사, 또는 시험 예외(assistant_settings.trial) — 0047 에 본사를 더한다.
--               read · none 은 0047 그대로 (장부 줄 · 사진이 있으면 read). 본사가 active 가 아니면 본사 몫은 빠진다
--   ledger_ai   full = 활성 협력업체 plan agent, 활성 다담 본사, 또는 시험 예외 — 영수증 사진을 Agent 처럼 AI 가 읽는다
--   assistant   0047 그대로 (Agent · 시험). 본사는 시험 예외가 아니면 none
--   사람        0047 그대로 — p_user 를 주면 그 업체 active 구성원(본사는 대표 · 실장)만, 아니면 none
--
-- 이 값을 따라 본사에도 열리는 것 (함수는 그대로)
--   ledger_month_report_scan(0038)   장부 줄이 있는 달에 본사도 month_report 를 받는다
--   ledger_extract_due(0038)         본사 사진도 AI 읽기를 건다
--   assistant_budget_reserve(0038)   본사 사진 읽기(extract) 예산을 잡는다 — 본사 assistant_settings 줄(한도)이 있어야 잡힌다.
--                                    이 파일은 그 줄을 만들지 않는다
--
-- 바꾸는 것
--   company_entitled(업체, 기능, 사람)   0047 본문 + 본사 칸 platform(활성 다담 본사) — ledger · ledger_ai 의 full 조건에 OR platform
--   설명(COMMENT)                       company_entitled 의 값 목록에 다담 본사
--
-- 바꾸지 않는 것
--   base · books · enabled 식, 구성원 확인(m), assistant 갈래, 다담 공장(hq) · 협력업체 자격, 권한(service_role 만), 표 · 행
--
-- 다시 돌려도 된다 (OR REPLACE).
-- =============================================

-- 업체 기능 자격 — 장부 · 사진 AI 읽기 full 에 활성 다담 본사 (비서는 그대로) ---------------

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

COMMENT ON FUNCTION public.company_entitled(uuid, text, uuid) IS '업체 기능 자격 — assistant: full | none (Agent · 시험 — 다담 본사는 아니다), ledger: full(Agent · 다담 본사 · 시험) | read(장부 줄 · 사진이 있는 업체 — 등급이 내려가도 보기 · 내보내기, Expert 로 쓰던 업체 포함) | none, ledger_ai(사진 AI 읽기): full(Agent · 다담 본사 · 시험) | none. 다담 본사는 active 일 때만. 사람을 주면 active 구성원만. service_role 전용';

REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;
