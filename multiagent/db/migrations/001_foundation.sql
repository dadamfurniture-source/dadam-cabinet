-- ============================================================
-- 다담 SaaS: Foundation Migration
-- Phase 1 - 제품본부 + 운영본부 + 경영지원 전체 스키마
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. 사용자 프로필 (Supabase Auth 확장)
-- ============================================================

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT,
  phone         TEXT,
  plan          TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'basic', 'pro', 'enterprise')),
  company_name  TEXT,
  company_type  TEXT CHECK (company_type IN ('individual', 'interior', 'factory', 'other')),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Auth 사용자 생성 시 자동 프로필 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. 제품본부 — AI 시뮬레이션 파이프라인
-- ============================================================

-- 프로젝트 (시뮬레이션 요청 단위)
CREATE TABLE public.projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  name          TEXT NOT NULL DEFAULT '새 프로젝트',
  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN (
                  'created', 'analyzing', 'designing', 'generating',
                  'quoting', 'completed', 'failed'
                )),
  category      TEXT NOT NULL
                CHECK (category IN (
                  'sink', 'island', 'closet', 'fridge_cabinet',
                  'shoe_cabinet', 'vanity', 'storage', 'utility_closet'
                )),
  style         TEXT CHECK (style IN (
                  'modern', 'nordic', 'classic', 'natural', 'industrial', 'luxury'
                )),
  budget        BIGINT,
  notes         TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 공간 분석 결과
CREATE TABLE public.space_analyses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  original_image_url TEXT NOT NULL,
  analysis_json     JSONB NOT NULL,        -- 전체 분석 결과
  walls             JSONB,                 -- 벽면 정보
  pipes             JSONB,                 -- 배관 정보
  obstacles         JSONB,                 -- 장애물 정보
  space_summary     TEXT,                  -- 공간 요약 텍스트
  confidence        REAL DEFAULT 0.0,      -- 분석 신뢰도
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 가구 배치 계획
CREATE TABLE public.layouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  space_analysis_id UUID REFERENCES public.space_analyses(id),
  layout_json       JSONB NOT NULL,        -- 전체 배치 데이터
  modules           JSONB NOT NULL,        -- 모듈 리스트
  upper_modules     JSONB,                 -- 상부장 모듈
  countertop        JSONB,                 -- 상판 정보
  total_width_mm    INT,
  total_height_mm   INT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 생성된 이미지
CREATE TABLE public.generated_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  layout_id     UUID REFERENCES public.layouts(id),
  image_url     TEXT NOT NULL,
  type          TEXT NOT NULL
                CHECK (type IN ('original', 'cleanup', 'furniture', 'correction', 'open', 'detail_design')),
  style         TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 견적
CREATE TABLE public.quotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  layout_id     UUID REFERENCES public.layouts(id),
  items_json    JSONB NOT NULL,            -- 견적 항목 상세
  subtotal      BIGINT NOT NULL DEFAULT 0, -- 소계
  installation_fee BIGINT DEFAULT 0,
  demolition_fee   BIGINT DEFAULT 0,
  tax_amount    BIGINT DEFAULT 0,          -- 부가세
  total_price   BIGINT NOT NULL DEFAULT 0, -- 총액
  margin_rate   REAL DEFAULT 0.3,
  price_range   JSONB,                     -- {"min": ..., "max": ...}
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 상세 설계 (Pro+)
CREATE TABLE public.detail_designs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  layout_id     UUID REFERENCES public.layouts(id),
  design_json   JSONB NOT NULL,            -- 설계도 데이터 (SVG 포함)
  drawings_url  TEXT,                      -- 설계도 파일 URL
  qa_report     JSONB,                     -- QA 검증 결과
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- BOM (Pro+)
CREATE TABLE public.bom_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detail_design_id UUID NOT NULL REFERENCES public.detail_designs(id) ON DELETE CASCADE,
  items_json      JSONB NOT NULL,          -- 자재 항목 리스트
  total_material_cost BIGINT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. 운영본부 — 주문 생명주기
-- ============================================================

-- 주문 (견적 확정 → 정산까지)
CREATE TABLE public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID REFERENCES public.projects(id),
  customer_id       UUID NOT NULL REFERENCES public.profiles(id),
  quote_id          UUID REFERENCES public.quotes(id),
  order_number      TEXT UNIQUE,           -- 주문번호 (자동생성)
  status            TEXT NOT NULL DEFAULT 'consulting'
                    CHECK (status IN (
                      'consulting', 'quoted', 'contracted', 'ordering',
                      'manufacturing', 'manufactured', 'installing',
                      'installed', 'as_received', 'as_completed', 'settled'
                    )),
  contract_amount   BIGINT,                -- 계약 금액 (원)
  contract_date     TIMESTAMPTZ,
  estimated_install TIMESTAMPTZ,           -- 예상 설치일
  actual_install    TIMESTAMPTZ,           -- 실제 설치일
  assigned_installer UUID,                 -- 설치 기사
  assigned_factory   UUID,                 -- 제작 공장
  delivery_address  TEXT,                  -- 배송/설치 주소
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 주문번호 자동생성 (ORD-2026-0001)
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq
  FROM public.orders
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());

  NEW.order_number := 'ORD-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION public.generate_order_number();

-- 주문 상태 이력
CREATE TABLE public.order_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT,                        -- agent명 또는 user UUID
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. 리소스 관리 (기사, 공장, 차량 등)
-- ============================================================

CREATE TABLE public.resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL
              CHECK (type IN ('installer', 'factory', 'vehicle', 'as_technician', 'consultant')),
  name        TEXT NOT NULL,
  capacity    INT DEFAULT 2,               -- 일일 최대 처리 건수
  phone       TEXT,
  email       TEXT,
  region      TEXT,                         -- 담당 지역
  specialties TEXT[],                       -- 전문 분야
  is_active   BOOLEAN DEFAULT true,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. 일정 관리
-- ============================================================

CREATE TABLE public.schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                CHECK (type IN (
                  'measurement', 'material_delivery', 'manufacturing_start',
                  'manufacturing_end', 'quality_check', 'delivery',
                  'installation', 'as_visit'
                )),
  title         TEXT NOT NULL,
  description   TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  duration_min  INT DEFAULT 60,
  assignee_id   UUID REFERENCES public.resources(id),
  location      TEXT,
  status        TEXT DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. 거래처 (공급업체, 공장 등)
-- ============================================================

CREATE TABLE public.vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL
                CHECK (type IN ('material_supplier', 'factory', 'logistics', 'installer')),
  business_number TEXT,                    -- 사업자등록번호
  representative  TEXT,                    -- 대표자명
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  bank_info     JSONB,                     -- {"bank": "...", "account": "...", "holder": "..."}
  payment_terms TEXT DEFAULT 'net30',      -- 결제조건
  is_active     BOOLEAN DEFAULT true,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. 매출매입 (경영지원)
-- ============================================================

-- 매출 전표
CREATE TABLE public.revenue_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  category        TEXT NOT NULL
                  CHECK (category IN ('contract_deposit', 'interim', 'balance', 'as_fee', 'other')),
  amount          BIGINT NOT NULL,         -- 공급가액
  tax_amount      BIGINT DEFAULT 0,        -- 부가세
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'invoiced', 'collected', 'overdue', 'cancelled')),
  due_date        DATE,                    -- 수금 예정일
  collected_date  DATE,                    -- 실제 수금일
  payment_method  TEXT CHECK (payment_method IN ('bank_transfer', 'card', 'cash')),
  invoice_number  TEXT,                    -- 세금계산서 번호
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 매입 전표
CREATE TABLE public.expense_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  vendor_id       UUID REFERENCES public.vendors(id),
  category        TEXT NOT NULL
                  CHECK (category IN ('material', 'manufacturing', 'logistics', 'installation', 'misc')),
  amount          BIGINT NOT NULL,         -- 공급가액
  tax_amount      BIGINT DEFAULT 0,        -- 부가세
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'paid', 'overdue', 'cancelled')),
  due_date        DATE,
  paid_date       DATE,
  po_number       TEXT,                    -- 발주번호 참조
  items_json      JSONB,                   -- 상세 품목
  invoice_number  TEXT,                    -- 세금계산서 번호
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 발주서
CREATE TABLE public.purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  vendor_id         UUID NOT NULL REFERENCES public.vendors(id),
  po_number         TEXT UNIQUE NOT NULL,
  type              TEXT NOT NULL
                    CHECK (type IN ('material', 'manufacturing', 'logistics')),
  items_json        JSONB NOT NULL,
  total_amount      BIGINT DEFAULT 0,
  status            TEXT DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled')),
  sent_at           TIMESTAMPTZ,
  expected_delivery DATE,
  actual_delivery   DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8. A/S 관리
-- ============================================================

CREATE TABLE public.after_service_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id),
  customer_id     UUID NOT NULL REFERENCES public.profiles(id),
  ticket_number   TEXT UNIQUE,             -- AS-2026-0001
  type            TEXT NOT NULL
                  CHECK (type IN ('defect', 'damage', 'adjustment', 'add_on')),
  priority        TEXT DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  description     TEXT NOT NULL,
  photos          TEXT[],                  -- 사진 URL 배열
  status          TEXT DEFAULT 'received'
                  CHECK (status IN ('received', 'assigned', 'in_progress', 'resolved', 'closed')),
  assigned_to     UUID REFERENCES public.resources(id),
  resolution      TEXT,
  cost            BIGINT DEFAULT 0,
  is_warranty     BOOLEAN DEFAULT true,
  warranty_expires DATE,
  scheduled_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- A/S 번호 자동생성
CREATE OR REPLACE FUNCTION public.generate_as_number()
RETURNS TRIGGER AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq
  FROM public.after_service_tickets
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());

  NEW.ticket_number := 'AS-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_as_number
  BEFORE INSERT ON public.after_service_tickets
  FOR EACH ROW
  WHEN (NEW.ticket_number IS NULL)
  EXECUTE FUNCTION public.generate_as_number();

-- ============================================================
-- 9. 알림
-- ============================================================

CREATE TABLE public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID,
  recipient_type  TEXT NOT NULL
                  CHECK (recipient_type IN ('customer', 'staff', 'vendor')),
  channel         TEXT NOT NULL
                  CHECK (channel IN ('kakao', 'sms', 'email', 'slack', 'in_app')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  related_order   UUID REFERENCES public.orders(id),
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'read')),
  sent_at         TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 10. 구독/결제
-- ============================================================

CREATE TABLE public.subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free'
                        CHECK (plan IN ('free', 'basic', 'pro', 'enterprise')),
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  status                TEXT DEFAULT 'active'
                        CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 11. 인덱스
-- ============================================================

-- 제품본부
CREATE INDEX idx_projects_user ON public.projects(user_id);
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_projects_category ON public.projects(category);
CREATE INDEX idx_space_analyses_project ON public.space_analyses(project_id);
CREATE INDEX idx_layouts_project ON public.layouts(project_id);
CREATE INDEX idx_generated_images_project ON public.generated_images(project_id);
CREATE INDEX idx_quotes_project ON public.quotes(project_id);

-- 운영본부
CREATE INDEX idx_orders_customer ON public.orders(customer_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_number ON public.orders(order_number);
CREATE INDEX idx_order_history_order ON public.order_status_history(order_id);
CREATE INDEX idx_schedules_order ON public.schedules(order_id);
CREATE INDEX idx_schedules_date ON public.schedules(scheduled_at);
CREATE INDEX idx_schedules_assignee ON public.schedules(assignee_id, scheduled_at);

-- 경영지원
CREATE INDEX idx_revenue_order ON public.revenue_entries(order_id);
CREATE INDEX idx_revenue_status ON public.revenue_entries(status);
CREATE INDEX idx_revenue_due ON public.revenue_entries(due_date) WHERE status IN ('pending', 'invoiced');
CREATE INDEX idx_expense_order ON public.expense_entries(order_id);
CREATE INDEX idx_expense_status ON public.expense_entries(status);
CREATE INDEX idx_expense_vendor ON public.expense_entries(vendor_id);
CREATE INDEX idx_po_order ON public.purchase_orders(order_id);
CREATE INDEX idx_po_vendor ON public.purchase_orders(vendor_id);
CREATE INDEX idx_as_order ON public.after_service_tickets(order_id);
CREATE INDEX idx_as_status ON public.after_service_tickets(status);
CREATE INDEX idx_notifications_recipient ON public.notifications(recipient_id, status);
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);

-- ============================================================
-- 12. RLS (Row Level Security)
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 프로필: 본인 것만 조회/수정
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 프로젝트: 본인 것만 CRUD
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY projects_update ON public.projects
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (auth.uid() = user_id);

-- 공간 분석: 프로젝트 소유자만
CREATE POLICY space_analyses_select ON public.space_analyses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- 배치: 프로젝트 소유자만
CREATE POLICY layouts_select ON public.layouts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- 이미지: 프로젝트 소유자만
CREATE POLICY images_select ON public.generated_images
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- 견적: 프로젝트 소유자만
CREATE POLICY quotes_select ON public.quotes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- 상세설계: 프로젝트 소유자만
CREATE POLICY designs_select ON public.detail_designs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
  );

-- BOM: 설계 소유자만
CREATE POLICY bom_select ON public.bom_lists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.detail_designs d
      JOIN public.projects p ON d.project_id = p.id
      WHERE d.id = detail_design_id AND p.user_id = auth.uid()
    )
  );

-- 주문: 고객 본인만
CREATE POLICY orders_select ON public.orders
  FOR SELECT USING (auth.uid() = customer_id);

-- 구독: 본인만
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- 알림: 수신자만
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (auth.uid() = recipient_id);
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- ============================================================
-- 13. Service Role용 정책 (서버 에이전트가 모든 데이터 접근)
-- ============================================================
-- Supabase service_role key는 RLS를 바이패스하므로 별도 정책 불필요
-- 에이전트는 service_role key로 접근

-- ============================================================
-- 14. updated_at 자동 갱신 트리거
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
