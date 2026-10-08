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

/** 이미지 생성이 받는 비율. */
export const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** base64 JPEG/PNG 머리에서 가로·세로를 읽는다. 못 읽으면 null. */
export function imageDimensions(base64) {
  if (!base64) return null;
  let bytes;
  try {
    // 머리만 본다 — JPEG SOF 는 EXIF 뒤에 오므로 넉넉히 64KB.
    const bin = atob(base64.slice(0, 87384)); // 4의 배수로 잘라야 atob 가 받는다
    bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
  // PNG: IHDR 의 width·height
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes.length >= 24) {
    const v = new DataView(bytes.buffer);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  // JPEG: SOFn 마커까지 세그먼트를 건너뛴다
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * 사진과 가장 가까운 생성 비율. 못 읽으면 undefined (모델에 맡긴다).
 * 비율을 비워 두면 참고 이미지가 섞일 때 캔버스가 사진과 달라져, 남는 칸을
 * 다른 장면(특히 두 장짜리 참고 이미지)으로 채운 "한 장에 두 장" 결과가 나왔다.
 */
export function aspectRatioOf(img) {
  const d = imageDimensions(img && img.base64);
  if (!d || !d.width || !d.height) return undefined;
  const r = Math.log(d.width / d.height);
  let best;
  let bestDiff = Infinity;
  for (const a of ASPECT_RATIOS) {
    const [w, h] = a.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - r);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = a;
    }
  }
  return best;
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

/**
 * 요청 하나의 시간 제한 (2026-09-22). 없으면 응답이 안 오는 호출이 잡 전체를 무기한 붙든다 —
 * 잡의 10분 제한은 다음 알람에서나 검사되므로, 진행 중인 fetch 는 스스로 끊어야 한다.
 * 첫 실측에서 QC 단계가 9분 넘게 멈춘 것이 계기다. env.GEMINI_TIMEOUT_MS 로 바꾼다.
 */
export function geminiTimeoutMs(env) {
  const n = Number(env && env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 150_000;
}

function send(env, route, path, body) {
  const signal = AbortSignal.timeout(geminiTimeoutMs(env));
  if (route === 'proxy') {
    const stub = proxyStub(env);
    if (!stub) throw new Error('GEMINI_PROXY binding missing');
    return stub.fetch('https://gemini-proxy/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: DIRECT_BASE + path, body }),
      signal,
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
    signal,
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
