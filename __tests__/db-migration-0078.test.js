/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0078_project_hold_events_seen.sql 정적 시험 (DB 없이).
 *
 *   2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차 (「차례대로」):
 *   projects 의 보류 상태(on_hold) · 다시 볼 날 · 메모 · 바꾼 때 · 사람, 프로젝트 일지 project_events(추가만 · 서버만),
 *   받은 일 읽음 inbox_seen(사람 · 업체마다 한 줄 · 본 때는 앞으로만 · 서버만).
 *   「계약금을 받으면 보류 · 그만둠은 작동하지 않는다」는 서버가 지킨다 — 이 파일에는 그 규칙의 지킴이를 두지 않는다
 *   (규칙을 고칠 때 DB 를 다시 손대지 않도록).
 *   값은 database/probes/0078-project-hold-events-seen.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0078_project_hold_events_seen.sql'),
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

describe('0078 — 프로젝트 보류 · 일지 · 받은 일 읽음', () => {
  test('트랜잭션 문 · 표나 칸 지우기 · 행 바꾸기가 없다, 새 표는 둘', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.project_events',
      'CREATE TABLE IF NOT EXISTS public.inbox_seen',
    ]);
  });

  test('프로젝트 상태 — 옛 값 넷에 on_hold 하나만 더한다, 다시 볼 날은 보류일 때만, 메모 200자', () => {
    expect(f).toContain(
      "CHECK (status = ANY (ARRAY['active'::text, 'on_hold'::text, 'closed'::text, 'cancelled'::text, 'handed_over'::text]))"
    );
    expect(f).toContain("CHECK ((hold_until IS NULL) OR (status = 'on_hold'::text))");
    expect(f).toContain('CHECK ((status_note IS NULL) OR (length(status_note) <= 200))');
    expect(f).toContain('FOREIGN KEY (status_by) REFERENCES auth.users(id) ON DELETE SET NULL');
    // 새 칸은 모두 비워 둘 수 있다 — 이미 있는 줄이 걸리지 않는다
    expect(f).toMatch(
      /ADD COLUMN IF NOT EXISTS hold_until date, ADD COLUMN IF NOT EXISTS status_note text, ADD COLUMN IF NOT EXISTS status_at timestamp with time zone, ADD COLUMN IF NOT EXISTS status_by uuid;/
    );
    // 계약금 규칙은 서버가 지킨다 — projects 에 새 트리거를 걸지 않는다
    expect(top).not.toMatch(/CREATE TRIGGER \w+ [^;]* ON public\.projects/);
  });

  test('일지 — 행동한 쪽 다섯 · 같은 업체 프로젝트(복합 FK · 프로젝트와 같이 지워짐) · payload 2000바이트 · 초안 id 는 글자', () => {
    expect(f).toContain(
      "CHECK (actor_kind = ANY (ARRAY['member'::text, 'customer'::text, 'worker'::text, 'admin'::text, 'system'::text]))"
    );
    expect(f).toContain(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE'
    );
    expect(f).toContain(
      "(jsonb_typeof(payload) = 'object'::text) AND (octet_length(payload::text) <= 2000)"
    );
    expect(f).toContain('subject_id text,');
    expect(f).toContain('FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(f).toContain('ON public.project_events USING btree (project_id, created_at)');
    expect(f).toContain('ON public.project_events USING btree (company_id, created_at DESC)');
  });

  test('일지 — 추가만: 서버는 SELECT · INSERT 뿐, 구성원 · 익명은 권한 없음(정책도 없음), 고치기 지킴이', () => {
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.project_events FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain('GRANT SELECT, INSERT ON TABLE public.project_events TO service_role;');
    expect(f).toContain('ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain('BEFORE UPDATE ON public.project_events');
    expect(top).not.toMatch(/CREATE POLICY/);
    expect(top).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
  });

  test('읽음 — 사람 · 업체마다 한 줄, 서버만(SELECT · INSERT · UPDATE), 본 때는 앞으로만', () => {
    expect(f).toContain('CONSTRAINT inbox_seen_pkey PRIMARY KEY (user_id, company_id)');
    expect(f).toContain('FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.inbox_seen FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.inbox_seen TO service_role;');
    expect(f).toContain('ALTER TABLE public.inbox_seen ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain('IF NEW.seen_at < OLD.seen_at THEN NEW.seen_at := OLD.seen_at; END IF;');
    expect(f).toContain('BEFORE UPDATE ON public.inbox_seen');
  });

  test('함수는 search_path 를 비우고 아무에게도 실행 권한을 주지 않는다', () => {
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(2);
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.project_events_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.inbox_seen_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('프로브 — 보류 · 일지 · 읽음을 칸마다 본다 (바꾸기는 준비 단계에, 칸은 읽기나 한 문장의 성공 · 거절만)', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0078-project-hold-events-seen.json'),
        'utf8'
      )
    );
    expect(probe.checks.map((c) => c.name.split(' — ')[0].split(' (')[0])).toEqual([
      '보류',
      '다시 볼 날은 보류일 때만',
      '모르는 상태는 못 넣는다',
      '상태 메모는 200자까지',
      '일지 읽기',
      '일지 쓰기',
      '구성원은 일지를 쓰지 못한다',
      '행동한 쪽은 다섯 가지만',
      'payload 는 2000바이트까지',
      '같은 업체 프로젝트에만',
      '일지 고치기는 서버도 못 한다',
      '일지 지우기도 못 한다',
      '읽음 읽기',
      '본 때는 뒤로 가지 않는다',
      '본 때는 앞으로는 간다',
      '한 사람 · 한 업체에 한 줄',
    ]);
    expect(probe.checks[0].expect).toEqual({
      x_owner: '1',
      y_owner: '0',
      anon: 'deny',
      service_role: '1',
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
  });
});
