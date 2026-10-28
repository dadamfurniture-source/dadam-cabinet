/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0012_company_settings.sql 정적 시험 (DB 없이).
 *
 *   새 표 company_settings: 업체당 한 줄, RLS 켬, authenticated 는 읽기만(대표 · 실장, 관리자는 본사만).
 *   옮기기: 본사 active owner 의 production_settings 한 줄만, 본사 설정이 있으면 건드리지 않음.
 *   production_settings 는 지우지도 고치지도 않는다.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0012 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const SQL = fs
  .readFileSync(path.join(DIR, '0012_company_settings.sql'), 'utf8')
  .split('\r\n')
  .join('\n');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = CODE.replace(/\s+/g, ' ');

describe('0012 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('지우거나 production_settings 를 고치지 않는다', () => {
    expect(CODE).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(CODE).not.toMatch(/\b(UPDATE|ALTER\s+TABLE)\s+public\.production_settings\b/i);
  });
});

describe('0012 — company_settings', () => {
  test('업체당 한 줄, 객체만, 업체 · 고친 사람 외래 키', () => {
    expect(flat).toContain('CONSTRAINT company_settings_pkey PRIMARY KEY (company_id)');
    expect(flat).toContain("CHECK (jsonb_typeof(settings) = 'object'::text)");
    expect(flat).toContain('FOREIGN KEY (company_id) REFERENCES public.companies(id)');
    expect(flat).toContain('FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL');
  });

  test('RLS 를 켜고 authenticated 는 읽기만', () => {
    expect(flat).toContain('ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;');
    expect(flat).toContain(
      'REVOKE ALL ON TABLE public.company_settings FROM PUBLIC, anon, authenticated;'
    );
    expect(flat).toContain('GRANT SELECT ON TABLE public.company_settings TO authenticated;');
    expect(CODE).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*TO authenticated/i);
  });

  test('읽기 정책: 대표 · 실장, 관리자는 본사 설정만', () => {
    expect(flat).toContain(
      "USING (company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text])));"
    );
    expect(flat).toContain(
      'USING ((SELECT public.is_admin()) AND company_id = (SELECT public.hq_company_id()));'
    );
    expect((CODE.match(/CREATE POLICY/g) || []).length).toBe(2);
  });
});

describe('0012 — 옮기기', () => {
  const ins = flat.slice(flat.indexOf('INSERT INTO public.company_settings'));

  test('본사 active owner 의 한 줄만, 본사 설정이 있으면 그대로', () => {
    expect(ins).toContain('AND m.company_id = public.hq_company_id()');
    expect(ins).toContain("AND m.role = 'owner'");
    expect(ins).toContain("AND m.status = 'active'");
    expect(ins).toContain('LIMIT 1');
    expect(ins).toContain('ON CONFLICT (company_id) DO NOTHING;');
  });
});
