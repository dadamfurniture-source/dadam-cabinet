/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0061_stock_unit_price.sql 정적 시험 (DB 없이).
 *
 *   재고 품목 단가 한 칸 — 재고 금액(남은 수량 × 단가)을 내려고 더한다. 정책 · 권한은 0059 그대로.
 *   값은 database/probes/0061-stock-unit-price.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const f = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0061_stock_unit_price.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .trim();
const statements = f
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

describe('0061 — 재고 품목 단가', () => {
  test('문장 — 칸 하나 · 제약 다시 걸기 · 설명뿐 (다시 돌려도 된다)', () => {
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe(
      'ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS unit_price bigint'
    );
    expect(statements[1]).toBe(
      'ALTER TABLE public.stock_items DROP CONSTRAINT IF EXISTS stock_items_unit_price_check'
    );
    expect(statements[2]).toBe(
      'ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_unit_price_check CHECK ((unit_price IS NULL) OR ((unit_price >= 0) AND (unit_price <= 100000000)))'
    );
    expect(statements[3]).toMatch(/^COMMENT ON COLUMN public\.stock_items\.unit_price IS '/);
  });

  test('정책 · 권한 · 표 만들기 · 지우기 · 행 바꾸기가 없다', () => {
    expect(f).not.toMatch(
      /\b(BEGIN|COMMIT|ROLLBACK|CREATE TABLE|CREATE POLICY|GRANT|REVOKE|DROP TABLE|DROP COLUMN|TRUNCATE)\b/i
    );
    expect(f).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
  });
});
