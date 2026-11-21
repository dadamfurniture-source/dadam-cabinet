-- =============================================
-- 0079 프로젝트 방문(실측) 일정 · 설치 날 고객 확인 (2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 2차 — 「차례대로」)
--
--   대표님이 정한 것 (2026-11-21):
--     · 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」 — 실측은 상담 다음 · 설계 앞 단계다.
--       차례(실측 일정 잡기 → 실측 완료 처리 → 설계 시작)는 서버의 「다음 할 일」 판정이 지킨다
--       (workflow-api src/pipeline.js). 이 파일은 그 일정을 담을 자리만 만든다.
--
-- 바꾸는 것:
--   1) project_visits — 프로젝트에 붙는 방문 일정. 지금 종류는 실측(measure) 하나.
--        일정 표(design_schedules)는 설계에 붙어 있어(design_id NOT NULL) 설계 전에는 일정을 넣을 수 없다.
--        그래서 설계가 없어도 프로젝트에 바로 붙는 표를 따로 둔다.
--        status       scheduled 예정 · done 끝 · cancelled 취소 (새 방문은 예정으로만, 끝 · 취소는 예정에서만 — 지킴이)
--        scheduled_at 가는 때
--        assignee_id  갈 사람 (구성원) · assignee_name 갈 사람 글 (50자까지 — 구성원이 아닌 사람)
--        note         메모 (200자까지)
--        done_at · done_by · cancelled_at  끝 · 취소한 때와 사람 (때는 지킴이가 찍는다)
--      예정인 방문은 프로젝트 · 종류마다 하나 (부분 유니크 색인). 끝난 뒤에는 다시 잡을 수 있다(재실측).
--      끝났거나 취소한 방문은 바뀌지 않는다 (사람 칸이 지워져 비는 것만). 날짜를 바꾸는 것은 예정일 때만.
--      프로젝트와 같은 업체의 줄만 ((project_id, company_id) 복합 FK). 프로젝트가 지워지면 같이 지워진다.
--      서버(service_role)만 쓰고 읽는다 — 화면은 워커를 거쳐 본다 (프로젝트 일지 0078 과 같은 결).
--   2) design_schedules — 고객이 그 날짜를 확인했다는 표시 칸 둘 (설치 일정에 쓴다)
--        customer_confirmed_at  확인을 표시한 때 · customer_confirmed_by  표시한 사람
--      전화로 확인한 것을 업체가 표시한다. 날짜를 바꾸면 서버가 표시를 지운다 (확인한 날짜가 아니게 되므로).
--
-- 읽기 · 쓰기: 새 표는 정책이 없다 — anon · authenticated 는 읽지도 쓰지도 못한다.
--   design_schedules 의 읽기 정책 · 권한은 그대로다 (구성원은 읽기만 — 쓰는 정책이 없다).
-- 이미 있는 줄은 바뀌지 않는다 (새 칸은 모두 비어 있다).
-- =============================================

-- 1) 프로젝트 방문 일정 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind text DEFAULT 'measure'::text NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    assignee_id uuid,
    assignee_name text,
    note text,
    done_at timestamp with time zone,
    done_by uuid,
    cancelled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_visits_pkey PRIMARY KEY (id),
    CONSTRAINT project_visits_kind_check CHECK (kind = ANY (ARRAY['measure'::text])),
    CONSTRAINT project_visits_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'done'::text, 'cancelled'::text])),
    CONSTRAINT project_visits_len_check CHECK ((COALESCE(length(assignee_name), 0) <= 50) AND (COALESCE(length(note), 0) <= 200)),
    CONSTRAINT project_visits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT project_visits_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE,
    CONSTRAINT project_visits_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT project_visits_done_by_fkey FOREIGN KEY (done_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT project_visits_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.project_visits IS '프로젝트에 붙는 방문 일정 — 실측 (0079 · 2026-11-21 뒤 공정 2차). 설계 전에도 잡는다. 예정인 방문은 프로젝트 · 종류마다 하나. 서버만 쓰고 읽는다';

-- 예정인 방문은 프로젝트 · 종류마다 하나
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_visits_open ON public.project_visits USING btree (project_id, kind) WHERE (status = 'scheduled'::text);
CREATE INDEX IF NOT EXISTS idx_project_visits_company_time ON public.project_visits USING btree (company_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_project_visits_project ON public.project_visits USING btree (project_id, created_at);

-- 지킴이 — 새 방문은 예정으로만 · 끝/취소는 예정에서만 · 끝났거나 취소한 방문은 그대로 · 때는 여기서 찍는다
CREATE OR REPLACE FUNCTION public.project_visits_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'scheduled' THEN
      RAISE EXCEPTION 'project_visits: 새 방문은 예정으로만 넣습니다' USING ERRCODE = '22023';
    END IF;
    NEW.done_at := NULL;
    NEW.done_by := NULL;
    NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.company_id, NEW.project_id, NEW.kind, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.project_id, OLD.kind, OLD.created_at) THEN
    RAISE EXCEPTION 'project_visits: 어느 프로젝트의 어떤 방문인지는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;

  IF OLD.status <> 'scheduled' THEN
    -- 끝났거나 취소한 방문 — 사람 칸이 지워져 비는 것(ON DELETE SET NULL)만 된다
    IF (NEW.status, NEW.scheduled_at, NEW.assignee_name, NEW.note, NEW.done_at, NEW.cancelled_at)
       IS DISTINCT FROM (OLD.status, OLD.scheduled_at, OLD.assignee_name, OLD.note, OLD.done_at, OLD.cancelled_at)
       OR (NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
       OR (NEW.done_by IS NOT NULL AND NEW.done_by IS DISTINCT FROM OLD.done_by)
       OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
      RAISE EXCEPTION 'project_visits: 끝났거나 취소한 방문은 바꿀 수 없습니다' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' THEN
    NEW.done_at := now();
    NEW.cancelled_at := NULL;
  ELSIF NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    NEW.done_at := NULL;
    NEW.done_by := NULL;
  ELSE
    NEW.done_at := NULL;
    NEW.done_by := NULL;
    NEW.cancelled_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.project_visits_guard() IS '프로젝트 방문 지킴이 — 새 방문은 예정으로만, 끝 · 취소는 예정에서만, 끝났거나 취소한 방문은 바뀌지 않는다';

REVOKE ALL ON FUNCTION public.project_visits_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_project_visits_guard ON public.project_visits;
CREATE TRIGGER trg_project_visits_guard BEFORE INSERT OR UPDATE ON public.project_visits FOR EACH ROW EXECUTE FUNCTION public.project_visits_guard();

ALTER TABLE public.project_visits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_visits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_visits TO service_role;

-- 2) 설치 날 고객 확인 ----------------------------------------------------------------
ALTER TABLE public.design_schedules
    ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS customer_confirmed_by uuid;

ALTER TABLE public.design_schedules DROP CONSTRAINT IF EXISTS design_schedules_customer_confirmed_by_fkey;
ALTER TABLE public.design_schedules
    ADD CONSTRAINT design_schedules_customer_confirmed_by_fkey FOREIGN KEY (customer_confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.design_schedules DROP CONSTRAINT IF EXISTS design_schedules_customer_confirmed_check;
ALTER TABLE public.design_schedules
    ADD CONSTRAINT design_schedules_customer_confirmed_check CHECK ((customer_confirmed_by IS NULL) OR (customer_confirmed_at IS NOT NULL));

COMMENT ON COLUMN public.design_schedules.customer_confirmed_at IS '고객이 이 날짜를 확인했다고 표시한 때 — 업체가 표시한다 (0079 · 2026-11-21 뒤 공정 2차). 날짜를 바꾸면 서버가 지운다';
COMMENT ON COLUMN public.design_schedules.customer_confirmed_by IS '고객 확인을 표시한 사람 — 서버가 적는다';
