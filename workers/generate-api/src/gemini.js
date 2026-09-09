/**
 * Gemini 호출 — 모델 하나, 함수 하나.
 * AI_GATEWAY_BASE 가 있으면 Cloudflare AI Gateway 를 거친다 (한국 발신 차단 우회).
 */

export function geminiModel(env) {
  return env.GEMINI_MODEL || 'gemini-3.1-flash-image';
}

/**
 * @param {object} env
 * @param {object} p
 * @param {string}   p.prompt
 * @param {{base64:string, mimeType:string}[]} [p.images]  첫 장이 편집 대상
 * @param {'image'|'text'} [p.want='image']
 * @param {number}   [p.temperature]
 * @returns {Promise<{image?:string, text?:string}>}
 */
const DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 호출 경로. 게이트웨이가 설정돼 있으면 게이트웨이 → 직접 순으로 시도한다.
 * Google 은 발신 지역에 따라 400 "User location is not supported" 를 내는데,
 * 워커가 어느 콜로에서 뜨느냐에 따라 어느 경로가 막히는지 달라진다.
 * 그래서 한 경로만 믿지 않고 지역 차단이면 다음 경로로 넘어간다.
 */
function bases(env) {
  const list = [];
  if (env.AI_GATEWAY_BASE)
    list.push(`${env.AI_GATEWAY_BASE.replace(/\/$/, '')}/google-ai-studio/v1beta`);
  list.push(DIRECT_BASE);
  return list;
}

function isGeoBlock(err) {
  return /location is not supported/i.test(err.message || '');
}

export async function callGemini(env, params) {
  const list = bases(env);
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    try {
      return await callGeminiAt(env, list[i], params);
    } catch (e) {
      lastErr = e;
      if (!isGeoBlock(e) || i === list.length - 1) throw e;
      console.warn(
        `[Gemini] geo-blocked via ${i === 0 && env.AI_GATEWAY_BASE ? 'gateway' : 'direct'}, trying next path`
      );
    }
  }
  throw lastErr;
}

async function callGeminiAt(env, base, { prompt, images = [], want = 'image', temperature }) {
  const url = `${base}/models/${geminiModel(env)}:generateContent?key=${env.GEMINI_API_KEY}`;

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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = {};
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) out.image = part.inlineData.data;
    if (part.text) out.text = part.text;
  }
  return out;
}
