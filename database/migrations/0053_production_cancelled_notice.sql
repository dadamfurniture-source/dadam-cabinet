-- =============================================
-- 0053 — 제작 의뢰 거둠 앱 알림 종류 (production_cancelled)
--
--   Manager 업체가 팩토리 답 기다림(chosen) 중인 제작 의뢰를 거두면, 답을 기다리던 팩토리의 대표 · 실장에게
--   앱 알림을 보낸다 (workflow-api production-requests/manager.js cancelMyRequest · push/messages.js productionCancelled).
--   글은 품목 이름만 싣는다 (업체 이름 · 요청 메모 · 설계 이름 없음), 열 곳은 팩토리 › 제작 의뢰함 (/segan/me.html#factory-requests).
--
-- 바꾸는 것:
--   notification_outbox_kind_check — 0050 목록(19개) 그대로 + production_cancelled = 20개로 지우고 다시 건다.
--
-- 바꾸지 않는 것
--   표 · 칸 · 권한 · 정책, 업체 없이 넣을 수 있는 종류(notification_outbox_company_check — 0023),
--   보낼 때 받는 사람 확인(workflow-api push/sender.js — 이 종류는 그 업체 active 구성원이면 간다, production_offered 와 같다).
--
-- 0052 (열린 PR) 의 객체를 쓰지 않는다. 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text]));
