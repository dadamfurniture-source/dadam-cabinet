/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0035_planner_work_checks.sql 정적 시험 (DB 없이).
 *
 *   플래너 설계 받기 (designs.source · source_ref) · 작업자 필수 확인 기록 (work_checks — 쌓기만, 서버만).
 *   값은 database/probes/0035-planner-work-checks.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0035_planner_work_checks.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();

describe('0035 — 플래너 설계 받기 · 작업자 필수 확인 기록', () => {
  test('바꾸는 것은 designs 칸 둘 · work_checks 표 하나 — 행 · 트랜잭션 · 정책 · 함수 없음', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE public|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|DROP TABLE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(['CREATE TABLE IF NOT EXISTS public.work_checks']);
    expect(f.match(/ALTER TABLE public\.designs ADD COLUMN IF NOT EXISTS \w+ text/g)).toEqual([
      'ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS source text',
      'ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS source_ref text',
    ]);
  });

  test('설계 출처 — 둘 다 비우거나 둘 다 모양대로, 회사 · 출처 · id 가 같으면 한 설계', () => {
    expect(f).toContain("(source IS NULL AND source_ref IS NULL) OR (source IS NOT NULL AND source_ref IS NOT NULL AND source ~ '^[a-z0-9-]{1,32}$' AND source_ref ~ '^[A-Za-z0-9_.:-]{1,128}$')");
    expect(f).toContain('CREATE UNIQUE INDEX IF NOT EXISTS designs_source_ref_key ON public.designs USING btree (company_id, source, source_ref) WHERE (source IS NOT NULL);');
  });

  test('필수 확인 기록 — 역할 넷 · 범위 · 항목 키 · 목록 판 모양, 메모 칸은 memo (note 아님)', () => {
    expect(f).toContain("CHECK (role = ANY (ARRAY['cut'::text, 'edge'::text, 'assembly'::text, 'install'::text]))");
    expect(f).toContain("CHECK (scope_key ~ '^([a-z]+:[0-9]+(:[0-9]+)?)?$' AND length(scope_key) <= 64)");
    expect(f).toContain("CHECK (item_key ~ '^[a-z0-9-]{1,64}$')");
    expect(f).toContain('memo text,');
    expect(f).not.toMatch(/\bnote\b text/);
    expect(f).toContain('FOREIGN KEY (document_id) REFERENCES public.design_documents(id) ON DELETE CASCADE');
    expect(f).toContain('FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL');
    expect(f).toContain('CREATE INDEX IF NOT EXISTS idx_work_checks_cell ON public.work_checks USING btree (document_id, role, scope_key, item_key, created_at DESC);');
  });

  test('권한 — 서버만, 서버도 넣기 · 읽기만 (쌓기만)', () => {
    expect(f).toContain('ALTER TABLE public.work_checks ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain('REVOKE ALL ON TABLE public.work_checks FROM PUBLIC, anon, authenticated;');
    expect(f).toContain('GRANT SELECT, INSERT ON TABLE public.work_checks TO service_role;');
    expect(f).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.work_checks FROM service_role;');
    expect(f).not.toMatch(/GRANT [^;]*\bTO (anon|authenticated|PUBLIC)\b/i);
  });
});
