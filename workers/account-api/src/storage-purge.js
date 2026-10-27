/**
 * 탈퇴할 때 그 회원의 Storage 파일을 지운다 (2026-10-27).
 *
 * auth.users 를 지우면 DB 행은 CASCADE 로 지워지지만 Storage 파일은 남는다. 공개 버킷(collection)의 파일은
 * 탈퇴 뒤에도 주소로 계속 열린다. 그래서 계정을 지우기 **전에** 회원 폴더를 비운다.
 *
 * 대상 버킷 — 첫 폴더가 회원 id 인 것 ({user_id}/…):
 *   generations     '{user_id}/{generation_id}/{file}'      AI 연출컷 입력·결과 (workers/generate-api)
 *   design-images   '{user_id}/{type}/{file}'               설계 사진 (js/supabase-utils.js 등)
 *   collection      '{user_id}/{file}'                      시공사례 사진 · 연출컷 자동 게시 복사본
 *   (renders · cad 는 첫 폴더가 설계 id 라 여기서 다루지 않는다. 카탈로그 버킷은 회원 것이 아니다.)
 *
 * 폴더를 따라 내려가며 목록을 읽고(service_role, POST /storage/v1/object/list/{bucket}), 모아서 지운다
 * (DELETE /storage/v1/object/{bucket}). 회원 id 는 UUID 여야 하고, 지우는 경로는 반드시 '{user_id}/' 로 시작한다 —
 * 빈 접두사로 버킷 전체를 지우는 일이 없게.
 *
 * 던지지 않는다. 결과(버킷마다 찾은 수 · 지운 수 · 실패 수)를 돌려준다 — 경로나 개인 정보는 담지 않는다.
 * 이 파일은 import 가 없다 — 시험(__tests__/account-delete-files.test.js)이 export 를 떼고 평가한다.
 */

export const USER_FOLDER_BUCKETS = ['generations', 'design-images', 'collection'];
/** 목록 한 번에 읽는 수 (Storage list 의 limit) */
export const LIST_PAGE = 1000;
/** 삭제 한 번에 보내는 경로 수 */
export const DELETE_CHUNK = 500;
/** 폴더 깊이 — 지금 가장 깊은 것이 2 ({user_id}/{generation_id}/{file}) */
export const MAX_DEPTH = 4;
/** Storage 요청 수 상한 — 워커 한 요청의 하위 요청 한도(유료 1000) 안에서 인증·로그 몫을 남긴다 */
export const MAX_STORAGE_CALLS = 900;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

class BudgetError extends Error {}

function spend(ctx) {
  if (ctx.calls >= ctx.maxCalls) throw new BudgetError('storage call budget reached');
  ctx.calls += 1;
}

/** 한 폴더의 항목 — 파일 경로와 하위 폴더 경로. 여러 쪽이면 이어 읽는다. */
async function listFolder(env, bucket, folder, ctx) {
  const files = [];
  const folders = [];
  for (let offset = 0; ; offset += ctx.pageSize) {
    spend(ctx);
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({ prefix: folder, limit: ctx.pageSize, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const rows = await res.json();
    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) {
      if (!r || typeof r.name !== 'string' || !r.name) continue;
      const full = `${folder}/${r.name}`;
      // 폴더는 id 가 없다 (Storage list 의 약속)
      if (r.id == null) folders.push(full);
      else files.push(full);
    }
    if (list.length < ctx.pageSize) break;
  }
  return { files, folders };
}

/** 회원 폴더 아래 파일 경로 전부 */
async function listUserFiles(env, bucket, userId, ctx) {
  const out = [];
  let level = [userId];
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
    const next = [];
    for (const folder of level) {
      const { files, folders } = await listFolder(env, bucket, folder, ctx);
      out.push(...files);
      next.push(...folders);
    }
    level = next;
  }
  return out;
}

async function removeFiles(env, bucket, paths, ctx) {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += ctx.deleteChunk) {
    const chunk = paths.slice(i, i + ctx.deleteChunk);
    try {
      spend(ctx);
      const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: headers(env),
        body: JSON.stringify({ prefixes: chunk }),
      });
      if (!res.ok) {
        failed += chunk.length;
        continue;
      }
      const rows = await res.json().catch(() => null);
      const n = Array.isArray(rows) ? rows.length : chunk.length;
      deleted += n;
      failed += chunk.length - n;
    } catch (e) {
      // 요청이 실패했거나 상한에 닿았다 — 남은 것은 못 지운 것으로 센다
      failed += paths.length - i;
      if (e instanceof BudgetError) ctx.truncated = true;
      break;
    }
  }
  return { deleted, failed };
}

/**
 * 회원의 Storage 파일을 지운다. 던지지 않는다.
 * @returns {Promise<{ok: boolean, truncated: boolean, calls: number,
 *   buckets: Object<string, {found: number, deleted: number, failed: number, error?: string}>}>}
 *   ok — 모든 버킷을 끝까지 읽고 찾은 파일을 전부 지웠다
 */
export async function purgeUserFiles(env, userId, opts = {}) {
  const buckets = opts.buckets || USER_FOLDER_BUCKETS;
  const ctx = {
    calls: 0,
    truncated: false,
    maxCalls: opts.maxCalls || MAX_STORAGE_CALLS,
    pageSize: opts.pageSize || LIST_PAGE,
    deleteChunk: opts.deleteChunk || DELETE_CHUNK,
  };
  const result = { ok: false, truncated: false, calls: 0, buckets: {} };
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    result.error = 'bad_user_id';
    return result;
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    result.error = 'no_service_key';
    return result;
  }
  let ok = true;
  for (const bucket of buckets) {
    const b = { found: 0, deleted: 0, failed: 0 };
    result.buckets[bucket] = b;
    try {
      const paths = (await listUserFiles(env, bucket, userId, ctx)).filter((p) => p.startsWith(`${userId}/`));
      b.found = paths.length;
      const r = await removeFiles(env, bucket, paths, ctx);
      b.deleted = r.deleted;
      b.failed = r.failed;
      if (r.failed) ok = false;
    } catch (e) {
      ok = false;
      if (e instanceof BudgetError) ctx.truncated = true;
      else b.error = String((e && e.message) || e).slice(0, 60);
    }
    if (ctx.truncated) {
      // 상한에 닿았다 — 이 버킷은 끝까지 못 읽었고, 남은 버킷은 손대지 않는다
      b.error = 'budget';
      break;
    }
  }
  result.truncated = ctx.truncated;
  result.ok = ok && !ctx.truncated;
  result.calls = ctx.calls;
  return result;
}

/** 로그 한 줄 — 버킷마다 지운 수/찾은 수와 실패 수만 (경로·회원 id 없음) */
export function purgeSummary(r) {
  if (!r) return 'storage: -';
  if (r.error) return `storage: skipped (${r.error})`;
  const parts = Object.entries(r.buckets).map(
    ([name, b]) => `${name}=${b.deleted}/${b.found}${b.failed ? ` failed=${b.failed}` : ''}${b.error ? ` error=${b.error}` : ''}`
  );
  return `storage: ${parts.join(' ')} calls=${r.calls}${r.truncated ? ' truncated' : ''} ok=${r.ok}`;
}
