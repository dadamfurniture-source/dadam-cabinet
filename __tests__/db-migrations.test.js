/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, __dirname, process */
/**
 * DB 번호 마이그레이션 (database/migrations) 시험 — DB 없이 돈다.
 *
 *   1. 파일 이름: NNNN_이름.sql, 0000_baseline.sql 부터 빈 번호 · 겹치는 번호 없이 하나씩 커진다
 *   2. 기준선 0000_baseline.sql: 있고, 찍은 날 머리말, 비밀값 없음, 행 데이터 없음(버킷 정의만), SQL 모양
 *   3. scripts/db-migrate.mjs 의 순수 부분: 이름 · 순서 · 체크섬 · 대기 계산 · 문장 나누기 · 금지 문장
 *
 * 1 · 2 는 스크립트를 부르지 않고 따로 본다 — 스크립트가 틀려도 이 시험은 잡는다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const BASELINE = path.join(DIR, '0000_baseline.sql');
const SCRIPT = pathToFileURL(path.join(ROOT, 'scripts', 'db-migrate.mjs')).href;
const NAME = /^(\d{4})_[a-z0-9]+(?:[_-][a-z0-9]+)*\.sql$/;

/** 맨 앞 BOM (U+FEFF) */
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

const lf = (s) => s.replace(BOM_RE, '').replace(/\r\n?/g, '\n');

/** db-migrate.mjs 를 ESM 으로 싣고 body 를 돌려 JSON 결과를 받는다 */
function runEsm(body) {
  const code = `import * as m from ${JSON.stringify(SCRIPT)};
const out = await (async () => { ${body} })();
console.log(JSON.stringify(out));`;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

describe('마이그레이션 파일 이름', () => {
  const entries = fs.readdirSync(DIR).sort();
  const sql = entries.filter((f) => f.toLowerCase().endsWith('.sql'));

  test('폴더에는 번호 SQL 과 README.md 만 있다', () => {
    const other = entries.filter((f) => !f.toLowerCase().endsWith('.sql') && f !== 'README.md');
    expect(other).toEqual([]);
  });

  test('이름은 NNNN_소문자이름.sql', () => {
    expect(sql.filter((f) => !NAME.test(f))).toEqual([]);
  });

  test('0000_baseline.sql 부터 빈 번호 · 겹치는 번호 없이 하나씩 커진다', () => {
    const nums = sql.map((f) => Number(f.slice(0, 4)));
    expect(sql[0]).toBe('0000_baseline.sql');
    nums.forEach((n, i) => expect(n).toBe(i));
  });
});

describe('기준선 0000_baseline.sql', () => {
  const text = fs.existsSync(BASELINE) ? lf(fs.readFileSync(BASELINE, 'utf8')) : '';

  test('있고, 찍은 날과 출발점이라는 머리말이 있다', () => {
    // 큰 파일이라 실패해도 본문 전체를 찍지 않게 머리말만 본다
    const head = text.split('\n').slice(0, 20).join('\n');
    expect(text.length).toBeGreaterThan(10000);
    expect(head).toMatch(/^-- .*0000_baseline\.sql/m);
    expect(head).toMatch(/찍은 날: \d{4}-\d{2}-\d{2}/);
    expect(head).toMatch(/출발점/);
  });

  const SECRETS = [
    ['JWT (anon · service_role 키 등)', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ['Supabase 비밀 키', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
    ['service_role 키 값', /service_role[_-]?key\s*[:=]\s*['"][^'"]+['"]/i],
    ['Slack 토큰 · 웹훅', /xox[abposr]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\//],
    ['Toss 키', /\b(?:live|test)_(?:sk|gsk|ck|gck)_[A-Za-z0-9]{10,}/],
    ['Google API 키', /AIza[0-9A-Za-z_-]{35}/],
    ['OpenAI · Anthropic 키', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
    ['AWS 키', /AKIA[0-9A-Z]{16}/],
    ['개인 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['비밀번호가 든 접속 주소', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i],
    ['비밀번호 값', /\b(?:password|passwd|pwd)\s*(?:=|:=|:)\s*'[^']+'/i],
    ['역할 비밀번호', /\bPASSWORD\s+'[^']+'/i],
  ];
  test.each(SECRETS)('비밀값이 없다: %s', (_label, re) => {
    const hits = text.split('\n').flatMap((l, i) => (re.test(l) ? [i + 1] : []));
    expect(hits).toEqual([]);
  });

  test('행 데이터가 없다 — INSERT 는 storage 버킷 정의뿐, COPY 없음', () => {
    const inserts = text.match(/^INSERT INTO \S+/gm) || [];
    expect(inserts.filter((s) => s !== 'INSERT INTO storage.buckets')).toEqual([]);
    expect(/^COPY /m.test(text)).toBe(false);
    expect(/\bsetval\s*\(/i.test(text)).toBe(false);
  });

  test('SQL 모양: ; 로 끝나고, 달러 따옴표가 짝이 맞고, 트랜잭션 문이 없다', () => {
    expect(text.trimEnd().endsWith(';')).toBe(true);
    const tags = {};
    for (const t of text.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || [])
      tags[t] = (tags[t] || 0) + 1;
    for (const [tag, n] of Object.entries(tags)) expect([tag, n % 2]).toEqual([tag, 0]);
    expect(/^(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(text)).toBe(false);
  });

  test('앱 객체가 들어 있다 (테이블 · 함수 · 정책 · 버킷 · auth.users 트리거)', () => {
    const want = {
      table: /^CREATE TABLE public\.\w+ \(/m,
      function: /^CREATE OR REPLACE FUNCTION public\./m,
      policy: /^CREATE POLICY .+ ON public\./m,
      storagePolicy: /^CREATE POLICY .+ ON storage\.objects/m,
      bucket: /^INSERT INTO storage\.buckets/m,
      authTrigger: /^CREATE TRIGGER \w+ .*ON auth\.users .*EXECUTE FUNCTION public\./m,
      rls: /^ALTER TABLE public\.\w+ ENABLE ROW LEVEL SECURITY;/m,
    };
    const missing = Object.entries(want)
      .filter(([, re]) => !re.test(text))
      .map(([k]) => k);
    expect(missing).toEqual([]);
  });
});

describe('scripts/db-migrate.mjs 순수 부분', () => {
  let r;
  beforeAll(() => {
    r = runEsm(`
      const sha = (s) => m.checksum(s);
      const f = (version, name, checksum) => ({ version, name, file: version + '_' + name + '.sql', checksum });
      const files = [f('0000', 'baseline', 'a'), f('0001', 'one', 'b'), f('0002', 'two', 'c'), f('0003', 'three', 'd')];
      const at = '2026-10-27 10:00';
      return {
        parse: ['0001_add_x.sql', '0012_fix-policy_v2.sql', '1_x.sql', '00001_x.sql', '0001-x.sql',
                '0001_X.sql', '0001_.sql', '0001_x.SQL', '0001_x__y.sql', '0001_x.sql.bak']
          .map((n) => m.parseMigrationName(n)),
        namesOk: m.checkMigrationNames(['README.md', '0002_b.sql', '0000_baseline.sql', '0001_a.sql']),
        namesDup: m.checkMigrationNames(['0000_baseline.sql', '0001_a.sql', '0001_b.sql']).problems.length,
        namesGap: m.checkMigrationNames(['0000_baseline.sql', '0002_b.sql']).problems.length,
        namesNoBase: m.checkMigrationNames(['0001_a.sql']).problems.length,
        namesBad: m.checkMigrationNames(['0000_baseline.sql', 'add-x.sql', '0001_A.SQL']).problems.length,
        sumLf: sha('SELECT 1;\\nSELECT 2;\\n'),
        sumCrlf: sha('SELECT 1;\\r\\nSELECT 2;\\r\\n'),
        sumBom: sha('\\uFEFFSELECT 1;\\nSELECT 2;\\n'),
        sumOther: sha('SELECT 1;\\nSELECT 3;\\n'),
        planFresh: m.planMigrations(files, []),
        plan: m.planMigrations(files, [
          { version: '0000', name: 'baseline', checksum: 'a', applied_at: at },
          { version: '0001', name: 'one', checksum: 'b', applied_at: at },
        ]),
        planChanged: m.planMigrations(files, [
          { version: '0000', name: 'baseline', checksum: 'a', applied_at: at },
          { version: '0001', name: 'one', checksum: 'CHANGED', applied_at: at },
        ]),
        planMissing: m.planMigrations(files.slice(0, 2), [
          { version: '0000', name: 'baseline', checksum: 'a', applied_at: at },
          { version: '0001', name: 'one', checksum: 'b', applied_at: at },
          { version: '0002', name: 'gone', checksum: 'x', applied_at: at },
        ]),
        planOutOfOrder: m.planMigrations(files, [
          { version: '0000', name: 'baseline', checksum: 'a', applied_at: at },
          { version: '0002', name: 'two', checksum: 'c', applied_at: at },
        ]),
        split: m.splitSqlStatements([
          '-- 주석 ; 은 무시',
          "CREATE TABLE t (a text DEFAULT ';');",
          '/* 여러 줄 ; 주석 */ CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$',
          'BEGIN RETURN 1; END;',
          '$fn$;',
          "SELECT E'it\\\\'s;', \\"a;b\\";",
          'CREATE FUNCTION g() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END;',
          'DO $$ BEGIN PERFORM 1; END $$;',
        ].join('\\n')),
        splitOpenDollar: m.splitSqlStatements('CREATE FUNCTION f() AS $x$ BEGIN;').errors,
        splitNoSemi: m.splitSqlStatements('SELECT 1;\\nSELECT 2').errors.length,
        forbidden: [
          'BEGIN;\\nCREATE TABLE t (a int);\\nCOMMIT;',
          'START TRANSACTION; SELECT 1;',
          'ROLLBACK;',
          '\\\\i other.sql',
          'DO $$ BEGIN PERFORM 1; END $$;',
          'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN COMMIT; END $$;',
          'ALTER TABLE public.t ADD COLUMN IF NOT EXISTS b text;',
        ].map((s) => m.forbiddenStatements(s).length),
        realDir: (() => {
          const { migrations, problems } = m.loadMigrations();
          return { problems, files: migrations.map((x) => x.file), baselineSum: migrations[0] && migrations[0].checksum };
        })(),
      };
    `);
  });

  test('이름 읽기: NNNN_소문자이름.sql 만', () => {
    expect(r.parse[0]).toEqual({ version: '0001', name: 'add_x', file: '0001_add_x.sql' });
    expect(r.parse[1]).toEqual({
      version: '0012',
      name: 'fix-policy_v2',
      file: '0012_fix-policy_v2.sql',
    });
    expect(r.parse.slice(2)).toEqual([null, null, null, null, null, null, null, null]);
  });

  test('이름 목록: 번호 순으로 세우고 겹침 · 빈 번호 · 기준선 없음 · 형식 틀림을 잡는다', () => {
    expect(r.namesOk.problems).toEqual([]);
    expect(r.namesOk.migrations.map((x) => x.file)).toEqual([
      '0000_baseline.sql',
      '0001_a.sql',
      '0002_b.sql',
    ]);
    expect(r.namesDup).toBe(1);
    expect(r.namesGap).toBe(1);
    expect(r.namesNoBase).toBe(1);
    expect(r.namesBad).toBe(2);
  });

  test('체크섬: sha256, CRLF · BOM 은 같은 값, 내용이 바뀌면 다른 값', () => {
    const want = crypto.createHash('sha256').update('SELECT 1;\nSELECT 2;\n').digest('hex');
    expect(r.sumLf).toBe(want);
    expect(r.sumCrlf).toBe(want);
    expect(r.sumBom).toBe(want);
    expect(r.sumOther).not.toBe(want);
  });

  test('대기 계산: 기록 없으면 전부 대기, 기록만큼 적용됨, 다음은 맨 앞 대기', () => {
    expect(r.planFresh.pending.map((x) => x.version)).toEqual(['0000', '0001', '0002', '0003']);
    expect(r.plan.rows.map((x) => x.state)).toEqual(['applied', 'applied', 'pending', 'pending']);
    expect(r.plan.next.file).toBe('0002_two.sql');
    expect([r.plan.changed, r.plan.missing, r.plan.outOfOrder]).toEqual([[], [], []]);
  });

  test('적용한 뒤 바뀐 파일 · 사라진 파일 · 거꾸로 된 순서를 잡는다', () => {
    expect(r.planChanged.changed.map((x) => x.file)).toEqual(['0001_one.sql']);
    expect(r.planMissing.missing.map((x) => x.version)).toEqual(['0002']);
    expect(r.planOutOfOrder.outOfOrder.map((x) => x.file)).toEqual(['0001_one.sql']);
  });

  test('문장 나누기: 주석 · 문자열 · 달러 따옴표 · BEGIN ATOMIC 안의 ; 는 끝이 아니다', () => {
    expect(r.split.errors).toEqual([]);
    expect(r.split.statements.map((s) => s.text.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'CREATE TABLE',
      'CREATE FUNCTION',
      "SELECT E'',",
      'CREATE FUNCTION',
      'DO $$$$',
    ]);
    expect(r.split.statements.map((s) => s.line)).toEqual([2, 3, 6, 7, 8]);
    expect(r.splitOpenDollar.some((e) => e.includes('달러 따옴표'))).toBe(true);
    expect(r.splitNoSemi).toBe(1);
  });

  test('금지 문장: 트랜잭션 문 · psql 명령은 막고, 함수 · DO 본문 안은 통과', () => {
    expect(r.forbidden).toEqual([2, 1, 1, 2, 0, 0, 0]);
  });

  test('실제 폴더: 이름 문제 없음, 기준선 체크섬은 LF 로 맞춘 sha256', () => {
    expect(r.realDir.problems).toEqual([]);
    expect(r.realDir.files[0]).toBe('0000_baseline.sql');
    const want = crypto
      .createHash('sha256')
      .update(lf(fs.readFileSync(BASELINE, 'utf8')))
      .digest('hex');
    expect(r.realDir.baselineSum).toBe(want);
  });
});
