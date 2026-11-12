/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, __dirname, process */
/**
 * scripts/rls-probe.mjs 순수 부분 + database/probes/*.json 기대값 파일 모양 (DB 없이).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SCRIPT = pathToFileURL(path.join(ROOT, 'scripts', 'rls-probe.mjs')).href;
const PROBES = path.join(ROOT, 'database', 'probes');

function runEsm(body) {
  const code = `import * as m from ${JSON.stringify(SCRIPT)};
import fs from 'node:fs';
const out = await (async () => { ${body} })();
console.log(JSON.stringify(out));`;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  );
}

describe('rls-probe', () => {
  let r;
  beforeAll(() => {
    const files = fs.readdirSync(PROBES).filter((f) => f.endsWith('.json'));
    r = runEsm(`
      const files = ${JSON.stringify(files)};
      const base = {
        ids: ['row_a'], users: ['user_a'],
        setup: ['insert into t values ({{row_a}})'],
        roles: { anon: { role: 'anon' }, a: { role: 'authenticated', user: 'user_a' } },
        checks: [{ name: 'c', sql: 'select {{row_a}}', expect: { '*': 0 } }],
      };
      const variant = (patch) => m.validateProbe(Object.assign(JSON.parse(JSON.stringify(base)), patch));
      return {
        real: Object.fromEntries(files.map((f) => [f, m.validateProbe(JSON.parse(fs.readFileSync(${JSON.stringify(PROBES)} + '/' + f, 'utf8')))])),
        ok: m.validateProbe(base),
        unknownPlaceholder: variant({ checks: [{ name: 'c', sql: 'select {{nope}}', expect: { '*': 0 } }] }).length,
        unknownRole: variant({ checks: [{ name: 'c', sql: 'select 1', roles: ['ghost'], expect: { '*': 0 } }] }).length,
        missingExpect: variant({ checks: [{ name: 'c', sql: 'select 1', expect: { anon: 0 } }] }).length,
        badRoleKind: variant({ roles: { x: { role: 'postgres' } } }).length,
        authNoUser: variant({ roles: { x: { role: 'authenticated' } } }).length,
        txInSql: variant({ setup: ['commit'] }).length,
        fill: m.fillIds('select {{a}}, {{b}}', { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222' }),
        fillUnknown: (() => { try { m.fillIds('select {{z}}', {}); return 'no error'; } catch (e) { return 'error'; } })(),
        outcomes: [
          m.outcome(null, { code: '42501' }),
          m.outcome(null, { code: '23505' }),
          m.outcome({ command: 'SELECT', rows: [{ count: '3' }] }),
          m.outcome({ command: 'SELECT', rows: [{ v: true }] }),
          m.outcome({ command: 'SELECT', rows: [] }),
          m.outcome({ command: 'INSERT', rowCount: 1 }),
          m.outcome({ command: 'UPDATE', rowCount: 0 }),
          m.outcome([{ command: 'INSERT', rowCount: 1 }, { command: 'DELETE', rowCount: 2 }]),
        ],
        matrix: m.formatMatrix(['anon', 'a'], [
          { name: 'read', cells: { anon: { got: 'deny', want: 'deny', ok: true }, a: { got: '1', want: '0', ok: false } } },
        ]),
      };
    `);
  });

  test('database/probes 의 기대값 파일은 모두 모양이 맞다', () => {
    expect(Object.keys(r.real).length).toBeGreaterThan(0);
    for (const [file, problems] of Object.entries(r.real))
      expect([file, problems]).toEqual([file, []]);
  });

  test('모양 검사: 모르는 자리표시 · 역할 · 빠진 기대값 · 잘못된 role · 계정 없는 authenticated · 트랜잭션 문', () => {
    expect(r.ok).toEqual([]);
    expect(r.unknownPlaceholder).toBe(1);
    expect(r.unknownRole).toBe(1);
    expect(r.missingExpect).toBe(1);
    expect(r.badRoleKind).toBeGreaterThanOrEqual(1);
    expect(r.authNoUser).toBe(1);
    expect(r.txInSql).toBe(1);
  });

  test("자리표시 {{이름}} → 'uuid'::uuid, 모르는 이름은 오류", () => {
    expect(r.fill).toBe(
      "select '11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid"
    );
    expect(r.fillUnknown).toBe('error');
  });

  test('결과 값: 42501 → deny, 다른 오류 → err:코드, SELECT → 첫 칸, INSERT → ok, UPDATE · DELETE → rows:n', () => {
    expect(r.outcomes).toEqual([
      'deny',
      'err:23505',
      '3',
      'true',
      '(없음)',
      'ok',
      'rows:0',
      'rows:2',
    ]);
  });

  test('표: 기대와 다른 칸은 ✗받은값≠기대값', () => {
    const lines = r.matrix.split('\n');
    expect(lines[0]).toMatch(/^시험\s*\| anon\s*\| a/);
    expect(lines[2]).toMatch(/deny/);
    expect(lines[2]).toMatch(/✗1≠0/);
  });
});
