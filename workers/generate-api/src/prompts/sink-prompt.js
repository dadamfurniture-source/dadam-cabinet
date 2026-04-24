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
  - Below cooktop: 2-tier stacked drawer bank (exactly 2 drawer fronts stacked vertically). NOT a single door, NOT a single drawer — must be a visible 2-tier drawer face.
  - Below sink: single full-height cabinet door (under-sink storage).
  - Other lower cabinets (the three 600mm units): each is a single full-height door.
[COUNTERTOP] ${countertop}, continuous surface.
[SINK] Undermount single-bowl basin, matte gunmetal interior.
[FAUCET] Minimalist pull-down mixer tap, matte black.
[COOKTOP] Flush induction cooktop integrated into the countertop, 4 cooking zones, NO gas burners, NO knobs sticking up.
[HANDLES] J-pull handleless on every door and drawer — a narrow J-shaped channel recess carved into the top edge of each door panel and into the top edge of each drawer front, same color as the cabinet (no separate hardware).
[HOOD] Slim concealed under-cabinet hood integrated above cooktop.
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
KEEP everything else PIXEL-IDENTICAL: camera angle, room background, cabinet layout, sink position, cooktop position, hood, door lines, appliance positions, lighting, AND the J-pull handleless style AND the 2-tier drawer bank below the cooktop AND the undermount sink + matte black faucet + flush induction cooktop hardware.
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

/**
 * Sink-only quote. 단가는 mcp-server `quote.service.ts` 의 카테고리 표준값.
 * 하부장 160k/1000mm, 상부장 140k (벽폭의 70% 만 상부장으로 가정 — 후드 존 제외),
 * 상판 basic 150k/1000mm, 수전·싱크볼·후드 basic 각 1식, 시공 200k, 철거 30k/1000mm.
 */
export function buildSinkQuote(wallW) {
  const mm = Math.max(0, Number(wallW) || 0);
  const lowerPrice = 160000;
  const upperPrice = 140000;
  const countertopPrice = 150000;
  const faucet = 40000, sinkBowl = 80000, hood = 65000;
  const install = 200000, demolitionRate = 30000;
  const upperMm = Math.round(mm * 0.7);
  const items = [
    { name: '하부장 캐비닛', quantity: `${mm}mm`, unit_price: lowerPrice, total: Math.round(lowerPrice * mm / 1000) },
    { name: '상부장 캐비닛', quantity: `${upperMm}mm`, unit_price: upperPrice, total: Math.round(upperPrice * upperMm / 1000) },
    { name: '상판 (인조대리석)', quantity: `${mm}mm`, unit_price: countertopPrice, total: Math.round(countertopPrice * mm / 1000) },
    { name: '수전', quantity: '1개', unit_price: faucet, total: faucet },
    { name: '싱크볼', quantity: '1개', unit_price: sinkBowl, total: sinkBowl },
    { name: '후드', quantity: '1개', unit_price: hood, total: hood },
    { name: '시공비', quantity: '1식', unit_price: install, total: install },
    { name: '기존 철거', quantity: `${mm}mm`, unit_price: demolitionRate, total: Math.round(demolitionRate * mm / 1000) },
  ];
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * 0.10);
  const total = subtotal + vat;
  return {
    items, subtotal, vat, total,
    range: { min: Math.round(total * 0.95), max: Math.round(total * 1.30) },
    grade: 'basic',
  };
}
