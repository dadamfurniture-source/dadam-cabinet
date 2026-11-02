/**
 * Supabase — 사용자 확인(/auth/v1/user)과 PostgREST(service_role).
 * 비서 표(assistant_*)는 RLS 를 켜고 정책이 없다 — 이 워커만 서비스 키로 읽고 쓴다 (database/migrations/0026).
 */
import { authError } from './http.js';

export class DbError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export class ConflictError extends DbError {
  constructor(message) {
    super(message, 409);
  }
}

/** Authorization: Bearer → { id, token } (Supabase 가 확인). token 은 읽기 도구가 workflow-api 에 그대로 넘긴다 — 남기지 않는다 */
export async function verifyUser(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) throw authError();
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${m[1]}`,
    },
  });
  if (!res.ok) throw authError('로그인이 끝났습니다. 다시 로그인해 주세요');
  const user = await res.json();
  if (!user || !user.id) throw authError();
  return { id: user.id, token: m[1] };
}

function headers(env, prefer = 'return=representation') {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

async function rest(env, path, init) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    if (text.includes('23505')) throw new ConflictError(`Supabase unique violation: ${text}`);
    throw new DbError(`Supabase ${res.status}: ${text}`, res.status);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('Content-Type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export async function selectMany(env, table, query) {
  return (
    (await rest(env, `/${table}?${new URLSearchParams(query)}`, {
      method: 'GET',
      headers: headers(env),
    })) || []
  );
}

export async function selectOne(env, table, query) {
  const rows = await selectMany(env, table, { ...query, limit: '1' });
  return rows[0] || null;
}

export async function insertOne(env, table, row) {
  const rows = await rest(env, `/${table}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(row),
  });
  return rows && rows[0] ? rows[0] : null;
}

export async function insertMany(env, table, rows) {
  return (
    (await rest(env, `/${table}`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify(rows),
    })) || []
  );
}

/** 조건에 맞는 줄 고치기 — 조건이 비면 던진다 (전체를 고치지 않는다) */
export async function updateWhere(env, table, filter, patch) {
  if (!filter || !Object.keys(filter).length) throw new Error('updateWhere: filter required');
  return (
    (await rest(env, `/${table}?${new URLSearchParams(filter)}`, {
      method: 'PATCH',
      headers: headers(env),
      body: JSON.stringify(patch),
    })) || []
  );
}

export async function callRpc(env, fn, args = {}) {
  return rest(env, `/rpc/${encodeURIComponent(fn)}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(args),
  });
}
