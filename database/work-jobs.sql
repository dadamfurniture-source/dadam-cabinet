-- ============================================================
-- 작업자 포털 — 작업 게시 · 신청 · 배정 · 보고 (docs/01-plan/worker-portal-contract.md §2)
--
-- 사장님이 전화·카톡으로 부르던 일(설치 · A/S · 조립 추가 인원)을 게시판에 올리고,
-- 승인된 작업자가 신청 → 편집자가 선정·지정 → 시작 → 보고 → 검수 로 돌린다.
--
--   worker_invites     초대 링크 (토큰은 해시만 — pepperedHash(SHARE_TOKEN_PEPPER, 'worker-invite', token))
--   workers            작업자 자격 (pending → approved / rejected, approved ↔ suspended). 초대로 와도 pending
--   worker_notes       관리자 전용 메모 (편집자만 읽는다 — API 가 작업자에게 절대 돌려주지 않는다)
--   work_jobs          작업 1건 (주소 · 연락처 · 고객 실명 칸이 일부러 없다)
--   work_applications  신청 (작업 × 작업자 하나)
--   work_assignments   배정 (사람별 상태 — 신청 승인 · 직접 지정)
--   work_updates       작업자 보고 + 회사 정정 · 메모 (추가만 — 덮어쓰기 · 삭제 없음)
--   work_photos        사진 (2주차에 사용 — 표만 미리)
--   work_reviews       평가 (2주차에 사용 — 표만 미리)
--   work_job_events    상태 전이 기록 (추가만, 개인정보 없음)
--
-- 규칙: 쓰기는 Worker(service_role)만. 읽기 정책은 관리자(is_admin) SELECT 하나 — worker_notes 만 정책 없음(편집자만, API 로). anon 차단.
--       auth.users 를 가리키는 칸은 모두 ON DELETE SET NULL (회원탈퇴가 FK 에 막히지 않게 — account-deletion.sql).
--       주민등록번호 · 계좌 칸은 어느 표에도 두지 않는다 (__tests__/work-jobs-sql.test.js 가 막는다).
--       금액 · 기간 · 벌칙 같은 사업 규칙 값은 여기 넣지 않는다 (정원 상한도 두지 않는다 — slots >= 1 만).
-- 되돌리기: database/work-jobs-rollback.sql (표를 역순으로 DROP — 데이터가 지워진다).
-- 멱등: 두 번 실행해도 안전하다.
-- ============================================================

BEGIN;

-- ── 초대 링크 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          TEXT NOT NULL UNIQUE,
  kinds_preset        TEXT[] NOT NULL DEFAULT '{}',
  display_name_preset TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  used_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE worker_invites DROP CONSTRAINT IF EXISTS worker_invites_kinds_chk;
ALTER TABLE worker_invites ADD CONSTRAINT worker_invites_kinds_chk
  CHECK (kinds_preset <@ ARRAY['install', 'as', 'assembly']::text[]);

ALTER TABLE worker_invites DROP CONSTRAINT IF EXISTS worker_invites_len_chk;
ALTER TABLE worker_invites ADD CONSTRAINT worker_invites_len_chk
  CHECK (coalesce(length(display_name_preset), 0) <= 30);

COMMENT ON TABLE worker_invites IS
  '작업자 초대 링크. 평문 토큰은 발급 응답에만 있고 여기엔 해시만. 1회용 — used_at 이 찍히면 끝.';

-- ── 작업자 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name    TEXT NOT NULL,
  phone           TEXT,
  kinds           TEXT[] NOT NULL DEFAULT '{}',
  region_label    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  consent_version TEXT NOT NULL,
  consent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  photo_consent   BOOLEAN NOT NULL DEFAULT false,
  approved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  invited_via     UUID REFERENCES worker_invites(id) ON DELETE SET NULL,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_status_chk;
ALTER TABLE workers ADD CONSTRAINT workers_status_chk
  CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_kinds_chk;
ALTER TABLE workers ADD CONSTRAINT workers_kinds_chk
  CHECK (kinds <@ ARRAY['install', 'as', 'assembly']::text[]);

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_len_chk;
ALTER TABLE workers ADD CONSTRAINT workers_len_chk
  CHECK (length(display_name) BETWEEN 1 AND 30 AND coalesce(length(phone), 0) <= 30
    AND coalesce(length(region_label), 0) <= 40 AND coalesce(length(reject_reason), 0) <= 200);

CREATE INDEX IF NOT EXISTS idx_workers_status ON workers (status, created_at DESC);

COMMENT ON TABLE workers IS
  '작업자 자격. profiles · admin_roles 와 따로 둔다. 주민번호 · 계좌는 받지 않는다.';

-- ── 관리자 메모 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  author     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE worker_notes DROP CONSTRAINT IF EXISTS worker_notes_len_chk;
ALTER TABLE worker_notes ADD CONSTRAINT worker_notes_len_chk
  CHECK (length(note) BETWEEN 1 AND 1000);

CREATE INDEX IF NOT EXISTS idx_worker_notes_worker ON worker_notes (worker_id, created_at DESC);

-- ── 작업 ────────────────────────────────────────────────────
-- expired 는 저장하지 않는다 — open 이고 apply_deadline 이 지났으면 API 가 effective_status 로 돌려준다
CREATE TABLE IF NOT EXISTS work_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  title          TEXT NOT NULL,
  detail         TEXT,
  region_label   TEXT,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  apply_deadline TIMESTAMPTZ,
  slots          INT NOT NULL DEFAULT 1,
  mode           TEXT NOT NULL DEFAULT 'open',
  pay_amount     INT,
  pay_unit       TEXT,
  pay_visible    BOOLEAN NOT NULL DEFAULT false,
  order_id       UUID,
  design_id      UUID,
  version        INT NOT NULL DEFAULT 0,
  cancel_reason  TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_kind_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_kind_chk
  CHECK (kind IN ('install', 'as', 'assembly'));

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_status_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_status_chk
  CHECK (status IN ('draft', 'open', 'filled', 'in_progress', 'review', 'done', 'closed', 'cancelled'));

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_mode_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_mode_chk
  CHECK (mode IN ('open', 'invite', 'direct'));

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_slots_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_slots_chk
  CHECK (slots >= 1);

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_pay_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_pay_chk
  CHECK ((pay_amount IS NULL OR pay_amount >= 0)
    AND (pay_unit IS NULL OR pay_unit IN ('day', 'hour', 'meter', 'job')));

ALTER TABLE work_jobs DROP CONSTRAINT IF EXISTS work_jobs_len_chk;
ALTER TABLE work_jobs ADD CONSTRAINT work_jobs_len_chk
  CHECK (length(title) BETWEEN 1 AND 80 AND coalesce(length(detail), 0) <= 2000
    AND coalesce(length(region_label), 0) <= 40 AND coalesce(length(cancel_reason), 0) <= 200);

CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_work_jobs_created ON work_jobs (created_at DESC);

COMMENT ON TABLE work_jobs IS
  '작업자 포털 작업. 주소 · 연락처 · 고객 실명 칸이 없다 (현장 정보는 공개 기간 결정 전까지 내보내지 않는다). version 은 낙관적 잠금.';

-- ── 신청 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE,
  worker_id     UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'applied',
  message       TEXT,
  decided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decide_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, worker_id)
);

ALTER TABLE work_applications DROP CONSTRAINT IF EXISTS work_applications_status_chk;
ALTER TABLE work_applications ADD CONSTRAINT work_applications_status_chk
  CHECK (status IN ('applied', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE work_applications DROP CONSTRAINT IF EXISTS work_applications_len_chk;
ALTER TABLE work_applications ADD CONSTRAINT work_applications_len_chk
  CHECK (coalesce(length(message), 0) <= 300 AND coalesce(length(decide_reason), 0) <= 200);

CREATE INDEX IF NOT EXISTS idx_work_applications_worker ON work_applications (worker_id, created_at DESC);

-- ── 배정 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE,
  worker_id            UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  application_id       UUID REFERENCES work_applications(id) ON DELETE SET NULL,
  via                  TEXT NOT NULL,
  status               TEXT NOT NULL,
  started_at           TIMESTAMPTZ,
  submitted_at         TIMESTAMPTZ,
  accepted_at          TIMESTAMPTZ,
  revision_count       INT NOT NULL DEFAULT 0,
  no_show              BOOLEAN NOT NULL DEFAULT false,
  release_reason       TEXT,
  worker_name_snapshot TEXT,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_assignments DROP CONSTRAINT IF EXISTS work_assignments_via_chk;
ALTER TABLE work_assignments ADD CONSTRAINT work_assignments_via_chk
  CHECK (via IN ('application', 'invite'));

ALTER TABLE work_assignments DROP CONSTRAINT IF EXISTS work_assignments_status_chk;
ALTER TABLE work_assignments ADD CONSTRAINT work_assignments_status_chk
  CHECK (status IN ('offered', 'confirmed', 'declined', 'started', 'submitted', 'revision', 'accepted', 'released', 'removed'));

ALTER TABLE work_assignments DROP CONSTRAINT IF EXISTS work_assignments_len_chk;
ALTER TABLE work_assignments ADD CONSTRAINT work_assignments_len_chk
  CHECK (coalesce(length(release_reason), 0) <= 200 AND coalesce(length(worker_name_snapshot), 0) <= 30);

-- 한 작업에 한 사람은 활성 배정 하나 (끝난 배정 — declined · released · removed — 은 여러 줄 남는다)
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_assignments_active ON work_assignments (job_id, worker_id)
  WHERE status IN ('offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted');
CREATE INDEX IF NOT EXISTS idx_work_assignments_worker ON work_assignments (worker_id, status);
CREATE INDEX IF NOT EXISTS idx_work_assignments_job ON work_assignments (job_id);

-- ── 보고 · 정정 (추가만) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_updates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE,
  assignment_id     UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  author_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_role       TEXT NOT NULL,
  kind              TEXT NOT NULL,
  body              TEXT NOT NULL,
  issue_chips       TEXT[] NOT NULL DEFAULT '{}',
  amends_id         UUID REFERENCES work_updates(id) ON DELETE SET NULL,
  visible_to_worker BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_updates DROP CONSTRAINT IF EXISTS work_updates_role_chk;
ALTER TABLE work_updates ADD CONSTRAINT work_updates_role_chk
  CHECK (author_role IN ('worker', 'company'));

ALTER TABLE work_updates DROP CONSTRAINT IF EXISTS work_updates_kind_chk;
ALTER TABLE work_updates ADD CONSTRAINT work_updates_kind_chk
  CHECK (kind IN ('progress', 'issue', 'result', 'correction', 'note'));

ALTER TABLE work_updates DROP CONSTRAINT IF EXISTS work_updates_len_chk;
ALTER TABLE work_updates ADD CONSTRAINT work_updates_len_chk
  CHECK (length(body) BETWEEN 1 AND 1000);

CREATE INDEX IF NOT EXISTS idx_work_updates_job ON work_updates (job_id, created_at);

COMMENT ON TABLE work_updates IS
  '작업 기록 — 작업자 보고(progress · issue · result)와 회사 정정 · 메모(correction · note). 추가만 한다. 정정은 amends_id 로 원본을 가리킨다.';

-- ── 사진 (2주차에 사용) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id     UUID REFERENCES work_updates(id) ON DELETE SET NULL,
  job_id        UUID NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  path          TEXT NOT NULL,
  bytes         INT,
  width         INT,
  height        INT,
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  committed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_photos DROP CONSTRAINT IF EXISTS work_photos_len_chk;
ALTER TABLE work_photos ADD CONSTRAINT work_photos_len_chk
  CHECK (length(path) BETWEEN 1 AND 300);

CREATE INDEX IF NOT EXISTS idx_work_photos_job ON work_photos (job_id, created_at);

-- ── 평가 (2주차에 사용) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL,
  reviewer_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  score         INT,
  reason_chips  TEXT[] NOT NULL DEFAULT '{}',
  comment       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  published_at  TIMESTAMPTZ,
  reply         TEXT,
  objection     TEXT,
  objection_at  TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  frozen_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, direction)
);

ALTER TABLE work_reviews DROP CONSTRAINT IF EXISTS work_reviews_direction_chk;
ALTER TABLE work_reviews ADD CONSTRAINT work_reviews_direction_chk
  CHECK (direction IN ('company_to_worker', 'worker_to_company'));

ALTER TABLE work_reviews DROP CONSTRAINT IF EXISTS work_reviews_status_chk;
ALTER TABLE work_reviews ADD CONSTRAINT work_reviews_status_chk
  CHECK (status IN ('draft', 'published'));

ALTER TABLE work_reviews DROP CONSTRAINT IF EXISTS work_reviews_score_chk;
ALTER TABLE work_reviews ADD CONSTRAINT work_reviews_score_chk
  CHECK (score IS NULL OR score BETWEEN 1 AND 5);

ALTER TABLE work_reviews DROP CONSTRAINT IF EXISTS work_reviews_len_chk;
ALTER TABLE work_reviews ADD CONSTRAINT work_reviews_len_chk
  CHECK (coalesce(length(comment), 0) <= 500 AND coalesce(length(reply), 0) <= 500
    AND coalesce(length(objection), 0) <= 500);

-- ── 상태 전이 기록 (추가만, 개인정보 없음) ──────────────────
CREATE TABLE IF NOT EXISTS work_job_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES work_jobs(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind    TEXT NOT NULL,
  type          TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  note          TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_job_events DROP CONSTRAINT IF EXISTS work_job_events_actor_chk;
ALTER TABLE work_job_events ADD CONSTRAINT work_job_events_actor_chk
  CHECK (actor_kind IN ('worker', 'admin', 'system'));

ALTER TABLE work_job_events DROP CONSTRAINT IF EXISTS work_job_events_len_chk;
ALTER TABLE work_job_events ADD CONSTRAINT work_job_events_len_chk
  CHECK (length(type) BETWEEN 1 AND 40 AND coalesce(length(note), 0) <= 300
    AND coalesce(length(from_status), 0) <= 20 AND coalesce(length(to_status), 0) <= 20);

CREATE INDEX IF NOT EXISTS idx_work_job_events_job ON work_job_events (job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_job_events_created ON work_job_events (created_at DESC);

-- ── RLS — 관리자 읽기만, 쓰기는 Worker(service_role)만 ──────
-- 작업자의 읽기는 전부 API 를 거친다 (금액 공개 여부 · 주소 비공개가 늘 적용되게)
ALTER TABLE worker_invites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_updates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_photos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_reviews      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_job_events   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON worker_invites    FROM anon;
REVOKE ALL ON workers           FROM anon;
REVOKE ALL ON worker_notes      FROM anon;
REVOKE ALL ON work_jobs         FROM anon;
REVOKE ALL ON work_applications FROM anon;
REVOKE ALL ON work_assignments  FROM anon;
REVOKE ALL ON work_updates      FROM anon;
REVOKE ALL ON work_photos       FROM anon;
REVOKE ALL ON work_reviews      FROM anon;
REVOKE ALL ON work_job_events   FROM anon;

DROP POLICY IF EXISTS "Admins read worker invites" ON worker_invites;
CREATE POLICY "Admins read worker invites" ON worker_invites
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read workers" ON workers;
CREATE POLICY "Admins read workers" ON workers
  FOR SELECT TO authenticated USING (public.is_admin());

-- worker_notes 는 정책을 두지 않는다 — 편집자(super_admin·admin)만 읽어야 하는데 is_admin() 은 support·moderator 도 참이다.
-- RLS 켜고 정책이 없으면 authenticated 는 한 행도 못 읽는다. 읽기는 API(requireAdminEditor → service_role)로만.
-- 예전 판으로 이미 만든 정책은 다시 실행할 때 지운다.
DROP POLICY IF EXISTS "Admins read worker notes" ON worker_notes;

DROP POLICY IF EXISTS "Admins read work jobs" ON work_jobs;
CREATE POLICY "Admins read work jobs" ON work_jobs
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work applications" ON work_applications;
CREATE POLICY "Admins read work applications" ON work_applications
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work assignments" ON work_assignments;
CREATE POLICY "Admins read work assignments" ON work_assignments
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work updates" ON work_updates;
CREATE POLICY "Admins read work updates" ON work_updates
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work photos" ON work_photos;
CREATE POLICY "Admins read work photos" ON work_photos
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work reviews" ON work_reviews;
CREATE POLICY "Admins read work reviews" ON work_reviews
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read work job events" ON work_job_events;
CREATE POLICY "Admins read work job events" ON work_job_events
  FOR SELECT TO authenticated USING (public.is_admin());

COMMIT;
