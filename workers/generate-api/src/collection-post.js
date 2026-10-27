/**
 * 시공사례(collection) 자동 게시 — AI 스튜디오 연출컷이 완성되면 대표 연출컷 한 장을 올린다 (2026-10-27).
 *
 * 무엇을 올리나:
 *   - 기본안(images 의 'base' 슬롯) 한 장만. 화면이 대표로 보여 주는 칸이다 (slotList 순서 base → v1…, my-designs
 *     썸네일 · ai-design 첫 칸 · '기본안 다운로드' 가 모두 images[0] = base). 추천안 v1~v3, 방 사진(room) ·
 *     참고 이미지(ref-*) · 도면 렌더(render-*) 는 올리지 않는다.
 *   - AI 스튜디오(일반 경로)만. 플래너 모드(options.mode === 'planner')는 올리지 않는다.
 *   - status 'done' 으로 닫는 두 곳(runPipeline 마무리 · fail() 의 기본안 있음)에서만 부른다.
 *
 * 어떻게:
 *   generations 버킷은 비공개다 — 그 주소를 쓰지 않는다. service_role 로 기본안을 읽어 공개 버킷 `collection` 의
 *   '{user_id}/gen-{generation_id}.{ext}' 에 복사하고, 그 공개 URL 로 collection_posts 행을 만든다
 *   (source 'ai_render', generation_id). 경로가 정해져 있어 다시 올려도 같은 파일이다.
 *   행은 generation_id UNIQUE 에 ignore-duplicates 로 넣는다 — 'done' 이 두 번 와도 게시물은 하나다
 *   (database/collection-auto-post.sql). 행을 못 넣으면 복사한 파일을 지운다.
 *
 * 실패해도 연출컷은 그대로다: 'done' 패치를 보낸 뒤에 부르고, 여기서는 던지지 않는다 (로그만).
 * 켜고 끄기: wrangler.toml COLLECTION_AUTO_POST — 'on' 일 때만 올린다.
 */

import {
  base64ToBytes,
  deleteWhere,
  extOf,
  fetchObjectBase64,
  insertIgnoreDuplicate,
  removeObjects,
  selectMany,
  storagePublicUrl,
  uploadBytes,
} from './supabase.js';

export const COLLECTION_BUCKET = 'collection';
/** collection 버킷의 다른 업로드(mypage.html 시공사례 올리기, cacheControl '3600')와 같은 값 */
export const COLLECTION_CACHE_CONTROL = 'max-age=3600';

/**
 * generations.category → collection_posts.category (CHECK: kitchen · builtin · storage · interior · other).
 * ai-design.html KINDS 의 collection 값(시공사례 탭을 품목으로 거를 때 쓰는 짝)과 같다 — 새로 정한 짝이 아니다.
 * 표에 없는 품목은 올리지 않는다.
 */
export const COLLECTION_CATEGORY = Object.freeze({
  sink: 'kitchen',
  island: 'kitchen',
  fridge: 'kitchen',
  wardrobe: 'builtin',
  shoe: 'builtin',
  bedroom: 'builtin',
  storage: 'storage',
  vanity: 'interior',
  office: 'other',
  study: 'other',
});

export function collectionPath(userId, generationId, mimeType) {
  return `${userId}/gen-${generationId}.${extOf(mimeType)}`;
}

/**
 * 올릴지 판단 — 이유를 돌려준다 (로그·시험용). ok 면 { ok: true, base, category }.
 * @param {object} env
 * @param {{id, userId, category, options}} job
 * @param {{images?: object}} ck
 */
export function collectionPostPlan(env, job, ck) {
  if (env.COLLECTION_AUTO_POST !== 'on') return { ok: false, reason: 'off' };
  const opts = (job && job.options) || {};
  if (opts.mode === 'planner') return { ok: false, reason: 'planner' };
  if (!job || !job.id || !job.userId) return { ok: false, reason: 'no_job' };
  const base = ck && ck.images && ck.images.base;
  if (!base || !base.path) return { ok: false, reason: 'no_base' };
  const category = COLLECTION_CATEGORY[job.category];
  if (!category) return { ok: false, reason: 'unknown_category' };
  return { ok: true, base, category };
}

/**
 * 대표 연출컷을 시공사례에 올린다. 던지지 않는다.
 * @returns {Promise<{posted: boolean, reason?: string, path?: string}>}
 */
export async function postToCollection(env, job, ck) {
  const plan = collectionPostPlan(env, job, ck);
  if (!plan.ok) return { posted: false, reason: plan.reason };
  let path = null;
  try {
    const img = await fetchObjectBase64(env, plan.base.path);
    path = collectionPath(job.userId, job.id, img.mimeType);
    await uploadBytes(env, COLLECTION_BUCKET, path, base64ToBytes(img.base64), img.mimeType, COLLECTION_CACHE_CONTROL);
    const row = await insertIgnoreDuplicate(
      env,
      'collection_posts',
      {
        user_id: job.userId,
        image_url: storagePublicUrl(env, COLLECTION_BUCKET, path),
        storage_path: path,
        category: plan.category,
        source: 'ai_render',
        generation_id: job.id,
      },
      'generation_id'
    );
    console.log(`[Job ${job.id}] collection: ${row ? 'posted' : 'already posted'} ${path}`);
    return { posted: !!row, reason: row ? undefined : 'duplicate', path };
  } catch (e) {
    console.warn(`[Job ${job.id}] collection post skipped:`, e.message);
    // 행이 없으면 방금 올린 파일은 주인 없는 공개 파일이다 — 지운다. 같은 연출컷의 행이 있다고 확인될 때만
    //   (그 행이 가리키는 같은 경로라) 남긴다. 확인을 못 하면 지운다.
    if (path) {
      let keep = false;
      try {
        const existing = await selectMany(env, 'collection_posts', { generation_id: `eq.${job.id}`, select: 'id' });
        keep = Array.isArray(existing) && existing.length > 0;
      } catch (e2) {
        console.warn(`[Job ${job.id}] collection cleanup check failed:`, e2.message);
      }
      if (!keep) await removeObjects(env, [path], COLLECTION_BUCKET);
    }
    return { posted: false, reason: 'error' };
  }
}

/**
 * 연출컷을 지울 때 그 시공사례 게시물과 복사한 파일도 지운다 (DELETE /api/generate/:id).
 * 행은 generation_id FK ON DELETE CASCADE 로도 지워지지만 파일은 남는다 — 그래서 여기서 먼저 지운다.
 * 던지지 않는다 (연출컷 삭제를 막지 않는다).
 */
export async function removeCollectionPostsFor(env, generationId) {
  try {
    const rows = await deleteWhere(env, 'collection_posts', { generation_id: `eq.${generationId}` }, 'storage_path');
    const paths = (rows || []).map((r) => r && r.storage_path).filter(Boolean);
    if (paths.length) await removeObjects(env, paths, COLLECTION_BUCKET);
    return { removed: (rows || []).length };
  } catch (e) {
    console.warn(`[Generate] collection post cleanup for ${generationId} skipped:`, e.message);
    return { removed: 0, error: e.message };
  }
}
