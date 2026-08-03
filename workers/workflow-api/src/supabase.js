/**
 * Supabase REST/Auth 헬퍼 (Edge Workers 용).
 *
 * workers/payments-api/src/supabase.js 기반.
 * 추가: insertMany, selectManyRaw, ConflictError, NotFoundError, ValidationError
 *
 * - 사용자 JWT 검증: GET /auth/v1/user 호출 → 200 이면 인증 성공
 * - DB CRUD: PostgREST API + service_role key (RLS 우회)
 */

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.statusCode = 403;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.statusCode = 404;
  }
}

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 422;
    this.details = details;
  }
}

export class ConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 409;
    this.details = details;
  }
}

export class GoneError extends Error {
  constructor(message = 'Gone') {
    super(message);
    this.statusCode = 410;
  }
}

export class DbError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** PostgREST 고유 제약 위반 코드. */
export const PG_UNIQUE_VIOLATION = '23505';

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
    // 고유 제약 위반은 호출부가 멱등 처리(기존 행 조회)를 해야 하므로 구분해서 던진다
    if (text.includes(PG_UNIQUE_VIOLATION)) {
      throw new ConflictError(`Supabase unique violation: ${text}`, text);
    }
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

/** 배열 bulk insert. PostgREST 는 body 가 배열이면 다건 삽입한다. */
export async function insertMany(env, table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const out = await restRequest(env, `/${table}`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify(rows),
  });
  return out || [];
}

/**
 * 고유 제약 충돌을 무시하는 insert. 충돌 시 null 을 반환하므로
 * 호출부가 기존 행을 조회해 멱등 응답을 만들 수 있다.
 */
export async function insertOneIgnoreConflict(env, table, row) {
  try {
    return await insertOne(env, table, row);
  } catch (err) {
    if (err instanceof ConflictError) return null;
    throw err;
  }
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

/**
 * 설계 소유권 확인.
 *
 * ★ select=* 를 쓴다. designs 테이블 DDL 이 두 벌 존재하고
 *   (database/schema.sql 은 name, database/designs-schema.sql 은 title)
 *   없는 컬럼을 select 에 지정하면 PostgREST 가 400 을 던지기 때문.
 */
export async function assertDesignOwner(env, designId, userId) {
  const design = await selectOne(env, 'designs', {
    id: `eq.${designId}`,
    select: '*',
  });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
  if (design.user_id !== userId) throw new ForbiddenError('본인 설계가 아닙니다');
  return design;
}

/** designs 의 제목 컬럼 편차를 흡수한다. */
export function designTitleOf(design, fallback = '무제 설계') {
  if (!design) return fallback;
  return design.name || design.title || fallback;
}
