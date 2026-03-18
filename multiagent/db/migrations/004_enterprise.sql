-- ============================================================
-- Enterprise Features 마이그레이션
-- API Key 인증 + 브랜드 커스터마이징
-- ============================================================

-- ============================================================
-- 1. API Keys — Enterprise 프로그래밍 접근
-- ============================================================

CREATE TABLE public.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                -- "Production API Key"
  key_hash    TEXT NOT NULL UNIQUE,         -- SHA-256 hash of the actual key
  key_prefix  TEXT NOT NULL,                -- "dk_live_abc12..." (first 12 chars for display)
  scopes      TEXT[] DEFAULT '{"read","write"}', -- permissions
  is_active   BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,                 -- NULL = never expires
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON public.api_keys(key_prefix);

-- RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own API keys"
  ON public.api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own API keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own API keys"
  ON public.api_keys FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own API keys"
  ON public.api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 2. Brand Settings — 화이트라벨 커스터마이징
-- ============================================================

CREATE TABLE public.brand_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name    TEXT,                     -- 회사명 (견적서/도면 표시용)
  logo_url        TEXT,                     -- 로고 이미지 URL
  primary_color   TEXT DEFAULT '#2563eb',   -- 브랜드 메인 색상
  secondary_color TEXT DEFAULT '#1e293b',   -- 보조 색상
  footer_text     TEXT,                     -- 견적서 하단 문구
  contact_info    JSONB,                    -- { phone, email, address, website }
  watermark_text  TEXT,                     -- 도면 워터마크
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_brand_settings_user ON public.brand_settings(user_id);

-- RLS
ALTER TABLE public.brand_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brand settings"
  ON public.brand_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own brand settings"
  ON public.brand_settings FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. API Usage Logs — 사용량 추적
-- ============================================================

CREATE TABLE public.api_usage_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  endpoint    TEXT NOT NULL,
  method      TEXT NOT NULL,
  status_code INT,
  response_ms INT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_usage_key ON public.api_usage_logs(api_key_id);
CREATE INDEX idx_api_usage_user ON public.api_usage_logs(user_id);
CREATE INDEX idx_api_usage_created ON public.api_usage_logs(created_at);

-- RLS
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage logs"
  ON public.api_usage_logs FOR SELECT
  USING (auth.uid() = user_id);
