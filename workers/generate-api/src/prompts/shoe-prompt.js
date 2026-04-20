/**
 * 신발장 전용 프롬프트
 *
 * 대상 category: 'shoe' | 'shoe_cabinet'
 *
 * Step 2 (닫힌 도어): 슬림 프로파일 바닥~천장 신발장
 * Step 3 (열린 도어): 신발장 문 열어 내부 선반 보여주기
 */

export const SHOE_CATEGORIES = ['shoe', 'shoe_cabinet'];

export function buildShoeClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  return `Place ${doorColor} ${doorFinish} shoe cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
}

export function buildShoeAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door shoe cabinet image, generate the SAME cabinet with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open doors to ~90 degrees showing interior shelving
- Show neatly arranged shoes on interior shelves
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}
