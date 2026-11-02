/**
 * 회계장부 — 사진 읽기 걸기. 읽기는 assistant-api 가 한다.
 *
 *   서비스 바인딩 ASSISTANT → dadam-assistant-api 의 이름 있는 진입점 LedgerExtract, RPC extract({ documentId, again }).
 *   곧바로 { ok: true, queued: true } | { ok: false, reason } — 미국 Durable Object 에 줄을 세울 뿐이고 읽기는 따로 돈다.
 *   그 객체가 ledger_extract_begin 으로 시도를 잡고 ledger_extractions 에 결과를 쓴다 (database/migrations/0029).
 *   바인딩이 없으면(로컬 · 시험) 한 번만 적고 건너뛴다 — 사진 올리기 · 확인은 그대로 된다.
 *
 *   올린 직후   새 사진이면 uploadDocument(documents.js)가 ctx.waitUntil(requestExtract) — 같은 사진을 다시 올린 reused 는 걸지 않는다
 *   매분 cron   runExtractDue — rpc ledger_extract_due(DUE_LIMIT 장, DUE_WAIT_SEC 기다림, DUE_STUCK_SEC 멈춤, MAX_ATTEMPTS)가
 *               준 사진마다 건다 (올린 직후 걸기가 실패했거나 읽기가 실패 · 멈춘 사진)
 */
import { callRpc } from '../supabase.js';
import { isUuid } from './checks.js';

/** 매분 cron — 한 번에 걸 사진 · 올린 뒤 기다릴 초 · 멈췄다고 볼 초 · 사진마다 자동 시도 */
export const DUE_LIMIT = 5;
export const DUE_WAIT_SEC = 120;
export const DUE_STUCK_SEC = 600;
export const MAX_ATTEMPTS = 2;

let warnedNoBinding = false;

function extractor(env) {
  const b = env && env.ASSISTANT;
  return b && typeof b.extract === 'function' ? b : null;
}

/** assistant-api 에 읽기를 건다 — 던지지 않는다 → { ok, queued?, reason? } */
export async function requestExtract(env, documentId, { again = false } = {}) {
  const b = extractor(env);
  if (!b) {
    if (!warnedNoBinding) {
      console.warn('[Ledger] ASSISTANT binding missing — photo reading is not requested');
      warnedNoBinding = true;
    }
    return { ok: false, reason: 'no_binding' };
  }
  try {
    const out = await b.extract({ documentId, again: again === true });
    return out && typeof out === 'object' ? out : { ok: false, reason: 'empty' };
  } catch (e) {
    console.error('[Ledger] extract request failed:', e && e.message);
    return { ok: false, reason: 'failed' };
  }
}

/** PostgREST 가 함수를 모른다 (0029 를 적용하기 전) */
const isMissingFunction = (e) =>
  !!e && (e.statusCode === 404 || /PGRST202|Could not find the function/.test(String(e.message)));

/** 매분 cron — 다시 걸 사진마다 읽기를 건다 → { due, queued, skipped? } (던지지 않는다) */
export async function runExtractDue(env) {
  if (!extractor(env)) return { due: 0, queued: 0, skipped: 'no_binding' };
  let rows;
  try {
    rows = await callRpc(env, 'ledger_extract_due', {
      p_limit: DUE_LIMIT,
      p_wait_sec: DUE_WAIT_SEC,
      p_stuck_sec: DUE_STUCK_SEC,
      p_max_attempts: MAX_ATTEMPTS,
    });
  } catch (e) {
    if (isMissingFunction(e)) {
      console.warn('[Ledger] ledger_extract_due missing — apply database/migrations/0029');
      return { due: 0, queued: 0, skipped: 'no_function' };
    }
    console.error('[Ledger] extract due failed:', e && e.statusCode ? e.statusCode : 'error');
    return { due: 0, queued: 0, skipped: 'error' };
  }
  const list = Array.isArray(rows) ? rows : [];
  let queued = 0;
  for (const r of list) {
    if (!r || !isUuid(r.document_id)) continue;
    const out = await requestExtract(env, r.document_id);
    if (out.ok) queued += 1;
  }
  return { due: list.length, queued };
}
