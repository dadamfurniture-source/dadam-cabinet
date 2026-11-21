/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0079_project_visits_install_confirm.sql 정적 시험 (DB 없이).
 *
 *   2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 2차 (「차례대로」 · 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」):
 *   프로젝트에 붙는 방문 일정 project_visits(실측 — 설계가 없어도 잡는다, 서버만, 예정은 프로젝트에 하나),
 *   design_schedules 의 고객 확인 표시 칸 둘(설치 날 — 업체가 표시).
 *   실측 → 설계 차례는 서버의 「다음 할 일」 판정(workflow-api src/pipeline.js)이 지킨다 — 이 파일에는 그 규칙의 지킴이를 두지 않는다
 *   (규칙을 고칠 때 DB 를 다시 손대지 않도록).
 *   값은 database/probes/0079-project-visits-install-confirm.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0079_project_visits_install_confirm.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');

describe('0079 — 프로젝트 방문(실측) 일정 · 설치 날 고객 확인', () => {
  test('트랜잭션 문 · 표나 칸 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.project_visits',
    ]);
  });

  test('방문 — 종류는 실측 하나 · 상태 셋 · 글자 수 · 같은 업체 프로젝트(복합 FK · 프로젝트와 같이 지워짐)', () => {
    expect(f).toContain("CHECK (kind = ANY (ARRAY['measure'::text]))");
    expect(f).toContain(
      "CHECK (status = ANY (ARRAY['scheduled'::text, 'done'::text, 'cancelled'::text]))"
    );
    expect(f).toContain(
      'CHECK ((COALESCE(length(assignee_name), 0) <= 50) AND (COALESCE(length(note), 0) <= 200))'
    );
    expect(f).toContain(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE'
    );
    expect(f).toContain('scheduled_at timestamp with time zone NOT NULL,');
    // 사람 칸은 그 사람이 지워지면 비워진다 — 방문은 남는다
    for (const col of ['assignee_id', 'done_by', 'created_by'])
      expect(f).toContain(`FOREIGN KEY (${col}) REFERENCES auth.users(id) ON DELETE SET NULL`);
  });

  test('방문 — 예정은 프로젝트 · 종류마다 하나 (끝난 뒤에는 다시 잡을 수 있다), 달력 · 프로젝트 읽기 색인', () => {
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_project_visits_open ON public.project_visits USING btree (project_id, kind) WHERE (status = 'scheduled'::text);"
    );
    expect(f).toContain('ON public.project_visits USING btree (company_id, scheduled_at)');
    expect(f).toContain('ON public.project_visits USING btree (project_id, created_at)');
  });

  test('방문 — 서버만(SELECT · INSERT · UPDATE, 지우기 없음), 구성원 · 익명은 권한 없음(정책도 없음)', () => {
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.project_visits FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.project_visits TO service_role;'
    );
    expect(f).toContain('ALTER TABLE public.project_visits ENABLE ROW LEVEL SECURITY;');
    expect(top).not.toMatch(/CREATE POLICY/);
    expect(top).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(top).not.toMatch(/GRANT [^;]*DELETE[^;]* ON TABLE public\.project_visits/);
  });

  test('지킴이 — 새 방문은 예정으로만, 끝 · 취소는 예정에서만, 끝났거나 취소한 방문은 그대로, 때는 지킴이가 찍는다', () => {
    expect(f).toContain(
      'CREATE TRIGGER trg_project_visits_guard BEFORE INSERT OR UPDATE ON public.project_visits FOR EACH ROW EXECUTE FUNCTION public.project_visits_guard();'
    );
    expect(f).toContain(
      "IF TG_OP = 'INSERT' THEN IF NEW.status <> 'scheduled' THEN RAISE EXCEPTION"
    );
    expect(f).toContain(
      '(NEW.id, NEW.company_id, NEW.project_id, NEW.kind, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.project_id, OLD.kind, OLD.created_at)'
    );
    expect(f).toContain("IF OLD.status <> 'scheduled' THEN");
    expect(f).toContain(
      "IF NEW.status = 'done' THEN NEW.done_at := now(); NEW.cancelled_at := NULL;"
    );
    expect(f).toContain(
      "ELSIF NEW.status = 'cancelled' THEN NEW.cancelled_at := now(); NEW.done_at := NULL; NEW.done_by := NULL;"
    );
    // 거절은 모두 같은 코드 — 확인표가 err:22023 으로 본다
    expect(f.match(/USING ERRCODE = '22023'/g)).toHaveLength(3);
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(1);
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.project_visits_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('설치 날 고객 확인 — 일정 표에 비워 둘 수 있는 칸 둘, 사람만 있고 때가 없으면 거절. 일정 표의 정책 · 권한 · 트리거는 건드리지 않는다', () => {
    expect(f).toMatch(
      /ALTER TABLE public\.design_schedules ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamp with time zone, ADD COLUMN IF NOT EXISTS customer_confirmed_by uuid;/
    );
    expect(f).toContain(
      'FOREIGN KEY (customer_confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL'
    );
    expect(f).toContain(
      'CHECK ((customer_confirmed_by IS NULL) OR (customer_confirmed_at IS NOT NULL))'
    );
    expect(top).not.toMatch(/(GRANT|REVOKE) [^;]* ON TABLE public\.design_schedules/);
    expect(top).not.toMatch(/CREATE TRIGGER \w+ [^;]* ON public\.design_schedules/);
    // 차례(실측 → 설계)는 서버가 지킨다 — projects · designs 에 새 트리거를 걸지 않는다
    expect(top).not.toMatch(
      /CREATE TRIGGER \w+ [^;]* ON public\.(projects|designs|planner_drafts)/
    );
  });

  test('프로브 — 방문 · 고객 확인을 칸마다 본다 (바꾸기는 준비 단계에, 칸은 읽기나 한 문장의 성공 · 거절만)', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'database',
          'probes',
          '0079-project-visits-install-confirm.json'
        ),
        'utf8'
      )
    );
    expect(probe.checks.map((c) => c.name.split(' — ')[0].split(' (')[0])).toEqual([
      '방문 읽기',
      '끝낸 방문',
      '취소한 방문',
      '방문 잡기',
      '예정인 방문은 프로젝트에 하나',
      '새 방문은 예정으로만',
      '종류는 실측 하나',
      '메모는 200자까지',
      '같은 업체 프로젝트에만',
      '구성원은 방문을 직접 넣지 못한다',
      '실측 끝내기',
      '예정인 방문의 날짜는 바꿀 수 있다',
      '끝난 방문의 날짜는 바꾸지 못한다',
      '취소한 방문은 되살리지 못한다',
      '어느 프로젝트의 방문인지는 바꾸지 못한다',
      '방문 지우기는 서버도 못 한다',
      '설치 날 고객 확인',
      '구성원은 확인 표시를 직접 고치지 못한다',
      '표시한 사람만 있고 때가 없으면 거절',
      '확인 표시 지우기',
    ]);
    expect(probe.checks[0].expect).toEqual({
      x_owner: 'deny',
      y_owner: 'deny',
      anon: 'deny',
      service_role: '2',
    });
    // 한 칸은 한 문장이다 — 바꾸고 읽는 두 문장을 한 칸에 두지 않는다 (칸은 하나씩 되돌려진다)
    for (const c of probe.checks) expect(c.sql.includes(';')).toBe(false);
    // 고치기 · 지우기의 기대값은 rows:n · deny · err 뿐이다 (ok 는 넣기)
    for (const c of probe.checks) {
      const verb = c.sql.trim().split(' ')[0].toLowerCase();
      for (const v of Object.values(c.expect)) {
        if (verb === 'update' || verb === 'delete') expect(v).toMatch(/^(rows:\d+|deny|err:\w+)$/);
        if (verb === 'insert') expect(v).toMatch(/^(ok|deny|err:\w+)$/);
      }
    }
    // 거절 칸이 다른 제약에 먼저 걸리지 않게 — 유니크(예정 하나)에 걸리는 칸은 하나뿐이고, 나머지 넣기는 방문이 없는 프로젝트(project_z)에
    const inserts = probe.checks.filter((c) =>
      c.sql.startsWith('insert into public.project_visits')
    );
    expect(inserts.filter((c) => c.sql.includes('{{project_x}}'))).toHaveLength(1);
    expect(inserts.filter((c) => c.sql.includes('{{project_z}}'))).toHaveLength(inserts.length - 1);
  });
});
