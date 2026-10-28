/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0010_hide_demo_partners.sql 정적 시험 (DB 없이) + 협력업체 화면.
 *
 *   숨기는 이름은 시드 파일(database/partners-seed.sql)의 가상 업체 10곳과 정확히 같다.
 *   UPDATE 한 문장뿐 — 지우지 않고, is_active 만 바꾸고, 회사와 이어진 행은 건드리지 않는다.
 *   partner-recommendation.html 은 partners 를 읽지 않고 가상 목록 · 전화 링크도 없다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lf = (s) => s.split('\r\n').join('\n');
const SQL = lf(
  fs.readFileSync(path.join(ROOT, 'database', 'migrations', '0010_hide_demo_partners.sql'), 'utf8')
);
const SEED = lf(fs.readFileSync(path.join(ROOT, 'database', 'partners-seed.sql'), 'utf8'));
const PAGE = lf(fs.readFileSync(path.join(ROOT, 'partner-recommendation.html'), 'utf8'));
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const stmts = CODE.split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

/** 시드의 업체 이름 — 각 VALUES 묶음 첫 값 */
const seedNames = [...SEED.matchAll(/^\('([^']+)'/gm)].map((m) => m[1]);

describe('0010 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('partners UPDATE 한 문장뿐이고 is_active 만 false 로 바꾼다', () => {
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^UPDATE public\.partners p SET is_active = false WHERE /);
    expect(CODE).not.toMatch(/\b(DELETE|DROP|TRUNCATE|INSERT|ALTER|GRANT|REVOKE|CREATE)\b/i);
  });

  test('회사와 이어진 행은 건드리지 않는다', () => {
    expect(stmts[0]).toContain(
      'AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.partner_id = p.id)'
    );
  });
});

describe('0010 — 시드와 맞는다', () => {
  test('숨기는 이름이 시드 가상 업체 10곳과 같다', () => {
    const m = stmts[0].match(/company_name IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(seedNames).toHaveLength(10);
    expect(names.sort()).toEqual([...seedNames].sort());
  });

  test('공개 읽기 정책은 is_active 행만 보인다 (기준선)', () => {
    const BASE = lf(
      fs.readFileSync(path.join(ROOT, 'database', 'migrations', '0000_baseline.sql'), 'utf8')
    );
    expect(BASE).toContain(
      'CREATE POLICY "Anyone can view active partners" ON public.partners\n    FOR SELECT\n    TO PUBLIC\n    USING ((is_active = true));'
    );
  });
});

describe('협력업체 화면 — 가상 목록을 보이지 않는다', () => {
  test('partners 표를 읽지 않는다', () => {
    expect(PAGE).not.toMatch(/from\(\s*['"]partners['"]\s*\)/);
    expect(PAGE).not.toMatch(/supabase/i);
  });

  test('시드 가상 업체 이름 · 전화 링크가 없다', () => {
    for (const n of seedNames) expect(PAGE).not.toContain(n);
    expect(PAGE).not.toMatch(/href="tel:/);
  });

  test('준비 중 안내와 상담 신청 링크가 있고, 다른 화면으로 되돌려 보내지 않는다', () => {
    expect(PAGE).toContain('협력업체 연결은 준비 중입니다');
    expect(PAGE).toMatch(
      /<a href="consultation\.html" class="btn internal-link" id="consultLink">상담 신청<\/a>/
    );
    expect(PAGE).not.toMatch(/location\.href\s*=/);
  });
});
