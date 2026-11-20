/**
 * 본사가 고른 연출컷만 시공사례에 (2026-11-20 대표님 「연출컷은 본사에서 정하고 올릴 수 있도록」, DB 0075).
 *
 * 연출컷 자동 게시는 끔 (wrangler.toml COLLECTION_AUTO_POST "off"). 다담 본사 대표 · 실장 또는 사이트 관리자가
 * 고객의 AI 스튜디오 연출컷 목록을 보고 올리거나 내린다. 앱 시공사례 탭은 source 'upload' 이거나 hq_picked_at 이 있는
 * 게시물만 읽는다 (segan/collection.js). 예전에 자동으로 올라간 행(hq_picked_at 없음)은 목록에 「안 올림」으로 나온다.
 *
 *   GET    /api/hq/collection?before=<ISO 시각>   연출컷 목록 — 새 것부터 PAGE 장, 끝난(done) AI 스튜디오 것만(플래너 모드 빼고)
 *                                                  { items: [{ id, created_at, place_label, door_color, image, picked, picked_at }], next }
 *   POST   /api/hq/collection/:id                  올리기 — 게시물이 있으면 고른 때만 적고, 없으면 대표 연출컷을 복사해 새로 올린다
 *   DELETE /api/hq/collection/:id                  내리기 — 게시물 행과 공개 복사본을 지운다 (removeCollectionPostsFor)
 *
 * 누가: 다담 본사(companies.kind 'platform')의 active 대표 · 실장(owner · manager), 또는 admin_roles 의 admin · super_admin.
 *       아니면 403 not_hq. 고객 이름 · 연락처는 내보내지 않는다 (사진 · 품목 · 문 색 · 만든 때만 — 비공개 사진 주소의 경로에는 버킷 폴더인 회원 id 가 들어 있다).
 * 사진 주소는 비공개 버킷의 1시간짜리 서명 주소 — 목록을 다시 읽으면 새로 받는다.
 * DB 0075 적용 전이면(hq_picked_at 칸 없음) 409 db_pending.
 */

import {
  COLLECTION_CATEGORY,
  collectionPostInfo,
  postToCollection,
  removeCollectionPostsFor,
} from './collection-post.js';
import { OWNER_SIGNED_TTL_SEC, signImageUrls } from './storage-urls.js';
import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  bucketName,
  selectMany,
  selectOne,
  updateById,
} from './supabase.js';

export const HQ_PICK_ROLES = Object.freeze(['owner', 'manager']);
export const HQ_PICK_ADMIN_ROLES = Object.freeze(['admin', 'super_admin']);
export const HQ_COLLECTION_PAGE = 24;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = Object.keys(COLLECTION_CATEGORY);

function notHq() {
  const err = new ForbiddenError('다담 본사 대표 · 실장만 고를 수 있습니다');
  err.code = 'not_hq';
  return err;
}

function dbPending() {
  const err = new ConflictError('DB 0075 적용 전입니다');
  err.code = 'db_pending';
  return err;
}

/** 칸이 없다는 PostgREST 오류 (DB 0075 전) — 42703 · PGRST204 */
export function isMissingColumn(e) {
  const m = String((e && e.message) || '');
  return e instanceof DbError && /42703|PGRST204|hq_picked/.test(m);
}

/** 고를 수 있는 사람인가 — 사이트 관리자 또는 다담 본사 active 대표 · 실장. 아니면 던진다 */
export async function assertHqPicker(env, user) {
  if (!user || !user.id) throw notHq();
  const admin = await selectOne(env, 'admin_roles', { user_id: `eq.${user.id}`, select: 'role' });
  if (admin && HQ_PICK_ADMIN_ROLES.includes(admin.role)) return { via: 'admin' };
  const platform = await selectOne(env, 'companies', { kind: 'eq.platform', select: 'id' });
  if (!platform || !platform.id) throw notHq();
  const rows = await selectMany(env, 'company_members', {
    user_id: `eq.${user.id}`,
    company_id: `eq.${platform.id}`,
    status: 'eq.active',
    select: 'role',
  });
  if ((rows || []).some((r) => HQ_PICK_ROLES.includes(r.role))) return { via: 'platform' };
  throw notHq();
}

/** generations 행의 대표 연출컷 칸 (images 의 base 슬롯) */
function baseImage(row) {
  const list = Array.isArray(row && row.images) ? row.images : [];
  return list.find((im) => im && im.slot === 'base' && im.path) || null;
}

/** 고를 수 있는 연출컷인가 — 끝남 · AI 스튜디오(플래너 모드 아님) · 아는 품목 · 대표 연출컷 있음 */
export function pickable(row) {
  if (!row || row.status !== 'done') return false;
  const opts = row.options || {};
  if (opts.mode === 'planner') return false;
  if (!CATEGORIES.includes(row.category)) return false;
  return !!baseImage(row);
}

/**
 * 목록 — 새 것부터 PAGE 장 (끝난 AI 스튜디오 연출컷), 그 게시물이 본사가 고른 것인지.
 * @param {string} [before] ISO 시각 — 이보다 앞 것
 */
export async function listHqCollection(env, before) {
  const query = {
    status: 'eq.done',
    category: `in.(${CATEGORIES.join(',')})`,
    or: '(options->>mode.is.null,options->>mode.neq.planner)',
    select: 'id,status,category,options,images,created_at',
    order: 'created_at.desc',
    limit: String(HQ_COLLECTION_PAGE),
  };
  if (before) {
    if (Number.isNaN(Date.parse(before))) throw new ValidationError('before 가 시각이 아닙니다');
    query.created_at = `lt.${new Date(before).toISOString()}`;
  }
  const rows = ((await selectMany(env, 'generations', query)) || []).filter(pickable);
  let posts = [];
  if (rows.length) {
    try {
      posts =
        (await selectMany(env, 'collection_posts', {
          generation_id: `in.(${rows.map((r) => r.id).join(',')})`,
          select: 'generation_id,hq_picked_at',
        })) || [];
    } catch (e) {
      if (isMissingColumn(e)) throw dbPending();
      throw e;
    }
  }
  const pickedAt = new Map(posts.map((p) => [p.generation_id, p.hq_picked_at || null]));
  const signed = await signImageUrls(
    env,
    rows.map((r) => baseImage(r)),
    bucketName(env),
    OWNER_SIGNED_TTL_SEC
  );
  const items = rows.map((r, i) => {
    const info = collectionPostInfo({ category: r.category, options: r.options });
    const at = pickedAt.get(r.id) || null;
    return {
      id: r.id,
      created_at: r.created_at,
      place_label: info.place_label,
      door_color: info.door_color,
      image: (signed[i] && signed[i].url) || null,
      picked: !!at,
      picked_at: at,
    };
  });
  const next = rows.length === HQ_COLLECTION_PAGE ? rows[rows.length - 1].created_at : null;
  return { items, next };
}

async function pickableRow(env, id) {
  if (!UUID_RE.test(String(id || ''))) throw new NotFoundError('연출컷을 찾을 수 없습니다');
  const row = await selectOne(env, 'generations', {
    id: `eq.${id}`,
    select: 'id,user_id,status,category,options,images',
  });
  if (!row || !pickable(row)) throw new NotFoundError('올릴 수 있는 연출컷이 아닙니다');
  return row;
}

/** 올리기 — 있으면 고른 때만 적고, 없으면 대표 연출컷을 복사해 새 게시물 */
export async function pickHqCollection(env, id, user, { now = () => new Date().toISOString(), patch = updateById } = {}) {
  const row = await pickableRow(env, id);
  const mark = { hq_picked_at: now(), hq_picked_by: user.id };
  let existing;
  try {
    existing = await selectOne(env, 'collection_posts', {
      generation_id: `eq.${row.id}`,
      select: 'id,hq_picked_at',
    });
  } catch (e) {
    if (isMissingColumn(e)) throw dbPending();
    throw e;
  }
  if (existing) {
    if (!existing.hq_picked_at) await patch(env, 'collection_posts', existing.id, mark);
    return { picked: true, created: false };
  }
  const job = { id: row.id, userId: row.user_id, category: row.category, options: row.options || {} };
  const ck = { images: { base: baseImage(row) } };
  const res = await postToCollection(env, job, ck, { force: true, extra: mark });
  if (res.posted) return { picked: true, created: true };
  if (res.reason === 'duplicate') {
    // 그 사이 다른 본사 사람이 올렸다 — 고른 때가 없으면 적는다
    const again = await selectOne(env, 'collection_posts', { generation_id: `eq.${row.id}`, select: 'id,hq_picked_at' });
    if (again && !again.hq_picked_at) await patch(env, 'collection_posts', again.id, mark);
    return { picked: true, created: false };
  }
  throw new DbError(`시공사례에 올리지 못했습니다 (${res.reason})`);
}

/** 내리기 — 게시물 행과 공개 복사본을 지운다 */
export async function unpickHqCollection(env, id) {
  if (!UUID_RE.test(String(id || ''))) throw new NotFoundError('연출컷을 찾을 수 없습니다');
  const out = await removeCollectionPostsFor(env, id);
  if (out.error) throw new DbError(`시공사례에서 내리지 못했습니다 (${out.error})`);
  return { picked: false, removed: out.removed };
}
