/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0056_ledger_platform.sql 정적 시험 (DB 없이).
 *
 *   다담 본사(companies.kind = 'platform')도 회계장부 — company_entitled 를 0047 본문에서 다시 만든다:
 *   본사 칸 platform(활성 다담 본사) 하나를 더하고 ledger · ledger_ai 의 full 조건에 OR platform.
 *   assistant 갈래 · base · books · enabled 식 · 구성원 확인(m) · 머리 · 권한은 0047 그대로.
 *   값은 database/probes/0056-ledger-platform.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const FILE = '0056_ledger_platform.sql';
const PREV = '0047_tier_manager.sql';
const PROBE = path.join(ROOT, 'database', 'probes', '0056-ledger-platform.json');
const raw = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').split('\r\n').join('\n');
const noComments = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const f = flat(noComments(raw(FILE)));
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const statements = top
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((n) => /^\d{4}_.*\.sql$/.test(n))
  .sort();
const FLAT = Object.fromEntries(MIGRATIONS.map((n) => [n, flat(noComments(raw(n)))]));
const was = FLAT[PREV];

/** company_entitled 본문 ($function$ 사이) */
const body = (text) => {
  const m =
    /CREATE OR REPLACE FUNCTION public\.company_entitled\(.*?\$function\$(.*?)\$function\$/.exec(
      text
    );
  return m ? m[1].trim() : null;
};
const between = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? null : text.slice(a, b);
};
const count = (text, sub) => text.split(sub).length - 1;

const HEAD =
  "CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $function$";
const REVOKE =
  'REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role';
const GRANT = 'GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role';

/** 0056 이 0047 본문에 더하는 세 곳 — [0047, 0056] */
const PLATFORM = "co.status = 'active' AND co.kind = 'platform' AS platform, ";
const LEDGER = [
  "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT books FROM c) THEN 'full'",
  "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT books OR platform FROM c) THEN 'full'",
];
const AI = [
  "WHEN p_feature = 'ledger_ai' THEN CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'none' END",
  "WHEN p_feature = 'ledger_ai' THEN CASE WHEN (SELECT base OR platform FROM c) THEN 'full' ELSE 'none' END",
];

describe('0056 — 다담 본사도 회계장부 · 사진 AI 읽기 (company_entitled)', () => {
  test('문장 — 자격 함수 다시 만들기 · 설명 · 권한 거두기 · 서버 권한뿐, 트랜잭션 · 표 · 행 · 정책 없음', () => {
    expect(statements).toEqual([
      `${HEAD} … $function$`,
      expect.stringMatching(
        /^COMMENT ON FUNCTION public\.company_entitled\(uuid, text, uuid\) IS '[^']*'$/
      ),
      REVOKE,
      GRANT,
    ]);
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP|TRUNCATE|POLICY|CREATE TABLE|ALTER TABLE|SECURITY DEFINER|VIEW|TRIGGER)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
  });

  test('0056 앞의 마지막 company_entitled 정의는 0047 이다 (그 본문에서 다시 만든다)', () => {
    const defs = MIGRATIONS.filter(
      (n) => n < FILE && FLAT[n].includes('CREATE OR REPLACE FUNCTION public.company_entitled(')
    );
    expect(defs[defs.length - 1]).toBe(PREV);
  });

  test('본문 — 0047 그대로 + 본사 칸 platform 하나 · ledger 와 ledger_ai 의 full 조건에 OR platform', () => {
    const now = body(f);
    const before = body(was);
    expect(now).not.toBeNull();
    expect(before).not.toBeNull();
    expect(before).not.toMatch(/platform/);
    expect(count(before, LEDGER[0])).toBe(1);
    expect(count(before, AI[0])).toBe(1);
    expect(count(now, PLATFORM)).toBe(1);
    expect(count(now, LEDGER[1])).toBe(1);
    expect(count(now, AI[1])).toBe(1);
    // platform 은 이 세 곳에만 (칸 이름 · 값 · 두 조건)
    expect(now.match(/platform/g)).toHaveLength(4);
    expect(now.replace(PLATFORM, '').replace(LEDGER[1], LEDGER[0]).replace(AI[1], AI[0])).toBe(
      before
    );
    // 본사 칸은 active 일 때만, kind 하나로 (plan · 시험 · 사람과 섞지 않는다)
    expect(now).toContain(
      "AS books, co.status = 'active' AND co.kind = 'platform' AS platform, coalesce(s.enabled, false) AS enabled"
    );
  });

  test('assistant 갈래 · base · books 식 · 구성원 확인(m) · 장부 read 갈래는 0047 과 같은 글자', () => {
    const now = body(f);
    const before = body(was);
    const parts = [
      ["WHEN p_feature = 'assistant' THEN", "WHEN p_feature = 'ledger' THEN"],
      ['WITH c AS ( SELECT', ' AS books,'],
      ['), m AS (', 'SELECT CASE'],
      [
        "THEN 'full' WHEN EXISTS (SELECT 1 FROM public.ledger_entries e",
        "WHEN p_feature = 'ledger_ai'",
      ],
    ];
    for (const [from, to] of parts) {
      const a = between(now, from, to);
      expect(a).not.toBeNull();
      expect(a).toBe(between(before, from, to));
      expect(a).not.toMatch(/platform/);
    }
    // 비서는 base AND enabled · 전체 켜짐 그대로 — 본사 칸을 보지 않는다
    expect(
      between(now, "WHEN p_feature = 'assistant' THEN", "WHEN p_feature = 'ledger' THEN")
    ).toBe(
      "WHEN p_feature = 'assistant' THEN CASE WHEN (SELECT base AND enabled FROM c) AND coalesce((SELECT g.assistant_on FROM public.assistant_global g WHERE g.id), false) THEN 'full' ELSE 'none' END "
    );
    // 공장(hq)은 이름으로 다루지 않는다
    expect(now).not.toMatch(/'hq'/);
  });

  test('머리 · 권한 — sql · STABLE · search_path · SECURITY INVOKER, EXECUTE 는 서버만 (0047 과 같은 글자)', () => {
    for (const text of [f, was]) {
      expect(text).toContain(HEAD);
      expect(text).toContain(`${REVOKE};`);
      expect(text).toContain(`${GRANT};`);
    }
    expect(f).not.toMatch(/SECURITY DEFINER/);
    expect(f).not.toMatch(/GRANT [^;]* TO [^;]*\b(anon|authenticated|PUBLIC)\b/);
    expect(f.indexOf(REVOKE)).toBeLessThan(f.indexOf(GRANT));
  });

  test('설명 — ledger · ledger_ai full 에 다담 본사, assistant 는 Agent · 시험 (본사 아님)', () => {
    const c = /COMMENT ON FUNCTION public\.company_entitled\(uuid, text, uuid\) IS '([^']*)'/.exec(
      f
    );
    expect(c).not.toBeNull();
    expect(c[1]).toContain('assistant: full | none (Agent · 시험 — 다담 본사는 아니다)');
    expect(c[1]).toContain('ledger: full(Agent · 다담 본사 · 시험)');
    expect(c[1]).toContain('ledger_ai(사진 AI 읽기): full(Agent · 다담 본사 · 시험)');
    expect(c[1]).toContain('사람을 주면 active 구성원만. service_role 전용');
  });

  test('머리말 — 무엇 · 비서는 그대로 · 이 값을 따라 열리는 것 · 바꾸지 않는 것 · 다시 돌려도 된다', () => {
    const head = raw(FILE)
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(head).toMatch(/^-- 0056/m);
    expect(head).toMatch(/companies\.kind = 'platform'/);
    expect(head).toMatch(/assistant\s+0047 그대로/);
    for (const fn of ['ledger_month_report_scan', 'ledger_extract_due', 'assistant_budget_reserve'])
      expect(head).toContain(fn);
    expect(head).toMatch(/바꾸지 않는 것/);
    expect(head).toMatch(/다시 돌려도 된다/);
  });

  test('프로브 — 본사 full/full · 구성원만 · 비서 0047 식 · 멈춘 본사 · 공장 · 협력업체 · 함수 모양', () => {
    const probe = JSON.parse(fs.readFileSync(PROBE, 'utf8'));
    expect(probe.title).toContain(`--migration database/migrations/${FILE}`);
    expect(Object.keys(probe.roles)).toEqual(['anon', 'p_member', 'service_role']);
    expect(probe.roles.p_member).toEqual({ role: 'authenticated', user: 'p_member_user' });

    // 본사는 하나뿐(companies_one_platform) — 가짜 본사를 만들지 않고 platform_company_id() 를 쓴다
    const setup = probe.setup.join('\n');
    expect(setup).not.toMatch(/'platform'/);
    const rows = setup.matchAll(/\(\{\{(company_\w+)\}\}, '(\w+)', '[^']*', '(\w+)', '(\w+)'\)/g);
    expect([...rows].map(([, id, kind, plan, status]) => [id, kind, plan, status])).toEqual([
      ['company_m', 'partner', 'manager', 'active'],
      ['company_mr', 'partner', 'manager', 'active'],
      ['company_e', 'partner', 'expert', 'active'],
      ['company_er', 'partner', 'expert', 'active'],
      ['company_a', 'partner', 'agent', 'active'],
    ]);
    expect(setup).toContain(
      "VALUES (public.platform_company_id(), {{p_member_user}}, 'manager', 'active'), (public.platform_company_id(), {{p_removed_user}}, 'manager', 'removed')"
    );
    expect(setup).toMatch(/INSERT INTO public\.ledger_entries [^\n]*\{\{company_mr\}\}/);
    expect(setup).toMatch(/INSERT INTO public\.ledger_documents [^\n]*\{\{company_er\}\}/);

    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c]));
    const want = (name) => byName[name] && byName[name].expect;
    expect(want('다담 본사 — 장부 / 사진 AI 읽기 full (사람 없이, 자격 함수는 서버만)')).toEqual({
      service_role: 'full/full',
      '*': 'deny',
    });
    expect(want('다담 본사 — active 구성원(실장)으로 물어도 장부 / 사진 AI 읽기 full')).toEqual({
      service_role: 'full/full',
    });
    expect(
      want('다담 본사 — 구성원이 아닌 사람 · 나간 구성원은 장부 / 사진 / 비서 모두 none')
    ).toEqual({ service_role: 'none/none/none,none/none/none' });
    const assistant =
      byName[
        '다담 본사 — 업무 비서(assistant)는 0047 식 그대로 (시험 예외 · 켜짐 · 전체 켜짐이 다 있어야 full, 장부 자격과 따로)'
      ];
    expect(assistant.expect).toEqual({ service_role: 'true' });
    // 견주는 식은 0047 비서 갈래와 같은 조건 (본사 base = active · 시험)
    expect(assistant.sql).toContain(
      "co.status = 'active' AND coalesce(s.trial, false) AND coalesce(s.enabled, false) AND coalesce((SELECT g.assistant_on FROM public.assistant_global g WHERE g.id), false) THEN 'full' ELSE 'none' END"
    );
    expect(want('다담 공장(hq) — 0047 식 그대로 (장부 · 사진 AI 읽기 · 비서)')).toEqual({
      service_role: 'true',
    });
    expect(
      want(
        '협력업체 — 0047 그대로 (장부/사진/비서): Manager · 장부 줄 있는 Manager · Expert · 사진 있는 Expert · Agent'
      )
    ).toEqual({
      service_role: 'none/none/none,read/none/none,none/none/none,read/none/none,full/full/none',
    });
    expect(want('모르는 기능 · 없는 업체는 none (0047 그대로)')).toEqual({
      service_role: 'none/none/none',
    });
    expect(
      want(
        "자격 함수 모양 — sql · STABLE · SECURITY INVOKER · search_path '' · EXECUTE 는 서버만 (anon/authenticated/service_role)"
      )
    ).toEqual({ service_role: 'sql/s/false/search_path=""/false/false/true' });

    // 실제 행을 고치는 칸은 멈춘 본사 하나 — 그 칸 안(SAVEPOINT)에서만 본사 줄을 suspended 로
    const writes = probe.checks.filter((c) => /\b(update|insert|delete)\b/i.test(c.sql));
    expect(writes.map((c) => c.name)).toEqual([
      '다담 본사가 active 가 아니면(이 칸 안에서만 suspended, 되돌림) 본사 몫이 빠진다 — 장부는 0047 처럼(줄 · 사진이 있으면 read, 없으면 none) / 사진 AI 읽기 none',
    ]);
    expect(writes[0].sql).toMatch(
      /^update public\.companies set status = 'suspended' where id = public\.platform_company_id\(\); select /
    );
    expect(writes[0].expect).toEqual({ service_role: 'true/none' });
    expect(writes[0].roles).toEqual(['service_role']);
    expect(probe.checks).toHaveLength(9);
  });
});
