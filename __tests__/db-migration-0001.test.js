/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0001_security_fixes.sql 정적 시험 (DB 없이).
 *
 *   design_rules  읽기는 anon · authenticated 에 남기고 (mcp-server RAG 의 quick_trigger_search 가 anon 키로 읽는다),
 *                 쓰기 정책은 authenticated + public.is_admin() 만. anon 권한은 SELECT 만.
 *   user_profiles TO PUBLIC · WITH CHECK (true) 인 "Service role can insert profiles" 를 지운다.
 *   renders       storage 정책의 하위 질의가 objects.name 을 이름까지 붙여 쓴다 (designs.name 으로 풀리지 않게).
 * 지우는 옛 정책 이름은 기준선(0000)에 실제로 있는 이름이어야 한다 — 이름이 틀리면 DROP IF EXISTS 가 조용히 지나간다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0001_security_fixes.sql');
const BASE = read('0000_baseline.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

const unq = (n) => n.replace(/^"|"$/g, '');
/** CREATE POLICY 블록 → { name, table, cmd, roles, body } */
const policies = [
  ...CODE.matchAll(/CREATE POLICY ("[^"]+"|\w+) ON (\S+)\s+FOR (\w+)\s+TO ([^\n]+)\n([\s\S]*?);/g),
].map((m) => ({
  name: unq(m[1]),
  table: m[2],
  cmd: m[3],
  roles: m[4].split(',').map((s) => s.trim()),
  body: m[5].replace(/\s+/g, ' ').trim(),
}));
const drops = [...CODE.matchAll(/DROP POLICY IF EXISTS ("[^"]+"|\w+) ON (\S+);/g)].map((m) => ({
  name: unq(m[1]),
  table: m[2],
  at: m.index,
}));
const on = (table) => policies.filter((p) => p.table === table);

describe('0001 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('CREATE POLICY 마다 앞에 같은 이름의 DROP POLICY IF EXISTS 가 있다 (다시 돌려도 된다)', () => {
    for (const p of policies) {
      const at = CODE.indexOf(
        `CREATE POLICY ${p.name.includes(' ') ? `"${p.name}"` : p.name} ON ${p.table}`
      );
      const d = drops.find((x) => x.name === p.name && x.table === p.table && x.at < at);
      expect([p.table, p.name, Boolean(d)]).toEqual([p.table, p.name, true]);
    }
  });

  test('지우는 옛 정책 이름은 기준선에 있는 이름이다', () => {
    const old = [
      ['public.design_rules', 'Anyone can read'],
      ['public.design_rules', 'Anyone can insert'],
      ['public.design_rules', 'Anyone can update'],
      ['public.design_rules', 'Anyone can delete'],
      ['public.user_profiles', 'Service role can insert profiles'],
      ['storage.objects', 'renders_select_own'],
      ['storage.objects', 'renders_insert_own'],
      ['storage.objects', 'renders_delete_own'],
    ];
    for (const [table, name] of old) {
      const q = name.includes(' ') ? `"${name}"` : name;
      expect([table, name, BASE.includes(`CREATE POLICY ${q} ON ${table}\n`)]).toEqual([
        table,
        name,
        true,
      ]);
      expect([table, name, drops.some((d) => d.table === table && d.name === name)]).toEqual([
        table,
        name,
        true,
      ]);
    }
  });
});

describe('0001 — design_rules', () => {
  const ps = on('public.design_rules');

  test('"Anyone can …" 정책을 다시 만들지 않는다', () => {
    expect(ps.filter((p) => /^Anyone can/.test(p.name))).toEqual([]);
  });

  test('읽기 정책은 남긴다 — anon · authenticated', () => {
    const read = ps.filter((p) => p.cmd === 'SELECT');
    expect(read).toHaveLength(1);
    expect(read[0].roles.sort()).toEqual(['anon', 'authenticated']);
  });

  test('쓰기 정책(INSERT · UPDATE · DELETE)은 authenticated 에만, 조건은 public.is_admin()', () => {
    const write = ps.filter((p) => p.cmd !== 'SELECT');
    expect(write.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const p of write) {
      expect([p.name, p.roles]).toEqual([p.name, ['authenticated']]);
      expect(p.body).not.toMatch(/\(\s*true\s*\)/i);
      if (p.cmd !== 'INSERT') expect(p.body).toMatch(/USING \(public\.is_admin\(\)\)/);
      if (p.cmd !== 'DELETE') expect(p.body).toMatch(/WITH CHECK \(public\.is_admin\(\)\)/);
    }
  });

  test('권한: 모두 거둔 뒤 anon 은 SELECT 만, authenticated 는 SELECT · INSERT · UPDATE · DELETE (TRUNCATE 없음)', () => {
    expect(CODE).toMatch(
      /REVOKE ALL ON TABLE public\.design_rules FROM PUBLIC, anon, authenticated;/
    );
    const grants = [
      ...CODE.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.design_rules TO (\w+);/g),
    ].map((m) => [m[2], m[1]]);
    expect(grants).toEqual([
      ['anon', 'SELECT'],
      ['authenticated', 'SELECT, INSERT, UPDATE, DELETE'],
    ]);
    expect(CODE).not.toMatch(/GRANT ALL ON TABLE public\.design_rules/);
  });
});

describe('0001 — user_profiles', () => {
  test('"Service role can insert profiles" 를 지우고 새 정책은 만들지 않는다', () => {
    expect(
      drops.some(
        (d) => d.table === 'public.user_profiles' && d.name === 'Service role can insert profiles'
      )
    ).toBe(true);
    expect(on('public.user_profiles')).toEqual([]);
  });
});

describe('0001 — storage renders 정책', () => {
  const ps = on('storage.objects');

  test('renders_select_own · insert_own · delete_own 세 개, authenticated 에만', () => {
    expect(ps.map((p) => `${p.name}:${p.cmd}`).sort()).toEqual([
      'renders_delete_own:DELETE',
      'renders_insert_own:INSERT',
      'renders_select_own:SELECT',
    ]);
    for (const p of ps) expect([p.name, p.roles]).toEqual([p.name, ['authenticated']]);
  });

  test('하위 질의는 objects.name 을 이름까지 붙여 쓴다 — 설계 소유자 · 첫 폴더 규칙 그대로', () => {
    for (const p of ps) {
      expect([p.name, p.body.includes("bucket_id = 'renders'")]).toEqual([p.name, true]);
      expect([p.name, p.body.includes('storage.foldername(objects.name))[1]')]).toEqual([
        p.name,
        true,
      ]);
      expect([p.name, /foldername\(\s*name\s*\)/.test(p.body)]).toEqual([p.name, false]);
      expect([p.name, p.body.includes('d.user_id = auth.uid()')]).toEqual([p.name, true]);
      expect([p.name, p.body.includes('FROM public.designs d')]).toEqual([p.name, true]);
    }
  });

  test('renders_select_admin 은 건드리지 않는다', () => {
    expect(CODE).not.toMatch(/renders_select_admin/);
  });
});
