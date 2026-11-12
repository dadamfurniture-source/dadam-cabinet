-- ============================================================
-- consultations — 앱 상담 신청(segan/consult.html)이 쓰는 칸 + insert 정책
--
-- 앱의 상담 신청은 consultation.html 과 같은 길(Supabase 로 consultations 에 insert)을 쓴다.
-- 이미 있는 칸은 그대로 쓴다:
--   name · email · phone · title · description(요청 내용) · preferred_time(연락 받기 좋은 시간)
--   · consultation_type('ai-design') · status('pending') · user_id · privacy_agreed_at(동의 시각)
-- 없는 것만 더한다:
--   generation_id   이 상담에 붙인 연출컷 (generations.id). 연출컷이 지워지면 비운다
--   quote           신청할 때의 예상 견적 (generations.quote 를 그대로 옮겨 둔다 — 연출컷이 지워져도 남게)
--   sido · gugun    시공 지역 (profiles · partners 와 같은 두 칸)
--   consult_target  상담받을 곳: 'hq'(다담가구 본사) · 'partner'(가까운 협력업체). 지금은 고객의 선택만 남긴다
--
-- insert 정책 「Users can insert consultations」 를 좁힌다 (예전: WITH CHECK (true) — 누구나 아무 user_id 로):
--   user_id 는 비우거나(로그인 없이 consultation.html 에서 신청 — 지금처럼 된다) 자기 것만,
--   generation_id 는 비우거나 자기 연출컷만.
--   연출컷 주인 확인은 SECURITY DEFINER 함수로 한다 — 정책 식에 generations 를 바로 쓰면 그 표에 권한이 없는
--   anon 의 insert 가 (generation_id 를 비워도) 「permission denied for table generations」 로 막힌다.
-- 읽기 · 고치기 정책은 그대로다 (본인 · 관리자).
--
-- 여러 번 돌려도 같다. 정책을 바꾸는 동안 insert 정책이 비는 틈이 없게 한 트랜잭션으로 묶는다.
-- ============================================================

BEGIN;

ALTER TABLE public.consultations
    ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS quote JSONB,
    ADD COLUMN IF NOT EXISTS sido TEXT,
    ADD COLUMN IF NOT EXISTS gugun TEXT,
    ADD COLUMN IF NOT EXISTS consult_target TEXT,
    -- 운영 DB 에는 이미 있다. 저장소의 스키마 기록을 맞추려고 둔다 (있으면 아무 일도 하지 않는다)
    ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMPTZ;

-- consult_target 은 두 값만 (비어 있어도 된다 — 사이트 consultation.html 은 이 칸을 쓰지 않는다)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'consultations_consult_target_check'
          AND conrelid = 'public.consultations'::regclass
    ) THEN
        ALTER TABLE public.consultations
            ADD CONSTRAINT consultations_consult_target_check
            CHECK (consult_target IS NULL OR consult_target IN ('hq', 'partner'));
    END IF;
END $$;

-- 내 연출컷 · 상담 내역에서 「이 연출컷으로 낸 상담」을 찾는다
CREATE INDEX IF NOT EXISTS idx_consultations_generation
    ON public.consultations(generation_id)
    WHERE generation_id IS NOT NULL;

-- 붙인 연출컷이 비었거나 신청하는 사람의 것인가
CREATE OR REPLACE FUNCTION public.consultation_generation_ok(gid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT gid IS NULL
        OR EXISTS (SELECT 1 FROM public.generations g WHERE g.id = gid AND g.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.consultation_generation_ok(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultation_generation_ok(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    WITH CHECK (
        (user_id IS NULL OR user_id = auth.uid())
        AND public.consultation_generation_ok(generation_id)
    );

COMMIT;
