/**
 * 싱크대 / 주방 전용 프롬프트
 *
 * 대상 category: 'sink' | 'kitchen' | 'l_shaped_sink' | 'island_kitchen'
 *
 * Step 2 (닫힌 도어): 사용자가 선택한 색상·스타일·레이아웃으로 빌트인 주방 설치
 * Step 3 (AI 추천 — 닫힌 도어): Step 2 결과물에 상·하부 투톤 + 다른 카운터탑을 랜덤으로 입힌
 *   **또 다른 닫힌 도어** 이미지. 열린 도어 아님. 사용자 요구: "싱크대 2개의 이미지 생성 결과물은 닫힌 도어."
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

const LAYOUT_DESC = {
  i_type: 'straight linear I-shaped',
  l_type: 'L-shaped corner',
  u_type: 'U-shaped three-wall',
  peninsula: 'peninsula island facing living room',
};

// AI 추천안 색상 풀 (상·하부 투톤)
const ALT_TWO_TONES = [
  { upper: 'cream white', lower: 'walnut wood grain' },
  { upper: 'matte black', lower: 'natural oak' },
  { upper: 'sage green',  lower: 'cream white' },
  { upper: 'navy blue',   lower: 'warm beige' },
  { upper: 'warm white',  lower: 'smoked oak' },
  { upper: 'terracotta',  lower: 'cream white' },
  { upper: 'soft gray',   lower: 'walnut wood grain' },
  { upper: 'dusty pink',  lower: 'natural oak' },
];

const ALT_COUNTERTOPS = [
  'white quartz with subtle gray veining',
  'warm gray marble',
  'butcher-block wood countertop',
  'matte concrete',
  'cream terrazzo with small chips',
  'black granite',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

/**
 * Step 3 — 닫힌 도어 결과를 입력으로 받아 상·하부 색상·카운터탑만 **랜덤 추천안** 으로
 * 리컬러링한 **또 다른 닫힌 도어** 이미지. 레이아웃·카메라·배경 모두 동일, 도어는 여전히 닫혀있음.
 */
export function buildSinkAltSpec({ styleName }) {
  const pick = pickRandom(ALT_TWO_TONES);
  const altCT = pickRandom(ALT_COUNTERTOPS);
  const prompt = `Recolor this kitchen photo to an AI-recommended alternate color scheme:
- Upper cabinets: ${pick.upper}
- Lower cabinets: ${pick.lower}
- Countertop: ${altCT}
- ${styleName} style
KEEP everything else PIXEL-IDENTICAL: camera angle, room background, cabinet layout, sink position, cooktop position, hood, door lines, appliance positions, lighting.
ALL DOORS MUST STAY CLOSED — do NOT open any door or drawer. Do NOT show interior contents. This is a closed-door alternate color rendering of the same kitchen. Photorealistic. No text or labels.`;

  return {
    inputKey: 'closed',
    prompt,
    metadata: {
      alt_colors: { upper: pick.upper, lower: pick.lower },
      alt_countertop: altCT,
      alt_style: { name: 'AI Two-tone Recommendation', upper: pick.upper, lower: pick.lower, countertop: altCT },
    },
  };
}

export const __internals = { LAYOUT_DESC, ALT_TWO_TONES, ALT_COUNTERTOPS, pickRandom };
