/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 주방가전 모델 수집 (2026-10-25 사장님 — "전자레인지 및 주방가전 데이터 수집").
 *   DB: 종류 rice_cooker · 종류별 세부 구분 검사 · 가져오기 함수가 쿡탑 타공도 넣는다 (database/appliance-models-kitchen.sql)
 *   관리 화면: 오븐 · 밥솥 탭, 종류별 세부 구분 이름표, 수집 칸은 수집하는 종류(냉장고 · 주방가전)에서
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const KITCHEN = read('database/appliance-models-kitchen.sql');
const CATALOG = read('database/appliance-models-catalog.sql');
const SCHEMA = read('database/appliance-models-schema.sql');
const AP = read('admin/appliances.html');

const CATEGORIES = ['refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine', 'microwave', 'rice_cooker'];
const KITCHEN_SUBTYPES = {
  microwave: ['solo', 'combi'],
  oven: ['oven', 'steam_oven', 'combi'],
  dishwasher: ['built_in', 'freestanding', 'countertop'],
  cooktop: ['induction', 'highlight', 'hybrid', 'gas'],
  hood: ['chimney', 'slim', 'built_in', 'island'],
  rice_cooker: ['pressure_ih', 'ih', 'pressure', 'electric'],
};

/** CHECK (… CASE category WHEN 'x' THEN subtype IN (…) …) → { x: [...] } */
function subtypeCheckOf(sql) {
  const start = sql.indexOf('ADD CONSTRAINT appliance_models_subtype_chk CHECK');
  const body = sql.slice(start, sql.indexOf('ELSE false END);', start));
  const out = {};
  // 주석(-- …) 안 괄호는 목록이 아니다 — 지우고 읽는다
  for (const m of body.replace(/--[^\n]*/g, '').matchAll(/WHEN '([a-z_]+)' THEN subtype IN \(([^)]*)\)/g)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  }
  return { out, text: body };
}

describe('DB — appliance-models-kitchen.sql', () => {
  test('종류에 밥솥(rice_cooker)을 더한다 · 첫 스키마 · 전자레인지 SQL 과 같은 목록', () => {
    const chk = KITCHEN.slice(KITCHEN.indexOf('ADD CONSTRAINT appliance_models_category_check'), KITCHEN.indexOf(');', KITCHEN.indexOf('ADD CONSTRAINT appliance_models_category_check')));
    expect([...chk.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CATEGORIES);
    expect(KITCHEN).toContain('DROP CONSTRAINT IF EXISTS appliance_models_category_check');
    // appliance-models-microwave.sql 도 같은 목록 — kitchen.sql 뒤에 다시 돌려도 밥솥 행이 걸리지 않게
    const MW = read('database/appliance-models-microwave.sql');
    const mw = MW.slice(MW.indexOf('ADD CONSTRAINT appliance_models_category_check'), MW.indexOf(');', MW.indexOf('ADD CONSTRAINT appliance_models_category_check')));
    expect([...mw.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CATEGORIES);
    const first = SCHEMA.slice(SCHEMA.indexOf('category    TEXT NOT NULL CHECK'), SCHEMA.indexOf('\n', SCHEMA.indexOf('category    TEXT NOT NULL CHECK')));
    expect([...first.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CATEGORIES);
  });

  test('세부 구분 검사는 종류별 — 냉장고 9가지 그대로, 주방가전 종류마다, 모르는 종류는 subtype 을 못 가진다', () => {
    const { out, text } = subtypeCheckOf(KITCHEN);
    expect(out.refrigerator).toEqual(['french_4door', 'side_by_side', 'two_door', 'one_door', 'built_in', 'kimchi_stand', 'kimchi_lid', 'wine', 'small']);
    for (const [cat, list] of Object.entries(KITCHEN_SUBTYPES)) expect([cat, out[cat]]).toEqual([cat, list]);
    expect(text).toContain('CHECK (subtype IS NULL OR CASE category');
  });

  test('appliance-models-catalog.sql 도 같은 정의 — 주방가전 행이 들어간 뒤 그 파일을 다시 돌려도 걸리지 않는다', () => {
    expect(subtypeCheckOf(CATALOG).text).toBe(subtypeCheckOf(KITCHEN).text);
  });

  test('이 파일만 돌려도 되게 함수가 쓰는 칸은 모두 IF NOT EXISTS', () => {
    for (const col of ['subtype', 'line', 'install_type', 'model_codes', 'back_gap_mm', 'discontinued', 'collected_at', 'side_gap_mm', 'top_gap_mm',
      'niche_min_w_mm', 'niche_min_h_mm', 'niche_min_d_mm', 'niche_max_w_mm', 'niche_max_h_mm', 'niche_max_d_mm', 'image_source_url',
      'cutout_w_mm', 'cutout_d_mm', 'cutout_r_mm', 'faucet_hole_mm']) {
      expect([col, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(KITCHEN)]).toEqual([col, true]);
    }
  });

  test('가져오기 함수 — 쿡탑 · 싱크볼 타공과 수전 구멍을 넣고, 다시 가져올 때는 기존 값(관리 화면에서 고친 값) 우선', () => {
    expect(KITCHEN).toContain('CREATE OR REPLACE FUNCTION import_appliance_models(rows JSONB)');
    expect(KITCHEN).toMatch(/cutout_w_mm, cutout_d_mm, cutout_r_mm, faucet_hole_mm,\s+verified, source_url/);
    expect(KITCHEN).toContain("NULLIF(r->>'faucet_hole_mm', '')::INT,");
    for (const k of ['cutout_w_mm', 'cutout_d_mm', 'cutout_r_mm', 'faucet_hole_mm']) {
      expect(KITCHEN).toMatch(new RegExp(`${k}\\s+= COALESCE\\(${k}, NULLIF\\(r->>'${k}', ''\\)::INT\\)`));
    }
    // 냉장고 가져오기 규칙은 그대로 (여유 · 니치 기존 값 우선, 코드 합집합, 검증 OR)
    expect(KITCHEN).toMatch(/side_gap_mm\s+= COALESCE\(side_gap_mm, NULLIF\(r->>'side_gap_mm', ''\)::INT\)/);
    expect(KITCHEN).toMatch(/niche_min_w_mm\s+= COALESCE\(niche_min_w_mm, NULLIF\(r->>'niche_min_w_mm', ''\)::INT\)/);
    expect(KITCHEN).toMatch(/model_codes\s+= ARRAY\(SELECT DISTINCT unnest\(model_codes \|\| codes\)\)/);
    expect(KITCHEN).toMatch(/verified\s+= verified OR COALESCE/);
    expect(KITCHEN).toContain("COALESCE(r->>'category', 'refrigerator')");
  });

  test('웹 · 익명은 가져오기 함수를 못 부른다', () => {
    expect(KITCHEN).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;');
    expect(KITCHEN).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;');
  });
});

describe('관리 화면 — admin/appliances.html', () => {
  const block = (name) => {
    const s = AP.slice(AP.indexOf(`const ${name} = {`));
    return s.slice(0, s.indexOf('\n      };') + 9);
  };

  test('오븐 · 밥솥 탭과 종류 옵션', () => {
    expect(AP).toContain('data-cat="oven"');
    expect(AP).toContain('data-cat="rice_cooker"');
    expect(AP).toContain('<option value="rice_cooker">');
  });

  test('종류별 세부 구분 이름표 = DB 검사 목록', () => {
    const sub = block('SUBTYPES');
    for (const [cat, list] of Object.entries(KITCHEN_SUBTYPES)) {
      const line = sub.split('\n').find((l) => l.trim().startsWith(`${cat}:`));
      expect([cat, [...line.matchAll(/([a-z_0-9]+):\s*'/g)].map((m) => m[1])]).toEqual([cat, list]);
    }
    expect(sub).toContain('refrigerator: FRIDGE_SUBTYPES');
    expect(AP).toContain('const COLLECTED_CATS = Object.keys(SUBTYPES);');
  });

  test('목록 · 필터 · 입력이 그 종류의 이름표를 쓴다', () => {
    expect(AP).toContain('(SUBTYPES[r.category] || {})[r.subtype]');
    expect(AP).toContain("filter.style.display = SUBTYPES[cat] ? '' : 'none';");
    expect(AP).toContain("sel.innerHTML = '<option value=\"\">미지정</option>' + subtypeOptions(cat);");
    // 이름표는 escape 한다
    expect(AP).toContain('`<option value="${k}">${escHtml(v)}</option>`');
  });
});
