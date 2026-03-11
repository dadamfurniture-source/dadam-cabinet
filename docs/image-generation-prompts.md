# Image Generation Prompts (v10 Pipeline)

> Source: `mcp-server/scripts/v10-nodes/build-all-prompts.js`
> Updated: 2026-03-11
> Pipeline: Cleanup → Furniture → Correction(inline) → Open

---

## Pipeline Flow

```
[Photo] → Wall Analysis (Claude) → Parse Wall Data
                                       ↓
                                 Build All Prompts
                                 ├─ cleanupPrompt     → Gemini Cleanup
                                 ├─ compressedPrompt  → Gemini Furniture (actual use, <300 chars)
                                 ├─ furniturePrompt   → Correction reference / local testing
                                 └─ openPrompt        → Gemini Open (edit closed → open)
```

---

## 1. Cleanup Prompt

```
Edit this image: Remove everything from the floor and surfaces.
Delete all construction debris, tools, materials, plastic sheets, dust, and trash.
The floor must be perfectly clean polished tile or concrete.
Keep the exact same room — same walls, tiles, ceiling, lights, camera angle.
Output: a photorealistic photo of this same empty room, spotlessly clean, ready for furniture.
```

---

## 2. Furniture Prompts

### Shared Sections (extracted as variables)

```
PRESERVE_BG:
  This photo shows a room ready for furniture installation.
  PRESERVE the background EXACTLY — do NOT modify walls, floor, ceiling, or lighting.

QUALITY_RULES:
  - Photorealistic quality with realistic shadows and reflections
  - Proper material textures (wood grain, stone pattern, stainless steel)
  - Realistic edge profiles and panel gaps (2-3mm between doors)
  - Natural lighting consistent with the background

BASE_PROHIBITED:
  - Do NOT modify the background, walls, or floor
  - No text, labels, dimensions, or markings
  - No floating or detached furniture elements

DUCT_RULES (kitchen only):
  The range hood MUST be fully concealed inside the upper cabinet.
  REMOVE all exposed duct pipes, silver aluminum tubes, ventilation pipes.
  Wall behind cabinets must show clean tiles — NO pipe or duct visible.
```

### 2-1. Kitchen — Blueprint Mode

```
[TASK: BLUEPRINT-GUIDED PHOTOREALISTIC FURNITURE RENDERING]

{PRESERVE_BG}
Place furniture according to the PRECISE CABINET LAYOUT below.

[PRECISE CABINET LAYOUT — MUST FOLLOW EXACTLY]
Wall: {wallW}mm wide × {wallH}mm tall

[UPPER CABINETS] top {uTop}%~{uBot}% of wall height, left to right:
  1. x: {xS}~{xE}%, {wMm}mm wide, {dc}-door cabinet
  ...
  (total upper: {N} modules, flush with ceiling)

[LOWER CABINETS] bottom {lTop}%~{lBot}% of wall height, left to right:
  1. x: {xS}~{xE}%, {wMm}mm wide, {dc}-door [SINK at center]
  ...

[UTILITY ANCHOR POINTS — FIXED POSITIONS]
★ Water supply at {waterPercent}% → Sink MUST be placed at this position
★ Exhaust duct at {exhaustPercent}% → Cooktop + Range hood MUST be placed at this position

★★★ RENDERING RULES (MANDATORY) ★★★
1. PRESERVE the background EXACTLY
2. Place furniture ONLY where the layout specifies
3. Match EXACT proportions and positions from the layout
4. Each module width ratio must match precisely
5. Upper cabinets flush with ceiling
6. Door/drawer count must match the layout
7. Sink and cooktop positions must match exactly

★★★ PHOTOREALISTIC QUALITY ★★★
{QUALITY_RULES}
- Subtle shadow under upper cabinets onto backsplash
- Realistic toe kick shadow on floor

★★★ CONCEALED RANGE HOOD ★★★
{DUCT_RULES}

[MATERIALS]
{materialText}
[STYLE: {styleLabel}]

[PROHIBITED]
{BASE_PROHIBITED}
- Do NOT change positions or proportions from the layout
- NO exposed duct pipe, silver tube, or ventilation pipe
- Sink cabinet door MUST be completely closed
```

### 2-2. Kitchen — Fallback (No Blueprint)

```
[TASK: FURNITURE PLACEMENT — AI-ANALYZED UTILITY POSITIONS]

★★★ CRITICAL: DO NOT MODIFY THE BACKGROUND ★★★
This photo shows a room. Do NOT alter walls, floor, ceiling, or lighting.
ONLY add kitchen furniture and appliances.

Wall dimensions: {wallW}mm × {wallH}mm

[WATER SUPPLY → SINK POSITION]
  {waterMm}mm ({waterPercent}%) from left
  → Sink bowl center MUST be placed at {waterPercent}% position

[EXHAUST DUCT → COOKTOP POSITION]
  {exhaustMm}mm ({exhaustPercent}%) from left
  → Cooktop + Range hood center MUST be placed at {exhaustPercent}% position

★★★ CONCEALED RANGE HOOD ★★★
{DUCT_RULES}

[REQUIRED COMPONENTS]
✓ Sink Bowl — stainless steel, at {waterPercent}% position
✓ Faucet — behind sink bowl
✓ Cooktop — at {exhaustPercent}% position
✓ Range Hood — BUILT-IN CONCEALED inside upper cabinet
✓ Lower Cabinets — height 870mm from floor
✓ Upper Cabinets — FLUSH with ceiling (NO gap)
✓ Toe Kick — below lower cabinets

[MATERIALS] / [STYLE] / [PROHIBITED] — same structure as Blueprint mode
```

### 2-3. Non-Kitchen Categories (data-driven)

All non-kitchen categories use the same template with category-specific config:

```
[TASK: PHOTOREALISTIC {TASK_NAME} RENDERING]

{PRESERVE_BG}

[{TASK_NAME} LAYOUT]
Wall: {wallW}mm wide × {wallH}mm tall
{category-specific layout details}

[MATERIALS] / [STYLE]

★★★ RENDERING RULES ★★★
{category-specific rules}

[PROHIBITED]
{BASE_PROHIBITED}
{category-specific prohibitions}
```

| Category | Task Name | Key Layout Details | Extra Prohibitions |
|----------|-----------|-------------------|-------------------|
| wardrobe | BUILT-IN WARDROBE | Full-width, floor-to-ceiling, hinged/sliding doors, hanging rod + shelf + drawer | No glass-front doors unless specified |
| shoe_cabinet | SHOE CABINET | Slim 300-400mm depth, tilted shelves 15-20°, clean minimal fronts | Depth must not exceed 400mm appearance |
| fridge_cabinet | REFRIGERATOR CABINET | Center opening ~700×1800mm, side storage, bridge cabinet above | Do NOT render a refrigerator |
| vanity | BATHROOM VANITY | Vanity with sink at {waterPercent}%, mirror cabinet above, faucet | — |
| storage | STORAGE CABINET | Full wall, floor-to-ceiling, adjustable shelves | — |

---

## 3. Compressed Prompts (n8n Cloud + Gemini)

> **Must stay under 300 characters.** Actually used for Furniture generation.

| Category | Template |
|----------|----------|
| Kitchen (blueprint) | `Place {doorDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY. {wallW}x{wallH}mm wall. Sink at {waterPercent}%, cooktop at {exhaustPercent}%. {N} upper flush ceiling. {N} lower ({lCompact}). {ctDesc}. {handleType}. {styleLabel}. Photorealistic. Concealed hood.` |
| Kitchen (fallback) | `Place {doorDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY. {wallW}x{wallH}mm wall. Sink at {waterPercent}%, cooktop at {exhaustPercent}%. {ctDesc}. {handleType}. {styleLabel}. Photorealistic. Concealed hood.` |
| Wardrobe | `Place {doorDesc} built-in wardrobe on this photo. PRESERVE background EXACTLY. Wall: {wallW}x{wallH}mm. Full-width floor-to-ceiling wardrobe with hinged doors. {handleType}. {styleLabel}. Photorealistic. All doors closed.` |
| Shoe Cabinet | `Place {doorDesc} shoe cabinet on this photo. PRESERVE background EXACTLY. Wall: {wallW}x{wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling. {handleType}. {styleLabel}. Photorealistic. All doors closed.` |
| Vanity | `Place {doorDesc} bathroom vanity on this photo. PRESERVE background EXACTLY. Wall: {wallW}x{wallH}mm. Vanity with sink at {waterPercent}% from left. Mirror cabinet above. {ctDesc} countertop. {styleLabel}. Photorealistic. Faucet chrome finish.` |
| Fridge Cabinet | `Place {doorDesc} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY. Wall: {wallW}x{wallH}mm. Center opening for fridge, tall storage on sides, bridge above. {handleType}. {styleLabel}. Photorealistic. All doors closed.` |
| Storage | `Place {doorDesc} storage cabinet on this photo. PRESERVE background EXACTLY. Wall: {wallW}x{wallH}mm. Floor-to-ceiling built-in with multiple door sections. {handleType}. {styleLabel}. Photorealistic. All doors closed.` |

---

## 4. Open Door Prompt

```
[IMAGE EDITING — NOT REGENERATION]
Do NOT regenerate this image. EDIT the existing image to show doors in OPEN state only.
★ Furniture appearance (size, color, material, position) — keep 100% identical
★ Background (walls, floor, ceiling, lighting) — keep 100% identical
★ Camera angle, perspective, viewpoint — keep 100% identical

[DO NOT CHANGE] ★★★
- Door count: maintain EXACT number of doors from the closed image
- Door position/size/ratio: keep identical
- Door color/material: do NOT change
- Overall furniture size and shape: do NOT change
- Sink bowl, faucet, cooktop, hood positions: DO NOT change (sink only)

[CRITICAL — DOOR STRUCTURE RULES]
- NEVER add or remove doors
- NEVER merge or split doors
- Follow the exact door division lines from the closed state
- Each door must open independently

[CHANGE ONLY — DOOR STATE]
Swing doors: rotate 90° outward on hinges from current position
Drawers: pull forward 30-40% from current position
Do NOT open swing doors like drawers or drawers like swing doors.

[INTERIOR CONTENTS — {category}]
{category-specific contents — see table below}

[CATEGORY RESTRICTIONS]
{category-specific forbidden items}

[ABSOLUTELY FORBIDDEN]
❌ No dimension labels, text, or numbers
❌ No background or room element changes
❌ No camera angle changes
❌ No door type changes (swing↔drawer)
❌ No adding/removing/merging/splitting doors

[OUTPUT]
- Door structure 100% matching the closed image
- Photorealistic interior photo quality
- Neatly organized storage contents (not messy)
```

### Interior Contents by Category

| Category | Contents | Forbidden |
|----------|----------|-----------|
| wardrobe | Shirts, blouses, jackets, coats on rods; folded sweaters; jeans; underwear/socks organizers; bags, hats, scarves | NO dishes or kitchen items |
| sink | Plates, bowls, cups, pots, spices, cutting boards. Under sink: drain pipe, water supply, angle valves. Under sink FORBIDDEN: trash, detergent, clutter | NO clothing |
| fridge | Coffee machine, microwave, toaster, groceries, cups, snacks | NO clothing |
| vanity | Cosmetics, makeup brushes, perfume, hair dryer, towels | NO clothing or kitchen items |
| shoe | Sneakers, dress shoes, sandals, boots, shoe care supplies | NO clothing or dishes |
| storage | Books, storage boxes, bedding, luggage, seasonal items | NO food items |

---

## 5. Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `{wallW}` | Wall width (mm) | 3000 |
| `{wallH}` | Wall height (mm) | 2400 |
| `{waterPercent}` | Water supply position (%) | 30 |
| `{exhaustPercent}` | Exhaust duct position (%) | 70 |
| `{styleLabel}` | Design style | Modern Minimal |
| `{doorDesc}` | Door color + finish | white matte |
| `{materialText}` | Full material description | (auto-generated) |

### Color Map (Korean → English)

| Korean | English | | Korean | English |
|--------|---------|---|--------|---------|
| 화이트 | pure white | | 마블화이트 | white marble |
| 그레이 | gray | | 그레이마블 | gray marble |
| 블랙 | matte black | | 차콜 | charcoal |
| 오크 | natural oak wood | | 베이지 | beige |
| 월넛 | dark walnut wood | | 네이비 | navy blue |
| 스노우 | snow white | | | |

### Finish Map

| Korean | English |
|--------|---------|
| 무광 | matte |
| 유광 | glossy |
| 엠보 | embossed |
