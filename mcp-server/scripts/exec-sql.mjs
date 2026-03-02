#!/usr/bin/env node
/**
 * Supabase DB에 직접 SQL 실행 (pg 패키지 사용)
 * Usage: node scripts/exec-sql.mjs [sql-file-path]
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
  console.error('Missing SUPABASE_DB_PASSWORD in .env');
  process.exit(1);
}

// Direct connection (not pooler) - required for DDL
const connStr = `postgresql://postgres:${dbPassword}@db.vvqrvgcgnlfpiqqndsve.supabase.co:5432/postgres`;
const sqlFile = process.argv[2] || resolve(__dirname, '../sql/furniture-images.sql');
const sql = readFileSync(sqlFile, 'utf-8');

console.log(`=== Executing: ${sqlFile} ===\n`);

const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Connected to Supabase DB\n');

  // pgvector 확장 먼저 활성화
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
  console.log('OK: pgvector extension enabled');

  // 전체 SQL을 한번에 실행 ($$로 감싼 함수 블록 보호)
  await client.query(sql);
  console.log('OK: All SQL statements executed');

  console.log('\n=== Verification ===');
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('furniture_images', 'lora_models')
    ORDER BY table_name
  `);
  for (const row of tables.rows) {
    console.log(`  ${row.table_name}: EXISTS`);
  }
  if (tables.rows.length < 2) {
    console.warn('  WARNING: Not all tables were created!');
  }

} catch (e) {
  console.error('Connection error:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
