/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0005_hq_customers.sql 정적 시험 (DB 없이).
 *
 *   새 계정마다 본사 고객 행 — auth.users AFTER INSERT 트리거, 함수는 API 역할이 직접 못 부른다.
 *   지금 계정 채우기 — 본사(kind = 'hq')만, company_id · user_id 만 (이름 · 연락처는 베끼지 않는다).
 *   ON CONFLICT 대상은 0003 의 부분 유니크 인덱스와 같아야 한다 — 다르면 첫 실행부터 오류가 난다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0005_hq_customers.sql');
const T0003 = read('0003_company_tables.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = CODE.replace(/\s+/g, ' ');

describe('0005 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    // 함수 본문($function$ … $function$)의 BEGIN · END 는 빼고 본다
    const outside = CODE.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(outside).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('트리거는 DROP IF EXISTS 다음에 만든다 (다시 돌려도 된다)', () => {
    const drop = flat.indexOf(
      'DROP TRIGGER IF EXISTS on_auth_user_created_hq_customer ON auth.users;'
    );
    const create = flat.indexOf(
      'CREATE TRIGGER on_auth_user_created_hq_customer AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.add_hq_customer();'
    );
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });
});

describe('0005 — 함수', () => {
  test('SECURITY DEFINER · search_path 고정 · 트리거 함수', () => {
    expect(flat).toMatch(
      /CREATE OR REPLACE FUNCTION public\.add_hq_customer\(\) RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'/
    );
  });

  test('PUBLIC · anon · authenticated · service_role 에서 거두고 Auth 역할에만 연다', () => {
    expect(flat).toContain(
      'REVOKE ALL ON FUNCTION public.add_hq_customer() FROM PUBLIC, anon, authenticated, service_role;'
    );
    const grants = [
      ...flat.matchAll(/GRANT EXECUTE ON FUNCTION public\.add_hq_customer\(\) TO ([^;]+);/g),
    ];
    expect(grants.map((m) => m[1].trim())).toEqual(['supabase_auth_admin']);
  });
});

describe('0005 — 고객 행', () => {
  const inserts = [...flat.matchAll(/INSERT INTO public\.customers \(([^)]*)\)([^;]*);/g)];

  test('넣는 곳은 둘 (트리거 · 채우기), 칸은 company_id · user_id 뿐', () => {
    expect(inserts).toHaveLength(2);
    for (const m of inserts) expect(m[1].replace(/\s/g, '')).toBe('company_id,user_id');
  });

  test('둘 다 본사만 고른다', () => {
    for (const m of inserts) expect(m[2]).toMatch(/WHERE c\.kind = 'hq'/);
  });

  test('ON CONFLICT 대상이 0003 의 부분 유니크 인덱스와 같다', () => {
    expect(T0003.replace(/\s+/g, ' ')).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS customers_company_user ON public.customers USING btree (company_id, user_id) WHERE (user_id IS NOT NULL);'
    );
    for (const m of inserts) {
      expect(m[2]).toContain(
        'ON CONFLICT (company_id, user_id) WHERE (user_id IS NOT NULL) DO NOTHING'
      );
    }
  });
});
