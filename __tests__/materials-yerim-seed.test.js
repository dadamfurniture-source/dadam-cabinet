/**
 * 예림 LUX 카탈로그 시드 — database/materials-yerim-lux-seed.sql 안전성 시험.
 *
 * materials-catalog-sql.test.js 와 같은 방식: SQL 은 DB 없이 못 돌리므로 소스 텍스트로 고정한다.
 *   - 두 번 실행해도 안전: ALTER 는 IF NOT EXISTS, INSERT 는 WHERE NOT EXISTS (code)
 *   - 파괴 문장 없음 (I6: 카탈로그는 더하기만)
 *   - 시드 JSON(database/seed/yerim-lux.json)과 SQL 의 코드가 1:1 이고, 각 코드는 정확히 한 번
 *   - 코드 접두사 'YR-' 라 기존 PET-OAK-M 체계와 겹치지 않는다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'database/materials-yerim-lux-seed.sql'), 'utf8');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/seed/yerim-lux.json'), 'utf8'));

const statements = SQL
  .replace(/--[^\n]*/g, '')
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

describe('materials-yerim-lux-seed.sql — 멱등성 · 안전성', () => {
  test('ALTER TABLE 은 전부 ADD COLUMN IF NOT EXISTS', () => {
    const alters = statements.filter((s) => /^ALTER TABLE/i.test(s));
    expect(alters).toHaveLength(4);
    for (const s of alters) expect(s).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('INSERT 는 WHERE NOT EXISTS (code) 로 보호된다', () => {
    const inserts = statements.filter((s) => /^INSERT INTO materials/i.test(s));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM materials m WHERE m\.code = v\.code\)/);
  });

  test('파괴 문장이 없다', () => {
    for (const s of statements) {
      expect(s).not.toMatch(/^(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
      expect(s).not.toMatch(/ALTER TABLE \w+ DROP/i);
    }
  });
});

describe('시드 데이터', () => {
  test('도어재 117 + 바디재 27 = 144, 코드는 전부 YR- 접두사이고 유일하다', () => {
    expect(SEED.items).toHaveLength(144);
    expect(SEED.items.filter((i) => i.category === 'door_material')).toHaveLength(117);
    expect(SEED.items.filter((i) => i.category === 'body_material')).toHaveLength(27);
    const codes = SEED.items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^YR-/);
  });

  test('SQL 에 모든 코드가 정확히 한 번 나온다', () => {
    for (const i of SEED.items) {
      const n = (SQL.match(new RegExp(`'${i.code.replace(/[-]/g, '\\-')}'`, 'g')) || []).length;
      expect([i.code, n]).toEqual([i.code, 1]);
    }
  });

  test('hex · tone · slot 이 형식에 맞는다', () => {
    for (const i of SEED.items) {
      expect(i.color_hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(['matte', 'gloss', 'single']).toContain(i.tone);
      expect(['none', 'h', 'v']).toContain(i.grain);
      expect(i.slot.length).toBeGreaterThan(0);
      if (i.category === 'body_material') expect(i.slot).toEqual(['body']);
      else expect(i.slot).toEqual(['door', 'drawer_front']);
      expect(i.source_url).toMatch(/^https:\/\/www\.yerim\.net\//);
    }
  });

  test('예림 제품코드는 한 건(글로시 다크그레이)만 비어 있고 uid 로 대체된다', () => {
    const noVendor = SEED.items.filter((i) => !i.vendor_code);
    expect(noVendor.map((i) => i.color_name)).toEqual(['글로시 다크그레이']);
    expect(noVendor[0].code).toBe('YR-U1802');
  });
});
