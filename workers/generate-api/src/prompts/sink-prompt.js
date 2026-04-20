/**
 * 싱크대 / 키친 전용 프롬프트
 *
 * 대상 category: 'sink' | 'kitchen' | 'l_shaped_sink' | 'island_kitchen'
 *
 * Step 2 (닫힌 도어): 사용자가 선택한 색상·스타일로 I/L/island 형 빌트인 주방 설치
 * Step 3 (AI 추천):   같은 레이아웃에 상·하부 투톤 + 다른 카운터탑을 랜덤으로 입힌 닫힌 도어
 *   - mcp-server/src/routes/generate.route.ts 의 ALT_TWO_TONES 패턴을 Worker 로 포팅
 *   - 2번째 이미지도 닫힌 도어 (열린 도어 아님) — 사용자 요구
 */

const LAYOUT_DESC = {
  i_type: 'straight linear I-shaped',
  l_type: 'L-shaped corner',
  c_type: 'C-shaped U',
  island: 'island with peninsula',
};

// Step 3 추천안 색상 풀 (상부 · 하부 조합)
const ALT_TWO_TONES = [
  { upper: 'cream white', lower: 'walnut wood grain' },
  { upper: 'matte black', lower: 'natural oak' },
  { upper: 'sage green', lower: 'cream white' },
  { upper: 'navy blue',  lower: 'warm beige' },
  { upper: 'warm white', lower: 'smoked oak' },
  { upper: 'terracotta', lower: 'cream white' },
  { upper: 'soft gray',  lower: 'walnut wood grain' },
  { upper: 'dusty pink', lower: 'natural oak' },
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

/**
 * Step 2 — 사용자 옵션 기반 닫힌 도어.
 */
export function buildSinkClosedPrompt({ style, kitchenLayout, wallData, themeData, styleName }) {
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
 * Step 3 — 닫힌 도어 결과물을 입력으로 받아 상·하부 색상만 리컬러링한 AI 추천안.
 * worker.js 쪽에서 `closedResult.image` 를 inputImage 로 사용한다.
 */
export function buildSinkAltSpec({ styleName }) {
  const pick = pickRandom(ALT_TWO_TONES);
  const altCT = pickRandom(ALT_COUNTERTOPS);
  const prompt = `Recolor this kitchen photo to an AI-recommended alternate color scheme:
- Upper cabinets: ${pick.upper}
- Lower cabinets: ${pick.lower}
- Countertop: ${altCT}
- ${styleName} style
KEEP everything else PIXEL-IDENTICAL: camera angle, room background, cabinet layout, sink position, cooktop position, hood, door lines, appliance positions, lighting. All doors CLOSED. Do NOT add or remove any cabinet. Photorealistic. No text or labels.`;

  return {
    inputKey: 'closed', // worker.js 가 closedResult.image 를 입력으로 사용
    prompt,
    metadata: {
      alt_colors: { upper: pick.upper, lower: pick.lower },
      alt_countertop: altCT,
      alt_style: { name: 'AI Two-tone Recommendation', upper: pick.upper, lower: pick.lower, countertop: altCT },
    },
  };
}

export const __internals = { LAYOUT_DESC, ALT_TWO_TONES, ALT_COUNTERTOPS, pickRandom };
