// ═══ Build All Prompts v10 — Cleanup + Furniture + Open ═══
// Ported from v9 Parse BG Result + Build Fixed Prompts
// Builds all prompts and geminiCleanupBody for the 4-stage pipeline
const input = $('Parse Wall Data').first().json;
const category = (input.category || 'sink').toLowerCase();
const styleLabel = input.style || 'Modern Minimal';
const roomImage = input.roomImage || '';
const imageType = input.imageType || 'image/jpeg';
const cabinetSpecs = input.cabinetSpecs || {};
const materialDescriptions = input.materialDescriptions || [];
const clientPrompt = input.prompt || '';
const negativePrompt = input.negative_prompt || '';
// Blueprint data from frontend (if provided)
let layoutData = input.layoutData || null;
let modules = input.modules || null;
let hasBlueprint = !!(layoutData && modules);
let hasModules = !!(modules && (modules.upper || modules.lower));

// ─── Wall dimensions + utility positions (AI-only, no manual override) ───
const wallW = input.wallData?.wall_width_mm || 3000;
const wallH = input.wallData?.wall_height_mm || 2400;

let waterPercent, exhaustPercent;
if (input.wallData?.water_supply_position) {
  waterPercent = Math.round(input.wallData.water_supply_position / wallW * 100);
} else {
  waterPercent = 30;
}
// exhaust_duct → gas_pipe fallback → default
if (input.wallData?.exhaust_duct_position) {
  exhaustPercent = Math.round(input.wallData.exhaust_duct_position / wallW * 100);
} else if (input.wallData?.gas_pipe_position) {
  exhaustPercent = Math.round(input.wallData.gas_pipe_position / wallW * 100);
} else {
  exhaustPercent = 70;
}

const isKitchen = ['sink', 'l_shaped_sink', 'island', 'island_kitchen', 'kitchen'].includes(category);

// ═══ KITCHEN: Auto-generate blueprint if not provided ═══
if (isKitchen && !hasBlueprint && !hasModules) {
  const totalW = wallW;
  const totalH = wallH;
  const sinkPct = waterPercent / 100;
  const cooktopPct = exhaustPercent / 100;
  const UPPER_H = 720, LOWER_H = 870, MOLDING = 60;
  const COUNTERTOP = 20, TOE_KICK = 150;
  const SINK_W = 800, COOKTOP_W = 600;

  function distributeModules(totalWidth, sinkCenterMm, cooktopCenterMm) {
    const sinkLeft = Math.max(0, sinkCenterMm - SINK_W / 2);
    const cooktopLeft = Math.max(0, cooktopCenterMm - COOKTOP_W / 2);
    let anchors = [];
    if (sinkCenterMm <= cooktopCenterMm) {
      anchors = [
        { left: sinkLeft, w: SINK_W, hasSink: true, hasCooktop: false },
        { left: cooktopLeft, w: COOKTOP_W, hasSink: false, hasCooktop: true }
      ];
    } else {
      anchors = [
        { left: cooktopLeft, w: COOKTOP_W, hasSink: false, hasCooktop: true },
        { left: sinkLeft, w: SINK_W, hasSink: true, hasCooktop: false }
      ];
    }
    if (anchors[1].left < anchors[0].left + anchors[0].w) {
      anchors[1].left = anchors[0].left + anchors[0].w;
    }
    if (anchors[1].left + anchors[1].w > totalWidth) {
      anchors[1].left = totalWidth - anchors[1].w;
    }
    const result = [];
    let cursor = 0;
    for (const anchor of anchors) {
      const gap = anchor.left - cursor;
      if (gap >= 300) fillGap(result, gap);
      result.push({ width_mm: anchor.w, type: 'door', door_count: anchor.w >= 700 ? 2 : 1, hasSink: anchor.hasSink, hasCooktop: anchor.hasCooktop });
      cursor = anchor.left + anchor.w;
    }
    const remaining = totalWidth - cursor;
    if (remaining >= 300) fillGap(result, remaining);
    return result;
  }

  function fillGap(arr, gapMm) {
    let remaining = gapMm;
    while (remaining >= 300) {
      let w;
      if (remaining >= 1800) w = 900;
      else if (remaining >= 1200) w = 600;
      else if (remaining >= 900) w = Math.min(900, remaining);
      else w = remaining;
      if (w < 300) break;
      arr.push({ width_mm: w, type: 'door', door_count: w >= 700 ? 2 : 1, hasSink: false, hasCooktop: false });
      remaining -= w;
    }
  }

  const sinkCenterMm = Math.round(sinkPct * totalW);
  const cooktopCenterMm = Math.round(cooktopPct * totalW);
  const lowerModules = distributeModules(totalW, sinkCenterMm, cooktopCenterMm);
  const upperModules = lowerModules.map(m => ({ width_mm: m.width_mm, type: m.type, door_count: m.door_count, hasSink: false, hasCooktop: false }));

  const ny = (mm) => mm / totalH;
  const upperY = ny(MOLDING);
  const upperH_n = ny(UPPER_H);
  const backsplashH = 1.0 - ny(MOLDING + UPPER_H + COUNTERTOP + LOWER_H + TOE_KICK);
  const countertopY = upperY + upperH_n + backsplashH;
  const lowerY = countertopY + ny(COUNTERTOP);
  const lowerH_n = ny(LOWER_H);

  function buildLayoutModules(mods) {
    let accW = 0;
    return mods.map(m => { const w = m.width_mm / totalW; const mod = { x: accW, w }; accW += w; return mod; });
  }

  layoutData = {
    totalW_mm: totalW, totalH_mm: totalH,
    upper: { y: upperY, h: upperH_n, modules: buildLayoutModules(upperModules) },
    lower: { y: lowerY, h: lowerH_n, modules: buildLayoutModules(lowerModules) },
    countertop: { y: countertopY },
    toeKick: { h: ny(TOE_KICK) }
  };
  modules = { upper: upperModules, lower: lowerModules };
  hasBlueprint = true;
  hasModules = true;

  if (!cabinetSpecs.door_color_upper) cabinetSpecs.door_color_upper = '\uD654\uC774\uD2B8';
  if (!cabinetSpecs.door_color_lower) cabinetSpecs.door_color_lower = '\uD654\uC774\uD2B8';
  if (!cabinetSpecs.door_finish_upper) cabinetSpecs.door_finish_upper = '\uBB34\uAD11';
  if (!cabinetSpecs.door_finish_lower) cabinetSpecs.door_finish_lower = '\uBB34\uAD11';
  if (!cabinetSpecs.countertop_color) cabinetSpecs.countertop_color = '\uC2A4\uB178\uC6B0';
  if (!cabinetSpecs.handle_type) cabinetSpecs.handle_type = 'hidden (push-to-open)';
}

// ─── Korean to English material translation ───
const colorMap = {
  '\uD654\uC774\uD2B8':'pure white', '\uADF8\uB808\uC774':'gray', '\uBE14\uB799':'matte black',
  '\uC624\uD06C':'natural oak wood', '\uC6D4\uB11B':'dark walnut wood', '\uC2A4\uB178\uC6B0':'snow white',
  '\uB9C8\uBE14\uD654\uC774\uD2B8':'white marble', '\uADF8\uB808\uC774\uB9C8\uBE14':'gray marble', '\uCC28\uCF5C':'charcoal',
  '\uBCA0\uC774\uC9C0':'beige', '\uB124\uC774\uBE44':'navy blue'
};
const finishMap = { '\uBB34\uAD11':'matte', '\uC720\uAD11':'glossy', '\uC5E0\uBCF4':'embossed' };
function translateColor(k) { return k ? (colorMap[k] || k) : ''; }
function translateFinish(k) { return k ? (finishMap[k] || k) : 'matte'; }

// Use frontend style data if available, otherwise cabinetSpecs
const upperColor = input.styleDoorColor ? translateColor(input.styleDoorColor) : translateColor(cabinetSpecs.door_color_upper);
const upperFinish = input.styleDoorFinish ? translateFinish(input.styleDoorFinish) : translateFinish(cabinetSpecs.door_finish_upper);
const lowerColor = input.styleDoorColor ? translateColor(input.styleDoorColor) : translateColor(cabinetSpecs.door_color_lower);
const lowerFinish = input.styleDoorFinish ? translateFinish(input.styleDoorFinish) : translateFinish(cabinetSpecs.door_finish_lower);
const countertopColor = translateColor(cabinetSpecs.countertop_color);
const handleType = input.styleHandlePrompt || cabinetSpecs.handle_type || 'hidden (push-to-open)';

let materialText = '';
if (upperColor) materialText += 'Upper doors: ' + upperColor + ' ' + upperFinish + '\n';
if (lowerColor) materialText += 'Lower doors: ' + lowerColor + ' ' + lowerFinish + '\n';
if (input.styleCountertopPrompt) materialText += 'Countertop: ' + input.styleCountertopPrompt + '\n';
else if (countertopColor) materialText += 'Countertop: ' + countertopColor + '\n';
materialText += 'Handle: ' + handleType + '\n';
if (input.styleMoodPrompt) materialText += 'Mood: ' + input.styleMoodPrompt + '\n';
if (input.styleAccentPrompt) materialText += 'Accent: ' + input.styleAccentPrompt + '\n';
if (materialDescriptions && materialDescriptions.length > 0) {
  materialText += 'Additional: ' + materialDescriptions.join(', ') + '\n';
}

// ═══ 1. CLEANUP PROMPT (short & direct for better Gemini results) ═══
const cleanupPrompt =
  'Edit this image: Remove everything from the floor and surfaces. ' +
  'Delete all construction debris, tools, materials, plastic sheets, dust, and trash. ' +
  'The floor must be perfectly clean polished tile or concrete. ' +
  'Keep the exact same room — same walls, tiles, ceiling, lights, camera angle. ' +
  'Output: a photorealistic photo of this same empty room, spotlessly clean, ready for furniture.';

// ═══ 2. FURNITURE PROMPT ═══
let furniturePrompt = '';

if (isKitchen) {
  if (hasBlueprint && hasModules && modules) {
    // ─── BLUEPRINT MODE ───
    const ld = layoutData;
    const totalW = ld && ld.totalW_mm ? ld.totalW_mm : wallW;
    const totalH = wallH;
    let layoutText = '[PRECISE CABINET LAYOUT \u2014 MUST FOLLOW EXACTLY]\n';
    layoutText += 'Wall: ' + totalW + 'mm wide \u00D7 ' + totalH + 'mm tall\n\n';

    if (modules.upper && modules.upper.length > 0) {
      const uTop = ld && ld.upper ? (ld.upper.y * 100).toFixed(1) : '2.5';
      const uBot = ld && ld.upper ? ((ld.upper.y + ld.upper.h) * 100).toFixed(1) : '32.5';
      layoutText += '[UPPER CABINETS] top ' + uTop + '%~' + uBot + '% of wall height, left to right:\n';
      let accX = 0;
      modules.upper.forEach((m, i) => {
        const wNorm = ld && ld.upper && ld.upper.modules && ld.upper.modules[i] ? ld.upper.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xS = (accX * 100).toFixed(1);
        accX += wNorm;
        const xE = (accX * 100).toFixed(1);
        const dc = m.door_count || 1;
        layoutText += '  ' + (i+1) + '. x: ' + xS + '~' + xE + '%, ' + wMm + 'mm wide, ' + dc + '-door cabinet\n';
      });
      layoutText += '  (total upper: ' + modules.upper.length + ' modules, flush with ceiling)\n\n';
    }

    if (modules.lower && modules.lower.length > 0) {
      const lTop = ld && ld.lower ? (ld.lower.y * 100).toFixed(1) : '65.8';
      const lBot = ld && ld.lower ? ((ld.lower.y + ld.lower.h) * 100).toFixed(1) : '100';
      layoutText += '[LOWER CABINETS] bottom ' + lTop + '%~' + lBot + '% of wall height, left to right:\n';
      let accX = 0;
      modules.lower.forEach((m, i) => {
        const wNorm = ld && ld.lower && ld.lower.modules && ld.lower.modules[i] ? ld.lower.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xS = (accX * 100).toFixed(1);
        accX += wNorm;
        const xE = (accX * 100).toFixed(1);
        const dc = m.door_count || 1;
        let extras = '';
        if (m.hasSink || m.has_sink) extras += ' [SINK at center]';
        if (m.hasCooktop || m.has_cooktop) extras += ' [COOKTOP at center]';
        layoutText += '  ' + (i+1) + '. x: ' + xS + '~' + xE + '%, ' + wMm + 'mm wide, ' + dc + '-door' + extras + '\n';
      });
      layoutText += '\n';
    }

    if (ld && ld.countertop) layoutText += 'Countertop: thin strip at ' + (ld.countertop.y * 100).toFixed(1) + '% height\n';
    if (ld && ld.toeKick) layoutText += 'Toe kick: dark strip at very bottom (~' + (ld.toeKick.h * 100).toFixed(0) + '%)\n';

    furniturePrompt = '[TASK: BLUEPRINT-GUIDED PHOTOREALISTIC FURNITURE RENDERING]\n\n' +
      'This photo shows a room ready for furniture installation. PRESERVE the background EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n' +
      'Place furniture according to the PRECISE CABINET LAYOUT below.\n\n' +
      layoutText + '\n' +
      '[UTILITY ANCHOR POINTS]\n' +
      'Water supply pipe at ' + waterPercent + '% from left \u2192 Sink module MUST align here\n' +
      'Exhaust duct at ' + exhaustPercent + '% from left \u2192 Cooktop module MUST align here\n\n' +
      '\u2605\u2605\u2605 RENDERING RULES (MANDATORY) \u2605\u2605\u2605\n' +
      '1. PRESERVE the background EXACTLY \u2014 do NOT modify walls, floor, or ceiling\n' +
      '2. Place furniture ONLY where the layout description specifies\n' +
      '3. Match the EXACT proportions and positions from the layout\n' +
      '4. Each module WIDTH RATIO must match the layout precisely\n' +
      '5. Upper cabinets must be flush with ceiling\n' +
      '6. Drawers and doors must match the count specified\n' +
      '7. Handles must match the type specified in materials\n' +
      '8. Sink and cooktop positions must match the layout exactly\n\n' +
      '\u2605\u2605\u2605 PHOTOREALISTIC QUALITY \u2605\u2605\u2605\n' +
      '- Add realistic shadows, reflections, and ambient lighting\n' +
      '- Apply proper material textures (wood grain, stone pattern, stainless steel)\n' +
      '- Show realistic edge profiles and panel gaps (2-3mm between doors)\n' +
      '- Natural lighting from windows/ceiling as visible in the background\n' +
      '- Subtle shadow under upper cabinets onto backsplash\n' +
      '- Realistic toe kick shadow on floor\n\n' +
      '\u2605\u2605\u2605 RANGE HOOD \u2014 BUILT-IN CONCEALED TYPE ONLY \u2605\u2605\u2605\n' +
      'The range hood MUST be fully concealed inside the upper cabinet.\n' +
      'NO exposed hood duct pipes or external ductwork visible.\n\n' +
      '[MATERIALS]\n' + materialText + '\n' +
      '[STYLE: ' + styleLabel + ']\n' +
      (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
      '[PROHIBITED]\n' +
      '- Do NOT change positions or proportions from the layout\n' +
      '- Do NOT modify the background/wall/floor\n' +
      '- No text, labels, or dimension markings\n' +
      '- NO exposed hood duct or ventilation pipe\n' +
      '- NO floating or detached furniture elements\n' +
      '- Sink cabinet door MUST be completely closed\n' +
      (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');

  } else {
    // ─── KITCHEN FALLBACK (no blueprint) ───
    const waterMm = Math.round(waterPercent / 100 * wallW);
    const exhaustMm = Math.round(exhaustPercent / 100 * wallW);

    furniturePrompt = '[TASK: FURNITURE PLACEMENT \u2014 AI-ANALYZED UTILITY POSITIONS]\n\n' +
      '\u2605\u2605\u2605 CRITICAL: DO NOT MODIFY THE BACKGROUND \u2605\u2605\u2605\n' +
      'This photo shows a room. Do NOT alter walls, floor, ceiling, or lighting.\n' +
      'ONLY add kitchen furniture and appliances.\n\n' +
      'Wall dimensions: ' + wallW + 'mm \u00D7 ' + wallH + 'mm\n\n' +
      '[ANCHOR POINT 1: Water Supply \u2192 Sink Center]\n' +
      '  Millimeters: ' + waterMm + 'mm from left\n' +
      '  Percentage:  ' + waterPercent + '% from left edge\n' +
      '  \u2192 Place SINK BOWL center exactly at ' + waterPercent + '% from left\n\n' +
      '[ANCHOR POINT 2: Exhaust Duct \u2192 Cooktop Center]\n' +
      '  Millimeters: ' + exhaustMm + 'mm from left\n' +
      '  Percentage:  ' + exhaustPercent + '% from left edge\n' +
      '  \u2192 Place COOKTOP center exactly at ' + exhaustPercent + '% from left\n\n' +
      '\u2605\u2605\u2605 RANGE HOOD \u2014 BUILT-IN CONCEALED TYPE ONLY \u2605\u2605\u2605\n' +
      'The range hood MUST be fully concealed inside the upper cabinet.\n' +
      'NO exposed hood duct pipes or external ductwork visible.\n\n' +
      '[REQUIRED COMPONENTS]\n' +
      '\u2713 Sink Bowl \u2014 stainless steel, at ' + waterPercent + '% position\n' +
      '\u2713 Faucet \u2014 behind sink bowl\n' +
      '\u2713 Cooktop \u2014 at ' + exhaustPercent + '% position\n' +
      '\u2713 Range Hood \u2014 BUILT-IN CONCEALED inside upper cabinet\n' +
      '\u2713 Lower Cabinets \u2014 height 870mm from floor\n' +
      '\u2713 Upper Cabinets \u2014 FLUSH with ceiling (NO gap)\n' +
      '\u2713 Toe Kick \u2014 below lower cabinets\n\n' +
      '[MATERIALS]\n' + materialText + '\n' +
      '[STYLE: ' + styleLabel + ']\n' +
      (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
      '[PROHIBITED]\n' +
      '- Do NOT modify background/walls/floor\n' +
      '- No text, labels, or dimensions\n' +
      '- NO exposed/chimney/wall-mount range hood\n' +
      '- NO gap between upper cabinets and ceiling\n' +
      '- Sink cabinet door MUST be completely closed\n' +
      (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');
  }

} else if (category === 'wardrobe') {
  furniturePrompt = '[TASK: PHOTOREALISTIC BUILT-IN WARDROBE RENDERING]\n\n' +
    'This photo shows a room ready for furniture installation. PRESERVE EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n\n' +
    '[WARDROBE LAYOUT]\n' +
    'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall\n' +
    '- Full-width built-in wardrobe covering the entire wall\n' +
    '- Floor-to-ceiling installation (no gap at top or bottom)\n' +
    '- Multiple sections with hinged or sliding doors\n' +
    '- Interior composition: hanging rod section + shelf section + drawer section\n' +
    '- All doors CLOSED in this rendering\n\n' +
    '[MATERIALS]\n' + materialText + '\n' +
    '[STYLE: ' + styleLabel + ']\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    '- Photorealistic quality with proper shadows and reflections\n' +
    '- Doors must be uniform with consistent gap spacing (2-3mm)\n' +
    '- Handles aligned horizontally across all doors\n' +
    '- Realistic edge profiles and panel construction\n\n' +
    '[PROHIBITED]\n' +
    '- Do NOT modify background/walls/floor\n' +
    '- No glass-front doors unless specified\n' +
    '- No text, labels, or dimensions\n' +
    '- No floating or detached elements\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');

} else if (category === 'shoe_cabinet') {
  furniturePrompt = '[TASK: PHOTOREALISTIC SHOE CABINET RENDERING]\n\n' +
    'This photo shows a room ready for furniture installation. PRESERVE EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n\n' +
    '[SHOE CABINET LAYOUT]\n' +
    'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall\n' +
    '- Slim profile shoe cabinet (300-400mm depth)\n' +
    '- Floor-to-ceiling or partial height as appropriate for the space\n' +
    '- Internal tilted shoe shelves (15-20 degree angle) for efficient storage\n' +
    '- All doors CLOSED in this rendering\n' +
    '- Clean minimal door fronts\n\n' +
    '[MATERIALS]\n' + materialText + '\n' +
    '[STYLE: ' + styleLabel + ']\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    '- Photorealistic quality with proper shadows\n' +
    '- Slim proportions \u2014 cabinet must NOT look deep/bulky\n' +
    '- Consistent door gaps and handle alignment\n\n' +
    '[PROHIBITED]\n' +
    '- Do NOT modify background/walls/floor\n' +
    '- No text, labels, or dimensions\n' +
    '- Cabinet depth must not exceed 400mm visual appearance\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');

} else if (category === 'fridge_cabinet' || category === 'fridge') {
  furniturePrompt = '[TASK: PHOTOREALISTIC REFRIGERATOR CABINET RENDERING]\n\n' +
    'This photo shows a room ready for furniture installation. PRESERVE EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n\n' +
    '[FRIDGE CABINET LAYOUT]\n' +
    'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall\n' +
    '- Center: refrigerator opening (~700mm wide \u00D7 1800mm tall)\n' +
    '- Side panels: tall storage cabinets flanking the refrigerator\n' +
    '- Upper cabinet: bridge cabinet above refrigerator opening\n' +
    '- Floor-to-ceiling installation\n' +
    '- All cabinet doors CLOSED in this rendering\n\n' +
    '[MATERIALS]\n' + materialText + '\n' +
    '[STYLE: ' + styleLabel + ']\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    '- Photorealistic quality with proper shadows\n' +
    '- Refrigerator opening must be clearly defined and centered\n' +
    '- Side cabinets must be symmetrical\n' +
    '- Consistent material and color across all panels\n\n' +
    '[PROHIBITED]\n' +
    '- Do NOT modify background/walls/floor\n' +
    '- Do NOT render a refrigerator \u2014 only the cabinet surround\n' +
    '- No text, labels, or dimensions\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');

} else if (category === 'vanity') {
  furniturePrompt = '[TASK: PHOTOREALISTIC BATHROOM VANITY RENDERING]\n\n' +
    'This photo shows a room ready for furniture installation. PRESERVE EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n\n' +
    '[VANITY LAYOUT]\n' +
    'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall\n' +
    '- Lower: vanity cabinet with integrated sink basin\n' +
    '- Sink position: aligned at ' + waterPercent + '% from left (water supply location)\n' +
    '- Upper: mirror cabinet above vanity\n' +
    '- Faucet: single-lever mixer, chrome or matte finish\n' +
    '- Countertop: extending full width of vanity\n\n' +
    '[MATERIALS]\n' + materialText + '\n' +
    '[STYLE: ' + styleLabel + ']\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    '- Photorealistic quality with proper reflections on mirror\n' +
    '- Sink must align with water supply position\n' +
    '- Mirror cabinet proportional to vanity below\n' +
    '- Realistic water fixture and basin details\n\n' +
    '[PROHIBITED]\n' +
    '- Do NOT modify background/walls/floor\n' +
    '- No text, labels, or dimensions\n' +
    '- No floating or detached elements\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');

} else {
  // ─── GENERIC STORAGE CABINET ───
  furniturePrompt = '[TASK: PHOTOREALISTIC STORAGE CABINET RENDERING]\n\n' +
    'This photo shows a room ready for furniture installation. PRESERVE EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.\n\n' +
    '[STORAGE CABINET LAYOUT]\n' +
    'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall\n' +
    '- Built-in storage cabinet covering the wall\n' +
    '- Floor-to-ceiling installation\n' +
    '- Multiple door sections with adjustable interior shelves\n' +
    '- All doors CLOSED in this rendering\n\n' +
    '[MATERIALS]\n' + materialText + '\n' +
    '[STYLE: ' + styleLabel + ']\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '') +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    '- Photorealistic quality with proper shadows and reflections\n' +
    '- Consistent door gaps and handle alignment\n' +
    '- Realistic edge profiles\n\n' +
    '[PROHIBITED]\n' +
    '- Do NOT modify background/walls/floor\n' +
    '- No text, labels, or dimensions\n' +
    '- No floating or detached elements\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '');
}

// ═══ 3. OPEN DOOR PROMPT (Korean, from v9) ═══
const SEP = '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550';
const CATEGORY_CONTENTS = {
  wardrobe: '- \uD589\uAC70\uC5D0 \uAC78\uB9B0 \uC154\uCE20, \uBE14\uB77C\uC6B0\uC2A4, \uC7AC\uD0B7, \uCF54\uD2B8\n- \uC811\uD78C \uC2A4\uC6E8\uD130, \uB2C8\uD2B8, \uD2F0\uC154\uCE20\n- \uCCAD\uBC14\uC9C0, \uBA74\uBC14\uC9C0 \uB4F1 \uD558\uC758\uB958\n- \uC11C\uB78D \uC18D \uC18D\uC637, \uC591\uB9D0 \uC815\uB9AC\uD568\n- \uAC00\uBC29, \uBAA8\uC790, \uC2A4\uCE74\uD504 \uC561\uC138\uC11C\uB9AC',
  sink: '- \uADF8\uB987, \uC811\uC2DC, \uBC25\uACF5\uAE30, \uAD6D\uADF8\uB987\n- \uCEF5, \uBA38\uADF8\uC794, \uC720\uB9AC\uC794\n- \uB0C4\uBE44, \uD504\uB77C\uC774\uD32C, \uC870\uB9AC\uB3C4\uAD6C\n- \uC591\uB150\uD1B5, \uC624\uC77C\uBCD1\n- \uB3C4\uB9C8, \uC8FC\uAC78, \uAD6D\uC790\n[\uC2F1\uD06C\uBCFC \uD558\uBD80 - \uD544\uC218]\n- \uBC30\uC218\uAD00 (P\uD2B8\uB7A9/S\uD2B8\uB7A9)\n- \uAE09\uC218\uAD00 (\uB0C9/\uC628\uC218)\n- \uC218\uB3C4 \uBD84\uBC30\uAE30 (\uC575\uAE00\uBC38\uBE0C)\n[\uC2F1\uD06C\uBCFC \uD558\uBD80 - \uAE08\uC9C0]\n\u274C \uC4F0\uB808\uAE30\uD1B5, \uC138\uC81C, \uCCAD\uC18C\uC6A9\uD488, \uC7A1\uB3D9\uC0AC\uB2C8',
  fridge: '- \uCEE4\uD53C\uBA38\uC2E0, \uC804\uC790\uB808\uC778\uC9C0\n- \uD1A0\uC2A4\uD130, \uBBF9\uC11C\uAE30\n- \uC2DD\uB8CC\uD488, \uC2DC\uB9AC\uC5BC \uBC15\uC2A4\n- \uCEF5, \uBA38\uADF8\uC794\n- \uAC04\uC2DD, \uC74C\uB8CC',
  vanity: '- \uD654\uC7A5\uD488, \uC2A4\uD0A8\uCF00\uC5B4 \uC81C\uD488\n- \uBA54\uC774\uD06C\uC5C5 \uBE0C\uB7EC\uC2DC, \uD30C\uC6B0\uCE58\n- \uD5A5\uC218, \uB85C\uC158, \uD06C\uB9BC\n- \uD5E4\uC5B4\uB4DC\uB77C\uC774\uC5B4, \uACE0\uB370\uAE30\n- \uC218\uAC74, \uC138\uBA74\uB3C4\uAD6C',
  shoe: '- \uC6B4\uB3D9\uD654, \uC2A4\uB2C8\uCEE4\uC988\n- \uAD6C\uB450, \uB85C\uD37C, \uD790\n- \uC0CC\uB4E4, \uC2AC\uB9AC\uD37C\n- \uBD80\uCE20, \uB808\uC778\uBD80\uCE20\n- \uC2E0\uBC1C \uAD00\uB9AC\uC6A9\uD488',
  storage: '- \uCC45, \uC7A1\uC9C0, \uBB38\uC11C\n- \uC218\uB0A9\uBC15\uC2A4, \uBC14\uAD6C\uB2C8\n- \uC774\uBD88, \uCE68\uAD6C\uB958\n- \uC5EC\uD589\uAC00\uBC29, \uCE90\uB9AC\uC5B4\n- \uACC4\uC808\uC6A9\uD488'
};
const CATEGORY_FORBIDDEN = {
  wardrobe: '\u274C \uC2DD\uAE30\uB958, \uC8FC\uBC29\uC6A9\uD488 \uAE08\uC9C0 (\uC637\uC7A5\uC5D0\uB294 \uC758\uB958\uB9CC)',
  sink: '\u274C \uC758\uB958, \uC637 \uAE08\uC9C0 (\uC8FC\uBC29\uC5D0\uB294 \uC8FC\uBC29\uC6A9\uD488\uB9CC)',
  fridge: '\u274C \uC758\uB958, \uC637 \uAE08\uC9C0 (\uB0C9\uC7A5\uACE0\uC7A5\uC5D0\uB294 \uAC00\uC804/\uC2DD\uD488\uB9CC)',
  vanity: '\u274C \uC758\uB958, \uC8FC\uBC29\uC6A9\uD488 \uAE08\uC9C0 (\uD654\uC7A5\uB300\uC5D0\uB294 \uD654\uC7A5\uD488\uB9CC)',
  shoe: '\u274C \uC758\uB958, \uC2DD\uAE30\uB958 \uAE08\uC9C0 (\uC2E0\uBC1C\uC7A5\uC5D0\uB294 \uC2E0\uBC1C\uB9CC)',
  storage: '\u274C \uC74C\uC2DD\uBB3C \uAE08\uC9C0 (\uC218\uB0A9\uC7A5\uC5D0\uB294 \uC218\uB0A9\uC6A9\uD488\uB9CC)'
};

const catKey = category === 'fridge_cabinet' ? 'fridge' : (category === 'shoe_cabinet' ? 'shoe' : category);
const contents = CATEGORY_CONTENTS[catKey] || CATEGORY_CONTENTS.storage;
const forbidden = CATEGORY_FORBIDDEN[catKey] || CATEGORY_FORBIDDEN.storage;
const sinkExtra = category === 'sink' ? '- \uC2F1\uD06C\uBCFC, \uC218\uC804, \uCFE1\uD0D1, \uD6C4\uB4DC \uC704\uCE58: \uBCC0\uACBD \uAE08\uC9C0\n' : '';

const openPrompt =
  '[TASK] \uC774 \uAC00\uAD6C \uC774\uBBF8\uC9C0\uC5D0\uC11C \uBAA8\uB4E0 \uB3C4\uC5B4\uB97C \uC5F4\uB9B0 \uC0C1\uD0DC\uB85C \uBCC0\uACBD\uD558\uC138\uC694.\n\n' +
  SEP + '\n[CRITICAL - \uC808\uB300 \uBCC0\uACBD \uAE08\uC9C0] \u2605\u2605\u2605 \uAC00\uC7A5 \uC911\uC694\n' + SEP + '\n' +
  '- \uB3C4\uC5B4 \uAC1C\uC218: \uD604\uC7AC \uC774\uBBF8\uC9C0\uC5D0 \uBCF4\uC774\uB294 \uB3C4\uC5B4 \uAC1C\uC218 \uC815\uD655\uD788 \uC720\uC9C0\n' +
  '- \uB3C4\uC5B4 \uC704\uCE58: \uAC01 \uB3C4\uC5B4\uC758 \uC704\uCE58 \uADF8\uB300\uB85C \uC720\uC9C0\n' +
  '- \uB3C4\uC5B4 \uD06C\uAE30/\uBE44\uC728: \uAC01 \uB3C4\uC5B4\uC758 \uB108\uBE44\uC640 \uB192\uC774 \uBE44\uC728 \uC644\uC804\uD788 \uB3D9\uC77C\n' +
  '- \uB3C4\uC5B4 \uC0C9\uC0C1/\uC7AC\uC9C8: \uBCC0\uACBD \uAE08\uC9C0\n' +
  '- \uAC00\uAD6C \uC804\uCCB4 \uD06C\uAE30\uC640 \uD615\uD0DC: \uBCC0\uACBD \uAE08\uC9C0\n' +
  '- \uCE74\uBA54\uB77C \uC575\uAE00, \uC6D0\uADFC\uAC10, \uC2DC\uC810: \uC644\uC804\uD788 \uB3D9\uC77C\n' +
  '- \uBC30\uACBD (\uBCBD, \uBC14\uB2E5, \uCC9C\uC7A5, \uC870\uBA85): \uB3D9\uC77C\n' +
  sinkExtra + '\n' +
  SEP + '\n[CRITICAL - \uB3C4\uC5B4 \uAD6C\uC870 \uC720\uC9C0 \uADDC\uCE59]\n' + SEP + '\n' +
  '- \uC808\uB300 \uB3C4\uC5B4\uB97C \uCD94\uAC00\uD558\uAC70\uB098 \uC81C\uAC70\uD558\uC9C0 \uB9C8\uC138\uC694\n' +
  '- \uC808\uB300 \uB3C4\uC5B4\uB97C \uD569\uCE58\uAC70\uB098 \uBD84\uD560\uD558\uC9C0 \uB9C8\uC138\uC694\n' +
  '- \uB2EB\uD78C \uC0C1\uD0DC\uC758 \uB3C4\uC5B4 \uBD84\uD560\uC120/\uACBD\uACC4\uC120\uC744 \uC815\uD655\uD788 \uB530\uB974\uC138\uC694\n' +
  '- \uAC01 \uB3C4\uC5B4\uB294 \uB3C5\uB9BD\uC801\uC73C\uB85C \uC5F4\uB824\uC57C \uD569\uB2C8\uB2E4\n\n' +
  SEP + '\n[\uBCC0\uACBD\uD560 \uAC83 - \uB3C4\uC5B4 \uC0C1\uD0DC\uB9CC]\n' + SEP + '\n' +
  '\uC5EC\uB2EB\uC774 \uB3C4\uC5B4 (Swing door):\n\u2192 \uD604\uC7AC \uC704\uCE58\uC5D0\uC11C \uD78C\uC9C0 \uAE30\uC900 90\uB3C4 \uBC14\uAE65\uC73C\uB85C \uD68C\uC804\uD558\uC5EC \uC5F4\uB9BC\n\n' +
  '\uC11C\uB78D \uB3C4\uC5B4 (Drawer):\n\u2192 \uD604\uC7AC \uC704\uCE58\uC5D0\uC11C 30-40% \uC55E\uC73C\uB85C \uB2F9\uACA8\uC9C4 \uC0C1\uD0DC\n\n' +
  '\u203B \uC5EC\uB2EB\uC774\uB97C \uC11C\uB78D\uCC98\uB7FC \uC5F4\uAC70\uB098, \uC11C\uB78D\uC744 \uC5EC\uB2EB\uC774\uCC98\uB7FC \uC5F4\uBA74 \uC548\uB428!\n\n' +
  SEP + '\n[\uB0B4\uBD80 \uC218\uB0A9\uBB3C - ' + category + ']\n' + SEP + '\n' +
  contents + '\n\n' +
  SEP + '\n[\uD488\uBAA9 \uD63C\uB3D9 \uAE08\uC9C0]\n' + SEP + '\n' +
  forbidden + '\n\n' +
  SEP + '\n[ABSOLUTELY FORBIDDEN]\n' + SEP + '\n' +
  '\u274C \uCE58\uC218 \uB77C\uBCA8, \uD14D\uC2A4\uD2B8, \uC22B\uC790 \uCD94\uAC00 \uAE08\uC9C0\n' +
  '\u274C \uBC30\uACBD, \uBC29 \uC694\uC18C \uBCC0\uACBD \uAE08\uC9C0\n' +
  '\u274C \uCE74\uBA54\uB77C \uC575\uAE00 \uBCC0\uACBD \uAE08\uC9C0\n' +
  '\u274C \uB3C4\uC5B4 \uD0C0\uC785 \uBCC0\uACBD \uAE08\uC9C0 (swing\u2194drawer)\n' +
  '\u274C \uB3C4\uC5B4 \uCD94\uAC00/\uC81C\uAC70/\uD569\uCE58\uAE30/\uBD84\uD560 \uAE08\uC9C0\n\n' +
  SEP + '\n[OUTPUT]\n' + SEP + '\n' +
  '- \uB2EB\uD78C \uC774\uBBF8\uC9C0\uC640 \uB3C4\uC5B4 \uAD6C\uC870 100% \uC77C\uCE58\n' +
  '- \uD3EC\uD1A0\uB9AC\uC5BC\uB9AC\uC2A4\uD2F1 \uC778\uD14C\uB9AC\uC5B4 \uC0AC\uC9C4 \uD488\uC9C8\n' +
  '- \uC815\uB9AC\uB41C \uC218\uB0A9 \uC0C1\uD0DC (\uC5B4\uC9C0\uB7FD\uC9C0 \uC54A\uAC8C)';

// ═══ COMPRESSED PROMPT (<500 chars for n8n Cloud + Gemini compatibility) ═══
let compressedPrompt = '';
const doorDesc = (upperColor || 'white') + ' ' + (upperFinish || 'matte');
const ctDesc = input.styleCountertopPrompt || countertopColor || 'white stone';

if (isKitchen && hasBlueprint && hasModules && modules) {
  // Compact lower summary: only modules with sink/cooktop noted
  const lCompact = modules.lower.map(m => {
    if (m.hasSink || m.has_sink) return 'sink';
    if (m.hasCooktop || m.has_cooktop) return 'cooktop';
    return m.width_mm + '';
  }).join(', ');
  compressedPrompt = 'Place ' + doorDesc + ' kitchen cabinets on this photo. PRESERVE background EXACTLY.\n' +
    wallW + 'x' + wallH + 'mm wall. Sink ' + waterPercent + '%, hood ' + exhaustPercent + '%.\n' +
    modules.upper.length + ' upper flush ceiling. ' + modules.lower.length + ' lower (' + lCompact + ').\n' +
    ctDesc + '. ' + handleType + '. ' + styleLabel + '. Photorealistic. Concealed hood.';
} else if (isKitchen) {
  compressedPrompt = 'Place ' + doorDesc + ' kitchen cabinets on this photo. PRESERVE background EXACTLY.\n' +
    wallW + 'x' + wallH + 'mm wall. Sink ' + waterPercent + '%, hood ' + exhaustPercent + '%.\n' +
    ctDesc + '. ' + handleType + '. ' + styleLabel + '. Photorealistic. Flush upper cabinets. Concealed hood.';
} else if (category === 'wardrobe') {
  compressedPrompt = 'Place ' + doorDesc + ' built-in wardrobe on this photo. PRESERVE background EXACTLY.\n' +
    'Wall: ' + wallW + 'x' + wallH + 'mm. Full-width floor-to-ceiling wardrobe with hinged doors.\n' +
    handleType + '. ' + styleLabel + '. Photorealistic. All doors closed.';
} else if (category === 'shoe_cabinet') {
  compressedPrompt = 'Place ' + doorDesc + ' shoe cabinet on this photo. PRESERVE background EXACTLY.\n' +
    'Wall: ' + wallW + 'x' + wallH + 'mm. Slim profile 300-400mm depth. Floor-to-ceiling.\n' +
    handleType + '. ' + styleLabel + '. Photorealistic. All doors closed.';
} else if (category === 'vanity') {
  compressedPrompt = 'Place ' + doorDesc + ' bathroom vanity on this photo. PRESERVE background EXACTLY.\n' +
    'Wall: ' + wallW + 'x' + wallH + 'mm. Vanity with sink at ' + waterPercent + '% from left. Mirror cabinet above.\n' +
    ctDesc + ' countertop. ' + styleLabel + '. Photorealistic. Faucet chrome finish.';
} else if (category === 'fridge_cabinet' || category === 'fridge') {
  compressedPrompt = 'Place ' + doorDesc + ' refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.\n' +
    'Wall: ' + wallW + 'x' + wallH + 'mm. Center opening for fridge, tall storage on sides, bridge above.\n' +
    handleType + '. ' + styleLabel + '. Photorealistic. All doors closed.';
} else {
  compressedPrompt = 'Place ' + doorDesc + ' storage cabinet on this photo. PRESERVE background EXACTLY.\n' +
    'Wall: ' + wallW + 'x' + wallH + 'mm. Floor-to-ceiling built-in with multiple door sections.\n' +
    handleType + '. ' + styleLabel + '. Photorealistic. All doors closed.';
}

// ═══ Return prompt data for Gemini Furniture Code node ═══
return [{
  category: input.category,
  style: input.style,
  cleanedBackground: roomImage,
  imageType,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  furniturePrompt,
  compressedPrompt,
  openPrompt,
  hasBlueprint,
  hasModules,
  renderingMode: hasBlueprint ? 'blueprint' : (isKitchen ? 'fallback' : category),
  hasCleanedBackground: true
}];
