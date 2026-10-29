-- =============================================
-- 0014 — 수주 하나에 기다리는 요청 하나 (order_events)
--
-- 서버(workflow-api)는 요청을 넣기 전에 기다리는 요청이 있는지 본다. 같은 순간에 두 요청이 들어오면
-- 둘 다 들어갈 수 있어, 표에서도 막는다: 한 수주(order_id)에 state = 'pending' 줄은 하나뿐.
-- 결정된 줄(approved · rejected)과 바로 처리된 줄(done)은 몇 개든 된다.
-- 다시 돌려도 된다.
-- =============================================

CREATE UNIQUE INDEX IF NOT EXISTS order_events_one_pending_per_order
    ON public.order_events USING btree (order_id)
    WHERE (state = 'pending'::text AND order_id IS NOT NULL);
