-- Migration 002: Payment Providers (Stripe + Toss 이중 지원)
--
-- Goal: generic provider 컬럼 추가 + 빌링키/결제이력 테이블 신설.
-- 기존 stripe_* 컬럼은 후속 마이그레이션에서 drop 예정 (호환성 유지).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== subscriptions 확장 =====

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'toss')),
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_key TEXT,
  ADD COLUMN IF NOT EXISTS next_charge_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amount_krw INTEGER;

UPDATE public.subscriptions
SET provider_customer_id = stripe_customer_id,
    provider_subscription_id = stripe_subscription_id
WHERE provider_customer_id IS NULL
  AND stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_next_charge
  ON public.subscriptions(next_charge_at)
  WHERE provider = 'toss' AND status = 'active';

-- ===== 웹훅 멱등성 테이블 =====

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'toss')),
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

-- ===== 결제 이력 테이블 =====

CREATE TABLE IF NOT EXISTS public.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'toss')),
  order_id TEXT NOT NULL,
  payment_key TEXT,
  plan TEXT NOT NULL,
  amount_krw INTEGER NOT NULL,
  tax_amount INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed', 'refunded', 'pending')),
  method TEXT,
  receipt_url TEXT,
  failure_code TEXT,
  failure_message TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, order_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_history_user
  ON public.payment_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_history_subscription
  ON public.payment_history(subscription_id, created_at DESC);

-- ===== RLS =====

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_history_owner_select ON public.payment_history;
CREATE POLICY payment_history_owner_select ON public.payment_history
  FOR SELECT USING (auth.uid() = user_id);

-- payment_events 는 service role 만 접근 (정책 없음 = 기본 deny)

COMMIT;
