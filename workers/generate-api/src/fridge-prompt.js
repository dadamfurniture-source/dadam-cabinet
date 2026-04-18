/**
 * 냉장고장 전용 프롬프트 빌더
 *
 * Cloudflare Worker 의 /api/generate 에서 category === 'fridge' | 'fridge_cabinet'
 * 일 때만 사용. 클라이언트가 보낸 fridge_options 와 포트폴리오 레퍼런스 개수를
 * 받아 Gemini 에 넘길 단일 문자열 프롬프트를 만든다.
 *
 * 입력:
 *   fridgeOpts: { brand, modelLine, combo, position, appliances, referenceCount }
 *
 * 공개 API:
 *   buildFridgePrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts })
 */

const UNIT_DESC = {
  '1door': 'single-door column refrigerator',
  '3door': 'three-door refrigerator',
  '4door': 'french-door (4-door) refrigerator',
};

const LINE_DESC = {
  bespoke: 'Samsung Bespoke Kitchen Fit',
  infinite: 'Samsung Infinite Line',
  standing: 'freestanding',
  fitmax: 'LG Fit & Max built-in',
};

const APPLIANCE_DESC = {
  coffee_maker: 'espresso/coffee machine',
  microwave: 'microwave oven',
  oven: 'built-in oven',
  air_fryer: 'air fryer',
  toaster: 'toaster',
  kettle: 'electric kettle',
  rice_cooker: 'rice cooker',
  blender: 'blender',
};

function describeCombo(opts) {
  const combo = opts.combo || { '4door': 1 };
  const parts = [];
  for (const [type, count] of Object.entries(combo)) {
    if (Number(count) > 0) {
      const desc = UNIT_DESC[type] || type;
      parts.push(Number(count) > 1 ? `${count}x ${desc}` : desc);
    }
  }
  if (parts.length === 0) parts.push(UNIT_DESC['4door']);
  const brand = opts.brand === 'lg' ? 'LG' : 'Samsung';
  const lineDesc = LINE_DESC[opts.modelLine] || '';
  const lineStr = lineDesc ? ` (${lineDesc})` : '';
  return `${brand}${lineStr}: ${parts.join(' + ')}`;
}

function describeLayout(opts) {
  const position = opts.position === 'right' ? 'right' : 'left';
  return position === 'right'
    ? 'refrigerator on the RIGHT side of the wall, tall pantry cabinets to its LEFT'
    : 'refrigerator on the LEFT side of the wall, tall pantry cabinets to its RIGHT';
}

function describeAppliances(opts) {
  const ids = Array.isArray(opts.appliances) ? opts.appliances : [];
  if (ids.length === 0) return '';
  const names = ids.map((id) => APPLIANCE_DESC[id]).filter(Boolean);
  if (names.length === 0) return '';
  return ` Visible small appliances placed inside the open/glass niche of the tall cabinets: ${names.join(', ')}.`;
}

function describeStyleReference(refCount) {
  if (!refCount || refCount <= 0) return '';
  const plural = refCount > 1;
  return ` STYLE REFERENCE: The next ${refCount} image${plural ? 's are' : ' is'} 다담가구 냉장고장 portfolio reference${plural ? 's' : ''}. Match their door-panel layout, proportions, trim detail, and finish quality while keeping the target room (first image) background EXACT.`;
}

/**
 * 냉장고장 설치 프롬프트 생성.
 *
 * @param {object} p
 * @param {string} p.doorColor   도어 색상 (예: "white")
 * @param {string} p.doorFinish  도어 마감 (예: "matte")
 * @param {object} p.wallData    { wallW, wallH }
 * @param {string} p.styleName   스타일 이름 (예: "Modern Minimal")
 * @param {object} p.fridgeOpts  클라이언트가 보낸 fridge_options (+ referenceCount)
 * @returns {string}
 */
export function buildFridgePrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts }) {
  const opts = fridgeOpts || {};
  const combo = describeCombo(opts);
  const layout = describeLayout(opts);
  const appliances = describeAppliances(opts);
  const styleRef = describeStyleReference(opts.referenceCount || 0);

  return `Edit photo: install ${doorColor} ${doorFinish} refrigerator surround cabinet. PRESERVE background of the first image EXACTLY.
INSTALLATION SITE PREPARATION: Completely clear the target wall area before placing the new cabinet — remove any existing storage, shelves, partitions, paneling, trim, or wall finishes so the new pantry is the only furniture on that wall.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Fridge: ${combo}. Layout: ${layout}, bridge cabinet above fridge.
ALL cabinet doors: ${doorColor} ${doorFinish} flat-panel. Door surface smooth and seamless.${appliances}${styleRef}
${styleName}. Photorealistic. All doors closed. No text.`;
}

// 테스트/디버깅용 (필요 시 worker 외부에서 불러 확인)
export const __internals = { UNIT_DESC, LINE_DESC, APPLIANCE_DESC, describeCombo, describeLayout, describeAppliances, describeStyleReference };
