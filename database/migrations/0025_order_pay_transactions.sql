-- =============================================
-- 0025 — 수주 온라인 결제 기록
--
-- 고객이 앱에서 수금 줄(order_payments — 계약금 · 중도금 · 잔금)을 결제창 · 가상계좌로 낸다. 다담 공장 수주부터.
-- 결제 한 번(결제창을 연 것 하나) = payment_transactions 한 줄. 결제사(provider)가 받고, 서버가 결제사 알림으로 줄을 고친다.
--   payment_transactions
--     provider          결제사 — 지금은 toss 하나. 다른 결제사(스테이블코인 결제사 · 에스크로 계약 등)는 그 기능과 함께 더한다
--     provider_ref      결제사에 보낸 주문 번호 (토스 orderId) — 하나뿐
--     provider_payment_ref  결제사가 준 결제 번호 (토스 paymentKey)
--     method            card(카드) · easy_pay(간편결제) · virtual_account(가상계좌) · transfer(계좌이체)
--     status            ready(결제창 염) → waiting_deposit(가상계좌 입금 기다림) → paid(받음)
--                       · check_needed(들어온 돈이 수금 줄과 다름 — 사람이 본다) · canceled · expired(입금 기한 지남) · failed
--     amount_requested  수금 줄 금액 / amount_received  결제사가 받았다고 한 금액
--     virtual_account   가상계좌 { bank, account_number, holder, due_at } (고객에게 보여 줄 입금 안내)
--   수금 줄 하나에 열린(ready · waiting_deposit) 결제는 하나뿐.
--   읽기 · 쓰기는 서버(service_role)만, 지우기 없음 — 화면은 서버를 거친다.
--   order_payments.method  결제사로 받은 줄은 easy_pay · virtual_account 도 적는다 (손 「받음」 값은 그대로).
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 수금 줄의 받은 방법 ------------------------------------------------------------

ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_method_check;
ALTER TABLE public.order_payments
    ADD CONSTRAINT order_payments_method_check CHECK ((method IS NULL) OR (method = ANY (ARRAY['transfer'::text, 'card'::text, 'cash'::text, 'other'::text, 'easy_pay'::text, 'virtual_account'::text])));

-- 2) 결제 기록 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    order_id uuid NOT NULL,
    company_id uuid NOT NULL,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    provider_payment_ref text,
    method text,
    status text DEFAULT 'ready'::text NOT NULL,
    amount_requested bigint NOT NULL,
    amount_received bigint,
    virtual_account jsonb,
    status_note text,
    requested_by uuid,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT payment_transactions_provider_check CHECK (provider = ANY (ARRAY['toss'::text])),
    CONSTRAINT payment_transactions_method_check CHECK ((method IS NULL) OR (method = ANY (ARRAY['card'::text, 'easy_pay'::text, 'virtual_account'::text, 'transfer'::text]))),
    CONSTRAINT payment_transactions_status_check CHECK (status = ANY (ARRAY['ready'::text, 'waiting_deposit'::text, 'paid'::text, 'check_needed'::text, 'canceled'::text, 'expired'::text, 'failed'::text])),
    CONSTRAINT payment_transactions_amount_check CHECK ((amount_requested > 0) AND ((amount_received IS NULL) OR (amount_received >= 0))),
    CONSTRAINT payment_transactions_ref_check CHECK ((length(provider_ref) BETWEEN 6 AND 64) AND ((provider_payment_ref IS NULL) OR (length(provider_payment_ref) <= 200))),
    CONSTRAINT payment_transactions_note_check CHECK ((status_note IS NULL) OR (length(status_note) <= 300)),
    CONSTRAINT payment_transactions_va_check CHECK ((virtual_account IS NULL) OR (jsonb_typeof(virtual_account) = 'object'::text)),
    CONSTRAINT payment_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE SET NULL,
    CONSTRAINT payment_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE,
    CONSTRAINT payment_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT payment_transactions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.payment_transactions IS '수주 온라인 결제 기록 — 결제창 한 번 = 한 줄. 수금 줄마다 열린 결제는 하나. 서버만 읽고 씀, 지우기 없음';

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_ref_key ON public.payment_transactions USING btree (provider, provider_ref);
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_payment_ref_key ON public.payment_transactions USING btree (provider, provider_payment_ref) WHERE (provider_payment_ref IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_one_open ON public.payment_transactions USING btree (payment_id) WHERE (status = ANY (ARRAY['ready'::text, 'waiting_deposit'::text]));
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment ON public.payment_transactions USING btree (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON public.payment_transactions USING btree (order_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_transactions_touch ON public.payment_transactions;
CREATE TRIGGER trg_payment_transactions_touch BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_transactions TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.payment_transactions FROM service_role;
