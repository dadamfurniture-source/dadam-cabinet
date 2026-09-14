/**
 * C0 마감 카탈로그 정본 — database/materials-catalog-v2.sql 안전성 시험.
 *
 * SQL 은 DB 없이 실행할 수 없으므로 소스 텍스트로 고정한다 (erp-ui.test.js 의 스키마 검사 방식).
 *   - 두 번 실행해도 안전: ALTER 는 IF NOT EXISTS, INSERT 는 WHERE NOT EXISTS, UPDATE 는 code IS NULL 만
 *   - 파괴 문장 없음 (I6: 카탈로그는 더하기만)
 *   - 시드 코드가 bom-finish-color.js getFinishColorCode() 출력과 글자 단위로 같고, 각각 정확히 한 번 나온다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'database/materials-catalog-v2.sql'), 'utf8');
const FC = require('../js/detaildesign/bom-finish-color.js');

// 인용된 코드 리터럴('PET-OAK-M') 이 SQL 에 몇 번 나오는지
const countLiteral = (code) => (SQL.match(new RegExp(`'${code}'`, 'g')) || []).length;

// 문장 단위로 잘라 검사 (세미콜론 기준, DO $$ 블록은 통째로 하나)
const statements = SQL
  .replace(/--[^\n]*/g, '')
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(Boolean);

describe('materials-catalog-v2.sql — 멱등성', () => {
  test('ALTER TABLE 은 전부 ADD COLUMN IF NOT EXISTS', () => {
    const alters = statements.filter(s => /^ALTER TABLE/i.test(s));
    expect(alters.length).toBeGreaterThanOrEqual(16);
    for (const s of alters) expect(s).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('요구된 컬럼이 모두 추가된다', () => {
    const cols = ['code', 'finish_code', 'color_code', 'tone', 'slot', 'roughness', 'metalness', 'clearcoat',
      'texture_url', 'normal_url', 'tile_mm', 'grain', 'price_key', 'vendor_code', 'sort', 'active'];
    for (const c of cols) {
      expect(SQL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `));
    }
    expect(SQL).toMatch(/tone IS NULL OR tone IN \('matte', 'gloss', 'single'\)/);
    expect(SQL).toMatch(/grain IS NULL OR grain IN \('none', 'h', 'v'\)/);
    expect(SQL).toMatch(/'door','drawer_front','body','top','handle','finishing','kick'/);
    expect(SQL).toMatch(/active BOOLEAN DEFAULT TRUE/);
  });

  test('code 는 NULL 을 뺀 부분 유일 인덱스, IF NOT EXISTS', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON materials\(code\) WHERE code IS NOT NULL/);
    const idx = statements.filter(s => /^CREATE (UNIQUE )?INDEX/i.test(s));
    for (const s of idx) expect(s).toMatch(/IF NOT EXISTS/);
  });

  test('CHECK 제약은 pg_constraint 존재 확인 뒤에만 추가', () => {
    const m = SQL.match(/DO \$\$([\s\S]*?)END \$\$;/);
    expect(m).not.toBeNull();
    const block = m[1];
    const adds = block.match(/ADD CONSTRAINT/g) || [];
    const guards = block.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g) || [];
    expect(adds.length).toBe(3);
    expect(guards.length).toBe(adds.length);
  });

  test('INSERT 는 전부 WHERE NOT EXISTS (code) 로 보호된다', () => {
    const inserts = statements.filter(s => /^INSERT INTO materials/i.test(s));
    expect(inserts.length).toBe(2); // 도어 매트릭스 + 상판
    for (const s of inserts) {
      expect(s).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM materials m WHERE m\.code = v\.code\)/);
    }
  });

  test('UPDATE 는 기존 행의 빈 code 만 채운다', () => {
    const updates = statements.filter(s => /^UPDATE materials/i.test(s));
    expect(updates.length).toBe(4 + 7 + 3); // 상판 4 + 도어색 7 + 마감 3
    for (const s of updates) expect(s).toMatch(/AND code IS NULL\s*$/);
  });

  test('RPC 는 CREATE OR REPLACE, 활성 행을 slot·sort 순으로', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION get_materials_catalog\(\)/);
    expect(SQL).toMatch(/RETURNS SETOF materials/);
    expect(SQL).toMatch(/ORDER BY slot NULLS LAST, sort NULLS LAST/);
    // 공개 읽기 RLS 를 그대로 타도록 SECURITY DEFINER 를 쓰지 않는다
    expect(SQL).not.toMatch(/SECURITY DEFINER/);
  });
});

describe('materials-catalog-v2.sql — 파괴 문장 없음 (I6)', () => {
  test('DROP / TRUNCATE / DELETE / ALTER … DROP / RENAME 이 없다', () => {
    const body = SQL.replace(/--[^\n]*/g, '');
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bRENAME\b/i);
    expect(body).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  test('기존 시드 행의 이름·카테고리를 바꾸는 UPDATE 가 없다', () => {
    const updates = statements.filter(s => /^UPDATE materials/i.test(s));
    for (const s of updates) {
      const setClause = s.match(/SET([\s\S]*?)WHERE/)[1];
      expect(setClause).not.toMatch(/\bcolor_name\s*=/);
      expect(setClause).not.toMatch(/\bcategory\s*=/);
      expect(setClause).not.toMatch(/\bis_active\s*=/);
    }
  });
});

describe('materials-catalog-v2.sql — 시드 코드 = getFinishColorCode()', () => {
  const finishes = FC.DOOR_FINISH_CATALOG.map(f => f.value);
  const baseColors = ['cream', 'oak', 'walnut', 'graphite', 'white', 'black', 'sage'];
  // FurnitureOptionCatalog 에만 있던 3색 — 내장 표에 아직 없더라도 같은 규칙으로 만든다
  const extraColors = [['gray', 'GRY'], ['beige', 'BGE'], ['navy', 'NVY']];

  test('기존 7×7 = 49 코드가 각각 정확히 한 번 시드된다', () => {
    const codes = [];
    for (const f of finishes) for (const c of baseColors) codes.push(FC.getFinishColorCode(f, c));
    expect(codes).toHaveLength(49);
    expect(new Set(codes).size).toBe(49);
    for (const code of codes) expect({ code, n: countLiteral(code) }).toEqual({ code, n: 1 });
  });

  test('추가 3색 × 7 마감 = 21 코드가 같은 규칙으로 각각 한 번 시드된다', () => {
    for (const f of FC.DOOR_FINISH_CATALOG) {
      for (const [, colorCode] of extraColors) {
        const suffix = FC.TONE_SUFFIX[f.tone] || '';
        const code = suffix ? `${f.code}-${colorCode}-${suffix}` : `${f.code}-${colorCode}`;
        expect({ code, n: countLiteral(code) }).toEqual({ code, n: 1 });
      }
    }
  });

  test('도어 매트릭스 VALUES 행 수는 정확히 70', () => {
    const insert = statements.find(s => /^INSERT INTO materials[\s\S]*'door_material'/.test(s));
    const rows = insert.match(/^\s+\('(?:PET|MFB|LPM|PNT|VNR)-/gm) || [];
    expect(rows).toHaveLength(70);
  });

  test('색 hex 는 bom-finish-color.js DOOR_COLOR_CATALOG 와 같다', () => {
    for (const c of FC.DOOR_COLOR_CATALOG) {
      if (!baseColors.includes(c.value)) continue;
      const code = FC.getFinishColorCode('pet-matte', c.value);
      const line = SQL.split('\n').find(l => l.includes(`'${code}'`));
      expect(line).toContain(`'${c.hex}'`);
    }
    expect(SQL).toMatch(/'PET-GRY-M', 'PET', 'GRY', 'matte', [^\n]*'#9e9e9e'/);
    expect(SQL).toMatch(/'PET-BGE-M', 'PET', 'BGE', 'matte', [^\n]*'#d4c4b0'/);
    expect(SQL).toMatch(/'PET-NVY-M', 'PET', 'NVY', 'matte', [^\n]*'#1a237e'/);
  });

  test('톤별 PBR 기본값', () => {
    // matte r=0.75 m=0 cc=0 / gloss r=0.25 m=0 cc=0.6 / single r=0.6 m=0 cc=0
    expect(SQL).toMatch(/'PET-OAK-M'[\s\S]*?0\.75, 0, 0, 'v', 'PET-M'/);
    expect(SQL).toMatch(/'PET-OAK-G'[\s\S]*?0\.25, 0, 0\.6, 'v', 'PET-G'/);
    expect(SQL).toMatch(/'MFB-OAK'[\s\S]*?0\.6, 0, 0, 'v', 'MFB'/);
  });

  test('price_key 는 FINISH_BASE_PRICE 키와 일치한다', () => {
    for (const key of Object.keys(FC.FINISH_BASE_PRICE)) {
      expect(countLiteral(key)).toBeGreaterThanOrEqual(10); // 마감당 10 색
    }
  });

  test('상판 4 코드 (TOP-SNW/MWH/GMB/CHC) — UPDATE 1 + INSERT 1 = 각 2 회', () => {
    for (const [code, name] of [['TOP-SNW', '스노우'], ['TOP-MWH', '마블화이트'], ['TOP-GMB', '그레이마블'], ['TOP-CHC', '차콜']]) {
      expect(countLiteral(code)).toBe(2);
      expect(SQL).toMatch(new RegExp(`code = '${code}'[\\s\\S]*?category = 'countertop' AND color_name = '${name}' AND code IS NULL`));
    }
  });

  test('기존 door / door_finish 행 코드 채우기', () => {
    for (const [name, code] of [['화이트', 'WHT'], ['그레이', 'GRY'], ['베이지', 'BGE'], ['월넛', 'WNT'], ['오크', 'OAK'], ['네이비', 'NVY'], ['블랙', 'BLK']]) {
      expect(SQL).toMatch(new RegExp(`SET code = '${code}', color_code = '${code}'[\\s\\S]*?category = 'door' AND color_name = '${name}' AND code IS NULL`));
    }
    expect(SQL).toMatch(/SET code = 'TONE-M', tone = 'matte'[\s\S]*?color_name = '무광'/);
    expect(SQL).toMatch(/SET code = 'TONE-G', tone = 'gloss'[\s\S]*?color_name = '유광'/);
    expect(SQL).toMatch(/SET code = 'TONE-E', tone = NULL[\s\S]*?color_name = '엠보'/);
  });
});
