/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0039_ledger_book_biz_no.sql 정적 시험 (DB 없이).
 *
 *   ledger_book(0027) 맨 끝에 거래처 사업자번호 칸 — 장부 줄은 적은 번호 · 원가는 고른 거래처 번호 · 수금은 없음.
 *   ledger_summary(0034) 지출 상대 상위 5 → 10.
 *   역할별 동작은 database/probes/0039-ledger-book-biz-no.json 이 실DB 트랜잭션에서 본다.
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
const S = read('0039_ledger_book_biz_no.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));

/** 함수 머리부터 본문 끝까지 */
function whole(text, name) {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(.*?\\$function\\$.*?\\$function\\$`
  ).exec(text);
  return m ? m[0] : null;
}

const FUNCTIONS = [
  ['ledger_book', 'uuid, date, date, boolean'],
  ['ledger_summary', 'uuid, date, date'],
];

describe('0039 — 장부 줄 사업자번호 · 지출 상대 10곳', () => {
  test('트랜잭션 문 · 표 지우기 · 정책 · 새 표 · 행 바꾸기가 없고, ledger_book 하나만 지우고 함수 둘을 만든다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE|CREATE POLICY|CREATE TABLE|ALTER TABLE)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/DROP FUNCTION [^;]*;/g)).toEqual([
      'DROP FUNCTION IF EXISTS public.ledger_book(uuid, date, date, boolean);',
    ]);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual(
      FUNCTIONS.map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`)
    );
    expect(top.indexOf('DROP FUNCTION')).toBeLessThan(
      top.indexOf('CREATE OR REPLACE FUNCTION public.ledger_book')
    );
  });

  test('ledger_book — 0027 본문 + 맨 끝 칸 하나 (장부 줄 · 수금 · 원가)', () => {
    const now = whole(f, 'ledger_book');
    const was = whole(flat(read('0027_ledger_core.sql')), 'ledger_book');
    const adds = [
      [
        ' voided_at timestamp with time zone, counterparty_biz_no text)',
        ' voided_at timestamp with time zone)',
      ],
      [
        ' NULL::uuid, NULL::text, e.voided_at, e.counterparty_biz_no FROM',
        ' NULL::uuid, NULL::text, e.voided_at FROM',
      ],
      [
        ' p.order_id, o.order_no, NULL::timestamp with time zone, NULL::text FROM',
        ' p.order_id, o.order_no, NULL::timestamp with time zone FROM',
      ],
      [
        ' c.order_id, o.order_no, NULL::timestamp with time zone, cp.biz_no FROM',
        ' c.order_id, o.order_no, NULL::timestamp with time zone FROM',
      ],
    ];
    let back = now;
    for (const [a, b] of adds) {
      expect(back.split(a).length - 1).toBe(1);
      back = back.replace(a, b);
    }
    expect(back).toBe(was);
  });

  test('ledger_summary — 0034 본문에서 상대 수만 10', () => {
    const now = whole(f, 'ledger_summary');
    const was = whole(flat(read('0034_ledger_summary.sql')), 'ledger_summary');
    expect(now).toContain('c_top constant integer := 10;');
    expect(now.replace('c_top constant integer := 10;', 'c_top constant integer := 5;')).toBe(was);
  });

  test('함수는 모두 서버만 (REVOKE 둘 · service_role EXECUTE)', () => {
    for (const [n, args] of FUNCTIONS) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${n}(${args}) FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${n}(${args}) TO service_role;`);
    }
    expect(f).not.toMatch(/TO (anon|authenticated)\b/);
  });

  test('프로브 협력업체는 등급이 있다 (companies_partner_plan_check)', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0039-ledger-book-biz-no.json'),
        'utf8'
      )
    );
    const rows = probe.setup
      .join('\n')
      .matchAll(/\(\{\{(company_\w+)\}\}, '(\w+)', '[^']*', ([^,]+), '(\w+)'\)/g);
    expect([...rows].map(([, id, kind, plan, status]) => [id, kind, plan, status])).toEqual([
      ['company_x', 'partner', "'expert'", 'active'],
    ]);
  });
});
