/**
 * 고객 A/S 접수 (DB 0045 as_requests · 버킷 as-request-photos — 2026-11-06 사장님 결정 · A/S 접수 묶음)
 *   구조 답 6: 고객 앱 A/S 신청 → 본사 시스템 기록 → 그 수주의 팩토리 담당자(또는 연계 MANAGER)에게 바로. 본사가 손으로 넘기지 않는다.
 *   ② 담당자가 없으면 그 팩토리 대표 · 실장 ③ 본사는 기록 + 48시간 넘게 아무도 안 받으면 본사 관리자에게 알림
 *   ④ 앱 상담으로 시작한 수주만 — 고객 계정과 이어진 수주 (customers.user_id → projects → orders)
 *   메모 「MANAGER 와 팩토리 담당자가 같이 있을 수 없음」 — 연계 MANAGER 길(route manager)은 MANAGER 등급을 만든 뒤 더한다.
 *
 *   고객 (본인 수주만)
 *     POST /me/orders/:orderId/as-requests/photo    사진 한 장 (본문 = JPEG · PNG) → { photo_path }
 *     POST /me/orders/:orderId/as-requests          { body, photo_paths? } → 접수 한 줄 (담당자 · 대표 · 실장에게 앱 알림 as_request)
 *     GET  /me/as-requests                          내 접수 (팩토리 이름 · 주문번호 · 상태 · 때)
 *     POST /me/as-requests/:id/cancel               아직 받지 않은 접수 거두기
 *   팩토리 (그 팩토리 구성원 — 받기 · 끝은 대표 · 실장 또는 그 접수의 담당자)
 *     GET  /company/as-requests                     우리 A/S함 (사진은 서명 주소 1시간)
 *     POST /company/as-requests/:id/receive         받기
 *     POST /company/as-requests/:id/done            { report_id? } 끝 — 그 수주의 A/S 완료 보고(0043)와 잇는다
 *   본사
 *     GET  /admin/as-requests?days=                 관리자 — 기록 (접수 · 받기 · 끝 시간, 팩토리마다 A/S 수 · 끝낸 수주 수)
 *     runAsAlerts (cron)                            48시간 넘게 아무도 안 받은 접수 → 회사 Slack 한 메시지, alerted_at 을 찍는다
 *
 * 2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 ① (DB 0082 handler_company_id · handler_project_id):
 *   영업 사원 업체(plan manager — 생산을 하지 않는다)의 수주에 들어온 A/S 는 그 프로젝트의 제작 의뢰를 받은 팩토리
 *   (production_requests accepted 의 factory_company_id · factory_project_id)가 바로 받는다.
 *     · 팩토리 쪽: 그 팩토리 프로젝트의 담당자(없으면 대표 · 실장)에게 as_request 알림, 팩토리 A/S함에 보이고 받기 · 끝을 한다
 *     · 영업 사원 업체 쪽: 대표 · 실장(과 그 프로젝트 담당자)에게 as_factory 알림, A/S함에 「만든 팩토리가 처리」로 보이고 단추는 없다
 *   받은 의뢰가 없으면(직접 만든 · 의뢰 전) 지금처럼 수주한 업체가 받는다. 0082 전이면 지금처럼.
 *   팩토리가 끝낼 때는 완료 보고(report_id)를 잇지 않는다 — 보고는 수주한 업체의 수주에 붙는다.
 * 앱 알림 · Slack 에는 고객 이름 · 전화 · 주소 · 금액 · 내용을 싣지 않는다 (주문번호 · 건수만).
 * 0045 적용 전이면 쓰기 409 db_pending · 보기 ready false.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, insertOne, selectMany, selectOne, updateBy } from './supabase.js';
import { logAt, logProject } from './project-log.js';
import { companyOf } from './distribution/company.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';
import { uploadObject, createSignedUrls } from './storage.js';
import { readBodyCapped } from './ledger/documents.js';
import { sniffImage, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS } from './ledger/checks.js';
import { assertUuid } from './work/validate.js';
import { enqueueNotification, notifyRoles } from './push/outbox.js';
import { buildMessage, safeOrderNo } from './push/messages.js';
import { postToWebhook } from './slack.js';

export const AS_BUCKET = 'as-request-photos';
export const BODY_MAX = 1000;
export const PHOTOS_MAX = 5;
/** 이 시간이 지나도록 아무도 안 받으면 본사에 알린다 (③) */
export const ALERT_HOURS = 48;
export const FEED_DAYS = 30;
export const FEED_DAYS_MAX = 180;
const FEED_LIMIT = 500;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HOUR_MS = 3600 * 1000;
export const AS_STATE_LABEL = Object.freeze({ requested: '접수', received: '받음', done: '끝', cancelled: '거둠' });

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () => conflict('DB 0045 적용 전입니다 — A/S 접수는 적용 뒤에 됩니다', 'db_pending');

// ── 고객 ──────────────────────────────────────────────────

/** 본인 수주 — 고객 계정과 이어진 수주만 (④). 아니면 404 (남의 수주는 있는지도 모르게) */
async function myOrderOf(env, user, rawId) {
  const orderId = assertUuid(rawId, '수주 id');
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'id,company_id,project_id,design_id,order_no,status' });
  if (!order || !order.project_id || order.status === 'cancelled') throw new NotFoundError('수주를 찾을 수 없습니다');
  const project = await selectOne(env, 'projects', { id: `eq.${order.project_id}`, company_id: `eq.${order.company_id}`, select: 'id,customer_id' });
  if (!project) throw new NotFoundError('수주를 찾을 수 없습니다');
  const customer = await selectOne(env, 'customers', { id: `eq.${project.customer_id}`, select: 'id,user_id' });
  if (!customer || !user || customer.user_id !== user.id) throw new NotFoundError('수주를 찾을 수 없습니다');
  return order;
}

/** 이 수주의 사진 경로 모양 (서버가 올린 것만) */
export const photoPathRe = (order) => new RegExp(`^${order.company_id}/${order.id}/${UUID}\\.(jpg|png)$`);

/** 접수 본문 검사 (순수) → { body, photos } */
export function requestOf(input, order) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (!body) throw new ValidationError('A/S 내용을 적어 주세요', { field: 'body' });
  if (body.length > BODY_MAX) throw new ValidationError(`내용은 ${BODY_MAX}자까지입니다`, { field: 'body' });
  const paths = b.photo_paths == null ? [] : b.photo_paths;
  if (!Array.isArray(paths)) throw new ValidationError('photo_paths 는 배열입니다', { field: 'photo_paths' });
  const photos = [...new Set(paths.map(String))];
  if (photos.length > PHOTOS_MAX) throw new ValidationError(`사진은 ${PHOTOS_MAX}장까지입니다`, { field: 'photo_paths' });
  const re = photoPathRe(order);
  if (photos.some((p) => !re.test(p))) throw new ValidationError('이 수주에 올린 사진만 붙일 수 있습니다', { field: 'photo_paths' });
  return { body, photos };
}

/** 간 곳 — 그 수주 프로젝트의 담당자(DB 0042)가 있으면 담당자, 없으면 대표 · 실장 (②). 0042 전이면 대표 · 실장 */
export async function routeOf(env, order) {
  try {
    const p = await selectOne(env, 'projects', { id: `eq.${order.project_id}`, company_id: `eq.${order.company_id}`, select: 'id,assignee_id' });
    if (p && p.assignee_id) return { route: 'assignee', assignee_id: p.assignee_id };
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  return { route: 'owners', assignee_id: null };
}

/**
 * 처리하는 팩토리 — 수주한 업체가 영업 사원 업체(plan manager)이고 그 프로젝트 · 설계로 받은 제작 의뢰가 있으면
 * { company_id, project_id, route, assignee_id } (팩토리 쪽 프로젝트 담당자가 있으면 그 사람에게), 아니면 null.
 */
export async function handlerOf(env, order) {
  const company = await selectOne(env, 'companies', { id: `eq.${order.company_id}`, select: 'id,plan' });
  if (!company || company.plan !== 'manager') return null;
  const read = (key, val) =>
    val
      ? selectMany(env, 'production_requests', {
          company_id: `eq.${order.company_id}`,
          [key]: `eq.${val}`,
          status: 'eq.accepted',
          select: 'id,factory_company_id,factory_project_id,created_at',
          order: 'created_at.desc',
          limit: '5',
        }).catch((e) => {
          if (isMissingRelation(e)) return [];
          throw e;
        })
      : Promise.resolve([]);
  const [byProject, byDesign] = await Promise.all([read('project_id', order.project_id), read('design_id', order.design_id)]);
  const hit = [...(byProject || []), ...(byDesign || [])].find((r) => r.factory_company_id && r.factory_company_id !== order.company_id);
  if (!hit) return null;
  let assignee = null;
  if (hit.factory_project_id) {
    try {
      const p = await selectOne(env, 'projects', {
        id: `eq.${hit.factory_project_id}`,
        company_id: `eq.${hit.factory_company_id}`,
        select: 'id,assignee_id',
      });
      assignee = (p && p.assignee_id) || null;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }
  return {
    company_id: hit.factory_company_id,
    project_id: hit.factory_project_id || null,
    route: assignee ? 'assignee' : 'owners',
    assignee_id: assignee,
  };
}

/** POST /me/orders/:orderId/as-requests/photo */
export async function addAsPhoto(env, { user, params, request }) {
  const order = await myOrderOf(env, user, params.orderId);
  const bytes = await readBodyCapped(request, PHOTO_MAX_BYTES);
  if (!bytes.byteLength) throw new ValidationError('사진 본문이 비었습니다', { code: 'empty' });
  const img = sniffImage(bytes);
  if (img && img.heic) throw new ValidationError('HEIC 사진은 JPEG 로 바꿔 올려 주세요', { code: 'heic' });
  if (!img) throw new ValidationError('사진은 JPEG · PNG 만 받습니다', { code: 'bad_type' });
  if (Math.max(img.width, img.height) > PHOTO_MAX_EDGE || img.width * img.height > PHOTO_MAX_PIXELS) {
    throw new ValidationError(`사진이 너무 큽니다 (긴 변 ${PHOTO_MAX_EDGE}px · ${PHOTO_MAX_PIXELS / 10000}만 화소 이하)`, { code: 'dimensions' });
  }
  const path = `${order.company_id}/${order.id}/${crypto.randomUUID()}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
  try {
    await uploadObject(env, AS_BUCKET, path, bytes, img.mime);
  } catch (e) {
    if (/bucket|not found|404/i.test(String((e && e.message) || ''))) throw dbPending();
    throw e;
  }
  return { photo_path: path };
}

/**
 * 새 접수 알림 — 받는 업체(처리하는 팩토리가 있으면 그 팩토리)의 담당자에게, 없으면 대표 · 실장에게.
 * 팩토리가 받으면 수주한 영업 사원 업체의 대표 · 실장(과 그 프로젝트 담당자)에게 as_factory 도 (던지지 않는다)
 */
export async function notifyAsRequest(env, row, order, { managerAssignee = null } = {}) {
  const msg = buildMessage('as_request', { orderNo: order.order_no });
  if (!msg) return 0;
  const to = row.handler_company_id || order.company_id;
  let sent = 0;
  if (row.route === 'assignee' && row.assignee_id) {
    sent += (await enqueueNotification(env, { userId: row.assignee_id, companyId: to, kind: 'as_request', ...msg, refId: row.id, dedupeKey: `as_request:${row.id}:${row.assignee_id}` })) ? 1 : 0;
  } else {
    sent += await notifyRoles(env, { companyId: to, roles: ['owner', 'manager'], kind: 'as_request', ...msg, refId: row.id });
  }
  if (row.handler_company_id) {
    const told = buildMessage('as_factory', { orderNo: order.order_no });
    if (told)
      sent += await notifyRoles(env, {
        companyId: order.company_id,
        roles: ['owner', 'manager'],
        userIds: managerAssignee ? [managerAssignee] : [],
        kind: 'as_factory',
        ...told,
        refId: row.id,
      });
  }
  return sent;
}

/** POST /me/orders/:orderId/as-requests */
export async function addAsRequest(env, { user, params, body, ctx }) {
  const order = await myOrderOf(env, user, params.orderId);
  const r = requestOf(body, order);
  const [mine, handler] = await Promise.all([routeOf(env, order), handlerOf(env, order)]);
  const to = handler || mine;
  const base = {
    company_id: order.company_id,
    order_id: order.id,
    customer_user_id: user.id,
    body: r.body,
    photos: r.photos,
  };
  let row;
  try {
    row = await insertOne(
      env,
      'as_requests',
      handler
        ? { ...base, route: to.route, assignee_id: to.assignee_id, handler_company_id: handler.company_id, handler_project_id: handler.project_id }
        : { ...base, route: to.route, assignee_id: to.assignee_id }
    );
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    if (!handler) throw dbPending();
    // 0082 전 — 처리하는 업체 칸이 없다: 지금처럼 수주한 업체가 받는다
    try {
      row = await insertOne(env, 'as_requests', { ...base, route: mine.route, assignee_id: mine.assignee_id });
    } catch (e2) {
      if (isMissingRelation(e2)) throw dbPending();
      throw e2;
    }
  }
  const push = notifyAsRequest(env, row, order, { managerAssignee: mine.assignee_id }).catch(() => 0);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(push);
  else await push;
  // 프로젝트 일지 — 고객이 접수했다
  await logProject(env, ctx, {
    companyId: order.company_id,
    projectId: order.project_id,
    actor: { id: user.id, kind: 'customer' },
    type: 'as_requested',
    subject: { type: 'as', id: row.id },
  });
  // 팩토리 쪽 프로젝트 일지에도 — 팩토리가 받는다
  if (row.handler_company_id && row.handler_project_id) {
    await logProject(env, ctx, {
      companyId: row.handler_company_id,
      projectId: row.handler_project_id,
      actor: { id: user.id, kind: 'customer' },
      type: 'as_requested',
      subject: { type: 'as', id: row.id },
    });
  }
  return { id: row.id, state: row.state, route: row.route, created_at: row.created_at };
}

/** GET /me/as-requests */
export async function listMyAsRequests(env, { user }) {
  let rows;
  try {
    rows = (await selectMany(env, 'as_requests', {
      customer_user_id: `eq.${user.id}`,
      select: 'id,company_id,order_id,body,state,created_at,received_at,done_at,cancelled_at',
      order: 'created_at.desc',
      limit: '100',
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, items: [] };
    throw e;
  }
  const names = await namesOf(env, rows);
  return {
    ready: true,
    items: rows.map((r) => ({
      id: r.id,
      factory: names.company.get(r.company_id) || null,
      order_no: names.order.get(r.order_id) || null,
      body: r.body,
      state: r.state,
      label: AS_STATE_LABEL[r.state] || r.state,
      created_at: r.created_at,
      received_at: r.received_at || null,
      done_at: r.done_at || null,
      can_cancel: r.state === 'requested',
    })),
  };
}

/** POST /me/as-requests/:id/cancel */
export async function cancelMyAsRequest(env, { user, params, ctx }) {
  const id = assertUuid(params.id, '접수 id');
  let row;
  try {
    row = await selectOne(env, 'as_requests', { id: `eq.${id}`, select: 'id,customer_user_id,state,order_id' });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!row || row.customer_user_id !== user.id) throw new NotFoundError('접수를 찾을 수 없습니다');
  if (row.state !== 'requested') throw conflict('팩토리가 이미 받은 접수는 거둘 수 없습니다 — 팩토리에 연락해 주세요', 'not_requested');
  const out = await updateBy(env, 'as_requests', { id: `eq.${id}`, state: 'eq.requested', select: 'id,state,cancelled_at' }, { state: 'cancelled' });
  const got = Array.isArray(out) ? out[0] : out;
  if (!got) throw conflict('그 사이 팩토리가 받았습니다', 'not_requested');
  await logAt(env, ctx, { order: row.order_id }, { actor: { id: user.id, kind: 'customer' }, type: 'as_cancelled', subject: { type: 'as', id } });
  return { id, state: 'cancelled', cancelled_at: got.cancelled_at || null };
}

// ── 팩토리 ─────────────────────────────────────────────────

/** 받기 · 끝을 할 수 있나 — 대표 · 실장, 또는 그 접수의 담당자 */
function canHandle(row, user, role) {
  return role === 'owner' || role === 'manager' || (row.assignee_id && row.assignee_id === user.id);
}

/** 사진 → 서명 주소 */
async function signPhotos(env, rows) {
  const paths = rows.flatMap((r) => (Array.isArray(r.photos) ? r.photos : []));
  let urls = new Map();
  if (paths.length) {
    try {
      urls = await createSignedUrls(env, AS_BUCKET, paths);
    } catch (e) {
      console.warn('[as-requests] 사진 서명 주소 실패:', e && e.message);
    }
  }
  return (r) => (Array.isArray(r.photos) ? r.photos : []).map((p) => urls.get(p) || null).filter(Boolean);
}

/** 팩토리 이름 · 주문번호 */
async function namesOf(env, rows) {
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const [companies, orders] = await Promise.all([
    companyIds.length ? selectMany(env, 'companies', { id: `in.(${companyIds.join(',')})`, select: 'id,name' }) : [],
    orderIds.length ? selectMany(env, 'orders', { id: `in.(${orderIds.join(',')})`, select: 'id,order_no' }) : [],
  ]);
  return {
    company: new Map((companies || []).map((c) => [c.id, c.name || null])),
    order: new Map((orders || []).map((o) => [o.id, o.order_no || null])),
  };
}

const AS_LIST_COLUMNS = 'id,company_id,order_id,body,photos,state,route,assignee_id,created_at,received_at,done_at,cancelled_at';

/** 우리 A/S함의 줄 — 우리 수주에 들어온 것 + 우리가 처리하는 팩토리인 것 (0082 전이면 앞의 것만), 새 것부터 */
async function companyRows(env, companyId) {
  const read = (key, cols) =>
    selectMany(env, 'as_requests', { [key]: `eq.${companyId}`, select: cols, order: 'created_at.desc', limit: '200' });
  const withHandler = `${AS_LIST_COLUMNS},handler_company_id,handler_project_id`;
  let own;
  let handled = [];
  try {
    [own, handled] = await Promise.all([read('company_id', withHandler), read('handler_company_id', withHandler)]);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    own = await read('company_id', AS_LIST_COLUMNS);
    handled = [];
  }
  const seen = new Set();
  return [...(own || []), ...(handled || [])]
    .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 200);
}

/** 이 줄을 우리가 받아 처리하나 — 처리하는 팩토리가 따로 있으면 그 팩토리만 */
const weHandle = (r, companyId) => (r.handler_company_id ? r.handler_company_id === companyId : r.company_id === companyId);

/** GET /company/as-requests */
export async function listCompanyAsRequests(env, { user }) {
  const { companyId, role } = await companyOf(env, user);
  let rows;
  try {
    rows = await companyRows(env, companyId);
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, items: [] };
    throw e;
  }
  const names = await namesOf(env, rows);
  const photosOf = await signPhotos(env, rows);
  const handlers = [...new Set(rows.map((r) => r.handler_company_id).filter((id) => id && id !== companyId))];
  const handlerName = new Map(
    handlers.length
      ? ((await selectMany(env, 'companies', { id: `in.(${handlers.join(',')})`, select: 'id,name' })) || []).map((c) => [c.id, c.name || null])
      : []
  );
  return {
    ready: true,
    items: rows.map((r) => ({
      // 처리하는 곳 — mine 우리가 받는다 · factory 만든 팩토리가 처리한다(영업 사원 업체가 보는 줄) · from_manager 영업 사원 업체 고객의 접수를 우리가 받는다
      handled_by: !r.handler_company_id ? 'mine' : r.handler_company_id === companyId ? 'from_manager' : 'factory',
      handler_name: r.handler_company_id && r.handler_company_id !== companyId ? handlerName.get(r.handler_company_id) || null : null,
      id: r.id,
      order_no: names.order.get(r.order_id) || null,
      body: r.body,
      photo_urls: photosOf(r),
      state: r.state,
      label: AS_STATE_LABEL[r.state] || r.state,
      route: r.route,
      mine: r.assignee_id === user.id,
      can_handle: (r.state === 'requested' || r.state === 'received') && weHandle(r, companyId) && canHandle(r, user, role),
      created_at: r.created_at,
      received_at: r.received_at || null,
      done_at: r.done_at || null,
    })),
  };
}

async function myCompanyRequest(env, user, rawId) {
  const id = assertUuid(rawId, '접수 id');
  const { companyId, role } = await companyOf(env, user);
  let row;
  try {
    row = await selectOne(env, 'as_requests', {
      id: `eq.${id}`,
      select: 'id,company_id,order_id,state,assignee_id,handler_company_id,handler_project_id',
    }).catch((e) => {
      if (!isMissingRelation(e)) throw e;
      return selectOne(env, 'as_requests', { id: `eq.${id}`, select: 'id,company_id,order_id,state,assignee_id' });
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!row || (row.company_id !== companyId && row.handler_company_id !== companyId))
    throw new NotFoundError('접수를 찾을 수 없습니다');
  if (!weHandle(row, companyId))
    throw new ForbiddenError('이 A/S 는 만든 팩토리가 받아 처리합니다', 'factory_handles');
  if (!canHandle(row, user, role)) throw new ForbiddenError('A/S 는 그 수주의 담당자나 팩토리 대표 · 실장이 받습니다', 'not_handler');
  return row;
}

/** POST /company/as-requests/:id/receive */
export async function receiveAsRequest(env, { user, params, ctx }) {
  const row = await myCompanyRequest(env, user, params.id);
  if (row.state !== 'requested') throw conflict('이미 받았거나 거둔 접수입니다', 'not_requested');
  const out = await updateBy(env, 'as_requests', { id: `eq.${row.id}`, state: 'eq.requested', select: 'id,received_at' }, { state: 'received', received_by: user.id });
  const got = Array.isArray(out) ? out[0] : out;
  if (!got) throw conflict('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  await logBoth(env, ctx, row, { actor: { id: user.id }, type: 'as_received', subject: { type: 'as', id: row.id } });
  return { id: row.id, state: 'received', received_at: got.received_at || null };
}

/** POST /company/as-requests/:id/done { report_id? } — 그 수주의 A/S 완료 보고(0043)와 잇는다 */
export async function finishAsRequest(env, { user, params, body, ctx }) {
  const row = await myCompanyRequest(env, user, params.id);
  if (row.state !== 'received') throw conflict('받은 접수만 끝낼 수 있습니다', 'not_received');
  const reportId = body && body.report_id != null ? assertUuid(body.report_id, '보고 id') : null;
  // 처리하는 팩토리는 보고를 잇지 않는다 — 완료 보고는 수주한 업체의 수주에 붙는다
  if (reportId && row.handler_company_id)
    throw new ValidationError('만든 팩토리가 처리한 A/S 에는 완료 보고를 잇지 않습니다', { field: 'report_id' });
  if (reportId) {
    const rep = await selectOne(env, 'order_reports', { id: `eq.${reportId}`, order_id: `eq.${row.order_id}`, select: 'id,kind' });
    if (!rep || rep.kind !== 'as_done') throw new ValidationError('이 수주의 「A/S 완료」 보고만 이을 수 있습니다', { field: 'report_id' });
  }
  const out = await updateBy(
    env,
    'as_requests',
    { id: `eq.${row.id}`, state: 'eq.received', select: 'id,done_at' },
    reportId ? { state: 'done', done_report_id: reportId } : { state: 'done' }
  );
  const got = Array.isArray(out) ? out[0] : out;
  if (!got) throw conflict('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  await logBoth(env, ctx, row, { actor: { id: user.id }, type: 'as_done', subject: { type: 'as', id: row.id } });
  return { id: row.id, state: 'done', done_at: got.done_at || null, report_id: reportId };
}

/**
 * 수주 쪽 프로젝트 일지 + 처리하는 팩토리 쪽 프로젝트 일지 (있으면).
 * 팩토리가 한 일은 수주 쪽(영업 사원 업체) 일지에 「누가」 없이 적는다 — 그 업체 구성원이 아니다
 */
async function logBoth(env, ctx, row, ev) {
  await logAt(env, ctx, { order: row.order_id }, row.handler_company_id ? { ...ev, actor: { kind: 'system' } } : ev);
  if (row.handler_company_id && row.handler_project_id)
    await logProject(env, ctx, { companyId: row.handler_company_id, projectId: row.handler_project_id, ...ev });
}

// ── 본사 ──────────────────────────────────────────────────

const hoursBetween = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / HOUR_MS : null);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/**
 * 본사 기록 (순수) — 접수 줄 · 그 기간 끝낸 수주 수(팩토리마다) → { total, waiting, late, avg_receive_hours, avg_done_hours, factories }
 *   late = 접수 상태로 ALERT_HOURS 를 넘긴 것, A/S 율 = 접수 수 ÷ 그 기간 끝낸 수주 수 (끝낸 수주가 없으면 null)
 */
export function asStats(rows, ordersDone, nowMs = Date.now()) {
  const live = (rows || []).filter((r) => r.state !== 'cancelled');
  const by = new Map();
  for (const r of live) {
    const f = by.get(r.company_id) || { company_id: r.company_id, count: 0, done: 0 };
    f.count += 1;
    if (r.state === 'done') f.done += 1;
    by.set(r.company_id, f);
  }
  const doneMap = ordersDone instanceof Map ? ordersDone : new Map();
  for (const id of doneMap.keys()) if (!by.has(id)) by.set(id, { company_id: id, count: 0, done: 0 });
  return {
    total: live.length,
    waiting: live.filter((r) => r.state === 'requested').length,
    late: live.filter((r) => r.state === 'requested' && nowMs - Date.parse(r.created_at) > ALERT_HOURS * HOUR_MS).length,
    avg_receive_hours: avg(live.map((r) => hoursBetween(r.created_at, r.received_at)).filter((x) => x != null)),
    avg_done_hours: avg(live.map((r) => hoursBetween(r.created_at, r.done_at)).filter((x) => x != null)),
    factories: [...by.values()].map((f) => {
      const orders = doneMap.get(f.company_id) || 0;
      return { ...f, orders_done: orders, as_rate: orders ? Math.round((f.count / orders) * 1000) / 10 : null };
    }),
  };
}

/** GET /admin/as-requests?days= */
export async function listAsAdmin(env, { user, query, nowMs = Date.now() }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 볼 수 있습니다');
  const days = query && query.days != null && query.days !== '' ? Number(query.days) : FEED_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > FEED_DAYS_MAX) throw new ValidationError(`days 는 1~${FEED_DAYS_MAX} 입니다`, { field: 'days' });
  const since = new Date(nowMs - days * 86400000).toISOString();
  let rows;
  try {
    rows = (await selectMany(env, 'as_requests', {
      created_at: `gte.${since}`,
      select: 'id,company_id,order_id,state,route,created_at,received_at,done_at,cancelled_at,alerted_at',
      order: 'created_at.desc',
      limit: String(FEED_LIMIT),
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, days, items: [] };
    throw e;
  }
  const done = (await selectMany(env, 'orders', { completed_at: `gte.${since}`, select: 'id,company_id', limit: '5000' })) || [];
  const doneMap = new Map();
  for (const o of done) doneMap.set(o.company_id, (doneMap.get(o.company_id) || 0) + 1);
  const names = await namesOf(env, rows.concat(done.map((o) => ({ company_id: o.company_id }))));
  const stats = asStats(rows, doneMap, nowMs);
  return {
    ready: true,
    days,
    stats: { ...stats, factories: stats.factories.map((f) => ({ ...f, name: names.company.get(f.company_id) || null })) },
    items: rows.map((r) => ({
      id: r.id,
      factory: names.company.get(r.company_id) || null,
      order_no: names.order.get(r.order_id) || null,
      state: r.state,
      label: AS_STATE_LABEL[r.state] || r.state,
      route: r.route,
      created_at: r.created_at,
      received_at: r.received_at || null,
      done_at: r.done_at || null,
      alerted: !!r.alerted_at,
    })),
  };
}

/** 본사 Slack 한 메시지 (순수) — 건수 · 주문번호만 */
export function buildAsAlert(rows, { adminUrl = '' } = {}) {
  const nos = rows.map((r) => safeOrderNo(r.order_no)).filter(Boolean).slice(0, 10);
  const line = `A/S 접수 ${rows.length}건이 ${ALERT_HOURS}시간 넘게 받지 않은 채 있습니다${nos.length ? ` — ${nos.join(' · ')}` : ''}`;
  return { text: adminUrl ? `${line}\n${adminUrl}` : line, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: adminUrl ? `${line}\n<${adminUrl}|A/S 기록 열기>` : line } }] };
}

/** cron — 48시간 넘게 접수 상태인 줄을 알리고 alerted_at 을 찍는다 (던지지 않는다) */
export async function runAsAlerts(env, { nowMs = Date.now() } = {}) {
  const out = { alerted: 0 };
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ...out, skipped: 'supabase' };
  if (!env.SLACK_WEBHOOK_URL) return { ...out, skipped: 'slack' };
  try {
    const before = new Date(nowMs - ALERT_HOURS * HOUR_MS).toISOString();
    const rows = (await selectMany(env, 'as_requests', {
      state: 'eq.requested',
      alerted_at: 'is.null',
      created_at: `lt.${before}`,
      select: 'id,order_id,created_at',
      order: 'created_at.asc',
      limit: '50',
    })) || [];
    if (!rows.length) return out;
    const names = await namesOf(env, rows);
    const base = String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const sent = await postToWebhook(env, buildAsAlert(rows.map((r) => ({ order_no: names.order.get(r.order_id) })), { adminUrl: base ? `${base}/admin/as-requests.html` : '' }));
    if (!sent || !sent.ok) {
      console.error('[as-alert] Slack 전송 실패 — 다음 차례에 다시 알린다');
      return { ...out, failed: rows.length };
    }
    await updateBy(env, 'as_requests', { id: `in.(${rows.map((r) => r.id).join(',')})`, state: 'eq.requested', alerted_at: 'is.null' }, { alerted_at: new Date(nowMs).toISOString() });
    return { alerted: rows.length };
  } catch (e) {
    if (isMissingRelation(e)) return { ...out, skipped: 'db' };
    console.error('[as-alert] 실패:', e && e.message);
    return { ...out, error: true };
  }
}

