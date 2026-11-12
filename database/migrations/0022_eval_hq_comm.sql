-- =============================================
-- 0022 — 업체 평가표 「본사 소통」
--
-- 본사 등급 영역 하나(본사 소통) — 본사의 설계 · 구성에 잘 맞는 업체일수록 높게 매긴다.
--   company_evaluations.hq_comm  { score: 점수 } — 지금은 본사(관리자)가 점수를 직접 넣는다.
--                                평가 항목을 정하면 같은 칸(jsonb)에 항목을 더한다 — 표를 다시 바꾸지 않는다.
--                                점수 범위 · 배율은 서버 workers/workflow-api/src/distribution/rules.js (EVAL_WEIGHTS).
-- 권한은 표 단위(0018) 그대로 — 본사만 읽고, 쓰기는 서버만.
-- 평가 이력(company_evaluation_history.snapshot)은 줄 전체를 담으므로 새 칸도 같이 남는다.
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.company_evaluations ADD COLUMN IF NOT EXISTS hq_comm jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.company_evaluations DROP CONSTRAINT IF EXISTS company_evaluations_hq_comm_check;
ALTER TABLE public.company_evaluations
    ADD CONSTRAINT company_evaluations_hq_comm_check CHECK (jsonb_typeof(hq_comm) = 'object');

COMMENT ON COLUMN public.company_evaluations.hq_comm IS '본사 소통 — { score } 본사가 매김 (본사 설계 · 구성에 맞을수록 높게). 평가 항목은 같은 칸에 더한다';
COMMENT ON TABLE public.company_evaluations IS '본사 업체 평가표 — 등급 · 설비 · 인력 · 마감 · 자재(거래 회사) · 설계 · 본사 소통 · 가격대 · 서류. 본사(관리자)만 읽고, 쓰기는 서버만';
