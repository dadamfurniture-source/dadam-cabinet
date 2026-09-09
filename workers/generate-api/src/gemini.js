/**
 * Gemini 호출 — 모델 하나, 함수 하나.
 *
 * 경로는 셋이고 지역 차단이면 다음으로 넘어간다.
 *   gateway  Cloudflare AI Gateway (AI_GATEWAY_BASE 가 있을 때)
 *   direct   Google 원본 엔드포인트
 *   proxy    미국 콜로에 고정된 Durable Object (proxy.js) — 워커 콜로가 어디든 통한다
 * 한 번 막힌 경로는 이 isolate 안에서는 다시 시도하지 않는다 (호출마다 3초씩 버리지 않도록).
 * GEMINI_VIA=proxy 로 두면 처음부터 proxy 만 쓴다.
 */

import { proxyStub } from './proxy.js';

const DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiModel(env) {
  return env.GEMINI_MODEL || 'gemini-3.1-flash-image';
}

function isGeoBlock(text) {
  return /location is not supported/i.test(text || '');
}

function routes(env) {
  if (env.GEMINI_VIA === 'proxy') return ['proxy'];
  const list = [];
  if (env.AI_GATEWAY_BASE) list.push('gateway');
  list.push('direct');
  if (env.GEMINI_PROXY) list.push('proxy');
  return list;
}

let firstOpenRoute = 0; // isolate 수명 동안 기억한다

/**
 * @param {object} env
 * @param {object} p
 * @param {string}   p.prompt
 * @param {{base64:string, mimeType:string}[]} [p.images]  첫 장이 편집 대상
 * @param {'image'|'text'} [p.want='image']
 * @param {number}   [p.temperature]
 * @returns {Promise<{image?:string, text?:string}>}
 */
export async function callGemini(env, { prompt, images = [], want = 'image', temperature }) {
  const parts = images
    .filter((i) => i && i.base64 && i.mimeType)
    .map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }));
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: want === 'text' ? ['TEXT'] : ['IMAGE', 'TEXT'],
      temperature: temperature ?? (want === 'text' ? 0.2 : 0.4),
    },
  };
  const path = `/models/${geminiModel(env)}:generateContent?key=${env.GEMINI_API_KEY}`;

  const list = routes(env);
  for (let i = Math.min(firstOpenRoute, list.length - 1); i < list.length; i++) {
    const res = await send(env, list[i], path, body);
    const text = await res.text();
    if (!res.ok) {
      if (isGeoBlock(text) && i < list.length - 1) {
        console.warn(`[Gemini] ${list[i]} geo-blocked, switching to ${list[i + 1]}`);
        firstOpenRoute = i + 1;
        continue;
      }
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text);
    const out = {};
    for (const part of data.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) out.image = part.inlineData.data;
      if (part.text) out.text = part.text;
    }
    return out;
  }
  throw new Error('Gemini: no route');
}

function send(env, route, path, body) {
  if (route === 'proxy') {
    const stub = proxyStub(env);
    if (!stub) throw new Error('GEMINI_PROXY binding missing');
    return stub.fetch('https://gemini-proxy/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: DIRECT_BASE + path, body }),
    });
  }
  const base =
    route === 'gateway'
      ? `${env.AI_GATEWAY_BASE.replace(/\/$/, '')}/google-ai-studio/v1beta`
      : DIRECT_BASE;
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
