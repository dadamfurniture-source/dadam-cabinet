/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0021_build_period.sql 정적 시험 (DB 없이).
 *
 *   업체 「상담까지 걸리는 날」(0~14일)을 「고객 확정 ~ 시공 완료 기간」(1~14일, 최소 제작 기간)으로 바꾸고,
 *   상담에 「시공 완료 희망 날짜」 칸을 더한다.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0021 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0021_build_period.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ');

describe('0021 — 고객 확정 ~ 시공 완료 기간', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('권한을 바꾸지 않는다 (표 단위 그대로)', () => {
    expect(S).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(S).not.toMatch(/\bPOLICY\b/i);
  });

  test('기간 1~14 제약 — 지우고 다시 만든다', () => {
    expect(f).toContain('DROP CONSTRAINT IF EXISTS company_service_settings_lead_days_check;');
    expect(f).toContain('CHECK (lead_days IS NULL OR (lead_days >= 1 AND lead_days <= 14))');
  });

  test('상담 「시공 완료 희망 날짜」 칸', () => {
    expect(f).toContain(
      'ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS wanted_done_date date;'
    );
  });
});
