/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0082_customer_invites_as_handler.sql 정적 시험 (DB 없이).
 *
 *   2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 (「1번으로 처리」 · 「진행」):
 *   고객 초대 링크 customer_invites(서버만 · 토큰 해시 · 한 번 · 같은 업체만), design_schedules 의 고객 변경 요청 칸 셋,
 *   as_requests 의 처리하는 업체 칸 둘(영업 사원 업체 수주의 A/S 를 만든 팩토리가 받는다 ①) · 그 팩토리 읽기 정책,
 *   앱 알림 종류 둘(as_factory · install_change).
 *   값은 database/probes/0082-customer-invites-as-handler.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0082_customer_invites_as_handler.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
/** 0077 의 알림 종류 목록 — 0082 는 그것에 둘만 더한다 */
const kindsOf = (sql) => {
  const m = sql
    .replace(/\s+/g, ' ')
    .match(/notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/);
  return m ? m[1].match(/'([a-z_]+)'::text/g).map((x) => x.slice(1, -7)) : null;
};

describe('0082 — 고객 초대 링크 · 고객의 설치 날 변경 요청 · A/S 를 만든 팩토리가 받는다', () => {
  test('트랜잭션 문 · 표나 칸 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.customer_invites',
    ]);
  });

  test('초대 — 토큰은 해시만 · 하나뿐, 만료는 만든 때보다 뒤, 한 번만 쓰고 쓴 것은 거둘 수 없다, 같은 업체 고객 · 프로젝트만', () => {
    expect(f).toContain('CONSTRAINT customer_invites_token_hash_key UNIQUE (token_hash)');
    expect(f).toContain('CHECK (length(token_hash) BETWEEN 32 AND 128)');
    expect(f).not.toMatch(/\btoken text\b/);
    expect(f).toContain('CHECK (expires_at > created_at)');
    expect(f).toContain('CHECK ((used_by IS NULL) OR (used_at IS NOT NULL))');
    expect(f).toContain('CHECK ((used_at IS NULL) OR (revoked_at IS NULL))');
    expect(f).toContain(
      'FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id) ON DELETE CASCADE'
    );
    expect(f).toContain(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE CASCADE'
    );
    for (const col of ['created_by', 'used_by'])
      expect(f).toContain(`FOREIGN KEY (${col}) REFERENCES auth.users(id) ON DELETE SET NULL`);
  });

  test('초대 — 서버만(SELECT · INSERT · UPDATE, 지우기 없음), 구성원 · 익명은 권한 없음', () => {
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.customer_invites FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_invites TO service_role;'
    );
    expect(f).toContain('ALTER TABLE public.customer_invites ENABLE ROW LEVEL SECURITY;');
    expect(top).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(top).not.toMatch(/CREATE POLICY \w+ ON public\.customer_invites/);
  });

  test('설치 날 변경 요청 — 비워 둘 수 있는 칸 셋, 사람 · 글만 있고 때가 없으면 거절, 200자까지. 일정 표의 정책 · 권한 · 트리거는 그대로', () => {
    expect(f).toMatch(
      /ALTER TABLE public\.design_schedules ADD COLUMN IF NOT EXISTS customer_change_requested_at timestamp with time zone, ADD COLUMN IF NOT EXISTS customer_change_by uuid, ADD COLUMN IF NOT EXISTS customer_change_note text;/
    );
    expect(f).toContain(
      'FOREIGN KEY (customer_change_by) REFERENCES auth.users(id) ON DELETE SET NULL'
    );
    expect(f).toContain(
      'CHECK ( ((customer_change_by IS NULL) AND (customer_change_note IS NULL)) OR (customer_change_requested_at IS NOT NULL))'
    );
    expect(f).toContain('CHECK (COALESCE(length(customer_change_note), 0) <= 200)');
    expect(top).not.toMatch(/(GRANT|REVOKE) [^;]* ON TABLE public\.design_schedules/);
    expect(top).not.toMatch(/CREATE TRIGGER \w+ [^;]* ON public\.design_schedules/);
  });

  test('A/S — 처리하는 업체 칸 둘(팩토리 쪽 프로젝트는 그 팩토리 것만 · 수주 업체와 다름), 지킴이가 바꾸지 못하게, 그 팩토리 구성원 읽기', () => {
    expect(f).toMatch(
      /ALTER TABLE public\.as_requests ADD COLUMN IF NOT EXISTS handler_company_id uuid, ADD COLUMN IF NOT EXISTS handler_project_id uuid;/
    );
    expect(f).toContain(
      'FOREIGN KEY (handler_project_id, handler_company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'CHECK ( ((handler_project_id IS NULL) OR (handler_company_id IS NOT NULL)) AND ((handler_company_id IS NULL) OR (handler_company_id <> company_id)))'
    );
    // 0045 지킴이 그대로 + 두 칸
    expect(f).toContain(
      '(NEW.id, NEW.company_id, NEW.order_id, NEW.body, NEW.photos, NEW.route, NEW.created_at, NEW.handler_company_id, NEW.handler_project_id) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.order_id, OLD.body, OLD.photos, OLD.route, OLD.created_at, OLD.handler_company_id, OLD.handler_project_id)'
    );
    const old = read('database', 'migrations', '0045_as_requests.sql').replace(/\s+/g, ' ');
    const body = (s) => s.match(/IF NEW\.state IS DISTINCT FROM OLD\.state THEN.*?RETURN NEW;/)[0];
    expect(body(f)).toBe(body(old));
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.as_requests_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'CREATE POLICY as_requests_handler_read ON public.as_requests FOR SELECT TO authenticated USING (handler_company_id IN (SELECT public.my_company_ids()));'
    );
    // 권한은 그대로 — 0045 의 GRANT 를 다시 쓰지 않는다
    expect(top).not.toMatch(/(GRANT|REVOKE) [^;]* ON TABLE public\.as_requests/);
  });

  test('알림 종류 — 0077 목록 그대로에 as_factory · install_change 둘만 더한다', () => {
    const before = kindsOf(read('database', 'migrations', '0077_business_cert_trial.sql'));
    const after = kindsOf(S);
    expect(before).not.toBeNull();
    expect(after).toEqual([...before, 'as_factory', 'install_change']);
    // 0077 뒤 다른 파일이 종류 목록을 바꾸지 않았다 (바꿨으면 이 목록이 그것을 지운다)
    const dir = path.join(__dirname, '..', 'database', 'migrations');
    const later = fs
      .readdirSync(dir)
      .filter((n) => /^\d{4}_/.test(n) && Number(n.slice(0, 4)) > 77 && Number(n.slice(0, 4)) < 82)
      .filter((n) =>
        /notification_outbox_kind_check/.test(fs.readFileSync(path.join(dir, n), 'utf8'))
      );
    expect(later).toEqual([]);
  });

  test('프로브 — 칸은 한 문장, 고치기의 기대값은 rows:n · deny · err, 거절 칸은 다른 제약에 먼저 걸리지 않는다', () => {
    const probe = JSON.parse(read('database', 'probes', '0082-customer-invites-as-handler.json'));
    expect(probe.checks).toHaveLength(23);
    expect(probe.checks[0].expect).toEqual({
      anon: 'deny',
      x_owner: 'deny',
      y_owner: 'deny',
      service_role: '2',
    });
    for (const c of probe.checks) expect(c.sql.includes(';')).toBe(false);
    for (const c of probe.checks) {
      const verb = c.sql.trim().split(' ')[0].toLowerCase();
      for (const v of Object.values(c.expect)) {
        if (verb === 'update' || verb === 'delete') expect(v).toMatch(/^(rows:\d+|deny|err:\w+)$/);
        if (verb === 'insert') expect(v).toMatch(/^(ok|deny|err:\w+)$/);
      }
    }
    // 초대 넣기 칸의 토큰은 「같은 토큰」 칸 하나만 준비 단계의 것(a)을 쓴다
    const tokens = probe.checks
      .filter((c) => c.sql.startsWith('insert into public.customer_invites'))
      .map((c) => (c.sql.match(/repeat\('(\w)', 64\)/) || [])[1] || 'raw');
    expect(tokens.filter((t) => t === 'a')).toHaveLength(1);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).not.toContain('b');
  });
});
