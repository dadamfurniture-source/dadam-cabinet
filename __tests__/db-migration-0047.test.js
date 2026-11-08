/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0047_tier_manager.sql 정적 시험 (DB 없이).
 *
 *   새 등급 manager — profiles.tier · credit_plans.tier · subscriptions.plan · companies.plan · companies.next_plan 값 목록에 더하고
 *   credit_plans 에 manager 500 줄. 회계장부 full 은 Agent · 시험만 (company_entitled books 조건, read 는 그대로).
 *   profile_stats 끝에 manager_users. partner_applications.plan · company_members.role 은 그대로.
 *   역할별 동작은 database/probes/0047-tier-manager.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const FILE = '0047_tier_manager.sql';
const raw = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').split('\r\n').join('\n');
const read = (name) =>
  raw(name)
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = read(FILE);
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));
const BASE = flat(read('0000_baseline.sql'));

/** 함수 본문 */
function body(text, name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(
    text
  );
  return m ? m[1] : null;
}

/** start 에서 연 괄호 하나의 안 (짝 맞는 닫는 괄호까지) */
function inside(text, start) {
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
  }
  return text.slice(start, i - 1).trim();
}

/** CONSTRAINT 이름 CHECK (…) 의 괄호 안 (파일 안 마지막 정의) */
function checkOf(text, name) {
  const head = `CONSTRAINT ${name} CHECK (`;
  const at = text.lastIndexOf(head);
  return at < 0 ? null : inside(text, at + head.length);
}

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((n) => /^\d{4}_.*\.sql$/.test(n))
  .sort();
/** 마이그레이션마다 주석 뺀 한 줄 본문 */
const FLAT = Object.fromEntries(MIGRATIONS.map((n) => [n, flat(read(n))]));

const values = (expr) => [...expr.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);

/** [표, 제약 이름, 옛 정의가 있는 파일, 새 값 목록 (ARRAY 안)] */
const CHECKS = [
  [
    'profiles',
    'profiles_tier_check',
    '0000_baseline.sql',
    ['standard', 'manager', 'expert', 'agent'],
  ],
  [
    'credit_plans',
    'credit_plans_tier_check',
    '0000_baseline.sql',
    ['standard', 'manager', 'expert', 'agent'],
  ],
  [
    'subscriptions',
    'subscriptions_plan_check',
    '0000_baseline.sql',
    ['free', 'manager', 'expert', 'agent'],
  ],
  [
    'companies',
    'companies_plan_check',
    '0003_company_tables.sql',
    ['partner', 'manager', 'expert', 'agent'],
  ],
  [
    'companies',
    'companies_next_plan_check',
    '0011_partner_signup.sql',
    ['partner', 'manager', 'expert', 'agent'],
  ],
];

describe('0047 — 새 등급 manager · 장부 full 은 Agent 만', () => {
  test('트랜잭션 문 · 지우기 · 정책 · 새 표가 없고, 함수는 company_entitled 하나 · 넣기는 credit_plans 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|DROP VIEW|TRUNCATE|DROP FUNCTION|CREATE POLICY|DROP POLICY|CREATE TABLE)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      'CREATE OR REPLACE FUNCTION public.company_entitled',
    ]);
    expect(top.match(/INSERT INTO public\.\w+/g)).toEqual(['INSERT INTO public.credit_plans']);
  });

  test.each(CHECKS)(
    '%s.%s — 지우고 같은 이름으로, 옛 정의에 manager 만 더한다',
    (table, name, oldFile, want) => {
      const now = checkOf(top, name);
      const was = checkOf(FLAT[oldFile], name);
      expect(now).not.toBeNull();
      expect(was).not.toBeNull();
      expect(values(now)).toEqual(want);
      expect(now.replace("'manager'::text, ", '')).toBe(was);
      const drop = `ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${name};`;
      const add = `ALTER TABLE public.${table} ADD CONSTRAINT ${name} CHECK (`;
      expect(top.split(drop).length - 1).toBe(1);
      expect(top.split(add).length - 1).toBe(1);
      expect(top.indexOf(drop)).toBeLessThan(top.indexOf(add));
    }
  );

  test('옛 정의 파일이 0047 앞의 마지막 정의다 (그 사이 다시 정의한 마이그레이션 없음)', () => {
    for (const [, name, oldFile] of CHECKS) {
      const defs = MIGRATIONS.filter(
        (n) => n !== FILE && FLAT[n].includes(`CONSTRAINT ${name} CHECK (`)
      );
      expect([name, defs[defs.length - 1]]).toEqual([name, oldFile]);
    }
  });

  test("'expert' 를 담은 값 목록 제약은 모두 manager 도 담는다 (옛 user_profiles.role 은 등급이 아니라 뺀다)", () => {
    const last = {};
    for (const n of MIGRATIONS) {
      const t = n === FILE ? top : FLAT[n];
      for (const m of t.matchAll(/CONSTRAINT (\w+) CHECK \(/g))
        last[m[1]] = inside(t, m.index + m[0].length);
    }
    const missing = Object.entries(last)
      .filter(([name, expr]) => name !== 'user_profiles_role_check' && /'expert'::text/.test(expr))
      .filter(([, expr]) => !/'manager'::text/.test(expr))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test('Agent 신청 plan · 구성원 직책(role) 제약은 건드리지 않는다, 직책을 등급과 견주지 않는다', () => {
    expect(top).not.toMatch(/partner_applications/);
    expect(top).not.toMatch(/company_members_role_check/);
    expect(f).not.toMatch(/\brole\s*(=|IN|<>|=\s*ANY)\s*\(?\s*'manager'/i);
    expect(f).not.toMatch(/'manager'[^;]*\brole\b/i);
  });

  test('크레딧 지급표 — manager 500 한 줄, 다시 돌리면 그대로 (다른 등급 숫자는 안 고친다)', () => {
    expect(top).toContain(
      "INSERT INTO public.credit_plans (tier, monthly_credits, updated_at) VALUES ('manager', 500, now()) ON CONFLICT (tier) DO NOTHING;"
    );
    expect(top).not.toMatch(/UPDATE public\.credit_plans/i);
    expect(top).not.toMatch(/'(standard|expert|agent)', \d+/);
  });

  test('자격 — 0038 본문에서 books 조건만 plan agent (read · ledger_ai · assistant 그대로)', () => {
    const now = body(f, 'company_entitled');
    const was = body(FLAT['0038_ledger_expert.sql'], 'company_entitled');
    const booksNow =
      "co.status = 'active' AND ((co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)) AS books,";
    const booksWas =
      "co.status = 'active' AND ((co.kind = 'partner' AND co.plan IN ('expert', 'agent')) OR coalesce(s.trial, false)) AS books,";
    expect(now).toContain(booksNow);
    expect(now).not.toContain("'expert'");
    expect(now).not.toContain("'manager'");
    expect(was).toContain(booksWas);
    expect(now.replace(booksNow, booksWas)).toBe(was);
    expect(now).toContain(
      "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT books FROM c) THEN 'full' WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company) OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read' ELSE 'none' END"
    );
    expect(f).toContain(
      "CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $function$"
    );
  });

  test('자격 함수는 서버만 (REVOKE · service_role EXECUTE), 설명은 ledger full = Agent · 시험', () => {
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;'
    );
    expect(f).not.toMatch(/GRANT [^;]* ON FUNCTION [^;]* TO [^;]*\b(anon|authenticated)\b/);
    expect(f).toMatch(
      /COMMENT ON FUNCTION public\.company_entitled\(uuid, text, uuid\) IS '[^']*ledger: full\(Agent · 시험\)/
    );
  });

  test('profile_stats — 0000 정의 그대로 + 맨 끝 manager_users, security_invoker · 권한 그대로', () => {
    const view = (t, head) => {
      const m = new RegExp(
        `${head} public\\.profile_stats WITH \\(security_invoker='on'\\) AS (.*?) FROM public\\.profiles;`
      ).exec(t);
      return m ? m[1] : null;
    };
    const now = view(top, 'CREATE OR REPLACE VIEW');
    const was = view(BASE, 'CREATE VIEW');
    expect(now).not.toBeNull();
    expect(was).not.toBeNull();
    expect(now).toBe(`${was}, count(*) FILTER (WHERE (tier = 'manager'::text)) AS manager_users`);
    const cols = [...now.matchAll(/ AS (\w+)(?=,|$)/g)].map((x) => x[1]);
    expect(cols[cols.length - 1]).toBe('manager_users');
    expect(cols.slice(0, -1)).toEqual([
      'total_users',
      'standard_users',
      'expert_users',
      'agent_users',
      'paid_users',
      'today_signups',
      'week_signups',
      'month_signups',
    ]);
    for (const g of [
      'REVOKE ALL ON TABLE public.profile_stats FROM PUBLIC, anon, authenticated, service_role;',
      'GRANT ALL ON TABLE public.profile_stats TO authenticated, service_role;',
    ]) {
      expect(BASE).toContain(g);
      expect(top).toContain(g);
    }
  });

  test('다시 돌려도 된다 — 제약은 DROP IF EXISTS 다음 ADD, 함수 · 뷰는 OR REPLACE, 넣기는 ON CONFLICT', () => {
    const adds = top.match(/ADD CONSTRAINT \w+/g) || [];
    const drops = top.match(/DROP CONSTRAINT IF EXISTS \w+/g) || [];
    expect(adds.map((s) => s.split(' ').pop())).toEqual(drops.map((s) => s.split(' ').pop()));
    expect(adds).toHaveLength(CHECKS.length);
    expect(top).not.toMatch(/CREATE (FUNCTION|VIEW)\b/);
    expect(top).toMatch(/ON CONFLICT \(tier\) DO NOTHING/);
  });

  test('머리말 — 무엇 · 왜 · 월 보고에 미치는 것 · 직책 manager 는 다르다', () => {
    const head = raw(FILE)
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(head).toMatch(/^-- 0047/m);
    expect(head).toMatch(/month_report/);
    expect(head).toMatch(/ledger_month_report_scan/);
    expect(head).toMatch(/company_members\.role/);
    expect(head).toMatch(/다시 돌려도 된다/);
  });

  test('프로브 — 협력업체 plan 은 제약 목록 안, manager 업체가 있다', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0047-tier-manager.json'),
        'utf8'
      )
    );
    const rows = probe.setup
      .join('\n')
      .matchAll(/\(\{\{(company_\w+)\}\}, '(\w+)', '[^']*', '(\w+)', '(\w+)'\)/g);
    const companies = [...rows].map(([, id, kind, plan, status]) => [id, kind, plan, status]);
    expect(companies).toEqual([
      ['company_m', 'partner', 'manager', 'active'],
      ['company_e', 'partner', 'expert', 'active'],
      ['company_x', 'partner', 'expert', 'active'],
      ['company_a', 'partner', 'agent', 'active'],
      ['company_t', 'partner', 'expert', 'active'],
    ]);
    const entitled = probe.checks.find((c) => c.name.startsWith('자격 (장부/사진 읽기)'));
    expect(entitled.expect.service_role).toBe('none/none,read/none,none/none,full/full,full/full');
  });
});
