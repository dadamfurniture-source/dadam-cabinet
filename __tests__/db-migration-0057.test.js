/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0057_factory_as_agent.sql 정적 시험 (DB 없이).
 *
 *   다담 공장(companies.kind = 'hq')을 Agent 처럼 — 2026-11-10 대표님 결정.
 *   company_entitled   0056 본문의 base · books 에 OR co.kind = 'hq' 두 곳만 더한다
 *   consume_credit · my_credit_wallet · company_tier_sync
 *                      0011 본문에서 업체 고르기만 kind IN ('partner', 'hq') · 공장 plan = 'agent'
 *   지금 공장 구성원    profiles.tier = agent 로 한 번 맞춘다
 *   값은 database/probes/0057-factory-as-agent.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const FILE = '0057_factory_as_agent.sql';
const PROBE = path.join(ROOT, 'database', 'probes', '0057-factory-as-agent.json');
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

/** 함수 본문 ($function$ 사이) — 파일 안 마지막 정의 */
const body = (text, fn) => {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fn}\\(.*?\\$function\\$(.*?)\\$function\\$`,
    'g'
  );
  let last = null;
  for (const m of text.matchAll(re)) last = m[1].trim();
  return last;
};
/** 0057 앞에서 그 함수를 마지막으로 정의한 파일 */
const prevDef = (fn) => {
  const defs = MIGRATIONS.filter(
    (n) => n < FILE && FLAT[n].includes(`CREATE OR REPLACE FUNCTION public.${fn}(`)
  );
  return defs[defs.length - 1];
};
const count = (text, sub) => text.split(sub).length - 1;

const AGENT = "(co.kind = 'partner' AND co.plan = 'agent')";
const PICK_WAS = 'c.id, c.status, c.plan INTO';
const PICK_NOW = "c.id, c.status, CASE WHEN c.kind = 'hq' THEN 'agent' ELSE c.plan END INTO";
const KIND_WAS = "AND c.kind = 'partner'";
const KIND_NOW = "AND c.kind IN ('partner', 'hq')";

describe('0057 — 다담 공장을 Agent 처럼 (자격 · 크레딧 · 등급)', () => {
  test('문장 — 함수 넷 다시 만들기 · 설명 · 권한 · 지금 공장 구성원 등급 맞추기, 트랜잭션 · 표 · 정책 없음', () => {
    expect(statements).toEqual([
      "CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $function$ … $function$",
      expect.stringMatching(
        /^COMMENT ON FUNCTION public\.company_entitled\(uuid, text, uuid\) IS '[^']*'$/
      ),
      'REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role',
      'GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role',
      "CREATE OR REPLACE FUNCTION public.consume_credit(p_reason text DEFAULT 'generate'::text) RETURNS TABLE(ref uuid, balance integer, cost integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$ … $function$",
      "CREATE OR REPLACE FUNCTION public.my_credit_wallet() RETURNS TABLE(scope text, company_id uuid, plan text, balance integer, monthly integer, period_end timestamp with time zone, usable boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ … $function$",
      'REVOKE ALL ON FUNCTION public.my_credit_wallet() FROM PUBLIC, anon, authenticated, service_role',
      'GRANT EXECUTE ON FUNCTION public.my_credit_wallet() TO authenticated, service_role',
      "CREATE OR REPLACE FUNCTION public.company_tier_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$ … $function$",
      'REVOKE ALL ON FUNCTION public.company_tier_sync() FROM PUBLIC, anon, authenticated, service_role',
      "UPDATE public.profiles p SET tier = 'agent', tier_source = 'company' FROM public.company_members m JOIN public.companies c ON c.id = m.company_id WHERE m.user_id = p.id AND m.status = 'active' AND c.kind = 'hq' AND c.status = 'active' AND (p.tier IS DISTINCT FROM 'agent' OR p.tier_source IS DISTINCT FROM 'company')",
    ]);
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP|TRUNCATE|POLICY|CREATE TABLE|ALTER TABLE|VIEW|TRIGGER trg)\b/i
    );
    expect(top).not.toMatch(/credit_plans/);
  });

  test('앞 정의 — company_entitled 는 0056, 크레딧 · 등급 함수는 0011 (그 사이 다시 정의한 파일 없음)', () => {
    expect(prevDef('company_entitled')).toBe('0056_ledger_platform.sql');
    for (const fn of ['consume_credit', 'my_credit_wallet', 'company_tier_sync'])
      expect([fn, prevDef(fn)]).toEqual([fn, '0011_partner_signup.sql']);
  });

  test("자격 — 0056 본문에서 base · books 의 Agent 조건 뒤에 OR co.kind = 'hq' 두 곳만", () => {
    const now = body(f, 'company_entitled');
    const was = body(FLAT['0056_ledger_platform.sql'], 'company_entitled');
    expect(count(was, `${AGENT} OR coalesce(s.trial, false)`)).toBe(2);
    expect(count(now, `${AGENT} OR co.kind = 'hq' OR coalesce(s.trial, false)`)).toBe(2);
    expect(now.match(/'hq'/g)).toHaveLength(2);
    expect(now.split(" OR co.kind = 'hq'").join('')).toBe(was);
    // 공장 몫도 active 일 때만 (base · books 는 co.status = 'active' AND (…) 안)
    expect(now).toContain(
      `co.status = 'active' AND (${AGENT} OR co.kind = 'hq' OR coalesce(s.trial, false)) AS base,`
    );
    expect(now).toContain(
      `co.status = 'active' AND (${AGENT} OR co.kind = 'hq' OR coalesce(s.trial, false)) AS books,`
    );
  });

  test('크레딧 · 통장 · 등급 맞추기 — 0011 본문에서 업체 고르기만 (협력업체 + 공장, 공장 plan = agent)', () => {
    const old = FLAT['0011_partner_signup.sql'];
    for (const fn of ['consume_credit', 'my_credit_wallet']) {
      const now = body(f, fn);
      const was = body(old, fn);
      expect([fn, count(was, PICK_WAS), count(was, KIND_WAS)]).toEqual([fn, 1, 1]);
      expect([fn, count(now, PICK_NOW), count(now, KIND_NOW)]).toEqual([fn, 1, 1]);
      expect(now.replace(PICK_NOW, PICK_WAS).replace(KIND_NOW, KIND_WAS)).toBe(was);
    }
    const now = body(f, 'company_tier_sync');
    const was = body(old, 'company_tier_sync');
    expect(count(was, KIND_WAS)).toBe(2);
    expect(count(now, KIND_NOW)).toBe(2);
    expect(
      now
        .split(KIND_NOW)
        .join(KIND_WAS)
        .replace("CASE WHEN c.kind = 'hq' THEN 'agent' ELSE c.plan END AS plan", 'c.plan')
    ).toBe(was);
  });

  test('되돌려 주기 · 업체 등급 바꿈 리셋은 그대로 (공장 줄도 company_id 로 돌려준다)', () => {
    for (const fn of ['refund_credit', 'refund_credit_svc', 'company_credits_reset_on_plan'])
      expect(f).not.toContain(`FUNCTION public.${fn}(`);
  });

  test('설명 — 공장은 장부 · 사진 AI · 비서 full 에, 본사는 비서에서 빠진 그대로', () => {
    const c = /COMMENT ON FUNCTION public\.company_entitled\(uuid, text, uuid\) IS '([^']*)'/.exec(
      f
    );
    expect(c).not.toBeNull();
    expect(c[1]).toContain(
      'assistant: full | none (Agent · 다담 공장 · 시험 — 다담 본사는 아니다)'
    );
    expect(c[1]).toContain('ledger: full(Agent · 다담 공장 · 다담 본사 · 시험)');
    expect(c[1]).toContain('ledger_ai(사진 AI 읽기): full(Agent · 다담 공장 · 다담 본사 · 시험)');
  });

  test('머리말 — 결정 · 정해 둔 값 · 바꾸지 않는 것 · 다시 돌려도 된다', () => {
    const head = raw(FILE)
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(head).toMatch(/^-- 0057/m);
    expect(head).toContain('2026-11-10 대표님 결정');
    for (const fn of [
      'company_entitled',
      'consume_credit',
      'my_credit_wallet',
      'company_tier_sync',
    ])
      expect(head).toContain(fn);
    expect(head).toMatch(/바꾸지 않는 것/);
    expect(head).toMatch(/다시 돌려도 된다/);
  });

  test('프로브 — 공장 full/full · 구성원만 · 비서 · 멈춘 공장 · 협력업체 · 본사 · 통장 · 크레딧 · 등급', () => {
    const probe = JSON.parse(fs.readFileSync(PROBE, 'utf8'));
    expect(probe.title).toContain(`--migration database/migrations/${FILE}`);
    expect(Object.keys(probe.roles)).toEqual(['anon', 'f_member', 'other', 'service_role']);
    expect(probe.roles.f_member).toEqual({ role: 'authenticated', user: 'f_member_user' });

    // 공장 · 본사는 하나뿐 — 가짜를 만들지 않고 hq_company_id() · platform_company_id() 를 쓴다
    const setup = probe.setup.join('\n');
    expect(setup).not.toMatch(/'hq'|'platform'/);
    expect(setup).toContain(
      "VALUES (public.hq_company_id(), {{f_member_user}}, 'staff', 'active'), (public.hq_company_id(), {{f_removed_user}}, 'staff', 'removed')"
    );

    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c]));
    const want = (name) => byName[name] && byName[name].expect;
    expect(
      want(
        '다담 공장(active) — 장부 / 사진 AI 읽기 full, 시험 예외 없이 (사람 없이, 자격 함수는 서버만)'
      )
    ).toEqual({ service_role: 'full/full', '*': 'deny' });
    expect(
      want(
        '협력업체 — 0056 그대로 (장부/사진/비서): Manager · 장부 줄 있는 Manager · Expert · 사진 있는 Expert · Agent'
      )
    ).toEqual({
      service_role: 'none/none/none,read/none/none,none/none/none,read/none/none,full/full/none',
    });
    expect(
      want(
        '통장 — 다담 공장 구성원은 업체 통장 · plan agent · 월 지급 = Agent, 구성원 아닌 사람은 개인 통장'
      )
    ).toEqual({ f_member: 'company/agent/true/true', other: 'personal/standard/false/false' });
    expect(
      want(
        '등급 맞추기 — 다담 공장 active 구성원은 agent/company, 나간 구성원 · 구성원 아닌 사람은 업체 등급이 아니다'
      )
    ).toEqual({ service_role: 'agent/company,false,false' });

    // 시험 예외를 끄고 본다 — 공장 몫이 trial 덕이 아니라는 것을 확인
    expect(
      byName[
        '다담 공장(active) — 장부 / 사진 AI 읽기 full, 시험 예외 없이 (사람 없이, 자격 함수는 서버만)'
      ].sql
    ).toMatch(
      /^update public\.assistant_settings set trial = false where company_id = public\.hq_company_id\(\); select /
    );
    expect(probe.checks).toHaveLength(12);
  });
});
