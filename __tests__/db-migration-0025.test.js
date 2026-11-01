/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0025_order_pay_transactions.sql 정적 시험 (DB 없이).
 *
 *   수주 온라인 결제 기록 — payment_transactions (결제창 한 번 = 한 줄, 수금 줄마다 열린 결제 하나, 서버만),
 *   수금 줄 받은 방법에 easy_pay · virtual_account.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0025 확인이 실DB 트랜잭션에서 본다.
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
const S = read('0025_order_pay_transactions.sql');
const f = S.replace(/\s+/g, ' ');

/** CHECK 안의 '이름'::text 들 */
function namesOf(text, constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(
    text.replace(/\s+/g, ' ')
  );
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0025 — 수주 온라인 결제 기록', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    // REVOKE DELETE, TRUNCATE … 는 권한 회수라 뺀다
    const noRevoke = S.replace(/^\s*REVOKE[^;]*;/gim, '');
    expect(noRevoke).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('수금 줄 받은 방법 — 예전 넷 그대로 + 간편결제 · 가상계좌', () => {
    const before = namesOf(read('0000_baseline.sql'), 'order_payments_method_check');
    expect(before).toEqual(['transfer', 'card', 'cash', 'other']);
    expect(f).toContain('DROP CONSTRAINT IF EXISTS order_payments_method_check;');
    expect(namesOf(S, 'order_payments_method_check')).toEqual([
      ...before,
      'easy_pay',
      'virtual_account',
    ]);
  });

  test('결제 기록 — 결제사 · 결제 수단 · 상태 이름', () => {
    expect(namesOf(S, 'payment_transactions_provider_check')).toEqual(['toss']);
    expect(namesOf(S, 'payment_transactions_method_check')).toEqual([
      'card',
      'easy_pay',
      'virtual_account',
      'transfer',
    ]);
    expect(namesOf(S, 'payment_transactions_status_check')).toEqual([
      'ready',
      'waiting_deposit',
      'paid',
      'check_needed',
      'canceled',
      'expired',
      'failed',
    ]);
  });

  test('수금 줄마다 열린 결제(ready · waiting_deposit) 하나 · 결제사 주문 번호 하나 · 서버만, 지우기 없음', () => {
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_one_open ON public.payment_transactions USING btree (payment_id) WHERE (status = ANY (ARRAY['ready'::text, 'waiting_deposit'::text]));"
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_ref_key ON public.payment_transactions USING btree (provider, provider_ref);'
    );
    expect(f).toContain(
      'FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE SET NULL'
    );
    expect(f).toContain('ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.payment_transactions FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_transactions TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.payment_transactions FROM service_role;'
    );
    expect(S).not.toMatch(/CREATE POLICY/i);
  });
});
