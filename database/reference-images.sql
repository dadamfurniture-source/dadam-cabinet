-- =============================================
-- 참고 이미지 — 연출컷(ai-design.html) 「테마」 탭 (2026-10-08)
--
-- 왜: 테마 사진을 위키미디어 공용에서 **실시간으로** 찾아 왔다. 검색 13개를 다 기다리고(7.5초),
--   받은 300장 전부의 채도를 6장씩 차례로 잰 뒤(37초)에야 첫 장이 떴다 — 약 45초.
--   이제 쓸 사진을 미리 골라 우리 Storage 에 두고, 연출컷 화면은 이 표를 한 번 읽어 섞기만 한다.
--
-- 사진이 들어오는 두 길:
--   ① 업로드 (source='upload')  관리자가 직접 올린다 → 곧바로 approved
--   ② 추천   (source='claude')  Claude 가 고른 후보를 **파일로** 넘기면 관리자가 관리자 화면
--                              「추천 불러오기」로 올린다 → pending → 관리자가 확정(approved)·거절(rejected)
--      서비스 롤 키를 쓰지 않는다 — 넣는 것은 늘 관리자 로그인이다 (아래 RLS 가 is_admin() 만 허용).
--
-- 이름: 표 `theme_images` · 버킷 `theme-images`.
--   `reference_images` 는 쓰지 않는다 — 벽 분석 few-shot 용 **다른 표**가 이미 그 이름으로 있다
--   (category·visual_features·ground_truth, mcp-server/src/clients/supabase.client.ts 가 읽는다).
--   처음 이 파일이 그 이름을 썼다가 CREATE TABLE IF NOT EXISTS 가 옛 표를 건너뛰고 인덱스에서 깨졌다.
--
-- 파일: 버킷 `theme-images` (공개 읽기)
--   {id}/full.jpg   원본 (긴 변 1600 까지 줄임)
--   {id}/thumb.jpg  격자용 썸네일 (가로 320) — 연출컷 생성 때 워커로 보내는 것도 이것이다 (예전과 같은 크기)
--   pending(추천) 행은 아직 파일이 없다 — 원본 주소(origin_url)로 미리보기만 하고, 확정할 때 복사한다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일을 통째로 붙여 실행. 여러 번 돌려도 안전하다.
-- =============================================

CREATE TABLE IF NOT EXISTS public.theme_images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 테마 — 기본 여섯은 키('animal' · 'flower' · 'nature' · 'product' · 'painting' · 'ai')이고
    --   이름은 js/reference-images.js 가 붙인다. 관리자가 새로 만든 테마는 이름 그대로 들어간다 (예: '원목').
    theme           TEXT NOT NULL CHECK (char_length(btrim(theme)) BETWEEN 1 AND 32),

    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    source          TEXT NOT NULL CHECK (source IN ('upload', 'claude')),

    title           TEXT,           -- 알아보기 위한 이름
    note            TEXT,           -- 추천 이유 (Claude) · 메모 (관리자)

    -- 출처 — 추천(위키미디어)은 CC0 · 퍼블릭 도메인만 받는다 (상업 사용·재배포 가능).
    origin_url      TEXT,           -- 원본 파일 주소 — 같은 사진인지 가리는 키 (아래 유니크)
    preview_url     TEXT,           -- 검토 화면 미리보기 (위키미디어 320 썸네일) — 원본은 수십 MB 일 수 있다
    download_url    TEXT,           -- 확정할 때 받아 복사할 주소 (위키미디어 1280 썸네일). 없으면 origin_url
    source_page     TEXT,           -- 사람이 보는 출처 페이지
    author          TEXT,
    license         TEXT,

    -- 버킷 안의 경로 — approved 는 반드시 있다 (아래 CHECK)
    storage_path    TEXT,
    thumb_path      TEXT,
    width           INT,
    height          INT,

    -- 채도 점수 (0~1) — **등록할 때 한 번** 잰다. 예전엔 손님이 열 때마다 300장을 쟀다.
    colorfulness    REAL,

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,     -- 지우지 않고 숨기기

    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    reviewed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 사용 중인 사진은 반드시 우리 Storage 에 파일이 있다 — 남의 서버 링크로 서비스하지 않는다
    CONSTRAINT theme_images_approved_has_file
        CHECK (status <> 'approved' OR (storage_path IS NOT NULL AND thumb_path IS NOT NULL))
);

-- 같은 이름의 다른 표가 있으면 IF NOT EXISTS 가 조용히 건너뛴다 — 여기서 분명히 멈춘다
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'theme_images' AND column_name = 'origin_url'
    ) THEN
        RAISE EXCEPTION 'public.theme_images 가 이미 다른 모양으로 있습니다. 이름이 겹친 표인지 먼저 확인하세요.';
    END IF;
END $$;

-- 같은 원본은 두 번 들어가지 않는다. 거절한 것도 남겨 두어 같은 사진을 다시 추천하지 않게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS theme_images_origin_url_key
    ON public.theme_images (origin_url)
    WHERE origin_url IS NOT NULL;

-- 연출컷 화면이 쓰는 질의: approved · 활성
CREATE INDEX IF NOT EXISTS idx_theme_images_served
    ON public.theme_images (status, is_active, theme);


-- =============================================
-- RLS
--   손님(누구나): 사용 중(approved)이면서 숨기지 않은 것만 읽는다
--   관리자: 전부 (public.is_admin() — SECURITY DEFINER, js/admin-access.js 와 같은 판정)
-- =============================================
ALTER TABLE public.theme_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "theme_images_public_read" ON public.theme_images;
CREATE POLICY "theme_images_public_read" ON public.theme_images
    FOR SELECT
    USING (status = 'approved' AND is_active);

DROP POLICY IF EXISTS "theme_images_admin_all" ON public.theme_images;
CREATE POLICY "theme_images_admin_all" ON public.theme_images
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());


-- =============================================
-- Storage 버킷 `theme-images` — 공개 읽기, 쓰기는 관리자만
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('theme-images', 'theme-images', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "theme_images_obj_read" ON storage.objects;
DROP POLICY IF EXISTS "theme_images_obj_insert" ON storage.objects;
DROP POLICY IF EXISTS "theme_images_obj_update" ON storage.objects;
DROP POLICY IF EXISTS "theme_images_obj_delete" ON storage.objects;

CREATE POLICY "theme_images_obj_read" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'theme-images');

CREATE POLICY "theme_images_obj_insert" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'theme-images' AND public.is_admin());

-- 확정을 다시 눌렀을 때 같은 경로에 덮어쓰기(upsert) 한다
CREATE POLICY "theme_images_obj_update" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'theme-images' AND public.is_admin())
    WITH CHECK (bucket_id = 'theme-images' AND public.is_admin());

CREATE POLICY "theme_images_obj_delete" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'theme-images' AND public.is_admin());
