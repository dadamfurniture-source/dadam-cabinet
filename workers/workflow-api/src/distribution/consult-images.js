/**
 * 상담 그림 — 연출컷 첫 장 · 고객 현장 사진을 버킷에서 찾아 service_role 로 읽는다.
 * 업체 쪽(company.js GET /company/consults/:id/image)과 본사 쪽(admin.js GET /admin/consultations/:id/image)이 같이 쓴다.
 * 버킷 경로(<user_id>/<generation_id>/…)나 서명 주소는 밖으로 내보내지 않는다 — 그림 그대로만.
 *
 *   연출컷 첫 장  generations.images[0]
 *   현장 사진     generations.inputs.room — 고객이 연출컷을 만들 때 올린 방 사진 (2026-11-23 대표님 「추천 진행」)
 */

import { NotFoundError } from '../supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** 연출컷 첫 장 → { bucket, path } (path 가 없으면 저장된 Storage 주소에서 꺼낸다) */
const OBJECT_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;
export function renderRef(images, defaultBucket) {
  const first = Array.isArray(images) ? images[0] : null;
  if (!first || typeof first !== 'object') return null;
  if (
    typeof first.path === 'string' &&
    first.path &&
    !first.path.startsWith('/') &&
    !first.path.split('/').includes('..')
  ) {
    return { bucket: defaultBucket, path: first.path };
  }
  const m = typeof first.url === 'string' ? OBJECT_URL_RE.exec(first.url) : null;
  if (!m) return null;
  try {
    return {
      bucket: decodeURIComponent(m[1]),
      path: m[2].split('/').map(decodeURIComponent).join('/'),
    };
  } catch {
    return null;
  }
}

/** 고객이 올린 현장 사진 → { bucket, path } | null (generations.inputs.room — 연출컷과 같은 버킷) */
export function roomRef(inputs, defaultBucket) {
  const room = inputs && typeof inputs === 'object' ? inputs.room : null;
  return room && typeof room === 'object' ? renderRef([room], defaultBucket) : null;
}

/** ?kind= — render(기본, 연출컷 첫 장) | room(고객 현장 사진). 그 밖은 404. 값은 없을 때의 글 */
export const IMAGE_KINDS = Object.freeze({ render: '연출컷이 없습니다', room: '현장 사진이 없습니다' });
export function imageKindOf(raw) {
  const k = raw == null || raw === '' ? 'render' : String(raw);
  if (!Object.prototype.hasOwnProperty.call(IMAGE_KINDS, k)) throw new NotFoundError('그림이 없습니다');
  return k;
}

/** service_role 로 버킷 객체를 읽는다 → { bytes, mime }. 없으면 404 (글은 부른 쪽이 정한다) */
export async function readStorageImage(env, ref, missing) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${ref.bucket}/${ref.path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new NotFoundError(missing);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get('Content-Type') || 'application/octet-stream',
  };
}
