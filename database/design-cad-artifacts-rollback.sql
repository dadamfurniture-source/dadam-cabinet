-- ============================================================
-- CAD 산출물 되돌리기 — database/design-cad-artifacts.sql 이 만든 표 · 정책을 지운다
--
-- ⚠️ 표의 행(GLB 기록)이 지워진다. 버킷 `cad` 의 파일은 SQL 로 지우지 않는다 —
--    필요하면 Supabase 대시보드 → Storage → cad 에서 비운 뒤 버킷을 지운다.
--    실수로 실행하지 않도록 design-cad-artifacts.sql 과 따로 둔다.
-- 표가 없어도 안전하다 (IF EXISTS).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "cad_select_admin" ON storage.objects;
DROP TABLE IF EXISTS design_cad_artifacts;

COMMIT;
