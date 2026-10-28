-- =============================================
-- 0009 — 간편 플래너 「시공 완료 확인」: 앱 전에 끝난 현장도 학습용으로
--
-- 학습용 내보내기(dataset_exportable)는 다담 자료(dadam_*)를 앱 수주(orders)가 시공 완료일 때만 내보낸다.
-- 그런데 앱 수주는 승인된 고객 확인서로만 생긴다 — 앱을 쓰기 전에 끝난 현장은 수주가 없어 영영 나갈 수 없었다.
-- 사장님 2026-10-28 「고치는 방법[추천] 진행」: 관리자가 간편 플래너에서 시공 완료로 표시한 설계도 내보낸다
-- (시공 완료 사진이 창고에 한 장 이상 있을 때만 표시된다).
--
--   planner_completions   간편 플래너 설계 묶음(group_key) 하나 = 한 줄. 쓰기는 dataset-api 워커(service_role)만 —
--                         관리자 토큰 · 창고의 시공 완료 사진을 확인한 뒤 (workers/dataset-api/src/planner.js).
--                         읽기는 관리자만. dataset_exportable 이 security_invoker 라 관리자 화면(admin/dataset.html)이
--                         셀 때 authenticated 에 SELECT 가 있어야 한다 (orders 와 같은 권한 모양 — anon 은 없음).
--   dataset_exportable    조건 하나를 더한다 — source 가 dadam_planner 이고 그 묶음이 planner_completions 에 있으면.
--                         다른 출처 · 다른 조건(검수 · 거절 · 생성 그림 · 고객 사진 동의)은 그대로다.
--                         열 · 차례는 그대로 (CREATE OR REPLACE VIEW 는 권한을 유지한다).
-- 다시 돌려도 된다.
-- =============================================

CREATE TABLE IF NOT EXISTS public.planner_completions (
  group_key        text PRIMARY KEY
                   CHECK (group_key ~ '^planner-lite:design:[A-Za-z0-9][A-Za-z0-9-]{3,80}$'),
  -- 표시할 때 창고에 있던 시공 완료 사진 수
  complete_photos  integer NOT NULL CHECK (complete_photos >= 1),
  -- 표시한 관리자 (auth.users id — 탈퇴해도 기록은 남긴다)
  confirmed_by     uuid NOT NULL,
  confirmed_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.planner_completions IS
  '간편 플래너 설계 중 관리자가 시공 완료로 확인한 것 (ERP 이전 현장). dataset_exportable 이 dadam_planner 를 내보내는 두 번째 근거. 쓰기는 dataset-api 워커만.';

ALTER TABLE public.planner_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planner_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.planner_completions TO authenticated;

DROP POLICY IF EXISTS planner_completions_admin_read ON public.planner_completions;
CREATE POLICY planner_completions_admin_read ON public.planner_completions
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

CREATE OR REPLACE VIEW public.dataset_exportable WITH (security_invoker='on') AS
SELECT sample_id,
    source,
    group_key,
    image_url,
    image_sha256,
    width,
    height,
    media,
    phase,
    space,
    furniture,
    layout_shape,
    attrs,
    label_source,
    confidence,
    needs_review,
    license,
    consent,
    src_table,
    src_id,
    src_updated_at,
    taxonomy_version,
    created_at,
    updated_at,
    design_id
   FROM public.dataset_samples
  WHERE ((needs_review = false) AND (COALESCE(((attrs ->> 'rejected'::text))::boolean, false) = false) AND (media <> 'generated'::text) AND ((license <> 'user-uploaded'::text) OR ((consent = true) AND (label_source = 'human'::text))) AND ((source <> ALL (ARRAY['dadam_collection'::text, 'dadam_generation'::text, 'dadam_planner'::text, 'dadam_design'::text])) OR (EXISTS ( SELECT 1
           FROM public.orders o
          WHERE ((o.design_id = dataset_samples.design_id) AND (o.status = 'completed'::text)))) OR ((source = 'dadam_planner'::text) AND (EXISTS ( SELECT 1
           FROM public.planner_completions pc
          WHERE (pc.group_key = dataset_samples.group_key))))));
