/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0030_push_ledger_assistant.sql 정적 시험 (DB 없이).
 *
 *   장부 · AI 비서 앱 알림 — 알림 종류 셋(ledger_pending · ledger_returned · assistant_brief)을 더한다.
 *   모두 업체 알림이라 업체 없이 넣을 수 있는 종류(0023)는 건드리지 않는다.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0030 확인이 실DB 트랜잭션에서 본다.
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
const S = read('0030_push_ledger_assistant.sql');
const f = S.replace(/\s+/g, ' ');
const NEW = ['ledger_pending', 'ledger_returned', 'assistant_brief'];

/** CHECK (kind = ANY (ARRAY[...])) 안의 이름들 */
function kindsOf(text, constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(
    text.replace(/\s+/g, ' ')
  );
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0030 — 장부 · AI 비서 앱 알림', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기 · 권한 바꾸기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
    expect(S).not.toMatch(/\b(GRANT|REVOKE|POLICY)\b/i);
  });

  test('알림 종류 — 0023 열한 가지 그대로 + 장부 · 비서 셋, 지우고 다시 만든다', () => {
    const before = kindsOf(read('0023_work_notifications.sql'), 'notification_outbox_kind_check');
    expect(before).toHaveLength(11);
    expect(f).toContain('DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;');
    expect(kindsOf(S, 'notification_outbox_kind_check')).toEqual([...before, ...NEW]);
  });

  test('업체 없이 넣을 수 있는 종류는 그대로 (0023)', () => {
    expect(f).not.toContain('notification_outbox_company_check');
  });

  test('서버 알림 종류 목록(push/messages.js NOTIFICATION_KINDS)은 이 목록의 앞부분이다', () => {
    const msg = fs.readFileSync(
      path.join(__dirname, '..', 'workers', 'workflow-api', 'src', 'push', 'messages.js'),
      'utf8'
    );
    const block = /NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(msg);
    expect(block).not.toBeNull();
    const names = [...block[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    // 서버가 넣는 종류는 이 목록에 있거나, 뒤 번호(0033 ledger_notice · 0045 as_request)에서 더한 것이다 (db-migration-0033 · 0045 시험이 본다)
    const db = kindsOf(S, 'notification_outbox_kind_check');
    expect(names.filter((k) => !db.includes(k))).toEqual(['ledger_notice', 'as_request']);
  });
});
