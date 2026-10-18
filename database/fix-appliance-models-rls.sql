-- ═══════════════════════════════════════════════════════════════
-- 가전 모델 쓰기 권한 오타 수정 (work-reports-archive.plan.md PR7, 2026-10-19)
--
-- appliance-models-schema.sql 의 쓰기 정책이 역할 이름을 'superadmin' 으로 적어
-- 실제 역할 'super_admin' 계정은 가전 모델을 추가·수정·삭제할 수 없었다.
-- admin · super_admin 이 쓸 수 있게 다시 만든다. 읽기는 그대로 전체 허용.
-- 여러 번 실행해도 된다.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "appliance_models_admin_insert" ON appliance_models;
DROP POLICY IF EXISTS "appliance_models_admin_update" ON appliance_models;
DROP POLICY IF EXISTS "appliance_models_admin_delete" ON appliance_models;

CREATE POLICY "appliance_models_admin_insert" ON appliance_models
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'super_admin'))
  );

CREATE POLICY "appliance_models_admin_update" ON appliance_models
  FOR UPDATE USING (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'super_admin'))
  );

CREATE POLICY "appliance_models_admin_delete" ON appliance_models
  FOR DELETE USING (
    auth.uid() IN (SELECT user_id FROM admin_roles WHERE role IN ('admin', 'super_admin'))
  );

COMMENT ON TABLE appliance_models IS '가전 모델 카탈로그 (냉장고/후드/식세기/싱크볼/쿡탑) — 도면 배치 W/D/H · 상판 타공 참조';
