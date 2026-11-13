/**
 * Dadam Workflow API — Cloudflare Worker
 *
 * 상세설계 → 고객확인 문서 → BOM → 작업지시서 → 일정/Slack 업무 루프의 서버측.
 *
 * 라우트 (W11-2 범위):
 *   GET  /health
 *   POST /designs/:designId/snapshots   — 설계+BOM 동결 (멱등)
 *   POST /planner/designs               — 간편 플래너 설계 받기 → 앱 설계 찾거나 만들고 동결 (본사 대표 · 실장 · 관리자, src/planner-handoff.js)
 *   GET /planner/access · /planner/drafts(…) · /planner/my-modules(…) · /planner/recommend — 간편 플래너 웹판 저장소 (src/planner-drafts.js, DB 0046)
 *   GET  /designs/:designId/snapshots   — 스냅샷 목록
 *   GET  /snapshots/:snapshotId         — 스냅샷 단건 (payload 포함)
 *   POST /snapshots/:snapshotId/quote   — 견적 재계산 미리보기 (저장 안 함)
 *   GET  /designs/:designId/cad-assembly   — 최신 동결 명세 + 해시 (관리자, CAD 베타 PR16b)
 *   POST /snapshots/:snapshotId/cad-artifacts?kind=cad|exterior — 동결본 GLB 보관 (관리자, 명세 해시 대조)
 *   GET  /snapshots/:snapshotId/cad-artifacts — 보관 GLB 목록 + 서명 URL (관리자)
 *
 *   POST /snapshots/:snapshotId/documents  — 문서 발행 (평문 토큰은 여기서만 반환)
 *   GET  /designs/:designId/documents      — 목록 (stale 배지 포함)
 *   GET  /documents/:documentId            — 단건
 *   GET  /documents/:documentId/print      — A4 인쇄 HTML (내부용). 작업지시서는 ?pack= 으로 꾸러미
 *   POST /documents/:documentId/revoke     — 공유 링크 회수
 *
 *   POST /designs/:designId/schedules      — 일정 등록 + Slack 알림
 *   GET  /designs/:designId/schedules      — 일정 목록
 *   PATCH /schedules/:scheduleId           — 일정 수정
 *   POST /schedules/batches/:batchId/notify — Slack 재전송 (멱등)
 *
 *   GET  /admin/consult-inbox · /admin/consultations/:id/candidates · POST /admin/consultations/:id/assign
 *   GET  /admin/companies · GET|PUT /admin/companies/:id/evaluation — 다담 본사 상담 분배 (src/distribution/)
 *   GET  /company/consults · GET /company/consults/:id/image · POST /company/consults/:id/accept|decline
 *   GET|PUT /company/service-settings
 *   GET  /company/my-score — 업체 쪽 상담 (src/distribution/company.js)
 *   GET|POST /company/projects · GET /company/designs · PUT /designs/:designId/project — 업체 고객 · 프로젝트, 설계 목록 · 잇기 (src/company-projects.js)
 *   PUT /company/projects/:id/assignee · GET /company/projects/:id/assignee-candidates — 프로젝트 담당자 (src/company-assignee.js, DB 0042)
 *   GET|POST /company/projects/:id/work · PATCH …/work/:kind · POST …/work/invite — 프로젝트의 작업 배정 (src/work/project-work.js)
 *   GET /company/quotes — 업체 견적(고객 확인서) 목록, 읽기만 (src/company-quotes.js)
 *   GET /company/customers · PATCH /company/customers/:id — 업체 고객 목록 · 이름 · 전화 고치기 (src/company-customers.js)
 *   GET /company/summary — 업체 숫자(견적 흐름 · 리드타임), 대표 · 실장, 읽기만 (src/company-summary.js)
 *   GET|PUT /company/shifts — 근무 일정(쉬는 날), 구성원이 보고 대표 · 실장이 적는다 (src/work-shifts.js, DB 0060)
 *   GET /company/workers · POST /company/workers/invites(/:id/revoke) · PATCH /company/workers/:linkId — 팩토리의 작업자:
 *     연결된 작업자 · 초대 · 승인 · 정지 (src/work/company.js, DB 0064 — 2026-11-13 「작업자 한 길」). POST /work/invites/peek 는 초대 미리보기
 *   GET|POST /stock/items · PATCH /stock/items/:id · POST /stock/items/:id/moves · GET /stock/moves — 재고 품목 · 입출고 (src/stock.js, DB 0059)
 *   GET|POST /stock/offcuts · PATCH /stock/offcuts/:id · GET /stock/offcuts/:id/events · POST /stock/offcuts/labels · GET /stock/summary — 자투리 · 재고 숫자 (src/stock-offcuts.js, DB 0059)
 *   GET|POST /stock/orders · POST /stock/orders/:id/receive · POST /stock/orders/:id/cancel — 재고 구매 발주 (src/stock-orders.js, DB 0062)
 *   GET /stock/needs · PUT /stock/links · POST /stock/needs/:orderId/issue · GET /stock/needs/:orderId/offcuts — 작업지시 자재 ↔ 재고 (src/stock-needs.js, DB 0063)
 *   GET  /company/schedules?from=&to= — 업체 업무 달력: 일정 표 · 상담 희망일 · 받을 날 · A/S 접수 (src/company-schedules.js)
 *   GET|POST /company/schedules/:id/workers — 설치 · A/S 방문 일정 줄의 작업자 배정 (src/work/schedule-link.js)
 *   POST /company/work/assignments/:id/accept|revision|remove — 팩토리 대표 · 실장의 완료 보고 확인 · 보완요청 · 빼기
 *   GET  /company/sites?kind=install|as · PUT /company/sites/geo · PUT /company/as-requests/:id/visit —
 *                                 설치 · A/S 지도 + 표: 현장 좌표 · A/S 방문 일정 (src/company-sites.js, DB 0058)
 *
 *   GET  /ledger/me · /ledger/accounts · /ledger/book · GET|PUT /ledger/settings
 *   POST /ledger/entries · /ledger/entries/:id/void · /ledger/entries/:id/correct
 *   GET|POST /ledger/documents — 회계장부 (src/ledger/)
 *   GET  /ledger/review · POST /ledger/review/post · POST /ledger/documents/:id/post|return|reject|reread
 *   GET  /ledger/business-status — 사진 확인 · 국세청 사업자 상태 (src/ledger/review.js, 읽기 걸기 src/ledger/extract.js)
 *   GET  /ledger/notices · POST /ledger/notices/seen — 장부 알림 (src/ledger/notices.js, 만드는 것은 DB 0033)
 *   GET  /ledger/dashboard — 회계 한눈에 (src/ledger/dashboard.js, 묶음은 DB 0034)
 *   GET  /ledger/close-memo — 월 마감 메모 (src/ledger/close-memo.js — 서버가 센 손볼 곳, AI 없음)
 *   GET|POST /orders/:orderId/reports · POST …/reports/photo · GET /admin/order-reports — 수주 완료 보고 (src/order-reports.js, DB 0043)
 *   POST /me/orders/:orderId/as-requests(/photo) · GET /me/as-requests · POST /me/as-requests/:id/cancel ·
 *   GET /company/as-requests · POST /company/as-requests/:id/receive|done · GET /admin/as-requests — 고객 A/S 접수 (src/as-requests.js, DB 0045)
 *   GET  /brief/today — 아침 브리핑 본문 (비서를 쓰는 업체 구성원, src/brief.js)
 *   POST|GET /production-requests · GET /production-requests/:id · POST …/:id/choose|cancel — Manager 업체 제작 의뢰
 *   GET /admin/production-requests · POST …/:id/review|recommend · GET …/:id/suggestions — 본사 추천
 *   GET /factory/production-requests · POST …/:id/accept|decline — 고른 팩토리의 받기 (src/production-requests/, DB 0050)
 *
 *   GET  /public/confirm                  — 고객 열람 (X-Share-Token)
 *   POST /public/confirm/decision          — 고객 승인/수정요청
 *
 * 인증: 내부 API 는 Supabase 사용자 JWT (Authorization: Bearer).
 *       고객 공유 링크는 X-Share-Token 헤더 (W11-4).
 */

import { handleOptions, jsonResponse, htmlResponse, isAllowedOrigin, corsHeaders } from './cors.js';
import { createRouter } from './router.js';
import { normalizePack, WORK_ORDER_PACKS } from './templates/work-order.js';
import {
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  GoneError,
  TooLargeError,
  RateLimitError,
  DbError,
  verifyJwt,
  assertDesignAccess,
  hqCompanyId,
  selectOne,
} from './supabase.js';
import {
  listReports,
  getReport,
  updateReportMeta,
  createNote,
  reportSummary,
  backfillReports,
} from './reports/service.js';
import { getManagementSummary } from './management/service.js';
import { createOutsourceOrder, listOutsourceOrders, loadCountertopContext } from './reports/outsource.js';
import { renderReportPrint } from './templates/report-print.js';
import { createSnapshot, listSnapshots, getSnapshotForViewer, previewQuote, quoteForViewer } from './snapshots.js';
import { receivePlannerDesign } from './planner-handoff.js';
import { getFrozenAssembly, uploadCadArtifact, listCadArtifacts, customerExteriorUrl } from './cad-artifacts.js';
import {
  issueDocument,
  listDocuments,
  getDocumentForOwner,
  documentForViewer,
  revokeDocument,
  renderDocument,
  resolvePrintAssets,
  openSharedDocument,
  recordDecision,
} from './documents.js';
import { getSiteInfo, saveSiteInfo } from './site-info.js';
import {
  createOrderFromDocument,
  listOrders,
  getOrder,
  updateOrder,
  addCost,
  deleteCost,
} from './orders.js';
import { listOrderEvents, listOrderRequests, decideOrderEvent } from './order-events.js';
import { listReworks, addRework, deleteRework, reworksForViewer } from './rework.js';
import { getFeedback, createFeedbackLink, openFeedback, answerFeedback } from './feedback.js';
import { listCounterparties, createCounterparty, updateCounterparty } from './counterparties.js';
import { listPayments, addPayment, updatePayment, deletePayment, updateCostDates, addCashBalance } from './payments.js';
import { listSalesHistory, saveSalesHistory } from './sales-history.js';
import { createOkr, updateOkr, deleteOkr } from './okrs.js';
import {
  createSchedules,
  listSchedules,
  updateSchedule,
  resendBatch,
} from './schedules.js';
import {
  computePlan,
  proposePlan,
  runDailyBriefs,
  runMonthlyCloses,
  getMonthlySummary,
  getProposal,
  listProposals,
  decideProposal,
  listAssignments,
  getSettings,
  saveSettings,
  assertHqMoney,
  assertHqProduction,
} from './production/service.js';
import { getBooksSummary } from './books.js';
import { createEntry, voidEntry, correctEntry, getBook, listAccounts, listLedgerOrders } from './ledger/entries.js';
import { uploadDocument, listDocuments as listLedgerDocuments } from './ledger/documents.js';
import { listReview, postDocument, postBatch, decideDocument, rereadDocument, businessStatus } from './ledger/review.js';
import { runExtractDue } from './ledger/extract.js';
import { runLedgerNotices, listNotices, markNoticesSeen } from './ledger/notices.js';
import { ledgerDashboard } from './ledger/dashboard.js';
import { getBrief, runMorningBrief } from './brief.js';
import { listReceivables, listPayables } from './ledger/money.js';
import { getCloseMemo } from './ledger/close-memo.js';
import { addOrderReport, addReportPhoto, listOrderReports, listReportsAdmin } from './order-reports.js';
import { addAsPhoto, addAsRequest, listMyAsRequests, cancelMyAsRequest, listCompanyAsRequests, receiveAsRequest, finishAsRequest, listAsAdmin, runAsAlerts } from './as-requests.js';
import { listSupplierModes, setSupplierMode, holdDocuments, listHeld, supplierEntries, attachStatements } from './ledger/statements.js';
import { runLedgerPendingNotices } from './push/ledger-hooks.js';
import { ledgerMe, getLedgerSettings, putLedgerSettings } from './ledger/settings.js';
import {
  createWorkerLink,
  listWorkerLinks,
  revokeWorkerLink,
  resolveWorker,
  workerToday,
  addWorklog,
  markAssignmentDone,
  listWorklogs,
  getCalibration,
  applyCalibration,
} from './production/worker-access.js';
import { runConsultNotices, runPartnerApplicationNotices, isConsultNoticeMinute } from './consult-notify.js';
import { getMe, registerWorker, listWorkersAdmin, patchWorkerAdmin, listWorkerNotes, addWorkerNote, listWorkerEvents } from './work/workers.js';
import { createInvite, claimInvite, peekInvite } from './work/invites.js';
import { listCompanyWorkers, createCompanyInvite, revokeCompanyInvite, patchCompanyWorker } from './work/company.js';
import {
  listScheduleWorkers, assignScheduleWorkers, acceptCompanyAssignment, reviseCompanyAssignment, removeCompanyAssignment,
  keepAssigneeName, syncJobWithSchedule,
} from './work/schedule-link.js';
import { listProjectWork, assignProjectWork, patchProjectWork, inviteProjectWork } from './work/project-work.js';
import {
  listJobsForWorker,
  getJobForWorker,
  listJobsAdmin,
  createJobAdmin,
  getJobAdmin,
  patchJobAdmin,
  publishJob,
  cancelJob,
  closeJob,
} from './work/jobs.js';
import { applyToJob, withdrawApplication, approveApplication, rejectApplication } from './work/applications.js';
import {
  confirmAssignment,
  declineAssignment,
  startAssignment,
  releaseAssignment,
  inviteWorker,
  acceptAssignment,
  requestRevision,
  removeAssignment,
} from './work/assignments.js';
import { addWorkerUpdate, addCompanyUpdate } from './work/updates.js';
import {
  getFactoryToday,
  addFactoryWorklog,
  markFactoryAssignmentDone,
  linkFactoryAccount,
  listFactoryWorkers,
  assignFactoryWorker,
  endFactoryWorker,
} from './work/factory.js';
import {
  factoryPack,
  getFactoryChecks,
  postFactoryCheck,
  assignmentPack,
  getAssignmentChecks,
  postAssignmentCheck,
  postFactoryPhoto,
  postAssignmentPhoto,
  getOrderChecks,
} from './work/checks.js';
import { acceptConsultation, listMyProjects } from './projects.js';
import {
  consultInbox,
  consultCandidates,
  assignConsultation,
  notifyConsultAssigned,
  listCompaniesAdmin,
  getCompanyEvaluation,
  putCompanyEvaluation,
} from './distribution/admin.js';
import {
  listCompanyConsults,
  readCompanyConsultImage,
  acceptCompanyConsult,
  declineCompanyConsult,
  runAssignmentExpiry,
  getServiceSettings,
  putServiceSettings,
  myScore,
} from './distribution/company.js';
import { listCompanyProjects, listCompanyDesigns, createCompanyProject, linkDesignProject } from './company-projects.js';
import { listCompanyQuotes } from './company-quotes.js';
import { listCompanyCustomers, updateCompanyCustomer } from './company-customers.js';
import { getCompanySummary } from './company-summary.js';
import { listShifts, putShift } from './work-shifts.js';
import { listStockItems, createStockItem, updateStockItem, addStockMove, listStockMoves } from './stock.js';
import { listOffcuts, createOffcut, updateOffcut, listOffcutEvents, makeOffcutLabels, getStockSummary } from './stock-offcuts.js';
import { listStockOrders, createStockOrder, receiveStockOrder, cancelStockOrder } from './stock-orders.js';
import { listStockNeeds, putStockLink, issueStockForOrder, listOffcutCandidates } from './stock-needs.js';
import { listCompanySchedules } from './company-schedules.js';
import { listCompanySites, saveSiteGeo, setAsVisit } from './company-sites.js';
import { listHqCompanies, listHqCompanyProjects, listHqCompanyMembers } from './hq-companies.js';
import { setProjectAssignee, assigneeCandidates } from './company-assignee.js';
import {
  plannerAccess,
  listDrafts,
  getDraft,
  saveDraft,
  discardDraft,
  getAppState,
  putAppState,
  addPhoto as addPlannerPhoto,
  readPhoto as readPlannerPhoto,
  deletePhoto as deletePlannerPhoto,
  listMyModules,
  saveMyModule,
  deleteMyModule,
  recommendOf,
  SAVE_BODY_MAX_BYTES,
} from './planner-drafts.js';
import { createRequest, listMyRequests, getMyRequest, chooseFactory, cancelMyRequest } from './production-requests/manager.js';
import { listRequestsAdmin, reviewRequest, suggestionsFor, recommendFactories } from './production-requests/admin.js';
import { listFactoryRequests, acceptFactoryRequest, declineFactoryRequest, runProductionOfferExpiry } from './production-requests/factory.js';
import { handlePushKey, handleSavePushSubscription, handleDeletePushSubscription } from './push/routes.js';
import { runPushSender, runPushCleanup, isPushCleanupTime, PUSH_SEND_CRON } from './push/sender.js';
import { notifyOrderRequest, notifyOrderRequestDecided, notifyConfirmationDecided } from './push/hooks.js';

const SERVICE = 'dadam-workflow-api';
const VERSION = '0.1.0';

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * 응답을 막지 않고 뒤에서 돌린다 (ctx.waitUntil). ctx 가 없으면 기다린다.
 * job 은 던지지 않는 일이어야 한다 (앱 알림 넣기 — src/push/hooks.js).
 */
async function afterResponse(ctx, job) {
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else await job;
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

  const { snapshot, reused, money } = await createSnapshot(env, {
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
        // B4: 재단 배치 원판 장수. 배치를 안 보냈거나 DB 컬럼이 없으면 null
        sheet_count: snapshot.sheet_count === undefined ? null : snapshot.sheet_count,
        // W11-3 이후 채워짐. 원가 · 수금 권한이 없으면 원가 · 마진 칸을 뺀다
        quote: quoteForViewer(snapshot.quote_payload, money),
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
  const snapshot = await getSnapshotForViewer(env, { snapshotId: params.snapshotId, user });
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

// ===== CAD 산출물 (PR16b, cad-artifacts.js) =====

async function handleGetCadAssembly(request, env, { params, user }) {
  const data = await getFrozenAssembly(env, { designId: params.designId, user });
  return jsonResponse(request, env, { success: true, data });
}

async function handleUploadCadArtifact(request, env, { params, user }) {
  const kind = new URL(request.url).searchParams.get('kind') || 'cad';
  const bytes = new Uint8Array(await request.arrayBuffer());
  const { artifact, reused } = await uploadCadArtifact(env, { snapshotId: params.snapshotId, user, kind, bytes });
  return jsonResponse(request, env, { success: true, data: { artifact, reused } }, reused ? 200 : 201);
}

async function handleListCadArtifacts(request, env, { params, user }) {
  const data = await listCadArtifacts(env, { snapshotId: params.snapshotId, user });
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
        // 이번 발행으로 대체된 구 리비전 수. 재발행이면 보통 1 이상이고,
        // 그만큼의 옛 공유 링크가 닫혔다는 뜻이다 (화면이 그대로 안내한다).
        superseded_count: result.superseded_count,
        superseded_closed_count: result.superseded_closed_count,
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
  // 문서 행 그대로 — 원가 · 수금 권한이 없으면 render_payload.quote 의 원가 · 마진만 뺀다
  const { doc, snapshot, money } = await getDocumentForOwner(env, {
    documentId: params.documentId,
    user,
  });
  return jsonResponse(request, env, {
    success: true,
    data: { ...documentForViewer(doc, money), snapshot_rev: snapshot.rev, snapshot_content_hash: snapshot.content_hash },
  });
}

/**
 * 내부용 인쇄 화면. 작업지시서는 여기서 연다.
 * 접근은 설계 접근 규칙 그대로 — 관리자는 본사 설계 문서를 연다 (보관함에서 남의 작업지시서 — work-reports-archive.plan.md §5),
 * 협력업체 설계 문서는 열지 못한다. 인쇄물에는 원가 · 마진이 없다.
 */
async function getDocumentForPrint(env, { documentId, user }) {
  return getDocumentForOwner(env, { documentId, user });
}

async function handlePrintDocument(request, env, { params, user }) {
  const { doc, snapshot } = await getDocumentForPrint(env, {
    documentId: params.documentId,
    user,
  });
  // 꾸러미 (work-order-stage.plan.md §4.3): ?pack=cut|assembly|door|labels|all — 같은 동결 문서에서 섹션만 고른다
  const pack = normalizePack(new URL(request.url).searchParams.get('pack'));
  if (!pack) {
    throw new ValidationError(`pack 은 ${Object.keys(WORK_ORDER_PACKS).join(', ')} 중 하나여야 합니다`);
  }
  // B5: 작업지시서 표지의 정면 렌더는 인쇄 시점에 서명 URL(1시간)을 만든다
  const assets = await resolvePrintAssets(env, doc);
  // 상판 발주 요청서 — 발주 마감(설치 − 4근무일) · 재질별 업체 · 가전 모델 타공은 인쇄 시점에 읽는다
  const top = doc.doc_type === 'work_order' && (pack === 'top' || pack === 'all') ? await loadCountertopContext(env, { doc, snapshot }) : null;
  return htmlResponse(request, env, renderDocument(doc, snapshot, { toolbar: true, pack, top, ...assets }));
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
  // CAD 베타: 고객용 외관 GLB (관리자가 동결본 GLB 를 지었을 때만). 3D 는 덤이라 실패해도 확인서는 연다
  let exteriorGlbUrl = null;
  if (doc.doc_type === 'customer_confirmation') {
    try {
      exteriorGlbUrl = await customerExteriorUrl(env, doc.snapshot_id);
    } catch (err) {
      console.error('exterior glb url failed:', err && err.message);
    }
  }

  return jsonResponse(request, env, {
    success: true,
    data: {
      // 문서 본문만. 승인 폼은 confirm.html 이 iframe 바깥에 그린다.
      html: renderDocument(doc, snapshot, { toolbar: false }),
      // 외관 3D (서명 URL 1시간) — confirm.html 이 iframe 바깥에 뷰어로 그린다. 없으면 null
      exterior_glb_url: exteriorGlbUrl,
      doc_no: doc.doc_no,
      title: doc.title,
      decision: doc.decision,
      expires_at: doc.expires_at,
    },
  });
}

async function handleGetSiteInfo(request, env, { params, user }) {
  await assertDesignAccess(env, params.designId, user, { money: false });
  const site = await getSiteInfo(env, params.designId);
  return jsonResponse(request, env, { success: true, data: site });
}

async function handleSaveSiteInfo(request, env, { params, user }) {
  await assertDesignAccess(env, params.designId, user, { money: false });
  const body = (await readJson(request)) || {};
  const saved = await saveSiteInfo(env, params.designId, body);
  return jsonResponse(request, env, { success: true, data: saved });
}

async function handleCreateOrder(request, env, { params, user, ctx }) {
  const { order, reused } = await createOrderFromDocument(env, {
    documentId: params.documentId,
    user,
  });
  // 새 수주면 생산 계획을 다시 돌려 대표에게 인력 추천을 보낸다. 응답을 막지 않고, 실패해도 수주는 그대로다.
  // 제안은 본사 Slack 으로 나가므로 본사 수주일 때만.
  if (!reused && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(
      (async () => {
        if (!(await isHqWork(env, { companyId: order.company_id }))) return;
        await proposePlan(env, {
          user,
          trigger: 'order_created',
          orderId: order.id,
          triggerLabel: `새 수주 ${order.customer_name ? order.customer_name + ' · ' : ''}${order.order_no}`,
        });
      })().catch((e) => console.error('production proposal failed:', e && e.message)),
    );
  }
  return jsonResponse(request, env, { success: true, data: { ...order, reused } }, reused ? 200 : 201);
}

// ── 생산 계획 · 인력 추천 ──
/** 본사 설계 · 수주의 일인가 — 생산 계획 · 제안은 본사 Slack 으로 나간다. companyId 를 모르면 설계에서 읽는다 */
async function isHqWork(env, { companyId = null, designId = null }) {
  const hq = await hqCompanyId(env);
  if (companyId) return companyId === hq;
  const design = designId ? await selectOne(env, 'designs', { id: `eq.${designId}`, select: 'company_id' }) : null;
  return Boolean(design) && design.company_id === hq;
}

/**
 * 계획에 영향을 주는 변경(설치 일정 등록·변경, 수주 취소 · 되살리기) 뒤에 응답을 막지 않고 다시 계획한다.
 * 본사 설계 · 수주의 변경일 때만 (scope: { companyId } 또는 { designId }).
 * 실패는 로그만 남긴다 — 원래 요청(일정·수주 저장)은 이미 끝났다.
 */
function replanLater(env, ctx, user, triggerLabel, scope) {
  if (!ctx || typeof ctx.waitUntil !== 'function') return;
  ctx.waitUntil(
    (async () => {
      if (!(await isHqWork(env, scope))) return;
      await proposePlan(env, { user, trigger: 'manual', triggerLabel });
    })().catch((e) => console.error('production replan failed:', e && e.message)),
  );
}

async function handleGetProductionPlan(request, env, { user }) {
  // 계획 · 제안은 본사 일 — 협력업체 구성원은 403 not_hq (생산 화면은 설정만 보여 준다)
  await assertHqProduction(env, user);
  const url = new URL(request.url);
  const data = await computePlan(env, { user, today: url.searchParams.get('today') || undefined });
  return jsonResponse(request, env, { success: true, data });
}

async function handleCreateProposal(request, env, { user }) {
  // 제안은 본사 Slack 으로 나간다 — 협력업체 구성원이면 제안도 Slack 도 만들지 않는다 (403 not_hq)
  await assertHqProduction(env, user);
  const data = await proposePlan(env, { user, trigger: 'manual', triggerLabel: '수동 재계산' });
  return jsonResponse(request, env, { success: true, data }, 201);
}

async function handleListProposals(request, env, { user }) {
  const url = new URL(request.url);
  const items = await listProposals(env, { user, status: url.searchParams.get('status'), from: url.searchParams.get('from') });
  return jsonResponse(request, env, { success: true, data: { items } });
}

// ── 작업 지시 보고 보관함 (work-reports-archive.plan.md §4) ──
function queryOf(request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

async function handleListReports(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await listReports(env, { user, query: queryOf(request) }) });
}

async function handleReportSummary(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await reportSummary(env, { user, query: queryOf(request) }) });
}

async function handleGetReport(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: await getReport(env, { user, id: params.reportId }) });
}

async function handlePrintReport(request, env, { params, user }) {
  const report = await getReport(env, { user, id: params.reportId });
  return htmlResponse(request, env, renderReportPrint(report, { live: report.live }));
}

async function handleUpdateReport(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await updateReportMeta(env, { user, id: params.reportId, body }) });
}

async function handleCreateOutsourceOrder(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await createOutsourceOrder(env, { user, documentId: params.documentId, body }) }, 201);
}

async function handleListOutsourceOrders(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: { items: await listOutsourceOrders(env, { user, documentId: params.documentId }) } });
}

async function handleCreateNote(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await createNote(env, { user, body }) }, 201);
}

async function handleBackfillReports(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await backfillReports(env, { user }) });
}

async function handleGetProposal(request, env, { params, user }) {
  const data = await getProposal(env, { user, proposalId: params.proposalId });
  return jsonResponse(request, env, { success: true, data });
}

async function handleDecideProposal(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const data = await decideProposal(env, { user, proposalId: params.proposalId, body });
  return jsonResponse(request, env, { success: true, data });
}

async function handleListAssignments(request, env, { user }) {
  const url = new URL(request.url);
  const items = await listAssignments(env, { user, from: url.searchParams.get('from') });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleGetProductionSettings(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await getSettings(env, { user }) });
}

// ── 작업자 링크 · 실측 기록 · 보정 ──
async function handleCreateWorkerLink(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await createWorkerLink(env, { user, body }) }, 201);
}

async function handleListWorkerLinks(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: { items: await listWorkerLinks(env, { user }) } });
}

async function handleRevokeWorkerLink(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: await revokeWorkerLink(env, { user, linkId: params.linkId }) });
}

async function handleListWorklogs(request, env, { user }) {
  const url = new URL(request.url);
  return jsonResponse(request, env, { success: true, data: { items: await listWorklogs(env, { user, from: url.searchParams.get('from') }) } });
}

async function handleGetCalibration(request, env, { user }) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  return jsonResponse(request, env, { success: true, data: await getCalibration(env, { user, days }) });
}

async function handleApplyCalibration(request, env, { user }) {
  const body = (await readJson(request)) || {};
  const roles = Array.isArray(body.roles) ? body.roles : null;
  return jsonResponse(request, env, { success: true, data: await applyCalibration(env, { user, roles }) });
}

/** 작업자 화면 — 계정 없이 X-Worker-Token 으로. */
async function workerFrom(request, env) {
  return resolveWorker(env, request.headers.get('X-Worker-Token') || '');
}

async function handleWorkerToday(request, env) {
  const link = await workerFrom(request, env);
  return jsonResponse(request, env, { success: true, data: await workerToday(env, { link }) });
}

async function handleWorkerLog(request, env) {
  const link = await workerFrom(request, env);
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await addWorklog(env, { link, body }) }, 201);
}

async function handleWorkerAssignmentDone(request, env, { params }) {
  const link = await workerFrom(request, env);
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await markAssignmentDone(env, { link, assignmentId: params.assignmentId, done: body.done !== false }) });
}

/** 「내 계정에 잇기」 — 로그인(JWT) + 이 기기의 생산 링크(X-Worker-Token) → 공장 배정 (work/factory.js) */
async function handleFactoryLink(request, env, { user }) {
  const data = await linkFactoryAccount(env, { user, token: request.headers.get('X-Worker-Token') || '' });
  return jsonResponse(request, env, { success: true, data }, 201, NO_STORE);
}

async function handleMonthlySummary(request, env, { user }) {
  // 월 고정비는 본사 설정이다 — 본사 대표 · 실장 · 관리자만 (아니면 403 not_money). 월 마감 cron 은 이 경로를 거치지 않는다
  await assertHqMoney(env, user);
  const url = new URL(request.url);
  // 본사 수주 전부 (누가 만든 설계든) — 월 마감 보고(cron)는 예전처럼 설계 주인별
  return jsonResponse(request, env, { success: true, data: await getMonthlySummary(env, { user, month: url.searchParams.get('month'), scope: 'hq' }) });
}

/** 업체 장부 요약 — 그 업체 대표 · 실장만 (src/books.js). 금액이 담겨 캐시에 남기지 않는다 */
async function handleBooksSummary(request, env, { user }) {
  const url = new URL(request.url);
  return jsonResponse(request, env, { success: true, data: await getBooksSummary(env, { user, month: url.searchParams.get('month') }) }, 200, NO_STORE);
}

// ===== 회계장부 (src/ledger/) — 금액 · 사진 상태가 담겨 캐시에 남기지 않는다 =====

async function handleLedgerMe(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await ledgerMe(env, { user, company }) }, 200, NO_STORE);
}

async function handleLedgerAccounts(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await listAccounts(env, { user, company }) }, 200, NO_STORE);
}

async function handleLedgerOrders(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await listLedgerOrders(env, { user }) }, 200, NO_STORE);
}

async function handleLedgerBook(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await getBook(env, {
    user,
    company: q.get('company') || undefined,
    month: q.get('month'),
    from: q.get('from'),
    to: q.get('to'),
    includeVoid: q.get('include_void') === '1',
  });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleGetLedgerSettings(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await getLedgerSettings(env, { user, company }) }, 200, NO_STORE);
}

async function handlePutLedgerSettings(request, env, { user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await putLedgerSettings(env, { user, body }) }, 200, NO_STORE);
}

async function handleCreateLedgerEntry(request, env, { user }) {
  const body = await readJson(request);
  const { entry, reused } = await createEntry(env, { user, body, idempotencyKey: request.headers.get('X-Idempotency-Key') });
  return jsonResponse(request, env, { success: true, data: { entry, reused } }, reused ? 200 : 201, NO_STORE);
}

async function handleVoidLedgerEntry(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await voidEntry(env, { user, entryId: params.id, body }) }, 200, NO_STORE);
}

async function handleCorrectLedgerEntry(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await correctEntry(env, { user, entryId: params.id, body }) }, 201, NO_STORE);
}

async function handleUploadLedgerDocument(request, env, { user, ctx }) {
  const { document, reused } = await uploadDocument(env, { user, request, ctx });
  return jsonResponse(request, env, { success: true, data: { document, reused } }, reused ? 200 : 201, NO_STORE);
}

async function handleListLedgerDocuments(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await listLedgerDocuments(env, {
    user,
    company: q.get('company') || undefined,
    status: q.get('status'),
    mine: q.get('mine') === '1',
    before: q.get('before'),
    limit: q.get('limit'),
  });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

// 사진 확인 (src/ledger/review.js) — 읽은 칸 · 금액 · 서명 주소가 담겨 캐시에 남기지 않는다

async function handleLedgerReview(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await listReview(env, {
    user,
    company: q.get('company') || undefined,
    status: q.get('status'),
    before: q.get('before'),
    limit: q.get('limit'),
  });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handlePostLedgerDocument(request, env, { params, user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await postDocument(env, { user, documentId: params.id, body }) }, 201, NO_STORE);
}

async function handlePostLedgerBatch(request, env, { user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await postBatch(env, { user, body }) }, 200, NO_STORE);
}

async function handleReturnLedgerDocument(request, env, { params, user, ctx }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await decideDocument(env, { user, documentId: params.id, body, status: 'returned', ctx }) }, 200, NO_STORE);
}

async function handleRejectLedgerDocument(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await decideDocument(env, { user, documentId: params.id, body, status: 'rejected' }) }, 200, NO_STORE);
}

async function handleRereadLedgerDocument(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: await rereadDocument(env, { user, documentId: params.id }) }, 202, NO_STORE);
}

async function handleLedgerDashboard(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await ledgerDashboard(env, { user, company: q.get('company') || undefined, month: q.get('month') || undefined, months: q.get('months') });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleLedgerReceivables(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await listReceivables(env, { user, company }) }, 200, NO_STORE);
}

async function handleLedgerPayables(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await listPayables(env, { user, company }) }, 200, NO_STORE);
}

/** 월 마감 메모 — ?month= (기본 지난달, 한국 시간) · ?company= 본사 보기 */
async function handleLedgerCloseMemo(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await getCloseMemo(env, { user, company: q.get('company') || undefined, month: q.get('month') || undefined });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleLedgerSuppliers(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await listSupplierModes(env, { user, company }) }, 200, NO_STORE);
}

async function handlePutLedgerSupplier(request, env, { user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await setSupplierMode(env, { user, body }) }, 200, NO_STORE);
}

async function handleHoldLedgerDocuments(request, env, { user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await holdDocuments(env, { user, body }) }, 200, NO_STORE);
}

async function handleUnholdLedgerDocuments(request, env, { user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await holdDocuments(env, { user, body, release: true }) }, 200, NO_STORE);
}

async function handleLedgerHeld(request, env, { user }) {
  const company = new URL(request.url).searchParams.get('company') || undefined;
  return jsonResponse(request, env, { success: true, data: await listHeld(env, { user, company }) }, 200, NO_STORE);
}

async function handleLedgerHeldEntries(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await supplierEntries(env, { user, company: q.get('company') || undefined, bizNo: q.get('biz_no'), nameKey: q.get('name_key') });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleAttachLedgerStatements(request, env, { params, user }) {
  const body = await readJson(request);
  return jsonResponse(request, env, { success: true, data: await attachStatements(env, { user, entryId: params.id, body }) }, 200, NO_STORE);
}

async function handleBrief(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await getBrief(env, { user }) }, 200, NO_STORE);
}

async function handleLedgerNotices(request, env, { user }) {
  const q = new URL(request.url).searchParams;
  const data = await listNotices(env, { user, company: q.get('company') || undefined, limit: q.get('limit') });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleLedgerNoticesSeen(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await markNoticesSeen(env, { user, body }) }, 200, NO_STORE);
}

async function handleBusinessStatus(request, env, { user }) {
  const bizNo = new URL(request.url).searchParams.get('biz_no');
  return jsonResponse(request, env, { success: true, data: await businessStatus(env, { user, bizNo }) }, 200, NO_STORE);
}

// 경영 대시보드 (Claude 프로젝트 문서 "다담 경영 대시보드" 1단계) — 관리자만, 회사 전체
async function handleManagementSummary(request, env, { user }) {
  const url = new URL(request.url);
  return jsonResponse(request, env, { success: true, data: await getManagementSummary(env, { user, month: url.searchParams.get('month') }) });
}

async function handleSaveProductionSettings(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await saveSettings(env, { user, body }) });
}

async function handleListOrders(request, env, { user }) {
  const url = new URL(request.url);
  const items = await listOrders(env, { user, designId: url.searchParams.get('design_id') || null });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleGetOrder(request, env, { params, user }) {
  // 원가 · 마진 · 수금 · 재작업 비용은 원가 · 수금 권한(대표 · 실장 · 본사 주인 · 관리자)이 있을 때만 싣는다
  const { money, ...data } = await getOrder(env, { orderId: params.orderId, user });
  // 재작업 · A/S — 표가 아직 없으면(2단계 SQL 전) null 이고 화면이 안내를 띄운다
  data.reworks = reworksForViewer(await listReworks(env, params.orderId), money);
  // 설치 후 한 문항 — 같은 방식으로 표가 없으면 null
  data.feedback = await getFeedback(env, params.orderId);
  // 수금 일정 — 표가 없으면 null
  if (money) data.payments = await listPayments(env, params.orderId, { online: true });
  return jsonResponse(request, env, { success: true, data });
}

async function handleAddPayment(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const data = await addPayment(env, { orderId: params.orderId, user, body, idempotencyKey: request.headers.get('X-Idempotency-Key') });
  return jsonResponse(request, env, { success: true, data }, data.reused ? 200 : 201);
}

async function handleUpdatePayment(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await updatePayment(env, { orderId: params.orderId, paymentId: params.paymentId, user, body }) });
}

async function handleDeletePayment(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: await deletePayment(env, { orderId: params.orderId, paymentId: params.paymentId, user }) });
}

async function handleUpdateCostDates(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await updateCostDates(env, { orderId: params.orderId, costId: params.costId, user, body }) });
}

async function handleCreateOkr(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await createOkr(env, { user, body }) }, 201);
}

async function handleUpdateOkr(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await updateOkr(env, { user, id: params.id, body }) });
}

async function handleDeleteOkr(request, env, { params, user }) {
  return jsonResponse(request, env, { success: true, data: await deleteOkr(env, { user, id: params.id }) });
}

async function handleListSalesHistory(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await listSalesHistory(env, { user }) });
}

async function handleSaveSalesHistory(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await saveSalesHistory(env, { user, body }) });
}

async function handleAddCashBalance(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await addCashBalance(env, { user, body }) }, 201);
}

async function handleListCounterparties(request, env, { user }) {
  const kind = new URL(request.url).searchParams.get('kind') || null;
  return jsonResponse(request, env, { success: true, data: await listCounterparties(env, { user, kind }) });
}

async function handleCreateCounterparty(request, env, { user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await createCounterparty(env, { user, body }) }, 201);
}

async function handleUpdateCounterparty(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await updateCounterparty(env, { user, id: params.id, body }) });
}

async function handleCreateFeedbackLink(request, env, { params, user }) {
  const data = await createFeedbackLink(env, { orderId: params.orderId, user });
  return jsonResponse(request, env, { success: true, data }, 201);
}

// 고객 공개 — 토큰은 확인서처럼 X-Share-Token 헤더로 (URL 에 두지 않는다)
async function handlePublicFeedback(request, env) {
  const { token } = shareCredentials(request);
  return jsonResponse(request, env, { success: true, data: await openFeedback(env, { token }) });
}

async function handlePublicFeedbackAnswer(request, env) {
  const { token } = shareCredentials(request);
  const body = (await readJson(request)) || {};
  return jsonResponse(request, env, { success: true, data: await answerFeedback(env, { token, body }) });
}

async function handleAddRework(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const row = await addRework(env, { orderId: params.orderId, user, body });
  return jsonResponse(request, env, { success: true, data: row }, 201);
}

async function handleDeleteRework(request, env, { params, user }) {
  const out = await deleteRework(env, { orderId: params.orderId, reworkId: params.reworkId, user });
  return jsonResponse(request, env, { success: true, data: out });
}

async function handleUpdateOrder(request, env, { params, user, ctx }) {
  const patch = (await readJson(request)) || {};
  const { order, event, pending } = await updateOrder(env, { orderId: params.orderId, user, patch });
  // 대표 승인이 필요한 바꾸기를 대표가 아닌 사람이 했다 — 요청만 남았고 수주는 그대로다. 대표들에게 앱 알림
  if (pending) {
    await afterResponse(ctx, notifyOrderRequest(env, event));
    return jsonResponse(request, env, { success: true, data: event }, 202);
  }
  // 취소되면 그 주문이 차지하던 공장 시간이 풀리고, 되살리면 다시 차지한다
  if (event && event.to_status === 'cancelled') {
    replanLater(env, ctx, user, `수주 취소 ${order && order.order_no ? order.order_no : ''}`.trim(), { companyId: order && order.company_id });
  }
  if (event && event.kind === 'revive') replanAfterRevive(env, ctx, user, order);
  return jsonResponse(request, env, { success: true, data: order });
}

/** 되살리기(취소 → 접수)가 적용됐다 — 취소 때처럼 다시 계획한다 (본사 수주일 때만) */
function replanAfterRevive(env, ctx, user, order) {
  replanLater(env, ctx, user, `수주 되살리기 ${order && order.order_no ? order.order_no : ''}`.trim(), { companyId: order && order.company_id });
}

/** 수주 기록 (최근 것 먼저) + 지금 바꿀 수 있는 상태 · 승인 권한 — 수주를 볼 수 있는 사람 누구나 */
async function handleListOrderEvents(request, env, { params, user }) {
  const data = await listOrderEvents(env, { orderId: params.orderId, user });
  return jsonResponse(request, env, { success: true, data });
}

/** 내가 대표인 업체에서 승인을 기다리는 요청 (?state=pending) */
async function handleListOrderRequests(request, env, { user }) {
  const url = new URL(request.url);
  const items = await listOrderRequests(env, { user, state: url.searchParams.get('state') || 'pending' });
  return jsonResponse(request, env, { success: true, data: { items } });
}

/** 대표의 승인 · 반려 — { decision: 'approved' | 'rejected' } */
async function handleDecideOrderEvent(request, env, { params, user, ctx }) {
  const body = (await readJson(request)) || {};
  const data = await decideOrderEvent(env, { eventId: params.eventId, user, decision: body.decision });
  // 승인으로 되살리기가 적용됐다
  if (data.order && data.event && data.event.kind === 'revive' && data.event.state === 'approved') {
    replanAfterRevive(env, ctx, user, data.order);
  }
  // 요청한 사람에게 결과 앱 알림
  await afterResponse(ctx, notifyOrderRequestDecided(env, data.event));
  return jsonResponse(request, env, { success: true, data });
}

async function handleAddCost(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const { cost, reused } = await addCost(env, { orderId: params.orderId, user, body, idempotencyKey: request.headers.get('X-Idempotency-Key') });
  return jsonResponse(request, env, { success: true, data: cost }, reused ? 200 : 201);
}

async function handleDeleteCost(request, env, { params, user }) {
  const out = await deleteCost(env, {
    orderId: params.orderId,
    costId: params.costId,
    user,
  });
  return jsonResponse(request, env, { success: true, data: out });
}

async function handlePublicDecision(request, env, { ctx } = {}) {
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
  // 설계 업체 대표 · 실장 + 설계를 만든 사람에게 앱 알림 (설계 제목 · 고객 이름은 싣지 않는다)
  await afterResponse(ctx, notifyConfirmationDecided(env, doc));

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
  // 설치 일정이 들어오면 생산 마감이 바뀌므로 계획을 다시 돌린다.
  if (Array.isArray(body.items) && body.items.some((it) => it && it.type === 'installation')) {
    replanLater(env, ctx, user, '설치 일정 등록', { designId: params.designId });
  }
  return jsonResponse(request, env, { success: true, data }, 201);
}

async function handleListSchedules(request, env, { params, user }) {
  const items = await listSchedules(env, { designId: params.designId, user });
  return jsonResponse(request, env, { success: true, data: { items } });
}

async function handleUpdateSchedule(request, env, { params, user, ctx }) {
  const patch = (await readJson(request)) || {};
  const row = await updateSchedule(env, { scheduleId: params.scheduleId, user, patch });
  // 이 일정에 작업자를 배정해 두었으면 (src/work/schedule-link.js) 작업 시각 · 취소를 맞추고, 담당 글은 작업자 이름으로 둔다.
  // 맞추기가 실패해도 일정 저장은 그대로다 (다음 읽기에서 다시 맞춘다)
  if (row && (patch.scheduled_at !== undefined || patch.duration_min !== undefined || patch.status !== undefined)) {
    await syncJobWithSchedule(env, ctx, row);
  }
  if (row && patch.assignee_name !== undefined) {
    const name = await keepAssigneeName(env, row);
    if (name !== undefined) row.assignee_name = name;
  }
  // 설치 날짜가 옮겨지거나 취소되면 마감이 바뀐다
  if (row && row.type === 'installation' && (patch.scheduled_at !== undefined || patch.status !== undefined)) {
    replanLater(env, ctx, user, '설치 일정 변경', { designId: row.design_id });
  }
  return jsonResponse(request, env, { success: true, data: row });
}

async function handleResendSlack(request, env, { params, user, ctx }) {
  const data = await resendBatch(env, ctx, { batchId: params.batchId, user });
  return jsonResponse(request, env, { success: true, data });
}

// ===== 상담 확정 · 내 프로젝트 (src/projects.js) =====

/** 관리자 — 본사 상담 일정 확정 + 고객 · 프로젝트 잇기 (상담의 연결 칸은 서버만 바꾼다) */
async function handleAcceptConsultation(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  const data = await acceptConsultation(env, { user, consultationId: params.id, body });
  return jsonResponse(request, env, { success: true, data });
}

// ===== 다담 본사 상담 분배 (관리자, src/distribution/admin.js) — 이름 · 연락처가 담겨 캐시에 남기지 않는다 =====

async function handleConsultInbox(request, env, { user }) {
  const data = await consultInbox(env, { user, query: queryOf(request) });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleConsultCandidates(request, env, { params, user }) {
  const data = await consultCandidates(env, { user, consultationId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 배정 — 업체 대표 · 실장 앱 알림은 응답 뒤에 (실패해도 배정은 그대로) */
async function handleAssignConsultation(request, env, { params, user, ctx }) {
  const body = (await readJson(request)) || {};
  const { data, notice } = await assignConsultation(env, { user, consultationId: params.id, body });
  await afterResponse(ctx, notifyConsultAssigned(env, notice));
  return jsonResponse(request, env, { success: true, data }, 201, NO_STORE);
}

async function handleListCompaniesAdmin(request, env, { user }) {
  const data = await listCompaniesAdmin(env, { user, query: queryOf(request) });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleGetCompanyEvaluation(request, env, { params, user }) {
  const data = await getCompanyEvaluation(env, { user, companyId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handlePutCompanyEvaluation(request, env, { params, user }) {
  const body = await readJson(request);
  const data = await putCompanyEvaluation(env, { user, companyId: params.id, body });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

// ===== 업체 쪽 상담 (src/distribution/company.js) — 이름 · 연락처가 담겨 캐시에 남기지 않는다 =====

async function handleCompanyConsults(request, env, { user }) {
  const data = await listCompanyConsults(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 상담 연출컷 첫 장 — 이미지 그대로 (앱이 본인 토큰으로 받아 blob 주소로 그린다) */
async function handleCompanyConsultImage(request, env, { params, user }) {
  const { bytes, mime } = await readCompanyConsultImage(env, { user, consultationId: params.id });
  return new Response(bytes, {
    status: 200,
    headers: { ...corsHeaders(request, env), ...NO_STORE, 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' },
  });
}

async function handleAcceptCompanyConsult(request, env, { params, user }) {
  const data = await acceptCompanyConsult(env, { user, consultationId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 못 받음 — 본문 없이 204 */
async function handleDeclineCompanyConsult(request, env, { params, user }) {
  const body = (await readJson(request)) || {};
  await declineCompanyConsult(env, { user, consultationId: params.id, body });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), ...NO_STORE } });
}

async function handleGetServiceSettings(request, env, { user }) {
  const data = await getServiceSettings(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handlePutServiceSettings(request, env, { user }) {
  const body = await readJson(request);
  const data = await putServiceSettings(env, { user, body });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleMyScore(request, env, { user }) {
  const data = await myScore(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

// ===== 업체 고객 · 프로젝트 (src/company-projects.js) — 고객 이름 · 전화가 담겨 캐시에 남기지 않는다 =====

// ===== 다담 본사 › 업체관리 › 등록 업체 (src/hq-companies.js) — 본사 대표 · 실장, 보기만 =====

async function handleHqCompanies(request, env, { user }) {
  const data = await listHqCompanies(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleHqCompanyProjects(request, env, { params, user }) {
  const data = await listHqCompanyProjects(env, { user, companyId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleHqCompanyMembers(request, env, { params, user }) {
  const data = await listHqCompanyMembers(env, { user, companyId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleCompanyProjects(request, env, { user }) {
  const data = await listCompanyProjects(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

async function handleCreateCompanyProject(request, env, { user }) {
  const body = await readJson(request);
  const data = await createCompanyProject(env, { user, body, idempotencyKey: request.headers.get('X-Idempotency-Key') });
  return jsonResponse(request, env, { success: true, data }, data.reused ? 200 : 201, NO_STORE);
}

async function handleCompanyDesigns(request, env, { user }) {
  return jsonResponse(request, env, { success: true, data: await listCompanyDesigns(env, { user }) }, 200, NO_STORE);
}

async function handleLinkDesignProject(request, env, { params, user }) {
  const body = await readJson(request);
  const data = await linkDesignProject(env, { user, designId: params.designId, body });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 프로젝트 담당자 정하기 · 비우기 — 대표 · 실장 (src/company-assignee.js) */
async function handleSetProjectAssignee(request, env, { params, user }) {
  const body = await readJson(request);
  const data = await setProjectAssignee(env, { user, projectId: params.id, body });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 담당자 후보 · 추천 차례 — 대표 · 실장 */
async function handleAssigneeCandidates(request, env, { params, user }) {
  const data = await assigneeCandidates(env, { user, projectId: params.id });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 로그인한 사람의 고객 행에 걸린 프로젝트 — 금액 · 일정이 담겨 캐시에 남기지 않는다 */
async function handleMyProjects(request, env, { user }) {
  // data 는 프로젝트 배열 그대로 (앱 화면 계약)
  const data = await listMyProjects(env, { user });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

// ===== 작업자 포털 (docs/01-plan/worker-portal-contract.md §3) =====

/** 작업자 이름 · 휴대폰이 담길 수 있어 중간 캐시 · 브라우저 캐시에 남기지 않는다 */
const NO_STORE = { 'Cache-Control': 'no-store, private' };

/** src/work/* 본문을 그대로 읽는 함수 (env, { user, params, request }) → data (작업자 필수 확인 사진 — work/checks.js) */
function rawRoute(fn, status = 200) {
  return async (request, env, { params, user }) => jsonResponse(request, env, { success: true, data: await fn(env, { user, params, request }) }, status, NO_STORE);
}

/** src/work/* HTML 함수 (env, { user, params, query }) → 인쇄 화면 (작업자 꾸러미 — work/checks.js) */
function htmlRoute(fn) {
  return async (request, env, { params, user }) => htmlResponse(request, env, await fn(env, { user, params, query: queryOf(request) }));
}

/** src/work/* 함수 (env, { user, params, body, query, ctx }) → data 를 라우트 핸들러로 */
function workRoute(fn, status = 200) {
  return async (request, env, { params, user, ctx }) => {
    const body = request.method === 'GET' ? null : (await readJson(request)) || {};
    const data = await fn(env, { user, params, body, query: queryOf(request), ctx });
    return jsonResponse(request, env, { success: true, data }, status, NO_STORE);
  };
}

/** 간편 플래너 설계 저장 — 본문을 상한까지만 읽는다 (설계 5MB) */
async function handleSavePlannerDraft(request, env, { user }) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > SAVE_BODY_MAX_BYTES) throw new TooLargeError('설계가 너무 큽니다');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > SAVE_BODY_MAX_BYTES) throw new TooLargeError('설계가 너무 큽니다');
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const data = await saveDraft(env, { user, body: body || {} });
  return jsonResponse(request, env, { success: true, data }, 200, NO_STORE);
}

/** 간편 플래너 설계 사진 — 이미지 바이트 그대로 (비공개, 캐시 없음) */
async function handleReadPlannerPhoto(request, env, { params, user }) {
  const { bytes, mime } = await readPlannerPhoto(env, { user, params });
  return new Response(bytes, { status: 200, headers: { ...corsHeaders(request, env), ...NO_STORE, 'Content-Type': mime } });
}

// ===== 라우팅 =====

const router = createRouter([
  { method: 'GET', path: '/health', auth: 'none', handler: handleHealth },

  // 앱 알림 (web push) — 공개 키 · 이 기기 등록 · 지우기 (src/push/routes.js)
  { method: 'GET',    path: '/push/key',           auth: 'none', handler: handlePushKey },
  { method: 'POST',   path: '/push/subscriptions', auth: 'jwt',  handler: handleSavePushSubscription },
  { method: 'DELETE', path: '/push/subscriptions', auth: 'jwt',  handler: handleDeletePushSubscription },

  { method: 'POST', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleCreateSnapshot },
  { method: 'POST', path: '/planner/designs', auth: 'jwt', handler: workRoute(receivePlannerDesign, 201) },
  // 간편 플래너 웹판 저장소 (src/planner-drafts.js, DB 0046)
  { method: 'GET',    path: '/planner/access',                     auth: 'jwt', handler: workRoute(plannerAccess) },
  { method: 'GET',    path: '/planner/drafts',                     auth: 'jwt', handler: workRoute(listDrafts) },
  { method: 'POST',   path: '/planner/drafts',                     auth: 'jwt', handler: handleSavePlannerDraft },
  { method: 'GET',    path: '/planner/drafts/:id',                 auth: 'jwt', handler: workRoute(getDraft) },
  { method: 'POST',   path: '/planner/drafts/:id/discard',         auth: 'jwt', handler: workRoute(discardDraft) },
  { method: 'GET',    path: '/planner/drafts/:id/app-state',       auth: 'jwt', handler: workRoute(getAppState) },
  { method: 'PUT',    path: '/planner/drafts/:id/app-state',       auth: 'jwt', handler: workRoute(putAppState) },
  { method: 'POST',   path: '/planner/drafts/:id/photos',          auth: 'jwt', handler: rawRoute(addPlannerPhoto, 201) },
  { method: 'GET',    path: '/planner/drafts/:id/photos/:file',    auth: 'jwt', handler: handleReadPlannerPhoto },
  { method: 'DELETE', path: '/planner/drafts/:id/photos/:file',    auth: 'jwt', handler: workRoute(deletePlannerPhoto) },
  { method: 'GET',    path: '/planner/my-modules',                 auth: 'jwt', handler: workRoute(listMyModules) },
  { method: 'POST',   path: '/planner/my-modules',                 auth: 'jwt', handler: workRoute(saveMyModule, 201) },
  { method: 'DELETE', path: '/planner/my-modules/:id',             auth: 'jwt', handler: workRoute(deleteMyModule) },
  { method: 'GET',    path: '/planner/recommend',                  auth: 'jwt', handler: workRoute(recommendOf) },
  { method: 'GET', path: '/designs/:designId/snapshots', auth: 'jwt', handler: handleListSnapshots },
  { method: 'GET', path: '/snapshots/:snapshotId', auth: 'jwt', handler: handleGetSnapshot },
  { method: 'POST', path: '/snapshots/:snapshotId/quote', auth: 'jwt', handler: handleQuotePreview },
  { method: 'GET', path: '/designs/:designId/cad-assembly', auth: 'jwt', handler: handleGetCadAssembly },
  { method: 'POST', path: '/snapshots/:snapshotId/cad-artifacts', auth: 'jwt', handler: handleUploadCadArtifact },
  { method: 'GET', path: '/snapshots/:snapshotId/cad-artifacts', auth: 'jwt', handler: handleListCadArtifacts },

  { method: 'POST', path: '/snapshots/:snapshotId/documents', auth: 'jwt', handler: handleIssueDocument },
  { method: 'GET', path: '/designs/:designId/documents', auth: 'jwt', handler: handleListDocuments },
  { method: 'GET', path: '/documents/:documentId', auth: 'jwt', handler: handleGetDocument },
  { method: 'GET', path: '/documents/:documentId/print', auth: 'jwt', handler: handlePrintDocument },
  { method: 'POST', path: '/documents/:documentId/revoke', auth: 'jwt', handler: handleRevokeDocument },
  { method: 'GET', path: '/documents/:documentId/outsource-orders', auth: 'jwt', handler: handleListOutsourceOrders },
  { method: 'POST', path: '/documents/:documentId/outsource-orders', auth: 'jwt', handler: handleCreateOutsourceOrder },

  // CD-4: 현장 정보 — 설치 작업지시서의 입력
  { method: 'GET', path: '/designs/:designId/site-info', auth: 'jwt', handler: handleGetSiteInfo },
  { method: 'PUT', path: '/designs/:designId/site-info', auth: 'jwt', handler: handleSaveSiteInfo },

  { method: 'POST', path: '/designs/:designId/schedules', auth: 'jwt', handler: handleCreateSchedules },
  { method: 'GET', path: '/designs/:designId/schedules', auth: 'jwt', handler: handleListSchedules },
  // 설계를 프로젝트에 잇기 · 풀기 (그 업체 대표 · 실장, 협력업체 설계는 만든 사람도)
  { method: 'PUT', path: '/designs/:designId/project', auth: 'jwt', handler: handleLinkDesignProject },
  { method: 'PATCH', path: '/schedules/:scheduleId', auth: 'jwt', handler: handleUpdateSchedule },
  { method: 'POST', path: '/schedules/batches/:batchId/notify', auth: 'jwt', handler: handleResendSlack },

  // CD-5: ERP — 수주 · 실적 원가
  { method: 'POST',   path: '/documents/:documentId/order', auth: 'jwt', handler: handleCreateOrder },
  { method: 'GET',    path: '/orders',                      auth: 'jwt', handler: handleListOrders },
  { method: 'GET',    path: '/orders/:orderId',             auth: 'jwt', handler: handleGetOrder },
  { method: 'PATCH',  path: '/orders/:orderId',             auth: 'jwt', handler: handleUpdateOrder },
  // 수주 상태 기록 · 대표 승인 (src/order-events.js)
  { method: 'GET',    path: '/orders/:orderId/events',      auth: 'jwt', handler: handleListOrderEvents },
  // 수주 완료 보고 (src/order-reports.js, DB 0043)
  { method: 'GET',    path: '/orders/:orderId/reports',     auth: 'jwt', handler: workRoute(listOrderReports) },
  { method: 'POST',   path: '/orders/:orderId/reports',     auth: 'jwt', handler: workRoute(addOrderReport, 201) },
  { method: 'POST',   path: '/orders/:orderId/reports/photo', auth: 'jwt', handler: rawRoute(addReportPhoto, 201) },
  { method: 'GET',    path: '/admin/order-reports',         auth: 'jwt', handler: workRoute(listReportsAdmin) },
  // 고객 A/S 접수 (src/as-requests.js, DB 0045)
  { method: 'POST',   path: '/me/orders/:orderId/as-requests/photo', auth: 'jwt', handler: rawRoute(addAsPhoto, 201) },
  { method: 'POST',   path: '/me/orders/:orderId/as-requests', auth: 'jwt', handler: workRoute(addAsRequest, 201) },
  { method: 'GET',    path: '/me/as-requests',              auth: 'jwt', handler: workRoute(listMyAsRequests) },
  { method: 'POST',   path: '/me/as-requests/:id/cancel',   auth: 'jwt', handler: workRoute(cancelMyAsRequest) },
  { method: 'GET',    path: '/company/as-requests',         auth: 'jwt', handler: workRoute(listCompanyAsRequests) },
  { method: 'POST',   path: '/company/as-requests/:id/receive', auth: 'jwt', handler: workRoute(receiveAsRequest) },
  { method: 'POST',   path: '/company/as-requests/:id/done', auth: 'jwt', handler: workRoute(finishAsRequest) },
  { method: 'GET',    path: '/admin/as-requests',           auth: 'jwt', handler: workRoute(listAsAdmin) },
  { method: 'GET',    path: '/orders/:orderId/checks',      auth: 'jwt', handler: workRoute(getOrderChecks) },
  { method: 'GET',    path: '/order-requests',              auth: 'jwt', handler: handleListOrderRequests },
  { method: 'POST',   path: '/order-events/:eventId/decide', auth: 'jwt', handler: handleDecideOrderEvent },
  { method: 'POST',   path: '/orders/:orderId/costs',       auth: 'jwt', handler: handleAddCost },
  { method: 'DELETE', path: '/orders/:orderId/costs/:costId', auth: 'jwt', handler: handleDeleteCost },
  { method: 'PATCH',  path: '/orders/:orderId/costs/:costId', auth: 'jwt', handler: handleUpdateCostDates },
  { method: 'POST',   path: '/orders/:orderId/payments',    auth: 'jwt', handler: handleAddPayment },
  { method: 'PATCH',  path: '/orders/:orderId/payments/:paymentId', auth: 'jwt', handler: handleUpdatePayment },
  { method: 'DELETE', path: '/orders/:orderId/payments/:paymentId', auth: 'jwt', handler: handleDeletePayment },
  { method: 'POST',   path: '/orders/:orderId/reworks',     auth: 'jwt', handler: handleAddRework },
  { method: 'DELETE', path: '/orders/:orderId/reworks/:reworkId', auth: 'jwt', handler: handleDeleteRework },
  { method: 'POST',   path: '/orders/:orderId/feedback-link', auth: 'jwt', handler: handleCreateFeedbackLink },

  // 상담 확정 (관리자, 본사 상담) · 내 프로젝트 (로그인한 고객)
  { method: 'POST', path: '/consultations/:id/accept', auth: 'jwt', handler: handleAcceptConsultation },
  { method: 'GET',  path: '/me/projects',              auth: 'jwt', handler: handleMyProjects },

  // 다담 본사 상담 분배 · 업체 평가표 (관리자)
  { method: 'GET',  path: '/admin/consult-inbox',                 auth: 'jwt', handler: handleConsultInbox },
  { method: 'GET',  path: '/admin/consultations/:id/candidates',  auth: 'jwt', handler: handleConsultCandidates },
  { method: 'POST', path: '/admin/consultations/:id/assign',      auth: 'jwt', handler: handleAssignConsultation },
  { method: 'GET',  path: '/admin/companies',                     auth: 'jwt', handler: handleListCompaniesAdmin },
  { method: 'GET',  path: '/admin/companies/:id/evaluation',      auth: 'jwt', handler: handleGetCompanyEvaluation },
  { method: 'PUT',  path: '/admin/companies/:id/evaluation',      auth: 'jwt', handler: handlePutCompanyEvaluation },

  // 업체 쪽 상담 — 목록 · 설정 읽기는 구성원, 받기 · 못 받음 · 설정 고치기 · 내 점수는 대표 · 실장
  { method: 'GET',  path: '/company/consults',                    auth: 'jwt', handler: handleCompanyConsults },
  { method: 'GET',  path: '/company/consults/:id/image',          auth: 'jwt', handler: handleCompanyConsultImage },
  { method: 'POST', path: '/company/consults/:id/accept',         auth: 'jwt', handler: handleAcceptCompanyConsult },
  { method: 'POST', path: '/company/consults/:id/decline',        auth: 'jwt', handler: handleDeclineCompanyConsult },
  { method: 'GET',  path: '/company/service-settings',            auth: 'jwt', handler: handleGetServiceSettings },
  { method: 'PUT',  path: '/company/service-settings',            auth: 'jwt', handler: handlePutServiceSettings },
  { method: 'GET',  path: '/company/my-score',                    auth: 'jwt', handler: handleMyScore },
  // 업체 고객 · 프로젝트 — 목록은 구성원, 만들기는 대표 · 실장 (다담 공장 · Manager 이상 협력업체)
  { method: 'GET',  path: '/hq/companies',                        auth: 'jwt', handler: handleHqCompanies },
  { method: 'GET',  path: '/hq/companies/:id/projects',           auth: 'jwt', handler: handleHqCompanyProjects },
  { method: 'GET',  path: '/hq/companies/:id/members',            auth: 'jwt', handler: handleHqCompanyMembers },
  { method: 'GET',  path: '/company/projects',                    auth: 'jwt', handler: handleCompanyProjects },
  { method: 'POST', path: '/company/projects',                    auth: 'jwt', handler: handleCreateCompanyProject },
  { method: 'PUT',  path: '/company/projects/:id/assignee',       auth: 'jwt', handler: handleSetProjectAssignee },
  { method: 'GET',  path: '/company/projects/:id/assignee-candidates', auth: 'jwt', handler: handleAssigneeCandidates },
  // 프로젝트의 작업 배정 — 종류 줄(철거 · 재단 · 엣지 · 조립 · 설치 · A/S)마다 작업자 (src/work/project-work.js, DB 0064 · 0065)
  { method: 'GET',   path: '/company/projects/:id/work',          auth: 'jwt', handler: workRoute(listProjectWork) },
  { method: 'POST',  path: '/company/projects/:id/work',          auth: 'jwt', handler: workRoute(assignProjectWork) },
  { method: 'POST',  path: '/company/projects/:id/work/invite',   auth: 'jwt', handler: workRoute(inviteProjectWork, 201) },
  { method: 'PATCH', path: '/company/projects/:id/work/:kind',    auth: 'jwt', handler: workRoute(patchProjectWork) },
  { method: 'GET',  path: '/company/designs',                     auth: 'jwt', handler: handleCompanyDesigns },
  // 업체 견적 목록 — 고객 확인서 모아 읽기 (src/company-quotes.js)
  { method: 'GET',  path: '/company/quotes',                      auth: 'jwt', handler: workRoute((env, a) => listCompanyQuotes(env, a)) },
  // 업체 고객 목록 · 이름 · 전화 고치기 (src/company-customers.js)
  { method: 'GET',  path: '/company/customers',                   auth: 'jwt', handler: workRoute((env, a) => listCompanyCustomers(env, a)) },
  { method: 'PATCH', path: '/company/customers/:id',              auth: 'jwt', handler: workRoute((env, a) => updateCompanyCustomer(env, a)) },
  // 업체 숫자 — 견적 흐름 · 리드타임 (src/company-summary.js)
  { method: 'GET',  path: '/company/summary',                     auth: 'jwt', handler: workRoute((env, a) => getCompanySummary(env, a)) },
  // 근무 일정 — 쉬는 날만 (src/work-shifts.js, DB 0060)
  // 팩토리의 작업자 — 연결 · 초대 · 승인 (src/work/company.js, DB 0064)
  { method: 'GET',   path: '/company/workers',                     auth: 'jwt', handler: workRoute(listCompanyWorkers) },
  { method: 'POST',  path: '/company/workers/invites',             auth: 'jwt', handler: workRoute(createCompanyInvite, 201) },
  { method: 'POST',  path: '/company/workers/invites/:id/revoke',  auth: 'jwt', handler: workRoute(revokeCompanyInvite) },
  { method: 'PATCH', path: '/company/workers/:linkId',             auth: 'jwt', handler: workRoute(patchCompanyWorker) },
  { method: 'GET',  path: '/company/shifts',                      auth: 'jwt', handler: workRoute((env, a) => listShifts(env, a)) },
  { method: 'PUT',  path: '/company/shifts',                      auth: 'jwt', handler: workRoute((env, a) => putShift(env, a)) },
  // 재고 — 판재 · 철물 품목과 입출고 (src/stock.js, DB 0059)
  { method: 'GET',  path: '/stock/items',                         auth: 'jwt', handler: workRoute((env, a) => listStockItems(env, a)) },
  { method: 'POST', path: '/stock/items',                         auth: 'jwt', handler: workRoute((env, a) => createStockItem(env, a), 201) },
  { method: 'PATCH', path: '/stock/items/:id',                    auth: 'jwt', handler: workRoute((env, a) => updateStockItem(env, a)) },
  { method: 'POST', path: '/stock/items/:id/moves',               auth: 'jwt', handler: workRoute((env, a) => addStockMove(env, a), 201) },
  { method: 'GET',  path: '/stock/moves',                         auth: 'jwt', handler: workRoute((env, a) => listStockMoves(env, a)) },
  // 재고 — 자투리 자재 · 라벨 QR · 구매 · 재고 숫자 (src/stock-offcuts.js, DB 0059). labels 는 :id 보다 먼저
  { method: 'GET',  path: '/stock/offcuts',                       auth: 'jwt', handler: workRoute((env, a) => listOffcuts(env, a)) },
  { method: 'POST', path: '/stock/offcuts',                       auth: 'jwt', handler: workRoute((env, a) => createOffcut(env, a), 201) },
  { method: 'POST', path: '/stock/offcuts/labels',                auth: 'jwt', handler: workRoute((env, a) => makeOffcutLabels(env, a)) },
  { method: 'PATCH', path: '/stock/offcuts/:id',                  auth: 'jwt', handler: workRoute((env, a) => updateOffcut(env, a)) },
  { method: 'GET',  path: '/stock/offcuts/:id/events',            auth: 'jwt', handler: workRoute((env, a) => listOffcutEvents(env, a)) },
  { method: 'GET',  path: '/stock/summary',                       auth: 'jwt', handler: workRoute((env, a) => getStockSummary(env, a)) },
  // 재고 구매 발주 — 철물 · 판재 발주 기록과 입고 (src/stock-orders.js, DB 0062). 생산 › 외주 발주(/reports)와 다른 것
  { method: 'GET',  path: '/stock/orders',                        auth: 'jwt', handler: workRoute((env, a) => listStockOrders(env, a)) },
  { method: 'POST', path: '/stock/orders',                        auth: 'jwt', handler: workRoute((env, a) => createStockOrder(env, a), 201) },
  { method: 'POST', path: '/stock/orders/:id/receive',            auth: 'jwt', handler: workRoute((env, a) => receiveStockOrder(env, a)) },
  { method: 'POST', path: '/stock/orders/:id/cancel',             auth: 'jwt', handler: workRoute((env, a) => cancelStockOrder(env, a)) },
  // 작업지시 자재 ↔ 재고 — 수주별 자재 상태 · 짝표 · 수주 자재 출고 · 자투리 후보 (src/stock-needs.js, DB 0063)
  { method: 'GET',  path: '/stock/needs',                         auth: 'jwt', handler: workRoute((env, a) => listStockNeeds(env, a)) },
  { method: 'PUT',  path: '/stock/links',                         auth: 'jwt', handler: workRoute((env, a) => putStockLink(env, a)) },
  { method: 'POST', path: '/stock/needs/:orderId/issue',          auth: 'jwt', handler: workRoute((env, a) => issueStockForOrder(env, a), 201) },
  { method: 'GET',  path: '/stock/needs/:orderId/offcuts',        auth: 'jwt', handler: workRoute((env, a) => listOffcutCandidates(env, a)) },
  { method: 'GET',  path: '/company/schedules',                   auth: 'jwt', handler: workRoute((env, a) => listCompanySchedules(env, a)) },
  // 일정 줄에서 작업자 배정 · 완료 보고 확인 (src/work/schedule-link.js, DB 0064)
  { method: 'GET',  path: '/company/schedules/:id/workers',       auth: 'jwt', handler: workRoute(listScheduleWorkers) },
  { method: 'POST', path: '/company/schedules/:id/workers',       auth: 'jwt', handler: workRoute(assignScheduleWorkers) },
  { method: 'POST', path: '/company/work/assignments/:id/accept',   auth: 'jwt', handler: workRoute(acceptCompanyAssignment) },
  { method: 'POST', path: '/company/work/assignments/:id/revision', auth: 'jwt', handler: workRoute(reviseCompanyAssignment) },
  { method: 'POST', path: '/company/work/assignments/:id/remove',   auth: 'jwt', handler: workRoute(removeCompanyAssignment) },
  // 설치 · A/S 지도 + 표 (src/company-sites.js, DB 0058)
  { method: 'GET',  path: '/company/sites',                       auth: 'jwt', handler: workRoute((env, a) => listCompanySites(env, a)) },
  { method: 'PUT',  path: '/company/sites/geo',                   auth: 'jwt', handler: workRoute(saveSiteGeo) },
  { method: 'PUT',  path: '/company/as-requests/:id/visit',       auth: 'jwt', handler: workRoute(setAsVisit) },

  // Manager 업체 제작 의뢰 (src/production-requests/, DB 0050) — 내기 · 고르기 · 거두기는 Manager 업체 대표 · 실장,
  // 본사 추천은 관리자, 받기 · 못 받음은 고른 팩토리의 대표 · 실장
  { method: 'POST', path: '/production-requests',                 auth: 'jwt', handler: workRoute(createRequest, 201) },
  { method: 'GET',  path: '/production-requests',                 auth: 'jwt', handler: workRoute(listMyRequests) },
  { method: 'GET',  path: '/production-requests/:id',             auth: 'jwt', handler: workRoute(getMyRequest) },
  { method: 'POST', path: '/production-requests/:id/choose',      auth: 'jwt', handler: workRoute(chooseFactory) },
  { method: 'POST', path: '/production-requests/:id/cancel',      auth: 'jwt', handler: workRoute(cancelMyRequest) },
  { method: 'GET',  path: '/admin/production-requests',           auth: 'jwt', handler: workRoute(listRequestsAdmin) },
  { method: 'POST', path: '/admin/production-requests/:id/review', auth: 'jwt', handler: workRoute(reviewRequest) },
  { method: 'GET',  path: '/admin/production-requests/:id/suggestions', auth: 'jwt', handler: workRoute(suggestionsFor) },
  { method: 'POST', path: '/admin/production-requests/:id/recommend', auth: 'jwt', handler: workRoute(recommendFactories, 201) },
  { method: 'GET',  path: '/factory/production-requests',         auth: 'jwt', handler: workRoute(listFactoryRequests) },
  { method: 'POST', path: '/factory/production-requests/:id/accept', auth: 'jwt', handler: workRoute(acceptFactoryRequest) },
  { method: 'POST', path: '/factory/production-requests/:id/decline', auth: 'jwt', handler: workRoute(declineFactoryRequest) },

  // 업체 장부 요약 (그 업체 대표 · 실장)
  { method: 'GET',   path: '/books/summary',      auth: 'jwt', handler: handleBooksSummary },

  // 회계장부 (Agent 업체 — 자격은 company_entitled(DB 0047), 사진 AI 읽기도 Agent. 금액 · 장부는 대표 · 실장, 사진 올리기는 구성원 누구나)
  { method: 'GET',  path: '/ledger/me',                 auth: 'jwt', handler: handleLedgerMe },
  { method: 'GET',  path: '/ledger/accounts',           auth: 'jwt', handler: handleLedgerAccounts },
  { method: 'GET',  path: '/ledger/book',               auth: 'jwt', handler: handleLedgerBook },
  { method: 'GET',  path: '/ledger/orders',             auth: 'jwt', handler: handleLedgerOrders },
  { method: 'GET',  path: '/ledger/settings',           auth: 'jwt', handler: handleGetLedgerSettings },
  { method: 'PUT',  path: '/ledger/settings',           auth: 'jwt', handler: handlePutLedgerSettings },
  { method: 'POST', path: '/ledger/entries',            auth: 'jwt', handler: handleCreateLedgerEntry },
  { method: 'POST', path: '/ledger/entries/:id/void',   auth: 'jwt', handler: handleVoidLedgerEntry },
  { method: 'POST', path: '/ledger/entries/:id/correct', auth: 'jwt', handler: handleCorrectLedgerEntry },
  { method: 'GET',  path: '/ledger/documents',          auth: 'jwt', handler: handleListLedgerDocuments },
  { method: 'POST', path: '/ledger/documents',          auth: 'jwt', handler: handleUploadLedgerDocument },
  { method: 'GET',  path: '/ledger/review',             auth: 'jwt', handler: handleLedgerReview },
  { method: 'POST', path: '/ledger/review/post',        auth: 'jwt', handler: handlePostLedgerBatch },
  { method: 'POST', path: '/ledger/documents/:id/post', auth: 'jwt', handler: handlePostLedgerDocument },
  { method: 'POST', path: '/ledger/documents/:id/return', auth: 'jwt', handler: handleReturnLedgerDocument },
  { method: 'POST', path: '/ledger/documents/:id/reject', auth: 'jwt', handler: handleRejectLedgerDocument },
  { method: 'POST', path: '/ledger/documents/:id/reread', auth: 'jwt', handler: handleRereadLedgerDocument },
  { method: 'GET',  path: '/ledger/business-status',    auth: 'jwt', handler: handleBusinessStatus },
  { method: 'GET',  path: '/ledger/notices',            auth: 'jwt', handler: handleLedgerNotices },
  { method: 'GET',  path: '/ledger/dashboard',          auth: 'jwt', handler: handleLedgerDashboard },
  // 아침 브리핑 (src/brief.js)
  { method: 'GET',  path: '/brief/today',               auth: 'jwt', handler: handleBrief },
  { method: 'GET',  path: '/ledger/receivables',        auth: 'jwt', handler: handleLedgerReceivables },
  { method: 'GET',  path: '/ledger/payables',           auth: 'jwt', handler: handleLedgerPayables },
  { method: 'GET',  path: '/ledger/close-memo',         auth: 'jwt', handler: handleLedgerCloseMemo },
  { method: 'GET',  path: '/ledger/suppliers',          auth: 'jwt', handler: handleLedgerSuppliers },
  { method: 'PUT',  path: '/ledger/suppliers',          auth: 'jwt', handler: handlePutLedgerSupplier },
  { method: 'POST', path: '/ledger/documents/hold',     auth: 'jwt', handler: handleHoldLedgerDocuments },
  { method: 'POST', path: '/ledger/documents/unhold',   auth: 'jwt', handler: handleUnholdLedgerDocuments },
  { method: 'GET',  path: '/ledger/held',               auth: 'jwt', handler: handleLedgerHeld },
  { method: 'GET',  path: '/ledger/held/entries',       auth: 'jwt', handler: handleLedgerHeldEntries },
  { method: 'POST', path: '/ledger/entries/:id/attach', auth: 'jwt', handler: handleAttachLedgerStatements },
  { method: 'POST', path: '/ledger/notices/seen',       auth: 'jwt', handler: handleLedgerNoticesSeen },

  // 거래처 · 공급처 (그 업체 대표 · 실장, 본사 목록은 관리자도)
  { method: 'GET',   path: '/counterparties',     auth: 'jwt', handler: handleListCounterparties },
  { method: 'POST',  path: '/counterparties',     auth: 'jwt', handler: handleCreateCounterparty },
  { method: 'PATCH', path: '/counterparties/:id', auth: 'jwt', handler: handleUpdateCounterparty },

  // 생산 계획 · 인력 추천 (주문이 들어오면 자동 제안 → 대표 승인 → 작업자 지시)
  { method: 'GET',  path: '/production/plan',                          auth: 'jwt', handler: handleGetProductionPlan },
  { method: 'POST', path: '/production/proposals',                     auth: 'jwt', handler: handleCreateProposal },
  { method: 'GET',  path: '/production/proposals',                     auth: 'jwt', handler: handleListProposals },
  { method: 'GET',  path: '/production/proposals/:proposalId',         auth: 'jwt', handler: handleGetProposal },
  { method: 'POST', path: '/production/proposals/:proposalId/decision', auth: 'jwt', handler: handleDecideProposal },
  { method: 'GET',  path: '/production/assignments',                   auth: 'jwt', handler: handleListAssignments },
  { method: 'GET',  path: '/production/settings',                      auth: 'jwt', handler: handleGetProductionSettings },
  { method: 'POST', path: '/production/settings',                      auth: 'jwt', handler: handleSaveProductionSettings },
  { method: 'POST', path: '/production/worker-links',                  auth: 'jwt', handler: handleCreateWorkerLink },
  { method: 'GET',  path: '/production/worker-links',                  auth: 'jwt', handler: handleListWorkerLinks },
  { method: 'POST', path: '/production/worker-links/:linkId/revoke',   auth: 'jwt', handler: handleRevokeWorkerLink },
  { method: 'GET',  path: '/production/monthly',                       auth: 'jwt', handler: handleMonthlySummary },
  { method: 'GET',  path: '/management/summary',                       auth: 'jwt', handler: handleManagementSummary },
  { method: 'POST', path: '/management/cash-balance',                  auth: 'jwt', handler: handleAddCashBalance },
  { method: 'GET',  path: '/management/sales-history',                 auth: 'jwt', handler: handleListSalesHistory },
  { method: 'PUT',  path: '/management/sales-history',                 auth: 'jwt', handler: handleSaveSalesHistory },
  { method: 'POST',   path: '/management/okrs',                        auth: 'jwt', handler: handleCreateOkr },
  { method: 'PATCH',  path: '/management/okrs/:id',                    auth: 'jwt', handler: handleUpdateOkr },
  { method: 'DELETE', path: '/management/okrs/:id',                    auth: 'jwt', handler: handleDeleteOkr },
  { method: 'GET',  path: '/production/worklogs',                      auth: 'jwt', handler: handleListWorklogs },
  { method: 'GET',  path: '/production/calibration',                   auth: 'jwt', handler: handleGetCalibration },
  { method: 'POST', path: '/production/calibration/apply',             auth: 'jwt', handler: handleApplyCalibration },

  // 공개 — 작업자 링크 (JWT 없음, X-Worker-Token 으로 인증)
  // 작업 지시 보고 보관함 — 관리자 전원 읽기, 메모·고정·보관은 주인 또는 admin 이상
  { method: 'GET',   path: '/reports',                   auth: 'jwt', handler: handleListReports },
  { method: 'POST',  path: '/reports',                   auth: 'jwt', handler: handleCreateNote },
  { method: 'GET',   path: '/reports/summary',           auth: 'jwt', handler: handleReportSummary },
  { method: 'GET',   path: '/reports/:reportId',         auth: 'jwt', handler: handleGetReport },
  { method: 'PATCH', path: '/reports/:reportId',         auth: 'jwt', handler: handleUpdateReport },
  { method: 'GET',   path: '/reports/:reportId/print',   auth: 'jwt', handler: handlePrintReport },
  { method: 'POST',  path: '/admin/reports/backfill',    auth: 'jwt', handler: handleBackfillReports },

  // 작업자 포털 — 작업자 (호출자의 workers 행이 approved 또는 suspended. /work/me · register · claim-invite 는 예외)
  //   정지(suspended)는 모집중 목록 · 신청 · 초대 수락만 403 — 지난 기록 · 진행 중인 일 정리는 된다 (src/work/access.js)
  { method: 'GET',   path: '/work/me',                                auth: 'jwt', handler: workRoute(getMe) },
  { method: 'POST',  path: '/work/register',                          auth: 'jwt', handler: workRoute(registerWorker, 201) },
  { method: 'POST',  path: '/work/invites/peek',                      auth: 'jwt', handler: workRoute(peekInvite) },
  { method: 'POST',  path: '/work/claim-invite',                      auth: 'jwt', handler: workRoute(claimInvite, 201) },
  { method: 'GET',   path: '/work/jobs',                              auth: 'jwt', handler: workRoute(listJobsForWorker) },
  { method: 'GET',   path: '/work/jobs/:id',                          auth: 'jwt', handler: workRoute(getJobForWorker) },
  { method: 'POST',  path: '/work/jobs/:id/apply',                    auth: 'jwt', handler: workRoute(applyToJob, 201) },
  { method: 'POST',  path: '/work/applications/:id/withdraw',         auth: 'jwt', handler: workRoute(withdrawApplication) },
  { method: 'POST',  path: '/work/assignments/:id/confirm',           auth: 'jwt', handler: workRoute(confirmAssignment) },
  { method: 'POST',  path: '/work/assignments/:id/decline',           auth: 'jwt', handler: workRoute(declineAssignment) },
  { method: 'POST',  path: '/work/assignments/:id/start',             auth: 'jwt', handler: workRoute(startAssignment) },
  { method: 'POST',  path: '/work/assignments/:id/release',           auth: 'jwt', handler: workRoute(releaseAssignment) },
  { method: 'POST',  path: '/work/assignments/:id/updates',           auth: 'jwt', handler: workRoute(addWorkerUpdate, 201) },

  // 작업자 포털 — 관리자 (읽기 isAdmin, 쓰기 · 작업자 메모는 super_admin · admin)
  { method: 'GET',   path: '/work/admin/jobs',                        auth: 'jwt', handler: workRoute(listJobsAdmin) },
  { method: 'POST',  path: '/work/admin/jobs',                        auth: 'jwt', handler: workRoute(createJobAdmin, 201) },
  { method: 'GET',   path: '/work/admin/jobs/:id',                    auth: 'jwt', handler: workRoute(getJobAdmin) },
  { method: 'PATCH', path: '/work/admin/jobs/:id',                    auth: 'jwt', handler: workRoute(patchJobAdmin) },
  { method: 'POST',  path: '/work/admin/jobs/:id/publish',            auth: 'jwt', handler: workRoute(publishJob) },
  { method: 'POST',  path: '/work/admin/jobs/:id/cancel',             auth: 'jwt', handler: workRoute(cancelJob) },
  { method: 'POST',  path: '/work/admin/jobs/:id/close',              auth: 'jwt', handler: workRoute(closeJob) },
  { method: 'POST',  path: '/work/admin/jobs/:id/invite',             auth: 'jwt', handler: workRoute(inviteWorker, 201) },
  { method: 'POST',  path: '/work/admin/jobs/:id/updates',            auth: 'jwt', handler: workRoute(addCompanyUpdate, 201) },
  { method: 'POST',  path: '/work/admin/applications/:id/approve',    auth: 'jwt', handler: workRoute(approveApplication) },
  { method: 'POST',  path: '/work/admin/applications/:id/reject',     auth: 'jwt', handler: workRoute(rejectApplication) },
  { method: 'POST',  path: '/work/admin/assignments/:id/accept',      auth: 'jwt', handler: workRoute(acceptAssignment) },
  { method: 'POST',  path: '/work/admin/assignments/:id/revision',    auth: 'jwt', handler: workRoute(requestRevision) },
  { method: 'POST',  path: '/work/admin/assignments/:id/remove',      auth: 'jwt', handler: workRoute(removeAssignment) },
  { method: 'GET',   path: '/work/admin/workers',                     auth: 'jwt', handler: workRoute(listWorkersAdmin) },
  { method: 'PATCH', path: '/work/admin/workers/:id',                 auth: 'jwt', handler: workRoute(patchWorkerAdmin) },
  { method: 'GET',   path: '/work/admin/workers/:id/notes',           auth: 'jwt', handler: workRoute(listWorkerNotes) },
  { method: 'POST',  path: '/work/admin/workers/:id/notes',           auth: 'jwt', handler: workRoute(addWorkerNote, 201) },
  { method: 'GET',   path: '/work/admin/workers/:id/events',          auth: 'jwt', handler: workRoute(listWorkerEvents) },
  { method: 'POST',  path: '/work/admin/invites',                     auth: 'jwt', handler: workRoute(createInvite, 201) },

  // 공장 작업자 — 작업자 계정으로 하는 공장 일 · 본사의 공장 배정 (src/work/factory.js, DB 0024)
  { method: 'GET',   path: '/work/factory',                           auth: 'jwt', handler: workRoute(getFactoryToday) },
  { method: 'POST',  path: '/work/factory/worklogs',                  auth: 'jwt', handler: workRoute(addFactoryWorklog, 201) },
  { method: 'POST',  path: '/work/factory/assignments/:id/done',      auth: 'jwt', handler: workRoute(markFactoryAssignmentDone) },
  { method: 'POST',  path: '/work/factory/link',                      auth: 'jwt', handler: handleFactoryLink },
  // 작업자 꾸러미 · 필수 확인 (src/work/checks.js, DB 0035 work_checks) — 내 역할 꾸러미만, 체크는 지금 문서 판에
  { method: 'GET',   path: '/work/factory/orders/:orderId/pack',      auth: 'jwt', handler: htmlRoute(factoryPack) },
  { method: 'GET',   path: '/work/factory/orders/:orderId/checks',    auth: 'jwt', handler: workRoute(getFactoryChecks) },
  { method: 'POST',  path: '/work/factory/orders/:orderId/checks',    auth: 'jwt', handler: workRoute(postFactoryCheck, 201) },
  { method: 'POST',  path: '/work/factory/orders/:orderId/checks/photo', auth: 'jwt', handler: rawRoute(postFactoryPhoto, 201) },
  { method: 'GET',   path: '/work/assignments/:id/pack',              auth: 'jwt', handler: htmlRoute(assignmentPack) },
  { method: 'GET',   path: '/work/assignments/:id/checks',            auth: 'jwt', handler: workRoute(getAssignmentChecks) },
  { method: 'POST',  path: '/work/assignments/:id/checks',            auth: 'jwt', handler: workRoute(postAssignmentCheck, 201) },
  { method: 'POST',  path: '/work/assignments/:id/checks/photo',      auth: 'jwt', handler: rawRoute(postAssignmentPhoto, 201) },
  { method: 'GET',   path: '/production/factory-workers',             auth: 'jwt', handler: workRoute(listFactoryWorkers) },
  { method: 'POST',  path: '/production/factory-workers',             auth: 'jwt', handler: workRoute(assignFactoryWorker, 201) },
  { method: 'POST',  path: '/production/factory-workers/:id/end',     auth: 'jwt', handler: workRoute(endFactoryWorker) },

  { method: 'GET',  path: '/public/production/today',                          auth: 'none', handler: handleWorkerToday },
  { method: 'POST', path: '/public/production/worklogs',                       auth: 'none', handler: handleWorkerLog },
  { method: 'POST', path: '/public/production/assignments/:assignmentId/done', auth: 'none', handler: handleWorkerAssignmentDone },

  // 공개 — 고객 공유 링크 (JWT 없음, X-Share-Token 으로 인증)
  { method: 'GET', path: '/public/confirm', auth: 'none', handler: handlePublicConfirm },
  { method: 'GET', path: '/public/feedback', auth: 'none', handler: handlePublicFeedback },
  { method: 'POST', path: '/public/feedback', auth: 'none', handler: handlePublicFeedbackAnswer },
  { method: 'POST', path: '/public/confirm/decision', auth: 'none', handler: handlePublicDecision },
]);

/** 평일 아침 7시(KST) — UTC 22:00 일~목 (wrangler.toml [triggers] crons) */
export const DAILY_BRIEF_CRON = '0 22 * * SUN-THU';

function errorResponse(request, env, err) {
  const known = [AuthError, ForbiddenError, NotFoundError, ValidationError, ConflictError, GoneError, TooLargeError, RateLimitError];
  if (known.some((C) => err instanceof C)) {
    return jsonResponse(
      request,
      env,
      { success: false, message: err.message, code: err.code || undefined, details: err.details || undefined },
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

  /**
   * cron 둘 (wrangler.toml [triggers] crons — 값을 바꾸면 여기 판정도 같이 고칠 것.
   * 계정 전체 cron 개수 한도(Workers Free 5개) 때문에 1분 cron 하나에 여러 일을 싣는다):
   *   DAILY_BRIEF_CRON — 평일 아침 7시(KST) 생산 요약 · 월 마감
   *   PUSH_SEND_CRON   — 1분마다 앱 알림 보내기, 하루 한 번 그 1분에 끝난 알림 정리 (src/push/sender.js),
   *                      24시간 지난 상담 배정 되돌리기 (src/distribution/company.js runAssignmentExpiry),
   *                      24시간 지난 제작 의뢰 답 기다림 → 답 없음 (src/production-requests/factory.js runProductionOfferExpiry),
   *                      장부 사진 읽기 다시 걸기 (src/ledger/extract.js runExtractDue) · 확인할 사진 알림
   *                      (src/push/ledger-hooks.js runLedgerPendingNotices),
   *                      분이 5의 배수면 새 상담 · 새 업체 신청 Slack 알림 (src/consult-notify.js),
   *                      08:00~08:09(KST) 아침 브리핑 알림 (src/brief.js runMorningBrief)
   */
  async scheduled(event, env, ctx) {
    if (event.cron === PUSH_SEND_CRON) {
      ctx.waitUntil(
        runPushSender(env, { nowMs: event.scheduledTime }).catch((e) => console.error('push sender failed:', e && e.statusCode ? e.statusCode : 'error')),
      );
      // 장부 사진 읽기 — 올린 직후 걸기가 빠졌거나 읽기가 실패 · 멈춘 사진을 다시 건다 (src/ledger/extract.js, 던지지 않는다).
      // 같이: 읽기가 막 끝난 업체의 대표 · 실장에게 확인할 사진 알림 (src/push/ledger-hooks.js, 던지지 않는다).
      // assistant-api 바인딩이 있을 때만 (없으면 걸 곳도, 새로 끝나는 읽기도 없다)
      if (env.ASSISTANT) {
        ctx.waitUntil(
          Promise.all([runExtractDue(env), runLedgerPendingNotices(env, { nowMs: event.scheduledTime })]),
        );
      }
      // 장부 알림 — 분마다 나눠 훑기 · 국세청 · 아침 묶음 (src/ledger/notices.js, 던지지 않는다)
      ctx.waitUntil(runLedgerNotices(env, { nowMs: event.scheduledTime }));
      // 아침 브리핑 — 08:00 부터 업체마다 정해진 분에 「오늘 볼 것 N건」 (src/brief.js, 던지지 않는다)
      ctx.waitUntil(runMorningBrief(env, { nowMs: event.scheduledTime }));
      // 24시간 지난 상담 배정 → 무응답, 본사 상담은 다시 대기 (src/distribution/company.js)
      ctx.waitUntil(
        runAssignmentExpiry(env, { nowMs: event.scheduledTime }).catch((e) => console.error('assignment expiry failed:', e && e.statusCode ? e.statusCode : 'error')),
      );
      // 24시간 지난 제작 의뢰 답 기다림 → 답 없음, 본사가 다시 추천 (src/production-requests/factory.js, 던지지 않는다)
      ctx.waitUntil(runProductionOfferExpiry(env, { nowMs: event.scheduledTime }));
      if (isPushCleanupTime(event.scheduledTime)) {
        ctx.waitUntil(
          runPushCleanup(env, { nowMs: event.scheduledTime }).catch((e) => console.error('push cleanup failed:', e && e.statusCode ? e.statusCode : 'error')),
        );
      }
      if (isConsultNoticeMinute(event.scheduledTime)) {
        ctx.waitUntil(
          runConsultNotices(env).catch((e) => console.error('consultation notice failed:', e && e.message)),
        );
        // 새 업체 신청은 따로 — 실패해도 상담 알림은 그대로 돈다
        ctx.waitUntil(
          runPartnerApplicationNotices(env).catch((e) => console.error('partner application notice failed:', e && e.message)),
        );
        // A/S 접수 — 48시간 넘게 아무도 안 받은 것을 본사 Slack 에 (src/as-requests.js, 던지지 않는다)
        ctx.waitUntil(runAsAlerts(env, { nowMs: event.scheduledTime }));
      }
      return;
    }
    if (event.cron !== DAILY_BRIEF_CRON) {
      console.warn('unknown cron:', event.cron);
      return;
    }
    ctx.waitUntil(
      runDailyBriefs(env).catch((e) => console.error('daily production brief failed:', e && e.message)),
    );
    // 매월 첫 근무일 — 전월 생산 마감 보고 (보관함, 이미 있으면 건너뜀)
    ctx.waitUntil(
      runMonthlyCloses(env).catch((e) => console.error('monthly close failed:', e && e.message)),
    );
  },
};
