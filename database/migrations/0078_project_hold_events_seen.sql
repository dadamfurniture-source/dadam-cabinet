-- =============================================
-- 0078 프로젝트 보류 · 프로젝트 일지 · 받은 일 읽음 (2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차 — 「차례대로」)
--
--   대표님이 정한 것 (2026-11-21):
--     · 차례대로 (1차 = 업체 안에서 바로 쓰는 것: 잔금 · 보류/그만둠 · 누가 했는지 기록 · 계정마다 읽음)
--     · 계약금을 받으면 보류 · 그만둠은 작동하지 않는다 — 이 규칙은 서버가 지킨다
--       (workflow-api PATCH /company/projects/:id/status — projects.status 를 바꾸는 길은 그것 하나다)
--
-- 바꾸는 것:
--   1) projects — 상태에 on_hold(보류)를 더하고, 상태를 바꾼 때 · 사람 · 메모 · 다시 볼 날 칸을 더한다
--        status       active · on_hold(새) · closed · cancelled · handed_over
--        hold_until   보류를 다시 볼 날 (보류일 때만 — 다른 상태에서는 비운다)
--        status_note  보류 · 그만둠 메모 (200자까지, 없어도 된다)
--        status_at    상태를 마지막으로 바꾼 때 (서버가 적는다)
--        status_by    바꾼 사람 (서버가 적는다)
--   2) project_events — 프로젝트 일지. 누가 · 언제 · 무엇을 했는지 한 줄씩. 추가만 하고 고치거나 지우지 않는다
--        (수주 완료 보고 order_reports 0043 과 같은 결). 서버(service_role)만 쓰고 읽는다 — 화면은 워커를 거쳐 본다.
--        actor_kind   member 구성원 · customer 고객 · worker 작업자 · admin 본사 · system 서버(자동)
--        type         사건 이름 (quote_sent · order_created · status_changed … 1 ~ 40자, 값은 서버가 정한다)
--        subject_*    무엇에 일어났나 (order · document · design · draft … + 그 id — 플래너 초안 id 는 글자라 text)
--        payload      id · 상태 · 종류 값만. 이름 · 연락처 · 주소 · 금액 · 글은 넣지 않는다 (company_events 0003 과 같은 규칙)
--      프로젝트와 같은 업체의 줄만 ((project_id, company_id) 복합 FK — 0006 의 유니크). 프로젝트가 지워지면 같이 지워진다
--      (막 만든 프로젝트를 되돌리는 서버 길이 일지 때문에 막히지 않게).
--   3) inbox_seen — 「새로 생긴 일」 소식을 어디까지 봤나. 사람 · 업체마다 한 줄 (기기가 아니라 계정이 기억한다).
--        seen_at 은 앞으로만 간다 (지킴이가 옛 값을 지킨다). 서버만 쓰고 읽는다.
--
-- 읽기 · 쓰기: 새 표 둘은 정책이 없다 — anon · authenticated 는 읽지도 쓰지도 못한다 (ensure_rls 가 RLS 를 켠다. 아래에서도 켠다).
-- 이미 있는 줄은 바뀌지 않는다 (새 칸은 모두 비어 있다).
-- =============================================

-- 1) 프로젝트 상태 ------------------------------------------------------------------
ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS hold_until date,
    ADD COLUMN IF NOT EXISTS status_note text,
    ADD COLUMN IF NOT EXISTS status_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS status_by uuid;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_status_check CHECK (status = ANY (ARRAY['active'::text, 'on_hold'::text, 'closed'::text, 'cancelled'::text, 'handed_over'::text]));

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_hold_until_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_hold_until_check CHECK ((hold_until IS NULL) OR (status = 'on_hold'::text));

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_note_check;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_status_note_check CHECK ((status_note IS NULL) OR (length(status_note) <= 200));

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_by_fkey;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_status_by_fkey FOREIGN KEY (status_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.hold_until IS '보류를 다시 볼 날 — 보류(on_hold)일 때만 (0078 · 2026-11-21 뒤 공정 1차)';
COMMENT ON COLUMN public.projects.status_note IS '보류 · 그만둠 메모 (200자까지) — 서버가 적는다';
COMMENT ON COLUMN public.projects.status_at IS '상태를 마지막으로 바꾼 때 — 서버가 적는다';
COMMENT ON COLUMN public.projects.status_by IS '상태를 바꾼 사람 — 서버가 적는다';

-- 2) 프로젝트 일지 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    actor_user_id uuid,
    actor_kind text NOT NULL,
    type text NOT NULL,
    subject_type text,
    subject_id text,
    from_status text,
    to_status text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_events_pkey PRIMARY KEY (id),
    CONSTRAINT project_events_actor_check CHECK (actor_kind = ANY (ARRAY['member'::text, 'customer'::text, 'worker'::text, 'admin'::text, 'system'::text])),
    CONSTRAINT project_events_len_check CHECK ((length(type) BETWEEN 1 AND 40)
        AND (COALESCE(length(subject_type), 0) <= 30) AND (COALESCE(length(subject_id), 0) <= 80)
        AND (COALESCE(length(from_status), 0) <= 20) AND (COALESCE(length(to_status), 0) <= 20)),
    CONSTRAINT project_events_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text) AND (octet_length(payload::text) <= 2000)),
    CONSTRAINT project_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT project_events_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE,
    CONSTRAINT project_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_events IS '프로젝트 일지 — 누가 · 언제 · 무엇을 했나 (0078 · 2026-11-21 뒤 공정 1차). 추가만 한다. payload 에 이름 · 연락처 · 주소 · 금액 · 글을 넣지 않는다. 서버만 쓰고 읽는다';

CREATE INDEX IF NOT EXISTS idx_project_events_project ON public.project_events USING btree (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_events_company ON public.project_events USING btree (company_id, created_at DESC);

-- 고치기 막기 — 사람 칸(actor_user_id)이 지워져 비는 것(ON DELETE SET NULL)만 된다
CREATE OR REPLACE FUNCTION public.project_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.project_id, NEW.actor_kind, NEW.type, NEW.subject_type, NEW.subject_id,
      NEW.from_status, NEW.to_status, NEW.payload, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.project_id, OLD.actor_kind, OLD.type, OLD.subject_type, OLD.subject_id,
      OLD.from_status, OLD.to_status, OLD.payload, OLD.created_at)
     OR (NEW.actor_user_id IS NOT NULL AND NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id) THEN
    RAISE EXCEPTION 'project_events: 일지는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.project_events_guard() IS '프로젝트 일지 지킴이 — 내용은 바뀌지 않는다 (한 사람 칸이 지워져 비는 것만)';

REVOKE ALL ON FUNCTION public.project_events_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_project_events_guard ON public.project_events;
CREATE TRIGGER trg_project_events_guard BEFORE UPDATE ON public.project_events FOR EACH ROW EXECUTE FUNCTION public.project_events_guard();

ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.project_events TO service_role;

-- 3) 받은 일 읽음 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inbox_seen (
    user_id uuid NOT NULL,
    company_id uuid NOT NULL,
    seen_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbox_seen_pkey PRIMARY KEY (user_id, company_id),
    CONSTRAINT inbox_seen_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT inbox_seen_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.inbox_seen IS '받은 일(새로 생긴 일) 소식을 어디까지 봤나 — 사람 · 업체마다 한 줄 (0078 · 2026-11-21 뒤 공정 1차). seen_at 은 앞으로만 간다. 서버만 쓰고 읽는다';

-- 본 때는 앞으로만 — 옛 값을 보내면 지금 값을 지킨다 (여러 기기가 엇갈려 보내도 뒤로 가지 않게)
CREATE OR REPLACE FUNCTION public.inbox_seen_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.seen_at < OLD.seen_at THEN
    NEW.seen_at := OLD.seen_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.inbox_seen_guard() IS '받은 일 읽음 지킴이 — 본 때는 앞으로만 간다';

REVOKE ALL ON FUNCTION public.inbox_seen_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_inbox_seen_guard ON public.inbox_seen;
CREATE TRIGGER trg_inbox_seen_guard BEFORE UPDATE ON public.inbox_seen FOR EACH ROW EXECUTE FUNCTION public.inbox_seen_guard();

ALTER TABLE public.inbox_seen ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inbox_seen FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.inbox_seen TO service_role;
