/**
 * 작업자 포털 — database/work-jobs.sql · work-jobs-rollback.sql 안전성 시험 (DB 없이 소스 텍스트로 고정).
 * 계약: docs/01-plan/worker-portal-contract.md §2 · §6
 *   - 두 번 실행해도 안전: CREATE … IF NOT EXISTS · DROP CONSTRAINT/POLICY IF EXISTS 뒤 재생성, 파괴 문장 없음
 *   - RLS: 표마다 켜고, 정책은 관리자 SELECT(public.is_admin()) 하나 — 쓰기 정책 없음 (Worker service_role 만), anon REVOKE
 *   - auth.users FK 는 모두 ON DELETE SET NULL · 주민번호 · 계좌 열 없음 · 글자 수 CHECK
 *   - 되돌리기 파일은 모든 표를 만든 순서의 역순으로 DROP
 * 워커가 같은 이름으로 쓰는지는 workers/workflow-api/test/work.test.js 가 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8');
const SQL = read('work-jobs.sql');
const ROLLBACK = read('work-jobs-rollback.sql');
const strip = (s) => s.replace(/--[^\n]*/g, '');
const body = strip(SQL);
const statements = body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

const TABLES = [
  'worker_invites', 'workers', 'worker_notes', 'work_jobs', 'work_applications',
  'work_assignments', 'work_updates', 'work_photos', 'work_reviews', 'work_job_events',
];

/** CREATE TABLE 본문 (괄호 안) */
function tableBody(name) {
  const m = body.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`${name} 표 정의가 없습니다`);
  return m[1];
}
/** 표의 열 이름 목록 */
function columnsOf(name) {
  return tableBody(name).split('\n').map((l) => l.trim()).filter((l) => /^[a-z_]+\s+[A-Z]/.test(l)).map((l) => l.split(/\s+/)[0]);
}
/** CHECK 제약 본문들 (ALTER … ADD CONSTRAINT name CHECK (…)) */
function checksOf(name) {
  return statements.filter((s) => new RegExp(`^ALTER TABLE ${name} ADD CONSTRAINT \\w+\\s+CHECK`).test(s)).join('\n');
}
/** CHECK 안의 IN ('a', 'b') 목록 */
function inList(check, col) {
  const m = check.match(new RegExp(`${col} IN \\(([^)]*)\\)`));
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : null;
}

describe('work-jobs.sql — 멱등 · 비파괴', () => {
  test('트랜잭션으로 감싼다', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toMatch(/^COMMIT;?$/);
  });

  test('파괴 문장이 없다 — DROP TABLE · TRUNCATE · DELETE · UPDATE · DROP COLUMN', () => {
    expect(body).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements.some((s) => /^(DELETE|UPDATE)\b/i.test(s))).toBe(false);
    expect(body).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  test('CREATE TABLE · INDEX 는 모두 IF NOT EXISTS', () => {
    const creates = statements.filter((s) => /^CREATE (TABLE|UNIQUE INDEX|INDEX)\b/i.test(s));
    expect(creates.length).toBeGreaterThanOrEqual(TABLES.length);
    creates.forEach((s) => expect(s).toMatch(/IF NOT EXISTS/i));
  });

  test('ADD CONSTRAINT · CREATE POLICY 앞에는 같은 이름의 DROP … IF EXISTS', () => {
    const adds = [...body.matchAll(/ADD CONSTRAINT (\w+)/gi)];
    expect(adds.length).toBeGreaterThan(10);
    for (const m of adds) {
      const drop = body.indexOf(`DROP CONSTRAINT IF EXISTS ${m[1]};`);
      expect(drop).toBeGreaterThan(-1);
      expect(drop).toBeLessThan(m.index);
    }
    for (const m of body.matchAll(/CREATE POLICY "([^"]+)"/gi)) {
      const drop = body.indexOf(`DROP POLICY IF EXISTS "${m[1]}"`);
      expect(drop).toBeGreaterThan(-1);
      expect(drop).toBeLessThan(m.index);
    }
  });

  test('계약의 표 10개를 모두 만든다', () => {
    const made = [...body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(made).toEqual(TABLES);
  });
});

describe('work-jobs.sql — RLS', () => {
  test.each(TABLES)('%s — RLS 켬 · anon REVOKE · 정책은 관리자 SELECT 하나', (t) => {
    expect(body).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`));
    expect(body).toMatch(new RegExp(`REVOKE ALL ON ${t}\\s+FROM anon`));
    const policies = [...body.matchAll(new RegExp(`CREATE POLICY "[^"]+" ON ${t}\\s+FOR (\\w+) TO (\\w+) USING \\(([^;]*)\\);`, 'g'))];
    expect(policies.length).toBe(1);
    expect(policies[0][1]).toBe('SELECT');
    expect(policies[0][2]).toBe('authenticated');
    expect(policies[0][3].trim()).toBe('public.is_admin()');
  });

  test('쓰기 정책이 없다 — INSERT · UPDATE · DELETE · ALL · WITH CHECK', () => {
    expect(body).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i);
    expect(body).not.toMatch(/WITH CHECK/i);
    expect(body).not.toMatch(/\bGRANT\b/i);
  });

  test('정책은 is_admin() 만 부른다 (admin_roles 직접 조회 금지 — 42P17 재귀)', () => {
    const usings = [...body.matchAll(/USING \(([^;]*)\);/g)].map((m) => m[1].trim());
    expect(usings.length).toBe(TABLES.length);
    usings.forEach((u) => expect(u).toBe('public.is_admin()'));
  });
});

describe('work-jobs.sql — 열 · 제약', () => {
  test('auth.users 를 가리키는 FK 는 모두 ON DELETE SET NULL', () => {
    const refs = [...body.matchAll(/REFERENCES auth\.users\(id\)([^,\n]*)/g)];
    expect(refs.length).toBeGreaterThanOrEqual(12);
    refs.forEach((m) => expect(m[1].trim()).toBe('ON DELETE SET NULL'));
    // auth.users 를 가리키는 칸은 NOT NULL 이면 SET NULL 이 실패한다
    for (const line of body.split('\n').filter((l) => l.includes('REFERENCES auth.users'))) {
      expect(line).not.toMatch(/NOT NULL/);
    }
  });

  test('주민번호 · 계좌 열이 없다', () => {
    const banned = /rrn|resident|jumin|ssn|주민|bank|account|계좌|iban/i;
    for (const t of TABLES) {
      for (const col of columnsOf(t)) expect(col).not.toMatch(banned);
    }
    for (const t of TABLES) expect(tableBody(t)).not.toMatch(/주민|계좌/);
  });

  test('작업에는 주소 · 연락처 · 고객 실명 열이 없다', () => {
    const cols = columnsOf('work_jobs');
    for (const bad of ['address', 'phone', 'customer_name', 'contact', 'cost', 'margin']) {
      expect(cols.some((c) => c.includes(bad))).toBe(false);
    }
    expect(cols).toEqual(expect.arrayContaining(['pay_amount', 'pay_unit', 'pay_visible', 'version', 'slots', 'mode']));
  });

  test('글자 수 CHECK — 계약의 상한 그대로', () => {
    const want = {
      workers: ['length(display_name) BETWEEN 1 AND 30', 'length(phone), 0) <= 30', 'length(region_label), 0) <= 40', 'length(reject_reason), 0) <= 200'],
      worker_invites: ['length(display_name_preset), 0) <= 30'],
      worker_notes: ['length(note) BETWEEN 1 AND 1000'],
      work_jobs: ['length(title) BETWEEN 1 AND 80', 'length(detail), 0) <= 2000', 'length(region_label), 0) <= 40', 'length(cancel_reason), 0) <= 200'],
      work_applications: ['length(message), 0) <= 300', 'length(decide_reason), 0) <= 200'],
      work_assignments: ['length(release_reason), 0) <= 200', 'length(worker_name_snapshot), 0) <= 30'],
      work_updates: ['length(body) BETWEEN 1 AND 1000'],
      work_reviews: ['length(comment), 0) <= 500', 'length(reply), 0) <= 500', 'length(objection), 0) <= 500'],
      work_job_events: ['length(note), 0) <= 300'],
    };
    for (const [t, parts] of Object.entries(want)) {
      const chk = checksOf(t);
      for (const p of parts) expect(chk).toContain(p);
    }
  });

  test('상태 · 종류 목록 — 계약 §1 · §2', () => {
    const kinds = ['install', 'as', 'assembly'];
    expect(inList(checksOf('work_jobs'), 'kind')).toEqual(kinds);
    expect(inList(checksOf('work_jobs'), 'status')).toEqual(['draft', 'open', 'filled', 'in_progress', 'review', 'done', 'closed', 'cancelled']);
    expect(inList(checksOf('work_jobs'), 'mode')).toEqual(['open', 'invite', 'direct']);
    expect(inList(checksOf('work_jobs'), 'pay_unit')).toEqual(['day', 'hour', 'meter', 'job']);
    expect(checksOf('work_jobs')).toMatch(/slots >= 1/);
    expect(checksOf('work_jobs')).toMatch(/pay_amount IS NULL OR pay_amount >= 0/);
    expect(checksOf('work_jobs')).not.toMatch(/expired/);
    expect(inList(checksOf('workers'), 'status')).toEqual(['pending', 'approved', 'suspended', 'rejected']);
    expect(checksOf('workers')).toContain(`kinds <@ ARRAY['install', 'as', 'assembly']::text[]`);
    expect(checksOf('worker_invites')).toContain(`kinds_preset <@ ARRAY['install', 'as', 'assembly']::text[]`);
    expect(inList(checksOf('work_applications'), 'status')).toEqual(['applied', 'approved', 'rejected', 'withdrawn']);
    expect(inList(checksOf('work_assignments'), 'via')).toEqual(['application', 'invite']);
    expect(inList(checksOf('work_assignments'), 'status')).toEqual(['offered', 'confirmed', 'declined', 'started', 'submitted', 'revision', 'accepted', 'released', 'removed']);
    expect(inList(checksOf('work_updates'), 'author_role')).toEqual(['worker', 'company']);
    expect(inList(checksOf('work_updates'), 'kind')).toEqual(['progress', 'issue', 'result', 'correction', 'note']);
    expect(inList(checksOf('work_reviews'), 'direction')).toEqual(['company_to_worker', 'worker_to_company']);
    expect(checksOf('work_reviews')).toMatch(/score IS NULL OR score BETWEEN 1 AND 5/);
    expect(inList(checksOf('work_job_events'), 'actor_kind')).toEqual(['worker', 'admin', 'system']);
  });

  test('기본값 — 작업자 pending · 작업 draft · 금액 숨김 · version 0 · 신청 applied', () => {
    expect(tableBody('workers')).toMatch(/status\s+TEXT NOT NULL DEFAULT 'pending'/);
    expect(tableBody('work_jobs')).toMatch(/status\s+TEXT NOT NULL DEFAULT 'draft'/);
    expect(tableBody('work_jobs')).toMatch(/pay_visible\s+BOOLEAN NOT NULL DEFAULT false/);
    expect(tableBody('work_jobs')).toMatch(/version\s+INT NOT NULL DEFAULT 0/);
    expect(tableBody('work_applications')).toMatch(/status\s+TEXT NOT NULL DEFAULT 'applied'/);
    expect(tableBody('work_updates')).toMatch(/visible_to_worker BOOLEAN NOT NULL DEFAULT true/);
  });

  test('고유 — 신청 (작업, 작업자) · 활성 배정 부분 고유 · 평가 (배정, 방향) · 초대 토큰 해시 · 작업자 계정', () => {
    expect(tableBody('work_applications')).toMatch(/UNIQUE \(job_id, worker_id\)/);
    expect(body).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_work_assignments_active ON work_assignments \(job_id, worker_id\)\s+WHERE status IN \('offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted'\)/);
    expect(tableBody('work_reviews')).toMatch(/UNIQUE \(assignment_id, direction\)/);
    expect(tableBody('worker_invites')).toMatch(/token_hash\s+TEXT NOT NULL UNIQUE/);
    expect(tableBody('workers')).toMatch(/user_id\s+UUID UNIQUE REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  });

  test('기록은 추가만 — 정정은 amends_id 로 원본을 가리킨다 (원본이 지워져도 정정은 남는다)', () => {
    expect(tableBody('work_updates')).toMatch(/amends_id\s+UUID REFERENCES work_updates\(id\) ON DELETE SET NULL/);
    expect(tableBody('work_job_events')).toMatch(/payload\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  });
});

describe('work-jobs-rollback.sql', () => {
  const rb = strip(ROLLBACK);
  const rbStatements = rb.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

  test('트랜잭션 · 모든 표를 만든 순서의 역순으로 DROP TABLE IF EXISTS', () => {
    expect(rbStatements[0]).toBe('BEGIN');
    expect(rbStatements[rbStatements.length - 1]).toMatch(/^COMMIT;?$/);
    const drops = [...rb.matchAll(/DROP TABLE IF EXISTS (\w+)/g)].map((m) => m[1]);
    expect(drops).toEqual([...TABLES].reverse());
  });

  test('다른 표는 건드리지 않는다 (CASCADE 없음 · DELETE · UPDATE 없음)', () => {
    expect(rb).not.toMatch(/CASCADE/i);
    expect(rbStatements.some((s) => /^(DELETE|UPDATE|TRUNCATE|ALTER)\b/i.test(s))).toBe(false);
    expect(rbStatements.filter((s) => /^DROP\b/i.test(s)).length).toBe(TABLES.length);
  });
});
