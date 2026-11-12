/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0031_ledger_extract_reread.sql 정적 시험 (DB 없이).
 *
 *   읽기 시작(ledger_extract_begin)에 판 · 다시 걸 사진(ledger_extract_due)에 다시 읽을 판을 더한다 —
 *   더 낮은 판으로 읽은 확인 기다리는 사진만 새 판으로 다시 읽는다. 나머지는 0029 그대로.
 *   역할별 동작은 database/probes/0031-ledger-extract-reread.json 이 실DB 트랜잭션에서 본다.
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
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = read('0031_ledger_extract_reread.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));
const old = flat(read('0029_ledger_extract.sql'));

/** 함수 본문 */
function body(text, name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(
    text
  );
  return m ? m[1] : null;
}

describe('0031 — 새 판으로 다시 읽기', () => {
  test('트랜잭션 문 · 표 바꾸기가 없고, 두 함수만 옛 인자를 지우고 새로 만든다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|CREATE POLICY)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(top.match(/DROP FUNCTION [^;]*;/g)).toEqual([
      'DROP FUNCTION IF EXISTS public.ledger_extract_begin(uuid, integer, boolean);',
      'DROP FUNCTION IF EXISTS public.ledger_extract_due(integer, integer, integer, integer);',
    ]);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+\([^)]*\)/g)).toEqual([
      'CREATE OR REPLACE FUNCTION public.ledger_extract_begin(p_document uuid, p_max_attempts integer, p_again boolean DEFAULT false, p_schema_version integer DEFAULT NULL)',
      'CREATE OR REPLACE FUNCTION public.ledger_extract_due(p_limit integer, p_wait_sec integer, p_stuck_sec integer, p_max_attempts integer, p_reread_below integer DEFAULT NULL)',
    ]);
    expect(f).toContain(
      'RETURNS TABLE(document_id uuid, company_id uuid, reread boolean) LANGUAGE plpgsql SET search_path TO'
    );
  });

  test('읽기 시작 — 0029 와 같고, 읽은 사진은 다시 + 더 낮은 판일 때만 연다', () => {
    const b = body(f, 'ledger_extract_begin');
    expect(b).toContain(
      "IF v_last.status = 'done' AND NOT (coalesce(p_again, false) AND coalesce(v_last.schema_version, 0) < coalesce(p_schema_version, 0)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'done', 'id', v_last.id);"
    );
    expect(b).toContain(
      "IF p_schema_version IS NOT NULL AND p_schema_version < 1 THEN RAISE EXCEPTION 'p_schema_version must be >= 1'; END IF;"
    );
    // 판 검사 · 읽은 사진 조건을 빼면 0029 본문 그대로
    const back = b
      .replace(
        " IF p_schema_version IS NOT NULL AND p_schema_version < 1 THEN RAISE EXCEPTION 'p_schema_version must be >= 1'; END IF;",
        ''
      )
      .replace(
        ' AND NOT (coalesce(p_again, false) AND coalesce(v_last.schema_version, 0) < coalesce(p_schema_version, 0))',
        ''
      );
    expect(back).toBe(body(old, 'ledger_extract_begin'));
    // IF 조건 안에 CASE … THEN 을 두지 않는다 (plpgsql 이 조건을 첫 THEN 까지로 읽는다)
    const conds = [...b.matchAll(/(?<!END )\bIF\b(.*?)\bTHEN\b/g)].map((m) => m[1]);
    expect(conds.length).toBeGreaterThan(6);
    for (const c of conds) expect(c).not.toMatch(/\bCASE\b/);
  });

  test('다시 걸 사진 — 0029 사진 + 더 낮은 판으로 읽은 사진(시도 5 아래, reread), 다시 읽기는 뒤에', () => {
    const b = body(f, 'ledger_extract_due');
    const was = body(old, 'ledger_extract_due');
    // 멈춘 시도 닫기 · 확인 기다림 · 기다린 초는 그대로
    for (const part of [
      "UPDATE public.ledger_extractions x SET status = 'failed', error = 'stuck' WHERE x.status = 'running' AND x.started_at < now() - make_interval(secs => p_stuck_sec);",
      "WHERE d.review_status = 'pending' AND d.created_at < now() - make_interval(secs => p_wait_sec)",
    ]) {
      expect(was).toContain(part);
      expect(b).toContain(part);
    }
    expect(b).toContain(
      "SELECT d.id, d.company_id, coalesce(lx.status = 'done', false) FROM public.ledger_documents d"
    );
    expect(b).toContain(
      'SELECT x.status, x.attempt, x.schema_version FROM public.ledger_extractions x WHERE x.document_id = d.id ORDER BY x.attempt DESC LIMIT 1) lx ON true'
    );
    expect(b).toContain(
      "AND (lx.status IS NULL OR (lx.status = 'failed' AND lx.attempt < p_max_attempts) OR (lx.status = 'done' AND coalesce(lx.schema_version, 0) < coalesce(p_reread_below, 0) AND lx.attempt < 5))"
    );
    expect(b).toContain(
      "ORDER BY coalesce(lx.status = 'done', false), d.created_at LIMIT p_limit;"
    );
    expect(b).toContain(
      "IF p_reread_below IS NOT NULL AND p_reread_below < 1 THEN RAISE EXCEPTION 'p_reread_below must be >= 1'; END IF;"
    );
  });

  test('권한 — 새 인자 함수는 서버만', () => {
    expect(top).not.toMatch(/GRANT [^;]*\bTO (anon|authenticated|PUBLIC)\b/i);
    for (const fn of [
      'ledger_extract_begin(uuid, integer, boolean, integer)',
      'ledger_extract_due(integer, integer, integer, integer, integer)',
    ]) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
      expect(f).toContain(`COMMENT ON FUNCTION public.${fn} IS`);
    }
  });
});
