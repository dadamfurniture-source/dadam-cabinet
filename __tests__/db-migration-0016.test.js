/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0016_app_notifications.sql 정적 시험 (DB 없이).
 *
 *   기기 등록 · 보낼 알림은 서버만. 알림 글이 열 곳은 앱 안. 구성원 · 업체 상태가 바뀌면 정리.
 *   본사 Slack 새 상담 잡기 함수는 본사 상담 조건만 더하고 나머지는 0002 그대로.
 *   역할별 동작 · 정리 트리거는 database/probes/0003-company-tables.json 의 0016 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0016_app_notifications.sql');
/** 줄 주석을 뺀 본문 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
/** 함수 본문을 뺀 나머지 */
const OUTSIDE = CODE.replace(/\$function\$[\s\S]*?\$function\$/g, '');
const flat = CODE.replace(/\s+/g, ' ');

/** 한 파일에서 claim_consultation_notices 정의 본문 */
const claimBody = (text) => {
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.claim_consultation_notices');
  return text.slice(start, text.indexOf('$function$;', start));
};

describe('0016 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(OUTSIDE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('기존 표 · 행을 지우지 않는다', () => {
    expect(OUTSIDE).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(OUTSIDE).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });
});

describe('0016 — 서버만', () => {
  test.each(['push_subscriptions', 'notification_outbox'])('%s: RLS 켜고 화면 쪽 권한 없음', (t) => {
    expect(flat).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    expect(flat).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${t} TO service_role;`);
    expect(CODE).not.toMatch(new RegExp(`CREATE POLICY [^;]* ON public\\.${t}\\b`));
    expect(CODE).not.toMatch(new RegExp(`GRANT[^;]*ON TABLE public\\.${t} TO [^;]*(anon|authenticated)`));
  });

  test('잡기 함수는 service_role 만 부른다', () => {
    expect(flat).toContain('REVOKE ALL ON FUNCTION public.claim_notifications(integer) FROM PUBLIC, anon, authenticated, service_role;');
    expect(flat).toContain('GRANT EXECUTE ON FUNCTION public.claim_notifications(integer) TO service_role;');
  });

  test('정리 트리거 함수는 아무도 직접 부르지 못한다', () => {
    for (const fn of ['push_cleanup_member', 'push_cleanup_company']) {
      expect(flat).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated, service_role;`);
    }
  });
});

describe('0016 — 알림 글', () => {
  test('누르면 열 곳은 앱 안(/segan/)만', () => {
    expect(flat).toContain("CHECK (url ~ '^/segan/' AND length(url) <= 300)");
  });

  test('글 길이 상한 (잠금 화면에 짧게)', () => {
    expect(flat).toContain('length(title) BETWEEN 1 AND 60 AND length(body) BETWEEN 1 AND 160');
  });

  test('업체 없는 알림은 신청 진행만', () => {
    expect(flat).toContain("CHECK (company_id IS NOT NULL OR kind = 'partner_application'::text)");
  });

  test('회원 탈퇴 · 업체 삭제면 함께 지워진다', () => {
    for (const t of ['push_subscriptions', 'notification_outbox']) {
      expect(flat).toContain(`CONSTRAINT ${t}_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`);
      expect(flat).toContain(`CONSTRAINT ${t}_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE`);
    }
  });
});

describe('0016 — 본사 Slack 은 본사 상담만', () => {
  test('0002 함수에 본사 조건 두 줄만 더한다', () => {
    const before = claimBody(read('0002_consultations_notified_at.sql')).split('\n');
    const after = claimBody(SQL).split('\n');
    const added = after.filter((l) => !before.includes(l));
    expect(added.map((l) => l.trim())).toEqual([
      'AND s.company_id = public.hq_company_id()',
      'AND f.company_id = public.hq_company_id()',
    ]);
    expect(before.filter((l) => !after.includes(l))).toEqual([]);
  });
});
