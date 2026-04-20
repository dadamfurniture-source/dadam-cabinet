/**
 * 붙박이장 전용 프롬프트
 *
 * 대상 category: 'wardrobe'
 *
 * Step 2 (닫힌 도어): 벽 전체를 덮는 빌트인 붙박이장 설치
 * Step 3 (열린 도어): 도어를 열어 내부 옷봉·서랍 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export const WARDROBE_CATEGORIES = ['wardrobe'];

export function buildWardrobeClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  return `Place ${doorColor} ${doorFinish} built-in wardrobe on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Full-width floor-to-ceiling wardrobe with hinged doors.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
}

export function buildWardrobeAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open doors to ~90 degrees showing interior
- Show neatly organized clothes on hangers and folded items on shelves/in drawers
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}
