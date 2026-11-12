/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0018_partner_profiles.sql · 0019_consult_assignments.sql 정적 시험 (DB 없이).
 *
 *   0018 업체 상담 설정(업체 대표 · 실장 · 관리자 읽기) · 본사 평가표(관리자만) · 평가 이력(추가만).
 *   0019 상담 칸(도어 마감 · 철거 · 가격대 · 사본 · 동의) · 배정 기록(순위 · 점수는 서버만, 지우기 없음).
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0018 · 0019 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const code = (sql) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const S18 = code(read('0018_partner_profiles.sql'));
const S19 = code(read('0019_consult_assignments.sql'));
const flat = (s) => s.replace(/\s+/g, ' ');
const outside = (s) => s.replace(/\$function\$[\s\S]*?\$function\$/g, '');

describe.each([
  ['0018', S18],
  ['0019', S19],
])('%s — 형식', (_n, S) => {
  test('트랜잭션 문 · 지우기 · 행 고치기가 없다', () => {
    const o = outside(S);
    expect(o).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(o).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?public|DROP\s+COLUMN)\b/i);
    expect(o).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('화면(authenticated)에게 쓰기 권한을 주지 않는다', () => {
    expect(S).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*TO authenticated/i);
  });
});

describe('0018 — 업체 자료', () => {
  const f = flat(S18);

  test('세 표 모두 RLS 와 화면 쪽 권한 회수', () => {
    for (const t of ['company_service_settings', 'company_evaluations', 'company_evaluation_history']) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
  });

  test('평가표 · 이력은 관리자만 읽는다 (업체 구성원 정책 없음)', () => {
    for (const t of ['company_evaluations', 'company_evaluation_history']) {
      const policies = [...f.matchAll(new RegExp(`CREATE POLICY \\w+ ON public\\.${t} [^;]*;`, 'g'))].map((m) => m[0]);
      expect(policies).toHaveLength(1);
      expect(policies[0]).toContain('USING ((SELECT public.is_admin()));');
    }
  });

  test('상담 설정은 그 업체 대표 · 실장 + 관리자', () => {
    expect(f).toContain("USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));");
  });

  test('평가 이력은 트리거로만 쌓이고 서버도 고치거나 지우지 못한다', () => {
    expect(f).toContain('CREATE TRIGGER trg_company_evaluation_keep_history AFTER INSERT OR UPDATE ON public.company_evaluations FOR EACH ROW EXECUTE FUNCTION public.company_evaluation_keep_history();');
    expect(f).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.company_evaluation_history FROM service_role;');
    expect(f).toContain('REVOKE ALL ON FUNCTION public.company_evaluation_keep_history() FROM PUBLIC, anon, authenticated, service_role;');
  });

  test('등급 · 가격대 값', () => {
    expect(f).toContain("grade = ANY (ARRAY['S'::text, 'A'::text, 'B'::text, 'C'::text])");
    expect(f).toContain("price_tier = ANY (ARRAY['basic'::text, 'mid'::text, 'high'::text])");
  });
});

describe('0019 — 상담 배정', () => {
  const f = flat(S19);

  test('상담 상태에 assigned · returned 를 더한다', () => {
    expect(f).toContain("status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'assigned'::text, 'returned'::text])");
  });

  test('화면에서 넣는 상담은 본사 · 사본 아님', () => {
    expect(f).toContain('AND company_id = (SELECT public.platform_company_id()) AND customer_id IS NULL AND project_id IS NULL AND origin_consultation_id IS NULL);');
  });

  test('본사 상담 하나에 기다리는 배정 하나', () => {
    expect(f).toContain("CREATE UNIQUE INDEX IF NOT EXISTS consult_assignments_one_open ON public.consult_assignments USING btree (consultation_id) WHERE (state = 'assigned'::text);");
  });

  test('순위 · 점수 칸은 화면에 주지 않는다', () => {
    const m = f.match(/GRANT SELECT \(([^)]*)\) ON TABLE public\.consult_assignments TO authenticated;/);
    expect(m).not.toBeNull();
    const cols = m[1].split(',').map((s) => s.trim());
    for (const c of ['rank', 'total', 'score']) expect(cols).not.toContain(c);
  });

  test('배정 기록은 아무도 지우지 못한다', () => {
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.consult_assignments FROM service_role;');
  });
});
