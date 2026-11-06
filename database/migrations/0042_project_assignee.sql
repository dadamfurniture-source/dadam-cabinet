-- =============================================
-- 0042 프로젝트 담당자 — 팩토리 안 담당자 칸 (2026-11-06 사장님 결정 · 작업 분배 묶음)
--
--   ① 담당자 칸을 여는 팩토리: Expert · Agent 모두 — Expert 는 대표 · 실장이 손으로 고르고,
--      Agent 는 비서가 추천 → 대표 · 실장 승인 (승인 카드 project_assign)
--   ② 담당자를 붙일 곳: 프로젝트에 한 명 — 그 프로젝트의 상담 · 설계 · 수주 · 수금 · 설치 · A/S 가 그 사람 몫
--   ③ 담당자가 될 수 있는 사람: 그 업체의 대표 · 실장 · 직원 모두 (지금 구성원 — company_members active)
--
-- 바꾸는 것:
--   1) projects 칸 셋 — assignee_id (담당자, auth.users) · assigned_at (담당자를 정하거나 바꾼 때, 트리거가 찍는다)
--      · assigned_by (정한 사람 — 서버가 적는다). 사람이 지워지면 비운다 (ON DELETE SET NULL).
--   2) 지킴이 트리거 — 담당자는 그 프로젝트 업체의 지금 구성원만 (아니면 23514). 담당자가 바뀔 때 assigned_at = now().
--      구성원이 나가도(removed) 이미 정한 담당자는 그대로 둔다 — 바꾸는 것은 사람이 한다.
--   3) 업체 · 담당자 색인 (진행 중 프로젝트 — 비서 추천의 「진행 중 담당 수」)
--   4) 승인 카드 종류에 project_assign (담당자 정하기 — 비서 추천, 대표 · 실장 승인)
--
-- 쓰기는 지금처럼 workflow-api(service_role)만 — 구성원 쓰기 정책은 더하지 않는다. 읽기 정책은 그대로.
-- =============================================

-- 1) 칸 -----------------------------------------------------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS assignee_id uuid;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS assigned_by uuid;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_assignee_id_fkey;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_assigned_by_fkey;
ALTER TABLE public.projects
    ADD CONSTRAINT projects_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.assignee_id IS '담당자 — 그 업체의 지금 구성원(대표 · 실장 · 직원) 한 명. 비우면 담당자 없음 (0042 · 2026-11-06 작업 분배 ①~③)';
COMMENT ON COLUMN public.projects.assigned_at IS '담당자를 정하거나 바꾼 때 — 트리거가 찍는다';
COMMENT ON COLUMN public.projects.assigned_by IS '담당자를 정한 사람 (서버가 적는다 — 손으로 고른 대표 · 실장, 또는 승인 카드를 승인한 사람)';

-- 2) 지킴이 --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projects_assignee_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.company_members m
        WHERE m.company_id = NEW.company_id AND m.user_id = NEW.assignee_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'projects: assignee must be an active member of the company' USING ERRCODE = '23514';
  END IF;
  NEW.assigned_at := now();
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.projects_assignee_guard() IS '프로젝트 담당자 지킴이 — 그 업체의 지금 구성원만, 바뀔 때 assigned_at 을 찍는다 (0042)';

REVOKE ALL ON FUNCTION public.projects_assignee_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_projects_assignee_guard ON public.projects;
CREATE TRIGGER trg_projects_assignee_guard BEFORE INSERT OR UPDATE OF assignee_id ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.projects_assignee_guard();

-- 3) 색인 ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_assignee ON public.projects USING btree (company_id, assignee_id)
    WHERE (assignee_id IS NOT NULL);

-- 4) 승인 카드 종류 -------------------------------------------------------------------
ALTER TABLE public.assistant_actions DROP CONSTRAINT IF EXISTS assistant_actions_kind_check;
ALTER TABLE public.assistant_actions
    ADD CONSTRAINT assistant_actions_kind_check CHECK (kind = ANY (ARRAY['consult_accept'::text, 'consult_decline'::text, 'order_status'::text, 'ledger_post'::text, 'project_create'::text, 'design_link'::text, 'payment_received'::text, 'cost_add'::text, 'project_assign'::text, 'draft'::text]));
