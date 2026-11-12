/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0032_appliance_lower_categories.sql 정적 시험 (DB 없이).
 *
 *   가전 모델 카탈로그에 하부장 안에 들어가는 가전 4종류(로봇청소기 스테이션 · 음식물처리기 · 정수기 · 와인셀러)와
 *   종류별 세부 구분을 더한다 (사장님 2026-11-03). 옛 종류 · 구분은 0000 기준선 그대로.
 *   관리 화면(admin/appliances.html) · 수집기(scripts/kitchen-catalog) 가 같은 목록을 쓰는지도 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const raw = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const noComments = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const S = noComments(raw('database/migrations/0032_appliance_lower_categories.sql'));
const f = S.replace(/\s+/g, ' ');
const BASE = raw('database/migrations/0000_baseline.sql');
const AP = raw('admin/appliances.html');
const COLLECT = raw('scripts/kitchen-catalog/collect.py');
const TO_SQL = raw('scripts/kitchen-catalog/to_sql.py');

const NEW = {
  robot_vacuum: ['toe_kick', 'built_in'],
  food_disposer: ['grinder', 'grinder_microbial', 'microbial', 'dryer'],
  water_purifier: ['purify', 'cold', 'hot', 'hot_cold'],
  wine_cellar: ['under_counter', 'built_in'],
};

/** 0000 기준선 — 종류 목록 */
function baseCategories() {
  const line = BASE.split('\n').find((l) => l.includes('appliance_models_category_check CHECK'));
  return [...line.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
}

/** 0000 기준선 — 종류별 구분 { cat: [...] } */
function baseSubtypes() {
  const start = BASE.indexOf('ADD CONSTRAINT appliance_models_subtype_chk');
  const body = BASE.slice(start, BASE.indexOf('END));', start));
  const out = {};
  for (const m of body.matchAll(
    /WHEN '([a-z_]+)'::text THEN \(subtype = ANY \(ARRAY\[([^\]]*)\]\)\)/g
  )) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_0-9]+)'::text/g)].map((x) => x[1]);
  }
  return out;
}

/** 0032 — 종류 목록 */
function categories() {
  const m = /appliance_models_category_check CHECK \(category IN \(([^)]*)\)\)/.exec(f);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
}

/** 0032 — 종류별 구분 { cat: [...] } */
function subtypes() {
  const start = f.indexOf('ADD CONSTRAINT appliance_models_subtype_chk');
  const body = f.slice(start, f.indexOf('ELSE false END);', start));
  const out = {};
  for (const m of body.matchAll(/WHEN '([a-z_]+)' THEN subtype IN \(([^)]*)\)/g)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  }
  return out;
}

describe('0032 — 하부장 가전 종류', () => {
  test('트랜잭션 문 · 행 고치기 · 권한 바꾸기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b\s*;/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
    expect(S).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(S).not.toMatch(/\bPOLICY\b/i);
    expect(S).not.toMatch(/\bFUNCTION\b/i);
  });

  test('다시 돌려도 된다 — 두 검사는 지우고 다시 만든다', () => {
    expect(f).toContain(
      'ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_category_check;'
    );
    expect(f).toContain(
      'ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk;'
    );
    expect(f.indexOf('DROP CONSTRAINT IF EXISTS appliance_models_category_check')).toBeLessThan(
      f.indexOf('ADD CONSTRAINT appliance_models_category_check')
    );
    expect(f.indexOf('DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk')).toBeLessThan(
      f.indexOf('ADD CONSTRAINT appliance_models_subtype_chk')
    );
  });

  test('종류 = 기준선 목록 그대로 + 새 종류 4개', () => {
    const base = baseCategories();
    expect(base).toContain('faucet');
    expect(categories()).toEqual([...base, ...Object.keys(NEW)]);
  });

  test('세부 구분 — 옛 종류는 기준선 그대로, 새 종류는 정한 목록, 그 밖 종류는 구분을 못 가진다', () => {
    const base = baseSubtypes();
    expect(Object.keys(base)).toEqual([
      'refrigerator',
      'microwave',
      'oven',
      'dishwasher',
      'cooktop',
      'hood',
      'rice_cooker',
      'range',
    ]);
    expect(subtypes()).toEqual({ ...base, ...NEW });
    expect(f).toContain('CHECK (subtype IS NULL OR CASE category');
    expect(f).toContain('ELSE false END);');
  });
});

describe('관리 화면 · 수집기도 같은 목록', () => {
  const block = (name) => {
    const s = AP.slice(AP.indexOf(`const ${name} = {`));
    return s.slice(0, s.indexOf('\n      };') + 9);
  };

  test('탭 · 종류 옵션', () => {
    for (const c of Object.keys(NEW)) {
      expect([c, AP.includes(`data-cat="${c}"`)]).toEqual([c, true]);
      expect([c, AP.includes(`<option value="${c}">`)]).toEqual([c, true]);
    }
  });

  test('세부 구분 이름표 = DB 검사 목록', () => {
    const sub = block('SUBTYPES');
    for (const [cat, list] of Object.entries(NEW)) {
      const line = sub.split('\n').find((l) => l.trim().startsWith(`${cat}:`));
      expect([
        cat,
        line ? [...line.matchAll(/([a-z_0-9]+):\s*'/g)].map((m) => m[1]) : null,
      ]).toEqual([cat, list]);
    }
  });

  test('수집기 치수 범위 · SQL 이름표에 새 종류가 있다', () => {
    for (const c of Object.keys(NEW)) {
      expect([
        c,
        new RegExp(
          `"${c}":\\s*\\{"w": \\(\\d+, \\d+\\), "h": \\(\\d+, \\d+\\), "d": \\(\\d+, \\d+\\)\\}`
        ).test(COLLECT),
      ]).toEqual([c, true]);
      expect([c, TO_SQL.includes(`'${c}': '`)]).toEqual([c, true]);
    }
  });
});
