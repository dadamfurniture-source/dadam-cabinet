/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0080_inflow.sql 정적 시험 (DB 없이).
 *
 *   2026-11-23 마케팅 「사이트 새는 곳 막기」 묶음 2 (대표님 11-21: Cloudflare 웹 분석 + 자체 기록):
 *   consultations · profiles 에 유입 칸 넷(source · medium · campaign · referrer), profiles 에 inflow_at.
 *   넣기 · 고치기 길은 그대로 — 상담은 표 단위 GRANT(0000) + 넣기 정책(0017), 가입은 본인 고치기 정책(0000).
 *   값은 database/probes/0080-inflow.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0080_inflow.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();

const COLS = ['inflow_source', 'inflow_medium', 'inflow_campaign', 'inflow_referrer'];
const LEN =
  'CHECK ((COALESCE(length(inflow_source), 0) <= 100) AND (COALESCE(length(inflow_medium), 0) <= 100) AND (COALESCE(length(inflow_campaign), 0) <= 100) AND (COALESCE(length(inflow_referrer), 0) <= 200))';

describe('0080 — 유입 경로', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기 · 새 표 · 함수 · 트리거가 없다', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE TABLE|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER)\b/i
    );
    expect(f).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
  });

  test('상담 — 유입 칸 넷(비워 둘 수 있다) · 길이 제한', () => {
    expect(f).toContain(
      `ALTER TABLE public.consultations ${COLS.map((c) => `ADD COLUMN IF NOT EXISTS ${c} text`).join(', ')};`
    );
    expect(f).toContain(`ADD CONSTRAINT consultations_inflow_len_check ${LEN};`);
  });

  test('가입 — 유입 칸 넷 + 채운 때 · 길이 제한', () => {
    expect(f).toContain(
      `ALTER TABLE public.profiles ${COLS.map((c) => `ADD COLUMN IF NOT EXISTS ${c} text`).join(', ')}, ADD COLUMN IF NOT EXISTS inflow_at timestamp with time zone;`
    );
    expect(f).toContain(`ADD CONSTRAINT profiles_inflow_len_check ${LEN};`);
  });

  test('권한 · 정책은 그대로 — GRANT · REVOKE · 정책을 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(GRANT|REVOKE)\b/);
    expect(f).not.toMatch(/\b(CREATE|DROP|ALTER) POLICY\b/);
    expect(f).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  test('프로브 — 상담 넣기(익명 · 회원) · 길이 · 가입 유입은 본인 줄만', () => {
    const probe = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0080-inflow.json'), 'utf8')
    );
    expect(probe.checks.map((c) => c.name.split(' — ')[0].split(' (')[0])).toEqual([
      '상담 넣기',
      '상담 유입',
      '상담 유입',
      '가입 유입 읽기',
      '가입 유입 채우기',
      '가입 유입',
    ]);
    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c.expect]));
    expect(byName['상담 넣기 — 유입 칸 넷과 함께 (익명 · 회원 모두 넣는다)']).toEqual({
      anon: 'ok',
      cust: 'ok',
    });
    expect(byName['가입 유입 채우기 — 본인 줄만 고친다']).toEqual({
      anon: 'rows:0',
      cust: 'rows:1',
      other: 'rows:0',
      service_role: 'rows:1',
    });
  });
});
