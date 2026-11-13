/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0066_work_delivery_company_notes.sql 정적 시험 (DB 없이).
 *
 *   「작업자 한 길」 2차로 미뤄 둔 것 (2026-11-14 사장님 결정) — 납품 줄에도 작업자를 배정한다(종류 「납품」을 새로),
 *   팩토리 대표 · 실장이 연결된 작업자에 대해 메모를 남긴다(worker_company_notes — 서버만 · 쌓기만).
 *   값은 database/probes/0066-work-delivery-company-notes.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0066_work_delivery_company_notes.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const SEVEN =
  "ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text, 'demolition'::text, 'delivery'::text]";
const kindsIn = (sql) => [...sql.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);

describe('0066 — 납품 작업자 · 팩토리의 작업자 메모', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다, 새 표는 하나', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.worker_company_notes',
    ]);
  });

  test('종류 — 작업자 · 초대 · 연결 · 작업 넷 모두 같은 일곱 (0065 의 여섯 + 납품)', () => {
    const prev = read('database', 'migrations', '0065_work_kinds_project_jobs.sql');
    const six = kindsIn(/workers_kinds_chk CHECK \(([^;]+)\);/.exec(prev)[1]);
    expect(six).toHaveLength(6);
    expect(kindsIn(SEVEN)).toEqual([...six, 'delivery']);
    for (const [table, name, col] of [
      ['workers', 'workers_kinds_chk', 'kinds'],
      ['worker_invites', 'worker_invites_kinds_chk', 'kinds_preset'],
      ['worker_companies', 'worker_companies_kinds_check', 'kinds'],
    ]) {
      expect(f).toContain(`ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${name};`);
      expect(f).toContain(`ADD CONSTRAINT ${name} CHECK (${col} <@ ${SEVEN});`);
    }
    expect(f).toContain(
      'ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_kind_chk;'
    );
    expect(f).toContain(`ADD CONSTRAINT work_jobs_kind_chk CHECK (kind = ANY (${SEVEN}));`);
  });

  test('서버의 종류 목록(workflow-api work/validate.js) · 알림 글의 종류 이름이 이 일곱과 같다', () => {
    const seven = kindsIn(SEVEN);
    const validate = read('workers', 'workflow-api', 'src', 'work', 'validate.js');
    const kinds = [
      .../WORK_KINDS = Object\.freeze\(\[([^\]]*)\]\)/.exec(validate)[1].matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    expect(kinds).toEqual(seven);
    const labels = /WORK_KIND_LABELS = Object\.freeze\(\{([^}]*)\}\)/.exec(
      read('workers', 'workflow-api', 'src', 'push', 'messages.js')
    )[1];
    expect([...labels.matchAll(/([a-z_]+):/g)].map((x) => x[1]).sort()).toEqual([...seven].sort());
    expect(validate).toContain('export const WORKER_KINDS = WORK_KINDS;');
  });

  test('메모 표 — 연결 줄에 붙는다 · 같은 팩토리의 연결에만 · 1 ~ 1000자 · 연결이 지워지면 같이 지워진다', () => {
    expect(f).toContain('link_id uuid NOT NULL');
    expect(f).toContain('company_id uuid NOT NULL');
    expect(f).toContain('note text NOT NULL');
    expect(f).toContain(
      'CONSTRAINT worker_company_notes_len_chk CHECK ((length(note) >= 1) AND (length(note) <= 1000))'
    );
    expect(f).toContain(
      'CONSTRAINT worker_company_notes_author_fkey FOREIGN KEY (author) REFERENCES auth.users(id) ON DELETE SET NULL'
    );
    expect(f).toContain(
      'ADD CONSTRAINT worker_company_notes_link_fkey FOREIGN KEY (link_id, company_id) REFERENCES public.worker_companies(id, company_id) ON DELETE CASCADE;'
    );
    // 복합 외래 키가 기댈 유니크 — 다시 돌릴 때는 외래 키를 먼저 떼고 다시 건다
    const drop = f.indexOf(
      'ALTER TABLE IF EXISTS public.worker_company_notes DROP CONSTRAINT IF EXISTS worker_company_notes_link_fkey;'
    );
    const uniqueDrop = f.indexOf(
      'ALTER TABLE public.worker_companies DROP CONSTRAINT IF EXISTS worker_companies_id_company_id_key;'
    );
    const unique = f.indexOf(
      'ALTER TABLE public.worker_companies ADD CONSTRAINT worker_companies_id_company_id_key UNIQUE (id, company_id);'
    );
    const table = f.indexOf('CREATE TABLE IF NOT EXISTS public.worker_company_notes');
    const fk = f.indexOf('ADD CONSTRAINT worker_company_notes_link_fkey');
    expect(drop).toBeGreaterThan(-1);
    expect(uniqueDrop).toBeGreaterThan(drop);
    expect(unique).toBeGreaterThan(uniqueDrop);
    expect(table).toBeGreaterThan(unique);
    expect(fk).toBeGreaterThan(table);
  });

  test('서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음. 서버도 고치거나 지우지 못한다 (쌓기만)', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(f).toContain('ALTER TABLE public.worker_company_notes ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.worker_company_notes FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT ON TABLE public.worker_company_notes TO service_role;'
    );
    expect(f).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.worker_company_notes FROM service_role;'
    );
  });

  test('고객 정보 칸이 없다 · 일정 종류 · 알림 종류 · PC 관리자 메모는 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(customer|phone|address)\w*\s+(text|uuid)/i);
    expect(f).not.toContain('design_schedules');
    expect(f).not.toContain('notification_outbox');
    expect(f).not.toMatch(/public\.worker_notes\b/);
    expect(f).toContain('고객 이름 · 전화 · 주소를 넣지 않는다');
  });

  test('확인표 — 이 번호의 파일을 가리키고 납품 종류 · 메모의 서버만 · 남의 팩토리 · 쌓기만을 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0066-work-delivery-company-notes.json'));
    expect(probe.title).toContain('0066_work_delivery_company_notes.sql');
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '납품',
      '모르는 작업 종류',
      '서버만',
      '남의 팩토리',
      '1001자',
      '고치지 못한다',
      '지우지 못한다',
      'RLS',
    ])
      expect(names).toContain(word);
    expect(probe.checks.length).toBeGreaterThanOrEqual(24);
    // 칸은 하나씩 되돌린다 — 한 문장에서 바꾸고 읽지 않는다 (우리 함수 호출도 없다)
    for (const c of probe.checks) {
      expect(c.sql).not.toMatch(/public\.\w+\(/);
      expect(c.sql).not.toMatch(/\breturning\b/i);
    }
    // 거절 칸은 보려는 제약 하나만 걸리게 — 「남의 팩토리 연결」은 외래 키(23503): 글자 수 · 빈 글 제약에 먼저 걸리지 않는 메모로
    const other = probe.checks.find((c) => c.name.startsWith('남의 팩토리 연결에는'));
    expect(other.expect.service_role).toBe('err:23503');
    expect(other.sql).toContain('{{link_a}}, {{company_y}}');
    expect(other.sql).toMatch(/'probe [^']+'\)$/);
    // 글자 수 칸은 제 팩토리의 연결로 넣는다 (외래 키에 걸리지 않게)
    for (const c of probe.checks.filter(
      (x) => x.expect.service_role === 'err:23514' && x.sql.includes('worker_company_notes')
    ))
      expect(c.sql).toContain('{{link_a}}, {{company_x}}');
    // 메모를 미리 넣어 두고(준비 단계) 칸에서는 읽는다
    expect(probe.setup.join('\n')).toContain('INSERT INTO public.worker_company_notes');
  });
});
