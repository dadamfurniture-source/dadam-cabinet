/**
 * Supabase REST/Auth 헬퍼 (Edge Workers 용).
 *
 * workers/payments-api/src/supabase.js 기반.
 * 추가: insertMany, selectManyRaw, ConflictError, NotFoundError, ValidationError
 *
 * - 사용자 JWT 검증: GET /auth/v1/user 호출 → 200 이면 인증 성공
 * - DB CRUD: PostgREST API + service_role key (RLS 우회)
 * - 업체 단위 접근: designAccess · assertDesignAccess · companyAccess (아래)
 */

// 관리자 검사는 reports/admin.js 하나로 — 그 파일도 이 파일을 읽지만 함수 안에서만 써서 순환 import 가 안전하다
import { isAdmin } from './reports/admin.js';

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

export class ForbiddenError extends Error {
  /** code — 화면이 사유를 가를 때 쓰는 짧은 이름 (예: not_member · not_money). 응답에 그대로 실린다 */
  constructor(message = 'Forbidden', code = null) {
    super(message);
    this.statusCode = 403;
    if (code) this.code = code;
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

/** CD-5: 필터 조건에 맞는 행 삭제. 필터가 비면 전체 삭제가 되므로 막는다. */
export async function restDelete(env, table, filter) {
  const qs = new URLSearchParams(filter).toString();
  if (!qs) throw new ValidationError('삭제 조건이 비어 있습니다');
  return restRequest(env, `/${table}?${qs}`, {
    method: 'DELETE',
    headers: restHeaders(env),
  });
}

/**
 * CD-4: 있으면 갱신, 없으면 삽입 (PostgREST upsert).
 * `onConflict` 는 고유 인덱스가 걸린 컬럼이어야 한다 —
 * 아니면 PostgREST 가 42P10 으로 거부한다.
 */
export async function upsertOne(env, table, row, onConflict) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const rows = await restRequest(env, `/${table}${qs}`, {
    method: 'POST',
    headers: restHeaders(env, 'resolution=merge-duplicates,return=representation'),
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

/** PostgREST RPC — POST /rpc/<fn>. 인자는 함수의 매개변수 이름 그대로. */
export async function callRpc(env, fn, args = {}) {
  return restRequest(env, `/rpc/${encodeURIComponent(fn)}`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify(args),
  });
}

// ===== 업체(회사) 단위 접근 =====
//
// 이 워커는 service_role 로 읽으므로 RLS 가 걸리지 않는다 — 누가 무엇을 보는지는 여기서 정한다.
// 설계 · 수주 · 상담 · 연출컷 · 작업은 company_id 칸으로 업체에 묶인다 (database/migrations/0006).

/**
 * 원가 · 마진 · 수금 · 재작업 비용 · 월 손익(회계)까지 보는 구성원 역할.
 * 설계 · 견적(고객 금액) · 문서 · 수주 상태와 계약금은 업체 구성원 누구나 본다.
 */
export const MONEY_ROLES = Object.freeze(['owner', 'manager']);

// 본사 회사 id — 격리(isolate)마다 한 번 읽는다. 못 찾으면 캐시하지 않고 던진다
let hqIdCache = null;

/** 시험용 — 본사 id 캐시 비우기 */
export function clearHqCompanyCache() {
  hqIdCache = null;
}

/** 본사 회사 id (companies.kind = 'hq', 하나뿐). 없으면 DbError */
export async function hqCompanyId(env) {
  if (hqIdCache) return hqIdCache;
  const row = await selectOne(env, 'companies', { kind: 'eq.hq', select: 'id' });
  if (!row || !row.id) throw new DbError('본사 회사(companies.kind=hq)를 찾을 수 없습니다');
  hqIdCache = row.id;
  return hqIdCache;
}

/** 호출자가 active 구성원인 업체들 — [{ company_id, role }] */
export async function activeMemberships(env, user) {
  if (!user || !user.id) return [];
  return (await selectMany(env, 'company_members', {
    user_id: `eq.${user.id}`,
    status: 'eq.active',
    select: 'company_id,role',
  })) || [];
}

/**
 * 업체 전체를 볼 수 있는 업체 id 들.
 *   all   — active 구성원인 업체 + 관리자면 본사
 *   money — 그중 원가 · 수금까지 보는 업체 (owner · manager 인 업체 + 관리자면 본사)
 * 본사 설계를 직접 만든 사람의 몫(설계 단위)은 여기 들지 않는다 — designAccess · listOrders 가 따로 본다.
 */
export async function companyAccess(env, user, { hq = null } = {}) {
  const hqId = hq || (await hqCompanyId(env));
  const all = new Set();
  const money = new Set();
  for (const m of await activeMemberships(env, user)) {
    all.add(m.company_id);
    if (MONEY_ROLES.includes(m.role)) money.add(m.company_id);
  }
  if (!money.has(hqId) && (await isAdmin(env, user))) {
    all.add(hqId);
    money.add(hqId);
  }
  return { all, money };
}

/**
 * 설계 접근. 아래 중 하나면 { design, money } 를 돌려준다.
 *   a. 설계 업체의 active 구성원 — money 는 owner · manager 만
 *   b. 본사 설계이고 내가 만든 설계 (예전 규칙 그대로, money 포함)
 *   c. 관리자이고 본사 설계 (money 포함) — 관리자도 협력업체 설계는 못 본다
 * 설계가 없으면 404, 어느 것도 아니면 403.
 *
 * money: 원가 · 마진 · 수금 · 재작업 비용 · 월 손익을 볼 · 바꿀 수 있는가.
 *
 * ★ select=* 를 쓴다. designs 테이블 DDL 이 두 벌 존재하고
 *   (database/schema.sql 은 name, database/designs-schema.sql 은 title)
 *   없는 컬럼을 select 에 지정하면 PostgREST 가 400 을 던지기 때문.
 */
export async function designAccess(env, designId, user) {
  const design = await selectOne(env, 'designs', {
    id: `eq.${designId}`,
    select: '*',
  });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
  const hq = await hqCompanyId(env);
  if (design.company_id === hq && user && design.user_id === user.id) return { design, money: true };
  const { all, money } = await companyAccess(env, user, { hq });
  if (!all.has(design.company_id)) throw new ForbiddenError('이 설계를 볼 권한이 없습니다');
  return { design, money: money.has(design.company_id) };
}

/**
 * 설계 접근 확인 — 통과하면 설계 행. money 이면 원가 · 수금 권한(owner · manager · 본사 주인 · 관리자)까지 요구한다.
 */
export async function assertDesignAccess(env, designId, user, { money = false } = {}) {
  const access = await designAccess(env, designId, user);
  if (money && !access.money) throw new ForbiddenError('원가 · 수금은 업체 대표 · 실장만 볼 수 있습니다');
  return access.design;
}

/** designs 의 제목 컬럼 편차를 흡수한다. */
export function designTitleOf(design, fallback = '무제 설계') {
  if (!design) return fallback;
  return design.name || design.title || fallback;
}
