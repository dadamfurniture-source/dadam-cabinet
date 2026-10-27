#!/usr/bin/env node
// ============================================================
// RLS 역할 표 — 역할마다 읽기 · 쓰기를 시도해 기대값과 견주고 표로 찍는다. 끝은 늘 ROLLBACK.
//
//   한 트랜잭션 안에서:
//     1. --migration 파일들을 주어진 차례로 돌린다 (아직 적용 안 한 마이그레이션을 미리 볼 때)
//     2. 기대값 파일의 users 마다 가짜 auth.users 행을 넣는다 (이메일 probe-<uuid>@example.invalid)
//     3. setup SQL 로 가짜 행을 만든다 (postgres 권한 — RLS 건너뜀)
//     4. checks × roles: SAVEPOINT → SET LOCAL ROLE + request.jwt.claims → SQL → ROLLBACK TO SAVEPOINT
//     5. ROLLBACK — 아무것도 남지 않는다
//
//   결과 값: 오류 42501(권한 없음 · RLS 위반) → deny, 다른 오류 → err:<코드>,
//           SELECT → 첫 행 첫 칸, INSERT → ok, UPDATE · DELETE → rows:<개수>
//
// 기대값 파일 (JSON, database/probes/*.json):
//   ids      가짜 행 id 이름들 — 실행마다 새 uuid. SQL 에서 {{이름}} → 'uuid'::uuid
//   users    가짜 계정 이름들 — auth.users 에 넣는다. {{이름}} 으로도 쓴다
//   setup    가짜 행을 만드는 SQL 목록
//   roles    { 이름: { role: anon | authenticated | service_role, user?: users 의 이름 } } — 열 차례 그대로
//   checks   [{ name, sql, roles?: [역할 이름…], expect: { 역할 이름 | "*": 기대값 } }]
// 시험 SQL 은 가짜 행만 세거나 고친다 — 실제 행을 읽지 않게 쓴다 (값은 첫 칸 하나만 찍힌다).
//
// 쓰는 법:
//   node scripts/rls-probe.mjs --probe database/probes/0003-company-tables.json \
//        [--migration database/migrations/0003_company_tables.sql]…
// 접속값은 scripts/db-connect.mjs 참고. 기대값과 다른 칸이 있으면 exit 1.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db-connect.mjs';
import { forbiddenStatements, normalizeSql } from './db-migrate.mjs';

const ROLE_KINDS = new Set(['anon', 'authenticated', 'service_role']);

// ── 순수 함수 (DB 없이 시험한다) ─────────────────────────────

/** 기대값 파일 모양 검사 → 문제 목록 */
export function validateProbe(probe) {
  const out = [];
  const names = new Set([...(probe.ids || []), ...(probe.users || [])]);
  if ((probe.ids || []).length + (probe.users || []).length !== names.size)
    out.push('ids · users 이름이 겹친다');
  const roles = probe.roles || {};
  if (!Object.keys(roles).length) out.push('roles 가 없다');
  for (const [key, r] of Object.entries(roles)) {
    if (!ROLE_KINDS.has(r.role))
      out.push(`roles.${key}: role 은 anon | authenticated | service_role`);
    if (r.role === 'authenticated' && !(probe.users || []).includes(r.user)) {
      out.push(`roles.${key}: authenticated 는 users 의 계정이 있어야 한다`);
    }
    if (r.role !== 'authenticated' && r.user)
      out.push(`roles.${key}: ${r.role} 에는 user 를 붙이지 않는다`);
  }
  const sqls = [...(probe.setup || []), ...(probe.checks || []).map((c) => c.sql)];
  for (const sql of sqls) {
    for (const m of String(sql).matchAll(/\{\{(\w+)\}\}/g)) {
      if (!names.has(m[1])) out.push(`모르는 자리표시 {{${m[1]}}}: ${String(sql).slice(0, 60)}`);
    }
    for (const bad of forbiddenStatements(`${sql};`))
      out.push(`${bad}: ${String(sql).slice(0, 60)}`);
  }
  const seen = new Set();
  for (const c of probe.checks || []) {
    if (!c.name || !c.sql) out.push('check 에 name · sql 이 있어야 한다');
    if (seen.has(c.name)) out.push(`check 이름이 겹친다: ${c.name}`);
    seen.add(c.name);
    for (const r of c.roles || []) if (!roles[r]) out.push(`${c.name}: 모르는 역할 ${r}`);
    for (const r of Object.keys(c.expect || {})) {
      if (r !== '*' && !roles[r]) out.push(`${c.name}: expect 의 모르는 역할 ${r}`);
    }
    for (const r of c.roles || Object.keys(roles)) {
      if (!(r in (c.expect || {})) && !('*' in (c.expect || {})))
        out.push(`${c.name}: ${r} 의 기대값이 없다`);
    }
  }
  return out;
}

/** {{이름}} → 'uuid'::uuid */
export function fillIds(sql, ids) {
  return String(sql).replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!ids[name]) throw new Error(`모르는 자리표시 {{${name}}}`);
    return `'${ids[name]}'::uuid`;
  });
}

/** pg 결과(또는 오류) → 표에 적을 값 */
export function outcome(result, error) {
  if (error) return error.code === '42501' ? 'deny' : `err:${error.code || '?'}`;
  const r = Array.isArray(result) ? result[result.length - 1] : result;
  if (r.command === 'SELECT') {
    const row = r.rows[0];
    if (!row) return '(없음)';
    const v = Object.values(row)[0];
    return v === null ? 'null' : String(v);
  }
  if (r.command === 'INSERT') return 'ok';
  return `rows:${r.rowCount}`;
}

/** 시험 × 역할 결과를 표로 */
export function formatMatrix(roleKeys, rows) {
  const head = ['시험', ...roleKeys];
  const body = rows.map((row) => [
    row.name,
    ...roleKeys.map((k) => {
      const c = row.cells[k];
      if (!c) return '·';
      return c.ok ? c.got : `✗${c.got}≠${c.want}`;
    }),
  ]);
  const width = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cols) => cols.map((c, i) => c.padEnd(width[i])).join(' | ');
  return [line(head), width.map((w) => '-'.repeat(w)).join('-|-'), ...body.map(line)].join('\n');
}

// ── DB 쪽 ───────────────────────────────────────────────────

async function asRole(client, role, uid) {
  await client.query(`SET LOCAL ROLE ${role.role}`);
  const claims =
    role.role === 'authenticated' ? { sub: uid, role: 'authenticated' } : { role: role.role };
  await client.query(
    `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify(claims), uid || '']
  );
}

export async function runProbe(client, probe, migrationFiles) {
  const ids = {};
  for (const name of [...(probe.ids || []), ...(probe.users || [])])
    ids[name] = crypto.randomUUID();
  const roleKeys = Object.keys(probe.roles);
  const rows = [];
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '60s'`);
    for (const file of migrationFiles) {
      const sql = normalizeSql(fs.readFileSync(file, 'utf8'));
      const bad = forbiddenStatements(sql);
      if (bad.length) throw new Error(`${file}: ${bad.join(' / ')}`);
      await client.query(sql);
    }
    for (const name of probe.users || []) {
      await client.query(
        `insert into auth.users (id, email, aud, role, created_at, updated_at) values ($1, $2, 'authenticated', 'authenticated', now(), now())`,
        [ids[name], `probe-${ids[name]}@example.invalid`]
      );
    }
    for (const sql of probe.setup || []) await client.query(fillIds(sql, ids));
    for (const check of probe.checks) {
      const row = { name: check.name, cells: {} };
      const sql = fillIds(check.sql, ids);
      for (const key of check.roles || roleKeys) {
        const role = probe.roles[key];
        const want = key in check.expect ? check.expect[key] : check.expect['*'];
        await client.query('SAVEPOINT probe');
        let got;
        try {
          await asRole(client, role, role.user ? ids[role.user] : null);
          got = outcome(await client.query(sql));
        } catch (e) {
          got = outcome(null, e);
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT probe');
        }
        row.cells[key] = { got, want: String(want), ok: got === String(want) };
      }
      rows.push(row);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
  return { roleKeys, rows };
}

async function main(argv) {
  const migrations = [];
  let probeFile = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--migration') migrations.push(argv[++i]);
    else if (argv[i] === '--probe') probeFile = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('node scripts/rls-probe.mjs --probe <기대값.json> [--migration <파일.sql>]…');
      return 0;
    } else throw new Error(`모르는 인자: ${argv[i]}`);
  }
  if (!probeFile) throw new Error('--probe <기대값.json> 이 필요하다');
  for (const f of migrations)
    if (!f || !fs.existsSync(f)) throw new Error(`마이그레이션 파일이 없다: ${f}`);
  const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8'));
  const problems = validateProbe(probe);
  if (problems.length) throw new Error(`기대값 파일 문제:\n  ${problems.join('\n  ')}`);

  const client = await connect();
  let result;
  try {
    result = await runProbe(client, probe, migrations);
  } finally {
    await client.end();
  }
  console.log(`${probe.title || probeFile}`);
  if (migrations.length) console.log(`먼저 돌린 파일: ${migrations.join(', ')}`);
  console.log(
    `가짜 계정 ${(probe.users || []).length} · 가짜 행 id ${(probe.ids || []).length} · 끝에 ROLLBACK\n`
  );
  console.log(formatMatrix(result.roleKeys, result.rows));
  const cells = result.rows.flatMap((r) => Object.values(r.cells));
  const bad = cells.filter((c) => !c.ok).length;
  console.log(`\n칸 ${cells.length} · 기대와 다름 ${bad}`);
  return bad ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`실패: ${err.message}`);
      process.exit(1);
    }
  );
}
