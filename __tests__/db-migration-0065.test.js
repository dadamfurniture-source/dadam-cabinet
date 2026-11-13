/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0065_work_kinds_project_jobs.sql 정적 시험 (DB 없이).
 *
 *   「작업자 한 길」 둘째 묶음 (2026-11-13 사장님 결정) — 작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결을
 *   프로젝트 한 화면에서. 작업자 종류에 철거, 작업 종류 여섯, 작업의 프로젝트 칸, 「이 일로 바로」 초대.
 *   값은 database/probes/0065-work-kinds-project-jobs.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0065_work_kinds_project_jobs.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const SIX =
  "ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text]";

describe('0065 — 작업 종류 넓히기 · 프로젝트의 작업', () => {
  test('트랜잭션 문 · 새 표 · 표 · 칸 지우기 · 행 고치기가 없다', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(
      /\b(CREATE TABLE|DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i
    );
    expect(f).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/\b(GRANT|REVOKE)\b/);
  });

  test('작업자 종류 — 작업자 · 초대 · 연결 셋 모두 여섯 종류 (철거 더함)', () => {
    for (const [table, name, col] of [
      ['workers', 'workers_kinds_chk', 'kinds'],
      ['worker_invites', 'worker_invites_kinds_chk', 'kinds_preset'],
      ['worker_companies', 'worker_companies_kinds_check', 'kinds'],
    ]) {
      expect(f).toContain(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${name};`);
      expect(f).toContain(`ADD CONSTRAINT ${name} CHECK (${col} <@ ${SIX});`);
    }
  });

  test('작업 종류 — 작업자 종류와 같은 여섯', () => {
    expect(f).toContain(
      'ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_kind_chk;'
    );
    expect(f).toContain(`ADD CONSTRAINT work_jobs_kind_chk CHECK (kind = ANY (${SIX}));`);
  });

  test('작업의 프로젝트 칸 — 같은 업체의 프로젝트만, 프로젝트 하나 · 종류 하나에 살아 있는 작업 하나 (일정 작업은 세지 않는다)', () => {
    expect(f).toContain('ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS project_id uuid;');
    expect(f).toContain(
      'ADD CONSTRAINT work_jobs_project_id_fkey FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id);'
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_jobs_project_kind_live ON public.work_jobs USING btree (project_id, kind) WHERE ((project_id IS NOT NULL) AND (schedule_id IS NULL) AND (status <> 'cancelled'::text));"
    );
  });

  test('「이 일로 바로」 초대 — 초대의 작업 칸, 작업이 지워지면 비운다', () => {
    expect(f).toContain('ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS job_id uuid;');
    expect(f).toContain(
      'ADD CONSTRAINT worker_invites_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE SET NULL;'
    );
  });

  test('고객 정보 칸이 없다 · 일정 종류 · 알림 종류는 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(customer|phone|address)\w*\s+(text|uuid)/i);
    expect(f).not.toContain('design_schedules');
    expect(f).not.toContain('notification_outbox');
  });

  test('확인표 — 이 번호의 파일을 가리키고 종류 · 겹침 · 남의 프로젝트 · 초대의 작업 칸을 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0065-work-kinds-project-jobs.json'));
    expect(probe.title).toContain('0065_work_kinds_project_jobs.sql');
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '철거',
      '모르는 작업 종류',
      '살아 있는 작업 하나',
      '일정에서 생긴 작업',
      '남의 업체',
      '초대의 작업 칸',
    ])
      expect(names).toContain(word);
    expect(probe.checks.length).toBeGreaterThanOrEqual(18);
    // 확인표는 함수 호출과 읽기를 한 문장에 섞지 않는다 — 이 확인표에는 우리 함수 호출이 아예 없다
    for (const c of probe.checks) expect(c.sql).not.toMatch(/public\.\w+\(/);
  });
});
