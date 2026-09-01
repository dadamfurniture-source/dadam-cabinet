/**
 * 사무실 붙박이 전용 프롬프트
 *
 * 대상 category: 'office'
 *
 * 왜 별도 모듈인가:
 *   등록되지 않은 카테고리는 dispatcher 가 buildStorageClosedPrompt 로 떨어뜨린다.
 *   그건 바닥~천장 수납장이라, '사무실' 을 고른 사람에게 책상 없는 창고장이 나온다.
 *   화면에 항목을 넣는 이상 그 항목이 뜻하는 것을 그려야 한다.
 *
 * Step 2 (닫힌 도어): 데스크 상판 + 상부 선반 + 하부 서랍의 일체형 붙박이
 * Step 3 (열린 도어): 서랍·도어 열어 내부 수납 보여주기
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export const OFFICE_CATEGORIES = ['office'];

export function buildOfficeClosedPrompt({ wallData, themeData, styleName }) {
  const doorColor = themeData.style_door_color || 'warm off-white';
  const doorFinish = themeData.style_door_finish || 'matte';

  return `Edit photo: install a ${doorColor} ${doorFinish} ${styleName} built-in OFFICE unit on this wall (~${wallData.wallW}mm wide × ${wallData.wallH}mm tall).

[FORM — MUST MATCH THIS EXACT LAYOUT]
- One continuous built-in wall unit running the full wall width, between flush full-height side panels
- DESK WORKTOP slab at ~730mm height, ~600~700mm deep, ~20~30mm thick, clean square edge, spanning the full width
- UNDER THE WORKTOP: a drawer pedestal (2~3 handleless drawers, ~400mm wide) at ONE side only; the rest of the under-desk space is OPEN knee space so a chair slides fully in
- ABOVE THE WORKTOP: open shelving band (~2~3 shelves) plus flat-panel closed cabinet doors at the outer sections, rising to the ceiling
- All fronts handleless — hidden J-profile grip or push-to-open
- Optional slim linear light under the upper shelf, subtle only

[FINISH]
- Panels, doors, drawer fronts: matte flat-panel, ${doorColor}
- Worktop may be a contrasting slab (light oak / solid surface) if it suits ${styleName}
- Styled minimally: a closed laptop, a few upright books, one small plant, a desk lamp — nothing cluttered

[FORBIDDEN]
- NO free-standing desk or loose office furniture — this is a BUILT-IN wall unit
- NO cubicle partitions, NO office chairs stacked, NO conference table
- NO visible handles or knobs
- NO text, logos, brand names, screens showing content

[BACKGROUND — STRICTLY PRESERVE]
- Keep the ORIGINAL room background pixel-identical: wall color/wallpaper/joints, floor material/pattern/board direction, ceiling, columns, beams, niches, windows, doors, baseboards, switches, outlets, lighting, camera angle
- The unit installs in front of / inside the existing structure — do NOT repaint walls, do NOT change flooring, do NOT remove or alter columns, beams, or any architectural element

Photorealistic. All closed (drawers closed, cabinet doors closed). No text/labels.`;
}

export function buildOfficeAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed built-in office unit image, generate the SAME unit with drawers and cabinet doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position, worktop styling
- Open the drawer pedestal (~80° pulled out) and the upper cabinet doors (~90°)
- Show neatly organized interior: files, stationery trays, boxes, folders
- Do NOT add or change any structure, panel, or finish
- Photorealistic quality`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}

/**
 * Office quote. 수납장 폴백(160k/1000mm)보다 높다 —
 * 데스크 상판 + 상부장 + 서랍장이 한 벌로 들어간다.
 * mcp-server 단가표에 사무실 항목이 생기면 그쪽을 정본으로 삼을 것.
 */
export function buildOfficeQuote(wallW) {
  const mm = Math.max(0, Number(wallW) || 0);
  const unitPrice = 220000;
  const install = 200000,
    demolitionRate = 30000;
  const items = [
    {
      name: '사무실 붙박이',
      quantity: `${mm}mm`,
      unit_price: unitPrice,
      total: Math.round((unitPrice * mm) / 1000),
    },
    { name: '시공비', quantity: '1식', unit_price: install, total: install },
    {
      name: '기존 철거',
      quantity: `${mm}mm`,
      unit_price: demolitionRate,
      total: Math.round((demolitionRate * mm) / 1000),
    },
  ];
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * 0.1);
  const total = subtotal + vat;
  return {
    items,
    subtotal,
    vat,
    total,
    range: { min: Math.round(total * 0.95), max: Math.round(total * 1.3) },
    grade: 'basic',
  };
}
