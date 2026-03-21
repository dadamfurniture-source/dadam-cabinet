// ═══ Build All Prompts v10 — Cleanup + Furniture + Open ═══
// Optimized: All English, deduplicated shared sections
// RAG 노드가 있으면 RAG에서, 없으면 Parse Wall Data에서 데이터 가져오기
let input;
try { input = $('Supabase RAG Search').first().json; }
catch(e) { input = $('Parse Wall Data').first().json; }
const category = (input.category || 'sink').toLowerCase();
const styleLabel = input.style || 'Modern Minimal';
const roomImage = input.roomImage || '';
const imageType = input.imageType || 'image/jpeg';
const cabinetSpecs = input.cabinetSpecs || {};
const materialDescriptions = input.materialDescriptions || [];
const clientPrompt = input.prompt || '';
const ragRules = input.ragRules || null;
const negativePrompt = input.negative_prompt || '';
// Kitchen layout type: i_type(1자), l_type(ㄱ자), u_type(ㄷ자), peninsula(대면)
const kitchenLayout = input.kitchenLayout || input.kitchen_layout || cabinetSpecs.kitchen_layout || 'i_type';
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

// ═══ RAG RULES SECTION ═══
let ragSection = '';
if (ragRules) {
  if (ragRules.background && ragRules.background.length > 0) {
    ragSection += '[BACKGROUND RULES]\n' + ragRules.background.join('\n') + '\n\n';
  }
  if (ragRules.modules && ragRules.modules.length > 0) {
    ragSection += '[MODULE RULES]\n' + ragRules.modules.join('\n') + '\n\n';
  }
  if (ragRules.doors && ragRules.doors.length > 0) {
    ragSection += '[DOOR RULES]\n' + ragRules.doors.join('\n') + '\n\n';
  }
  if (ragRules.materials && ragRules.materials.length > 0) {
    const matTexts = ragRules.materials.map(m => '- ' + (m.triggers && m.triggers[0] ? m.triggers[0] + ': ' : '') + m.content);
    ragSection += '[MATERIAL RULES]\n' + matTexts.join('\n') + '\n\n';
  }
}

// ═══ SHARED PROMPT SECTIONS (deduplicated) ═══
const WALL_DIM = 'Wall: ' + wallW + 'mm wide \u00D7 ' + wallH + 'mm tall';
const PRESERVE_BG = 'This photo shows a room ready for furniture installation. PRESERVE the background EXACTLY \u2014 do NOT modify walls, floor, ceiling, or lighting.';
const MATERIALS_STYLE = '[MATERIALS]\n' + materialText + '\n[STYLE: ' + styleLabel + ']\n' +
  (ragSection ? ragSection : '') +
  (clientPrompt ? '[CLIENT SPECIFICATIONS]\n' + clientPrompt + '\n' : '');
const BASE_PROHIBITED = '- Do NOT modify the background, walls, or floor\n' +
  '- No text, labels, dimensions, or markings\n' +
  '- No floating or detached furniture elements\n';
const QUALITY_RULES = '- Photorealistic quality with realistic shadows and reflections\n' +
  '- Proper material textures (wood grain, stone pattern, stainless steel)\n' +
  '- Realistic edge profiles and panel gaps (2-3mm between doors)\n' +
  '- Natural lighting consistent with the background\n';
const DUCT_RULES = 'The range hood MUST be fully concealed inside the upper cabinet.\n' +
  'REMOVE all exposed duct pipes, silver aluminum tubes, ventilation pipes from the image.\n' +
  'The wall behind cabinets must show clean tiles or wall surface \u2014 NO pipe or duct visible.\n';
const EXTRA_RESTRICT = negativePrompt ? '[ADDITIONAL RESTRICTIONS]\n' + negativePrompt : '';

// ═══ 1. CLEANUP PROMPT ═══
const cleanupPrompt =
  'Edit this image: Remove everything from the floor and surfaces. ' +
  'Delete all construction debris, tools, materials, plastic sheets, dust, and trash. ' +
  'The floor must be perfectly clean polished tile or concrete. ' +
  'Keep the exact same room \u2014 same walls, tiles, ceiling, lights, camera angle. ' +
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
      PRESERVE_BG + '\nPlace furniture according to the PRECISE CABINET LAYOUT below.\n\n' +
      layoutText + '\n' +
      '[UTILITY ANCHOR POINTS \u2014 FIXED POSITIONS]\n' +
      '\u2605 Water supply at ' + waterPercent + '% \u2192 Sink MUST be placed at this position\n' +
      '\u2605 Exhaust duct at ' + exhaustPercent + '% \u2192 Cooktop + Range hood MUST be placed at this position\n\n' +
      '\u2605\u2605\u2605 RENDERING RULES (MANDATORY) \u2605\u2605\u2605\n' +
      '1. PRESERVE the background EXACTLY\n' +
      '2. Place furniture ONLY where the layout specifies\n' +
      '3. Match EXACT proportions and positions from the layout\n' +
      '4. Each module width ratio must match precisely\n' +
      '5. Upper cabinets flush with ceiling\n' +
      '6. Door/drawer count must match the layout\n' +
      '7. Sink and cooktop positions must match exactly\n\n' +
      '\u2605\u2605\u2605 PHOTOREALISTIC QUALITY \u2605\u2605\u2605\n' +
      QUALITY_RULES +
      '- Subtle shadow under upper cabinets onto backsplash\n' +
      '- Realistic toe kick shadow on floor\n\n' +
      '\u2605\u2605\u2605 CONCEALED RANGE HOOD \u2605\u2605\u2605\n' +
      DUCT_RULES + '\n' +
      MATERIALS_STYLE +
      '[PROHIBITED]\n' +
      BASE_PROHIBITED +
      '- Do NOT change positions or proportions from the layout\n' +
      '- NO exposed duct pipe, silver tube, or ventilation pipe\n' +
      '- Sink cabinet door MUST be completely closed\n' +
      EXTRA_RESTRICT;

  } else {
    // ─── KITCHEN FALLBACK (no blueprint) ───
    const waterMm = Math.round(waterPercent / 100 * wallW);
    const exhaustMm = Math.round(exhaustPercent / 100 * wallW);

    furniturePrompt = '[TASK: FURNITURE PLACEMENT \u2014 AI-ANALYZED UTILITY POSITIONS]\n\n' +
      '\u2605\u2605\u2605 CRITICAL: DO NOT MODIFY THE BACKGROUND \u2605\u2605\u2605\n' +
      'This photo shows a room. Do NOT alter walls, floor, ceiling, or lighting.\n' +
      'ONLY add kitchen furniture and appliances.\n\n' +
      'Wall dimensions: ' + wallW + 'mm \u00D7 ' + wallH + 'mm\n\n' +
      '[WATER SUPPLY \u2192 SINK POSITION]\n' +
      '  ' + waterMm + 'mm (' + waterPercent + '%) from left\n' +
      '  \u2192 Sink bowl center MUST be placed at ' + waterPercent + '% position\n\n' +
      '[EXHAUST DUCT \u2192 COOKTOP POSITION]\n' +
      '  ' + exhaustMm + 'mm (' + exhaustPercent + '%) from left\n' +
      '  \u2192 Cooktop + Range hood center MUST be placed at ' + exhaustPercent + '% position\n\n' +
      '\u2605\u2605\u2605 CONCEALED RANGE HOOD \u2605\u2605\u2605\n' +
      DUCT_RULES + '\n' +
      '[REQUIRED COMPONENTS]\n' +
      '\u2713 Sink Bowl \u2014 stainless steel, at ' + waterPercent + '% position\n' +
      '\u2713 Faucet \u2014 behind sink bowl\n' +
      '\u2713 Cooktop \u2014 at ' + exhaustPercent + '% position\n' +
      '\u2713 Range Hood \u2014 BUILT-IN CONCEALED inside upper cabinet\n' +
      '\u2713 Lower Cabinets \u2014 height 870mm from floor\n' +
      '\u2713 Upper Cabinets \u2014 FLUSH with ceiling (NO gap)\n' +
      '\u2713 Toe Kick \u2014 below lower cabinets\n\n' +
      MATERIALS_STYLE +
      '[PROHIBITED]\n' +
      BASE_PROHIBITED +
      '- NO exposed duct pipe, silver tube, or ventilation pipe\n' +
      '- NO exposed/chimney/wall-mount range hood\n' +
      '- NO gap between upper cabinets and ceiling\n' +
      '- Sink cabinet door MUST be completely closed\n' +
      EXTRA_RESTRICT;
  }

} else {
  // ─── NON-KITCHEN CATEGORIES ───
  const categoryConfigs = {
    wardrobe: {
      task: 'BUILT-IN WARDROBE',
      layout: '- Full-width built-in wardrobe covering the entire wall\n' +
        '- Floor-to-ceiling installation (no gap at top or bottom)\n' +
        '- Multiple sections with hinged or sliding doors\n' +
        '- Interior: hanging rod + shelf + drawer sections\n' +
        '- All doors CLOSED in this rendering',
      rules: QUALITY_RULES + '- Handles aligned horizontally across all doors\n',
      extra_prohibit: '- No glass-front doors unless specified\n'
    },
    shoe_cabinet: {
      task: 'SHOE CABINET',
      layout: '- Slim profile shoe cabinet (300-400mm depth)\n' +
        '- Floor-to-ceiling or partial height as appropriate\n' +
        '- Internal tilted shoe shelves (15-20\u00B0 angle)\n' +
        '- All doors CLOSED, clean minimal door fronts',
      rules: '- Photorealistic quality with proper shadows\n' +
        '- Slim proportions \u2014 must NOT look deep/bulky\n' +
        '- Consistent door gaps and handle alignment\n',
      extra_prohibit: '- Cabinet depth must not exceed 400mm visual appearance\n'
    },
    fridge_cabinet: {
      task: 'REFRIGERATOR CABINET',
      layout: '- Center: refrigerator opening (~700mm wide \u00D7 1800mm tall)\n' +
        '- Side panels: tall storage cabinets flanking the refrigerator\n' +
        '- Upper: bridge cabinet above refrigerator opening\n' +
        '- Floor-to-ceiling installation\n' +
        '- All cabinet doors CLOSED in this rendering',
      rules: QUALITY_RULES +
        '- Refrigerator opening clearly defined and centered\n' +
        '- Side cabinets symmetrical\n',
      extra_prohibit: '- Do NOT render a refrigerator \u2014 only the cabinet surround\n'
    },
    vanity: {
      task: 'BATHROOM VANITY',
      layout: '- Lower: vanity cabinet with integrated sink basin\n' +
        '- Sink position: aligned at ' + waterPercent + '% from left (water supply)\n' +
        '- Upper: mirror cabinet above vanity\n' +
        '- Faucet: single-lever mixer, chrome or matte finish\n' +
        '- Countertop: extending full width of vanity',
      rules: '- Photorealistic quality with proper reflections on mirror\n' +
        '- Sink aligned with water supply position\n' +
        '- Mirror cabinet proportional to vanity below\n' +
        '- Realistic water fixture and basin details\n',
      extra_prohibit: ''
    },
    storage: {
      task: 'STORAGE CABINET',
      layout: '- Built-in storage cabinet covering the wall\n' +
        '- Floor-to-ceiling installation\n' +
        '- Multiple door sections with adjustable interior shelves\n' +
        '- All doors CLOSED in this rendering',
      rules: QUALITY_RULES,
      extra_prohibit: ''
    }
  };

  const catCfgKey = category === 'fridge' ? 'fridge_cabinet' : category;
  const cfg = categoryConfigs[catCfgKey] || categoryConfigs.storage;

  furniturePrompt = '[TASK: PHOTOREALISTIC ' + cfg.task + ' RENDERING]\n\n' +
    PRESERVE_BG + '\n\n' +
    '[' + cfg.task + ' LAYOUT]\n' +
    WALL_DIM + '\n' +
    cfg.layout + '\n\n' +
    MATERIALS_STYLE +
    '\u2605\u2605\u2605 RENDERING RULES \u2605\u2605\u2605\n' +
    cfg.rules + '\n' +
    '[PROHIBITED]\n' +
    BASE_PROHIBITED +
    cfg.extra_prohibit +
    EXTRA_RESTRICT;
}

// ═══ 3. OPEN DOOR PROMPT (English) ═══
const CATEGORY_CONTENTS = {
  wardrobe: '- Shirts, blouses, jackets, coats on hanging rods\n- Folded sweaters, knits, t-shirts on shelves\n- Jeans, pants on hangers or shelves\n- Underwear, socks in drawer organizers\n- Bags, hats, scarves as accessories',
  sink: '- Plates, bowls, dishes on shelves\n- Cups, mugs, glasses\n- Pots, pans, cooking utensils\n- Spice jars, oil bottles\n- Cutting boards, spatulas, ladles\n[UNDER SINK \u2014 MANDATORY]\n- Drain pipe (P-trap/S-trap)\n- Water supply pipes (hot/cold)\n- Water distributor (angle valves)\n[UNDER SINK \u2014 FORBIDDEN]\n\u274C NO trash cans, detergent, cleaning supplies, or clutter',
  fridge: '- Coffee machine, microwave\n- Toaster, blender\n- Groceries, cereal boxes\n- Cups, mugs\n- Snacks, beverages',
  vanity: '- Cosmetics, skincare products\n- Makeup brushes, pouches\n- Perfume, lotion, cream\n- Hair dryer, curling iron\n- Towels, toiletries',
  shoe: '- Sneakers, athletic shoes\n- Dress shoes, loafers, heels\n- Sandals, slippers\n- Boots, rain boots\n- Shoe care supplies',
  storage: '- Books, magazines, documents\n- Storage boxes, baskets\n- Bedding, blankets\n- Luggage, suitcases\n- Seasonal items'
};

const CATEGORY_FORBIDDEN = {
  wardrobe: '\u274C NO dishes or kitchen items (wardrobe = clothing only)',
  sink: '\u274C NO clothing (kitchen = kitchenware only)',
  fridge: '\u274C NO clothing (fridge cabinet = appliances/food only)',
  vanity: '\u274C NO clothing or kitchen items (vanity = cosmetics only)',
  shoe: '\u274C NO clothing or dishes (shoe cabinet = shoes only)',
  storage: '\u274C NO food items (storage = storage supplies only)'
};

const catKey = category === 'fridge_cabinet' ? 'fridge' : (category === 'shoe_cabinet' ? 'shoe' : category);
const contents = CATEGORY_CONTENTS[catKey] || CATEGORY_CONTENTS.storage;
const forbidden = CATEGORY_FORBIDDEN[catKey] || CATEGORY_FORBIDDEN.storage;
const sinkExtra = category === 'sink' ? '- Sink bowl, faucet, cooktop, hood positions: DO NOT change\n' : '';

const openPrompt =
  '[IMAGE EDITING \u2014 NOT REGENERATION]\n' +
  'Do NOT regenerate this image. EDIT the existing image to show doors in OPEN state only.\n' +
  '\u2605 Furniture appearance (size, color, material, position) \u2014 keep 100% identical\n' +
  '\u2605 Background (walls, floor, ceiling, lighting) \u2014 keep 100% identical\n' +
  '\u2605 Camera angle, perspective, viewpoint \u2014 keep 100% identical\n\n' +
  '[DO NOT CHANGE] \u2605\u2605\u2605\n' +
  '- Door count: maintain EXACT number of doors from the closed image\n' +
  '- Door position/size/ratio: keep identical\n' +
  '- Door color/material: do NOT change\n' +
  '- Overall furniture size and shape: do NOT change\n' +
  sinkExtra + '\n' +
  '[CRITICAL \u2014 DOOR STRUCTURE RULES]\n' +
  '- NEVER add or remove doors\n' +
  '- NEVER merge or split doors\n' +
  '- Follow the exact door division lines from the closed state\n' +
  '- Each door must open independently\n\n' +
  '[CHANGE ONLY \u2014 DOOR STATE]\n' +
  'Swing doors: rotate 90\u00B0 outward on hinges from current position\n' +
  'Drawers: pull forward 30-40% from current position\n' +
  'Do NOT open swing doors like drawers or drawers like swing doors.\n\n' +
  '[INTERIOR CONTENTS \u2014 ' + category + ']\n' +
  contents + '\n\n' +
  '[CATEGORY RESTRICTIONS]\n' +
  forbidden + '\n\n' +
  '[ABSOLUTELY FORBIDDEN]\n' +
  '\u274C No dimension labels, text, or numbers\n' +
  '\u274C No background or room element changes\n' +
  '\u274C No camera angle changes\n' +
  '\u274C No door type changes (swing\u2194drawer)\n' +
  '\u274C No adding/removing/merging/splitting doors\n\n' +
  '[OUTPUT]\n' +
  '- Door structure 100% matching the closed image\n' +
  '- Photorealistic interior photo quality\n' +
  '- Neatly organized storage contents (not messy)';

// ═══ COMPRESSED PROMPT (<500 chars for n8n Cloud + Gemini) ═══
let compressedPrompt = '';
const doorDesc = (upperColor || 'white') + ' ' + (upperFinish || 'matte');
const ctDesc = input.styleCountertopPrompt || countertopColor || 'white stone';

if (isKitchen && hasBlueprint && hasModules && modules) {
  const lCompact = modules.lower.map(m => {
    if (m.hasSink || m.has_sink) return 'sink';
    if (m.hasCooktop || m.has_cooktop) return 'cooktop';
    return m.width_mm + '';
  }).join(', ');
  compressedPrompt = 'Place ' + doorDesc + ' kitchen cabinets on this photo. PRESERVE background EXACTLY.\n' +
    wallW + 'x' + wallH + 'mm wall. Sink at ' + waterPercent + '%, cooktop at ' + exhaustPercent + '%.\n' +
    modules.upper.length + ' upper flush ceiling. ' + modules.lower.length + ' lower (' + lCompact + ').\n' +
    ctDesc + '. ' + handleType + '. ' + styleLabel + '. Photorealistic. Concealed hood.';
} else if (isKitchen) {
  compressedPrompt = 'Place ' + doorDesc + ' kitchen cabinets on this photo. PRESERVE background EXACTLY.\n' +
    wallW + 'x' + wallH + 'mm wall. Sink at ' + waterPercent + '%, cooktop at ' + exhaustPercent + '%.\n' +
    ctDesc + '. ' + handleType + '. ' + styleLabel + '. Photorealistic. Concealed hood.';
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
  kitchenLayout: isKitchen ? kitchenLayout : undefined,
  cleanedBackground: roomImage,
  imageType,
  wallData: input.wallData,
  cabinetSpecs,
  modules,
  furniturePlacement: input.furniturePlacement,
  furniturePrompt,
  compressedPrompt,
  openPrompt,
  hasBlueprint,
  hasModules,
  renderingMode: hasBlueprint ? 'blueprint' : (isKitchen ? 'fallback' : category),
  hasCleanedBackground: true
}];
