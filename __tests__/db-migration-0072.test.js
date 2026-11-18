/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0072_work_orderless_render_kinds.sql 정적 시험 (DB 없이).
 *
 *   수주 없는 작업의 필수 확인(work_checks.order_id 를 비울 수 있고 job_id 로 작업을 적는다) ·
 *   지시서 그림 종류 둘(design_renders.kind 에 layout · inside).
 *   값은 database/probes/0072-work-orderless-render-kinds.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (sql) =>
  sql
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/^\s*--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
const RAW = read('database', 'migrations', '0072_work_orderless_render_kinds.sql');
const f = strip(RAW);
const wordsIn = (sql) => [...sql.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
const KINDS =
  "ARRAY['front'::text, 'iso'::text, 'plan'::text, 'module'::text, 'layout'::text, 'inside'::text]";

describe('0072 — 수주 없는 작업의 필수 확인 · 지시서 그림 종류 둘', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기 · 새 표가 없다', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(f).not.toMatch(/CREATE TABLE/i);
  });

  test('수주 칸 — 0035 에서는 꼭 있어야 했고, 이제 비울 수 있다 (문서 칸은 그대로)', () => {
    const prev = strip(read('database', 'migrations', '0035_planner_work_checks.sql'));
    expect(prev).toContain('order_id uuid NOT NULL,');
    expect(prev).toContain('document_id uuid NOT NULL,');
    expect(f).toContain('ALTER TABLE public.work_checks ALTER COLUMN order_id DROP NOT NULL;');
    expect(f).not.toMatch(/document_id[^;]*DROP NOT NULL/);
    // 수주 칸의 외래 키 · 수주로 읽는 색인은 그대로 둔다
    expect(f).not.toContain('work_checks_order_id_fkey');
    expect(f).not.toContain('idx_work_checks_order');
  });

  test('작업 칸 — work_jobs 를 가리키고 작업이 지워지면 비운다 (체크 줄은 남는다)', () => {
    expect(f).toContain('ALTER TABLE public.work_checks ADD COLUMN IF NOT EXISTS job_id uuid;');
    expect(f).toContain(
      'ALTER TABLE public.work_checks DROP CONSTRAINT IF EXISTS work_checks_job_id_fkey;'
    );
    expect(f).toContain(
      'ADD CONSTRAINT work_checks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.work_jobs(id) ON DELETE SET NULL;'
    );
    expect(f).toContain(
      'CREATE INDEX IF NOT EXISTS idx_work_checks_job ON public.work_checks USING btree (job_id) WHERE (job_id IS NOT NULL);'
    );
    expect(f).toContain('COMMENT ON COLUMN public.work_checks.order_id IS');
    expect(f).toContain('COMMENT ON COLUMN public.work_checks.job_id IS');
    expect(f).not.toMatch(/job_id uuid NOT NULL/);
    expect(f).not.toMatch(/ON DELETE CASCADE/);
  });

  test('그림 종류 — 기준선의 넷 + 배치 평면 · 속 구조 정면도', () => {
    const base = /design_renders_kind_check CHECK \(\(kind = ANY \(([^;]+?)\)\)\);/.exec(
      read('database', 'migrations', '0000_baseline.sql')
    )[1];
    const four = wordsIn(base);
    expect(four).toEqual(['front', 'iso', 'plan', 'module']);
    expect(wordsIn(KINDS)).toEqual([...four, 'layout', 'inside']);
    expect(f).toContain(
      'ALTER TABLE public.design_renders DROP CONSTRAINT IF EXISTS design_renders_kind_check;'
    );
    expect(f).toContain(`ADD CONSTRAINT design_renders_kind_check CHECK (kind = ANY (${KINDS}));`);
    // 칸은 더하지 않는다 — 모듈 상자 자리는 있는 칸 camera 에 적는다
    expect(f).not.toMatch(/ALTER TABLE public\.design_renders ADD COLUMN/);
    expect(RAW).toContain('camera(jsonb)');
  });

  test('권한 · 정책 · 역할 · 문서 종류는 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(GRANT|REVOKE)\b/);
    expect(f).not.toMatch(/\b(CREATE|DROP|ALTER) POLICY\b/);
    expect(f).not.toContain('ROW LEVEL SECURITY');
    expect(f).not.toContain('work_checks_role_check');
    expect(f).not.toContain('design_documents');
    // 바꾸는 표는 둘뿐
    expect(
      [...new Set([...f.matchAll(/ALTER TABLE public\.(\w+)/g)].map((x) => x[1]))].sort()
    ).toEqual(['design_renders', 'work_checks']);
  });

  test('확인표 — 이 번호의 파일을 가리키고 수주 없는 체크 · 작업 칸 · 서버만 · 그림 종류를 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0072-work-orderless-render-kinds.json'));
    expect(probe.title).toContain('0072_work_orderless_render_kinds.sql');
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '수주 없는 체크',
      '전에 있던 모양은 그대로',
      '없는 작업 id',
      '문서 없는 체크',
      '모르는 역할',
      '여전히 서버만',
      '고치지 못한다',
      '지우지 못한다',
      '작업을 지워도',
      '비울 수 있다',
      '비울 수 없다',
      '배치 평면',
      '속 구조 정면도',
      '모르는 그림 종류',
      '여섯 가지',
      'RLS',
    ])
      expect(names).toContain(word);
    expect(probe.checks.length).toBeGreaterThanOrEqual(20);
    // 칸은 하나씩 되돌린다 — 한 문장에서 바꾸고 읽지 않는다 (우리 함수 호출도 없다)
    for (const c of probe.checks) {
      expect(c.sql).not.toMatch(/public\.\w+\(/);
      expect(c.sql).not.toMatch(/\breturning\b/i);
      expect(c.sql.split(';').filter((s) => s.trim()).length).toBe(1);
    }
    // 고치기 · 지우기 칸은 모든 역할이 권한에서 막힌다 — 줄 수(rows:n)를 기대하지 않는다
    for (const c of probe.checks.filter((x) => /^(update|delete) /.test(x.sql)))
      expect(c.expect).toEqual({ '*': 'deny' });
    // 거절 칸은 보려는 제약 하나만 걸리게 — 다른 칸(범위 · 항목 · 판)은 받는 모양으로
    const noJob = probe.checks.find((c) => c.name.startsWith('없는 작업 id'));
    expect(noJob.expect.service_role).toBe('err:23503');
    expect(noJob.sql).toContain("'cut', 'sheet:2', 'probe-item', 'v3', true");
    const noDoc = probe.checks.find((c) => c.name.startsWith('문서 없는 체크'));
    expect(noDoc.expect.service_role).toBe('err:23502');
    const badRole = probe.checks.find((c) => c.name.startsWith('모르는 역할'));
    expect(badRole.expect.service_role).toBe('err:23514');
    expect(badRole.sql).toContain("'as', '', 'probe-item', 'v3', true");
    const badKind = probe.checks.find((c) => c.name.startsWith('모르는 그림 종류'));
    expect(badKind.expect.service_role).toBe('err:23514');
    // 작업을 지우는 일은 준비 단계에서 하고 칸에서는 읽는다
    const setup = probe.setup.join('\n');
    expect(setup).toContain('DELETE FROM public.work_jobs WHERE id = {{job_gone}}');
    // 그 작업의 체크 줄을 먼저 넣고, 그 뒤에 작업을 지운다
    expect(setup).toMatch(/'probe-gone'[\s\S]*DELETE FROM public\.work_jobs/);
    // 한 프로젝트에 같은 종류의 살아 있는 작업을 둘 넣지 않는다 (0065 유니크)
    const jobKinds = [...setup.matchAll(/\{\{job_\w+\}\}, '([a-z]+)'/g)].map((x) => x[1]);
    expect(new Set(jobKinds).size).toBe(jobKinds.length);
    // 수주 없는 길은 프로젝트에 이어진 설계다
    expect(setup).toContain('{{company_x}}, {{project_x}})');
  });
});
