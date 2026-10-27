/**
 * 탈퇴 정리 — auth 사용자를 지우기 **전에** 하는 일 (2026-10-27).
 *
 * 지운다 (사람을 알아볼 수 있는 것):
 *   - Storage: generations 전부(방 사진 · 참고 이미지 · 결과 · 중간 산출물), design-images 전부,
 *     collection 에서 공개 AI 연출컷 복사본을 뺀 나머지(직접 올린 시공사례 사진 등)        — storage-purge.js
 *   - 직접 올린 시공사례 행 (collection_posts.source = 'upload')
 *   - 계약 기록이 없는 설계 — 행(딸린 품목 · 도면 스냅샷 · 렌더 기록 · 현장 정보 등은 FK CASCADE)과
 *     그 설계의 renders · cad 파일
 *   - 계정 · 프로필 등은 auth 사용자를 지울 때 FK CASCADE 로
 * 남긴다 (회원과 떼어):
 *   - 시공사례에 공개된 AI 연출컷 (source = 'ai_render' 행과 그 collection 복사본)
 *   - 결제 · 구독 기록 (결제 키는 지운다)                                        — database/withdrawal-retention.sql
 *   - 계약 기록이 있는 설계 — 고객 확인서 · 계약 시점 설계 · 시공 일정 · 시공 주소 · 수주가 딸린 설계 행 그대로,
 *     그 설계의 renders · cad 파일도. 크레딧 원장도 남긴다.                       — database/withdrawal-contract-records.sql
 *   auth 사용자를 지울 때 남은 행의 user_id 는 FK 가 NULL 로 바꾼다.
 *
 * 어느 설계가 계약 기록인지는 DB 함수 withdrawal_designs(회원) 가 정한다 (withdrawal-contract-records.sql).
 * 그 함수를 못 부르면 어느 설계도 지우지 않는다 — 계약 기록을 잃는 것보다 더 남기는 쪽이 안전하다.
 * 남길 AI 연출컷 복사본은 collection_posts 행으로 정한다. 그 행을 못 읽으면 collection 버킷은 건드리지 않는다.
 * 던지지 않는다. 결과에는 수만 담는다 (경로 · 개인 정보 없음).
 */
import { UUID_RE, makePurgeContext, purgeDesignFiles, purgeSummary, purgeUserFiles } from './storage-purge.js';

/** 설계 행을 한 번에 지우는 수 (URL 길이) */
export const DESIGN_DELETE_CHUNK = 100;

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function rest(env, path, method, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: serviceHeaders(env),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

/**
 * 회원의 설계를 계약 기록이 있는 것 · 없는 것으로 나눈다.
 * @returns {Promise<{contract: string[], other: string[]}>}
 */
async function splitDesigns(env, userId) {
  const rows = await rest(env, 'rpc/withdrawal_designs', 'POST', { p_user_id: userId });
  const contract = [];
  const other = [];
  for (const r of rows) {
    if (!r || typeof r.design_id !== 'string' || !UUID_RE.test(r.design_id)) continue;
    (r.contract === true ? contract : other).push(r.design_id);
  }
  return { contract, other };
}

/** 계약 기록이 없는 설계 행을 지운다 — 이 회원의 것만. 실제로 지운 id 를 돌려준다. */
async function deleteDesigns(env, userId, ids) {
  const deleted = [];
  let failed = 0;
  for (let i = 0; i < ids.length; i += DESIGN_DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DESIGN_DELETE_CHUNK);
    try {
      const rows = await rest(env, `designs?id=in.(${chunk.join(',')})&user_id=eq.${userId}&select=id`, 'DELETE');
      const got = new Set(rows.map((r) => r && r.id));
      for (const id of chunk) if (got.has(id)) deleted.push(id);
      failed += chunk.length - got.size;
    } catch (e) {
      failed += chunk.length;
    }
  }
  return { deleted, failed };
}

/**
 * @returns {Promise<{complete: boolean, errors: string[],
 *   posts: {upload_deleted: number, ai_render_kept: number},
 *   designs: {deleted: number, kept: number, failed: number},
 *   files: object|null, designFiles: object|null}>}
 */
export async function prepareWithdrawal(env, userId) {
  const out = {
    complete: false,
    errors: [],
    posts: { upload_deleted: 0, ai_render_kept: 0 },
    designs: { deleted: 0, kept: 0, failed: 0 },
    files: null,
    designFiles: null,
  };
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

  // 3) 설계 — 계약 기록이 없는 것만 지운다. 나누지 못하면 하나도 지우지 않는다.
  let goneDesigns = [];
  try {
    const { contract, other } = await splitDesigns(env, userId);
    out.designs.kept = contract.length;
    const r = await deleteDesigns(env, userId, other);
    goneDesigns = r.deleted;
    out.designs.deleted = r.deleted.length;
    out.designs.failed = r.failed;
    if (r.failed) out.errors.push('designs_delete');
  } catch (e) {
    out.errors.push('designs_read');
  }

  // 4) 파일 — 하위 요청 상한은 둘이 나눠 쓴다
  const ctx = makePurgeContext();
  out.files = await purgeUserFiles(
    env,
    userId,
    keep ? { ctx, keep: { collection: keep } } : { ctx, skip: { collection: 'keep_unknown' } }
  );
  // 지운 설계의 renders · cad 만. 남긴(계약) 설계와 못 지운 설계의 파일은 그대로 둔다.
  out.designFiles = await purgeDesignFiles(env, goneDesigns, { ctx });

  out.complete = out.errors.length === 0 && !!out.files.ok && !!out.designFiles.ok;
  return out;
}

function bucketCounts(purge) {
  const files = {};
  for (const [name, b] of Object.entries((purge && purge.buckets) || {})) {
    files[name] = { deleted: b.deleted, failed: b.failed, ...(b.kept ? { kept: b.kept } : {}), ...(b.error ? { error: b.error } : {}) };
  }
  return files;
}

/** admin_logs.new_value 에 싣는 결과 — 지운 수 · 남긴 수 · 실패 수만 */
export function withdrawalDetail(w) {
  const files = { ...bucketCounts(w && w.files), ...bucketCounts(w && w.designFiles) };
  const fileErr = (w && w.files && w.files.error) || (w && w.designFiles && w.designFiles.error);
  return {
    complete: !!(w && w.complete),
    posts: { ...((w && w.posts) || {}) },
    designs: { ...((w && w.designs) || {}) },
    files,
    ...(w && w.errors && w.errors.length ? { errors: w.errors.slice() } : {}),
    ...(fileErr ? { files_error: fileErr } : {}),
    ...((w && w.files && w.files.truncated) || (w && w.designFiles && w.designFiles.truncated) ? { truncated: true } : {}),
  };
}

/** 로그 한 줄 (경로 · 회원 id 없음) */
export function withdrawalSummary(w) {
  if (!w) return 'withdrawal: -';
  const p = w.posts || {};
  const d = w.designs || {};
  return (
    `posts: upload_deleted=${p.upload_deleted || 0} ai_render_kept=${p.ai_render_kept || 0}` +
    ` designs: deleted=${d.deleted || 0} kept=${d.kept || 0}${d.failed ? ` failed=${d.failed}` : ''}` +
    `${w.errors && w.errors.length ? ` errors=${w.errors.join(',')}` : ''} ${purgeSummary(w.files)}` +
    ` design-${purgeSummary(w.designFiles)} complete=${!!w.complete}`
  );
}
