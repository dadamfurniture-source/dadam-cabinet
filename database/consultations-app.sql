-- ============================================================
-- consultations — 앱 상담 신청(segan/consult.html)이 쓰는 칸
--
-- 앱의 상담 신청은 consultation.html 과 같은 길(consultations 에 insert → on_new_consultation
-- 트리거가 admin_logs 에 알림)을 쓴다. 이미 있는 칸은 그대로 쓴다:
--   name · email · phone · title · description(요청 내용) · preferred_time(연락 받기 좋은 시간)
--   · consultation_type('ai-design') · status('pending') · user_id · privacy_agreed_at(동의 시각)
-- 없는 것만 더한다:
--   generation_id   이 상담에 붙인 연출컷 (generations.id). 연출컷이 지워지면 비운다
--   quote           신청할 때의 예상 견적 (generations.quote 를 그대로 옮겨 둔다 — 연출컷이 지워져도 남게)
--   sido · gugun    시공 지역 (profiles · partners 와 같은 두 칸)
--   consult_target  상담받을 곳: 'hq'(다담가구 본사) · 'partner'(가까운 협력업체). 지금은 고객의 선택만 남긴다
--
-- 여러 번 돌려도 같다 (IF NOT EXISTS). RLS 는 바꾸지 않는다 — 기존 정책 그대로:
--   insert 는 누구나("Users can insert consultations"), 읽기는 본인(user_id) · 관리자.
-- ============================================================

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
