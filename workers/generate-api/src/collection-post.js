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
 *   'ai/{무작위 UUID}.{ext}' 에 복사하고, 그 공개 URL 로 collection_posts 행을 만든다 (source 'ai_render', generation_id).
 *   공개 주소에 회원 id · 연출컷 id 를 넣지 않는다 (2026-11-09, DB 0052 — 옛 경로 '{user_id}/gen-{generation_id}.{ext}'
 *   는 주소만 보고 올린 사람마다 묶을 수 있었다). 파일 주인(owner_id)은 DB 트리거가 게시물 주인으로 채운다 —
 *   회원이 「시공사례에서 내리기」로 그 파일을 지운다 (0052 trg_collection_posts_ai_owner · collection_delete_owner).
 *   행은 generation_id UNIQUE 에 ignore-duplicates 로 넣는다 — 'done' 이 두 번 와도 게시물은 하나다
 *   (database/collection-auto-post.sql). 경로가 부를 때마다 새로 정해지므로, 게시물이 이미 있어 행이 들어가지
 *   않았거나 행을 못 넣었으면 방금 올린 파일을 지운다.
 *
 * 사진 정보 (2026-11-08, DB 0049 — 앱 시공사례에서 사진을 누르면 보이는 장소 · 색상 · 업체):
 *   place_label  품목 이름 (COLLECTION_PLACE_LABEL). 지역은 넣지 않는다 — 연출컷의 방은 고객 집이다
 *   door_color   문짝 색 이름 (COLLECTION_DOOR_COLOR, options.door_color). 모르는 값이면 비운다
 *   company_id   올린 사람이 active 구성원인 업체 (본사 · 협력업체), 아니면 비운다 — 고객 혼자 만든 연출컷.
 *                generations.company_id 는 쓰지 않는다 (이 서버가 넣지 않아 늘 기본값 본사다).
 *                직접 올린 사진의 같은 규칙은 DB 지킴이 collection_posts_info_guard 가 맡는다 (0049 머리말)
 *   이름 글은 화면 글 그대로다 (ai-design.html KINDS · #doorColor, segan/make.js) — 0049 의 채우기와 같은 표.
 *   새 칸은 DB 0049 가 만든다 — 0049 를 적용한 뒤에 배포한다 (없으면 행 넣기가 실패해 게시가 빠진다).
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

/**
 * 생성 품목 → 장소 표시(collection_posts.place_label). 화면 품목 이름 그대로 (ai-design.html · segan/make.js KINDS).
 * DB 0049 의 채우기(generations.category CASE)와 같은 표다 — 시험이 견준다.
 */
export const COLLECTION_PLACE_LABEL = Object.freeze({
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  storage: '수납장',
  fridge: '냉장고장',
  vanity: '화장대',
  shoe: '신발장',
  office: '사무실',
  study: '서재',
  bedroom: '침실',
});

/**
 * 문짝 색 값(prompts.js DOOR_COLORS) → 화면 이름(collection_posts.door_color). ai-design.html #doorColor · segan/make.js DOORS 글 그대로.
 * DB 0049 의 채우기(options.door_color CASE)와 같은 표다.
 */
export const COLLECTION_DOOR_COLOR = Object.freeze({
  white: '화이트',
  cream: '크림',
  'light grey': '라이트 그레이',
  greige: '그레이지',
  'oak woodgrain': '오크',
  'walnut woodgrain': '월넛',
  charcoal: '차콜',
});

/** 게시물의 장소 · 문짝 색 이름 — 모르는 값이면 null */
export function collectionPostInfo(job) {
  const opts = (job && job.options) || {};
  return {
    place_label: COLLECTION_PLACE_LABEL[job && job.category] || null,
    door_color: COLLECTION_DOOR_COLOR[opts.door_color] || null,
  };
}

/**
 * 올린 사람의 업체 — active 구성원인 업체 id (한 사람은 active 업체 하나뿐, 0003 부분 유니크). 아니면 null.
 * service_role 로 company_members 를 읽는다. 실패는 던진다 (postToCollection 이 게시를 건너뛴다).
 */
export async function posterCompanyId(env, userId) {
  const rows = await selectMany(env, 'company_members', {
    user_id: `eq.${userId}`,
    status: 'eq.active',
    select: 'company_id',
    limit: '1',
  });
  return (Array.isArray(rows) && rows[0] && rows[0].company_id) || null;
}

/** 공개 버킷 collection 안 AI 연출컷 복사본 폴더 — 회원이 올리는 사진은 'p/' (DB 0052) */
export const COLLECTION_AI_PREFIX = 'ai';

/** 'ai/{무작위 UUID}.{ext}' — 부를 때마다 새 경로. 회원 id · 연출컷 id 를 넣지 않는다 */
export function collectionPath(mimeType) {
  return `${COLLECTION_AI_PREFIX}/${crypto.randomUUID()}.${extOf(mimeType)}`;
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
    // 업체는 파일을 올리기 전에 — 못 읽으면 아무것도 올리지 않고 건너뛴다
    const companyId = await posterCompanyId(env, job.userId);
    path = collectionPath(img.mimeType);
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
        ...collectionPostInfo(job),
        company_id: companyId,
      },
      'generation_id'
    );
    console.log(`[Job ${job.id}] collection: ${row ? 'posted' : 'already posted'} ${path}`);
    if (!row) {
      // 이미 있는 게시물은 그때 올린 다른 경로를 가리킨다 — 방금 올린 파일은 주인 없는 공개 파일이라 지운다
      await removeObjects(env, [path], COLLECTION_BUCKET);
      return { posted: false, reason: 'duplicate' };
    }
    return { posted: true, reason: undefined, path };
  } catch (e) {
    console.warn(`[Job ${job.id}] collection post skipped:`, e.message);
    // 행이 없으면 방금 올린 파일은 주인 없는 공개 파일이다 — 지운다. 같은 연출컷의 행이 이 경로를 가리킨다고
    //   확인될 때만 (행은 들어갔는데 응답을 못 받은 때) 남긴다. 확인을 못 하면 지운다.
    if (path) {
      let keep = false;
      try {
        const existing = await selectMany(env, 'collection_posts', {
          generation_id: `eq.${job.id}`,
          storage_path: `eq.${path}`,
          select: 'id',
        });
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
