/**
 * 사진 읽기 — workflow-api 가 서비스 바인딩 RPC 로 부른다 (src/index.js LedgerExtract.extract).
 *
 *   queueExtract(env, { documentId, again })  사진마다 ExtractJob(Durable Object, 미국 enam) 하나에 맡기고 바로 { ok, queued }.
 *     부르는 쪽(사진 올린 직후 · 매분 cron)은 기다리지 않는다. 같은 사진을 여러 번 불러도 시작 함수가 하나만 돌린다.
 *
 *   ExtractJob 알람 → runExtract
 *     1. 시작 — DB 함수 ledger_extract_begin(사진, EXTRACT_MAX_ATTEMPTS, again) 이 running 시도 한 줄을 만든다.
 *        막히면(도는 중 · 읽음 · 확인 끝남 · 최대 시도 · 거절 · 한도) 아무것도 하지 않는다
 *     2. 예산 — purpose extract, 키 extract:{시도 id}. 안 되면 시도를 skipped_budget(error = 이유)로 닫는다
 *     3. 사진 — 비공개 버킷 ledger-evidence 를 서비스 키로 읽어 base64 (서명 주소는 만들지 않는다)
 *     4. Claude — 사진 + 스키마(output_config.format json_schema). 도구 없음. 거절이면 refused, 잘림 · 틀린 JSON 이면 failed
 *     5. 다듬기 · 검사 (checks.js) → 시도를 done 으로 (result · checks · usage · 비용 · 모델 · 판) → 정산
 *   실패하면 시도를 failed(error = 짧은 까닭)로 닫는다 — 매분 cron 이 최대 시도까지 다시 건다.
 *   알람이 돌다 객체가 죽으면 시도는 running 으로 남고, cron 의 ledger_extract_due 가 멈춘 시도로 닫고 다시 건다.
 *
 * Claude 는 홍콩 콜로에서 403 이라 이 객체는 SESSION_LOCATION(기본 enam)에 만든다 (대화와 같다).
 */
import { callRpc, updateWhere } from '../db.js';
import { reserveBudget, settleBudget, costMicros, rateOf, US_GEO_MULTIPLIER } from '../meter.js';
import { claudeClient, hasServerFallback, FALLBACK_BETA, textOf } from '../claude.js';
import { SCHEMA, SCHEMA_VERSION, SYSTEM, ASK } from './schema.js';
import { normalize, checkResult } from './checks.js';

export const BUCKET = 'ledger-evidence';
export const MODEL_DEFAULT = 'claude-haiku-5-5';
/** 사진 한 장의 입력 토큰 어림 — 앱이 긴 변 2576 · 375만 화소로 줄여 올린다. 넉넉히 잡고 정산에서 바꾼다 */
export const IMAGE_TOKENS = 6000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function maxAttempts(env) {
  const v = Number(env.EXTRACT_MAX_ATTEMPTS);
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : 2;
}

/** RPC 받는 곳 — 객체에 맡기고 바로 돌아온다 */
export async function queueExtract(env, input) {
  const documentId = input && input.documentId;
  if (typeof documentId !== 'string' || !UUID_RE.test(documentId))
    return { ok: false, reason: 'bad_input' };
  const id = env.EXTRACT_JOB.idFromName(documentId);
  const stub = env.EXTRACT_JOB.get(id, { locationHint: env.SESSION_LOCATION || 'enam' });
  const res = await stub.fetch('https://extract-job/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, again: input.again === true }),
  });
  return res.ok ? { ok: true, queued: true } : { ok: false, reason: 'queue_failed' };
}

/** Claude 요청 — 사진 한 장 + 스키마 */
export function buildExtractRequest(env, { mime, data }) {
  const model = env.EXTRACT_MODEL || MODEL_DEFAULT;
  return {
    model,
    max_tokens: Number(env.EXTRACT_MAX_TOKENS) || 4000,
    ...(hasServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    inference_geo: env.INFERENCE_GEO || 'us',
    output_config: {
      effort: env.EXTRACT_EFFORT || 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text', text: ASK },
        ],
      },
    ],
  };
}

/** 잡을 금액 — 사진은 IMAGE_TOKENS 로 어림(base64 글자 수로 세지 않는다) + 글 + 최대 답 */
export function estimateExtractMicros(env, params) {
  const r = rateOf(params.model);
  const textBytes = new TextEncoder().encode(params.system + ASK).length;
  const input = IMAGE_TOKENS + Math.ceil(textBytes / 2);
  const geo = (env.INFERENCE_GEO || 'us') === 'us' ? US_GEO_MULTIPLIER : 1;
  return Math.max(
    1,
    Math.ceil((input * r.input + (Number(params.max_tokens) || 0) * r.output) * geo)
  );
}

/** 비공개 버킷에서 사진 바이트 → base64 */
export async function readPhoto(env, path) {
  const url = `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new ExtractFail('photo_' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES) throw new ExtractFail('photo_size');
  return toBase64(bytes);
}

export function toBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 까닭이 짧은 실패 — 시도의 error 칸에 그대로 */
export class ExtractFail extends Error {}

const compactUsage = (u) => ({
  input_tokens: Number(u && u.input_tokens) || 0,
  output_tokens: Number(u && u.output_tokens) || 0,
  cache_read_input_tokens: Number(u && u.cache_read_input_tokens) || 0,
  cache_creation_input_tokens: Number(u && u.cache_creation_input_tokens) || 0,
});

/** 도는 시도를 닫는다 (running 일 때만 — 이미 닫혔으면 그대로) */
async function close(env, id, patch) {
  await updateWhere(env, 'ledger_extractions', { id: `eq.${id}`, status: 'eq.running' }, patch);
}

/** 한 사진 읽기 — 결과: started false(막힘) | { status } */
export async function runExtract(env, { documentId, again }) {
  const begin = await callRpc(env, 'ledger_extract_begin', {
    p_document: documentId,
    p_max_attempts: maxAttempts(env),
    p_again: again === true,
  });
  if (!begin || !begin.ok) return { started: false, reason: (begin && begin.reason) || 'failed' };

  const extractionId = begin.id;
  let reserve = null;
  let params = null;
  let called = false;
  try {
    params = buildExtractRequest(env, { mime: begin.mime, data: '' });
    reserve = await reserveBudget(env, {
      companyId: begin.company_id,
      userId: null,
      purpose: 'extract',
      key: `extract:${extractionId}`,
      micros: estimateExtractMicros(env, params),
      model: params.model,
    });
    if (!reserve.ok) {
      await close(env, extractionId, {
        status: 'skipped_budget',
        error: String(reserve.reason || 'over_limit').slice(0, 200),
      });
      return { started: true, status: 'skipped_budget' };
    }

    params = buildExtractRequest(env, {
      mime: begin.mime,
      data: await readPhoto(env, begin.storage_path),
    });
    let final;
    called = true;
    try {
      final = await claudeClient(env).beta.messages.create(params);
    } catch (e) {
      throw new ExtractFail('claude' + (e && e.status ? '_' + e.status : ''));
    }
    const model = final.model || params.model;
    const usage = final.usage || {};
    const cost = costMicros(env, model, usage);
    await settleBudget(env, reserve.id, cost, usage, model);
    reserve = null;
    const base = {
      model,
      schema_version: SCHEMA_VERSION,
      usage: compactUsage(usage),
      cost_micros: cost,
    };

    if (final.stop_reason === 'refusal') {
      await close(env, extractionId, { ...base, status: 'refused', error: 'refusal' });
      return { started: true, status: 'refused' };
    }
    if (final.stop_reason === 'max_tokens') {
      await close(env, extractionId, { ...base, status: 'failed', error: 'cut' });
      return { started: true, status: 'failed' };
    }
    let raw;
    try {
      raw = JSON.parse(textOf(final.content));
    } catch {
      await close(env, extractionId, { ...base, status: 'failed', error: 'parse' });
      return { started: true, status: 'failed' };
    }
    const { result, redacted } = normalize(raw);
    const checks = checkResult(result, { redacted });
    await close(env, extractionId, { ...base, status: 'done', result, checks, error: null });
    return { started: true, status: 'done' };
  } catch (e) {
    const code =
      e instanceof ExtractFail ? e.message : String((e && e.message) || 'error').slice(0, 60);
    if (!(e instanceof ExtractFail)) console.error('[assistant] extract failed:', code);
    // 예산을 잡고 Claude 를 부르기 전에 실패했으면 0 으로 정산(잡은 금액을 푼다).
    // Claude 를 부르다 실패했으면 쓴 양을 모르므로 잡은 금액을 그대로 둔다 (한도를 넉넉히 센다)
    if (reserve && reserve.ok && !called)
      await settleBudget(env, reserve.id, 0, {}, params && params.model);
    await close(env, extractionId, { status: 'failed', error: code.slice(0, 200) }).catch((err) =>
      console.error('[assistant] extract close failed:', err && err.message)
    );
    return { started: true, status: 'failed' };
  }
}

/** 사진마다 하나 — /start 는 할 일을 적고 알람, 알람이 읽는다 */
export class ExtractJob {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/start')
      return new Response('not found', { status: 404 });
    const input = await request.json();
    const job = await this.ctx.storage.get('job');
    // 이미 기다리는 일이 있으면 다시 = true 만 덧붙인다
    await this.ctx.storage.put('job', {
      documentId: input.documentId,
      again: (job && job.again) || input.again === true,
    });
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job) return;
    // 먼저 지운다 — 돌다 죽어도 두 번 부르지 않는다 (멈춘 시도는 cron 이 닫고 다시 건다)
    await this.ctx.storage.delete('job');
    await runExtract(this.env, job);
  }
}
