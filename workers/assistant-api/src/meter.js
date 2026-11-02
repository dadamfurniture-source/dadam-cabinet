/**
 * 월 한도 — 부르기 전에 예산을 잡고(assistant_budget_reserve), 끝나면 실제 비용으로 정산(assistant_budget_settle).
 * 금액 단위는 US 달러 백만분의 1(micros). 함수 · 표는 database/migrations/0026.
 *
 * 요금 (Anthropic 요금표 platform.claude.com/docs/en/about-claude/pricing, 2026-11-02 확인 — 100만 토큰당 달러 = 토큰 하나당 micros)
 *   cache_write 는 5분 캐시 값. inference_geo "us" 는 모든 칸 1.1배 (같은 요금표 Data residency pricing).
 *   응답의 model 이 표에 없으면(서버 대체 모델 등) 표에서 가장 비싼 값으로 센다 — 한도를 넘겨 쓰지 않게.
 */
import { callRpc } from './db.js';

export const RATES = Object.freeze({
  'claude-opus-5-5': { input: 4, cache_write: 5, cache_read: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cache_write: 6.25, cache_read: 0.5, output: 25 },
  // 거절 대체 모델 — fallbacks "default" 는 사이버 분류 거절을 Opus 4.8 로 돌린다
  'claude-opus-4-8': { input: 5, cache_write: 6.25, cache_read: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, cache_write: 2.5, cache_read: 0.1, output: 10 },
});
export const US_GEO_MULTIPLIER = 1.1;

const MAX_RATE = Object.freeze(
  Object.values(RATES).reduce(
    (m, r) => ({
      input: Math.max(m.input, r.input),
      cache_write: Math.max(m.cache_write, r.cache_write),
      cache_read: Math.max(m.cache_read, r.cache_read),
      output: Math.max(m.output, r.output),
    }),
    { input: 0, cache_write: 0, cache_read: 0, output: 0 }
  )
);

/** 모델 id → 요금 (날짜가 붙은 id 도 — 가장 긴 앞머리가 맞는 것) */
export function rateOf(model) {
  const id = String(model || '');
  const key = Object.keys(RATES)
    .filter((k) => id === k || id.startsWith(k + '-'))
    .sort((a, b) => b.length - a.length)[0];
  return key ? RATES[key] : MAX_RATE;
}

function geo(env) {
  return (env.INFERENCE_GEO || 'us') === 'us' ? US_GEO_MULTIPLIER : 1;
}

const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Claude usage → micros (올림) */
export function costMicros(env, model, usage) {
  const u = usage || {};
  const r = rateOf(model);
  const raw =
    n(u.input_tokens) * r.input +
    n(u.cache_creation_input_tokens) * r.cache_write +
    n(u.cache_read_input_tokens) * r.cache_read +
    n(u.output_tokens) * r.output;
  return Math.ceil(raw * geo(env));
}

/**
 * 잡을 금액 — 보낼 글(UTF-8 바이트의 절반을 토큰으로 어림) × 입력 요금 + 최대 답 토큰 × 출력 요금.
 * 넉넉하게 잡고 정산에서 실제 비용으로 바꾼다.
 */
export function estimateMicros(env, params) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ system: params.system, messages: params.messages })
  ).length;
  const r = rateOf(params.model);
  return Math.max(
    1,
    Math.ceil((Math.ceil(bytes / 2) * r.input + n(params.max_tokens) * r.output) * geo(env))
  );
}

/** → { ok, id?, repeat?, reason? } (reason: no_limit · not_entitled · over_limit · off) */
export async function reserveBudget(
  env,
  { companyId, userId, purpose = 'chat', key, micros, model }
) {
  const out = await callRpc(env, 'assistant_budget_reserve', {
    p_company: companyId,
    p_purpose: purpose,
    p_key: key,
    p_micros: micros,
    p_user: userId || null,
    p_model: model || null,
  });
  return out && typeof out === 'object' ? out : { ok: false, reason: 'failed' };
}

/** 정산 — 실패해도 던지지 않는다 (잡은 금액이 그대로 남아 한도를 넉넉히 센다) */
export async function settleBudget(env, id, micros, usage, model) {
  if (!id) return;
  const u = usage || {};
  try {
    await callRpc(env, 'assistant_budget_settle', {
      p_id: id,
      p_cost_micros: Math.max(0, micros || 0),
      p_usage: {
        model: model || null,
        input_tokens: n(u.input_tokens),
        output_tokens: n(u.output_tokens),
        cache_read_input_tokens: n(u.cache_read_input_tokens),
        cache_creation_input_tokens: n(u.cache_creation_input_tokens),
      },
    });
  } catch (e) {
    console.error('[assistant] settle failed:', e && e.message);
  }
}
