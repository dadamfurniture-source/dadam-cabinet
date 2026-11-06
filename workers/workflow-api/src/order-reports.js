/**
 * 수주 완료 보고 (DB 0043 order_reports · 버킷 order-report-photos — 2026-11-06 사장님 결정 · 작업 분배 묶음)
 *   ④ 설치 · A/S 는 팩토리마다 자기 사람으로 — 본사에 작업 요청하는 길은 없다
 *   ⑤ 수주에서 「설치 완료」 · 「A/S 완료」 + 사진. 담당자나 대표 · 실장이 누르고 사진을 올린다. 본사는 받아서 기록만 (검수 없음)
 *
 *   POST /orders/:orderId/reports/photo   사진 한 장 (본문 = JPEG · PNG) → { photo_path } — 보고에 붙인다
 *   POST /orders/:orderId/reports         { kind: install_done | as_done, note?, photo_paths? } → 보고 한 줄
 *   GET  /orders/:orderId/reports         그 수주의 보고 (최신순, 사진은 서명 주소 1시간)
 *     보고 · 사진: 그 팩토리의 대표 · 실장, 또는 그 수주 프로젝트의 담당자 (DB 0042 projects.assignee_id)
 *     보기: 그 수주를 볼 수 있는 사람 (설계 접근 — orders.js orderAccess)
 *   GET  /admin/order-reports?days=       본사 관리자 — 모든 팩토리의 최근 보고 (팩토리 이름 · 주문번호 · 종류 · 메모 · 사진)
 *
 * 사진은 서버가 비공개 버킷에 올린다 — 경로 <팩토리 id>/<수주 id>/<uuid>.jpg|png, 5MB · 긴 변 · 화소 한도는 장부 사진과 같다.
 * 수주 상태는 바꾸지 않는다 (보고는 기록이다). 0043 적용 전이면 409 db_pending.
 */
import { ConflictError, ForbiddenError, ValidationError, companyAccess, insertOne, selectMany, selectOne } from './supabase.js';
import { orderAccess } from './orders.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';
import { uploadObject, createSignedUrls } from './storage.js';
import { readBodyCapped } from './ledger/documents.js';
import { sniffImage, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS } from './ledger/checks.js';
import { assertUuid } from './work/validate.js';

export const REPORT_BUCKET = 'order-report-photos';
export const REPORT_KINDS = Object.freeze(['install_done', 'as_done']);
export const REPORT_KIND_LABEL = Object.freeze({ install_done: '설치 완료', as_done: 'A/S 완료' });
export const NOTE_MAX = 500;
export const PHOTOS_MAX = 10;
/** 본사 모아 보기 — 기본 · 최대 날 수, 한 번에 줄 수 */
export const FEED_DAYS = 30;
export const FEED_DAYS_MAX = 90;
export const FEED_LIMIT = 200;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const dbPending = () => {
  const err = new ConflictError('DB 0043 적용 전입니다 — 완료 보고는 적용 뒤에 됩니다');
  err.code = 'db_pending';
  return err;
};

/** 보고 · 사진을 올릴 수 있는가 — 그 팩토리 대표 · 실장, 또는 그 수주 프로젝트의 담당자 */
export async function canReport(env, user, order) {
  const { money } = await companyAccess(env, user);
  if (money.has(order.company_id)) return true;
  if (!order.project_id || !user || !user.id) return false;
  try {
    const p = await selectOne(env, 'projects', {
      id: `eq.${order.project_id}`,
      company_id: `eq.${order.company_id}`,
      select: 'id,assignee_id',
    });
    return !!(p && p.assignee_id && p.assignee_id === user.id);
  } catch (e) {
    if (isMissingRelation(e)) return false; // 0042 전 — 담당자 칸이 없다
    throw e;
  }
}

async function reportableOrder(env, user, rawId) {
  const orderId = assertUuid(rawId, '수주 id');
  const { order } = await orderAccess(env, orderId, user);
  if (!(await canReport(env, user, order)))
    throw new ForbiddenError('완료 보고는 그 수주의 담당자나 팩토리 대표 · 실장이 합니다', 'not_reporter');
  return order;
}

/** 이 수주의 사진 경로 모양 (서버가 올린 것만) */
export const photoPathRe = (order) => new RegExp(`^${order.company_id}/${order.id}/${UUID}\\.(jpg|png)$`);

/** 보낼 보고 본문 검사 (순수) → { kind, note, photos } */
export function reportOf(body, order) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!REPORT_KINDS.includes(b.kind)) throw new ValidationError('kind 는 install_done · as_done 입니다', { field: 'kind' });
  let note = null;
  if (b.note != null) {
    if (typeof b.note !== 'string') throw new ValidationError('메모는 글이어야 합니다', { field: 'note' });
    note = b.note.trim() || null;
    if (note && note.length > NOTE_MAX) throw new ValidationError(`메모는 ${NOTE_MAX}자까지입니다`, { field: 'note' });
  }
  const paths = b.photo_paths == null ? [] : b.photo_paths;
  if (!Array.isArray(paths)) throw new ValidationError('photo_paths 는 배열입니다', { field: 'photo_paths' });
  if (paths.length > PHOTOS_MAX) throw new ValidationError(`사진은 ${PHOTOS_MAX}장까지입니다`, { field: 'photo_paths' });
  const re = photoPathRe(order);
  const photos = [...new Set(paths.map(String))];
  if (photos.some((p) => !re.test(p))) throw new ValidationError('이 수주에 올린 사진만 붙일 수 있습니다', { field: 'photo_paths' });
  return { kind: b.kind, note, photos };
}

/** POST /orders/:orderId/reports/photo — 본문 = 사진 */
export async function addReportPhoto(env, { user, params, request }) {
  const order = await reportableOrder(env, user, params.orderId);
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
    await uploadObject(env, REPORT_BUCKET, path, bytes, img.mime);
  } catch (e) {
    if (/bucket|not found|404/i.test(String((e && e.message) || ''))) throw dbPending();
    throw e;
  }
  return { photo_path: path };
}

/** POST /orders/:orderId/reports */
export async function addOrderReport(env, { user, params, body }) {
  const order = await reportableOrder(env, user, params.orderId);
  const r = reportOf(body, order);
  let row;
  try {
    row = await insertOne(env, 'order_reports', {
      company_id: order.company_id,
      order_id: order.id,
      kind: r.kind,
      note: r.note,
      photos: r.photos,
      reported_by: user.id,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  return { id: row.id, kind: row.kind, note: row.note || null, photo_count: r.photos.length, created_at: row.created_at };
}

/** 줄들의 사진 → 서명 주소 (1시간) — 실패하면 주소 없이 */
async function signPhotos(env, rows) {
  const paths = rows.flatMap((r) => (Array.isArray(r.photos) ? r.photos : []));
  let urls = new Map();
  if (paths.length) {
    try {
      urls = await createSignedUrls(env, REPORT_BUCKET, paths);
    } catch (e) {
      console.warn('[order-reports] 사진 서명 주소 실패:', e && e.message);
    }
  }
  return (r) => (Array.isArray(r.photos) ? r.photos : []).map((p) => urls.get(p) || null).filter(Boolean);
}

/** GET /orders/:orderId/reports */
export async function listOrderReports(env, { user, params }) {
  const orderId = assertUuid(params.orderId, '수주 id');
  const { order } = await orderAccess(env, orderId, user);
  let rows;
  try {
    rows = (await selectMany(env, 'order_reports', {
      order_id: `eq.${order.id}`,
      company_id: `eq.${order.company_id}`,
      select: 'id,kind,note,photos,reported_by,created_at',
      order: 'created_at.desc',
      limit: '100',
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, can_report: false, items: [] };
    throw e;
  }
  const photosOf = await signPhotos(env, rows);
  return {
    ready: true,
    can_report: await canReport(env, user, order),
    items: rows.map((r) => ({ id: r.id, kind: r.kind, label: REPORT_KIND_LABEL[r.kind] || r.kind, note: r.note || null, photo_urls: photosOf(r), created_at: r.created_at, mine: r.reported_by === user.id })),
  };
}

/** GET /admin/order-reports?days= — 본사 관리자 */
export async function listReportsAdmin(env, { user, query, nowMs = Date.now() }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 볼 수 있습니다');
  const raw = query && query.days != null && query.days !== '' ? Number(query.days) : FEED_DAYS;
  if (!Number.isInteger(raw) || raw < 1 || raw > FEED_DAYS_MAX) throw new ValidationError(`days 는 1~${FEED_DAYS_MAX} 입니다`, { field: 'days' });
  const since = new Date(nowMs - raw * 86400000).toISOString();
  let rows;
  try {
    rows = (await selectMany(env, 'order_reports', {
      created_at: `gte.${since}`,
      select: 'id,company_id,order_id,kind,note,photos,created_at',
      order: 'created_at.desc',
      limit: String(FEED_LIMIT),
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, days: raw, items: [] };
    throw e;
  }
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const orderIds = [...new Set(rows.map((r) => r.order_id))];
  const [companies, orders] = await Promise.all([
    companyIds.length ? selectMany(env, 'companies', { id: `in.(${companyIds.join(',')})`, select: 'id,name,kind' }) : [],
    orderIds.length ? selectMany(env, 'orders', { id: `in.(${orderIds.join(',')})`, select: 'id,order_no' }) : [],
  ]);
  const nameOf = new Map((companies || []).map((c) => [c.id, c.name || null]));
  const noOf = new Map((orders || []).map((o) => [o.id, o.order_no || null]));
  const photosOf = await signPhotos(env, rows);
  return {
    ready: true,
    days: raw,
    items: rows.map((r) => ({
      id: r.id,
      company_name: nameOf.get(r.company_id) || null,
      order_no: noOf.get(r.order_id) || null,
      kind: r.kind,
      label: REPORT_KIND_LABEL[r.kind] || r.kind,
      note: r.note || null,
      photo_urls: photosOf(r),
      created_at: r.created_at,
    })),
  };
}

