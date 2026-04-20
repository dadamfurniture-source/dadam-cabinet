/**
 * CORS 헬퍼 — preflight + 실제 응답에 헤더 부착.
 */

function parseOrigins(env) {
  return (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = parseOrigins(env);
  const allowOrigin = allow.includes(origin) ? origin : allow[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, tosspayments-signature',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
    },
  });
}
