/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0048_assistant_guide.sql 정적 시험 (DB 없이).
 *
 *   AI 비서 안내 모드 — assistant_global 에 guide_on · guide_daily_limit(기본 20, 0~1000),
 *   사람 × 한국 날짜 사용량 표(assistant_guide_usage — 숫자만, 서버 읽기만, 계정과 함께 지움),
 *   함수 셋(상태 · 세기 · 정산 — 서버만, SECURITY DEFINER, 세기는 ON CONFLICT … WHERE used < 한도 한 문장).
 *   0047 객체 · 업무 모드(company_entitled · assistant_usage · 대화 표)는 건드리지 않는다.
 *   역할별 동작은 database/probes/0048-assistant-guide.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const FILE = '0048_assistant_guide.sql';
const raw = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', FILE), 'utf8')
  .split('\r\n')
  .join('\n');
const S = raw
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));

/** 함수 본문 */
function body(name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(f);
  return m ? m[1] : '';
}

const FUNCS = [
  ['assistant_guide_status', 'uuid'],
  ['assistant_guide_take', 'uuid'],
  ['assistant_guide_settle', 'uuid, date, bigint, jsonb, boolean'],
];

describe('0048 — AI 비서 안내 모드', () => {
  test('트랜잭션 문 · 지우기 · 정책 · 행 바꾸기가 없다, 새 표는 하나 · 함수는 셋', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|DROP VIEW|TRUNCATE|DROP FUNCTION|CREATE POLICY|DROP POLICY)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.assistant_guide_usage',
    ]);
    expect(f.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual(
      FUNCS.map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`)
    );
    expect(f).not.toMatch(/CREATE FUNCTION\b/);
  });

  test('업무 모드 · 0047 객체는 건드리지 않는다', () => {
    for (const name of [
      'company_entitled',
      'assistant_usage',
      'assistant_conversations',
      'assistant_messages',
      'assistant_settings',
      'assistant_budget_reserve',
      'profiles',
      'credit_plans',
      'companies',
    ])
      expect(f).not.toMatch(new RegExp(`public\\.${name}\\b`));
    // assistant_global 은 두 칸 · 한도 제약 · 설명만
    expect(top.match(/ALTER TABLE public\.assistant_global [A-Z]+ [A-Z]+/g)).toEqual([
      'ALTER TABLE public.assistant_global ADD COLUMN',
      'ALTER TABLE public.assistant_global ADD COLUMN',
      'ALTER TABLE public.assistant_global DROP CONSTRAINT',
      'ALTER TABLE public.assistant_global ADD CONSTRAINT',
    ]);
  });

  test('assistant_global — guide_on 기본 켬 · guide_daily_limit 기본 20 · 0~1000', () => {
    expect(top).toContain(
      'ALTER TABLE public.assistant_global ADD COLUMN IF NOT EXISTS guide_on boolean DEFAULT true NOT NULL;'
    );
    expect(top).toContain(
      'ALTER TABLE public.assistant_global ADD COLUMN IF NOT EXISTS guide_daily_limit integer DEFAULT 20 NOT NULL;'
    );
    const drop =
      'ALTER TABLE public.assistant_global DROP CONSTRAINT IF EXISTS assistant_global_guide_limit_check;';
    const add =
      'ALTER TABLE public.assistant_global ADD CONSTRAINT assistant_global_guide_limit_check CHECK ((guide_daily_limit >= 0) AND (guide_daily_limit <= 1000));';
    expect(top).toContain(drop);
    expect(top).toContain(add);
    expect(top.indexOf(drop)).toBeLessThan(top.indexOf(add));
  });

  test('사용량 표 — 사람 × 날짜 한 줄, 숫자만 (글 칸 없음), 계정과 함께 지움', () => {
    const m = /CREATE TABLE IF NOT EXISTS public\.assistant_guide_usage \((.*?)\);/.exec(top);
    expect(m).not.toBeNull();
    const cols = m[1]
      .trim()
      .split(/, (?=[a-z_]+ (?:uuid|date|integer|bigint|timestamp))/)
      .filter((c) => !c.startsWith('CONSTRAINT'))
      .map((c) => c.split(' ')[0]);
    expect(cols).toEqual([
      'user_id',
      'day',
      'used',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost_micros',
      'created_at',
      'updated_at',
    ]);
    expect(m[1]).not.toMatch(/\b(text|jsonb)\b/);
    expect(m[1]).toContain('CONSTRAINT assistant_guide_usage_pkey PRIMARY KEY (user_id, day)');
    expect(m[1]).toContain(
      'CONSTRAINT assistant_guide_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
    );
    expect(m[1]).toContain('CHECK ((used >= 0) AND (used <= 1000))');
    expect(m[1]).not.toMatch(/company/);
  });

  test('권한 — 표는 RLS 켬 · 정책 없음 · 서버 읽기만, 함수는 서버만 (SECURITY DEFINER · search_path 비움)', () => {
    expect(top).toContain('ALTER TABLE public.assistant_guide_usage ENABLE ROW LEVEL SECURITY;');
    expect(top).toContain(
      'REVOKE ALL ON TABLE public.assistant_guide_usage FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(top).toContain('GRANT SELECT ON TABLE public.assistant_guide_usage TO service_role;');
    expect(top).not.toMatch(/GRANT [^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]* ON TABLE/);
    expect(top).not.toMatch(/TO [^;]*\b(anon|authenticated)\b/);
    for (const [name, args] of FUNCS) {
      expect(top).toContain(
        `REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(top).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
      const head = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\) RETURNS jsonb LANGUAGE plpgsql (STABLE )?SECURITY DEFINER SET search_path TO '' AS \\$function\\$`
      );
      expect(f).toMatch(head);
      expect(f).toMatch(
        new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(${args}\\) IS '[^']*service_role 전용'`)
      );
    }
  });

  test('세기 — 한국 날짜 · 스위치 · 한도 0 이면 줄을 만들지 않고, 한 문장으로 한도 안에서만 센다', () => {
    const b = body('assistant_guide_take');
    expect(b).toContain("v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;");
    expect(b).toContain("v_reset := (v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul';");
    expect(b).toContain(
      'SELECT g.guide_on, g.guide_daily_limit INTO v_on, v_limit FROM public.assistant_global g WHERE g.id;'
    );
    expect(b).toContain(
      "IF NOT coalesce(v_on, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'off'"
    );
    expect(b).toContain('IF v_limit >= 1 THEN');
    expect(b).toContain(
      'INSERT INTO public.assistant_guide_usage AS u (user_id, day, used) VALUES (p_user, v_day, 1) ON CONFLICT (user_id, day) DO UPDATE SET used = u.used + 1, updated_at = now() WHERE u.used < v_limit RETURNING u.used INTO v_used;'
    );
    expect(b).toContain("'reason', 'over_limit'");
    // 세기 전에 따로 읽고 견주는 두 단계(경합)가 없다 — 줄 읽기는 한도에 걸린 뒤에만
    expect(b.indexOf('ON CONFLICT')).toBeLessThan(
      b.indexOf('SELECT u.used INTO v_used FROM public.assistant_guide_usage u')
    );
  });

  test('상태 — 세지 않는다 (넣기 · 고치기 없음), 같은 날짜 · reset_at 계산', () => {
    const b = body('assistant_guide_status');
    expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(b).toContain("v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;");
    expect(b).toContain("((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul')");
  });

  test('정산 — 그 날 줄만 고치고(새 줄 없음), 돌려주기는 0 아래로 가지 않는다, 토큰 칸은 Claude usage 이름', () => {
    const b = body('assistant_guide_settle');
    expect(b).not.toMatch(/\bINSERT\b/);
    expect(b).toContain('WHERE u.user_id = p_user AND u.day = p_day');
    expect(b).toContain(
      'SET used = CASE WHEN coalesce(p_give_back, false) THEN greatest(u.used - 1, 0) ELSE u.used END'
    );
    for (const [col, key] of [
      ['input_tokens', 'input_tokens'],
      ['output_tokens', 'output_tokens'],
      ['cache_read_tokens', 'cache_read_input_tokens'],
      ['cache_write_tokens', 'cache_creation_input_tokens'],
    ])
      expect(b).toContain(
        `${col} = u.${col} + greatest(coalesce((v_usage->>'${key}')::bigint, 0), 0)`
      );
    expect(b).toContain('cost_micros = u.cost_micros + p_cost_micros');
    expect(b).toContain("RAISE EXCEPTION 'p_cost_micros must be zero or more';");
    expect(b).toContain("RETURN jsonb_build_object('ok', false, 'reason', 'not_found');");
  });

  test('다시 돌려도 된다 — 칸은 IF NOT EXISTS, 제약은 DROP IF EXISTS 다음 ADD, 함수는 OR REPLACE', () => {
    const adds = top.match(/ADD CONSTRAINT \w+/g) || [];
    const drops = top.match(/DROP CONSTRAINT IF EXISTS \w+/g) || [];
    expect(adds.map((s) => s.split(' ').pop())).toEqual(drops.map((s) => s.split(' ').pop()));
    expect(top).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    expect(top).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  });

  test('머리말 — 두 모드 · 글은 넣지 않는다 · 0047 에 기대지 않는다', () => {
    const head = raw
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(head).toMatch(/^-- 0048/m);
    expect(head).toMatch(/업무 모드/);
    expect(head).toMatch(/안내 모드/);
    expect(head).toMatch(/글은 넣지 않는다/);
    expect(head).toMatch(/0047/);
    expect(head).toMatch(/다시 돌려도 된다/);
  });

  test('프로브 — 한도 · 끔 · 돌려주기 · 서버만을 본다', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0048-assistant-guide.json'),
        'utf8'
      )
    );
    const names = probe.checks.map((c) => c.name);
    for (const want of ['하루 한도 2', '스위치 끔', '돌려주기', '한도 0', '서버만'])
      expect(names.some((n) => n.includes(want))).toBe(true);
    const third = probe.checks.find((c) => c.name.startsWith('하루 한도 2 — 셋째'));
    expect(third.expect.service_role).toBe('false/over_limit/2/2');
  });
});
