/**
 * Supabase REST · Storage · RPC 헬퍼 (service_role).
 *
 * workers/workflow-api/src/supabase.js 의 CRUD 부분을 복사했다 — 워커 사이 import 는
 * 배포 경로 필터(workers/generate-api/**)를 피해 가므로 파일을 복사한다.
 * 여기에 Storage 업로드·삭제·공개 URL 과 service_role RPC 를 더했다.
 *
 * 이 워커에서 service_role 을 쓰는 곳:
 *   - generations 행 insert/update/delete (클라이언트 INSERT/DELETE 정책이 없다)
 *   - generations 버킷 업로드·삭제
 *   - refund_credit_svc (잡 안 실패 환불 — 사용자 토큰이 없다)
 * 사용자 토큰으로 되는 일(차감·본인 행 읽기)은 사용자 토큰으로 한다.
 */

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.statusCode = 404;
  }
}
export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.statusCode = 403;
  }
}
export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.statusCode = 409;
  }
}
export class GoneError extends Error {
  constructor(message = 'Gone') {
    super(message);
    this.statusCode = 410;
  }
}
export class ValidationError extends Error {
  constructor(message = 'Bad request') {
    super(message);
    this.statusCode = 400;
  }
}
export class DbError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

function serviceKey(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new DbError('SUPABASE_SERVICE_ROLE_KEY not configured');
  return env.SUPABASE_SERVICE_ROLE_KEY;
}

function restHeaders(env, prefer = 'return=representation') {
  const key = serviceKey(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

async function restRequest(env, path, init) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new DbError(`Supabase ${res.status}: ${text.slice(0, 300)}`, res.status);
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
  return restRequest(env, `/${table}?${qs}`, { method: 'GET', headers: restHeaders(env) });
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

export async function deleteById(env, table, id) {
  return restRequest(env, `/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: restHeaders(env, 'return=minimal'),
  });
}

/** service_role 로 RPC 호출. 반환 JSON 그대로. */
export async function rpcService(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new DbError(`${fn} failed: ${res.status} ${text.slice(0, 200)}`, res.status);
  return text ? JSON.parse(text) : null;
}

// ─── Storage ───

export function bucketName(env) {
  return env.GENERATIONS_BUCKET || 'generations';
}

export function publicUrl(env, path) {
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucketName(env)}/${path}`;
}

/**
 * 객체 업로드 (있으면 덮어씀). base64 문자열을 받아 바이트로 올린다.
 * alarm 재실행으로 같은 슬롯을 두 번 올려도 덮어쓰기라 멱등이다.
 */
export async function uploadObject(env, path, base64, mimeType) {
  const key = serviceKey(env);
  const bytes = base64ToBytes(base64);
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucketName(env)}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new DbError(`Storage upload ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return { path, url: publicUrl(env, path), bytes: bytes.byteLength };
}

/** 여러 객체 삭제. 없는 경로가 섞여 있어도 실패하지 않는다. */
export async function removeObjects(env, paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const key = serviceKey(env);
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucketName(env)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: list }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[Storage] delete ${res.status}: ${text.slice(0, 120)}`);
  }
}

/** 저장된 객체를 다시 base64 로. 잡이 재개될 때 입력·기본안을 읽는 데 쓴다. */
export async function fetchObjectBase64(env, path) {
  const key = serviceKey(env);
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucketName(env)}/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new DbError(`Storage read ${res.status} for ${path}`, res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { base64: bytesToBase64(buf), mimeType: res.headers.get('Content-Type') || 'image/jpeg' };
}

// ─── base64 ───

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000; // 한 번에 다 넘기면 인자 수 제한에 걸린다
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function extOf(mimeType) {
  if (/png/i.test(mimeType || '')) return 'png';
  if (/webp/i.test(mimeType || '')) return 'webp';
  return 'jpg';
}
