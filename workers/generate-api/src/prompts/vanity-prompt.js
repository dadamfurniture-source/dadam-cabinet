/**
 * 파우더룸/화장대 전용 프롬프트
 *
 * 대상 category: 'vanity'
 *
 * Step 2 (닫힌 도어): 벽에 화장대 + 거울 캐비닛 설치
 * Step 3 (열린 도어): 화장대 도어/서랍 열어 내부 수납 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export const VANITY_CATEGORIES = ['vanity'];

export function buildVanityClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  const countertop = themeData.style_countertop_prompt || 'white stone countertop';
  return `Place ${doorColor} ${doorFinish} bathroom vanity on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Vanity with sink at ${wallData.waterPct}% from left. Mirror cabinet above.
${countertop}. ${styleName}. Photorealistic. Faucet chrome finish.`;
}

export function buildVanityAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door vanity image, generate the SAME vanity with doors and drawers OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open vanity doors and drawers to ~90 degrees showing interior
- Show neatly organized skincare bottles, towels, accessories inside
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}
