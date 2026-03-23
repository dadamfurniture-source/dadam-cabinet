#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Blueprint-Guided Image Generation — Workflow Transformer
// Modifies v8-claude-analysis-vars.json Code nodes
// ═══════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(__dirname, '..', '..', 'n8n', 'v8-claude-analysis-vars.json');

const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'));

function findNode(name) {
  return workflow.nodes.find(n => n.name === name);
}

// ═══════════════════════════════════════════════════════════════
// 1. Parse Input — Add 6 blueprint fields + flags
// ═══════════════════════════════════════════════════════════════
const parseInput = findNode('Parse Input');
parseInput.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Input v6 - Blueprint Data Support
// ═══════════════════════════════════════════════════════════════
const body = $input.first().json.body || $input.first().json;

const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

// Normalize manual positions to 0-1000 grid
function normalizePosition(pos) {
  if (!pos) return null;
  const scale = (pos.x <= 100 && (!pos.y || pos.y <= 100)) ? 10 : 1;
  return {
    x: Math.round((pos.x || 0) * scale),
    y: pos.y != null ? Math.round(pos.y * scale) : null
  };
}

const rawManualPositions = body.manual_positions || null;
let manualPositions = null;
if (rawManualPositions) {
  manualPositions = {};
  if (rawManualPositions.water_pipe) {
    manualPositions.water_pipe = normalizePosition(rawManualPositions.water_pipe);
  }
  if (rawManualPositions.exhaust_duct) {
    manualPositions.exhaust_duct = normalizePosition(rawManualPositions.exhaust_duct);
  }
}

const clientPrompt = body.prompt || '';
const negativePrompt = body.negative_prompt || '';
const cabinetSpecs = body.cabinet_specs || {};

// Blueprint data from LayoutRenderer v2
const layoutImage = body.layout_image || '';
const layoutData = body.layout_data || null;
const maskImage = body.mask_image || '';
const modules = body.modules || null;
const referenceImages = body.reference_images || [];
const materialDescriptions = body.material_descriptions || [];

return {
  category,
  style,
  roomImage,
  imageType,
  manualPositions,
  hasManualPositions: !!(manualPositions && (manualPositions.water_pipe || manualPositions.exhaust_duct)),
  clientPrompt,
  negativePrompt,
  cabinetSpecs,
  layoutImage,
  layoutData,
  maskImage,
  modules,
  referenceImages,
  materialDescriptions,
  hasBlueprint: !!(layoutImage && layoutImage.length > 100),
  hasMask: !!(maskImage && maskImage.length > 100),
  hasModules: !!(modules && ((modules.upper && modules.upper.length > 0) || (modules.lower && modules.lower.length > 0)))
};`;

console.log('✅ Parse Input updated');

// ═══════════════════════════════════════════════════════════════
// 2. Build Claude Request — Pass-through new fields
// ═══════════════════════════════════════════════════════════════
const buildClaude = findNode('Build Claude Request');
const oldBuildClaudeReturn = `return {
  claudeRequestBody: JSON.stringify(claudeRequestBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  manualPositions: input.manualPositions,
  hasManualPositions: input.hasManualPositions
};`;

const newBuildClaudeReturn = `return {
  claudeRequestBody: JSON.stringify(claudeRequestBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  manualPositions: input.manualPositions,
  hasManualPositions: input.hasManualPositions,
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
};`;

buildClaude.parameters.jsCode = buildClaude.parameters.jsCode.replace(oldBuildClaudeReturn, newBuildClaudeReturn);
console.log('✅ Build Claude Request updated');

// ═══════════════════════════════════════════════════════════════
// 3. Parse Claude Result — Pass-through new fields
// ═══════════════════════════════════════════════════════════════
const parseClaude = findNode('Parse Claude Result');

// Replace the return statement to include blueprint fields
const oldParseClaudeReturn = `return [{
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult,
  coordinateFrame,
  validationWarnings: warnings,
  analysisMethod: hasManual ? 'manual' : 'claude'
}];`;

const newParseClaudeReturn = `return [{
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult,
  coordinateFrame,
  validationWarnings: warnings,
  analysisMethod: hasManual ? 'manual' : 'claude',
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
}];`;

parseClaude.parameters.jsCode = parseClaude.parameters.jsCode.replace(oldParseClaudeReturn, newParseClaudeReturn);
console.log('✅ Parse Claude Result updated');

// ═══════════════════════════════════════════════════════════════
// 4. Build Cleanup Prompt — Pass-through new fields
// ═══════════════════════════════════════════════════════════════
const buildCleanup = findNode('Build Cleanup Prompt');

const oldCleanupReturn = `return {
  geminiCleanupBody: JSON.stringify(geminiCleanupBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: input.coordinateFrame,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {}
};`;

const newCleanupReturn = `return {
  geminiCleanupBody: JSON.stringify(geminiCleanupBody),
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
};`;

buildCleanup.parameters.jsCode = buildCleanup.parameters.jsCode.replace(oldCleanupReturn, newCleanupReturn);
console.log('✅ Build Cleanup Prompt updated');

// ═══════════════════════════════════════════════════════════════
// 5. Parse BG + Build Furniture — MAJOR REWRITE
// ═══════════════════════════════════════════════════════════════
const parseBG = findNode('Parse BG + Build Furniture');
parseBG.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Background + Build Furniture Prompt v4 - Blueprint-Guided
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

// Parse cleaned background from Gemini response
let cleanedBackground = null;
try {
  const candidates = response.candidates || [];
  if (candidates.length > 0) {
    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.inlineData || part.inline_data) {
        cleanedBackground = (part.inlineData || part.inline_data).data;
      }
    }
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
let geminiFurnitureBody;

// ═══════════════════════════════════════════════════════════════
// BLUEPRINT MODE — 2-image (cleaned BG + blueprint)
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

  // --- Build module dimension text from modules + layoutData ---
  let moduleDataText = '';
  const ld = layoutData;
  if (hasModules && modules) {
    const totalW = ld && ld.totalW_mm ? ld.totalW_mm : (wb.width_mm || 3000);

    if (modules.upper && modules.upper.length > 0) {
      moduleDataText += '[UPPER CABINETS] left to right:\\n';
      modules.upper.forEach((m, i) => {
        const wMm = m.width_mm || (ld && ld.upper && ld.upper.modules && ld.upper.modules[i]
          ? Math.round(ld.upper.modules[i].w * totalW) : 600);
        const typeStr = m.type || 'door';
        const doorCount = m.door_count || m.doorCount || 1;
        moduleDataText += '  ' + (i+1) + '. ' + wMm + 'mm (' + doorCount + '-' + typeStr + ')\\n';
      });
    }
    if (modules.lower && modules.lower.length > 0) {
      moduleDataText += '[LOWER CABINETS] left to right:\\n';
      modules.lower.forEach((m, i) => {
        const wMm = m.width_mm || (ld && ld.lower && ld.lower.modules && ld.lower.modules[i]
          ? Math.round(ld.lower.modules[i].w * totalW) : 600);
        const typeStr = m.type || 'door';
        const doorCount = m.door_count || m.doorCount || 1;
        let extras = '';
        if (m.hasSink || m.has_sink) extras += ' [SINK]';
        if (m.hasCooktop || m.has_cooktop) extras += ' [COOKTOP]';
        moduleDataText += '  ' + (i+1) + '. ' + wMm + 'mm (' + doorCount + '-' + typeStr + ')' + extras + '\\n';
      });
    }
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

  furniturePrompt = \`[TASK: BLUEPRINT-GUIDED PHOTOREALISTIC FURNITURE RENDERING]

Image 1 = cleaned background photo (PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting)
Image 2 = precision front-view blueprint with exact module positions and proportions

★★★ BLUEPRINT LEGEND ★★★
- Each colored rectangle = one cabinet module at exact position and size
- Proportions are mathematically computed from real mm measurements
- Horizontal lines inside rectangles = drawers
- Vertical lines inside rectangles = door divisions
- Dark bottom strip = toe kick
- Thin middle strip = countertop surface
- Stainless rectangle on countertop = sink bowl position
- Black rectangle on countertop = cooktop position
- Dark gray top strip = crown molding (if present)
- Small bars on doors = handles (match the specified handle type)

★★★ RENDERING RULES (MANDATORY) ★★★
1. PRESERVE the cleaned background EXACTLY — do NOT modify walls, floor, or ceiling
2. Place furniture ONLY where the blueprint shows colored rectangles
3. Match the EXACT proportions and positions from the blueprint
4. Each module's WIDTH RATIO must match the blueprint precisely
5. Upper cabinets must be flush with ceiling (as shown in blueprint)
6. Drawers and doors must match the count shown in the blueprint
7. Handles must match the type specified in materials
8. Sink and cooktop positions must match the blueprint exactly

★★★ PHOTOREALISTIC QUALITY ★★★
- Add realistic shadows, reflections, and ambient lighting
- Apply proper material textures (wood grain, stone pattern, stainless steel)
- Show realistic edge profiles and panel gaps (2-3mm between doors)
- Natural lighting from windows/ceiling as visible in the background
- Subtle shadow under upper cabinets onto backsplash
- Slight reflection on glossy surfaces, matte diffusion on matte surfaces
- Realistic toe kick shadow on floor

★★★ RANGE HOOD — BUILT-IN CONCEALED TYPE ONLY ★★★
The range hood MUST be fully concealed inside the upper cabinet.
NO exposed hood duct pipes or external ductwork visible.
NO silver/metallic ventilation pipes on wall or ceiling.
The upper cabinet above the cooktop contains the hood — no separate hood visible.

\${moduleDataText ? '[MODULE DIMENSIONS]\\n' + moduleDataText + '\\n' : ''}[MATERIALS]
\${materialText}
[STYLE: \${styleLabel}]
\${clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : ''}
[PROHIBITED]
- Do NOT change positions or proportions from the blueprint
- Do NOT modify the background/wall/floor
- No text, labels, or dimension markings
- NO exposed hood duct or ventilation pipe
- NO visible exhaust pipe or silver/metallic duct tube
- NO floating or detached furniture elements
\${negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : ''}\`;

  // Build Gemini parts: text + cleaned BG + blueprint + optional reference images
  const parts = [
    { text: furniturePrompt },
    { inline_data: { mime_type: 'image/png', data: cleanedBackground } },
    { inline_data: { mime_type: 'image/png', data: layoutImage } }
  ];

  // Add reference images (max 2)
  if (referenceImages && referenceImages.length > 0) {
    for (const ref of referenceImages.slice(0, 2)) {
      if (ref && ref.data) {
        parts.push({ inline_data: { mime_type: ref.type || 'image/jpeg', data: ref.data } });
      }
    }
  }

  geminiFurnitureBody = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 }
  };

// ═══════════════════════════════════════════════════════════════
// FALLBACK MODE — text-only (existing behavior, no blueprint)
// ═══════════════════════════════════════════════════════════════
} else {

  furniturePrompt = \`[TASK: FURNITURE PLACEMENT — AI-ANALYZED UTILITY POSITIONS]

★★★ CRITICAL: DO NOT MODIFY THE BACKGROUND ★★★
This image is a cleaned background. Do NOT alter walls, floor, ceiling, or lighting.
ONLY add kitchen furniture and appliances.

═══════════════════════════════════════════════════════════════
★★★ PLACEMENT COORDINATES ★★★
═══════════════════════════════════════════════════════════════

Wall dimensions: \${wb.width_mm}mm × \${wb.height_mm}mm

[ANCHOR POINT 1: Water Supply → Sink Center]
  Grid position: x=\${wsCenter.x}/1000, y=\${wsCenter.y}/1000
  Millimeters:   \${wsMm.x}mm from left, \${wsMm.y}mm from top
  Percentage:    \${waterPercent}% from left edge
  → Place SINK BOWL center exactly at \${waterPercent}% from left

[ANCHOR POINT 2: Exhaust Duct → Cooktop Center]
  Grid position: x=\${edCenter.x}/1000, y=\${edCenter.y}/1000
  Millimeters:   \${edMm.x}mm from left, \${edMm.y}mm from top
  Percentage:    \${exhaustPercent}% from left edge
  → Place COOKTOP center exactly at \${exhaustPercent}% from left

★★★ RANGE HOOD — BUILT-IN CONCEALED TYPE ONLY ★★★
The range hood MUST be fully concealed inside the upper cabinet.
NO exposed hood duct pipes or external ductwork visible.

[REQUIRED COMPONENTS]
✓ Sink Bowl — stainless steel, at \${waterPercent}% position
✓ Faucet — behind sink bowl
✓ Cooktop — at \${exhaustPercent}% position
✓ Range Hood — BUILT-IN CONCEALED inside upper cabinet
✓ Lower Cabinets — height 870mm from floor
✓ Upper Cabinets — FLUSH with ceiling (NO gap)
✓ Toe Kick — below lower cabinets

[STYLE: \${styleLabel}]
\${clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt : ''}
\${cabinetSpecs.door_color_upper ? '- Upper door color: ' + cabinetSpecs.door_color_upper + ' ' + (cabinetSpecs.door_finish_upper || 'matte') : '- Colors: white, gray, wood tones'}
\${cabinetSpecs.door_color_lower ? '- Lower door color: ' + cabinetSpecs.door_color_lower + ' ' + (cabinetSpecs.door_finish_lower || 'matte') : ''}
\${cabinetSpecs.countertop_color ? '- Countertop: ' + cabinetSpecs.countertop_color : ''}
\${cabinetSpecs.handle_type ? '- Handle: ' + cabinetSpecs.handle_type : '- Handle: hidden (push-to-open)'}

[PROHIBITED]
- Do NOT modify background/walls/floor
- Do NOT add text, labels, or dimensions
- NO exposed/chimney/wall-mount range hood
- NO gap between upper cabinets and ceiling
\${negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : ''}\`;

  geminiFurnitureBody = {
    contents: [{
      parts: [
        { text: furniturePrompt },
        { inline_data: { mime_type: 'image/png', data: cleanedBackground } }
      ]
    }],
    generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 }
  };
}

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody),
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

console.log('✅ Parse BG + Build Furniture REWRITTEN (blueprint mode)');

// ═══════════════════════════════════════════════════════════════
// 6. Parse Furniture + Prep Open — Pass-through metadata
// ═══════════════════════════════════════════════════════════════
const parseFurniture = findNode('Parse Furniture + Prep Open');

const oldParseFurnitureReturn = `return [{
  cleanedBackground: input.cleanedBackground,
  closedImage,
  hasClosedImage: !!closedImage,
  geminiOpenBody: JSON.stringify(geminiOpenBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  coordinateFrame: cf
}];`;

const newParseFurnitureReturn = `return [{
  cleanedBackground: input.cleanedBackground,
  closedImage,
  hasClosedImage: !!closedImage,
  geminiOpenBody: JSON.stringify(geminiOpenBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  coordinateFrame: cf,
  hasBlueprint: input.hasBlueprint || false,
  hasMask: input.hasMask || false,
  renderingMode: input.renderingMode || 'fallback',
  layoutData: input.layoutData || null
}];`;

parseFurniture.parameters.jsCode = parseFurniture.parameters.jsCode.replace(oldParseFurnitureReturn, newParseFurnitureReturn);
console.log('✅ Parse Furniture + Prep Open updated');

// ═══════════════════════════════════════════════════════════════
// 7. Format Response (All) — Add rendering metadata
// ═══════════════════════════════════════════════════════════════
const formatAll = findNode('Format Response (All)');

const oldFormatAllReturn = `return [{
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
    coordinate_frame: cf || null
  },
  generated_image: {
    background: { base64: input.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background' },
    closed: { base64: input.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture added (closed)' },
    open: { base64: openImage, mime_type: 'image/png', description: 'Stage 3: Doors open' }
  }
}];`;

const newFormatAllReturn = `return [{
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

formatAll.parameters.jsCode = formatAll.parameters.jsCode.replace(oldFormatAllReturn, newFormatAllReturn);
console.log('✅ Format Response (All) updated');

// ═══════════════════════════════════════════════════════════════
// 8. Format Response (Closed) — Add rendering metadata
// ═══════════════════════════════════════════════════════════════
const formatClosed = findNode('Format Response (Closed)');

const oldFormatClosedReturn = `return [{
  success: true,
  message: 'Claude analysis + image generation complete (closed doors only)',
  processing: 'claude-analysis-2d + 2-stage-generation',
  category: input.category,
  style: input.style,
  pipe_analysis: {
    method: 'claude',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    confidence: analysis.confidence,
    coordinate_frame: cf || null
  },
  generated_image: {
    background: { base64: input.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background' },
    closed: { base64: input.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture added (closed)' },
    open: null
  }
}];`;

const newFormatClosedReturn = `return [{
  success: true,
  message: 'Claude analysis + image generation complete (closed doors only)',
  processing: 'claude-analysis-2d + 2-stage-generation',
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
    open: null
  }
}];`;

formatClosed.parameters.jsCode = formatClosed.parameters.jsCode.replace(oldFormatClosedReturn, newFormatClosedReturn);
console.log('✅ Format Response (Closed) updated');

// ═══════════════════════════════════════════════════════════════
// Write output
// ═══════════════════════════════════════════════════════════════
const output = JSON.stringify(workflow, null, 2);

// Validate JSON
try {
  JSON.parse(output);
  console.log('✅ JSON validation passed');
} catch (e) {
  console.error('❌ JSON validation FAILED:', e.message);
  process.exit(1);
}

// Validate each Code node's jsCode is non-empty
const codeNodes = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.code');
for (const node of codeNodes) {
  if (!node.parameters.jsCode || node.parameters.jsCode.length < 50) {
    console.error('❌ Node "' + node.name + '" has empty or too short jsCode');
    process.exit(1);
  }
  console.log('  ✓ ' + node.name + ': ' + node.parameters.jsCode.length + ' chars');
}

// Verify blueprint data flow
const parseBGCode = findNode('Parse BG + Build Furniture').parameters.jsCode;
const checks = [
  ['layoutImage extraction', parseBGCode.includes('input.layoutImage')],
  ['hasBlueprint branch', parseBGCode.includes('if (hasBlueprint)')],
  ['2-image Gemini parts', parseBGCode.includes('data: layoutImage')],
  ['colorMap translation', parseBGCode.includes('colorMap')],
  ['moduleDataText generation', parseBGCode.includes('moduleDataText')],
  ['fallback mode', parseBGCode.includes('FALLBACK MODE')],
  ['rendering rules in prompt', parseBGCode.includes('RENDERING RULES')],
  ['Image 2 = blueprint', parseBGCode.includes('Image 2 = precision')]
];
for (const [label, ok] of checks) {
  console.log(ok ? '  ✓ ' + label : '  ❌ ' + label + ' MISSING');
  if (!ok) process.exit(1);
}

writeFileSync(workflowPath, output, 'utf-8');
console.log('\n🎉 Workflow updated successfully: ' + workflowPath);
