/**
 * 사업자등록증 사진 읽기 — account-api 가 서비스 바인딩 RPC 로 부른다 (src/index.js CertExtract.read).
 * 2026-11-21 대표님 계획 승인 「사업자등록증 등록 시 첫 달 무료」 (database/migrations/0077).
 *
 *   readCert(env, { certificateId })  사업자등록증마다 CertReader(Durable Object, 미국 enam) 하나에 맡기고 답을 기다린다.
 *     → { ok: true, extracted: { biz_no, company_name, representative_name, open_date } } | { ok: false, reason }
 *     영수증 읽기(job.js)와 달리 그 자리에서 읽어 돌려준다 — 시도 표 · 알람 · 다시 걸기가 없다.
 *     읽지 못하면 올리기는 그대로 되고 사람이 직접 적는다 (account-api biz-cert.js).
 *
 *   CertReader → runCertRead
 *     1. 스위치 — assistant_global.extract_on(사진 읽기 전체 스위치)이 꺼져 있으면 읽지 않는다 (reason off)
 *     2. 줄 — business_certificates 에서 경로 · 형식을 읽는다. 상태가 uploaded 일 때만 (없음 not_found · 아니면 not_uploaded)
 *     3. 사진 — 비공개 버킷 business-certs 를 서비스 키로 읽는다 (서명 주소는 만들지 않는다)
 *     4. 방향 — 영수증과 같은 길 (ORIENT_MODEL 에 묻고, 0 이 아니면 Cloudflare Images 로 돌린 JPEG 를 읽는다. 버킷의 사진은 그대로)
 *     5. Claude(EXTRACT_MODEL) — (돌린) 사진 + CERT_SCHEMA (output_config.format json_schema). 도구 없음
 *     6. 다듬기 (cert-schema.js normalizeCert) → 네 칸
 *   DB 에는 쓰지 않는다 — 읽은 값은 부른 쪽(account-api)이 business_certificates.extracted 에 적는다.
 *   실패 까닭(reason): off · not_found · not_uploaded · photo_상태 · photo_size · orient_거절/잘림/틀림 · rotate_… ·
 *     refusal · cut · parse · claude_상태 · error
 *
 * 예산 — 업체 월 한도(meter.js assistant_budget_reserve)는 여기서 쓰지 못한다: 올리는 사람에게 아직 업체가 없고
 *   (assistant_usage.company_id 필수) 그 함수는 업체의 장부 자격을 본다. 읽는 양은 account-api 의 올리기 한도
 *   (한 사람 24시간 5장)가 묶고, 쓴 비용은 로그에 micros 로만 남긴다 (meter.js costMicros).
 * Claude 는 홍콩 콜로에서 403 이라 객체는 SESSION_LOCATION(기본 enam)에 만든다 (job.js · guide.js 와 같다). 객체는 저장소를 쓰지 않는다.
 * 로그에는 사업자등록증 id · 까닭 코드 · 비용만 — 읽은 값(번호 · 이름)은 남기지 않는다.
 */
import { selectOne } from '../db.js';
import { costMicros } from '../meter.js';
import { hasServerFallback, FALLBACK_BETA } from '../claude.js';
import { ROTATIONS } from './schema.js';
import {
  MODEL_DEFAULT,
  ExtractFail,
  ask,
  readAnswer,
  buildOrientRequest,
  readPhoto,
  rotatePhoto,
  toBase64,
} from './job.js';
import {
  CERT_SCHEMA,
  CERT_SYSTEM,
  CERT_ASK,
  CERT_ORIENT_SYSTEM,
  normalizeCert,
} from './cert-schema.js';

export const CERT_BUCKET = 'business-certs';
const CERT_COLS = 'id,storage_path,mime,status';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RPC 받는 곳 — 미국 객체에 맡기고 읽은 값을 기다린다. 던지지 않는다 */
export async function readCert(env, input) {
  const certificateId = input && input.certificateId;
  if (typeof certificateId !== 'string' || !UUID_RE.test(certificateId))
    return { ok: false, reason: 'bad_input' };
  try {
    const id = env.CERT_READER.idFromName(certificateId);
    const stub = env.CERT_READER.get(id, { locationHint: env.SESSION_LOCATION || 'enam' });
    const res = await stub.fetch('https://cert-reader/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId }),
    });
    const out = res.ok ? await res.json().catch(() => null) : null;
    return out && typeof out === 'object' ? out : { ok: false, reason: 'read_failed' };
  } catch (e) {
    console.error('[assistant] cert read request failed:', String((e && e.message) || 'error'));
    return { ok: false, reason: 'read_failed' };
  }
}

/** Claude 요청 — 사업자등록증 사진 한 장 + 스키마 (영수증 읽기와 같은 모델 · 생각 정도 · 최대 답) */
export function buildCertRequest(env, { mime, data }) {
  const model = env.EXTRACT_MODEL || MODEL_DEFAULT;
  return {
    model,
    max_tokens: Number(env.EXTRACT_MAX_TOKENS) || 8000,
    ...(hasServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    inference_geo: env.INFERENCE_GEO || 'us',
    output_config: {
      effort: env.EXTRACT_EFFORT || 'medium',
      format: { type: 'json_schema', schema: CERT_SCHEMA },
    },
    system: CERT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text', text: CERT_ASK },
        ],
      },
    ],
  };
}

/** 한 장 읽기 → { ok: true, extracted } | { ok: false, reason }. 던지지 않는다 */
export async function runCertRead(env, { certificateId }) {
  let cost = 0;
  const call = async (params) => {
    const final = await ask(env, params);
    cost += costMicros(env, final.model || params.model, final.usage || {});
    return final;
  };
  try {
    const global = await selectOne(env, 'assistant_global', { select: 'extract_on' });
    if (!global || global.extract_on !== true) return { ok: false, reason: 'off' };

    const row = await selectOne(env, 'business_certificates', {
      id: `eq.${certificateId}`,
      select: CERT_COLS,
    });
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'uploaded') return { ok: false, reason: 'not_uploaded' };

    let photo = await readPhoto(env, row.storage_path, CERT_BUCKET);
    let mime = row.mime;

    // 방향 — 0 이 아니면 돌린 JPEG 를 읽는다
    const o = readAnswer(
      await call(
        buildOrientRequest(env, { mime, data: toBase64(photo), system: CERT_ORIENT_SYSTEM })
      )
    );
    if (!o.raw) throw new ExtractFail('orient_' + o.error);
    const rotate = Number(o.raw.rotate);
    if (!ROTATIONS.includes(rotate)) throw new ExtractFail('orient_parse');
    if (rotate) {
      photo = await rotatePhoto(env, photo, rotate);
      mime = 'image/jpeg';
    }

    const a = readAnswer(await call(buildCertRequest(env, { mime, data: toBase64(photo) })));
    if (!a.raw) throw new ExtractFail(a.error);
    console.log('[assistant] cert read', JSON.stringify({ id: certificateId, cost_micros: cost }));
    return { ok: true, extracted: normalizeCert(a.raw) };
  } catch (e) {
    const known = e instanceof ExtractFail;
    const reason = known ? String(e.message).slice(0, 60) : 'error';
    if (!known)
      console.error(
        '[assistant] cert read failed:',
        String((e && e.message) || 'error').slice(0, 60)
      );
    console.log(
      '[assistant] cert read',
      JSON.stringify({ id: certificateId, reason, cost_micros: cost })
    );
    return { ok: false, reason };
  }
}

/** 사업자등록증마다 하나 — /read 는 그 자리에서 읽어 답한다 (저장소 · 알람 없음) */
export class CertReader {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/read')
      return new Response('not found', { status: 404 });
    const input = await request.json().catch(() => null);
    const id = input && input.certificateId;
    const out =
      typeof id === 'string' && UUID_RE.test(id)
        ? await runCertRead(this.env, { certificateId: id })
        : { ok: false, reason: 'bad_input' };
    return new Response(JSON.stringify(out), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
