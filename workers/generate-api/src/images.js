/**
 * 연출컷 이미지 한 장 — 공급자를 고른다 (2026-10-18).
 *
 * IMAGE_PROVIDER = 'openai' 이고 OPENAI_API_KEY 가 있으면 GPT 가 그린다. 아니면 지금처럼 Gemini.
 * GPT 가 어떤 이유로든 실패하면(과부하·크레딧·모델 이름·검열) Gemini 가 대신 그리고 칸에 남긴다 —
 * 생성이 멈추는 것보다 다른 모델의 결과가 낫다. 분석·검사·채팅(텍스트)은 이 파일을 거치지 않고 Gemini 그대로.
 * 플래너 모드 기본안은 도면 렌더를 함께 쓰는 별도 경로라 renderImage 로 오지 않는다 (job.js).
 * 2026-10-18: 플래너 모드는 요청의 image_provider 로 고른다 — renderPlannerImage.
 * 2026-10-19: 플래너 모드 기본값은 PLANNER_IMAGE_PROVIDER (wrangler.toml 'openai' = GPT).
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
 * 플래너 모드 행에 기록된 이미지 공급자 (2026-10-18, 사장님 "같은 사진·도면을 GPT 로도 돌려 비교").
 * 'openai' 만 알아듣고, 없거나 모르는 값은 'gemini' — 기록이 없던 옛 행은 Gemini 로 그렸다.
 */
export function plannerProvider(v) {
  return v === 'openai' ? 'openai' : 'gemini';
}

/**
 * 플래너 모드 기본 공급자 (2026-10-19, wrangler.toml PLANNER_IMAGE_PROVIDER).
 * 실측(사진 4장 × 두 모델)에서 GPT 가 도면을 더 잘 따르고 더 싸서 기본을 GPT 로 — 'openai' 일 때만 GPT,
 * 없거나 모르는 값이면 'gemini'. 전역 IMAGE_PROVIDER(연출컷)와는 따로 논다.
 */
export function plannerDefaultProvider(env) {
  return env && env.PLANNER_IMAGE_PROVIDER === 'openai' ? 'openai' : 'gemini';
}

/**
 * 플래너 모드 요청의 공급자를 정한다 (2026-10-19). 요청 값('gemini'|'openai') → 재생성 원본에 기록된 값 →
 * 기본값(plannerDefaultProvider). 모르는 요청 값은 안 보낸 것으로 본다. 결과는 늘 둘 중 하나.
 */
export function resolvePlannerProvider(env, requested, inherited) {
  if (requested === 'openai' || requested === 'gemini') return requested;
  if (inherited === 'openai' || inherited === 'gemini') return inherited;
  return plannerDefaultProvider(env);
}

/**
 * 플래너 모드 기본안 한 장 (2026-10-18). 전역 IMAGE_PROVIDER 가 아니라 **행에 기록된 값**을 따른다.
 *
 *   'gemini'   callGemini(2K · 온도 · 비율). 칸 표시 없음.
 *   'openai'   GPT 편집 호출. 온도·imageSize 는 GPT 에 없어 뺀다.
 *              크기는 openai.js 의 OPENAI_SIZES 가 비율에서 고른다 (플래너 비율 다섯 개는 모두 표에 있다).
 *              키가 없거나 GPT 가 실패하면 Gemini 가 대신 그리고 fallback·사유를 남긴다.
 *
 * 2026-10-19: 공급자마다 보내는 것이 다를 수 있다 — GPT 에는 번호 붙은 입면, Gemini 에는 번호 없는 입면
 *   (Gemini 는 번호 라벨을 도어 위에 글자로 그려 넣었다). 그래서 p 는 객체 하나이거나
 *   공급자를 받아 객체를 돌려주는 함수다. GPT 실패 대체로 Gemini 가 그릴 때도 p('gemini') 를 다시 부른다.
 *
 * @param {object} env
 * @param {object|((provider:'gemini'|'openai')=>{prompt:string, images:object[], imageSize?:string, aspectRatio?:string, temperature?:number})} p
 * @param {'gemini'|'openai'} provider
 */
export async function renderPlannerImage(env, p, provider) {
  const payload = (who) => (typeof p === 'function' ? p(who) : p);
  const viaGemini = async () => {
    const g = payload('gemini');
    return { ...(await callGemini(env, g)), model: g.model || imageModel(env), provider: 'gemini' };
  };
  if (plannerProvider(provider) !== 'openai') return viaGemini();
  try {
    // 키가 없으면 callOpenAIImage 가 'OPENAI_API_KEY not configured' 로 던진다 → 아래에서 Gemini 가 대신
    const o = payload('openai');
    const r = await callOpenAIImage(env, { prompt: o.prompt, images: o.images, aspectRatio: o.aspectRatio });
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
