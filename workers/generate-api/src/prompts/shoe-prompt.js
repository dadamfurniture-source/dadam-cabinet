/**
 * 신발장 전용 프롬프트
 *
 * 대상 category: 'shoe' | 'shoe_cabinet'
 *
 * Step 2 (닫힌 도어): 슬림 프로파일 바닥~천장 신발장
 * Step 3 (열린 도어): 도어 열어 내부 신발 선반 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
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

/**
 * Shoe cabinet quote. mcp-server 단가: 400k/1000mm (슬림 프로파일, 바닥~천장).
 */
export function buildShoeQuote(wallW) {
  const mm = Math.max(0, Number(wallW) || 0);
  const unitPrice = 400000;
  const install = 200000, demolitionRate = 30000;
  const items = [
    { name: '신발장 캐비닛', quantity: `${mm}mm`, unit_price: unitPrice, total: Math.round(unitPrice * mm / 1000) },
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
