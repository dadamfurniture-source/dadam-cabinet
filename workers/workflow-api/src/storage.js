/**
 * Supabase Storage — 서명 URL (service role).
 *
 * 렌더 버킷 `renders` 는 비공개다 (database/design-renders.sql). 작업지시서 인쇄 화면은
 * 문서에 동결된 `path` 로 인쇄 시점에 1시간짜리 서명 URL 을 만들어 <img> 에 싣는다.
 * URL 자체는 문서에 저장하지 않는다 — 만료되면 의미가 없고, 경로만 있으면 언제든 다시 만든다.
 */

import { DbError } from './supabase.js';

export const RENDERS_BUCKET = 'renders';
export const SIGNED_URL_TTL_SEC = 3600;

/**
 * 여러 경로의 서명 URL 을 한 번에 만든다.
 * @returns {Map<string, string>} path → 절대 URL. 실패한 경로는 빠진다.
 */
export async function createSignedUrls(env, bucket, paths, expiresIn = SIGNED_URL_TTL_SEC) {
  const unique = [...new Set((paths || []).filter((p) => typeof p === 'string' && p))];
  const out = new Map();
  if (unique.length === 0) return out;

  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn, paths: unique }),
  });
  if (!res.ok) {
    throw new DbError(`Storage sign ${res.status}: ${await res.text()}`, res.status);
  }
  const rows = await res.json();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.error || !row.signedURL) continue;
    // signedURL 은 '/object/sign/<bucket>/<path>?token=…' 형태 (storage/v1 기준 상대 경로)
    const rel = String(row.signedURL).replace(/^\/+/, '');
    out.set(row.path, `${env.SUPABASE_URL}/storage/v1/${rel}`);
  }
  return out;
}
