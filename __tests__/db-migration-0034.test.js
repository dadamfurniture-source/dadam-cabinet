/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0034_ledger_summary.sql 정적 시험 (DB 없이).
 *
 *   회계 한눈에 — ledger_book 을 DB 안에서 달 · 계정 · 지출 상대로 묶는다. 서버만.
 *   값은 database/probes/0034-ledger-summary.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0034_ledger_summary.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = S.replace(/\$function\$[\s\S]*?\$function\$/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const body = (/\$function\$(.*?)\$function\$/.exec(f) || [])[1] || '';

describe('0034 — 회계 한눈에 묶음', () => {
  test('함수 하나만 — 표 · 행 · 다른 함수는 건드리지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(CREATE TABLE|ALTER TABLE|DROP|TRUNCATE|CREATE POLICY|INSERT|UPDATE|DELETE)\b/i
    );
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      'CREATE OR REPLACE FUNCTION public.ledger_summary',
    ]);
    expect(f).toContain(
      'FUNCTION public.ledger_summary(p_company uuid, p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE'
    );
    expect(f).not.toMatch(/SECURITY DEFINER/i);
  });

  test('ledger_book 그대로(취소 줄 뺌)에서 묶고, 기간은 400일까지', () => {
    expect(body).toContain('FROM public.ledger_book(p_company, p_from, p_to, false) x');
    expect(body).toContain(
      'IF p_company IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION'
    );
    expect(body).toContain('c_evidence_min constant bigint := 30000;');
    expect(body).toContain('c_top constant integer := 5;');
    expect(body).toContain("b.evidence_type IN ('simple_receipt', 'statement', 'none')");
    expect(body).toContain(
      "count(*) FILTER (WHERE b.source = 'cost' AND b.vat_amount IS NULL) AS vat_unknown"
    );
  });

  test('지출 상대 — 지출 · 자산 사기만(고객 이름 없음), 다듬은 상호로 묶어 달마다 상위', () => {
    expect(body).toContain(
      "WHERE b.direction IN ('expense', 'asset_buy') AND public.ledger_name_key(b.counterparty_name) IS NOT NULL GROUP BY b.month, public.ledger_name_key(b.counterparty_name)"
    );
    expect(body).toContain('WHERE q.rk <= c_top');
  });

  test('권한 — 서버만', () => {
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.ledger_summary(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT EXECUTE ON FUNCTION public.ledger_summary(uuid, date, date) TO service_role;'
    );
    expect(top).not.toMatch(/GRANT [^;]*\bTO (anon|authenticated|PUBLIC)\b/i);
  });
});
