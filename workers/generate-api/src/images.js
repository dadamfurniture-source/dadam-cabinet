/**
 * 연출컷 이미지 한 장 — 공급자를 고른다 (2026-10-18).
 *
 * IMAGE_PROVIDER = 'openai' 이고 OPENAI_API_KEY 가 있으면 GPT 가 그린다. 아니면 지금처럼 Gemini.
 * GPT 가 어떤 이유로든 실패하면(과부하·크레딧·모델 이름·검열) Gemini 가 대신 그리고 칸에 남긴다 —
 * 생성이 멈추는 것보다 다른 모델의 결과가 낫다. 분석·검사·채팅(텍스트)은 이 파일을 거치지 않고 Gemini 그대로.
 * 플래너 모드 기본안은 도면 렌더를 함께 쓰는 별도 경로라 여기로 오지 않는다 (job.js).
 */

import { callGemini, callImageWithFallback, imageModel } from './gemini.js';
import { callOpenAIImage } from './openai.js';

export function imageProvider(env) {
  return env && env.IMAGE_PROVIDER === 'openai' && env.OPENAI_API_KEY ? 'openai' : 'gemini';
}

async function gemini(env, p, role) {
  // 추천안은 Gemini 안에서도 과부하면 가벼운 모델로 (callImageWithFallback). 기본안은 기본 모델만.
  if (role === 'variant') return { ...(await callImageWithFallback(env, p)), provider: 'gemini' };
  return { ...(await callGemini(env, p)), model: p.model || imageModel(env), provider: 'gemini' };
}

/**
 * @param {object} env
 * @param {{prompt:string, images:object[], imageSize?:string, aspectRatio?:string}} p
 * @param {'base'|'variant'} [role='base']
 * @returns {Promise<{image?:string, imageMime?:string, model:string, provider:'openai'|'gemini',
 *   fallback?:boolean, fallback_reason?:string, usage?:object}>}
 */
export async function renderImage(env, p, role = 'base') {
  if (imageProvider(env) !== 'openai') return gemini(env, p, role);
  try {
    return { ...(await callOpenAIImage(env, p)), provider: 'openai' };
  } catch (e) {
    const reason = String((e && e.message) || e).slice(0, 160);
    console.warn(`[images] ${role}: OpenAI failed — Gemini draws instead: ${reason}`);
    const g = await gemini(env, p, role);
    return { ...g, fallback: true, fallback_reason: reason };
  }
}
