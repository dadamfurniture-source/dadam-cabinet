-- =============================================
-- 플래너 도면 스냅샷 (W12-71)
--
-- 배치(mockup-shell) · 구조(mockup-structure) 단계의 결과물은 여태 브라우저
-- localStorage 에만 있었다. 캐시를 지우면 사라지고, 다른 PC 에서는 보이지 않는다.
-- 디테일 단계(design_items)만 이미 계정에 붙어 있었다.
--
-- 이 표는 세 단계를 한 소유권 아래로 모은다.
--
-- 키는 새로 설계하지 않는다. 플래너는 이미 `?design=&item=` 으로 저장 스코프를
-- 나누고 있고(js/planner/planner-scope.js), 그 두 값이 그대로
--   design        = designs.id (UUID)
--   item          = design_items.unique_id (BIGINT)
-- 이다. 컬럼도 그대로 둔다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행.
-- =============================================

CREATE TABLE IF NOT EXISTS planner_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 소유권은 designs 를 타고 온다 (아래 RLS 참고)
    design_id       UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,

    -- design_items.unique_id — 클라이언트가 매기는 품목 고유 번호.
    -- FK 를 걸지 않는 이유: 품목은 저장할 때마다 delete + insert 로 재삽입되어
    -- design_items.id 가 매번 바뀐다. unique_id 만 품목을 가로질러 유지된다.
    item_unique_id  BIGINT NOT NULL,

    stage           TEXT NOT NULL CHECK (stage IN ('layout', 'structure', 'detail')),

    -- 사람이 붙인 이름. 자동 저장은 NULL.
    name            TEXT,

    -- 단계별 저장 키를 **그대로** 담는다 (변환하지 않는다).
    --   layout    : { layout: dadam_layout_v1, origin: dadam_origin_v1 }
    --   structure : { modules: dadam_struct_modules_v1, structures: dadam_structure_v1 }
    --   detail    : { specs, modules }  — 정본은 design_items, 이건 되돌리기용 사본
    payload         JSONB NOT NULL DEFAULT '{}',

    -- 자동 저장은 (design, item, stage) 당 **한 행**만 두고 덮어쓴다.
    -- 안 그러면 자동 저장이 목록을 가득 채워 수동 저장을 덮어 가린다.
    is_autosave     BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 목록 조회: 이 품목 · 이 단계 · 최근 순
CREATE INDEX IF NOT EXISTS idx_planner_snapshots_scope
    ON planner_snapshots (design_id, item_unique_id, stage, created_at DESC);

-- 자동 저장 행은 스코프당 하나뿐임을 DB 가 보장한다 (경쟁 상태 안전망).
-- 클라이언트는 upsert 를 쓰지 않는다 — PostgREST 의 on_conflict 는 인덱스 술어
-- (WHERE is_autosave)를 함께 보낼 수 없어 **부분** 유니크 인덱스를 집지 못한다.
-- 그래서 planner-store.js 가 조회 후 update / insert 를 손으로 나눈다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_snapshots_autosave
    ON planner_snapshots (design_id, item_unique_id, stage)
    WHERE is_autosave;


-- =============================================
-- RLS — 소유권은 designs.user_id 하나
-- =============================================
ALTER TABLE planner_snapshots ENABLE ROW LEVEL SECURITY;

-- user_id 컬럼을 여기 따로 두지 않는다. 두면 designs.user_id 와 어긋날 수 있고,
-- 어긋나는 순간 남의 도면이 보이거나 자기 도면이 안 보인다.
DROP POLICY IF EXISTS "own planner snapshots" ON planner_snapshots;
CREATE POLICY "own planner snapshots" ON planner_snapshots
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = planner_snapshots.design_id
              AND d.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = planner_snapshots.design_id
              AND d.user_id = auth.uid()
        )
    );

-- 관리자는 모두 조회 (designs 정책과 같은 방식)
DROP POLICY IF EXISTS "admins read planner snapshots" ON planner_snapshots;
CREATE POLICY "admins read planner snapshots" ON planner_snapshots
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));


-- =============================================
-- updated_at 자동 갱신
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_planner_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_planner_snapshots_update ON planner_snapshots;
CREATE TRIGGER on_planner_snapshots_update
    BEFORE UPDATE ON planner_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.handle_planner_snapshots_updated_at();
