-- =============================================
-- 0046 간편 플래너 웹판 저장소 — 설계 초안 · 설계 사진 · 내 모듈 (서버만 읽고 쓴다)
--
--   간편 플래너를 앱 주소(/segan/planner/)에서 돌릴 때, 지금까지 PC 폴더에 두던 것을 DB 로 옮긴다.
--   플래너 서버 → workflow-api(/planner/drafts · /planner/my-modules) → 이 표들. 화면은 표를 바로 읽지 않는다.
--
-- 바꾸는 것:
--   1) planner_drafts — 설계 하나 = 한 줄 (업체 · 플래너 설계 id). 형식은 플래너 저장 형식(dadam.planner-lite/1) 그대로 model 에.
--        rev        고친 차례 — 고칠 때마다 하나씩 오른다 (서버가 「보낸 rev = 저장된 rev」 일 때만 덮어쓴다 → 아니면 409)
--        app_state  마지막으로 앱에 보낸 설계 · 동결본 (플래너의 <id>/app.json 자리)
--        discarded_at  버린 설계 — 지우지 않고 표시만 한다. 한 번 적으면 그대로
--   2) planner_draft_photos — 설계 사진 한 장 = 한 줄. 바이트는 비공개 버킷 planner-photos 의 <업체 id>/<설계 id>/<파일>.
--        같은 업체 설계만 (planner_drafts (company_id, id) 복합 FK). 지우기는 deleted_at 표시만 (버킷 파일은 남는다)
--   3) planner_my_modules — 사람마다 고친 모듈 틀 (내 모듈). 사람이 지우면 줄을 지운다
--   4) 비공개 버킷 planner-photos — 15MB · JPEG · PNG · WEBP, 정책 없음(서버만)
--
-- 읽기 · 쓰기: 셋 다 service_role 만 (RLS 켬, 정책 없음). 누가 어느 설계를 보고 고치는지는 workflow-api 가 정한다.
-- =============================================

-- 1) 설계 초안 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_drafts (
    company_id uuid NOT NULL,
    id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    item text DEFAULT 'sink'::text NOT NULL,
    model jsonb NOT NULL,
    rev integer DEFAULT 1 NOT NULL,
    app_state jsonb,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    discarded_at timestamp with time zone,
    CONSTRAINT planner_drafts_pkey PRIMARY KEY (company_id, id),
    CONSTRAINT planner_drafts_id_check CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}$'::text),
    CONSTRAINT planner_drafts_name_check CHECK (length(name) <= 200),
    CONSTRAINT planner_drafts_item_check CHECK (item ~ '^[a-z_]{1,40}$'::text),
    CONSTRAINT planner_drafts_model_check CHECK ((jsonb_typeof(model) = 'object'::text) AND (octet_length(model::text) <= 5242880)),
    CONSTRAINT planner_drafts_rev_check CHECK (rev >= 1),
    CONSTRAINT planner_drafts_app_state_check CHECK ((app_state IS NULL) OR ((jsonb_typeof(app_state) = 'object'::text) AND (octet_length(app_state::text) <= 65536))),
    CONSTRAINT planner_drafts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT planner_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT planner_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_drafts IS '간편 플래너 웹판 설계 초안 — 업체 · 설계 id 마다 한 줄, model = dadam.planner-lite/1. 고칠 때마다 rev 하나 올림, 버리기는 discarded_at 표시만. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_drafts_company_updated ON public.planner_drafts USING btree (company_id, updated_at DESC) WHERE (discarded_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_planner_drafts_created_by ON public.planner_drafts USING btree (created_by) WHERE (created_by IS NOT NULL);

-- 지킴이 — 열쇠 · 만든 사람 · 만든 때는 그대로, 내용이 바뀌면 rev 는 꼭 하나만 오른다, 버린 설계는 다시 바뀌지 않는다, 고친 때는 여기서 찍는다
CREATE OR REPLACE FUNCTION public.planner_drafts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.company_id, NEW.id, NEW.created_at) IS DISTINCT FROM (OLD.company_id, OLD.id, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'planner_drafts: 설계 열쇠 · 만든 사람 · 만든 때는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF OLD.discarded_at IS NOT NULL THEN
    -- 사람이 지워져 사람 칸이 비는 것(ON DELETE SET NULL)만 된다
    IF (NEW.name, NEW.item, NEW.model, NEW.rev, NEW.app_state, NEW.discarded_at)
       IS DISTINCT FROM (OLD.name, OLD.item, OLD.model, OLD.rev, OLD.app_state, OLD.discarded_at)
       OR (NEW.updated_by IS NOT NULL AND NEW.updated_by IS DISTINCT FROM OLD.updated_by) THEN
      RAISE EXCEPTION 'planner_drafts: 버린 설계는 바뀌지 않습니다' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.model IS DISTINCT FROM OLD.model AND NEW.rev <> OLD.rev + 1 THEN
    RAISE EXCEPTION 'planner_drafts: 내용이 바뀌면 고친 차례(rev)는 하나 오른다 (% -> %)', OLD.rev, NEW.rev USING ERRCODE = '22023';
  END IF;
  IF NEW.model IS NOT DISTINCT FROM OLD.model AND NEW.rev <> OLD.rev THEN
    RAISE EXCEPTION 'planner_drafts: 내용이 그대로면 고친 차례(rev)도 그대로다' USING ERRCODE = '22023';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.planner_drafts_guard() IS '플래너 설계 초안 지킴이 — 열쇠 · 만든 사람 · 만든 때 그대로, 내용이 바뀌면 rev + 1, 버린 설계는 그대로, 고친 때를 찍는다 (0046)';

REVOKE ALL ON FUNCTION public.planner_drafts_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_planner_drafts_guard ON public.planner_drafts;
CREATE TRIGGER trg_planner_drafts_guard BEFORE UPDATE ON public.planner_drafts FOR EACH ROW EXECUTE FUNCTION public.planner_drafts_guard();

ALTER TABLE public.planner_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_drafts TO service_role;
-- 지우기 · 비우기는 아무도 못 한다 (버리기는 discarded_at)
REVOKE DELETE, TRUNCATE ON TABLE public.planner_drafts FROM service_role;

-- 2) 설계 사진 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_draft_photos (
    company_id uuid NOT NULL,
    draft_id text NOT NULL,
    file text NOT NULL,
    mime text NOT NULL,
    bytes integer NOT NULL,
    width integer,
    height integer,
    sha256 text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT planner_draft_photos_pkey PRIMARY KEY (company_id, draft_id, file),
    CONSTRAINT planner_draft_photos_file_check CHECK (file ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}\.(jpg|png|webp)$'::text),
    CONSTRAINT planner_draft_photos_mime_check CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])),
    CONSTRAINT planner_draft_photos_bytes_check CHECK ((bytes > 0) AND (bytes <= 15728640)),
    CONSTRAINT planner_draft_photos_size_check CHECK (((width IS NULL) OR (width > 0)) AND ((height IS NULL) OR (height > 0))),
    CONSTRAINT planner_draft_photos_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'::text),
    CONSTRAINT planner_draft_photos_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT planner_draft_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_draft_photos IS '간편 플래너 웹판 설계 사진 — 바이트는 비공개 버킷 planner-photos <업체 id>/<설계 id>/<파일>. 지우기는 deleted_at 표시만. service_role 만';

-- 지킴이 — 사진 내용은 그대로, 지운 표시는 한 번만
CREATE OR REPLACE FUNCTION public.planner_draft_photos_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.company_id, NEW.draft_id, NEW.file, NEW.mime, NEW.bytes, NEW.width, NEW.height, NEW.sha256, NEW.created_at)
     IS DISTINCT FROM (OLD.company_id, OLD.draft_id, OLD.file, OLD.mime, OLD.bytes, OLD.width, OLD.height, OLD.sha256, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'planner_draft_photos: 사진 내용은 바꿀 수 없습니다 (지운 표시만 한 번)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.planner_draft_photos_guard() IS '플래너 설계 사진 지킴이 — 내용 그대로, 지운 표시(deleted_at)만 한 번 (0046)';

REVOKE ALL ON FUNCTION public.planner_draft_photos_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_planner_draft_photos_guard ON public.planner_draft_photos;
CREATE TRIGGER trg_planner_draft_photos_guard BEFORE UPDATE ON public.planner_draft_photos FOR EACH ROW EXECUTE FUNCTION public.planner_draft_photos_guard();

ALTER TABLE public.planner_draft_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_draft_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_photos TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_photos FROM service_role;

-- 3) 내 모듈 -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_my_modules (
    user_id uuid NOT NULL,
    id text NOT NULL,
    company_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_my_modules_pkey PRIMARY KEY (user_id, id),
    CONSTRAINT planner_my_modules_id_check CHECK (id ~ '^my-[a-z0-9]{6,40}$'::text),
    CONSTRAINT planner_my_modules_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text) AND (octet_length(payload::text) <= 262144)),
    CONSTRAINT planner_my_modules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT planner_my_modules_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.planner_my_modules IS '간편 플래너 웹판 내 모듈 — 사람마다 고친 모듈 틀 (라이브러리 모듈 + 고친 값). 정식 라이브러리가 아니다. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_my_modules_user_created ON public.planner_my_modules USING btree (user_id, created_at DESC);

ALTER TABLE public.planner_my_modules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_my_modules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.planner_my_modules TO service_role;
REVOKE UPDATE, TRUNCATE ON TABLE public.planner_my_modules FROM service_role;

-- 4) 사진 버킷 ------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('planner-photos', 'planner-photos', false, 15728640, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
