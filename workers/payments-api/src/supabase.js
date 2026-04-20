/**
 * Supabase REST/Auth 헬퍼 (Edge Workers 용).
 *
 * - 사용자 JWT 검증: GET /auth/v1/user 호출 → 200 이면 인증 성공
 * - DB CRUD: PostgREST API + service_role key
 */

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

export class DbError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Authorization 헤더에서 Bearer 토큰 추출 후 Supabase 에 검증 요청. */
export async function verifyJwt(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError('Missing Bearer token');

  const token = match[1];
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new AuthError('Invalid token');
  const user = await res.json();
  if (!user || !user.id) throw new AuthError('Invalid user');

  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || null,
  };
}

function restHeaders(env, prefer = 'return=representation') {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

async function restRequest(env, path, init) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new DbError(`Supabase ${res.status}: ${text}`, res.status);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) return null;
  return res.json();
}

export async function selectOne(env, table, query) {
  const qs = new URLSearchParams({ ...query, limit: '1' }).toString();
  const rows = await restRequest(env, `/${table}?${qs}`, {
    method: 'GET',
    headers: restHeaders(env),
  });
  return rows && rows.length ? rows[0] : null;
}

export async function selectMany(env, table, query) {
  const qs = new URLSearchParams(query).toString();
  return restRequest(env, `/${table}?${qs}`, {
    method: 'GET',
    headers: restHeaders(env),
  });
}

export async function insertOne(env, table, row) {
  const rows = await restRequest(env, `/${table}`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify(row),
  });
  return rows && rows.length ? rows[0] : null;
}

export async function updateById(env, table, id, patch) {
  const rows = await restRequest(env, `/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: restHeaders(env),
    body: JSON.stringify(patch),
  });
  return rows && rows.length ? rows[0] : null;
}

export async function updateBy(env, table, filter, patch) {
  const qs = new URLSearchParams(filter).toString();
  return restRequest(env, `/${table}?${qs}`, {
    method: 'PATCH',
    headers: restHeaders(env),
    body: JSON.stringify(patch),
  });
}
