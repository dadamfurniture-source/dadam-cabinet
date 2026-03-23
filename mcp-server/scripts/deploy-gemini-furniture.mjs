#!/usr/bin/env node
/**
 * Furniture 파이프라인 Gemini 전환 배포 스크립트
 *
 * Pipeline:
 *   Before: Cleanup(Gemini) → Furniture(Flux LoRA) → Correction(Gemini) → Open(Gemini)
 *   After:  Cleanup(Gemini) → Furniture(Gemini v8 prompts) → Correction(Gemini) → Open(Gemini)
 *
 * Modified nodes:
 *   1. "Parse BG Result"          — v8 layout prompt builder transplant + category branching
 *   2. "Grok Furniture"           — LoRA → Gemini Code node
 *   3. "Parse Furniture + Prep Open" — Category-specific Correction + this.helpers.request fix
 *
 * Usage:
 *   node scripts/deploy-gemini-furniture.mjs [--dry-run]
 */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env'), override: false });

const N8N_KEY = process.env.N8N_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const dryRun = process.argv.includes('--dry-run');

if (!N8N_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }
if (!GEMINI_KEY) { console.error('ERROR: GEMINI_API_KEY not found'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════
// NODE CODE 1: Parse BG Result — v8 Layout Prompt Builder
// ═══════════════════════════════════════════════════════════════════
const PARSE_BG_CODE = `// ═══ Parse BG Result + v8 Layout Prompt Builder ═══
// Transplanted from v8-claude-analysis.json with category extensions
// Builds furniturePrompt for Gemini img2img furniture rendering
const prev = $('Build Fixed Prompts').first().json;
const response = $input.first().json;
const analysis = prev.analysisResult || {};
const cf = prev.coordinateFrame || {};
const category = (prev.category || '').toLowerCase();
const styleLabel = prev.style || 'Modern Minimal';
const clientPrompt = prev.clientPrompt || '';
const negativePrompt = prev.negativePrompt || '';
const cabinetSpecs = prev.cabinetSpecs || {};
const materialDescriptions = prev.materialDescriptions || [];

// Blueprint data
let layoutData = prev.layoutData || null;
let modules = prev.modules || null;
let hasBlueprint = prev.hasBlueprint || false;
const hasMask = prev.hasMask || false;
let hasModules = !!(modules && (modules.upper || modules.lower));

// ─── Parse cleaned background (Grok-compatible format) ───
function extractImg(resp) {
  try { const d = resp && resp.data; return (d && d.length > 0 && d[0].b64_json) ? d[0].b64_json : null; } catch(e) { return null; }
}
let cleanedBackground = extractImg(response);

// Retry with Gemini if first attempt failed
if (!cleanedBackground) {
  const roomImage = prev.roomImage;
  const imageType = prev.imageType || 'image/jpeg';
  const cp = prev.cleanupPrompt || 'Transform this construction site into a clean finished empty room. Preserve camera angle, walls, tiles. Remove all debris, tools, materials.';
  try {
    const r = await this.helpers.request({
      method: 'POST',
      uri: 'https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}',
      body: { contents: [{ parts: [{ text: cp }, { inlineData: { mimeType: imageType, data: roomImage } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
      json: true, timeout: 120000,
    });
    const parts = r?.candidates?.[0]?.content?.parts || [];
    const ip = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (ip?.inlineData?.data) cleanedBackground = ip.inlineData.data;
  } catch(e) {}
}

// ─── Utility positions (from Claude analysis) ───
const waterPercent = analysis.water_supply_percent || 30;
const exhaustPercent = analysis.exhaust_duct_percent || 70;
const wb = cf && cf.wall_boundaries ? cf.wall_boundaries : { width_mm: 3000, height_mm: 2400 };
const isKitchen = ['sink', 'l_shaped_sink', 'island', 'island_kitchen', 'kitchen'].includes(category);

// ═══ KITCHEN: Auto-generate blueprint if not provided ═══
if (isKitchen && !hasBlueprint && !hasModules) {
  const totalW = wb.width_mm || 3000;
  const totalH = wb.height_mm || 2400;
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

  if (!cabinetSpecs.door_color_upper) cabinetSpecs.door_color_upper = '화이트';
  if (!cabinetSpecs.door_color_lower) cabinetSpecs.door_color_lower = '화이트';
  if (!cabinetSpecs.door_finish_upper) cabinetSpecs.door_finish_upper = '무광';
  if (!cabinetSpecs.door_finish_lower) cabinetSpecs.door_finish_lower = '무광';
  if (!cabinetSpecs.countertop_color) cabinetSpecs.countertop_color = '스노우';
  if (!cabinetSpecs.handle_type) cabinetSpecs.handle_type = 'hidden (push-to-open)';
}

// ─── Korean→English material translation ───
const colorMap = {
  '화이트':'pure white', '그레이':'gray', '블랙':'matte black',
  '오크':'natural oak wood', '월넛':'dark walnut wood', '스노우':'snow white',
  '마블화이트':'white marble', '그레이마블':'gray marble', '차콜':'charcoal',
  '베이지':'beige', '네이비':'navy blue'
};
const finishMap = { '무광':'matte', '유광':'glossy', '엠보':'embossed' };
function translateColor(k) { return k ? (colorMap[k] || k) : ''; }
function translateFinish(k) { return k ? (finishMap[k] || k) : 'matte'; }

const upperColor = translateColor(cabinetSpecs.door_color_upper);
const upperFinish = translateFinish(cabinetSpecs.door_finish_upper);
const lowerColor = translateColor(cabinetSpecs.door_color_lower);
const lowerFinish = translateFinish(cabinetSpecs.door_finish_lower);
const countertopColor = translateColor(cabinetSpecs.countertop_color);
const handleType = cabinetSpecs.handle_type || 'hidden (push-to-open)';

let materialText = '';
if (upperColor) materialText += 'Upper doors: ' + upperColor + ' ' + upperFinish + '\\n';
if (lowerColor) materialText += 'Lower doors: ' + lowerColor + ' ' + lowerFinish + '\\n';
if (countertopColor) materialText += 'Countertop: ' + countertopColor + '\\n';
materialText += 'Handle: ' + handleType + '\\n';
if (materialDescriptions && materialDescriptions.length > 0) {
  materialText += 'Additional: ' + materialDescriptions.join(', ') + '\\n';
}

let furniturePrompt = '';

// ═══════════════════════════════════════════════════════════════
// KITCHEN CATEGORIES — Blueprint or Fallback with anchor points
// ═══════════════════════════════════════════════════════════════
if (isKitchen) {
  if (hasBlueprint && hasModules && modules) {
    // ─── BLUEPRINT MODE ───
    const ld = layoutData;
    const totalW = ld && ld.totalW_mm ? ld.totalW_mm : (wb.width_mm || 3000);
    const totalH = wb.height_mm || 2400;
    let layoutText = '[PRECISE CABINET LAYOUT — MUST FOLLOW EXACTLY]\\n';
    layoutText += 'Wall: ' + totalW + 'mm wide × ' + totalH + 'mm tall\\n\\n';

    if (modules.upper && modules.upper.length > 0) {
      const uTop = ld && ld.upper ? (ld.upper.y * 100).toFixed(1) : '2.5';
      const uBot = ld && ld.upper ? ((ld.upper.y + ld.upper.h) * 100).toFixed(1) : '32.5';
      layoutText += '[UPPER CABINETS] top ' + uTop + '%~' + uBot + '% of wall height, left to right:\\n';
      let accX = 0;
      modules.upper.forEach((m, i) => {
        const wNorm = ld && ld.upper && ld.upper.modules && ld.upper.modules[i] ? ld.upper.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xS = (accX * 100).toFixed(1);
        accX += wNorm;
        const xE = (accX * 100).toFixed(1);
        const dc = m.door_count || m.doorCount || 1;
        layoutText += '  ' + (i+1) + '. x: ' + xS + '~' + xE + '%, ' + wMm + 'mm wide, ' + dc + '-door cabinet\\n';
      });
      layoutText += '  (total upper: ' + modules.upper.length + ' modules, flush with ceiling)\\n\\n';
    }

    if (modules.lower && modules.lower.length > 0) {
      const lTop = ld && ld.lower ? (ld.lower.y * 100).toFixed(1) : '65.8';
      const lBot = ld && ld.lower ? ((ld.lower.y + ld.lower.h) * 100).toFixed(1) : '100';
      layoutText += '[LOWER CABINETS] bottom ' + lTop + '%~' + lBot + '% of wall height, left to right:\\n';
      let accX = 0;
      modules.lower.forEach((m, i) => {
        const wNorm = ld && ld.lower && ld.lower.modules && ld.lower.modules[i] ? ld.lower.modules[i].w : (m.width_mm || 600) / totalW;
        const wMm = m.width_mm || Math.round(wNorm * totalW);
        const xS = (accX * 100).toFixed(1);
        accX += wNorm;
        const xE = (accX * 100).toFixed(1);
        const dc = m.door_count || m.doorCount || 1;
        let extras = '';
        if (m.hasSink || m.has_sink) extras += ' [SINK at center]';
        if (m.hasCooktop || m.has_cooktop) extras += ' [COOKTOP at center]';
        layoutText += '  ' + (i+1) + '. x: ' + xS + '~' + xE + '%, ' + wMm + 'mm wide, ' + dc + '-door' + extras + '\\n';
      });
      layoutText += '\\n';
    }

    if (ld && ld.countertop) layoutText += 'Countertop: thin strip at ' + (ld.countertop.y * 100).toFixed(1) + '% height\\n';
    if (ld && ld.toeKick) layoutText += 'Toe kick: dark strip at very bottom (~' + (ld.toeKick.h * 100).toFixed(0) + '%)\\n';

    furniturePrompt = '[TASK: BLUEPRINT-GUIDED PHOTOREALISTIC FURNITURE RENDERING]\\n\\n' +
      'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n' +
      'Place furniture according to the PRECISE CABINET LAYOUT below.\\n\\n' +
      layoutText + '\\n' +
      '[UTILITY ANCHOR POINTS]\\n' +
      'Water supply pipe at ' + waterPercent + '% from left → Sink module MUST align here\\n' +
      'Exhaust duct at ' + exhaustPercent + '% from left → Cooktop module MUST align here\\n\\n' +
      '★★★ RENDERING RULES (MANDATORY) ★★★\\n' +
      '1. PRESERVE the cleaned background EXACTLY — do NOT modify walls, floor, or ceiling\\n' +
      '2. Place furniture ONLY where the layout description specifies\\n' +
      '3. Match the EXACT proportions and positions from the layout\\n' +
      '4. Each module WIDTH RATIO must match the layout precisely\\n' +
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
      '- Realistic toe kick shadow on floor\\n\\n' +
      '★★★ RANGE HOOD — BUILT-IN CONCEALED TYPE ONLY ★★★\\n' +
      'The range hood MUST be fully concealed inside the upper cabinet.\\n' +
      'NO exposed hood duct pipes or external ductwork visible.\\n\\n' +
      '[MATERIALS]\\n' + materialText + '\\n' +
      '[STYLE: ' + styleLabel + ']\\n' +
      (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
      '[PROHIBITED]\\n' +
      '- Do NOT change positions or proportions from the layout\\n' +
      '- Do NOT modify the background/wall/floor\\n' +
      '- No text, labels, or dimension markings\\n' +
      '- NO exposed hood duct or ventilation pipe\\n' +
      '- NO floating or detached furniture elements\\n' +
      (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

  } else {
    // ─── KITCHEN FALLBACK (no blueprint) ───
    const wsCenter = cf && cf.utilities && cf.utilities.water_supply && cf.utilities.water_supply.center
      ? cf.utilities.water_supply.center : { x: waterPercent * 10, y: 880 };
    const edCenter = cf && cf.utilities && cf.utilities.exhaust_duct && cf.utilities.exhaust_duct.center
      ? cf.utilities.exhaust_duct.center : { x: exhaustPercent * 10, y: 85 };
    const wsMm = { x: Math.round(wsCenter.x * (wb.mm_per_unit_x || wb.width_mm / 1000)), y: Math.round(wsCenter.y * (wb.mm_per_unit_y || wb.height_mm / 1000)) };
    const edMm = { x: Math.round(edCenter.x * (wb.mm_per_unit_x || wb.width_mm / 1000)), y: Math.round(edCenter.y * (wb.mm_per_unit_y || wb.height_mm / 1000)) };

    furniturePrompt = '[TASK: FURNITURE PLACEMENT — AI-ANALYZED UTILITY POSITIONS]\\n\\n' +
      '★★★ CRITICAL: DO NOT MODIFY THE BACKGROUND ★★★\\n' +
      'This image is a cleaned background. Do NOT alter walls, floor, ceiling, or lighting.\\n' +
      'ONLY add kitchen furniture and appliances.\\n\\n' +
      'Wall dimensions: ' + (wb.width_mm || 3000) + 'mm × ' + (wb.height_mm || 2400) + 'mm\\n\\n' +
      '[ANCHOR POINT 1: Water Supply → Sink Center]\\n' +
      '  Millimeters: ' + wsMm.x + 'mm from left\\n' +
      '  Percentage:  ' + waterPercent + '% from left edge\\n' +
      '  → Place SINK BOWL center exactly at ' + waterPercent + '% from left\\n\\n' +
      '[ANCHOR POINT 2: Exhaust Duct → Cooktop Center]\\n' +
      '  Millimeters: ' + edMm.x + 'mm from left\\n' +
      '  Percentage:  ' + exhaustPercent + '% from left edge\\n' +
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
      '[MATERIALS]\\n' + materialText + '\\n' +
      '[STYLE: ' + styleLabel + ']\\n' +
      (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
      '[PROHIBITED]\\n' +
      '- Do NOT modify background/walls/floor\\n' +
      '- No text, labels, or dimensions\\n' +
      '- NO exposed/chimney/wall-mount range hood\\n' +
      '- NO gap between upper cabinets and ceiling\\n' +
      (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');
  }

// ═══════════════════════════════════════════════════════════════
// NON-KITCHEN CATEGORIES
// ═══════════════════════════════════════════════════════════════
} else if (category === 'wardrobe') {
  furniturePrompt = '[TASK: PHOTOREALISTIC BUILT-IN WARDROBE RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n\\n' +
    '[WARDROBE LAYOUT]\\n' +
    'Wall: ' + (wb.width_mm || 3000) + 'mm wide × ' + (wb.height_mm || 2400) + 'mm tall\\n' +
    '- Full-width built-in wardrobe covering the entire wall\\n' +
    '- Floor-to-ceiling installation (no gap at top or bottom)\\n' +
    '- Multiple sections with hinged or sliding doors\\n' +
    '- Interior composition: hanging rod section + shelf section + drawer section\\n' +
    '- All doors CLOSED in this rendering\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '★★★ RENDERING RULES ★★★\\n' +
    '- Photorealistic quality with proper shadows and reflections\\n' +
    '- Doors must be uniform with consistent gap spacing (2-3mm)\\n' +
    '- Handles aligned horizontally across all doors\\n' +
    '- Realistic edge profiles and panel construction\\n\\n' +
    '[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- No glass-front doors unless specified\\n' +
    '- No text, labels, or dimensions\\n' +
    '- No floating or detached elements\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

} else if (category === 'shoe_cabinet') {
  furniturePrompt = '[TASK: PHOTOREALISTIC SHOE CABINET RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n\\n' +
    '[SHOE CABINET LAYOUT]\\n' +
    'Wall: ' + (wb.width_mm || 3000) + 'mm wide × ' + (wb.height_mm || 2400) + 'mm tall\\n' +
    '- Slim profile shoe cabinet (300-400mm depth)\\n' +
    '- Floor-to-ceiling or partial height as appropriate for the space\\n' +
    '- Internal tilted shoe shelves (15-20 degree angle) for efficient storage\\n' +
    '- All doors CLOSED in this rendering\\n' +
    '- Clean minimal door fronts\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '★★★ RENDERING RULES ★★★\\n' +
    '- Photorealistic quality with proper shadows\\n' +
    '- Slim proportions — cabinet must NOT look deep/bulky\\n' +
    '- Consistent door gaps and handle alignment\\n\\n' +
    '[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- No text, labels, or dimensions\\n' +
    '- Cabinet depth must not exceed 400mm visual appearance\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

} else if (category === 'fridge_cabinet') {
  furniturePrompt = '[TASK: PHOTOREALISTIC REFRIGERATOR CABINET RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n\\n' +
    '[FRIDGE CABINET LAYOUT]\\n' +
    'Wall: ' + (wb.width_mm || 3000) + 'mm wide × ' + (wb.height_mm || 2400) + 'mm tall\\n' +
    '- Center: refrigerator opening (~700mm wide × 1800mm tall)\\n' +
    '- Side panels: tall storage cabinets flanking the refrigerator\\n' +
    '- Upper cabinet: bridge cabinet above refrigerator opening\\n' +
    '- Floor-to-ceiling installation\\n' +
    '- All cabinet doors CLOSED in this rendering\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '★★★ RENDERING RULES ★★★\\n' +
    '- Photorealistic quality with proper shadows\\n' +
    '- Refrigerator opening must be clearly defined and centered\\n' +
    '- Side cabinets must be symmetrical\\n' +
    '- Consistent material and color across all panels\\n\\n' +
    '[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- Do NOT render a refrigerator — only the cabinet surround\\n' +
    '- No text, labels, or dimensions\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

} else if (category === 'vanity') {
  furniturePrompt = '[TASK: PHOTOREALISTIC BATHROOM VANITY RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n\\n' +
    '[VANITY LAYOUT]\\n' +
    'Wall: ' + (wb.width_mm || 3000) + 'mm wide × ' + (wb.height_mm || 2400) + 'mm tall\\n' +
    '- Lower: vanity cabinet with integrated sink basin\\n' +
    '- Sink position: aligned at ' + waterPercent + '% from left (water supply location)\\n' +
    '- Upper: mirror cabinet above vanity\\n' +
    '- Faucet: single-lever mixer, chrome or matte finish\\n' +
    '- Countertop: extending full width of vanity\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '★★★ RENDERING RULES ★★★\\n' +
    '- Photorealistic quality with proper reflections on mirror\\n' +
    '- Sink must align with water supply position\\n' +
    '- Mirror cabinet proportional to vanity below\\n' +
    '- Realistic water fixture and basin details\\n\\n' +
    '[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- No text, labels, or dimensions\\n' +
    '- No floating or detached elements\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');

} else {
  // ─── GENERIC STORAGE CABINET ───
  furniturePrompt = '[TASK: PHOTOREALISTIC STORAGE CABINET RENDERING]\\n\\n' +
    'This image is a cleaned background photo. PRESERVE EXACTLY — do NOT modify walls, floor, ceiling, or lighting.\\n\\n' +
    '[STORAGE CABINET LAYOUT]\\n' +
    'Wall: ' + (wb.width_mm || 3000) + 'mm wide × ' + (wb.height_mm || 2400) + 'mm tall\\n' +
    '- Built-in storage cabinet covering the wall\\n' +
    '- Floor-to-ceiling installation\\n' +
    '- Multiple door sections with adjustable interior shelves\\n' +
    '- All doors CLOSED in this rendering\\n\\n' +
    '[MATERIALS]\\n' + materialText + '\\n' +
    '[STYLE: ' + styleLabel + ']\\n' +
    (clientPrompt ? '[CLIENT SPECIFICATIONS]\\n' + clientPrompt + '\\n' : '') +
    '★★★ RENDERING RULES ★★★\\n' +
    '- Photorealistic quality with proper shadows and reflections\\n' +
    '- Consistent door gaps and handle alignment\\n' +
    '- Realistic edge profiles\\n\\n' +
    '[PROHIBITED]\\n' +
    '- Do NOT modify background/walls/floor\\n' +
    '- No text, labels, or dimensions\\n' +
    '- No floating or detached elements\\n' +
    (negativePrompt ? '[ADDITIONAL RESTRICTIONS]\\n' + negativePrompt : '');
}

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  furniturePrompt,
  category: prev.category,
  style: prev.style,
  analysisResult: analysis,
  coordinateFrame: cf,
  fixedOpenPrompt: prev.fixedOpenPrompt,
  s1Analysis: prev.s1Analysis,
  analysisMethod: prev.analysisMethod,
  hasBlueprint: !!hasBlueprint,
  hasMask: !!hasMask,
  hasModules: !!hasModules,
  renderingMode: hasBlueprint ? 'blueprint' : (isKitchen ? 'fallback' : category),
  layoutData: layoutData,
  modules: modules
}];`;


// ═══════════════════════════════════════════════════════════════════
// NODE CODE 2: Grok Furniture — Gemini img2img (replaces Flux LoRA)
// ═══════════════════════════════════════════════════════════════════
const GROK_FURNITURE_CODE = `// ═══ Gemini Furniture Generation (replaces Flux LoRA) ═══
// Uses furniturePrompt + cleanedBackground → Gemini img2img
// Output: Grok-compatible { data: [{ b64_json }] }
const input = $input.first().json;
const furniturePrompt = input.furniturePrompt || '';
const cleanedBackground = input.cleanedBackground || '';

if (!cleanedBackground) {
  return [{ json: { data: [], _error: 'No cleaned background image' } }];
}
if (!furniturePrompt) {
  return [{ json: { data: [], _error: 'No furniture prompt' } }];
}

const GEMINI_URI = 'https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}';

let lastError = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const r = await this.helpers.request({
      method: 'POST',
      uri: GEMINI_URI,
      body: {
        contents: [{ parts: [
          { text: furniturePrompt },
          { inlineData: { mimeType: 'image/png', data: cleanedBackground } }
        ]}],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 }
      },
      json: true,
      timeout: 120000,
    });

    const parts = r?.candidates?.[0]?.content?.parts || [];
    const ip = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (ip?.inlineData?.data) {
      return [{ json: { data: [{ b64_json: ip.inlineData.data }], _source: 'gemini-furniture' } }];
    }

    const tp = parts.find(p => p.text);
    lastError = 'No image' + (tp ? ': ' + tp.text.substring(0, 100) : '');
  } catch(e) {
    lastError = (e.message || '') + ' | status:' + (e.statusCode || '?');
  }
  if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
}

return [{ json: { data: [], _error: 'Furniture: ' + lastError } }];`;


// ═══════════════════════════════════════════════════════════════════
// NODE CODE 3: Parse Furniture + Prep Open — Category Correction
// ═══════════════════════════════════════════════════════════════════
const PARSE_FURNITURE_CODE = `// ═══ Parse Furniture + Prep Open — Category-specific Correction ═══
// Stage 2: Gemini Correction with category-aware validation
// Then prepares open-door prompt for Stage 3
const input = $('Parse BG Result').first().json;
const response = $input.first().json;
const category = (input.category || '').toLowerCase();

function extractImage(resp) {
  try { const d = resp && resp.data; return (d && d.length > 0 && d[0].b64_json) ? d[0].b64_json : null; } catch(e) { return null; }
}

let closedImage = extractImage(response);

// ─── Stage 2: Category-specific Gemini Correction ───
if (closedImage) {
  const isKitchen = ['sink', 'l_shaped_sink', 'island', 'island_kitchen', 'kitchen'].includes(category);

  let correctionPrompt = 'Apply these MANDATORY corrections to this furniture image if needed. ' +
    'If the image already satisfies all rules, output it unchanged.\\n\\n' +
    '[MANDATORY CORRECTIONS]\\n' +
    '1. PROPORTIONS: No stretching, squashing, or distortion compared to original photo.\\n' +
    '2. ALIGNMENT: All cabinet edges must be straight and properly aligned.\\n' +
    '3. CLOSED DOORS: Every cabinet must have closed doors. No open shelves.\\n';

  if (isKitchen) {
    correctionPrompt +=
      '4. SINK: Stainless steel sink bowl MUST be visible on the countertop.\\n' +
      '5. FAUCET: Clear, detailed faucet — tall arched spout, single lever, chrome or matte black.\\n' +
      '6. COOKTOP: Built-in cooktop MUST be visible on the countertop near the range hood area.\\n' +
      '7. RANGE HOOD: Fully concealed inside upper cabinet. NO exposed duct pipe or silver/metallic pipe.\\n' +
      '8. DRAWER CABINET: Cabinet below cooktop must be a drawer unit (2-3 stacked drawers).\\n' +
      '9. TILES: All backsplash tiles fully grouted with clean edges.\\n' +
      '10. UPPER CABINETS: Must be flush with ceiling — NO gap at top.\\n';
  } else if (category === 'wardrobe') {
    correctionPrompt +=
      '4. DOOR UNIFORMITY: All doors must be same width ratio and aligned.\\n' +
      '5. HANDLES: All handles must be at same height and consistently styled.\\n' +
      '6. FLOOR-TO-CEILING: No gap at top or bottom of wardrobe.\\n';
  } else if (category === 'vanity') {
    correctionPrompt +=
      '4. SINK BASIN: Must be clearly visible and properly integrated.\\n' +
      '5. FAUCET: Clear, detailed faucet fixture.\\n' +
      '6. MIRROR: Mirror cabinet above must be properly proportioned.\\n';
  } else {
    correctionPrompt +=
      '4. DOOR ALIGNMENT: All doors must be uniform and properly aligned.\\n' +
      '5. HANDLES: Consistent handle style and positioning.\\n';
  }

  correctionPrompt += '\\n[OUTPUT] Apply minimal corrections. Keep materials, colors, layout unchanged from input.';

  try {
    const geminiRes = await this.helpers.request({
      method: 'POST',
      uri: 'https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}',
      body: {
        contents: [{ parts: [
          { text: correctionPrompt },
          { inlineData: { mimeType: 'image/png', data: closedImage } }
        ]}],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      },
      json: true,
      timeout: 120000,
    });
    const parts = geminiRes?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (imgPart?.inlineData?.data) {
      closedImage = imgPart.inlineData.data;
    }
  } catch(e) { /* Correction failed, use Stage 1 image */ }
}

// Prepare Open prompt
const openPrompt = input.fixedOpenPrompt || '[TASK: OPEN DOORS AND DRAWERS]\\nPRESERVE EVERYTHING - ONLY OPEN DOORS\\nHinged doors: Open outward ~90 degrees\\nDrawers: Pull out 30-40%\\nShow interior storage items.';

return [{
  closedImage,
  hasClosedImage: !!closedImage,
  openPrompt,
  cleanedBackground: input.cleanedBackground,
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


// ═══════════════════════════════════════════════════════════════════
// MAIN DEPLOYMENT FLOW
// ═══════════════════════════════════════════════════════════════════

async function n8nFetch(url, opts, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      console.warn(`   Network error (attempt ${i}/${retries}): ${e.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, 3000));
      else throw e;
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  Furniture Pipeline: Flux LoRA → Gemini v8 Prompts');
console.log('═══════════════════════════════════════════════════════');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOY'}`);
console.log();

// ─── Step 0: Fetch workflow ───
console.log('0. Fetching workflow from n8n Cloud...');
const wfRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
if (!wfRes.ok) {
  console.error(`ERROR: Failed to fetch workflow: ${wfRes.status}`);
  process.exit(1);
}
const wf = await wfRes.json();
console.log(`   Fetched: "${wf.name}" (${wf.nodes.length} nodes, active: ${wf.active})`);

// ─── Step 1: Backup ───
const tmpDir = resolve(__dirname, '../tmp');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const backupPath = resolve(tmpDir, 'pre-gemini-furniture-backup.json');
writeFileSync(backupPath, JSON.stringify(wf, null, 2));
console.log(`1. Backup saved: ${backupPath}`);

// ─── Step 2: Modify "Parse BG Result" ───
const pbrIdx = wf.nodes.findIndex(n => n.name === 'Parse BG Result');
if (pbrIdx === -1) {
  console.error('ERROR: "Parse BG Result" node not found');
  process.exit(1);
}
wf.nodes[pbrIdx].parameters.jsCode = PARSE_BG_CODE;
console.log(`2. Parse BG Result: v8 layout prompt builder (${PARSE_BG_CODE.length} chars)`);

// ─── Step 3: Replace "Grok Furniture" ───
const gfIdx = wf.nodes.findIndex(n => n.name === 'Grok Furniture');
if (gfIdx === -1) {
  console.error('ERROR: "Grok Furniture" node not found');
  process.exit(1);
}
const gfOld = wf.nodes[gfIdx];
wf.nodes[gfIdx] = {
  id: gfOld.id,
  name: gfOld.name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: gfOld.position,
  parameters: { jsCode: GROK_FURNITURE_CODE }
};
console.log(`3. Grok Furniture: LoRA → Gemini Code node (${GROK_FURNITURE_CODE.length} chars)`);

// ─── Step 4: Modify "Parse Furniture + Prep Open" ───
const pfIdx = wf.nodes.findIndex(n => n.name === 'Parse Furniture + Prep Open');
if (pfIdx === -1) {
  console.error('ERROR: "Parse Furniture + Prep Open" node not found');
  process.exit(1);
}
wf.nodes[pfIdx].parameters.jsCode = PARSE_FURNITURE_CODE;
console.log(`4. Parse Furniture + Prep Open: category correction (${PARSE_FURNITURE_CODE.length} chars)`);

// ─── Step 4.5: Replace old Gemini API key in ALL remaining nodes ───
const OLD_KEY = 'AIzaSyBUkAqtH585oxKwmObMak_lyiZRwaY4BaI';
let keyReplacements = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  if (node.parameters.jsCode.includes(OLD_KEY)) {
    node.parameters.jsCode = node.parameters.jsCode.replace(new RegExp(OLD_KEY, 'g'), GEMINI_KEY);
    keyReplacements++;
    console.log(`   Key updated: "${node.name}"`);
  }
}
console.log(`4.5. Gemini API key: ${keyReplacements} nodes updated`);

// ─── Step 5: Validation ───
console.log('\n5. Validation...');
let issues = 0;

// Check for LoRA / Replicate references
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || '';
  if (code.includes('replicate.com') || code.includes('REPLICATE')) {
    console.error(`   WARNING: LoRA/Replicate ref in "${node.name}"`);
    issues++;
  }
}

// Check for xAI references
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || '';
  const params = JSON.stringify(node.parameters || {});
  if (code.includes('api.x.ai') || params.includes('api.x.ai')) {
    console.error(`   WARNING: xAI ref in "${node.name}"`);
    issues++;
  }
}

// Check for fetch() usage in modified nodes (should use this.helpers.request)
const modifiedNames = ['Parse BG Result', 'Grok Furniture', 'Parse Furniture + Prep Open'];
for (const name of modifiedNames) {
  const node = wf.nodes.find(n => n.name === name);
  if (node?.parameters?.jsCode) {
    // Check for standalone fetch( calls (not this.helpers.request)
    const fetchMatches = node.parameters.jsCode.match(/(?<!this\.helpers\.request.*?)await\s+fetch\(/g);
    if (fetchMatches) {
      console.error(`   WARNING: "${name}" uses fetch() instead of this.helpers.request`);
      issues++;
    }
  }
}

// Check for $vars references
let varsLeft = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  const matches = node.parameters.jsCode.match(/\$vars\./g);
  if (matches) {
    console.error(`   WARNING: ${node.name} has ${matches.length} $vars references`);
    varsLeft += matches.length;
    issues++;
  }
}

// Verify Gemini model in modified nodes
for (const name of modifiedNames) {
  const node = wf.nodes.find(n => n.name === name);
  if (node?.parameters?.jsCode?.includes(MODEL)) {
    console.log(`   ✓ "${name}" uses ${MODEL}`);
  } else if (name === 'Parse BG Result') {
    // Parse BG Result may have Gemini in retry section
    console.log(`   ✓ "${name}" updated (prompt builder mode)`);
  }
}

console.log(`   $vars: ${varsLeft === 0 ? 'CLEAN' : varsLeft + ' remaining'}`);
console.log(`   LoRA/xAI refs: ${issues === 0 ? 'CLEAN' : issues + ' issues'}`);

// ─── Step 6: Dry run or Deploy ───
if (dryRun) {
  const outPath = resolve(tmpDir, 'gemini-furniture-preview.json');
  writeFileSync(outPath, JSON.stringify(wf, null, 2));

  console.log(`\n${'─'.repeat(60)}`);
  console.log('Parse BG Result (first 300 chars):');
  console.log(PARSE_BG_CODE.substring(0, 300) + '...');
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Grok Furniture (first 300 chars):');
  console.log(GROK_FURNITURE_CODE.substring(0, 300) + '...');
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Parse Furniture Correction (first 300 chars):');
  console.log(PARSE_FURNITURE_CODE.substring(0, 300) + '...');
  console.log(`\nDry run saved: ${outPath}`);
  console.log('Deploy with: node scripts/deploy-gemini-furniture.mjs');
  process.exit(0);
}

// ─── Deploy to n8n Cloud ───
console.log('\n─── Deploying to n8n Cloud ───');

// Step A: Deactivate
console.log('A. Deactivating workflow...');
const deactRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
console.log(`   Deactivate: ${deactRes.status}`);

// Step B: Update
console.log('B. Updating workflow...');
const putRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
    name: wf.name,
  }),
});
if (!putRes.ok) {
  const errText = await putRes.text();
  console.error(`DEPLOY FAILED: ${putRes.status}`);
  console.error(errText.substring(0, 500));
  process.exit(1);
}
console.log(`   Update: ${putRes.status} OK`);

// Step C: Activate
console.log('C. Activating workflow...');
const actRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
console.log(`   Activate: ${actRes.status}`);

// Step D: Verify
console.log('\nD. Verifying deployment...');
const verifyRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
const verified = await verifyRes.json();

const pbrV = verified.nodes.find(n => n.name === 'Parse BG Result');
const gfV = verified.nodes.find(n => n.name === 'Grok Furniture');
const pfV = verified.nodes.find(n => n.name === 'Parse Furniture + Prep Open');

console.log(`   Active: ${verified.active}`);
console.log(`   Parse BG Result: has blueprint builder = ${pbrV?.parameters?.jsCode?.includes('distributeModules') || false}`);
console.log(`   Grok Furniture: type = ${gfV?.type}, has Gemini = ${gfV?.parameters?.jsCode?.includes(MODEL) || false}`);
console.log(`   Parse Furniture: has category correction = ${pfV?.parameters?.jsCode?.includes('isKitchen') || false}`);
console.log(`   LoRA refs: ${gfV?.parameters?.jsCode?.includes('replicate') ? 'WARNING' : 'CLEAN'}`);

// ─── Summary ───
console.log(`\n${'═'.repeat(60)}`);
console.log('DEPLOYMENT COMPLETE');
console.log(`${'═'.repeat(60)}`);
console.log('Pipeline: Cleanup(Gemini) → Furniture(Gemini v8) → Correction(Gemini) → Open(Gemini)');
console.log('');
console.log('Changes:');
console.log('  1. Parse BG Result: v8 layout prompt builder transplanted');
console.log('     - Blueprint mode for kitchen (sink/island) with anchor points');
console.log('     - Category-specific prompts for wardrobe/shoe/fridge/vanity/storage');
console.log('  2. Grok Furniture: Flux LoRA → Gemini img2img');
console.log('     - Uses this.helpers.request (not fetch)');
console.log('     - 3-attempt retry with exponential backoff');
console.log('  3. Parse Furniture: Category-specific Correction');
console.log('     - Kitchen: sink/faucet/cooktop/hood validation');
console.log('     - Wardrobe: door uniformity validation');
console.log('     - Fixed: fetch() → this.helpers.request');
console.log('');
console.log('Rollback: restore from tmp/pre-gemini-furniture-backup.json');
