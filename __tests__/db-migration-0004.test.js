/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0004_drop_user_profiles.sql 정적 시험 (DB 없이).
 *
 *   지우는 것은 기준선(0000)에 실제로 있는 이름 · 인자여야 한다 — 틀리면 DROP IF EXISTS 가 조용히 지나간다.
 *   CASCADE 없이, 함수 먼저.
 *   저장소의 앱 코드(사이트 · 워커 · mcp-server)는 지우는 이름을 부르지 않는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0004_drop_user_profiles.sql');
const BASE = read('0000_baseline.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const stmts = CODE.split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

describe('0004 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('DROP ... IF EXISTS 세 문장뿐이고 CASCADE 가 없다', () => {
    expect(stmts).toEqual([
      'DROP FUNCTION IF EXISTS public.approve_expert(uuid, uuid)',
      'DROP FUNCTION IF EXISTS public.get_user_role(uuid)',
      'DROP TABLE IF EXISTS public.user_profiles',
    ]);
    expect(CODE).not.toMatch(/\bCASCADE\b/i);
  });
});

describe('0004 — 기준선과 맞는다', () => {
  test('지우는 표 · 함수(인자까지)가 기준선에 있다', () => {
    expect(BASE).toContain('CREATE TABLE public.user_profiles (');
    expect(BASE).toContain(
      'CREATE OR REPLACE FUNCTION public.approve_expert(request_id uuid, admin_id uuid)'
    );
    expect(BASE).toContain('CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)');
  });

  test('기준선에서 user_profiles 를 가리키는 외래 키 · 뷰가 없다', () => {
    expect(BASE).not.toMatch(/REFERENCES public\.user_profiles\b/);
    const views = BASE.split(/;\n/).filter((s) => /^\s*CREATE (OR REPLACE )?VIEW\b/m.test(s));
    expect(views.length).toBeGreaterThan(0);
    expect(views.filter((s) => /\buser_profiles\b/.test(s))).toEqual([]);
  });

  test('기준선에서 user_profiles 를 본문에 쓰는 함수는 지우는 둘뿐이다', () => {
    const fns = [...BASE.matchAll(/CREATE OR REPLACE FUNCTION (\S+?)\(([\s\S]*?)\$function\$;/g)]
      .filter((m) => /\buser_profiles\b/.test(m[2]))
      .map((m) => m[1]);
    expect(fns.sort()).toEqual(['public.approve_expert', 'public.get_user_role']);
  });
});

describe('0004 — 앱 코드가 지우는 이름을 부르지 않는다', () => {
  const SKIP = new Set([
    'node_modules',
    '.git',
    '.claude',
    'database',
    '__tests__',
    'dist',
    'coverage',
  ]);
  const EXT = /\.(js|mjs|cjs|ts|html)$/;
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (
        EXT.test(e.name) &&
        /user_profiles|get_user_role|approve_expert/.test(fs.readFileSync(p, 'utf8'))
      ) {
        hits.push(path.relative(ROOT, p));
      }
    }
  };

  test('사이트 · 워커 · mcp-server 에 user_profiles · get_user_role · approve_expert 가 없다', () => {
    walk(ROOT);
    expect(hits).toEqual([]);
  });
});
