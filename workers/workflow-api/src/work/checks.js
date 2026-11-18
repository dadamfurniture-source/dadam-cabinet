/**
 * 작업자 꾸러미 · 필수 확인 (2026-11-04 사장님 「각 작업자에 작업지시서로 분배 · 작업자들에게 필수 확인사항도 포함」, 승인 계획 3-4 · v1)
 *
 * 작업자가 자기 역할의 작업지시서 꾸러미만 열고, 정본 목록(check-items.js — 발행 때 문서에 고정된 판)의 항목을 체크한다.
 * 체크는 DB 0035 work_checks 에 한 줄씩 쌓인다 (같은 칸의 마지막 줄이 지금 값). 칸 · 지금 값 · 완료 막기는 check-state.js.
 *
 *   공장 (재단 · 엣지 · 조립): 승인된 작업자 + 열린 공장 배정 (factory.js requireFactoryWorker). 주문은 배정된 생산 계획 주인의
 *     본사 수주만 (worker-access.js assertOwnHqOrder). 공정 → 역할 · 꾸러미: 재단 · 엣지 → cut · labels, 조립 → assembly.
 *     GET  /work/factory/orders/:orderId/pack?pack=   꾸러미 HTML (그 주문 설계의 지금 작업지시서)
 *     GET  /work/factory/orders/:orderId/checks       내 역할 항목 · 칸 · 지금 값
 *     POST /work/factory/orders/:orderId/checks       체크 한 번
 *     POST /work/factory/orders/:orderId/checks/photo 사진 한 장 (본문 = JPEG · PNG) → photo_path — 체크에 붙인다
 *   배정받은 작업(모집 · 초대 · 프로젝트 「작업 배정」으로 맡은 일): 내 배정이 확정 이상일 때 (assignments.js loadMyAssignment).
 *     지시서는 그 작업의 설계로 찾는다 (work/job-links.js) — 프로젝트 작업은 그 프로젝트에 이은 설계마다 (?design= 로 고른다, 없으면 첫 설계),
 *     수주가 없어도 프로젝트에 이은 설계면 연다 (수주 전 작업 — 이름표는 「수주 전 · 문서 번호」, 체크는 수주 칸을 비우고 작업 칸을 적는다 — DB 0072).
 *     설치 → 시공 지시서 · 철거 → 철거 지시서 · 납품 → 납품 지시서 (주소 · 연락처는 수락한 때부터 작업이 끝나고 7일까지만 — reveal.js siteOpenFor),
 *     재단 · 엣지 → 재단 꾸러미 · 라벨, 조립 → 조립 꾸러미. A/S 는 지시서가 없다 (2026-11-17 사장님 「각 작업에 작업지시서」).
 *     철거 · 납품 지시서에는 그 작업 줄의 사무실 메모(work_jobs.sheet_memo)가 같이 나온다.
 *     GET  /work/assignments/:id/pack · GET|POST /work/assignments/:id/checks · POST /work/assignments/:id/checks/photo
 *   본사 · 업체: GET /orders/:orderId/checks — 설계를 볼 수 있는 사람이 역할 전부의 지금 값 (사진은 서명 주소 1시간).
 *
 * 작업자 화면의 주문 이름은 가린 이름(홍*동 · 주문번호), 금액은 없다. 체크는 지금 문서 판에만 (새 판이 나오면 409 superseded).
 * 주문 끝 항목(목록 v2 finish — 「이 주문 재단 · 엣지 끝」 · 「이 주문 조립 끝」)은 그 역할의 필수가 남았으면 409 checks_left.
 * 사진: 「사진 필수」 항목은 사진을 붙여야 체크된다 (v1 확정 — 「선택」은 붙여도 되고 안 붙여도 된다). 사진은 비공개 버킷
 * work-check-photos (DB 0037) 에 서버가 올린다 — 경로 <회사>/<주문>/<문서>/<uuid>.jpg|png. 0035 · 0037 적용 전이면 409 db_pending.
 */
import { selectOne, insertOne, assertDesignAccess, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../supabase.js';
import { requireFactoryWorker } from './factory.js';
import { loadMyAssignment } from './assignments.js';
import { assertOwnHqOrder } from '../production/worker-access.js';
import { workerOrderLabel, orderLabel } from '../production/redact.js';
import { COUNTED_STATUSES, siteOpenFor } from './reveal.js';
import { assertUuid } from './validate.js';
import { itemsFor, itemApplies, CHECK_ROLES } from './check-items.js';
import { PACKS_OF_ROLE, DOC_TYPE_OF_ROLE, ROLE_OF_JOB_KIND, docContext, docContextOfDesign, cellsOf, roleChecks, checkRows } from './check-state.js';
import { sheetTargetOf } from './job-links.js';
import { resolvePrintAssets } from '../documents.js';
import { loadCountertopContext } from '../reports/outsource.js';
import { renderWorkOrder, normalizePack } from '../templates/work-order.js';
import { renderInstallationOrder } from '../templates/installation-order.js';
import { renderSiteOrder } from '../templates/site-order.js';
import { sitePhotosOf } from './job-sheet.js';
import { isMissingRelation } from '../work-order-data.js';
import { uploadObject, createSignedUrls } from '../storage.js';
import { readBodyCapped } from '../ledger/documents.js';
import { sniffImage, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS } from '../ledger/checks.js';

export { PACKS_OF_ROLE, cellsOf } from './check-state.js';

/** 공장 공정 → 확인 역할 */
export const CHECK_ROLE_OF_FACTORY = Object.freeze({ cutter: 'cut', edge: 'edge', asm: 'assembly' });
/** 작업자 필수 확인 사진 버킷 (DB 0037) */
export const CHECK_PHOTO_BUCKET = 'work-check-photos';
const MEMO_MAX = 300;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const dbPending = (what) => new ConflictError(`DB ${what} 적용 전입니다 — 필수 확인 ${what === '0037' ? '사진' : '기록'}은 적용 뒤에 됩니다`, { code: 'db_pending' });
/** 수주 전 작업의 이름표 — 고객 이름 없이 문서 번호만 (문서 제목에는 고객 이름이 들어 있을 수 있어 쓰지 않는다) */
export const orderlessLabel = (doc) => `수주 전 · ${doc.doc_no}`;
/** 현장 문서를 쓰는 역할 — 설치 · 철거 · 납품 */
const SITE_ROLES = Object.freeze(['install', 'demolition', 'delivery']);

async function loadOrder(env, orderId) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'id,order_no,customer_name,design_id,company_id' });
  if (!order) throw new NotFoundError('주문을 찾을 수 없습니다');
  return order;
}

/** 공장 작업자 + 내 계획의 주문 + 지금 작업지시서 */
async function factoryContext(env, user, rawOrderId) {
  const orderId = assertUuid(rawOrderId, '주문 id');
  const { worker, factory, roles } = await requireFactoryWorker(env, user);
  try {
    await assertOwnHqOrder(env, { user_id: factory.plan_user_id }, orderId);
  } catch (e) {
    if (e instanceof ValidationError) throw new NotFoundError('내 생산 계획의 주문이 아닙니다');
    throw e;
  }
  const order = await loadOrder(env, orderId);
  const ctx = await docContext(env, order, 'work_order');
  return withScope({ ...ctx, worker, order, roles: roles.map((r) => CHECK_ROLE_OF_FACTORY[r]).filter(Boolean) });
}

/**
 * 맥락에 이름표 · 팩토리 · 설계 · 사진 자리를 붙인다 — 수주가 있으면 가린 주문 이름, 없으면(수주 전 작업) 「수주 전 · 문서 번호」.
 *   label 은 비지 않는다: 템플릿은 이름표가 빈 글이면 사무실 보기(고객 실명 · 주소)로 그린다.
 */
function withScope(ctx) {
  const order = ctx.order || null;
  const design = ctx.design || (order ? { id: order.design_id, company_id: order.company_id } : null);
  const label = order ? workerOrderLabel(order) : orderlessLabel(ctx.doc);
  if (!label || !design || !design.company_id) throw new NotFoundError('이 작업의 지시서를 열 수 없습니다');
  return { ...ctx, order, design, label, companyId: design.company_id, scopeId: order ? order.id : design.id };
}

/**
 * 배정받은 작업의 내 배정 + 설계(+ 수주) + 지금 문서 — 작업 종류마다 그 지시서 (A/S 는 없다).
 *   설계는 work/job-links.js 가 고른다 — 프로젝트 작업은 그 프로젝트에 이은 설계 가운데 designId (없으면 첫 설계). 수주는 없어도 된다.
 */
async function assignmentContext(env, user, rawId, designId) {
  const { worker, assignment, job } = await loadMyAssignment(env, user, rawId);
  if (!COUNTED_STATUSES.includes(assignment.status)) throw new ForbiddenError('확정된 배정에서만 지시서를 엽니다', 'not_confirmed');
  const role = ROLE_OF_JOB_KIND[job.kind] || null;
  if (!role) throw new NotFoundError('이 작업에는 작업지시서가 없습니다');
  const { design, order } = await sheetTargetOf(env, job, designId);
  const ctx = order ? await docContext(env, order, DOC_TYPE_OF_ROLE[role]) : await docContextOfDesign(env, design.id, DOC_TYPE_OF_ROLE[role]);
  // 지시서의 주소 · 연락처도 같은 판정으로 연다 — 그 설계(수주)가 작업을 낸 팩토리의 것일 때만
  const siteOpen = siteOpenFor(job, assignment) && !!job.company_id && design.company_id === job.company_id;
  // 사무실 메모 — 그 작업 줄에 적어 둔 글 (0068 전에는 칸이 없다 → 빈 글)
  const memo = typeof job.sheet_memo === 'string' ? job.sheet_memo : '';
  return withScope({ ...ctx, worker, order, design, roles: [role], siteOpen, memo, jobId: job.id });
}

/** 꾸러미 HTML — 내 역할의 꾸러미만, 작업자 보기 (가린 주문 이름 · 주소 · 연락처 없음). 그림(렌더 · ISO 도면)은 1시간 서명 주소 */
async function packHtml(env, ctx, rawPack) {
  // 이름표가 비면 템플릿이 사무실 보기로 그린다 — 작업자 길에서는 늘 채운다 (withScope)
  if (!ctx.label) throw new NotFoundError('이 작업의 지시서를 열 수 없습니다');
  const allowed = ctx.roles.flatMap((r) => PACKS_OF_ROLE[r] || []);
  if (ctx.roles.includes('install')) {
    const { renderUrls } = await resolvePrintAssets(env, ctx.doc);
    // 상판 탑뷰의 가전 모델 타공 (그림 묶음 판이 있는 문서만) — 생산 설정 기본값 · 모델만 넘긴다 (현장 정보 · 거래처는 넘기지 않는다)
    let top = null;
    if (ctx.doc.render_payload && ctx.doc.render_payload.drawing_version) {
      const t = await loadCountertopContext(env, { doc: ctx.doc, snapshot: ctx.snapshot });
      top = { countertop: t.countertop, models: t.models };
    }
    return renderInstallationOrder(ctx.doc, ctx.snapshot, { toolbar: true, renderUrls, top, worker: { orderLabel: ctx.label, siteOpen: ctx.siteOpen === true } });
  }
  // 철거 · 납품 지시서 — 현장 정보는 설치 지시서와 같은 판정, 사무실 메모는 그 작업 줄의 것
  if (ctx.roles.includes('demolition') || ctx.roles.includes('delivery')) {
    // 철거 — 팩토리가 그 설계에 올려 둔 현장 사진. 주소와 같은 때에만 읽는다 (닫혀 있으면 서명 주소도 만들지 않는다)
    const sitePhotos =
      ctx.roles.includes('demolition') && ctx.siteOpen === true ? await sitePhotosOf(env, { designId: ctx.design.id, companyId: ctx.companyId }) : null;
    // 고정한 그림(납품 = ISO · 3D 앞모습, 철거 = 배치 평면)의 서명 주소 — 그림이 없는 옛 문서는 조회하지 않는다
    const { renderUrls } = await resolvePrintAssets(env, ctx.doc);
    return renderSiteOrder(ctx.doc, ctx.snapshot, { toolbar: true, memo: ctx.memo || '', sitePhotos, renderUrls, worker: { orderLabel: ctx.label, siteOpen: ctx.siteOpen === true } });
  }
  const pack = rawPack ? normalizePack(rawPack) : allowed[0];
  if (!pack || allowed.indexOf(pack) < 0) throw new ForbiddenError('내 공정의 꾸러미만 엽니다', 'not_my_pack');
  const { renderUrls } = await resolvePrintAssets(env, ctx.doc);
  return renderWorkOrder(ctx.doc, ctx.snapshot, { toolbar: true, pack, renderUrls, worker: { orderLabel: ctx.label } });
}

/** 작업자 보기 — 사진 경로 대신 있음 · 없음 */
const forWorker = (role) => ({ ...role, cells: role.cells.map((c) => ({ ...c, items: c.items.map(({ photo_path, ...x }) => ({ ...x, has_photo: !!photo_path })) })) });

async function checksView(env, ctx, label, { worker = true } = {}) {
  const rows = await checkRows(env, ctx.doc.id, ctx.roles);
  const roles = ctx.roles.map((r) => roleChecks(ctx, r, rows || []));
  return {
    order_label: label,
    document: { id: ctx.doc.id, doc_no: ctx.doc.doc_no, rev: ctx.doc.rev },
    list_version: ctx.list.version,
    block: ctx.list.block || 'none',
    db_ready: rows !== null,
    roles: worker ? roles.map(forWorker) : roles,
  };
}

/** 이 주문(수주 전 작업이면 설계) · 문서의 사진 경로 모양 (서버가 올린 것만) */
const photoPathRe = (ctx) => new RegExp(`^${ctx.companyId}/${ctx.scopeId}/${ctx.doc.id}/${UUID}\\.(jpg|png)$`);

/** 체크 한 번 — 지금 문서 판 · 내 역할 · 목록 항목 · 있는 칸 · 사진 필수면 사진 */
async function addCheck(env, ctx, user, body) {
  const b = body || {};
  if (b.document_id !== ctx.doc.id) throw new ConflictError('작업지시서가 새 판으로 바뀌었습니다 — 다시 열어 주세요', { code: 'superseded', document_id: ctx.doc.id });
  if (ctx.roles.indexOf(b.role) < 0) throw new ForbiddenError('내 역할의 항목만 체크합니다', 'not_my_role');
  const item = itemsFor(ctx.list, b.role).find((x) => x.key === b.item_key);
  if (!item) throw new ValidationError('목록에 없는 항목입니다', { field: 'item_key' });
  const scopeKey = typeof b.scope_key === 'string' ? b.scope_key : '';
  const cell = cellsOf(ctx.doc, ctx.snapshot, item.scope).find((c) => c.scope_key === scopeKey);
  if (!cell || !itemApplies(item, cell.module, ctx.snapshot)) throw new ValidationError('이 항목을 체크할 칸이 아닙니다', { field: 'scope_key' });
  if (typeof b.checked !== 'boolean') throw new ValidationError('checked 는 참 · 거짓이어야 합니다', { field: 'checked' });
  if (b.memo != null && (typeof b.memo !== 'string' || b.memo.length > MEMO_MAX)) throw new ValidationError(`메모는 ${MEMO_MAX}자까지입니다`, { field: 'memo' });
  const photoPath = b.photo_path == null || b.photo_path === '' ? null : String(b.photo_path);
  if (photoPath && (item.photo === 'none' || !photoPathRe(ctx).test(photoPath))) throw new ValidationError('이 항목에 붙일 수 없는 사진입니다', { field: 'photo_path' });
  if (item.photo === 'need' && b.checked && !photoPath) throw new ValidationError('사진이 필요한 항목입니다 — 사진을 붙여 체크해 주세요', { field: 'photo', code: 'photo_required' });
  // 주문 끝 항목(v2 finish) — 그 역할의 필수를 다 체크해야 (2026-11-06 사장님 「주문 끝 완료를 따로 둠」)
  if (item.finish && b.checked && ctx.list.block === 'must') {
    const rows = await checkRows(env, ctx.doc.id, [b.role]);
    const left = rows === null ? 0 : roleChecks(ctx, b.role, rows).must_left;
    if (left > 0) throw new ConflictError(`필수 확인이 ${left}개 남았습니다 — 필수를 다 체크한 뒤 주문 끝을 체크해 주세요`, { code: 'checks_left', left });
  }
  const row = {
    company_id: ctx.companyId,
    order_id: ctx.order ? ctx.order.id : null,
    document_id: ctx.doc.id,
    worker_id: ctx.worker ? ctx.worker.id : null,
    actor_user_id: user.id,
    role: b.role,
    scope_key: scopeKey,
    item_key: item.key,
    list_version: ctx.list.version,
    checked: b.checked,
    memo: b.memo ? b.memo.trim() || null : null,
    photo_path: b.checked ? photoPath : null,
  };
  const text = (e) => String((e && e.message) || '');
  try {
    try {
      // 배정받은 작업의 체크는 그 작업을 적는다 (DB 0072 — 공장 길은 작업이 없어 칸을 싣지 않는다)
      await insertOne(env, 'work_checks', ctx.jobId ? { ...row, job_id: ctx.jobId } : row);
    } catch (e) {
      // 작업 칸이 아직 없다 (0072 전) — 수주가 있으면 칸 없이 예전처럼 적는다
      if (!ctx.jobId || !/job_id/.test(text(e)) || !/42703|PGRST204/.test(text(e))) throw e;
      if (!row.order_id) throw dbPending('0072');
      await insertOne(env, 'work_checks', row);
    }
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending('0035');
    // 수주 전 작업의 체크는 DB 0072 부터 (work_checks.order_id 를 비울 수 있다 — 그 전에는 23502)
    if (!row.order_id && /23502/.test(text(e))) throw dbPending('0072');
    // 철거 · 납품 역할은 DB 0068 부터 (work_checks.role 제약 23514)
    if (SITE_ROLES.includes(b.role) && b.role !== 'install' && /23514/.test(String((e && e.message) || ''))) throw dbPending('0068');
    throw e;
  }
  return { role: b.role, scope_key: scopeKey, item_key: item.key, checked: b.checked, has_photo: !!(b.checked && photoPath) };
}

/** 사진 한 장 — JPEG · PNG, 5MB · 긴 변 · 화소 한도는 장부 사진과 같다 (ledger/checks.js) */
async function addPhoto(env, ctx, request) {
  const bytes = await readBodyCapped(request, PHOTO_MAX_BYTES);
  if (!bytes.byteLength) throw new ValidationError('사진 본문이 비었습니다', { code: 'empty' });
  const img = sniffImage(bytes);
  if (img && img.heic) throw new ValidationError('HEIC 사진은 JPEG 로 바꿔 올려 주세요', { code: 'heic' });
  if (!img) throw new ValidationError('사진은 JPEG · PNG 만 받습니다', { code: 'bad_type' });
  if (Math.max(img.width, img.height) > PHOTO_MAX_EDGE || img.width * img.height > PHOTO_MAX_PIXELS) {
    throw new ValidationError(`사진이 너무 큽니다 (긴 변 ${PHOTO_MAX_EDGE}px · ${PHOTO_MAX_PIXELS / 10000}만 화소 이하)`, { code: 'dimensions' });
  }
  const path = `${ctx.companyId}/${ctx.scopeId}/${ctx.doc.id}/${crypto.randomUUID()}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
  try {
    await uploadObject(env, CHECK_PHOTO_BUCKET, path, bytes, img.mime);
  } catch (e) {
    if (/bucket|not found|404/i.test(String((e && e.message) || ''))) throw dbPending('0037');
    throw e;
  }
  return { photo_path: path };
}

// ── 라우트 함수 (env, { user, params, body, query, request }) ─────────────────

/** GET /work/factory/orders/:orderId/pack — HTML */
export async function factoryPack(env, { user, params, query }) {
  return packHtml(env, await factoryContext(env, user, params.orderId), query && query.pack);
}
/** GET /work/factory/orders/:orderId/checks */
export async function getFactoryChecks(env, { user, params }) {
  const ctx = await factoryContext(env, user, params.orderId);
  return checksView(env, ctx, ctx.label);
}
/** POST /work/factory/orders/:orderId/checks */
export async function postFactoryCheck(env, { user, params, body }) {
  return addCheck(env, await factoryContext(env, user, params.orderId), user, body);
}
/** POST /work/factory/orders/:orderId/checks/photo — 본문 = 사진 */
export async function postFactoryPhoto(env, { user, params, request }) {
  return addPhoto(env, await factoryContext(env, user, params.orderId), request);
}
/** 주소의 ?design= — 그 작업의 설계 고르기 (프로젝트 작업은 설계가 여럿일 수 있다). 없으면 첫 설계 */
const designOf = (query, request) => {
  if (query && query.design) return query.design;
  if (!request || !request.url) return null;
  try {
    return new URL(request.url).searchParams.get('design') || null;
  } catch {
    return null;
  }
};

/** GET /work/assignments/:id/pack?pack=&design= — HTML. pack 은 재단 · 엣지 작업의 꾸러미 고르기 (cut · labels — 없으면 첫 꾸러미), 현장 문서는 하나뿐이라 보지 않는다 */
export async function assignmentPack(env, { user, params, query }) {
  return packHtml(env, await assignmentContext(env, user, params.id, designOf(query)), (query && query.pack) || null);
}
/** GET /work/assignments/:id/checks?design= */
export async function getAssignmentChecks(env, { user, params, query }) {
  const ctx = await assignmentContext(env, user, params.id, designOf(query));
  return { ...(await checksView(env, ctx, ctx.label)), design: ctx.design.id };
}
/** POST /work/assignments/:id/checks?design= */
export async function postAssignmentCheck(env, { user, params, body, query }) {
  return addCheck(env, await assignmentContext(env, user, params.id, designOf(query)), user, body);
}
/** POST /work/assignments/:id/checks/photo?design= — 본문 = 사진 */
export async function postAssignmentPhoto(env, { user, params, request, query }) {
  return addPhoto(env, await assignmentContext(env, user, params.id, designOf(query, request)), request);
}
/** GET /orders/:orderId/checks — 본사 · 업체: 설계를 볼 수 있는 사람이 역할 전부 (작업지시서 판 기준, 설치 · 철거 · 납품은 그 지시서 판), 사진은 서명 주소 */
export async function getOrderChecks(env, { user, params }) {
  const order = await loadOrder(env, assertUuid(params.orderId, '주문 id'));
  await assertDesignAccess(env, order.design_id, user);
  const out = { order_label: orderLabel(order), roles: [] };
  for (const [docType, roles] of [['work_order', CHECK_ROLES.filter((r) => DOC_TYPE_OF_ROLE[r] === 'work_order')], ['installation_order', ['install']], ['demolition_order', ['demolition']], ['delivery_order', ['delivery']]]) {
    let ctx;
    try {
      ctx = withScope({ ...(await docContext(env, order, docType)), order, roles });
    } catch (e) {
      if (e instanceof NotFoundError) continue;
      throw e;
    }
    const view = await checksView(env, ctx, out.order_label, { worker: false });
    out.roles.push(...view.roles.map((r) => ({ ...r, document: view.document, list_version: view.list_version, block: view.block })));
    out.db_ready = view.db_ready;
  }
  const paths = out.roles.flatMap((r) => r.cells.flatMap((c) => c.items.map((x) => x.photo_path).filter(Boolean)));
  if (paths.length) {
    let urls = new Map();
    try {
      urls = await createSignedUrls(env, CHECK_PHOTO_BUCKET, paths);
    } catch (e) {
      console.warn('[checks] 사진 서명 주소 실패:', e && e.message);
    }
    out.roles.forEach((r) => r.cells.forEach((c) => c.items.forEach((x) => { x.photo_url = x.photo_path ? urls.get(x.photo_path) || null : null; })));
  }
  return out;
}
