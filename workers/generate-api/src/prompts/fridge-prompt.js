/**
 * 냉장고장 전용 프롬프트 빌더
 *
 * Cloudflare Worker 의 /api/generate 에서 category === 'fridge' | 'fridge_cabinet'
 * 일 때만 사용. 단순화된 2-stage 파이프라인(설치 → 홈바 대안)의 프롬프트를 만든다.
 * 이전 철거 스테이지는 제거되고 CLEAR_AND_INSTALL 블록으로 설치 프롬프트 안에 흡수됨.
 * 벽 분석(알코브 감지 포함)은 Worker 공통 Step 1 에서 Gemini TEXT 로 처리 — Claude Opus pre-analysis 는 제거됨.
 *
 * 공개 API:
 *   buildFridgeClosedPrompt({ wallData, themeData, styleName, fridgeOpts, preAnalysis })
 *     → 원본 룸 사진에서 기존 빌트인 제거 + 새 냉장고장 설치를 한 번에 수행하는 프롬프트
 *   buildFridgeAltSpec({ wallData, themeData, styleName, fridgeOpts, preAnalysis })
 *     → 홈바·홈카페 포함 AI 추천 디자인 프롬프트 (raw 룸 사진 기반)
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
 * 알코브 감지 시 install/recommended 프롬프트에 주입할 프레임 보존 블록.
 * preAnalysis.alcove_frame.present === true 이고 interior 폭 ≥ 600mm 일 때만 non-empty.
 * 반환: { block: string, interiorW: number | 0 }
 */
function buildAlcoveInstallFrame(preAnalysis) {
  const alc = preAnalysis && preAnalysis.alcove_frame;
  if (!alc || alc.present !== true) return { block: '', interiorW: 0 };
  const interior = alc.interior || {};
  const x0 = Number(interior.x_from_left_mm);
  const x1 = Number(interior.x_to_left_mm);
  if (!isFinite(x0) || !isFinite(x1) || x1 - x0 < 600) {
    return { block: '', interiorW: 0 };
  }
  const interiorW = x1 - x0;
  const lp = alc.left_panel || {};
  const rp = alc.right_panel || {};
  const tb = alc.top_bridge || {};
  const block = `ALCOVE INSTALL FRAME (HARD — the target wall is a 3-sided recessed alcove that MUST stay visible):
- Alcove LEFT vertical panel (x=${lp.x_from_left_mm ?? '?'}mm → x=${lp.x_to_left_mm ?? '?'}mm in original wall coords) remains pixel-identical to Image 1.
- Alcove RIGHT vertical panel (x=${rp.x_from_left_mm ?? '?'}mm → x=${rp.x_to_left_mm ?? '?'}mm) remains pixel-identical.
- Alcove TOP bridge/header (y=${tb.y_from_top_pct ?? '?'}% → y=${tb.y_to_top_pct ?? '?'}% from ceiling) remains pixel-identical.
- The new cabinetry (refrigerator + pantry + any internal bridge cabinet) must fit ENTIRELY INSIDE the alcove interior (width ≈ ${interiorW}mm).
- Left side of the cabinetry butts flush against the alcove's left inner face; right side butts flush against the right inner face; top butts flush against the alcove top bridge under-surface.
- DO NOT draw any new panel, frame, or trim OVER the alcove's outer frame (left vertical panel, right vertical panel, top header). The alcove frame must be visibly intact in the final image.
- DO NOT widen, narrow, repaint, or re-clad the alcove frame.`;
  return { block, interiorW };
}

// 한국 빌트인 표준 수직 치수 (mm)
const BASE_PLINTH_MM = 100;           // 바닥 토크익 (하부 걸레받이)
const FRIDGE_COLUMN_H_MM = 1850;      // 냉장고·팬트리 기둥 높이 (토크익 위부터 상단까지)

/**
 * 사용자가 선택한 냉장고 옵션을 Gemini 가 무시하지 못하도록 HARD REQUIREMENTS 블록으로 변환.
 * - 유닛별 가로 폭 (UNIT_WIDTH_MM) 으로 냉장고 그룹 총 폭을 계산
 * - position 을 절대 좌표 (mm offset) 로 표현 → "LEFT side" 같은 모호함 제거
 * - 멀티 유닛이면 좌→우 순서 명시
 * - 레퍼런스 이미지의 사양과 충돌하면 옵션이 우선임을 명시.
 * - alcoveInteriorW 가 주어지면 (>0) 그 값을 effective wall width 로 사용 (알코브 내부에 설치).
 * - wallH 로 상단 브릿지 높이를 역산해 수직 비율까지 잠근다.
 */
function buildSpecLock(opts, wallW, alcoveInteriorW, wallH = 2400) {
  const o = opts || {};
  const useAlcove = Number(alcoveInteriorW) > 600;
  const W = useAlcove ? Number(alcoveInteriorW) : (Number(wallW) || 3000);
  const H = Number(wallH) || 2400;
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

  const wallLabel = useAlcove
    ? `Effective install zone width (= alcove interior, the only place where new cabinetry may go): ${W}mm. All x-coordinates below are measured from the alcove interior's LEFT inner face (x=0mm) to its RIGHT inner face (x=${W}mm). Do NOT extend any cabinet beyond x=0mm or x=${W}mm — those edges are the alcove frame which must remain visible.`
    : `Target wall total width: ${W}mm. All x-coordinates below are measured from the wall's LEFT edge (x=0mm) to its RIGHT edge (x=${W}mm).`;

  // ─── [PROPORTIONS] 수평·수직 비율 잠금 ───
  const fridgePct = Math.round((totalFridgeMm / Math.max(1, W)) * 100);
  const pantryPct = Math.max(0, 100 - fridgePct);
  const fridgeTopFromFloor = BASE_PLINTH_MM + FRIDGE_COLUMN_H_MM; // 1950mm typical
  const bridgeHeightMm = Math.max(350, H - fridgeTopFromFloor);   // ceiling - fridge top
  const basePct = Math.round((BASE_PLINTH_MM / H) * 100);
  const colPct = Math.round((FRIDGE_COLUMN_H_MM / H) * 100);
  const bridgePct_v = Math.max(0, 100 - basePct - colPct);
  const proportionsBlock = [
    `[PROPORTIONS — horizontal, relative to install zone ${W}mm]`,
    `  • Refrigerator group: ${totalFridgeMm}mm (${fridgePct}% of ${W}mm)`,
    `  • Pantry columns:     ${pantryMm}mm (${pantryPct}% of ${W}mm)`,
    `  • Top bridge cabinet: spans 100% of install zone (${W}mm)`,
    `[PROPORTIONS — vertical, relative to wall height ${H}mm]`,
    `  • Base plinth / toe-kick: ${BASE_PLINTH_MM}mm off the floor (${basePct}%) — continuous under both fridge and pantry`,
    `  • Refrigerator + pantry column height: ${FRIDGE_COLUMN_H_MM}mm (${colPct}%) — fridge top and pantry top share the SAME horizontal plane at ${fridgeTopFromFloor}mm from floor`,
    `  • Top bridge cabinet height: ${bridgeHeightMm}mm (${bridgePct_v}%) — from the fridge/pantry top plane up to the ceiling`,
    `Any cabinet that exceeds these ratios by more than ±5% is WRONG. Do NOT stretch or shrink the fridge to fill empty space — the fridge width is FIXED at ${totalFridgeMm}mm per SPEC LOCK.`,
  ].join('\n');

  const lines = [
    `SPEC LOCK (HARD REQUIREMENTS — these specs OVERRIDE anything seen in the reference images):`,
    `- ${wallLabel}`,
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
  if (useAlcove) {
    lines.push(`- If the refrigerator group width exceeds the alcove interior width (${W}mm), reduce the unit count (e.g., drop a 1door) or choose narrower units — NEVER spill over the alcove frame.`);
  }
  lines.push(proportionsBlock);
  return lines.join('\n');
}

/**
 * 상단 브릿지 캐비닛이 아래 컬럼 경계와 동기화되도록 강제하는 블록.
 * SPEC LOCK 의 좌표 정보가 있어야 모델이 어디에 seam 을 둬야 할지 알 수 있음.
 */
function buildSeamAlignment(opts, wallW, alcoveInteriorW) {
  const o = opts || {};
  const useAlcove = Number(alcoveInteriorW) > 600;
  const W = useAlcove ? Number(alcoveInteriorW) : (Number(wallW) || 3000);
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

// Install-stage clear-and-fit block. Replaces the old Stage-1 demolition prompt:
// Gemini now handles "remove existing builtins + install new cabinet" in a single pass,
// so this language is injected into the installation prompt itself.
const CLEAR_AND_INSTALL = `CLEAR AND INSTALL (single-pass edit):
(a) Mentally remove any pre-existing built-ins on the target wall — old cabinet columns, shelving, partitions, upper hangers, embedded appliances, decorative trim, wall panels, and interior alcove dividers. They should NOT appear in the output.
(b) In the SAME pass, install the new refrigerator + pantry cabinet system per SPEC LOCK coordinates below.
DO NOT show demolition artifacts: no drill scars, no patched drywall, no partial-removal edges, no ghost outlines of removed furniture. The output must look like a clean, finished installation photograph.
If the target wall is an alcove bay, keep the alcove frame (left panel, right panel, top header) intact — only the alcove INTERIOR receives new cabinetry.`;

/**
 * 설치 프롬프트 — 단일 Gemini 호출로 "기존 구조 제거 + 새 냉장고장 설치" 를 한 번에 처리.
 * 이전 파이프라인의 Stage-1 (철거) 과 Stage-2 (설치) 를 통합했다.
 *
 * @param {object} p
 * @param {string} p.doorColor
 * @param {string} p.doorFinish
 * @param {object} p.wallData    { wallW, wallH }
 * @param {string} p.styleName
 * @param {object} p.fridgeOpts  클라이언트의 fridge_options (+ referenceCount)
 * @param {object} p.preAnalysis Gemini Step 1 에서 반환한 alcove_frame 등
 * @returns {string}
 */
export function buildFridgePrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts, preAnalysis }) {
  const opts = fridgeOpts || {};
  const wallW = (wallData && Number(wallData.wallW)) || 3000;
  const wallH = (wallData && Number(wallData.wallH)) || 2400;
  const { block: alcoveBlock, interiorW } = buildAlcoveInstallFrame(preAnalysis);
  const specLock = buildSpecLock(opts, wallW, interiorW, wallH);
  const seamLock = buildSeamAlignment(opts, wallW, interiorW);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const alcoveSection = alcoveBlock ? `\n\n${alcoveBlock}` : '';
  const bridgeSpan = interiorW > 0
    ? `Place a bridge cabinet across the top of the alcove interior (≈ ${interiorW}mm wide), divided per VERTICAL SEAM ALIGNMENT above. Do NOT extend the bridge over the alcove top header.`
    : `Place a bridge cabinet across the top spanning the full wall width, divided per VERTICAL SEAM ALIGNMENT above.`;

  return `${BACKGROUND_LOCK}${alcoveSection}

${CLEAR_AND_INSTALL}

${specLock}

${seamLock}

TASK: Edit Image 1 by installing the ${doorColor} ${doorFinish} refrigerator surround cabinet specified in SPEC LOCK above onto the target wall ONLY, following the exact x-coordinates, proportions, and seam alignment requirements above. Background of Image 1 stays pixel-identical per BACKGROUND LOCK above.
Target wall dimensions: ${wallW}×${wallH}mm. ${bridgeSpan}
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
export function buildFridgeRecommendedPrompt({ doorColor, doorFinish, wallData, styleName, fridgeOpts, preAnalysis }) {
  const opts = fridgeOpts || {};
  const wallW = (wallData && Number(wallData.wallW)) || 3000;
  const wallH = (wallData && Number(wallData.wallH)) || 2400;
  const { block: alcoveBlock, interiorW } = buildAlcoveInstallFrame(preAnalysis);
  const specLock = buildSpecLock(opts, wallW, interiorW, wallH);
  const seamLock = buildSeamAlignment(opts, wallW, interiorW);
  const styleRef = describeStyleReference(opts.referenceCount || 0);
  const alcoveSection = alcoveBlock ? `\n\n${alcoveBlock}` : '';
  const bridgeSpan = interiorW > 0
    ? `Bridge cabinet spans the top of the alcove interior (≈ ${interiorW}mm), divided per VERTICAL SEAM ALIGNMENT above (the home-bar internal seams are additional, but must NOT alter the refrigerator-vs-pantry seam, and must NOT extend over the alcove top header).`
    : `Bridge cabinet spans the top across the full wall width, divided per VERTICAL SEAM ALIGNMENT above (the home-bar internal seams are additional, but must NOT alter the refrigerator-vs-pantry seam).`;

  return `${BACKGROUND_LOCK}${alcoveSection}

${CLEAR_AND_INSTALL}

${specLock}

${seamLock}

TASK: Edit Image 1 by installing the ${doorColor} ${doorFinish} refrigerator surround cabinet specified in SPEC LOCK above (with the exact x-coordinates), AND adding an integrated home-bar / home-cafe zone on the SAME target wall, BLENDED INTO THE PANTRY HALF (do NOT shift the refrigerator group from its locked x-coordinates). Background of Image 1 stays pixel-identical per BACKGROUND LOCK above. The home-bar zone may ONLY occupy area on the target wall — it must NOT extend into the floor area, ceiling, side walls, or anywhere outside the target wall.
Target wall dimensions: ${wallW}×${wallH}mm. ${bridgeSpan}

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
  CLEAR_AND_INSTALL,
  BACKGROUND_LOCK,
  BACKGROUND_LOCK_REMINDER,
  BASE_PLINTH_MM,
  FRIDGE_COLUMN_H_MM,
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
// 벽 분석은 Worker 의 Step 1 (Gemini TEXT) 에서 공통으로 처리한다.
// 냉장고 알코브 스키마는 prompts/wall-analysis.js 의 fridge 분기 참고.
// 이전 버전의 Claude Opus pre-analysis (Step 1.5) 는 제거됨.
// ─────────────────────────────────────────────────────────────────

/** Gemini Step 1 이 돌려준 preAnalysis (alcove_frame, existing_builtins_on_target_wall) 를 short room-context 텍스트로. */
function formatPreAnalysis(pa) {
  if (!pa || typeof pa !== 'object') return '';
  const lines = [];
  const alc = pa.alcove_frame;
  if (alc && alc.present === true && alc.interior) {
    const iw = Number(alc.interior.x_to_left_mm) - Number(alc.interior.x_from_left_mm);
    if (isFinite(iw) && iw > 0) {
      lines.push(`- Wall has a recessed alcove bay; interior width ≈ ${iw}mm (x=${alc.interior.x_from_left_mm}→${alc.interior.x_to_left_mm}).`);
    } else {
      lines.push(`- Wall has a recessed alcove bay; keep the frame intact.`);
    }
  } else if (alc && alc.present === false) {
    lines.push(`- Target wall is flat (no alcove).`);
  }
  if (Array.isArray(pa.existing_builtins_on_target_wall) && pa.existing_builtins_on_target_wall.length) {
    lines.push(`- Existing items to remove in the same pass: ${pa.existing_builtins_on_target_wall.join(', ')}.`);
  }
  if (lines.length === 0) return '';
  return ['[ROOM CONTEXT — from wall analysis]', ...lines].join('\n');
}

export function buildFridgeClosedPrompt({ wallData, themeData, styleName, fridgeOpts, preAnalysis }) {
  const basePrompt = buildFridgePrompt({
    doorColor: themeData.style_door_color || 'white',
    doorFinish: themeData.style_door_finish || 'matte',
    wallData,
    styleName,
    fridgeOpts,
    preAnalysis,
  });
  const contextBlock = preAnalysis ? `\n\n${formatPreAnalysis(preAnalysis)}` : '';
  return `${basePrompt}${contextBlock}`;
}

/**
 * 냉장고장 AI 추천 디자인 (홈바·홈카페).
 * 철거 단계가 제거됐으므로 원본 룸 사진(raw)을 입력으로 사용 — clear-and-install 을 프롬프트 내에서 처리.
 */
export function buildFridgeAltSpec({ wallData, themeData, styleName, fridgeOpts, preAnalysis }) {
  const basePrompt = buildFridgeRecommendedPrompt({
    doorColor: themeData.style_door_color || 'white',
    doorFinish: themeData.style_door_finish || 'matte',
    wallData,
    styleName,
    fridgeOpts,
    preAnalysis,
  });
  const contextBlock = preAnalysis ? `\n\n${formatPreAnalysis(preAnalysis)}` : '';
  return {
    inputKey: 'raw', // 원본 room_image 를 입력으로 사용 (철거 스테이지 제거됨)
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
