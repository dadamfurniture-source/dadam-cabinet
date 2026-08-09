-- ============================================================
-- CD-4: 설치 도메인 + CD-6 잔여(일정 실적 시각)
--
-- 지금까지 작업지시서는 제작(공장)용 1종뿐이었다. 설치 팀에게 나갈 문서가
-- 없었고, 현장 정보(주소·층수·엘리베이터·반입경로·시공순서)를 담을 자리도
-- 전혀 없었다. design_schedules.location TEXT(300) 자유 텍스트 한 칸이 전부였다.
--
-- DB 작업을 두 번 하지 않으려고 CD-6 의 잔여 항목(일정 실제 시작·완료 시각)도
-- 같은 마이그레이션에 묶는다.
--
-- 멱등: 두 번 실행해도 안전하다.
-- ============================================================

BEGIN;

-- ── 1) doc_type 에 installation_order 추가 ──────────────────
-- 기존 CHECK 는 2값으로 잠겨 있어 설치 작업지시서를 만들 수 없었다.
-- (2026-08-09 기준 발행된 문서 0건 — 기존 데이터 영향 없음)
ALTER TABLE design_documents DROP CONSTRAINT IF EXISTS design_documents_doc_type_check;
ALTER TABLE design_documents ADD CONSTRAINT design_documents_doc_type_check
  CHECK (doc_type IN ('customer_confirmation', 'work_order', 'installation_order'));

-- 공유 링크 규칙은 그대로 둔다: 고객 확인서만 토큰을 갖는다.
-- 설치 작업지시서는 내부 문서라 링크 공유 대상이 아니다(제작 지시서와 동일).


-- ── 2) 현장 정보 ────────────────────────────────────────────
-- 설계 1건에 현장 1개. 스냅샷이 아니라 **설계**에 붙인다 —
-- 주소를 고쳤다고 설계 스냅샷 rev 가 올라가면 안 되기 때문이다.
-- 문서 발행 시점에 render_payload 로 복사돼 그 문서 안에서 동결된다.
CREATE TABLE IF NOT EXISTS design_site_info (
  design_id      UUID PRIMARY KEY REFERENCES designs(id) ON DELETE CASCADE,

  address        TEXT,           -- 시/군/구 + 도로명
  address_detail TEXT,           -- 동·호수
  floor          TEXT,           -- '12층', 'B1' 등 자유 표기 (숫자로 못 받는 현장이 있다)
  has_elevator   BOOLEAN,        -- NULL = 미확인. false(없음)와 구분해야 한다
  elevator_note  TEXT,           -- '사다리차 필요', '엘리베이터 규격 제한' 등
  access_note    TEXT,           -- 반입 경로 (계단 폭, 진입로, 주차)
  install_order  TEXT,           -- 시공 순서 메모
  contact_name   TEXT,
  contact_phone  TEXT,           -- 설치 팀이 현장에서 연락해야 한다
  notes          TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE design_site_info IS
  'CD-4 현장 정보. 설치 작업지시서의 입력. 연락처를 담으므로 공유 문서에 싣지 않는다.';
COMMENT ON COLUMN design_site_info.has_elevator IS
  'NULL=미확인 / true=있음 / false=없음. 미확인과 없음을 구분해야 사다리차 판단이 된다.';

-- 길이 상한 (자유 텍스트가 문서 레이아웃을 깨지 않게)
ALTER TABLE design_site_info DROP CONSTRAINT IF EXISTS design_site_info_len_chk;
ALTER TABLE design_site_info ADD CONSTRAINT design_site_info_len_chk CHECK (
  coalesce(length(address), 0)        <= 200 AND
  coalesce(length(address_detail), 0) <= 100 AND
  coalesce(length(floor), 0)          <= 30  AND
  coalesce(length(elevator_note), 0)  <= 300 AND
  coalesce(length(access_note), 0)    <= 1000 AND
  coalesce(length(install_order), 0)  <= 2000 AND
  coalesce(length(contact_name), 0)   <= 50  AND
  coalesce(length(contact_phone), 0)  <= 30  AND
  coalesce(length(notes), 0)          <= 2000
);


-- ── 3) 일정 실적 시각 (CD-6 잔여) ───────────────────────────
-- 공정 리드타임 학습에는 "예정" 이 아니라 "실제" 가 필요하다.
-- scheduled_at 만 있어 실측 리드타임을 낼 수 없었다.
ALTER TABLE design_schedules ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ;
ALTER TABLE design_schedules ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE design_schedules DROP CONSTRAINT IF EXISTS design_schedules_actual_chk;
ALTER TABLE design_schedules ADD CONSTRAINT design_schedules_actual_chk
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at);

COMMENT ON COLUMN design_schedules.started_at IS
  'CD-6 실제 착수 시각. scheduled_at(예정)과 다르다 — 리드타임 학습의 실측값.';

-- 리드타임 집계용
CREATE INDEX IF NOT EXISTS idx_design_schedules_completed
  ON design_schedules (type, completed_at DESC)
  WHERE completed_at IS NOT NULL;


-- ── 4) RLS — 다른 테이블과 동일하게 소유자 읽기만 ───────────
ALTER TABLE design_site_info ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON design_site_info FROM anon;

DROP POLICY IF EXISTS "Users read own site info" ON design_site_info;
CREATE POLICY "Users read own site info" ON design_site_info
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM designs d
      WHERE d.id = design_site_info.design_id AND d.user_id = auth.uid()
    )
  );

-- 쓰기는 Worker(service_role)만. 프론트가 직접 쓰면 길이·소유권 검증을 건너뛴다.


-- ── 5) updated_at 자동 갱신 ─────────────────────────────────
CREATE OR REPLACE FUNCTION set_site_info_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_info_updated_at ON design_site_info;
CREATE TRIGGER trg_site_info_updated_at
  BEFORE UPDATE ON design_site_info
  FOR EACH ROW EXECUTE FUNCTION set_site_info_updated_at();

COMMIT;
