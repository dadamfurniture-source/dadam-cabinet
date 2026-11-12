-- =============================================
-- 0058 — 현장 좌표(시도 · 구군 · 위도 · 경도) + A/S 방문 일정 잇기
--
-- 2026-11-10 대표님 승인 계획 3단계 「설치 · A/S 지도 + 표」.
--   지금 현장 주소(design_site_info.address)는 자유 글자 한 줄뿐이라 지도에 찍을 수 없다.
--   A/S 접수(as_requests)에는 방문일이 없다.
--
-- 바꾸는 것
--   1) design_site_info — 지도용 칸 여섯
--        sido · gugun   시도 · 구군 (지도 회사 주소 변환 결과 — 표의 「지역」 칸 · 지역 거르기)
--        lat · lng      위도 · 경도 (둘 다 있거나 둘 다 없다, 대한민국 범위)
--        geo_address    좌표로 바꾼 그때의 주소 글자. 지금 address 와 같을 때만 좌표를 믿는다
--                       — 주소를 고치면 좌표를 지우지 않아도 저절로 「좌표 없음」이 된다
--        geocoded_at    좌표를 적은 때
--   2) as_requests.visit_schedule_id — 그 접수의 방문 일정(design_schedules, type as_visit) 한 줄
--        방문일 · 방문 담당 · 상태는 일정 표에 있다 → 업무 달력의 「A/S 방문」과 같은 줄.
--        일정이 지워지면 비운다. 한 일정은 한 접수에만.
--
-- 바꾸지 않는 것
--   정책 · 권한 (현장 정보 읽기 = 설계 주인 · 그 업체 구성원, 쓰기 = 서버), as_requests 지킴이 트리거
--   (지킴이는 만든 칸 · 상태 · 때만 본다 — 새 칸은 서버가 고칠 수 있다)
--
-- 다시 돌려도 된다 (IF NOT EXISTS · DROP 뒤 ADD).
-- =============================================

-- 1) 현장 좌표 --------------------------------------------------------------------------

ALTER TABLE public.design_site_info
    ADD COLUMN IF NOT EXISTS sido text,
    ADD COLUMN IF NOT EXISTS gugun text,
    ADD COLUMN IF NOT EXISTS lat double precision,
    ADD COLUMN IF NOT EXISTS lng double precision,
    ADD COLUMN IF NOT EXISTS geo_address text,
    ADD COLUMN IF NOT EXISTS geocoded_at timestamp with time zone;

ALTER TABLE public.design_site_info DROP CONSTRAINT IF EXISTS design_site_info_geo_chk;
ALTER TABLE public.design_site_info
    ADD CONSTRAINT design_site_info_geo_chk CHECK (
        (COALESCE(length(sido), 0) <= 20)
        AND (COALESCE(length(gugun), 0) <= 30)
        AND (COALESCE(length(geo_address), 0) <= 200)
        AND ((lat IS NULL) = (lng IS NULL))
        AND ((lat IS NULL) OR ((lat >= 32.5) AND (lat <= 39.5) AND (lng >= 124.0) AND (lng <= 132.5)))
        AND ((lat IS NULL) OR (geo_address IS NOT NULL))
    );

COMMENT ON COLUMN public.design_site_info.sido IS '시도 — 주소 변환 결과 (0058). 지도 · 표의 지역 칸';
COMMENT ON COLUMN public.design_site_info.gugun IS '구군 — 주소 변환 결과 (0058)';
COMMENT ON COLUMN public.design_site_info.lat IS '위도 (0058). lng 와 같이 있거나 같이 없다';
COMMENT ON COLUMN public.design_site_info.lng IS '경도 (0058)';
COMMENT ON COLUMN public.design_site_info.geo_address IS '좌표로 바꾼 그때의 address 글자 (0058). 지금 address 와 다르면 좌표는 옛 주소 것 — 쓰지 않는다';
COMMENT ON COLUMN public.design_site_info.geocoded_at IS '좌표를 적은 때 (0058)';

-- 2) A/S 방문 일정 잇기 -----------------------------------------------------------------

ALTER TABLE public.as_requests
    ADD COLUMN IF NOT EXISTS visit_schedule_id uuid;

ALTER TABLE public.as_requests DROP CONSTRAINT IF EXISTS as_requests_visit_schedule_fkey;
ALTER TABLE public.as_requests
    ADD CONSTRAINT as_requests_visit_schedule_fkey FOREIGN KEY (visit_schedule_id)
        REFERENCES public.design_schedules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_as_requests_visit_schedule
    ON public.as_requests USING btree (visit_schedule_id) WHERE (visit_schedule_id IS NOT NULL);

COMMENT ON COLUMN public.as_requests.visit_schedule_id IS 'A/S 방문 일정 (design_schedules, type as_visit) — 방문일 · 방문 담당 · 상태는 그 줄에 (0058). 일정이 지워지면 비운다';
