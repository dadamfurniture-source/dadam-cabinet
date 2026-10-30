/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0017_platform_split.sql 정적 시험 (DB 없이).
 *
 *   다담 본사(kind platform) 하나를 새로 두고, 지금의 다담 회사(kind hq)는 이름만 「다담 공장」.
 *   새 상담은 본사로, 관리자 상담 읽기 · 고치기는 본사 상담만, 가입 고객 줄은 본사.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0017 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0017_platform_split.sql');
/** 줄 주석을 뺀 본문 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const OUTSIDE = CODE.replace(/\$function\$[\s\S]*?\$function\$/g, '');
const flat = CODE.replace(/\s+/g, ' ');

/** 한 파일에서 claim_consultation_notices 정의 본문 */
const claimBody = (text) => {
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.claim_consultation_notices');
  return text.slice(start, text.indexOf('$function$;', start));
};

describe('0017 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(OUTSIDE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('표 · 행을 지우지 않는다', () => {
    expect(OUTSIDE).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
  });

  test('행을 고치는 것은 공장 이름과 가입 고객 줄 옮기기 두 곳뿐', () => {
    const updates = OUTSIDE.match(/^\s*UPDATE\s+public\.\w+/gim) || [];
    expect(updates.map((u) => u.trim().replace(/\s+/g, ' '))).toEqual([
      'UPDATE public.companies',
      'UPDATE public.customers',
    ]);
  });
});

describe('0017 — 다담 본사', () => {
  test('kind platform 하나뿐, 등급(plan) 없이', () => {
    expect(flat).toContain("CHECK (kind = ANY (ARRAY['hq'::text, 'partner'::text, 'platform'::text]))");
    expect(flat).toContain("CHECK (kind = ANY (ARRAY['hq'::text, 'platform'::text]) OR plan IS NOT NULL)");
    expect(flat).toContain("CREATE UNIQUE INDEX IF NOT EXISTS companies_one_platform ON public.companies USING btree (kind) WHERE (kind = 'platform'::text);");
    expect(flat).toContain("SELECT 'platform', '다담 본사', 'active' WHERE NOT EXISTS (SELECT 1 FROM public.companies WHERE kind = 'platform');");
  });

  test('지금 회사는 이름만 「다담 공장」 — hq_company_id() 는 그대로', () => {
    expect(flat).toContain("UPDATE public.companies SET name = '다담 공장', updated_at = now() WHERE kind = 'hq' AND name <> '다담 공장';");
    expect(CODE).not.toMatch(/FUNCTION public\.hq_company_id/);
  });

  test('platform_company_id() 는 hq_company_id() 와 같은 권한', () => {
    expect(flat).toContain("SELECT c.id FROM public.companies c WHERE c.kind = 'platform' LIMIT 1;");
    expect(flat).toContain('REVOKE ALL ON FUNCTION public.platform_company_id() FROM PUBLIC, anon, authenticated, service_role;');
    expect(flat).toContain('GRANT EXECUTE ON FUNCTION public.platform_company_id() TO anon, authenticated, service_role;');
  });
});

describe('0017 — 상담은 본사로', () => {
  test('기본값 · 넣기 정책은 본사', () => {
    expect(flat).toContain('ALTER TABLE public.consultations ALTER COLUMN company_id SET DEFAULT public.platform_company_id();');
    expect(flat).toContain('AND company_id = (SELECT public.platform_company_id()) AND customer_id IS NULL AND project_id IS NULL);');
  });

  test('관리자 읽기 · 고치기는 본사 상담만 (옛 「모두」 정책은 지운다)', () => {
    expect(flat).toContain('DROP POLICY IF EXISTS "Admins can view all consultations" ON public.consultations;');
    expect(flat).toContain('DROP POLICY IF EXISTS "Admins can update consultations" ON public.consultations;');
    const admin = [...flat.matchAll(/CREATE POLICY consultations_admin_\w+ ON public\.consultations [^;]*;/g)].map((m) => m[0]);
    expect(admin).toHaveLength(2);
    for (const p of admin) expect(p).toContain('company_id = (SELECT public.platform_company_id())');
  });

  test('새 상담 Slack 잡기는 0016 함수에서 본사 조건만 바뀐다', () => {
    const before = claimBody(read('0016_app_notifications.sql'));
    const after = claimBody(SQL);
    expect(after).toBe(before.split('public.hq_company_id()').join('public.platform_company_id()'));
    expect(after.split('public.platform_company_id()')).toHaveLength(3);
  });
});

describe('0017 — 가입 고객 줄은 본사', () => {
  test('가입 트리거는 본사 줄을 만들고, 옛 공장 트리거 · 함수는 지운다', () => {
    expect(flat).toContain('DROP TRIGGER IF EXISTS on_auth_user_created_hq_customer ON auth.users;');
    expect(flat).toContain('CREATE TRIGGER on_auth_user_created_platform_customer AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.add_platform_customer();');
    expect(flat).toContain('DROP FUNCTION IF EXISTS public.add_hq_customer();');
    expect(flat).toContain("WHERE c.kind = 'platform' ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING;");
  });

  test('옮기는 줄은 이름 · 연락처 · 프로젝트 · 상담이 없는 가입 줄만', () => {
    const m = flat.match(/UPDATE public\.customers cu SET company_id = public\.platform_company_id\(\)[^;]*;/);
    expect(m).not.toBeNull();
    for (const cond of [
      'cu.company_id = public.hq_company_id()',
      'cu.user_id IS NOT NULL AND cu.name IS NULL AND cu.phone IS NULL',
      'NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.customer_id = cu.id)',
      'NOT EXISTS (SELECT 1 FROM public.consultations s WHERE s.customer_id = cu.id)',
    ]) {
      expect(m[0]).toContain(cond);
    }
  });

  test('관리자는 공장 · 본사 고객 줄을 읽는다', () => {
    expect(flat).toContain('USING ((SELECT public.is_admin()) AND company_id IN ((SELECT public.hq_company_id()), (SELECT public.platform_company_id())));');
  });
});
