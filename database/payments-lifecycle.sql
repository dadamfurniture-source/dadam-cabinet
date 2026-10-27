-- ═══════════════════════════════════════════════════════════════
-- 구독 수명주기 — 정기 결제 · 실패 재시도 · 해지 만료 · 환불
--
-- payments-api (workers/payments-api/src/lifecycle.js) 가 쓰는 칸만 더한다.
-- 더하기만 한다 — 지우거나 바꾸는 것 없음. 재실행 안전(idempotent).
-- payments-api 를 배포하기 **전에** 먼저 실행한다 (워커가 이 칸을 읽고 쓴다).
--
-- subscriptions
--   failed_attempts  이번 기간 결제 실패 횟수. 0 = 정상.
--                    1 → 첫 실패 1일 뒤 재시도, 2 → 첫 실패 3일 뒤 재시도, 3 → 해지
--   first_failed_at  이번 기간 첫 실패 시각. 재시도 시각은 여기서 잰다
--   cancel_reason    해지 까닭 — user_request(고객 해지) · payment_failed(재시도 끝 실패)
--                    · refunded(환불로 즉시 종료). billing.html 안내 문구가 이걸로 갈린다
--   ended_at         등급을 내리고 구독을 끝낸 시각. 비어 있는 cancelled 구독은
--                    current_period_end 가 지나면 cron 이 등급을 내리고 채운다
-- payment_history
--   refunded_at · refunded_by · refund_reason · refund_override
--                    관리자 환불 기록. override = 약관 조건(7일 · 크레딧 미사용)을
--                    벗어났는데 관리자 예외로 환불한 것
--
-- RLS 는 그대로다 — 두 표 모두 본인·관리자 SELECT 만, 쓰기는 워커(service_role).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_cancel_reason_check'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_cancel_reason_check
      CHECK (cancel_reason IS NULL OR cancel_reason IN ('user_request', 'payment_failed', 'refunded'));
  END IF;
END $$;

-- 결제 잠금 — 결제하는 길(정기 결제 cron · 지금 다시 결제 · 카드 바꾼 뒤 결제)은 모두
-- 조건부 UPDATE 로 이 두 칸을 먼저 잡는다. 두 번 누름 · cron 과 겹침으로 두 번 결제되지 않게.
--   charge_lock_until  이 시각까지 다른 결제는 기다린다 (5분 — 워커가 죽어도 풀린다)
--   charge_order_id    지금 결제 중이거나, 결과를 모른 채 끝난 결제의 주문번호.
--                      다음 결제는 이 주문번호부터 토스에 물어 두 번 결제하지 않는다
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS charge_lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS charge_order_id TEXT;

ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by UUID,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_override BOOLEAN NOT NULL DEFAULT FALSE;

-- cron 이 매일 찾는 두 묶음
CREATE INDEX IF NOT EXISTS idx_subscriptions_toss_due
  ON public.subscriptions (next_charge_at)
  WHERE provider = 'toss' AND status IN ('active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_subscriptions_toss_cancel_pending
  ON public.subscriptions (current_period_end)
  WHERE provider = 'toss' AND status = 'cancelled' AND ended_at IS NULL;
