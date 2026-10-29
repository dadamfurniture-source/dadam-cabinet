/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0015_partner_books.sql 정적 시험 (DB 없이).
 *
 *   업체 칸 3곳(기존 행 = 본사) · 금액 칸은 서버만 · 관리자 읽기는 본사 것만.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0015 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0015_partner_books.sql');
const BASE = read('0000_baseline.sql');
/** 줄 주석을 뺀 본문 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = CODE.replace(/\s+/g, ' ');

/** 기준 SQL 의 표 칸 이름들 (CREATE TABLE 순서) */
function baseColumns(table) {
  const start = BASE.indexOf(`CREATE TABLE public.${table} (`);
  const body = BASE.slice(start, BASE.indexOf('\n);', start));
  return body
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('CONSTRAINT'))
    .map((l) => l.split(' ')[0]);
}

/** GRANT SELECT (칸들) ON TABLE public.<표> TO authenticated 의 칸들 */
function grantedColumns(table) {
  const m = flat.match(new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE public\\.${table} TO authenticated;`));
  expect(m).not.toBeNull();
  return m[1].split(',').map((s) => s.trim());
}

describe('0015 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('표 · 행을 지우거나 고치지 않는다', () => {
    expect(CODE).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|DROP\s+COLUMN)\b/i);
    expect(CODE).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });
});

describe('0015 — 업체 칸', () => {
  test.each(['counterparties', 'work_reports', 'production_worklogs'])('%s.company_id — 기존 행은 본사, 빈 값 없음', (t) => {
    expect(flat).toContain(
      `ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS company_id uuid DEFAULT public.hq_company_id() NOT NULL;`
    );
    expect(flat).toContain(`FOREIGN KEY (company_id) REFERENCES public.companies(id);`);
  });

  test('공급처 이름 겹침은 업체 안에서만 (색인 이름 그대로)', () => {
    expect(BASE).toContain('CREATE UNIQUE INDEX uq_counterparties_name ON public.counterparties USING btree (kind, lower(name));');
    expect(flat).toContain('DROP INDEX IF EXISTS public.uq_counterparties_name;');
    expect(flat).toContain(
      'CREATE UNIQUE INDEX uq_counterparties_name ON public.counterparties USING btree (company_id, kind, lower(name));'
    );
  });
});

describe('0015 — 금액은 서버로만', () => {
  test.each([
    ['orders', ['contract_amount', 'received_amount'], ['company_id', 'project_id']],
    ['design_snapshots', ['quote_payload'], []],
  ])('%s: 금액 칸만 빼고 나머지 칸은 그대로 읽게', (table, hidden, later) => {
    expect(flat).toContain(`REVOKE SELECT ON TABLE public.${table} FROM authenticated;`);
    const granted = grantedColumns(table);
    for (const c of hidden) expect(granted).not.toContain(c);
    const expected = baseColumns(table).filter((c) => !hidden.includes(c)).concat(later);
    expect([...granted].sort()).toEqual([...expected].sort());
  });

  test('수주 원가: 설계 만든 사람 옛 읽기 규칙을 지운다', () => {
    expect(BASE).toContain('CREATE POLICY "Users read own order costs" ON public.order_costs');
    expect(flat).toContain('DROP POLICY IF EXISTS "Users read own order costs" ON public.order_costs;');
  });

  test('authenticated 에게 표 전체 읽기를 다시 주지 않는다', () => {
    expect(CODE).not.toMatch(/GRANT\s+(SELECT|ALL)\s+ON\s+TABLE\s+public\.(orders|design_snapshots)\b/i);
  });
});

describe('0015 — 관리자 읽기는 본사 것만', () => {
  test.each([
    ['order_payments', '"Admin read order payments"'],
    ['rework_logs', '"Admin read rework logs"'],
    ['install_feedback', '"Admin read install feedback"'],
  ])('%s: 본사 수주의 것만', (table, old) => {
    expect(flat).toContain(`DROP POLICY IF EXISTS ${old} ON public.${table};`);
    expect(flat).toContain(
      `USING ((SELECT public.is_admin()) AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = ${table}.order_id AND o.company_id = (SELECT public.hq_company_id())));`
    );
  });

  test.each(['customers', 'projects'])('%s: 관리자 읽기 · 쓰기는 본사 행만', (table) => {
    for (const op of ['read', 'insert', 'update', 'delete']) {
      expect(flat).toMatch(new RegExp(`CREATE POLICY ${table}_admin_${op} ON public\\.${table} [^;]*public\\.hq_company_id\\(\\)`));
    }
  });

  test('관리자 정책은 모두 본사 조건이 붙는다', () => {
    const policies = [...flat.matchAll(/CREATE POLICY (\w+) ON public\.\w+ [^;]*;/g)].map((m) => m[0]);
    for (const p of policies.filter((s) => /is_admin\(\)/.test(s))) {
      expect(p).toContain('public.hq_company_id()');
    }
  });
});
