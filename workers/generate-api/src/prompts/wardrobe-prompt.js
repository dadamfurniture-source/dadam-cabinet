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
 */
export function buildWardrobeClosedPrompt({ wallData, themeData }) {
  const doorColor = themeData.style_door_color || 'white';
  const s = getWardrobeStructure(wallData.wallW);
  return `Edit photo: install built-in wardrobe covering entire wall (~${wallData.wallW}mm wide, ~${wallData.wallH}mm tall).
Doors: "${doorColor}" matte flat-panel, each door is one single piece running full height from floor to ceiling. Door surface is completely smooth and seamless with no indentations, no grooves, no cutouts. ${s.prompt}
All doors closed. No gaps between doors. Preserve background. Photorealistic. No text.`;
}

/**
 * Step 3 — 열린 도어 + 내부 옷봉·서랍 구조.
 * worker.js 가 closedResult.image 를 입력으로 사용.
 */
export function buildWardrobeAltSpec({ wallData }) {
  const s = getWardrobeStructure(wallData.wallW);
  return {
    inputKey: 'closed',
    prompt: `Open all wardrobe doors ~90°. Show organized interior: ${s.open} Clothes on hangers, folded items in drawers. Same camera/lighting/background. Photorealistic. No text.`,
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
