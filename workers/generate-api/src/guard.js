/**
 * 요청 관문 — CORS 허용 목록 · 요청 한도 · 본문 크기 (2026-10-26).
 *
 *   CORS: wrangler.toml 의 CORS_ORIGINS (쉼표 구분). 목록에 없는 Origin 에는 Allow-Origin 을 싣지 않는다 —
 *         브라우저가 막는다. '*' 는 한 칸만 받는다: 서브도메인 한 단계(https://*.dadam-cabinet.pages.dev) 또는 포트(http://localhost:*).
 *         CORS_ORIGINS 가 비어 있으면 아무 Origin 도 열지 않는다.
 *   한도: Workers Rate Limiting 바인딩(wrangler.toml [[ratelimits]]). 키는 사용자 id. 바인딩이 없으면(시험·로컬) 세지 않고,
 *         한도기 자체가 실패해도 요청은 그대로 보낸다 — 손님 요청을 한도기 고장으로 막지 않는다.
 *   본문: Content-Length 를 먼저 보고, 없으면 읽으면서 센다. 넘으면 413.
 */

export class RateLimitError extends Error {
  constructor(message = '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요') {
    super(message);
    this.statusCode = 429;
    this.code = 'rate_limited';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message = '요청 본문이 너무 큽니다') {
    super(message);
    this.statusCode = 413;
    this.code = 'body_too_large';
  }
}

// ─── CORS ───

function parseOrigins(env) {
  return String((env && env.CORS_ORIGINS) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function originMatches(origin, entry) {
  if (!entry.includes('*')) return origin === entry;
  const re = new RegExp('^' + entry.split('*').map(escapeRe).join('[a-z0-9-]+') + '$');
  return re.test(origin);
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  return parseOrigins(env).some((entry) => originMatches(origin, entry));
}

export function corsHeaders(origin, env) {
  return {
    ...(isAllowedOrigin(origin, env) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Share-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// ─── 요청 한도 ───

/** binding.limit({key}) 이 success:false 면 429. 바인딩이 없거나 한도기가 실패하면 통과. */
export async function enforceRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return;
  let outcome;
  try {
    outcome = await binding.limit({ key: String(key) });
  } catch (e) {
    console.warn('[Generate] rate limiter failed:', e && e.message);
    return;
  }
  if (outcome && outcome.success === false) throw new RateLimitError();
}

// ─── 본문 크기 ───

/** 선언된 Content-Length 가 maxBytes 를 넘으면 413 (본문을 읽기 전에). */
export function assertContentLength(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError();
}

/** 본문을 텍스트로 — maxBytes 를 넘는 순간 읽기를 멈추고 413. */
export async function readBodyText(request, maxBytes) {
  assertContentLength(request, maxBytes);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* 이미 닫혔다 */
      }
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
