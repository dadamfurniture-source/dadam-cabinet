/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0063_stock_links.sql 정적 시험 (DB 없이).
 *
 *   작업지시 자재 ↔ 재고 잇기 (2026-11-12 사장님 결정) — 짝표 stock_links · 수주 자재 출고 stock_issues · 함수 stock_issue().
 *   두 표 모두 서버만. 값은 database/probes/0063-stock-links.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const f = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0063_stock_links.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const FN = 'stock_issue(uuid, uuid, text, jsonb, uuid)';

describe('0063 — 작업지시 자재 ↔ 재고 (짝표 · 수주 자재 출고)', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 둘 · 있던 표는 건드리지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION|ALTER TABLE public\.(stock_items|stock_moves|orders))\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.stock_links',
      'CREATE TABLE IF NOT EXISTS public.stock_issues',
    ]);
  });

  test('두 표 모두 서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    for (const t of ['stock_links', 'stock_issues']) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
  });

  test('짝표 — 자재 키는 업체 안에서 하나, 품목이 있거나 다루지 않거나 하나만, 같은 업체 품목만. 설정이라 서버는 지운다', () => {
    expect(f).toContain('CONSTRAINT stock_links_key UNIQUE (company_id, match_key)');
    expect(f).toContain('CHECK (ignored = (item_id IS NULL))');
    expect(f).toContain("CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text]))");
    expect(f).toContain(
      'FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_links TO service_role;'
    );
  });

  test('수주 자재 출고 — 같은 수주는 한 번만, 같은 업체 수주만, 추가만', () => {
    expect(f).toContain('CONSTRAINT stock_issues_order_key UNIQUE (company_id, order_id)');
    expect(f).toContain(
      'FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain('GRANT SELECT, INSERT ON TABLE public.stock_issues TO service_role;');
    expect(f).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_issues FROM service_role;'
    );
  });

  test('stock_issue — 기록을 먼저 넣고(겹치면 멈춤) 줄마다 stock_move(out). 정의자 권한 아님 · 서버만 부른다', () => {
    const body = /\$function\$(.*?)\$function\$/.exec(f)[1];
    expect(body.indexOf('INSERT INTO public.stock_issues')).toBeGreaterThan(0);
    expect(body.indexOf('INSERT INTO public.stock_issues')).toBeLessThan(
      body.indexOf('PERFORM public.stock_move')
    );
    expect(body).toContain(
      "PERFORM public.stock_move(p_company, v_item, 'out', v_qty, NULLIF(btrim(p_ref), ''), NULL, p_actor);"
    );
    expect(body).toContain('jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100');
    expect(f).toContain("SET search_path TO ''");
    expect(f).not.toContain('SECURITY DEFINER');
    expect(f).toContain(`REVOKE ALL ON FUNCTION public.${FN} FROM PUBLIC, anon, authenticated;`);
    expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${FN} TO service_role;`);
  });
});
