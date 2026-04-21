/**
 * 일반 수납장 폴백 프롬프트
 *
 * 위 5개 카테고리(sink/wardrobe/shoe/fridge/vanity) 어디에도 매치 안 되는 카테고리가
 * 들어왔을 때 사용. dispatcher 가 매치 실패 시 이 모듈로 빠짐.
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export function buildStorageClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  return `Place ${doorColor} ${doorFinish} storage cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Floor-to-ceiling built-in with multiple door sections.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
}

export function buildStorageAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door storage cabinet image, generate the SAME cabinet with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open doors to ~90 degrees showing interior shelving
- Show neatly organized items inside
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}

/**
 * Storage fallback quote. mcp-server 단가: 160k/1000mm.
 * 매치 안 된 카테고리에도 견적이 나오도록 안전망.
 */
export function buildStorageQuote(wallW) {
  const mm = Math.max(0, Number(wallW) || 0);
  const unitPrice = 160000;
  const install = 200000, demolitionRate = 30000;
  const items = [
    { name: '수납장 캐비닛', quantity: `${mm}mm`, unit_price: unitPrice, total: Math.round(unitPrice * mm / 1000) },
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
