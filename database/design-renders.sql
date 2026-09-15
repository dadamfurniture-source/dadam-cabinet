-- =============================================
-- 렌더 스냅샷 — design_renders 표 + renders 버킷 (D3, 계획 §4.4 R2 · §5 D3)
--
-- 디테일 모드의 📷 렌더 저장 (js/planner/planner-capture.js) 이 3D 씬을 오프스크린으로
-- 찍어(정면·3/4·평면·모듈) PNG 를 Storage 버킷 `renders` 에 올리고, 그 파일 하나마다
-- 이 표에 한 행을 남긴다. 작업지시서 표지(B5, workers/workflow-api work-order.js)는
-- 이 표에서 design_id + item_unique_id 의 **가장 최근 kind='front'** 행을 찾아 정면 렌더를 싣는다.
--
-- 키는 planner_snapshots 와 같다 (planner-snapshots-schema.sql 참고):
--   design_id       = designs.id (UUID)
--   item_unique_id  = design_items.unique_id (BIGINT) — FK 없음 (품목은 저장할 때마다 재삽입된다)
--
-- Storage 배치 (버킷 `renders`, 비공개):
--   {design_id}/{item_unique_id}/{kind}-{yyyymmddHHMMss}.png            kind = front | iso | plan
--   {design_id}/{item_unique_id}/module-{module_id}-{yyyymmddHHMMss}.png  kind = module
--   `path` 컬럼은 버킷 안의 키다 (버킷 이름을 앞에 붙이지 않는다). 읽기는 서명 URL(1시간) —
--   PlannerStore.listRenders 가 만든다. 버킷이 비공개라 public URL 은 없다.
--
-- 적용 방법 (두 번 실행해도 안전):
--   1) Supabase 대시보드 → Storage → New bucket → 이름 `renders`, **Public 끔**.
--      (아래 INSERT INTO storage.buckets 가 같은 일을 하지만, SQL Editor 의 역할이 storage 스키마에
--       쓰기 권한이 없는 프로젝트가 있다 — 그러면 대시보드에서 만들고 INSERT 는 건너뛴다.)
--   2) SQL Editor 에서 이 파일 전체 실행. 선행: designs-schema.sql (designs), admin-schema.sql (admin_roles).
--   3) 확인:
--        SELECT column_name FROM information_schema.columns WHERE table_name = 'design_renders';
--        SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'renders_%';
-- =============================================

CREATE TABLE IF NOT EXISTS design_renders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 소유권은 designs 를 타고 온다 (아래 RLS)
    design_id       UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    item_unique_id  BIGINT NOT NULL,

    -- 카메라 프리셋. module 이면 module_id 에 어느 모듈인지.
    kind            TEXT NOT NULL CHECK (kind IN ('front', 'iso', 'plan', 'module')),
    module_id       TEXT,

    -- 버킷 `renders` 안의 객체 키 ({design_id}/{item_unique_id}/… )
    path            TEXT NOT NULL,
    width           INT,
    height          INT,

    -- 찍을 때의 카메라: {kind, fov, position:[x,y,z], target:[x,y,z], up:[x,y,z], aspect, longEdge}
    camera          JSONB,

    -- 마감 모델(dadam_detail_v1, planner-finish.js) JSON 의 sha-256 — 렌더가 어느 마감 상태였는지 맞춰 본다.
    -- 키 정렬 후 직렬화(plannerCaptureStableJson)라 같은 지정이면 같은 값이다.
    detail_hash     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 목록·최신 정면 조회: 이 품목 · 최근 순 (B5 는 여기에 kind = 'front' 를 더해 LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_design_renders_scope
    ON design_renders (design_id, item_unique_id, created_at DESC);


-- =============================================
-- RLS — 소유권은 designs.user_id 하나 (planner_snapshots 와 같은 방식)
-- =============================================
ALTER TABLE design_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own design renders" ON design_renders;
CREATE POLICY "own design renders" ON design_renders
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_renders.design_id
              AND d.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM designs d
            WHERE d.id = design_renders.design_id
              AND d.user_id = auth.uid()
        )
    );

-- 관리자는 모두 조회
DROP POLICY IF EXISTS "admins read design renders" ON design_renders;
CREATE POLICY "admins read design renders" ON design_renders
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));


-- =============================================
-- Storage 버킷 `renders` — 비공개. 첫 폴더가 design_id 라 소유권을 designs 로 판정한다.
--   (design-images 는 첫 폴더가 user_id 였다 — storage-policies.sql. 여기는 설계 단위라 design_id.)
--   워커(service_role)는 RLS 를 우회하므로 B5 가 그대로 읽는다.
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('renders', 'renders', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS "renders_select_own" ON storage.objects;
DROP POLICY IF EXISTS "renders_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "renders_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "renders_select_admin" ON storage.objects;

-- 읽기(서명 URL 발급 포함): 그 설계의 소유자
CREATE POLICY "renders_select_own" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(name))[1]
              AND d.user_id = auth.uid()
        )
    );

-- 올리기: 그 설계의 소유자. upsert 는 쓰지 않으므로 UPDATE 정책은 두지 않는다 (파일명에 시각이 있다).
CREATE POLICY "renders_insert_own" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(name))[1]
              AND d.user_id = auth.uid()
        )
    );

-- 지우기: 그 설계의 소유자 (행을 지운 뒤 파일을 정리할 때)
CREATE POLICY "renders_delete_own" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(name))[1]
              AND d.user_id = auth.uid()
        )
    );

-- 관리자는 모두 조회
CREATE POLICY "renders_select_admin" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'renders'
        AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
    );
