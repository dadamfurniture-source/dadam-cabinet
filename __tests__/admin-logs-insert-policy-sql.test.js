/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/fix-admin-logs-insert-policy.sql 정적 시험 (작업자 포털 1주차 후속 A).
 *
 * stability-triggers.sql 의 "System can insert logs" (WITH CHECK (true)) 는 anon 키로도 admin_logs 에
 * 아무 행이나 넣게 했다. 고침 SQL 은 admin_logs 에 INSERT 하는 함수를 모두 SECURITY DEFINER +
 * search_path = public 으로 고정한 뒤 그 정책을 지운다. 함수 목록은 database/*.sql 을 훑어 정하므로,
 * 나중에 admin_logs 에 쓰는 함수가 새로 생기면 이 시험이 고침 SQL 에 넣으라고 알려 준다.
 *
 * 고침은 한 번 실행으로 끝나지 않는다 — 다른 database/*.sql 을 다시 돌리면 되돌아갈 수 있다. 아래
 * '다른 database/*.sql 이 고침을 되돌리지 않는다' 묶음이 그것을 본다 (알려진 예외는 KNOWN_* 목록).
 */
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'database');
const FIX_NAME = 'fix-admin-logs-insert-policy.sql';
const read = (f) => fs.readFileSync(path.join(DB, f), 'utf8').split('\r\n').join('\n');
const FIX = fs.existsSync(path.join(DB, FIX_NAME)) ? read(FIX_NAME) : '';
/** 줄 주석을 뺀다 — 설명 글에 든 낱말로 시험이 통과하지 않게 */
const stripComments = (sql) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const CODE = stripComments(FIX);

/** 고침 SQL 말고 database/*.sql 전부 */
const sqlFiles = () =>
  fs
    .readdirSync(DB)
    .filter((x) => x.endsWith('.sql') && x !== FIX_NAME)
    .sort();

/**
 * 한 SQL 파일에서 admin_logs 에 INSERT 하는 함수의 CREATE 문.
 * opts = 본문($$…$$) 앞뒤의 함수 설정 글 — SECURITY DEFINER · SET search_path 는 어느 쪽에도 올 수 있다.
 */
function loggingFunctionDefs(file, sql) {
  const defs = [];
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$([^;]*);/gi;
  let m;
  while ((m = re.exec(sql))) {
    if (/INSERT\s+INTO\s+(?:public\.)?admin_logs\b/i.test(m[3])) {
      defs.push({ file, fn: m[1], opts: stripComments(`${m[2]} ${m[4]}`) });
    }
  }
  return defs;
}
const allLoggingDefs = () => sqlFiles().flatMap((f) => loggingFunctionDefs(f, read(f)));

/** database/*.sql 에서 admin_logs 에 INSERT 하는 함수 이름 (고침 SQL 자신은 뺀다) */
function loggingFunctions() {
  return [...new Set(allLoggingDefs().map((d) => d.fn))].sort();
}

/** CREATE 문 자체가 SECURITY DEFINER + search_path = public 을 가진다 (CREATE OR REPLACE 로 다시 돌려도 고정이 남는다) */
const pinned = (d) =>
  /\bSECURITY\s+DEFINER\b/i.test(d.opts) &&
  /\bSET\s+search_path\s*(?:=|TO)\s*'?public\b/i.test(d.opts);

/**
 * admin_logs 에 아무나 INSERT 하게 하는 정책 — INSERT 에 걸리는 정책(FOR INSERT · FOR ALL · FOR 없음)이면서
 * WITH CHECK (true), 또는 WITH CHECK 없이 USING (true) (FOR ALL 은 그때 USING 이 INSERT 검사도 된다).
 * 돌려주는 값: '<파일>: <정책 이름>'
 */
function openInsertPolicies(file, sql) {
  const found = [];
  const code = stripComments(sql);
  const re =
    /CREATE\s+POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?"?admin_logs"?(?=[\s;])([^;]*);/gi;
  let m;
  while ((m = re.exec(code))) {
    const rest = m[2];
    const cmd = (
      (rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i) || [])[1] || 'ALL'
    ).toUpperCase();
    if (cmd !== 'INSERT' && cmd !== 'ALL') continue;
    const TRUE = String.raw`\(\s*\(?\s*true\s*\)?\s*\)`;
    const checkTrue = new RegExp(String.raw`WITH\s+CHECK\s*` + TRUE, 'i').test(rest);
    const usingTrueOnly =
      cmd === 'ALL' &&
      !/WITH\s+CHECK/i.test(rest) &&
      new RegExp(String.raw`USING\s*` + TRUE, 'i').test(rest);
    if (checkTrue || usingTrueOnly) found.push(`${file}: ${m[1]}`);
  }
  return found;
}
const allOpenInsertPolicies = () => sqlFiles().flatMap((f) => openInsertPolicies(f, read(f)));

/**
 * 알려진 예외 (PR #973 리뷰, 2026-10-20) — database/stability-triggers.sql 은 이 PR 이 소유하지 않아 고치지 못했다.
 *  - 9절이 "System can insert logs" (FOR INSERT WITH CHECK (true)) 를 DROP 뒤 다시 만든다.
 *  - 1~5절 다섯 함수는 CREATE OR REPLACE … SECURITY DEFINER 로만 정의하고 search_path 를 두지 않는다.
 * 고침 SQL 을 실행한 뒤 누가 그 파일을 다시 돌리면 (트리거 하나를 고칠 때 등) CREATE OR REPLACE 가 함수 설정
 * (proconfig) 을 새로 써서 search_path 고정이 지워지고, anon 의 아무나 쓰기 정책이 경고 없이 되살아난다.
 * 후속 (stability-triggers.sql 담당 미정 — PR #973 질문): 9절을 지우고 다섯 CREATE 문에 SET search_path = public 을 붙인다.
 * 후속이 머지되면 아래 test.failing 두 건이 '통과해 버렸다' 로 실패한다 — 그때 이 목록을 비우고 .failing 을 뗀다.
 */
const KNOWN_OPEN_POLICIES = ['stability-triggers.sql: "System can insert logs"'];
const KNOWN_UNPINNED_FUNCTIONS = [
  'stability-triggers.sql: handle_consultation_update',
  'stability-triggers.sql: handle_expert_request_approval',
  'stability-triggers.sql: handle_new_consultation',
  'stability-triggers.sql: handle_new_expert_request',
  'stability-triggers.sql: handle_profile_admin_update',
];
const defLabel = (d) => `${d.file}: ${d.fn}`;

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

describe('다른 database/*.sql 이 고침을 되돌리지 않는다', () => {
  test('찾기 도우미: admin_logs 아무나 쓰기 정책을 알아보고, 관리자 정책 · 다른 표 · 주석은 넘긴다', () => {
    const sql = [
      'CREATE POLICY "a" ON admin_logs FOR INSERT WITH CHECK (true);',
      'CREATE POLICY b ON public.admin_logs\n    FOR INSERT TO anon\n    WITH CHECK ( true );',
      'CREATE POLICY "c" ON admin_logs USING (true);',
      'CREATE POLICY "d" ON admin_logs FOR ALL USING ((true));',
      '-- CREATE POLICY "주석" ON admin_logs FOR INSERT WITH CHECK (true);',
      'CREATE POLICY "e" ON admin_logs FOR INSERT WITH CHECK (public.is_admin());',
      'CREATE POLICY "f" ON admin_logs FOR SELECT USING (true);',
      'CREATE POLICY "g" ON admin_logs FOR ALL USING (true) WITH CHECK (public.is_admin());',
      'CREATE POLICY "h" ON admin_logs_archive FOR INSERT WITH CHECK (true);',
      'CREATE POLICY "i" ON consultations FOR INSERT WITH CHECK (true);',
    ].join('\n');
    expect(openInsertPolicies('x.sql', sql)).toEqual([
      'x.sql: "a"',
      'x.sql: b',
      'x.sql: "c"',
      'x.sql: "d"',
    ]);
  });

  test('찾기 도우미: 함수 CREATE 문의 search_path 고정을 본문 앞뒤 어디서든 알아본다', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION public.a() RETURNS trigger AS $$ BEGIN INSERT INTO public.admin_logs (x) VALUES (1); RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;',
      'CREATE FUNCTION b() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$ BEGIN INSERT INTO admin_logs (x) VALUES (1); RETURN NEW; END; $$;',
      'CREATE OR REPLACE FUNCTION public.c() RETURNS trigger AS $$ BEGIN INSERT INTO public.admin_logs (x) VALUES (1); RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER;',
      'CREATE OR REPLACE FUNCTION public.d() RETURNS trigger AS $$ BEGIN INSERT INTO public.admin_logs (x) VALUES (1); RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER -- SET search_path = public\n;',
      'CREATE OR REPLACE FUNCTION public.e() RETURNS trigger AS $$ BEGIN INSERT INTO public.admin_logs (x) VALUES (1); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;',
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void AS $$ BEGIN DELETE FROM admin_logs; END; $$ LANGUAGE plpgsql SECURITY DEFINER;',
    ].join('\n');
    expect(loggingFunctionDefs('x.sql', sql).map((d) => [d.fn, pinned(d)])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
      ['d', false],
      ['e', false],
    ]);
  });

  test('고침 SQL 말고 새 파일이 admin_logs 에 WITH CHECK (true) INSERT 정책을 만들지 않는다 (알려진 예외만 허용)', () => {
    const unknown = allOpenInsertPolicies().filter((x) => !KNOWN_OPEN_POLICIES.includes(x));
    expect(unknown).toEqual([]);
  });

  test('admin_logs 에 쓰는 함수를 새로 만드는 파일은 CREATE 문에 SECURITY DEFINER + SET search_path = public 을 둔다 (알려진 예외만 허용)', () => {
    const unknown = allLoggingDefs()
      .filter((d) => !pinned(d))
      .map(defLabel)
      .filter((x) => !KNOWN_UNPINNED_FUNCTIONS.includes(x));
    expect(unknown).toEqual([]);
  });

  // 알려진 실패 — stability-triggers.sql 9절이 정책을 다시 만든다 (이 PR 소유 아님, 위 KNOWN_* 설명).
  // 9절이 지워지면 이 시험이 '통과해 버렸다' 로 실패한다 → .failing 을 떼고 KNOWN_OPEN_POLICIES 를 비운다.
  test.failing(
    '[알려진 실패: stability-triggers.sql 9절] database/*.sql 중 고침 SQL 말고는 admin_logs 에 WITH CHECK (true) INSERT 정책을 만드는 파일이 없다',
    () => {
      expect(allOpenInsertPolicies()).toEqual([]);
    }
  );

  // 알려진 실패 — stability-triggers.sql 1~5절이 search_path 없이 CREATE OR REPLACE 한다. 다시 돌리면 고침 SQL 의
  // ALTER FUNCTION … SET search_path 가 지워진다. 다섯 CREATE 문에 붙으면 .failing 을 떼고 KNOWN_UNPINNED_FUNCTIONS 를 비운다.
  test.failing(
    '[알려진 실패: stability-triggers.sql 1~5절] admin_logs 에 쓰는 함수의 CREATE 문은 모두 SECURITY DEFINER + SET search_path = public 을 둔다',
    () => {
      expect(
        allLoggingDefs()
          .filter((d) => !pinned(d))
          .map(defLabel)
      ).toEqual([]);
    }
  );

  // 일부만 고쳐졌을 때 (예: 함수 다섯 중 하나) 목록에 낡은 줄이 남지 않게 한다.
  test('알려진 예외 목록이 낡지 않았다 (고쳐진 항목은 목록에서 뺀다)', () => {
    expect(allOpenInsertPolicies()).toEqual(expect.arrayContaining(KNOWN_OPEN_POLICIES));
    expect(
      allLoggingDefs()
        .filter((d) => !pinned(d))
        .map(defLabel)
        .sort()
    ).toEqual(expect.arrayContaining(KNOWN_UNPINNED_FUNCTIONS));
  });
});
