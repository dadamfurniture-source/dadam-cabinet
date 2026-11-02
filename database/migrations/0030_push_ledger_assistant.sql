-- =============================================
-- 0030 — 장부 · AI 비서 앱 알림 종류
--
--   notification_outbox.kind  셋을 더한다 (모두 업체 알림 — 업체 없이 넣을 수 있는 종류는 그대로)
--     ledger_pending    확인할 영수증 · 명세표 사진이 있음 (대표 · 실장, 개수만 — 묶어서)
--     ledger_returned   올린 사진이 돌려보내짐 (올린 사람)
--     assistant_brief   AI 비서 아침 브리핑 (고정 문구 — 본문은 비서 탭을 열 때 만든다)
-- 글에 고객 이름 · 전화 · 주소 · 금액을 넣지 않는 것, 열 곳은 /segan/ 만인 것은 0016 그대로.
-- 기기 등록 · 권한 · 정리 트리거는 그대로. 받을 사람인지는 서버가 보낼 때 다시 본다 (workers/workflow-api/src/push/).
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text]));

COMMENT ON TABLE public.notification_outbox IS '보낼 앱 알림 — 한 줄 = 받는 사람 한 명. 업체 없이는 업체 신청 · 작업자 알림만. 장부 · 비서 알림은 업체와 함께. 글에 고객 이름 · 전화 · 주소 · 금액 없음, 열 곳은 /segan/ 만. 서버(service_role)만';
