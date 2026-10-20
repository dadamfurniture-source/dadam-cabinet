/**
 * database/fix-admin-logs-insert-policy.sql 정적 시험 (작업자 포털 1주차 후속 A).
 *
 * stability-triggers.sql 의 "System can insert logs" (WITH CHECK (true)) 는 anon 키로도 admin_logs 에
 * 아무 행이나 넣게 했다. 고침 SQL 은 admin_logs 에 INSERT 하는 함수를 모두 SECURITY DEFINER +
 * search_path = public 으로 고정한 뒤 그 정책을 지운다. 함수 목록은 database/*.sql 을 훑어 정하므로,
 * 나중에 admin_logs 에 쓰는 함수가 새로 생기면 이 시험이 고침 SQL 에 넣으라고 알려 준다.
 */
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'database');
const FIX_NAME = 'fix-admin-logs-insert-policy.sql';
const read = (f) => fs.readFileSync(path.join(DB, f), 'utf8').split('\r\n').join('\n');
const FIX = fs.existsSync(path.join(DB, FIX_NAME)) ? read(FIX_NAME) : '';
/** 주석을 뺀 본문 — 설명 글에 든 낱말로 시험이 통과하지 않게 */
const CODE = FIX.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

/** database/*.sql 에서 admin_logs 에 INSERT 하는 함수 이름 (고침 SQL 자신은 뺀다) */
function loggingFunctions() {
  const names = new Set();
  for (const f of fs.readdirSync(DB).filter((x) => x.endsWith('.sql') && x !== FIX_NAME)) {
    const sql = read(f);
    const re =
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$/gi;
    let m;
    while ((m = re.exec(sql))) {
      if (/INSERT\s+INTO\s+(?:public\.)?admin_logs\b/i.test(m[3])) names.add(m[1]);
    }
  }
  return [...names].sort();
}

describe('fix-admin-logs-insert-policy.sql', () => {
  const fns = loggingFunctions();

  test('admin_logs 에 쓰는 함수를 database/*.sql 에서 찾는다 (stability-triggers.sql 다섯 개)', () => {
    expect(fns).toEqual(
      expect.arrayContaining([
        'handle_consultation_update',
        'handle_expert_request_approval',
        'handle_new_consultation',
        'handle_new_expert_request',
        'handle_profile_admin_update',
      ])
    );
  });

  test('한 트랜잭션 (BEGIN … COMMIT)', () => {
    expect(CODE).toMatch(/^\s*BEGIN;/m);
    expect(CODE.trim()).toMatch(/COMMIT;$/);
  });

  test.each(fns)('%s: 있을 때만 SECURITY DEFINER + search_path = public 으로 고정한다', (fn) => {
    const alter = new RegExp(
      `ALTER\\s+FUNCTION\\s+public\\.${fn}\\(\\)\\s+SECURITY\\s+DEFINER\\s+SET\\s+search_path\\s*=\\s*public\\s*;`,
      'i'
    );
    expect(CODE).toMatch(alter);
    // pg_proc 으로 있는지 먼저 본다 — 없는 함수를 ALTER 하면 전체가 실패한다
    const at = CODE.search(alter);
    const before = CODE.slice(0, at);
    const guard = before.lastIndexOf('IF EXISTS');
    expect(guard).toBeGreaterThan(-1);
    const cond = before.slice(guard);
    expect(cond).toMatch(/FROM\s+pg_proc\b/i);
    expect(cond).toMatch(new RegExp(`p\\.proname\\s*=\\s*'${fn}'`));
    expect(cond).toMatch(/n\.nspname\s*=\s*'public'/);
    // 그 IF 와 ALTER 사이에 다른 ALTER 가 끼지 않았다 (자기 함수를 보는 IF 다)
    expect(cond).not.toMatch(/ALTER\s+FUNCTION/i);
  });

  test('ALTER FUNCTION 은 DO 블록 안에만 있다 (함수 본문은 다시 쓰지 않는다)', () => {
    expect(CODE).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    const doStart = CODE.search(/DO\s+\$\$/);
    const doEnd = CODE.indexOf('$$;', doStart);
    expect(doStart).toBeGreaterThan(-1);
    const outside = CODE.slice(0, doStart) + CODE.slice(doEnd);
    expect(outside).not.toMatch(/ALTER\s+FUNCTION/i);
  });

  test('함수를 고친 뒤 "System can insert logs" 를 지운다', () => {
    const drop = CODE.search(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"System can insert logs"\s+ON\s+(public\.)?admin_logs\s*;/i
    );
    expect(drop).toBeGreaterThan(-1);
    const lastAlter = CODE.lastIndexOf('ALTER FUNCTION');
    expect(drop).toBeGreaterThan(lastAlter);
    expect(drop).toBeLessThan(CODE.indexOf('COMMIT;'));
  });

  test('아무나 쓰기 정책을 다시 만들지 않고, 관리자 정책은 건드리지 않는다', () => {
    expect(CODE).not.toMatch(/CREATE\s+POLICY/i);
    expect(CODE).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
    expect(CODE).not.toMatch(/"Admins can insert logs"/);
    expect(CODE).not.toMatch(/"Admins can view logs"/);
  });

  test('멱등: IF EXISTS 로만 지우고, 표·정책을 새로 만들지 않는다', () => {
    const drops = CODE.match(/DROP\s+\w+/gi) || [];
    const dropsIfExists = CODE.match(/DROP\s+\w+\s+IF\s+EXISTS/gi) || [];
    expect(drops.length).toBe(dropsIfExists.length);
    expect(CODE).not.toMatch(/CREATE\s+TABLE/i);
  });
});
