-- ============================================================
-- generations.layout — 연출컷 구성 분석 결과 (gen-to-planner, 2026-09-11)
--
-- 워커 `POST /api/generate/:id/layout` 이 Claude 비전으로 기본안을 읽어
-- 세그먼트·가전·도어 수를 JSON 으로 남긴다 (형식: workers/generate-api/src/layout.js).
-- 클라이언트(ai-design → detaildesign gen-import)는 이 값을 플래너 배치로 바꾼다.
--
-- 쓰기는 service_role(워커)만. 사용자는 본인 행을 읽기만 한다 — 기존 컬럼 권한에 더한다
-- (generations-schema.sql 의 GRANT SELECT 목록에도 같이 넣어 두었다).
-- 재실행 안전.
-- ============================================================

ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS layout JSONB;
COMMENT ON COLUMN public.generations.layout IS
  '연출컷 구성 분석 (Claude 비전). 형식은 workers/generate-api/src/layout.js normalizeLayout';

GRANT SELECT (layout) ON public.generations TO authenticated;
