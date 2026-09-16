/**
 * 예림 자재 텍스처 반영 SQL — database/materials-yerim-textures.sql 안전성 시험.
 *
 * materials-yerim-seed.test.js 와 같은 방식: SQL 은 DB 없이 못 돌리므로 소스 텍스트로 고정한다.
 * 이 파일이 따로 있는 이유는 시드 INSERT 가 WHERE NOT EXISTS (code) 라서, 이미 시드를 넣은 DB 에는
 * 새 texture_url·color_hex·tile_mm 이 닿지 않기 때문이다 (헤더 주석이 그렇게 밝혀야 한다).
 *
 *   - 멱등: ALTER 는 ADD COLUMN IF NOT EXISTS, UPDATE 는 code 한 건씩 (WHERE code = '…')
 *   - 파괴 문장 없음 (DROP·DELETE·TRUNCATE·INSERT 없음)
 *   - 시드 JSON 의 144 코드가 정확히 한 번씩, 값도 시드와 같다
 *   - 가리키는 타일 파일이 실제로 저장소에 있다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL_PATH = path.join(ROOT, 'database/materials-yerim-textures.sql');
const SQL = fs.readFileSync(SQL_PATH, 'utf8');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/seed/yerim-lux.json'), 'utf8'));

const header = SQL.slice(0, SQL.indexOf('ALTER TABLE'));
const statements = SQL
  .replace(/--[^\n]*/g, '')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

describe('materials-yerim-textures.sql — 멱등성 · 안전성', () => {
  test('ALTER TABLE 은 전부 ADD COLUMN IF NOT EXISTS', () => {
    const alters = statements.filter((s) => /^ALTER TABLE/i.test(s));
    expect(alters).toHaveLength(2);
    for (const s of alters) expect(s).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('UPDATE 는 전부 code 한 건씩 — 몇 번 돌려도 결과가 같다', () => {
    const updates = statements.filter((s) => /^UPDATE/i.test(s));
    expect(updates).toHaveLength(SEED.items.length);
    for (const s of updates) {
      expect(s).toMatch(/^UPDATE materials SET texture_url = '[^']+', color_hex = '#[0-9a-f]{6}', tile_mm = \d+ WHERE code = 'YR-[^']+'$/);
    }
  });

  test('파괴 문장이 없다 — UPDATE·ALTER·COMMENT 뿐', () => {
    for (const s of statements) {
      expect(s).not.toMatch(/^(DROP|DELETE|TRUNCATE|INSERT)\b/i);
      expect(s).not.toMatch(/ALTER TABLE \w+ DROP/i);
      expect(s).toMatch(/^(ALTER TABLE|COMMENT ON|UPDATE materials)\b/i);
    }
  });

  test('머리말이 "이미 시드를 넣은 DB 용"이라고 분명히 밝힌다', () => {
    expect(header).toMatch(/이미 시드를 넣은 DB/);
    expect(header).toMatch(/WHERE NOT EXISTS \(code\)/);
    expect(header).toMatch(/기존 144행을 건드리지 않는다/);
    expect(header).toMatch(/texture_url = NULL/);   // 되돌리는 법
  });
});

describe('시드와 1:1', () => {
  test('144 코드가 정확히 한 번씩 나온다', () => {
    expect(SEED.items).toHaveLength(144);
    for (const i of SEED.items) {
      const n = (SQL.match(new RegExp(`WHERE code = '${i.code}';`, 'g')) || []).length;
      expect([i.code, n]).toEqual([i.code, 1]);
    }
    expect((SQL.match(/^UPDATE materials /gm) || [])).toHaveLength(144);
  });

  test('값이 시드 JSON 과 같다', () => {
    for (const i of SEED.items) {
      const line = SQL.split('\n').find((l) => l.includes(`WHERE code = '${i.code}';`));
      expect(line).toContain(`texture_url = '${i.texture_url}'`);
      expect(line).toContain(`color_hex = '${i.color_hex}'`);
      expect(line).toContain(`tile_mm = ${i.tile_mm}`);
    }
  });

  test('가리키는 타일 파일이 전부 저장소에 있다', () => {
    const urls = (SQL.match(/texture_url = '([^']+)'/g) || [])
      .map((s) => s.replace(/^texture_url = '|'$/g, ''));
    expect(urls).toHaveLength(144);
    const missing = urls.filter((u) => !fs.existsSync(path.join(ROOT, u)));
    expect(missing).toEqual([]);
    // 저장소 상대경로여야 플래너 페이지와 같은 출처가 된다 (CORS 없음)
    for (const u of urls) expect(u).toMatch(/^assets\/materials\/yerim\/YR-[\w.-]+\.jpg$/);
  });
});
