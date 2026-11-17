/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0070_price_lists.sql 정적 시험 (DB 없이).
 *
 *   자재 가격표 (2026-11-18) — 팩토리가 올린 공급처 가격표 한 벌(price_lists)과 그 줄(price_list_items).
 *   둘 다 서버만 · 지우기 없음 · 가격표는 상태만 loading → ready · 줄은 넣기만.
 *   값은 database/probes/0070-price-lists.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0070_price_lists.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const TABLES = ['price_lists', 'price_list_items'];

describe('0070 — 자재 가격표', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다, 새 표는 둘', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
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
    }
    expect(f).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.price_lists TO service_role;');
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.price_lists FROM service_role;');
    // 줄은 넣기만 — 고치기 권한도 없다
    expect(f).toContain('GRANT SELECT, INSERT ON TABLE public.price_list_items TO service_role;');
    expect(f).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.price_list_items FROM service_role;'
    );
  });

  test('가격표 — 팩토리 · 공급처(1 ~ 40자) · 줄 수(1 ~ 5000) · 상태(loading · ready, 기본 loading)', () => {
    expect(f).toContain('company_id uuid NOT NULL');
    expect(f).toContain('supplier text NOT NULL');
    expect(f).toContain("state text DEFAULT 'loading'::text NOT NULL");
    expect(f).toContain(
      'CONSTRAINT price_lists_supplier_check CHECK ((length(btrim(supplier)) >= 1) AND (length(supplier) <= 40))'
    );
    expect(f).toContain('CONSTRAINT price_lists_rows_check CHECK ((row_count >= 1) AND (row_count <= 5000))');
    expect(f).toContain(
      "CONSTRAINT price_lists_state_check CHECK (state = ANY (ARRAY['loading'::text, 'ready'::text]))"
    );
    expect(f).toContain(
      'CONSTRAINT price_lists_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)'
    );
    expect(f).toContain(
      'CONSTRAINT price_lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL'
    );
    expect(f).toContain('CONSTRAINT price_lists_id_company_key UNIQUE (id, company_id)');
    expect(f).toContain(
      'CREATE INDEX IF NOT EXISTS idx_price_lists_company ON public.price_lists USING btree (company_id, created_at DESC);'
    );
  });

  test('가격표 지킴이 — 내용은 그대로, 상태만 loading → ready 한 번 · 아무 역할도 직접 부르지 못한다', () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.price_lists_guard\(\)(.*?)\$function\$;/.exec(f)[1];
    expect(fn).toContain("SET search_path TO ''");
    expect(fn).toContain(
      '(NEW.id, NEW.company_id, NEW.supplier, NEW.source_name, NEW.row_count, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.supplier, OLD.source_name, OLD.row_count, OLD.created_at)'
    );
    expect(fn).toContain('(NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by)');
    expect(fn).toContain(
      "NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'loading' AND NEW.state = 'ready')"
    );
    expect(fn.match(/USING ERRCODE = '22023'/g)).toHaveLength(2);
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.price_lists_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain('DROP TRIGGER IF EXISTS trg_price_lists_guard ON public.price_lists;');
    expect(f).toContain(
      'CREATE TRIGGER trg_price_lists_guard BEFORE UPDATE ON public.price_lists FOR EACH ROW EXECUTE FUNCTION public.price_lists_guard();'
    );
  });

  test('줄 — 가격표 안 차례가 열쇠 · 용도 다섯 · 단가 0 ~ 1억 · 같은 팩토리의 가격표에만', () => {
    expect(f).toContain('CONSTRAINT price_list_items_pkey PRIMARY KEY (list_id, seq)');
    expect(f).toContain('CONSTRAINT price_list_items_seq_check CHECK ((seq >= 1) AND (seq <= 5000))');
    expect(f).toContain(
      "CONSTRAINT price_list_items_kind_check CHECK (kind = ANY (ARRAY['body'::text, 'back'::text, 'door'::text, 'edge'::text, 'other'::text]))"
    );
    expect(f).toContain(
      'CONSTRAINT price_list_items_name_check CHECK ((length(btrim(color_name)) >= 1) OR (length(btrim(code)) >= 1))'
    );
    expect(f).toContain(
      'CONSTRAINT price_list_items_price_check CHECK ((unit_price >= 0) AND (unit_price <= 100000000))'
    );
    expect(f).toContain(
      'CONSTRAINT price_list_items_thickness_check CHECK ((thickness IS NULL) OR ((thickness > (0)::numeric) AND (thickness <= (100)::numeric)))'
    );
    expect(f).toContain(
      'CONSTRAINT price_list_items_text_check CHECK ((length(category) <= 40) AND (length(product) <= 60) AND (length(spec) <= 60) AND (length(color_name) <= 40) AND (length(code) <= 40) AND (length(size_text) <= 40))'
    );
    expect(f).toContain(
      'CONSTRAINT price_list_items_list_fkey FOREIGN KEY (list_id, company_id) REFERENCES public.price_lists(id, company_id)'
    );
    expect(f).toContain(
      'CREATE INDEX IF NOT EXISTS idx_price_list_items_kind ON public.price_list_items USING btree (list_id, kind, seq);'
    );
    // 줄 수 한도는 가격표의 줄 수 한도와 같다
    expect(f).toContain('(seq <= 5000)');
    expect(f).toContain('(row_count <= 5000)');
  });

  test('확인표 — 두 표 · 지킴이 · 권한을 실DB 에서 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0070-price-lists.json'));
    expect(probe.title).toContain('database/migrations/0070_price_lists.sql');
    expect(Object.keys(probe.roles)).toEqual(['anon', 'x_owner', 'service_role']);
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of ['서버만', 'loading → ready', 'ready → loading', '지우지 못한다', '고치지 못한다', '모르는 용도', '다른 팩토리', 'RLS', '정책이 없다']) {
      expect(names).toContain(word);
    }
    // 칸마다 문장 하나 — 바꾸고 읽기를 한 칸에 섞지 않는다
    for (const c of probe.checks) {
      expect(c.sql.split(';').filter((s) => s.trim()).length).toBe(1);
      expect(/^\s*(select|insert|update|delete)\b/i.test(c.sql)).toBe(true);
    }
    // 브라우저 역할(anon · 대표 계정)이 든 칸은 모두 거절이다
    for (const c of probe.checks) {
      for (const role of ['anon', 'x_owner']) if (c.expect[role] !== undefined) expect(c.expect[role]).toBe('deny');
    }
  });
});
