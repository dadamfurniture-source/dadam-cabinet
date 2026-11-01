/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0026_design_sharing.sql 정적 시험 (DB 없이).
 *
 *   업체 설계 학습 공유 동의 — company_design_sharing (업체당 한 줄, 기본 꺼짐, 서버만),
 *   company_design_sharing_log (켜고 끈 기록, 트리거만 넣음, 서버는 읽기만).
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0026 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (name) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8')
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const S = read('0026_design_sharing.sql');
const f = S.replace(/\s+/g, ' ');

describe('0026 — 업체 설계 학습 공유 동의', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다 (기록 트리거 안의 넣기만)', () => {
    // 함수 본문(plpgsql BEGIN … END)은 트랜잭션 문이 아니라 뺀다
    const outside = S.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(outside).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    const noRevoke = S.replace(/^\s*REVOKE[^;]*;/gim, '');
    expect(noRevoke).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^(INSERT|UPDATE)\b/im);
    expect(S.match(/\bINSERT INTO\b/g)).toHaveLength(1);
  });

  test('지금 상태 — 업체당 한 줄, 기본 꺼짐, 켠 시각은 켜졌을 때만', () => {
    expect(f).toContain('CONSTRAINT company_design_sharing_pkey PRIMARY KEY (company_id)');
    expect(f).toContain('shared boolean DEFAULT false NOT NULL');
    expect(f).toContain(
      'CONSTRAINT company_design_sharing_since_check CHECK (shared = (shared_since IS NOT NULL))'
    );
    expect(f).toContain('FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL');
  });

  test('켜고 끈 기록 — 상태가 바뀔 때만 트리거가 넣는다', () => {
    expect(f).toContain(
      "IF TG_OP = 'INSERT' OR NEW.shared IS DISTINCT FROM OLD.shared THEN INSERT INTO public.company_design_sharing_log (company_id, shared, changed_by, changed_at) VALUES (NEW.company_id, NEW.shared, NEW.changed_by, NEW.changed_at);"
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_company_design_sharing_log AFTER INSERT OR UPDATE ON public.company_design_sharing FOR EACH ROW EXECUTE FUNCTION public.company_design_sharing_log_change();'
    );
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.company_design_sharing_log_change() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('권한 — 상태는 서버만 읽기 · 넣기 · 고치기, 기록은 서버 읽기만, 정책 없음', () => {
    for (const t of ['company_design_sharing', 'company_design_sharing_log'])
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.company_design_sharing FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.company_design_sharing TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.company_design_sharing FROM service_role;'
    );
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.company_design_sharing_log FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain('GRANT SELECT ON TABLE public.company_design_sharing_log TO service_role;');
    expect(S).not.toMatch(/CREATE POLICY/i);
  });
});
