-- ═══════════════════════════════════════════════════════════════
-- design_items.detail — 디테일 마감 모델 저장 컬럼 (D1, 계획서 §4.2 / §5 D1)
-- Supabase Dashboard > SQL Editor 에서 실행. 두 번 실행해도 안전(멱등), 기존 행은 건드리지 않는다.
--
-- 무엇인가
--   플래너 디테일 모드(mockup-structure.html?stage=detail, js/planner/planner-detail.js)가
--   부재 단위로 칠한 마감을 상세설계(detaildesign.html)가 품목(item.detail)에 받아
--   여기 저장한다. 형식은 js/planner/planner-finish.js 의 모델 그대로다:
--
--     { "version": 1,
--       "item":     { "door": {"code":"PET-OAK-M"}, "body": {...}, ... },
--       "sections": { "upper": { "door": {...} }, "lower": { ... } },
--       "modules":  { "<moduleId>": { "door": {...} } },
--       "parts":    { "<moduleId>": { "door#1": {...} } } }
--
--   code 는 materials.code 정본(database/materials-catalog-v2.sql)이다.
--   NULL = 아직 디테일을 칠하지 않은 품목 (옛 설계 전부). 프런트는 NULL 을 "없음"으로 읽는다.
--
-- 기존 키와의 관계
--   specs.doorColorUpper/Lower · doorFinishUpper/Lower 는 계속 채워진다 — 이 컬럼에서 **파생된 미러**다
--   (AI 연출컷·견적이 그 키를 읽는다). 정본은 detail 이고, 미러는 ui-step1.js 가 수신할 때 갱신한다.
--
-- 적용 방법
--   1. database/designs-schema.sql 이 먼저 적용돼 있어야 한다 (design_items 표).
--   2. 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
--   3. 확인: SELECT column_name, data_type, is_nullable FROM information_schema.columns
--            WHERE table_name = 'design_items' AND column_name = 'detail';
--      → jsonb / YES 한 줄.
--   4. 프런트(js/detaildesign/persistence-init.js)는 detail 이 있는 품목에만 이 컬럼을 보낸다.
--      그래서 이 파일을 적용하기 전에도 마감을 칠하지 않은 설계는 그대로 저장된다.
--      마감을 칠한 설계를 저장하려면 이 파일이 먼저 적용돼 있어야 한다 (없으면 컬럼 없음 오류).
--
-- 불변조건 (계획서 §3): 더하기만. 기존 컬럼·행은 바꾸지도 지우지도 않는다.
--   - ALTER 는 ADD COLUMN IF NOT EXISTS 하나뿐
--   - NOT NULL · DEFAULT 없음 — 기존 행은 NULL 로 남는다
--   - RLS 는 design_items 의 기존 정책(designs.user_id 경유)을 그대로 탄다. 새 정책 없음.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE design_items ADD COLUMN IF NOT EXISTS detail JSONB;

COMMENT ON COLUMN design_items.detail IS
  'D1 디테일 마감 모델 (js/planner/planner-finish.js, version 1). code 는 materials.code. NULL = 미지정. specs.doorColor*/doorFinish* 는 이 값의 파생 미러.';
