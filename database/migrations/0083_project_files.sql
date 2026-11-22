-- =============================================
-- 0083 프로젝트 단계 사진 (2026-11-23 대표님 승인 「프로젝트 관리 새 틀」 — 답 5번 「① 2차로 만듦」)
--
--   대표님이 정한 것 (2026-11-23):
--     · 「선형 단계를 찍으면 구체적으로 어떤 사진 및 도면, 정보들이 있는지 한눈에」 — 프로젝트 한 건 화면의 단계 칸.
--     · 실측 · 현장 사진을 단계에 직접 올리는 자리가 없다(실측에는 날 · 담당 · 메모뿐) → 단계 칸에 「사진 올리기」.
--       실측뿐 아니라 어느 단계에나 올린다.
--
-- 바꾸는 것:
--   1) project_files — 프로젝트의 단계에 붙인 사진 한 장이 한 줄.
--        stage       어느 단계 칸에 보이나 (상담 consult · 실측 measure · 설계 design · 견적 quote · 계약 contract ·
--                    생산 make · 설치 install · A/S done — workflow-api src/pipeline.js STEPS 와 같다)
--        path        버킷 project-files 안의 자리 — <업체>/<프로젝트>/<uuid>.jpg|png (그 업체 · 그 프로젝트 것만)
--        note        한 줄 메모 (200자까지)
--        created_by  올린 사람
--        deleted_at · deleted_by  지운 때와 사람 — 줄은 남기고 표시만 한다 (버킷 파일은 워커가 치운다)
--      올린 내용은 바뀌지 않는다 (사람 칸이 지워져 비는 것만). 지운 줄은 되살리지 못한다.
--      프로젝트와 같은 업체의 줄만 ((project_id, company_id) 복합 FK). 프로젝트가 지워지면 같이 지워진다.
--      서버(service_role)만 쓰고 읽는다 — 화면은 워커를 거쳐 본다 (실측 일정 0079 와 같은 결).
--   2) 버킷 project-files — 비공개 · 5MB · JPEG · PNG. 화면에는 워커가 한 시간짜리 서명 주소로 준다.
--
-- 읽기 · 쓰기: 새 표는 정책이 없다 — anon · authenticated 는 읽지도 쓰지도 못한다.
-- 이미 있는 줄 · 표는 바뀌지 않는다.
-- =============================================

-- 1) 프로젝트 단계 사진 ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    stage text NOT NULL,
    path text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT project_files_pkey PRIMARY KEY (id),
    CONSTRAINT project_files_path_key UNIQUE (path),
    CONSTRAINT project_files_stage_check CHECK (stage = ANY (ARRAY['consult'::text, 'measure'::text, 'design'::text, 'quote'::text,
        'contract'::text, 'make'::text, 'install'::text, 'done'::text])),
    CONSTRAINT project_files_path_check CHECK ((length(path) <= 200)
        AND (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'::text)
        AND (path LIKE ((company_id::text || '/'::text) || project_id::text) || '/%'::text)),
    CONSTRAINT project_files_note_check CHECK ((note IS NULL) OR (length(note) <= 200)),
    CONSTRAINT project_files_deleted_check CHECK ((deleted_by IS NULL) OR (deleted_at IS NOT NULL)),
    CONSTRAINT project_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT project_files_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE,
    CONSTRAINT project_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT project_files_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_files IS '프로젝트의 단계에 붙인 사진 (0083 · 2026-11-23 프로젝트 관리 새 틀). 사진 한 장이 한 줄 — 버킷 project-files. 지우면 표시만 한다. 서버만 쓰고 읽는다';

CREATE INDEX IF NOT EXISTS idx_project_files_project ON public.project_files USING btree (project_id, stage, created_at DESC) WHERE (deleted_at IS NULL);

-- 지킴이 — 새 줄은 지운 것으로 넣지 못한다 · 올린 내용은 바뀌지 않는다 · 지운 줄은 되살리지 못한다
CREATE OR REPLACE FUNCTION public.project_files_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL THEN
      RAISE EXCEPTION 'project_files: 새 사진은 지운 것으로 넣지 못합니다' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.project_id, NEW.stage, NEW.path, NEW.note, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.project_id, OLD.stage, OLD.path, OLD.note, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'project_files: 올린 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF OLD.deleted_at IS NOT NULL
     AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
          OR (NEW.deleted_by IS NOT NULL AND NEW.deleted_by IS DISTINCT FROM OLD.deleted_by)) THEN
    RAISE EXCEPTION 'project_files: 지운 사진은 되살리거나 고치지 못합니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.project_files_guard() IS '프로젝트 단계 사진 지킴이 — 새 줄은 지운 것으로 넣지 못하고, 올린 내용은 바뀌지 않고, 지운 줄은 되살리지 못한다';

REVOKE ALL ON FUNCTION public.project_files_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_project_files_guard ON public.project_files;
CREATE TRIGGER trg_project_files_guard BEFORE INSERT OR UPDATE ON public.project_files FOR EACH ROW EXECUTE FUNCTION public.project_files_guard();

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_files FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_files TO service_role;

-- 2) 사진 버킷 ----------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-files', 'project-files', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
