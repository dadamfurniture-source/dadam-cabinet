-- =============================================
-- 0006 — 기존 표에 회사 · 프로젝트 칸
--
-- 칸 (기존 행은 모두 본사, 프로젝트는 비움)
--   designs        company_id (NOT NULL, 기본 본사) · project_id
--   orders         company_id (NOT NULL, 기본 본사) · project_id
--   consultations  company_id (NOT NULL, 기본 본사) · customer_id · project_id
--   generations    company_id (NOT NULL, 기본 본사) · project_id · origin (customer | company, 기본 customer)
--   work_jobs      company_id (NOT NULL, 기본 본사)
--   기본값 public.hq_company_id() 는 STABLE 이라 ADD COLUMN 때 한 번 계산하고 표를 다시 쓰지 않는다.
--
-- 같은 회사끼리만 잇는다 (복합 FK)
--   designs (project_id, company_id)        → projects (id, company_id)   ON DELETE SET NULL (project_id)
--   orders (design_id, company_id)          → designs (id, company_id)    ON DELETE RESTRICT
--   orders (project_id, company_id)         → projects (id, company_id)   ON DELETE RESTRICT
--   consultations (customer_id, company_id) → customers (id, company_id)  ON DELETE SET NULL (customer_id)
--   consultations (project_id, company_id)  → projects (id, company_id)   ON DELETE SET NULL (project_id)
--   generations (project_id, company_id)    → projects (id, company_id)   ON DELETE SET NULL (project_id)
--   그래서 projects · designs 에 UNIQUE (id, company_id) 를 더한다.
--
-- generations 는 authenticated 에 칸 단위로 SELECT 를 준다 — 새 칸 셋도 같이 준다 (값에 개인정보 없음).
-- 정책 · 트리거 · 함수는 바꾸지 않는다. 클라이언트가 넣는 행은 기본값으로 본사가 된다.
-- 다시 돌려도 된다 (ADD COLUMN IF NOT EXISTS · 제약은 DROP … IF EXISTS 다음 ADD · CREATE INDEX IF NOT EXISTS).
-- =============================================

-- 1) 칸 ----------------------------------------------------------------------

ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT public.hq_company_id();
ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS project_id uuid;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT public.hq_company_id();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS project_id uuid;

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT public.hq_company_id();
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS project_id uuid;

ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT public.hq_company_id();
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'customer'::text;

ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT public.hq_company_id();

-- 2) 제약 — 기대는 쪽부터 지우고 다시 만든다 ---------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_design_company_fkey;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_project_fkey;
ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_project_fkey;
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_customer_fkey;
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_project_fkey;
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_project_fkey;
ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_id_company_id_key;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_id_company_id_key;

ALTER TABLE public.projects ADD CONSTRAINT projects_id_company_id_key UNIQUE (id, company_id);
ALTER TABLE public.designs ADD CONSTRAINT designs_id_company_id_key UNIQUE (id, company_id);

ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_company_id_fkey;
ALTER TABLE public.designs ADD CONSTRAINT designs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_company_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_company_id_fkey;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_company_id_fkey;
ALTER TABLE public.generations ADD CONSTRAINT generations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);
ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_company_id_fkey;
ALTER TABLE public.work_jobs ADD CONSTRAINT work_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE public.designs ADD CONSTRAINT designs_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id);
ALTER TABLE public.orders ADD CONSTRAINT orders_design_company_fkey FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD CONSTRAINT orders_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_customer_fkey FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id) ON DELETE SET NULL (customer_id);
ALTER TABLE public.consultations ADD CONSTRAINT consultations_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id);
ALTER TABLE public.generations ADD CONSTRAINT generations_project_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id);

ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_origin_check;
ALTER TABLE public.generations ADD CONSTRAINT generations_origin_check CHECK (origin = ANY (ARRAY['customer'::text, 'company'::text]));

-- 3) 권한 --------------------------------------------------------------------

GRANT SELECT (company_id, project_id, origin) ON public.generations TO authenticated;

-- 4) 색인 --------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_designs_company ON public.designs USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_designs_project ON public.designs USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_company ON public.orders USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_project ON public.orders USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_consultations_company ON public.consultations USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_customer ON public.consultations USING btree (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_consultations_project ON public.consultations USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_generations_company ON public.generations USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_project ON public.generations USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_work_jobs_company ON public.work_jobs USING btree (company_id, created_at DESC);
