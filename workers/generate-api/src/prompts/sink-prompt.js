/**
 * 싱크대 / 주방 전용 프롬프트
 *
 * 대상 category: 'sink' | 'kitchen' | 'l_shaped_sink' | 'island_kitchen'
 *
 * Step 2 (닫힌 도어): 사용자가 선택한 색상·스타일·레이아웃으로 빌트인 주방 설치
 * Step 3 (열린 도어): 같은 결과물의 도어를 ~90° 열어 내부 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

const LAYOUT_DESC = {
  i_type: 'straight linear I-shaped',
  l_type: 'L-shaped corner',
  u_type: 'U-shaped three-wall',
  peninsula: 'peninsula island facing living room',
};

export const SINK_CATEGORIES = ['sink', 'kitchen', 'l_shaped_sink', 'island_kitchen'];

export function buildSinkClosedPrompt({ kitchenLayout, wallData, themeData, styleName }) {
  const layoutDesc = LAYOUT_DESC[kitchenLayout] || 'straight linear';
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  const countertop = themeData.style_countertop_prompt || 'white stone countertop';

  return `Place ${doorColor} ${doorFinish} flat panel ${layoutDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY.
[WALL] ${wallData.wallW}x${wallData.wallH}mm wall.
[PLUMBING] Sink at ${wallData.waterPct}% from left, cooktop at ${wallData.exhaustPct}% from left.
[UPPER] 4 upper cabinets flush to ceiling, no gap between ceiling and cabinets.
[LOWER] 5 lower cabinets (600mm, sink, 600mm, cooktop, 600mm).
[COUNTERTOP] ${countertop}, continuous surface.
[DOORS] No visible handles. Push-to-open mechanism.
[HOOD] Concealed range hood integrated into upper cabinet above cooktop.
[STYLE] ${styleName}. Clean lines. Photorealistic interior photography.
[QUALITY] 8K quality, natural lighting, proper shadows and reflections.
CRITICAL: PRESERVE original room background EXACTLY. All doors CLOSED. No text/labels. Photorealistic.`;
}

export function buildSinkAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door kitchen image, generate the SAME kitchen with cabinet doors and drawers OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open upper cabinet doors and lower drawers to ~90 degrees showing interior
- Show neatly organized dishware, utensils, pantry items inside
- Photorealistic quality
- Do NOT change any furniture structure, color, layout, or appliance position`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}

export const __internals = { LAYOUT_DESC };
