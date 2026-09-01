#!/usr/bin/env node
/**
 * Supabase DB에 SQL 파일 실행
 *
 * Usage: node scripts/exec-sql.mjs <sql-file-path>
 *   예:  node scripts/exec-sql.mjs ../database/collection-schema.sql
 *
 * 접속:
 *   예전엔 db.<ref>.supabase.co 직결을 썼는데 그 호스트는 이제 DNS 자체가 없다
 *   (ENOTFOUND). 풀러를 쓰되 **5432(세션 모드)** 여야 한다 — 6543(트랜잭션 모드)은
 *   DDL·다중문 트랜잭션에 맞지 않는다.
 *   리전 접두사도 aws-0 이 아니라 aws-1 이다 (aws-0 은 'tenant not found').
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
if (!dbPassword) {
  console.error('Missing SUPABASE_DB_PASSWORD in mcp-server/.env');
  process.exit(1);
}

const PROJECT_REF = 'vvqrvgcgnlfpiqqndsve';
const connStr =
  `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(dbPassword)}` +
  `@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`;

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node scripts/exec-sql.mjs <sql-file-path>');
  process.exit(1);
}
const sql = readFileSync(sqlFile, 'utf-8');

console.log(`=== Executing: ${sqlFile} ===\n`);

const client = new pg.Client({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  await client.connect();
  console.log('Connected to Supabase DB (pooler, session mode)\n');

  // pgvector — 벡터 컬럼을 쓰는 파일만 필요하다.
  // 권한이 없거나 이미 있으면 그냥 넘어간다. 여기서 죽으면 안 된다.
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
  } catch (e) {
    console.log(`  (pgvector 건너뜀: ${e.message})`);
  }

  // 통째로 한 트랜잭션. 중간에 실패하면 절반만 적용된 스키마가 남지 않는다.
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('OK: applied in a single transaction');

  // 검증 — 파일이 만든다고 선언한 테이블이 실제로 있는지 본다.
  // 예전엔 furniture 테이블 두 개를 하드코딩했었다. 파일에서 뽑아 쓴다.
  const declared = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_.]+)/gi)].map((m) =>
    m[1].replace(/^public\./, '')
  );
  if (declared.length) {
    console.log('\n=== Verification ===');
    const found = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [declared]
    );
    const names = found.rows.map((r) => r.table_name);
    for (const t of declared) console.log(`  ${t}: ${names.includes(t) ? 'EXISTS' : 'MISSING'}`);
    if (names.length < declared.length) {
      console.warn('  WARNING: 선언된 테이블이 전부 만들어지지 않았다');
      process.exitCode = 1;
    }
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED:', e.message);
  if (e.detail) console.error('  detail:', e.detail);
  process.exit(1);
} finally {
  await client.end();
}
