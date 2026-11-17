-- =============================================
-- 0069 간편 플래너 — 여러 업체 공통 줄 (설계 제안 카드를 원론대로: 집단 패널 · 본사 씨앗)
--      (2026-11-17 사장님 결정 · 원론 = 「유전체의 연관 분석을 기반한 연구」 2026-10-25)
--
--   간편 플래너의 「자주 쓴 구성」 카드는 내 설계 줄을 따라 고른다 (플래너 #175 · #176). 여기에 다른 업체의 구성을 더한다.
--   사장님이 정하신 것: 넘어가는 것은 모듈 구성만 · **나를 빼고 3곳 이상**의 업체에서 나온 구성만 · **프로젝트에 이어진 설계만** 센다 ·
--   업체가 모이기 전에는 **본사가 고른 설계를 씨앗으로** 모든 업체의 첫 재료로 쓴다. 근거 문장은 약관 제11조.
--
-- 바꾸는 것:
--   1) planner_draft_genome — 설계마다 줄 유전체 한 줄 (업체 · 설계 id). 플래너가 저장 뒤 학습 묶음과 같이 보낸다
--        lines = [{k, fx:[설비 종류…], cells:[{l:[모듈 id…], r:[모듈 id…], w}]}] — 줄을 설비장으로 나눈 칸마다 시작 쪽 · 끝 쪽의
--        특수 모듈과 칸 폭. 고객 · 설계 이름 · 메모 · 사진 · 가격은 없다 (모듈 구성뿐)
--   2) planner_genome_panel — 여러 업체 공통 줄 (품목 · 줄 종류 · 줄 열쇠마다 한 줄). 워커가 하루 한 번 다시 묶는다 (지우고 채우는 표)
--        company_ids = 그 줄을 쓴 업체들 (서버만 본다 — 「나를 빼고 3곳」을 요청 때 거르려고), n = 업체 수,
--        line = 칸 · 모듈 · 칸 폭(가운데값). **씨앗이 아니면 3곳 미만인 줄은 이 표에 들어올 수 없다** (제약)
--   3) planner_genome_seeds — 본사가 씨앗으로 고른 설계 (업체 · 설계 id). 씨앗 줄은 3곳 규칙과 따로 패널에 들어간다
--
-- 읽기 · 쓰기: 새 표 셋은 service_role 만 (RLS 켬, 정책 없음). 누가 무엇을 보는지는 workflow-api 가 정한다 —
--   플래너에는 줄 구성과 무게만 내려가고 업체 · 설계 id 는 내려가지 않는다.
-- 건드리지 않는 것: planner_drafts · planner_draft_learn · designs 의 칸과 제약.
-- 0046 을 먼저 적용해야 한다. 다시 돌려도 된다.
-- =============================================

-- 1) 설계마다 줄 유전체 ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_draft_genome (
    company_id uuid NOT NULL,
    draft_id text NOT NULL,
    rev integer NOT NULL,
    item text NOT NULL,
    lines jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_draft_genome_pkey PRIMARY KEY (company_id, draft_id),
    CONSTRAINT planner_draft_genome_rev_check CHECK (rev >= 1),
    CONSTRAINT planner_draft_genome_item_check CHECK (item ~ '^[a-z_]{1,40}$'::text),
    CONSTRAINT planner_draft_genome_lines_check CHECK ((jsonb_typeof(lines) = 'array'::text) AND (octet_length(lines::text) <= 16384)),
    CONSTRAINT planner_draft_genome_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.planner_draft_genome IS '간편 플래너 설계의 줄 유전체 — 가전 자리 기준 칸마다 특수 모듈과 칸 폭 (모듈 구성뿐). 여러 업체 공통 줄을 묶는 재료. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_draft_genome_item ON public.planner_draft_genome USING btree (item, updated_at DESC);

ALTER TABLE public.planner_draft_genome ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_draft_genome FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_genome TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_genome FROM service_role;

-- 2) 여러 업체 공통 줄 ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_genome_panel (
    item text NOT NULL,
    kind text NOT NULL,
    line_key text NOT NULL,
    line jsonb NOT NULL,
    company_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    n integer NOT NULL,
    seed boolean DEFAULT false NOT NULL,
    built_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_genome_panel_pkey PRIMARY KEY (item, kind, line_key),
    CONSTRAINT planner_genome_panel_item_check CHECK (item ~ '^[a-z_]{1,40}$'::text),
    CONSTRAINT planner_genome_panel_kind_check CHECK (kind = ANY (ARRAY['floor'::text, 'upper'::text])),
    CONSTRAINT planner_genome_panel_key_check CHECK ((length(line_key) >= 1) AND (length(line_key) <= 2000)),
    CONSTRAINT planner_genome_panel_line_check CHECK ((jsonb_typeof(line) = 'object'::text) AND (octet_length(line::text) <= 8192)),
    CONSTRAINT planner_genome_panel_n_check CHECK (n = COALESCE(cardinality(company_ids), 0)),
    CONSTRAINT planner_genome_panel_three_check CHECK (seed OR (n >= 3))
);

COMMENT ON TABLE public.planner_genome_panel IS '간편 플래너 여러 업체 공통 줄 — 3곳 이상이 쓴 줄 구성(씨앗은 따로). 하루 한 번 다시 묶는다. company_ids 는 서버만 본다. service_role 만';

ALTER TABLE public.planner_genome_panel ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_genome_panel FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_genome_panel TO service_role;
REVOKE TRUNCATE ON TABLE public.planner_genome_panel FROM service_role;

-- 3) 본사가 고른 씨앗 설계 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_genome_seeds (
    company_id uuid NOT NULL,
    draft_id text NOT NULL,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_genome_seeds_pkey PRIMARY KEY (company_id, draft_id),
    CONSTRAINT planner_genome_seeds_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT planner_genome_seeds_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_genome_seeds IS '간편 플래너 씨앗 설계 — 본사가 모든 업체의 첫 제안 재료로 고른 설계. 표시를 빼면 줄을 지운다. service_role 만';

ALTER TABLE public.planner_genome_seeds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_genome_seeds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.planner_genome_seeds TO service_role;
REVOKE UPDATE, TRUNCATE ON TABLE public.planner_genome_seeds FROM service_role;
