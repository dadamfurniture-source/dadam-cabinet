/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0020_service_lead_days.sql 정적 시험 (DB 없이).
 *
 *   업체 상담 설정의 「다음 가능 날짜」(날짜)를 「상담까지 걸리는 날」(0~14일)로 바꾼다.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0020 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0020_service_lead_days.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ');

describe('0020 — 상담까지 걸리는 날', () => {
  test('트랜잭션 문 · 표 지우기 · 행 고치기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('권한을 바꾸지 않는다 (0018 표 단위 그대로)', () => {
    expect(S).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(S).not.toMatch(/\bPOLICY\b/i);
  });

  test('걸리는 날 칸 · 0~14 제약 · 옛 날짜 칸 지움', () => {
    expect(f).toContain(
      'ALTER TABLE public.company_service_settings ADD COLUMN IF NOT EXISTS lead_days integer;'
    );
    expect(f).toContain('CHECK (lead_days IS NULL OR (lead_days >= 0 AND lead_days <= 14))');
    expect(f).toContain(
      'ALTER TABLE public.company_service_settings DROP COLUMN IF EXISTS next_available_date;'
    );
  });

  test('다시 돌려도 된다 — 제약은 지우고 다시 만든다', () => {
    expect(f).toContain('DROP CONSTRAINT IF EXISTS company_service_settings_lead_days_check;');
  });
});
