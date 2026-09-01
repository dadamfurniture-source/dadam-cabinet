/**
 * dadam-account-api — 계정 자체를 다루는 작업
 *
 * 지금은 회원탈퇴 하나다. 별도 워커로 둔 이유:
 *   auth.users 삭제는 service_role 키가 있어야 한다. 브라우저에서는 못 한다.
 *   generate-api 에는 service_role 을 두지 않기로 했고(이미지 생성 워커가
 *   사용자 삭제 권한까지 갖고 있을 이유가 없다), payments-api 는 결제 전용이다.
 *
 * 헬퍼(cors.js)는 payments-api 것을 그대로 복제했다 — workflow-api 가 쓴 방식과 같다.
 */
import { corsHeaders, handleOptions, jsonResponse } from './cors.js';

class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.statusCode = 401;
  }
}

/** Authorization 헤더의 Bearer 토큰을 Supabase 에 검증 요청. */
async function verifyJwt(request, env) {
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

/**
 * 회원탈퇴.
 *
 * 본인 토큰으로만 자기 계정을 지운다 — 대상 id 를 본문에서 받지 않는 이유다.
 * 받으면 남의 계정을 지목할 수 있게 된다.
 *
 * auth.users 를 지우면 profiles·designs·collection_posts 등은 CASCADE 로 함께
 * 지워지고, 문의·피드백 같은 기록은 SET NULL 로 남는다
 * (database/account-deletion.sql).
 */
async function handleDelete(request, env) {
  // 키가 없으면 조용히 실패하는 대신 분명히 알린다.
  // (wrangler secret put SUPABASE_SERVICE_ROLE_KEY 로 등록)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      request,
      env,
      { success: false, error: '탈퇴 기능이 아직 설정되지 않았습니다. 고객센터로 문의해 주세요.' },
      503
    );
  }

  const user = await verifyJwt(request, env);

  // 흔적을 먼저 남긴다. 계정을 지운 뒤에는 누가 지웠는지 쓸 수 없다.
  // 실패해도 탈퇴 자체는 막지 않는다 — 로그 때문에 탈퇴가 안 되면 안 된다.
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/admin_logs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        action: 'account_delete',
        target_type: 'user',
        target_id: user.id,
        detail: { email: user.email, self_service: true },
      }),
    });
  } catch (e) {
    console.warn('[account] admin_logs:', e.message);
  }

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[account] delete failed:', res.status, body.slice(0, 300));
    return jsonResponse(
      request,
      env,
      { success: false, error: '탈퇴 처리에 실패했습니다. 고객센터로 문의해 주세요.' },
      500
    );
  }

  return jsonResponse(request, env, { success: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleOptions(request, env);

    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse(request, env, { status: 'ok', service: 'dadam-account-api' });
    }

    if (url.pathname === '/delete' && request.method === 'POST') {
      try {
        return await handleDelete(request, env);
      } catch (e) {
        if (e instanceof AuthError) {
          return jsonResponse(request, env, { success: false, error: e.message }, 401);
        }
        console.error('[account] error:', e.message);
        return jsonResponse(
          request,
          env,
          { success: false, error: '처리 중 오류가 발생했습니다.' },
          500
        );
      }
    }

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  },
};
