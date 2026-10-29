/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0013_order_events.sql 정적 시험 (DB 없이).
 *
 *   order_events: 추가만 — 지우기 · 비우기 권한이 아무에게도 없다. authenticated 는 읽기만.
 *   고칠 수 있는 것은 pending 줄의 결정뿐(가드 트리거).
 *   상태 값은 orders_status_check 와 같은 다섯 가지.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0013 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0013_order_events.sql');
const BASE = read('0000_baseline.sql');
/** 줄 주석을 뺀 본문 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
/** 함수 본문을 뺀 나머지 */
const OUTSIDE = CODE.replace(/\$function\$[\s\S]*?\$function\$/g, '');
const flat = CODE.replace(/\s+/g, ' ');

describe('0013 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(OUTSIDE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('표 · 행을 지우지 않는다', () => {
    expect(OUTSIDE).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?public)\b/i);
    expect(OUTSIDE).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });
});

describe('0013 — 권한', () => {
  test('RLS 를 켜고 authenticated 는 읽기만', () => {
    expect(flat).toContain('ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;');
    expect(flat).toContain(
      'REVOKE ALL ON TABLE public.order_events FROM PUBLIC, anon, authenticated;'
    );
    expect(flat).toContain('GRANT SELECT ON TABLE public.order_events TO authenticated;');
    expect(CODE).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*TO authenticated/i);
  });

  test('service_role 도 지우거나 비우지 못한다', () => {
    expect(flat).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.order_events TO service_role;'
    );
    expect(flat).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.order_events FROM service_role;'
    );
  });

  test('가드 트리거 함수는 아무도 직접 부르지 못한다', () => {
    expect(flat).toContain(
      'REVOKE ALL ON FUNCTION public.order_events_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(flat).toContain(
      'BEFORE UPDATE ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.order_events_guard();'
    );
  });
});

describe('0013 — 기록 규칙', () => {
  test('상태 값은 orders 와 같은 다섯 가지', () => {
    const m = BASE.match(/orders_status_check CHECK \(\(status = ANY \(ARRAY\[([^\]]*)\]\)\)\)/);
    expect(m).not.toBeNull();
    const base = [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]).sort();
    const block = SQL.slice(SQL.indexOf('order_events_status_values_check'));
    const mine = [...block.slice(0, block.indexOf('),\n')).matchAll(/'([a-z_]+)'::text/g)].map(
      (x) => x[1]
    );
    expect([...new Set(mine)].sort()).toEqual(base);
  });

  test('되살리기 · 되돌리기 · 승인 전 작업지시서는 사유 필수', () => {
    expect(flat).toContain("(kind = 'status'::text OR length(btrim(coalesce(reason, ''))) >= 1)");
    expect(flat).toContain("CHECK (kind <> 'revive'::text OR from_status = 'cancelled'::text)");
    expect(flat).toContain("CHECK (kind <> 'revert'::text OR from_status = 'completed'::text)");
  });

  test('같은 업체의 수주 · 설계만 가리킨다', () => {
    expect(flat).toContain('ADD CONSTRAINT orders_id_company_key UNIQUE (id, company_id);');
    expect(flat).toContain(
      'FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT'
    );
    expect(flat).toContain(
      'FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT'
    );
  });
});
