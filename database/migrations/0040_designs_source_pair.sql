-- =============================================
-- 0040 — 설계 출처 칸 둘은 같이 (designs_source_check 구멍 막기)
--
-- 0035 의 designs_source_check 는 「둘 다 비움 또는 둘 다 모양대로」를 뜻했지만,
-- 하나만 채우면 비운 쪽 정규식이 NULL 이 되어 CHECK 가 통과했다 (CHECK 는 NULL 을 거절하지 않는다).
--   source 만 'planner-lite' · source_ref 비움 → 통과 (막아야 함)
--   source 비움 · source_ref 만 → 통과 (막아야 함)
-- 11-04 0035 프로브 「설계 출처 — 하나만 채우면 거절」 칸이 ok 로 나와 알았다. 0035 는 적용됐으니 고치지 않고 이 파일로 바꾼다.
--
-- 바꾸는 것: designs_source_check 를 지우고 IS NOT NULL 둘을 더해 다시 만든다 (모양 정규식 · 유일 색인은 그대로).
-- 지금 행이 이 규칙을 어기면 ADD CONSTRAINT 가 멈춘다 — 미리 보기(--dry)에서 드러난다.
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_source_check;
ALTER TABLE public.designs
    ADD CONSTRAINT designs_source_check CHECK (
        (source IS NULL AND source_ref IS NULL)
        OR (source IS NOT NULL AND source_ref IS NOT NULL
            AND source ~ '^[a-z0-9-]{1,32}$' AND source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$')
    );
