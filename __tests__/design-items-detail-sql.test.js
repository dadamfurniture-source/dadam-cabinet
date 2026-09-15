/**
 * D1 design_items.detail — database/design-items-detail.sql 안전성 시험.
 *
 * SQL 은 DB 없이 실행할 수 없으므로 소스 텍스트로 고정한다 (materials-catalog-sql.test.js 방식).
 *   - 두 번 실행해도 안전: ALTER 는 ADD COLUMN IF NOT EXISTS 하나뿐
 *   - 기존 행을 건드리지 않음: NOT NULL · DEFAULT · UPDATE 없음 (옛 설계는 NULL 로 남는다)
 *   - 파괴 문장 없음 (DROP / TRUNCATE / DELETE / RENAME / ALTER COLUMN)
 * 프런트(persistence-init.js)가 같은 컬럼 이름으로 쓰고 읽는지는 designui-detail-sync.test.js 가 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'database/design-items-detail.sql'), 'utf8');

// 주석을 뺀 본문을 문장 단위로 (세미콜론 기준)
const body = SQL.replace(/--[^\n]*/g, '');
const statements = body
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

describe('design-items-detail.sql — 멱등성', () => {
  test('ALTER TABLE 은 design_items 에 ADD COLUMN IF NOT EXISTS detail JSONB 하나뿐', () => {
    const alters = statements.filter((s) => /^ALTER TABLE/i.test(s));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toMatch(/^ALTER TABLE design_items ADD COLUMN IF NOT EXISTS detail JSONB$/i);
  });

  test('기존 행을 바꾸지 않는다 — NOT NULL · DEFAULT · UPDATE · INSERT 없음', () => {
    expect(body).not.toMatch(/\bNOT NULL\b/i);
    expect(body).not.toMatch(/\bDEFAULT\b/i);
    expect(statements.some((s) => /^UPDATE\b/i.test(s))).toBe(false);
    expect(statements.some((s) => /^INSERT\b/i.test(s))).toBe(false);
  });

  test('COMMENT ON COLUMN 은 같은 컬럼을 가리킨다 (재실행해도 덮어쓸 뿐)', () => {
    const comments = statements.filter((s) => /^COMMENT ON/i.test(s));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(/^COMMENT ON COLUMN design_items\.detail IS/i);
  });

  test('RLS 정책·권한을 새로 만들지 않는다 (기존 design_items 정책을 그대로 탄다)', () => {
    expect(body).not.toMatch(/\bCREATE POLICY\b/i);
    expect(body).not.toMatch(/\bGRANT\b/i);
    expect(body).not.toMatch(/\bENABLE ROW LEVEL SECURITY\b/i);
  });
});

describe('design-items-detail.sql — 파괴 문장 없음', () => {
  test('DROP / TRUNCATE / DELETE / RENAME / ALTER COLUMN 이 없다', () => {
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bRENAME\b/i);
    expect(body).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });
});

describe('design-items-detail.sql — 적용 안내', () => {
  test('머리말에 적용 방법·확인 질의·선행 스키마·모델 형식이 적혀 있다', () => {
    expect(SQL).toMatch(/적용 방법/);
    expect(SQL).toMatch(/designs-schema\.sql/);
    expect(SQL).toMatch(/information_schema\.columns/);
    expect(SQL).toMatch(/두 번 실행해도 안전/);
    expect(SQL).toMatch(/planner-finish\.js/);
    expect(SQL).toMatch(/"version": 1/);
  });
});
