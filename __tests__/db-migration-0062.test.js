/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0062_stock_orders.sql 정적 시험 (DB 없이).
 *
 *   재고 구매 발주 (2026-11-12 사장님 결정) — stock_orders · stock_order_lines 와 함수 넷
 *   (입고 예정 빼기 · 발주 넣기 · 입고 · 취소). 두 표 모두 서버만, 지우지 않는다.
 *   값은 database/probes/0062-stock-orders.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const f = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0062_stock_orders.sql'),
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
const TABLES = ['stock_orders', 'stock_order_lines'];
const FUNCS = [
  'stock_expected_take(uuid, uuid, numeric)',
  'stock_order_place(uuid, uuid, date, text, jsonb, uuid)',
  'stock_order_receive(uuid, uuid, uuid, jsonb)',
  'stock_order_cancel(uuid, uuid, uuid)',
];

describe('0062 — 재고 구매 발주', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 둘 · 있던 표는 건드리지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION|ALTER TABLE public\.(stock_items|stock_moves|work_reports))\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('두 표 모두 서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음 · 서버도 지우지 못함', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    for (const t of TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(f).toContain(`REVOKE DELETE, TRUNCATE ON TABLE public.${t} FROM service_role;`);
    }
  });

  test('발주 — 번호는 업체마다 하나, 상태 셋, 끝난 때는 끝났을 때만, 받을 날은 꼭', () => {
    expect(f).toContain('CONSTRAINT stock_orders_seq_key UNIQUE (company_id, seq)');
    expect(f).toContain(
      "CHECK (state = ANY (ARRAY['ordered'::text, 'received'::text, 'cancelled'::text]))"
    );
    expect(f).toContain("CHECK ((state = 'ordered'::text) = (closed_at IS NULL))");
    expect(f).toContain('expected_on date NOT NULL');
  });

  test('줄 — 같은 업체의 발주 · 품목만, 한 발주에 같은 품목은 한 줄, 수량은 양수', () => {
    expect(f).toContain(
      'FOREIGN KEY (order_id, company_id) REFERENCES public.stock_orders(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain('CONSTRAINT stock_order_lines_item_key UNIQUE (order_id, item_id)');
    expect(f).toContain('CHECK ((qty > 0) AND ((received_qty IS NULL) OR (received_qty >= 0)))');
  });

  test('함수 넷 — search_path 비움 · 정의자 권한 아님 · 서버만 부른다', () => {
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(4);
    expect(f).not.toContain('SECURITY DEFINER');
    for (const fn of FUNCS) {
      expect(f).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });

  test('발주 넣기 — 업체마다 잠그고 번호를 매긴다 · 1 ~ 30줄 · 쓰는 품목만 · 입고 예정을 늘린다', () => {
    expect(f).toContain(
      "pg_advisory_xact_lock(pg_catalog.hashtextextended('stock_orders:' || p_company::text, 0))"
    );
    expect(f).toContain('jsonb_array_length(p_lines) NOT BETWEEN 1 AND 30');
    expect(f).toContain(
      'SET expected_qty = COALESCE(expected_qty, 0) + v_qty, expected_on = LEAST(COALESCE(expected_on, p_expected_on), p_expected_on)'
    );
    expect(f).toContain('WHERE id = v_item AND company_id = p_company AND active;');
  });

  test('입고 · 취소 — 줄을 잠그고, 끝난 발주는 거절. 입고는 stock_move 로 넣고 덜 온 만큼 입고 예정에서 뺀다', () => {
    expect(f.match(/WHERE id = p_order AND company_id = p_company FOR UPDATE/g)).toHaveLength(2);
    expect(f.match(/IF v_order\.state <> 'ordered' THEN/g)).toHaveLength(2);
    expect(f).toContain(
      "PERFORM public.stock_move(p_company, v_line.item_id, 'in', v_got, 'PO-' || lpad(v_order.seq::text, 4, '0'), NULL, p_actor);"
    );
    expect(f).toContain(
      'PERFORM public.stock_expected_take(p_company, v_line.item_id, v_line.qty - v_got);'
    );
    expect(f).toContain(
      'PERFORM public.stock_expected_take(p_company, v_line.item_id, v_line.qty);'
    );
    expect(f).toContain("SET state = 'received', closed_at = now(), closed_by = p_actor");
    expect(f).toContain("SET state = 'cancelled', closed_at = now(), closed_by = p_actor");
  });
});
