/**
 * 내보내기 이미지 주소 — 고객 사진 버킷은 서명 URL 로 (2026-10-26).
 *
 * generations · design-images 버킷은 비공개가 된다. dataset_samples.image_url 에는 공개 URL 이 저장돼 있어서
 * 그대로 내보내면 학습 쪽이 받지 못한다. 내보낼 때 service_role 로 7일짜리 서명 URL 을 만들어 image.url 에 싣고,
 * 나중에 다시 서명할 수 있게 image.bucket · image.path 도 싣는다. 다른 버킷(시공사례 등)·외부 주소는 그대로.
 * 서명을 못 하면 저장된 URL 을 그대로 둔다 (bucket · path 는 싣는다).
 *
 * toStorageRef 는 js/storage-urls.js · workers/generate-api/src/storage-urls.js 와 같은 규칙이다 (워커끼리 import 하지 않아 복사).
 * 이 파일은 import 가 없다 — 시험(__tests__/dataset-export-signing.test.js)이 export 를 떼고 평가한다.
 */

/** 서명하는 버킷 — 고객 사진 */
export const PRIVATE_BUCKETS = ['generations', 'design-images'];
/** 내보내기 서명 수명 (초) — 7일. 내보내기는 밤마다 다시 돈다 */
export const EXPORT_SIGNED_TTL_SEC = 7 * 24 * 3600;

// /storage/v1/object/public|sign|authenticated/<bucket>/<path>[?…]
const OBJECT_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

function decodeSegment(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 저장된 값 → { bucket, path }.
 *   - Supabase Storage 객체 URL (공개 · 서명 · authenticated) 이면 그 안의 버킷·경로
 *   - bucket 을 주면 버킷 안 경로도 받는다
 *   - 그 밖(data: · blob: · 다른 서버 · 사이트 상대 경로)은 null
 */
export function toStorageRef(value, bucket) {
  if (typeof value !== 'string' || !value) return null;
  const m = OBJECT_URL_RE.exec(value);
  if (m) return { bucket: decodeSegment(m[1]), path: m[2].split('/').map(decodeSegment).join('/') };
  if (!bucket) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.split('/').includes('..')) return null;
  return { bucket, path: value };
}

/**
 * 주소 여러 개 → 내보낼 { url, bucket, path } (같은 순서).
 * 고객 사진 버킷이면 sign(bucket, paths) 로 서명한 url 과 bucket · path, 아니면 { url: 그대로, bucket: null, path: null }.
 * @param {Array<string|null>} values  dataset_samples.image_url
 * @param {(bucket: string, paths: string[]) => Promise<Map<string,string>>} sign  버킷마다 한 번 부른다
 */
export async function signImageRefs(values, sign) {
  const list = Array.isArray(values) ? values : [];
  const refs = list.map((v) => {
    const r = toStorageRef(v);
    return r && PRIVATE_BUCKETS.includes(r.bucket) ? r : null;
  });
  const byBucket = new Map();
  for (const r of refs) {
    if (!r) continue;
    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, new Set());
    byBucket.get(r.bucket).add(r.path);
  }
  const signed = new Map(); // bucket → Map(path → url)
  for (const [bucket, paths] of byBucket) {
    try {
      signed.set(bucket, await sign(bucket, [...paths]));
    } catch (e) {
      console.warn(`[export] ${bucket} 서명 실패 — 저장된 주소를 그대로 씁니다:`, String((e && e.message) || e).slice(0, 200));
    }
  }
  return list.map((v, i) => {
    const r = refs[i];
    if (!r) return { url: v == null ? null : v, bucket: null, path: null };
    const url = (signed.get(r.bucket) && signed.get(r.bucket).get(r.path)) || v;
    return { url, bucket: r.bucket, path: r.path };
  });
}
