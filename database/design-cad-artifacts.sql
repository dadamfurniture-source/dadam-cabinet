-- =============================================
-- CAD 산출물 — design_cad_artifacts 표 + cad 버킷 (CAD 베타 PR16, docs/01-plan/planner-cad.plan.md)
--
-- 동결 스냅샷(design_snapshots)의 조립 명세(bom_payload.assembly)로 만든 GLB 를 보관한다.
--   kind = 'cad'      판재 전부 (관리자 · 공장용)
--   kind = 'exterior' 외관 판재만 (명세 vis = 'exterior' — 측판 · 도어 · 서랍 전면 · 몰딩 …). 고객용은 나중 PR
--
-- 쓰기는 워커(service_role, RLS 우회)만 한다 — 브라우저가 올린 GLB 의 명세 해시(assembly_hash)가
--   그 스냅샷 bom_payload.assembly 의 해시와 같을 때만 워커가 행을 남긴다 (동결본 인정).
--   그래서 아래에는 관리자 **읽기** 정책만 둔다. 고객 · 일반 사용자 정책은 없다.
--   ⚠️ renders 버킷 정책을 복사하지 않는다 — 그쪽은 고객이 올리고 지울 수 있다.
--
-- Storage 배치 (버킷 `cad`, 비공개):
--   {design_id}/{snapshot_id}/cad-{sha256 앞 16자}.glb
--   exterior/{design_id}/{snapshot_id}/exterior-{sha256 앞 16자}.glb   (고객용 접두사 — 서명 URL 은 워커가 낸다)
--   `path` 컬럼은 버킷 안의 키다 (버킷 이름을 앞에 붙이지 않는다).
--
-- 적용 방법 (두 번 실행해도 안전):
--   1) Supabase 대시보드 → Storage → New bucket → 이름 `cad`, **Public 끔**.
--      (아래 INSERT INTO storage.buckets 가 같은 일을 하지만, SQL Editor 역할이 storage 스키마에
--       쓰기 권한이 없는 프로젝트가 있다 — 그러면 대시보드에서 만들고 INSERT 는 건너뛴다.)
--   2) SQL Editor 에서 이 파일 전체 실행. 선행: workflow-schema.sql (design_snapshots), admin-schema.sql (admin_roles).
--   3) 확인:
--        SELECT column_name FROM information_schema.columns WHERE table_name = 'design_cad_artifacts';
--        SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'cad_%';
-- 되돌리기: database/design-cad-artifacts-rollback.sql
-- =============================================

CREATE TABLE IF NOT EXISTS design_cad_artifacts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_id         UUID NOT NULL,
    -- 복합 FK — 남의 설계 스냅샷을 붙이지 못하게 (design_documents 와 같은 방식)
    snapshot_id       UUID NOT NULL,
    -- 스냅샷 content_hash 그대로 (어느 동결본인지 사람이 맞춰 볼 때)
    content_hash      TEXT NOT NULL,
    -- bom_payload.assembly 의 SHA-256 (키 정렬 직렬화) — GLB 루트 extras.assemblyHash 와 같아야 행이 생긴다
    assembly_hash     TEXT NOT NULL,

    kind              TEXT NOT NULL CHECK (kind IN ('cad', 'exterior')),
    path              TEXT NOT NULL UNIQUE,
    bytes             BIGINT NOT NULL CHECK (bytes > 0),
    -- GLB 파일 자체의 SHA-256
    sha256            TEXT NOT NULL,

    -- 만든 쪽 버전 (planner-export.js) · 명세 규칙 버전 (assembly.rulesVersion)
    generator_version TEXT,
    rules_version     TEXT,
    parts             INT,
    modules           INT,

    created_by        UUID REFERENCES auth.users ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT design_cad_artifacts_snapshot_fk
        FOREIGN KEY (snapshot_id, design_id) REFERENCES design_snapshots (id, design_id) ON DELETE CASCADE,
    -- 같은 스냅샷 · 같은 종류 · 같은 파일은 한 번만 (다시 올리면 워커가 기존 행을 돌려준다)
    CONSTRAINT design_cad_artifacts_uniq UNIQUE (snapshot_id, kind, sha256)
);

CREATE INDEX IF NOT EXISTS idx_design_cad_artifacts_scope
    ON design_cad_artifacts (design_id, snapshot_id, kind, created_at DESC);


-- =============================================
-- RLS — 관리자 읽기만. 쓰기 · 지우기는 워커(service_role)만.
-- =============================================
ALTER TABLE design_cad_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read design cad artifacts" ON design_cad_artifacts;
CREATE POLICY "admins read design cad artifacts" ON design_cad_artifacts
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));


-- =============================================
-- Storage 버킷 `cad` — 비공개. 관리자 읽기(서명 URL 발급 포함)만.
--   올리기 · 지우기 정책이 없으므로 브라우저(고객 · 관리자 모두)는 직접 쓰지 못한다 — 워커만.
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cad', 'cad', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS "cad_select_admin" ON storage.objects;
CREATE POLICY "cad_select_admin" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'cad'
        AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
    );
