/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0009_planner_completions.sql 정적 시험 (DB 없이).
 *
 *   planner_completions — 쓰기는 service_role(dataset-api 워커)만, 읽기는 관리자만. 묶음 키 모양은 워커(planner.js)와 같다.
 *   dataset_exportable — 기준선 뷰에서 조건 하나(dadam_planner + planner_completions)만 더한다. 열 · 다른 조건은 한 글자도 그대로.
 *   역할별 실제 동작은 rls-probe + database/probes/0009-planner-completions.json 으로 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0009_planner_completions.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const STMTS = flat(CODE)
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const BASE = read('0000_baseline.sql');
const VIEW_RE = /CREATE (?:OR REPLACE )?VIEW public\.dataset_exportable[\s\S]*?;/;

describe('0009 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('건드리는 것은 표 하나 · 정책 하나 · 뷰 하나뿐', () => {
    const kinds = STMTS.map((s) => s.split(' ').slice(0, 3).join(' '));
    expect(kinds).toEqual([
      'CREATE TABLE IF',
      'COMMENT ON TABLE',
      'ALTER TABLE public.planner_completions',
      'REVOKE ALL ON',
      'GRANT SELECT ON',
      'DROP POLICY IF',
      'CREATE POLICY planner_completions_admin_read',
      'CREATE OR REPLACE',
    ]);
  });
});

describe('0009 — planner_completions', () => {
  test('다시 돌려도 된다 — IF NOT EXISTS, 정책은 DROP IF EXISTS 다음', () => {
    expect(flat(CODE)).toContain('CREATE TABLE IF NOT EXISTS public.planner_completions (');
    const drop = STMTS.indexOf('DROP POLICY IF EXISTS planner_completions_admin_read ON public.planner_completions');
    const create = STMTS.findIndex((s) => s.startsWith('CREATE POLICY planner_completions_admin_read'));
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  test('묶음 키 모양은 워커 planner.js 의 설계 id 와 같다 · 시공 완료 사진 한 장 이상 · 표시한 관리자', () => {
    const worker = read('../../workers/dataset-api/src/planner.js');
    const idRe = worker.match(/const DESIGN_ID_RE = \/\^(.+)\$\/;/)[1];
    expect(flat(CODE)).toContain(`CHECK (group_key ~ '^planner-lite:design:${idRe}$')`);
    expect(worker).toContain("export const COMPLETION_TABLE = 'planner_completions';");
    expect(flat(CODE)).toContain('complete_photos integer NOT NULL CHECK (complete_photos >= 1)');
    expect(flat(CODE)).toContain('confirmed_by uuid NOT NULL');
    expect(flat(CODE)).toContain('confirmed_at timestamptz NOT NULL DEFAULT now()');
  });

  test('RLS 켬 · anon 은 아무것도 · authenticated 는 SELECT 만 (쓰기는 service_role 워커만)', () => {
    expect(STMTS).toContain('ALTER TABLE public.planner_completions ENABLE ROW LEVEL SECURITY');
    expect(STMTS).toContain('REVOKE ALL ON TABLE public.planner_completions FROM PUBLIC, anon, authenticated');
    const grants = STMTS.filter((s) => /^GRANT /.test(s));
    expect(grants).toEqual(['GRANT SELECT ON TABLE public.planner_completions TO authenticated']);
  });

  test('정책은 읽기 하나 — 관리자만', () => {
    const policies = STMTS.filter((s) => s.startsWith('CREATE POLICY'));
    expect(policies).toEqual([
      'CREATE POLICY planner_completions_admin_read ON public.planner_completions FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',
    ]);
  });
});

describe('0009 — dataset_exportable', () => {
  const base = flat(BASE.match(VIEW_RE)[0]);
  const next = flat(CODE.match(VIEW_RE)[0]);
  const ORDER_END = "(o.status = 'completed'::text))))));";
  const PLANNER =
    "(o.status = 'completed'::text)))) OR ((source = 'dadam_planner'::text) AND (EXISTS ( SELECT 1 FROM public.planner_completions pc WHERE (pc.group_key = dataset_samples.group_key))))));";

  test('기준선 뷰 끝이 예상한 모양이다 (기준선이 바뀌면 이 시험부터 다시 본다)', () => {
    expect(base.startsWith('CREATE VIEW public.dataset_exportable WITH (security_invoker=\'on\') AS SELECT sample_id,')).toBe(true);
    expect(base.endsWith(ORDER_END)).toBe(true);
  });

  test('기준선 그대로 + 조건 하나 — 열 · 다른 조건 · security_invoker 는 한 글자도 같다', () => {
    const expected = base.replace('CREATE VIEW', 'CREATE OR REPLACE VIEW').slice(0, -ORDER_END.length) + PLANNER;
    expect(next).toBe(expected);
  });

  test('수주 시공 완료 조건은 그대로 남는다 (planner 조건은 OR 로 더할 뿐)', () => {
    expect(next).toContain('FROM public.orders o WHERE ((o.design_id = dataset_samples.design_id) AND (o.status = \'completed\'::text))');
    expect(next).toContain("(media <> 'generated'::text)");
    expect(next).toContain("((license <> 'user-uploaded'::text) OR ((consent = true) AND (label_source = 'human'::text)))");
  });
});
