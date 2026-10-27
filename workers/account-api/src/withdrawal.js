/**
 * 탈퇴 정리 — auth 사용자를 지우기 **전에** 하는 일 (2026-10-27).
 *
 * 지운다 (사람을 알아볼 수 있는 것):
 *   - Storage: generations 전부(방 사진 · 참고 이미지 · 결과 · 중간 산출물), design-images 전부,
 *     collection 에서 공개 AI 연출컷 복사본을 뺀 나머지(직접 올린 시공사례 사진 등)        — storage-purge.js
 *   - 직접 올린 시공사례 행 (collection_posts.source = 'upload')
 *   - 계정 · 프로필 · 설계 등은 auth 사용자를 지울 때 FK CASCADE 로 (database/withdrawal-retention.sql)
 * 남긴다 (작성자 없이):
 *   - 시공사례에 공개된 AI 연출컷 (source = 'ai_render' 행과 그 collection 복사본) — 행의 user_id · generation_id 는
 *     auth 사용자를 지울 때 FK 가 NULL 로 바꾼다
 *   - 결제 · 구독 기록 — 같은 방식으로 회원과 떼어 남긴다 (결제 키는 지운다, withdrawal-retention.sql)
 *
 * 남길 복사본은 collection_posts 행으로 정한다: 이 회원의 ai_render 행이 가리키는 storage_path. 그 행을 못 읽으면
 * 무엇을 남길지 모르므로 collection 버킷은 건드리지 않고(사유 keep_unknown) 기록한다.
 * 던지지 않는다. 결과에는 수만 담는다 (경로 · 개인 정보 없음).
 */
import { UUID_RE, purgeSummary, purgeUserFiles } from './storage-purge.js';

async function rest(env, path, method) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

/**
 * @returns {Promise<{complete: boolean, errors: string[],
 *   posts: {upload_deleted: number, ai_render_kept: number}, files: object|null}>}
 */
export async function prepareWithdrawal(env, userId) {
  const out = { complete: false, errors: [], posts: { upload_deleted: 0, ai_render_kept: 0 }, files: null };
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    out.errors.push('bad_user_id');
    return out;
  }

  // 1) 남길 것 — 공개된 AI 연출컷과 그 파일
  let keep = null;
  try {
    const rows = await rest(env, `collection_posts?user_id=eq.${userId}&source=eq.ai_render&select=id,storage_path`, 'GET');
    keep = new Set(rows.map((r) => r && r.storage_path).filter(Boolean));
    out.posts.ai_render_kept = rows.length;
  } catch (e) {
    out.errors.push('ai_render_read');
  }

  // 2) 직접 올린 시공사례 행 — 행을 먼저 지운다 (파일을 먼저 지우면 행만 남아 이미지가 깨진다)
  try {
    const rows = await rest(env, `collection_posts?user_id=eq.${userId}&source=eq.upload&select=id`, 'DELETE');
    out.posts.upload_deleted = rows.length;
  } catch (e) {
    out.errors.push('upload_delete');
  }

  // 3) 파일 — collection 은 남길 복사본을 빼고. 남길 것을 모르면 건드리지 않는다.
  out.files = await purgeUserFiles(
    env,
    userId,
    keep ? { keep: { collection: keep } } : { skip: { collection: 'keep_unknown' } }
  );

  out.complete = out.errors.length === 0 && !!out.files.ok;
  return out;
}

/** admin_logs.new_value 에 싣는 결과 — 지운 수 · 남긴 수 · 실패 수만 */
export function withdrawalDetail(w) {
  const files = {};
  for (const [name, b] of Object.entries((w && w.files && w.files.buckets) || {})) {
    files[name] = { deleted: b.deleted, failed: b.failed, ...(b.kept ? { kept: b.kept } : {}), ...(b.error ? { error: b.error } : {}) };
  }
  return {
    complete: !!(w && w.complete),
    posts: { ...((w && w.posts) || {}) },
    files,
    ...(w && w.errors && w.errors.length ? { errors: w.errors.slice() } : {}),
    ...(w && w.files && w.files.error ? { files_error: w.files.error } : {}),
    ...(w && w.files && w.files.truncated ? { truncated: true } : {}),
  };
}

/** 로그 한 줄 (경로 · 회원 id 없음) */
export function withdrawalSummary(w) {
  if (!w) return 'withdrawal: -';
  const p = w.posts || {};
  return (
    `posts: upload_deleted=${p.upload_deleted || 0} ai_render_kept=${p.ai_render_kept || 0}` +
    `${w.errors && w.errors.length ? ` errors=${w.errors.join(',')}` : ''} ${purgeSummary(w.files)} complete=${!!w.complete}`
  );
}
