/**
 * Claude 호출 — 이미지 한 장 + 프롬프트 → 스키마대로 된 JSON (gen-to-planner).
 *
 * 공식 SDK(@anthropic-ai/sdk)를 쓴다. 모델은 wrangler.toml 의 ANTHROPIC_MODEL (기본 claude-opus-5).
 * 키는 시크릿 ANTHROPIC_API_KEY.
 *
 * 발신 지역: 워커가 HKG 콜로에서 뜨면 api.anthropic.com 이 403 "Request not allowed" 로 막는다
 * (2026-09-12 실측 — Gemini 와 같은 문제). 그래서 SDK 의 fetch 를 미국 콜로 Durable Object
 * (proxy.js) 로 갈아끼운다. 바인딩이 없으면(테스트·로컬) 직접 부른다.
 *
 * - 사고(thinking)는 Opus 5 기본값(adaptive)이라 파라미터를 보내지 않는다.
 * - 구조화 출력: output_config.format = json_schema — 본문이 곧 JSON 이다.
 * - 안전 분류기가 거절하면(stop_reason 'refusal') 서버가 기본 대체 모델로 다시 돈다
 *   (fallbacks 'default' + beta server-side-fallback-2026-07-01). 그래도 거절이면 422.
 */

import Anthropic from '@anthropic-ai/sdk';
import { proxyStub } from './proxy.js';

export const CLAUDE_MODEL_DEFAULT = 'claude-opus-5';

/** SDK 가 쓸 fetch — 요청을 통째로 미국 콜로 DO 에 넘긴다. 바인딩이 없으면 undefined(기본 fetch). */
export function proxiedFetch(env) {
  const stub = proxyStub(env);
  if (!stub) return undefined;
  return async (url, init) => {
    const headers = {};
    new Headers((init && init.headers) || {}).forEach((v, k) => {
      headers[k] = v;
    });
    return stub.fetch('https://gemini-proxy/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: String(url),
        method: (init && init.method) || 'GET',
        headers,
        bodyText: init && typeof init.body === 'string' ? init.body : undefined,
      }),
    });
  };
}

export function claudeModel(env) {
  return env.ANTHROPIC_MODEL || CLAUDE_MODEL_DEFAULT;
}

export class ClaudeRefusal extends Error {
  constructor(message = '이미지를 분석할 수 없습니다') {
    super(message);
    this.statusCode = 422;
    this.code = 'refusal';
  }
}

/**
 * @param {object} env
 * @param {object} p
 * @param {string} p.prompt
 * @param {{base64:string, mimeType:string}} p.image
 * @param {object} p.schema         JSON Schema (output_config.format)
 * @param {number} [p.maxTokens]
 * @returns {Promise<{json:object, model:string, usage:object}>}
 */
export async function callClaudeJson(env, { prompt, image, schema, maxTokens = 8000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 90_000,
    maxRetries: 1,
    fetch: proxiedFetch(env),
  });
  const res = await client.beta.messages.create({
    model: claudeModel(env),
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: { type: 'json_schema', schema }, effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType(image.mimeType), data: image.base64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  if (res.stop_reason === 'refusal') {
    const why = res.stop_details && res.stop_details.explanation;
    throw new ClaudeRefusal(why ? `이미지를 분석할 수 없습니다: ${why}` : undefined);
  }
  const text = (res.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Claude returned non-JSON (${res.stop_reason}): ${text.slice(0, 120)}`);
  }
  return { json, model: res.model, usage: res.usage };
}

/** Anthropic 이 받는 네 가지 이미지 타입으로 정규화. 모르면 JPEG 로 본다. */
function mediaType(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'image/png';
  if (m.includes('webp')) return 'image/webp';
  if (m.includes('gif')) return 'image/gif';
  return 'image/jpeg';
}
