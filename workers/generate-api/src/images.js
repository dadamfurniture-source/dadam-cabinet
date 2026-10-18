/**
 * 연출컷 이미지 한 장 — 공급자를 고른다 (2026-10-18).
 *
 * IMAGE_PROVIDER = 'openai' 이고 OPENAI_API_KEY 가 있으면 GPT 가 그린다. 아니면 지금처럼 Gemini.
 * GPT 가 어떤 이유로든 실패하면(과부하·크레딧·모델 이름·검열) Gemini 가 대신 그리고 칸에 남긴다 —
 * 생성이 멈추는 것보다 다른 모델의 결과가 낫다. 분석·검사·채팅(텍스트)은 이 파일을 거치지 않고 Gemini 그대로.
 * 플래너 모드 기본안은 도면 렌더를 함께 쓰는 별도 경로라 renderImage 로 오지 않는다 (job.js).
 * 2026-10-18: 플래너 모드는 요청의 image_provider 로 고른다 — renderPlannerImage (기본 Gemini).
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
 * 플래너 모드 요청이 고른 이미지 공급자 (2026-10-18, 사장님 "같은 사진·도면을 GPT 로도 돌려 비교").
 * 'openai' 만 알아듣고, 없거나 모르는 값은 'gemini' — 지금 동작 그대로.
 */
export function plannerProvider(v) {
  return v === 'openai' ? 'openai' : 'gemini';
}

/**
 * 플래너 모드 기본안 한 장 (2026-10-18). 전역 IMAGE_PROVIDER 가 아니라 **요청이 고른 값**을 따른다.
 *
 *   'gemini' (기본)  지금과 바이트 그대로 — callGemini(2K · 온도 · 비율). 칸 표시 없음.
 *   'openai'        같은 프롬프트·같은 이미지 순서로 GPT 편집 호출. 온도·imageSize 는 GPT 에 없어 뺀다.
 *                   크기는 openai.js 의 OPENAI_SIZES 가 비율에서 고른다 (플래너 비율 다섯 개는 모두 표에 있다).
 *                   키가 없거나 GPT 가 실패하면 Gemini 가 같은 인자로 대신 그리고 fallback·사유를 남긴다.
 *
 * @param {object} env
 * @param {{prompt:string, images:object[], imageSize?:string, aspectRatio?:string, temperature?:number}} p
 * @param {'gemini'|'openai'} provider
 */
export async function renderPlannerImage(env, p, provider) {
  const viaGemini = async () => ({ ...(await callGemini(env, p)), model: p.model || imageModel(env), provider: 'gemini' });
  if (plannerProvider(provider) !== 'openai') return viaGemini();
  try {
    // 키가 없으면 callOpenAIImage 가 'OPENAI_API_KEY not configured' 로 던진다 → 아래에서 Gemini 가 대신
    const r = await callOpenAIImage(env, { prompt: p.prompt, images: p.images, aspectRatio: p.aspectRatio });
    return { ...r, provider: 'openai' };
  } catch (e) {
    const reason = String((e && e.message) || e).slice(0, 160);
    console.warn(`[images] planner: OpenAI failed — Gemini draws instead: ${reason}`);
    return { ...(await viaGemini()), fallback: true, fallback_reason: reason };
  }
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
