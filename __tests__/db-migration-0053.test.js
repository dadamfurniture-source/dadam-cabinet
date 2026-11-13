/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0053_production_cancelled_notice.sql 정적 시험 (DB 없이).
 *
 *   제작 의뢰 거둠 앱 알림 — 앱 알림 종류에 production_cancelled 를 더한다 (0050 목록 그대로 + 하나).
 *   Manager 가 팩토리 답 기다림 의뢰를 거두면 workflow-api 가 그 팩토리 대표 · 실장에게 넣는다 (production-requests/manager.js).
 *   값은 database/probes/0053-production-cancelled-notice.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const noComments = (text) =>
  text
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const f = noComments(read('database', 'migrations', '0053_production_cancelled_notice.sql'))
  .replace(/\s+/g, ' ')
  .trim();
const statements = f
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

/** CHECK (kind = ANY (ARRAY[...])) 안의 이름들 */
const kindsIn = (text) => {
  const m = /notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(
    text.replace(/\s+/g, ' ')
  );
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
};

describe('0053 — 제작 의뢰 거둠 앱 알림 종류', () => {
  test('문장은 알림 종류 제약을 지우고 다시 거는 둘뿐 — 트랜잭션 문 · 표 · 행 · 권한은 건드리지 않는다', () => {
    expect(statements).toEqual([
      'ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check',
      expect.stringMatching(
        /^ALTER TABLE public\.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[/
      ),
    ]);
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(
      /\b(GRANT|REVOKE|POLICY|DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE|INSERT)\b/i
    );
    // 업체 없이 넣을 수 있는 종류(0023)는 그대로
    expect(f).not.toContain('notification_outbox_company_check');
    // 0052(열린 PR — 시공사례 사진 경로)가 만드는 것을 쓰지 않는다
    expect(f).not.toMatch(/collection|storage\./);
  });

  test('종류 — 0050 목록(19개) 그대로 + production_cancelled', () => {
    const before = kindsIn(
      noComments(read('database', 'migrations', '0050_production_requests.sql'))
    );
    expect(before).toHaveLength(19);
    const kinds = kindsIn(f);
    expect(kinds).toEqual([...before, 'production_cancelled']);
    expect(kinds).toHaveLength(20);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  test('서버가 넣는 종류(workflow-api push/messages.js NOTIFICATION_KINDS)는 이 목록에 있거나 뒤 번호 0064 가 더한 것이다', () => {
    const msg = read('workers', 'workflow-api', 'src', 'push', 'messages.js');
    const names = [
      .../NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/
        .exec(msg)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    expect(names).toContain('production_cancelled');
    // 뒤 번호 0064 가 팩토리용 작업자 알림 셋을 더한다 (db-migration-0064 시험이 본다)
    expect(names.filter((k) => !kindsIn(f).includes(k))).toEqual([
      'work_link_request',
      'work_reply',
      'work_report',
    ]);
    // 거둠 알림은 제작 의뢰를 거두는 곳에서 넣는다
    expect(read('workers', 'workflow-api', 'src', 'production-requests', 'manager.js')).toContain(
      "kind: 'production_cancelled'"
    );
  });

  test('프로브 — 종류 20개, 거둠 넣어짐, 앞 종류 그대로, 모르는 종류 거절', () => {
    const probe = JSON.parse(read('database', 'probes', '0053-production-cancelled-notice.json'));
    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c.expect]));
    expect(byName['앱 알림 종류 — 20개 (0050 의 19개 + production_cancelled)']).toEqual({
      service_role: '20',
    });
    expect(byName['앱 알림 — 제작 의뢰 거둠(production_cancelled) 넣어짐']).toEqual({
      service_role: 'ok',
    });
    expect(byName['앱 알림 — 앞 종류는 그대로 (production_offered)']).toEqual({
      service_role: 'ok',
    });
    expect(byName['앱 알림 — 모르는 종류는 거절']).toEqual({ service_role: 'err:23514' });
    expect(probe.checks.length).toBe(4);
  });
});
