/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0073_appliance_laundry_combos.sql 정적 시험 (DB 없이).
 *
 *   가전 카탈로그 (2026-11-20) — 건조기 종류 · 세탁기 / 건조기 세부 구분 · 조합 묶음(나란히 · 쌓기).
 *   묶음 두 표는 appliance_models 처럼 누구나 읽고 사이트 관리자만 쓴다. 가져오기 함수는 서버만.
 *   값은 database/probes/0073-appliance-combos.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0073_appliance_laundry_combos.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const TABLES = ['appliance_combos', 'appliance_combo_members'];
const ADMIN =
  "(auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))";

describe('0073 — 가전 카탈로그 세탁 · 조합', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다, 새 표는 둘', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('종류에 건조기 · 세탁기와 건조기의 구분 · 기존 종류 · 구분은 그대로', () => {
    expect(f).toContain(
      "'robot_vacuum', 'food_disposer', 'water_purifier', 'wine_cellar', 'dryer' ));"
    );
    expect(f).toContain(
      "WHEN 'washing_machine' THEN subtype IN ('drum', 'top_load', 'mini', 'combo', 'washtower')"
    );
    expect(f).toContain("WHEN 'dryer' THEN subtype IN ('heat_pump', 'electric', 'gas')");
    // 0032 의 구분이 하나도 빠지지 않았다
    const old = read('database', 'migrations', '0032_appliance_lower_categories.sql').replace(
      /\s+/g,
      ' '
    );
    for (const m of old.matchAll(/WHEN '(\w+)' THEN subtype IN \(([^)]*)\)/g))
      expect(f).toContain(`WHEN '${m[1]}' THEN subtype IN (${m[2]})`);
    expect(f).toContain('ELSE false END);');
  });

  test('묶음 — 갈래 · 방식 · 쌓기는 두 대 · 나란히 1 ~ 6 대 · 사이 여유 0 ~ 500 · 같은 브랜드에 같은 이름은 하나', () => {
    expect(f).toContain(
      "CONSTRAINT appliance_combos_family_check CHECK (family IN ('fridge', 'laundry'))"
    );
    expect(f).toContain("CONSTRAINT appliance_combos_kind_check CHECK (kind IN ('side', 'stack'))");
    expect(f).toContain(
      "CONSTRAINT appliance_combos_units_check CHECK ((kind = 'stack' AND max_units = 2) OR (kind = 'side' AND max_units BETWEEN 1 AND 6))"
    );
    expect(f).toContain(
      'CONSTRAINT appliance_combos_gap_check CHECK ((gap_mm IS NULL) OR (gap_mm BETWEEN 0 AND 500))'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_appliance_combos_name ON public.appliance_combos USING btree (brand, lower(btrim(name)));'
    );
  });

  test('묶음 모델 — 자리 셋 · 모델 · 묶음을 지우면 같이 지워진다 · 방식과 맞는 자리만 (지킴이)', () => {
    expect(f).toContain(
      "CONSTRAINT appliance_combo_members_role_check CHECK (role IN ('any', 'lower', 'upper'))"
    );
    expect(f).toContain(
      'FOREIGN KEY (combo_id) REFERENCES public.appliance_combos(id) ON DELETE CASCADE'
    );
    expect(f).toContain(
      'FOREIGN KEY (model_id) REFERENCES public.appliance_models(id) ON DELETE CASCADE'
    );
    expect(f).toContain(
      'CREATE TRIGGER appliance_combo_members_guard BEFORE INSERT OR UPDATE ON public.appliance_combo_members'
    );
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.appliance_combo_members_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('읽기 · 쓰기 — appliance_models 와 같다: 누구나 읽고 사이트 관리자만 넣기 · 고치기 · 지우기', () => {
    for (const t of TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(
        `REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT SELECT ON TABLE public.${t} TO anon;`);
      expect(f).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${t} TO authenticated, service_role;`
      );
      expect(f).toContain(
        `CREATE POLICY ${t}_read_all ON public.${t} FOR SELECT TO PUBLIC USING (true);`
      );
      expect(f).toContain(
        `CREATE POLICY ${t}_admin_insert ON public.${t} FOR INSERT TO PUBLIC WITH CHECK (${ADMIN});`
      );
      expect(f).toContain(
        `CREATE POLICY ${t}_admin_update ON public.${t} FOR UPDATE TO PUBLIC USING (${ADMIN});`
      );
      expect(f).toContain(
        `CREATE POLICY ${t}_admin_delete ON public.${t} FOR DELETE TO PUBLIC USING (${ADMIN});`
      );
    }
    expect(f.match(/CREATE POLICY/g)).toHaveLength(8);
  });

  test('가져오기 함수 — 서버만, 같은 브랜드의 모델 코드로 찾는다', () => {
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.import_appliance_combos(jsonb) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT EXECUTE ON FUNCTION public.import_appliance_combos(jsonb) TO service_role;'
    );
    expect(f).toContain(
      "WHERE brand = r->>'brand' AND (model_code = m->>'code' OR (m->>'code') = ANY(model_codes))"
    );
    expect(f).toContain("(k = 'stack' AND (n_lower < 1 OR n_upper < 1))");
  });

  test('확인표가 있다', () => {
    const p = JSON.parse(read('database', 'probes', '0073-appliance-combos.json'));
    expect(p.checks.length).toBeGreaterThanOrEqual(15);
    expect(p.checks.every((c) => c.name && c.sql && c.expect)).toBe(true);
  });
});
