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
export async function callGemini(env, { prompt, images = [], want = 'image', temperature }) {
  const base = env.AI_GATEWAY_BASE
    ? `${env.AI_GATEWAY_BASE.replace(/\/$/, '')}/google-ai-studio/v1beta`
    : 'https://generativelanguage.googleapis.com/v1beta';
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
