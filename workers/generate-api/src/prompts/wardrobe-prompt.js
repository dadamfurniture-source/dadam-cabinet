/**
 * Wardrobe (붙박이장) prompt module — English only.
 *
 * Target category: 'wardrobe'
 *
 * Pipeline:
 *   Step 2    — Gemini: closed-door wardrobe covering entire wall.
 *   Step 2.5  — Claude Opus 4.7: analyze the generated closed-door image and
 *               return a JSON description of the doors it actually sees
 *               (count, left-to-right widths, visible seams, style cues).
 *   Step 3    — Gemini: open every door at ~90° using the Opus analysis so
 *               the output matches the exact door layout produced in Step 2.
 *
 * getWardrobeStructure(w) still supplies the planned 4 / 5 / 6 / 7-door layout
 * to Step 2 and to buildWardrobeQuote for pricing. The Opus analysis feeds Step 3
 * only — Step 2 keeps planning from scratch.
 *
 * Handle policy: handleless. Each door is a perfectly flat matte rectangle —
 * NO visible handle of any kind. The prompt describes the door face only and
 * stays silent on hardware so Gemini renders a clean unbroken surface.
 */

export const WARDROBE_CATEGORIES = ['wardrobe'];

/**
 * Claude Opus 4.7 runs AFTER Step 2 for wardrobe (the only category that does
 * this today). Other categories using PRE-analysis live in their own modules.
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
 * Step 2 — full-wall closed-door wardrobe.
 * Handleless design — every door is a perfectly flat matte rectangle with
 * no visible hardware of any kind.
 */
export function buildWardrobeClosedPrompt({ wallData, themeData }) {
  const doorColor = themeData.style_door_color || 'white';
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

PRESERVE background EXACTLY: floor, ceiling, side walls, window, lighting, camera angle all pixel-identical to the input photo. Photorealistic. No text, no labels.`;
}

/**
 * Step 2.5 — Claude Opus 4.7 reads the closed-door image generated in Step 2
 * and returns a JSON description of the actual door layout it sees. This is
 * then handed to Step 3 so the open-door image opens the same number and
 * positions of doors Gemini actually rendered.
 */
export function buildWardrobeStructureAnalysisPrompt() {
  return `You are looking at a photo of a newly generated built-in wardrobe covering one entire wall, all doors closed. The design is HANDLELESS — the door faces should be perfectly flat matte rectangles with no visible handles, pulls, or hardware.

Analyze the wardrobe as it actually appears in this image (do NOT guess the planned layout — describe what you SEE) and return ONLY the following JSON, no prose:

{
  "door_count": integer — number of distinct vertical doors you can count,
  "doors_left_to_right": [
    {
      "index": 1-based integer in left-to-right order,
      "relative_width": "narrow | medium | wide",
      "approx_x_start_pct": integer 0-100 (percent of wall width where this door's LEFT edge sits),
      "approx_x_end_pct":   integer 0-100 (percent of wall width where this door's RIGHT edge sits),
      "face_is_flat_handleless": true_or_false (whether this door face appears perfectly flat with no visible handle or hardware),
      "notes": "anything noteworthy about this specific door's appearance (kept short)"
    }
  ],
  "door_color_finish": "short description of the door color and finish you observe",
  "visible_vertical_seams_pct": [list of integers — x-coordinate percent of each vertical seam between doors],
  "horizontal_rails_or_seams": "describe any horizontal split / rail / shelf on the door faces, or 'none'",
  "overall_notes": "one short line of anything important for opening these doors naturally in a follow-up render"
}

Be accurate about the door count and their order. If you see 5 doors, say 5. Return valid JSON only.`;
}

/** Format the Opus structure analysis into a readable block for the Step 3 prompt. */
function formatStructureAnalysis(sa) {
  if (!sa || typeof sa !== 'object') return '';
  const lines = ['[ACTUAL DOOR LAYOUT FROM CLAUDE ANALYSIS OF THE CLOSED IMAGE — open exactly these doors]'];
  if (typeof sa.door_count === 'number') {
    lines.push(`- Door count observed: ${sa.door_count}`);
  }
  if (Array.isArray(sa.doors_left_to_right) && sa.doors_left_to_right.length) {
    const doorDescs = sa.doors_left_to_right.map((d) => {
      const range = (typeof d.approx_x_start_pct === 'number' && typeof d.approx_x_end_pct === 'number')
        ? ` at x=${d.approx_x_start_pct}%–${d.approx_x_end_pct}%`
        : '';
      const width = d.relative_width ? ` (${d.relative_width})` : '';
      return `  ${d.index}${range}${width}${d.notes ? ' — ' + d.notes : ''}`;
    });
    lines.push('- Doors in left-to-right order:');
    lines.push(...doorDescs);
  }
  if (sa.door_color_finish) lines.push(`- Door color/finish observed: ${sa.door_color_finish}`);
  if (Array.isArray(sa.visible_vertical_seams_pct) && sa.visible_vertical_seams_pct.length) {
    lines.push(`- Vertical seam positions (%): ${sa.visible_vertical_seams_pct.join(', ')}`);
  }
  if (sa.horizontal_rails_or_seams && sa.horizontal_rails_or_seams !== 'none') {
    lines.push(`- Horizontal features: ${sa.horizontal_rails_or_seams}`);
  }
  if (sa.overall_notes) lines.push(`- Notes: ${sa.overall_notes}`);
  return lines.join('\n');
}

/**
 * Step 3 — open every door shown in the Opus analysis at ~90°.
 * worker.js feeds the closed-door image back in as the base and the Opus
 * structure JSON as ctx.structureAnalysis.
 */
export function buildWardrobeAltSpec({ wallData, themeData, structureAnalysis }) {
  const s = getWardrobeStructure(wallData.wallW);
  const doorColor = (themeData && themeData.style_door_color) || 'same as input';
  const analysisBlock = structureAnalysis ? `\n\n${formatStructureAnalysis(structureAnalysis)}` : '';
  const expectedCount = structureAnalysis?.door_count ? structureAnalysis.door_count : 'every';
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe but with ALL DOORS VISIBLY OPEN at ~90 degrees, showing the interior.

CRITICAL — THE OUTPUT MUST LOOK DIFFERENT FROM THE INPUT:
- ${typeof expectedCount === 'number' ? `Exactly ${expectedCount} doors` : 'Every door'} must be swung open ~90°. Do NOT return a closed-door image. Do NOT return the input unchanged.
- The interior MUST be clearly visible through the open doors.${analysisBlock}

INTERIOR (must be visible through the open doors):
${s.open}
Clothes on hangers on the rods, folded items in the internal drawers. Realistic wardrobe interior.

DOORS on the opened state (still HANDLELESS):
- The OUTSIDE face of each open door is still ${doorColor} matte flat-panel — a perfectly flat rectangle with ZERO visible hardware: no handles, no knobs, no edge pulls, no recessed grips, no finger grooves, no chrome bars. Do NOT add hardware to the now-visible door faces.
- Each door swings from its own hinge side, revealing the interior of its own section.

KEEP IDENTICAL to the input:
- Camera angle, lighting, background (walls, floor, ceiling, window, etc.), wardrobe position and overall width.
- Side panels, top crown, toe-kick.

Photorealistic. No text, no labels.`,
    metadata: {
      alt_style: { name: 'Interior View (Doors Open)' },
      wardrobe_structure_analysis: structureAnalysis || null,
    },
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

export const __internals = { formatStructureAnalysis };
