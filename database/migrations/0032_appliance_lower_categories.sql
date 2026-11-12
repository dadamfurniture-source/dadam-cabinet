-- =============================================
-- 0032 — 가전 모델 카탈로그: 하부장 안에 들어가는 가전 4종류
--
-- 사장님 2026-11-03 "모델까지 수집해 카탈로그에 넣음". 수집기는 scripts/kitchen-catalog (README '하부장 가전').
-- appliance_models 에 종류(category) 4개와 종류별 세부 구분(subtype)을 더한다. 나머지 종류 · 구분은 그대로.
--
--   robot_vacuum    로봇청소기 빌트인 스테이션   toe_kick 걸레받이 히든 스테이션 · built_in 하부장 안 빌트인 스테이션
--   food_disposer   싱크대 아래 음식물처리기     grinder 분쇄 + 회수 · grinder_microbial 분쇄 + 미생물 2차 처리기 ·
--                                                microbial 미생물 분해 · dryer 건조 · 분쇄건조
--   water_purifier  언더싱크 정수기              purify 정수 · cold 냉정수 · hot 온정수 · hot_cold 냉온정수
--   wine_cellar     빌트인 와인셀러              under_counter 언더카운터 (상판 아래) · built_in 가구장 매립
--
-- 치수 W · H · D 는 하부장 안에 들어가는 본체 (스테이션 · 2차 처리기 · 정수 본체 · 와인셀러) — 다른 종류처럼 필수.
-- 키 큰 컬럼 와인셀러는 지금처럼 냉장고(refrigerator / wine) 로 둔다.
-- 가져오기 함수(import_appliance_models) · 권한 · 정책은 바꾸지 않는다 — 새 종류도 같은 함수로 들어간다.
--
-- 다시 돌려도 된다 (검사는 지우고 다시 만든다). 기존 행은 모두 새 검사를 그대로 통과한다 (목록에 더하기만).
-- =============================================

-- 1) 종류 ------------------------------------------------------------------------

ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_category_check;
ALTER TABLE public.appliance_models
    ADD CONSTRAINT appliance_models_category_check CHECK (category IN (
        'refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine', 'microwave',
        'rice_cooker', 'range', 'faucet',
        'robot_vacuum', 'food_disposer', 'water_purifier', 'wine_cellar'
    ));

-- 2) 종류별 세부 구분 — 0000 기준선의 목록 그대로 + 새 종류 4개 (싱크볼 · 수전 · 세탁기는 구분 없음) ---------

ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk;
ALTER TABLE public.appliance_models
    ADD CONSTRAINT appliance_models_subtype_chk CHECK (subtype IS NULL OR CASE category
        WHEN 'refrigerator' THEN subtype IN ('french_4door', 'side_by_side', 'two_door', 'one_door', 'built_in', 'kimchi_stand', 'kimchi_lid', 'wine', 'small')
        WHEN 'microwave' THEN subtype IN ('solo', 'combi')
        WHEN 'oven' THEN subtype IN ('oven', 'steam_oven', 'combi')
        WHEN 'dishwasher' THEN subtype IN ('built_in', 'freestanding', 'countertop')
        WHEN 'cooktop' THEN subtype IN ('induction', 'highlight', 'hybrid', 'gas')
        WHEN 'hood' THEN subtype IN ('chimney', 'slim', 'built_in', 'island')
        WHEN 'rice_cooker' THEN subtype IN ('pressure_ih', 'ih', 'pressure', 'electric')
        WHEN 'range' THEN subtype IN ('gas', 'induction', 'hybrid', 'highlight')
        WHEN 'robot_vacuum' THEN subtype IN ('toe_kick', 'built_in')
        WHEN 'food_disposer' THEN subtype IN ('grinder', 'grinder_microbial', 'microbial', 'dryer')
        WHEN 'water_purifier' THEN subtype IN ('purify', 'cold', 'hot', 'hot_cold')
        WHEN 'wine_cellar' THEN subtype IN ('under_counter', 'built_in')
        ELSE false
    END);

-- 3) 설명 ------------------------------------------------------------------------

COMMENT ON TABLE public.appliance_models IS '가전 모델 카탈로그 (냉장고 · 주방가전 · 싱크볼 · 수전 · 하부장 가전) — 도면 배치 W/D/H · 상판 타공 참조';
COMMENT ON COLUMN public.appliance_models.category IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine | microwave | rice_cooker | range | faucet | robot_vacuum(로봇청소기 빌트인 스테이션) | food_disposer(싱크대 아래 음식물처리기) | water_purifier(언더싱크 정수기) | wine_cellar(빌트인 · 언더카운터 와인셀러)';
COMMENT ON COLUMN public.appliance_models.subtype IS '세부 구분 — 종류별 목록은 appliance_models_subtype_chk (database/migrations/0032_appliance_lower_categories.sql)';
