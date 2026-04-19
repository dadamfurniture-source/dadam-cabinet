/**
 * 냉장고장 전용 프롬프트 빌더
 *
 * Cloudflare Worker 의 /api/generate 에서 category === 'fridge' | 'fridge_cabinet'
 * 일 때만 사용. 3 단계 Gemini 파이프라인(철거 → 설치 → 열린문)의 앞 두 단계
 * 프롬프트를 생성한다.
 *
 * 공개 API:
 *   buildFridgeDemolitionPrompt()
 *     → 입력 사진에서 기존 빌트인 구조물을 완전히 제거한 "빈 벽" 사진 생성 지시
 *   buildFridgePrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts, siteAlreadyCleared })
 *     → 철거된 (또는 원본) 이미지 위에 새 냉장고장을 설치하는 지시
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
  return ` STYLE REFERENCE: Image 1 is the ONLY base photo — its floor, ceiling, walls, window, lighting are the target. The following ${refCount} image${plural ? 's are' : ' is'} 다담가구 냉장고장 training example${plural ? 's' : ''} — use ONLY their door-panel layout, proportions, reveal lines, handle style, material finish, and bridge-cabinet proportion. DO NOT COPY their floor, ceiling, walls, windows, lighting, camera angle, or any background element into the output. Background comes from Image 1 alone.`;
}

// 철거 실패 폴백용 INSTALLATION SITE PREPARATION 문구
const FALLBACK_SITE_PREP = 'INSTALLATION SITE PREPARATION: Completely clear the target wall area before placing the new cabinet — remove any existing storage, shelves, partitions, paneling, trim, or wall finishes so the new pantry is the only furniture on that wall.';

// 설치·추천 단계에서 반복되는 배경 고정 지시문 (사용자 요구: 배경 변경 불가)
// 프롬프트 최상단에 배치해 Gemini 가 설치 지시를 처리하기 전에 배경 제약을 먼저 인식하도록 한다.
const BACKGROUND_LOCK = `BACKGROUND LOCK (ABSOLUTE HARD REQUIREMENT — read this FIRST):
Image 1 is the BASE photograph. Everything in it EXCEPT the target installation wall must come through to the output PIXEL-IDENTICAL. Treat this as an inpainting task where only the target wall is editable.

PIXEL-IDENTICAL — must not change in any way:
- Floor: material, wood-grain pattern, tile layout, board direction, color, sheen, grout lines, stains, reflections
- Ceiling: color, texture, height, recessed lights positions, ceiling molding
- Side walls and ALL walls outside the target installation wall: paint color, wallpaper, trim
- Window: frame, mullion, glass, curtains, blinds, view outside
- Lighting: white balance, color temperature, shadow direction, highlight placement
- Camera: angle, perspective, focal length, lens distortion, framing, crop
- Any furniture, plant, rug, décor, outlet, switch NOT on the target wall

FORBIDDEN CHANGES (common failure modes — do NOT commit any of these):
- Do NOT recolor or replace the floor (no swapping wood species, no adding rugs)
- Do NOT recolor or re-paint non-target walls
- Do NOT change window size, shape, curtain style, or the outside view
- Do NOT re-orient the room or shift camera angle even slightly
- Do NOT warm-up or cool-down the lighting
- Do NOT copy any floor/ceiling/wall/window appearance from reference images (those are style-only)
- Do NOT crop or re-frame the photo

Only the target installation wall may receive new cabinetry. Everywhere else is FROZEN.`;

/**
 * Stage 1: 철거 프롬프트.
 * 입력 이미지에서 기존 빌트인 구조를 전부 없애고 평평한 드라이월만 남긴 사진을 생성.
 * extraImages 없이 단일 이미지 입력 전제. 낮은 temperature 권장 (0.2).
 */
export function buildFridgeDemolitionPrompt() {
  return `Edit photo: DEMOLISH and REMOVE every pre-existing built-in furniture element on the target wall. Return a photograph of the SAME room with the target wall completely BARE.

REMOVE (delete entirely, no trace left):
- every full-height cabinet column on both sides of the wall
- any center alcove, niche, or recessed opening
- any top bridge cabinet or soffit-mounted cabinet spanning the wall
- any embedded appliance (oven, microwave, wall oven, warming drawer)
- every decorative trim, crown molding, baseboard, wainscoting, and wall panel on the target wall
- all existing shelving, partitions, dividers, and vertical slats
- all wallpaper accents, cladding, or non-paint finishes on the target surface

PRESERVE (must remain visually identical):
- floor (wood/tile pattern, grout lines, color)
- ceiling
- side walls and their surface
- window frame, glass, curtains/blinds
- exterior room lighting, white balance, and color temperature
- camera angle, perspective, lens distortion
- any furniture or object NOT on the target wall
- electrical outlets — relocate onto the bare wall at the same height, no drill scars

OUTPUT: bare flat painted drywall on the target wall, smooth and uniform, ready for new installation. Photorealistic. No text, labels, arrows, or diagrams. Do NOT add any new furniture.`;
}

/**
 * Stage 2: 설치 프롬프트.
 * siteAlreadyCleared === true 이면 INSTALLATION SITE PREPARATION 문구 생략 (철거 스테이지가 앞단에 성공했다는 의미).
 * false 이면 폴백 문구 포함 (철거 실패로 원본 사진을 쓰는 경우).
 *
 * @param {object} p
 * @param {string} p.doorColor
 * @param {string} p.doorFinish
 * @param {object} p.wallData             { wallW, wallH }
 * @param {string} p.styleName
 * @param {object} p.fridgeOpts           클라이언트의 fridge_options (+ referenceCount)
 * @param {boolean} [p.siteAlreadyCleared=false]
 * @returns {string}
 */
export function buildFridgePrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts, siteAlreadyCleared = false }) {
  const opts = fridgeOpts || {};
  const combo = describeCombo(opts);
  const layout = describeLayout(opts);
  const appliances = describeAppliances(opts);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const sitePrep = siteAlreadyCleared ? '' : `\n${FALLBACK_SITE_PREP}`;

  return `${BACKGROUND_LOCK}

TASK: Edit Image 1 by installing a ${doorColor} ${doorFinish} refrigerator surround cabinet onto the target wall ONLY. Background of Image 1 stays pixel-identical per BACKGROUND LOCK above.${sitePrep}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Fridge: ${combo}. Layout: ${layout}, bridge cabinet above fridge.
ALL cabinet doors: ${doorColor} ${doorFinish} flat-panel. Door surface smooth and seamless.${appliances}${styleRef}
${styleName}. Photorealistic. All doors closed. No text.`;
}

/**
 * Stage 3 (대안): AI 추천 디자인 — 냉장고장 + 홈바/홈카페 수납장 포함.
 * 기존 "열린문" 스테이지를 대체. 입력 이미지는 철거된 빈 벽(또는 철거 실패 시 원본).
 *
 * 주요 차이:
 *  - buildFridgePrompt 와 동일한 냉장고 사양은 유지하되 옆으로 홈바·홈카페 존을 덧붙임
 *  - 커피머신 니치 / 글라스 프론트 머그 수납 / 와인·카라프 오픈 선반 등 시그니처 요소 요구
 *  - 사용자 요구: 배경은 절대 변경 불가
 *
 * @param {object} p (buildFridgePrompt 와 동일한 파라미터)
 * @returns {string}
 */
export function buildFridgeRecommendedPrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts, siteAlreadyCleared = false }) {
  const opts = fridgeOpts || {};
  const combo = describeCombo(opts);
  const layout = describeLayout(opts);
  const appliances = describeAppliances(opts);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const sitePrep = siteAlreadyCleared ? '' : `\n${FALLBACK_SITE_PREP}`;

  return `${BACKGROUND_LOCK}

TASK: Edit Image 1 by installing a premium ${doorColor} ${doorFinish} refrigerator surround cabinet WITH an integrated home-bar and home-cafe zone onto the target wall ONLY. Background of Image 1 stays pixel-identical per BACKGROUND LOCK above.${sitePrep}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Fridge: ${combo}. Base layout: ${layout}, bridge cabinet above fridge.

HOME BAR / HOME CAFE ZONE — adjacent to the fridge column, blended into the same ${doorColor} ${doorFinish} cabinetry:
- Counter-height recessed niche (about 600mm wide, 400mm tall) with integrated power, sized for an espresso machine or drip coffee maker.
- Glass-front upper wall cabinet above the niche, interior lit, displaying mugs and stemware on slim shelves.
- Short open shelving bay (about 300–400mm wide) for carafes, tea canisters, wine bottles, or serveware.
- Closed lower drawer under the niche for coffee beans / small appliances.
- Tall pantry doors fill the remaining wall width up to the bridge cabinet, matching the fridge column height.

ALL cabinet doors and panels: ${doorColor} ${doorFinish} flat-panel, handleless, seamless reveals. No chrome handles.${appliances}${styleRef}
${styleName}. Photorealistic editorial interior shot. All closed doors fully closed. No text, labels, or floating captions.`;
}

// 테스트/디버깅용 (필요 시 worker 외부에서 불러 확인)
export const __internals = {
  UNIT_DESC,
  LINE_DESC,
  APPLIANCE_DESC,
  FALLBACK_SITE_PREP,
  BACKGROUND_LOCK,
  describeCombo,
  describeLayout,
  describeAppliances,
  describeStyleReference,
};
