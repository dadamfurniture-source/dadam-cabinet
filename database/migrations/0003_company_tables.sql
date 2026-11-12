-- =============================================
-- 0003 — 회사 · 구성원 · 고객 · 프로젝트 표
--
-- 표 (모두 public, RLS 켬)
--   companies        회사. kind hq(본사, 하나뿐) | partner. 파트너는 plan expert | agent.
--                    status applied | meeting | active | held | suspended | closed. partner_id → partners(id) (파트너 목록 연결)
--   company_members  회사 구성원. role owner | manager | staff, status active | removed.
--                    한 사람은 한 회사에서만 active 일 수 있다 (user_id 부분 유니크 인덱스).
--   customers        회사별 고객. user_id 가 없을 수 있다 (회사가 이름 · 연락처로 넣은 고객).
--                    계정 연결은 고객이 초대 링크를 눌렀을 때만 한다 — 연락처가 같다고 잇지 않는다.
--   projects         회사 + 고객 (복합 FK (customer_id, company_id) → 고객은 같은 회사 것만).
--                    status active | closed | cancelled | handed_over. 넘기기: 옛 프로젝트를 닫고 받는 회사에
--                    새 프로젝트를 만든다 — 새 프로젝트의 origin_project_id 가 옛 프로젝트를 가리킨다 (한 번만).
--   company_events   회사 이력. 추가만 한다 (UPDATE · DELETE 권한 없음, service_role 포함). 개인정보를 넣지 않는다.
--
-- 함수 (SECURITY DEFINER · STABLE · search_path = public, PUBLIC 회수, EXECUTE 는 anon · authenticated · service_role)
--   hq_company_id()                        본사 회사 id
--   my_company_ids(p_roles text[] = NULL)  내가 active 구성원인 회사 id 들 (역할로 거르기)
--   is_company_member(p_company_id, p_roles = NULL)
--   my_customer_ids()                      내 계정과 연결된 고객 행 id 들
--   정책은 함수를 (SELECT …) 로 감싸 한 번만 부르게 한다.
--
-- 읽기 (RLS)
--   구성원: 자기 회사의 회사 · 구성원 · 고객 · 프로젝트 · 이력 행. 자기 구성원 행은 removed 여도 본다.
--   고객:   자기 고객 행과 그 프로젝트.
--   관리자(public.is_admin()): 모두 (아래 TODO 참고).
-- 쓰기: 지금은 관리자(authenticated + is_admin())와 service_role 만. 회사 스스로 쓰는 길은 나중에 연다.
--
-- 시드: 본사 회사 '다담가구' 하나. 본사 owner 구성원은 admin_roles 의 super_admin 계정 하나뿐일 때만 넣는다.
--   기존 expert · agent 회원을 회사로 바꾸지 않는다.
-- 기존 표에 company_id · project_id 칸을 더하지 않고, 기존 정책도 바꾸지 않는다.
-- 다시 돌려도 된다 (IF NOT EXISTS · OR REPLACE · DROP … IF EXISTS 다음 CREATE · 시드는 없을 때만).
-- =============================================

-- 1) 표 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    plan text,
    status text DEFAULT 'applied'::text NOT NULL,
    partner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT companies_pkey PRIMARY KEY (id),
    CONSTRAINT companies_kind_check CHECK (kind = ANY (ARRAY['hq'::text, 'partner'::text])),
    CONSTRAINT companies_plan_check CHECK (plan IS NULL OR (kind = 'partner'::text AND plan = ANY (ARRAY['expert'::text, 'agent'::text]))),
    CONSTRAINT companies_status_check CHECK (status = ANY (ARRAY['applied'::text, 'meeting'::text, 'active'::text, 'held'::text, 'suspended'::text, 'closed'::text])),
    CONSTRAINT companies_name_check CHECK (length(name) BETWEEN 1 AND 100),
    CONSTRAINT companies_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.company_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_members_pkey PRIMARY KEY (id),
    CONSTRAINT company_members_role_check CHECK (role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])),
    CONSTRAINT company_members_status_check CHECK (status = ANY (ARRAY['active'::text, 'removed'::text])),
    CONSTRAINT company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid,
    name text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_pkey PRIMARY KEY (id),
    CONSTRAINT customers_id_company_id_key UNIQUE (id, company_id),
    CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    title text,
    status text DEFAULT 'active'::text NOT NULL,
    origin_project_id uuid,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_pkey PRIMARY KEY (id),
    CONSTRAINT projects_status_check CHECK (status = ANY (ARRAY['active'::text, 'closed'::text, 'cancelled'::text, 'handed_over'::text])),
    CONSTRAINT projects_origin_check CHECK (origin_project_id IS NULL OR origin_project_id <> id),
    CONSTRAINT projects_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT projects_customer_fkey FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id),
    CONSTRAINT projects_origin_project_id_fkey FOREIGN KEY (origin_project_id) REFERENCES public.projects(id)
);

CREATE TABLE IF NOT EXISTS public.company_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    actor_user_id uuid,
    actor_kind text NOT NULL,
    type text NOT NULL,
    subject_type text,
    subject_id uuid,
    from_status text,
    to_status text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_events_pkey PRIMARY KEY (id),
    CONSTRAINT company_events_actor_check CHECK (actor_kind = ANY (ARRAY['member'::text, 'admin'::text, 'system'::text])),
    CONSTRAINT company_events_subject_check CHECK (subject_type IS NULL OR subject_type = ANY (ARRAY['company'::text, 'member'::text, 'customer'::text, 'project'::text])),
    CONSTRAINT company_events_len_check CHECK (length(type) BETWEEN 1 AND 40 AND coalesce(length(from_status), 0) <= 20 AND coalesce(length(to_status), 0) <= 20),
    CONSTRAINT company_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT company_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.companies IS '회사 — 본사(hq, 하나뿐)와 파트너(partner, plan expert | agent)';
COMMENT ON TABLE public.company_members IS '회사 구성원 (owner | manager | staff). 한 사람은 한 회사에서만 active';
COMMENT ON TABLE public.customers IS '회사별 고객. user_id 는 고객이 초대 링크를 눌렀을 때만 연결한다 — 연락처로 잇지 않는다';
COMMENT ON TABLE public.projects IS '회사의 고객 프로젝트. 넘기기는 옛 프로젝트를 닫고 받는 회사에 새로 만든다 (origin_project_id)';
COMMENT ON TABLE public.company_events IS '회사 이력. 추가만 한다. payload 에 이름 · 연락처 · 주소를 넣지 않는다';

-- 2) 인덱스 ------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS companies_one_hq ON public.companies USING btree (kind) WHERE (kind = 'hq'::text);
CREATE INDEX IF NOT EXISTS idx_companies_partner ON public.companies USING btree (partner_id) WHERE (partner_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS company_members_one_active_company ON public.company_members USING btree (user_id) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members USING btree (company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON public.customers USING btree (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_user ON public.customers USING btree (company_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customers_user ON public.customers USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_projects_company ON public.projects USING btree (company_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON public.projects USING btree (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_origin_once ON public.projects USING btree (origin_project_id) WHERE (origin_project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_company_events_company ON public.company_events USING btree (company_id, created_at DESC);

-- 3) updated_at --------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_companies_touch ON public.companies;
CREATE TRIGGER trg_companies_touch BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
DROP TRIGGER IF EXISTS trg_company_members_touch ON public.company_members;
CREATE TRIGGER trg_company_members_touch BEFORE UPDATE ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
DROP TRIGGER IF EXISTS trg_customers_touch ON public.customers;
CREATE TRIGGER trg_customers_touch BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
DROP TRIGGER IF EXISTS trg_projects_touch ON public.projects;
CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

-- 4) 함수 --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hq_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id FROM public.companies c WHERE c.kind = 'hq' LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_company_ids(p_roles text[] DEFAULT NULL::text[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.company_id
    FROM public.company_members m
   WHERE m.user_id = auth.uid()
     AND m.status = 'active'
     AND (p_roles IS NULL OR m.role = ANY (p_roles));
$function$;

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid, p_roles text[] DEFAULT NULL::text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.company_members m
     WHERE m.company_id = p_company_id
       AND m.user_id = auth.uid()
       AND m.status = 'active'
       AND (p_roles IS NULL OR m.role = ANY (p_roles))
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_customer_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id FROM public.customers c WHERE c.user_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.hq_company_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_company_ids(text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_company_member(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_customer_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hq_company_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_company_ids(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_customer_ids() TO anon, authenticated, service_role;

-- 5) RLS · 권한 --------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_events ENABLE ROW LEVEL SECURITY;

-- anon 은 아무 권한 없음. authenticated 는 정책으로 거른다. service_role 은 RLS 를 건너뛴다.
REVOKE ALL ON TABLE public.companies, public.company_members, public.customers, public.projects, public.company_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.companies, public.company_members, public.customers, public.projects TO authenticated;
GRANT SELECT, INSERT ON TABLE public.company_events TO authenticated;
-- 이력은 추가만: service_role 도 고치거나 지우지 못한다
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.company_events FROM service_role;

-- companies
DROP POLICY IF EXISTS companies_member_read ON public.companies;
CREATE POLICY companies_member_read ON public.companies
    FOR SELECT
    TO authenticated
    USING (id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS companies_admin_read ON public.companies;
CREATE POLICY companies_admin_read ON public.companies
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS companies_admin_insert ON public.companies;
CREATE POLICY companies_admin_insert ON public.companies
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS companies_admin_update ON public.companies;
CREATE POLICY companies_admin_update ON public.companies
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS companies_admin_delete ON public.companies;
CREATE POLICY companies_admin_delete ON public.companies
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

-- company_members
DROP POLICY IF EXISTS company_members_member_read ON public.company_members;
CREATE POLICY company_members_member_read ON public.company_members
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS company_members_own_read ON public.company_members;
CREATE POLICY company_members_own_read ON public.company_members
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS company_members_admin_read ON public.company_members;
CREATE POLICY company_members_admin_read ON public.company_members
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_members_admin_insert ON public.company_members;
CREATE POLICY company_members_admin_insert ON public.company_members
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_members_admin_update ON public.company_members;
CREATE POLICY company_members_admin_update ON public.company_members
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_members_admin_delete ON public.company_members;
CREATE POLICY company_members_admin_delete ON public.company_members
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

-- customers
DROP POLICY IF EXISTS customers_member_read ON public.customers;
CREATE POLICY customers_member_read ON public.customers
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS customers_self_read ON public.customers;
CREATE POLICY customers_self_read ON public.customers
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

-- TODO: 파트너 회사(kind = 'partner')의 고객 · 프로젝트는 관리자 읽기에서 빼야 한다.
--       파트너 회사가 실제 고객을 받기 전에 이 정책(과 projects_admin_read)을 본사 회사로 좁힌다.
DROP POLICY IF EXISTS customers_admin_read ON public.customers;
CREATE POLICY customers_admin_read ON public.customers
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS customers_admin_insert ON public.customers;
CREATE POLICY customers_admin_insert ON public.customers
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS customers_admin_update ON public.customers;
CREATE POLICY customers_admin_update ON public.customers
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS customers_admin_delete ON public.customers;
CREATE POLICY customers_admin_delete ON public.customers
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

-- projects
DROP POLICY IF EXISTS projects_member_read ON public.projects;
CREATE POLICY projects_member_read ON public.projects
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS projects_customer_read ON public.projects;
CREATE POLICY projects_customer_read ON public.projects
    FOR SELECT
    TO authenticated
    USING (customer_id IN (SELECT public.my_customer_ids()));

-- TODO: customers_admin_read 와 같이 — 파트너 회사 프로젝트는 관리자 읽기에서 뺀다 (파트너 회사가 실제 고객을 받기 전에).
DROP POLICY IF EXISTS projects_admin_read ON public.projects;
CREATE POLICY projects_admin_read ON public.projects
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS projects_admin_insert ON public.projects;
CREATE POLICY projects_admin_insert ON public.projects
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS projects_admin_update ON public.projects;
CREATE POLICY projects_admin_update ON public.projects
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS projects_admin_delete ON public.projects;
CREATE POLICY projects_admin_delete ON public.projects
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

-- company_events (추가만 — UPDATE · DELETE 정책 없음)
DROP POLICY IF EXISTS company_events_member_read ON public.company_events;
CREATE POLICY company_events_member_read ON public.company_events
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS company_events_admin_read ON public.company_events;
CREATE POLICY company_events_admin_read ON public.company_events
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS company_events_admin_insert ON public.company_events;
CREATE POLICY company_events_admin_insert ON public.company_events
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

-- 6) 시드 --------------------------------------------------------------------

INSERT INTO public.companies (kind, name, status)
SELECT 'hq', '다담가구', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.companies WHERE kind = 'hq');

-- 본사 owner: admin_roles 의 super_admin 이 정확히 한 명일 때 그 계정만. 이미 active 구성원이면 건너뛴다.
INSERT INTO public.company_members (company_id, user_id, role, status)
SELECT c.id, a.user_id, 'owner', 'active'
  FROM public.admin_roles a
  CROSS JOIN public.companies c
 WHERE c.kind = 'hq'
   AND a.role = 'super_admin'
   AND a.user_id IS NOT NULL
   AND (SELECT count(*) FROM public.admin_roles WHERE role = 'super_admin') = 1
   AND NOT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = a.user_id AND m.status = 'active');
