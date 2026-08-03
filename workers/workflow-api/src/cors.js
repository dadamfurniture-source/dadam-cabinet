/**
 * CORS 헬퍼 — preflight + 실제 응답에 헤더 부착.
 * workers/payments-api/src/cors.js 기반. 허용 메서드/헤더만 이 워커에 맞게 교체.
 */

function parseOrigins(env) {
  return (env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 요청 Origin 이 허용 목록에 있는지.
 * 목록에 없으면 allow[0] 을 돌려주므로 브라우저는 차단하지만 서버는 200 을 준다.
 * 이 비대칭이 디버깅을 어렵게 만들어서, /health 가 진단용으로 이 값을 노출한다.
 */
export function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  return parseOrigins(env).includes(origin);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = parseOrigins(env);
  const allowOrigin = allow.includes(origin) ? origin : allow[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Share-Token, X-Access-Pin, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function jsonResponse(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

/**
 * 공개 문서용 HTML 응답.
 * 검색엔진 색인과 중간 캐시 저장을 모두 막는다 — 고객 금액이 담기기 때문.
 */
export function htmlResponse(request, env, html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      ...corsHeaders(request, env),
    },
  });
}
