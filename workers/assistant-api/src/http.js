/**
 * 응답 · 오류 · CORS — workers/workflow-api 와 같은 모양 ({ success, data } · { success:false, message, code }).
 */

export class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || undefined;
  }
}

export const authError = (m = '로그인이 필요합니다') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m, code) => new HttpError(403, m, code);
export const notFound = (m = '없습니다') => new HttpError(404, m, 'not_found');
export const badRequest = (m) => new HttpError(422, m, 'invalid');
export const conflict = (m, code) => new HttpError(409, m, code);
export const rateLimited = (m = '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요') =>
  new HttpError(429, m, 'rate_limited');

function parseOrigins(env) {
  return (env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const out = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (parseOrigins(env).includes(origin)) out['Access-Control-Allow-Origin'] = origin;
  return out;
}

export function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE,
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

export function ok(request, env, data, status = 200) {
  return json(request, env, { success: true, data }, status);
}

export function errorResponse(request, env, err) {
  if (err instanceof HttpError) {
    return json(
      request,
      env,
      { success: false, message: err.message, code: err.code },
      err.statusCode
    );
  }
  console.error('[assistant] unhandled:', err && err.stack ? err.stack : String(err));
  return json(request, env, { success: false, message: '서버 오류' }, 500);
}

/** 본문 JSON — 64KB 넘거나 객체가 아니면 422 */
export async function readJson(request) {
  const text = await request.text();
  if (text.length > 65536) throw badRequest('본문이 너무 큽니다');
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('본문이 JSON 이 아닙니다');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw badRequest('본문은 객체입니다');
  return body;
}
