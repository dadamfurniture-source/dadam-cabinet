/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0038_ledger_expert.sql 정적 시험 (DB 없이).
 *
 *   Expert 회계 — 장부 자격(ledger)을 Expert 로 넓히고 사진 AI 읽기 자격(ledger_ai)은 Agent · 시험으로 남긴다.
 *   예산 잡기 · 매분 읽을 사진은 ledger_ai 로 본다. 월 보고 알림(month_report)과 ledger_month_report_scan 을 더한다.
 *   역할별 동작은 database/probes/0038-ledger-expert.json 이 실DB 트랜잭션에서 본다.
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
const S = read('0038_ledger_expert.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));

/** 함수 본문 */
function body(text, name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(
    text
  );
  return m ? m[1] : null;
}

const FUNCTIONS = [
  ['company_entitled', 'uuid, text, uuid'],
  ['assistant_budget_reserve', 'uuid, text, text, bigint, uuid, text'],
  ['ledger_extract_due', 'integer, integer, integer, integer, integer'],
  ['ledger_month_report_scan', 'date'],
];

describe('0038 — Expert 회계 · 월 보고 알림', () => {
  test('트랜잭션 문 · 지우기 · 정책 · 새 표가 없고, 함수 넷만 만든다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE POLICY|CREATE TABLE)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual(
      FUNCTIONS.map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`)
    );
  });

  test('자격 — 0028 본문 + books(Expert · Agent · 시험) 조건 · ledger_ai(옛 기본 조건)', () => {
    const now = body(f, 'company_entitled');
    const was = body(flat(read('0028_ledger_read_scope.sql')), 'company_entitled');
    expect(now).toContain(
      "co.status = 'active' AND ((co.kind = 'partner' AND co.plan IN ('expert', 'agent')) OR coalesce(s.trial, false)) AS books,"
    );
    expect(now).toContain(
      "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT books FROM c) THEN 'full'"
    );
    expect(now).toContain(
      "WHEN p_feature = 'ledger_ai' THEN CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'none' END"
    );
    const back = now
      .replace(
        " co.status = 'active' AND ((co.kind = 'partner' AND co.plan IN ('expert', 'agent')) OR coalesce(s.trial, false)) AS books,",
        ''
      )
      .replace('(SELECT books FROM c)', '(SELECT base FROM c)')
      .replace(
        " WHEN p_feature = 'ledger_ai' THEN CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'none' END",
        ''
      );
    expect(back).toBe(was);
  });

  test('예산 잡기 — 0026 본문에서 사진 읽기 자격만 ledger_ai', () => {
    const now = body(f, 'assistant_budget_reserve');
    const was = body(flat(read('0026_assistant_core.sql')), 'assistant_budget_reserve');
    expect(now).toContain("CASE WHEN p_purpose = 'extract' THEN 'ledger_ai' ELSE 'assistant' END");
    expect(now.replace("THEN 'ledger_ai' ELSE", "THEN 'ledger' ELSE")).toBe(was);
  });

  test('매분 읽을 사진 — 0031 본문 + ledger_ai 업체만', () => {
    const now = body(f, 'ledger_extract_due');
    const was = body(flat(read('0031_ledger_extract_reread.sql')), 'ledger_extract_due');
    const add = " AND public.company_entitled(d.company_id, 'ledger_ai') = 'full'";
    expect(now.split(add).length - 1).toBe(1);
    expect(now.replace(add, '')).toBe(was);
  });

  test('알림 종류에 month_report 를 더한다 (0036 목록 그대로 + 하나, 급함 규칙은 0033 그대로 — 아침 묶음)', () => {
    const m = /CONSTRAINT ledger_notices_kind_check CHECK \((.*?)\)\s*;/.exec(top);
    expect([...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual([
      'duplicate',
      'large_amount',
      'new_supplier',
      'supplier_status',
      'price_change',
      'evidence_risk',
      'statement_mismatch',
      'invoice_missing',
      'month_report',
    ]);
    expect(top).not.toMatch(/ledger_notices_urgency_check/);
  });

  test('월 보고 — 회계 자격 full 업체 · 그 달 장부 줄이 있을 때만, 업체 · 달마다 하나(아침 묶음), 금액 합은 ledger_book', () => {
    const b = body(f, 'ledger_month_report_scan');
    expect(b).toContain("v_from := date_trunc('month', p_month)::date;");
    expect(b).toContain("v_to := (v_from + interval '1 month')::date - 1;");
    expect(b).toContain(
      "WHERE co.status = 'active' AND public.company_entitled(co.id, 'ledger') = 'full'"
    );
    expect(b).toContain('FROM public.ledger_book(c.id, v_from, v_to, false) b) t WHERE t.n > 0');
    expect(b).toContain("SELECT c.id, 'month_report', 'digest',");
    expect(b).toContain("'month:' || to_char(v_from, 'YYYY-MM')");
    expect(b).toContain('ON CONFLICT (company_id, dedupe_key) DO NOTHING;');
  });

  test('함수는 모두 서버만 (REVOKE 넷 · service_role EXECUTE)', () => {
    for (const [n, args] of FUNCTIONS) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${n}(${args}) FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${n}(${args}) TO service_role;`);
    }
    expect(f).not.toMatch(/TO (anon|authenticated)\b/);
  });

  test('프로브 협력업체는 등급이 expert · agent (companies_partner_plan_check · companies_plan_check)', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0038-ledger-expert.json'),
        'utf8'
      )
    );
    const rows = probe.setup
      .join('\n')
      .matchAll(/\(\{\{(company_\w+)\}\}, '(\w+)', '[^']*', ([^,]+), '(\w+)'\)/g);
    const companies = [...rows].map(([, id, kind, plan, status]) => [id, kind, plan, status]);
    expect(companies).toEqual([
      ['company_e', 'partner', "'expert'", 'active'],
      ['company_a', 'partner', "'agent'", 'active'],
      ['company_n', 'partner', "'expert'", 'suspended'],
      ['company_t', 'partner', "'expert'", 'active'],
    ]);
  });

  test('프로브 사진의 sha256 은 16진수 64자 (ledger_documents_sha_check)', () => {
    const probe = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'probes', '0038-ledger-expert.json'),
      'utf8'
    );
    const shas = [...probe.matchAll(/repeat\('(.)', (\d+)\)/g)];
    expect(shas.length).toBe(2);
    for (const [, ch, n] of shas) {
      expect(ch).toMatch(/^[0-9a-f]$/);
      expect(n).toBe('64');
    }
  });
});
