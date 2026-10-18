/**
 * 작업 지시 보고 보관함 — database/work-reports.sql 안전성 시험 (DB 없이 소스 텍스트로 고정).
 *   - 두 번 실행해도 안전: CREATE … IF NOT EXISTS · ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT/POLICY IF EXISTS 뒤 재생성
 *   - 파괴 문장 없음: DROP TABLE · TRUNCATE · DELETE · UPDATE
 *   - 종류 9종 CHECK · 같은 원본 한 번(UNIQUE) · 읽기는 주인 또는 관리자, 쓰기 정책 없음(service_role 만)
 * 워커가 같은 이름으로 쓰는지는 workers/workflow-api/test/reports.test.js 가 본다.
 */
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'database/work-reports.sql'), 'utf8');
const body = SQL.replace(/--[^\n]*/g, '');
const statements = body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

const KINDS = [
  'production_plan', 'staffing_decision', 'daily_brief', 'work_order', 'installation_order',
  'outsource_order', 'countertop_order', 'monthly_close', 'note',
];

describe('work-reports.sql — 멱등 · 비파괴', () => {
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

  test('CREATE 는 모두 IF NOT EXISTS, ADD COLUMN 도 IF NOT EXISTS', () => {
    statements.filter((s) => /^CREATE (TABLE|UNIQUE INDEX|INDEX)\b/i.test(s))
      .forEach((s) => expect(s).toMatch(/IF NOT EXISTS/i));
    const adds = [...body.matchAll(/ADD COLUMN\s+(IF NOT EXISTS\s+)?(\w+)/gi)];
    expect(adds.length).toBe(4);
    adds.forEach((m) => expect(m[1]).toBeTruthy());
  });

  test('ADD CONSTRAINT · CREATE POLICY 앞에는 같은 이름의 DROP … IF EXISTS', () => {
    for (const m of body.matchAll(/ADD CONSTRAINT (\w+)/gi)) {
      expect(body).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${m[1]}\\b`));
    }
    for (const m of body.matchAll(/CREATE POLICY "([^"]+)"/gi)) {
      expect(body).toContain(`DROP POLICY IF EXISTS "${m[1]}"`);
    }
  });
});

describe('work-reports.sql — 내용', () => {
  test('종류 9종 CHECK', () => {
    const chk = body.match(/work_reports_kind_chk CHECK \(kind IN \(([\s\S]*?)\)\)/);
    expect(chk).not.toBeNull();
    const kinds = [...chk[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual(KINDS);
  });

  test('같은 원본은 한 번 · 아침 요약은 주인×날짜 · 월 마감은 주인×달 하나', () => {
    expect(body).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_work_reports_source ON work_reports \(kind, source_id\) WHERE source_id IS NOT NULL/);
    expect(body).toMatch(/uq_work_reports_daily ON work_reports \(owner_id, period_start\) WHERE kind = 'daily_brief'/);
    expect(body).toMatch(/uq_work_reports_monthly ON work_reports \(owner_id, period_start\) WHERE kind = 'monthly_close'/);
  });

  test('RLS — 읽기는 주인 또는 관리자, 쓰기 정책 없음 (Worker service_role 만), anon 차단', () => {
    expect(body).toMatch(/ALTER TABLE work_reports ENABLE ROW LEVEL SECURITY/);
    expect(body).toMatch(/REVOKE ALL ON work_reports FROM anon/);
    const policies = [...body.matchAll(/CREATE POLICY "[^"]+" ON work_reports\s+FOR (\w+)/gi)].map((m) => m[1].toUpperCase());
    expect(policies).toEqual(['SELECT']);
    expect(body).toMatch(/USING \(owner_id = auth\.uid\(\) OR public\.is_admin\(\)\)/);
  });

  test('상판 발주 요청서 — 가전 모델 타공 칸 넷 (싱크볼·쿡탑 가로·세로·R, 수전 지름)', () => {
    for (const col of ['cutout_w_mm', 'cutout_d_mm', 'cutout_r_mm', 'faucet_hole_mm']) {
      expect(body).toMatch(new RegExp(`ALTER TABLE appliance_models ADD COLUMN IF NOT EXISTS ${col}\\s+INT`));
    }
  });
});
