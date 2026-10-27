/**
 * 서명 URL — generations 버킷을 비공개로 바꿔도 화면이 그대로 보이게 (2026-10-26).
 *
 * 행(generations.images[].url 등)에는 공개 URL 이 저장돼 있다. 행은 옮기지 않는다.
 * 내보낼 때만 경로(images[].path, 없으면 저장된 URL 에서 꺼낸 경로)로 서명 URL 을 만들어 url 을 바꿔 싣는다.
 * service_role 로 서명하므로 버킷이 공개든 비공개든 결과가 같다 — 코드가 SQL 보다 먼저 나갈 수 있다.
 *
 * 화면 쪽 js/storage-urls.js 의 toStorageRef 와 같은 규칙이다 (워커는 저장소 밖 파일을 import 하지 않는다).
 * 서명을 못 하면(요청 실패·그 경로만 실패) 저장된 URL 을 그대로 둔다 — 지금(공개 버킷)과 같은 결과다.
 */

/** 본인 화면 (GET /api/generate/:id — ai-design.html · 플래너 사진 패널) */
export const OWNER_SIGNED_TTL_SEC = 3600;
/** 공유 열람 (GET /api/share) — 링크가 남은 시간과 이 값 중 짧은 쪽 */
export const SHARE_SIGNED_MAX_SEC = 3600;

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
 *   - bucket 을 주면 버킷 안 경로('uid/gid/base.png')도 받는다
 *   - 그 밖(data: · blob: · 다른 서버 · 사이트 상대 경로)은 null — 서명할 대상이 아니다
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
 * 한 버킷의 경로 여러 개를 한 번에 서명한다.
 * @returns {Promise<Map<string,string>>} path → 절대 URL. 실패한 경로는 빠진다.
 */
export async function createSignedUrls(env, bucket, paths, expiresIn) {
  const unique = [...new Set((paths || []).filter((p) => typeof p === 'string' && p))];
  const out = new Map();
  if (!unique.length) return out;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn, paths: unique }),
  });
  if (!res.ok) throw new Error(`Storage sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.error || !row.signedURL) continue;
    // signedURL 은 storage/v1 기준 상대 경로 ('/object/sign/<bucket>/<path>?token=…')
    out.set(row.path, `${env.SUPABASE_URL}/storage/v1/${String(row.signedURL).replace(/^\/+/, '')}`);
  }
  return out;
}

/**
 * images 배열(generations.images 모양)의 url 을 서명 URL 로 바꾼 새 배열. 원본은 건드리지 않는다.
 * bucket 버킷 것만 서명한다 — 다른 버킷(공개 카탈로그 등)·외부 주소는 그대로 둔다.
 */
export async function signImageUrls(env, images, bucket, expiresIn) {
  const list = Array.isArray(images) ? images : [];
  const refs = list.map((im) => (im ? toStorageRef(im.path, bucket) || toStorageRef(im.url) : null));
  const paths = refs.filter((r) => r && r.bucket === bucket).map((r) => r.path);
  let signed = new Map();
  if (paths.length) {
    try {
      signed = await createSignedUrls(env, bucket, paths, expiresIn);
    } catch (e) {
      console.warn('[Storage] sign failed — stored URLs kept:', e.message);
    }
  }
  return list.map((im, i) => {
    const r = refs[i];
    const url = r && r.bucket === bucket ? signed.get(r.path) : null;
    return url ? { ...im, url } : im;
  });
}

/**
 * 공유 열람의 서명 수명(초) — 링크가 남은 시간, 최대 SHARE_SIGNED_MAX_SEC.
 * share_expires_at 이 없으면(열람 검사가 만료를 보지 않는 행) 최대값.
 */
export function shareSignedTtl(expiresAt, now = Date.now()) {
  const end = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (!Number.isFinite(end)) return SHARE_SIGNED_MAX_SEC;
  const left = Math.floor((end - now) / 1000);
  return Math.max(1, Math.min(SHARE_SIGNED_MAX_SEC, left));
}
