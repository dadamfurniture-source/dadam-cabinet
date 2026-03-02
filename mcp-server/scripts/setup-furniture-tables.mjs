#!/usr/bin/env node
/**
 * Supabase에 furniture_images + lora_models 테이블 생성
 * service_role key로 SQL 실행 (pg_net 또는 직접 REST 호출)
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

// SQL 문을 하나씩 실행하는 RPC wrapper
async function runSql(sql, label) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: sql }),
    });
    if (res.ok) {
      console.log(`OK: ${label}`);
      return true;
    }
    const text = await res.text();
    // 404 means exec_sql function doesn't exist
    if (res.status === 404) return null;
    console.warn(`  WARN (${res.status}): ${label} - ${text.substring(0, 200)}`);
    return false;
  } catch (e) {
    console.error(`  ERR: ${label} - ${e.message}`);
    return false;
  }
}

console.log('=== Setup Furniture Tables ===\n');

// 먼저 exec_sql RPC가 있는지 확인
const test = await runSql('SELECT 1', 'test connection');

if (test === null) {
  console.log('exec_sql RPC not found. Using alternative approach...\n');

  // PostgREST로는 DDL 실행 불가
  // Supabase Dashboard SQL Editor에서 실행해야 함
  // 대신 테이블이 이미 있는지 확인하고, 없으면 안내

  // 테이블 존재 여부 확인
  const checkTable = async (table) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=0`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    return res.ok;
  };

  const hasFurniture = await checkTable('furniture_images');
  const hasLora = await checkTable('lora_models');

  if (hasFurniture && hasLora) {
    console.log('furniture_images: EXISTS');
    console.log('lora_models: EXISTS');
    console.log('\nBoth tables already exist! No action needed.');
    process.exit(0);
  }

  if (!hasFurniture || !hasLora) {
    console.log(`furniture_images: ${hasFurniture ? 'EXISTS' : 'MISSING'}`);
    console.log(`lora_models: ${hasLora ? 'EXISTS' : 'MISSING'}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PostgREST로는 CREATE TABLE 실행 불가.');
    console.log('아래 방법 중 하나로 SQL을 실행해주세요:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n방법 1: Supabase Dashboard SQL Editor');
    console.log(`  → https://supabase.com/dashboard/project/vvqrvgcgnlfpiqqndsve/sql/new`);
    console.log('  → mcp-server/sql/furniture-images.sql 내용을 붙여넣기 후 Run');
    console.log('\n방법 2: Supabase CLI (DB 비밀번호 필요)');
    console.log('  → npx supabase db push --db-url postgresql://postgres:[PASSWORD]@db.vvqrvgcgnlfpiqqndsve.supabase.co:5432/postgres');
    console.log('\n방법 3: 이 스크립트에서 자동 실행 (DB 비밀번호 설정 후)');
    console.log('  → .env에 SUPABASE_DB_PASSWORD=xxx 추가');
    console.log('  → 다시 실행');

    // DB 비밀번호가 있으면 psql로 직접 실행
    const dbPass = process.env.SUPABASE_DB_PASSWORD;
    if (dbPass) {
      console.log('\nDB password found! Executing via connection string...');
      const { execSync } = await import('child_process');
      const connStr = `postgresql://postgres.vvqrvgcgnlfpiqqndsve:${dbPass}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;
      const sqlPath = resolve(__dirname, '../sql/furniture-images.sql');
      try {
        execSync(`npx supabase db execute --db-url "${connStr}" < "${sqlPath}"`, { stdio: 'inherit' });
        console.log('\nSQL executed successfully!');
      } catch (e) {
        console.error('Failed:', e.message);
        console.log('\nTrying with psql...');
        try {
          execSync(`psql "${connStr}" -f "${sqlPath}"`, { stdio: 'inherit' });
          console.log('\nSQL executed successfully!');
        } catch {
          console.error('psql also failed. Please use the Dashboard SQL Editor.');
        }
      }
    }

    process.exit(1);
  }
} else {
  console.log('exec_sql RPC available. Executing SQL statements...\n');
  // 이 경우는 거의 없지만, exec_sql이 있으면 직접 실행
  const { readFileSync } = await import('fs');
  const sql = readFileSync(resolve(__dirname, '../sql/furniture-images.sql'), 'utf-8');

  // 세미콜론으로 분리하여 하나씩 실행
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    const label = stmt.substring(0, 60).replace(/\n/g, ' ');
    await runSql(stmt, label);
  }
}

// 최종 확인
console.log('\n=== Verification ===');
for (const table of ['furniture_images', 'lora_models']) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=0`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  console.log(`${table}: ${res.ok ? 'OK' : 'NOT FOUND (' + res.status + ')'}`);
}
