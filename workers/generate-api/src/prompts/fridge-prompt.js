/**
 * 냉장고장 전용 프롬프트
 *
 * 대상 category: 'fridge' | 'fridge_cabinet'
 *
 * Step 2 (닫힌 도어): 냉장고장 + 좌·우 톨 팬트리 + 상단 브릿지
 * Step 3 (열린 도어): 도어 열어 내부 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export const FRIDGE_CATEGORIES = ['fridge', 'fridge_cabinet'];

export function buildFridgeClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  return `Place ${doorColor} ${doorFinish} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Center opening for fridge, tall storage on sides, bridge above.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
}

export function buildFridgeAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door fridge cabinet image, generate the SAME cabinet with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position, fridge position
- Open the cabinet doors to ~90 degrees showing interior shelving and pantry items
- Keep refrigerator itself unchanged
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}
