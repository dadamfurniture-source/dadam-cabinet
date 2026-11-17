-- =============================================
-- 0068 작업마다 작업지시서 — 철거 · 납품 지시서, 그 필수 확인, 작업의 지시서 메모
--      (2026-11-17 사장님 결정 · 「각 작업자에게 보낼 작업지시서가 각 작업에 작성되어 확인」)
--
--   「작업 배정」의 작업 줄마다 그 작업의 지시서를 쓰고 본다. 재단 · 엣지 · 조립은 작업지시서, 설치는 시공 지시서가 이미 있다.
--   철거 · 납품은 지시서를 새로 · 따로 발행한다 (시공 지시서와 한 번에 내지 않는다 — 철거는 시공 지시서보다 먼저다).
--
-- 바꾸는 것:
--   1) 문서 종류에 demolition_order(철거 지시서) · delivery_order(납품 지시서) — design_documents.doc_type 다섯
--        customer_confirmation 고객 확인서 · work_order 작업지시서 · installation_order 시공 지시서 · demolition_order · delivery_order
--   2) 필수 확인 역할에 demolition(철거) · delivery(납품) — work_checks.role 여섯
--        cut 재단 · edge 엣지 · assembly 조립 · install 설치 · demolition · delivery
--        철거 뒤 사진 · 납품 확인(수량 · 내린 뒤 사진)을 그 지시서에 적는다
--   3) work_jobs.sheet_memo — 사무실이 그 작업의 지시서에 적는 메모 (1 ~ 2000자, 없으면 비움)
--        작업 설명(detail)과 따로 둔다 — detail 은 수락하기 전(모집 중)의 작업자에게도 보인다.
--        이 메모는 지시서 안에만 찍힌다 (지시서는 그 작업을 수락한 작업자만 연다 — 서버가 가른다).
--        고객 이름 · 전화 · 주소를 넣지 않는다 (현장 정보는 지시서의 현장 칸이 따로 낸다)
--
-- 바꾸지 않는 것
--   작업 종류(work_jobs.kind — 철거 · 납품은 이미 있다, 0065 · 0066), 문서 표 · 작업 표의 권한 · 정책,
--   필수 확인 표의 권한(서버만 · 쌓기만), 보고서 색인의 종류(work_reports.kind — 새 지시서는 색인에 넣지 않는다),
--   고객 확인서 공유 규칙, 문서 번호 · 판 유니크.
--
-- 읽기 · 쓰기: 표의 권한은 그대로다 — work_jobs 는 서버(service_role)가 쓰고, 브라우저에서는 사이트 관리자만 읽는다
--   (정책 「Admins read work jobs」). 새 칸도 같다.
-- 0035 · 0065 · 0066 을 먼저 적용해야 한다. 다시 돌려도 된다.
-- =============================================

-- 1) 문서 종류에 철거 · 납품 지시서 ----------------------------------------------------

ALTER TABLE public.design_documents DROP CONSTRAINT IF EXISTS design_documents_doc_type_check;
ALTER TABLE public.design_documents
    ADD CONSTRAINT design_documents_doc_type_check CHECK (doc_type = ANY (ARRAY['customer_confirmation'::text, 'work_order'::text, 'installation_order'::text, 'demolition_order'::text, 'delivery_order'::text]));

-- 2) 필수 확인 역할에 철거 · 납품 ------------------------------------------------------

ALTER TABLE public.work_checks DROP CONSTRAINT IF EXISTS work_checks_role_check;
ALTER TABLE public.work_checks
    ADD CONSTRAINT work_checks_role_check CHECK (role = ANY (ARRAY['cut'::text, 'edge'::text, 'assembly'::text, 'install'::text, 'demolition'::text, 'delivery'::text]));

-- 3) 작업의 지시서 메모 ----------------------------------------------------------------

ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS sheet_memo text;

ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_sheet_memo_chk;
ALTER TABLE public.work_jobs
    ADD CONSTRAINT work_jobs_sheet_memo_chk CHECK (sheet_memo IS NULL OR ((length(sheet_memo) >= 1) AND (length(sheet_memo) <= 2000)));

COMMENT ON COLUMN public.work_jobs.sheet_memo IS '사무실이 그 작업의 지시서에 적는 메모 (1 ~ 2000자) — 지시서 안에만 찍힌다 (수락한 작업자만 연다). 작업 설명 detail 과 따로. 고객 이름 · 전화 · 주소를 넣지 않는다';
