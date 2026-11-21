/**
 * 상담 정리 (앱 연출컷 「정리하기」, 2026-11-21 대표님) — 상담 대화를 연출컷 참고 내용으로.
 * 텍스트 모델 한 번, JSON 답(responseSchema). 프롬프트 · 답 모양 · 읽기는 prompts.js (buildBriefPrompt · briefSchema · parseBrief).
 * extraConfig 를 쓰는 호출이라 worker.js 밖에 둔다 (position.test.js 「기존 호출부는 새 인자를 쓰지 않는다」).
 */
import { callGemini } from './gemini.js';
import { briefSchema, buildBriefPrompt, parseBrief } from './prompts.js';

/**
 * @param {object} env
 * @param {{category?:string, messages:{role:string,text:string}[], images:{base64:string,mimeType:string}[]}} c
 * @returns {Promise<{brief:string, door_color?:string, design_style?:string}>}
 */
export async function requestBrief(env, c, { call = callGemini } = {}) {
  const r = await call(env, {
    prompt: buildBriefPrompt({
      category: c.category,
      messages: c.messages,
      photo: c.images.length > 0,
    }),
    images: c.images,
    want: 'text',
    temperature: 0.2,
    retryDelaysMs: [3_000], // 손님이 화면에서 기다린다 — 과부하면 3초 뒤 한 번만
    extraConfig: {
      responseMimeType: 'application/json',
      responseSchema: briefSchema(),
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 2048,
    },
  });
  const out = parseBrief(r && r.text);
  if (!out) throw new Error('chat brief: unreadable reply');
  return out;
}
