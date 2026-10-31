/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0022_eval_hq_comm.sql 정적 시험 (DB 없이).
 *
 *   업체 평가표에 「본사 소통」 칸(hq_comm jsonb)을 더한다.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0022 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0022_eval_hq_comm.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ');

describe('0022 — 업체 평가표 본사 소통', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('권한을 바꾸지 않는다 (표 단위 그대로)', () => {
    expect(S).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(S).not.toMatch(/\bPOLICY\b/i);
  });

  test('본사 소통 칸 — jsonb, 기본 {}, 비지 않음', () => {
    expect(f).toContain(
      "ALTER TABLE public.company_evaluations ADD COLUMN IF NOT EXISTS hq_comm jsonb DEFAULT '{}'::jsonb NOT NULL;"
    );
  });

  test('본사 소통은 객체만 — 지우고 다시 만든다', () => {
    expect(f).toContain('DROP CONSTRAINT IF EXISTS company_evaluations_hq_comm_check;');
    expect(f).toContain(
      "ADD CONSTRAINT company_evaluations_hq_comm_check CHECK (jsonb_typeof(hq_comm) = 'object');"
    );
  });
});
