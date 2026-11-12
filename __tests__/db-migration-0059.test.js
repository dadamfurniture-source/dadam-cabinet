/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0059_stock.sql 정적 시험 (DB 없이).
 *
 *   마이페이지 6단계 (2026-11-12 사장님 결정 넷) — 재고 표 넷(품목 · 입출고 기록 · 자투리 · 자투리 기록)과
 *   입출고 한 번 함수 stock_move(). 네 표 모두 서버만 드나들고(정책 없음) 지우지 않는다.
 *   값은 database/probes/0059-stock.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0059_stock.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const TABLES = ['stock_items', 'stock_moves', 'stock_offcuts', 'stock_offcut_events'];

describe('0059 — 재고 (품목 · 입출고 기록 · 자투리 · 자투리 기록)', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 넷', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('네 표 모두 서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음 · 서버도 지우지 못함', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    for (const t of TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(f).toMatch(
        new RegExp(`REVOKE (UPDATE, )?DELETE, TRUNCATE ON TABLE public\\.${t} FROM service_role;`)
      );
    }
  });

  test('기록 두 표는 추가만 — 서버에도 고치기 권한이 없다', () => {
    for (const t of ['stock_moves', 'stock_offcut_events']) {
      expect(f).toContain(`GRANT SELECT, INSERT ON TABLE public.${t} TO service_role;`);
      expect(f).toContain(
        `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.${t} FROM service_role;`
      );
    }
  });

  test('품목 — 판재 · 철물, 수량은 0 이상, 입고 예정은 수량 · 받을 날이 같이, 업체 안에서 이름 · 규격이 겹치지 않는다', () => {
    expect(f).toContain("CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text]))");
    expect(f).toContain('CHECK ((qty >= 0) AND (safety_qty >= 0))');
    expect(f).toContain(
      'CHECK (((expected_qty IS NULL) AND (expected_on IS NULL)) OR ((expected_qty > 0) AND (expected_on IS NOT NULL)))'
    );
    expect(f).toContain(
      'ON public.stock_items USING btree (company_id, kind, lower(name), lower(spec))'
    );
    expect(f).toContain(
      'FOREIGN KEY (supplier_id) REFERENCES public.counterparties(id) ON DELETE SET NULL'
    );
  });

  test('입출고 기록 — 종류 셋, 입고 · 출고는 양수 · 실사 조정은 0 아님, 같은 업체 품목만', () => {
    expect(f).toContain("CHECK (kind = ANY (ARRAY['in'::text, 'out'::text, 'adjust'::text]))");
    expect(f).toContain("(kind = 'adjust'::text) AND (qty <> 0)");
    expect(f).toContain("(kind <> 'adjust'::text) AND (qty > 0)");
    expect(f).toContain(
      'FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT'
    );
  });

  test('stock_move — 줄을 잠그고, 모자라면 거절하고, 입고면 입고 예정을 줄인다 · 서버만 부른다', () => {
    expect(f).toContain('WHERE id = p_item AND company_id = p_company FOR UPDATE');
    expect(f).toContain("v_delta := CASE p_kind WHEN 'out' THEN -p_qty ELSE p_qty END;");
    expect(f).toContain('IF v_after < 0 THEN');
    expect(f).toContain("IF p_kind = 'in' AND v_expected IS NOT NULL THEN");
    expect(f).toContain("SET search_path TO ''");
    expect(f).not.toContain('SECURITY DEFINER');
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT EXECUTE ON FUNCTION public.stock_move(uuid, uuid, text, numeric, text, text, uuid) TO service_role;'
    );
  });

  test('자투리 — 번호는 업체마다 하나, 상태 넷, 씀 · 버림은 끝, 크기 한도', () => {
    expect(f).toContain('CONSTRAINT stock_offcuts_seq_key UNIQUE (company_id, seq)');
    expect(f).toContain(
      "CHECK (state = ANY (ARRAY['left'::text, 'reserved'::text, 'used'::text, 'discarded'::text]))"
    );
    expect(f).toContain(
      "CHECK ((state = ANY (ARRAY['used'::text, 'discarded'::text])) = (closed_at IS NOT NULL))"
    );
    expect(f).toContain('(width_mm BETWEEN 1 AND 3000) AND (height_mm BETWEEN 1 AND 3000)');
    expect(f).toContain("IF OLD.state NOT IN ('left', 'reserved') THEN");
    expect(f).toContain(
      "IF NEW.state IN ('used', 'discarded') THEN NEW.closed_at := now(); END IF;"
    );
    expect(f).toContain('BEFORE UPDATE ON public.stock_offcuts');
  });

  test('자투리 기록 — 종류 일곱, 같은 업체 자투리만', () => {
    expect(f).toContain(
      "CHECK (type = ANY (ARRAY['added'::text, 'reserved'::text, 'released'::text, 'used'::text, 'discarded'::text, 'moved'::text, 'label'::text]))"
    );
    expect(f).toContain(
      'FOREIGN KEY (offcut_id, company_id) REFERENCES public.stock_offcuts(id, company_id) ON DELETE RESTRICT'
    );
  });

  test('고객 정보 칸이 없다', () => {
    expect(top).not.toMatch(/\b(customer|phone|address)\w*\s+(text|uuid)/i);
  });
});
