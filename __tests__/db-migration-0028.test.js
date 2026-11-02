/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0028_ledger_read_scope.sql 정적 시험 (DB 없이).
 *
 *   company_entitled 의 ledger 판정만 바꾼다 — 기본 조건이면 full, 그 업체 장부 줄 · 사진이 있으면 read, 아니면 none.
 *   assistant 판정 · 구성원 확인 · 권한은 0026 그대로.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0028 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const raw = (name) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8')
    .split('\r\n')
    .join('\n');
const code = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();

const S = code(raw('0028_ledger_read_scope.sql'));
const BEFORE = code(raw('0026_assistant_core.sql'));

/** 그 파일의 company_entitled 몸통 ($function$ 안) */
function bodyOf(text) {
  const m =
    /CREATE OR REPLACE FUNCTION public\.company_entitled\([\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(
      text
    );
  return m ? flat(m[1]) : null;
}

describe('0028 장부 보기만 자격', () => {
  test('함수 하나만 바꾼다 — 표 · 칸 · 다른 함수 · 트리거 · 정책 없음, 트랜잭션 문 없음', () => {
    const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      'CREATE OR REPLACE FUNCTION public.company_entitled',
    ]);
    for (const re of [
      /CREATE TABLE/i,
      /ALTER TABLE/i,
      /CREATE TRIGGER/i,
      /CREATE POLICY/i,
      /CREATE INDEX/i,
      /\bINSERT\b/i,
      /\bDROP\b/i,
      /\bBEGIN\b/i,
      /\bCOMMIT\b/i,
    ]) {
      expect(top).not.toMatch(re);
    }
  });

  test('같은 이름 · 인자 · 꼴 (sql · STABLE · search_path 빈 값)', () => {
    const head = flat(
      /CREATE OR REPLACE FUNCTION public\.company_entitled[\s\S]*?AS \$function\$/.exec(S)[0]
    );
    expect(head).toBe(
      "CREATE OR REPLACE FUNCTION public.company_entitled(p_company uuid, p_feature text, p_user uuid DEFAULT NULL::uuid) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $function$"
    );
  });

  test('ledger — 기본 조건 full, 장부 줄 · 사진이 있으면 read, 아니면 none', () => {
    const b = bodyOf(S);
    expect(b).toContain(
      "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT base FROM c) THEN 'full' WHEN EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.company_id = p_company) OR EXISTS (SELECT 1 FROM public.ledger_documents d WHERE d.company_id = p_company) THEN 'read' ELSE 'none' END"
    );
    expect(b).not.toContain("ELSE 'read' END");
  });

  test('ledger 판정 말고는 0026 과 같다 (기본 조건 · 구성원 확인 · assistant)', () => {
    const LEDGER = /WHEN p_feature = 'ledger' THEN CASE .*? END (?=ELSE 'none' END;)/;
    const now = bodyOf(S).replace(LEDGER, '');
    const before = bodyOf(BEFORE).replace(LEDGER, '');
    expect(now).toBe(before);
  });

  test('권한 — service_role 만 부른다 (0026 과 같다)', () => {
    const f = flat(S);
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.company_entitled(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT EXECUTE ON FUNCTION public.company_entitled(uuid, text, uuid) TO service_role;'
    );
  });
});
