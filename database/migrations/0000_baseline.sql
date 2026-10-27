-- ============================================================
-- 0000_baseline.sql — DB 번호 마이그레이션의 출발점 (기준선)
--
-- 찍은 날: 2026-10-27 (라이브 DB, PostgreSQL 17.6)
-- 만든 도구: node scripts/db-dump-schema.mjs --baseline
--
-- 이 파일은 찍은 날의 스키마를 그대로 다시 만든다 (스키마만 · 행 데이터 없음 · storage 버킷 정의는 담음).
-- 빈 Supabase 프로젝트(auth · storage 스키마가 이미 있는 상태)에 postgres 역할로 돌린다고 보고 쓴다.
-- 소유자(OWNER) 문은 없다. CRLF 로 저장된 함수 본문은 LF 로 적혀 있다.
--
-- 라이브 DB 에는 돌리지 않는다 — `node scripts/db-migrate.mjs --baseline-mark` 로 「적용됨」만 적는다.
-- 이후 DB 변경은 모두 database/migrations/ 의 다음 번호 파일로 한다 (database/migrations/README.md).
-- 적용됨으로 적은 뒤에는 고치지 않는다 (체크섬이 바뀌면 db-migrate 가 멈춘다).
-- ============================================================

SET check_function_bodies = false;
SET client_min_messages = warning;

-- ------------------------------------------------------------
-- 확장
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions; -- 1.11
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; -- 1.3
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault; -- 0.3.1
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; -- 1.1
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public; -- 0.8.0

-- ------------------------------------------------------------
-- 시퀀스
-- ------------------------------------------------------------

CREATE SEQUENCE public.dadam_color_hex_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.dadam_fridge_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.dadam_material_formulas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.dadam_rules_numeric_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.dadam_search_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.dadam_triggers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.design_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 2147483647
    CACHE 1;
CREATE SEQUENCE public.document_access_log_id_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    CACHE 1;

-- ------------------------------------------------------------
-- 테이블
-- ------------------------------------------------------------

CREATE TABLE public.admin_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    admin_email text,
    action_type text NOT NULL,
    target_type text,
    target_id uuid,
    description text,
    old_value jsonb,
    new_value jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.admin_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    role text DEFAULT 'support'::text,
    permissions jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email text
);

CREATE TABLE public.appliance_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    brand text NOT NULL,
    model_name text NOT NULL,
    model_code text,
    width_mm integer,
    depth_mm integer,
    height_mm integer,
    capacity_l integer,
    verified boolean DEFAULT false,
    source_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    side_gap_mm integer,
    top_gap_mm integer,
    cutout_w_mm integer,
    cutout_d_mm integer,
    cutout_r_mm integer,
    faucet_hole_mm integer,
    subtype text,
    line text,
    install_type text,
    model_codes text[] DEFAULT '{}'::text[] NOT NULL,
    back_gap_mm integer,
    discontinued boolean DEFAULT false NOT NULL,
    collected_at timestamp with time zone,
    niche_min_w_mm integer,
    niche_min_h_mm integer,
    niche_min_d_mm integer,
    niche_max_w_mm integer,
    niche_max_h_mm integer,
    niche_max_d_mm integer,
    image_source_url text,
    image_path text,
    image_approved_at timestamp with time zone,
    image_approved_by uuid,
    gas_types text[]
);

CREATE TABLE public.cash_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    as_of date NOT NULL,
    amount bigint NOT NULL,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id text,
    role text NOT NULL,
    content text NOT NULL,
    page_source text DEFAULT 'ai-design'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.collection_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_user_id uuid,
    to_user_id uuid,
    post_id uuid NOT NULL,
    name text NOT NULL,
    contact text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.collection_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.collection_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    image_url text NOT NULL,
    storage_path text,
    title text DEFAULT ''::text,
    description text DEFAULT ''::text,
    category text DEFAULT 'kitchen'::text,
    region text DEFAULT ''::text,
    like_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    design_id uuid,
    item_unique_id bigint,
    consent_training boolean,
    source text DEFAULT 'upload'::text NOT NULL,
    generation_id uuid
);

CREATE TABLE public.consultations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text NOT NULL,
    phone text,
    consultation_type text,
    title text NOT NULL,
    description text,
    preferred_date date,
    preferred_time text,
    status text DEFAULT 'pending'::text,
    assigned_to uuid,
    admin_memo text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    furniture_categories text[] DEFAULT '{}'::text[],
    space_type text,
    space_width_mm integer,
    space_height_mm integer,
    space_depth_mm integer,
    budget_range text,
    style_preference text,
    request_detail_design boolean DEFAULT false,
    confirmed_at timestamp with time zone,
    privacy_agreed_at timestamp with time zone,
    generation_id uuid,
    quote jsonb,
    sido text,
    gugun text,
    consult_target text
);

CREATE TABLE public.counterparties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    category text,
    phone text,
    memo text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.credit_costs (
    action text NOT NULL,
    credits integer NOT NULL,
    label text,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.credit_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    delta integer NOT NULL,
    reason text NOT NULL,
    ref uuid,
    refunded boolean DEFAULT false NOT NULL,
    balance_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.credit_plans (
    tier text NOT NULL,
    monthly_credits integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.dadam_category_stats (
    category character varying(20) NOT NULL,
    chunk_count integer DEFAULT 0,
    trigger_count integer DEFAULT 0,
    last_indexed_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.dadam_chunks (
    id character varying(24) NOT NULL,
    content text NOT NULL,
    content_hash character varying(64) NOT NULL,
    category character varying(20) NOT NULL,
    chunk_type character varying(20) NOT NULL,
    phase character varying(20) NOT NULL,
    source_file character varying(255) NOT NULL,
    section_path text[] NOT NULL,
    triggers text[] NOT NULL,
    embedding public.vector(384),
    related_chunks text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    rule_type text DEFAULT 'module'::text
);

CREATE TABLE public.dadam_color_hex (
    id integer DEFAULT nextval('public.dadam_color_hex_id_seq'::regclass) NOT NULL,
    code text NOT NULL,
    hex text NOT NULL,
    rgb_r integer,
    rgb_g integer,
    rgb_b integer,
    name text,
    finish text,
    render_prompt text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.dadam_fridge_models (
    id integer DEFAULT nextval('public.dadam_fridge_models_id_seq'::regclass) NOT NULL,
    brand character varying(20) NOT NULL,
    line character varying(50) NOT NULL,
    category_name character varying(100),
    model_id character varying(50) NOT NULL,
    model_name character varying(100) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    depth integer NOT NULL,
    type character varying(20) NOT NULL,
    side_gap integer DEFAULT 0,
    between_gap integer DEFAULT 0,
    units jsonb,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.dadam_material_formulas (
    id integer DEFAULT nextval('public.dadam_material_formulas_id_seq'::regclass) NOT NULL,
    cabinet_type character varying(50) NOT NULL,
    part_name character varying(50) NOT NULL,
    formula_width text NOT NULL,
    formula_height text NOT NULL,
    quantity integer DEFAULT 1,
    material_type character varying(50),
    edge_sides integer DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.dadam_rules_numeric (
    id integer DEFAULT nextval('public.dadam_rules_numeric_id_seq'::regclass) NOT NULL,
    category character varying(50) NOT NULL,
    rule_type character varying(50) NOT NULL,
    rule_name character varying(100) NOT NULL,
    rule_value jsonb NOT NULL,
    unit character varying(20),
    description text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.dadam_search_logs (
    id integer DEFAULT nextval('public.dadam_search_logs_id_seq'::regclass) NOT NULL,
    query text NOT NULL,
    inferred_category character varying(20),
    inferred_phase character varying(20),
    detected_triggers text[],
    result_chunk_ids text[],
    result_scores double precision[],
    user_feedback character varying(20),
    session_id character varying(64),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.dadam_triggers (
    id integer DEFAULT nextval('public.dadam_triggers_id_seq'::regclass) NOT NULL,
    trigger_keyword character varying(100) NOT NULL,
    chunk_ids text[] NOT NULL,
    category character varying(20),
    hit_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.dataset_ingest_state (
    src_table text NOT NULL,
    watermark timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    last_run timestamp with time zone,
    last_count integer,
    last_error text
);

CREATE TABLE public.dataset_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sample_id text NOT NULL,
    reviewer uuid NOT NULL,
    verdict text NOT NULL,
    media text,
    phase text,
    space text,
    furniture text,
    layout_shape text,
    pii_found boolean,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dataset_samples (
    sample_id text NOT NULL,
    source text NOT NULL,
    group_key text NOT NULL,
    image_url text,
    image_sha256 text,
    width integer,
    height integer,
    media text DEFAULT 'photo'::text NOT NULL,
    phase text DEFAULT 'after'::text NOT NULL,
    space text DEFAULT 'unknown'::text NOT NULL,
    furniture text DEFAULT 'unknown'::text NOT NULL,
    layout_shape text DEFAULT 'unknown'::text NOT NULL,
    attrs jsonb DEFAULT '{}'::jsonb NOT NULL,
    label_source text NOT NULL,
    confidence real,
    needs_review boolean DEFAULT false NOT NULL,
    license text NOT NULL,
    consent boolean,
    src_table text,
    src_id uuid,
    src_updated_at timestamp with time zone,
    taxonomy_version text DEFAULT '1.1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    design_id uuid
);

CREATE TABLE public.design_cad_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    content_hash text NOT NULL,
    assembly_hash text NOT NULL,
    kind text NOT NULL,
    path text NOT NULL,
    bytes bigint NOT NULL,
    sha256 text NOT NULL,
    generator_version text,
    rules_version text,
    parts integer,
    modules integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.design_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    doc_type text NOT NULL,
    rev integer NOT NULL,
    doc_no text NOT NULL,
    status text DEFAULT 'issued'::text NOT NULL,
    superseded_by uuid,
    title text NOT NULL,
    customer_name text,
    customer_name_masked text,
    render_payload jsonb NOT NULL,
    totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text NOT NULL,
    share_token_hash text,
    access_pin_hash text,
    pin_fail_count integer DEFAULT 0 NOT NULL,
    pin_locked_at timestamp with time zone,
    expires_at timestamp with time zone,
    first_viewed_at timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    decision text,
    decided_at timestamp with time zone,
    signer_name text,
    signer_ip_hash text,
    signer_user_agent text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.design_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid,
    item_id uuid,
    embedding_json jsonb,
    searchable_text text,
    embedding_model text DEFAULT 'text-embedding-ada-002'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.design_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid,
    user_id uuid,
    feedback_type text,
    was_modified boolean DEFAULT false,
    modification_reason text,
    accuracy_score integer,
    usability_score integer,
    feedback_text text,
    created_at timestamp with time zone DEFAULT now(),
    post_id uuid
);

CREATE TABLE public.design_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid,
    item_id uuid,
    storage_path text NOT NULL,
    original_filename text,
    file_size integer,
    mime_type text,
    image_type text DEFAULT 'site_photo'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.design_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid,
    category text NOT NULL,
    name text,
    unique_id bigint,
    width integer,
    height integer,
    depth integer,
    specs jsonb DEFAULT '{}'::jsonb,
    modules jsonb DEFAULT '[]'::jsonb,
    customer_notes text,
    item_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.design_renders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    item_unique_id bigint NOT NULL,
    kind text NOT NULL,
    module_id text,
    path text NOT NULL,
    width integer,
    height integer,
    camera jsonb,
    detail_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.design_rules (
    id integer DEFAULT nextval('public.design_rules_id_seq'::regclass) NOT NULL,
    category character varying(50) NOT NULL,
    rule_type character varying(50) NOT NULL,
    trigger character varying(100) NOT NULL,
    content text NOT NULL,
    value_min numeric,
    value_max numeric,
    value_target numeric,
    unit character varying(20),
    priority integer DEFAULT 0,
    is_active boolean DEFAULT true,
    source character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.design_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    document_id uuid,
    batch_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    scheduled_at timestamp with time zone NOT NULL,
    duration_min integer DEFAULT 60 NOT NULL,
    assignee_name text,
    location text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    planned_at timestamp with time zone
);

CREATE TABLE public.design_site_info (
    design_id uuid NOT NULL,
    address text,
    address_detail text,
    floor text,
    has_elevator boolean,
    elevator_note text,
    access_note text,
    install_order text,
    contact_name text,
    contact_phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.design_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    rev integer NOT NULL,
    content_hash text NOT NULL,
    created_by uuid,
    app_version text,
    design_title text,
    design_payload jsonb NOT NULL,
    bom_payload jsonb NOT NULL,
    hardware_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    quote_payload jsonb,
    pricing_rule_set_id uuid,
    item_count integer NOT NULL,
    module_count integer DEFAULT 0 NOT NULL,
    panel_count integer DEFAULT 0 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cut_plan_payload jsonb,
    sheet_count integer
);

CREATE TABLE public.designs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text,
    total_items integer DEFAULT 0,
    total_modules integer DEFAULT 0,
    estimated_price integer,
    final_price integer,
    customer_satisfaction integer,
    revision_count integer DEFAULT 0,
    app_version text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone,
    completed_at timestamp with time zone,
    generation_id uuid
);

CREATE TABLE public.document_access_log (
    id bigint DEFAULT nextval('public.document_access_log_id_seq'::regclass) NOT NULL,
    document_id uuid,
    event text NOT NULL,
    ip_hash text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.expert_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    request_reason text,
    company_name text,
    experience_years integer,
    status text DEFAULT 'pending'::text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.furniture_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    subcategory text,
    style text,
    material text,
    color_hex text,
    description text,
    image_url text NOT NULL,
    storage_path text NOT NULL,
    thumbnail_url text,
    embedding public.vector(512),
    tags text[] DEFAULT '{}'::text[],
    source text DEFAULT 'photo'::text,
    is_training boolean DEFAULT false,
    lora_model_id text,
    width_px integer,
    height_px integer,
    file_size_bytes integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.furniture_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    subcategory text,
    name_ko text NOT NULL,
    name_en text,
    color_hex text,
    image_storage_path text,
    image_public_url text,
    manufacturer text,
    product_code text,
    specs jsonb DEFAULT '{}'::jsonb,
    prompt_description text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    applicable_to text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    texture_url text
);

CREATE TABLE public.generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    step_label text,
    error text,
    category text NOT NULL,
    title text,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    wall_analysis jsonb,
    quote jsonb,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    model text,
    elapsed_ms integer,
    credit_ref uuid,
    credit_cost integer,
    credit_refunded boolean DEFAULT false NOT NULL,
    is_favorite boolean DEFAULT false NOT NULL,
    share_token_hash text,
    share_expires_at timestamp with time zone,
    share_revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    layout jsonb,
    consent_training boolean
);

CREATE TABLE public.genome_seed_panel (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    lines jsonb NOT NULL,
    summary text,
    genome_version integer DEFAULT 1 NOT NULL,
    source_design_id uuid,
    source_item_unique_id bigint,
    active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.install_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    score smallint,
    comment text,
    answered_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lora_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    model_id text NOT NULL,
    model_version text,
    trigger_word text NOT NULL,
    training_images_count integer,
    training_steps integer,
    training_cost_usd numeric(6,4),
    status text DEFAULT 'training'::text,
    replicate_training_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    color_name text NOT NULL,
    color_name_en text,
    color_hex text,
    finish text,
    texture_prompt text NOT NULL,
    thumbnail_url text,
    applicable_to text[] DEFAULT '{}'::text[],
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    code text,
    finish_code text,
    color_code text,
    tone text,
    slot text[],
    roughness numeric,
    metalness numeric,
    clearcoat numeric,
    texture_url text,
    normal_url text,
    tile_mm integer,
    grain text,
    price_key text,
    vendor_code text,
    sort integer,
    active boolean DEFAULT true,
    vendor text,
    series text,
    source_url text,
    image_url text
);

CREATE TABLE public.okrs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quarter text NOT NULL,
    objective text NOT NULL,
    metric text NOT NULL,
    target numeric NOT NULL,
    direction text DEFAULT 'up'::text NOT NULL,
    manual_value numeric,
    sort smallint DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.order_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    category text NOT NULL,
    description text,
    vendor_name text,
    amount bigint NOT NULL,
    spent_on date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    counterparty_id uuid,
    due_on date
);

CREATE TABLE public.order_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    stage text NOT NULL,
    amount bigint NOT NULL,
    due_on date,
    paid_on date,
    method text,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text NOT NULL,
    design_id uuid NOT NULL,
    document_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    customer_name text,
    contract_amount bigint NOT NULL,
    received_amount bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    ordered_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    completed_at timestamp with time zone,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    price_tier text,
    partner_id uuid
);

CREATE TABLE public.partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    description text,
    partner_type text NOT NULL,
    sido text NOT NULL,
    gugun text NOT NULL,
    address text,
    lat double precision,
    lng double precision,
    specialty_categories text[] DEFAULT '{}'::text[],
    specialty_styles text[] DEFAULT '{}'::text[],
    specialty_text text,
    portfolio_images jsonb DEFAULT '[]'::jsonb,
    logo_url text,
    phone text,
    email text,
    website text,
    kakao_id text,
    business_number text,
    established_year integer,
    employee_count text,
    rating numeric(2,1) DEFAULT 0,
    review_count integer DEFAULT 0,
    completed_projects integer DEFAULT 0,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text,
    payload jsonb NOT NULL,
    processed_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    subscription_id uuid,
    provider text NOT NULL,
    order_id text NOT NULL,
    payment_key text,
    plan text NOT NULL,
    amount_krw integer NOT NULL,
    tax_amount integer DEFAULT 0,
    status text NOT NULL,
    method text,
    receipt_url text,
    failure_code text,
    failure_message text,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    refunded_at timestamp with time zone,
    refunded_by uuid,
    refund_reason text,
    refund_override boolean DEFAULT false NOT NULL
);

CREATE TABLE public.planner_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid NOT NULL,
    item_unique_id bigint NOT NULL,
    stage text NOT NULL,
    name text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_autosave boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.pricing_rule_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    label text,
    is_active boolean DEFAULT false NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.pricing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_set_id uuid NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    grade text DEFAULT '*'::text NOT NULL,
    unit text DEFAULT 'per_1000mm'::text NOT NULL,
    amount numeric(14,4) NOT NULL,
    note text
);

CREATE TABLE public.production_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    proposal_id uuid,
    work_date date,
    kind text NOT NULL,
    role text,
    people integer,
    hours numeric(5,2),
    order_label text,
    text text NOT NULL,
    cost bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'instructed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    done_at timestamp with time zone
);

CREATE TABLE public.production_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    trigger text NOT NULL,
    trigger_order_id uuid,
    plan jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_at timestamp with time zone,
    slack_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.production_settings (
    user_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.production_worker_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.production_worklogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    link_id uuid,
    worker_label text,
    work_date date NOT NULL,
    role text NOT NULL,
    order_id uuid,
    order_label text,
    units numeric(8,2) NOT NULL,
    minutes numeric(8,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    name text,
    phone text,
    tier text DEFAULT 'standard'::text,
    sido text,
    gugun text,
    referral text,
    provider text,
    avatar_url text,
    company_name text,
    business_number text,
    admin_memo text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_sign_in_at timestamp with time zone,
    detaildesign_approved boolean DEFAULT false,
    detaildesign_requested_at timestamp with time zone,
    detaildesign_approved_at timestamp with time zone,
    detaildesign_approved_by uuid,
    tier_source text DEFAULT 'manual'::text NOT NULL,
    terms_agreed_at timestamp with time zone,
    privacy_agreed_at timestamp with time zone,
    age_confirmed_at timestamp with time zone,
    marketing_agreed_at timestamp with time zone,
    marketing_withdrawn_at timestamp with time zone
);

CREATE TABLE public.reference_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    subcategory text,
    storage_path text NOT NULL,
    original_filename text,
    ground_truth jsonb NOT NULL,
    name text NOT NULL,
    description text,
    visual_features text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rework_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    cause text NOT NULL,
    occurred_on date DEFAULT CURRENT_DATE NOT NULL,
    minutes integer,
    cost bigint,
    parts text,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sales_history (
    month date NOT NULL,
    revenue bigint NOT NULL,
    orders integer,
    memo text,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.saved_partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    context_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.slack_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_id uuid,
    batch_id uuid,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.styles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    mood_prompt text NOT NULL,
    door_color_name text,
    door_color_hex text,
    door_finish text,
    countertop_prompt text,
    handle_prompt text,
    accent_prompt text,
    thumbnail_url text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    plan text DEFAULT 'free'::text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    status text DEFAULT 'active'::text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    provider text DEFAULT 'stripe'::text NOT NULL,
    provider_customer_id text,
    provider_subscription_id text,
    billing_key text,
    next_charge_at timestamp with time zone,
    amount_krw integer,
    failed_attempts integer DEFAULT 0 NOT NULL,
    first_failed_at timestamp with time zone,
    cancel_reason text,
    ended_at timestamp with time zone,
    charge_lock_until timestamp with time zone,
    charge_order_id text
);

CREATE TABLE public.theme_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    theme text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    source text NOT NULL,
    title text,
    note text,
    origin_url text,
    preview_url text,
    download_url text,
    source_page text,
    author text,
    license text,
    storage_path text,
    thumb_path text,
    width integer,
    height integer,
    colorfulness real,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_credits (
    user_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    period_start timestamp with time zone DEFAULT now() NOT NULL,
    period_end timestamp with time zone DEFAULT (now() + '1 mon'::interval) NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    image_type character varying(20) NOT NULL,
    storage_path text NOT NULL,
    public_url text NOT NULL,
    file_name text,
    file_size_bytes integer,
    mime_type character varying(50) DEFAULT 'image/png'::character varying,
    design_id uuid,
    door_state character varying(10),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    email text,
    name text,
    phone text,
    role text DEFAULT 'customer'::text,
    upgraded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.work_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    message text,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    application_id uuid,
    via text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone,
    submitted_at timestamp with time zone,
    accepted_at timestamp with time zone,
    revision_count integer DEFAULT 0 NOT NULL,
    no_show boolean DEFAULT false NOT NULL,
    release_reason text,
    worker_name_snapshot text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_job_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    assignment_id uuid,
    actor_user_id uuid,
    actor_kind text NOT NULL,
    type text NOT NULL,
    from_status text,
    to_status text,
    note text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    title text NOT NULL,
    detail text,
    region_label text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    apply_deadline timestamp with time zone,
    slots integer DEFAULT 1 NOT NULL,
    mode text DEFAULT 'open'::text NOT NULL,
    pay_amount integer,
    pay_unit text,
    pay_visible boolean DEFAULT false NOT NULL,
    order_id uuid,
    design_id uuid,
    version integer DEFAULT 0 NOT NULL,
    cancel_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    update_id uuid,
    job_id uuid NOT NULL,
    assignment_id uuid,
    path text NOT NULL,
    bytes integer,
    width integer,
    height integer,
    uploaded_by uuid,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    period_start date,
    period_end date,
    status text,
    source_table text,
    source_id uuid,
    order_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    design_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    pinned boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    direction text NOT NULL,
    reviewer_id uuid,
    score integer,
    reason_chips text[] DEFAULT '{}'::text[] NOT NULL,
    comment text,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    reply text,
    objection text,
    objection_at timestamp with time zone,
    resolved_at timestamp with time zone,
    frozen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    assignment_id uuid,
    author_user_id uuid,
    author_role text NOT NULL,
    kind text NOT NULL,
    body text NOT NULL,
    issue_chips text[] DEFAULT '{}'::text[] NOT NULL,
    amends_id uuid,
    visible_to_worker boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.worker_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id uuid NOT NULL,
    actor_user_id uuid,
    actor_kind text NOT NULL,
    type text NOT NULL,
    from_status text,
    to_status text,
    note text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.worker_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    kinds_preset text[] DEFAULT '{}'::text[] NOT NULL,
    display_name_preset text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.worker_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id uuid NOT NULL,
    author uuid,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    display_name text NOT NULL,
    phone text,
    kinds text[] DEFAULT '{}'::text[] NOT NULL,
    region_label text,
    status text DEFAULT 'pending'::text NOT NULL,
    consent_version text NOT NULL,
    consent_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_consent boolean DEFAULT false NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    reject_reason text,
    invited_via uuid,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------
-- 시퀀스 소유 열
-- ------------------------------------------------------------

ALTER SEQUENCE public.dadam_color_hex_id_seq OWNED BY public.dadam_color_hex.id;
ALTER SEQUENCE public.dadam_fridge_models_id_seq OWNED BY public.dadam_fridge_models.id;
ALTER SEQUENCE public.dadam_material_formulas_id_seq OWNED BY public.dadam_material_formulas.id;
ALTER SEQUENCE public.dadam_rules_numeric_id_seq OWNED BY public.dadam_rules_numeric.id;
ALTER SEQUENCE public.dadam_search_logs_id_seq OWNED BY public.dadam_search_logs.id;
ALTER SEQUENCE public.dadam_triggers_id_seq OWNED BY public.dadam_triggers.id;
ALTER SEQUENCE public.design_rules_id_seq OWNED BY public.design_rules.id;
ALTER SEQUENCE public.document_access_log_id_seq OWNED BY public.document_access_log.id;

-- ------------------------------------------------------------
-- 함수 · 뷰 (의존 순서)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_dataset_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    s dataset_samples%ROWTYPE;
BEGIN
    SELECT * INTO s FROM dataset_samples WHERE sample_id = NEW.sample_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF NEW.verdict = 'reject' THEN
        UPDATE dataset_samples SET
            needs_review = FALSE,
            label_source = 'human',
            attrs = s.attrs || jsonb_build_object('rejected', TRUE, 'reject_note', COALESCE(NEW.note, ''), 'pii_found', COALESCE(NEW.pii_found, FALSE)),
            updated_at = now()
        WHERE sample_id = NEW.sample_id;
        RETURN NEW;
    END IF;

    UPDATE dataset_samples SET
        media        = COALESCE(NEW.media, s.media),
        phase        = COALESCE(NEW.phase, s.phase),
        space        = COALESCE(NEW.space, s.space),
        furniture    = COALESCE(NEW.furniture, s.furniture),
        layout_shape = COALESCE(NEW.layout_shape, s.layout_shape),
        label_source = 'human',
        confidence   = 1.0,
        needs_review = FALSE,
        attrs = CASE
                  WHEN s.attrs ? 'original' THEN s.attrs
                  ELSE s.attrs || jsonb_build_object('original', jsonb_build_object(
                         'media', s.media, 'phase', s.phase, 'space', s.space,
                         'furniture', s.furniture, 'layout_shape', s.layout_shape,
                         'label_source', s.label_source, 'confidence', s.confidence))
                END,
        updated_at = now()
    WHERE sample_id = NEW.sample_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_expert(request_id uuid, admin_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  target_user_id UUID;
BEGIN
  -- 요청 조회
  SELECT user_id INTO target_user_id
  FROM expert_requests
  WHERE id = request_id AND status = 'pending';

  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 사용자 역할 업데이트
  UPDATE user_profiles
  SET role = 'expert', upgraded_at = NOW(), updated_at = NOW()
  WHERE id = target_user_id;

  -- 요청 상태 업데이트
  UPDATE expert_requests
  SET status = 'approved', reviewed_by = admin_id, reviewed_at = NOW()
  WHERE id = request_id;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_self_dd_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF OLD.detaildesign_approved IS DISTINCT FROM NEW.detaildesign_approved THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'detaildesign_approved can only be changed by administrators';
        END IF;
    END IF;
    IF OLD.detaildesign_approved_at IS DISTINCT FROM NEW.detaildesign_approved_at
        OR OLD.detaildesign_approved_by IS DISTINCT FROM NEW.detaildesign_approved_by THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'detaildesign_approved_at / _by can only be changed by administrators';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_self_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier
     OR OLD.tier_source IS DISTINCT FROM NEW.tier_source THEN
    IF current_user <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'tier / tier_source 는 관리자 또는 결제 서비스만 변경할 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.collection_posts_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consultation_generation_ok(gid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT gid IS NULL
        OR EXISTS (SELECT 1 FROM public.generations g WHERE g.id = gid AND g.user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.consume_credit(p_reason text DEFAULT 'generate'::text)
 RETURNS TABLE(ref uuid, balance integer, cost integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_tier TEXT;
  v_grant INT;
  v_cost INT;
  v_ref UUID := gen_random_uuid();
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 등록되지 않은 동작은 기본 단가로 받는다. 0 이나 NULL 로 떨어뜨리면
  -- 오타 하나에 공짜 생성이 열린다.
  SELECT cc.credits INTO v_cost FROM credit_costs cc WHERE cc.action = p_reason;
  v_cost := COALESCE(v_cost, (SELECT cc.credits FROM credit_costs cc WHERE cc.action = 'generate'), 20);

  SELECT p.tier INTO v_tier FROM profiles p WHERE p.id = v_user;
  SELECT cp.monthly_credits INTO v_grant FROM credit_plans cp WHERE cp.tier = COALESCE(v_tier, 'standard');
  v_grant := COALESCE(v_grant, 0);

  INSERT INTO user_credits (user_id, balance, period_start, period_end)
  VALUES (v_user, v_grant, now(), now() + INTERVAL '1 month')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT uc.balance INTO v_balance FROM user_credits uc WHERE uc.user_id = v_user FOR UPDATE;

  IF (SELECT uc.period_end FROM user_credits uc WHERE uc.user_id = v_user) <= now() THEN
    UPDATE user_credits uc
      SET balance = v_grant, period_start = now(), period_end = now() + INTERVAL '1 month', updated_at = now()
      WHERE uc.user_id = v_user;
    v_balance := v_grant;
    INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
    VALUES (v_user, v_grant, 'plan_reset', v_grant);
  END IF;

  -- 남은 게 단가보다 적으면 못 쓴다. 0 보다 큰지가 아니라 단가와 견준다 —
  -- 안 그러면 5 크레딧 남은 사람이 20짜리 생성을 하고 잔액이 음수가 된다.
  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credit';
  END IF;

  UPDATE user_credits uc
    SET balance = uc.balance - v_cost, updated_at = now()
    WHERE uc.user_id = v_user
    RETURNING uc.balance INTO v_balance;

  INSERT INTO credit_ledger (user_id, delta, reason, ref, balance_after)
  VALUES (v_user, -v_cost, p_reason, v_ref, v_balance);

  RETURN QUERY SELECT v_ref, v_balance, v_cost;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dsched_track_times()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.planned_at IS NULL THEN NEW.planned_at := NEW.scheduled_at; END IF;
    IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    RETURN NEW;
  END IF;
  -- 처음 잡은 날은 바뀌지 않는다
  NEW.planned_at := COALESCE(OLD.planned_at, OLD.scheduled_at);
  IF NEW.status = 'completed' THEN
    IF OLD.status IS DISTINCT FROM 'completed' OR NEW.completed_at IS NULL THEN
      NEW.completed_at := COALESCE(OLD.completed_at, now());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generations_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.genome_seed_panel_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ai_design_rules(p_category character varying DEFAULT 'common'::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'dimensions', (
      SELECT jsonb_object_agg(rule_name, rule_value)
      FROM dadam_rules_numeric
      WHERE (category = p_category OR category = 'common')
      AND rule_type = 'dimension'
    ),
    'formulas', (
      SELECT jsonb_object_agg(rule_name, rule_value)
      FROM dadam_rules_numeric
      WHERE (category = p_category OR category = 'common')
      AND rule_type = 'formula'
    ),
    'constraints', (
      SELECT jsonb_object_agg(rule_name, rule_value)
      FROM dadam_rules_numeric
      WHERE (category = p_category OR category = 'common')
      AND rule_type = 'constraint'
    ),
    'distribution', (
      SELECT jsonb_object_agg(rule_name, rule_value)
      FROM dadam_rules_numeric
      WHERE (category = p_category OR category = 'common')
      AND rule_type = 'distribution'
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_fridge_models(p_brand character varying DEFAULT NULL::character varying, p_line character varying DEFAULT NULL::character varying, p_type character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id integer, brand character varying, line character varying, category_name character varying, model_id character varying, model_name character varying, width integer, height integer, depth integer, type character varying, side_gap integer, between_gap integer, units jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    f.id::INT,
    f.brand::VARCHAR,
    f.line::VARCHAR,
    f.category_name::VARCHAR,
    f.model_id::VARCHAR,
    f.model_name::VARCHAR,
    f.width::INT,
    f.height::INT,
    f.depth::INT,
    f.type::VARCHAR,
    f.side_gap::INT,
    f.between_gap::INT,
    f.units
  FROM dadam_fridge_models f
  WHERE 
    (p_brand IS NULL OR f.brand = p_brand)
    AND (p_line IS NULL OR f.line = p_line)
    AND (p_type IS NULL OR f.type = p_type)
  ORDER BY f.brand, f.line, f.model_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_furniture_options(p_categories text[] DEFAULT NULL::text[], p_applicable_to text DEFAULT NULL::text)
 RETURNS SETOF public.furniture_options
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM furniture_options
  WHERE is_active = TRUE
    AND (p_categories IS NULL OR category = ANY(p_categories))
    AND (p_applicable_to IS NULL OR p_applicable_to = ANY(applicable_to))
  ORDER BY category, sort_order;
$function$;

CREATE OR REPLACE FUNCTION public.get_material_formulas(p_cabinet_type character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id integer, cabinet_type character varying, part_name character varying, formula_width text, formula_height text, quantity integer, material_type character varying, edge_sides integer, notes text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    m.id::INT,
    m.cabinet_type::VARCHAR,
    m.part_name::VARCHAR,
    m.formula_width::TEXT,
    m.formula_height::TEXT,
    m.quantity::INT,
    m.material_type::VARCHAR,
    m.edge_sides::INT,
    m.notes::TEXT
  FROM dadam_material_formulas m
  WHERE 
    (p_cabinet_type IS NULL OR m.cabinet_type = p_cabinet_type)
  ORDER BY m.cabinet_type, m.part_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_materials_catalog()
 RETURNS SETOF public.materials
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM materials
  WHERE is_active = TRUE AND COALESCE(active, TRUE) = TRUE
  ORDER BY slot NULLS LAST, sort NULLS LAST, category, sort_order;
$function$;

CREATE OR REPLACE FUNCTION public.get_rules_by_category(p_category character varying DEFAULT NULL::character varying, p_rule_type character varying DEFAULT NULL::character varying)
 RETURNS TABLE(id integer, category character varying, rule_type character varying, rule_name character varying, rule_value jsonb, unit character varying, description text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    r.id::INT,
    r.category::VARCHAR,
    r.rule_type::VARCHAR,
    r.rule_name::VARCHAR,
    r.rule_value,
    r.unit::VARCHAR,
    r.description::TEXT
  FROM dadam_rules_numeric r
  WHERE 
    (p_category IS NULL OR r.category = p_category OR r.category = 'common')
    AND (p_rule_type IS NULL OR r.rule_type = p_rule_type)
  ORDER BY r.category, r.rule_type, r.rule_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT role FROM user_profiles WHERE id = user_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.handle_dataset_samples_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone, tier, sido, gugun, referral, provider, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    NEW.raw_user_meta_data->>'phone',
    'standard',   -- 가입은 항상 standard. metadata 의 tier 는 신뢰하지 않는다
    NEW.raw_user_meta_data->>'sido',
    NEW.raw_user_meta_data->>'gugun',
    NEW.raw_user_meta_data->>'referral',
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_planner_snapshots_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.profiles
  SET
    email = NEW.email,
    name = COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', profiles.name),
    phone = COALESCE(NEW.raw_user_meta_data->>'phone', profiles.phone),
    -- tier 는 여기서 건드리지 않는다. metadata 는 사용자가 쓸 수 있는 값이다
    sido = COALESCE(NEW.raw_user_meta_data->>'sido', profiles.sido),
    gugun = COALESCE(NEW.raw_user_meta_data->>'gugun', profiles.gugun),
    avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', profiles.avatar_url),
    updated_at = NOW(),
    last_sign_in_at = NEW.last_sign_in_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_appliance_models(rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  r       JSONB;
  codes   TEXT[];
  hit     UUID;
  n_ins   INT := 0;
  n_upd   INT := 0;
  n_skip  INT := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    codes := ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'model_codes', '[]'::jsonb)));
    IF (r->>'model_code') IS NOT NULL AND NOT ((r->>'model_code') = ANY(codes)) THEN
      codes := array_prepend(r->>'model_code', codes);
    END IF;
    -- W · H · D 필수 — 수전만 수전 구멍 지름이 있으면 치수 없이도 (appliance_models_dims_chk 와 같은 조건)
    IF array_length(codes, 1) IS NULL
       OR ((COALESCE((r->>'width_mm')::INT, 0) <= 0
            OR COALESCE((r->>'depth_mm')::INT, 0) <= 0
            OR COALESCE((r->>'height_mm')::INT, 0) <= 0)
           AND NOT (r->>'category' = 'faucet' AND COALESCE(NULLIF(r->>'faucet_hole_mm', '')::INT, 0) > 0)) THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    SELECT id INTO hit FROM appliance_models
     WHERE brand = r->>'brand'
       AND (model_codes && codes OR model_code = ANY(codes))
     ORDER BY verified DESC, updated_at DESC
     LIMIT 1;

    IF hit IS NULL THEN
      INSERT INTO appliance_models (
        category, brand, model_name, model_code, model_codes, width_mm, depth_mm, height_mm, capacity_l,
        subtype, line, install_type, side_gap_mm, top_gap_mm, back_gap_mm,
        niche_min_w_mm, niche_min_h_mm, niche_min_d_mm, niche_max_w_mm, niche_max_h_mm, niche_max_d_mm,
        cutout_w_mm, cutout_d_mm, cutout_r_mm, faucet_hole_mm, gas_types,
        verified, source_url, image_source_url, notes, collected_at
      ) VALUES (
        COALESCE(r->>'category', 'refrigerator'), r->>'brand', r->>'model_name', codes[1], codes,
        NULLIF(r->>'width_mm', '')::INT, NULLIF(r->>'depth_mm', '')::INT, NULLIF(r->>'height_mm', '')::INT, NULLIF(r->>'capacity_l', '')::INT,
        r->>'subtype', r->>'line', r->>'install_type',
        NULLIF(r->>'side_gap_mm', '')::INT, NULLIF(r->>'top_gap_mm', '')::INT, NULLIF(r->>'back_gap_mm', '')::INT,
        NULLIF(r->>'niche_min_w_mm', '')::INT, NULLIF(r->>'niche_min_h_mm', '')::INT, NULLIF(r->>'niche_min_d_mm', '')::INT,
        NULLIF(r->>'niche_max_w_mm', '')::INT, NULLIF(r->>'niche_max_h_mm', '')::INT, NULLIF(r->>'niche_max_d_mm', '')::INT,
        NULLIF(r->>'cutout_w_mm', '')::INT, NULLIF(r->>'cutout_d_mm', '')::INT, NULLIF(r->>'cutout_r_mm', '')::INT,
        NULLIF(r->>'faucet_hole_mm', '')::INT,
        CASE WHEN jsonb_typeof(r->'gas_types') = 'array' THEN NULLIF(ARRAY(SELECT jsonb_array_elements_text(r->'gas_types')), '{}') END,
        COALESCE((r->>'verified')::BOOLEAN, false), r->>'source_url', NULLIF(r->>'image_source_url', ''), r->>'notes', NOW()
      );
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_models SET
        model_name       = COALESCE(r->>'model_name', model_name),
        model_codes      = ARRAY(SELECT DISTINCT unnest(model_codes || codes)),
        width_mm         = COALESCE(NULLIF(r->>'width_mm', '')::INT, width_mm),     -- 수전은 치수가 비어 올 수 있다
        depth_mm         = COALESCE(NULLIF(r->>'depth_mm', '')::INT, depth_mm),
        height_mm        = COALESCE(NULLIF(r->>'height_mm', '')::INT, height_mm),
        capacity_l       = COALESCE(NULLIF(r->>'capacity_l', '')::INT, capacity_l),
        subtype          = COALESCE(r->>'subtype', subtype),
        line             = COALESCE(r->>'line', line),
        install_type     = COALESCE(r->>'install_type', install_type),
        side_gap_mm      = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT),
        top_gap_mm       = COALESCE(top_gap_mm,  NULLIF(r->>'top_gap_mm', '')::INT),
        back_gap_mm      = COALESCE(back_gap_mm, NULLIF(r->>'back_gap_mm', '')::INT),
        niche_min_w_mm   = COALESCE(niche_min_w_mm, NULLIF(r->>'niche_min_w_mm', '')::INT),
        niche_min_h_mm   = COALESCE(niche_min_h_mm, NULLIF(r->>'niche_min_h_mm', '')::INT),
        niche_min_d_mm   = COALESCE(niche_min_d_mm, NULLIF(r->>'niche_min_d_mm', '')::INT),
        niche_max_w_mm   = COALESCE(niche_max_w_mm, NULLIF(r->>'niche_max_w_mm', '')::INT),
        niche_max_h_mm   = COALESCE(niche_max_h_mm, NULLIF(r->>'niche_max_h_mm', '')::INT),
        niche_max_d_mm   = COALESCE(niche_max_d_mm, NULLIF(r->>'niche_max_d_mm', '')::INT),
        cutout_w_mm      = COALESCE(cutout_w_mm, NULLIF(r->>'cutout_w_mm', '')::INT),
        cutout_d_mm      = COALESCE(cutout_d_mm, NULLIF(r->>'cutout_d_mm', '')::INT),
        cutout_r_mm      = COALESCE(cutout_r_mm, NULLIF(r->>'cutout_r_mm', '')::INT),
        faucet_hole_mm   = COALESCE(faucet_hole_mm, NULLIF(r->>'faucet_hole_mm', '')::INT),
        -- 가스 종류가 없는 행은 JSON null 로 온다 (배열이 아니면 풀지 않는다 — jsonb_array_elements_text 는 null 을 못 푼다)
        gas_types        = COALESCE(CASE WHEN jsonb_typeof(r->'gas_types') = 'array' THEN NULLIF(ARRAY(SELECT jsonb_array_elements_text(r->'gas_types')), '{}') END, gas_types),
        verified         = verified OR COALESCE((r->>'verified')::BOOLEAN, false),
        source_url       = COALESCE(r->>'source_url', source_url),
        image_source_url = COALESCE(NULLIF(r->>'image_source_url', ''), image_source_url),
        discontinued     = false,
        collected_at     = NOW()
      WHERE id = hit;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles WHERE user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_owner(resource_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
    RETURN auth.uid() = resource_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.quick_trigger_search(query_triggers text[], filter_category text DEFAULT NULL::text, limit_count integer DEFAULT 15)
 RETURNS TABLE(id integer, category character varying, rule_type character varying, trigger character varying, content text, value_min numeric, value_max numeric, value_target numeric, unit character varying, priority integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    dr.id,
    dr.category,
    dr.rule_type,
    dr.trigger,
    dr.content,
    dr.value_min,
    dr.value_max,
    dr.value_target,
    dr.unit,
    dr.priority
  FROM design_rules dr
  WHERE dr.is_active = true
    AND (
      dr.trigger = ANY(query_triggers)
      OR EXISTS (
        SELECT 1 FROM unnest(query_triggers) qt
        WHERE dr.trigger ILIKE '%' || qt || '%'
        OR dr.content ILIKE '%' || qt || '%'
      )
    )
    AND (
      filter_category IS NULL 
      OR dr.category = filter_category
      OR dr.category = 'common'
    )
  ORDER BY dr.priority DESC, dr.id
  LIMIT limit_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credit(p_ref uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row credit_ledger%ROWTYPE;
  v_balance INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_row FROM credit_ledger
    WHERE credit_ledger.ref = p_ref
      AND credit_ledger.user_id = v_user
      AND credit_ledger.delta < 0
      AND credit_ledger.refunded = FALSE
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
    WHERE uc.user_id = v_user RETURNING uc.balance INTO v_balance;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
  VALUES (v_user, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credit_svc(p_ref uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row credit_ledger%ROWTYPE;
  v_balance INT;
BEGIN
  SELECT * INTO v_row FROM credit_ledger
    WHERE credit_ledger.ref = p_ref
      AND credit_ledger.delta < 0
      AND credit_ledger.refunded = FALSE
      AND credit_ledger.created_at > now() - INTERVAL '30 minutes'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_applicable';
  END IF;

  UPDATE user_credits uc SET balance = uc.balance + (-v_row.delta), updated_at = now()
    WHERE uc.user_id = v_row.user_id RETURNING uc.balance INTO v_balance;

  UPDATE credit_ledger SET refunded = TRUE WHERE id = v_row.id;

  INSERT INTO credit_ledger (user_id, delta, reason, balance_after)
  VALUES (v_row.user_id, -v_row.delta, 'refund', v_balance);

  RETURN v_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_credits_on_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier THEN
    UPDATE user_credits SET period_end = now(), updated_at = now() WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_furniture_by_category(p_category text, p_style text DEFAULT NULL::text, p_training_only boolean DEFAULT false, p_limit integer DEFAULT 10)
 RETURNS SETOF public.furniture_images
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM furniture_images
  WHERE category = p_category
    AND (p_style IS NULL OR style = p_style)
    AND (NOT p_training_only OR is_training = true)
  ORDER BY created_at DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.search_furniture_by_embedding(p_embedding public.vector, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 5, p_threshold double precision DEFAULT 0.7)
 RETURNS TABLE(id uuid, category text, subcategory text, style text, description text, image_url text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    fi.id, fi.category, fi.subcategory, fi.style,
    fi.description, fi.image_url,
    1 - (fi.embedding <=> p_embedding) AS similarity
  FROM furniture_images fi
  WHERE fi.embedding IS NOT NULL
    AND (p_category IS NULL OR fi.category = p_category)
    AND 1 - (fi.embedding <=> p_embedding) >= p_threshold
  ORDER BY fi.embedding <=> p_embedding
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.set_orders_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_site_info_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.subscriptions_detach_on_withdrawal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.billing_key := NULL;
  NEW.next_charge_at := NULL;
  NEW.charge_lock_until := NULL;
  IF NEW.status IN ('active', 'past_due', 'trialing') THEN
    NEW.status := 'cancelled';
    NEW.cancel_reason := COALESCE(NEW.cancel_reason, 'user_request');
  END IF;
  NEW.ended_at := COALESCE(NEW.ended_at, now());
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.update_appliance_models_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_category_stats()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO dadam_category_stats (category, chunk_count, last_indexed_at)
    SELECT 
        c.category,
        COUNT(*),
        CURRENT_TIMESTAMP
    FROM dadam_chunks c
    GROUP BY c.category
    ON CONFLICT (category) DO UPDATE SET
        chunk_count = EXCLUDED.chunk_count,
        last_indexed_at = EXCLUDED.last_indexed_at,
        updated_at = CURRENT_TIMESTAMP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_design_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE designs SET
    total_items = (SELECT COUNT(*) FROM design_items WHERE design_id = NEW.design_id),
    total_modules = (
      SELECT COALESCE(SUM(jsonb_array_length(modules)), 0)
      FROM design_items
      WHERE design_id = NEW.design_id
    ),
    updated_at = NOW()
  WHERE id = NEW.design_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_furniture_images_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_like_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE collection_posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE collection_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_partners_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_chunk(p_id character varying, p_content text, p_category character varying, p_chunk_type character varying, p_phase character varying, p_source_file character varying, p_section_path text[], p_triggers text[], p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS character varying
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO dadam_chunks (
        id, content, content_hash, category, chunk_type, phase,
        source_file, section_path, triggers, metadata
    ) VALUES (
        p_id, p_content, md5(p_content), p_category, p_chunk_type, p_phase,
        p_source_file, p_section_path, p_triggers, p_metadata
    )
    ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        category = EXCLUDED.category,
        chunk_type = EXCLUDED.chunk_type,
        phase = EXCLUDED.phase,
        triggers = EXCLUDED.triggers,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wf_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdrawal_designs(p_user_id uuid)
 RETURNS TABLE(design_id uuid, contract boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT d.id,
         EXISTS (SELECT 1 FROM public.design_documents x WHERE x.design_id = d.id)
      OR EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id)
    FROM public.designs d
   WHERE d.user_id = p_user_id
$function$;

CREATE VIEW public.dataset_chains WITH (security_invoker='on') AS
SELECT o.design_id,
    o.order_no,
    o.completed_at,
    o.contract_amount,
    count(s.sample_id) AS samples,
    count(s.sample_id) FILTER (WHERE (s.media = 'generated'::text)) AS generated_n,
    count(s.sample_id) FILTER (WHERE (s.phase = 'before'::text)) AS before_n,
    count(s.sample_id) FILTER (WHERE (s.source = 'dadam_collection'::text)) AS finished_n,
    count(s.sample_id) FILTER (WHERE s.needs_review) AS review_n,
    f.feedback_n,
    f.accuracy_avg,
    f.usability_avg,
    f.was_modified,
    f.last_feedback_at
   FROM ((public.orders o
     LEFT JOIN public.dataset_samples s ON ((s.design_id = o.design_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS feedback_n,
            (avg(df.accuracy_score))::numeric(3,2) AS accuracy_avg,
            (avg(df.usability_score))::numeric(3,2) AS usability_avg,
            bool_or(COALESCE(df.was_modified, false)) AS was_modified,
            max(df.created_at) AS last_feedback_at
           FROM public.design_feedback df
          WHERE (df.design_id = o.design_id)) f ON (true))
  WHERE (o.status = 'completed'::text)
  GROUP BY o.design_id, o.order_no, o.completed_at, o.contract_amount, f.feedback_n, f.accuracy_avg, f.usability_avg, f.was_modified, f.last_feedback_at;

CREATE VIEW public.dataset_exportable WITH (security_invoker='on') AS
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
          WHERE ((o.design_id = dataset_samples.design_id) AND (o.status = 'completed'::text))))));

CREATE VIEW public.detail_design_approval_requests WITH (security_invoker='on') AS
SELECT id AS user_id,
    email,
    name,
    phone,
    tier,
    detaildesign_approved,
    detaildesign_requested_at,
    detaildesign_approved_at,
    detaildesign_approved_by,
    ( SELECT c.id
           FROM public.consultations c
          WHERE ((c.user_id = p.id) AND (c.request_detail_design = true))
          ORDER BY c.created_at DESC
         LIMIT 1) AS latest_consultation_id
   FROM public.profiles p
  WHERE ((detaildesign_requested_at IS NOT NULL) OR (detaildesign_approved = true));

CREATE VIEW public.profile_stats WITH (security_invoker='on') AS
SELECT count(*) AS total_users,
    count(*) FILTER (WHERE (tier = 'standard'::text)) AS standard_users,
    count(*) FILTER (WHERE (tier = 'expert'::text)) AS expert_users,
    count(*) FILTER (WHERE (tier = 'agent'::text)) AS agent_users,
    count(*) FILTER (WHERE (tier_source = 'subscription'::text)) AS paid_users,
    count(*) FILTER (WHERE (created_at >= CURRENT_DATE)) AS today_signups,
    count(*) FILTER (WHERE (created_at >= (CURRENT_DATE - '7 days'::interval))) AS week_signups,
    count(*) FILTER (WHERE (created_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))) AS month_signups
   FROM public.profiles;

-- ------------------------------------------------------------
-- 제약 (CHECK · PRIMARY KEY · UNIQUE)
-- ------------------------------------------------------------

ALTER TABLE ONLY public.admin_logs
    ADD CONSTRAINT admin_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_back_gap_mm_check CHECK ((back_gap_mm >= 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_category_check CHECK ((category = ANY (ARRAY['refrigerator'::text, 'hood'::text, 'dishwasher'::text, 'sink'::text, 'oven'::text, 'cooktop'::text, 'washing_machine'::text, 'microwave'::text, 'rice_cooker'::text, 'range'::text, 'faucet'::text])));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_cutout_d_mm_check CHECK (((cutout_d_mm IS NULL) OR (cutout_d_mm > 0)));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_cutout_r_mm_check CHECK (((cutout_r_mm IS NULL) OR (cutout_r_mm >= 0)));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_cutout_w_mm_check CHECK (((cutout_w_mm IS NULL) OR (cutout_w_mm > 0)));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_dims_chk CHECK ((((width_mm IS NULL) OR (width_mm > 0)) AND ((depth_mm IS NULL) OR (depth_mm > 0)) AND ((height_mm IS NULL) OR (height_mm > 0)) AND ((category = 'faucet'::text) OR ((width_mm IS NOT NULL) AND (depth_mm IS NOT NULL) AND (height_mm IS NOT NULL))) AND ((category <> 'faucet'::text) OR (faucet_hole_mm IS NOT NULL) OR ((width_mm IS NOT NULL) AND (depth_mm IS NOT NULL) AND (height_mm IS NOT NULL)))));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_faucet_hole_mm_check CHECK (((faucet_hole_mm IS NULL) OR (faucet_hole_mm > 0)));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_gas_types_check CHECK (((gas_types IS NULL) OR (gas_types <@ ARRAY['LNG'::text, 'LPG'::text])));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_image_path_chk CHECK (((image_path IS NULL) OR ((image_path !~ '^[a-z]+:'::text) AND (image_path !~ '^/'::text) AND (image_path !~ '\.\.'::text))));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_image_source_url_chk CHECK (((image_source_url IS NULL) OR (image_source_url ~ '^https?://'::text)));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_install_type_chk CHECK (((install_type IS NULL) OR (install_type = ANY (ARRAY['freestanding'::text, 'kitchen_fit'::text, 'built_in'::text]))));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_max_d_mm_check CHECK ((niche_max_d_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_max_h_mm_check CHECK ((niche_max_h_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_max_w_mm_check CHECK ((niche_max_w_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_min_d_mm_check CHECK ((niche_min_d_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_min_h_mm_check CHECK ((niche_min_h_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_niche_min_w_mm_check CHECK ((niche_min_w_mm > 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_side_gap_mm_check CHECK ((side_gap_mm >= 0));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_subtype_chk CHECK (((subtype IS NULL) OR
CASE category
    WHEN 'refrigerator'::text THEN (subtype = ANY (ARRAY['french_4door'::text, 'side_by_side'::text, 'two_door'::text, 'one_door'::text, 'built_in'::text, 'kimchi_stand'::text, 'kimchi_lid'::text, 'wine'::text, 'small'::text]))
    WHEN 'microwave'::text THEN (subtype = ANY (ARRAY['solo'::text, 'combi'::text]))
    WHEN 'oven'::text THEN (subtype = ANY (ARRAY['oven'::text, 'steam_oven'::text, 'combi'::text]))
    WHEN 'dishwasher'::text THEN (subtype = ANY (ARRAY['built_in'::text, 'freestanding'::text, 'countertop'::text]))
    WHEN 'cooktop'::text THEN (subtype = ANY (ARRAY['induction'::text, 'highlight'::text, 'hybrid'::text, 'gas'::text]))
    WHEN 'hood'::text THEN (subtype = ANY (ARRAY['chimney'::text, 'slim'::text, 'built_in'::text, 'island'::text]))
    WHEN 'rice_cooker'::text THEN (subtype = ANY (ARRAY['pressure_ih'::text, 'ih'::text, 'pressure'::text, 'electric'::text]))
    WHEN 'range'::text THEN (subtype = ANY (ARRAY['gas'::text, 'induction'::text, 'hybrid'::text, 'highlight'::text]))
    ELSE false
END));
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_top_gap_mm_check CHECK ((top_gap_mm >= 0));
ALTER TABLE ONLY public.cash_balances
    ADD CONSTRAINT cash_balances_memo_check CHECK (((memo IS NULL) OR (length(memo) <= 300)));
ALTER TABLE ONLY public.cash_balances
    ADD CONSTRAINT cash_balances_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE ONLY public.collection_inquiries
    ADD CONSTRAINT collection_inquiries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.collection_likes
    ADD CONSTRAINT collection_likes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.collection_likes
    ADD CONSTRAINT collection_likes_user_id_post_id_key UNIQUE (user_id, post_id);
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_category_check CHECK ((category = ANY (ARRAY['kitchen'::text, 'builtin'::text, 'storage'::text, 'interior'::text, 'other'::text])));
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_generation_id_key UNIQUE (generation_id);
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'ai_render'::text])));
ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_consult_target_check CHECK (((consult_target IS NULL) OR (consult_target = ANY (ARRAY['hq'::text, 'partner'::text]))));
ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['door'::text, 'cut_edge'::text, 'countertop'::text, 'board'::text, 'hardware'::text, 'install'::text, 'other'::text]))));
ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_kind_check CHECK ((kind = ANY (ARRAY['partner'::text, 'supplier'::text])));
ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_len_chk CHECK ((((length(name) >= 1) AND (length(name) <= 100)) AND (COALESCE(length(phone), 0) <= 40) AND (COALESCE(length(memo), 0) <= 1000)));
ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.credit_costs
    ADD CONSTRAINT credit_costs_credits_check CHECK ((credits > 0));
ALTER TABLE ONLY public.credit_costs
    ADD CONSTRAINT credit_costs_pkey PRIMARY KEY (action);
ALTER TABLE ONLY public.credit_ledger
    ADD CONSTRAINT credit_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.credit_plans
    ADD CONSTRAINT credit_plans_monthly_credits_check CHECK ((monthly_credits >= 0));
ALTER TABLE ONLY public.credit_plans
    ADD CONSTRAINT credit_plans_pkey PRIMARY KEY (tier);
ALTER TABLE ONLY public.credit_plans
    ADD CONSTRAINT credit_plans_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'expert'::text, 'agent'::text])));
ALTER TABLE ONLY public.dadam_category_stats
    ADD CONSTRAINT dadam_category_stats_pkey PRIMARY KEY (category);
ALTER TABLE ONLY public.dadam_chunks
    ADD CONSTRAINT dadam_chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_color_hex
    ADD CONSTRAINT dadam_color_hex_code_key UNIQUE (code);
ALTER TABLE ONLY public.dadam_color_hex
    ADD CONSTRAINT dadam_color_hex_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_fridge_models
    ADD CONSTRAINT dadam_fridge_models_model_id_key UNIQUE (model_id);
ALTER TABLE ONLY public.dadam_fridge_models
    ADD CONSTRAINT dadam_fridge_models_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_material_formulas
    ADD CONSTRAINT dadam_material_formulas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_rules_numeric
    ADD CONSTRAINT dadam_rules_numeric_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_search_logs
    ADD CONSTRAINT dadam_search_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_triggers
    ADD CONSTRAINT dadam_triggers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dadam_triggers
    ADD CONSTRAINT dadam_triggers_trigger_keyword_key UNIQUE (trigger_keyword);
ALTER TABLE ONLY public.dataset_ingest_state
    ADD CONSTRAINT dataset_ingest_state_pkey PRIMARY KEY (src_table);
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_furniture_check CHECK (((furniture IS NULL) OR (furniture = ANY (ARRAY['sink'::text, 'builtin'::text, 'fridge'::text, 'storage'::text, 'none'::text, 'unknown'::text]))));
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_layout_shape_check CHECK (((layout_shape IS NULL) OR (layout_shape = ANY (ARRAY['I'::text, 'L'::text, 'U'::text, 'island'::text, 'unknown'::text]))));
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_media_check CHECK (((media IS NULL) OR (media = ANY (ARRAY['photo'::text, 'render3d'::text, 'floorplan'::text, 'generated'::text]))));
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_phase_check CHECK (((phase IS NULL) OR (phase = ANY (ARRAY['before'::text, 'after'::text, 'in_progress'::text, 'unknown'::text]))));
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_space_check CHECK (((space IS NULL) OR (space = ANY (ARRAY['kitchen'::text, 'dining'::text, 'living'::text, 'bedroom'::text, 'bathroom'::text, 'entrance'::text, 'balcony'::text, 'dressing'::text, 'utility'::text, 'corridor'::text, 'study'::text, 'unknown'::text]))));
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_verdict_check CHECK ((verdict = ANY (ARRAY['confirm'::text, 'correct'::text, 'reject'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_furniture_check CHECK ((furniture = ANY (ARRAY['sink'::text, 'builtin'::text, 'fridge'::text, 'storage'::text, 'none'::text, 'unknown'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_label_source_check CHECK ((label_source = ANY (ARRAY['caption'::text, 'structured'::text, 'model'::text, 'human'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_layout_shape_check CHECK ((layout_shape = ANY (ARRAY['I'::text, 'L'::text, 'U'::text, 'island'::text, 'unknown'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_license_check CHECK ((license = ANY (ARRAY['owned'::text, 'user-uploaded'::text, 'restricted-internal'::text, 'cc0'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_media_check CHECK ((media = ANY (ARRAY['photo'::text, 'render3d'::text, 'floorplan'::text, 'generated'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_phase_check CHECK ((phase = ANY (ARRAY['before'::text, 'after'::text, 'in_progress'::text, 'unknown'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_pkey PRIMARY KEY (sample_id);
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_source_check CHECK ((source = ANY (ARRAY['dadam_collection'::text, 'dadam_generation'::text, 'dadam_planner'::text, 'dadam_design'::text, 'ohouse'::text])));
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_space_check CHECK ((space = ANY (ARRAY['kitchen'::text, 'dining'::text, 'living'::text, 'bedroom'::text, 'bathroom'::text, 'entrance'::text, 'balcony'::text, 'dressing'::text, 'utility'::text, 'corridor'::text, 'study'::text, 'unknown'::text])));
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_bytes_check CHECK ((bytes > 0));
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_kind_check CHECK ((kind = ANY (ARRAY['cad'::text, 'exterior'::text])));
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_path_key UNIQUE (path);
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_uniq UNIQUE (snapshot_id, kind, sha256);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_doc_no_key UNIQUE (doc_no);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['customer_confirmation'::text, 'work_order'::text, 'installation_order'::text])));
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_id_design_uniq UNIQUE (id, design_id);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_rev_uniq UNIQUE (design_id, doc_type, rev);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_share_chk CHECK (((doc_type <> 'customer_confirmation'::text) OR (status = ANY (ARRAY['revoked'::text, 'superseded'::text])) OR (share_token_hash IS NOT NULL)));
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_share_token_hash_key UNIQUE (share_token_hash);
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'viewed'::text, 'approved'::text, 'rejected'::text, 'revoked'::text, 'superseded'::text])));
ALTER TABLE ONLY public.design_embeddings
    ADD CONSTRAINT design_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_accuracy_score_check CHECK (((accuracy_score >= 1) AND (accuracy_score <= 5)));
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_feedback_type_check CHECK ((feedback_type = ANY (ARRAY['revision'::text, 'completion'::text, 'complaint'::text, 'praise'::text])));
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_usability_score_check CHECK (((usability_score >= 1) AND (usability_score <= 5)));
ALTER TABLE ONLY public.design_images
    ADD CONSTRAINT design_images_image_type_check CHECK ((image_type = ANY (ARRAY['site_photo'::text, 'reference'::text, 'sketch'::text, 'result'::text])));
ALTER TABLE ONLY public.design_images
    ADD CONSTRAINT design_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_items
    ADD CONSTRAINT design_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_renders
    ADD CONSTRAINT design_renders_kind_check CHECK ((kind = ANY (ARRAY['front'::text, 'iso'::text, 'plan'::text, 'module'::text])));
ALTER TABLE ONLY public.design_renders
    ADD CONSTRAINT design_renders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_rules
    ADD CONSTRAINT design_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_actual_chk CHECK (((completed_at IS NULL) OR (started_at IS NULL) OR (completed_at >= started_at)));
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_type_check CHECK ((type = ANY (ARRAY['measurement'::text, 'material_order'::text, 'manufacturing_start'::text, 'manufacturing_end'::text, 'quality_check'::text, 'delivery'::text, 'installation'::text, 'as_visit'::text])));
ALTER TABLE ONLY public.design_site_info
    ADD CONSTRAINT design_site_info_len_chk CHECK (((COALESCE(length(address), 0) <= 200) AND (COALESCE(length(address_detail), 0) <= 100) AND (COALESCE(length(floor), 0) <= 30) AND (COALESCE(length(elevator_note), 0) <= 300) AND (COALESCE(length(access_note), 0) <= 1000) AND (COALESCE(length(install_order), 0) <= 2000) AND (COALESCE(length(contact_name), 0) <= 50) AND (COALESCE(length(contact_phone), 0) <= 30) AND (COALESCE(length(notes), 0) <= 2000)));
ALTER TABLE ONLY public.design_site_info
    ADD CONSTRAINT design_site_info_pkey PRIMARY KEY (design_id);
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_hash_uniq UNIQUE (design_id, content_hash);
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_id_design_uniq UNIQUE (id, design_id);
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_nonempty CHECK ((item_count > 0));
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_rev_uniq UNIQUE (design_id, rev);
ALTER TABLE ONLY public.designs
    ADD CONSTRAINT designs_customer_satisfaction_check CHECK (((customer_satisfaction >= 1) AND (customer_satisfaction <= 5)));
ALTER TABLE ONLY public.designs
    ADD CONSTRAINT designs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.designs
    ADD CONSTRAINT designs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'in_review'::text, 'completed'::text, 'feedback_done'::text])));
ALTER TABLE ONLY public.document_access_log
    ADD CONSTRAINT document_access_log_event_check CHECK ((event = ANY (ARRAY['view'::text, 'pin_fail'::text, 'pin_locked'::text, 'decision'::text, 'expired'::text, 'not_found'::text])));
ALTER TABLE ONLY public.document_access_log
    ADD CONSTRAINT document_access_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expert_requests
    ADD CONSTRAINT expert_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expert_requests
    ADD CONSTRAINT expert_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.furniture_images
    ADD CONSTRAINT furniture_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.furniture_options
    ADD CONSTRAINT furniture_options_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_progress_check CHECK (((progress >= 0) AND (progress <= 100)));
ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'analyzing'::text, 'rendering'::text, 'qc'::text, 'variants'::text, 'done'::text, 'failed'::text])));
ALTER TABLE ONLY public.genome_seed_panel
    ADD CONSTRAINT genome_seed_panel_lines_check CHECK ((jsonb_typeof(lines) = 'array'::text));
ALTER TABLE ONLY public.genome_seed_panel
    ADD CONSTRAINT genome_seed_panel_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
ALTER TABLE ONLY public.genome_seed_panel
    ADD CONSTRAINT genome_seed_panel_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_comment_check CHECK (((comment IS NULL) OR (length(comment) <= 1000)));
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_order_id_key UNIQUE (order_id);
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_score_check CHECK (((score IS NULL) OR ((score >= 0) AND (score <= 10))));
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.lora_models
    ADD CONSTRAINT lora_models_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_grain_check CHECK (((grain IS NULL) OR (grain = ANY (ARRAY['none'::text, 'h'::text, 'v'::text]))));
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_slot_check CHECK (((slot IS NULL) OR (slot <@ ARRAY['door'::text, 'drawer_front'::text, 'body'::text, 'top'::text, 'handle'::text, 'finishing'::text, 'kick'::text])));
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_tone_check CHECK (((tone IS NULL) OR (tone = ANY (ARRAY['matte'::text, 'gloss'::text, 'single'::text]))));
ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_direction_check CHECK ((direction = ANY (ARRAY['up'::text, 'down'::text])));
ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_objective_check CHECK (((length(objective) >= 1) AND (length(objective) <= 200)));
ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.okrs
    ADD CONSTRAINT okrs_quarter_check CHECK ((quarter ~ '^[0-9]{4}-Q[1-4]$'::text));
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_amount_check CHECK ((amount >= 0));
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_category_check CHECK ((category = ANY (ARRAY['material'::text, 'hardware'::text, 'labor'::text, 'outsourcing'::text, 'logistics'::text, 'other'::text])));
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_len_chk CHECK (((COALESCE(length(description), 0) <= 300) AND (COALESCE(length(vendor_name), 0) <= 100)));
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_amount_check CHECK ((amount > 0));
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_memo_check CHECK (((memo IS NULL) OR (length(memo) <= 300)));
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_method_check CHECK (((method IS NULL) OR (method = ANY (ARRAY['transfer'::text, 'card'::text, 'cash'::text, 'other'::text]))));
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_stage_check CHECK ((stage = ANY (ARRAY['deposit'::text, 'interim'::text, 'balance'::text, 'other'::text])));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_completed_chk CHECK (((status <> 'completed'::text) OR (completed_at IS NOT NULL)));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_contract_amount_check CHECK ((contract_amount >= 0));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_document_id_key UNIQUE (document_id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_note_len_chk CHECK ((COALESCE(length(note), 0) <= 2000));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_no_key UNIQUE (order_no);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_price_tier_chk CHECK (((price_tier IS NULL) OR (price_tier = ANY (ARRAY['customer'::text, 'partner'::text]))));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_received_amount_check CHECK ((received_amount >= 0));
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'in_production'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_partner_type_check CHECK ((partner_type = ANY (ARRAY['interior'::text, 'factory'::text])));
ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'toss'::text])));
ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_provider_event_id_key UNIQUE (provider, event_id);
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'toss'::text])));
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_provider_order_id_key UNIQUE (provider, order_id);
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_status_check CHECK ((status = ANY (ARRAY['done'::text, 'failed'::text, 'refunded'::text, 'pending'::text])));
ALTER TABLE ONLY public.planner_snapshots
    ADD CONSTRAINT planner_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.planner_snapshots
    ADD CONSTRAINT planner_snapshots_stage_check CHECK ((stage = ANY (ARRAY['layout'::text, 'structure'::text, 'detail'::text])));
ALTER TABLE ONLY public.pricing_rule_sets
    ADD CONSTRAINT pricing_rule_sets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pricing_rule_sets
    ADD CONSTRAINT pricing_rule_sets_version_key UNIQUE (version);
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_grade_check CHECK ((grade = ANY (ARRAY['basic'::text, 'mid'::text, 'premium'::text, '*'::text])));
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_grade_chk CHECK ((grade = ANY (ARRAY['basic'::text, 'mid'::text, 'premium'::text, '*'::text])));
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_kind_check CHECK ((kind = ANY (ARRAY['cabinet'::text, 'module_type'::text, 'countertop'::text, 'fixture'::text, 'labor'::text, 'door_finish_base'::text, 'door_color_mult'::text, 'door_baseline'::text, 'vat'::text, 'range'::text])));
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_rule_set_id_kind_key_grade_key UNIQUE (rule_set_id, kind, key, grade);
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_unit_check CHECK ((unit = ANY (ARRAY['per_1000mm'::text, 'each'::text, 'per_m2'::text, 'ratio'::text, 'flat'::text])));
ALTER TABLE ONLY public.production_assignments
    ADD CONSTRAINT production_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.production_assignments
    ADD CONSTRAINT production_assignments_status_check CHECK ((status = ANY (ARRAY['instructed'::text, 'done'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.production_assignments
    ADD CONSTRAINT production_assignments_text_len_chk CHECK (((length(text) <= 500) AND (COALESCE(length(order_label), 0) <= 200)));
ALTER TABLE ONLY public.production_proposals
    ADD CONSTRAINT production_proposals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.production_proposals
    ADD CONSTRAINT production_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text, 'superseded'::text])));
ALTER TABLE ONLY public.production_proposals
    ADD CONSTRAINT production_proposals_trigger_check CHECK ((trigger = ANY (ARRAY['order_created'::text, 'manual'::text])));
ALTER TABLE ONLY public.production_settings
    ADD CONSTRAINT production_settings_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.production_worker_links
    ADD CONSTRAINT production_worker_links_label_len_chk CHECK (((length(label) >= 1) AND (length(label) <= 50)));
ALTER TABLE ONLY public.production_worker_links
    ADD CONSTRAINT production_worker_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.production_worker_links
    ADD CONSTRAINT production_worker_links_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_len_chk CHECK (((COALESCE(length(note), 0) <= 300) AND (COALESCE(length(order_label), 0) <= 200) AND (COALESCE(length(worker_label), 0) <= 50)));
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_minutes_check CHECK (((minutes > (0)::numeric) AND (minutes <= (1440)::numeric)));
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_role_check CHECK ((role = ANY (ARRAY['cutter'::text, 'edge'::text, 'asm'::text])));
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_units_check CHECK (((units > (0)::numeric) AND (units <= (1000)::numeric)));
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'expert'::text, 'agent'::text])));
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tier_source_check CHECK ((tier_source = ANY (ARRAY['manual'::text, 'subscription'::text])));
ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_category_check CHECK ((category = ANY (ARRAY['water_pipe'::text, 'exhaust_duct'::text, 'gas_pipe'::text, 'outlet'::text, 'tile'::text])));
ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_cause_check CHECK ((cause = ANY (ARRAY['measure'::text, 'design'::text, 'cutting'::text, 'edge'::text, 'assembly'::text, 'install'::text, 'material'::text, 'outsource'::text, 'customer'::text, 'other'::text])));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_cost_check CHECK (((cost IS NULL) OR (cost >= 0)));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_kind_check CHECK ((kind = ANY (ARRAY['rework'::text, 'as'::text])));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_memo_check CHECK (((memo IS NULL) OR (length(memo) <= 1000)));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_minutes_check CHECK (((minutes IS NULL) OR (minutes >= 0)));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_parts_check CHECK (((parts IS NULL) OR (length(parts) <= 300)));
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sales_history
    ADD CONSTRAINT sales_history_memo_check CHECK (((memo IS NULL) OR (length(memo) <= 300)));
ALTER TABLE ONLY public.sales_history
    ADD CONSTRAINT sales_history_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric));
ALTER TABLE ONLY public.sales_history
    ADD CONSTRAINT sales_history_orders_check CHECK (((orders IS NULL) OR (orders >= 0)));
ALTER TABLE ONLY public.sales_history
    ADD CONSTRAINT sales_history_pkey PRIMARY KEY (month);
ALTER TABLE ONLY public.sales_history
    ADD CONSTRAINT sales_history_revenue_check CHECK ((revenue >= 0));
ALTER TABLE ONLY public.saved_partners
    ADD CONSTRAINT saved_partners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.saved_partners
    ADD CONSTRAINT saved_partners_user_id_partner_id_key UNIQUE (user_id, partner_id);
ALTER TABLE ONLY public.slack_notifications
    ADD CONSTRAINT slack_notifications_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE ONLY public.slack_notifications
    ADD CONSTRAINT slack_notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.slack_notifications
    ADD CONSTRAINT slack_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
ALTER TABLE ONLY public.styles
    ADD CONSTRAINT styles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.styles
    ADD CONSTRAINT styles_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (cancel_reason = ANY (ARRAY['user_request'::text, 'payment_failed'::text, 'refunded'::text]))));
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'expert'::text, 'agent'::text])));
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'toss'::text])));
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'cancelled'::text, 'trialing'::text])));
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_approved_has_file CHECK (((status <> 'approved'::text) OR ((storage_path IS NOT NULL) AND (thumb_path IS NOT NULL))));
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'claude'::text])));
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_theme_check CHECK (((char_length(btrim(theme)) >= 1) AND (char_length(btrim(theme)) <= 32)));
ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_balance_check CHECK ((balance >= 0));
ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.user_images
    ADD CONSTRAINT user_images_door_state_check CHECK (((door_state)::text = ANY ((ARRAY['closed'::character varying, 'open'::character varying, NULL::character varying])::text[])));
ALTER TABLE ONLY public.user_images
    ADD CONSTRAINT user_images_image_type_check CHECK (((image_type)::text = ANY ((ARRAY['site_photo'::character varying, 'ai_generated'::character varying])::text[])));
ALTER TABLE ONLY public.user_images
    ADD CONSTRAINT user_images_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'expert'::text, 'admin'::text])));
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_job_id_worker_id_key UNIQUE (job_id, worker_id);
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_len_chk CHECK (((COALESCE(length(message), 0) <= 300) AND (COALESCE(length(decide_reason), 0) <= 200)));
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_status_chk CHECK ((status = ANY (ARRAY['applied'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])));
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_len_chk CHECK (((COALESCE(length(release_reason), 0) <= 200) AND (COALESCE(length(worker_name_snapshot), 0) <= 30)));
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_status_chk CHECK ((status = ANY (ARRAY['offered'::text, 'confirmed'::text, 'declined'::text, 'started'::text, 'submitted'::text, 'revision'::text, 'accepted'::text, 'released'::text, 'removed'::text])));
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_via_chk CHECK ((via = ANY (ARRAY['application'::text, 'invite'::text])));
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_actor_chk CHECK ((actor_kind = ANY (ARRAY['worker'::text, 'admin'::text, 'system'::text])));
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_len_chk CHECK ((((length(type) >= 1) AND (length(type) <= 40)) AND (COALESCE(length(note), 0) <= 300) AND (COALESCE(length(from_status), 0) <= 20) AND (COALESCE(length(to_status), 0) <= 20)));
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_kind_chk CHECK ((kind = ANY (ARRAY['install'::text, 'as'::text, 'assembly'::text])));
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_len_chk CHECK ((((length(title) >= 1) AND (length(title) <= 80)) AND (COALESCE(length(detail), 0) <= 2000) AND (COALESCE(length(region_label), 0) <= 40) AND (COALESCE(length(cancel_reason), 0) <= 200)));
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_mode_chk CHECK ((mode = ANY (ARRAY['open'::text, 'invite'::text, 'direct'::text])));
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_pay_chk CHECK ((((pay_amount IS NULL) OR (pay_amount >= 0)) AND ((pay_unit IS NULL) OR (pay_unit = ANY (ARRAY['day'::text, 'hour'::text, 'meter'::text, 'job'::text])))));
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_slots_chk CHECK ((slots >= 1));
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'filled'::text, 'in_progress'::text, 'review'::text, 'done'::text, 'closed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_len_chk CHECK (((length(path) >= 1) AND (length(path) <= 300)));
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_kind_chk CHECK ((kind = ANY (ARRAY['production_plan'::text, 'staffing_decision'::text, 'daily_brief'::text, 'work_order'::text, 'installation_order'::text, 'outsource_order'::text, 'countertop_order'::text, 'monthly_close'::text, 'note'::text])));
ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_reports
    ADD CONSTRAINT work_reports_text_len_chk CHECK (((length(title) <= 300) AND (COALESCE(length(note), 0) <= 4000)));
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_assignment_id_direction_key UNIQUE (assignment_id, direction);
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_direction_chk CHECK ((direction = ANY (ARRAY['company_to_worker'::text, 'worker_to_company'::text])));
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_len_chk CHECK (((COALESCE(length(comment), 0) <= 500) AND (COALESCE(length(reply), 0) <= 500) AND (COALESCE(length(objection), 0) <= 500)));
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_score_chk CHECK (((score IS NULL) OR ((score >= 1) AND (score <= 5))));
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])));
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_kind_chk CHECK ((kind = ANY (ARRAY['progress'::text, 'issue'::text, 'result'::text, 'correction'::text, 'note'::text])));
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_len_chk CHECK (((length(body) >= 1) AND (length(body) <= 1000)));
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_role_chk CHECK ((author_role = ANY (ARRAY['worker'::text, 'company'::text])));
ALTER TABLE ONLY public.worker_events
    ADD CONSTRAINT worker_events_actor_chk CHECK ((actor_kind = ANY (ARRAY['worker'::text, 'admin'::text, 'system'::text])));
ALTER TABLE ONLY public.worker_events
    ADD CONSTRAINT worker_events_len_chk CHECK ((((length(type) >= 1) AND (length(type) <= 40)) AND (COALESCE(length(note), 0) <= 300) AND (COALESCE(length(from_status), 0) <= 20) AND (COALESCE(length(to_status), 0) <= 20)));
ALTER TABLE ONLY public.worker_events
    ADD CONSTRAINT worker_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_kinds_chk CHECK ((kinds_preset <@ ARRAY['install'::text, 'as'::text, 'assembly'::text]));
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_len_chk CHECK ((COALESCE(length(display_name_preset), 0) <= 30));
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.worker_notes
    ADD CONSTRAINT worker_notes_len_chk CHECK (((length(note) >= 1) AND (length(note) <= 1000)));
ALTER TABLE ONLY public.worker_notes
    ADD CONSTRAINT worker_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_kinds_chk CHECK ((kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text]));
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_len_chk CHECK ((((length(display_name) >= 1) AND (length(display_name) <= 30)) AND (COALESCE(length(phone), 0) <= 30) AND (COALESCE(length(region_label), 0) <= 40) AND (COALESCE(length(reject_reason), 0) <= 200)));
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text])));
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_user_id_key UNIQUE (user_id);

-- ------------------------------------------------------------
-- 외래 키
-- ------------------------------------------------------------

ALTER TABLE ONLY public.admin_logs
    ADD CONSTRAINT admin_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.appliance_models
    ADD CONSTRAINT appliance_models_image_approved_by_fkey FOREIGN KEY (image_approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_inquiries
    ADD CONSTRAINT collection_inquiries_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_inquiries
    ADD CONSTRAINT collection_inquiries_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.collection_posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_inquiries
    ADD CONSTRAINT collection_inquiries_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_likes
    ADD CONSTRAINT collection_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.collection_posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_likes
    ADD CONSTRAINT collection_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.collection_posts
    ADD CONSTRAINT collection_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.credit_ledger
    ADD CONSTRAINT credit_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_reviewer_fkey FOREIGN KEY (reviewer) REFERENCES auth.users(id);
ALTER TABLE ONLY public.dataset_reviews
    ADD CONSTRAINT dataset_reviews_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES public.dataset_samples(sample_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dataset_samples
    ADD CONSTRAINT dataset_samples_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_cad_artifacts
    ADD CONSTRAINT design_cad_artifacts_snapshot_fk FOREIGN KEY (snapshot_id, design_id) REFERENCES public.design_snapshots(id, design_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_snapshot_fk FOREIGN KEY (snapshot_id, design_id) REFERENCES public.design_snapshots(id, design_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.design_documents
    ADD CONSTRAINT design_documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.design_documents(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_embeddings
    ADD CONSTRAINT design_embeddings_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_embeddings
    ADD CONSTRAINT design_embeddings_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.design_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.collection_posts(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_feedback
    ADD CONSTRAINT design_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_images
    ADD CONSTRAINT design_images_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_images
    ADD CONSTRAINT design_images_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.design_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_items
    ADD CONSTRAINT design_items_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_renders
    ADD CONSTRAINT design_renders_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_schedules
    ADD CONSTRAINT design_schedules_document_fk FOREIGN KEY (document_id, design_id) REFERENCES public.design_documents(id, design_id) ON DELETE SET NULL (document_id);
ALTER TABLE ONLY public.design_site_info
    ADD CONSTRAINT design_site_info_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.design_snapshots
    ADD CONSTRAINT design_snapshots_pricing_rule_set_id_fkey FOREIGN KEY (pricing_rule_set_id) REFERENCES public.pricing_rule_sets(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.designs
    ADD CONSTRAINT designs_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.designs
    ADD CONSTRAINT designs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.document_access_log
    ADD CONSTRAINT document_access_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.design_documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.expert_requests
    ADD CONSTRAINT expert_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expert_requests
    ADD CONSTRAINT expert_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.generations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.generations
    ADD CONSTRAINT generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.genome_seed_panel
    ADD CONSTRAINT genome_seed_panel_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.genome_seed_panel
    ADD CONSTRAINT genome_seed_panel_source_design_id_fkey FOREIGN KEY (source_design_id) REFERENCES public.designs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.install_feedback
    ADD CONSTRAINT install_feedback_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_costs
    ADD CONSTRAINT order_costs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.design_documents(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.counterparties(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.design_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.planner_snapshots
    ADD CONSTRAINT planner_snapshots_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pricing_rule_sets
    ADD CONSTRAINT pricing_rule_sets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_rule_set_id_fkey FOREIGN KEY (rule_set_id) REFERENCES public.pricing_rule_sets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.production_assignments
    ADD CONSTRAINT production_assignments_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.production_proposals(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.production_proposals
    ADD CONSTRAINT production_proposals_trigger_order_id_fkey FOREIGN KEY (trigger_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.production_worker_links(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.production_worklogs
    ADD CONSTRAINT production_worklogs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_detaildesign_approved_by_fkey FOREIGN KEY (detaildesign_approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rework_logs
    ADD CONSTRAINT rework_logs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.saved_partners
    ADD CONSTRAINT saved_partners_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.saved_partners
    ADD CONSTRAINT saved_partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.slack_notifications
    ADD CONSTRAINT slack_notifications_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.theme_images
    ADD CONSTRAINT theme_images_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_images
    ADD CONSTRAINT user_images_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_images
    ADD CONSTRAINT user_images_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_applications
    ADD CONSTRAINT work_applications_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.work_applications(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_assignments
    ADD CONSTRAINT work_assignments_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.work_assignments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_job_events
    ADD CONSTRAINT work_job_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_jobs
    ADD CONSTRAINT work_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.work_assignments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_update_id_fkey FOREIGN KEY (update_id) REFERENCES public.work_updates(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_photos
    ADD CONSTRAINT work_photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.work_assignments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_reviews
    ADD CONSTRAINT work_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_amends_id_fkey FOREIGN KEY (amends_id) REFERENCES public.work_updates(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.work_assignments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_updates
    ADD CONSTRAINT work_updates_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.worker_events
    ADD CONSTRAINT worker_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.worker_events
    ADD CONSTRAINT worker_events_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.worker_invites
    ADD CONSTRAINT worker_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.worker_notes
    ADD CONSTRAINT worker_notes_author_fkey FOREIGN KEY (author) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.worker_notes
    ADD CONSTRAINT worker_notes_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_invited_via_fkey FOREIGN KEY (invited_via) REFERENCES public.worker_invites(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 인덱스
-- ------------------------------------------------------------

CREATE INDEX idx_admin_logs_action ON public.admin_logs USING btree (action_type);
CREATE INDEX idx_admin_logs_admin ON public.admin_logs USING btree (admin_id);
CREATE INDEX idx_admin_logs_created ON public.admin_logs USING btree (created_at DESC);
CREATE INDEX idx_appliance_brand ON public.appliance_models USING btree (brand);
CREATE INDEX idx_appliance_category ON public.appliance_models USING btree (category);
CREATE INDEX idx_appliance_image_path ON public.appliance_models USING btree (image_path) WHERE (image_path IS NOT NULL);
CREATE INDEX idx_appliance_model_codes ON public.appliance_models USING gin (model_codes);
CREATE INDEX idx_appliance_subtype ON public.appliance_models USING btree (subtype);
CREATE INDEX idx_appliance_verified ON public.appliance_models USING btree (verified);
CREATE INDEX idx_cash_balances_asof ON public.cash_balances USING btree (as_of DESC, created_at DESC);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at DESC);
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages USING btree (session_id);
CREATE INDEX idx_chat_messages_user_id ON public.chat_messages USING btree (user_id);
CREATE INDEX idx_collection_likes_post ON public.collection_likes USING btree (post_id);
CREATE INDEX idx_collection_likes_user ON public.collection_likes USING btree (user_id);
CREATE INDEX idx_collection_posts_category ON public.collection_posts USING btree (category);
CREATE INDEX idx_collection_posts_created ON public.collection_posts USING btree (created_at DESC);
CREATE INDEX idx_collection_posts_design ON public.collection_posts USING btree (design_id) WHERE (design_id IS NOT NULL);
CREATE INDEX idx_collection_posts_user ON public.collection_posts USING btree (user_id);
CREATE INDEX idx_consultations_generation ON public.consultations USING btree (generation_id) WHERE (generation_id IS NOT NULL);
CREATE INDEX idx_consultations_request_dd ON public.consultations USING btree (request_detail_design) WHERE (request_detail_design = true);
CREATE INDEX idx_consultations_status ON public.consultations USING btree (status);
CREATE INDEX idx_consultations_user ON public.consultations USING btree (user_id);
CREATE UNIQUE INDEX uq_counterparties_name ON public.counterparties USING btree (kind, lower(name));
CREATE UNIQUE INDEX idx_credit_ledger_ref ON public.credit_ledger USING btree (ref) WHERE (ref IS NOT NULL);
CREATE INDEX idx_credit_ledger_user ON public.credit_ledger USING btree (user_id, created_at DESC);
CREATE INDEX idx_chunks_category_type_phase ON public.dadam_chunks USING btree (category, chunk_type, phase);
CREATE INDEX idx_chunks_embedding ON public.dadam_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE INDEX idx_chunks_triggers ON public.dadam_chunks USING gin (triggers);
CREATE INDEX idx_dadam_chunks_rule_type ON public.dadam_chunks USING btree (rule_type);
CREATE INDEX idx_color_hex_code ON public.dadam_color_hex USING btree (code);
CREATE INDEX idx_fridge_brand ON public.dadam_fridge_models USING btree (brand);
CREATE INDEX idx_fridge_line ON public.dadam_fridge_models USING btree (line);
CREATE INDEX idx_fridge_type ON public.dadam_fridge_models USING btree (type);
CREATE INDEX idx_rules_category ON public.dadam_rules_numeric USING btree (category);
CREATE INDEX idx_rules_name ON public.dadam_rules_numeric USING btree (rule_name);
CREATE INDEX idx_rules_type ON public.dadam_rules_numeric USING btree (rule_type);
CREATE INDEX idx_triggers_keyword ON public.dadam_triggers USING btree (trigger_keyword);
CREATE INDEX idx_dataset_reviews_sample ON public.dataset_reviews USING btree (sample_id, created_at DESC);
CREATE INDEX idx_dataset_samples_design ON public.dataset_samples USING btree (design_id) WHERE (design_id IS NOT NULL);
CREATE INDEX idx_dataset_samples_export ON public.dataset_samples USING btree (media, license, needs_review);
CREATE INDEX idx_dataset_samples_group ON public.dataset_samples USING btree (group_key);
CREATE INDEX idx_dataset_samples_review ON public.dataset_samples USING btree (created_at) WHERE needs_review;
CREATE INDEX idx_dataset_samples_src ON public.dataset_samples USING btree (src_table, src_updated_at);
CREATE INDEX idx_design_cad_artifacts_scope ON public.design_cad_artifacts USING btree (design_id, snapshot_id, kind, created_at DESC);
CREATE INDEX idx_documents_creator ON public.design_documents USING btree (created_by);
CREATE INDEX idx_documents_design ON public.design_documents USING btree (design_id, doc_type, rev DESC);
CREATE INDEX idx_documents_snapshot ON public.design_documents USING btree (snapshot_id);
CREATE INDEX idx_documents_superseded ON public.design_documents USING btree (superseded_by);
CREATE INDEX idx_design_feedback_design_id ON public.design_feedback USING btree (design_id);
CREATE INDEX idx_design_feedback_post ON public.design_feedback USING btree (post_id) WHERE (post_id IS NOT NULL);
CREATE INDEX idx_design_images_design_id ON public.design_images USING btree (design_id);
CREATE INDEX idx_design_images_item_id ON public.design_images USING btree (item_id);
CREATE INDEX idx_design_items_category ON public.design_items USING btree (category);
CREATE INDEX idx_design_items_design_id ON public.design_items USING btree (design_id);
CREATE INDEX idx_design_renders_scope ON public.design_renders USING btree (design_id, item_unique_id, created_at DESC);
CREATE INDEX idx_design_rules_category ON public.design_rules USING btree (category);
CREATE INDEX idx_design_rules_trigger ON public.design_rules USING btree (trigger);
CREATE INDEX idx_design_schedules_completed ON public.design_schedules USING btree (type, completed_at DESC) WHERE (completed_at IS NOT NULL);
CREATE INDEX idx_dsched_batch ON public.design_schedules USING btree (batch_id);
CREATE INDEX idx_dsched_design ON public.design_schedules USING btree (design_id, scheduled_at);
CREATE INDEX idx_dsched_document ON public.design_schedules USING btree (document_id);
CREATE INDEX idx_snapshots_design ON public.design_snapshots USING btree (design_id, rev DESC);
CREATE INDEX idx_snapshots_ruleset ON public.design_snapshots USING btree (pricing_rule_set_id);
CREATE INDEX idx_designs_created_at ON public.designs USING btree (created_at DESC);
CREATE INDEX idx_designs_generation ON public.designs USING btree (generation_id) WHERE (generation_id IS NOT NULL);
CREATE INDEX idx_designs_status ON public.designs USING btree (status);
CREATE INDEX idx_designs_user_id ON public.designs USING btree (user_id);
CREATE INDEX idx_doc_access ON public.document_access_log USING btree (document_id, created_at DESC);
CREATE INDEX idx_doc_access_ip ON public.document_access_log USING btree (ip_hash, created_at DESC);
CREATE INDEX idx_expert_requests_status ON public.expert_requests USING btree (status);
CREATE INDEX idx_expert_requests_user ON public.expert_requests USING btree (user_id);
CREATE INDEX idx_furniture_images_category ON public.furniture_images USING btree (category);
CREATE INDEX idx_furniture_images_category_style ON public.furniture_images USING btree (category, style);
CREATE INDEX idx_furniture_images_embedding ON public.furniture_images USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='20');
CREATE INDEX idx_furniture_images_training ON public.furniture_images USING btree (category, is_training) WHERE (is_training = true);
CREATE INDEX idx_fo_category_active ON public.furniture_options USING btree (category, is_active) WHERE (is_active = true);
CREATE UNIQUE INDEX idx_generations_share_token ON public.generations USING btree (share_token_hash) WHERE (share_token_hash IS NOT NULL);
CREATE INDEX idx_generations_user_active ON public.generations USING btree (user_id) WHERE (status <> ALL (ARRAY['done'::text, 'failed'::text]));
CREATE INDEX idx_generations_user_created ON public.generations USING btree (user_id, created_at DESC);
CREATE INDEX idx_genome_seed_panel_active ON public.genome_seed_panel USING btree (active, created_at DESC);
CREATE INDEX idx_lora_models_category ON public.lora_models USING btree (category);
CREATE INDEX idx_lora_models_status ON public.lora_models USING btree (status) WHERE (status = 'ready'::text);
CREATE INDEX idx_materials_category_active ON public.materials USING btree (category, is_active) WHERE (is_active = true);
CREATE UNIQUE INDEX idx_materials_code ON public.materials USING btree (code) WHERE (code IS NOT NULL);
CREATE INDEX idx_materials_slot ON public.materials USING gin (slot);
CREATE INDEX idx_okrs_quarter ON public.okrs USING btree (quarter, sort);
CREATE INDEX idx_order_costs_cat ON public.order_costs USING btree (category, spent_on DESC);
CREATE INDEX idx_order_costs_cp ON public.order_costs USING btree (counterparty_id) WHERE (counterparty_id IS NOT NULL);
CREATE INDEX idx_order_costs_order ON public.order_costs USING btree (order_id, created_at DESC);
CREATE INDEX idx_order_payments_open ON public.order_payments USING btree (due_on) WHERE (paid_on IS NULL);
CREATE INDEX idx_order_payments_order ON public.order_payments USING btree (order_id, due_on);
CREATE INDEX idx_orders_design ON public.orders USING btree (design_id);
CREATE INDEX idx_orders_partner ON public.orders USING btree (partner_id) WHERE (partner_id IS NOT NULL);
CREATE INDEX idx_orders_status ON public.orders USING btree (status, ordered_at DESC);
CREATE INDEX idx_partners_active ON public.partners USING btree (is_active);
CREATE INDEX idx_partners_categories ON public.partners USING gin (specialty_categories);
CREATE INDEX idx_partners_sido ON public.partners USING btree (sido);
CREATE INDEX idx_partners_type ON public.partners USING btree (partner_type);
CREATE INDEX idx_payment_history_subscription ON public.payment_history USING btree (subscription_id, created_at DESC);
CREATE INDEX idx_payment_history_user ON public.payment_history USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX idx_planner_snapshots_autosave ON public.planner_snapshots USING btree (design_id, item_unique_id, stage) WHERE is_autosave;
CREATE INDEX idx_planner_snapshots_scope ON public.planner_snapshots USING btree (design_id, item_unique_id, stage, created_at DESC);
CREATE UNIQUE INDEX pricing_rule_sets_one_active ON public.pricing_rule_sets USING btree (is_active) WHERE is_active;
CREATE INDEX idx_pricing_rules_set ON public.pricing_rules USING btree (rule_set_id, kind);
CREATE INDEX idx_prod_assign_user_date ON public.production_assignments USING btree (user_id, work_date);
CREATE INDEX idx_prod_proposals_user ON public.production_proposals USING btree (user_id, created_at DESC);
CREATE INDEX idx_prod_links_user ON public.production_worker_links USING btree (user_id, created_at DESC);
CREATE INDEX idx_prod_worklogs_user_date ON public.production_worklogs USING btree (user_id, work_date DESC);
CREATE INDEX idx_profiles_created_at ON public.profiles USING btree (created_at DESC);
CREATE INDEX idx_profiles_dd_approved ON public.profiles USING btree (detaildesign_approved);
CREATE INDEX idx_profiles_dd_requested ON public.profiles USING btree (detaildesign_requested_at) WHERE (detaildesign_requested_at IS NOT NULL);
CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);
CREATE INDEX idx_profiles_sido ON public.profiles USING btree (sido);
CREATE INDEX idx_profiles_tier ON public.profiles USING btree (tier);
CREATE INDEX idx_rework_logs_date ON public.rework_logs USING btree (occurred_on DESC);
CREATE INDEX idx_rework_logs_order ON public.rework_logs USING btree (order_id, occurred_on DESC);
CREATE INDEX idx_saved_partners_partner ON public.saved_partners USING btree (partner_id);
CREATE INDEX idx_saved_partners_user ON public.saved_partners USING btree (user_id);
CREATE INDEX idx_slack_notif_batch ON public.slack_notifications USING btree (batch_id);
CREATE INDEX idx_slack_notif_retry ON public.slack_notifications USING btree (status, created_at) WHERE (status <> 'sent'::text);
CREATE INDEX idx_styles_active ON public.styles USING btree (is_active, sort_order) WHERE (is_active = true);
CREATE INDEX idx_subscriptions_next_charge ON public.subscriptions USING btree (next_charge_at) WHERE ((provider = 'toss'::text) AND (status = 'active'::text));
CREATE INDEX idx_subscriptions_toss_cancel_pending ON public.subscriptions USING btree (current_period_end) WHERE ((provider = 'toss'::text) AND (status = 'cancelled'::text) AND (ended_at IS NULL));
CREATE INDEX idx_subscriptions_toss_due ON public.subscriptions USING btree (next_charge_at) WHERE ((provider = 'toss'::text) AND (status = ANY (ARRAY['active'::text, 'past_due'::text])));
CREATE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id);
CREATE INDEX idx_theme_images_served ON public.theme_images USING btree (status, is_active, theme);
CREATE UNIQUE INDEX theme_images_origin_url_key ON public.theme_images USING btree (origin_url) WHERE (origin_url IS NOT NULL);
CREATE INDEX idx_user_images_created_at ON public.user_images USING btree (created_at);
CREATE INDEX idx_user_images_type ON public.user_images USING btree (image_type);
CREATE INDEX idx_user_images_user_id ON public.user_images USING btree (user_id);
CREATE INDEX idx_user_images_user_type ON public.user_images USING btree (user_id, image_type);
CREATE INDEX idx_user_profiles_role ON public.user_profiles USING btree (role);
CREATE INDEX idx_work_applications_worker ON public.work_applications USING btree (worker_id, created_at DESC);
CREATE INDEX idx_work_assignments_job ON public.work_assignments USING btree (job_id);
CREATE INDEX idx_work_assignments_worker ON public.work_assignments USING btree (worker_id, status);
CREATE UNIQUE INDEX uq_work_assignments_active ON public.work_assignments USING btree (job_id, worker_id) WHERE (status = ANY (ARRAY['offered'::text, 'confirmed'::text, 'started'::text, 'submitted'::text, 'revision'::text, 'accepted'::text]));
CREATE INDEX idx_work_job_events_created ON public.work_job_events USING btree (created_at DESC);
CREATE INDEX idx_work_job_events_job ON public.work_job_events USING btree (job_id, created_at);
CREATE INDEX idx_work_jobs_created ON public.work_jobs USING btree (created_at DESC);
CREATE INDEX idx_work_jobs_status ON public.work_jobs USING btree (status, starts_at);
CREATE INDEX idx_work_photos_job ON public.work_photos USING btree (job_id, created_at);
CREATE INDEX idx_work_reports_kind ON public.work_reports USING btree (kind, created_at DESC);
CREATE INDEX idx_work_reports_orders ON public.work_reports USING gin (order_ids);
CREATE INDEX idx_work_reports_owner ON public.work_reports USING btree (owner_id, created_at DESC);
CREATE UNIQUE INDEX uq_work_reports_daily ON public.work_reports USING btree (owner_id, period_start) WHERE (kind = 'daily_brief'::text);
CREATE UNIQUE INDEX uq_work_reports_monthly ON public.work_reports USING btree (owner_id, period_start) WHERE (kind = 'monthly_close'::text);
CREATE UNIQUE INDEX uq_work_reports_source ON public.work_reports USING btree (kind, source_id) WHERE (source_id IS NOT NULL);
CREATE INDEX idx_work_updates_job ON public.work_updates USING btree (job_id, created_at);
CREATE INDEX idx_worker_events_worker ON public.worker_events USING btree (worker_id, created_at DESC);
CREATE INDEX idx_worker_notes_worker ON public.worker_notes USING btree (worker_id, created_at DESC);
CREATE INDEX idx_workers_status ON public.workers USING btree (status, created_at DESC);

-- ------------------------------------------------------------
-- 트리거
-- ------------------------------------------------------------

CREATE TRIGGER appliance_models_updated_at BEFORE UPDATE ON public.appliance_models FOR EACH ROW EXECUTE FUNCTION public.update_appliance_models_updated_at();
CREATE TRIGGER trigger_update_like_count AFTER INSERT OR DELETE ON public.collection_likes FOR EACH ROW EXECUTE FUNCTION public.update_like_count();
CREATE TRIGGER trg_collection_posts_updated_at BEFORE UPDATE ON public.collection_posts FOR EACH ROW EXECUTE FUNCTION public.collection_posts_touch_updated_at();
CREATE TRIGGER trg_counterparties_touch BEFORE UPDATE ON public.counterparties FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER on_dataset_review_insert AFTER INSERT ON public.dataset_reviews FOR EACH ROW EXECUTE FUNCTION public.apply_dataset_review();
CREATE TRIGGER on_dataset_samples_update BEFORE UPDATE ON public.dataset_samples FOR EACH ROW EXECUTE FUNCTION public.handle_dataset_samples_updated_at();
CREATE TRIGGER trg_documents_touch BEFORE UPDATE ON public.design_documents FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER update_design_stats_trigger AFTER INSERT OR DELETE OR UPDATE ON public.design_items FOR EACH ROW EXECUTE FUNCTION public.update_design_stats();
CREATE TRIGGER trg_dsched_touch BEFORE UPDATE ON public.design_schedules FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER trg_dsched_track_times BEFORE INSERT OR UPDATE ON public.design_schedules FOR EACH ROW EXECUTE FUNCTION public.dsched_track_times();
CREATE TRIGGER trg_site_info_updated_at BEFORE UPDATE ON public.design_site_info FOR EACH ROW EXECUTE FUNCTION public.set_site_info_updated_at();
CREATE TRIGGER trg_furniture_images_updated BEFORE UPDATE ON public.furniture_images FOR EACH ROW EXECUTE FUNCTION public.update_furniture_images_timestamp();
CREATE TRIGGER trg_generations_updated_at BEFORE UPDATE ON public.generations FOR EACH ROW EXECUTE FUNCTION public.generations_touch_updated_at();
CREATE TRIGGER trg_genome_seed_panel_touch BEFORE UPDATE ON public.genome_seed_panel FOR EACH ROW EXECUTE FUNCTION public.genome_seed_panel_touch();
CREATE TRIGGER trg_okrs_touch BEFORE UPDATE ON public.okrs FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER trg_order_payments_touch BEFORE UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_orders_updated_at();
CREATE TRIGGER trigger_partners_updated_at BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.update_partners_updated_at();
CREATE TRIGGER on_planner_snapshots_update BEFORE UPDATE ON public.planner_snapshots FOR EACH ROW EXECUTE FUNCTION public.handle_planner_snapshots_updated_at();
CREATE TRIGGER trg_block_self_dd_approval BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.block_self_dd_approval();
CREATE TRIGGER trg_block_self_tier_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.block_self_tier_change();
CREATE TRIGGER trg_reset_credits_on_tier_change AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.reset_credits_on_tier_change();
CREATE TRIGGER trg_slack_touch BEFORE UPDATE ON public.slack_notifications FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();
CREATE TRIGGER trg_subscriptions_detach_on_withdrawal BEFORE UPDATE OF user_id ON public.subscriptions FOR EACH ROW WHEN (((old.user_id IS NOT NULL) AND (new.user_id IS NULL))) EXECUTE FUNCTION public.subscriptions_detach_on_withdrawal();
CREATE TRIGGER update_user_images_updated_at BEFORE UPDATE ON public.user_images FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 행 수준 보안 (RLS)
-- ------------------------------------------------------------

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appliance_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_category_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_color_hex ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_fridge_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_material_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_rules_numeric ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dadam_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_ingest_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_cad_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_site_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.furniture_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.furniture_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genome_seed_panel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.install_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lora_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_worker_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_worklogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rework_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 정책 (public)
-- ------------------------------------------------------------

CREATE POLICY "Admins can insert logs" ON public.admin_logs
    FOR INSERT
    TO PUBLIC
    WITH CHECK (public.is_admin());
CREATE POLICY "Admins can view logs" ON public.admin_logs
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Admins can view all roles" ON public.admin_roles
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Super admins can manage roles" ON public.admin_roles
    FOR ALL
    TO PUBLIC
    USING (public.is_super_admin());
CREATE POLICY "Users can view own role" ON public.admin_roles
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY appliance_models_admin_delete ON public.appliance_models
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id
   FROM public.admin_roles
  WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
CREATE POLICY appliance_models_admin_insert ON public.appliance_models
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() IN ( SELECT admin_roles.user_id
   FROM public.admin_roles
  WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
CREATE POLICY appliance_models_admin_update ON public.appliance_models
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id
   FROM public.admin_roles
  WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
CREATE POLICY appliance_models_read_all ON public.appliance_models
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Admin read cash balances" ON public.cash_balances
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Users can insert own chat messages" ON public.chat_messages
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view own chat messages" ON public.chat_messages
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY collection_inquiries_insert ON public.collection_inquiries
    FOR INSERT
    TO PUBLIC
    WITH CHECK (true);
CREATE POLICY collection_inquiries_select ON public.collection_inquiries
    FOR SELECT
    TO PUBLIC
    USING (((auth.uid() = from_user_id) OR (auth.uid() = to_user_id)));
CREATE POLICY collection_likes_delete ON public.collection_likes
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY collection_likes_insert ON public.collection_likes
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY collection_likes_select ON public.collection_likes
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY collection_posts_delete ON public.collection_posts
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY collection_posts_delete_admin ON public.collection_posts
    FOR DELETE
    TO authenticated
    USING (public.is_admin());
CREATE POLICY collection_posts_insert ON public.collection_posts
    FOR INSERT
    TO PUBLIC
    WITH CHECK (((auth.uid() = user_id) AND (source = 'upload'::text) AND (generation_id IS NULL)));
CREATE POLICY collection_posts_select ON public.collection_posts
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY collection_posts_update ON public.collection_posts
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = user_id))
    WITH CHECK (((auth.uid() = user_id) AND (source = 'upload'::text) AND (generation_id IS NULL)));
CREATE POLICY "Admins can update consultations" ON public.consultations
    FOR UPDATE
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Admins can view all consultations" ON public.consultations
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id)));
CREATE POLICY "Users can view own consultations" ON public.consultations
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Admin read counterparties" ON public.counterparties
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "costs readable" ON public.credit_costs
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "admin ledger" ON public.credit_ledger
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "own ledger" ON public.credit_ledger
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "plans readable" ON public.credit_plans
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "admins read ingest state" ON public.dataset_ingest_state
    FOR SELECT
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "admins add own dataset reviews" ON public.dataset_reviews
    FOR INSERT
    TO PUBLIC
    WITH CHECK (((reviewer = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid())))));
CREATE POLICY "admins read dataset reviews" ON public.dataset_reviews
    FOR SELECT
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "admins manage dataset samples" ON public.dataset_samples
    FOR ALL
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "admins read design cad artifacts" ON public.design_cad_artifacts
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "Users read own documents" ON public.design_documents
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.designs
  WHERE ((designs.id = design_documents.design_id) AND (designs.user_id = auth.uid())))));
CREATE POLICY "Users can manage own feedback" ON public.design_feedback
    FOR ALL
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "admins read design feedback" ON public.design_feedback
    FOR SELECT
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "Users can manage own design images" ON public.design_images
    FOR ALL
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.designs
  WHERE ((designs.id = design_images.design_id) AND (designs.user_id = auth.uid())))));
CREATE POLICY "Users can manage own design items" ON public.design_items
    FOR ALL
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.designs
  WHERE ((designs.id = design_items.design_id) AND (designs.user_id = auth.uid())))));
CREATE POLICY "admins read design renders" ON public.design_renders
    FOR SELECT
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "own design renders" ON public.design_renders
    FOR ALL
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = design_renders.design_id) AND (d.user_id = auth.uid())))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = design_renders.design_id) AND (d.user_id = auth.uid())))));
CREATE POLICY "Anyone can delete" ON public.design_rules
    FOR DELETE
    TO PUBLIC
    USING (true);
CREATE POLICY "Anyone can insert" ON public.design_rules
    FOR INSERT
    TO PUBLIC
    WITH CHECK (true);
CREATE POLICY "Anyone can read" ON public.design_rules
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Anyone can update" ON public.design_rules
    FOR UPDATE
    TO PUBLIC
    USING (true);
CREATE POLICY "Users read own schedules" ON public.design_schedules
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.designs
  WHERE ((designs.id = design_schedules.design_id) AND (designs.user_id = auth.uid())))));
CREATE POLICY "Users read own site info" ON public.design_site_info
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = design_site_info.design_id) AND (d.user_id = auth.uid())))));
CREATE POLICY "Users read own snapshots" ON public.design_snapshots
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.designs
  WHERE ((designs.id = design_snapshots.design_id) AND (designs.user_id = auth.uid())))));
CREATE POLICY "Users can create own designs" ON public.designs
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete own designs" ON public.designs
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own designs" ON public.designs
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own designs" ON public.designs
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Admins can update requests" ON public.expert_requests
    FOR UPDATE
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Admins can view all requests" ON public.expert_requests
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Users can create expert request" ON public.expert_requests
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can insert own requests" ON public.expert_requests
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view own expert requests" ON public.expert_requests
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own requests" ON public.expert_requests
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY furniture_images_read ON public.furniture_images
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Public read" ON public.furniture_options
    FOR SELECT
    TO PUBLIC
    USING ((is_active = true));
CREATE POLICY "Service write" ON public.furniture_options
    FOR ALL
    TO PUBLIC
    USING ((auth.role() = 'service_role'::text));
CREATE POLICY generations_select_own ON public.generations
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY generations_update_own ON public.generations
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = user_id))
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "seed panel admin delete" ON public.genome_seed_panel
    FOR DELETE
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "seed panel admin insert" ON public.genome_seed_panel
    FOR INSERT
    TO authenticated
    WITH CHECK ((public.is_admin() AND (created_by = auth.uid())));
CREATE POLICY "seed panel admin update" ON public.genome_seed_panel
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
CREATE POLICY "seed panel read" ON public.genome_seed_panel
    FOR SELECT
    TO authenticated
    USING (true);
CREATE POLICY "Admin read install feedback" ON public.install_feedback
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY lora_models_read ON public.lora_models
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Public read materials" ON public.materials
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Service write materials" ON public.materials
    FOR ALL
    TO PUBLIC
    USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Admin read okrs" ON public.okrs
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Users read own order costs" ON public.order_costs
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM (public.orders o
     JOIN public.designs d ON ((d.id = o.design_id)))
  WHERE ((o.id = order_costs.order_id) AND (d.user_id = auth.uid())))));
CREATE POLICY "Admin read order payments" ON public.order_payments
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Users read own orders" ON public.orders
    FOR SELECT
    TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = orders.design_id) AND (d.user_id = auth.uid())))));
CREATE POLICY "Admins can manage partners" ON public.partners
    FOR ALL
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Anyone can view active partners" ON public.partners
    FOR SELECT
    TO PUBLIC
    USING ((is_active = true));
CREATE POLICY payment_history_admin_select ON public.payment_history
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY payment_history_owner_select ON public.payment_history
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "admins read planner snapshots" ON public.planner_snapshots
    FOR SELECT
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid()))));
CREATE POLICY "own planner snapshots" ON public.planner_snapshots
    FOR ALL
    TO PUBLIC
    USING ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = planner_snapshots.design_id) AND (d.user_id = auth.uid())))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.designs d
  WHERE ((d.id = planner_snapshots.design_id) AND (d.user_id = auth.uid())))));
CREATE POLICY "Users read own production assignments" ON public.production_assignments
    FOR SELECT
    TO authenticated
    USING ((user_id = auth.uid()));
CREATE POLICY "Users read own production proposals" ON public.production_proposals
    FOR SELECT
    TO authenticated
    USING ((user_id = auth.uid()));
CREATE POLICY "Users read own production settings" ON public.production_settings
    FOR SELECT
    TO authenticated
    USING ((user_id = auth.uid()));
CREATE POLICY "Users read own worker links" ON public.production_worker_links
    FOR SELECT
    TO authenticated
    USING ((user_id = auth.uid()));
CREATE POLICY "Users read own worklogs" ON public.production_worklogs
    FOR SELECT
    TO authenticated
    USING ((user_id = auth.uid()));
CREATE POLICY "Admins can update all profiles" ON public.profiles
    FOR UPDATE
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Admins can view all profiles" ON public.profiles
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = id))
    WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = id));
CREATE POLICY "Admin read rework logs" ON public.rework_logs
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admin read sales history" ON public.sales_history
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Users can delete own saved partners" ON public.saved_partners
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can save partners" ON public.saved_partners
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view own saved partners" ON public.saved_partners
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Public read styles" ON public.styles
    FOR SELECT
    TO PUBLIC
    USING (true);
CREATE POLICY "Service write styles" ON public.styles
    FOR ALL
    TO PUBLIC
    USING ((auth.role() = 'service_role'::text));
CREATE POLICY subscriptions_admin_select ON public.subscriptions
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY subscriptions_owner_select ON public.subscriptions
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY theme_images_admin_all ON public.theme_images
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
CREATE POLICY theme_images_public_read ON public.theme_images
    FOR SELECT
    TO PUBLIC
    USING (((status = 'approved'::text) AND is_active));
CREATE POLICY "admin credits" ON public.user_credits
    FOR SELECT
    TO PUBLIC
    USING (public.is_admin());
CREATE POLICY "own credits" ON public.user_credits
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own images" ON public.user_images
    FOR DELETE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own images" ON public.user_images
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own images" ON public.user_images
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own images" ON public.user_images
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = user_id));
CREATE POLICY "Service role can insert profiles" ON public.user_profiles
    FOR INSERT
    TO PUBLIC
    WITH CHECK (true);
CREATE POLICY "Users can update own profile" ON public.user_profiles
    FOR UPDATE
    TO PUBLIC
    USING ((auth.uid() = id));
CREATE POLICY "Users can view own profile" ON public.user_profiles
    FOR SELECT
    TO PUBLIC
    USING ((auth.uid() = id));
CREATE POLICY "Admins read work applications" ON public.work_applications
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read work assignments" ON public.work_assignments
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read work job events" ON public.work_job_events
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read work jobs" ON public.work_jobs
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read work photos" ON public.work_photos
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Owner or admin read work reports" ON public.work_reports
    FOR SELECT
    TO authenticated
    USING (((owner_id = auth.uid()) OR public.is_admin()));
CREATE POLICY "Admins read work reviews" ON public.work_reviews
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read work updates" ON public.work_updates
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read worker events" ON public.worker_events
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read worker invites" ON public.worker_invites
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins read workers" ON public.workers
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

-- ------------------------------------------------------------
-- 권한 (테이블 · 뷰 · 시퀀스)
-- ------------------------------------------------------------

REVOKE ALL ON TABLE public.admin_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.admin_logs TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_roles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.admin_roles TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.appliance_models FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.appliance_models TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cash_balances FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.cash_balances TO authenticated, service_role;
REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.chat_messages TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.collection_inquiries FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.collection_inquiries TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.collection_likes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.collection_likes TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.collection_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.collection_posts TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.consultations FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.consultations TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.counterparties FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.counterparties TO authenticated, service_role;
REVOKE ALL ON TABLE public.credit_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.credit_costs TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.credit_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.credit_ledger TO anon, authenticated;
GRANT ALL ON TABLE public.credit_ledger TO service_role;
REVOKE ALL ON TABLE public.credit_plans FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.credit_plans TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_category_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_category_stats TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_chunks FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_chunks TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_color_hex FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_color_hex TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_color_hex_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_color_hex_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_fridge_models FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_fridge_models TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_fridge_models_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_fridge_models_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_material_formulas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_material_formulas TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_material_formulas_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_material_formulas_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_rules_numeric FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_rules_numeric TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_rules_numeric_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_rules_numeric_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_search_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_search_logs TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_search_logs_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_search_logs_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dadam_triggers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dadam_triggers TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dadam_triggers_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.dadam_triggers_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dataset_chains FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dataset_chains TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dataset_exportable FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dataset_exportable TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dataset_ingest_state FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dataset_ingest_state TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dataset_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dataset_reviews TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.dataset_samples FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.dataset_samples TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_cad_artifacts FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_cad_artifacts TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_documents TO authenticated, service_role;
REVOKE ALL ON TABLE public.design_embeddings FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_embeddings TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_feedback TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_items FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_items TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_renders FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_renders TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_rules TO anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.design_rules_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.design_rules_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.design_schedules FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_schedules TO authenticated, service_role;
REVOKE ALL ON TABLE public.design_site_info FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_site_info TO authenticated, service_role;
REVOKE ALL ON TABLE public.design_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.design_snapshots TO authenticated, service_role;
REVOKE ALL ON TABLE public.designs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.designs TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.detail_design_approval_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.detail_design_approval_requests TO authenticated, service_role;
REVOKE ALL ON TABLE public.document_access_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.document_access_log TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.document_access_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.document_access_log_id_seq TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.expert_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.expert_requests TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.furniture_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.furniture_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.furniture_options FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.furniture_options TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.generations FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.generations TO service_role;
REVOKE ALL ON TABLE public.genome_seed_panel FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.genome_seed_panel TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.install_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.install_feedback TO authenticated, service_role;
REVOKE ALL ON TABLE public.lora_models FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.lora_models TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.materials FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.materials TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.okrs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.okrs TO authenticated, service_role;
REVOKE ALL ON TABLE public.order_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.order_costs TO authenticated, service_role;
REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.order_payments TO authenticated, service_role;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.orders TO authenticated, service_role;
REVOKE ALL ON TABLE public.partners FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.partners TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payment_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.payment_events TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payment_history FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.payment_history TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.planner_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.planner_snapshots TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pricing_rule_sets FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.pricing_rule_sets TO authenticated, service_role;
REVOKE ALL ON TABLE public.pricing_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.pricing_rules TO authenticated, service_role;
REVOKE ALL ON TABLE public.production_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.production_assignments TO authenticated, service_role;
REVOKE ALL ON TABLE public.production_proposals FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.production_proposals TO authenticated, service_role;
REVOKE ALL ON TABLE public.production_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.production_settings TO authenticated, service_role;
REVOKE ALL ON TABLE public.production_worker_links FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.production_worker_links TO authenticated, service_role;
REVOKE ALL ON TABLE public.production_worklogs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.production_worklogs TO authenticated, service_role;
REVOKE ALL ON TABLE public.profile_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profile_stats TO authenticated, service_role;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.reference_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reference_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rework_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.rework_logs TO authenticated, service_role;
REVOKE ALL ON TABLE public.sales_history FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.sales_history TO authenticated, service_role;
REVOKE ALL ON TABLE public.saved_partners FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.saved_partners TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.slack_notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.slack_notifications TO authenticated, service_role;
REVOKE ALL ON TABLE public.styles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.styles TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.subscriptions TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.theme_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.theme_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_credits FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_credits TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_images FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_images TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_profiles TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.work_applications FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_applications TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_assignments TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_job_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_job_events TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_jobs TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_photos TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_reports FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_reports TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_reviews TO authenticated, service_role;
REVOKE ALL ON TABLE public.work_updates FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.work_updates TO authenticated, service_role;
REVOKE ALL ON TABLE public.worker_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.worker_events TO authenticated, service_role;
REVOKE ALL ON TABLE public.worker_invites FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.worker_invites TO authenticated, service_role;
REVOKE ALL ON TABLE public.worker_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.worker_notes TO authenticated, service_role;
REVOKE ALL ON TABLE public.workers FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.workers TO authenticated, service_role;

-- ------------------------------------------------------------
-- 권한 (열 단위)
-- ------------------------------------------------------------

GRANT SELECT (id, user_id, delta, reason, refunded, balance_after, created_at) ON TABLE public.credit_ledger TO authenticated;
GRANT SELECT (id, user_id, parent_id, status, progress, step_label, error, category, title, options, inputs, wall_analysis, quote, images, model, elapsed_ms, credit_cost, is_favorite, share_expires_at, share_revoked_at, created_at, updated_at, completed_at, layout, consent_training) ON TABLE public.generations TO authenticated;
GRANT UPDATE (title, is_favorite, consent_training) ON TABLE public.generations TO authenticated;

-- ------------------------------------------------------------
-- 권한 (함수)
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.apply_dataset_review() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_dataset_review() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_expert(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_expert(uuid,uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_self_dd_approval() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_self_dd_approval() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_self_tier_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_self_tier_change() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.collection_posts_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_posts_touch_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultation_generation_ok(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultation_generation_ok(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_credit(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit(text) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.dsched_track_times() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dsched_track_times() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.generations_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generations_touch_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.genome_seed_panel_touch() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.genome_seed_panel_touch() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_ai_design_rules(character varying) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_design_rules(character varying) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_fridge_models(character varying,character varying,character varying) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fridge_models(character varying,character varying,character varying) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_furniture_options(text[],text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_furniture_options(text[],text) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_material_formulas(character varying) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_material_formulas(character varying) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_materials_catalog() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_materials_catalog() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_rules_by_category(character varying,character varying) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rules_by_category(character varying,character varying) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_dataset_samples_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_dataset_samples_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_planner_snapshots_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_planner_snapshots_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_user_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_user_update() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_appliance_models(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_appliance_models(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.quick_trigger_search(text[],text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quick_trigger_search(text[],text,integer) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refund_credit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_credit(uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refund_credit_svc(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_credit_svc(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.reset_credits_on_tier_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_credits_on_tier_change() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_furniture_by_category(text,text,boolean,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_furniture_by_category(text,text,boolean,integer) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_furniture_by_embedding(public.vector,text,integer,double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_furniture_by_embedding(public.vector,text,integer,double precision) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_orders_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_orders_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_site_info_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_site_info_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.subscriptions_detach_on_withdrawal() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.subscriptions_detach_on_withdrawal() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_appliance_models_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_appliance_models_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_category_stats() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_category_stats() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_design_stats() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_design_stats() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_furniture_images_timestamp() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_furniture_images_timestamp() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_like_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_like_count() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_partners_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_partners_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_chunk(character varying,text,character varying,character varying,character varying,character varying,text[],text[],jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_chunk(character varying,text,character varying,character varying,character varying,character varying,text[],text[],jsonb) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wf_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_touch_updated_at() TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawal_designs(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_designs(uuid) TO service_role;

-- ------------------------------------------------------------
-- 설명 (COMMENT)
-- ------------------------------------------------------------

COMMENT ON TABLE public.appliance_models IS '가전 모델 카탈로그 (냉장고/후드/식세기/싱크볼/쿡탑) — 도면 배치 W/D/H · 상판 타공 참조';
COMMENT ON COLUMN public.appliance_models.category IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine | microwave | rice_cooker | range | faucet';
COMMENT ON COLUMN public.appliance_models.width_mm IS '도면 가로 (mm)';
COMMENT ON COLUMN public.appliance_models.depth_mm IS '도면 깊이 = 평면도 세로 (mm), 후면 핸들 포함';
COMMENT ON COLUMN public.appliance_models.height_mm IS '3D 모듈 높이 (mm)';
COMMENT ON COLUMN public.appliance_models.verified IS 'true=제조사 공식 사양 / false=카테고리 표준 추정';
COMMENT ON COLUMN public.appliance_models.cutout_w_mm IS '상판 타공 가로(mm) — 싱크볼·쿡탑. 상판 발주 요청서에 그대로 실린다';
COMMENT ON COLUMN public.appliance_models.cutout_d_mm IS '상판 타공 세로(mm)';
COMMENT ON COLUMN public.appliance_models.cutout_r_mm IS '상판 타공 모서리 R(mm), 0 이면 각';
COMMENT ON COLUMN public.appliance_models.faucet_hole_mm IS '수전 타공 지름(mm) — 싱크볼 모델에 적는다';
COMMENT ON COLUMN public.appliance_models.subtype IS '세부 구분 — 종류별 목록은 appliance_models_subtype_chk (database/appliance-models-kitchen.sql)';
COMMENT ON COLUMN public.appliance_models.line IS '제품 라인 — BESPOKE · 키친핏 · 인피니트 · 오브제컬렉션 · 핏앤맥스 · 디오스 …';
COMMENT ON COLUMN public.appliance_models.install_type IS 'freestanding(일반) | kitchen_fit(가구 깊이 맞춤) | built_in(가구 도어 부착)';
COMMENT ON COLUMN public.appliance_models.model_codes IS '크기가 같은 모든 모델 코드 (색상 · 마감 변형). model_code 는 대표 코드';
COMMENT ON COLUMN public.appliance_models.back_gap_mm IS '설치 여유 — 뒤 (mm). 제조사가 공개한 경우만';
COMMENT ON COLUMN public.appliance_models.discontinued IS '단종 — 목록에서 사라진 모델. 지우지 않는다 (예전 설계가 가리킨다)';
COMMENT ON COLUMN public.appliance_models.collected_at IS '수집기가 마지막으로 제조사 공식 값을 확인한 때';
COMMENT ON COLUMN public.appliance_models.niche_min_w_mm IS '빌트인 장 안쪽 치수(니치) 폭 — 제조사 권장 공간 · 설치 공간. 한 값이면 여기만, 범위면 최소';
COMMENT ON COLUMN public.appliance_models.niche_min_h_mm IS '니치 높이 (최소 또는 한 값)';
COMMENT ON COLUMN public.appliance_models.niche_min_d_mm IS '니치 깊이 (최소 또는 한 값)';
COMMENT ON COLUMN public.appliance_models.niche_max_w_mm IS '니치 폭 최대 — 제조사가 범위로 줄 때만';
COMMENT ON COLUMN public.appliance_models.niche_max_h_mm IS '니치 높이 최대 — 범위일 때만';
COMMENT ON COLUMN public.appliance_models.niche_max_d_mm IS '니치 깊이 최대 — 범위일 때만';
COMMENT ON COLUMN public.appliance_models.image_source_url IS '제조사 제품 사진 원본 주소 (수집기). 생성에는 직접 쓰지 않는다 — 관리자가 가져와야 image_path 가 생긴다';
COMMENT ON COLUMN public.appliance_models.image_path IS '버킷 appliance-images 안 경로 ({id}/photo.ext). 있으면 연출컷 생성 때 이 냉장고의 참고 이미지';
COMMENT ON COLUMN public.appliance_models.image_approved_at IS '관리자가 사진을 가져온(승인한) 때';
COMMENT ON COLUMN public.appliance_models.image_approved_by IS '사진을 가져온 관리자';
COMMENT ON COLUMN public.appliance_models.gas_types IS '가스 쿡탑 · 가스오븐레인지가 쓸 수 있는 가스 — LNG(도시가스) · LPG. 제조사가 적은 것만';
COMMENT ON TABLE public.cash_balances IS '통장 잔액 기록 — 13주 현금흐름의 시작점';
COMMENT ON COLUMN public.consultations.privacy_agreed_at IS '상담 신청 개인정보 수집·이용 동의 시각';
COMMENT ON TABLE public.counterparties IS '장부용 거래처(partner) · 공급처(supplier). 관리자만. 공개 파트너 디렉터리(partners)와 별개';
COMMENT ON VIEW public.dataset_chains IS '시공 완료된 현장 단위 학습 묶음. ①연출컷 ②도면 ③완성사진 ④피드백이 design_id 하나로 묶인다.';
COMMENT ON COLUMN public.design_schedules.started_at IS 'CD-6 실제 착수 시각. scheduled_at(예정)과 다르다 — 리드타임 학습의 실측값.';
COMMENT ON COLUMN public.design_schedules.completed_at IS '완료로 바꾼 시각 — 완료가 아니게 되면 비운다 (리드타임의 기준)';
COMMENT ON COLUMN public.design_schedules.planned_at IS '처음 잡은 날 — 일정을 미뤄도 바뀌지 않는다 (납기 준수의 기준)';
COMMENT ON TABLE public.design_site_info IS 'CD-4 현장 정보. 설치 작업지시서의 입력. 연락처를 담으므로 공유 문서에 싣지 않는다.';
COMMENT ON COLUMN public.design_site_info.has_elevator IS 'NULL=미확인 / true=있음 / false=없음. 미확인과 없음을 구분해야 사다리차 판단이 된다.';
COMMENT ON COLUMN public.design_snapshots.cut_plan_payload IS 'B4 재단 배치 (js/detaildesign/nesting-engine.js NestingEngine.plan, version 1). 시트별 partId#k 절대 좌표·회전·잔재. NULL = 배치 없음.';
COMMENT ON COLUMN public.design_snapshots.sheet_count IS 'B4 원판 장수 = cut_plan_payload.sheets 길이 (워커 파생, 겹침 재단도 낱장). NULL = 배치 없음.';
COMMENT ON COLUMN public.furniture_options.texture_url IS 'Tileable texture image URL for Canvas createPattern() rendering. Stored in Supabase Storage option-images/textures/';
COMMENT ON COLUMN public.generations.layout IS '연출컷 구성 분석 (Claude 비전). 형식은 workers/generate-api/src/layout.js normalizeLayout';
COMMENT ON TABLE public.install_feedback IS '설치 후 소개 의향 0~10. 수주 하나에 하나';
COMMENT ON COLUMN public.materials.code IS '마감 코드 정본. 도어 {FINISH}-{COLOR}[-{M|G}], 상판 TOP-{XXX}. 이름 변경 금지 (I6)';
COMMENT ON COLUMN public.materials.slot IS '적용 부위: door / drawer_front / body / top / handle / finishing / kick';
COMMENT ON COLUMN public.materials.texture_url IS '자재 무늬 타일(저장소 상대경로 assets/materials/yerim/<code>.jpg)';
COMMENT ON COLUMN public.materials.tile_mm IS '텍스처 타일 한 장이 덮는 실제 크기(mm)';
COMMENT ON COLUMN public.materials.price_key IS 'pricing_rules / FINISH_BASE_PRICE 연결 키. 가격 자체는 여기 두지 않는다';
COMMENT ON COLUMN public.materials.vendor_code IS '실제 발주(업체) 코드. code 와 다를 수 있다';
COMMENT ON COLUMN public.materials.vendor IS '자재 공급사 식별자 (예: yerim)';
COMMENT ON COLUMN public.materials.series IS '공급사 라인업 (예: Prestige / Supreme / Deco / Prime / Body)';
COMMENT ON COLUMN public.materials.source_url IS '공급사 제품 페이지';
COMMENT ON COLUMN public.materials.image_url IS '공급사 스와치 이미지(외부 링크, 참고용)';
COMMENT ON TABLE public.okrs IS '분기 목표 — metric 은 대시보드 숫자 이름(워커 OKR_METRICS) 또는 manual';
COMMENT ON TABLE public.order_costs IS 'CD-5/CD-6 실적 원가. 견적 대비 실제를 학습하려면 항목이 견적과 같은 축으로 나뉘어야 한다.';
COMMENT ON COLUMN public.order_costs.counterparty_id IS '돈을 낸 공급처. vendor_name 은 예전 자유 입력 — 남겨 둔다';
COMMENT ON COLUMN public.order_costs.due_on IS '지급 예정일. spent_on 이 비어 있으면 아직 안 낸 돈';
COMMENT ON TABLE public.order_payments IS '수금 일정 — 계약금 · 중도금 · 잔금. paid_on 이 비면 미수';
COMMENT ON TABLE public.orders IS 'CD-5 수주. 승인된 고객 확인서 1건 = 수주 1건. document_id UNIQUE 로 중복 전환을 DB 가 막는다.';
COMMENT ON COLUMN public.orders.snapshot_id IS '계약 시점 설계. 이후 설계를 고쳐도 계약 내용은 이 스냅샷이다.';
COMMENT ON COLUMN public.orders.price_tier IS '고객(customer) · 거래처(partner). 수주 때 확인서 금액 종류를 옮기고 erp.html 에서 고친다. NULL 이면 계약금으로 짐작한다';
COMMENT ON COLUMN public.orders.partner_id IS '주문한 거래처(인테리어 업체). price_tier = partner 인 수주에 붙인다';
COMMENT ON COLUMN public.profiles.terms_agreed_at IS '이용약관 동의 시각';
COMMENT ON COLUMN public.profiles.privacy_agreed_at IS '개인정보처리방침 동의 시각';
COMMENT ON COLUMN public.profiles.age_confirmed_at IS '만 14세 이상 확인 시각';
COMMENT ON COLUMN public.profiles.marketing_agreed_at IS '마케팅 수신 동의 시각 (NULL = 동의 안 함)';
COMMENT ON COLUMN public.profiles.marketing_withdrawn_at IS '마케팅 수신 동의를 마지막으로 철회한 시각';
COMMENT ON TABLE public.rework_logs IS '재작업(공장) · A/S(설치 뒤). 원인 · 분 · 비용 — 품질비용과 A/S 율의 재료';
COMMENT ON TABLE public.sales_history IS '과거 월 매출(VAT 제외) — 계절 지수 · 수주 예측. 달의 1일로 적는다';
COMMENT ON TABLE public.user_images IS '사용자 이미지 메타데이터 (현장 사진, AI 생성 이미지)';
COMMENT ON COLUMN public.user_images.image_type IS 'site_photo: 현장 사진, ai_generated: AI 생성 이미지';
COMMENT ON COLUMN public.user_images.door_state IS 'AI 생성 이미지의 도어 상태 (closed/open)';
COMMENT ON TABLE public.work_jobs IS '작업자 포털 작업. 주소 · 연락처 · 고객 실명 칸이 없다 (현장 정보는 공개 기간 결정 전까지 내보내지 않는다). version 은 낙관적 잠금.';
COMMENT ON TABLE public.work_reports IS '작업 지시 보고 보관함. 보고가 생길 때 Worker 가 동결해 쌓는다. 지우지 않는다 — archived_at 으로 숨김.';
COMMENT ON TABLE public.work_updates IS '작업 기록 — 작업자 보고(progress · issue · result)와 회사 정정 · 메모(correction · note). 추가만 한다. 정정은 amends_id 로 원본을 가리킨다.';
COMMENT ON TABLE public.worker_events IS '작업자 가입 · 상태 · 종류 변경 이력. 추가만 한다. payload 에 이름 · 연락처 · 주소를 넣지 않는다.';
COMMENT ON TABLE public.worker_invites IS '작업자 초대 링크. 평문 토큰은 발급 응답에만 있고 여기엔 해시만. 1회용 — used_at 이 찍히면 끝.';
COMMENT ON TABLE public.workers IS '작업자 자격. profiles · admin_roles 와 따로 둔다. 주민번호 · 계좌는 받지 않는다.';

-- ------------------------------------------------------------
-- storage 버킷
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ad', 'ad', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('appliance-images', 'appliance-images', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cad', 'cad', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('collection', 'collection', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('datasets', 'datasets', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('design-images', 'design-images', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fridge-refs', 'fridge-refs', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('furniture-images', 'furniture-images', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('generations', 'generations', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reference-images', 'reference-images', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('renders', 'renders', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('theme-images', 'theme-images', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('training-zips', 'training-zips', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 정책 (storage)
-- ------------------------------------------------------------

CREATE POLICY appliance_images_obj_delete ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'appliance-images'::text) AND public.is_admin()));
CREATE POLICY appliance_images_obj_insert ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (((bucket_id = 'appliance-images'::text) AND public.is_admin()));
CREATE POLICY appliance_images_obj_read ON storage.objects
    FOR SELECT
    TO PUBLIC
    USING ((bucket_id = 'appliance-images'::text));
CREATE POLICY appliance_images_obj_update ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (((bucket_id = 'appliance-images'::text) AND public.is_admin()))
    WITH CHECK (((bucket_id = 'appliance-images'::text) AND public.is_admin()));
CREATE POLICY cad_select_admin ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'cad'::text) AND (EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid())))));
CREATE POLICY collection_delete_admin ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'collection'::text) AND public.is_admin()));
CREATE POLICY collection_delete_own ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'collection'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY collection_insert_own ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (((bucket_id = 'collection'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY collection_select_public ON storage.objects
    FOR SELECT
    TO PUBLIC
    USING ((bucket_id = 'collection'::text));
CREATE POLICY collection_update_own ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (((bucket_id = 'collection'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
    WITH CHECK (((bucket_id = 'collection'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "design-images_delete_own" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'design-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "design-images_insert_own" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (((bucket_id = 'design-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "design-images_select_admin" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'design-images'::text) AND public.is_admin()));
CREATE POLICY "design-images_select_own" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'design-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "design-images_update_own" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (((bucket_id = 'design-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "furniture-images_select_public" ON storage.objects
    FOR SELECT
    TO PUBLIC
    USING ((bucket_id = 'furniture-images'::text));
CREATE POLICY generations_objects_select_admin ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'generations'::text) AND public.is_admin()));
CREATE POLICY generations_objects_select_own ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'generations'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY renders_delete_own ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'renders'::text) AND (EXISTS ( SELECT 1
   FROM public.designs d
  WHERE (((d.id)::text = (storage.foldername(d.name))[1]) AND (d.user_id = auth.uid()))))));
CREATE POLICY renders_insert_own ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (((bucket_id = 'renders'::text) AND (EXISTS ( SELECT 1
   FROM public.designs d
  WHERE (((d.id)::text = (storage.foldername(d.name))[1]) AND (d.user_id = auth.uid()))))));
CREATE POLICY renders_select_admin ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'renders'::text) AND (EXISTS ( SELECT 1
   FROM public.admin_roles
  WHERE (admin_roles.user_id = auth.uid())))));
CREATE POLICY renders_select_own ON storage.objects
    FOR SELECT
    TO authenticated
    USING (((bucket_id = 'renders'::text) AND (EXISTS ( SELECT 1
   FROM public.designs d
  WHERE (((d.id)::text = (storage.foldername(d.name))[1]) AND (d.user_id = auth.uid()))))));
CREATE POLICY theme_images_obj_delete ON storage.objects
    FOR DELETE
    TO authenticated
    USING (((bucket_id = 'theme-images'::text) AND public.is_admin()));
CREATE POLICY theme_images_obj_insert ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (((bucket_id = 'theme-images'::text) AND public.is_admin()));
CREATE POLICY theme_images_obj_read ON storage.objects
    FOR SELECT
    TO PUBLIC
    USING ((bucket_id = 'theme-images'::text));
CREATE POLICY theme_images_obj_update ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (((bucket_id = 'theme-images'::text) AND public.is_admin()))
    WITH CHECK (((bucket_id = 'theme-images'::text) AND public.is_admin()));

-- ------------------------------------------------------------
-- Supabase 관리 테이블에 건 트리거 (public 함수)
-- ------------------------------------------------------------

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_user_update();

-- ------------------------------------------------------------
-- 이벤트 트리거 (public 함수)
-- ------------------------------------------------------------

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE FUNCTION public.rls_auto_enable();
