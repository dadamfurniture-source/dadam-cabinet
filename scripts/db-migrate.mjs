#!/usr/bin/env node
// ============================================================
// DB 번호 마이그레이션 — database/migrations/NNNN_이름.sql 을 차례로 적용하고 기록한다.
//
//   기록:   public.schema_migrations (version text PK, name, applied_at, checksum)
//           --baseline-mark 가 처음 만든다 (RLS 켬 · API 역할 권한 없음).
//   체크섬: 파일 내용의 sha256 (BOM 빼고 줄바꿈을 LF 로 맞춰서 — Windows CRLF 와 CI LF 가 같은 값).
//           적용한 뒤 파일이 바뀌면(체크섬이 다르면) 아무것도 돌리지 않고 멈춘다.
//
// 쓰는 법:
//   node scripts/db-migrate.mjs --status                 적용됨 · 대기 · 바뀜 목록 (읽기 전용)
//   node scripts/db-migrate.mjs --dry   <파일>           트랜잭션 안에서 돌려 보고 ROLLBACK, 객체 수 전후 비교
//   node scripts/db-migrate.mjs --apply <파일>           한 트랜잭션으로 적용하고 schema_migrations 에 한 줄 적는다
//   node scripts/db-migrate.mjs --baseline-mark [--dry]  schema_migrations 를 만들고 0000 을 「적용됨」으로만 적는다
//                                                        (0000_baseline.sql 은 돌리지 않는다. 라이브 덤프가 기준선과
//                                                         같을 때만 적는다. --dry 면 같은 일을 하고 ROLLBACK)
//
// 지키는 것:
//   - --apply 는 맨 앞 대기 번호만 받는다 (건너뛰기 · 거꾸로 적용 금지). --dry 는 다른 번호도 되지만 알린다.
//   - 파일 안의 BEGIN · COMMIT · ROLLBACK 같은 트랜잭션 문, psql 역슬래시 명령은 받지 않는다
//     (--dry 의 ROLLBACK 이 무력해지기 때문).
//   - 잠금은 5초까지만 기다린다 (lock_timeout) — 운영 테이블을 오래 막지 않게.
// 접속값은 scripts/db-connect.mjs 참고.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, connect } from './db-connect.mjs';
import { dumpBody, dumpSchema } from './db-dump-schema.mjs';

export const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
export const BASELINE = { version: '0000', name: 'baseline', file: '0000_baseline.sql' };
/** NNNN_이름.sql — 이름은 소문자 · 숫자, 낱말 사이 _ 또는 - */
export const NAME_RE = /^(\d{4})_([a-z0-9]+(?:[_-][a-z0-9]+)*)\.sql$/;
const LOCK_TIMEOUT = '5s';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ── 순수 함수 (DB 없이 시험한다) ─────────────────────────────

/** '0001_add_x.sql' → { version: '0001', name: 'add_x', file } · 형식이 아니면 null */
export function parseMigrationName(file) {
  const m = NAME_RE.exec(file);
  return m ? { version: m[1], name: m[2], file } : null;
}

/** 맨 앞 BOM (U+FEFF) */
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

/** BOM 을 빼고 줄바꿈을 LF 로 */
export function normalizeSql(text) {
  return text.replace(BOM_RE, '').replace(/\r\n?/g, '\n');
}

export function checksum(text) {
  return crypto.createHash('sha256').update(normalizeSql(text), 'utf8').digest('hex');
}

/**
 * 폴더의 파일 이름들 → { migrations: 번호 순, problems: 문제 설명 }
 * .sql 이 아닌 파일(README.md 등)은 건너뛴다.
 */
export function checkMigrationNames(fileNames) {
  const problems = [];
  const migrations = [];
  for (const f of fileNames) {
    if (!f.toLowerCase().endsWith('.sql')) continue;
    const p = parseMigrationName(f);
    if (p) migrations.push(p);
    else problems.push(`이름 형식이 아니다 (NNNN_이름.sql — 소문자 · 숫자 · _ · -): ${f}`);
  }
  migrations.sort((a, b) => cmp(a.version, b.version) || cmp(a.file, b.file));
  for (let i = 1; i < migrations.length; i++) {
    const prev = migrations[i - 1];
    const cur = migrations[i];
    if (cur.version === prev.version) problems.push(`번호가 겹친다: ${prev.file} · ${cur.file}`);
    else if (Number(cur.version) !== Number(prev.version) + 1) {
      problems.push(`번호가 비었다: ${prev.file} 다음이 ${cur.file}`);
    }
  }
  if (!migrations.length || migrations[0].file !== BASELINE.file) {
    problems.push(`${BASELINE.file} 이 맨 앞에 있어야 한다`);
  }
  return { migrations, problems };
}

/**
 * 파일(체크섬 포함)과 schema_migrations 줄을 맞춰 본다.
 * @param files   [{ version, name, file, checksum }] 번호 순
 * @param applied [{ version, name, checksum, applied_at }]
 */
export function planMigrations(files, applied) {
  const byVersion = new Map(applied.map((a) => [a.version, a]));
  const fileVersions = new Set(files.map((f) => f.version));
  const rows = files.map((f) => {
    const a = byVersion.get(f.version);
    if (!a) return { ...f, state: 'pending' };
    if (a.checksum !== f.checksum) {
      return { ...f, state: 'changed', applied_at: a.applied_at, applied_checksum: a.checksum };
    }
    return { ...f, state: 'applied', applied_at: a.applied_at };
  });
  const missing = applied
    .filter((a) => !fileVersions.has(a.version))
    .sort((a, b) => cmp(a.version, b.version))
    .map((a) => ({ version: a.version, name: a.name, state: 'missing', applied_at: a.applied_at }));
  const maxApplied = applied.reduce((m, a) => (a.version > m ? a.version : m), '');
  const pending = rows.filter((r) => r.state === 'pending');
  return {
    rows,
    pending,
    changed: rows.filter((r) => r.state === 'changed'),
    missing,
    outOfOrder: pending.filter((r) => r.version < maxApplied),
    next: pending[0] || null,
  };
}

/** 계획에서 「아무것도 돌리면 안 되는」 이유들 */
export function planBlockers(plan, problems = []) {
  const out = [...problems];
  for (const r of plan.changed) out.push(`적용한 뒤 파일이 바뀌었다 (체크섬 다름): ${r.file}`);
  for (const r of plan.missing)
    out.push(`적용한 기록은 있는데 파일이 없다: ${r.version}_${r.name}.sql`);
  for (const r of plan.outOfOrder)
    out.push(`이미 적용한 번호보다 앞 번호가 대기 중이다: ${r.file}`);
  return out;
}

/**
 * SQL 을 문장으로 나눈다 (주석 빼고, 따옴표 · 달러 따옴표 안은 비운 뼈대로).
 * @returns {{ statements: { text: string, line: number }[], errors: string[] }}
 *   text 는 뼈대 — 낱말 검사용. 마지막 문장이 ; 로 안 끝나면 errors 에 적는다.
 */
export function splitSqlStatements(sql) {
  const s = normalizeSql(sql);
  const n = s.length;
  const statements = [];
  const errors = [];
  let cur = '';
  let line = 1;
  let startLine = 0;
  const mark = () => {
    if (!startLine) startLine = line;
  };
  const push = () => {
    const text = cur.trim();
    if (text) statements.push({ text, line: startLine });
    cur = '';
    startLine = 0;
  };
  let i = 0;
  while (i < n) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (c === '\n') {
      line++;
      cur += c;
      i++;
    } else if (two === '--') {
      while (i < n && s[i] !== '\n') i++;
    } else if (two === '/*') {
      let depth = 0;
      const open = line;
      do {
        if (s.slice(i, i + 2) === '/*') {
          depth++;
          i += 2;
        } else if (s.slice(i, i + 2) === '*/') {
          depth--;
          i += 2;
        } else {
          if (s[i] === '\n') line++;
          i++;
        }
      } while (depth > 0 && i < n);
      if (depth > 0) errors.push(`${open}행: /* 주석이 닫히지 않았다`);
      cur += ' ';
    } else if (c === "'") {
      mark();
      const escapes = /(^|[^A-Za-z0-9_$])[eE]$/.test(cur);
      const open = line;
      i++;
      let closed = false;
      while (i < n) {
        if (s[i] === '\n') line++;
        if (escapes && s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) errors.push(`${open}행: 작은따옴표 문자열이 닫히지 않았다`);
      cur += "''";
    } else if (c === '"') {
      mark();
      const open = line;
      i++;
      let closed = false;
      while (i < n) {
        if (s[i] === '\n') line++;
        if (s[i] === '"') {
          if (s[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) errors.push(`${open}행: 큰따옴표 이름이 닫히지 않았다`);
      cur += '""';
    } else if (
      c === '$' &&
      !/[A-Za-z0-9_$]/.test(s[i - 1] || '') &&
      /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(s.slice(i))
    ) {
      mark();
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i))[0];
      const end = s.indexOf(tag, i + tag.length);
      if (end < 0) {
        errors.push(`${line}행: 달러 따옴표 ${tag} 가 닫히지 않았다`);
        i = n;
      } else {
        for (let k = i; k < end; k++) if (s[k] === '\n') line++;
        i = end + tag.length;
      }
      cur += `${tag}${tag}`;
    } else if (c === ';') {
      // BEGIN ATOMIC … END 본문 안의 ; 는 문장 끝이 아니다
      if (/\bBEGIN\s+ATOMIC\b/i.test(cur) && !/\bEND\s*$/i.test(cur.trimEnd())) {
        cur += c;
        i++;
        continue;
      }
      push();
      i++;
    } else {
      if (!/\s/.test(c)) mark();
      cur += c;
      i++;
    }
  }
  if (cur.trim()) {
    errors.push(`${startLine}행: 마지막 문장이 ; 로 끝나지 않는다`);
    push();
  }
  return { statements, errors };
}

const TX_CONTROL =
  /^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION)\b/i;

/** 마이그레이션 파일에 들어가면 안 되는 문장 (트랜잭션 제어 · psql 명령) → [설명] */
export function forbiddenStatements(sql) {
  const { statements, errors } = splitSqlStatements(sql);
  const out = [...errors];
  for (const st of statements) {
    if (TX_CONTROL.test(st.text))
      out.push(
        `${st.line}행: 트랜잭션 문은 넣지 않는다 (도구가 감싼다): ${st.text.split(/\s+/)[0]}`
      );
    if (st.text.startsWith('\\')) out.push(`${st.line}행: psql 역슬래시 명령은 쓸 수 없다`);
  }
  return out;
}

/** 폴더를 읽어 마이그레이션 목록(체크섬 포함)과 이름 문제를 돌려준다 */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const { migrations, problems } = checkMigrationNames(names);
  for (const m of migrations) {
    m.path = path.join(dir, m.file);
    m.checksum = checksum(fs.readFileSync(m.path, 'utf8'));
  }
  return { migrations, problems };
}

// ── DB 쪽 ───────────────────────────────────────────────────

const COUNTS_SQL = `select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p'))::int as tables,
  (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped)::int as columns,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm'))::int as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not exists (select 1 from pg_depend e
      where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e'))::int as functions,
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
     join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and (n.nspname = 'public' or pn.nspname = 'public'))::int as triggers,
  (select count(*) from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public')::int as indexes,
  (select count(*) from pg_constraint co join pg_namespace n on n.oid = co.connamespace
    where n.nspname = 'public')::int as constraints,
  (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public')::int as policies,
  (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage')::int as storage_policies,
  (select count(*) from storage.buckets)::int as buckets`;

const BOOTSTRAP_SQL = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    checksum text NOT NULL
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.schema_migrations IS 'database/migrations 적용 기록 — scripts/db-migrate.mjs 만 쓴다';`;

async function tableExists(client) {
  const r = await client.query(`select to_regclass('public.schema_migrations') is not null as ok`);
  return r.rows[0].ok;
}

async function readApplied(client) {
  if (!(await tableExists(client))) return null;
  const r = await client.query(
    `select version, name, checksum, to_char(applied_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as applied_at
       from public.schema_migrations order by version`
  );
  return r.rows;
}

async function counts(client) {
  return (await client.query(COUNTS_SQL)).rows[0];
}

function printCounts(before, after) {
  console.log('\n객체 수          전      후    차이');
  for (const k of Object.keys(before)) {
    const d = after[k] - before[k];
    const diff = d === 0 ? '' : d > 0 ? `+${d}` : String(d);
    console.log(
      `  ${k.padEnd(16)}${String(before[k]).padStart(5)}  ${String(after[k]).padStart(5)}  ${diff.padStart(5)}`
    );
  }
}

/** pg 오류를 파일 줄 번호와 함께 */
function describePgError(err, sql) {
  let where = '';
  const pos = Number(err.position);
  if (pos > 0) where = ` (${sql.slice(0, pos - 1).split('\n').length}행 근처)`;
  const extra = [err.detail && `자세히: ${err.detail}`, err.hint && `힌트: ${err.hint}`].filter(
    Boolean
  );
  return [`SQL 오류${where}: ${err.message}`, ...extra].join('\n  ');
}

function resolveTarget(arg, migrations) {
  if (!arg) throw new Error('파일을 적는다: database/migrations/NNNN_이름.sql');
  let abs = path.resolve(arg);
  if (!fs.existsSync(abs) && !arg.includes('/') && !arg.includes('\\'))
    abs = path.join(MIGRATIONS_DIR, arg);
  if (path.dirname(abs) !== MIGRATIONS_DIR)
    throw new Error(`database/migrations/ 안의 파일만 받는다: ${arg}`);
  const m = migrations.find((x) => x.file === path.basename(abs));
  if (!m) throw new Error(`마이그레이션 파일이 아니다 (이름 형식 · 있는지 확인): ${arg}`);
  return m;
}

async function cmdStatus() {
  const { migrations, problems } = loadMigrations();
  const client = await connect();
  let applied;
  try {
    await client.query('BEGIN READ ONLY');
    applied = await readApplied(client);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
  if (applied === null) {
    console.log(
      'schema_migrations 없음 — 아직 기록을 시작하지 않았다 (--baseline-mark, 승인 받고)'
    );
  }
  const plan = planMigrations(migrations, applied || []);
  const label = { applied: '적용됨', pending: '대기', changed: '바뀜!', missing: '파일 없음!' };
  for (const r of [...plan.rows, ...plan.missing].sort((a, b) => cmp(a.version, b.version))) {
    const when = r.applied_at ? ` ${r.applied_at}` : '';
    console.log(`  ${r.version}  ${r.name.padEnd(40)} ${label[r.state]}${when}`);
  }
  const blockers = planBlockers(plan, problems);
  console.log(
    `\n대기 ${plan.pending.length} · 바뀜 ${plan.changed.length} · 파일 없음 ${plan.missing.length}` +
      (plan.next ? ` · 다음: ${plan.next.file}` : '')
  );
  for (const b of blockers) console.log(`문제: ${b}`);
  return blockers.length ? 1 : 0;
}

async function cmdRun(arg, { apply }) {
  const { migrations, problems } = loadMigrations();
  const target = resolveTarget(arg, migrations);
  if (target.version === BASELINE.version) {
    throw new Error('기준선(0000)은 돌리지 않는다 — --baseline-mark 로 기록만 한다');
  }
  const sql = normalizeSql(fs.readFileSync(target.path, 'utf8'));
  const bad = forbiddenStatements(sql);
  if (bad.length) throw new Error(`파일을 받을 수 없다:\n  ${bad.join('\n  ')}`);

  const client = await connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (apply) {
      if (!(await tableExists(client)))
        throw new Error('schema_migrations 가 없다 — --baseline-mark 를 먼저 (승인 받고)');
      await client.query('LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE');
    }
    const applied = (await readApplied(client)) || [];
    const plan = planMigrations(migrations, applied);
    const blockers = planBlockers(plan, problems);
    const row = plan.rows.find((r) => r.version === target.version);
    if (row.state !== 'pending') blockers.push(`이미 적용한 번호다: ${target.file}`);
    if (plan.pending.some((r) => r.version === BASELINE.version)) {
      const msg = `기준선 ${BASELINE.file} 이 아직 기록되지 않았다 (--baseline-mark)`;
      if (apply) blockers.push(msg);
      else console.log(`알림: ${msg}`);
    }
    const next = plan.pending.find((r) => r.version !== BASELINE.version);
    if (next && next.version !== target.version) {
      const msg = `맨 앞 대기 번호는 ${next.file} 이다`;
      if (apply) blockers.push(`${msg} — 차례대로 적용한다`);
      else console.log(`알림: ${msg} (앞 번호가 아직 없는 상태로 돌려 본다)`);
    }
    if (blockers.length) throw new Error(`멈춘다:\n  ${blockers.join('\n  ')}`);

    console.log(
      `${apply ? '적용' : '돌려 보기 (ROLLBACK)'}: ${target.file}  체크섬 ${target.checksum.slice(0, 12)}…`
    );
    const before = await counts(client);
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(describePgError(err, sql));
    }
    if (apply) {
      await client.query(
        'INSERT INTO public.schema_migrations (version, name, applied_at, checksum) VALUES ($1, $2, now(), $3)',
        [target.version, target.name, target.checksum]
      );
    }
    const after = await counts(client);
    printCounts(before, after);
    if (apply) {
      await client.query('COMMIT');
      console.log(`\n적용했다: ${target.file} (schema_migrations 에 기록)`);
    } else {
      await client.query('ROLLBACK');
      console.log('\nROLLBACK 했다 — DB 는 그대로다');
    }
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function cmdBaselineMark({ dry }) {
  const { migrations, problems } = loadMigrations();
  if (problems.length) throw new Error(`멈춘다:\n  ${problems.join('\n  ')}`);
  const base = migrations[0];
  const text = fs.readFileSync(base.path, 'utf8');

  const client = await connect();
  try {
    await client.query('BEGIN READ ONLY');
    const applied = await readApplied(client);
    await client.query('ROLLBACK');
    const mark = applied && applied.find((a) => a.version === BASELINE.version);
    if (mark) {
      if (mark.checksum === base.checksum) {
        console.log(`이미 기록돼 있다: ${base.file} (${mark.applied_at})`);
        return 0;
      }
      throw new Error(`기록된 ${base.file} 의 체크섬이 지금 파일과 다르다 — 파일을 되돌린다`);
    }

    // 라이브가 기준선과 같은지 — 다르면 기준선을 다시 찍는 PR 이 먼저다
    const live = await dumpSchema(client);
    const want = dumpBody(text);
    if (live.body !== want) {
      const a = want.split('\n');
      const b = live.body.split('\n');
      let k = 0;
      while (k < a.length && k < b.length && a[k] === b[k]) k++;
      throw new Error(
        `라이브 스키마가 ${base.file} 와 다르다 (본문 ${k + 1}번째 줄부터) — 기준선을 다시 찍어 PR 로 올린 뒤 기록한다\n` +
          `  기준선: ${a[k] ?? '(끝)'}\n  라이브: ${b[k] ?? '(끝)'}`
      );
    }

    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const before = await counts(client);
    await client.query(BOOTSTRAP_SQL);
    await client.query(
      'INSERT INTO public.schema_migrations (version, name, applied_at, checksum) VALUES ($1, $2, now(), $3)',
      [base.version, base.name, base.checksum]
    );
    const after = await counts(client);
    console.log(
      `${dry ? '돌려 보기 (ROLLBACK)' : '기록'}: ${base.file} 를 적용됨으로 (실행하지 않음)  체크섬 ${base.checksum.slice(0, 12)}…`
    );
    console.log('라이브 스키마 = 기준선 본문 (같음)');
    console.log(
      `\n실행하는 SQL:\n${BOOTSTRAP_SQL}\nINSERT INTO public.schema_migrations … ('${base.version}', '${base.name}', now(), '<체크섬>');`
    );
    printCounts(before, after);
    if (dry) {
      await client.query('ROLLBACK');
      console.log('\nROLLBACK 했다 — DB 는 그대로다');
    } else {
      await client.query('COMMIT');
      console.log('\n기록했다');
    }
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

const USAGE = `node scripts/db-migrate.mjs --status
node scripts/db-migrate.mjs --dry <database/migrations/NNNN_이름.sql>
node scripts/db-migrate.mjs --apply <database/migrations/NNNN_이름.sql>
node scripts/db-migrate.mjs --baseline-mark [--dry]`;

async function main(argv) {
  const has = (f) => argv.includes(f);
  const valueOf = (f) => argv[argv.indexOf(f) + 1];
  if (has('--help') || has('-h')) {
    console.log(USAGE);
    return 0;
  }
  const known = new Set(['--status', '--apply', '--dry', '--baseline-mark']);
  const flags = argv.filter((a) => a.startsWith('-'));
  for (const f of flags) if (!known.has(f)) throw new Error(`모르는 인자: ${f}\n${USAGE}`);
  if (has('--baseline-mark')) {
    if (flags.some((f) => f !== '--baseline-mark' && f !== '--dry'))
      throw new Error(`한 번에 하나만:\n${USAGE}`);
    return cmdBaselineMark({ dry: has('--dry') });
  }
  const actions = ['--status', '--apply', '--dry'].filter(has);
  if (actions.length !== 1) {
    console.log(USAGE);
    return 1;
  }
  if (has('--status')) return cmdStatus();
  if (has('--apply')) return cmdRun(valueOf('--apply'), { apply: true });
  return cmdRun(valueOf('--dry'), { apply: false });
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
