/**
 * Gemini 호출 — 함수 하나.
 *
 * 모델은 둘이다 (둘 다 wrangler.toml vars):
 *   GEMINI_IMAGE_MODEL  이미지 생성·변형        (기본 gemini-3-pro-image, 2K)
 *   GEMINI_TEXT_MODEL   브리프·품질 검사 (텍스트)  (기본 gemini-3.8-flash)
 *
 * 경로는 셋이고 지역 차단이면 다음으로 넘어간다.
 *   gateway  Cloudflare AI Gateway (AI_GATEWAY_BASE 가 있을 때)
 *   direct   Google 원본 엔드포인트
 *   proxy    미국 콜로에 고정된 Durable Object (proxy.js)
 * 한 번 막힌 경로는 이 isolate 안에서는 다시 시도하지 않는다.
 * GEMINI_VIA=proxy 로 두면 처음부터 proxy 만 쓴다.
 */

import { proxyStub } from './proxy.js';

const DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function imageModel(env) {
  return env.GEMINI_IMAGE_MODEL || env.GEMINI_MODEL || 'gemini-3-pro-image';
}

export function textModel(env) {
  return env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
}

/** /health 가 보여주는 대표 모델. */
export function geminiModel(env) {
  return imageModel(env);
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
 * @param {string}   [p.model]        비우면 want 에 따라 imageModel/textModel
 * @param {string}   [p.imageSize]    '1K' | '2K' | '4K' (이미지일 때만)
 * @param {string}   [p.aspectRatio]  예: '4:3' (이미지일 때만)
 * @returns {Promise<{image?:string, imageMime?:string, text?:string}>}
 */
export async function callGemini(
  env,
  { prompt, images = [], want = 'image', temperature, model, imageSize, aspectRatio }
) {
  const parts = images
    .filter((i) => i && i.base64 && i.mimeType)
    .map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }));
  parts.push({ text: prompt });

  const generationConfig = {
    responseModalities: want === 'text' ? ['TEXT'] : ['IMAGE', 'TEXT'],
    temperature: temperature ?? (want === 'text' ? 0.2 : 0.4),
  };
  if (want !== 'text' && (imageSize || aspectRatio)) {
    generationConfig.imageConfig = {};
    if (imageSize) generationConfig.imageConfig.imageSize = imageSize;
    if (aspectRatio) generationConfig.imageConfig.aspectRatio = aspectRatio;
  }
  const body = { contents: [{ parts }], generationConfig };
  const useModel = model || (want === 'text' ? textModel(env) : imageModel(env));
  const path = `/models/${useModel}:generateContent?key=${env.GEMINI_API_KEY}`;

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
      if (part.inlineData) {
        out.image = part.inlineData.data;
        out.imageMime = part.inlineData.mimeType || 'image/png';
      }
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

/** 진단용: 각 경로로 짧은 텍스트 호출을 보내 상태·소요시간을 돌려준다. */
export async function probeRoutes(env) {
  const path = `/models/${textModel(env)}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: 'Reply with OK' }] }],
    generationConfig: { responseModalities: ['TEXT'] },
  };
  const out = {};
  for (const route of ['gateway', 'direct', 'proxy']) {
    if (route === 'gateway' && !env.AI_GATEWAY_BASE) continue;
    if (route === 'proxy' && !env.GEMINI_PROXY) continue;
    const t0 = Date.now();
    try {
      const res = await send(env, route, path, body);
      const text = await res.text();
      out[route] = `${res.status} ${Date.now() - t0}ms ${text.replace(/\s+/g, ' ').slice(0, 90)}`;
    } catch (e) {
      out[route] = `ERR ${e.message}`;
    }
  }
  return out;
}
