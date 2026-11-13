/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0064_worker_companies.sql 정적 시험 (DB 없이).
 *
 *   「작업자 한 길」 (2026-11-13 사장님 결정) — 작업자 계정은 하나, 팩토리마다 연결 줄(worker_companies).
 *   초대에 팩토리 칸, 작업에 일정 칸, 지금 작업자는 다담 공장 연결로 옮긴다.
 *   값은 database/probes/0064-worker-companies.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0064_worker_companies.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const kindsIn = (sql) => (sql.match(/'([a-z_]+)'::text/g) || []).map((k) => k.slice(1, -7));

describe('0064 — 작업자 ↔ 팩토리 연결', () => {
  test('트랜잭션 문 · 표 · 칸 지우기가 없다, 새 표는 하나', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.worker_companies',
    ]);
  });

  test('연결 — 한 작업자 × 한 팩토리 한 줄, 상태 다섯 · 종류 다섯 · 길 셋 · 사유 200자', () => {
    expect(f).toContain('CONSTRAINT worker_companies_pair_key UNIQUE (company_id, worker_id)');
    expect(f).toContain(
      "CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text, 'ended'::text]))"
    );
    expect(f).toContain(
      "CHECK (kinds <@ ARRAY['install'::text, 'as'::text, 'assembly'::text, 'cutting'::text, 'edge'::text])"
    );
    expect(f).toContain(
      "CHECK (via = ANY (ARRAY['invite'::text, 'public'::text, 'migrated'::text]))"
    );
    expect(f).toContain('CHECK (COALESCE(length(reason), 0) <= 200)');
    expect(f).toContain('FOREIGN KEY (company_id) REFERENCES public.companies(id)');
    expect(f).toContain('FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE');
    expect(f).toContain(
      'FOREIGN KEY (invite_id) REFERENCES public.worker_invites(id) ON DELETE SET NULL'
    );
    expect(f).toContain('FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL');
  });

  test('서버만 — RLS 켬 · 정책 없음 · 브라우저 권한 없음. 서버도 지우지 못한다 (끝은 status ended)', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(f).toContain('ALTER TABLE public.worker_companies ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.worker_companies FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_companies TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.worker_companies FROM service_role;'
    );
  });

  test('초대 — 팩토리 칸(비면 옛 본사 초대) · 거둔 때', () => {
    expect(f).toContain(
      'ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS company_id uuid;'
    );
    expect(f).toContain(
      'ALTER TABLE public.worker_invites ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone;'
    );
    expect(f).toContain(
      'ADD CONSTRAINT worker_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);'
    );
    // 팩토리 칸은 비울 수 있다 — 옛 초대가 남아 있다
    expect(f).not.toContain('ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL');
  });

  test('작업 ↔ 일정 — 일정이 지워지면 비운다 · 일정 하나에 살아 있는 작업 하나', () => {
    expect(f).toContain('ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS schedule_id uuid;');
    expect(f).toContain(
      'FOREIGN KEY (schedule_id) REFERENCES public.design_schedules(id) ON DELETE SET NULL;'
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_jobs_schedule_live ON public.work_jobs USING btree (schedule_id) WHERE ((schedule_id IS NOT NULL) AND (status <> 'cancelled'::text));"
    );
  });

  test('옮기기 — 지금 작업자를 다담 공장 연결로, 다시 돌려도 같은 결과 · 다담 공장이 없으면 아무것도 안 넣는다', () => {
    const ins = f.match(/INSERT INTO public\.worker_companies [^;]+;/g);
    expect(ins).toHaveLength(1);
    expect(ins[0]).toContain(
      "SELECT public.hq_company_id(), w.id, w.status, w.kinds, 'migrated', w.invited_via, w.approved_by, w.approved_at, w.reject_reason, w.created_at"
    );
    expect(ins[0]).toContain('WHERE public.hq_company_id() IS NOT NULL');
    expect(ins[0]).toContain('ON CONFLICT (company_id, worker_id) DO NOTHING;');
    // 행을 넣는 문장은 이것 하나뿐
    expect(f.match(/\bINSERT INTO\b/g)).toHaveLength(1);
  });

  test('앱 알림 종류 — 0053 의 스무 개 그대로 + 팩토리용 셋 (업체 없이 넣는 종류는 안 바꾼다)', () => {
    const prev = read('database', 'migrations', '0053_production_cancelled_notice.sql');
    const before = kindsIn(prev.match(/notification_outbox_kind_check CHECK \(([^;]+)\);/)[1]);
    const after = kindsIn(f.match(/notification_outbox_kind_check CHECK \(([^;]+)\);/)[1]);
    expect(before).toHaveLength(20);
    expect(after).toEqual([...before, 'work_link_request', 'work_reply', 'work_report']);
    expect(f).not.toContain('notification_outbox_company_check');
  });

  test('서버가 넣는 종류(workflow-api push/messages.js NOTIFICATION_KINDS)는 이 목록과 같다(차례만 다름) — 팩토리용 셋은 WORK_MANAGER_KINDS', () => {
    const msg = read('workers', 'workflow-api', 'src', 'push', 'messages.js');
    const listOf = (name) =>
      [
        ...new RegExp(`${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`)
          .exec(msg)[1]
          .matchAll(/'([a-z_]+)'/g),
      ].map((x) => x[1]);
    const after = kindsIn(f.match(/notification_outbox_kind_check CHECK \(([^;]+)\);/)[1]);
    expect(listOf('NOTIFICATION_KINDS').sort()).toEqual([...after].sort());
    expect(listOf('NOTIFICATION_KINDS').slice(-3)).toEqual(after.slice(-3));
    expect(listOf('WORK_MANAGER_KINDS')).toEqual([
      'work_link_request',
      'work_reply',
      'work_report',
    ]);
    // 팩토리용 셋은 업체 없이 넣는 종류(작업자에게 가는 것)가 아니다
    expect(
      listOf('WORK_NOTIFICATION_KINDS').filter((k) => listOf('WORK_MANAGER_KINDS').includes(k))
    ).toEqual([]);
  });

  test('이력 — 하는 사람 종류에 member (작업자 이력 · 작업 이력 둘 다)', () => {
    for (const name of ['work_job_events_actor_chk', 'worker_events_actor_chk']) {
      expect(f).toContain(`DROP CONSTRAINT IF EXISTS ${name};`);
      expect(f).toContain(
        `ADD CONSTRAINT ${name} CHECK (actor_kind = ANY (ARRAY['worker'::text, 'admin'::text, 'system'::text, 'member'::text]));`
      );
    }
  });

  test('고객 정보 칸이 없다 · 계정 상태(workers.status)는 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(customer|phone|address)\w*\s+(text|uuid)/i);
    expect(f).not.toMatch(/ALTER TABLE public\.workers\b/);
  });

  test('확인표 — 이 번호의 파일을 가리키고 서버만 · 겹침 · 옮기기 · 알림 · 이력을 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0064-worker-companies.json'));
    expect(probe.title).toContain('0064_worker_companies.sql');
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '서버만',
      '한 줄',
      '다른 팩토리',
      '살아 있는 작업 하나',
      '옮기기',
      '23개',
      'member',
    ])
      expect(names).toContain(word);
    expect(probe.checks.length).toBeGreaterThanOrEqual(25);
    // 실행기는 칸마다 되돌린다 (SAVEPOINT → ROLLBACK TO) — 앞 칸에서 지운 것은 다음 칸에 남지 않는다.
    // 일정 지우기는 준비 단계에서 하고, 칸은 그 뒤 모습을 읽기만 한다 (2026-11-13 실DB 미리 보기에서 한 칸이 어긋났다)
    expect(probe.setup).toContain('DELETE FROM public.design_schedules WHERE id = {{sched_z}}');
    expect(probe.checks.some((c) => /^\s*delete\s+from\s+public\.design_schedules/i.test(c.sql))).toBe(false);
    const cleared = probe.checks.find((c) => c.name.startsWith('일정이 지워지면 작업의 일정 칸이 빈다'));
    expect(cleared.sql).toContain('{{job_z}}');
    expect(cleared.expect.service_role).toBe('true');
    expect(probe.title).toContain('칸은 하나씩 되돌린다');
  });
});
