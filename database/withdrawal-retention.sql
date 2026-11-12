-- =============================================
-- 회원탈퇴 — 남길 기록을 회원과 떼어 남긴다 (2026-10-27)
--
-- 탈퇴(workers/account-api /delete · /admin/delete)는 auth 사용자를 지운다. 그때 FK 가 정한 대로 행이
-- 지워지거나(CASCADE) 남는다(SET NULL). 이 파일은 남길 것을 SET NULL 로 바꾸고, 지울 것은 CASCADE 로 맞춘다.
--
-- 남긴다 (작성자 · 회원 정보 없이):
--   1) collection_posts — 시공사례에 공개된 AI 연출컷(source 'ai_render').
--        user_id       auth.users  ON DELETE SET NULL (NOT NULL 해제)
--        generation_id generations ON DELETE SET NULL — 탈퇴로 generations 행이 지워져도 게시물은 남는다.
--                      고객이 「내 연출컷」 에서 연출컷을 지우면 워커(DELETE /api/generate/:id)가 게시물 행과
--                      복사본을 먼저 지우므로 그 길은 그대로다.
--        직접 올린 사진(source 'upload')은 남기지 않는다 — account-api 가 auth 사용자를 지우기 전에 행과 파일을 지운다
--        (workers/account-api/src/withdrawal.js).
--   2) 결제 · 구독 기록 — 전자상거래법상 계약 · 결제 기록 보관(5년).
--        payment_history.user_id         profiles ON DELETE SET NULL (NOT NULL 해제)
--        payment_history.subscription_id subscriptions ON DELETE SET NULL (그대로 다시 건다)
--        subscriptions.user_id           profiles ON DELETE SET NULL (NOT NULL 해제)
--        구독 행이 회원과 떨어지는 순간(user_id → NULL) 트리거가 결제 키(billing_key)를 지우고, 결제 예정 ·
--        결제 잠금을 비우고, 진행 중인 구독은 해지(cancelled · user_request)로 닫고 ended_at 을 채운다 —
--        정기 결제 cron(workers/payments-api)이 주인 없는 구독을 다시 집지 않게.
-- 지운다:
--   3) collection_inquiries — 탈퇴한 회원이 보낸 문의(from_user_id)와 그 회원에게 온 문의(to_user_id)는 CASCADE.
--        보낸 문의에는 그 회원의 이름 · 연락처가 들어 있고, 받은 문의는 답할 사람이 없다.
--        (collection-schema.sql 의 기본 FK 는 NO ACTION 이라 행이 있으면 탈퇴가 막혔고,
--         account-deletion.sql 의 SET NULL 은 이름 · 연락처를 주인 없이 남겼다.)
--
-- FK 이름은 실DB 와 다를 수 있다 — 열마다 걸린 FK 를 이름과 상관없이 찾아 지우고, 정해진 이름으로 다시 건다.
-- 여러 번 돌려도 같다.
--
-- 순서: 이 파일을 먼저 적용하고 account-api 코드를 머지한다. 코드는 공개 AI 연출컷의 파일을 남기는데,
--   이 파일 없이 탈퇴하면 그 행이 CASCADE 로 지워져 파일만 주인 없이 남는다.
-- 선행: collection-auto-post.sql (source · generation_id), payments-lifecycle.sql (ended_at · cancel_reason ·
--   charge_lock_until), multiagent/db/migrations/002_payment_providers.sql (subscriptions · payment_history).
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

-- 1) 시공사례 — 공개 AI 연출컷은 남긴다
SELECT pg_temp.drop_fks_on('public.collection_posts', 'user_id');
ALTER TABLE public.collection_posts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.collection_posts
  ADD CONSTRAINT collection_posts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

SELECT pg_temp.drop_fks_on('public.collection_posts', 'generation_id');
ALTER TABLE public.collection_posts
  ADD CONSTRAINT collection_posts_generation_id_fkey
  FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;

-- 2) 결제 · 구독 — 기록은 남기고 회원과 뗀다
SELECT pg_temp.drop_fks_on('public.payment_history', 'user_id');
ALTER TABLE public.payment_history ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

SELECT pg_temp.drop_fks_on('public.payment_history', 'subscription_id');
ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_subscription_id_fkey
  FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;

SELECT pg_temp.drop_fks_on('public.subscriptions', 'user_id');
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 구독이 회원과 떨어지면: 결제 키를 지우고, 다시 결제되지 않게 닫는다
CREATE OR REPLACE FUNCTION public.subscriptions_detach_on_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.billing_key := NULL;
  NEW.next_charge_at := NULL;
  NEW.charge_lock_until := NULL;
  IF NEW.status IN ('active', 'past_due', 'trialing') THEN
    NEW.status := 'cancelled';
    NEW.cancel_reason := COALESCE(NEW.cancel_reason, 'user_request');
  END IF;
  NEW.ended_at := COALESCE(NEW.ended_at, now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_subscriptions_detach_on_withdrawal ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_detach_on_withdrawal
  BEFORE UPDATE OF user_id ON public.subscriptions
  FOR EACH ROW
  WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
  EXECUTE FUNCTION public.subscriptions_detach_on_withdrawal();

-- 3) 시공사례 문의 — 탈퇴한 회원이 보낸 것 · 받은 것은 지운다
SELECT pg_temp.drop_fks_on('public.collection_inquiries', 'from_user_id');
ALTER TABLE public.collection_inquiries
  ADD CONSTRAINT collection_inquiries_from_user_id_fkey
  FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

SELECT pg_temp.drop_fks_on('public.collection_inquiries', 'to_user_id');
ALTER TABLE public.collection_inquiries
  ADD CONSTRAINT collection_inquiries_to_user_id_fkey
  FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;

-- =============================================
-- 확인 (필요할 때 따로 돌린다)
-- =============================================
--
-- ① FK 와 삭제 동작 — confdeltype: n = SET NULL, c = CASCADE
--   SELECT conrelid::regclass AS tbl, conname, confdeltype, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE contype = 'f'
--      AND conrelid IN ('public.collection_posts'::regclass, 'public.payment_history'::regclass,
--                       'public.subscriptions'::regclass, 'public.collection_inquiries'::regclass)
--    ORDER BY 1, 2;
--
-- ② NOT NULL 이 풀렸는지
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND (table_name, column_name) IN (('collection_posts','user_id'), ('payment_history','user_id'), ('subscriptions','user_id'));
--
-- ③ 트리거
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.subscriptions'::regclass AND NOT tgisinternal;
--
-- ④ 탈퇴 뒤 — 남은 것은 작성자 없이
--   SELECT source, count(*) FROM public.collection_posts WHERE user_id IS NULL GROUP BY source;   -- ai_render 만
--   SELECT count(*) FROM public.payment_history WHERE user_id IS NULL;
--   SELECT count(*) FROM public.subscriptions WHERE user_id IS NULL AND billing_key IS NOT NULL;  -- 0
--
-- =============================================
-- 되돌리기 (원래 동작으로 — 탈퇴하면 행이 지워진다)
-- =============================================
--   DROP TRIGGER IF EXISTS trg_subscriptions_detach_on_withdrawal ON public.subscriptions;
--   DROP FUNCTION IF EXISTS public.subscriptions_detach_on_withdrawal();
--   그리고 위 FK 들을 ON DELETE CASCADE 로 다시 건다 (user_id 가 NULL 인 행이 있으면 NOT NULL 은 되돌리지 못한다).
