#!/usr/bin/env node
/**
 * Transform v8-grok-analysis.json: Simplify prompt system
 * Remove: RAG Search, Build S3, Claude S3, Build S4, Claude S4, Format+QA
 * Add: Build Fixed Prompts (replaces Parse S3+Build Bodies), Format Response (new)
 * Modify: Parse Input, Build S1, Parse S1, Parse BG, Parse Furniture, error/closed formats
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));
console.log(`Read ${wf.nodes.length} nodes`);

function findNode(name) {
  const n = wf.nodes.find(n => n.name === name);
  if (!n) throw new Error(`Node not found: ${name}`);
  return n;
}

// ═══════════════════════════════════════════════════════════
// 1. Remove 5 nodes
// ═══════════════════════════════════════════════════════════
const REMOVE = [
  'Supabase RAG Search',
  'Build S3 Request',
  'Claude S3 Prompt Gen',
  'Build S4 Request',
  'Claude S4 QA',
  'Format Response + QA',
];
wf.nodes = wf.nodes.filter(n => !REMOVE.includes(n.name));
console.log(`Removed ${REMOVE.length} nodes, ${wf.nodes.length} remaining`);

// ═══════════════════════════════════════════════════════════
// 2. Modify Parse Input - remove RAG fields
// ═══════════════════════════════════════════════════════════
findNode('Parse Input').parameters.jsCode = `const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

return {
  category, style, roomImage, imageType,
  manual_positions: body.manual_positions || null,
  prompt: body.prompt || '',
  negative_prompt: body.negative_prompt || '',
  cabinet_specs: body.cabinet_specs || {},
  layout_image: body.layout_image || '',
  layout_data: body.layout_data || null,
  mask_image: body.mask_image || '',
  modules: body.modules || null,
  reference_images: body.reference_images || [],
  material_descriptions: body.material_descriptions || [],
  styleMoodPrompt: body.style_mood_prompt || '',
  styleDoorColor: body.style_door_color || '',
  styleDoorHex: body.style_door_hex || '',
  styleDoorFinish: body.style_door_finish || '',
  styleCountertopPrompt: body.style_countertop_prompt || '',
  styleHandlePrompt: body.style_handle_prompt || '',
  styleAccentPrompt: body.style_accent_prompt || ''
};`;

// ═══════════════════════════════════════════════════════════
// 3. Modify Build S1 Request - remove RAG, add style passthrough
// ═══════════════════════════════════════════════════════════
findNode('Build S1 Request').parameters.jsCode = `// Build S1 Request - Claude Vision S1 body (no RAG)
const input = $('Parse Input').first().json;
const category = input.category;
const style = input.style;
const roomImage = input.roomImage;
const imageType = input.imageType;

function normalizePosition(pos) {
  if (!pos) return null;
  const scale = (pos.x <= 100 && (!pos.y || pos.y <= 100)) ? 10 : 1;
  return { x: Math.round((pos.x || 0) * scale), y: pos.y != null ? Math.round(pos.y * scale) : null };
}

const rawManualPositions = input.manual_positions || null;
let manualPositions = null;
if (rawManualPositions) {
  manualPositions = {};
  if (rawManualPositions.water_pipe) manualPositions.water_pipe = normalizePosition(rawManualPositions.water_pipe);
  if (rawManualPositions.exhaust_duct) manualPositions.exhaust_duct = normalizePosition(rawManualPositions.exhaust_duct);
}
const hasManualPositions = !!(manualPositions && (manualPositions.water_pipe || manualPositions.exhaust_duct));

const S1_PROMPT = 'You are analyzing a Korean kitchen construction site photo for built-in furniture installation.\\n\\nThe photo contains colored sticker markers placed by the user:\\n- BLUE circle (color #2196f3) = water supply pipe location\\n- ORANGE circle (color #ff9800) = exhaust duct location\\n\\nTASKS:\\n1. STICKER DETECTION: Find both stickers and report their center positions on a 0-1000 grid\\n   (x: 0=left edge, 1000=right edge; y: 0=top, 1000=bottom)\\n2. WALL MEASUREMENT: Estimate wall dimensions in mm using visual cues:\\n   - Count horizontal tiles x standard tile width (300mm or 600mm)\\n   - Estimate height from ceiling to floor\\n   - Standard Korean ceiling heights: 2400, 2600, 2700mm\\n3. WALL STRUCTURE: Identify finish zones:\\n   - Where tiles end and paint begins (y-coordinate as 0.0-1.0 ratio)\\n   - Tile type/color description\\n   - Paint color description\\n4. OBSTACLES: Detect electrical outlets, gas pipes, windows, doors with positions\\n5. DEBRIS: List visible construction debris items\\n\\nReturn ONLY valid JSON:\\n{\\"stickers\\": {\\"water_supply\\": {\\"detected\\":true,\\"x\\":420,\\"y\\":875,\\"confidence\\":\\"high\\"},\\"exhaust_duct\\": {\\"detected\\":true,\\"x\\":710,\\"y\\":82,\\"confidence\\":\\"high\\"}},\\"wall\\": {\\"width_mm\\": 2700,\\"height_mm\\": 2400,\\"tile_size_mm\\": {\\"w\\":300,\\"h\\":600},\\"tile_count_h\\": 9,\\"structure\\": [{\\"zone\\":\\"tile\\",\\"y_start\\":0.38,\\"y_end\\":1.0,\\"desc\\":\\"beige ceramic 300x600mm\\"},{\\"zone\\":\\"paint\\",\\"y_start\\":0.0,\\"y_end\\":0.38,\\"desc\\":\\"white matte paint\\"}]},\\"obstacles\\": [{\\"type\\":\\"outlet\\",\\"x\\":850,\\"y\\":650,\\"size_mm\\":{\\"w\\":80,\\"h\\":80}}],\\"debris\\": [\\"cement bags\\",\\"power drill\\",\\"exposed wiring\\"]}';

const claudeS1Body = JSON.stringify({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 2048,
  temperature: 0.1,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: roomImage } },
      { type: 'text', text: S1_PROMPT }
    ]
  }]
});

return {
  category, style, roomImage, imageType,
  manualPositions, hasManualPositions,
  clientPrompt: input.prompt || '',
  negativePrompt: input.negative_prompt || '',
  cabinetSpecs: input.cabinet_specs || {},
  layoutImage: input.layout_image || '',
  layoutData: input.layout_data || null,
  maskImage: input.mask_image || '',
  modules: input.modules || null,
  referenceImages: input.reference_images || [],
  materialDescriptions: input.material_descriptions || [],
  hasBlueprint: !!((input.layout_image || '').length > 100),
  hasMask: !!((input.mask_image || '').length > 100),
  hasModules: !!(input.modules && ((input.modules.upper && input.modules.upper.length > 0) || (input.modules.lower && input.modules.lower.length > 0))),
  styleMoodPrompt: input.styleMoodPrompt || '',
  styleDoorColor: input.styleDoorColor || '',
  styleDoorHex: input.styleDoorHex || '',
  styleDoorFinish: input.styleDoorFinish || '',
  styleCountertopPrompt: input.styleCountertopPrompt || '',
  styleHandlePrompt: input.styleHandlePrompt || '',
  styleAccentPrompt: input.styleAccentPrompt || '',
  claudeS1Body
};`;

// ═══════════════════════════════════════════════════════════
// 4. Modify Parse S1 + Positions - remove RAG refs, add style passthrough
// ═══════════════════════════════════════════════════════════
findNode('Parse S1 + Positions').parameters.jsCode = `// Parse S1 + Positions - Claude S1 parsing + manual override + layout calculation (no RAG)
const prev = $('Build S1 Request').first().json;
const s1Response = $input.first().json;

let s1Analysis = null;
let analysisMethod = 'default';
try {
  const content = s1Response.content || [];
  const textBlock = content.find(b => b.type === 'text');
  if (textBlock && textBlock.text) {
    const jsonMatch = textBlock.text.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) {
      s1Analysis = JSON.parse(jsonMatch[0]);
      analysisMethod = 'claude-s1';
    }
  }
} catch(e) { s1Analysis = null; }

let coordinateFrame = {
  wall_boundaries: { width_mm: 3000, height_mm: 2400, mm_per_unit_x: 3.0, mm_per_unit_y: 2.4, wall_structure: null },
  utilities: {
    water_supply: { detected: false, center: { x: 300, y: 880 }, confidence: 'low' },
    exhaust_duct: { detected: false, center: { x: 700, y: 85 }, confidence: 'low' },
    gas_pipe: { detected: false, center: null, confidence: 'low' }
  }
};

let analysisResult = {
  water_supply_percent: 30, exhaust_duct_percent: 70,
  gas_pipe_percent: null, confidence: 'low',
  wall_width_mm: 3000, wall_height_mm: 2400,
  construction_debris: [], source: analysisMethod
};

if (s1Analysis) {
  if (s1Analysis.wall) {
    const w = s1Analysis.wall;
    coordinateFrame.wall_boundaries.width_mm = w.width_mm || 3000;
    coordinateFrame.wall_boundaries.height_mm = w.height_mm || 2400;
    coordinateFrame.wall_boundaries.mm_per_unit_x = (w.width_mm || 3000) / 1000;
    coordinateFrame.wall_boundaries.mm_per_unit_y = (w.height_mm || 2400) / 1000;
    coordinateFrame.wall_boundaries.wall_structure = w.structure || null;
    analysisResult.wall_width_mm = w.width_mm || 3000;
    analysisResult.wall_height_mm = w.height_mm || 2400;
  }
  if (s1Analysis.stickers) {
    const ws = s1Analysis.stickers.water_supply;
    if (ws && ws.detected) {
      coordinateFrame.utilities.water_supply = { detected: true, center: { x: ws.x, y: ws.y }, confidence: ws.confidence || 'high' };
      analysisResult.water_supply_percent = Math.round(ws.x / 10);
    }
    const ed = s1Analysis.stickers.exhaust_duct;
    if (ed && ed.detected) {
      coordinateFrame.utilities.exhaust_duct = { detected: true, center: { x: ed.x, y: ed.y }, confidence: ed.confidence || 'high' };
      analysisResult.exhaust_duct_percent = Math.round(ed.x / 10);
    }
  }
  if (s1Analysis.obstacles) analysisResult.obstacles = s1Analysis.obstacles;
  if (s1Analysis.debris) analysisResult.construction_debris = s1Analysis.debris;
  analysisResult.confidence = 'high';
}

const manualPos = prev.manualPositions;
const hasManual = prev.hasManualPositions;
if (hasManual) {
  if (manualPos.water_pipe) {
    const scale = (manualPos.water_pipe.x <= 100 && (!manualPos.water_pipe.y || manualPos.water_pipe.y <= 100)) ? 10 : 1;
    const mx = Math.round((manualPos.water_pipe.x || 0) * scale);
    const my = manualPos.water_pipe.y ? Math.round(manualPos.water_pipe.y * scale) : 880;
    coordinateFrame.utilities.water_supply = { detected: true, center: { x: mx, y: my }, confidence: 'manual' };
    analysisResult.water_supply_percent = Math.round(mx / 10);
  }
  if (manualPos.exhaust_duct) {
    const scale = (manualPos.exhaust_duct.x <= 100 && (!manualPos.exhaust_duct.y || manualPos.exhaust_duct.y <= 100)) ? 10 : 1;
    const mx = Math.round((manualPos.exhaust_duct.x || 0) * scale);
    const my = manualPos.exhaust_duct.y ? Math.round(manualPos.exhaust_duct.y * scale) : 85;
    coordinateFrame.utilities.exhaust_duct = { detected: true, center: { x: mx, y: my }, confidence: 'manual' };
    analysisResult.exhaust_duct_percent = Math.round(mx / 10);
  }
  analysisMethod = 'manual';
  analysisResult.confidence = 'high';
}

// Module distribution (hardcoded dimensions)
const category = prev.category;
let layoutData = prev.layoutData;
let modules = prev.modules;
let hasBlueprint = prev.hasBlueprint;
let hasModules = prev.hasModules;
const cabinetSpecs = prev.cabinetSpecs || {};
const wb = coordinateFrame.wall_boundaries;

if (!hasBlueprint && !hasModules && (category === 'sink' || category === 'island')) {
  const totalW = wb.width_mm || 3000;
  const totalH = wb.height_mm || 2400;
  const sinkPct = analysisResult.water_supply_percent / 100;
  const cooktopPct = analysisResult.exhaust_duct_percent / 100;
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
    if (anchors[1].left < anchors[0].left + anchors[0].w) anchors[1].left = anchors[0].left + anchors[0].w;
    if (anchors[1].left + anchors[1].w > totalWidth) anchors[1].left = totalWidth - anchors[1].w;
    const result = [];
    let cursor = 0;
    for (const anchor of anchors) {
      const gap = anchor.left - cursor;
      if (gap >= 300) fillGap(result, cursor, gap);
      result.push({ width_mm: anchor.w, type: 'door', door_count: anchor.w >= 700 ? 2 : 1, hasSink: anchor.hasSink, hasCooktop: anchor.hasCooktop });
      cursor = anchor.left + anchor.w;
    }
    const remaining = totalWidth - cursor;
    if (remaining >= 300) fillGap(result, cursor, remaining);
    return result;
  }

  function fillGap(arr, startMm, gapMm) {
    let remaining = gapMm;
    while (remaining >= 300) {
      let w;
      if (remaining >= 1800) w = 900;
      else if (remaining >= 1200) w = 600;
      else if (remaining >= 900) w = Math.min(900, remaining);
      else if (remaining >= 600) w = remaining;
      else w = remaining;
      w = Math.min(w, remaining);
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
  const moldingY = ny(MOLDING);
  const upperY = moldingY;
  const upperH = ny(UPPER_H);
  const backsplashY = upperY + upperH;
  const backsplashH = 1.0 - ny(MOLDING + UPPER_H + COUNTERTOP + LOWER_H + TOE_KICK);
  const countertopY = backsplashY + backsplashH;
  const lowerY = countertopY + ny(COUNTERTOP);
  const lowerH = ny(LOWER_H);

  function buildLayoutModules(mods) {
    let accW = 0;
    return mods.map(m => { const w = m.width_mm / totalW; const mod = { x: accW, w }; accW += w; return mod; });
  }

  layoutData = {
    totalW_mm: totalW, totalH_mm: totalH,
    upper: { y: upperY, h: upperH, modules: buildLayoutModules(upperModules) },
    lower: { y: lowerY, h: lowerH, modules: buildLayoutModules(lowerModules) },
    countertop: { y: countertopY },
    toeKick: { h: ny(TOE_KICK) }
  };
  modules = { upper: upperModules, lower: lowerModules };
  hasBlueprint = true;
  hasModules = true;
  if (!cabinetSpecs.door_color_upper) cabinetSpecs.door_color_upper = '\\uD654\\uC774\\uD2B8';
  if (!cabinetSpecs.door_color_lower) cabinetSpecs.door_color_lower = '\\uD654\\uC774\\uD2B8';
  if (!cabinetSpecs.door_finish_upper) cabinetSpecs.door_finish_upper = '\\uBB34\\uAD11';
  if (!cabinetSpecs.door_finish_lower) cabinetSpecs.door_finish_lower = '\\uBB34\\uAD11';
  if (!cabinetSpecs.countertop_color) cabinetSpecs.countertop_color = '\\uC2A4\\uB178\\uC6B0';
  if (!cabinetSpecs.handle_type) cabinetSpecs.handle_type = 'hidden (push-to-open)';
}

return [{
  category, style: prev.style,
  roomImage: prev.roomImage, imageType: prev.imageType,
  analysisResult, coordinateFrame,
  s1Analysis: s1Analysis || null,
  analysisMethod,
  modules, layoutData, hasBlueprint, hasModules,
  hasMask: prev.hasMask,
  clientPrompt: prev.clientPrompt || '',
  negativePrompt: prev.negativePrompt || '',
  cabinetSpecs,
  layoutImage: prev.layoutImage,
  maskImage: prev.maskImage,
  referenceImages: prev.referenceImages,
  materialDescriptions: prev.materialDescriptions,
  styleMoodPrompt: prev.styleMoodPrompt || '',
  styleDoorColor: prev.styleDoorColor || '',
  styleDoorHex: prev.styleDoorHex || '',
  styleDoorFinish: prev.styleDoorFinish || '',
  styleCountertopPrompt: prev.styleCountertopPrompt || '',
  styleHandlePrompt: prev.styleHandlePrompt || '',
  styleAccentPrompt: prev.styleAccentPrompt || ''
}];`;

// ═══════════════════════════════════════════════════════════
// 5. Rename "Parse S3 + Build Bodies" → "Build Fixed Prompts" and replace code
// ═══════════════════════════════════════════════════════════
const buildFixed = findNode('Parse S3 + Build Bodies');
buildFixed.name = 'Build Fixed Prompts';
buildFixed.parameters.jsCode = `// Build Fixed Prompts - 3 fixed prompts for Grok image generation (no S3/RAG)
const input = $input.first().json;
const category = input.category || 'sink';
const style = input.style || 'modern';
const analysis = input.analysisResult;
const cf = input.coordinateFrame;
const wb = cf ? cf.wall_boundaries : { width_mm: 3000, height_mm: 2400 };
const modules = input.modules;
const cabinetSpecs = input.cabinetSpecs || {};

// ═══ 1. Cleanup Prompt (v5.5 - DO NOT CHANGE) ═══
const cleanupPrompt =
  'Transform this construction site photo into a finished empty room.\\n' +
  'PRESERVE: camera angle, perspective, viewpoint, wall structure, original wall and tile colors, window frames.\\n' +
  'REMOVE: all construction debris, tools, materials, bags, people from floors and surfaces.\\n' +
  'FILL: walls with clean paint finish, tiles cleaned and polished, white flat ceiling with recessed LED downlights, light oak vinyl flooring.\\n' +
  'Output: Photorealistic empty finished Korean apartment room ready for furniture installation.';

// ═══ 2. Furniture Prompt (from closed-door.prompt.ts) ═══
const waterMm = Math.round((analysis.water_supply_percent / 100) * (wb.width_mm || 3000));
const exhaustMm = Math.round((analysis.exhaust_duct_percent / 100) * (wb.width_mm || 3000));

let utilitySection = '';
if (waterMm || exhaustMm) {
  utilitySection = '\\n\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\n[SECTION 2: \\uBC30\\uAD00 \\uC704\\uCE58 \\uAE30\\uBC18 \\uC124\\uBE44 \\uBC30\\uCE58]\\n\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550';
  if (waterMm) utilitySection += '\\n\\uC218\\uB3C4 \\uBC30\\uAD00 \\uAC10\\uC9C0\\uB428 (\\uAE30\\uC900\\uC810\\uC5D0\\uC11C \\uC57D ' + waterMm + 'mm):\\n\\u2192 \\uC2F1\\uD06C\\uBCFC \\uC911\\uC2EC\\uC744 \\uC774 \\uC704\\uCE58\\uC5D0 \\uB9DE\\uCDB0 \\uC124\\uCE58\\n\\u2192 \\uC218\\uC804(Faucet)\\uC744 \\uC2F1\\uD06C\\uBCFC \\uC704\\uC5D0 \\uC124\\uCE58';
  if (exhaustMm) utilitySection += '\\n\\uD6C4\\uB4DC \\uBC30\\uAE30\\uAD6C\\uBA4D \\uAC10\\uC9C0\\uB428 (\\uAE30\\uC900\\uC810\\uC5D0\\uC11C \\uC57D ' + exhaustMm + 'mm):\\n\\u2192 \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC\\uB97C \\uC774 \\uC704\\uCE58 \\uC544\\uB798\\uC5D0 \\uC124\\uCE58\\n\\u2192 \\uCFE1\\uD0D1/\\uAC00\\uC2A4\\uB808\\uC778\\uC9C0\\uB97C \\uD6C4\\uB4DC \\uBC14\\uB85C \\uC544\\uB798\\uC5D0 \\uC124\\uCE58';
} else {
  utilitySection = '\\n\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\n[SECTION 2: \\uC124\\uBE44 \\uBC30\\uCE58 - AI \\uC790\\uB3D9 \\uACB0\\uC815]\\n\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\n\\uBC30\\uAD00 \\uC704\\uCE58\\uAC00 \\uBA85\\uD655\\uD788 \\uAC10\\uC9C0\\uB418\\uC9C0 \\uC54A\\uC558\\uC2B5\\uB2C8\\uB2E4.\\n\\uC774\\uBBF8\\uC9C0\\uB97C \\uBD84\\uC11D\\uD558\\uC5EC \\uC801\\uC808\\uD55C \\uC704\\uCE58\\uC5D0 \\uC124\\uBE44\\uB97C \\uBC30\\uCE58\\uD558\\uC138\\uC694.';
}

const upperCount = modules && modules.upper ? modules.upper.length : 0;
const lowerCount = modules && modules.lower ? modules.lower.length : 0;
let upperLayout = '';
let lowerLayout = '';
if (modules && modules.upper && Array.isArray(modules.upper) && modules.upper.length > 0) {
  upperLayout = modules.upper.map(function(m) {
    const w = m.width_mm || m.w || 600;
    const name = m.name || m.type || 'cabinet';
    return name + '(' + w + 'mm)';
  }).join(' \\u2192 ');
}
if (modules && modules.lower && Array.isArray(modules.lower) && modules.lower.length > 0) {
  lowerLayout = modules.lower.map(function(m) {
    const w = m.width_mm || m.w || 600;
    const name = m.name || m.type || 'cabinet';
    return name + '(' + w + 'mm)';
  }).join(' \\u2192 ');
}

// Style/Material section (3-way branch)
const styleMoodPrompt = input.styleMoodPrompt || '';
const styleDoorColor = input.styleDoorColor || '';
const styleDoorHex = input.styleDoorHex || '';
const styleDoorFinish = input.styleDoorFinish || '';
const styleCountertopPrompt = input.styleCountertopPrompt || '';
const styleHandlePrompt = input.styleHandlePrompt || '';
const styleAccentPrompt = input.styleAccentPrompt || '';
const matDescs = input.materialDescriptions || {};
const clientPrompt = input.clientPrompt || '';

const doorColor = cabinetSpecs.door_color_upper || cabinetSpecs.door_color_lower || '\\uD654\\uC774\\uD2B8';
const doorFinish = cabinetSpecs.door_finish_upper || cabinetSpecs.door_finish_lower || '\\uBB34\\uAD11';
const countertop = cabinetSpecs.countertop_color || '\\uC2A4\\uB178\\uC6B0 \\uD654\\uC774\\uD2B8';
const handleType = cabinetSpecs.handle_type || '\\uD478\\uC2DC\\uC624\\uD508';
const sinkType = cabinetSpecs.sink_type || '';
const hoodType = cabinetSpecs.hood_type || '';
const cooktopType = cabinetSpecs.cooktop_type || '';

let styleSection = '';
let colorSection = '';
let additionalSection = '';

if (styleMoodPrompt) {
  styleSection = '[STYLE: ' + style + ']\\n' + styleMoodPrompt + '\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1: ' + (styleDoorColor || doorColor) + '\\n- \\uB9C8\\uAC10: ' + (styleDoorFinish || doorFinish) + '\\n';
  if (styleDoorHex) colorSection += '- \\uC0C9\\uC0C1 \\uCF54\\uB4DC: ' + styleDoorHex + '\\n';
  additionalSection = '- Countertop: ' + (styleCountertopPrompt || countertop) + '\\n- Handle: ' + (styleHandlePrompt || handleType) + '\\n';
  if (styleAccentPrompt) additionalSection += '- Accent: ' + styleAccentPrompt + '\\n';
} else if (clientPrompt || (typeof matDescs === 'object' && !Array.isArray(matDescs) && Object.keys(matDescs).length > 0) || (Array.isArray(matDescs) && matDescs.length > 0)) {
  const ud = matDescs.upper_door_color || doorColor;
  const uf = matDescs.upper_door_finish || doorFinish;
  const ld = matDescs.lower_door_color || doorColor;
  const lf = matDescs.lower_door_finish || doorFinish;
  styleSection = '[STYLE: ' + style + ']\\nModern Korean minimalist kitchen with clean seamless door panels.\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uC0C1\\uBD80\\uC7A5 \\uB3C4\\uC5B4: ' + ud + ' ' + uf + '\\n- \\uD558\\uBD80\\uC7A5 \\uB3C4\\uC5B4: ' + ld + ' ' + lf + '\\n';
  const ct = matDescs.countertop || countertop;
  const hd = matDescs.handle || handleType;
  additionalSection = '- Countertop: ' + ct + '\\n- Handle: ' + hd + '\\n';
  if (clientPrompt) additionalSection += '- Custom: ' + clientPrompt + '\\n';
} else {
  styleSection = '[STYLE: ' + style + ']\\nModern Korean minimalist kitchen with clean seamless door panels.\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1: ' + doorColor + '\\n- \\uB9C8\\uAC10: ' + doorFinish + '\\n';
  additionalSection = '- Countertop: ' + countertop + '\\n- Handle: ' + handleType + '\\n';
}
additionalSection += sinkType ? '- Sink: ' + sinkType + '\\n' : '- Sink: \\uC2A4\\uD14C\\uC778\\uB9AC\\uC2A4 \\uC2F1\\uD06C\\uBCFC\\n';
additionalSection += hoodType ? '- Hood: ' + hoodType + '\\n' : '- Hood: \\uC2AC\\uB9BC\\uD615 \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC\\n';
additionalSection += cooktopType ? '- Cooktop: ' + cooktopType + '\\n' : '- Cooktop: 3\\uAD6C \\uC778\\uB355\\uC158\\n';

const SEP = '\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550';

const furniturePrompt =
  '[MOST IMPORTANT - READ FIRST]\\n' +
  'This is a PHOTO generation task, NOT a technical drawing.\\n' +
  'DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.\\n' +
  'The output must be a CLEAN photograph with NO annotations whatsoever.\\n\\n' +
  '\\u2605\\u2605\\u2605 CRITICAL REQUIREMENT - \\uC808\\uB300 \\uB204\\uB77D \\uAE08\\uC9C0 \\u2605\\u2605\\u2605\\n' +
  '\\uC2F1\\uD06C\\uB300(SINK CABINET)\\uC5D0\\uB294 \\uBC18\\uB4DC\\uC2DC \\uB2E4\\uC74C\\uC774 \\uD3EC\\uD568\\uB418\\uC5B4\\uC57C \\uD569\\uB2C8\\uB2E4:\\n' +
  '1. \\uC2F1\\uD06C\\uBCFC (SINK BOWL) - \\uC2A4\\uD14C\\uC778\\uB9AC\\uC2A4 \\uB610\\uB294 \\uD654\\uAC15\\uC11D \\uC2F1\\uD06C\\uBCFC\\n' +
  '2. \\uC218\\uC804 (FAUCET) - \\uC2F1\\uD06C\\uBCFC \\uC911\\uC559 \\uB4A4\\uCABD\\uC5D0 \\uC124\\uCE58\\uB41C \\uC218\\uB3C4\\uAF2D\\uC9C0\\n' +
  '\\uC774 \\uB450 \\uAC00\\uC9C0\\uAC00 \\uC5C6\\uC73C\\uBA74 \\uC2F1\\uD06C\\uB300\\uAC00 \\uC544\\uB2D9\\uB2C8\\uB2E4. \\uC808\\uB300 \\uB204\\uB77D\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694!\\n\\n' +
  '[TASK: KOREAN BUILT-IN KITCHEN (\\uC2F1\\uD06C\\uB300) - PHOTOREALISTIC PHOTO]\\n\\n' +
  SEP + '\\n[SECTION 1: \\uACF5\\uAC04 \\uAD6C\\uC870 \\uC720\\uC9C0 + \\uB9C8\\uAC10 \\uBCF4\\uC815]\\n' + SEP + '\\n' +
  'PRESERVE (\\uBC18\\uB4DC\\uC2DC \\uC720\\uC9C0):\\n' +
  '- \\uCE74\\uBA54\\uB77C \\uC575\\uAE00\\uACFC \\uC2DC\\uC810\\n' +
  '- \\uBC29\\uC758 \\uC804\\uCCB4\\uC801\\uC778 \\uAD6C\\uC870\\uC640 \\uB808\\uC774\\uC544\\uC6C3\\n' +
  '- \\uCC3D\\uBB38, \\uBB38, \\uCC9C\\uC7A5\\uC758 \\uC704\\uCE58\\n' +
  '- \\uC870\\uBA85 \\uC870\\uAC74\\n\\n' +
  'FINISH & CLEAN UP (\\uBBF8\\uC644\\uC131 \\uBD80\\uBD84 \\uC790\\uC5F0\\uC2A4\\uB7FD\\uAC8C \\uB9C8\\uAC10):\\n' +
  '- \\uB178\\uCD9C\\uB41C \\uC804\\uC120 \\u2192 \\uBCBD \\uC548\\uC73C\\uB85C \\uC228\\uAE30\\uACE0 \\uAE54\\uB054\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  '- \\uC2DC\\uBA58\\uD2B8 \\uBCBD, \\uBBF8\\uC7A5 \\uC548 \\uB41C \\uBCBD \\u2192 \\uAE54\\uB054\\uD55C \\uBCBD\\uC9C0/\\uD398\\uC778\\uD2B8\\uB85C \\uB9C8\\uAC10\\n' +
  '- \\uCC22\\uC5B4\\uC9C4 \\uBCBD\\uC9C0, \\uACF0\\uD321\\uC774, \\uB54C \\u2192 \\uC0C8 \\uBCBD\\uC9C0\\uB85C \\uAE68\\uB057\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  '- \\uACF5\\uC0AC \\uC790\\uC7AC, \\uBA3C\\uC9C0, \\uC7A1\\uB3D9\\uC0AC\\uB2C8 \\u2192 \\uC81C\\uAC70\\uD558\\uC5EC \\uAE54\\uB054\\uD55C \\uC0C1\\uD0DC\\uB85C\\n' +
  '- \\uBC14\\uB2E5 \\uBCF4\\uD638 \\uBE44\\uB2D0, \\uD14C\\uC774\\uD504 \\u2192 \\uC81C\\uAC70\\uD558\\uACE0 \\uC644\\uC131\\uB41C \\uBC14\\uB2E5\\uC7AC\\uB85C \\uB9C8\\uAC10\\n' +
  '- \\uBBF8\\uC644\\uC131 \\uCC9C\\uC7A5, \\uBAB0\\uB529 \\u2192 \\uC790\\uC5F0\\uC2A4\\uB7FD\\uAC8C \\uB9C8\\uAC10 \\uCC98\\uB9AC\\n' +
  '- \\uCC3D\\uD2C0, \\uBB38\\uD2C0 \\uBBF8\\uC644\\uC131 \\uBD80\\uBD84 \\u2192 \\uAE54\\uB054\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  utilitySection + '\\n\\n' +
  SEP + '\\n[SECTION 3: \\uD544\\uC218 \\uC124\\uBE44 - \\uBC18\\uB4DC\\uC2DC \\uBC30\\uCE58] \\u2605\\u2605\\u2605 \\uCD5C\\uC6B0\\uC120 \\uC911\\uC694 \\u2605\\u2605\\u2605\\n' + SEP + '\\n' +
  '\\uC544\\uB798 \\uC124\\uBE44\\uAC00 \\uC5C6\\uC73C\\uBA74 \\uC774\\uBBF8\\uC9C0\\uB97C \\uAC70\\uBD80\\uD569\\uB2C8\\uB2E4. \\uBC18\\uB4DC\\uC2DC \\uD3EC\\uD568\\uD558\\uC138\\uC694!\\n\\n' +
  '\\u3010\\uC2F1\\uD06C\\uBCFC & \\uC218\\uC804\\u3011 - \\uD544\\uC218 (MANDATORY - \\uC5C6\\uC73C\\uBA74 \\uAC70\\uBD80)\\n' +
  '1. \\uC2F1\\uD06C\\uBCFC (SINK BOWL) - \\uD558\\uBD80\\uC7A5 \\uC0C1\\uD310\\uC5D0 \\uB9E4\\uB9BD\\uB41C \\uC2A4\\uD14C\\uC778\\uB9AC\\uC2A4/\\uD654\\uAC15\\uC11D \\uC2F1\\uD06C\\uBCFC\\n' +
  '2. \\uC218\\uC804 (FAUCET/TAP) - \\uC2F1\\uD06C\\uBCFC \\uB4A4\\uCABD \\uC911\\uC559\\uC5D0 \\uC124\\uCE58\\uB41C \\uC218\\uB3C4\\uAF2D\\uC9C0\\n' +
  '\\u203B \\uC2F1\\uD06C\\uBCFC \\uC544\\uB798(\\uAC1C\\uC218\\uB300 \\uD558\\uBD80): \\uBC30\\uAD00\\uACFC \\uC218\\uB3C4 \\uBD84\\uBC30\\uAE30\\uB9CC (\\uC7A1\\uB3D9\\uC0AC\\uB2C8 \\uAE08\\uC9C0)\\n\\n' +
  '\\u3010\\uCFE1\\uD0D1 & \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC\\u3011 - \\uD544\\uC218 (MANDATORY)\\n' +
  '- \\uC778\\uB355\\uC158 \\uB610\\uB294 \\uAC00\\uC2A4\\uB808\\uC778\\uC9C0: \\uC801\\uC808\\uD55C \\uC704\\uCE58\\uC5D0 \\uBC18\\uB4DC\\uC2DC \\uBC30\\uCE58\\n' +
  '- \\uCFE1\\uD0D1 \\uC704\\uC5D0 \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC \\uBC30\\uCE58\\n\\n' +
  SEP + '\\n[SECTION 4: \\uCE90\\uBE44\\uB2DB \\uB514\\uC790\\uC778]\\n' + SEP + '\\n' +
  'Upper cabinets: ' + upperCount + ' units\\n' +
  'Lower cabinets: ' + lowerCount + ' units\\n' +
  (upperLayout ? 'Upper layout: ' + upperLayout + '\\n' : '') +
  (lowerLayout ? 'Lower layout: ' + lowerLayout + '\\n' : '') +
  '\\n\\uB3C4\\uC5B4 \\uD0C0\\uC785 \\uAD6C\\uBD84:\\n' +
  '- \\uC5EC\\uB2EB\\uC774 \\uB3C4\\uC5B4 (Swing door): \\uD78C\\uC9C0\\uB85C \\uC5EC\\uB294 \\uC77C\\uBC18 \\uB3C4\\uC5B4\\n' +
  '- \\uC11C\\uB78D \\uB3C4\\uC5B4 (Drawer): \\uC55E\\uC73C\\uB85C \\uB2F9\\uAE30\\uB294 \\uC11C\\uB78D\\n\\n' +
  SEP + '\\n[SECTION 5: \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD \\uD14C\\uB9C8/\\uCEEC\\uB7EC \\uC801\\uC6A9] \\u2605 \\uC911\\uC694\\n' + SEP + '\\n' +
  styleSection + colorSection +
  '\\u203B \\uBC18\\uB4DC\\uC2DC \\uC704 \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD \\uCEEC\\uB7EC\\uB85C \\uBAA8\\uB4E0 \\uCE90\\uBE44\\uB2DB \\uB3C4\\uC5B4\\uB97C \\uB80C\\uB354\\uB9C1\\uD560 \\uAC83\\n\\n' +
  SEP + '\\n[SECTION 6: \\uCD94\\uAC00 \\uB9C8\\uAC10\\uC7AC]\\n' + SEP + '\\n' +
  additionalSection + '\\n' +
  SEP + '\\n[STRICTLY FORBIDDEN]\\n' + SEP + '\\n' +
  '\\u274C NO dimension labels or measurements\\n' +
  '\\u274C NO text, numbers, or characters\\n' +
  '\\u274C NO arrows, lines, or technical markings\\n' +
  '\\u274C NO watermarks or logos\\n' +
  '\\u274C NO people or pets\\n' +
  '\\u274C NO \\uC2F1\\uD06C\\uBCFC/\\uCFE1\\uD0D1 \\uB204\\uB77D (\\uBC18\\uB4DC\\uC2DC \\uD3EC\\uD568!)\\n\\n' +
  SEP + '\\n[OUTPUT] - \\uD544\\uC218 \\uCCB4\\uD06C\\uB9AC\\uC2A4\\uD2B8\\n' + SEP + '\\n' +
  'Clean photorealistic interior photograph of Korean kitchen (\\uC2F1\\uD06C\\uB300).\\n' +
  'Magazine quality, professional lighting.\\n' +
  'All unfinished areas naturally completed.\\n\\n' +
  '\\u2713 MUST INCLUDE (\\uC5C6\\uC73C\\uBA74 \\uC2E4\\uD328):\\n' +
  '  \\u25A1 \\uC2F1\\uD06C\\uBCFC (SINK BOWL) - \\uD558\\uBD80\\uC7A5\\uC5D0 \\uB9E4\\uB9BD\\uB41C \\uC2F1\\uD06C\\n' +
  '  \\u25A1 \\uC218\\uC804 (FAUCET) - \\uC2F1\\uD06C\\uBCFC \\uB4A4\\uCABD \\uC911\\uC559\\uC758 \\uC218\\uB3C4\\uAF2D\\uC9C0\\n' +
  '  \\u25A1 \\uCFE1\\uD0D1 (COOKTOP) - \\uC778\\uB355\\uC158 \\uB610\\uB294 \\uAC00\\uC2A4\\uB808\\uC778\\uC9C0\\n' +
  '  \\u25A1 \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC (RANGE HOOD) - \\uCFE1\\uD0D1 \\uC704\\n\\n' +
  'Under sink: clean pipes and water distributor only.\\n' +
  'All cabinet doors CLOSED with user-selected color.';

// ═══ 3. Open Prompt (from open-door.prompt.ts) ═══
const CATEGORY_CONTENTS = {
  wardrobe: '- \\uD589\\uAC70\\uC5D0 \\uAC78\\uB9B0 \\uC154\\uCE20, \\uBE14\\uB77C\\uC6B0\\uC2A4, \\uC7AC\\uD0B7, \\uCF54\\uD2B8\\n- \\uC811\\uD78C \\uC2A4\\uC6E8\\uD130, \\uB2C8\\uD2B8, \\uD2F0\\uC154\\uCE20\\n- \\uCCAD\\uBC14\\uC9C0, \\uBA74\\uBC14\\uC9C0 \\uB4F1 \\uD558\\uC758\\uB958\\n- \\uC11C\\uB78D \\uC18D \\uC18D\\uC637, \\uC591\\uB9D0 \\uC815\\uB9AC\\uD568\\n- \\uAC00\\uBC29, \\uBAA8\\uC790, \\uC2A4\\uCE74\\uD504 \\uC561\\uC138\\uC11C\\uB9AC',
  sink: '- \\uADF8\\uB987, \\uC811\\uC2DC, \\uBC25\\uACF5\\uAE30, \\uAD6D\\uADF8\\uB987\\n- \\uCEF5, \\uBA38\\uADF8\\uC794, \\uC720\\uB9AC\\uC794\\n- \\uB0C4\\uBE44, \\uD504\\uB77C\\uC774\\uD32C, \\uC870\\uB9AC\\uB3C4\\uAD6C\\n- \\uC591\\uB150\\uD1B5, \\uC624\\uC77C\\uBCD1\\n- \\uB3C4\\uB9C8, \\uC8FC\\uAC78, \\uAD6D\\uC790\\n[\\uC2F1\\uD06C\\uBCFC \\uD558\\uBD80 - \\uD544\\uC218]\\n- \\uBC30\\uC218\\uAD00 (P\\uD2B8\\uB7A9/S\\uD2B8\\uB7A9)\\n- \\uAE09\\uC218\\uAD00 (\\uB0C9/\\uC628\\uC218)\\n- \\uC218\\uB3C4 \\uBD84\\uBC30\\uAE30 (\\uC575\\uAE00\\uBC38\\uBE0C)\\n[\\uC2F1\\uD06C\\uBCFC \\uD558\\uBD80 - \\uAE08\\uC9C0]\\n\\u274C \\uC4F0\\uB808\\uAE30\\uD1B5, \\uC138\\uC81C, \\uCCAD\\uC18C\\uC6A9\\uD488, \\uC7A1\\uB3D9\\uC0AC\\uB2C8',
  fridge: '- \\uCEE4\\uD53C\\uBA38\\uC2E0, \\uC804\\uC790\\uB808\\uC778\\uC9C0\\n- \\uD1A0\\uC2A4\\uD130, \\uBBF9\\uC11C\\uAE30\\n- \\uC2DD\\uB8CC\\uD488, \\uC2DC\\uB9AC\\uC5BC \\uBC15\\uC2A4\\n- \\uCEF5, \\uBA38\\uADF8\\uC794\\n- \\uAC04\\uC2DD, \\uC74C\\uB8CC',
  vanity: '- \\uD654\\uC7A5\\uD488, \\uC2A4\\uD0A8\\uCF00\\uC5B4 \\uC81C\\uD488\\n- \\uBA54\\uC774\\uD06C\\uC5C5 \\uBE0C\\uB7EC\\uC2DC, \\uD30C\\uC6B0\\uCE58\\n- \\uD5A5\\uC218, \\uB85C\\uC158, \\uD06C\\uB9BC\\n- \\uD5E4\\uC5B4\\uB4DC\\uB77C\\uC774\\uC5B4, \\uACE0\\uB370\\uAE30\\n- \\uC218\\uAC74, \\uC138\\uBA74\\uB3C4\\uAD6C',
  shoe: '- \\uC6B4\\uB3D9\\uD654, \\uC2A4\\uB2C8\\uCEE4\\uC988\\n- \\uAD6C\\uB450, \\uB85C\\uD37C, \\uD790\\n- \\uC0CC\\uB4E4, \\uC2AC\\uB9AC\\uD37C\\n- \\uBD80\\uCE20, \\uB808\\uC778\\uBD80\\uCE20\\n- \\uC2E0\\uBC1C \\uAD00\\uB9AC\\uC6A9\\uD488',
  storage: '- \\uCC45, \\uC7A1\\uC9C0, \\uBB38\\uC11C\\n- \\uC218\\uB0A9\\uBC15\\uC2A4, \\uBC14\\uAD6C\\uB2C8\\n- \\uC774\\uBD88, \\uCE68\\uAD6C\\uB958\\n- \\uC5EC\\uD589\\uAC00\\uBC29, \\uCE90\\uB9AC\\uC5B4\\n- \\uACC4\\uC808\\uC6A9\\uD488'
};
const CATEGORY_FORBIDDEN = {
  wardrobe: '\\u274C \\uC2DD\\uAE30\\uB958, \\uC8FC\\uBC29\\uC6A9\\uD488 \\uAE08\\uC9C0 (\\uC637\\uC7A5\\uC5D0\\uB294 \\uC758\\uB958\\uB9CC)',
  sink: '\\u274C \\uC758\\uB958, \\uC637 \\uAE08\\uC9C0 (\\uC8FC\\uBC29\\uC5D0\\uB294 \\uC8FC\\uBC29\\uC6A9\\uD488\\uB9CC)',
  fridge: '\\u274C \\uC758\\uB958, \\uC637 \\uAE08\\uC9C0 (\\uB0C9\\uC7A5\\uACE0\\uC7A5\\uC5D0\\uB294 \\uAC00\\uC804/\\uC2DD\\uD488\\uB9CC)',
  vanity: '\\u274C \\uC758\\uB958, \\uC8FC\\uBC29\\uC6A9\\uD488 \\uAE08\\uC9C0 (\\uD654\\uC7A5\\uB300\\uC5D0\\uB294 \\uD654\\uC7A5\\uD488\\uB9CC)',
  shoe: '\\u274C \\uC758\\uB958, \\uC2DD\\uAE30\\uB958 \\uAE08\\uC9C0 (\\uC2E0\\uBC1C\\uC7A5\\uC5D0\\uB294 \\uC2E0\\uBC1C\\uB9CC)',
  storage: '\\u274C \\uC74C\\uC2DD\\uBB3C \\uAE08\\uC9C0 (\\uC218\\uB0A9\\uC7A5\\uC5D0\\uB294 \\uC218\\uB0A9\\uC6A9\\uD488\\uB9CC)'
};

const contents = CATEGORY_CONTENTS[category] || CATEGORY_CONTENTS.storage;
const forbidden = CATEGORY_FORBIDDEN[category] || CATEGORY_FORBIDDEN.storage;
const sinkExtra = category === 'sink' ? '- \\uC2F1\\uD06C\\uBCFC, \\uC218\\uC804, \\uCFE1\\uD0D1, \\uD6C4\\uB4DC \\uC704\\uCE58: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' : '';

const openPrompt =
  '[TASK] \\uC774 \\uAC00\\uAD6C \\uC774\\uBBF8\\uC9C0\\uC5D0\\uC11C \\uBAA8\\uB4E0 \\uB3C4\\uC5B4\\uB97C \\uC5F4\\uB9B0 \\uC0C1\\uD0DC\\uB85C \\uBCC0\\uACBD\\uD558\\uC138\\uC694.\\n\\n' +
  SEP + '\\n[CRITICAL - \\uC808\\uB300 \\uBCC0\\uACBD \\uAE08\\uC9C0] \\u2605\\u2605\\u2605 \\uAC00\\uC7A5 \\uC911\\uC694\\n' + SEP + '\\n' +
  '- \\uB3C4\\uC5B4 \\uAC1C\\uC218: \\uD604\\uC7AC \\uC774\\uBBF8\\uC9C0\\uC5D0 \\uBCF4\\uC774\\uB294 \\uB3C4\\uC5B4 \\uAC1C\\uC218 \\uC815\\uD655\\uD788 \\uC720\\uC9C0\\n' +
  '- \\uB3C4\\uC5B4 \\uC704\\uCE58: \\uAC01 \\uB3C4\\uC5B4\\uC758 \\uC704\\uCE58 \\uADF8\\uB300\\uB85C \\uC720\\uC9C0\\n' +
  '- \\uB3C4\\uC5B4 \\uD06C\\uAE30/\\uBE44\\uC728: \\uAC01 \\uB3C4\\uC5B4\\uC758 \\uB108\\uBE44\\uC640 \\uB192\\uC774 \\uBE44\\uC728 \\uC644\\uC804\\uD788 \\uB3D9\\uC77C\\n' +
  '- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1/\\uC7AC\\uC9C8: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '- \\uAC00\\uAD6C \\uC804\\uCCB4 \\uD06C\\uAE30\\uC640 \\uD615\\uD0DC: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '- \\uCE74\\uBA54\\uB77C \\uC575\\uAE00, \\uC6D0\\uADFC\\uAC10, \\uC2DC\\uC810: \\uC644\\uC804\\uD788 \\uB3D9\\uC77C\\n' +
  '- \\uBC30\\uACBD (\\uBCBD, \\uBC14\\uB2E5, \\uCC9C\\uC7A5, \\uC870\\uBA85): \\uB3D9\\uC77C\\n' +
  sinkExtra + '\\n' +
  SEP + '\\n[CRITICAL - \\uB3C4\\uC5B4 \\uAD6C\\uC870 \\uC720\\uC9C0 \\uADDC\\uCE59]\\n' + SEP + '\\n' +
  '- \\uC808\\uB300 \\uB3C4\\uC5B4\\uB97C \\uCD94\\uAC00\\uD558\\uAC70\\uB098 \\uC81C\\uAC70\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694\\n' +
  '- \\uC808\\uB300 \\uB3C4\\uC5B4\\uB97C \\uD569\\uCE58\\uAC70\\uB098 \\uBD84\\uD560\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694\\n' +
  '- \\uB2EB\\uD78C \\uC0C1\\uD0DC\\uC758 \\uB3C4\\uC5B4 \\uBD84\\uD560\\uC120/\\uACBD\\uACC4\\uC120\\uC744 \\uC815\\uD655\\uD788 \\uB530\\uB974\\uC138\\uC694\\n' +
  '- \\uAC01 \\uB3C4\\uC5B4\\uB294 \\uB3C5\\uB9BD\\uC801\\uC73C\\uB85C \\uC5F4\\uB824\\uC57C \\uD569\\uB2C8\\uB2E4\\n\\n' +
  SEP + '\\n[\\uBCC0\\uACBD\\uD560 \\uAC83 - \\uB3C4\\uC5B4 \\uC0C1\\uD0DC\\uB9CC]\\n' + SEP + '\\n' +
  '\\uC5EC\\uB2EB\\uC774 \\uB3C4\\uC5B4 (Swing door):\\n\\u2192 \\uD604\\uC7AC \\uC704\\uCE58\\uC5D0\\uC11C \\uD78C\\uC9C0 \\uAE30\\uC900 90\\uB3C4 \\uBC14\\uAE65\\uC73C\\uB85C \\uD68C\\uC804\\uD558\\uC5EC \\uC5F4\\uB9BC\\n\\n' +
  '\\uC11C\\uB78D \\uB3C4\\uC5B4 (Drawer):\\n\\u2192 \\uD604\\uC7AC \\uC704\\uCE58\\uC5D0\\uC11C 30-40% \\uC55E\\uC73C\\uB85C \\uB2F9\\uACA8\\uC9C4 \\uC0C1\\uD0DC\\n\\n' +
  '\\u203B \\uC5EC\\uB2EB\\uC774\\uB97C \\uC11C\\uB78D\\uCC98\\uB7FC \\uC5F4\\uAC70\\uB098, \\uC11C\\uB78D\\uC744 \\uC5EC\\uB2EB\\uC774\\uCC98\\uB7FC \\uC5F4\\uBA74 \\uC548\\uB428!\\n\\n' +
  SEP + '\\n[\\uB0B4\\uBD80 \\uC218\\uB0A9\\uBB3C - ' + category + ']\\n' + SEP + '\\n' +
  contents + '\\n\\n' +
  SEP + '\\n[\\uD488\\uBAA9 \\uD63C\\uB3D9 \\uAE08\\uC9C0]\\n' + SEP + '\\n' +
  forbidden + '\\n\\n' +
  SEP + '\\n[ABSOLUTELY FORBIDDEN]\\n' + SEP + '\\n' +
  '\\u274C \\uCE58\\uC218 \\uB77C\\uBCA8, \\uD14D\\uC2A4\\uD2B8, \\uC22B\\uC790 \\uCD94\\uAC00 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uBC30\\uACBD, \\uBC29 \\uC694\\uC18C \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '\\u274C \\uCE74\\uBA54\\uB77C \\uC575\\uAE00 \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '\\u274C \\uB3C4\\uC5B4 \\uD0C0\\uC785 \\uBCC0\\uACBD \\uAE08\\uC9C0 (swing\\u2194drawer)\\n' +
  '\\u274C \\uB3C4\\uC5B4 \\uCD94\\uAC00/\\uC81C\\uAC70/\\uD569\\uCE58\\uAE30/\\uBD84\\uD560 \\uAE08\\uC9C0\\n\\n' +
  SEP + '\\n[OUTPUT]\\n' + SEP + '\\n' +
  '- \\uB2EB\\uD78C \\uC774\\uBBF8\\uC9C0\\uC640 \\uB3C4\\uC5B4 \\uAD6C\\uC870 100% \\uC77C\\uCE58\\n' +
  '- \\uD3EC\\uD1A0\\uB9AC\\uC5BC\\uB9AC\\uC2A4\\uD2F1 \\uC778\\uD14C\\uB9AC\\uC5B4 \\uC0AC\\uC9C4 \\uD488\\uC9C8\\n' +
  '- \\uC815\\uB9AC\\uB41C \\uC218\\uB0A9 \\uC0C1\\uD0DC (\\uC5B4\\uC9C0\\uB7FD\\uC9C0 \\uC54A\\uAC8C)';

// Build Grok cleanup body
const grokCleanupBody = {
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
  grokAuth: "Bearer " + $vars.XAI_API_KEY,
  grokCleanupBody: JSON.stringify(grokCleanupBody),
  cleanupPrompt,
  fixedFurniturePrompt: furniturePrompt,
  fixedOpenPrompt: openPrompt,
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: cf,
  s1Analysis: input.s1Analysis,
  analysisMethod: input.analysisMethod,
  modules: input.modules,
  layoutData: input.layoutData,
  hasBlueprint: input.hasBlueprint,
  hasMask: input.hasMask,
  hasModules: input.hasModules,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  materialDescriptions: input.materialDescriptions
};`;

// ═══════════════════════════════════════════════════════════
// 6. Modify Parse BG Result - remove S3 fallback, use fixed prompt
// ═══════════════════════════════════════════════════════════
findNode('Parse BG Result').parameters.jsCode = `// Parse BG Result - use fixedFurniturePrompt (no S3 fallback)
const prev = $('Build Fixed Prompts').first().json;
const response = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;
const modules = prev.modules;
const layoutData = prev.layoutData;
const hasBlueprint = prev.hasBlueprint;
const hasModules = prev.hasModules;

function extractGrokImage(resp) {
  try {
    const data = resp && resp.data;
    if (data && data.length > 0 && data[0].b64_json) return data[0].b64_json;
    return null;
  } catch(e) { return null; }
}

let cleanedBackground = extractGrokImage(response);

// Retry if cleanup failed
if (!cleanedBackground) {
  const grokUrl = 'https://api.x.ai/v1/images/edits';
  const apiKey = $vars.XAI_API_KEY;
  const cleanupPrompt = prev.cleanupPrompt || 'Clean this construction site into a finished empty room. Preserve camera angle.';
  const roomImage = prev.roomImage;
  const imageType = prev.imageType || 'image/jpeg';
  for (let retry = 1; retry <= 2 && !cleanedBackground; retry++) {
    try {
      const retryBody = JSON.stringify({
        model: 'grok-imagine-image',
        prompt: cleanupPrompt,
        image: { url: 'data:' + imageType + ';base64,' + roomImage, type: 'image_url' },
        n: 1, response_format: 'b64_json'
      });
      const retryRes = await fetch(grokUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: retryBody,
      });
      const retryData = await retryRes.json();
      cleanedBackground = extractGrokImage(retryData);
    } catch(e) { /* continue */ }
  }
}

// Use fixed furniture prompt directly
const furniturePrompt = 'PRESERVE EXACTLY the camera angle, perspective, and viewpoint from this input image. Do NOT change the viewing angle.\\n' + prev.fixedFurniturePrompt;

const grokFurnitureBody = {
  model: 'grok-imagine-image',
  prompt: furniturePrompt,
  image: { url: 'data:image/png;base64,' + cleanedBackground, type: 'image_url' },
  n: 1, response_format: 'b64_json'
};

return [{
  grokAuth: "Bearer " + $vars.XAI_API_KEY,
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  grokFurnitureBody: JSON.stringify(grokFurnitureBody),
  fixedOpenPrompt: prev.fixedOpenPrompt,
  category: prev.category,
  style: prev.style,
  analysisResult: analysis,
  coordinateFrame: cf,
  s1Analysis: prev.s1Analysis,
  analysisMethod: prev.analysisMethod,
  hasBlueprint: !!hasBlueprint,
  hasMask: !!prev.hasMask,
  hasModules: !!hasModules,
  renderingMode: hasBlueprint ? 'blueprint' : 'fallback',
  layoutData: layoutData,
  modules: modules
}];`;

// ═══════════════════════════════════════════════════════════
// 7. Modify Parse Furniture + Prep Open - use fixedOpenPrompt
// ═══════════════════════════════════════════════════════════
findNode('Parse Furniture + Prep Open').parameters.jsCode = `// Parse Furniture + Prep Open - Stage 2 correction + fixed open prompt
const input = $('Parse BG Result').first().json;
const response = $input.first().json;

function extractGrokImage(resp) {
  try {
    const data = resp && resp.data;
    if (data && data.length > 0 && data[0].b64_json) return data[0].b64_json;
    return null;
  } catch(e) { return null; }
}

let closedImage = extractGrokImage(response);

// Stage 2: Correction Pass
if (closedImage) {
  const grokUrl = 'https://api.x.ai/v1/images/edits';
  const apiKey = $vars.XAI_API_KEY;
  const CORRECTION_PROMPT =
    'Apply these MANDATORY corrections to this kitchen image if needed. ' +
    'If the image already satisfies all rules, output it unchanged.\\n\\n' +
    '[MANDATORY CORRECTIONS]\\n' +
    '1. CLOSED DOORS: Every cabinet must have closed doors. No open shelves, no glass-front doors.\\n' +
    '2. COOKTOP: Built-in cooktop must be visible on the countertop near the range hood.\\n' +
    '3. DRAWER CABINET: The cabinet below the cooktop must be a drawer unit (2-3 stacked drawers), not hinged door.\\n' +
    '4. FAUCET: Clear, detailed faucet \\u2014 tall arched spout, single lever, chrome or matte black.\\n' +
    '5. NO DUCT PIPE: Range hood duct fully concealed inside upper cabinet. No silver/metallic pipe visible.\\n' +
    '6. FINISHED TILES: All backsplash tiles fully grouted with clean edges.\\n' +
    '7. PROPORTIONS: No stretching or distortion compared to original photo.\\n\\n' +
    '[OUTPUT] Apply minimal corrections. Keep materials, colors, layout unchanged from input.';
  try {
    const correctionRes = await fetch(grokUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'grok-imagine-image',
        prompt: CORRECTION_PROMPT,
        image: { url: 'data:image/png;base64,' + closedImage, type: 'image_url' },
        n: 1, response_format: 'b64_json'
      }),
    });
    const correctedImage = extractGrokImage(await correctionRes.json());
    if (correctedImage) closedImage = correctedImage;
  } catch(e) { /* Stage 2 failed, use Stage 1 image */ }
}

// Use fixed open prompt
const openPrompt = input.fixedOpenPrompt || '[TASK: OPEN DOORS AND DRAWERS]\\nPRESERVE EVERYTHING - ONLY OPEN DOORS\\nHinged doors: Open outward ~90 degrees\\nDrawers: Pull out 30-40%\\nShow interior storage items.';

const grokOpenBody = {
  model: 'grok-imagine-image',
  prompt: openPrompt,
  image: { url: 'data:image/png;base64,' + closedImage, type: 'image_url' },
  n: 1, response_format: 'b64_json'
};

return [{
  grokAuth: "Bearer " + $vars.XAI_API_KEY,
  cleanedBackground: input.cleanedBackground,
  closedImage,
  hasClosedImage: !!closedImage,
  grokOpenBody: JSON.stringify(grokOpenBody),
  category: input.category,
  style: input.style,
  analysisResult: input.analysisResult,
  coordinateFrame: input.coordinateFrame,
  s1Analysis: input.s1Analysis,
  analysisMethod: input.analysisMethod,
  hasBlueprint: input.hasBlueprint || false,
  hasMask: input.hasMask || false,
  renderingMode: input.renderingMode || 'fallback',
  layoutData: input.layoutData || null,
  modules: input.modules || null
}];`;

// ═══════════════════════════════════════════════════════════
// 8. Add Format Response node (replaces Build S4 → Claude S4 → Format+QA chain)
// ═══════════════════════════════════════════════════════════
wf.nodes.push({
  parameters: {
    jsCode: `// Format Response - simplified (no QA)
const prev = $('Parse Furniture + Prep Open').first().json;
const openResponse = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;

function extractGrokImage(resp) {
  try {
    const data = resp && resp.data;
    if (data && data.length > 0 && data[0].b64_json) return data[0].b64_json;
    return null;
  } catch(e) { return null; }
}

const openImage = extractGrokImage(openResponse);

return [{
  success: true,
  message: 'Claude S1 analysis + 3-stage Grok image generation complete',
  processing: 'claude-s1 + grok-3-stage',
  category: prev.category,
  style: prev.style,
  pipe_analysis: {
    method: prev.analysisMethod || 'default',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    wall_width_mm: analysis.wall_width_mm,
    wall_height_mm: analysis.wall_height_mm,
    wall_structure: cf && cf.wall_boundaries ? cf.wall_boundaries.wall_structure : null,
    confidence: analysis.confidence,
    coordinate_frame: cf || null,
    rendering_mode: prev.renderingMode || 'fallback',
    has_blueprint: prev.hasBlueprint || false,
    layout_data: prev.layoutData || null
  },
  generated_image: {
    background: { base64: prev.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background' },
    closed: { base64: prev.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture added (closed)' },
    open: { base64: openImage, mime_type: 'image/png', description: 'Stage 3: Doors open' }
  }
}];`
  },
  id: 'a1b2c3d4-format-response-v9',
  name: 'Format Response',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [19728, 14448]
});

// ═══════════════════════════════════════════════════════════
// 9. Modify Format Response (Closed) - update message, remove QA
// ═══════════════════════════════════════════════════════════
findNode('Format Response (Closed)').parameters.jsCode = `const input = $('Parse Furniture + Prep Open').first().json;
const analysis = input.analysisResult;
const cf = input.coordinateFrame;

return [{
  success: true,
  message: 'Claude S1 analysis + image generation complete (closed doors only)',
  processing: 'claude-s1 + grok-2-stage',
  category: input.category,
  style: input.style,
  pipe_analysis: {
    method: input.analysisMethod || 'default',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    wall_width_mm: analysis.wall_width_mm,
    wall_height_mm: analysis.wall_height_mm,
    confidence: analysis.confidence,
    coordinate_frame: cf || null,
    rendering_mode: input.renderingMode || 'fallback',
    has_blueprint: input.hasBlueprint || false,
    layout_data: input.layoutData || null
  },
  generated_image: {
    background: { base64: input.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background' },
    closed: { base64: input.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture added (closed)' },
    open: null
  }
}];`;

// ═══════════════════════════════════════════════════════════
// 10. Modify Format Response (Error) - change node reference
// ═══════════════════════════════════════════════════════════
findNode('Format Response (Error)').parameters.jsCode = `const input = $('Build Fixed Prompts').first().json;
return [{json: {
  success: false,
  message: 'Background cleanup failed',
  error_detail: 'Background cleanup failed - Grok could not generate cleaned image',
  category: input.category
}}];`;

// ═══════════════════════════════════════════════════════════
// 11. Rewrite connections
// ═══════════════════════════════════════════════════════════
wf.connections = {
  "Webhook": { "main": [[{ "node": "Parse Input", "type": "main", "index": 0 }]] },
  "Parse Input": { "main": [[{ "node": "Build S1 Request", "type": "main", "index": 0 }]] },
  "Build S1 Request": { "main": [[{ "node": "Claude S1 Analysis", "type": "main", "index": 0 }]] },
  "Claude S1 Analysis": { "main": [[{ "node": "Parse S1 + Positions", "type": "main", "index": 0 }]] },
  "Parse S1 + Positions": { "main": [[{ "node": "Build Fixed Prompts", "type": "main", "index": 0 }]] },
  "Build Fixed Prompts": { "main": [[{ "node": "Grok Background Cleanup", "type": "main", "index": 0 }]] },
  "Grok Background Cleanup": { "main": [[{ "node": "Parse BG Result", "type": "main", "index": 0 }]] },
  "Parse BG Result": { "main": [[{ "node": "Has Cleaned BG?", "type": "main", "index": 0 }]] },
  "Has Cleaned BG?": { "main": [
    [{ "node": "Grok Furniture", "type": "main", "index": 0 }],
    [{ "node": "Format Response (Error)", "type": "main", "index": 0 }]
  ]},
  "Grok Furniture": { "main": [[{ "node": "Parse Furniture + Prep Open", "type": "main", "index": 0 }]] },
  "Parse Furniture + Prep Open": { "main": [[{ "node": "Has Closed Image?", "type": "main", "index": 0 }]] },
  "Has Closed Image?": { "main": [
    [{ "node": "Grok Open Door", "type": "main", "index": 0 }],
    [{ "node": "Format Response (Closed)", "type": "main", "index": 0 }]
  ]},
  "Grok Open Door": { "main": [[{ "node": "Format Response", "type": "main", "index": 0 }]] },
  "Format Response": { "main": [[{ "node": "Respond (All)", "type": "main", "index": 0 }]] },
  "Format Response (Closed)": { "main": [[{ "node": "Respond (Closed)", "type": "main", "index": 0 }]] },
  "Format Response (Error)": { "main": [[{ "node": "Respond (Error)", "type": "main", "index": 0 }]] }
};

// ═══════════════════════════════════════════════════════════
// 12. Compact positions (closer together since fewer nodes)
// ═══════════════════════════════════════════════════════════
const positions = {
  'Webhook':                    [16448, 14672],
  'Parse Input':                [16648, 14672],
  'Build S1 Request':           [16848, 14672],
  'Claude S1 Analysis':         [17048, 14672],
  'Parse S1 + Positions':       [17248, 14672],
  'Build Fixed Prompts':        [17448, 14672],
  'Grok Background Cleanup':    [17648, 14672],
  'Parse BG Result':            [17848, 14672],
  'Has Cleaned BG?':            [18048, 14672],
  'Grok Furniture':             [18248, 14560],
  'Parse Furniture + Prep Open':[18448, 14560],
  'Has Closed Image?':          [18648, 14560],
  'Grok Open Door':             [18848, 14448],
  'Format Response':            [19048, 14448],
  'Respond (All)':              [19248, 14448],
  'Format Response (Closed)':   [18848, 14672],
  'Respond (Closed)':           [19048, 14672],
  'Format Response (Error)':    [18248, 14784],
  'Respond (Error)':            [18448, 14784],
};

for (const node of wf.nodes) {
  if (positions[node.name]) {
    node.position = positions[node.name];
  }
}

// ═══════════════════════════════════════════════════════════
// 13. Update workflow name and version
// ═══════════════════════════════════════════════════════════
wf.name = 'Dadam Interior v9 (Simplified) - Production';

// ═══════════════════════════════════════════════════════════
// 14. Write output
// ═══════════════════════════════════════════════════════════
writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log(`\nWritten ${wf.nodes.length} nodes to ${wfPath}`);
console.log('Node list:');
wf.nodes.forEach((n, i) => console.log(`  ${i+1}. ${n.name} (${n.type})`));
console.log('\nConnections:');
Object.keys(wf.connections).forEach(k => {
  const targets = wf.connections[k].main.flat().map(c => c.node);
  console.log(`  ${k} → ${targets.join(', ')}`);
});
console.log('\nDone!');
