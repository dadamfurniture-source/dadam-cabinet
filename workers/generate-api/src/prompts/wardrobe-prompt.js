/**
 * Wardrobe (붙박이장) prompt module — English only.
 *
 * Target category: 'wardrobe'
 *
 * Pipeline:
 *   Step 1     — Gemini: wall-size analysis of the room photo.
 *   Step 1.5   — Claude Opus 4.7: analyze the ROOM PHOTO and return a JSON
 *                sketch of floor/ceiling/side-wall character, target-wall
 *                obstructions, existing built-ins, style hints, door-count
 *                suggestion. Passed to Step 2 as ctx.preAnalysis.
 *   Step 2     — Gemini: full-wall closed-door wardrobe with the pre-analysis
 *                block injected. Uses getWardrobeStructure(w) for section
 *                layout defaults, but the pre-analysis can override details.
 *   Step 3     — Gemini: open every door of the Step 2 render, revealing the
 *                interior. No additional post-analysis (that Step 2.5
 *                2D/1D classifier was removed in favor of this PRE pattern).
 *
 * Handle policy: handleless. Every door is a perfectly flat matte rectangle
 * with no visible hardware anywhere. The prompt enumerates forbidden pulls
 * / grips / hinges so Gemini renders a clean unbroken surface.
 */

export const WARDROBE_CATEGORIES = ['wardrobe'];

/**
 * Claude Opus 4.7 runs BEFORE Step 2 for wardrobe (matches the fridge
 * pre-analysis pattern). Change this one line to swap models.
 */
export const WARDROBE_ANALYSIS_MODEL = 'claude-opus-4-7';

/**
 * Section layout by wall width. Each door is a single full-height panel
 * (floor to ceiling). Shelves are minimized; rods and internal drawers win.
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
 * Step 1.5 — Opus 4.7 reads the original room photo and returns a JSON
 * description of the room that Gemini will use to place the wardrobe.
 */
export function buildWardrobeAnalysisPrompt() {
  return `You are looking at an uploaded photo of a room where a full-wall built-in wardrobe will be installed.

Analyze the room as shown and return ONLY the following JSON, no prose. Be accurate about what you see — do not invent features that are not visible.

{
  "target_wall": {
    "approx_width_mm": integer or null — your best guess of the target (back) wall width where the wardrobe will cover edge-to-edge,
    "approx_height_mm": integer or null — floor-to-ceiling height at the target wall,
    "has_window": true_or_false,
    "has_door": true_or_false,
    "obstructions": [{ "type": "window | door | beam | column | outlet | switch | niche | radiator | other", "side": "left | center | right", "note": "short description" }]
  },
  "floor": { "material": "string — e.g. medium oak wood / walnut herringbone / gray porcelain tile", "tone": "warm | cool | neutral" },
  "ceiling": { "type": "flat | molding | soffit | beam_exposed", "lighting": "short note on visible ceiling lights" },
  "side_walls": { "color": "string", "character": "short note — e.g. plain white paint, patterned wallpaper" },
  "existing_built_ins_on_target_wall": ["short list of existing items to demolish before installing the wardrobe, or empty array"],
  "style_character": "one short line on the room style (modern minimal / warm scandi / classic / etc.)",
  "door_count_suggestion": {
    "count": integer or null — recommended door count based on target wall width (use the wardrobe's 4/5/6/7 door tiers: ≤2000→4, ≤2600→5, ≤3200→6, >3200→7),
    "reason": "short justification based on the measured wall width"
  },
  "design_hints_for_wardrobe": "one short line on door-face color/tone that harmonizes with the existing floor + side walls",
  "special_considerations": ["list of installation notes — e.g. 'beam at center reduces usable height over section C', or empty array"]
}

JSON only. Use null where uncertain.`;
}

/** Format Opus pre-analysis into a readable block injected ahead of Step 2. */
function formatPreAnalysis(pa) {
  if (!pa || typeof pa !== 'object') return '';
  const lines = ['[ROOM CONTEXT FROM CLAUDE PRE-ANALYSIS — honor these when placing the wardrobe]'];
  if (pa.target_wall) {
    const tw = pa.target_wall;
    const dims = [tw.approx_width_mm ? `${tw.approx_width_mm}mm wide` : null, tw.approx_height_mm ? `${tw.approx_height_mm}mm tall` : null].filter(Boolean).join(', ');
    if (dims) lines.push(`- Target wall: ${dims}`);
    if (tw.has_window) lines.push(`- Target wall HAS a window — keep it uncovered, size the wardrobe around it`);
    if (tw.has_door) lines.push(`- Target wall HAS a door — keep it clear, route the wardrobe around it`);
    if (Array.isArray(tw.obstructions) && tw.obstructions.length) {
      lines.push(`- Obstructions: ${tw.obstructions.map((o) => `${o.type}@${o.side}${o.note ? ' (' + o.note + ')' : ''}`).join('; ')}`);
    }
  }
  if (pa.floor) lines.push(`- Floor: ${pa.floor.material || '?'} (${pa.floor.tone || '?'} tone)`);
  if (pa.ceiling) lines.push(`- Ceiling: ${pa.ceiling.type || '?'}${pa.ceiling.lighting ? ' — ' + pa.ceiling.lighting : ''}`);
  if (pa.side_walls) lines.push(`- Side walls: ${pa.side_walls.color || '?'}${pa.side_walls.character ? ' — ' + pa.side_walls.character : ''}`);
  if (Array.isArray(pa.existing_built_ins_on_target_wall) && pa.existing_built_ins_on_target_wall.length) {
    lines.push(`- Existing built-ins to demolish: ${pa.existing_built_ins_on_target_wall.join(', ')}`);
  }
  if (pa.style_character) lines.push(`- Room style: ${pa.style_character}`);
  if (pa.door_count_suggestion?.count) {
    lines.push(`- Suggested door count: ${pa.door_count_suggestion.count}${pa.door_count_suggestion.reason ? ' (' + pa.door_count_suggestion.reason + ')' : ''}`);
  }
  if (pa.design_hints_for_wardrobe) lines.push(`- Design hint: ${pa.design_hints_for_wardrobe}`);
  if (Array.isArray(pa.special_considerations) && pa.special_considerations.length) {
    lines.push(`- Special considerations: ${pa.special_considerations.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Step 2 — full-wall closed-door wardrobe.
 * Handleless design — every door is a perfectly flat matte rectangle with
 * no visible hardware of any kind.
 */
export function buildWardrobeClosedPrompt({ wallData, themeData, preAnalysis }) {
  const doorColor = themeData.style_door_color || 'white';
  const preBlock = preAnalysis ? `\n\n${formatPreAnalysis(preAnalysis)}` : '';
  return `Edit photo: install a FULL-HEIGHT built-in wardrobe covering the entire wall (~${wallData.wallW}mm wide, ~${wallData.wallH}mm tall, floor to ceiling).

STRUCTURE (HARD REQUIREMENT — this is a WARDROBE, NOT a kitchen, NOT sink cabinetry, NOT an upper+lower cabinet):
- Each door is ONE SINGLE PIECE running continuously from floor to ceiling. A single rectangular door face, nothing else.
- NEVER split any door horizontally into upper and lower sections.
- NO mid-height rail, NO crossbar, NO horizontal seam, NO counter, NO open shelf, NO visible transom panel breaking the door face.
- NO upper cabinet above shorter doors. NO base cabinet with short doors below longer top doors. NO hutch. NO kitchen-style upper/lower split.
- NO countertop, NO sink, NO faucet, NO appliances — this is a clothing wardrobe, not a kitchen.

DOORS (HANDLELESS — perfectly flat matte rectangles, NO visible hardware anywhere):
- "${doorColor}" matte flat-panel, completely smooth and seamless across the entire face.
- The front face of every door is a perfectly flat uninterrupted rectangle with zero surface interruption — no raised profiles, no grooves, no recesses, no bars, no lips, no bumps.
- Absolutely NO handles of any kind: no knobs, no bar handles, no D-pulls, no cup pulls, no top-edge pulls, no edge pulls, no finger pulls, no chrome bars, no metal bars, no brass hardware.
- Absolutely NO handle substitutes cut into the door: no recessed grips, no J-channel grips, no finger grooves, no routed slots, no notches, no cutouts along any edge.
- No hinge lines, no visible hardware, no shadow lines, no trim. Each door face is one flat monolithic rectangle edge to edge.
- All doors closed in this image. No gaps between adjacent doors.

SECTION LAYOUT (this describes the interior for reference; in THIS image the doors are closed and the interior is NOT visible):
${getWardrobeStructure(wallData.wallW).prompt}

PRESERVE background EXACTLY: floor, ceiling, side walls, window, lighting, camera angle all pixel-identical to the input photo. Photorealistic. No text, no labels.${preBlock}`;
}

/**
 * Step 3 — open-door variant.
 * worker.js feeds closedResult.image back in as the base. No Opus
 * post-analysis anymore — the opening rules come from the preAnalysis-
 * aware Step 2 plan plus getWardrobeStructure.
 */
export function buildWardrobeAltSpec({ wallData, themeData }) {
  const s = getWardrobeStructure(wallData.wallW);
  const doorColor = (themeData && themeData.style_door_color) || 'same as input';
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe but with ALL DOORS VISIBLY OPEN at ~90 degrees, showing the interior.

CRITICAL — THE OUTPUT MUST LOOK DIFFERENT FROM THE INPUT:
- Every wardrobe door must be swung open ~90°. Do NOT return a closed-door image. Do NOT return the input unchanged.
- The interior MUST be clearly visible through the open doors.

INTERIOR (must be visible through the open doors):
${s.open}
Clothes on hangers on the rods, folded items in the internal drawers. Realistic wardrobe interior.

DOORS on the opened state (still HANDLELESS):
- The OUTSIDE face of each open door is still ${doorColor} matte flat-panel — a perfectly flat rectangle with ZERO visible hardware: no handles, no knobs, no edge pulls, no recessed grips, no finger grooves, no chrome bars. Do NOT add hardware to the now-visible door faces.
- Each door swings from its own hinge side, revealing the interior of its own section. Paired doors (adjacent full-height twins) swing outward from the center seam between them; standalone doors swing from their single hinge.

KEEP IDENTICAL to the input:
- Camera angle, lighting, background (walls, floor, ceiling, window, etc.), wardrobe position and overall width.
- Side panels, top crown, toe-kick.

Photorealistic. No text, no labels.`,
    metadata: { alt_style: { name: 'Interior View (Doors Open)' } },
  };
}

/**
 * Wardrobe-only quote (140,000 KRW per 300mm of wall width).
 * worker.js attaches this to the response as `quote`.
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

export const __internals = { formatPreAnalysis };
