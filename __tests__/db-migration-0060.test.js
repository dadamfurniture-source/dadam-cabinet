/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0060_work_shifts.sql 정적 시험 (DB 없이).
 *
 *   마이페이지 6단계 (2026-11-12 사장님 결정 ④) — 근무 일정은 쉬는 날만 적는다.
 *   work_shifts 한 표. 서버만 드나든다(정책 없음).
 *   값은 database/probes/0060-work-shifts.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0060_work_shifts.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();

describe('0060 — 근무 일정 (쉬는 날)', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.work_shifts',
    ]);
  });

  test('사람은 구성원 또는 작업자 하나만 · 종류 넷 · 메모 100자', () => {
    expect(f).toContain('CHECK ((member_user_id IS NULL) <> (worker_id IS NULL))');
    expect(f).toContain(
      "CHECK (kind = ANY (ARRAY['off'::text, 'leave'::text, 'half'::text, 'out'::text]))"
    );
    expect(f).toContain('CHECK (COALESCE(length(note), 0) <= 100)');
    expect(f).toContain('FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(f).toContain('FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE');
  });

  test('한 사람 하루에 한 줄 — 구성원 · 작업자 따로 고유', () => {
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_member_day ON public.work_shifts USING btree (company_id, member_user_id, work_date) WHERE (member_user_id IS NOT NULL);'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_worker_day ON public.work_shifts USING btree (company_id, worker_id, work_date) WHERE (worker_id IS NOT NULL);'
    );
  });

  test('서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음. 서버는 지울 수 있다(쉬는 날 지우기 = 다시 근무)', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(f).toContain('ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain('REVOKE ALL ON TABLE public.work_shifts FROM PUBLIC, anon, authenticated;');
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.work_shifts TO service_role;'
    );
  });

  test('출퇴근 시간 · 고객 정보 칸이 없다', () => {
    expect(f).not.toMatch(
      /\b(clock|check_in|check_out|customer|phone|address)\w*\s+(text|uuid|timestamp|time)/i
    );
  });
});
