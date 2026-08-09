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
 *   POST /snapshots/:snapshotId/documents  — 문서 발행 (평문 토큰은 여기서만 반환)
 *   GET  /designs/:designId/documents      — 목록 (stale 배지 포함)
 *   GET  /documents/:documentId            — 단건
 *   GET  /documents/:documentId/print      — A4 인쇄 HTML (내부용)
 *   POST /documents/:documentId/revoke     — 공유 링크 회수
 *
 *   POST /designs/:designId/schedules      — 일정 등록 + Slack 알림
 *   GET  /designs/:designId/schedules      — 일정 목록
 *   PATCH /schedules/:scheduleId           — 일정 수정
 *   POST /schedules/batches/:batchId/notify — Slack 재전송 (멱등)
 *
 *   GET  /public/confirm                   — 고객 열람 (X-Share-Token)
 *   POST /public/confirm/decision          — 고객 승인/수정요청
 *
 * 인증: 내부 API 는 Supabase 사용자 JWT (Authorization: Bearer).
 *       고객 공유 링크는 X-Share-Token 헤더 (W11-4).
 */

import { handleOptions, jsonResponse, htmlResponse, isAllowedOrigin } from './cors.js';
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
  assertDesignOwner,
} from './supabase.js';
import { createSnapshot, listSnapshots, getSnapshot, previewQuote } from './snapshots.js';
import {
  issueDocument,
  listDocuments,
  getDocumentForOwner,
  revokeDocument,
  renderDocument,
  openSharedDocument,
  recordDecision,
} from './documents.js';
import { getSiteInfo, saveSiteInfo } from './site-info.js';
import {
  createSchedules,
  listSchedules,
  updateSchedule,
  resendBatch,
} from './schedules.js';

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

// ===== 문서 =====

async function handleIssueDocument(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const result = await issueDocument(env, {
    user,
    body: { ...body, snapshot_id: params.snapshotId },
  });

  return jsonResponse(
    request,
    env,
    {
      success: true,
      data: {
        document_id: result.document.id,
        doc_no: result.document.doc_no,
        doc_type: result.document.doc_type,
        rev: result.document.rev,
        expires_at: result.document.expires_at,
        totals: result.document.totals,
        // ★ 평문 토큰은 이 응답에서만 볼 수 있다. DB 에는 해시만 남는다.
        share_token: result.share_token,
        share_url: result.share_url,
      },
    },
    201,
  );
}

async function handleListDocuments(request, env, { params, user }) {
  const items = await listDocuments(env, { designId: params.designId, user });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleGetDocument(request, env, { params, user }) {
  const { doc, snapshot } = await getDocumentForOwner(env, {
    documentId: params.documentId,
    user,
  });
  return jsonResponse(request, env, {
    success: true,
    data: { ...doc, snapshot_rev: snapshot.rev, snapshot_content_hash: snapshot.content_hash },
  });
}

/** 내부용 인쇄 화면. 작업지시서는 여기서 연다. */
async function handlePrintDocument(request, env, { params, user }) {
  const { doc, snapshot } = await getDocumentForOwner(env, {
    documentId: params.documentId,
    user,
  });
  return htmlResponse(request, env, renderDocument(doc, snapshot, { toolbar: true }));
}

async function handleRevokeDocument(request, env, { params, user }) {
  const doc = await revokeDocument(env, { user, documentId: params.documentId });
  return jsonResponse(request, env, { success: true, data: { id: doc.id, status: doc.status } });
}

// ===== 공개(비로그인) — 고객 공유 링크 =====

function shareCredentials(request) {
  const url = new URL(request.url);
  return {
    // 토큰은 헤더로 받는 것이 기본이다. 경로/쿼리에 두면 액세스 로그와
    // Referer 에 남는다. ?t= 는 브라우저가 직접 여는 인쇄 화면 전용 폴백.
    token: request.headers.get('X-Share-Token') || url.searchParams.get('t') || '',
    pin: request.headers.get('X-Access-Pin') || '',
  };
}

async function handlePublicConfirm(request, env) {
  const { token, pin } = shareCredentials(request);
  const { doc, snapshot } = await openSharedDocument(env, request, { token, pin });

  return jsonResponse(request, env, {
    success: true,
    data: {
      // 문서 본문만. 승인 폼은 confirm.html 이 iframe 바깥에 그린다.
      html: renderDocument(doc, snapshot, { toolbar: false }),
      doc_no: doc.doc_no,
      title: doc.title,
      decision: doc.decision,
      expires_at: doc.expires_at,
    },
  });
}

async function handleGetSiteInfo(request, env, { params, user }) {
  await assertDesignOwner(env, params.designId, user.id);
  const site = await getSiteInfo(env, params.designId);
  return jsonResponse(request, env, { success: true, data: site });
}

async function handleSaveSiteInfo(request, env, { params, user }) {
  await assertDesignOwner(env, params.designId, user.id);
  const body = (await readJson(request)) || {};
  const saved = await saveSiteInfo(env, params.designId, body);
  return jsonResponse(request, env, { success: true, data: saved });
}

async function handlePublicDecision(request, env) {
  const { token, pin } = shareCredentials(request);
  const body = (await readJson(request)) || {};
  const { doc } = await recordDecision(env, request, {
    token,
    pin,
    decision: body.decision,
    signerName: body.signer_name,
    memo: body.memo,
    // CD-6: 집계 가능한 수정 요청 사유 (자유 메모와 병행)
    reasons: body.reasons,
  });

  return jsonResponse(request, env, {
    success: true,
    data: { decision: doc.decision, decided_at: doc.decided_at, signer_name: doc.signer_name },
  });
}

// ===== 일정 + Slack =====

async function handleCreateSchedules(request, env, { params, user, ctx }) {
  const body = (await readJson(request)) || {};
  const data = await createSchedules(env, ctx, {
    designId: params.designId,
    user,
    body,
  });
  // Slack 전송은 응답 후에 일어난다. 실패해도 일정은 이미 저장돼 있다.
  return jsonResponse(request, env, { success: true, data }, 201);
}

async function handleListSchedules(request, env, { params, user }) {
  const items = await listSchedules(env, { designId: params.designId, user });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleUpdateSchedule(request, env, { params, user }) {
  const patch = (await readJson(request)) || {};
  const row = await updateSchedule(env, { scheduleId: params.scheduleId, user, patch });
  return jsonResponse(request, env, { success: true, data: row });
}

async function handleResendSlack(request, env, { params, user, ctx }) {
  const data = await resendBatch(env, ctx, { batchId: params.batchId, user });
  return jsonResponse(request, env, { success: true, data });
}

// ===== 라우팅 =====

const router = createRouter([
  { method: 'GET', path: '/health', auth: 'none', handler: handleHealth },

  { method: 'POST', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleCreateSnapshot },
  { method: 'GET', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleListSnapshots },
  { method: 'GET', path: '/snapshots/:snapshotId', auth: 'jwt', handler: handleGetSnapshot },
  { method: 'POST', path: '/snapshots/:snapshotId/quote', auth: 'jwt', handler: handleQuotePreview },

  { method: 'POST', path: '/snapshots/:snapshotId/documents', auth: 'jwt', handler: handleIssueDocument },
  { method: 'GET', path: '/designs/:designId/documents', auth: 'jwt', handler: handleListDocuments },
  { method: 'GET', path: '/documents/:documentId', auth: 'jwt', handler: handleGetDocument },
  { method: 'GET', path: '/documents/:documentId/print', auth: 'jwt', handler: handlePrintDocument },
  { method: 'POST', path: '/documents/:documentId/revoke', auth: 'jwt', handler: handleRevokeDocument },

  // CD-4: 현장 정보 — 설치 작업지시서의 입력
  { method: 'GET', path: '/designs/:designId/site-info', auth: 'jwt', handler: handleGetSiteInfo },
  { method: 'PUT', path: '/designs/:designId/site-info', auth: 'jwt', handler: handleSaveSiteInfo },

  { method: 'POST', path: '/designs/:designId/schedules', auth: 'jwt', handler: handleCreateSchedules },
  { method: 'GET', path: '/designs/:designId/schedules', auth: 'jwt', handler: handleListSchedules },
  { method: 'PATCH', path: '/schedules/:scheduleId', auth: 'jwt', handler: handleUpdateSchedule },
  { method: 'POST', path: '/schedules/batches/:batchId/notify', auth: 'jwt', handler: handleResendSlack },

  // 공개 — 고객 공유 링크 (JWT 없음, X-Share-Token 으로 인증)
  { method: 'GET', path: '/public/confirm', auth: 'none', handler: handlePublicConfirm },
  { method: 'POST', path: '/public/confirm/decision', auth: 'none', handler: handlePublicDecision },
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
