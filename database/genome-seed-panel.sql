-- =============================================
-- 설계 유전체 — 씨앗 패널 (2026-10-25)
--
-- 사장님이 자주 하는 구성을 **씨앗**으로 저장한다. 자동완성(js/planner/planner-genome.js)이
-- 아직 설계가 없는 계정에 처음 제안할 때 쓰는 집단 패널의 정본이다.
-- 합성(시뮬레이션) 데이터가 아니라 사장님이 플래너에서 그린 설계라서 검증된 기본 데이터가 된다.
--
-- 담는 것: 플래너 구조를 유전체로 바꾼 라인 (js/planner/planner-seed.js plannerSeedLines)
--   lines = [{ section: 'lower'|'upper'|'tall'…,
--              loci: [{ W: 폭 mm, sig: 구조 서명 ('D1/L' · 'D2' · 'OPEN' · 'DR:2:1:1|ball|18|sk' · 'T:SRD-SW/R' …),
--                       anchors: ['sink'|'hood'…], fixed: 고정 모듈 여부 }] }]
-- 고객 이름·주소는 없다. 치수·규칙을 새로 만들지 않는다 — 플래너가 이미 정한 폭과 구조 서명뿐이다.
--
-- 권한: 쓰기는 관리자만 (public.is_admin(), database/fix-admin-rls-recursion.sql).
--       읽기는 로그인한 사용자 누구나 — 자동완성이 모든 계정의 첫 패널로 읽는다.
--       (다른 업체 설계가 아니라 사장님 씨앗만 담기므로 공개 범위를 넓게 둔다. 좁히려면 아래 읽기 정책을 is_admin() 으로.)
--
-- 적용: Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행. 여러 번 실행해도 된다.
-- =============================================
CREATE TABLE IF NOT EXISTS genome_seed_panel (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 사람이 붙인 이름 — "I자 3000 개수대 왼쪽" 같은 것
    name                   TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),

    -- 유전체 라인 (위 주석)
    lines                  JSONB NOT NULL CHECK (jsonb_typeof(lines) = 'array'),

    -- 목록에 보일 한 줄 요약 (planner-seed.js plannerSeedSummary)
    summary                TEXT,

    -- 서명 형식 판 (PLANNER_GENOME_VERSION) — 형식이 바뀌면 옛 씨앗을 가려 읽는다
    genome_version         INT NOT NULL DEFAULT 1,

    -- 어느 설계·품목에서 저장했는지 (되찾기용). 설계를 지워도 씨앗은 남는다.
    source_design_id       UUID REFERENCES designs(id) ON DELETE SET NULL,
    source_item_unique_id  BIGINT,

    -- 지우기는 감추기다 — 어떤 씨앗이 제안을 만들었는지 나중에 되짚을 수 있게
    active                 BOOLEAN NOT NULL DEFAULT TRUE,

    created_by             UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_genome_seed_panel_active
    ON genome_seed_panel (active, created_at DESC);


-- =============================================
-- RLS
-- =============================================
ALTER TABLE genome_seed_panel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seed panel read" ON genome_seed_panel;
CREATE POLICY "seed panel read" ON genome_seed_panel
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "seed panel admin insert" ON genome_seed_panel;
CREATE POLICY "seed panel admin insert" ON genome_seed_panel
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin() AND created_by = auth.uid());

DROP POLICY IF EXISTS "seed panel admin update" ON genome_seed_panel;
CREATE POLICY "seed panel admin update" ON genome_seed_panel
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "seed panel admin delete" ON genome_seed_panel;
CREATE POLICY "seed panel admin delete" ON genome_seed_panel
    FOR DELETE TO authenticated
    USING (public.is_admin());


-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION genome_seed_panel_touch()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_genome_seed_panel_touch ON genome_seed_panel;
CREATE TRIGGER trg_genome_seed_panel_touch
    BEFORE UPDATE ON genome_seed_panel
    FOR EACH ROW EXECUTE FUNCTION genome_seed_panel_touch();
