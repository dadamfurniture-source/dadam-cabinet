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
 * (floor to ceiling). Shelves are minimized; rods handle hanging and a single
 * 2-tier stacked drawer pair (2 drawers total, nothing more) lives at the
 * bottom of the LAST section only.
 *
 * EVEN-ONLY tiers (4 / 4 / 6 / 8 doors):
 *   Gemini strongly prefers symmetric mirrored pairs, so asymmetric odd-count
 *   plans (old 5 / 7 tiers) were being silently rounded up to even in the
 *   rendered image, causing closed-vs-open count drift. Keeping every tier
 *   at an even count, with each section containing exactly 2 mirrored doors,
 *   matches Gemini's natural rendering and eliminates the drift source.
 */
export function getWardrobeStructure(w) {
  if (w > 3200) return {
    doorCount: 8,
    prompt: '4 sections (~' + Math.round(w / 4) + 'mm each): section A (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section B (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section C (2 full-height mirrored doors, long-clothes hanging with 1 rod inside) + section D (2 full-height mirrored doors, long-clothes hanging with 1 rod + ONE 2-tier stacked drawer pair — exactly 2 drawers, stacked, at the bottom of this section ONLY). Total 8 full-height doors arranged as 4 symmetric mirrored pairs. The wardrobe contains exactly 2 drawers total, both in section D.',
    open: 'Section A: 2 rods for short clothes, no drawers. Section B: 2 rods for short clothes, no drawers. Section C: 1 rod for long coats, no drawers. Section D: 1 rod for long coats + 2-tier stacked drawer pair at the bottom (exactly 2 drawers, stacked vertically, no more).',
  };
  if (w > 2600) return {
    doorCount: 6,
    prompt: '3 sections (~' + Math.round(w / 3) + 'mm each): section A (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section B (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section C (2 full-height mirrored doors, long-clothes hanging with 1 rod + ONE 2-tier stacked drawer pair — exactly 2 drawers, stacked, at the bottom of this section ONLY). Total 6 full-height doors arranged as 3 symmetric mirrored pairs. The wardrobe contains exactly 2 drawers total, both in section C.',
    open: 'Section A: 2 rods for short clothes, no drawers. Section B: 2 rods for short clothes, no drawers. Section C: 1 rod for long coats + 2-tier stacked drawer pair at the bottom (exactly 2 drawers, stacked vertically, no more).',
  };
  if (w > 2000) return {
    doorCount: 4,
    prompt: '2 sections (~' + Math.round(w / 2) + 'mm each): section A (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section B (2 full-height mirrored doors, long-clothes hanging with 1 rod + ONE 2-tier stacked drawer pair — exactly 2 drawers, stacked, at the bottom of this section ONLY). Total 4 full-height doors arranged as 2 symmetric mirrored pairs. The wardrobe contains exactly 2 drawers total, both in section B.',
    open: 'Section A: 2 rods for short clothes, no drawers. Section B: 1 rod for long coats + 2-tier stacked drawer pair at the bottom (exactly 2 drawers, stacked vertically, no more).',
  };
  return {
    doorCount: 4,
    prompt: '2 sections (~' + Math.round(w / 2) + 'mm each): section A (2 full-height mirrored doors, short-clothes hanging with 2 rods inside) + section B (2 full-height mirrored doors, long-clothes hanging with 1 rod + ONE 2-tier stacked drawer pair — exactly 2 drawers, stacked, at the bottom of this section ONLY). Total 4 full-height doors arranged as 2 symmetric mirrored pairs. The wardrobe contains exactly 2 drawers total, both in section B.',
    open: 'Section A: 2 rods for short clothes, no drawers. Section B: 1 rod for long coats + 2-tier stacked drawer pair at the bottom (exactly 2 drawers, stacked vertically, no more).',
  };
}

/**
 * Step 2 — full-wall closed-door wardrobe.
 * Handleless design — every door is a perfectly flat matte rectangle with
 * no visible hardware of any kind.
 */
export function buildWardrobeClosedPrompt({ wallData, themeData }) {
  const doorColor = themeData.style_door_color || 'white';
  const struct = getWardrobeStructure(wallData.wallW);
  const doorCount = struct.doorCount;
  const pairCount = doorCount / 2;
  return `Edit photo: install a FULL-HEIGHT built-in wardrobe covering the entire wall (~${wallData.wallW}mm wide, ~${wallData.wallH}mm tall, floor to ceiling).

EXACT DOOR COUNT (HARD REQUIREMENT — enforce BEFORE finalizing):
- The closed wardrobe MUST show EXACTLY ${doorCount} full-height doors across the entire wall — no more, no fewer.
- Arranged as ${pairCount} symmetric mirrored pair${pairCount > 1 ? 's' : ''} (each pair = two adjacent matching doors that meet at a center seam).
- Do NOT add an extra pair to fill visual space. Do NOT drop a pair. Do NOT insert a narrow standalone door between pairs. The count is ${doorCount}, full stop.
- Count the doors in your output before you return. If it is not exactly ${doorCount}, redo the layout until it matches.

STRUCTURE (HARD REQUIREMENT — this is a WARDROBE, NOT a kitchen, NOT sink cabinetry, NOT an upper+lower cabinet):
- Each door is ONE SINGLE PIECE running continuously from floor to ceiling. A single rectangular door face, nothing else.
- NEVER split any door horizontally into upper and lower sections.
- NO mid-height rail, NO crossbar, NO horizontal seam, NO counter, NO open shelf, NO visible transom panel breaking the door face.
- NO upper cabinet above shorter doors. NO base cabinet with short doors below longer top doors. NO hutch. NO kitchen-style upper/lower split.
- NO countertop, NO sink, NO faucet, NO appliances — this is a clothing wardrobe, not a kitchen.

NO EXTERNAL DRAWERS (ABSOLUTE — the closed wardrobe front shows ONLY full-height doors):
- Drawers live ONLY inside the wardrobe behind closed doors. The drawers are revealed only in the open-door view, never visible on the closed front.
- NO drawer fronts on the exterior. NO drawer bank visible below / above / between any door. NO row of drawer faces stacked at the floor line, at the top line, or anywhere in between.
- NO visible drawer pulls, drawer lips, drawer seams, or drawer reveal-gaps anywhere on the closed face.
- The bottom edge of every door runs directly to the floor (or the thin toe-kick); there is NO drawer band below the doors. The top edge of every door runs directly to the ceiling; there is NO drawer band above the doors.
- If you are tempted to draw a strip of short horizontal panels at the bottom — that is a drawer bank and is FORBIDDEN. The closed wardrobe front is ONLY full-height door faces edge to edge.

DOORS (HANDLELESS — perfectly flat matte rectangles, NO visible hardware anywhere):
- "${doorColor}" matte flat-panel, completely smooth and seamless across the entire face.
- The front face of every door is a perfectly flat uninterrupted rectangle with zero surface interruption — no raised profiles, no grooves, no recesses, no bars, no lips, no bumps.
- Absolutely NO handles of any kind: no knobs, no bar handles, no D-pulls, no cup pulls, no top-edge pulls, no edge pulls, no finger pulls, no chrome bars, no metal bars, no brass hardware.
- ABSOLUTELY NO FINGER GROOVES anywhere on any door. Repeat: NO finger grooves — no horizontal grooves cut into the top edge, NO vertical grooves along any side, NO angled chamfers or bevels on the door edges that could read as grip slots. No "J-channel", no routed slots, no notches, no cutouts, no shadow gaps, no inset strips along any edge of any door.
- No hinge lines, no visible hardware, no shadow lines, no trim. Each door face is one flat monolithic rectangle edge to edge, with its OWN top edge, bottom edge, and side edges all left as plain square corners — not carved, not routed, not grooved.
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

Analyze the wardrobe as it actually appears in this image (do NOT guess the planned layout — describe what you SEE). The wardrobe is designed to use symmetric mirrored pairs, so the total door count should be EVEN under normal conditions (4, 6, or 8 doors).

Classify each door into a SECTION of type "2D" (two-door mirrored pair sharing a section, opening outward from the center seam between them). If, unexpectedly, you observe an asymmetric layout with an odd total count, you may fall back to a "1D" (single door that forms its own section) for the unpaired door — but this is the EXCEPTION, not the default.

Section classification rule:
- Pair adjacent doors that read as matching twins (similar width + a center seam between them) into a 2D section of two doors. This is the default case.
- Under normal conditions every section is 2D. Do NOT invent a 1D section for aesthetic reasons.
- ONLY if the total door count is genuinely odd (rare, indicates a Gemini render deviation), classify the last unpaired door as 1D and include it in doors_left_to_right. Do NOT drop, merge, or forget that door.

Return ONLY the following JSON, no prose:

{
  "door_count": integer — number of distinct vertical doors you can count,
  "doors_left_to_right": [
    {
      "index": 1-based integer in left-to-right order,
      "relative_width": "narrow | medium | wide",
      "approx_x_start_pct": integer 0-100 (percent of wall width where this door's LEFT edge sits),
      "approx_x_end_pct":   integer 0-100 (percent of wall width where this door's RIGHT edge sits),
      "section_index": 1-based integer — which section this door belongs to (doors in the same 2D pair share the same section_index),
      "section_type": "2D" or "1D" — the type of the section this door belongs to,
      "face_is_flat_handleless": true_or_false (whether this door face appears perfectly flat with no visible handle or hardware),
      "notes": "anything noteworthy about this specific door's appearance (kept short)"
    }
  ],
  "sections": [
    {
      "section_index": 1-based integer in left-to-right order,
      "type": "2D" or "1D",
      "door_indexes": [list of door indexes belonging to this section — exactly 2 for 2D, exactly 1 for 1D],
      "approx_x_start_pct": integer 0-100 (LEFT edge of this section),
      "approx_x_end_pct":   integer 0-100 (RIGHT edge of this section)
    }
  ],
  "door_color_finish": "short description of the door color and finish you observe",
  "visible_vertical_seams_pct": [list of integers — x-coordinate percent of each vertical seam between doors; the seam INSIDE a 2D pair is the pair's center-open seam, the seams BETWEEN sections are section dividers],
  "horizontal_rails_or_seams": "describe any horizontal split / rail / shelf on the door faces, or 'none'",
  "overall_notes": "one short line of anything important for opening these doors naturally in a follow-up render"
}

Be accurate about the door count and section pairing. Examples:
- 4 doors seen → likely 2 sections of 2D each.
- 5 doors seen → 2 sections of 2D + 1 section of 1D (the last door alone).
- 6 doors seen → 3 sections of 2D each.
- 7 doors seen → 3 sections of 2D + 1 section of 1D (the last door alone).
Return valid JSON only.`;
}

/** Format the Opus structure analysis into a readable block for the Step 3 prompt. */
function formatStructureAnalysis(sa) {
  if (!sa || typeof sa !== 'object') return '';
  const lines = ['[ACTUAL DOOR LAYOUT FROM CLAUDE ANALYSIS OF THE CLOSED IMAGE — open exactly these doors]'];
  if (typeof sa.door_count === 'number') {
    lines.push(`- Door count observed: ${sa.door_count}`);
  }
  if (Array.isArray(sa.sections) && sa.sections.length) {
    const count2D = sa.sections.filter((s) => s.type === '2D').length;
    const count1D = sa.sections.filter((s) => s.type === '1D').length;
    lines.push(`- Sections: ${sa.sections.length} total — ${count2D} × 2D (paired), ${count1D} × 1D (single).`);
    const sectionDescs = sa.sections.map((sec) => {
      const range = (typeof sec.approx_x_start_pct === 'number' && typeof sec.approx_x_end_pct === 'number')
        ? `x=${sec.approx_x_start_pct}%–${sec.approx_x_end_pct}%`
        : '';
      const doors = Array.isArray(sec.door_indexes) ? `doors [${sec.door_indexes.join(', ')}]` : '';
      return `  Section ${sec.section_index} (${sec.type}, ${range}, ${doors})`;
    });
    lines.push(...sectionDescs);
  }
  if (Array.isArray(sa.doors_left_to_right) && sa.doors_left_to_right.length) {
    const doorDescs = sa.doors_left_to_right.map((d) => {
      const range = (typeof d.approx_x_start_pct === 'number' && typeof d.approx_x_end_pct === 'number')
        ? ` at x=${d.approx_x_start_pct}%–${d.approx_x_end_pct}%`
        : '';
      const sec = d.section_type ? ` [${d.section_type}${d.section_index ? ' §' + d.section_index : ''}]` : '';
      const width = d.relative_width ? ` (${d.relative_width})` : '';
      return `  ${d.index}${range}${sec}${width}${d.notes ? ' — ' + d.notes : ''}`;
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

  lines.push('');
  lines.push('OPENING RULES:');
  lines.push('- Every section is a 2D pair — both doors of each pair swing OUTWARD from the center seam between them (left door opens to the left side, right door opens to the right side), revealing the interior of that section.');
  lines.push('- The output MUST contain exactly the same number of open doors as the input has closed doors. Do NOT drop a pair. Do NOT merge a pair into a single door. Do NOT leave any door closed.');
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
  const opusCount = typeof structureAnalysis?.door_count === 'number' ? structureAnalysis.door_count : null;
  // Opus 가 세어준 실제 닫힘 도어 수가 우선 (Gemini 가 플랜에서 드리프트한 경우 대응).
  // 없으면 wallW 플랜 기반 짝수 기본값 (getWardrobeStructure.doorCount).
  const enforcedCount = opusCount !== null ? opusCount : s.doorCount;
  const analysisBlock = structureAnalysis ? `\n\n${formatStructureAnalysis(structureAnalysis)}` : '';
  // Opus 분석이 성공했을 때는 planned s.open 을 주입하지 않는다 (충돌 방지).
  // Opus 실패 시에만 플랜 텍스트로 fallback.
  const plannedInteriorBlock = structureAnalysis
    ? ''
    : `\n\nINTERIOR (planned layout — follow this when opening the doors):\n${s.open}`;
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe but with ALL DOORS VISIBLY OPEN at ~90 degrees, showing the interior.

CRITICAL — THE OUTPUT MUST LOOK DIFFERENT FROM THE INPUT:
- Exactly ${enforcedCount} doors must be swung open ~90°. Do NOT return a closed-door image. Do NOT return the input unchanged.
- The number of OPEN doors in your output MUST exactly match the number of doors in the input image (which is ${enforcedCount}). If the input shows ${enforcedCount} doors, the output shows ${enforcedCount} doors open — never fewer, never more.
- Every section is a mirrored 2-door pair; both doors of each pair swing OUTWARD from the center seam between them. Do NOT leave any pair half-open.
- The interior MUST be clearly visible through the open doors.${analysisBlock}${plannedInteriorBlock}

INTERIOR CONTENTS (must be visible through the open doors):
Clothes on hangers on the rods inside each section. The ONLY drawers are an exact 2-drawer stack (2-tier, vertically stacked) at the bottom of the LAST section — that is the entire drawer content of the wardrobe. All OTHER sections have rods only — do NOT render any additional drawers anywhere. The 2 drawers are INTERIOR drawers visible THROUGH the opened door of the last section, NOT exterior drawers mounted on the outside. No drawer fronts on any outside face of the wardrobe. Realistic wardrobe interior.

DOORS on the opened state (still HANDLELESS — NO finger grooves):
- The OUTSIDE face of each open door is still ${doorColor} matte flat-panel — a perfectly flat rectangle with ZERO visible hardware: no handles, no knobs, no edge pulls, no recessed grips, no chrome bars.
- ABSOLUTELY NO finger grooves on the newly visible door edges: no horizontal groove along the top edge, no vertical groove on any side, no routed slot, no chamfer, no notch. Door edges are plain square corners.
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
