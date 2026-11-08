-- =============================================
-- 0050 — Manager 업체 제작 의뢰 (다담 본사 추천 → Manager 가 고름 → 팩토리가 24시간 안에 받기)
--
--   2026-11-08 사장님 결정: Manager 등급(인테리어 업체)의 제작 의뢰는 다담 본사로 왔다가, 본사가 상담 내용을 파악한 뒤
--   추천하는 업체(팩토리) 가운데 Manager 가 선택할 수 있도록 한다.
--   흐름: Manager 대표 · 실장이 설계(간편 플래너 설계 · 앱 설계, 프로젝트가 있으면 같이)로 의뢰 → 본사(관리자)가 검토해
--         팩토리 1~N 곳을 추천 → Manager 가 한 곳을 고름 → 그 팩토리 대표 · 실장이 24시간 안에 받기 · 못 받음
--         → 받으면 팩토리 쪽 프로젝트 · 설계 사본과 잇는다. 못 받음 · 답 없음이면 본사가 다시 추천한다.
--
-- 바꾸는 것:
--   1) production_requests — 의뢰 한 번 = 한 줄. company_id = 의뢰한 Manager 업체.
--        설계        draft_id(간편 플래너 설계 — planner_drafts (company_id, id), draft_rev = 의뢰 때 고친 차례) ·
--                    design_id(앱 설계) 중 하나 이상, project_id(있으면). 모두 같은 업체 것만 (복합 FK).
--                    의뢰가 걸린 설계 · 프로젝트는 지울 수 없다 (RESTRICT). 같은 설계로 열린 의뢰는 하나뿐.
--        item · note · sido · gugun · wanted_done_date  품목 키 · 요청 메모 · 현장 지역 · 시공 완료 희망 날짜 (추천 점수에 쓴다)
--        status      submitted 접수 → recommending 본사 검토 중 → recommended 추천 도착 → chosen 팩토리 답 기다림
--                    → accepted 받음 | declined 못 받음 | expired 24시간 답 없음.
--                    declined · expired 는 본사가 다시 추천한다 (→ recommended). accepted 전에는 언제든 cancelled (Manager 가 거둠).
--                    accepted · cancelled 는 끝.
--        round       추천 차례 (0 = 아직 추천 없음, 추천할 때마다 커진다)
--        hq_note     본사가 Manager 에게 남기는 말 (추천할 때)
--        factory_company_id  고른 팩토리 (chosen · accepted · declined · expired 일 때만, 다시 추천 · 거두면 비운다)
--        factory_project_id · factory_draft_id  받은 팩토리 쪽 새 프로젝트 · 간편 플래너 설계 사본 (accepted 만)
--        status_at   상태 · 차례가 마지막으로 바뀐 때 (트리거가 찍는다)
--   2) production_recommendations — 본사 추천 한 곳 = 한 줄 (차례 round · 순서 rank · 본사가 적는 짧은 소개 note).
--        chosen      Manager 가 고른 줄 — chosen_at · expires_at(고른 때 + 24시간)은 트리거가 찍는다
--                    (24시간 = workflow-api distribution/rules.js ASSIGNMENT_TTL_HOURS, 상담 배정과 같다)
--        response    팩토리 답 accepted | declined | expired | cancelled(답 전에 의뢰를 거둠 · 고르기가 엇갈림) — 고른 줄만, 한 번.
--                    responded_at 은 트리거가 찍는다. 못 받음 사유 reason 은 declined 만 (1~500자)
--        한 의뢰에 답을 기다리는 줄은 하나뿐. 새 추천은 의뢰의 지금 차례보다 뒤 차례로만 넣는다.
--   3) 지킴이 트리거 둘 — 만든 칸은 그대로, 상태는 정해진 차례로만, 때는 트리거가 찍는다
--   4) 앱 알림 종류 셋 — production_recommended(Manager 대표 · 실장: 추천 도착) · production_offered(팩토리 대표 · 실장: 새 의뢰) ·
--      production_answered(Manager 대표 · 실장: 팩토리가 받음 · 못 받음 · 답 없음). 0045 목록 + 셋.
--      본사(관리자)에는 회사 Slack 으로 알린다 (본사 업체는 구성원이 없어 앱 알림을 받을 기기가 없다 — 0017).
--
-- 바꾸지 않는 것
--   projects.status handed_over · origin_project_id (0003 넘기기) — Manager 는 고객 프로젝트를 그대로 들고 있고,
--   한 프로젝트에서 의뢰가 여럿 나갈 수 있어(origin 은 한 번만) 쓰지 않는다. 잇기는 이 표의 factory_project_id 로.
--
-- 읽기 · 쓰기: 둘 다 service_role 만 (RLS 켬, 정책 없음) — 누가 무엇을 보는지는 workflow-api 가 정한다
--   (Manager 는 자기 업체 의뢰와 추천 팩토리 이름 · 지역 · 소개만, 팩토리는 자기에게 온 의뢰만, 본사는 모두 + 추천 점수).
-- 지우기 없음. 0048 · 0049 (열린 PR) 의 객체를 쓰지 않는다. 다시 돌려도 된다.
-- =============================================

-- 1) 의뢰 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    draft_id text,
    draft_rev integer,
    design_id uuid,
    project_id uuid,
    item text,
    note text,
    sido text,
    gugun text,
    wanted_done_date date,
    status text DEFAULT 'submitted'::text NOT NULL,
    round integer DEFAULT 0 NOT NULL,
    hq_note text,
    factory_company_id uuid,
    factory_project_id uuid,
    factory_draft_id text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_requests_pkey PRIMARY KEY (id),
    CONSTRAINT production_requests_status_check CHECK (status = ANY (ARRAY['submitted'::text, 'recommending'::text, 'recommended'::text, 'chosen'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text])),
    CONSTRAINT production_requests_design_ref_check CHECK ((draft_id IS NOT NULL) OR (design_id IS NOT NULL)),
    CONSTRAINT production_requests_draft_rev_check CHECK (((draft_id IS NULL) = (draft_rev IS NULL)) AND (draft_rev IS NULL OR draft_rev >= 1)),
    CONSTRAINT production_requests_item_check CHECK (item IS NULL OR item ~ '^[a-z_]{1,40}$'::text),
    CONSTRAINT production_requests_text_check CHECK ((note IS NULL OR length(note) BETWEEN 1 AND 1000) AND (hq_note IS NULL OR length(hq_note) BETWEEN 1 AND 500)),
    CONSTRAINT production_requests_region_check CHECK ((sido IS NULL OR length(sido) BETWEEN 1 AND 20) AND (gugun IS NULL OR (sido IS NOT NULL AND length(gugun) BETWEEN 1 AND 40))),
    CONSTRAINT production_requests_round_check CHECK ((round >= 0) AND (status = 'cancelled'::text OR ((status = ANY (ARRAY['submitted'::text, 'recommending'::text])) = (round = 0)))),
    CONSTRAINT production_requests_factory_check CHECK (((status = ANY (ARRAY['chosen'::text, 'accepted'::text, 'declined'::text, 'expired'::text])) = (factory_company_id IS NOT NULL))
        AND (factory_project_id IS NULL OR status = 'accepted'::text)
        AND (factory_draft_id IS NULL OR status = 'accepted'::text)),
    CONSTRAINT production_requests_factory_draft_check CHECK (factory_draft_id IS NULL OR factory_draft_id ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}$'::text),
    CONSTRAINT production_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT production_requests_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT production_requests_design_fkey FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT production_requests_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT production_requests_factory_company_fkey FOREIGN KEY (factory_company_id) REFERENCES public.companies(id),
    CONSTRAINT production_requests_factory_project_fkey FOREIGN KEY (factory_project_id, factory_company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT production_requests_factory_draft_fkey FOREIGN KEY (factory_company_id, factory_draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT production_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.production_requests IS 'Manager 업체 제작 의뢰 — 본사 추천 → Manager 고름 → 팩토리 24시간 안에 받기 (2026-11-08 사장님 결정). 상태 submitted → recommending → recommended → chosen → accepted | declined | expired (declined · expired → recommended), accepted 전 cancelled. 쓰기는 service_role 만, 지우지 않는다';
COMMENT ON COLUMN public.production_requests.company_id IS '의뢰한 Manager 업체';
COMMENT ON COLUMN public.production_requests.round IS '추천 차례 — 0 은 아직 추천 없음. 추천할 때마다 커지고, 화면은 이 차례의 추천만 보인다';
COMMENT ON COLUMN public.production_requests.factory_company_id IS '고른 팩토리 — chosen · accepted · declined · expired 일 때만 (다시 추천 · 거두면 비운다)';
COMMENT ON COLUMN public.production_requests.factory_project_id IS '받은 팩토리 쪽 새 프로젝트 (고객 = 의뢰한 Manager 업체). accepted 만';
COMMENT ON COLUMN public.production_requests.factory_draft_id IS '받은 팩토리 쪽 간편 플래너 설계 사본 id. accepted 만, 한 번';

CREATE INDEX IF NOT EXISTS idx_production_requests_company ON public.production_requests USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_requests_status ON public.production_requests USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_requests_factory ON public.production_requests USING btree (factory_company_id, status) WHERE (factory_company_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS production_requests_one_open_draft ON public.production_requests USING btree (company_id, draft_id)
    WHERE ((draft_id IS NOT NULL) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS production_requests_one_open_design ON public.production_requests USING btree (design_id)
    WHERE ((design_id IS NOT NULL) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])));

-- 지킴이 — 의뢰 내용은 그대로, 상태는 정해진 차례로만, 차례는 추천할 때만 커진다, 고른 팩토리 · 받은 프로젝트 · 설계 사본은 그때만
CREATE OR REPLACE FUNCTION public.production_requests_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.draft_id, NEW.draft_rev, NEW.design_id, NEW.project_id, NEW.item, NEW.note,
      NEW.sido, NEW.gugun, NEW.wanted_done_date, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.draft_id, OLD.draft_rev, OLD.design_id, OLD.project_id, OLD.item, OLD.note,
      OLD.sido, OLD.gugun, OLD.wanted_done_date, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'production_requests: 의뢰 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF OLD.status IN ('accepted', 'cancelled') THEN
    -- 끝난 의뢰 — 받은 팩토리의 설계 사본을 한 번 적는 것만 된다
    IF (NEW.status, NEW.round, NEW.hq_note, NEW.factory_company_id, NEW.factory_project_id, NEW.status_at)
       IS DISTINCT FROM (OLD.status, OLD.round, OLD.hq_note, OLD.factory_company_id, OLD.factory_project_id, OLD.status_at)
       OR (NEW.factory_draft_id IS DISTINCT FROM OLD.factory_draft_id
           AND NOT (OLD.status = 'accepted' AND OLD.factory_draft_id IS NULL)) THEN
      RAISE EXCEPTION 'production_requests: 끝난 의뢰는 바뀌지 않습니다' USING ERRCODE = '22023';
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN
      NEW.updated_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'submitted' AND NEW.status IN ('recommending', 'recommended', 'cancelled'))
            OR (OLD.status = 'recommending' AND NEW.status IN ('recommended', 'cancelled'))
            OR (OLD.status = 'recommended' AND NEW.status IN ('chosen', 'cancelled'))
            OR (OLD.status = 'chosen' AND NEW.status IN ('accepted', 'declined', 'expired', 'cancelled'))
            OR (OLD.status IN ('declined', 'expired') AND NEW.status IN ('recommended', 'cancelled'))) THEN
      RAISE EXCEPTION 'production_requests: % -> % 는 안 됩니다', OLD.status, NEW.status USING ERRCODE = '22023';
    END IF;
    NEW.status_at := now();
  END IF;
  IF NEW.round IS DISTINCT FROM OLD.round OR NEW.hq_note IS DISTINCT FROM OLD.hq_note THEN
    -- 추천(다시 추천)할 때만 — 차례가 커지고 상태는 recommended
    IF NOT (NEW.round > OLD.round AND NEW.status = 'recommended') THEN
      RAISE EXCEPTION 'production_requests: 추천 차례 · 본사 말은 추천할 때만 바뀝니다' USING ERRCODE = '22023';
    END IF;
    NEW.status_at := now();
  END IF;
  IF NEW.factory_company_id IS DISTINCT FROM OLD.factory_company_id
     AND NOT ((OLD.status = 'recommended' AND NEW.status = 'chosen' AND NEW.factory_company_id IS NOT NULL)
              OR (NEW.factory_company_id IS NULL AND NEW.status IN ('recommended', 'cancelled'))) THEN
    RAISE EXCEPTION 'production_requests: 고른 팩토리는 고를 때만 정합니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.factory_project_id IS DISTINCT FROM OLD.factory_project_id
     AND NOT (OLD.status = 'chosen' AND NEW.status = 'accepted') THEN
    RAISE EXCEPTION 'production_requests: 팩토리 프로젝트는 받을 때만 잇습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.factory_draft_id IS DISTINCT FROM OLD.factory_draft_id
     AND NOT (OLD.status = 'chosen' AND NEW.status = 'accepted') THEN
    RAISE EXCEPTION 'production_requests: 설계 사본은 받은 뒤 한 번만 적습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.production_requests_guard() IS '제작 의뢰 지킴이 — 의뢰 내용 그대로, 상태 차례(submitted → recommending → recommended → chosen → accepted | declined | expired, declined · expired → recommended, accepted 전 cancelled), 차례는 추천 때만, 상태 바뀐 때를 찍는다 (0050)';

REVOKE ALL ON FUNCTION public.production_requests_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_production_requests_guard ON public.production_requests;
CREATE TRIGGER trg_production_requests_guard BEFORE UPDATE ON public.production_requests FOR EACH ROW EXECUTE FUNCTION public.production_requests_guard();

-- 2) 본사 추천 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    company_id uuid NOT NULL,
    round integer NOT NULL,
    rank integer NOT NULL,
    note text,
    chosen boolean DEFAULT false NOT NULL,
    chosen_at timestamp with time zone,
    expires_at timestamp with time zone,
    response text,
    reason text,
    responded_by uuid,
    responded_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_recommendations_pkey PRIMARY KEY (id),
    CONSTRAINT production_recommendations_round_check CHECK ((round >= 1) AND (rank BETWEEN 1 AND 10)),
    CONSTRAINT production_recommendations_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
    CONSTRAINT production_recommendations_chosen_check CHECK ((chosen = (chosen_at IS NOT NULL)) AND (chosen = (expires_at IS NOT NULL)) AND (expires_at IS NULL OR expires_at > chosen_at)),
    CONSTRAINT production_recommendations_response_check CHECK ((response IS NULL OR (chosen AND response = ANY (ARRAY['accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text])))
        AND ((response IS NULL) = (responded_at IS NULL))),
    CONSTRAINT production_recommendations_reason_check CHECK (reason IS NULL OR (response = 'declined'::text AND length(reason) BETWEEN 1 AND 500)),
    CONSTRAINT production_recommendations_request_fkey FOREIGN KEY (request_id) REFERENCES public.production_requests(id) ON DELETE CASCADE,
    CONSTRAINT production_recommendations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT production_recommendations_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT production_recommendations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.production_recommendations IS '제작 의뢰 본사 추천 — 한 곳 한 줄 (차례 · 순서 · 짧은 소개). Manager 가 고른 줄만 팩토리 답(받음 · 못 받음 · 답 없음 · 거둠)을 받는다. 한 의뢰에 답을 기다리는 줄은 하나. 쓰기는 service_role 만';
COMMENT ON COLUMN public.production_recommendations.note IS '본사가 적는 이 팩토리의 짧은 소개 (Manager 화면에 보인다, 200자)';
COMMENT ON COLUMN public.production_recommendations.expires_at IS '팩토리가 답할 기한 = 고른 때 + 24시간 (트리거가 찍는다 — workflow-api ASSIGNMENT_TTL_HOURS 와 같다)';

CREATE UNIQUE INDEX IF NOT EXISTS production_recommendations_round_company ON public.production_recommendations USING btree (request_id, round, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS production_recommendations_round_rank ON public.production_recommendations USING btree (request_id, round, rank);
CREATE UNIQUE INDEX IF NOT EXISTS production_recommendations_one_open ON public.production_recommendations USING btree (request_id) WHERE (chosen AND (response IS NULL));
CREATE INDEX IF NOT EXISTS idx_production_recommendations_company ON public.production_recommendations USING btree (company_id, chosen_at DESC) WHERE chosen;
CREATE INDEX IF NOT EXISTS idx_production_recommendations_open ON public.production_recommendations USING btree (expires_at) WHERE (chosen AND (response IS NULL));

-- 지킴이 — 새 추천은 의뢰의 다음 차례로만 · 고르기 · 답 없이, 추천 내용은 그대로, 고르기 · 답은 한 번, 때는 여기서 찍는다
CREATE OR REPLACE FUNCTION public.production_recommendations_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_round integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.round INTO v_round FROM public.production_requests r WHERE r.id = NEW.request_id;
    IF v_round IS NULL OR NEW.round <= v_round THEN
      RAISE EXCEPTION 'production_recommendations: 새 추천은 의뢰의 다음 차례로만 넣습니다' USING ERRCODE = '22023';
    END IF;
    IF NEW.chosen OR NEW.response IS NOT NULL OR NEW.reason IS NOT NULL OR NEW.responded_by IS NOT NULL THEN
      RAISE EXCEPTION 'production_recommendations: 새 추천은 고르기 · 답 없이 넣습니다' USING ERRCODE = '22023';
    END IF;
    NEW.chosen_at := NULL;
    NEW.expires_at := NULL;
    NEW.responded_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.request_id, NEW.company_id, NEW.round, NEW.rank, NEW.note, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.company_id, OLD.round, OLD.rank, OLD.note, OLD.created_at)
     OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by)
     OR (NEW.responded_by IS NOT NULL AND NEW.responded_by IS DISTINCT FROM OLD.responded_by
         AND NEW.response IS NOT DISTINCT FROM OLD.response) THEN
    RAISE EXCEPTION 'production_recommendations: 추천 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.chosen IS DISTINCT FROM OLD.chosen THEN
    IF OLD.chosen THEN
      RAISE EXCEPTION 'production_recommendations: 고른 줄은 되돌릴 수 없습니다' USING ERRCODE = '22023';
    END IF;
    NEW.chosen_at := now();
    NEW.expires_at := now() + interval '24 hours';
  ELSIF (NEW.chosen_at, NEW.expires_at) IS DISTINCT FROM (OLD.chosen_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'production_recommendations: 고른 때 · 기한은 고를 때만 찍힌다' USING ERRCODE = '22023';
  END IF;
  IF NEW.response IS DISTINCT FROM OLD.response THEN
    IF OLD.response IS NOT NULL THEN
      RAISE EXCEPTION 'production_recommendations: 팩토리 답은 한 번만 적습니다' USING ERRCODE = '22023';
    END IF;
    NEW.responded_at := now();
  ELSIF NEW.responded_at IS DISTINCT FROM OLD.responded_at OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'production_recommendations: 답한 때 · 사유는 답할 때만 적습니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.production_recommendations_guard() IS '제작 의뢰 추천 지킴이 — 새 추천은 의뢰의 다음 차례로만 · 고르기 · 답 없이, 추천 내용 그대로, 고르기 · 답은 한 번, 고른 때 · 기한(+24시간) · 답한 때는 여기서 찍는다 (0050)';

REVOKE ALL ON FUNCTION public.production_recommendations_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_production_recommendations_guard ON public.production_recommendations;
CREATE TRIGGER trg_production_recommendations_guard BEFORE INSERT OR UPDATE ON public.production_recommendations FOR EACH ROW EXECUTE FUNCTION public.production_recommendations_guard();

-- 3) 권한 — 둘 다 서버만 (정책 없음), 지우기 없음 -------------------------------------------
ALTER TABLE public.production_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_recommendations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.production_recommendations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.production_requests TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.production_recommendations TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.production_requests FROM service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.production_recommendations FROM service_role;

-- 4) 앱 알림 종류 — 제작 의뢰 셋 (0045 목록 + production_recommended · production_offered · production_answered) ---------
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text]));
