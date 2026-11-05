/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0040_designs_source_pair.sql 정적 시험 (DB 없이).
 *
 *   0035 designs_source_check 구멍 — 하나만 채우면 비운 쪽 정규식이 NULL 이라 CHECK 가 통과했다.
 *   값은 database/probes/0040-designs-source-pair.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0040_designs_source_pair.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();

describe('0040 — 설계 출처 칸 둘은 같이', () => {
  test('바꾸는 것은 designs_source_check 하나 — 행 · 트랜잭션 · 칸 · 표 · 정책 · 함수 없음', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE public|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|CREATE TABLE|DROP TABLE|ADD COLUMN|DROP COLUMN|CREATE (UNIQUE )?INDEX|DROP INDEX)\b/i);
    expect(f.match(/ALTER TABLE public\.\w+/g)).toEqual(['ALTER TABLE public.designs', 'ALTER TABLE public.designs']);
    expect(f).toContain('ALTER TABLE public.designs DROP CONSTRAINT IF EXISTS designs_source_check;');
  });

  test('둘 다 비움 또는 둘 다 채움(IS NOT NULL) + 0035 모양 그대로', () => {
    expect(f).toContain(
      "CHECK ( (source IS NULL AND source_ref IS NULL) OR (source IS NOT NULL AND source_ref IS NOT NULL AND source ~ '^[a-z0-9-]{1,32}$' AND source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$') );",
    );
  });

  test('프로브 — 하나만 채우면 거절 둘 · 둘 다 비움 · 둘 다 채움 · 모양 틀림', () => {
    const probe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0040-designs-source-pair.json'), 'utf8'));
    expect(probe.checks.map((c) => c.expect.service_role)).toEqual(['err:23514', 'err:23514', 'ok', 'ok', 'err:23514']);
  });
});
