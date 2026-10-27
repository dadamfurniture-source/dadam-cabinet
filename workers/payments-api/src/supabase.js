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

/** 로그인은 됐지만 권한이 없다 (관리자 전용 경로). */
export class ForbiddenError extends AuthError {
  constructor(message = 'Forbidden') {
    super(message);
    this.statusCode = 403;
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

/**
 * 호출자가 관리자인지 확인한다. account-api · dataset-api 와 같은 방식 —
 * is_admin() 은 SECURITY DEFINER 라 **사용자 토큰으로** 부른다.
 * service_role 로 물으면 누구나 관리자가 된다.
 */
export async function verifyAdmin(request, env) {
  const user = await verifyJwt(request, env);
  const auth = request.headers.get('Authorization') || '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new ForbiddenError('권한을 확인할 수 없습니다');
  const ok = await res.json();
  if (ok !== true) throw new ForbiddenError('관리자만 사용할 수 있습니다');
  return user;
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

/**
 * 넣되, UNIQUE(onConflict) 에 걸리면 조용히 넘긴다 (ON CONFLICT DO NOTHING).
 * 넘겼으면 null. 같은 주문번호를 두 번 기록하지 않으려고 쓴다.
 */
export async function insertIgnoreDuplicate(env, table, row, onConflict) {
  const rows = await restRequest(env, `/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: restHeaders(env, 'resolution=ignore-duplicates,return=representation'),
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
