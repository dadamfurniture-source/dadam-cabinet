-- =============================================
-- 0020 — 업체 상담 설정: 다음 가능 날짜 → 상담까지 걸리는 날
--
-- 날짜 하나를 적어 두면 날이 지날 때마다 업체가 고쳐야 한다. 대신 일수 하나를 둔다.
--   lead_days  상담까지 걸리는 날 (0~14일, 비면 0). 가능한 날 = 오늘(KST) + 이 일수
--              (서버 workers/workflow-api/src/distribution/rules.js 가 센다)
-- 옛 칸 next_available_date 는 지운다 (0018 에서 만든 뒤 아무 업체도 쓰지 않았다).
-- 권한은 표 단위(0018) 그대로 — 새 칸도 같은 읽기 · 쓰기 규칙을 따른다.
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.company_service_settings ADD COLUMN IF NOT EXISTS lead_days integer;

ALTER TABLE public.company_service_settings DROP CONSTRAINT IF EXISTS company_service_settings_lead_days_check;
ALTER TABLE public.company_service_settings
    ADD CONSTRAINT company_service_settings_lead_days_check CHECK (lead_days IS NULL OR (lead_days >= 0 AND lead_days <= 14));

ALTER TABLE public.company_service_settings DROP COLUMN IF EXISTS next_available_date;

COMMENT ON COLUMN public.company_service_settings.lead_days IS '상담까지 걸리는 날 (0~14일, 비면 0) — 가능한 날 = 오늘 + 이 일수';
COMMENT ON TABLE public.company_service_settings IS '업체 상담 설정 — 상담 받는 지역 · 하는 품목 · 한 달 한도 · 상담까지 걸리는 날. 업체 대표 · 실장이 서버를 거쳐 고침';
