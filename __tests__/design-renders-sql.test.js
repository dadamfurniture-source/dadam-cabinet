/**
 * D3 design_renders — database/design-renders.sql 안전성 시험.
 *
 * SQL 은 DB 없이 실행할 수 없으므로 소스 텍스트로 고정한다 (design-items-detail-sql.test.js 방식).
 *   - 두 번 실행해도 안전: CREATE TABLE/INDEX 는 IF NOT EXISTS, 정책은 DROP IF EXISTS 뒤 CREATE, 버킷은 ON CONFLICT
 *   - 소유권은 designs.user_id 하나 — 표 RLS 와 Storage 정책 둘 다 (planner_snapshots 와 같은 방식)
 *   - 파괴 문장 없음 (DROP 은 정책만)
 * 프런트가 같은 컬럼·같은 경로 규칙으로 쓰는지는 planner-capture.test.js 가 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'database/design-renders.sql'), 'utf8');

const body = SQL.replace(/--[^\n]*/g, '');
const statements = body
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

describe('design-renders.sql — 표', () => {
  test('CREATE TABLE IF NOT EXISTS design_renders 하나, 요구된 컬럼 전부', () => {
    const creates = statements.filter((s) => /^CREATE TABLE/i.test(s));
    expect(creates).toHaveLength(1);
    const t = creates[0];
    expect(t).toMatch(/^CREATE TABLE IF NOT EXISTS design_renders/i);
    expect(t).toMatch(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(t).toMatch(/design_id\s+UUID NOT NULL REFERENCES designs\(id\) ON DELETE CASCADE/);
    expect(t).toMatch(/item_unique_id\s+BIGINT/);
    expect(t).toMatch(/kind\s+TEXT NOT NULL CHECK \(kind IN \('front', 'iso', 'plan', 'module'\)\)/);
    expect(t).toMatch(/module_id\s+TEXT/);
    expect(t).toMatch(/path\s+TEXT NOT NULL/);
    expect(t).toMatch(/width\s+INT/);
    expect(t).toMatch(/height\s+INT/);
    expect(t).toMatch(/camera\s+JSONB/);
    expect(t).toMatch(/detail_hash\s+TEXT/);
    expect(t).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    // 소유자 컬럼을 따로 두지 않는다 — designs.user_id 와 어긋날 수 있다
    expect(t).not.toMatch(/user_id/);
  });

  test('인덱스는 (design_id, item_unique_id, created_at DESC), IF NOT EXISTS', () => {
    const idx = statements.filter((s) => /^CREATE (UNIQUE )?INDEX/i.test(s));
    expect(idx).toHaveLength(1);
    expect(idx[0]).toMatch(/^CREATE INDEX IF NOT EXISTS \w+\s+ON design_renders \(design_id, item_unique_id, created_at DESC\)/i);
  });
});

describe('design-renders.sql — RLS (designs.user_id 경유)', () => {
  test('표: RLS 켜고, 소유자 FOR ALL(USING + WITH CHECK) + 관리자 SELECT — 각각 DROP IF EXISTS 뒤에', () => {
    expect(body).toMatch(/ALTER TABLE design_renders ENABLE ROW LEVEL SECURITY/);
    const own = statements.find((s) => /^CREATE POLICY "own design renders" ON design_renders/.test(s));
    expect(own).toBeDefined();
    expect(own).toMatch(/FOR ALL/);
    expect((own.match(/d\.id = design_renders\.design_id\s+AND d\.user_id = auth\.uid\(\)/g) || []).length).toBe(2); // USING + WITH CHECK
    const adm = statements.find((s) => /^CREATE POLICY "admins read design renders" ON design_renders/.test(s));
    expect(adm).toMatch(/FOR SELECT/);
    expect(adm).toMatch(/FROM admin_roles WHERE user_id = auth\.uid\(\)/);
    expect(body).toMatch(/DROP POLICY IF EXISTS "own design renders" ON design_renders/);
    expect(body).toMatch(/DROP POLICY IF EXISTS "admins read design renders" ON design_renders/);
  });

  test('Storage: 버킷 renders 는 비공개(ON CONFLICT 로 재실행 안전), 정책은 첫 폴더 = 설계 소유자', () => {
    expect(body).toMatch(/INSERT INTO storage\.buckets \(id, name, public\)\s+VALUES \('renders', 'renders', FALSE\)\s+ON CONFLICT \(id\) DO UPDATE SET public = FALSE/);
    const pols = statements.filter((s) => /^CREATE POLICY "renders_\w+" ON storage\.objects/.test(s));
    const names = pols.map((s) => s.match(/"(renders_\w+)"/)[1]).sort();
    expect(names).toEqual(['renders_delete_own', 'renders_insert_own', 'renders_select_admin', 'renders_select_own']);
    for (const p of pols) {
      expect(p).toMatch(/bucket_id = 'renders'/);
      expect(p).toMatch(/TO authenticated/);
      expect(body).toContain(`DROP POLICY IF EXISTS "${p.match(/"(renders_\w+)"/)[1]}" ON storage.objects`);
    }
    const own = pols.filter((s) => /_own"/.test(s));
    expect(own).toHaveLength(3);
    for (const p of own) {
      expect(p).toMatch(/d\.id::text = \(storage\.foldername\(name\)\)\[1\]\s+AND d\.user_id = auth\.uid\(\)/);
    }
    expect(pols.find((s) => /_select_own"/.test(s))).toMatch(/FOR SELECT/);
    expect(pols.find((s) => /_insert_own"/.test(s))).toMatch(/FOR INSERT[\s\S]*WITH CHECK/);
    expect(pols.find((s) => /_delete_own"/.test(s))).toMatch(/FOR DELETE/);
    expect(pols.find((s) => /_select_admin"/.test(s))).toMatch(/FOR SELECT[\s\S]*admin_roles/);
    // 공개 읽기 정책이 없다 — 비공개 버킷, 서명 URL 만
    expect(body).not.toMatch(/TO public/i);
    // upsert 를 쓰지 않으므로 UPDATE 정책도 없다
    expect(pols.some((s) => /FOR UPDATE/.test(s))).toBe(false);
  });
});

describe('design-renders.sql — 파괴 문장 없음', () => {
  test('DROP 은 POLICY IF EXISTS 뿐 · TRUNCATE / DELETE / RENAME / ALTER COLUMN / DROP TABLE 없음', () => {
    const drops = body.match(/\bDROP\b[^;]*/gi) || [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d).toMatch(/^DROP POLICY IF EXISTS/i);
    expect(body).not.toMatch(/\bDROP TABLE\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bRENAME\b/i);
    expect(body).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(statements.some((s) => /^UPDATE\b/i.test(s))).toBe(false);
  });
});

describe('design-renders.sql — 적용 안내', () => {
  test('머리말에 적용 방법·버킷 생성·확인 질의·경로 규칙·B5 조회 방법이 적혀 있다', () => {
    expect(SQL).toMatch(/적용 방법/);
    expect(SQL).toMatch(/두 번 실행해도 안전/);
    expect(SQL).toMatch(/New bucket/);
    expect(SQL).toMatch(/Public 끔/);
    expect(SQL).toMatch(/information_schema\.columns/);
    expect(SQL).toMatch(/pg_policies/);
    expect(SQL).toMatch(/\{design_id\}\/\{item_unique_id\}\/\{kind\}-\{yyyymmddHHMMss\}\.png/);
    expect(SQL).toMatch(/kind='front'/);
    expect(SQL).toMatch(/planner-capture\.js/);
  });
});
