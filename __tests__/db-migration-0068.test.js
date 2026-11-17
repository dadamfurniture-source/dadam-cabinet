/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0068_work_sheet_docs.sql 정적 시험 (DB 없이).
 *
 *   작업마다 작업지시서 (2026-11-17 사장님 결정) — 철거 · 납품 지시서를 새로 · 따로 발행하고,
 *   그 지시서의 필수 확인(철거 뒤 사진 · 납품 확인)을 적고, 사무실이 작업마다 지시서 메모를 쓴다.
 *   값은 database/probes/0068-work-sheet-docs.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (sql) =>
  sql
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/^\s*--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
const RAW = read('database', 'migrations', '0068_work_sheet_docs.sql');
const f = strip(RAW);
const wordsIn = (sql) => [...sql.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
const DOC_TYPES =
  "ARRAY['customer_confirmation'::text, 'work_order'::text, 'installation_order'::text, 'demolition_order'::text, 'delivery_order'::text]";
const ROLES =
  "ARRAY['cut'::text, 'edge'::text, 'assembly'::text, 'install'::text, 'demolition'::text, 'delivery'::text]";

describe('0068 — 작업마다 작업지시서 (철거 · 납품 지시서 · 필수 확인 역할 · 지시서 메모)', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기 · 새 표가 없다', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(f).not.toMatch(/CREATE TABLE/i);
  });

  test('문서 종류 — 기준선의 셋 + 철거 · 납품 지시서', () => {
    const base = /design_documents_doc_type_check CHECK \(([^;]+)\);/.exec(
      read('database', 'migrations', '0000_baseline.sql')
    )[1];
    const three = wordsIn(base);
    expect(three).toEqual(['customer_confirmation', 'work_order', 'installation_order']);
    expect(wordsIn(DOC_TYPES)).toEqual([...three, 'demolition_order', 'delivery_order']);
    expect(f).toContain(
      'ALTER TABLE public.design_documents DROP CONSTRAINT IF EXISTS design_documents_doc_type_check;'
    );
    expect(f).toContain(
      `ADD CONSTRAINT design_documents_doc_type_check CHECK (doc_type = ANY (${DOC_TYPES}));`
    );
  });

  test('필수 확인 역할 — 0035 의 넷 + 철거 · 납품', () => {
    const prev = /work_checks_role_check CHECK \(([^)]+\)[^)]*)\)/.exec(
      read('database', 'migrations', '0035_planner_work_checks.sql')
    )[1];
    const four = wordsIn(prev);
    expect(four).toEqual(['cut', 'edge', 'assembly', 'install']);
    expect(wordsIn(ROLES)).toEqual([...four, 'demolition', 'delivery']);
    expect(f).toContain(
      'ALTER TABLE public.work_checks DROP CONSTRAINT IF EXISTS work_checks_role_check;'
    );
    expect(f).toContain(`ADD CONSTRAINT work_checks_role_check CHECK (role = ANY (${ROLES}));`);
  });

  test('서버가 아는 문서 종류 · 필수 확인 역할은 모두 DB 가 받는 것이다', () => {
    const documents = read('workers', 'workflow-api', 'src', 'documents.js');
    const docTypes = [
      .../export const DOC_TYPES = \[([^\]]*)\]/.exec(documents)[1].matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    expect(docTypes.length).toBeGreaterThanOrEqual(3);
    docTypes.forEach((t) => expect(wordsIn(DOC_TYPES)).toContain(t));
    const items = read('workers', 'workflow-api', 'src', 'work', 'check-items.js');
    const roles = [
      .../export const CHECK_ROLES = Object\.freeze\(\[([^\]]*)\]\)/
        .exec(items)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    expect(roles.length).toBeGreaterThanOrEqual(4);
    roles.forEach((r) => expect(wordsIn(ROLES)).toContain(r));
  });

  test('지시서 메모 — work_jobs.sheet_memo, 1 ~ 2000자 · 비울 수 있다 · 작업 설명(detail)은 건드리지 않는다', () => {
    expect(f).toContain('ALTER TABLE public.work_jobs ADD COLUMN IF NOT EXISTS sheet_memo text;');
    expect(f).toContain(
      'ALTER TABLE public.work_jobs DROP CONSTRAINT IF EXISTS work_jobs_sheet_memo_chk;'
    );
    expect(f).toContain(
      'ADD CONSTRAINT work_jobs_sheet_memo_chk CHECK (sheet_memo IS NULL OR ((length(sheet_memo) >= 1) AND (length(sheet_memo) <= 2000)));'
    );
    expect(f).toContain('COMMENT ON COLUMN public.work_jobs.sheet_memo IS');
    expect(f).not.toContain('work_jobs_len_chk');
    expect(f).not.toMatch(/\bdetail\b[^;]*(ALTER|DROP|TYPE)/i);
    // 수락 전에도 보이는 설명과 따로 두는 까닭 · 고객 정보를 넣지 않는다는 말이 적혀 있다
    expect(RAW).toContain('detail 은 수락하기 전(모집 중)의 작업자에게도 보인다');
    expect(RAW).toContain('고객 이름 · 전화 · 주소를 넣지 않는다');
  });

  test('권한 · 정책 · 작업 종류 · 보고서 색인 종류는 건드리지 않는다', () => {
    expect(f).not.toMatch(/\b(GRANT|REVOKE)\b/);
    expect(f).not.toMatch(/\b(CREATE|DROP|ALTER) POLICY\b/);
    expect(f).not.toContain('ROW LEVEL SECURITY');
    expect(f).not.toContain('work_jobs_kind_chk');
    expect(f).not.toContain('work_reports');
    expect(f).not.toContain('design_documents_share_chk');
    expect(f).not.toContain('design_documents_rev_uniq');
    // 바꾸는 표는 셋뿐
    expect([...new Set([...f.matchAll(/ALTER TABLE public\.(\w+)/g)].map((x) => x[1]))].sort()).toEqual([
      'design_documents',
      'work_checks',
      'work_jobs',
    ]);
  });

  test('확인표 — 이 번호의 파일을 가리키고 새 종류 · 새 역할 · 메모 길이 · 서버만을 본다', () => {
    const probe = JSON.parse(read('database', 'probes', '0068-work-sheet-docs.json'));
    expect(probe.title).toContain('0068_work_sheet_docs.sql');
    const names = probe.checks.map((c) => c.name).join('\n');
    for (const word of [
      '철거 지시서',
      '납품 지시서',
      '모르는 문서 종류',
      '필수 확인 역할 — 철거',
      '필수 확인 역할 — 납품',
      '모르는 역할',
      '여전히 서버만',
      '고치지 못한다',
      '지우지 못한다',
      '2000자까지',
      '2001자',
      '빈 글',
      '비우기',
      'RLS',
    ])
      expect(names).toContain(word);
    expect(probe.checks.length).toBeGreaterThanOrEqual(20);
    // 칸은 하나씩 되돌린다 — 한 문장에서 바꾸고 읽지 않는다 (우리 함수 호출도 없다)
    for (const c of probe.checks) {
      expect(c.sql).not.toMatch(/public\.\w+\(/);
      expect(c.sql).not.toMatch(/\breturning\b/i);
      expect(c.sql.split(';').filter((s) => s.trim()).length).toBe(1);
    }
    // 거절 칸은 보려는 제약 하나만 걸리게 — 다른 칸(범위 · 항목 · 판 · 문서 번호)은 받는 모양으로
    const badDoc = probe.checks.find((c) => c.name.startsWith('모르는 문서 종류'));
    expect(badDoc.expect.service_role).toBe('err:23514');
    expect(badDoc.sql).toContain("'as_order', 1, 'probe-n-' || {{doc_n}}::text");
    const badRole = probe.checks.find((c) => c.name.startsWith('모르는 역할'));
    expect(badRole.expect.service_role).toBe('err:23514');
    expect(badRole.sql).toContain("'as', '', 'probe-item', 'v3', true");
    // 새 문서를 넣는 칸은 준비 단계의 작업지시서(rev 1)와 종류가 달라 판 유니크에 걸리지 않는다
    for (const c of probe.checks.filter((x) => x.sql.includes('into public.design_documents')))
      expect(c.sql).not.toContain("'work_order'");
    // 메모가 든 작업은 준비 단계에서 넣어 두고 칸에서는 읽는다
    expect(probe.setup.join('\n')).toContain("{{job_memo}}, 'cutting'");
    expect(probe.setup.join('\n')).toContain("'probe 지시서 메모'");
    // 한 프로젝트에 같은 종류의 살아 있는 작업을 둘 넣지 않는다 (0065 유니크)
    const jobKinds = [...probe.setup.join('\n').matchAll(/\{\{job_\w+\}\}, '([a-z]+)'/g)].map((x) => x[1]);
    expect(new Set(jobKinds).size).toBe(jobKinds.length);
  });
});
