/**
 * OpenAI GPT Image — 연출컷 기본안·추천안 (2026-10-18, 사장님 "기본안 추천안 둘다 GPT").
 *
 * POST /v1/images/edits (multipart). 입력 이미지는 image[] 로 여러 장, 첫 장이 편집 대상이다.
 * 마스크는 쓰지 않는다 — GPT 마스크는 "프롬프트 기반"이라 경계를 강제하지 않는다.
 * input_fidelity 는 gpt-image-2 이상에서 지정할 수 없다(항상 높음) — 보내지 않는다.
 *
 * 설정 (wrangler.toml vars):
 *   OPENAI_IMAGE_MODEL    기본 gpt-image-2.5-sunburst ("편집 정밀도가 가장 중요할 때")
 *   OPENAI_IMAGE_QUALITY  기본 high
 *   OPENAI_TIMEOUT_MS     기본 210초 (Gemini 이미지와 같게)
 * 키: 시크릿 OPENAI_API_KEY. 없으면 images.js 가 Gemini 로 그린다.
 */

import { retryDelaysMs } from './gemini.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const RETRY_AFTER_CAP_MS = 60_000;

export function openaiImageModel(env) {
  return (env && env.OPENAI_IMAGE_MODEL) || 'gpt-image-2.5-sunburst';
}

export function openaiImageQuality(env) {
  return (env && env.OPENAI_IMAGE_QUALITY) || 'high';
}

/**
 * 사진 비율 → GPT 출력 크기. 두 변 16의 배수, 약 300만 화소.
 * 2560×1440(약 369만 화소)를 넘는 크기는 문서상 "실험적" 이라 피한다. 21:9 는 2.35:1 로 가깝게.
 */
export const OPENAI_SIZES = {
  '1:1': '1760x1760',
  '2:3': '1360x2048',
  '3:2': '2048x1360',
  '3:4': '1536x2048',
  '4:3': '2048x1536',
  '4:5': '1632x2048',
  '5:4': '2048x1632',
  '9:16': '1152x2048',
  '16:9': '2048x1152',
  '21:9': '2560x1088',
};

export function openaiSize(aspectRatio) {
  return OPENAI_SIZES[aspectRatio] || 'auto';
}

export function openaiTimeoutMs(env) {
  const n = Number(env && env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 210_000;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * 과부하(429·500·502·503)만 다시 보낸다. 429 라도 크레딧·한도 소진(insufficient_quota)은 기다려도 안 풀린다.
 */
function classify(status, text) {
  const quota = /insufficient_quota|billing_hard_limit|exceeded your current quota/i.test(text || '');
  return { quota, retryable: !quota && [429, 500, 502, 503].includes(status) };
}

function retryAfterMs(res) {
  const v = res.headers && res.headers.get && res.headers.get('retry-after');
  if (!v) return null;
  const sec = Number(v);
  return Number.isFinite(sec) ? Math.max(0, sec * 1000) : null;
}

/**
 * GPT 이미지 편집 한 장.
 * @param {object} env
 * @param {object} p
 * @param {string} p.prompt
 * @param {{base64:string, mimeType:string}[]} p.images  첫 장이 편집 대상
 * @param {string} [p.aspectRatio]  예: '3:4' → 1536x2048
 * @param {number[]} [p.retryDelaysMs]
 * @returns {Promise<{image:string, imageMime:string, model:string, usage?:object}>}
 */
export async function callOpenAIImage(env, { prompt, images = [], aspectRatio, retryDelaysMs: delaysOverride }) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const model = openaiImageModel(env);
  const delays = delaysOverride || retryDelaysMs(env);
  for (let retry = 0; ; retry++) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', openaiSize(aspectRatio));
    form.append('quality', openaiImageQuality(env));
    form.append('output_format', 'jpeg');
    form.append('n', '1');
    images
      .filter((i) => i && i.base64 && i.mimeType)
      .forEach((img, i) => {
        const blob = new Blob([b64ToBytes(img.base64)], { type: img.mimeType });
        form.append('image[]', blob, `image-${i + 1}.${EXT[img.mimeType] || 'jpg'}`);
      });

    const res = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(openaiTimeoutMs(env)),
    });
    const text = await res.text();
    if (!res.ok) {
      const c = classify(res.status, text);
      const err = new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      err.retryable = c.retryable;
      err.quota = c.quota;
      if (!c.retryable || retry >= delays.length) throw err;
      const ra = retryAfterMs(res);
      const wait = ra != null ? Math.min(ra, RETRY_AFTER_CAP_MS) : delays[retry];
      console.warn(`[OpenAI] ${res.status} — retry ${retry + 1}/${delays.length} in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const data = JSON.parse(text);
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error('OpenAI: no image in response');
    return { image: b64, imageMime: 'image/jpeg', model, ...(data.usage ? { usage: data.usage } : {}) };
  }
}
