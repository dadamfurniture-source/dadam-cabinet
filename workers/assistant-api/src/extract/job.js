/**
 * 사진 읽기 — workflow-api 가 서비스 바인딩 RPC 로 부른다 (src/index.js LedgerExtract.extract).
 *
 *   queueExtract(env, { documentId, again })  사진마다 ExtractJob(Durable Object, 미국 enam) 하나에 맡기고 바로 { ok, queued }.
 *     부르는 쪽(사진 올린 직후 · 매분 cron)은 기다리지 않는다. 같은 사진을 여러 번 불러도 시작 함수가 하나만 돌린다.
 *
 *   ExtractJob 알람 → runExtract
 *     1. 시작 — DB 함수 ledger_extract_begin(사진, EXTRACT_MAX_ATTEMPTS, again, again 이면 SCHEMA_VERSION) 이 running 시도 한 줄을 만든다.
 *        막히면(도는 중 · 읽음 · 확인 끝남 · 최대 시도 · 거절 · 한도) 아무것도 하지 않는다.
 *        읽은 사진도 again 이고 더 낮은 판으로 읽은 것이면 이 판으로 다시 읽는다 (database/migrations/0031)
 *     2. 예산 — purpose extract, 키 extract:{시도 id}. 안 되면 시도를 skipped_budget(error = 이유)로 닫는다
 *     3. 사진 — 비공개 버킷 ledger-evidence 를 서비스 키로 읽는다 (서명 주소는 만들지 않는다)
 *     4. 방향 — Claude 에 글자가 똑바로 서려면 시계 방향으로 몇 도 돌려야 하는지 묻는다(ORIENT_SCHEMA, 생각 low).
 *        0 이 아니면 Cloudflare Images 바인딩(IMAGES)으로 그만큼 돌린 JPEG 를 만든다 — 버킷의 사진(증빙)은 그대로 둔다
 *     5. Claude — (돌린) 사진 + 스키마(output_config.format json_schema). 도구 없음. 거절이면 refused, 잘림 · 틀린 JSON 이면 failed
 *        스키마에는 계정 제안 account_hint — 고를 거리는 ledger_accounts(쓰는 중인 매입 · 제조 · 판관 · 자산, sort 차례),
 *        업종은 company_settings 에서. 시작 뒤 한 번 읽어 예산 어림 · 읽기에 같이 쓴다 (목록이 없으면 failed no_accounts)
 *        (방향을 묻다 거절 · 잘림 · 틀린 답이면 error 앞에 orient_)
 *     6. 다듬기 · 검사 (checks.js) → 시도를 done 으로 (result + rotate · checks · 두 번 부른 usage 합 · 비용 합 · 모델 · 판) → 정산
 *   실패하면 시도를 failed(error = 짧은 까닭)로 닫는다 — 매분 cron 이 최대 시도까지 다시 건다.
 *   알람이 돌다 객체가 죽으면 시도는 running 으로 남고, cron 의 ledger_extract_due 가 멈춘 시도로 닫고 다시 건다.
 *
 * Claude 는 홍콩 콜로에서 403 이라 이 객체는 SESSION_LOCATION(기본 enam)에 만든다 (대화와 같다).
 */
import { callRpc, updateWhere, selectMany, selectOne } from '../db.js';
import { reserveBudget, settleBudget, costMicros, rateOf, US_GEO_MULTIPLIER } from '../meter.js';
import { claudeClient, hasServerFallback, FALLBACK_BETA, textOf } from '../claude.js';
import {
  SCHEMA,
  SCHEMA_VERSION,
  ASK,
  ACCOUNT_GROUPS,
  extractSchema,
  extractSystem,
  ORIENT_SCHEMA,
  ORIENT_SYSTEM,
  ORIENT_ASK,
  ROTATIONS,
} from './schema.js';
import { normalize, checkResult } from './checks.js';

export const BUCKET = 'ledger-evidence';
export const MODEL_DEFAULT = 'claude-haiku-5-5';
/** 사진 한 장의 입력 토큰 어림 — 앱이 긴 변 2576 · 375만 화소로 줄여 올린다. 넉넉히 잡고 정산에서 바꾼다 */
export const IMAGE_TOKENS = 6000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** 방향 묻기의 최대 답 토큰 (생각 포함) · 생각 정도 — 각도 하나만 답한다 */
export const ORIENT_MAX_TOKENS = 2000;
export const ORIENT_EFFORT = 'low';
/** 돌린 사진의 JPEG 품질 (Cloudflare Images output quality) */
export const ROTATE_QUALITY = 90;
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

/** Claude 요청 — 사진 한 장 + 스키마 (accounts 는 loadAccounts, businessKind 는 loadBusinessKind) */
export function buildExtractRequest(env, { mime, data, accounts, businessKind = null }) {
  const model = env.EXTRACT_MODEL || MODEL_DEFAULT;
  return {
    model,
    max_tokens: Number(env.EXTRACT_MAX_TOKENS) || 8000,
    ...(hasServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    inference_geo: env.INFERENCE_GEO || 'us',
    output_config: {
      effort: env.EXTRACT_EFFORT || 'medium',
      format: { type: 'json_schema', schema: extractSchema(accounts) },
    },
    system: extractSystem(businessKind),
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

/** Claude 요청 — 사진 한 장의 방향만 (읽기 전에 한 번) */
export function buildOrientRequest(env, { mime, data }) {
  const model = env.EXTRACT_MODEL || MODEL_DEFAULT;
  return {
    model,
    max_tokens: ORIENT_MAX_TOKENS,
    ...(hasServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    inference_geo: env.INFERENCE_GEO || 'us',
    output_config: {
      effort: ORIENT_EFFORT,
      format: { type: 'json_schema', schema: ORIENT_SCHEMA },
    },
    system: ORIENT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text', text: ORIENT_ASK },
        ],
      },
    ],
  };
}

/** 계정 제안의 고를 거리 — 쓰는 중인 매입 · 제조 · 판관 · 자산 계정, sort 차례 */
export async function loadAccounts(env) {
  const rows = await selectMany(env, 'ledger_accounts', {
    select: 'code,name,grp,note,sort',
    active: 'eq.true',
    grp: `in.(${ACCOUNT_GROUPS.join(',')})`,
  });
  const list = (rows || [])
    .slice()
    .sort((a, b) => a.sort - b.sort || (a.code < b.code ? -1 : 1))
    .map(({ code, name, note }) => ({ code, name, note: note || null }));
  if (!list.length) throw new ExtractFail('no_accounts');
  return list;
}

/** 업체 업종 — company_settings.settings.tax.business_kind (manufacturing · retail, 모르면 null) */
export async function loadBusinessKind(env, companyId) {
  const row = await selectOne(env, 'company_settings', {
    company_id: `eq.${companyId}`,
    select: 'settings',
  });
  const kind = row && row.settings && row.settings.tax && row.settings.tax.business_kind;
  return ['manufacturing', 'retail'].includes(kind) ? kind : null;
}

/** 잡을 금액 — 사진은 IMAGE_TOKENS 로 어림(base64 글자 수로 세지 않는다) + 글 + 최대 답 */
export function estimateExtractMicros(env, params) {
  const r = rateOf(params.model);
  const ask = params.messages[0].content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const textBytes = new TextEncoder().encode(params.system + ask).length;
  const input = IMAGE_TOKENS + Math.ceil(textBytes / 2);
  const geo = (env.INFERENCE_GEO || 'us') === 'us' ? US_GEO_MULTIPLIER : 1;
  return Math.max(
    1,
    Math.ceil((input * r.input + (Number(params.max_tokens) || 0) * r.output) * geo)
  );
}

/** 비공개 버킷에서 사진 바이트 */
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
  return bytes;
}

/** 시계 방향으로 deg 돌린 JPEG — Cloudflare Images 바인딩 (버킷의 사진은 그대로 둔다) */
export async function rotatePhoto(env, bytes, deg) {
  if (!env.IMAGES) throw new ExtractFail('rotate_unavailable');
  let out;
  try {
    const done = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({ rotate: deg })
      .output({ format: 'image/jpeg', quality: ROTATE_QUALITY });
    out = new Uint8Array(await done.response().arrayBuffer());
  } catch (e) {
    // 무료 한도(달마다 5,000장)를 넘으면 9422
    throw new ExtractFail('rotate_failed' + (e && e.code ? '_' + e.code : ''));
  }
  if (!out.length || out.length > PHOTO_MAX_BYTES) throw new ExtractFail('rotate_size');
  return out;
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

/** 두 번 부른 사용량을 더한다 */
function addUsage(a, b) {
  const x = compactUsage(a);
  const y = compactUsage(b);
  return Object.fromEntries(Object.keys(x).map((k) => [k, x[k] + y[k]]));
}

/** 도는 시도를 닫는다 (running 일 때만 — 이미 닫혔으면 그대로) */
async function close(env, id, patch) {
  await updateWhere(env, 'ledger_extractions', { id: `eq.${id}`, status: 'eq.running' }, patch);
}

/** Claude 한 번 — 부르다 실패하면 ExtractFail('claude_상태') */
async function ask(env, params) {
  try {
    return await claudeClient(env).beta.messages.create(params);
  } catch (e) {
    throw new ExtractFail('claude' + (e && e.status ? '_' + e.status : ''));
  }
}

/** 답 → { raw } | 거절 · 잘림 · 틀린 JSON 이면 { status, error } */
function readAnswer(final) {
  if (final.stop_reason === 'refusal') return { status: 'refused', error: 'refusal' };
  if (final.stop_reason === 'max_tokens') return { status: 'failed', error: 'cut' };
  try {
    return { raw: JSON.parse(textOf(final.content)) };
  } catch {
    return { status: 'failed', error: 'parse' };
  }
}

/** 한 사진 읽기 — 결과: started false(막힘) | { status } */
export async function runExtract(env, { documentId, again }) {
  const begin = await callRpc(env, 'ledger_extract_begin', {
    p_document: documentId,
    p_max_attempts: maxAttempts(env),
    p_again: again === true,
    // 다시 읽기면 판을 넘긴다 — 더 낮은 판으로 읽은 사진은 이 판으로 다시 읽는다
    ...(again === true ? { p_schema_version: SCHEMA_VERSION } : {}),
  });
  if (!begin || !begin.ok) return { started: false, reason: (begin && begin.reason) || 'failed' };

  const extractionId = begin.id;
  let reserve = null;
  let model = null;
  let inFlight = false;
  // 두 번(방향 · 읽기) 부른 사용량 · 비용 합
  const spent = { usage: compactUsage(null), cost: 0 };
  const call = async (params) => {
    inFlight = true;
    const final = await ask(env, params);
    inFlight = false;
    model = final.model || params.model;
    spent.usage = addUsage(spent.usage, final.usage);
    spent.cost += costMicros(env, model, final.usage || {});
    return final;
  };
  // 쓴 만큼 정산하고 시도를 닫는다
  const finish = async (patch) => {
    await settleBudget(env, reserve.id, spent.cost, spent.usage, model);
    reserve = null;
    await close(env, extractionId, {
      model,
      schema_version: SCHEMA_VERSION,
      usage: spent.usage,
      cost_micros: spent.cost,
      ...patch,
    });
    return { started: true, status: patch.status };
  };
  try {
    // 계정 제안의 고를 거리 · 업종 — 한 번 읽어 어림 · 읽기에 같이 쓴다
    const accounts = await loadAccounts(env);
    const businessKind = await loadBusinessKind(env, begin.company_id);
    // 예산은 두 번 부를 몫을 한 번에 잡는다 (키 하나 — 알람이 다시 울려도 두 번 깎지 않는다)
    const plan = [
      buildOrientRequest(env, { mime: begin.mime, data: '' }),
      buildExtractRequest(env, { mime: begin.mime, data: '', accounts, businessKind }),
    ];
    model = plan[1].model;
    reserve = await reserveBudget(env, {
      companyId: begin.company_id,
      userId: null,
      purpose: 'extract',
      key: `extract:${extractionId}`,
      micros: plan.reduce((sum, p) => sum + estimateExtractMicros(env, p), 0),
      model,
    });
    if (!reserve.ok) {
      await close(env, extractionId, {
        status: 'skipped_budget',
        error: String(reserve.reason || 'over_limit').slice(0, 200),
      });
      return { started: true, status: 'skipped_budget' };
    }

    let photo = await readPhoto(env, begin.storage_path);
    let mime = begin.mime;

    // 방향 — 0 이 아니면 돌린 JPEG 를 읽는다
    const o = readAnswer(await call(buildOrientRequest(env, { mime, data: toBase64(photo) })));
    if (!o.raw) return await finish({ status: o.status, error: 'orient_' + o.error });
    const rotate = Number(o.raw.rotate);
    if (!ROTATIONS.includes(rotate))
      return await finish({ status: 'failed', error: 'orient_parse' });
    if (rotate) {
      photo = await rotatePhoto(env, photo, rotate);
      mime = 'image/jpeg';
    }

    const a = readAnswer(
      await call(buildExtractRequest(env, { mime, data: toBase64(photo), accounts, businessKind }))
    );
    if (!a.raw) return await finish({ status: a.status, error: a.error });
    const { result, redacted } = normalize(a.raw, { accountCodes: accounts.map((x) => x.code) });
    const checks = checkResult(result, { redacted });
    return await finish({ status: 'done', result: { ...result, rotate }, checks, error: null });
  } catch (e) {
    const code =
      e instanceof ExtractFail ? e.message : String((e && e.message) || 'error').slice(0, 60);
    if (!(e instanceof ExtractFail)) console.error('[assistant] extract failed:', code);
    // Claude 를 부르는 도중 실패했으면 쓴 양을 모르므로 잡은 금액을 그대로 둔다 (한도를 넉넉히 센다).
    // 그 밖(사진 · 돌리기 실패 등)은 이미 쓴 만큼(안 불렀으면 0)으로 정산해 나머지를 푼다
    if (reserve && reserve.ok && !inFlight)
      await settleBudget(env, reserve.id, spent.cost, spent.usage, model);
    const known = spent.cost ? { model, usage: spent.usage, cost_micros: spent.cost } : {};
    await close(env, extractionId, { status: 'failed', error: code.slice(0, 200), ...known }).catch(
      (err) => console.error('[assistant] extract close failed:', err && err.message)
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
