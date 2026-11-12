-- =============================================
-- 0027 — 회계장부 바탕 (Agent 업체)
--
-- 한 돈은 한 표에만 둔다 — 장부는 세 곳을 합쳐 보여 준다 (ledger_book).
--   수주 수금    order_payments (받은 날 paid_on). 일반과세 업체는 공급가 = round(금액 ÷ 1.1), 부가세 = 나머지(계산값)
--   수주 원가    order_costs (낸 날 spent_on) + 새 칸 vat_amount(공제되는 부가세, NULL = 옛 줄 미기재) · evidence_type
--   수주 밖 돈   ledger_entries (새 표 — order_id 가 없다. 임대료 · 소모품 · 차량 등)
--
-- 표 (모두 RLS 켬, 정책 없음, 서버 service_role 만 — 화면은 workflow-api 를 거친다)
--   ledger_accounts       계정 목록 — 소득세법 시행규칙 별지 제74호서식 부표(총수입금액 및 필요경비명세서) 항목 그대로.
--                         grp income(수입) · purchase(매입) · manufacturing(제조비용) · admin(일반관리비) · asset(사업용 자산)
--   ledger_cost_accounts  수주 원가 종류 → 계정. 업체 업종(company_settings.settings.tax.business_kind:
--                         manufacturing 제조 | retail 도소매)에 따라. 노무 · 외주는 아직 잇지 않는다(세무사 확인 뒤)
--   ledger_documents      영수증 · 거래명세표 사진. 비공개 버킷 ledger-evidence. 같은 업체에 같은 파일(sha256)은 하나.
--                         review_status pending(확인 기다림) · posted(장부에 올림) · returned(돌려보냄) · rejected(버림)
--                         · skipped_budget(한도로 읽지 못함). 지우지 않는다. 파일 · 올린 사람 칸은 고치지 않는다
--   ledger_entries        장부 줄. 입력 차례 seq. direction income · expense · asset_buy(자산 사기) · asset_sell(자산 팔기).
--                         amount = 실제 부담 금액(공제되는 부가세 뺌), vat_amount = 공제되는 부가세만.
--                         지우지 않는다 — 취소 칸(voided_*)만 한 번 적는다. 고치기는 취소 + 새 줄(replaces_id)
--   ledger_evidence       사진 ↔ 장부 줄 또는 원가 줄 (primary · supporting). 원가 줄이 지워져 사진에 남은 연결이 없으면
--                         그 사진은 pending 으로 돌아간다
--   ledger_events         바꾼 기록 — 장부 표 셋과 order_costs · order_payments 의 넣기 · 고치기 · 지우기를 옛 값 · 새 값으로.
--                         덧붙이기만. 바꾼 사람은 요청 머리 x-actor-id(없으면 토큰 sub)
--
-- 칸 더하기
--   counterparties  biz_no(사업자등록번호 10자리) · tax_type(국세청 과세 유형 글) · nts_status(active 계속 · suspended 휴업
--                   · closed 폐업 · unregistered 미등록) · nts_checked_at. 같은 업체 안 사업자번호는 하나
--   order_costs     vat_amount · evidence_type
--
-- 함수 (서버만)
--   ledger_book(업체, 시작일, 끝일, 취소 줄도)   세 곳을 합친 장부 줄
--   ledger_post_document(사진, 사람, 내용)       확인한 사진을 장부 줄 · 원가 줄로 올리거나 이미 있는 줄에 붙인다 — 한 번만
--   ledger_move_to_order(장부 줄, 수주, 사람, 원가 종류, 이유)  장부 줄 취소 + 그 수주 원가 줄 + 사진 연결 옮기기
--   ledger_correct_entry(장부 줄, 사람, 새 내용, 이유)           취소 + 새 줄(replaces_id) + 사진 연결 옮기기
--
-- 다시 돌려도 된다.
-- =============================================

-- 1) 계정 ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
    code text NOT NULL,
    name text NOT NULL,
    grp text NOT NULL,
    sort integer NOT NULL,
    note text,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT ledger_accounts_pkey PRIMARY KEY (code),
    CONSTRAINT ledger_accounts_code_check CHECK (code ~ '^[a-z]+\.[a-z_]+$'),
    CONSTRAINT ledger_accounts_grp_check CHECK (grp = ANY (ARRAY['income'::text, 'purchase'::text, 'manufacturing'::text, 'admin'::text, 'asset'::text])),
    CONSTRAINT ledger_accounts_len_check CHECK ((length(name) BETWEEN 1 AND 40) AND ((note IS NULL) OR (length(note) <= 200)))
);

COMMENT ON TABLE public.ledger_accounts IS '장부 계정 — 소득세법 시행규칙 별지 제74호서식 부표 항목 그대로. 서버만';

INSERT INTO public.ledger_accounts (code, name, grp, sort, note) VALUES
    ('income.sales', '매출액', 'income', 10, NULL),
    ('income.other', '기타', 'income', 20, NULL),
    ('purchase.goods', '상품매입', 'purchase', 30, '도소매'),
    ('purchase.materials', '재료비 매입', 'purchase', 40, '제조'),
    ('manufacturing.labor', '노무비', 'manufacturing', 50, '제조원가명세서를 쓰는 제조업'),
    ('manufacturing.expense', '경비', 'manufacturing', 60, '제조원가명세서를 쓰는 제조업'),
    ('admin.salary', '급료', 'admin', 100, NULL),
    ('admin.taxes', '제세공과금', 'admin', 110, NULL),
    ('admin.rent', '임차료', 'admin', 120, NULL),
    ('admin.interest', '지급이자', 'admin', 130, NULL),
    ('admin.entertainment', '접대비', 'admin', 140, NULL),
    ('admin.donation', '기부금', 'admin', 150, NULL),
    ('admin.depreciation', '감가상각비', 'admin', 160, NULL),
    ('admin.vehicle', '차량유지비', 'admin', 170, NULL),
    ('admin.fees', '지급수수료', 'admin', 180, NULL),
    ('admin.supplies', '소모품비', 'admin', 190, NULL),
    ('admin.welfare', '복리후생비', 'admin', 200, NULL),
    ('admin.freight', '운반비', 'admin', 210, NULL),
    ('admin.advertising', '광고선전비', 'admin', 220, NULL),
    ('admin.travel', '여비교통비', 'admin', 230, NULL),
    ('admin.other', '기타', 'admin', 240, NULL),
    ('asset.tangible', '유형자산', 'asset', 300, NULL),
    ('asset.intangible', '무형자산', 'asset', 310, NULL)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ledger_cost_accounts (
    category text NOT NULL,
    business_kind text NOT NULL,
    account text NOT NULL,
    CONSTRAINT ledger_cost_accounts_pkey PRIMARY KEY (category, business_kind),
    CONSTRAINT ledger_cost_accounts_category_check CHECK (category = ANY (ARRAY['material'::text, 'hardware'::text, 'labor'::text, 'outsourcing'::text, 'logistics'::text, 'other'::text])),
    CONSTRAINT ledger_cost_accounts_kind_check CHECK (business_kind = ANY (ARRAY['manufacturing'::text, 'retail'::text, 'any'::text])),
    CONSTRAINT ledger_cost_accounts_account_fkey FOREIGN KEY (account) REFERENCES public.ledger_accounts(code)
);

COMMENT ON TABLE public.ledger_cost_accounts IS '수주 원가 종류 → 장부 계정. 업종(manufacturing · retail)마다, any 는 업종 무관. 서버만';

INSERT INTO public.ledger_cost_accounts (category, business_kind, account) VALUES
    ('material', 'manufacturing', 'purchase.materials'),
    ('material', 'retail', 'purchase.goods'),
    ('hardware', 'manufacturing', 'purchase.materials'),
    ('hardware', 'retail', 'purchase.goods'),
    ('logistics', 'any', 'admin.freight'),
    ('other', 'any', 'admin.other')
ON CONFLICT (category, business_kind) DO NOTHING;

-- 2) 거래처 · 원가 칸 ---------------------------------------------------------------

ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS biz_no text;
ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS tax_type text;
ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS nts_status text;
ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS nts_checked_at timestamp with time zone;

ALTER TABLE public.counterparties DROP CONSTRAINT IF EXISTS counterparties_biz_check;
ALTER TABLE public.counterparties ADD CONSTRAINT counterparties_biz_check CHECK (
    ((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$'))
    AND ((tax_type IS NULL) OR (length(tax_type) <= 60))
    AND ((nts_status IS NULL) OR (nts_status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text, 'unregistered'::text]))));

CREATE UNIQUE INDEX IF NOT EXISTS counterparties_company_biz_no ON public.counterparties USING btree (company_id, biz_no) WHERE (biz_no IS NOT NULL);

COMMENT ON COLUMN public.counterparties.biz_no IS '사업자등록번호 10자리 (숫자만). 같은 업체 안에서 하나';
COMMENT ON COLUMN public.counterparties.nts_status IS '국세청 사업자 상태 — active 계속 · suspended 휴업 · closed 폐업 · unregistered 미등록 (nts_checked_at 에 조회)';

ALTER TABLE public.order_costs ADD COLUMN IF NOT EXISTS vat_amount bigint;
ALTER TABLE public.order_costs ADD COLUMN IF NOT EXISTS evidence_type text;

ALTER TABLE public.order_costs DROP CONSTRAINT IF EXISTS order_costs_vat_check;
ALTER TABLE public.order_costs ADD CONSTRAINT order_costs_vat_check CHECK (
    ((vat_amount IS NULL) OR (vat_amount >= 0))
    AND ((evidence_type IS NULL) OR (evidence_type = ANY (ARRAY['tax_invoice'::text, 'invoice'::text, 'card'::text, 'cash_receipt'::text, 'simple_receipt'::text, 'statement'::text, 'other'::text, 'none'::text]))));

COMMENT ON COLUMN public.order_costs.vat_amount IS '공제되는 부가세 — amount 는 공급가. NULL 은 옛 줄(미기재)';
COMMENT ON COLUMN public.order_costs.evidence_type IS '증빙 — tax_invoice 세금계산서 · invoice 계산서 · card 카드 · cash_receipt 현금영수증 · simple_receipt 간이영수증 · statement 거래명세표 · other · none';

-- 3) 사진 문서 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    uploaded_by uuid NOT NULL,
    storage_path text NOT NULL,
    mime text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    width integer,
    height integer,
    note text,
    idempotency_key text,
    review_status text DEFAULT 'pending'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_documents_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_documents_path_key UNIQUE (storage_path),
    CONSTRAINT ledger_documents_mime_check CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text])),
    CONSTRAINT ledger_documents_size_check CHECK ((size_bytes BETWEEN 1 AND 5242880) AND ((width IS NULL) OR (width > 0)) AND ((height IS NULL) OR (height > 0))),
    CONSTRAINT ledger_documents_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ledger_documents_len_check CHECK ((length(storage_path) BETWEEN 1 AND 300) AND ((note IS NULL) OR (length(note) <= 300)) AND ((decision_reason IS NULL) OR (length(decision_reason) <= 300)) AND ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200))),
    CONSTRAINT ledger_documents_status_check CHECK (review_status = ANY (ARRAY['pending'::text, 'posted'::text, 'returned'::text, 'rejected'::text, 'skipped_budget'::text])),
    CONSTRAINT ledger_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

COMMENT ON TABLE public.ledger_documents IS '영수증 · 거래명세표 사진 — 비공개 버킷 ledger-evidence. 지우지 않는다. 올린 사람은 id 로만 남는다(계정을 지워도). 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS ledger_documents_company_sha ON public.ledger_documents USING btree (company_id, sha256);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_documents_company_idem ON public.ledger_documents USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_documents_company_status ON public.ledger_documents USING btree (company_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_documents_uploader ON public.ledger_documents USING btree (uploaded_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_ledger_documents_touch ON public.ledger_documents;
CREATE TRIGGER trg_ledger_documents_touch BEFORE UPDATE ON public.ledger_documents FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();

-- 4) 장부 줄 ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    seq bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    entry_date date NOT NULL,
    direction text NOT NULL,
    account text NOT NULL,
    description text,
    counterparty_id uuid,
    counterparty_name text,
    counterparty_biz_no text,
    amount bigint NOT NULL,
    vat_amount bigint DEFAULT 0 NOT NULL,
    evidence_type text NOT NULL,
    payment_method text,
    source text NOT NULL,
    created_by uuid NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    replaces_id uuid,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_entries_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_entries_seq_key UNIQUE (seq),
    CONSTRAINT ledger_entries_direction_check CHECK (direction = ANY (ARRAY['income'::text, 'expense'::text, 'asset_buy'::text, 'asset_sell'::text])),
    CONSTRAINT ledger_entries_amount_check CHECK ((amount > 0) AND (vat_amount >= 0)),
    CONSTRAINT ledger_entries_evidence_check CHECK (evidence_type = ANY (ARRAY['tax_invoice'::text, 'invoice'::text, 'card'::text, 'cash_receipt'::text, 'simple_receipt'::text, 'statement'::text, 'other'::text, 'none'::text])),
    CONSTRAINT ledger_entries_method_check CHECK ((payment_method IS NULL) OR (payment_method = ANY (ARRAY['transfer'::text, 'card'::text, 'cash'::text, 'other'::text]))),
    CONSTRAINT ledger_entries_source_check CHECK (source = ANY (ARRAY['manual'::text, 'photo'::text, 'import'::text])),
    CONSTRAINT ledger_entries_biz_check CHECK ((counterparty_biz_no IS NULL) OR (counterparty_biz_no ~ '^[0-9]{10}$')),
    CONSTRAINT ledger_entries_len_check CHECK (((description IS NULL) OR (length(description) <= 200)) AND ((counterparty_name IS NULL) OR (length(counterparty_name) <= 100)) AND ((void_reason IS NULL) OR (length(void_reason) <= 300)) AND ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200))),
    CONSTRAINT ledger_entries_void_check CHECK (((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL))),
    CONSTRAINT ledger_entries_replaces_check CHECK ((replaces_id IS NULL) OR (replaces_id <> id)),
    CONSTRAINT ledger_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT ledger_entries_account_fkey FOREIGN KEY (account) REFERENCES public.ledger_accounts(code),
    CONSTRAINT ledger_entries_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id),
    CONSTRAINT ledger_entries_replaces_id_fkey FOREIGN KEY (replaces_id) REFERENCES public.ledger_entries(id)
);

COMMENT ON TABLE public.ledger_entries IS '장부 줄 (수주 밖 돈) — 지우지 않는다. 취소 칸만 한 번, 고치기는 취소 + 새 줄(replaces_id). 수주 원가는 order_costs 에만. 서버만';
COMMENT ON COLUMN public.ledger_entries.amount IS '실제 부담 금액 — 공제되는 부가세는 vat_amount 로 나눈다. 공제되지 않으면 합계를 적고 vat_amount 0';

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_replaces_once ON public.ledger_entries USING btree (replaces_id) WHERE (replaces_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_company_idem ON public.ledger_entries USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_company_date ON public.ledger_entries USING btree (company_id, entry_date, seq);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_counterparty ON public.ledger_entries USING btree (counterparty_id) WHERE (counterparty_id IS NOT NULL);

-- 5) 증빙 연결 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    entry_id uuid,
    cost_id uuid,
    role text DEFAULT 'primary'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_evidence_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_evidence_target_check CHECK ((entry_id IS NULL) <> (cost_id IS NULL)),
    CONSTRAINT ledger_evidence_role_check CHECK (role = ANY (ARRAY['primary'::text, 'supporting'::text])),
    CONSTRAINT ledger_evidence_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT ledger_evidence_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.ledger_documents(id),
    CONSTRAINT ledger_evidence_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.ledger_entries(id),
    CONSTRAINT ledger_evidence_cost_id_fkey FOREIGN KEY (cost_id) REFERENCES public.order_costs(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.ledger_evidence IS '사진 ↔ 장부 줄 또는 원가 줄. 원가 줄이 지워져 연결이 하나도 없으면 사진은 pending 으로 돌아간다. 서버만';

CREATE UNIQUE INDEX IF NOT EXISTS ledger_evidence_doc_entry ON public.ledger_evidence USING btree (document_id, entry_id) WHERE (entry_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_evidence_doc_cost ON public.ledger_evidence USING btree (document_id, cost_id) WHERE (cost_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_evidence_entry ON public.ledger_evidence USING btree (entry_id) WHERE (entry_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_evidence_cost ON public.ledger_evidence USING btree (cost_id) WHERE (cost_id IS NOT NULL);

-- 6) 바꾼 기록 ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_events (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    company_id uuid,
    table_name text NOT NULL,
    row_id uuid NOT NULL,
    op text NOT NULL,
    old_row jsonb,
    new_row jsonb,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_events_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_events_table_check CHECK (table_name = ANY (ARRAY['ledger_documents'::text, 'ledger_entries'::text, 'ledger_evidence'::text, 'order_costs'::text, 'order_payments'::text])),
    CONSTRAINT ledger_events_op_check CHECK (op = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))
);

COMMENT ON TABLE public.ledger_events IS '장부 바꾼 기록 — 넣기 · 고치기 · 지우기의 옛 값 · 새 값 · 바꾼 사람. 트리거만 넣는다. 덧붙이기만. 서버는 읽기만';

CREATE INDEX IF NOT EXISTS idx_ledger_events_company ON public.ledger_events USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_events_row ON public.ledger_events USING btree (table_name, row_id, id);

-- 7) 트리거 — 지우지 않는 장부 · 기록 -----------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  BEGIN
    v := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor-id';
  EXCEPTION WHEN others THEN
    v := NULL;
  END;
  IF v IS NULL OR v !~ v_uuid THEN
    BEGIN
      v := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
    EXCEPTION WHEN others THEN
      v := NULL;
    END;
  END IF;
  IF v IS NULL OR v !~ v_uuid THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
END;
$function$;

COMMENT ON FUNCTION public.ledger_actor() IS '바꾼 사람 — PostgREST 요청 머리 x-actor-id, 없으면 토큰 sub. 둘 다 없으면 NULL';

REVOKE ALL ON FUNCTION public.ledger_actor() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_actor() TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME IN ('order_costs', 'order_payments') THEN
    SELECT o.company_id INTO v_company FROM public.orders o WHERE o.id = (v_row ->> 'order_id')::uuid;
  ELSE
    v_company := (v_row ->> 'company_id')::uuid;
  END IF;
  INSERT INTO public.ledger_events (company_id, table_name, row_id, op, old_row, new_row, actor)
  VALUES (v_company, TG_TABLE_NAME, (v_row ->> 'id')::uuid, lower(TG_OP),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
          public.ledger_actor());
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.ledger_audit() IS '장부 바꾼 기록 트리거 — ledger_documents · ledger_entries · ledger_evidence · order_costs · order_payments';

REVOKE ALL ON FUNCTION public.ledger_audit() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ledger_entries_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_void constant text[] := ARRAY['voided_at', 'voided_by', 'void_reason'];
  v_grp text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_entries are never deleted — void instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT a.grp INTO v_grp FROM public.ledger_accounts a WHERE a.code = NEW.account AND a.active;
    IF v_grp IS NULL THEN
      RAISE EXCEPTION 'unknown or inactive account %', NEW.account;
    END IF;
    IF NOT ((v_grp = 'income' AND NEW.direction = 'income')
            OR (v_grp IN ('purchase', 'manufacturing', 'admin') AND NEW.direction = 'expense')
            OR (v_grp = 'asset' AND NEW.direction IN ('asset_buy', 'asset_sell'))) THEN
      RAISE EXCEPTION 'account % does not take direction %', NEW.account, NEW.direction;
    END IF;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new ledger entry cannot be voided';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'voided ledger entries do not change';
  END IF;
  IF NEW.voided_at IS NULL THEN
    RAISE EXCEPTION 'ledger entries only take a void — correct with a new entry';
  END IF;
  IF (to_jsonb(NEW) - v_void) IS DISTINCT FROM (to_jsonb(OLD) - v_void) THEN
    RAISE EXCEPTION 'ledger entries only take a void — correct with a new entry';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledger_entries_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_entries_guard ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_guard();

CREATE OR REPLACE FUNCTION public.ledger_documents_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_fixed constant text[] := ARRAY['id', 'company_id', 'uploaded_by', 'storage_path', 'mime', 'size_bytes', 'sha256', 'width', 'height', 'note', 'idempotency_key', 'created_at'];
  v_keys text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_documents are never deleted — reject instead';
  END IF;
  SELECT string_agg(k, ',') INTO v_keys FROM unnest(v_fixed) k
   WHERE (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k);
  IF v_keys IS NOT NULL THEN
    RAISE EXCEPTION 'ledger_documents file columns do not change (%)', v_keys;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledger_documents_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_documents_guard ON public.ledger_documents;
CREATE TRIGGER trg_ledger_documents_guard BEFORE UPDATE OR DELETE ON public.ledger_documents FOR EACH ROW EXECUTE FUNCTION public.ledger_documents_guard();

CREATE OR REPLACE FUNCTION public.ledger_evidence_released()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.ledger_documents d
     SET review_status = 'pending', decided_by = NULL, decided_at = NULL, decision_reason = NULL
   WHERE d.id = OLD.document_id
     AND d.review_status = 'posted'
     AND NOT EXISTS (SELECT 1 FROM public.ledger_evidence x WHERE x.document_id = OLD.document_id);
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.ledger_evidence_released() IS '사진 연결이 지워져 하나도 남지 않으면(원가 줄을 지운 경우 등) 그 사진을 pending 으로 돌린다';

REVOKE ALL ON FUNCTION public.ledger_evidence_released() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ledger_evidence_released ON public.ledger_evidence;
CREATE TRIGGER trg_ledger_evidence_released AFTER DELETE ON public.ledger_evidence FOR EACH ROW EXECUTE FUNCTION public.ledger_evidence_released();

DROP TRIGGER IF EXISTS trg_ledger_documents_audit ON public.ledger_documents;
CREATE TRIGGER trg_ledger_documents_audit AFTER INSERT OR UPDATE OR DELETE ON public.ledger_documents FOR EACH ROW EXECUTE FUNCTION public.ledger_audit();
DROP TRIGGER IF EXISTS trg_ledger_entries_audit ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_audit AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.ledger_audit();
DROP TRIGGER IF EXISTS trg_ledger_evidence_audit ON public.ledger_evidence;
CREATE TRIGGER trg_ledger_evidence_audit AFTER INSERT OR UPDATE OR DELETE ON public.ledger_evidence FOR EACH ROW EXECUTE FUNCTION public.ledger_audit();
DROP TRIGGER IF EXISTS trg_order_costs_ledger_audit ON public.order_costs;
CREATE TRIGGER trg_order_costs_ledger_audit AFTER INSERT OR UPDATE OR DELETE ON public.order_costs FOR EACH ROW EXECUTE FUNCTION public.ledger_audit();
DROP TRIGGER IF EXISTS trg_order_payments_ledger_audit ON public.order_payments;
CREATE TRIGGER trg_order_payments_ledger_audit AFTER INSERT OR UPDATE OR DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.ledger_audit();

-- 8) 장부 합치기 --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_book(p_company uuid, p_from date, p_to date, p_include_void boolean DEFAULT false)
 RETURNS TABLE(source text, id uuid, entry_date date, seq bigint, direction text, account text, description text,
               counterparty_name text, amount bigint, vat_amount bigint, vat_computed boolean, evidence_type text,
               order_id uuid, order_no text, voided_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH s AS (
    SELECT coalesce(cs.settings #>> '{tax,vat_type}', '') AS vat_type,
           coalesce(cs.settings #>> '{tax,business_kind}', '') AS business_kind
      FROM (SELECT 1) AS one
      LEFT JOIN public.company_settings cs ON cs.company_id = p_company
  )
  SELECT 'entry'::text, e.id, e.entry_date, e.seq, e.direction, e.account, e.description,
         e.counterparty_name, e.amount, e.vat_amount, false, e.evidence_type,
         NULL::uuid, NULL::text, e.voided_at
    FROM public.ledger_entries e
   WHERE e.company_id = p_company
     AND e.entry_date BETWEEN p_from AND p_to
     AND (p_include_void OR e.voided_at IS NULL)
  UNION ALL
  SELECT 'payment'::text, p.id, p.paid_on, NULL::bigint, 'income'::text, 'income.sales'::text, p.stage,
         o.customer_name,
         CASE WHEN s.vat_type = 'general' THEN round(p.amount::numeric / 1.1)::bigint ELSE p.amount END,
         CASE WHEN s.vat_type = 'general' THEN p.amount - round(p.amount::numeric / 1.1)::bigint END,
         s.vat_type = 'general', NULL::text,
         p.order_id, o.order_no, NULL::timestamp with time zone
    FROM public.order_payments p
    JOIN public.orders o ON o.id = p.order_id
   CROSS JOIN s
   WHERE o.company_id = p_company
     AND p.paid_on BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'cost'::text, c.id, c.spent_on, NULL::bigint, 'expense'::text, m.account, c.description,
         coalesce(cp.name, c.vendor_name), c.amount, c.vat_amount, false, c.evidence_type,
         c.order_id, o.order_no, NULL::timestamp with time zone
    FROM public.order_costs c
    JOIN public.orders o ON o.id = c.order_id
   CROSS JOIN s
    LEFT JOIN public.ledger_cost_accounts m ON m.category = c.category AND m.business_kind IN (s.business_kind, 'any')
    LEFT JOIN public.counterparties cp ON cp.id = c.counterparty_id
   WHERE o.company_id = p_company
     AND c.spent_on BETWEEN p_from AND p_to;
$function$;

COMMENT ON FUNCTION public.ledger_book(uuid, date, date, boolean) IS '장부 줄 — 장부 줄(entry) + 받은 수금(payment, 일반과세는 공급가 · 부가세 계산값) + 낸 원가(cost, 계정은 업종 잇기 · 없으면 NULL). 낸 날이 빈 원가는 넣지 않는다. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_book(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_book(uuid, date, date, boolean) TO service_role;

-- 9) 사진 올리기 · 수주로 옮기기 · 고치기 ------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_post_document(p_document uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_doc public.ledger_documents%ROWTYPE;
  v_target text := p_payload ->> 'target';
  v_e jsonb := coalesce(p_payload -> 'entry', '{}'::jsonb);
  v_c jsonb := coalesce(p_payload -> 'cost', '{}'::jsonb);
  v_order uuid;
  v_entry uuid;
  v_cost uuid;
  v_role text := 'primary';
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor is required';
  END IF;
  SELECT * INTO v_doc FROM public.ledger_documents d WHERE d.id = p_document FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_doc.review_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_doc.review_status);
  END IF;

  IF v_target = 'entry' THEN
    INSERT INTO public.ledger_entries (company_id, entry_date, direction, account, description, counterparty_id,
                                       counterparty_name, counterparty_biz_no, amount, vat_amount, evidence_type,
                                       payment_method, source, created_by)
    VALUES (v_doc.company_id, (v_e ->> 'entry_date')::date, v_e ->> 'direction', v_e ->> 'account', v_e ->> 'description',
            nullif(v_e ->> 'counterparty_id', '')::uuid, v_e ->> 'counterparty_name', v_e ->> 'counterparty_biz_no',
            (v_e ->> 'amount')::bigint, coalesce((v_e ->> 'vat_amount')::bigint, 0), v_e ->> 'evidence_type',
            v_e ->> 'payment_method', 'photo', p_actor)
    RETURNING id INTO v_entry;
  ELSIF v_target = 'order_cost' THEN
    SELECT o.id INTO v_order FROM public.orders o
     WHERE o.id = nullif(p_payload ->> 'order_id', '')::uuid AND o.company_id = v_doc.company_id;
    IF v_order IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
    END IF;
    INSERT INTO public.order_costs (order_id, category, description, vendor_name, amount, spent_on, created_by,
                                    counterparty_id, vat_amount, evidence_type)
    VALUES (v_order, v_c ->> 'category', v_c ->> 'description', v_c ->> 'vendor_name', (v_c ->> 'amount')::bigint,
            (v_c ->> 'spent_on')::date, p_actor, nullif(v_c ->> 'counterparty_id', '')::uuid,
            (v_c ->> 'vat_amount')::bigint, v_c ->> 'evidence_type')
    RETURNING id INTO v_cost;
  ELSIF v_target = 'attach' THEN
    v_role := 'supporting';
    v_entry := nullif(p_payload ->> 'entry_id', '')::uuid;
    v_cost := nullif(p_payload ->> 'cost_id', '')::uuid;
    IF (v_entry IS NULL) = (v_cost IS NULL) THEN
      RAISE EXCEPTION 'attach takes entry_id or cost_id';
    END IF;
    IF v_entry IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.ledger_entries x
          WHERE x.id = v_entry AND x.company_id = v_doc.company_id AND x.voided_at IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'entry_not_found');
    END IF;
    IF v_cost IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.order_costs c JOIN public.orders o ON o.id = c.order_id
          WHERE c.id = v_cost AND o.company_id = v_doc.company_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'cost_not_found');
    END IF;
  ELSE
    RAISE EXCEPTION 'target must be entry, order_cost or attach';
  END IF;

  INSERT INTO public.ledger_evidence (company_id, document_id, entry_id, cost_id, role, created_by)
  VALUES (v_doc.company_id, v_doc.id, v_entry, v_cost, v_role, p_actor);

  UPDATE public.ledger_documents d
     SET review_status = 'posted', decided_by = p_actor, decided_at = now(), decision_reason = NULL
   WHERE d.id = v_doc.id;

  RETURN jsonb_build_object('ok', true, 'entry_id', v_entry, 'cost_id', v_cost, 'role', v_role);
END;
$function$;

COMMENT ON FUNCTION public.ledger_post_document(uuid, uuid, jsonb) IS '확인한 사진 올리기 — target entry(장부 줄) · order_cost(그 수주 원가 줄) · attach(이미 있는 줄에 supporting) + 연결 + posted. pending 일 때만, 한 번만. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_post_document(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_post_document(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_move_to_order(p_entry uuid, p_order uuid, p_actor uuid, p_category text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_e public.ledger_entries%ROWTYPE;
  v_cost uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor is required';
  END IF;
  SELECT * INTO v_e FROM public.ledger_entries e WHERE e.id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_e.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;
  IF v_e.direction <> 'expense' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_expense');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order AND o.company_id = v_e.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  UPDATE public.ledger_entries e
     SET voided_at = now(), voided_by = p_actor,
         void_reason = left('수주 원가로 옮김' || coalesce(': ' || nullif(p_reason, ''), ''), 300)
   WHERE e.id = p_entry;

  INSERT INTO public.order_costs (order_id, category, description, vendor_name, amount, spent_on, created_by,
                                  counterparty_id, vat_amount, evidence_type)
  VALUES (p_order, p_category, v_e.description, v_e.counterparty_name, v_e.amount, v_e.entry_date, p_actor,
          v_e.counterparty_id, v_e.vat_amount, v_e.evidence_type)
  RETURNING id INTO v_cost;

  UPDATE public.ledger_evidence x SET entry_id = NULL, cost_id = v_cost WHERE x.entry_id = p_entry;

  RETURN jsonb_build_object('ok', true, 'cost_id', v_cost);
END;
$function$;

COMMENT ON FUNCTION public.ledger_move_to_order(uuid, uuid, uuid, text, text) IS '장부 줄을 그 수주 원가로 — 장부 줄 취소 + 원가 줄 넣기 + 사진 연결 옮기기를 한 번에. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_move_to_order(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_move_to_order(uuid, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ledger_correct_entry(p_entry uuid, p_actor uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_e public.ledger_entries%ROWTYPE;
  v_new uuid;
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor is required';
  END IF;
  IF nullif(p_reason, '') IS NULL THEN
    RAISE EXCEPTION 'p_reason is required';
  END IF;
  SELECT * INTO v_e FROM public.ledger_entries e WHERE e.id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_e.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;

  UPDATE public.ledger_entries e
     SET voided_at = now(), voided_by = p_actor, void_reason = left(p_reason, 300)
   WHERE e.id = p_entry;

  INSERT INTO public.ledger_entries (company_id, entry_date, direction, account, description, counterparty_id,
                                     counterparty_name, counterparty_biz_no, amount, vat_amount, evidence_type,
                                     payment_method, source, created_by, replaces_id)
  VALUES (v_e.company_id,
          coalesce((v_p ->> 'entry_date')::date, v_e.entry_date),
          coalesce(v_p ->> 'direction', v_e.direction),
          coalesce(v_p ->> 'account', v_e.account),
          CASE WHEN v_p ? 'description' THEN v_p ->> 'description' ELSE v_e.description END,
          CASE WHEN v_p ? 'counterparty_id' THEN nullif(v_p ->> 'counterparty_id', '')::uuid ELSE v_e.counterparty_id END,
          CASE WHEN v_p ? 'counterparty_name' THEN v_p ->> 'counterparty_name' ELSE v_e.counterparty_name END,
          CASE WHEN v_p ? 'counterparty_biz_no' THEN v_p ->> 'counterparty_biz_no' ELSE v_e.counterparty_biz_no END,
          coalesce((v_p ->> 'amount')::bigint, v_e.amount),
          coalesce((v_p ->> 'vat_amount')::bigint, v_e.vat_amount),
          coalesce(v_p ->> 'evidence_type', v_e.evidence_type),
          CASE WHEN v_p ? 'payment_method' THEN v_p ->> 'payment_method' ELSE v_e.payment_method END,
          v_e.source, p_actor, v_e.id)
  RETURNING id INTO v_new;

  UPDATE public.ledger_evidence x SET entry_id = v_new WHERE x.entry_id = p_entry;

  RETURN jsonb_build_object('ok', true, 'entry_id', v_new);
END;
$function$;

COMMENT ON FUNCTION public.ledger_correct_entry(uuid, uuid, jsonb, text) IS '장부 줄 고치기 — 원래 줄 취소 + 바꾼 칸만 다른 새 줄(replaces_id) + 사진 연결 옮기기. service_role 전용';

REVOKE ALL ON FUNCTION public.ledger_correct_entry(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ledger_correct_entry(uuid, uuid, jsonb, text) TO service_role;

-- 10) 사진 버킷 (비공개, 정책 없음 — 서버만) ---------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ledger-evidence', 'ledger-evidence', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 11) 권한 — 서버만 -----------------------------------------------------------------

ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_cost_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ledger_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ledger_accounts TO service_role;

REVOKE ALL ON TABLE public.ledger_cost_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ledger_cost_accounts TO service_role;

REVOKE ALL ON TABLE public.ledger_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_documents TO service_role;

REVOKE ALL ON TABLE public.ledger_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_entries TO service_role;

REVOKE ALL ON TABLE public.ledger_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ledger_evidence TO service_role;

REVOKE ALL ON TABLE public.ledger_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ledger_events TO service_role;
