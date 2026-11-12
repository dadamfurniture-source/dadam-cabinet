-- =============================================
-- 0035 — 플래너 설계 받기 · 작업자 필수 확인 기록
--
-- 2026-11-04 사장님 「각 작업자에 작업지시서로 분배 · 작업자들에게 필수 확인사항도 포함」 (승인 계획 3단계).
--   designs.source · source_ref  설계가 어디서 왔나 — 간편 플래너(dadam-planner-lite)가 보낸 설계는 source 'planner-lite',
--     source_ref = 플래너 설계 id. 같은 회사 · 같은 출처 · 같은 id 는 앱 설계 하나 (다시 보내면 그 설계에 새 동결본, POST /planner/designs).
--     상세설계 화면에서 만든 설계는 둘 다 비운다.
--   work_checks  작업자가 작업지시서 꾸러미의 필수 확인을 체크한 기록. 체크 한 번 = 줄 하나 — 지우지도 고치지도 않고 쌓기만,
--     같은 칸(문서 · 역할 · 범위 · 항목)의 마지막 줄이 지금 값이다. 어느 작업지시서 판(document_id)을 보고 체크했는지 남긴다.
--     항목 키 · 목록 판은 엔진 정본(workers/workflow-api/src/work/check-items.js)이 정하고 발행 때 문서에 고정된다.
--     읽기 · 쓰기 모두 서버(service_role) — 화면은 서버를 거친다. 서버도 넣기 · 읽기만 (고치기 · 지우기 없음).
--     메모 칸 이름은 memo (작업자 화면 금지 키 note 를 피한다 — work/reveal.js).
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 설계 출처 ---------------------------------------------------------------------

ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS source_ref text;

ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_source_check;
ALTER TABLE public.designs
    ADD CONSTRAINT designs_source_check CHECK (
        (source IS NULL AND source_ref IS NULL)
        OR (source ~ '^[a-z0-9-]{1,32}$' AND source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$')
    );

CREATE UNIQUE INDEX IF NOT EXISTS designs_source_ref_key ON public.designs USING btree (company_id, source, source_ref) WHERE (source IS NOT NULL);

COMMENT ON COLUMN public.designs.source IS '설계가 온 곳 — planner-lite (간편 플래너). 상세설계 화면 설계는 비움';
COMMENT ON COLUMN public.designs.source_ref IS '출처 안 설계 id (플래너 설계 id). 회사 · 출처 · id 가 같으면 한 설계';

-- 2) 작업자 필수 확인 기록 ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    document_id uuid NOT NULL,
    worker_id uuid,
    actor_user_id uuid,
    role text NOT NULL,
    scope_key text DEFAULT ''::text NOT NULL,
    item_key text NOT NULL,
    list_version text NOT NULL,
    checked boolean NOT NULL,
    memo text,
    photo_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_checks_pkey PRIMARY KEY (id),
    CONSTRAINT work_checks_role_check CHECK (role = ANY (ARRAY['cut'::text, 'edge'::text, 'assembly'::text, 'install'::text])),
    CONSTRAINT work_checks_scope_check CHECK (scope_key ~ '^([a-z]+:[0-9]+(:[0-9]+)?)?$' AND length(scope_key) <= 64),
    CONSTRAINT work_checks_item_check CHECK (item_key ~ '^[a-z0-9-]{1,64}$'),
    CONSTRAINT work_checks_version_check CHECK (list_version ~ '^[A-Za-z0-9._-]{1,32}$'),
    CONSTRAINT work_checks_memo_check CHECK (memo IS NULL OR length(memo) <= 300),
    CONSTRAINT work_checks_photo_check CHECK (photo_path IS NULL OR length(photo_path) <= 500),
    CONSTRAINT work_checks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT work_checks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE,
    CONSTRAINT work_checks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.design_documents(id) ON DELETE CASCADE,
    CONSTRAINT work_checks_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL,
    CONSTRAINT work_checks_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.work_checks IS '작업자 필수 확인 기록 — 체크 한 번 = 줄 하나, 쌓기만 (같은 칸의 마지막 줄이 지금 값). 서버만, 넣기 · 읽기만';

CREATE INDEX IF NOT EXISTS idx_work_checks_cell ON public.work_checks USING btree (document_id, role, scope_key, item_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_checks_order ON public.work_checks USING btree (order_id, created_at DESC);

ALTER TABLE public.work_checks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.work_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.work_checks TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.work_checks FROM service_role;
