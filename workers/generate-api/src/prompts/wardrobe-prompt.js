/**
 * Wardrobe (붙박이장) prompt module — English only.
 *
 * Target category: 'wardrobe'
 *
 * Step 2 (closed doors):  Full-wall full-height built-in wardrobe installation.
 * Step 3 (open doors):    Same wardrobe with all doors swung open, showing interior.
 *
 * getWardrobeStructure(w) returns a 4 / 5 / 6 / 7 full-height-door layout based on
 * the target wall width. The same structure is reused by buildWardrobeQuote for
 * pricing.
 *
 * All prompt text sent to Gemini is English only. JSDoc comments kept in English
 * so the entire file matches.
 */

export const WARDROBE_CATEGORIES = ['wardrobe'];

/**
 * Section layout by wall width.
 * Every door is a FULL-HEIGHT single panel (floor to ceiling) — never split
 * horizontally. Shelves are minimized; hanging rods and internal drawers win.
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
 * Gemini 2.5 Flash Image tends to default to kitchen-style upper+lower splits
 * and to draw visible handles; both are explicitly banned here.
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

DOORS (NO HANDLES — push-to-open, completely flush):
- "${doorColor}" matte flat-panel, completely smooth and seamless.
- The front face of every door is a PERFECTLY FLAT uninterrupted rectangle.
- ABSOLUTELY NO handles of any kind. This includes ALL of the following, which must not appear anywhere:
  * no knobs, pulls, D-handles, bar handles, cup pulls, finger pulls
  * no chrome bars, metal bars, brass hardware, aluminum strips
  * no recessed grips, J-channel grips, finger grooves, edge cutouts
  * no indentations, no grooves, no slots, no notches on the door face or edges
  * no hinge lines visible from the front
- The opening mechanism is push-to-open (touch latch). No hardware is visible from the outside.

SECTION LAYOUT (this describes the interior for reference; in THIS image the doors are closed and the interior is NOT visible):
${getWardrobeStructure(wallData.wallW).prompt}

PRESERVE background EXACTLY: floor, ceiling, side walls, window, lighting, camera angle all pixel-identical to the input photo. Photorealistic. No text, no labels.`;
}

/**
 * Step 3 — open-door variant showing interior rods and drawers.
 * worker.js feeds closedResult.image back in as the base.
 * Counter-measures against Gemini sometimes returning the input unchanged.
 */
export function buildWardrobeAltSpec({ wallData, themeData }) {
  const s = getWardrobeStructure(wallData.wallW);
  const doorColor = (themeData && themeData.style_door_color) || 'same as input';
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door wardrobe image, generate the SAME wardrobe but with ALL DOORS VISIBLY OPEN at ~90 degrees, showing the interior.

CRITICAL — THE OUTPUT MUST LOOK DIFFERENT FROM THE INPUT:
- Every wardrobe door MUST be swung open ~90°. Do NOT return a closed-door image. Do NOT return the input unchanged.
- The interior MUST be clearly visible through the open doors.

INTERIOR (must be visible through the open doors):
${s.open}
Clothes on hangers on the rods, folded items in the internal drawers. Realistic wardrobe interior.

DOORS (still NO HANDLES on the open doors either):
- Door color and finish (on the OUTSIDE face of each open door) remains ${doorColor} matte flat-panel.
- The door faces are still completely flush — no handles, no knobs, no pulls, no recessed grips, no hinge lines visible from the front.

KEEP IDENTICAL to the input:
- Camera angle, lighting, background (walls, floor, ceiling, window, etc.), wardrobe position and width.
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
