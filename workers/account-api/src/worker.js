/**
 * dadam-account-api — 계정 자체를 다루는 작업
 *
 * 회원탈퇴와 협력업체(신청 · 업체 · 직원 초대 · 관리자 처리 — partner.js). 별도 워커로 둔 이유:
 *   auth.users 삭제는 service_role 키가 있어야 한다. 브라우저에서는 못 한다.
 *   generate-api 에는 service_role 을 두지 않기로 했고(이미지 생성 워커가
 *   사용자 삭제 권한까지 갖고 있을 이유가 없다), payments-api 는 결제 전용이다.
 *
 * 헬퍼(cors.js)는 payments-api 것을 그대로 복제했다 — workflow-api 가 쓴 방식과 같다.
 */
import { corsHeaders, handleOptions, jsonResponse } from './cors.js';
import { matchPartnerRoute, partnerResponse, runPartnerRoute } from './partner.js';
import { prepareWithdrawal, soleOwnerCompanies, withdrawalDetail, withdrawalSummary } from './withdrawal.js';

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
 * 관리자 활동 기록 (admin_logs). 열 이름은 database/admin-schema.sql 이 정본이다:
 *   admin_id · admin_email · action_type(NOT NULL) · target_type · target_id · description · old_value · new_value.
 * 실패해도 탈퇴를 막지 않는다 — 로그 때문에 탈퇴가 안 되면 안 된다. 실패는 상태 코드만 남긴다.
 */
async function writeAdminLog(env, row) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_logs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.warn('[account] admin_logs:', res.status);
  } catch {
    console.warn('[account] admin_logs: request failed');
  }
}

/**
 * 회원탈퇴.
 *
 * 본인 토큰으로만 자기 계정을 지운다 — 대상 id 를 본문에서 받지 않는 이유다.
 * 받으면 남의 계정을 지목할 수 있게 된다.
 *
 * 계정을 지우기 **전에** withdrawal.js 가 정리한다 (2026-10-27):
 *   지운다 — Storage 회원 폴더(generations · design-images 전부, collection 은 공개 AI 연출컷 복사본 빼고),
 *            직접 올린 시공사례 행(source 'upload'), 계약 기록이 없는 설계 행과 그 renders · cad 파일
 *   남긴다 — 시공사례에 공개된 AI 연출컷(source 'ai_render'), 결제 · 구독 기록, 계약 기록이 있는 설계
 *            (고객 확인서 · 수주가 딸린 설계)와 크레딧 원장. auth 사용자를 지울 때 FK 가 회원과 떼어 놓는다
 *            (database/withdrawal-retention.sql · withdrawal-contract-records.sql — 적용돼 있어야 한다)
 * 나머지(프로필 등)는 auth.users 를 지울 때 FK CASCADE 로 지워진다.
 * 일부를 못 지워도 탈퇴는 그대로 하고 그 사실을 수로만 기록한다 (경로 · 개인 정보 없음).
 * 회사의 마지막 대표는 탈퇴하지 않는다 (409) — 정리 전에 본다.
 * 계정이 남아 있는 동안이어야 같은 요청을 다시 보낼 수 있으므로 정리를 먼저 한다.
 */
async function handleDelete(request, env) {
  // 인증을 먼저 본다. 설정 여부를 인증 앞에 두면 비로그인 요청이 401 대신
  // 503 을 받아, 로그인하지 않은 사람에게 서버 설정 상태를 알려주게 된다.
  const user = await verifyJwt(request, env);

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

  const blocked = await soleOwnerBlock(request, env, user.id);
  if (blocked) return blocked;

  // 정리 먼저 — 계정을 지운 뒤에는 이 요청을 다시 보낼 수 없다. 던지지 않는다.
  const w = await prepareWithdrawal(env, user.id);
  console.log('[account] delete', withdrawalSummary(w));

  // 흔적을 남긴다. 계정을 지운 뒤에는 누가 지웠는지 쓸 수 없다.
  // 2026-10-27: 열 이름을 admin_logs 정본에 맞췄다 (예전 action · detail 은 없는 열이라 기록이 남지 않았다).
  await writeAdminLog(env, {
    action_type: 'account_delete',
    target_type: 'user',
    target_id: user.id,
    description: '회원 본인 탈퇴',
    new_value: { self_service: true, ...withdrawalDetail(w) },
  });

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

/** 호출자가 관리자인지 확인. is_admin() 은 SECURITY DEFINER 라 사용자 토큰으로 부른다. */
async function assertAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new AuthError('권한을 확인할 수 없습니다');
  const ok = await res.json();
  if (ok !== true) throw new AuthError('관리자만 사용할 수 있습니다');
}

/**
 * 회사의 마지막 대표면 탈퇴하지 않는다 — 대표를 넘긴 뒤에 한다. 확인을 못 하면 탈퇴도 하지 않는다.
 * 막아야 하면 응답을, 아니면 null 을 돌려준다.
 */
async function soleOwnerBlock(request, env, userId) {
  let sole;
  try {
    sole = await soleOwnerCompanies(env, userId);
  } catch {
    return jsonResponse(
      request,
      env,
      { success: false, error: '탈퇴할 수 있는지 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      503
    );
  }
  if (!sole.length) return null;
  return jsonResponse(
    request,
    env,
    { success: false, code: 'sole_owner', error: '업체 대표를 다른 분께 넘긴 뒤 탈퇴할 수 있습니다.' },
    409
  );
}

/**
 * 관리자의 강제 탈퇴.
 *
 * 본인 탈퇴(handleDelete)와 달리 대상 id 를 받는다 — 그래서 관리자 확인이
 * 반드시 서버에서 일어나야 한다. 화면에서 버튼을 감추는 것으로는 못 막는다.
 */
async function handleAdminDelete(request, env) {
  await verifyJwt(request, env);
  await assertAdmin(request, env);

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(request, env, { success: false, error: '서버 설정이 필요합니다.' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const target = body && body.user_id;
  // UUID 모양만 받는다 — 파일 정리가 이 값을 폴더 이름으로 쓴다
  if (typeof target !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) {
    return jsonResponse(request, env, { success: false, error: '대상이 올바르지 않습니다.' }, 400);
  }

  const admin = await verifyJwt(request, env);

  const blocked = await soleOwnerBlock(request, env, target);
  if (blocked) return blocked;

  // 대상 회원 정리 먼저 (본인 탈퇴와 같다). 던지지 않는다.
  const w = await prepareWithdrawal(env, target);
  console.log('[account] admin delete', withdrawalSummary(w));

  await writeAdminLog(env, {
    admin_id: admin.id,
    admin_email: admin.email || null,
    action_type: 'account_delete',
    target_type: 'user',
    target_id: target,
    description: '관리자 강제 탈퇴',
    new_value: { by_admin: true, ...withdrawalDetail(w) },
  });

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${target}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error('[account] admin delete failed:', res.status, (await res.text()).slice(0, 200));
    return jsonResponse(request, env, { success: false, error: '삭제에 실패했습니다.' }, 500);
  }
  return jsonResponse(request, env, { success: true });
}

/**
 * 협력업체 길 (partner.js). 로그인 확인은 verifyJwt, 관리자 길은 /admin/delete 와 같은 assertAdmin.
 * 로그인 안 됨 → 401 unauthorized, 관리자 아님 → 403 not_admin.
 */
async function handlePartner(request, env, route, url) {
  let user;
  try {
    user = await verifyJwt(request, env);
  } catch (e) {
    if (e instanceof AuthError) {
      return partnerResponse(
        request,
        env,
        { success: false, code: 'unauthorized', error: e.message },
        401
      );
    }
    console.error('[account] partner auth:', e.message);
    return partnerResponse(
      request,
      env,
      { success: false, code: 'server_error', error: '처리 중 오류가 발생했습니다.' },
      500
    );
  }
  if (route.admin) {
    try {
      await assertAdmin(request, env);
    } catch (e) {
      if (e instanceof AuthError) {
        return partnerResponse(
          request,
          env,
          { success: false, code: 'not_admin', error: e.message },
          403
        );
      }
      console.error('[account] partner admin check:', e.message);
      return partnerResponse(
        request,
        env,
        { success: false, code: 'server_error', error: '처리 중 오류가 발생했습니다.' },
        500
      );
    }
  }
  return runPartnerRoute(request, env, route, { user, url });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleOptions(request, env);

    if (url.pathname === '/health' || url.pathname === '/') {
      // configured 는 service_role 키가 등록됐는지만 알린다(값은 노출하지 않는다).
      // 이게 없으면 탈퇴가 되는지 배포 후에 확인할 방법이 없다.
      return jsonResponse(request, env, {
        status: 'ok',
        service: 'dadam-account-api',
        configured: !!env.SUPABASE_SERVICE_ROLE_KEY,
      });
    }

    if (
      (url.pathname === '/delete' || url.pathname === '/admin/delete') &&
      request.method === 'POST'
    ) {
      try {
        return url.pathname === '/admin/delete'
          ? await handleAdminDelete(request, env)
          : await handleDelete(request, env);
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

    const partnerRoute = matchPartnerRoute(request.method, url.pathname);
    if (partnerRoute) return handlePartner(request, env, partnerRoute, url);

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  },
};
