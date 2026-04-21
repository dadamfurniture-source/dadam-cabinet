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

// 냉장고 유닛별 표준 가로폭 (mm). 절대 좌표 계산에 사용.
// 한국 빌트인 표준 기준: 1도어 컬럼은 좁고, 3·4도어는 비슷한 와이드 바디.
const UNIT_WIDTH_MM = {
  '1door': 600,
  '3door': 900,
  '4door': 900,
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
  return ` STYLE REFERENCE: Image 1 is the ONLY base photo — its floor, ceiling, walls, window, lighting are the target. The following ${refCount} image${plural ? 's are' : ' is'} 다담가구 냉장고장 training example${plural ? 's' : ''} — use ONLY their door-panel finish, reveal lines, handleless detail, and material texture. DO NOT COPY their floor, ceiling, walls, windows, lighting, camera angle, OR refrigerator placement, refrigerator-vs-pantry proportion, refrigerator centering, or column widths into the output. Layout (which side the fridge sits on, where it starts, how wide the pantry is) comes ONLY from SPEC LOCK above; backgrounds come ONLY from Image 1.`;
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

// 추천 디자인 (홈바·홈카페) 의 긴 자유 묘사 뒤에 다시 못 박는 짧은 재확인 문구.
const BACKGROUND_LOCK_REMINDER = `REMINDER — BACKGROUND LOCK still applies: do NOT touch floor, ceiling, side walls, window, curtains, lighting, or camera angle. The home-bar zone is only allowed to occupy the target wall area, not to redecorate the rest of the room.`;

/**
 * 사용자가 선택한 냉장고 옵션을 Gemini 가 무시하지 못하도록 HARD REQUIREMENTS 블록으로 변환.
 * - 유닛별 가로 폭 (UNIT_WIDTH_MM) 으로 냉장고 그룹 총 폭을 계산
 * - position 을 절대 좌표 (mm offset) 로 표현 → "LEFT side" 같은 모호함 제거
 * - 멀티 유닛이면 좌→우 순서 명시
 * - 레퍼런스 이미지의 사양과 충돌하면 옵션이 우선임을 명시.
 */
function buildSpecLock(opts, wallW) {
  const o = opts || {};
  const W = Number(wallW) || 3000;
  const brand = o.brand === 'lg' ? 'LG' : 'Samsung';
  const lineDesc = LINE_DESC[o.modelLine] || '';
  const lineHasBrand = lineDesc.toLowerCase().includes(brand.toLowerCase());
  const brandLine = lineDesc
    ? (lineHasBrand ? lineDesc : `${brand} ${lineDesc}`)
    : `${brand} (model line not specified)`;

  // 1) 냉장고 유닛 시퀀스 — 좁은(1door) → 넓은(3·4door) 순으로 정렬해 외관상 자연스러움
  const combo = o.combo || { '4door': 1 };
  const order = ['1door', '3door', '4door']; // 좌→우 표시 순서
  const unitSeq = []; // [{type, widthMm}]
  for (const type of order) {
    const n = Number(combo[type] || 0);
    for (let i = 0; i < n; i++) {
      unitSeq.push({ type, widthMm: UNIT_WIDTH_MM[type] || 900 });
    }
  }
  if (unitSeq.length === 0) unitSeq.push({ type: '4door', widthMm: UNIT_WIDTH_MM['4door'] });

  const totalFridgeMm = unitSeq.reduce((s, u) => s + u.widthMm, 0);
  const pantryMm = Math.max(0, W - totalFridgeMm);

  const comboParts = unitSeq.map((u) => `${UNIT_DESC[u.type]} (~${u.widthMm}mm wide)`);
  const position = o.position === 'right' ? 'RIGHT' : 'LEFT';

  // 2) 절대 좌표 기반 위치 지시 (벽의 left edge 를 x=0 기준)
  let layoutLine;
  if (position === 'LEFT') {
    layoutLine =
      `- Refrigerator group STARTS FLUSH AGAINST THE WALL'S LEFT EDGE (x=0mm) and extends rightward to x=${totalFridgeMm}mm. ` +
      `Tall pantry / storage cabinets begin immediately at x=${totalFridgeMm}mm and continue to the wall's RIGHT edge (x=${W}mm), filling exactly ${pantryMm}mm. ` +
      `No gap between the refrigerator group and the pantry. No empty wall space on the left of the refrigerator.`;
  } else {
    layoutLine =
      `- Refrigerator group ENDS FLUSH AGAINST THE WALL'S RIGHT EDGE (x=${W}mm); it starts at x=${pantryMm}mm and extends rightward ${totalFridgeMm}mm. ` +
      `Tall pantry / storage cabinets fill from the wall's LEFT edge (x=0mm) to x=${pantryMm}mm. ` +
      `No gap between the pantry and the refrigerator group. No empty wall space on the right of the refrigerator.`;
  }

  // 3) 멀티 유닛이면 내부 순서 명시 (왼쪽부터 누적 좌표)
  let unitOrderLine = '';
  if (unitSeq.length > 1) {
    let cursor = position === 'LEFT' ? 0 : pantryMm;
    const ranges = unitSeq.map((u) => {
      const start = cursor;
      const end = cursor + u.widthMm;
      cursor = end;
      return `${UNIT_DESC[u.type]} occupies x=${start}mm → x=${end}mm`;
    });
    unitOrderLine = `- Inside the refrigerator group, units are placed strictly LEFT-TO-RIGHT in this order with NO overlap and NO gap: ${ranges.join('; then ')}.`;
  }

  const ids = Array.isArray(o.appliances) ? o.appliances : [];
  const applianceNames = ids.map((id) => APPLIANCE_DESC[id]).filter(Boolean);

  const lines = [
    `SPEC LOCK (HARD REQUIREMENTS — these specs OVERRIDE anything seen in the reference images):`,
    `- Target wall total width: ${W}mm. All x-coordinates below are measured from the wall's LEFT edge (x=0mm) to its RIGHT edge (x=${W}mm).`,
    `- Brand & line: ${brandLine}. Use authentic ${brand} refrigerator proportions, door divisions, hinge placement, and panel splits — not a generic fridge and not the brand shown in any reference image.`,
    `- Refrigerator units (exactly this many appear, no more no fewer, in this exact left-to-right order): ${comboParts.join(' + ')}. Total refrigerator group width ≈ ${totalFridgeMm}mm.`,
    layoutLine,
  ];
  if (unitOrderLine) lines.push(unitOrderLine);
  if (applianceNames.length > 0) {
    lines.push(`- Built-in appliances that MUST appear, visibly placed inside the cabinetry's open or glass-front niches: ${applianceNames.join(', ')}. None of these may be omitted.`);
  } else {
    lines.push(`- No built-in cooking appliances on this wall — no oven, no microwave, no air-fryer drawer. Only the refrigerator(s) and closed cabinetry.`);
  }
  lines.push(`- If a reference image shows a different brand, different door count, opposite position, OR a different placement (centered when LEFT was requested, etc.), IGNORE those aspects of the reference. References are consulted ONLY for door-panel finish, reveal lines, handleless detail, and bridge-cabinet proportion.`);
  return lines.join('\n');
}

/**
 * 상단 브릿지 캐비닛이 아래 컬럼 경계와 동기화되도록 강제하는 블록.
 * SPEC LOCK 의 좌표 정보가 있어야 모델이 어디에 seam 을 둬야 할지 알 수 있음.
 */
function buildSeamAlignment(opts, wallW) {
  const o = opts || {};
  const W = Number(wallW) || 3000;
  const combo = o.combo || { '4door': 1 };
  const order = ['1door', '3door', '4door'];
  const unitSeq = [];
  for (const type of order) {
    const n = Number(combo[type] || 0);
    for (let i = 0; i < n; i++) unitSeq.push({ type, widthMm: UNIT_WIDTH_MM[type] || 900 });
  }
  if (unitSeq.length === 0) unitSeq.push({ type: '4door', widthMm: UNIT_WIDTH_MM['4door'] });
  const totalFridgeMm = unitSeq.reduce((s, u) => s + u.widthMm, 0);
  const pantryMm = Math.max(0, W - totalFridgeMm);
  const position = o.position === 'right' ? 'RIGHT' : 'LEFT';

  // 위→아래 컬럼 경계 좌표
  const seams = new Set();
  if (position === 'LEFT') {
    let c = 0;
    for (const u of unitSeq) { c += u.widthMm; seams.add(c); }
    // 냉장고 그룹 끝(=팬트리 시작) 도 자연스럽게 포함됨
  } else {
    let c = pantryMm;
    for (const u of unitSeq) { c += u.widthMm; if (c < W) seams.add(c); }
    seams.add(pantryMm); // 팬트리 끝(=냉장고 시작)
  }
  const seamList = [...seams].sort((a, b) => a - b);

  return `VERTICAL SEAM ALIGNMENT (required — bridge cabinet must follow column layout below):
- Treat the top bridge cabinet as a horizontal panel run that MIRRORS the vertical seams of the cabinetry below it.
- The bridge cabinet MUST have panel divisions at exactly these x-coordinates (mm from the wall's left edge): ${seamList.join('mm, ')}mm.
- Bridge cabinet panels DIRECTLY ABOVE the refrigerator group share the same width as each refrigerator unit; bridge panels DIRECTLY ABOVE the pantry columns share the same width as the pantry door modules.
- DO NOT introduce floating bridge panel divisions that ignore the columns below. No off-axis seams.`;
}

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
  const wallW = (wallData && Number(wallData.wallW)) || 3000;
  const specLock = buildSpecLock(opts, wallW);
  const seamLock = buildSeamAlignment(opts, wallW);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const sitePrep = siteAlreadyCleared ? '' : `\n${FALLBACK_SITE_PREP}`;

  return `${BACKGROUND_LOCK}

${specLock}

${seamLock}

TASK: Edit Image 1 by installing the ${doorColor} ${doorFinish} refrigerator surround cabinet specified in SPEC LOCK above onto the target wall ONLY, following the exact x-coordinates and seam alignment requirements above. Background of Image 1 stays pixel-identical per BACKGROUND LOCK above.${sitePrep}
Target wall dimensions: ${wallW}×${(wallData && wallData.wallH) || 2400}mm. Place a bridge cabinet across the top spanning the full wall width, divided per VERTICAL SEAM ALIGNMENT above.
ALL cabinet doors and panels: ${doorColor} ${doorFinish} flat-panel, handleless, seamless reveals. Door surface smooth and seamless.${styleRef}
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
  const wallW = (wallData && Number(wallData.wallW)) || 3000;
  const specLock = buildSpecLock(opts, wallW);
  const seamLock = buildSeamAlignment(opts, wallW);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const sitePrep = siteAlreadyCleared ? '' : `\n${FALLBACK_SITE_PREP}`;

  return `${BACKGROUND_LOCK}

${specLock}

${seamLock}

TASK: Edit Image 1 by installing the ${doorColor} ${doorFinish} refrigerator surround cabinet specified in SPEC LOCK above (with the exact x-coordinates), AND adding an integrated home-bar / home-cafe zone on the SAME target wall, BLENDED INTO THE PANTRY HALF (do NOT shift the refrigerator group from its locked x-coordinates). Background of Image 1 stays pixel-identical per BACKGROUND LOCK above. The home-bar zone may ONLY occupy area on the target wall — it must NOT extend into the floor area, ceiling, side walls, or anywhere outside the target wall.${sitePrep}
Target wall dimensions: ${wallW}×${(wallData && wallData.wallH) || 2400}mm. Bridge cabinet spans the top across the full wall width, divided per VERTICAL SEAM ALIGNMENT above (the home-bar internal seams are additional, but must NOT alter the refrigerator-vs-pantry seam).

HOME BAR / HOME CAFE ZONE — adjacent to the refrigerator column on the target wall, blended into the same ${doorColor} ${doorFinish} cabinetry:
- Counter-height recessed niche (about 600mm wide, 400mm tall) with integrated power, sized for an espresso machine or drip coffee maker.
- Glass-front upper wall cabinet above the niche, interior lit, displaying mugs and stemware on slim shelves.
- Short open shelving bay (about 300–400mm wide) for carafes, tea canisters, wine bottles, or serveware.
- Closed lower drawer under the niche for coffee beans / small appliances.
- Tall pantry doors fill the remaining wall width up to the bridge cabinet, matching the fridge column height.

ALL cabinet doors and panels: ${doorColor} ${doorFinish} flat-panel, handleless, seamless reveals. No chrome handles.${styleRef}
${styleName}. Photorealistic editorial interior shot. All closed doors fully closed. No text, labels, or floating captions.

${BACKGROUND_LOCK_REMINDER}`;
}

// 테스트/디버깅용 (필요 시 worker 외부에서 불러 확인)
export const __internals = {
  UNIT_DESC,
  UNIT_WIDTH_MM,
  LINE_DESC,
  APPLIANCE_DESC,
  FALLBACK_SITE_PREP,
  BACKGROUND_LOCK,
  BACKGROUND_LOCK_REMINDER,
  buildSpecLock,
  buildSeamAlignment,
  describeCombo,
  describeLayout,
  describeAppliances,
  describeStyleReference,
};

// ═══════════════════════════════════════════════════════════════
// Dispatcher 인터페이스 — worker.js 의 ALT_BUILDERS / CLOSED_BUILDERS 가
// 모든 카테고리 모듈에서 동일한 모양의 함수를 호출한다.
// ═══════════════════════════════════════════════════════════════

export const FRIDGE_CATEGORIES = ['fridge', 'fridge_cabinet'];

// ─────────────────────────────────────────────────────────────────
// Claude Opus 4.7 pre-analysis (냉장고장 전용, Step 1.5)
// 다른 카테고리는 이 경로를 쓰지 않음. 바꾸려면 아래 한 줄만 수정.
// ─────────────────────────────────────────────────────────────────

export const FRIDGE_ANALYSIS_MODEL = 'claude-opus-4-7';

export function buildFridgeAnalysisPrompt() {
  return `이 방 사진을 한국 아파트 냉장고장 빌트인 설치 관점에서 분석하세요.
다음 JSON 스키마만 반환하고 다른 설명은 붙이지 마세요:

{
  "floor": { "material": "string — 예: 오크 원목 / 월넛 / 대리석 타일 / 포세린 타일", "tone": "warm | cool | neutral" },
  "ceiling": { "type": "flat | molding | soffit | beam_exposed", "lighting": "string — 예: 다운라이트 4개 일렬" },
  "side_walls": { "color": "string", "notable_features": ["string, 예: 창문·문·콘센트 위치"] },
  "target_wall_obstructions": [
    { "type": "pillar | beam | window | door | outlet | niche | existing_cabinet", "side": "left | center | right", "note": "string" }
  ],
  "existing_fridge_visible": { "present": true_or_false, "side": "left | center | right | null", "approx_width_mm": number_or_null },
  "existing_built_ins_on_target_wall": ["string — 예: 상단 행거, 하단 수납장"],
  "style_character": "string — 짧게 (예: 모던 미니멀, 따뜻한 스칸디)",
  "design_hints_for_fridge_cabinet": "string — 기존 공간과 조화로운 냉장고장 톤·비례 한줄 제안",
  "special_considerations": ["string — 설치 시 주의점. 없으면 빈 배열"]
}

JSON 외 텍스트 금지. 확신 없으면 null 사용.`;
}

/** preAnalysis 객체를 Gemini 프롬프트에 삽입할 사람이 읽기 좋은 포맷으로 변환. */
function formatPreAnalysis(pa) {
  if (!pa || typeof pa !== 'object') return '';
  const lines = ['[ROOM CONTEXT FROM CLAUDE PRE-ANALYSIS — honor these when designing the fridge cabinet]'];
  if (pa.floor) lines.push(`- Floor: ${pa.floor.material || '?'} (${pa.floor.tone || '?'} tone)`);
  if (pa.ceiling) lines.push(`- Ceiling: ${pa.ceiling.type || '?'}${pa.ceiling.lighting ? ' — ' + pa.ceiling.lighting : ''}`);
  if (pa.side_walls) {
    const feats = Array.isArray(pa.side_walls.notable_features) && pa.side_walls.notable_features.length
      ? ' — features: ' + pa.side_walls.notable_features.join(', ')
      : '';
    lines.push(`- Side walls: ${pa.side_walls.color || '?'}${feats}`);
  }
  if (Array.isArray(pa.target_wall_obstructions) && pa.target_wall_obstructions.length) {
    lines.push(`- Target wall obstructions: ${pa.target_wall_obstructions.map((o) => `${o.type}@${o.side}${o.note ? ' (' + o.note + ')' : ''}`).join('; ')}`);
  }
  if (pa.existing_fridge_visible?.present) {
    const f = pa.existing_fridge_visible;
    lines.push(`- Existing fridge visible: side=${f.side || '?'}${f.approx_width_mm ? `, ~${f.approx_width_mm}mm wide` : ''} — try to keep this side/width`);
  }
  if (Array.isArray(pa.existing_built_ins_on_target_wall) && pa.existing_built_ins_on_target_wall.length) {
    lines.push(`- Existing built-ins to replace: ${pa.existing_built_ins_on_target_wall.join(', ')}`);
  }
  if (pa.style_character) lines.push(`- Style character: ${pa.style_character}`);
  if (pa.design_hints_for_fridge_cabinet) lines.push(`- Design hint: ${pa.design_hints_for_fridge_cabinet}`);
  if (Array.isArray(pa.special_considerations) && pa.special_considerations.length) {
    lines.push(`- Special considerations: ${pa.special_considerations.join('; ')}`);
  }
  return lines.join('\n');
}

export function buildFridgeClosedPrompt({ wallData, themeData, styleName, fridgeOpts, siteAlreadyCleared, preAnalysis }) {
  const basePrompt = buildFridgePrompt({
    doorColor: themeData.style_door_color || 'white',
    doorFinish: themeData.style_door_finish || 'matte',
    wallData,
    styleName,
    fridgeOpts,
    siteAlreadyCleared: !!siteAlreadyCleared,
  });
  const contextBlock = preAnalysis ? `\n\n${formatPreAnalysis(preAnalysis)}` : '';
  return `${basePrompt}${contextBlock}`;
}

/**
 * Step 3 — 냉장고장 AI 추천 디자인 (홈바·홈카페).
 * 냉장고장은 다른 카테고리와 달리 `installBaseImage` (철거된 빈 벽) 을 입력으로 쓴다 — closedResult 가 아님.
 */
export function buildFridgeAltSpec({ wallData, themeData, styleName, fridgeOpts, siteAlreadyCleared, preAnalysis }) {
  const basePrompt = buildFridgeRecommendedPrompt({
    doorColor: themeData.style_door_color || 'white',
    doorFinish: themeData.style_door_finish || 'matte',
    wallData,
    styleName,
    fridgeOpts,
    siteAlreadyCleared: !!siteAlreadyCleared,
  });
  const contextBlock = preAnalysis ? `\n\n${formatPreAnalysis(preAnalysis)}` : '';
  return {
    inputKey: 'install', // worker.js 가 installBaseImage (철거 후 빈 벽) 을 입력으로 사용
    prompt: `${basePrompt}${contextBlock}`,
    metadata: { alt_style: { name: 'AI 추천 (홈바·홈카페)' } },
  };
}

/**
 * Fridge-only quote. 냉장고장은 벽 전체가 팬트리 + 브릿지 + 냉장고 영역으로 구성.
 * 하부 팬트리 180k/1000mm, 상부 브릿지 140k/1000mm (브릿지는 벽폭 100%),
 * 시공 200k, 철거 30k/1000mm. 냉장고 본체는 고객 지참 전제 (견적 제외).
 */
export function buildFridgeQuote(wallW) {
  const mm = Math.max(0, Number(wallW) || 0);
  const lowerPrice = 180000;
  const bridgePrice = 140000;
  const install = 200000, demolitionRate = 30000;
  const items = [
    { name: '팬트리 하부장', quantity: `${mm}mm`, unit_price: lowerPrice, total: Math.round(lowerPrice * mm / 1000) },
    { name: '상단 브릿지 캐비닛', quantity: `${mm}mm`, unit_price: bridgePrice, total: Math.round(bridgePrice * mm / 1000) },
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
