/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0044_consult_photo_learn.sql 정적 시험 (DB 없이).
 *   2026-11-06 사장님 결정 (작업 분배 ⑥ 완료 사진 학습 — 고객이 동의한 수주의 사진만): consultations.photo_learn_agreed_at 하나.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0044_consult_photo_learn.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();

describe('0044 — 시공 사진 학습 활용 동의', () => {
  test('바꾸는 것은 칸 하나 — 정책 · 트랜잭션 · 행 바꾸기 · 지우기 없음', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|CREATE POLICY|DROP POLICY|CREATE TABLE|DROP|INSERT INTO|UPDATE public|DELETE FROM)\b/i);
    expect(f.match(/ADD COLUMN IF NOT EXISTS \w+ [a-z ]+;/g)).toEqual(['ADD COLUMN IF NOT EXISTS photo_learn_agreed_at timestamp with time zone;']);
  });
  test('프로브 — 칸 모양', () => {
    const probe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0044-consult-photo-learn.json'), 'utf8'));
    expect(probe.checks.map((c) => c.expect.service_role)).toEqual(['timestamp with time zone/YES']);
  });
});
