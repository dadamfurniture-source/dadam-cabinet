-- =============================================================================
-- 다담AI 단가 규칙 시드 (W11) — 버전 '2026.08'
--
-- 출처: 코드에 실재하는 값만 1:1 이관한다. 새 단가를 임의로 만들지 않는다.
--   · mcp-server/src/services/quote.service.ts:12-49
--       CABINET_PRICES / MODULE_TYPE_PRICES / COUNTERTOP_PRICES
--       FIXTURE_PRICES / LABOR / VAT_RATE / range(0.95, 1.30)
--   · mcp-server/src/config/bom-rules.defaults.ts:123-142
--       FINISH_BASE_PRICE / COLOR_PRICE_MULTIPLIER
--
-- 선행: database/workflow-schema.sql
-- 실행: Supabase SQL Editor. 재실행 안전(멱등).
--
-- ⚠️ 담당자 확정이 필요한 미결정 항목 3건
--   견적 금액이 달라지는 사안이므로 임의로 정하지 않고 현행 코드 동작만 옮겼다.
--
--   (1) door_baseline — 행을 넣지 않음
--       도어 마감 업차지를 "마감 단가 − 기본 도어 단가" 로 계산하려면 기본 도어
--       단가(₩/m²)가 필요한데 코드 어디에도 없다. CABINET_PRICES 에 기본 도어가
--       포함돼 있다고 보면 baseline 없이 업차지를 더할 경우 도어값이 이중 계상된다.
--       → 견적 엔진은 이 행이 없으면 도어 마감 업차지를 적용하지 않는다.
--
--   (2) labor/installation (200,000) — 시드는 하되 미사용
--       calculateQuote 가 실제로는 계상하지 않는다. 계상하면 건당 20만 + VAT 증가.
--
--   (3) module_type/* — 시드는 하되 미사용
--       calculateQuote 가 참조하지 않으며, cabinet 과 같은 길이를 대상으로 해
--       동시 적용 시 이중 계상된다.
-- =============================================================================

-- 활성 세트는 부분 유니크 인덱스(pricing_rule_sets_one_active)로 최대 1개다.
-- ON CONFLICT (version) 은 그 인덱스 위반을 잡지 못하므로, 기존 활성 세트를
-- 먼저 내려야 한다. 이 순서가 없으면 다음 단가 버전을 시드할 때 실패한다.
UPDATE pricing_rule_sets SET is_active = FALSE
 WHERE is_active AND version <> '2026.08';

INSERT INTO pricing_rule_sets (version, label, is_active)
VALUES ('2026.08', '초기 이관 — quote.service.ts + bom-rules.defaults.ts', TRUE)
ON CONFLICT (version) DO UPDATE SET is_active = TRUE;


-- ─── 캐비닛 본체 (CABINET_PRICES, quote.service.ts:12-20) ────────────────────
-- 산식: unit_price × 해당 구간 총 길이(mm) / 1000
-- ⚠️ wardrobe 는 원본 주석에 "per 자(303mm)" 라 적혀 있으나
--    calculateQuote:96 은 다른 카테고리와 동일하게 /1000 으로 계산한다.
--    코드 동작을 그대로 옮긴다(per_1000mm). 실제 상거래 단위와 다르면 별도 정정 필요.
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('cabinet', 'sink.lower',           '*', 'per_1000mm', 160000, NULL),
  ('cabinet', 'sink.upper',           '*', 'per_1000mm', 140000, NULL),
  ('cabinet', 'island.lower',         '*', 'per_1000mm', 180000, NULL),
  ('cabinet', 'island.upper',         '*', 'per_1000mm', 140000, NULL),
  ('cabinet', 'wardrobe.lower',       '*', 'per_1000mm', 100000, '원본 주석은 per 자(303mm) — 코드는 /1000'),
  ('cabinet', 'shoe_cabinet.lower',   '*', 'per_1000mm', 400000, NULL),
  ('cabinet', 'vanity.lower',         '*', 'per_1000mm', 250000, NULL),
  ('cabinet', 'storage.lower',        '*', 'per_1000mm', 160000, NULL),
  ('cabinet', 'fridge_cabinet.lower', '*', 'per_1000mm', 180000, NULL),
  ('cabinet', 'fridge_cabinet.upper', '*', 'per_1000mm', 140000, NULL)
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 모듈 타입별 단가 (MODULE_TYPE_PRICES, quote.service.ts:23-30) ───────────
-- ⚠️ 미사용 상수 — calculateQuote(:80-146) 는 MODULE_TYPE_PRICES 를 참조하지 않는다
--    (전 소스 grep 결과 참조처 0곳, 선언부 :23 뿐).
--    게다가 cabinet/sink.lower(160,000/1000mm) 와 module_type/sink.sink(200,000/1000mm)
--    는 같은 물리 길이를 대상으로 하므로 둘 다 적용하면 이중 계상된다.
--    값 보존 목적으로만 시드하며, 견적 엔진은 이 kind 를 사용하지 않는다.
--    사용하려면 cabinet 과의 배타 규칙을 먼저 확정할 것.
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('module_type', 'sink.sink',    '*', 'per_1000mm', 200000, '싱크볼+배관 공간 포함'),
  ('module_type', 'sink.cooktop', '*', 'per_1000mm', 180000, '인덕션+환기 포함'),
  ('module_type', 'sink.drawer',  '*', 'per_1000mm', 170000, '소프트클로즈 레일 포함'),
  ('module_type', 'sink.door',    '*', 'per_1000mm', 150000, '기본 여닫이')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 상판 (COUNTERTOP_PRICES, quote.service.ts:32-36) ────────────────────────
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('countertop', 'default', 'basic',   'per_1000mm', 150000, '인조대리석'),
  ('countertop', 'default', 'mid',     'per_1000mm', 190000, '인조대리석'),
  ('countertop', 'default', 'premium', 'per_1000mm', 230000, '인조대리석')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 설비 (FIXTURE_PRICES, quote.service.ts:38-42) ───────────────────────────
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('fixture', 'faucet',    'basic',   'each',  40000, NULL),
  ('fixture', 'faucet',    'mid',     'each', 110000, NULL),
  ('fixture', 'faucet',    'premium', 'each', 150000, NULL),
  ('fixture', 'sink_bowl', 'basic',   'each',  80000, NULL),
  ('fixture', 'sink_bowl', 'mid',     'each', 385000, NULL),
  ('fixture', 'sink_bowl', 'premium', 'each', 450000, NULL),
  ('fixture', 'hood',      'basic',   'each',  65000, NULL),
  ('fixture', 'hood',      'mid',     'each',  80000, NULL),
  ('fixture', 'hood',      'premium', 'each', 230000, NULL)
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 인건비 (LABOR, quote.service.ts:44-47) ──────────────────────────────────
-- ⚠️ installation(200,000) 은 **미사용 상수**다. calculateQuote(:80-146) 는
--    demolition 만 계상하고(:129-132) installation 은 items 에 추가하지 않는다
--    (전 소스 grep 결과 LABOR.installation 참조처 0곳).
--    계상하도록 바꾸면 견적이 건당 200,000 + VAT 만큼 늘어나는 신규 규칙이 되므로
--    담당자 확정 전까지 견적 엔진은 이 행을 사용하지 않는다.
-- ★ demolition 은 상하부장 합산 길이 기준으로 견적당 1회 계산한다 (현행 코드 동작).
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('labor', 'installation', '*', 'flat',        200000, '코드 미사용 상수 — 계상 여부 미결정'),
  ('labor', 'demolition',   '*', 'per_1000mm',   30000, '상하부장 합산 길이 기준, 견적당 1회')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 도어 마감 기본 단가 (FINISH_BASE_PRICE, bom-rules.defaults.ts:123-131) ──
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('door_finish_base', 'PET-M', '*', 'per_m2', 24000, 'PET 매트'),
  ('door_finish_base', 'PET-G', '*', 'per_m2', 26000, 'PET 광택'),
  ('door_finish_base', 'MFB',   '*', 'per_m2', 14000, 'MFB 멜라민'),
  ('door_finish_base', 'LPM',   '*', 'per_m2', 16000, 'LPM 라미네이트'),
  ('door_finish_base', 'PNT-M', '*', 'per_m2', 32000, '도장 무광'),
  ('door_finish_base', 'PNT-G', '*', 'per_m2', 34000, '도장 유광'),
  ('door_finish_base', 'VNR',   '*', 'per_m2', 38000, '무늬목')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 도어 색상 배수 (COLOR_PRICE_MULTIPLIER, bom-rules.defaults.ts:134-142) ──
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('door_color_mult', 'CRM', '*', 'ratio', 1.00, '크림 (기본)'),
  ('door_color_mult', 'OAK', '*', 'ratio', 1.00, '오크 (기본)'),
  ('door_color_mult', 'WNT', '*', 'ratio', 1.05, '월넛 (짙은)'),
  ('door_color_mult', 'GRP', '*', 'ratio', 1.05, '그라파이트 (짙은)'),
  ('door_color_mult', 'WHT', '*', 'ratio', 0.95, '화이트 (양산)'),
  ('door_color_mult', 'BLK', '*', 'ratio', 0.95, '블랙 (양산)'),
  ('door_color_mult', 'SAG', '*', 'ratio', 1.10, '세이지 (특수)')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 부가세 + 예상 범위 (quote.service.ts:49, 140-143) ───────────────────────
INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
SELECT rs.id, v.kind, v.key, v.grade, v.unit, v.amount, v.note
FROM pricing_rule_sets rs,
(VALUES
  ('vat',   'rate', '*', 'ratio', 0.10, '부가세율'),
  ('range', 'min',  '*', 'ratio', 0.95, '예상 범위 하한 배수'),
  ('range', 'max',  '*', 'ratio', 1.30, '예상 범위 상한 배수')
) AS v(kind, key, grade, unit, amount, note)
WHERE rs.version = '2026.08'
ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- ─── 미결정: 기본 도어 단가 ─────────────────────────────────────────────────
-- 확정되면 아래 주석을 해제하고 <금액> 을 채울 것.
-- 이 행이 있어야만 견적 엔진이 도어 마감 업차지를 계상한다.
--
-- INSERT INTO pricing_rules (rule_set_id, kind, key, grade, unit, amount, note)
-- SELECT rs.id, 'door_baseline', 'default', '*', 'per_m2', <금액>, 'CABINET_PRICES 에 포함된 기본 도어 단가'
-- FROM pricing_rule_sets rs WHERE rs.version = '2026.08'
-- ON CONFLICT (rule_set_id, kind, key, grade) DO NOTHING;


-- =============================================================================
-- 확인 쿼리
-- =============================================================================
-- SELECT kind, COUNT(*) FROM pricing_rules pr
--   JOIN pricing_rule_sets rs ON rs.id = pr.rule_set_id
--   WHERE rs.version = '2026.08' GROUP BY kind ORDER BY kind;
--   기대: cabinet 10, countertop 3, door_color_mult 7, door_finish_base 7,
--         fixture 9, labor 2, module_type 4, range 2, vat 1  (합계 45행)
--
-- SELECT version, is_active FROM pricing_rule_sets;   -- 활성 세트 1개
