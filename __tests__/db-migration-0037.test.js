/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0037_work_check_photos.sql 정적 시험 (DB 없이) — 작업자 필수 확인 사진 비공개 버킷 하나.
 */
const fs = require('fs');
const path = require('path');

const f = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0037_work_check_photos.sql'), 'utf8')
  .split('\r\n').join('\n').split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .trim();

describe('0037 — 작업자 필수 확인 사진 버킷', () => {
  test('비공개 버킷 하나 — 5MB · JPEG · PNG, 다시 돌려도 같다', () => {
    expect(f).toContain("VALUES ('work-check-photos', 'work-check-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])");
    expect(f).toContain('ON CONFLICT (id) DO UPDATE SET');
  });
  test('그 밖은 건드리지 않는다 — 표 · 정책 · 함수 · 트랜잭션 없음', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|DROP|GRANT|REVOKE|DELETE|UPDATE public)\b/i);
    expect(f.match(/INSERT INTO [a-z_.]+/g)).toEqual(['INSERT INTO storage.buckets']);
  });
});
