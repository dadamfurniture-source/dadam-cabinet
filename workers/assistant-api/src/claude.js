/**
 * Claude 부르기 — 공식 SDK(@anthropic-ai/sdk) Messages API.
 *
 *   모델 ANTHROPIC_MODEL (기본 claude-haiku-5-5), effort EFFORT (기본 medium), 생각은 기본(adaptive).
 *   inference_geo INFERENCE_GEO (기본 us — 미국 안에서만 처리, 요금 1.1배).
 *   거절(stop_reason refusal)이면 서버가 기본 대체 모델로 다시 돈다 — fallbacks "default" + 베타 server-side-fallback-2026-07-01.
 *   Haiku 5.5 는 서버 대체가 없어 fallbacks 를 보내면 400 이다 — 보내지 않고, 거절은 그대로 refused 로 끝난다.
 *   키는 시크릿 ANTHROPIC_API_KEY. 이 객체는 미국 콜로에서 뜨므로 직접 부른다 (src/session.js).
 *
 * 지난 대화 다시 보내기 (echoContent)
 *   비서 메시지는 받은 내용 블록 그대로 저장하고 그대로 다시 보낸다 — 생각 블록을 빼거나 고치면 그 뒤 생각이 무효가 된다.
 *   하나만 다르다: 답 중간에 대체 모델로 넘어간 메시지(fallback 블록)는 마지막 fallback 블록 앞의 블록 가운데
 *   글(text)만 보내고, 그 뒤는 그대로 보낸다. fallback 블록 자체는 빼도 된다 (Anthropic 대체 모델 안내).
 */
import Anthropic from '@anthropic-ai/sdk';
import { CONTEXT_OPEN } from './prompt.js';

export const MODEL_DEFAULT = 'claude-haiku-5-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const NO_SERVER_FALLBACK = ['claude-haiku-5-5'];

/** 서버 대체(fallbacks)를 받는 모델인가 (날짜가 붙은 id 도) */
export function hasServerFallback(model) {
  const id = String(model || '');
  return !NO_SERVER_FALLBACK.some((k) => id === k || id.startsWith(k + '-'));
}

/** SDK 클라이언트 — 시험은 env.ASSISTANT_CLAUDE 에 가짜를 끼운다 (wrangler vars 는 글자라 운영에는 생기지 않는다) */
export function claudeClient(env) {
  if (env.ASSISTANT_CLAUDE && typeof env.ASSISTANT_CLAUDE === 'object') return env.ASSISTANT_CLAUDE;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 });
}

/** tools 는 대화 첫 차례에 정한 목록 그대로 (src/session.js frame) — 비었으면 싣지 않는다. tool_choice 는 기본 auto */
export function buildRequest(env, { system, messages, tools }) {
  const model = env.ANTHROPIC_MODEL || MODEL_DEFAULT;
  return {
    model,
    max_tokens: Number(env.MAX_OUTPUT_TOKENS) || 8000,
    ...(hasServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    inference_geo: env.INFERENCE_GEO || 'us',
    output_config: { effort: env.EFFORT || 'medium' },
    system,
    ...(tools && tools.length ? { tools } : {}),
    messages,
  };
}

/** 저장한 비서 내용 블록 → 다시 보낼 블록 */
export function echoContent(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  let last = -1;
  list.forEach((b, i) => {
    if (b && b.type === 'fallback') last = i;
  });
  if (last < 0) return list;
  return list.filter((b, i) => (i < last ? b && b.type === 'text' : i > last));
}

/** assistant_messages 줄(seq 차례) → Messages API messages */
export function historyOf(rows) {
  return (rows || []).map((r) => ({
    role: r.role,
    content: r.role === 'assistant' ? echoContent(r.content) : r.content,
  }));
}

/** 내용 블록의 글만 */
export function textOf(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/** 사람이 쓴 글만 — 시스템이 붙인 맥락 블록(<맥락>…)은 뺀다 */
export function userTextOf(blocks) {
  return textOf(
    (Array.isArray(blocks) ? blocks : []).filter(
      (b) => !(b && b.type === 'text' && String(b.text).startsWith(CONTEXT_OPEN))
    )
  );
}

/** 차례를 여는 사람 메시지인가 (도구 결과만 담긴 user 메시지는 아니다) */
export function isTurnStart(row) {
  return (
    !!row &&
    row.role === 'user' &&
    Array.isArray(row.content) &&
    row.content.some((b) => b && b.type === 'text')
  );
}
