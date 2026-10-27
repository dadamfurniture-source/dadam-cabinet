-- =============================================
-- 회원탈퇴 — 계약 기록은 회원과 떼어 남긴다 (2026-10-27)
--
-- 지금은 auth 사용자를 지우면 designs 가 CASCADE 로 지워지고, 그 설계에 딸린 고객 확인서(design_documents) ·
-- 계약 시점 설계(design_snapshots) · 시공 일정(design_schedules) · 시공 주소(design_site_info)가 함께 지워진다.
-- 수주(orders.design_id → designs ON DELETE RESTRICT)가 있으면 그 CASCADE 가 막혀 탈퇴 자체가 실패한다.
-- 크레딧 원장(credit_ledger)도 CASCADE 로 지워진다.
--
-- 바꾸는 것:
--   1) designs.user_id        auth.users ON DELETE SET NULL (NOT NULL 이면 해제)
--        계약 기록이 **없는** 설계는 account-api 가 auth 사용자를 지우기 전에 직접 지운다
--        (workers/account-api/src/withdrawal.js — 딸린 행은 지금처럼 CASCADE, renders · cad 파일도 지운다).
--        그래서 auth 사용자를 지울 때 남아 있는 설계는 계약 기록이 있는 것뿐이고, 그 행과 딸린 계약 기록 ·
--        수주가 user_id 없이 남는다. 수주가 있는 회원도 탈퇴할 수 있다 (RESTRICT 에 닿지 않는다).
--   2) credit_ledger.user_id  auth.users ON DELETE SET NULL (NOT NULL 해제) — 크레딧 지급 · 사용 원장
--        (잔액 user_credits 는 지금처럼 지워진다)
--   3) public.withdrawal_designs(회원) — 그 회원의 설계마다 계약 기록이 있는지.
--        계약 기록 = 고객 확인서(design_documents, 어떤 상태든 — 거절 · 회수도 청약철회 기록이다) 또는 수주(orders).
--        시공 일정 · 시공 주소 · 스냅샷만 있고 확인서 · 수주가 없는 설계는 계약 전 단계로 보고 지운다.
--        account-api 만 부른다 (service_role). 다른 역할은 실행할 수 없다.
--
-- 읽기 권한: 떨어진 행(user_id NULL)은 관리자만 본다. 이 표들의 회원 정책은 모두 auth.uid() = user_id 나
--   designs.user_id = auth.uid() 로 비교한다 — NULL 은 누구와도 같지 않다 (아래 확인 ③).
--
-- 남는 행의 개인 정보 (매년 검토 대상) — 계약 · 청약철회 기록, 보관 5년(전자상거래법):
--   designs             설계 제목 · 메모 (user_memo · name/title), 원본 이미지 주소(original_image — 파일은 지워진다)
--   design_documents    customer_name · customer_name_masked · signer_name · signer_ip_hash · signer_user_agent ·
--                       render_payload(발행 당시 동결된 현장 주소 등)
--   design_snapshots    design_payload · quote_payload (품목 메모 등 고객이 적은 글이 들어 있을 수 있다)
--   orders              customer_name · note
--   order_payments      memo
--   design_schedules    location · assignee_name · description · notes   ← 시공(재화 공급) 기록 — 보관 기간 표에 따로 없다
--   design_site_info    address · address_detail · floor · contact_name · contact_phone · access_note · notes
--                                                                         ← 시공 주소 — 보관 기간 표에 따로 없다
--   credit_ledger       delta · reason · ref (사람 정보 없음, user_id 는 NULL)  ← 보관 기간 표에 따로 없다
--
-- FK 이름은 실DB 와 다를 수 있다 — 열마다 걸린 FK 를 이름과 상관없이 찾아 지우고 정해진 이름으로 다시 건다.
-- 여러 번 돌려도 같다.
-- 순서: 이 파일을 먼저 적용하고 account-api 코드를 머지한다 (코드가 withdrawal_designs 를 부른다).
-- 선행: designs-schema.sql · workflow-schema.sql · cd5-erp.sql · credits-schema.sql.
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 실행.
-- =============================================

BEGIN;

-- 0) 한 열에 걸린 FK 를 이름과 상관없이 지운다 — 이 실행에서만 산다 (pg_temp)
CREATE OR REPLACE FUNCTION pg_temp.drop_fks_on(tbl regclass, col text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = tbl
       AND c.contype = 'f'
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = tbl AND a.attname = col)]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, r.conname);
  END LOOP;
END $$;

-- 1) 설계 — 남아 있는 설계는 회원과 떨어진다
SELECT pg_temp.drop_fks_on('public.designs', 'user_id');
ALTER TABLE public.designs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.designs
  ADD CONSTRAINT designs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) 크레딧 원장
SELECT pg_temp.drop_fks_on('public.credit_ledger', 'user_id');
ALTER TABLE public.credit_ledger ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) 계약 기록 판정 — 탈퇴 정리(account-api)가 부른다
CREATE OR REPLACE FUNCTION public.withdrawal_designs(p_user_id UUID)
RETURNS TABLE (design_id UUID, contract BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT d.id,
         EXISTS (SELECT 1 FROM public.design_documents x WHERE x.design_id = d.id)
      OR EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id)
    FROM public.designs d
   WHERE d.user_id = p_user_id
$$;

REVOKE ALL ON FUNCTION public.withdrawal_designs(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdrawal_designs(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdrawal_designs(UUID) TO service_role;

COMMIT;

-- =============================================
-- 확인 (필요할 때 따로 돌린다)
-- =============================================
--
-- ① FK — confdeltype n = SET NULL
--   SELECT conrelid::regclass, conname, confdeltype, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE contype = 'f' AND conrelid IN ('public.designs'::regclass, 'public.credit_ledger'::regclass)
--      AND conname IN ('designs_user_id_fkey', 'credit_ledger_user_id_fkey');
--
-- ② 함수 권한 — service_role 만
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public' AND routine_name = 'withdrawal_designs';
--
-- ③ 떨어진 행을 회원이 못 읽는지 — 아래 표들의 정책 중 user_id IS NULL 이나 true 로 여는 것이 없어야 한다
--   SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('designs', 'design_items', 'design_documents', 'design_snapshots', 'design_schedules',
--                        'design_site_info', 'design_renders', 'planner_snapshots', 'design_cad_artifacts',
--                        'orders', 'order_payments', 'order_costs', 'credit_ledger')
--    ORDER BY tablename, policyname;
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects' AND (policyname LIKE 'renders_%' OR policyname LIKE 'cad_%');
--
-- ④ 미리보기 — 한 회원의 설계가 어떻게 갈리는지
--   SELECT * FROM public.withdrawal_designs('<user uuid>');
--
-- =============================================
-- 되돌리기
-- =============================================
--   DROP FUNCTION IF EXISTS public.withdrawal_designs(UUID);
--   그리고 두 FK 를 ON DELETE CASCADE 로 다시 건다 (user_id 가 NULL 인 행이 있으면 NOT NULL 은 되돌리지 못한다).
