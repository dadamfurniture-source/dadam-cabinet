/**
 * Anthropic (Claude) API 클라이언트 — Cloudflare Worker 환경.
 *
 * 현재 사용처: 냉장고장 카테고리의 pre-analysis 단계 (prompts/fridge-prompt.js).
 * 다른 카테고리는 Claude 를 호출하지 않으며, 이 파일이 import 되지도 않음.
 *
 * 실패 모드:
 *   - API key 없음/잘못됨 → ExternalError throw (worker 가 catch 후 preAnalysis=null 로 진행)
 *   - Rate limit / 타임아웃 → 동일, 생성 파이프라인 자체는 계속 진행
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * 방 사진 한 장을 Claude 에게 분석 요청.
 *
 * @param {object} env - Cloudflare Worker env (ANTHROPIC_API_KEY 필요)
 * @param {object} p
 * @param {string} p.model       - 예: 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'
 * @param {string} p.prompt      - JSON 반환 지시 포함한 분석 프롬프트
 * @param {string} p.image       - base64 (data URI prefix 없이 순수 base64)
 * @param {string} p.imageType   - 'image/jpeg' | 'image/png' 등
 * @param {number} [p.maxTokens] - 기본 1024
 * @returns {Promise<{text: string, usage?: object}>}
 */
export async function callClaudeVision(env, { model, prompt, image, imageType, maxTokens = 1024 }) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set in Cloudflare Worker secrets');
  }

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageType, data: image } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    throw new Error(`Claude API ${res.status}: ${errText.substring(0, 240)}`);
  }

  const data = await res.json();
  // Claude 응답의 content 는 [{type:'text', text:'...'}] 배열
  const text = data.content?.[0]?.text || '';
  return { text, usage: data.usage };
}

/**
 * Claude 응답에서 JSON 블록만 안전하게 추출.
 * Claude 가 ```json ... ``` 로 감싸거나 앞뒤 설명을 붙여도 대응.
 *
 * @returns {object|null} 파싱 실패 시 null
 */
export function extractJson(text) {
  if (!text) return null;
  // 1) ```json ... ``` 코드펜스 우선
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  // 2) { ... } 또는 [ ... ] 블록 추출
  const jsonMatch = candidate.match(/[\{\[][\s\S]*[\}\]]/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
