-- =============================================
-- 0023 — 작업자 앱 알림
--
-- 작업자(workers)는 업체 구성원이 아니다 — 작업자 알림은 업체 없이(company_id 비움) 넣고,
-- 업체 없는 기기(push_subscriptions.company_id 비움 — 업체 신청자와 같은 자리)로 보낸다.
--   notification_outbox.kind           작업자 알림 넷을 더한다
--     work_invited       관리자가 작업에 초대함 (배정 제안)
--     work_registration  작업자 신청 승인 · 반려
--     work_assigned      신청한 작업에 뽑힘 (배정 확정)
--     work_schedule      맡은 작업의 일정이 바뀜
--   notification_outbox_company_check  업체 없이 넣을 수 있는 종류에 작업자 알림 넷을 더한다 (업체 신청과 같다)
-- 기기 등록 · 권한 · 정리 트리거는 그대로. 받을 사람인지는 서버가 보낼 때 다시 본다
-- (작업자 상태 — workers/workflow-api/src/push/sender.js).
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text]));

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_company_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_company_check CHECK (company_id IS NOT NULL OR kind = ANY (ARRAY['partner_application'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text]));

COMMENT ON TABLE public.notification_outbox IS '보낼 앱 알림 — 한 줄 = 받는 사람 한 명. 업체 없이는 업체 신청 · 작업자 알림만. 글에 고객 이름 · 전화 · 주소 · 금액 없음, 열 곳은 /segan/ 만. 서버(service_role)만';
