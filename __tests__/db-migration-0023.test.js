/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0023_work_notifications.sql 정적 시험 (DB 없이).
 *
 *   작업자 앱 알림 — 알림 종류 넷(work_invited · work_registration · work_assigned · work_schedule)을 더하고,
 *   업체 없이 넣을 수 있는 종류에도 더한다 (업체 신청과 같다).
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0023 확인이 실DB 트랜잭션에서 본다.
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
const S = read('0023_work_notifications.sql');
const f = S.replace(/\s+/g, ' ');
const WORK = ['work_invited', 'work_registration', 'work_assigned', 'work_schedule'];

/** CHECK (kind = ANY (ARRAY[...])) 안의 이름들 */
function kindsOf(text, constraint) {
  // 0016 은 CREATE TABLE 안(… ,), 0023 은 ALTER TABLE … ADD CONSTRAINT (… ;)
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(text.replace(/\s+/g, ' '));
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0023 — 작업자 앱 알림', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기 · 권한 바꾸기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    expect(S).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
    expect(S).not.toMatch(/\b(GRANT|REVOKE|POLICY)\b/i);
  });

  test('알림 종류 — 0016 일곱 가지 그대로 + 작업자 넷, 지우고 다시 만든다', () => {
    const before = kindsOf(read('0016_app_notifications.sql'), 'notification_outbox_kind_check');
    expect(before).toHaveLength(7);
    expect(f).toContain('DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;');
    expect(kindsOf(S, 'notification_outbox_kind_check')).toEqual([...before, ...WORK]);
  });

  test('업체 없이 넣을 수 있는 종류 — 업체 신청 + 작업자 넷 (그 밖은 업체가 있어야)', () => {
    expect(f).toContain('DROP CONSTRAINT IF EXISTS notification_outbox_company_check;');
    expect(f).toContain('ADD CONSTRAINT notification_outbox_company_check CHECK (company_id IS NOT NULL OR kind = ANY (');
    expect(kindsOf(S, 'notification_outbox_company_check')).toEqual(['partner_application', ...WORK]);
  });

  test('서버 알림 종류 목록(push/messages.js NOTIFICATION_KINDS)과 같다', () => {
    const msg = fs.readFileSync(
      path.join(__dirname, '..', 'workers', 'workflow-api', 'src', 'push', 'messages.js'),
      'utf8'
    );
    const block = /NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(msg);
    expect(block).not.toBeNull();
    const names = [...block[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    // 서버가 먼저 바뀌기 전(이 DB 변경만 들어간 때)에는 서버 목록이 0016 그대로다
    const db = kindsOf(S, 'notification_outbox_kind_check');
    expect(db.slice(0, names.length)).toEqual(names);
  });
});
