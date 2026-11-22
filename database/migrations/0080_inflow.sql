-- =============================================
-- 0080 유입 경로 — 상담 · 가입에 「어디서 왔나」 남기기 (2026-11-23 마케팅 「사이트 새는 곳 막기」 묶음 2)
--
--   대표님이 정한 것 (2026-11-21): Cloudflare 웹 분석 + 자체 기록.
--     방문 수는 Cloudflare 가, 「어느 글 · 광고를 보고 온 고객이 상담 · 가입했나」는 이 칸들이 맡는다.
--
--   값은 화면(segan/source.js)이 처음 방문 때 브라우저에 담아 둔 것 — 처음 온 곳을 지킨다(90일):
--     inflow_source    utm_source  (instagram · naver_blog …)           100자까지
--     inflow_medium    utm_medium  (social · cpc …)                     100자까지
--     inflow_campaign  utm_campaign (tones …)                           100자까지
--     inflow_referrer  꼬리표 없이 들어왔을 때 바깥 사이트 호스트만 (search.naver.com …) — 주소 전체는 담지 않는다  200자까지
--
-- 바꾸는 것:
--   1) consultations — 유입 칸 넷. 고객이 상담을 넣을 때 같이 넣는다 (넣기 정책 · GRANT 는 그대로 — 표 단위 GRANT 0000, 정책 0017)
--   2) profiles      — 유입 칸 넷 + inflow_at(채운 때). 가입한 사람이 자기 줄에 한 번 채운다
--                      (본인 고치기 정책 「Users can update own profile」 그대로 — 화면은 inflow_at 이 비었을 때만 채운다)
--
-- 이미 있는 줄은 바뀌지 않는다 (새 칸은 모두 비어 있다). 업체에 넘기는 상담 사본에는 넣지 않는다 (workflow-api COPY_FIELDS).
-- =============================================

-- 1) 상담 ---------------------------------------------------------------------------
ALTER TABLE public.consultations
    ADD COLUMN IF NOT EXISTS inflow_source text,
    ADD COLUMN IF NOT EXISTS inflow_medium text,
    ADD COLUMN IF NOT EXISTS inflow_campaign text,
    ADD COLUMN IF NOT EXISTS inflow_referrer text;

ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_inflow_len_check;
ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_inflow_len_check CHECK ((COALESCE(length(inflow_source), 0) <= 100)
        AND (COALESCE(length(inflow_medium), 0) <= 100) AND (COALESCE(length(inflow_campaign), 0) <= 100)
        AND (COALESCE(length(inflow_referrer), 0) <= 200));

COMMENT ON COLUMN public.consultations.inflow_source IS '유입 — utm_source (0080 · 2026-11-23). 처음 방문 때 브라우저가 담아 둔 값';
COMMENT ON COLUMN public.consultations.inflow_medium IS '유입 — utm_medium';
COMMENT ON COLUMN public.consultations.inflow_campaign IS '유입 — utm_campaign';
COMMENT ON COLUMN public.consultations.inflow_referrer IS '유입 — 꼬리표 없이 들어온 바깥 사이트 호스트 (주소 전체는 담지 않는다)';

-- 2) 가입 ---------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS inflow_source text,
    ADD COLUMN IF NOT EXISTS inflow_medium text,
    ADD COLUMN IF NOT EXISTS inflow_campaign text,
    ADD COLUMN IF NOT EXISTS inflow_referrer text,
    ADD COLUMN IF NOT EXISTS inflow_at timestamp with time zone;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_inflow_len_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_inflow_len_check CHECK ((COALESCE(length(inflow_source), 0) <= 100)
        AND (COALESCE(length(inflow_medium), 0) <= 100) AND (COALESCE(length(inflow_campaign), 0) <= 100)
        AND (COALESCE(length(inflow_referrer), 0) <= 200));

COMMENT ON COLUMN public.profiles.inflow_source IS '유입 — utm_source (0080 · 2026-11-23). 가입한 사람이 한 번 채운다';
COMMENT ON COLUMN public.profiles.inflow_medium IS '유입 — utm_medium';
COMMENT ON COLUMN public.profiles.inflow_campaign IS '유입 — utm_campaign';
COMMENT ON COLUMN public.profiles.inflow_referrer IS '유입 — 꼬리표 없이 들어온 바깥 사이트 호스트';
COMMENT ON COLUMN public.profiles.inflow_at IS '유입 칸을 채운 때 — 비었을 때만 화면이 채운다';
