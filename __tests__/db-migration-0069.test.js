/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0069_planner_genome_panel.sql 정적 시험 (DB 없이).
 *
 *   간편 플래너 설계 제안 카드에 다른 업체 구성을 더하는 표 셋 (2026-11-17 사장님 결정 —
 *   모듈 구성만 · 나를 빼고 3곳 이상 · 프로젝트에 이어진 설계만 · 업체가 모이기 전에는 본사가 고른 씨앗):
 *   planner_draft_genome(설계마다 줄 유전체) · planner_genome_panel(여러 업체 공통 줄) · planner_genome_seeds(씨앗 설계) — 셋 다 service_role 만.
 *   값은 database/probes/0069-planner-genome-panel.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0069_planner_genome_panel.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const NEW_TABLES = ['planner_draft_genome', 'planner_genome_panel', 'planner_genome_seeds'];

describe('0069 — 간편 플래너 여러 업체 공통 줄', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다, 새 표는 셋', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      NEW_TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('있던 플래너 표 · 설계 표는 건드리지 않는다', () => {
    for (const t of ['planner_drafts', 'planner_draft_learn', 'planner_signals', 'designs']) {
      expect(f).not.toContain(`ALTER TABLE public.${t} `);
      expect(f).not.toMatch(new RegExp(`ON public\\.${t}\\b`));
    }
  });

  test('셋 다 서버만 — RLS 를 켜고 정책이 없다, 익명 · 로그인 사용자 권한을 거둔다', () => {
    expect(f).not.toContain('CREATE POLICY');
    for (const t of NEW_TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    // 줄 유전체: 넣기 · 고치기만 (지우지 않는다) / 공통 줄: 다시 묶으려고 지우기까지 / 씨앗: 넣기 · 표시 빼기 (고치지 않는다)
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_genome TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_genome FROM service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_genome_panel TO service_role;'
    );
    expect(f).toContain('REVOKE TRUNCATE ON TABLE public.planner_genome_panel FROM service_role;');
    expect(f).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE public.planner_genome_seeds TO service_role;'
    );
    expect(f).toContain(
      'REVOKE UPDATE, TRUNCATE ON TABLE public.planner_genome_seeds FROM service_role;'
    );
  });

  test('줄 유전체 — 설계마다 한 줄, 그 업체의 설계에만 붙는다, 줄은 배열 · 16KB 까지', () => {
    expect(f).toContain('CONSTRAINT planner_draft_genome_pkey PRIMARY KEY (company_id, draft_id)');
    expect(f).toContain(
      'CONSTRAINT planner_draft_genome_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      "CONSTRAINT planner_draft_genome_lines_check CHECK ((jsonb_typeof(lines) = 'array'::text) AND (octet_length(lines::text) <= 16384))"
    );
  });

  test('공통 줄 — 씨앗이 아니면 3곳 미만은 들어올 수 없다, 업체 수 = 업체 목록 길이, 줄 종류는 바닥 · 상부', () => {
    expect(f).toContain('CONSTRAINT planner_genome_panel_pkey PRIMARY KEY (item, kind, line_key)');
    expect(f).toContain('CONSTRAINT planner_genome_panel_three_check CHECK (seed OR (n >= 3))');
    expect(f).toContain(
      'CONSTRAINT planner_genome_panel_n_check CHECK (n = COALESCE(cardinality(company_ids), 0))'
    );
    expect(f).toContain(
      "CONSTRAINT planner_genome_panel_kind_check CHECK (kind = ANY (ARRAY['floor'::text, 'upper'::text]))"
    );
  });

  test('씨앗 — 있는 설계만 고른다, 고른 사람은 계정을 지워도 줄이 남는다', () => {
    expect(f).toContain(
      'CONSTRAINT planner_genome_seeds_draft_fkey FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'CONSTRAINT planner_genome_seeds_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL'
    );
  });

  test('실DB 확인표가 같이 있다 — 표 셋의 읽기 · 쓰기와 3곳 제약을 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0069-planner-genome-panel.json'));
    const sql = probe.checks.map((c) => c.sql).join('\n');
    for (const t of NEW_TABLES) expect(sql).toContain(`public.${t}`);
    expect(
      probe.checks.some((c) => /3곳 미만/.test(c.name) && c.expect.service_role === 'err:23514')
    ).toBe(true);
    // 바꾸는 문장과 읽는 문장을 한 칸에 섞지 않는다 (칸마다 되돌린다)
    for (const c of probe.checks) expect(/;\s*select/i.test(c.sql)).toBe(false);
  });
});
