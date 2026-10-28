/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0011_partner_signup.sql 정적 시험 (DB 없이).
 *
 *   형식: 트랜잭션 문 없음, 표 · 칸을 지우지 않음, 새 표는 RLS 를 켜고 anon · authenticated 권한을 먼저 거둔다.
 *   함수: SECURITY DEFINER 는 search_path 를 고정한다. 트리거 함수는 아무도 직접 못 부른다.
 *         my_credit_wallet 은 로그인 · 서버만, 알림 잡기는 서버만.
 *   consume_credit: 업체 통장 길을 더했을 뿐 자기 통장 길은 기준선(0000)과 글자 그대로 같다.
 *   block_self_tier_change: 허용하는 역할은 service_role · postgres(DB 소유자) · 관리자뿐.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0011 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0011_partner_signup.sql');
const BASE = read('0000_baseline.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
/** 함수 본문(plpgsql 의 BEGIN · END 포함)을 뺀 나머지 */
const OUTSIDE = CODE.replace(/\$function\$[\s\S]*?\$function\$/g, '');

/** CREATE OR REPLACE FUNCTION public.<name>( … $function$; 한 덩어리 */
function fnBlock(src, name) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return null;
  const end = src.indexOf('$function$;', start);
  return src.slice(start, end + '$function$;'.length);
}

const NEW_TABLES = ['partner_applications', 'company_credits', 'company_invites'];

describe('0011 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(OUTSIDE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('표 · 칸 · 행을 지우지 않는다', () => {
    expect(CODE).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|VIEW|SCHEMA)\b/i);
    expect(CODE).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE)\b/i);
    expect(OUTSIDE).not.toMatch(/^\s*(UPDATE|INSERT)\b/im);
  });

  test('새 표는 RLS 를 켜고, anon · authenticated 권한을 먼저 거둔 뒤 읽기만 준다', () => {
    for (const t of NEW_TABLES) {
      expect(CODE).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
      expect(CODE).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
    expect(CODE).toContain(
      'REVOKE ALL ON TABLE public.partner_applications, public.company_credits, public.company_invites FROM PUBLIC, anon, authenticated;'
    );
    // authenticated 에 쓰기 권한을 주지 않는다
    expect(CODE).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/i);
  });

  test('초대 토큰 해시 칸은 authenticated 열 권한에 없다', () => {
    const m = CODE.match(
      /GRANT SELECT \(([^)]*)\) ON TABLE public\.company_invites TO authenticated;/
    );
    expect(m).not.toBeNull();
    const cols = m[1].split(',').map((s) => s.trim());
    expect(cols).not.toContain('token_hash');
    expect(cols).toContain('id');
  });
});

describe('0011 — 함수', () => {
  test('SECURITY DEFINER 함수는 search_path 를 고정한다', () => {
    const blocks = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g)].map(
      (m) => m[0]
    );
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const b of blocks.filter((x) => /SECURITY DEFINER/.test(x))) {
      expect(b).toMatch(/SET search_path TO 'public'/);
    }
  });

  test('트리거 함수는 아무도 직접 부르지 못한다', () => {
    for (const f of ['company_tier_sync()', 'company_credits_reset_on_plan()']) {
      expect(CODE).toContain(
        `REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(CODE).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f.replace(/[()]/g, '\\$&')}`)
      );
    }
  });

  test('my_credit_wallet 은 로그인 · 서버만, 알림 잡기는 서버만', () => {
    expect(CODE).toContain(
      'GRANT EXECUTE ON FUNCTION public.my_credit_wallet() TO authenticated, service_role;'
    );
    expect(CODE).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_partner_application_notices(timestamp with time zone, integer) TO service_role;'
    );
    const claim = fnBlock(CODE, 'claim_partner_application_notices');
    expect(claim).not.toMatch(/SECURITY DEFINER/);
    // 이름 · 대표자 · 연락처 · 사업자번호 · 소개는 돌려주지 않는다
    expect(claim).toContain('RETURNING a.created_at, a.kind');
    expect(claim).not.toMatch(
      /company_name|representative_name|contact_phone|business_number|intro/
    );
  });

  test('consume_credit 의 자기 통장 길은 기준선과 같다', () => {
    const mine = fnBlock(SQL, 'consume_credit');
    const base = fnBlock(BASE, 'consume_credit');
    expect(mine && base).toBeTruthy();
    const tail = (s) =>
      s.slice(s.indexOf('  SELECT p.tier INTO v_tier FROM profiles p WHERE p.id = v_user;'));
    expect(tail(base).length).toBeGreaterThan(500);
    expect(tail(mine)).toBe(tail(base));
    // 시그니처 · 돌려주는 모양도 같다 (CREATE OR REPLACE 라 권한 유지)
    const head = (s) => s.slice(0, s.indexOf('AS $function$'));
    expect(head(mine)).toBe(head(base));
  });

  test('refund 함수 시그니처는 기준선과 같다 (권한 유지)', () => {
    for (const name of ['refund_credit', 'refund_credit_svc']) {
      const head = (s) => s.slice(0, s.indexOf('AS $function$'));
      expect(head(fnBlock(SQL, name))).toBe(head(fnBlock(BASE, name)));
    }
  });

  test('block_self_tier_change 는 service_role · postgres · 관리자만 허용한다', () => {
    const b = fnBlock(CODE, 'block_self_tier_change');
    expect(b).toContain(
      "IF current_user NOT IN ('service_role', 'postgres') AND NOT public.is_admin() THEN"
    );
    expect(b).not.toMatch(/SECURITY DEFINER/);
  });
});
