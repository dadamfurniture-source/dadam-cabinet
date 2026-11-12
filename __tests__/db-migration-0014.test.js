/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0014_order_events_one_pending.sql 정적 시험 (DB 없이).
 *
 *   한 수주에 기다리는 요청(pending)은 하나 — 부분 유일 색인 하나만 더한다.
 *   실제로 두 번째 pending 이 막히는지는 database/probes/0003-company-tables.json 의 0014 확인이 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const SQL = fs.readFileSync(path.join(DIR, '0014_order_events_one_pending.sql'), 'utf8').split('\r\n').join('\n');
/** 줄 주석을 뺀 본문 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = CODE.replace(/\s+/g, ' ').trim();

describe('0014 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('색인 하나만 — 표 · 행 · 권한은 건드리지 않는다', () => {
    expect(CODE).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|GRANT|REVOKE|ALTER)\b/i);
    expect(CODE.match(/;/g)).toHaveLength(1);
  });
});

describe('0014 — 기다리는 요청 하나', () => {
  test('수주마다 pending 줄 하나 (부분 유일 색인)', () => {
    expect(flat).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS order_events_one_pending_per_order ON public.order_events USING btree (order_id) WHERE (state = 'pending'::text AND order_id IS NOT NULL);"
    );
  });

  test('0013 의 상태 값 pending 과 같은 글자', () => {
    const base = fs.readFileSync(path.join(DIR, '0013_order_events.sql'), 'utf8');
    expect(base).toContain("'pending'::text");
  });
});
