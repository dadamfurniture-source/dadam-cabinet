-- ═══════════════════════════════════════════════════════════════
-- design_snapshots.cut_plan_payload · sheet_count — 재단 배치 저장 컬럼 (B4, 계획서 §4.6 / §5 B4)
-- Supabase Dashboard > SQL Editor 에서 실행. 두 번 실행해도 안전(멱등), 기존 행은 건드리지 않는다.
--
-- 무엇인가
--   상세설계 CNC 탭이 그리는 원판 배치(js/detaildesign/nesting-engine.js `NestingEngine.plan`)를
--   스냅샷을 동결할 때 함께 저장한다. 작업지시서 v2(B5)의 시트별 재단표·부재 라벨이 이것만 읽는다.
--   형식은 docs/design-rules/bom-protocol.md §7-3 그대로다:
--
--     { "version": 1,
--       "sheetSize": {"w":1220,"h":2440}, "kerf": 4, "trim": 10,
--       "sheets":  [ { "no":1, "material":"PB", "thickness":15, "partClass":"본체",
--                      "size":{"w":1220,"h":2440}, "layout":{"no":1,"stack":2,"index":1,"dir":"H","rotated":false},
--                      "parts":[ { "partId":"0-l1-body:side-0#0", "w":550, "h":720, "x":10, "y":10, "rot":false, "grain":"none" } ],
--                      "usedArea": 396000, "yield": 0.133 } ],
--       "offcuts": [ { "sheetNo":1, "kind":"strip", "x":564, "y":10, "w":636, "h":720, "free":636 } ],
--       "summary": { "sheetsByMaterial": {"PB_15": 2}, "sheetCount": 2, "totalYield": 0.133 } }
--
--   sheet_count 는 sheets 의 길이(겹침 재단도 낱장으로 센다)를 워커가 파생해 넣는다 — 목록에서 원판 장수를
--   payload 를 읽지 않고 보여 주기 위한 것이다. NULL = 배치를 싣지 않은 스냅샷 (옛 스냅샷 전부, 엔진이 없던 클라이언트).
--
-- 적용 방법
--   1. database/workflow-schema.sql 이 먼저 적용돼 있어야 한다 (design_snapshots 표).
--   2. 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
--   3. 확인: SELECT column_name, data_type, is_nullable FROM information_schema.columns
--            WHERE table_name = 'design_snapshots' AND column_name IN ('cut_plan_payload', 'sheet_count');
--      → jsonb / YES, integer / YES 두 줄.
--   4. 워커(workers/workflow-api/src/snapshots.js)는 이 컬럼이 없어도 멈추지 않는다 — 배치만 빼고 저장하고
--      로그에 경고를 남긴다(PGRST204/42703 감지). 그래서 워커 배포와 이 파일 적용의 순서는 상관없지만,
--      적용 전에 동결한 스냅샷에는 배치가 남지 않는다.
--
-- 불변조건 (계획서 §3): 더하기만. 기존 컬럼·행은 바꾸지도 지우지도 않는다.
--   - ALTER 는 ADD COLUMN IF NOT EXISTS 둘뿐
--   - NOT NULL · DEFAULT 없음 — 기존 행은 NULL 로 남는다
--   - RLS 는 design_snapshots 의 기존 정책(읽기 전용, 쓰기는 service_role)을 그대로 탄다. 새 정책 없음.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE design_snapshots ADD COLUMN IF NOT EXISTS cut_plan_payload JSONB;

ALTER TABLE design_snapshots ADD COLUMN IF NOT EXISTS sheet_count INT;

COMMENT ON COLUMN design_snapshots.cut_plan_payload IS
  'B4 재단 배치 (js/detaildesign/nesting-engine.js NestingEngine.plan, version 1). 시트별 partId#k 절대 좌표·회전·잔재. NULL = 배치 없음.';

COMMENT ON COLUMN design_snapshots.sheet_count IS
  'B4 원판 장수 = cut_plan_payload.sheets 길이 (워커 파생, 겹침 재단도 낱장). NULL = 배치 없음.';
