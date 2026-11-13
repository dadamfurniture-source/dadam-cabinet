-- =============================================
-- 0067 간편 플래너 — 설계가 모여 검토되는 길 (학습 묶음 · 저장 실패 · 신호 · 점검 기록 · 검토 등급 · 사진 제공 동의)
--
--   웹판 플래너의 설계는 planner_drafts(0046)에 저장되지만, 학습 자료(dataset_samples)로는 이어지지 않았고
--   저장 · 수집이 도는지 볼 기록도 없었다. 그 길에 필요한 표를 더한다. planner_drafts 는 건드리지 않는다
--   (지킴이가 고친 때를 올리고 rev 를 지킨다 — 학습 묶음은 따로 표에 둔다).
--
-- 바꾸는 것:
--   1) planner_draft_learn — 설계마다 학습 묶음 한 줄 (업체 · 설계 id). 플래너가 저장한 뒤 따로 보낸다.
--        bundle · bundle_sha256  묶음과 그 지문. rev 는 그 묶음을 낸 설계의 고친 차례 (뒤로 가지 않는다)
--        ingested_*              학습 자료로 수집한 지문 · rev · 때 · 마지막 오류 · 해 본 수
--        pending                 아직 수집 안 한 묶음인가 (수집한 지문 ≠ 지금 지문) — 수집이 이 칸으로 고른다
--        고친 때(updated_at)는 묶음이 바뀔 때만 찍힌다. 수집 표시만 바뀌면 그대로
--   2) planner_save_issues — 저장 · 묶음 · 사진이 안 된 것만 적는다 (된 것은 적지 않는다). 글은 없고 단계 · 코드 · 상태뿐.
--        서버가 30일 지난 줄을 지운다
--   3) planner_signals — 한 번에 채우기 · 제안을 받아들임 / 넘김 같은 화면 신호. 쌓기만
--   4) system_checks — 저장 · 학습 길 점검 기록 (매일 한 번 · 사람이 누른 것). 매일 점검은 날마다 한 줄뿐 (같은 날 두 번 넣기 = 23505)
--   5) dataset_reviews 에 등급(grade — good 양질 · normal 보통 · exclude 제외) · 까닭(reasons) · 본 rev(src_rev).
--        제외는 reject 일 때만, 양질에는 까닭이 없다. 넣으면 표본 attrs 에 grade · grade_reasons · reviewed_rev 가 적힌다
--        (있던 지킴이 apply_dataset_review 는 그대로 — 그 뒤에 도는 지킴이 하나를 더한다)
--   6) company_consents — 업체 동의 기록. 지금은 한 가지: planner_photo_learning (플래너에 올린 사진을 학습 자료로 제공).
--        쌓기만 한다 — 지금 값은 업체 · 종류마다 마지막 줄
--   7) 앱 알림 종류 하나 — system_check_failed (점검이 막힌 날). 0064 목록(23개) 그대로 + 하나 = 24개
--
-- 읽기 · 쓰기: 새 표 다섯은 service_role 만 (RLS 켬, 정책 없음). 누가 무엇을 보고 고치는지는 workflow-api · dataset-api 가 정한다.
-- 건드리지 않는 것: planner_drafts · planner_draft_photos · dataset_samples 의 칸과 제약, dataset_reviews 의 정책 · 있던 지킴이.
-- =============================================

-- 1) 학습 묶음 -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_draft_learn (
    company_id uuid NOT NULL,
    draft_id text NOT NULL,
    rev integer NOT NULL,
    bundle jsonb NOT NULL,
    bundle_sha256 text NOT NULL,
    sent_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingested_sha256 text,
    ingested_rev integer,
    ingested_at timestamp with time zone,
    ingest_error text,
    ingest_tries integer DEFAULT 0 NOT NULL,
    pending boolean GENERATED ALWAYS AS (ingested_sha256 IS DISTINCT FROM bundle_sha256) STORED,
    CONSTRAINT planner_draft_learn_pkey PRIMARY KEY (company_id, draft_id),
    CONSTRAINT planner_draft_learn_rev_check CHECK (rev >= 1),
    CONSTRAINT planner_draft_learn_bundle_check CHECK ((jsonb_typeof(bundle) = 'object'::text) AND (octet_length(bundle::text) <= 1048576)),
    CONSTRAINT planner_draft_learn_sha256_check CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'::text),
    CONSTRAINT planner_draft_learn_ingested_check CHECK (((ingested_sha256 IS NULL) AND (ingested_rev IS NULL) AND (ingested_at IS NULL)) OR ((ingested_sha256 ~ '^[0-9a-f]{64}$'::text) AND (ingested_rev >= 1) AND (ingested_rev <= rev) AND (ingested_at IS NOT NULL))),
    CONSTRAINT planner_draft_learn_error_check CHECK ((ingest_error IS NULL) OR (length(ingest_error) <= 300)),
    CONSTRAINT planner_draft_learn_tries_check CHECK ((ingest_tries >= 0) AND (ingest_tries <= 1000)),
    CONSTRAINT planner_draft_learn_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT planner_draft_learn_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_draft_learn IS '간편 플래너 웹판 학습 묶음 — 설계(planner_drafts)마다 한 줄, 저장과 따로 보낸다. pending = 아직 학습 자료로 수집 안 함. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_draft_learn_pending ON public.planner_draft_learn USING btree (updated_at) WHERE pending;

-- 지킴이 — 열쇠 · 만든 때는 그대로, rev 는 뒤로 가지 않는다, 묶음이 바뀌면 지문도 바뀐다,
--   고친 때는 묶음이 바뀔 때만 (수집 표시만 바뀌면 그대로), 묶음이 바뀌면 수집 오류 · 해 본 수를 처음으로
CREATE OR REPLACE FUNCTION public.planner_draft_learn_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.company_id, NEW.draft_id, NEW.created_at) IS DISTINCT FROM (OLD.company_id, OLD.draft_id, OLD.created_at) THEN
    RAISE EXCEPTION 'planner_draft_learn: 설계 열쇠 · 만든 때는 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  IF NEW.rev < OLD.rev THEN
    RAISE EXCEPTION 'planner_draft_learn: 고친 차례(rev)는 뒤로 가지 않는다 (% -> %)', OLD.rev, NEW.rev USING ERRCODE = '22023';
  END IF;
  IF NEW.bundle IS DISTINCT FROM OLD.bundle AND NEW.bundle_sha256 IS NOT DISTINCT FROM OLD.bundle_sha256 THEN
    RAISE EXCEPTION 'planner_draft_learn: 묶음이 바뀌면 지문도 바뀐다' USING ERRCODE = '22023';
  END IF;
  IF NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256 OR NEW.rev <> OLD.rev THEN
    NEW.updated_at := now();
    NEW.ingest_error := NULL;
    NEW.ingest_tries := 0;
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.planner_draft_learn_guard() IS '플래너 학습 묶음 지킴이 — 열쇠 그대로, rev 는 뒤로 안 감, 묶음이 바뀌면 지문도, 고친 때는 묶음이 바뀔 때만 (0067)';

REVOKE ALL ON FUNCTION public.planner_draft_learn_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_planner_draft_learn_guard ON public.planner_draft_learn;
CREATE TRIGGER trg_planner_draft_learn_guard BEFORE UPDATE ON public.planner_draft_learn FOR EACH ROW EXECUTE FUNCTION public.planner_draft_learn_guard();

ALTER TABLE public.planner_draft_learn ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_draft_learn FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_learn TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_learn FROM service_role;

-- 2) 저장 실패 기록 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_save_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    user_id uuid,
    draft_id text,
    source text NOT NULL,
    stage text NOT NULL,
    code text NOT NULL,
    status integer,
    rev integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_save_issues_pkey PRIMARY KEY (id),
    CONSTRAINT planner_save_issues_draft_id_check CHECK ((draft_id IS NULL) OR (draft_id ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}$'::text)),
    CONSTRAINT planner_save_issues_source_check CHECK (source = ANY (ARRAY['server'::text, 'client'::text])),
    CONSTRAINT planner_save_issues_stage_check CHECK (stage = ANY (ARRAY['save'::text, 'learn'::text, 'photo'::text, 'open'::text])),
    CONSTRAINT planner_save_issues_code_check CHECK (code ~ '^[a-z0-9_]{1,40}$'::text),
    CONSTRAINT planner_save_issues_status_check CHECK ((status IS NULL) OR ((status >= 100) AND (status <= 599))),
    CONSTRAINT planner_save_issues_rev_check CHECK ((rev IS NULL) OR (rev >= 0)),
    CONSTRAINT planner_save_issues_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT planner_save_issues_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_save_issues IS '간편 플래너 웹판 저장 실패 기록 — 안 된 것만 (단계 · 코드 · 상태, 글 없음). 서버가 30일 지난 줄을 지운다. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_save_issues_created ON public.planner_save_issues USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_save_issues_company_created ON public.planner_save_issues USING btree (company_id, created_at DESC) WHERE (company_id IS NOT NULL);

ALTER TABLE public.planner_save_issues ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_save_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.planner_save_issues TO service_role;
REVOKE UPDATE, TRUNCATE ON TABLE public.planner_save_issues FROM service_role;

-- 3) 화면 신호 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid,
    draft_id text,
    kind text NOT NULL,
    item text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planner_signals_pkey PRIMARY KEY (id),
    CONSTRAINT planner_signals_draft_id_check CHECK ((draft_id IS NULL) OR (draft_id ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}$'::text)),
    CONSTRAINT planner_signals_kind_check CHECK (kind = ANY (ARRAY['fill_all'::text, 'suggest_shown'::text, 'suggest_accepted'::text, 'suggest_skipped'::text])),
    CONSTRAINT planner_signals_item_check CHECK ((item IS NULL) OR (item ~ '^[a-z_]{1,40}$'::text)),
    CONSTRAINT planner_signals_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text) AND (octet_length(payload::text) <= 8192)),
    CONSTRAINT planner_signals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT planner_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_signals IS '간편 플래너 웹판 화면 신호 — 한 번에 채우기 · 제안 받아들임 / 넘김. 쌓기만. service_role 만';

CREATE INDEX IF NOT EXISTS idx_planner_signals_kind_created ON public.planner_signals USING btree (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_signals_company_created ON public.planner_signals USING btree (company_id, created_at DESC);

ALTER TABLE public.planner_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.planner_signals TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.planner_signals FROM service_role;

-- 4) 점검 기록 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    cause text NOT NULL,
    run_date date NOT NULL,
    ok boolean NOT NULL,
    steps jsonb NOT NULL,
    run_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_checks_pkey PRIMARY KEY (id),
    CONSTRAINT system_checks_kind_check CHECK (kind = ANY (ARRAY['planner_learning'::text])),
    CONSTRAINT system_checks_cause_check CHECK (cause = ANY (ARRAY['daily'::text, 'manual'::text])),
    CONSTRAINT system_checks_steps_check CHECK ((jsonb_typeof(steps) = 'array'::text) AND (octet_length(steps::text) <= 16384)),
    CONSTRAINT system_checks_run_by_check CHECK ((cause = 'manual'::text) OR (run_by IS NULL)),
    CONSTRAINT system_checks_run_by_fkey FOREIGN KEY (run_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_checks IS '시스템 점검 기록 — 간편 플래너 저장 · 학습 길 (매일 한 번 · 사람이 누른 것). 매일 점검은 날마다 한 줄. 쌓기만. service_role 만';

-- 매일 점검은 종류 · 날마다 한 줄 — 크론이 같은 날 두 번 돌아도 둘째는 23505 (알림도 한 번)
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_checks_daily ON public.system_checks USING btree (kind, run_date) WHERE (cause = 'daily'::text);
CREATE INDEX IF NOT EXISTS idx_system_checks_kind_created ON public.system_checks USING btree (kind, created_at DESC);

ALTER TABLE public.system_checks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.system_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.system_checks TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.system_checks FROM service_role;

-- 5) 검토 등급 ------------------------------------------------------------------------
ALTER TABLE public.dataset_reviews ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE public.dataset_reviews ADD COLUMN IF NOT EXISTS reasons text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.dataset_reviews ADD COLUMN IF NOT EXISTS src_rev integer;

COMMENT ON COLUMN public.dataset_reviews.grade IS '검토 등급 — good 양질 · normal 보통 · exclude 제외 (제외는 verdict reject 일 때만). 없으면 등급 없는 옛 검수';
COMMENT ON COLUMN public.dataset_reviews.reasons IS '보통 · 제외의 까닭 — dimension 치수 이상 · incomplete 구성 미완성 · photo_blur 사진 흐림 · test 시험 설계';
COMMENT ON COLUMN public.dataset_reviews.src_rev IS '검토할 때 본 원본의 고친 차례 (플래너 설계 rev)';

ALTER TABLE public.dataset_reviews DROP CONSTRAINT IF EXISTS dataset_reviews_grade_check;
ALTER TABLE public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_grade_check CHECK ((grade IS NULL) OR ((grade = ANY (ARRAY['good'::text, 'normal'::text, 'exclude'::text])) AND ((grade = 'exclude'::text) = (verdict = 'reject'::text))));
ALTER TABLE public.dataset_reviews DROP CONSTRAINT IF EXISTS dataset_reviews_reasons_check;
ALTER TABLE public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_reasons_check CHECK ((reasons <@ ARRAY['dimension'::text, 'incomplete'::text, 'photo_blur'::text, 'test'::text]) AND ((cardinality(reasons) = 0) OR (grade = ANY (ARRAY['normal'::text, 'exclude'::text]))));
ALTER TABLE public.dataset_reviews DROP CONSTRAINT IF EXISTS dataset_reviews_src_rev_check;
ALTER TABLE public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_src_rev_check CHECK ((src_rev IS NULL) OR (src_rev >= 1));

-- 등급을 표본에 적는다 — 있던 지킴이(on_dataset_review_insert → apply_dataset_review) 뒤에 돈다 (이름 차례)
CREATE OR REPLACE FUNCTION public.apply_dataset_review_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.grade IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.dataset_samples
     SET attrs = attrs || jsonb_build_object('grade', NEW.grade, 'grade_reasons', to_jsonb(NEW.reasons), 'reviewed_rev', NEW.src_rev)
   WHERE sample_id = NEW.sample_id;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.apply_dataset_review_grade() IS '검토 등급을 표본 attrs 에 적는다 — grade · grade_reasons · reviewed_rev (0067)';

REVOKE ALL ON FUNCTION public.apply_dataset_review_grade() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS on_dataset_review_insert_grade ON public.dataset_reviews;
CREATE TRIGGER on_dataset_review_insert_grade AFTER INSERT ON public.dataset_reviews FOR EACH ROW EXECUTE FUNCTION public.apply_dataset_review_grade();

-- 6) 업체 동의 기록 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    kind text NOT NULL,
    granted boolean NOT NULL,
    terms_version text NOT NULL,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_consents_pkey PRIMARY KEY (id),
    CONSTRAINT company_consents_kind_check CHECK (kind = ANY (ARRAY['planner_photo_learning'::text])),
    CONSTRAINT company_consents_terms_version_check CHECK (terms_version ~ '^[0-9A-Za-z._-]{1,40}$'::text),
    CONSTRAINT company_consents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT company_consents_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_consents IS '업체 동의 기록 — planner_photo_learning (플래너에 올린 사진을 학습 자료로 제공). 쌓기만, 지금 값은 업체 · 종류마다 마지막 줄. service_role 만';

CREATE INDEX IF NOT EXISTS idx_company_consents_company_kind_created ON public.company_consents USING btree (company_id, kind, created_at DESC);

ALTER TABLE public.company_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.company_consents TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.company_consents FROM service_role;

-- 7) 앱 알림 종류 — 0064 목록(23개) 그대로 + 점검이 막힌 날 하나 = 24개 --------------------

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_kind_check CHECK (kind = ANY (ARRAY['order_request'::text, 'order_request_decided'::text, 'confirmation_decided'::text, 'partner_application'::text, 'billing_failed'::text, 'company_suspended'::text, 'consult_assigned'::text, 'work_invited'::text, 'work_registration'::text, 'work_assigned'::text, 'work_schedule'::text, 'ledger_pending'::text, 'ledger_returned'::text, 'assistant_brief'::text, 'ledger_notice'::text, 'as_request'::text, 'production_recommended'::text, 'production_offered'::text, 'production_answered'::text, 'production_cancelled'::text, 'work_link_request'::text, 'work_reply'::text, 'work_report'::text, 'system_check_failed'::text]));
