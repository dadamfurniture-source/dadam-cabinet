-- =============================================
-- 0072 수주 없는 작업의 필수 확인 · 지시서 그림 종류 둘
--
--   작업자의 지시서는 그 작업의 설계로 찾는다 — 수주가 아직 없는 설계(프로젝트에 이어진 것)의 작업도 지시서를 열고 필수 확인을 적는다.
--   지시서에 싣는 그림에 배치 평면 · 속 구조 정면도를 더한다.
--
-- 바꾸는 것:
--   1) work_checks.order_id — 비울 수 있다 (수주가 없는 작업의 체크). 수주가 있으면 지금처럼 그 수주를 적는다.
--        체크는 문서(document_id)에 달린다 — 읽는 길은 문서 · 역할 · 범위 · 항목이라 수주가 나중에 생겨도 그대로 이어진다.
--   2) work_checks.job_id — 어느 작업에서 체크했는지 (work_jobs). 작업이 지워지면 비운다 (체크 줄은 남는다).
--        공장 길(생산 계획의 수주로 여는 체크)은 작업이 없어 비워 둔다.
--   3) design_renders.kind 에 layout(배치 평면 — 벽 · 가전 자리) · inside(벽마다 속 구조 정면도) — 여섯
--        front 3D 앞모습 · iso ISO 도면 · plan 상판 탑뷰 · module · layout · inside
--        inside 그림의 모듈 상자 자리는 있는 칸 camera(jsonb)에 적는다 — 칸을 더하지 않는다.
--
-- 바꾸지 않는 것
--   필수 확인 표의 권한(서버만 · 넣기 · 읽기만 — 고치기 · 지우기 없음) · RLS · 역할 · 범위 · 항목 제약,
--   문서 · 수주 · 작업 표, 렌더 표의 권한 · 정책 · 다른 칸.
--
-- 0035 · 0064 · 0068 을 먼저 적용해야 한다. 다시 돌려도 된다.
-- =============================================

-- 1) 수주 없는 체크 --------------------------------------------------------------------

ALTER TABLE public.work_checks ALTER COLUMN order_id DROP NOT NULL;

-- 2) 체크한 작업 -----------------------------------------------------------------------

ALTER TABLE public.work_checks ADD COLUMN IF NOT EXISTS job_id uuid;

ALTER TABLE public.work_checks DROP CONSTRAINT IF EXISTS work_checks_job_id_fkey;
ALTER TABLE public.work_checks
    ADD CONSTRAINT work_checks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_checks_job ON public.work_checks USING btree (job_id) WHERE (job_id IS NOT NULL);

COMMENT ON COLUMN public.work_checks.order_id IS '그 체크의 수주 — 수주가 없는 작업(프로젝트에 이어진 설계)의 체크는 비운다. 체크는 문서(document_id)에 달린다';
COMMENT ON COLUMN public.work_checks.job_id IS '체크한 작업 (work_jobs) — 공장 길(생산 계획의 수주)은 비운다. 작업이 지워지면 비운다';

-- 3) 지시서 그림 종류 — 배치 평면 · 속 구조 정면도 ---------------------------------------

ALTER TABLE public.design_renders DROP CONSTRAINT IF EXISTS design_renders_kind_check;
ALTER TABLE public.design_renders
    ADD CONSTRAINT design_renders_kind_check CHECK (kind = ANY (ARRAY['front'::text, 'iso'::text, 'plan'::text, 'module'::text, 'layout'::text, 'inside'::text]));
