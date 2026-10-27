// ============================================================
// DB 접속 공용 — scripts/db-dump-schema.mjs · scripts/db-migrate.mjs 가 쓴다.
//
//   드라이버:  pg — 루트에 없으면 mcp-server/node_modules 에서 싣는다 (`cd mcp-server && npm ci`).
//   접속값:    환경 변수가 먼저, 없으면 mcp-server/.env
//              SUPABASE_URL          프로젝트 주소 (호스트 첫 마디가 프로젝트 ref)
//              SUPABASE_DB_PASSWORD  DB 비밀번호
//              SUPABASE_DB_HOST      (선택) 기본 aws-1-ap-northeast-2.pooler.supabase.com (세션 모드 풀러)
//              SUPABASE_DB_PORT      (선택) 기본 5432
//   사용자:    postgres.<ref>
//
// 비밀번호 · 접속 문자열은 어디에도 찍지 않는다.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOST = 'aws-1-ap-northeast-2.pooler.supabase.com';
const ENV_FILE = path.join(ROOT, 'mcp-server', '.env');

/** KEY=VALUE 줄만 읽는다 (주석 · 빈 줄 건너뜀, 감싼 따옴표 벗김) */
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

export function loadDbConfig() {
  const fileEnv = readEnvFile(ENV_FILE);
  const get = (k) => process.env[k] || fileEnv[k] || '';
  const url = get('SUPABASE_URL');
  const password = get('SUPABASE_DB_PASSWORD');
  if (!url || !password) {
    throw new Error('SUPABASE_URL · SUPABASE_DB_PASSWORD 가 없다 (환경 변수 또는 mcp-server/.env)');
  }
  const ref = new URL(url).hostname.split('.')[0];
  return {
    host: get('SUPABASE_DB_HOST') || DEFAULT_HOST,
    port: Number(get('SUPABASE_DB_PORT') || 5432),
    database: 'postgres',
    user: `postgres.${ref}`,
    password,
    ssl: { rejectUnauthorized: false },
    application_name: 'dadam-db-tools',
  };
}

export function loadPg() {
  for (const base of [
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'mcp-server', 'package.json'),
  ]) {
    try {
      return createRequire(base)('pg');
    } catch {
      // 다음 후보
    }
  }
  throw new Error('pg 패키지를 못 찾았다 — `cd mcp-server && npm ci` 로 설치한다');
}

/** 접속한 pg.Client 를 돌려준다. 끝나면 호출한 쪽이 client.end() */
export async function connect() {
  const pg = loadPg();
  const client = new pg.Client(loadDbConfig());
  await client.connect();
  return client;
}
