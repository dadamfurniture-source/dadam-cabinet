-- =============================================================================
-- 다담AI 업무 루프 스키마 (W11)
-- 상세설계 → 고객확인 문서 → BOM → 작업지시서 → 일정/Slack
--
-- 전제: database/schema.sql 의 designs / design_items 가 이미 존재.
-- 실행: Supabase SQL Editor 에 전문 붙여넣기. 재실행 안전(멱등).
--
-- 설계 원칙
--   1) 모든 산출물은 append-only 리비전. UPDATE-in-place 금지.
--      고객이 이미 본 문서는 영구 보존한다.
--   2) 최신 여부(stale) 판정은 content_hash 비교로만 한다.
--      designs.updated_at / total_items 는 update_design_stats_trigger 가
--      design_items 변경마다 갱신하므로 판정 기준으로 쓸 수 없다.
--   3) 쓰기는 전부 Cloudflare Worker(service_role) 경유.
--      authenticated 는 읽기만, anon 은 접근 불가.
-- =============================================================================

-- updated_at 자동 갱신 (workflow 전용 — 기존 트리거 함수와 이름 충돌 회피)
CREATE OR REPLACE FUNCTION public.wf_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 1. 단가 규칙 (버전 고정 가능)
--    단가는 자주 바뀌므로 코드가 아닌 데이터로 둔다.
--    문서 발행 시 rule_set_id 를 스냅샷에 핀으로 박아 과거 견적을 재현한다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pricing_rule_sets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version        TEXT NOT NULL UNIQUE,              -- '2026.08'
  label          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 활성 세트는 동시에 최대 1개만
CREATE UNIQUE INDEX IF NOT EXISTS pricing_rule_sets_one_active
  ON pricing_rule_sets ((is_active)) WHERE is_active;

CREATE TABLE IF NOT EXISTS pricing_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL REFERENCES pricing_rule_sets ON DELETE CASCADE,

  -- kind: 단가의 종류. quote.service.ts 의 상수 그룹과 1:1 대응
  kind        TEXT NOT NULL CHECK (kind IN (
                'cabinet',           -- CABINET_PRICES        (예: sink.lower)
                'module_type',       -- MODULE_TYPE_PRICES    (예: sink.cooktop)
                'countertop',        -- COUNTERTOP_PRICES
                'fixture',           -- FIXTURE_PRICES        (faucet/sink_bowl/hood)
                'labor',             -- LABOR                 (installation/demolition)
                'door_finish_base',  -- FINISH_BASE_PRICE     (₩/m²)
                'door_color_mult',   -- COLOR_PRICE_MULTIPLIER
                'door_baseline',     -- 기본 도어 단가 (업차지 차액 계산용)
                'vat',               -- VAT_RATE
                'range'              -- 예상 범위 min/max 배수
              )),
  key         TEXT NOT NULL,                        -- 'sink.lower' | 'faucet' | 'PET-M' | 'OAK'
  -- grade 오타는 조회 시 조용히 0행이 되어 단가가 누락되므로 값을 고정한다
  grade       TEXT NOT NULL DEFAULT '*'
              CHECK (grade IN ('basic', 'mid', 'premium', '*')),
  unit        TEXT NOT NULL DEFAULT 'per_1000mm'
              CHECK (unit IN ('per_1000mm', 'each', 'per_m2', 'ratio', 'flat')),
  amount      NUMERIC(14,4) NOT NULL,               -- 배수(1.05)·세율(0.10) 수용
  note        TEXT,

  UNIQUE (rule_set_id, kind, key, grade)
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_set ON pricing_rules (rule_set_id, kind);


-- =============================================================================
-- 2. 설계 스냅샷 — 1·2단계 동결
--    ★ design_items 를 읽지 않는다. 클라이언트 메모리의
--      DadamAgent.exportDesign() 결과를 그대로 받는다.
--      persistence-init.js 의 저장이 delete → insert 비트랜잭션이라
--      중간 실패 시 design_items 가 0행이 될 수 있기 때문.
-- =============================================================================

CREATE TABLE IF NOT EXISTS design_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id    UUID NOT NULL REFERENCES designs ON DELETE CASCADE,
  rev          INT NOT NULL,
  content_hash TEXT NOT NULL,          -- SHA-256(canonical(design+bom)), uniqueId 제외
  created_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  app_version  TEXT,

  -- designs 테이블의 name/title 컬럼 편차(schema.sql vs designs-schema.sql)에
  -- 의존하지 않도록 제목을 스냅샷이 직접 보유한다.
  design_title TEXT,

  design_payload      JSONB NOT NULL,  -- DadamAgent.exportDesign()
  bom_payload         JSONB NOT NULL,  -- MaterialExtractor.extract()
  hardware_payload    JSONB NOT NULL DEFAULT '{}'::JSONB,
  quote_payload       JSONB,           -- 서버가 pricing_rules 로 계산
  pricing_rule_set_id UUID REFERENCES pricing_rule_sets ON DELETE SET NULL,

  -- DEFAULT 를 두지 않는다. DEFAULT 0 이면 CHECK(item_count>0) 과 모순이라
  -- 컬럼을 빠뜨린 INSERT 가 "nonempty 위반" 이라는 엉뚱한 에러를 낸다.
  item_count   INT NOT NULL,
  module_count INT NOT NULL DEFAULT 0,
  panel_count  INT NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT design_snapshots_rev_uniq  UNIQUE (design_id, rev),
  -- 동일 내용이면 새 rev 를 만들지 않고 기존 rev 를 재사용(멱등).
  -- ★ Worker 계약: INSERT 시 반드시 ON CONFLICT (design_id, content_hash) DO NOTHING
  --   후 기존 행을 조회해 반환할 것. 그러지 않으면 생짜 23505 를 받는다.
  --   부작용: 내용을 A→B→A 로 되돌리면 새 rev 가 생기지 않고 rev A 가 재사용된다.
  CONSTRAINT design_snapshots_hash_uniq UNIQUE (design_id, content_hash),
  -- 빈 설계가 동결되어 0원 확인서가 발행되는 것을 막는다
  CONSTRAINT design_snapshots_nonempty  CHECK (item_count > 0),
  -- design_documents 의 복합 FK 대상 (스냅샷과 문서가 같은 설계인지 DB 가 강제)
  CONSTRAINT design_snapshots_id_design_uniq UNIQUE (id, design_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_design  ON design_snapshots (design_id, rev DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_ruleset ON design_snapshots (pricing_rule_set_id);


-- =============================================================================
-- 3. 문서 — 3·4단계 (고객확인서 / 작업지시서)
-- =============================================================================

CREATE TABLE IF NOT EXISTS design_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id     UUID NOT NULL REFERENCES designs ON DELETE CASCADE,
  -- ★ 복합 FK — snapshot_id 단독 FK 로 두면 "남의 설계 스냅샷" 을 붙일 수 있다.
  --   Worker 의 파라미터 뒤바뀜 하나로 고객 A 의 확인서가 고객 B 의 견적을
  --   가리키게 되고, RLS 는 design_id 기준이라 이 조합을 걸러내지 못한다.
  --   스냅샷은 문서가 참조하는 동안 삭제 불가 (RESTRICT).
  snapshot_id   UUID NOT NULL,
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('customer_confirmation', 'work_order')),
  rev           INT NOT NULL,
  doc_no        TEXT NOT NULL UNIQUE,               -- 'DD-20260803-A1B2-CC-r1'
  status        TEXT NOT NULL DEFAULT 'issued'
                CHECK (status IN ('issued', 'viewed', 'approved', 'rejected', 'revoked', 'superseded')),
  -- 재발행 시 구 문서는 삭제하지 않고 supersede 로 연결 (감사 추적)
  superseded_by UUID REFERENCES design_documents ON DELETE SET NULL,

  title                TEXT NOT NULL,
  customer_name        TEXT,                        -- 원본 (내부 전용)
  customer_name_masked TEXT,                        -- '홍*동' — 공유 문서에 노출되는 값
  render_payload       JSONB NOT NULL,              -- 렌더에 필요한 전부 (동결)
  totals               JSONB NOT NULL DEFAULT '{}'::JSONB,  -- {subtotal, vat, discount, total}
  content_hash         TEXT NOT NULL,

  -- 공유 링크 (customer_confirmation 전용)
  -- ★ 평문 토큰은 저장하지 않는다. 발급 응답에서 1회만 반환.
  share_token_hash  TEXT UNIQUE,
  access_pin_hash   TEXT,
  pin_fail_count    INT NOT NULL DEFAULT 0,
  pin_locked_at     TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  first_viewed_at   TIMESTAMPTZ,
  view_count        INT NOT NULL DEFAULT 0,

  -- 고객 결정 (증거력 확보용)
  decision          TEXT CHECK (decision IN ('approved', 'rejected')),
  decided_at        TIMESTAMPTZ,
  signer_name       TEXT,
  signer_ip_hash    TEXT,                           -- 원본 IP 미저장
  signer_user_agent TEXT,

  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT design_documents_rev_uniq UNIQUE (design_id, doc_type, rev),
  -- design_schedules 의 복합 FK 대상
  CONSTRAINT design_documents_id_design_uniq UNIQUE (id, design_id),
  CONSTRAINT design_documents_snapshot_fk
    FOREIGN KEY (snapshot_id, design_id)
    REFERENCES design_snapshots (id, design_id) ON DELETE RESTRICT,
  -- 발행 시에는 토큰이 반드시 있어야 하지만, 유출 대응으로 회수(revoked)하거나
  -- 재발행으로 대체(superseded)될 때는 토큰을 NULL 로 지울 수 있어야 한다.
  CONSTRAINT design_documents_share_chk CHECK (
    doc_type <> 'customer_confirmation'
    OR status IN ('revoked', 'superseded')
    OR share_token_hash IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_documents_design     ON design_documents (design_id, doc_type, rev DESC);
CREATE INDEX IF NOT EXISTS idx_documents_snapshot   ON design_documents (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_documents_superseded ON design_documents (superseded_by);
CREATE INDEX IF NOT EXISTS idx_documents_creator    ON design_documents (created_by);

DROP TRIGGER IF EXISTS trg_documents_touch ON design_documents;
CREATE TRIGGER trg_documents_touch BEFORE UPDATE ON design_documents
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();


-- =============================================================================
-- 4. 일정 — 5단계
--    ★ 이름을 'schedules' 가 아닌 'design_schedules' 로 둔다.
--      multiagent/db/migrations/001_foundation.sql 의 schedules
--      (orders/resources FK 보유) 와 이름이 충돌하면 그 마이그레이션을
--      같은 DB 에 적용할 수 없게 된다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS design_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id     UUID NOT NULL REFERENCES designs ON DELETE CASCADE,
  -- 문서와 마찬가지로 복합 FK — 남의 설계 문서를 일정에 붙일 수 없게 한다
  document_id   UUID,
  batch_id      UUID NOT NULL,                      -- 한 번의 등록 묶음 = Slack 멱등 키 근거
  type          TEXT NOT NULL CHECK (type IN (
                  'measurement',          -- 실측
                  'material_order',       -- 자재 발주
                  'manufacturing_start',  -- 제작 착수
                  'manufacturing_end',    -- 제작 완료
                  'quality_check',        -- 검수
                  'delivery',             -- 납품
                  'installation',         -- 설치
                  'as_visit'              -- A/S 방문
                )),
  title         TEXT NOT NULL,
  description   TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  duration_min  INT NOT NULL DEFAULT 60,
  assignee_name TEXT,
  location      TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  notes         TEXT,
  created_by    UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 문서가 지워져도 일정은 남아야 하므로 document_id 만 NULL 로 되돌린다.
  -- design_id 는 NOT NULL 이라 컬럼 목록 없는 SET NULL 을 쓰면 삭제가 실패한다.
  -- ON DELETE SET NULL (컬럼목록) 은 PostgreSQL 15+ 문법 (Supabase 충족).
  CONSTRAINT design_schedules_document_fk
    FOREIGN KEY (document_id, design_id)
    REFERENCES design_documents (id, design_id) ON DELETE SET NULL (document_id)
);

CREATE INDEX IF NOT EXISTS idx_dsched_design   ON design_schedules (design_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_dsched_batch    ON design_schedules (batch_id);
CREATE INDEX IF NOT EXISTS idx_dsched_document ON design_schedules (document_id);

DROP TRIGGER IF EXISTS trg_dsched_touch ON design_schedules;
CREATE TRIGGER trg_dsched_touch BEFORE UPDATE ON design_schedules
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();


-- =============================================================================
-- 5. Slack 발송 로그 — 멱등 + 재시도
--    일정 INSERT 를 먼저 커밋하고 Slack 은 그 뒤에 비동기로 보낸다.
--    Slack 이 죽어도 일정은 남는다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS slack_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id       UUID REFERENCES designs ON DELETE CASCADE,
  batch_id        UUID,
  idempotency_key TEXT NOT NULL UNIQUE,             -- 'sched:<batch_id>'
  payload         JSONB NOT NULL,                   -- 전송한 Block Kit 원문
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 이 테이블은 workflow 스키마에서 유일하게 UPDATE 되는 테이블
  -- (pending→sent, attempts, last_error) — stuck 감지에 필요
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_notif_batch ON slack_notifications (batch_id);
-- 미발송 건만 스캔 (재전송 목록)
CREATE INDEX IF NOT EXISTS idx_slack_notif_retry
  ON slack_notifications (status, created_at) WHERE status <> 'sent';

DROP TRIGGER IF EXISTS trg_slack_touch ON slack_notifications;
CREATE TRIGGER trg_slack_touch BEFORE UPDATE ON slack_notifications
  FOR EACH ROW EXECUTE FUNCTION public.wf_touch_updated_at();


-- =============================================================================
-- 6. 공개 문서 접근 로그 — 유출 감지 / 브루트포스 흔적
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_access_log (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID REFERENCES design_documents ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN (
                'view', 'pin_fail', 'pin_locked', 'decision', 'expired', 'not_found'
              )),
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_access    ON document_access_log (document_id, created_at DESC);
-- IP 기준 조회(브루트포스 흔적 추적)가 풀스캔이 되지 않도록
CREATE INDEX IF NOT EXISTS idx_doc_access_ip ON document_access_log (ip_hash, created_at DESC);


-- =============================================================================
-- 기존 DB 보정
--
-- CREATE TABLE IF NOT EXISTS 는 테이블이 이미 있으면 블록 전체를 건너뛴다.
-- 에러 없이 SUCCESS 로 끝나므로 컬럼·제약 변경이 "적용된 것처럼 보이지만"
-- 실제로는 반영되지 않는다. 게다가 인덱스/트리거는 별도 문장이라 정상 생성되어
-- updated_at 이 없는 slack_notifications 에 touch 트리거만 붙는 반쪽 상태가 되고,
-- 그 상태에서 UPDATE 하면 "record new has no field updated_at" 로 전면 실패한다.
--
-- 그래서 구조 변경은 아래에서 ALTER 로 한 번 더 강제한다. 신규 DB 에서는 no-op.
--
-- ⚠️ 이미 데이터가 있는 DB 라면 ADD CONSTRAINT 가 위반 행 때문에 실패할 수 있다.
--    적용 전 파일 하단의 "보정 전 위반 행 점검" 쿼리를 먼저 실행할 것.
-- =============================================================================

ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE design_snapshots ALTER COLUMN item_count DROP DEFAULT;

ALTER TABLE pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_grade_chk;
ALTER TABLE pricing_rules ADD  CONSTRAINT pricing_rules_grade_chk
  CHECK (grade IN ('basic', 'mid', 'premium', '*'));

ALTER TABLE design_documents DROP CONSTRAINT IF EXISTS design_documents_share_chk;
ALTER TABLE design_documents ADD  CONSTRAINT design_documents_share_chk CHECK (
  doc_type <> 'customer_confirmation'
  OR status IN ('revoked', 'superseded')
  OR share_token_hash IS NOT NULL
);

-- 복합 FK 재구성. 순서 중요 — FK 를 먼저 떨어뜨려야 대상 UNIQUE 를 재생성할 수 있다.
ALTER TABLE design_schedules DROP CONSTRAINT IF EXISTS design_schedules_document_fk;
ALTER TABLE design_schedules DROP CONSTRAINT IF EXISTS design_schedules_document_id_fkey;
ALTER TABLE design_documents DROP CONSTRAINT IF EXISTS design_documents_snapshot_fk;
ALTER TABLE design_documents DROP CONSTRAINT IF EXISTS design_documents_snapshot_id_fkey;

ALTER TABLE design_snapshots DROP CONSTRAINT IF EXISTS design_snapshots_id_design_uniq;
ALTER TABLE design_snapshots ADD  CONSTRAINT design_snapshots_id_design_uniq UNIQUE (id, design_id);
ALTER TABLE design_documents DROP CONSTRAINT IF EXISTS design_documents_id_design_uniq;
ALTER TABLE design_documents ADD  CONSTRAINT design_documents_id_design_uniq UNIQUE (id, design_id);

ALTER TABLE design_documents ADD CONSTRAINT design_documents_snapshot_fk
  FOREIGN KEY (snapshot_id, design_id)
  REFERENCES design_snapshots (id, design_id) ON DELETE RESTRICT;
ALTER TABLE design_schedules ADD CONSTRAINT design_schedules_document_fk
  FOREIGN KEY (document_id, design_id)
  REFERENCES design_documents (id, design_id) ON DELETE SET NULL (document_id);


-- =============================================================================
-- RLS
--   쓰기는 전부 Worker(service_role). authenticated 는 본인 설계에 한해 읽기만.
--   anon 은 어떤 테이블에도 접근 불가 — 고객 공유 링크는 반드시 Worker 를 경유한다.
--   (만료·PIN·열람 카운트·잠금은 SQL 정책만으로 구현할 수 없기 때문)
-- =============================================================================

ALTER TABLE pricing_rule_sets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;

-- 단가: 정책 0개 → service_role(Worker) 전용.
--   등급별 원가 단가표는 경쟁 민감 정보라 로그인 사용자 전체에 열지 않는다.
--   화면의 견적 미리보기는 Worker 의 POST /snapshots/:id/quote 를 경유한다.
--   (아래 두 정책은 이전 버전에서 만들었을 수 있으므로 명시적으로 제거)
DROP POLICY IF EXISTS "Auth users read rule sets" ON pricing_rule_sets;
DROP POLICY IF EXISTS "Auth users read rules" ON pricing_rules;

-- 스냅샷 / 문서 / 일정: 부모 설계 소유자만 읽기
DROP POLICY IF EXISTS "Users read own snapshots" ON design_snapshots;
CREATE POLICY "Users read own snapshots" ON design_snapshots
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM designs
      WHERE designs.id = design_snapshots.design_id
        AND designs.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users read own documents" ON design_documents;
CREATE POLICY "Users read own documents" ON design_documents
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM designs
      WHERE designs.id = design_documents.design_id
        AND designs.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users read own schedules" ON design_schedules;
CREATE POLICY "Users read own schedules" ON design_schedules
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM designs
      WHERE designs.id = design_schedules.design_id
        AND designs.user_id = auth.uid()
    )
  );

-- slack_notifications / document_access_log : 정책 0개 → service_role 전용

-- anon 차단 (RLS 와 별개로 테이블 권한 자체를 회수)
REVOKE ALL ON pricing_rule_sets   FROM anon;
REVOKE ALL ON pricing_rules       FROM anon;
REVOKE ALL ON design_snapshots    FROM anon;
REVOKE ALL ON design_documents    FROM anon;
REVOKE ALL ON design_schedules    FROM anon;
REVOKE ALL ON slack_notifications FROM anon;
REVOKE ALL ON document_access_log FROM anon;


-- =============================================================================
-- 보정 전 위반 행 점검 (이미 데이터가 있는 DB 에서만 필요)
-- 아래가 전부 0행이어야 위 ALTER 블록이 성공한다.
-- =============================================================================
-- -- 다른 설계의 스냅샷을 참조하는 문서
-- SELECT d.id, d.doc_no FROM design_documents d
--   JOIN design_snapshots s ON s.id = d.snapshot_id
--   WHERE s.design_id <> d.design_id;
--
-- -- 다른 설계의 문서를 참조하는 일정
-- SELECT sc.id FROM design_schedules sc
--   JOIN design_documents dd ON dd.id = sc.document_id
--   WHERE dd.design_id <> sc.design_id;
--
-- -- 허용값이 아닌 grade
-- SELECT id, kind, key, grade FROM pricing_rules
--   WHERE grade NOT IN ('basic','mid','premium','*');
--
-- -- 발행 상태인데 공유 토큰이 없는 고객확인서
-- SELECT id, doc_no, status FROM design_documents
--   WHERE doc_type = 'customer_confirmation'
--     AND status NOT IN ('revoked','superseded')
--     AND share_token_hash IS NULL;


-- =============================================================================
-- 확인 쿼리 (실행 후 수동 점검용)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('design_snapshots','design_documents','design_schedules',
--                        'slack_notifications','document_access_log',
--                        'pricing_rule_sets','pricing_rules')
--   ORDER BY table_name;   -- 7행이어야 함
--
-- designs 의 제목 컬럼이 name 인지 title 인지 확인:
-- SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='designs' ORDER BY ordinal_position;
