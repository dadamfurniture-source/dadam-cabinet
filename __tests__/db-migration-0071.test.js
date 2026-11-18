/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0071_part_catalog.sql 정적 시험 (DB 없이).
 *
 *   철물 · 부속 카탈로그 (2026-11-18) — 공급 회사(part_vendors)와 그 회사의 상품(part_items) · 사진 버킷 part-photos.
 *   둘 다 서버만 · 지우기 없음 · 상품은 같은 팩토리의 공급 회사에만 · 팩토리와 공급 회사는 바꾸지 못한다.
 *   값은 database/probes/0071-part-catalog.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0071_part_catalog.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const TABLES = ['part_vendors', 'part_items'];

describe('0071 — 철물 · 부속 카탈로그', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기가 없다, 새 표는 둘, 행 넣기는 사진 버킷뿐', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/(^|; )\s*INSERT INTO \S+/g).map((s) => s.replace(/^;?\s*/, ''))).toEqual([
      'INSERT INTO storage.buckets',
    ]);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('둘 다 서버만 — RLS 켬 · 정책 없음 · 브라우저 역할에 권한 없음 · 서버도 지우지 못한다', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    for (const t of TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(f).toContain(`GRANT SELECT, INSERT, UPDATE ON TABLE public.${t} TO service_role;`);
      expect(f).toContain(`REVOKE DELETE, TRUNCATE ON TABLE public.${t} FROM service_role;`);
    }
  });

  test('공급 회사 — 팩토리마다 · 이름 1 ~ 40자 · 같은 팩토리에 같은 이름은 하나', () => {
    expect(f).toContain(
      'CONSTRAINT part_vendors_name_check CHECK ((length(btrim(name)) >= 1) AND (length(name) <= 40))'
    );
    expect(f).toContain('CONSTRAINT part_vendors_id_company_key UNIQUE (id, company_id)');
    expect(f).toContain(
      'CONSTRAINT part_vendors_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_part_vendors_name ON public.part_vendors USING btree (company_id, lower(btrim(name)));'
    );
  });

  test('상품 — 같은 팩토리의 공급 회사에만 · 참고가 · 매입가는 0 ~ 1억이고 본 날과 같이 · 옵션 · 사양은 JSON 모양과 크기 한도', () => {
    expect(f).toContain(
      'CONSTRAINT part_items_vendor_fkey FOREIGN KEY (vendor_id, company_id) REFERENCES public.part_vendors(id, company_id)'
    );
    expect(f).toContain(
      'CONSTRAINT part_items_ref_price_check CHECK ((ref_price IS NULL) OR ((ref_price >= 0) AND (ref_price <= 100000000) AND (ref_price_on IS NOT NULL)))'
    );
    expect(f).toContain(
      'CONSTRAINT part_items_buy_price_check CHECK ((buy_price IS NULL) OR ((buy_price >= 0) AND (buy_price <= 100000000) AND (buy_price_on IS NOT NULL)))'
    );
    expect(f).toContain(
      "(jsonb_typeof(options) = 'array'::text) AND (jsonb_typeof(addons) = 'array'::text)"
    );
    expect(f).toContain("(jsonb_typeof(specs) = 'object'::text)");
    expect(f).toContain('(length((options)::text) <= 20000)');
    expect(f).toContain('(length((specs)::text) <= 20000)');
    expect(f).toContain("options jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(f).toContain("specs jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(f).toContain('specs_checked boolean DEFAULT false NOT NULL');
    expect(f).toContain('active boolean DEFAULT true NOT NULL');
    expect(f).toContain('((width_mm IS NULL) OR ((width_mm > 0) AND (width_mm <= 10000)))');
    // 같은 공급 회사에 같은 상품 번호는 하나 — 번호가 없으면 같은 이름이 하나
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_part_items_vendor_no ON public.part_items USING btree (vendor_id, vendor_item_no) WHERE (vendor_item_no <> ''::text);"
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_part_items_vendor_name ON public.part_items USING btree (vendor_id, lower(btrim(name))) WHERE (vendor_item_no = ''::text);"
    );
  });

  test('상품 지킴이 — 팩토리 · 공급 회사 · 만든 때는 그대로 · 아무 역할도 직접 부르지 못한다', () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.part_items_guard\(\)(.*?)\$function\$;/.exec(
      f
    )[1];
    expect(fn).toContain("SET search_path TO ''");
    expect(fn).toContain(
      '(NEW.id, NEW.company_id, NEW.vendor_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.vendor_id, OLD.created_at)'
    );
    expect(fn).toContain("USING ERRCODE = '22023'");
    expect(fn).toContain('NEW.updated_at := now();');
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.part_items_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain('DROP TRIGGER IF EXISTS trg_part_items_guard ON public.part_items;');
    expect(f).toContain(
      'CREATE TRIGGER trg_part_items_guard BEFORE UPDATE ON public.part_items FOR EACH ROW EXECUTE FUNCTION public.part_items_guard();'
    );
  });

  test('사진 버킷 — 비공개 · 5MB · 다시 돌려도 된다', () => {
    expect(f).toContain(
      "VALUES ('part-photos', 'part-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])"
    );
    expect(f).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(f).not.toContain('storage.objects');
  });

  test('확인표 — 두 표 · 지킴이 · 권한 · 버킷을 실DB 에서 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0071-part-catalog.json'));
    expect(probe.title).toContain('database/migrations/0071_part_catalog.sql');
    expect(Object.keys(probe.roles)).toEqual(['anon', 'x_owner', 'service_role']);
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '서버만',
      '같은 이름은 하나',
      '같은 상품 번호는 하나',
      '다른 팩토리',
      '지우지 못한다',
      '바꾸지 못한다',
      'RLS',
      '정책이 없다',
      '사진 버킷',
    ]) {
      expect(names).toContain(word);
    }
    // 칸마다 문장 하나 — 바꾸고 읽기를 한 칸에 섞지 않는다
    for (const c of probe.checks) {
      expect(c.sql.split(';').filter((s) => s.trim()).length).toBe(1);
      expect(/^\s*(select|insert|update|delete)\b/i.test(c.sql)).toBe(true);
    }
    // 브라우저 역할(anon · 대표 계정)이 든 칸은 모두 거절이다
    for (const c of probe.checks) {
      for (const role of ['anon', 'x_owner'])
        if (c.expect[role] !== undefined) expect(c.expect[role]).toBe('deny');
    }
    // 넣기는 ok · 고치기는 rows:n (확인표 규칙)
    for (const c of probe.checks) {
      const got = c.expect.service_role;
      if (/^\s*insert\b/i.test(c.sql)) expect(got === 'ok' || /^err:/.test(got)).toBe(true);
      if (/^\s*update\b/i.test(c.sql)) expect(/^(rows:\d+|err:\d+)$/.test(got)).toBe(true);
    }
  });
});
