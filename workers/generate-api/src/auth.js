/**
 * 생성 API 사용자 인증
 *
 * 왜 필요한가:
 *   이 워커는 지금까지 인증이 **없었다**. 클라이언트(ai-design.html)는 이미
 *   Authorization 헤더를 보내고 있었는데 워커가 읽지 않았다 — URL 만 알면
 *   누구나 Gemini·Replicate 비용을 태울 수 있었다.
 *
 * 구현은 workers/payments-api/src/supabase.js 의 verifyJwt 와 같다.
 * 토큰을 직접 파싱해 서명을 검증하는 대신 Supabase 에 물어본다 —
 * 워커에 JWT 시크릿을 두지 않아도 되고, 폐기된 토큰도 함께 걸러진다.
 */

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

/** Authorization 헤더의 Bearer 토큰을 Supabase 에 검증 요청. 실패하면 AuthError. */
export async function verifyJwt(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError('로그인이 필요합니다');

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${match[1]}`,
    },
  });
  if (!res.ok) throw new AuthError('로그인이 만료되었습니다. 다시 로그인해 주세요');

  const user = await res.json();
  if (!user || !user.id) throw new AuthError('로그인이 필요합니다');
  return { id: user.id, email: user.email };
}
