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
 *   설치 · 조립 작업(모집 · 초대로 맡은 일): 내 배정이 확정 이상이고 작업에 주문이 있을 때 (assignments.js loadMyAssignment).
 *     설치 → 시공 지시서 (주소 · 연락처는 열리지 않는다 — reveal.js SITE_NOTE), 조립 → 조립 꾸러미.
 *     GET  /work/assignments/:id/pack · GET|POST /work/assignments/:id/checks · POST /work/assignments/:id/checks/photo
 *   본사 · 업체: GET /orders/:orderId/checks — 설계를 볼 수 있는 사람이 역할 전부의 지금 값 (사진은 서명 주소 1시간).
 *
 * 작업자 화면의 주문 이름은 가린 이름(홍*동 · 주문번호), 금액은 없다. 체크는 지금 문서 판에만 (새 판이 나오면 409 superseded).
 * 사진: 「사진 필수」 항목은 사진을 붙여야 체크된다 (v1 확정 — 「선택」은 붙여도 되고 안 붙여도 된다). 사진은 비공개 버킷
 * work-check-photos (DB 0037) 에 서버가 올린다 — 경로 <회사>/<주문>/<문서>/<uuid>.jpg|png. 0035 · 0037 적용 전이면 409 db_pending.
 */
import { selectOne, insertOne, assertDesignAccess, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../supabase.js';
import { requireFactoryWorker } from './factory.js';
import { loadMyAssignment } from './assignments.js';
import { assertOwnHqOrder } from '../production/worker-access.js';
import { workerOrderLabel, orderLabel } from '../production/redact.js';
import { COUNTED_STATUSES } from './reveal.js';
import { assertUuid } from './validate.js';
import { itemsFor, itemApplies, CHECK_ROLES } from './check-items.js';
import { PACKS_OF_ROLE, docContext, cellsOf, roleChecks, checkRows } from './check-state.js';
import { resolvePrintAssets } from '../documents.js';
import { renderWorkOrder, normalizePack } from '../templates/work-order.js';
import { renderInstallationOrder } from '../templates/installation-order.js';
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
  return { ...ctx, worker, order, roles: roles.map((r) => CHECK_ROLE_OF_FACTORY[r]).filter(Boolean) };
}

/** 설치 · 조립 작업의 내 배정 + 주문 + 지금 문서 */
async function assignmentContext(env, user, rawId) {
  const { worker, assignment, job } = await loadMyAssignment(env, user, rawId);
  if (!COUNTED_STATUSES.includes(assignment.status)) throw new ForbiddenError('확정된 배정에서만 지시서를 엽니다', 'not_confirmed');
  const role = job.kind === 'install' ? 'install' : job.kind === 'assembly' ? 'assembly' : null;
  if (!role) throw new NotFoundError('이 작업에는 작업지시서가 없습니다');
  if (!job.order_id) throw new NotFoundError('이 작업에는 연결된 주문이 없습니다');
  const order = await loadOrder(env, job.order_id);
  const ctx = await docContext(env, order, role === 'install' ? 'installation_order' : 'work_order');
  return { ...ctx, worker, order, roles: [role] };
}

/** 꾸러미 HTML — 내 역할의 꾸러미만, 작업자 보기 (가린 주문 이름 · 주소 · 연락처 없음). 그림(렌더 · ISO 도면)은 1시간 서명 주소 */
async function packHtml(env, ctx, rawPack) {
  const allowed = ctx.roles.flatMap((r) => PACKS_OF_ROLE[r] || []);
  if (ctx.roles.includes('install')) {
    const { renderUrls } = await resolvePrintAssets(env, ctx.doc);
    return renderInstallationOrder(ctx.doc, ctx.snapshot, { toolbar: true, renderUrls, worker: { orderLabel: workerOrderLabel(ctx.order) } });
  }
  const pack = rawPack ? normalizePack(rawPack) : allowed[0];
  if (!pack || allowed.indexOf(pack) < 0) throw new ForbiddenError('내 공정의 꾸러미만 엽니다', 'not_my_pack');
  const { renderUrls } = await resolvePrintAssets(env, ctx.doc);
  return renderWorkOrder(ctx.doc, ctx.snapshot, { toolbar: true, pack, renderUrls, worker: { orderLabel: workerOrderLabel(ctx.order) } });
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

/** 이 주문 · 문서의 사진 경로 모양 (서버가 올린 것만) */
const photoPathRe = (ctx) => new RegExp(`^${ctx.order.company_id}/${ctx.order.id}/${ctx.doc.id}/${UUID}\\.(jpg|png)$`);

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
  try {
    await insertOne(env, 'work_checks', {
      company_id: ctx.order.company_id,
      order_id: ctx.order.id,
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
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending('0035');
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
  const path = `${ctx.order.company_id}/${ctx.order.id}/${ctx.doc.id}/${crypto.randomUUID()}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
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
  return checksView(env, ctx, workerOrderLabel(ctx.order));
}
/** POST /work/factory/orders/:orderId/checks */
export async function postFactoryCheck(env, { user, params, body }) {
  return addCheck(env, await factoryContext(env, user, params.orderId), user, body);
}
/** POST /work/factory/orders/:orderId/checks/photo — 본문 = 사진 */
export async function postFactoryPhoto(env, { user, params, request }) {
  return addPhoto(env, await factoryContext(env, user, params.orderId), request);
}
/** GET /work/assignments/:id/pack — HTML */
export async function assignmentPack(env, { user, params }) {
  return packHtml(env, await assignmentContext(env, user, params.id), null);
}
/** GET /work/assignments/:id/checks */
export async function getAssignmentChecks(env, { user, params }) {
  const ctx = await assignmentContext(env, user, params.id);
  return checksView(env, ctx, workerOrderLabel(ctx.order));
}
/** POST /work/assignments/:id/checks */
export async function postAssignmentCheck(env, { user, params, body }) {
  return addCheck(env, await assignmentContext(env, user, params.id), user, body);
}
/** POST /work/assignments/:id/checks/photo — 본문 = 사진 */
export async function postAssignmentPhoto(env, { user, params, request }) {
  return addPhoto(env, await assignmentContext(env, user, params.id), request);
}
/** GET /orders/:orderId/checks — 본사 · 업체: 설계를 볼 수 있는 사람이 역할 전부 (작업지시서 판 기준, 설치는 시공 지시서 판), 사진은 서명 주소 */
export async function getOrderChecks(env, { user, params }) {
  const order = await loadOrder(env, assertUuid(params.orderId, '주문 id'));
  await assertDesignAccess(env, order.design_id, user);
  const out = { order_label: orderLabel(order), roles: [] };
  for (const [docType, roles] of [['work_order', CHECK_ROLES.filter((r) => r !== 'install')], ['installation_order', ['install']]]) {
    let ctx;
    try {
      ctx = { ...(await docContext(env, order, docType)), order, roles };
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
