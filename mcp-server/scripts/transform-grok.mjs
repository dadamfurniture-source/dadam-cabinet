#!/usr/bin/env node
/**
 * transform-grok.mjs
 * Transforms v8-claude-analysis-vars.json from Gemini to Grok image generation API.
 *
 * Changes:
 * 1. Build Cleanup Prompt: geminiCleanupBody → grokCleanupBody (Grok editing format)
 * 2. Gemini Background Cleanup HTTP → Grok Background Cleanup (URL, auth, body)
 * 3. Parse BG + Build Furniture: Grok response parsing + grokFurnitureBody
 *    - Blueprint mode: 1-image + text layout description (no 2nd blueprint image)
 * 4. Gemini Furniture HTTP → Grok Furniture
 * 5. Parse Furniture + Prep Open: Grok response parsing + grokOpenBody
 * 6. Gemini Open Door HTTP → Grok Open Door
 * 7. Format Response (All): Grok response parsing
 * 8. Connections: Gemini → Grok node name renames
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
const outputPath = inputPath; // overwrite in place

const wf = JSON.parse(readFileSync(inputPath, 'utf-8'));

// ────────────────────────────────────────────
// Helper: find node by name
// ────────────────────────────────────────────
function findNode(name) {
  return wf.nodes.find(n => n.name === name);
}

// ════════════════════════════════════════════════════════════════
// 1. Build Cleanup Prompt — body format change
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Build Cleanup Prompt');
  if (!node) throw new Error('Node "Build Cleanup Prompt" not found');

  // Replace the Gemini body creation and return statement
  let code = node.parameters.jsCode;

  // Replace geminiCleanupBody creation block
  code = code.replace(
    /const geminiCleanupBody = \{[\s\S]*?\};\s*\n\nreturn \{[\s\S]*?geminiCleanupBody:[\s\S]*?\};/,
    `const grokCleanupBody = {
  model: 'grok-imagine-image',
  prompt: cleanupPrompt,
  image: {
    url: 'data:' + (input.imageType || 'image/jpeg') + ';base64,' + input.roomImage,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};

return {
  grokCleanupBody: JSON.stringify(grokCleanupBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: input.coordinateFrame,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  layoutImage: input.layoutImage,
  layoutData: input.layoutData,
  maskImage: input.maskImage,
  modules: input.modules,
  referenceImages: input.referenceImages,
  materialDescriptions: input.materialDescriptions,
  hasBlueprint: input.hasBlueprint,
  hasMask: input.hasMask,
  hasModules: input.hasModules
};`
  );

  node.parameters.jsCode = code;
  console.log('[1] Build Cleanup Prompt: geminiCleanupBody → grokCleanupBody ✓');
}

// ════════════════════════════════════════════════════════════════
// 2. Gemini Background Cleanup HTTP → Grok Background Cleanup
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Gemini Background Cleanup');
  if (!node) throw new Error('Node "Gemini Background Cleanup" not found');

  node.name = 'Grok Background Cleanup';
  node.parameters = {
    method: 'POST',
    url: 'https://api.x.ai/v1/images/edits',
    sendQuery: false,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{ $vars.XAI_API_KEY }}' },
        { name: 'Content-Type', value: 'application/json' }
      ]
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: '={{ $json.grokCleanupBody }}',
    options: { timeout: 120000 }
  };

  console.log('[2] Gemini Background Cleanup → Grok Background Cleanup ✓');
}

// ════════════════════════════════════════════════════════════════
// 3. Parse BG + Build Furniture — major changes
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Parse BG + Build Furniture');
  if (!node) throw new Error('Node "Parse BG + Build Furniture" not found');

  node.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Background + Build Furniture Prompt v5 - Grok Editing API
// ═══════════════════════════════════════════════════════════════
const input = $('Build Cleanup Prompt').first().json;
const response = $input.first().json;
const analysis = input.analysisResult;
const cf = input.coordinateFrame;
const clientPrompt = input.clientPrompt || '';
const negativePrompt = input.negativePrompt || '';
const cabinetSpecs = input.cabinetSpecs || {};

// Blueprint data
const layoutImage = input.layoutImage || '';
const layoutData = input.layoutData || null;
const maskImage = input.maskImage || '';
const modules = input.modules || null;
const referenceImages = input.referenceImages || [];
const materialDescriptions = input.materialDescriptions || [];
const hasBlueprint = input.hasBlueprint;
const hasMask = input.hasMask;
const hasModules = input.hasModules;

// Parse cleaned background from Grok response
let cleanedBackground = null;
try {
  const data = response.data || [];
  if (data.length > 0 && data[0].b64_json) {
    cleanedBackground = data[0].b64_json;
  }
} catch (e) { console.log('Parse error:', e.message); }

const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;
const wb = cf && cf.wall_boundaries ? cf.wall_boundaries : { width_mm: 3000, height_mm: 2400, mm_per_unit_x: 3.0, mm_per_unit_y: 2.4 };

// 2D coordinates
const wsCenter = cf && cf.utilities && cf.utilities.water_supply && cf.utilities.water_supply.center
  ? cf.utilities.water_supply.center : { x: waterPercent * 10, y: 880 };
const edCenter = cf && cf.utilities && cf.utilities.exhaust_duct && cf.utilities.exhaust_duct.center
  ? cf.utilities.exhaust_duct.center : { x: exhaustPercent * 10, y: 85 };

// mm values
const wsMm = {
  x: Math.round(wsCenter.x * (wb.mm_per_unit_x || wb.width_mm / 1000)),
  y: Math.round(wsCenter.y * (wb.mm_per_unit_y || wb.height_mm / 1000))
};
const edMm = {
  x: Math.round(edCenter.x * (wb.mm_per_unit_x || wb.width_mm / 1000)),
  y: Math.round(edCenter.y * (wb.mm_per_unit_y || wb.height_mm / 1000))
};

const styleLabel = input.style || 'Modern Minimal';
let furniturePrompt;
let grokFurnitureBody;

// ═══════════════════════════════════════════════════════════════
// BLUEPRINT MODE — 1-image (cleaned BG) + text layout description
// Grok editing API only supports 1 image input, so blueprint
// positions are conveyed via detailed text description.
// ═══════════════════════════════════════════════════════════════
if (hasBlueprint) {

  // --- Material color/finish Korean→English translation ---
  const colorMap = {
    '화이트':'pure white', '그레이':'gray', '블랙':'matte black',
    '오크':'natural oak wood', '월넛':'dark walnut wood', '스노우':'snow white',
    '마블화이트':'white marble', '그레이마블':'gray marble', '차콜':'charcoal',
    '베이지':'beige', '네이비':'navy blue'
  };
  const finishMap = { '무광':'matte', '유광':'glossy', '엠보':'embossed' };

  function translateColor(korean) {
    if (!korean) return '';
    return colorMap[korean] || korean;
  }
  function translateFinish(korean) {
    if (!korean) return 'matte';
    return finishMap[korean] || korean;
  }

  // --- Build precise module layout text from modules + layoutData ---
  const ld = layoutData;
  const totalW = ld && ld.totalW_mm ? ld.totalW_mm : (wb.width_mm || 3000);
  const totalH = wb.height_mm || 2400;
  let layoutText = '[PRECISE CABINET LAYOUT — MUST FOLLOW EXACTLY]\\n';
  layoutText += 'Wall: ' + totalW + 'mm wide × ' + totalH + 'mm tall\\n\\n';

  if (hasModules && modules) {
    // Upper cabinets
    if (modules.upper && modules.upper.length > 0) {
      const upperTop = ld && ld.upper ? (ld.upper.y * 100).toFixed(1) : '2.5';
      const upperBottom = ld && ld.upper ? ((ld.upper.y + ld.upper.h) * 100).toFixed(1) : '32.5';
      layoutText += '[UPPER CABINETS] top ' + upperTop + '%~' + upperBottom + '% of wall height, left to right:\\n';
      let accX = 0;
      modules.upper.forEach((m, i) => {
        const wNorm = ld && ld.upper && ld.upper.modules && ld.upper.modules[i]
          ? ld.upper.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xStart = (accX * 100).toFixed(1);
        accX += wNorm;
        const xEnd = (accX * 100).toFixed(1);
        const typeStr = m.type || 'door';
        const doorCount = m.door_count || m.doorCount || 1;
        layoutText += '  ' + (i+1) + '. x: ' + xStart + '~' + xEnd + '%, ' + wMm + 'mm wide, ' + doorCount + '-' + typeStr + ' cabinet\\n';
      });
      layoutText += '  (total upper: ' + modules.upper.length + ' modules, flush with ceiling)\\n\\n';
    }
    // Lower cabinets
    if (modules.lower && modules.lower.length > 0) {
      const lowerTop = ld && ld.lower ? (ld.lower.y * 100).toFixed(1) : '65.8';
      const lowerBottom = ld && ld.lower ? ((ld.lower.y + ld.lower.h) * 100).toFixed(1) : '100';
      layoutText += '[LOWER CABINETS] bottom ' + lowerTop + '%~' + lowerBottom + '% of wall height, left to right:\\n';
      let accX = 0;
      modules.lower.forEach((m, i) => {
        const wNorm = ld && ld.lower && ld.lower.modules && ld.lower.modules[i]
          ? ld.lower.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xStart = (accX * 100).toFixed(1);
        accX += wNorm;
        const xEnd = (accX * 100).toFixed(1);
        const typeStr = m.type || 'door';
        const doorCount = m.door_count || m.doorCount || 1;
        let extras = '';
        if (m.hasSink || m.has_sink) extras += ' [SINK at center]';
        if (m.hasCooktop || m.has_cooktop) extras += ' [COOKTOP at center]';
        layoutText += '  ' + (i+1) + '. x: ' + xStart + '~' + xEnd + '%, ' + wMm + 'mm wide, ' + doorCount + '-' + typeStr + extras + '\\n';
      });
      layoutText += '\\n';
    }
  }

  // Countertop and toe kick positions from layoutData
  if (ld && ld.countertop) {
    layoutText += 'Countertop: thin strip at ' + (ld.countertop.y * 100).toFixed(1) + '% height\\n';
  }
  if (ld && ld.toeKick) {
    layoutText += 'Toe kick: dark strip at very bottom (~' + (ld.toeKick.h * 100).toFixed(0) + '%)\\n';
  }

  // --- Translate cabinet spec colors ---
  const upperColor = translateColor(cabinetSpecs.door_color_upper);
  const upperFinish = translateFinish(cabinetSpecs.door_finish_upper);
  const lowerColor = translateColor(cabinetSpecs.door_color_lower);
  const lowerFinish = translateFinish(cabinetSpecs.door_finish_lower);
  const countertopColor = translateColor(cabinetSpecs.countertop_color);
  const handleType = cabinetSpecs.handle_type || 'hidden (push-to-open)';

  // --- Material description text ---
  let materialText = '';
  if (upperColor) materialText += 'Upper doors: ' + upperColor + ' ' + upperFinish + '\\n';
  if (lowerColor) materialText += 'Lower doors: ' + lowerColor + ' ' + lowerFinish + '\\n';
  if (countertopColor) materialText += 'Countertop: ' + countertopColor + '\\n';
  materialText += 'Handle: ' + handleType + '\\n';
  if (materialDescriptions && materialDescriptions.length > 0) {
    materialText += 'Additional: ' + materialDescriptions.join(', ') + '\\n';
  }

  furniturePrompt = '[TASK: BLUEPRINT-GUIDED PHOTOREALISTIC FURNITURE RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n' +
    'Place furniture according to the PRECISE CABINET LAYOUT below.\\n\\n' +
    layoutText + '\\n' +
    '★★★ RENDERING RULES (MANDATORY) ★★★\\n' +
    '1. PRESERVE the cleaned background EXACTLY — do NOT modify walls, floor, or ceiling\\n' +
    '2. Place furniture ONLY where the layout description specifies\\n' +
    '3. Match the EXACT proportions and positions from the layout\\n' +
    '4. Each module\\'s WIDTH RATIO must match the layout precisely\\n' +
    '5. Upper cabinets must be flush with ceiling\\n' +
    '6. Drawers and doors must match the count specified\\n' +
    '7. Handles must match the type specified in materials\\n' +
    '8. Sink and cooktop positions must match the layout exactly\\n\\n' +
    '★★★ PHOTOREALISTIC QUALITY ★★★\\n' +
    '- Add realistic shadows, reflections, and ambient lighting\\n' +
    '- Apply proper material textures (wood grain, stone pattern, stainless steel)\\n' +
    '- Show realistic edge profiles and panel gaps (2-3mm between doors)\\n' +
    '- Natural lighting from windows/ceiling as visible in the background\\n' +
    '- Subtle shadow under upper cabinets onto backsplash\\n' +
    '- Slight reflection on glossy surfaces, matte diffusion on matte surfaces\\n' +
    '- Realistic toe kick shadow on floor\\n\\n' +
    '★★★ RANGE HOOD — BUILT-IN CONCEALED TYPE ONLY ★★★\\n' +
    'The range hood MUST be fully concealed inside the upper cabinet.\\n' +
    'NO exposed hood duct pipes or external ductwork visible.\\n' +
    'NO silver/metallic ventilation pipes on wall or ceiling.\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '[PROHIBITED]\\n' +
    '- Do NOT change positions or proportions from the layout\\n' +
    '- Do NOT modify the background/wall/floor\\n' +
    '- No text, labels, or dimension markings\\n' +
    '- NO exposed hood duct or ventilation pipe\\n' +
    '- NO visible exhaust pipe or silver/metallic duct tube\\n' +
    '- NO floating or detached furniture elements\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

  grokFurnitureBody = {
    model: 'grok-imagine-image',
    prompt: furniturePrompt,
    image: {
      url: 'data:image/png;base64,' + cleanedBackground,
      type: 'image_url'
    },
    n: 1,
    response_format: 'b64_json'
  };

// ═══════════════════════════════════════════════════════════════
// FALLBACK MODE — text-only (existing behavior, no blueprint)
// ═══════════════════════════════════════════════════════════════
} else {

  furniturePrompt = '[TASK: FURNITURE PLACEMENT — AI-ANALYZED UTILITY POSITIONS]\\n\\n' +
    '★★★ CRITICAL: DO NOT MODIFY THE BACKGROUND ★★★\\n' +
    'This image is a cleaned background. Do NOT alter walls, floor, ceiling, or lighting.\\n' +
    'ONLY add kitchen furniture and appliances.\\n\\n' +
    '═══════════════════════════════════════════════════════════════\\n' +
    '★★★ PLACEMENT COORDINATES ★★★\\n' +
    '═══════════════════════════════════════════════════════════════\\n\\n' +
    'Wall dimensions: ' + wb.width_mm + 'mm × ' + wb.height_mm + 'mm\\n\\n' +
    '[ANCHOR POINT 1: Water Supply → Sink Center]\\n' +
    '  Grid position: x=' + wsCenter.x + '/1000, y=' + wsCenter.y + '/1000\\n' +
    '  Millimeters:   ' + wsMm.x + 'mm from left, ' + wsMm.y + 'mm from top\\n' +
    '  Percentage:    ' + waterPercent + '% from left edge\\n' +
    '  → Place SINK BOWL center exactly at ' + waterPercent + '% from left\\n\\n' +
    '[ANCHOR POINT 2: Exhaust Duct → Cooktop Center]\\n' +
    '  Grid position: x=' + edCenter.x + '/1000, y=' + edCenter.y + '/1000\\n' +
    '  Millimeters:   ' + edMm.x + 'mm from left, ' + edMm.y + 'mm from top\\n' +
    '  Percentage:    ' + exhaustPercent + '% from left edge\\n' +
    '  → Place COOKTOP center exactly at ' + exhaustPercent + '% from left\\n\\n' +
    '★★★ RANGE HOOD — BUILT-IN CONCEALED TYPE ONLY ★★★\\n' +
    'The range hood MUST be fully concealed inside the upper cabinet.\\n' +
    'NO exposed hood duct pipes or external ductwork visible.\\n\\n' +
    '[REQUIRED COMPONENTS]\\n' +
    '✓ Sink Bowl — stainless steel, at ' + waterPercent + '% position\\n' +
    '✓ Faucet — behind sink bowl\\n' +
    '✓ Cooktop — at ' + exhaustPercent + '% position\\n' +
    '✓ Range Hood — BUILT-IN CONCEALED inside upper cabinet\\n' +
    '✓ Lower Cabinets — height 870mm from floor\\n' +
    '✓ Upper Cabinets — FLUSH with ceiling (NO gap)\\n' +
    '✓ Toe Kick — below lower cabinets\\n\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    (cabinetSpecs.door_color_upper ? '- Upper door color: ' + cabinetSpecs.door_color_upper + ' ' + (cabinetSpecs.door_finish_upper || 'matte') + '\\n' : '- Colors: white, gray, wood tones\\n') +
    (cabinetSpecs.door_color_lower ? '- Lower door color: ' + cabinetSpecs.door_color_lower + ' ' + (cabinetSpecs.door_finish_lower || 'matte') + '\\n' : '') +
    (cabinetSpecs.countertop_color ? '- Countertop: ' + cabinetSpecs.countertop_color + '\\n' : '') +
    (cabinetSpecs.handle_type ? '- Handle: ' + cabinetSpecs.handle_type + '\\n' : '- Handle: hidden (push-to-open)\\n') +
    '\\n[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- Do NOT add text, labels, or dimensions\\n' +
    '- NO exposed/chimney/wall-mount range hood\\n' +
    '- NO gap between upper cabinets and ceiling\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

  grokFurnitureBody = {
    model: 'grok-imagine-image',
    prompt: furniturePrompt,
    image: {
      url: 'data:image/png;base64,' + cleanedBackground,
      type: 'image_url'
    },
    n: 1,
    response_format: 'b64_json'
  };
}

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  grokFurnitureBody: JSON.stringify(grokFurnitureBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  coordinateFrame: cf,
  hasBlueprint: !!hasBlueprint,
  hasMask: !!hasMask,
  hasModules: !!hasModules,
  renderingMode: hasBlueprint ? 'blueprint' : 'fallback',
  layoutData: layoutData
}];`;

  console.log('[3] Parse BG + Build Furniture: Grok response parsing + grokFurnitureBody ✓');
}

// ════════════════════════════════════════════════════════════════
// 4. Gemini Furniture HTTP → Grok Furniture
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Gemini Furniture');
  if (!node) throw new Error('Node "Gemini Furniture" not found');

  node.name = 'Grok Furniture';
  node.parameters = {
    method: 'POST',
    url: 'https://api.x.ai/v1/images/edits',
    sendQuery: false,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{ $vars.XAI_API_KEY }}' },
        { name: 'Content-Type', value: 'application/json' }
      ]
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: '={{ $json.grokFurnitureBody }}',
    options: { timeout: 120000 }
  };

  console.log('[4] Gemini Furniture → Grok Furniture ✓');
}

// ════════════════════════════════════════════════════════════════
// 5. Parse Furniture + Prep Open — response parsing + body format
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Parse Furniture + Prep Open');
  if (!node) throw new Error('Node "Parse Furniture + Prep Open" not found');

  node.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Furniture + Prep Open Door v4 - Grok Editing API
// ═══════════════════════════════════════════════════════════════
const input = $('Parse BG + Build Furniture').first().json;
const response = $input.first().json;
const analysis = input.analysisResult;
const cf = input.coordinateFrame;

// Parse furniture image from Grok response
let closedImage = null;
try {
  const data = response.data || [];
  if (data.length > 0 && data[0].b64_json) {
    closedImage = data[0].b64_json;
  }
} catch (e) { console.log('Parse error:', e.message); }

const openPrompt = '[TASK: OPEN DOORS AND DRAWERS]\\n\\n' +
  '★★★ PRESERVE EVERYTHING — ONLY OPEN DOORS ★★★\\n\\n' +
  '[DO NOT CHANGE]\\n' +
  '- Background (walls, floor, ceiling)\\n' +
  '- Furniture position, size, and color\\n' +
  '- Camera angle\\n' +
  '- Lighting\\n' +
  '- Range hood must remain CONCEALED inside upper cabinet (no exposed ductwork)\\n\\n' +
  '[CHANGES TO MAKE]\\n' +
  '- Hinged doors: Open outward to approximately 90 degrees\\n' +
  '- Drawers: Pull out 30-40%\\n' +
  '- Show interior storage items\\n\\n' +
  '[INTERIOR ITEMS TO SHOW]\\n' +
  '- Plates, bowls, cups in upper cabinets\\n' +
  '- Pots, pans, cooking utensils in lower cabinets\\n' +
  '- Spice containers, condiments\\n\\n' +
  '★★★ DUCT CONCEALMENT CHECK ★★★\\n' +
  'Verify: The range hood area must still show NO exposed duct pipes.\\n' +
  'The upper cabinet above the cooktop must appear as a normal cabinet, even when open.\\n' +
  'No silver/metallic pipes visible anywhere.\\n\\n' +
  '[OUTPUT]\\n' +
  '- Same furniture, doors open\\n' +
  '- Photorealistic quality\\n' +
  '- Interior items visible\\n' +
  '- No exposed ductwork';

const grokOpenBody = {
  model: 'grok-imagine-image',
  prompt: openPrompt,
  image: {
    url: 'data:image/png;base64,' + closedImage,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};

return [{
  cleanedBackground: input.cleanedBackground,
  closedImage,
  hasClosedImage: !!closedImage,
  grokOpenBody: JSON.stringify(grokOpenBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  coordinateFrame: cf,
  hasBlueprint: input.hasBlueprint || false,
  hasMask: input.hasMask || false,
  renderingMode: input.renderingMode || 'fallback',
  layoutData: input.layoutData || null
}];`;

  console.log('[5] Parse Furniture + Prep Open: Grok response parsing + grokOpenBody ✓');
}

// ════════════════════════════════════════════════════════════════
// 6. Gemini Open Door HTTP → Grok Open Door
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Gemini Open Door');
  if (!node) throw new Error('Node "Gemini Open Door" not found');

  node.name = 'Grok Open Door';
  node.parameters = {
    method: 'POST',
    url: 'https://api.x.ai/v1/images/edits',
    sendQuery: false,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{ $vars.XAI_API_KEY }}' },
        { name: 'Content-Type', value: 'application/json' }
      ]
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: '={{ $json.grokOpenBody }}',
    options: { timeout: 120000 }
  };

  console.log('[6] Gemini Open Door → Grok Open Door ✓');
}

// ════════════════════════════════════════════════════════════════
// 7. Format Response (All) — Grok response parsing
// ════════════════════════════════════════════════════════════════
{
  const node = findNode('Format Response (All)');
  if (!node) throw new Error('Node "Format Response (All)" not found');

  node.parameters.jsCode = `const input = $('Parse Furniture + Prep Open').first().json;
const openResponse = $input.first().json;
const analysis = input.analysisResult;
const cf = input.coordinateFrame;

// Parse open door image from Grok response
let openImage = null;
try {
  const data = openResponse.data || [];
  if (data.length > 0 && data[0].b64_json) {
    openImage = data[0].b64_json;
  }
} catch (e) { console.log('Parse error:', e.message); }

return [{
  success: true,
  message: 'Claude analysis + 3-stage image generation complete',
  processing: 'claude-analysis-2d + 3-stage-generation',
  category: input.category,
  style: input.style,
  pipe_analysis: {
    method: 'claude',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    confidence: analysis.confidence,
    coordinate_frame: cf || null,
    rendering_mode: input.renderingMode || 'fallback',
    has_blueprint: input.hasBlueprint || false,
    has_mask: input.hasMask || false,
    layout_data: input.layoutData || null
  },
  generated_image: {
    background: { base64: input.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background' },
    closed: { base64: input.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture added (closed)' },
    open: { base64: openImage, mime_type: 'image/png', description: 'Stage 3: Doors open' }
  }
}];`;

  console.log('[7] Format Response (All): Grok response parsing ✓');
}

// ════════════════════════════════════════════════════════════════
// 8. Connections — Gemini → Grok node name renames
// ════════════════════════════════════════════════════════════════
{
  const renameMap = {
    'Gemini Background Cleanup': 'Grok Background Cleanup',
    'Gemini Furniture': 'Grok Furniture',
    'Gemini Open Door': 'Grok Open Door'
  };

  const connStr = JSON.stringify(wf.connections);
  let newConnStr = connStr;
  for (const [old, nw] of Object.entries(renameMap)) {
    newConnStr = newConnStr.split(JSON.stringify(old)).join(JSON.stringify(nw));
  }
  wf.connections = JSON.parse(newConnStr);

  console.log('[8] Connections: Gemini → Grok renames ✓');
}

// ════════════════════════════════════════════════════════════════
// Write output
// ════════════════════════════════════════════════════════════════
writeFileSync(outputPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log('\n✅ Transformation complete. Written to:', outputPath);
