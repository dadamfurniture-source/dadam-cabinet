/**
 * Dadam Workflow API — Cloudflare Worker
 *
 * 상세설계 → 고객확인 문서 → BOM → 작업지시서 → 일정/Slack 업무 루프의 서버측.
 *
 * 라우트 (W11-2 범위):
 *   GET  /health
 *   POST /designs/:designId/snapshots   — 설계+BOM 동결 (멱등)
 *   GET  /designs/:designId/snapshots   — 스냅샷 목록
 *   GET  /snapshots/:snapshotId         — 스냅샷 단건 (payload 포함)
 *   POST /snapshots/:snapshotId/quote   — 견적 재계산 미리보기 (저장 안 함)
 *
 * 이후 PR 에서 추가:
 *   W11-4  문서 발행 + 공개 공유 링크 + 인쇄 HTML
 *   W11-6  일정 + Slack
 *
 * 인증: 내부 API 는 Supabase 사용자 JWT (Authorization: Bearer).
 *       고객 공유 링크는 X-Share-Token 헤더 (W11-4).
 */

import { handleOptions, jsonResponse, isAllowedOrigin } from './cors.js';
import { createRouter } from './router.js';
import {
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  GoneError,
  DbError,
  verifyJwt,
} from './supabase.js';
import { createSnapshot, listSnapshots, getSnapshot, previewQuote } from './snapshots.js';

const SERVICE = 'dadam-workflow-api';
const VERSION = '0.1.0';

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ===== 핸들러 =====

/**
 * CORS 오설정은 브라우저에서만 터지고 서버는 200 을 주기 때문에 원인 파악이 어렵다.
 * 요청 Origin 과 허용 여부를 그대로 돌려주어 curl 만으로 진단할 수 있게 한다.
 */
async function handleHealth(request, env) {
  return jsonResponse(request, env, {
    success: true,
    data: {
      status: 'ok',
      service: SERVICE,
      version: VERSION,
      echo_origin: request.headers.get('Origin') || null,
      origin_allowed: isAllowedOrigin(request, env),
      supabase_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });
}

async function handleCreateSnapshot(request, env, { params, user }) {
  const body = await readJson(request);
  if (!body) throw new ValidationError('JSON 본문을 해석할 수 없습니다');

  const { snapshot, reused } = await createSnapshot(env, {
    designId: params.designId,
    user,
    body,
  });

  return jsonResponse(
    request,
    env,
    {
      success: true,
      data: {
        snapshot_id: snapshot.id,
        rev: snapshot.rev,
        content_hash: snapshot.content_hash,
        design_title: snapshot.design_title,
        item_count: snapshot.item_count,
        module_count: snapshot.module_count,
        panel_count: snapshot.panel_count,
        quote: snapshot.quote_payload, // W11-3 이후 채워짐
        reused,
        created_at: snapshot.created_at,
      },
    },
    reused ? 200 : 201,
  );
}

async function handleListSnapshots(request, env, { params, user }) {
  const url = new URL(request.url);
  const items = await listSnapshots(env, {
    designId: params.designId,
    user,
    limit: url.searchParams.get('limit'),
  });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleGetSnapshot(request, env, { params, user }) {
  const snapshot = await getSnapshot(env, { snapshotId: params.snapshotId, user });
  return jsonResponse(request, env, { success: true, data: snapshot });
}

async function handleQuotePreview(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const data = await previewQuote(env, {
    snapshotId: params.snapshotId,
    user,
    grade: body.grade,
    useActiveRules: body.use_active_rules === true,
  });
  return jsonResponse(request, env, { success: true, data });
}

// ===== 라우팅 =====

const router = createRouter([
  { method: 'GET', path: '/health', auth: 'none', handler: handleHealth },

  { method: 'POST', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleCreateSnapshot },
  { method: 'GET', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleListSnapshots },
  { method: 'GET', path: '/snapshots/:snapshotId', auth: 'jwt', handler: handleGetSnapshot },
  { method: 'POST', path: '/snapshots/:snapshotId/quote', auth: 'jwt', handler: handleQuotePreview },
]);

function errorResponse(request, env, err) {
  const known = [AuthError, ForbiddenError, NotFoundError, ValidationError, ConflictError, GoneError];
  if (known.some((C) => err instanceof C)) {
    return jsonResponse(
      request,
      env,
      { success: false, message: err.message, details: err.details || undefined },
      err.statusCode,
    );
  }
  if (err instanceof DbError) {
    console.error('DB error:', err.message);
    return jsonResponse(request, env, { success: false, message: 'DB 오류' }, err.statusCode);
  }
  console.error('Unhandled:', err && err.stack ? err.stack : String(err));
  return jsonResponse(request, env, { success: false, message: '서버 오류' }, 500);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    const url = new URL(request.url);
    const resolved = router.resolve(request.method, url.pathname);

    if (resolved === null) {
      return jsonResponse(request, env, { success: false, message: 'Not found' }, 404);
    }
    if (resolved === 'method_mismatch') {
      return jsonResponse(request, env, { success: false, message: 'Method not allowed' }, 405);
    }

    try {
      const user = resolved.auth === 'jwt' ? await verifyJwt(request, env) : null;
      return await resolved.handler(request, env, { params: resolved.params, user, ctx });
    } catch (err) {
      return errorResponse(request, env, err);
    }
  },
};
