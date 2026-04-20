/**
 * 붙박이장 전용 프롬프트
 *
 * 대상 category: 'wardrobe'
 *
 * Step 2 (닫힌 도어): 벽면 전체를 덮는 full-height 도어 구조 설치
 * Step 3 (열린 도어): 같은 결과물의 문을 ~90° 열어 내부 옷봉·서랍 보여주기
 * 벽 폭에 따라 getWardrobeStructure 가 4/5/6/7 도어 구조를 리턴 — 견적 계산에도 재사용 가능.
 */

export const WARDROBE_CATEGORIES = ['wardrobe'];

/**
 * 벽 폭별 섹션 구조.
 * 모든 도어는 FULL-HEIGHT 단일 도어 (바닥~천장), 상·하 분할 금지.
 * 선반은 최소화하고 옷봉·내부 서랍을 우선.
 */
export function getWardrobeStructure(w) {
  if (w > 3200) return {
    prompt: '4 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, short-clothes hanging with 2 rods inside) + section C (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom) + section D (1 full-height door, long-clothes hanging with 1 rod + internal drawer at bottom). Total 7 full-height doors.',
    open: 'Section A: 2 rods for short clothes. Section B: 2 rods for short clothes. Section C: 1 rod for long coats + internal drawer at bottom. Section D: 1 rod for long coats + internal drawer at bottom.',
  };
  if (w > 2600) return {
    prompt: '3 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, short-clothes hanging with 2 rods inside) + section C (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom). Total 6 full-height doors.',
    open: 'Section A: 2 rods for short clothes. Section B: 2 rods for short clothes. Section C: 1 rod for long coats + internal drawer at bottom.',
  };
  if (w > 2000) return {
    prompt: '3 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom) + section C (1 full-height door, long-clothes hanging with 1 rod + internal drawer at bottom). Total 5 full-height doors.',
    open: 'Section A: 2 rods for short clothes. Section B: 1 rod for long coats + internal drawer at bottom. Section C: 1 rod for long coats + internal drawer at bottom.',
  };
  return {
    prompt: '2 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom). Total 4 full-height doors.',
    open: 'Section A: 2 rods for short clothes. Section B: 1 rod for long coats + internal drawer at bottom.',
  };
}

/**
 * Step 2 — 벽 전체 붙박이장 닫힌 도어.
 * Gemini 가 습관적으로 상하부장으로 분할하려 하므로 금지 절을 반복·구체화.
 */
export function buildWardrobeClosedPrompt({ wallData, themeData }) {
  const doorColor = themeData.style_door_color || 'white';
  const s = getWardrobeStructure(wallData.wallW);
  return `Edit photo: install a FULL-HEIGHT built-in wardrobe covering the entire wall (~${wallData.wallW}mm wide, ~${wallData.wallH}mm tall floor-to-ceiling).

STRUCTURE (HARD REQUIREMENT — this is a WARDROBE, NOT a kitchen, NOT a sink cabinetry, NOT an upper+lower cabinet):
- Each door is ONE SINGLE PIECE running continuously from the floor to the ceiling. Single rectangular door face, nothing else.
- NEVER split any door horizontally into upper and lower sections.
- NO mid-height rail, NO crossbar, NO horizontal seam, NO counter, NO open shelf, NO visible transom panel breaking the door face.
- NO upper cabinet above shorter doors. NO base cabinet with short doors below longer top doors. NO hutch. NO kitchen-style upper/lower split.
- NO countertop, NO sink, NO faucet, NO appliances — this is a clothing wardrobe, not a kitchen.

DOORS:
- "${doorColor}" matte flat-panel, completely smooth and seamless.
- NO indentations, NO grooves, NO cutouts, NO visible handles, NO knobs, NO chrome bars — push-to-open only.
- All doors closed in this image. No gaps between adjacent doors.

SECTION LAYOUT (inside is described here for reference; in THIS image doors are closed):
${s.prompt}

PRESERVE background EXACTLY: floor, ceiling, side walls, window, lighting, camera angle all pixel-identical. Photorealistic. No text, no labels.`;
}

/**
 * Step 3 — 열린 도어 + 내부 옷봉·서랍 구조.
 * worker.js 가 closedResult.image 를 입력으로 사용.
 * Gemini 가 "doors open" 지시를 무시하고 두 번째도 닫힌 이미지를 반환하는 경향을 차단.
 */
export function buildWardrobeAltSpec({ wallData, themeData }) {
  const s = getWardrobeStructure(wallData.wallW);
  const doorColor = (themeData && themeData.style_door_color) || 'same as input';
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe but with ALL DOORS VISIBLY OPEN at ~90 degrees, showing the interior.

CRITICAL — THE OUTPUT MUST LOOK DIFFERENT FROM THE INPUT:
- Every wardrobe door MUST be swung open ~90°. Do NOT return a closed-door image. Do NOT return the input unchanged.
- The interior MUST be clearly visible through the open doors.

INTERIOR (must be visible through the open doors):
${s.open}
Clothes on hangers on the rods, folded items in the internal drawers. Realistic wardrobe interior.

KEEP IDENTICAL from the input:
- Camera angle, lighting, background (walls, floor, ceiling, window, etc.), wardrobe position and width
- Door color and finish (the OUTSIDE face of each open door is still ${doorColor} matte flat-panel)
- Side panels, top crown, toe-kick

Photorealistic. No text, no labels.`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}

/**
 * 붙박이장 전용 견적 (300mm 당 140,000원).
 * worker.js 가 response.quote 로 붙여 보낸다.
 */
export function buildWardrobeQuote(wallW) {
  const UNIT_MM = 300;
  const UNIT_PRICE = 140000;
  const units = Math.ceil(wallW / UNIT_MM);
  const cabinetTotal = units * UNIT_PRICE;
  const installTotal = 200000;
  const demolitionTotal = Math.round(30000 * wallW / 1000);
  const items = [
    { name: '붙박이장 캐비닛', quantity: `${wallW}mm (${units}자)`, unit_price: UNIT_PRICE, total: cabinetTotal },
    { name: '시공비', quantity: '1식', unit_price: installTotal, total: installTotal },
    { name: '기존 철거', quantity: `${wallW}mm`, unit_price: 30000, total: demolitionTotal },
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
