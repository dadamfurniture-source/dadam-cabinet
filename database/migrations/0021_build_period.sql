-- =============================================
-- 0021 — 고객 확정 ~ 시공 완료 기간 · 시공 완료 희망 날짜
--
-- 0020 의 「상담까지 걸리는 날」(0~14일)을 「고객 확정 ~ 시공 완료 기간」으로 바꾼다.
--   company_service_settings.lead_days  고객 확정 ~ 시공 완료 기간 (1~90일).
--                                       비면 상담 설정을 마치지 않은 것으로 보고 배정하지 않는다.
--                                       가능한 완료일 = 오늘(KST) + 이 일수 (서버 workers/workflow-api/src/distribution/rules.js)
--   consultations.wanted_done_date      고객이 시공을 마쳤으면 하는 날 (예: 입주 날) · 선택. 가능한 완료일과 견준다.
--                                       preferred_date(희망 상담 날짜)는 연락 일정으로 그대로 두고 점수에 쓰지 않는다.
-- 칸 이름 lead_days 는 그대로 둔다 (0020 뒤 아무 업체도 값을 넣지 않았다).
-- 권한은 표 단위(0000 · 0018) 그대로 — 상담 넣기 · 설정 읽기 · 쓰기 규칙이 새 칸에도 같다.
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.company_service_settings DROP CONSTRAINT IF EXISTS company_service_settings_lead_days_check;
ALTER TABLE public.company_service_settings
    ADD CONSTRAINT company_service_settings_lead_days_check CHECK (lead_days IS NULL OR (lead_days >= 1 AND lead_days <= 90));

COMMENT ON COLUMN public.company_service_settings.lead_days IS '고객 확정 ~ 시공 완료 기간 (1~90일, 비면 설정을 마치지 않은 것) — 가능한 완료일 = 오늘 + 이 일수';
COMMENT ON TABLE public.company_service_settings IS '업체 상담 설정 — 상담 받는 지역 · 하는 품목 · 한 달 한도 · 고객 확정 ~ 시공 완료 기간. 업체 대표 · 실장이 서버를 거쳐 고침';

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS wanted_done_date date;

COMMENT ON COLUMN public.consultations.wanted_done_date IS '시공 완료 희망 날짜 (예: 입주 날) · 선택 — 업체 「고객 확정 ~ 시공 완료 기간」과 견준다';
