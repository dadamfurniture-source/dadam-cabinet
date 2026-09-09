-- ============================================================
-- 연출컷 생성 이력 — generations 테이블 · generations 버킷 · 서비스 환불 함수
-- (계획: .ultraplan/plan.md PR-1, 2026-09-09)
--
-- 왜 새 테이블인가:
--   라이브 `designs` 는 플래너 설계 테이블(name/total_items…)이고 my-designs.html 이 읽던
--   모양(title/generated_images)과도 다르다. 연출컷 이력은 여기에만 쓴다.
--
-- 쓰기 주체는 워커(service_role) 하나다. 클라이언트는 본인 행 SELECT 와
-- is_favorite/title UPDATE 만 할 수 있다. credit_ref 와 share_token_hash 는
-- 컬럼 단위로 숨긴다 — ref 가 보이면 누구나 refund_credit 을 부를 수 있다.
--
-- 재실행 안전: CREATE POLICY 는 IF NOT EXISTS 를 못 받으므로 DROP 을 먼저 건다.
-- 실행: node mcp-server/scripts/exec-sql.mjs database/generations-schema.sql
-- ============================================================

-- 1. 테이블
CREATE TABLE IF NOT EXISTS public.generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,   -- 재생성 계보
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'analyzing', 'rendering', 'qc', 'variants', 'done', 'failed')),
  progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  step_label TEXT,
  error TEXT,
  category TEXT NOT NULL,
  title TEXT,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,   -- design_style, door_color, door_finish, wall_width_override, fridge_options
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {room:{path,url,mime}, refs:[{path,url,mime}]}
  wall_analysis JSONB,
  quote JSONB,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{slot:'base'|'v1'|'v2'|'v3', label, finish_key, path, url}]
  model TEXT,
  elapsed_ms INT,
  credit_ref UUID,
  credit_cost INT,
  credit_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  share_token_hash TEXT,
  share_expires_at TIMESTAMPTZ,
  share_revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generations_user_created
  ON public.generations (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_share_token
  ON public.generations (share_token_hash) WHERE share_token_hash IS NOT NULL;
-- 사용자당 실행 중 잡 1개(409) 판정용
CREATE INDEX IF NOT EXISTS idx_generations_user_active
  ON public.generations (user_id) WHERE status NOT IN ('done', 'failed');

-- updated_at 자동 갱신 (다른 테이블과 같은 방식)
CREATE OR REPLACE FUNCTION public.generations_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_generations_updated_at ON public.generations;
CREATE TRIGGER trg_generations_updated_at
  BEFORE UPDATE ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.generations_touch_updated_at();

-- 2. RLS — 본인 SELECT/UPDATE 만. INSERT/DELETE 정책 없음 → 워커(service_role)만 쓴다.
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "generations_select_own" ON public.generations;
CREATE POLICY "generations_select_own" ON public.generations
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "generations_update_own" ON public.generations;
CREATE POLICY "generations_update_own" ON public.generations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 컬럼 단위 권한. 테이블 단위 권한이 남아 있으면 컬럼 회수가 무효가 된다
-- (credits-schema.sql 과 같은 실측) — 먼저 걷어내고 필요한 컬럼만 준다.
REVOKE ALL ON public.generations FROM anon, authenticated;
GRANT SELECT (
  id, user_id, parent_id, status, progress, step_label, error, category, title,
  options, inputs, wall_analysis, quote, images, model, elapsed_ms, credit_cost,
  is_favorite, share_expires_at, share_revoked_at, created_at, updated_at, completed_at
) ON public.generations TO authenticated;
GRANT UPDATE (is_favorite, title) ON public.generations TO authenticated;

-- 3. 버킷 — public 읽기, 쓰기는 service_role (RLS 우회) 만.
INSERT INTO storage.buckets (id, name, public)
VALUES ('generations', 'generations', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "generations_objects_select_public" ON storage.objects;
CREATE POLICY "generations_objects_select_public" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'generations');

-- 4. 서비스 환불 — 잡 안에서 실패했을 때 사용자 토큰이 없다.
--    refund_credit 과 같은 본문에서 auth.uid() 대신 원장 행의 user_id 를 쓴다.
--    EXECUTE 는 service_role 에만 준다.
CREATE OR REPLACE FUNCTION public.refund_credit_svc(p_ref UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
    WHERE uc.user_id = v_row.user_id RETURNING uc.balance INTO v_balance;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
  VALUES (v_row.user_id, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.refund_credit_svc(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit_svc(UUID) TO service_role;
