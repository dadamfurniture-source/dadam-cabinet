/**
 * 앱 알림 기기 등록 (push_subscriptions — database/migrations/0016_app_notifications.sql).
 *
 *   GET    /push/key            VAPID 공개 키 { key } — 로그인 없이
 *   POST   /push/subscriptions  (Bearer) { endpoint, keys: { p256dh, auth }, user_agent } → 201 { id }
 *   DELETE /push/subscriptions  (Bearer) { endpoint } → 204 (내 등록만 지운다)
 *
 * 누가 등록하나 (POST):
 *   1. 업체의 active 구성원 (본사 포함) → company_id = 그 업체.
 *      업체가 정지(suspended)면 대표만 (결제 · 정지 알림을 받는다), 닫힌 업체는 아니다
 *   2. 열린 업체 신청(applied · meeting · 아직 안 쓴 approved — account-api 와 같은 규칙)이 있는 사람 → company_id 없음
 *   3. 그 밖 → 403 no_company
 * 같은 기기(endpoint)는 한 줄 — 다시 등록하면 사람 · 업체 · 키를 새로 묶고 실패 횟수를 지운다.
 * 받는 주소는 알려진 푸시 서비스의 https 주소만 (아니면 422).
 *
 * 응답 · 로그에 받는 주소 · 키를 싣지 않는다.
 */

import { jsonResponse, corsHeaders } from '../cors.js';
import { selectMany, upsertOne, restDelete, ForbiddenError, ValidationError } from '../supabase.js';
import { isAllowedPushEndpoint, decodeSubscriptionKeys, ENDPOINT_MAX } from './webpush.js';

const NO_STORE = { 'Cache-Control': 'no-store, private' };
/** DB CHECK 와 같다 */
const P256DH_MAX = 200;
const AUTH_MAX = 100;
const USER_AGENT_MAX = 300;

function coded(Err, message, code) {
  const e = new Err(message);
  e.code = code;
  return e;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** GET /push/key — 공개 키. 설정이 없으면 503 */
export async function handlePushKey(request, env) {
  const key = typeof env.VAPID_PUBLIC_KEY === 'string' ? env.VAPID_PUBLIC_KEY.trim() : '';
  if (!key) {
    return jsonResponse(request, env, { success: false, message: '알림 설정이 아직 없습니다', code: 'not_configured' }, 503, NO_STORE);
  }
  return jsonResponse(request, env, { success: true, data: { key } }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/** 받는 주소 — 알려진 푸시 서비스만. 아니면 422 */
function endpointOf(body) {
  const endpoint = body && body.endpoint;
  if (!isAllowedPushEndpoint(endpoint)) {
    throw coded(ValidationError, '알림을 받을 수 없는 주소입니다', 'invalid_endpoint');
  }
  return endpoint;
}

/** 기기 키 — 모양이 틀리면 422 */
async function keysOf(body) {
  const keys = body && body.keys && typeof body.keys === 'object' ? body.keys : {};
  const { p256dh, auth } = keys;
  const ok =
    typeof p256dh === 'string' &&
    typeof auth === 'string' &&
    p256dh.length <= P256DH_MAX &&
    auth.length <= AUTH_MAX &&
    (await decodeSubscriptionKeys(p256dh, auth));
  if (!ok) throw coded(ValidationError, '알림 키가 올바르지 않습니다', 'invalid_keys');
  return { p256dh, auth };
}

/** 브라우저 이름 — 300자(코드 포인트)까지, 없으면 null */
function userAgentOf(body) {
  const ua = body && typeof body.user_agent === 'string' ? body.user_agent.trim() : '';
  return ua ? [...ua].slice(0, USER_AGENT_MAX).join('') : null;
}

const isOpenApplication = (a) =>
  !!a && (a.status === 'applied' || a.status === 'meeting' || (a.status === 'approved' && !a.used_at));

/**
 * 알림을 묶을 업체. 구성원이면 { companyId }, 업체 없이 신청 중이거나 작업자(대기 · 승인 · 정지)면 { companyId: null }.
 * 그 밖은 403 no_company.
 */
export async function pushCompanyFor(env, userId) {
  const members =
    (await selectMany(env, 'company_members', {
      user_id: `eq.${userId}`,
      status: 'eq.active',
      select: 'company_id,role,company:companies(status)',
    })) || [];
  for (const m of members) {
    const status = m.company && m.company.status;
    if (status === 'active' || (status === 'suspended' && m.role === 'owner')) return { companyId: m.company_id };
  }
  const apps =
    (await selectMany(env, 'partner_applications', {
      user_id: `eq.${userId}`,
      status: 'in.(applied,meeting,approved)',
      select: 'id,status,used_at',
    })) || [];
  if (apps.some(isOpenApplication)) return { companyId: null };
  // 작업자 — 업체 구성원이 아니라 업체 없는 기기로 작업자 알림(work_*)을 받는다 (0023)
  const workers =
    (await selectMany(env, 'workers', { user_id: `eq.${userId}`, status: 'in.(pending,approved,suspended)', select: 'id' })) || [];
  if (workers.length) return { companyId: null };
  throw new ForbiddenError('업체 구성원만 알림을 받을 수 있습니다', 'no_company');
}

/** POST /push/subscriptions */
export async function handleSavePushSubscription(request, env, { user }) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON 본문을 해석할 수 없습니다');
  const endpoint = endpointOf(body);
  const { p256dh, auth } = await keysOf(body);
  const { companyId } = await pushCompanyFor(env, user.id);

  const saved = await upsertOne(
    env,
    'push_subscriptions',
    {
      user_id: user.id,
      company_id: companyId,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgentOf(body),
      fail_count: 0,
      updated_at: new Date().toISOString(),
    },
    'endpoint',
  );
  if (!saved || !saved.id) throw new Error('push subscription: no row');
  return jsonResponse(request, env, { success: true, data: { id: saved.id } }, 201, NO_STORE);
}

/** DELETE /push/subscriptions — 내 등록 중 그 주소만. 없어도 204 */
export async function handleDeletePushSubscription(request, env, { user }) {
  const body = await readJson(request);
  const endpoint = body && body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > ENDPOINT_MAX) {
    throw coded(ValidationError, '알림 주소가 올바르지 않습니다', 'invalid_endpoint');
  }
  await restDelete(env, 'push_subscriptions', { user_id: `eq.${user.id}`, endpoint: `eq.${endpoint}` });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), ...NO_STORE } });
}
