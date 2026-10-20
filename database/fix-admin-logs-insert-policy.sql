-- ============================================================
-- admin_logs 아무나 쓰기 막기 (작업자 포털 1주차 후속 A, 2026-10-20)
--
-- 문제: stability-triggers.sql 의 정책 "System can insert logs" (FOR INSERT WITH CHECK (true)) 때문에
--       anon 키만 있으면 누구나 admin_logs 에 아무 행이나 넣을 수 있었다.
--       관리자 대시보드 · 활동 로그 화면이 그 행을 그리므로 가짜 기록 · 저장형 XSS 의 통로가 된다.
--
-- 고침: admin_logs 에 쓰는 트리거 함수를 SECURITY DEFINER + search_path = public 으로 고정한다.
--       SECURITY DEFINER 함수는 함수 주인(표 주인) 권한으로 돌아 RLS 정책 없이도 로그를 쓴다.
--       그다음 "System can insert logs" 를 지운다. "Admins can insert logs" (WITH CHECK public.is_admin()) 는 남긴다.
--       함수 본문은 다시 쓰지 않는다 (ALTER FUNCTION 만). 함수가 없으면 건너뛴다.
--
-- 대상 함수 = database/*.sql 에서 admin_logs 에 INSERT 하는 함수 전부 (database/stability-triggers.sql):
--   handle_expert_request_approval  expert_requests 승인 · 거절 (AFTER UPDATE)
--   handle_consultation_update      consultations 상태 변경 (BEFORE UPDATE)
--   handle_profile_admin_update     관리자가 회원 정보 · 등급을 바꿀 때 (BEFORE UPDATE)
--   handle_new_consultation         비로그인 상담 신청 (AFTER INSERT) — 이 함수 때문에 정책이 열려 있었다
--   handle_new_expert_request       Expert 승급 신청 (AFTER INSERT)
-- 이미 SECURITY DEFINER 로 만든 함수도 search_path 는 고정한다.
--
-- 브라우저 코드는 admin_logs 에 insert 하지 않는다 (admin/index.html · logs.html 은 읽기만).
-- workers/account-api 는 service_role 키로 쓰므로 RLS 와 무관하다.
--
-- 실행 뒤 확인: 로그인하지 않은 창에서 상담 신청(consultation.html)이 여전히 접수되는지.
-- 멱등: 여러 번 실행해도 된다.
-- ============================================================

BEGIN;

DO $$
BEGIN
  -- 1. Expert 승급 승인 · 거절 로그
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_expert_request_approval' AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.handle_expert_request_approval() SECURITY DEFINER SET search_path = public;
  ELSE
    RAISE NOTICE 'public.handle_expert_request_approval() 없음 — 건너뜀';
  END IF;

  -- 2. 상담 상태 변경 로그
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_consultation_update' AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.handle_consultation_update() SECURITY DEFINER SET search_path = public;
  ELSE
    RAISE NOTICE 'public.handle_consultation_update() 없음 — 건너뜀';
  END IF;

  -- 3. 관리자의 회원 정보 · 등급 변경 로그
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_profile_admin_update' AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.handle_profile_admin_update() SECURITY DEFINER SET search_path = public;
  ELSE
    RAISE NOTICE 'public.handle_profile_admin_update() 없음 — 건너뜀';
  END IF;

  -- 4. 새 상담 신청 로그 (비로그인 신청에서도 돈다)
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_consultation' AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.handle_new_consultation() SECURITY DEFINER SET search_path = public;
  ELSE
    RAISE NOTICE 'public.handle_new_consultation() 없음 — 건너뜀';
  END IF;

  -- 5. 새 Expert 승급 신청 로그
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_expert_request' AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.handle_new_expert_request() SECURITY DEFINER SET search_path = public;
  ELSE
    RAISE NOTICE 'public.handle_new_expert_request() 없음 — 건너뜀';
  END IF;
END
$$;

-- 트리거 함수가 정책 없이 쓸 수 있게 된 뒤에 아무나 쓰기 정책을 지운다.
-- 관리자 쓰기 정책 "Admins can insert logs" 와 읽기 정책 "Admins can view logs" 는 그대로 둔다.
DROP POLICY IF EXISTS "System can insert logs" ON public.admin_logs;

COMMIT;
