#!/usr/bin/env node
// Update Parse S3 (lower temp) + Parse BG Result (retry logic + camera preservation)
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// ===== Parse S3 + Build Bodies: lower temperature 0.4 → 0.2 =====
const PARSE_S3_CODE = `// Parse S3 + Build Bodies (v3.1) - lower temp + safe fallback
const prev = $('Build S3 Request').first().json;
const s3Response = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;

let s3Prompts = null;
try {
  const content = s3Response.content || [];
  const textBlock = content.find(b => b.type === 'text');
  if (textBlock && textBlock.text) {
    const jsonMatch = textBlock.text.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) s3Prompts = JSON.parse(jsonMatch[0]);
  }
} catch(e) { s3Prompts = null; }

const debrisList = analysis.construction_debris && analysis.construction_debris.length > 0 ? analysis.construction_debris.join(', ') : 'construction debris, tools, temporary items';
const ragBg = prev.ragBg || [];

let cleanupPrompt, s3FurniturePrompt, s3OpenPrompt;

if (s3Prompts && s3Prompts.cleanup_prompt && s3Prompts.furniture_prompt && s3Prompts.open_prompt) {
  cleanupPrompt = s3Prompts.cleanup_prompt;
  s3FurniturePrompt = s3Prompts.furniture_prompt;
  s3OpenPrompt = s3Prompts.open_prompt;
  if (cleanupPrompt.length > 900) cleanupPrompt = cleanupPrompt.substring(0, 800);
  if (s3FurniturePrompt.length > 1500) s3FurniturePrompt = s3FurniturePrompt.substring(0, 1400);
} else {
  cleanupPrompt = '[BACKGROUND CLEANUP]\\n' +
    'Transform this construction site photo into a finished empty room.\\n' +
    'PRESERVE EXACTLY: camera angle, perspective, viewpoint, wall structure, window frames.\\n' +
    'REMOVE: ' + debrisList + ', people, loose materials.\\n' +
    'FILL: walls with smooth painted finish. ceiling with white flat ceiling and recessed LED. floor with light oak vinyl flooring.\\n' +
    (ragBg.length > 0 ? ragBg.slice(0, 3).join('\\n') + '\\n' : '') +
    'Result: Photorealistic finished empty Korean apartment room.';
  s3FurniturePrompt = null;
  s3OpenPrompt = null;
}

const geminiCleanupBody = {
  contents: [{
    parts: [
      { text: cleanupPrompt },
      { inline_data: { mime_type: prev.imageType || 'image/jpeg', data: prev.roomImage } }
    ]
  }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.2 }
};

return {
  geminiCleanupBody: JSON.stringify(geminiCleanupBody),
  cleanupPrompt,
  s3FurniturePrompt,
  s3OpenPrompt,
  s3Success: !!(s3Prompts),
  cleanupPromptLength: cleanupPrompt.length,
  category: prev.category,
  style: prev.style,
  roomImage: prev.roomImage,
  imageType: prev.imageType,
  analysisResult: analysis,
  coordinateFrame: cf,
  s1Analysis: prev.s1Analysis,
  analysisMethod: prev.analysisMethod,
  modules: prev.modules,
  layoutData: prev.layoutData,
  hasBlueprint: prev.hasBlueprint,
  hasMask: prev.hasMask,
  hasModules: prev.hasModules,
  clientPrompt: prev.clientPrompt || '',
  negativePrompt: prev.negativePrompt || '',
  cabinetSpecs: prev.cabinetSpecs || {},
  layoutImage: prev.layoutImage,
  maskImage: prev.maskImage,
  referenceImages: prev.referenceImages,
  materialDescriptions: prev.materialDescriptions,
  ragResults: prev.ragResults || [],
  ragBg: prev.ragBg, ragModules: prev.ragModules, ragDoors: prev.ragDoors,
  ragMaterials: prev.ragMaterials, ragDims: prev.ragDims
};`;

// ===== Parse BG Result: add retry logic + camera angle preservation =====
const PARSE_BG_CODE = `// Parse BG Result (v3.1) - Retry on IMAGE_OTHER + camera angle preservation
const prev = $('Parse S3 + Build Bodies').first().json;
const response = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;
const wb = cf ? cf.wall_boundaries : { width_mm: 3000, height_mm: 2400, mm_per_unit_x: 3.0, mm_per_unit_y: 2.4 };
const modules = prev.modules;
const layoutData = prev.layoutData;
const hasBlueprint = prev.hasBlueprint;
const hasModules = prev.hasModules;
const cabinetSpecs = prev.cabinetSpecs || {};
const materialDescriptions = prev.materialDescriptions || [];
const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;

function extractGeminiImage(resp) {
  try {
    var parts = (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || [];
    var img = parts.find(function(p) { return p.inlineData || p.inline_data; });
    return img ? (img.inlineData || img.inline_data).data : null;
  } catch(e) { return null; }
}

// First attempt from HTTP Request node
let cleanedBackground = extractGeminiImage(response);

// Retry on IMAGE_OTHER: up to 2 retries with different temperature
if (!cleanedBackground) {
  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
  const apiKey = $vars.GEMINI_API_KEY;
  const cleanupPrompt = prev.cleanupPrompt || 'Clean this construction site into a finished empty room. Preserve camera angle.';
  const roomImage = prev.roomImage;
  const imageType = prev.imageType || 'image/jpeg';

  for (let retry = 1; retry <= 2 && !cleanedBackground; retry++) {
    const retryTemp = retry === 1 ? 0.3 : 0.5;
    try {
      const retryBody = JSON.stringify({
        contents: [{
          parts: [
            { text: cleanupPrompt },
            { inline_data: { mime_type: imageType, data: roomImage } }
          ]
        }],
        generationConfig: { responseModalities: ['image', 'text'], temperature: retryTemp }
      });
      const retryRes = await fetch(geminiUrl + '?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: retryBody,
      });
      const retryData = await retryRes.json();
      cleanedBackground = extractGeminiImage(retryData);
    } catch(e) { /* continue to next retry */ }
  }
}

// Build furniture prompt: use S3 if available, otherwise fallback
let furniturePrompt;
if (prev.s3FurniturePrompt) {
  furniturePrompt = prev.s3FurniturePrompt;
  // Ensure camera angle preservation is first line
  if (!furniturePrompt.startsWith('PRESERVE EXACTLY')) {
    furniturePrompt = 'PRESERVE EXACTLY the camera angle, perspective, and viewpoint from this input image. Do NOT change the viewing angle.\\n' + furniturePrompt;
  }
} else {
  const colorMap = { '화이트':'pure white', '그레이':'gray', '블랙':'matte black', '오크':'natural oak wood', '월넛':'dark walnut wood', '스노우':'snow white', '마블화이트':'white marble', '그레이마블':'gray marble', '차콜':'charcoal', '베이지':'beige', '네이비':'navy blue' };
  const finishMap = { '무광':'matte', '유광':'glossy', '엠보':'embossed' };
  function tr(k,m) { return m[k] || k || ''; }

  const ragModules = prev.ragModules || [];
  const ragDoors = prev.ragDoors || [];
  const ragMaterials = prev.ragMaterials || [];
  let ragSections = '';
  if (ragModules.length > 0) ragSections += '\\n[MODULE RULES]\\n' + ragModules.join('\\n') + '\\n';
  if (ragDoors.length > 0) ragSections += '\\n[DOOR RULES]\\n' + ragDoors.join('\\n') + '\\n';
  if (ragMaterials.length > 0) {
    ragSections += '\\n[MATERIAL SPECS]\\n';
    ragMaterials.forEach(m => { ragSections += '[' + (m.trigger || '') + '] ' + m.content + '\\n'; });
  }

  if (hasBlueprint && hasModules && modules) {
    const totalW = layoutData && layoutData.totalW_mm ? layoutData.totalW_mm : (wb.width_mm || 3000);
    let layoutText = '[PRECISE CABINET LAYOUT]\\nWall: ' + totalW + 'mm wide x ' + (wb.height_mm || 2400) + 'mm tall\\n\\n';
    const ld = layoutData;
    if (modules.upper && modules.upper.length > 0) {
      layoutText += '[UPPER CABINETS] left to right:\\n';
      let accX = 0;
      modules.upper.forEach((m, i) => {
        const wNorm = ld && ld.upper && ld.upper.modules && ld.upper.modules[i] ? ld.upper.modules[i].w : (m.width_mm || 600) / totalW;
        layoutText += '  ' + (i+1) + '. x: ' + (accX * 100).toFixed(1) + '~' + ((accX + wNorm) * 100).toFixed(1) + '%, ' + (m.width_mm || Math.round(wNorm * totalW)) + 'mm, ' + (m.door_count || 1) + '-door\\n';
        accX += wNorm;
      });
      layoutText += '\\n';
    }
    if (modules.lower && modules.lower.length > 0) {
      layoutText += '[LOWER CABINETS] left to right:\\n';
      let accX = 0;
      modules.lower.forEach((m, i) => {
        const wNorm = ld && ld.lower && ld.lower.modules && ld.lower.modules[i] ? ld.lower.modules[i].w : (m.width_mm || 600) / totalW;
        let extras = '';
        if (m.hasSink || m.has_sink) extras += ' [SINK]';
        if (m.hasCooktop || m.has_cooktop) extras += ' [COOKTOP]';
        layoutText += '  ' + (i+1) + '. x: ' + (accX * 100).toFixed(1) + '~' + ((accX + wNorm) * 100).toFixed(1) + '%, ' + (m.width_mm || Math.round(wNorm * totalW)) + 'mm, ' + (m.door_count || 1) + '-door' + extras + '\\n';
        accX += wNorm;
      });
    }
    furniturePrompt = 'PRESERVE EXACTLY the camera angle, perspective, and viewpoint from this input image. Do NOT change the viewing angle.\\n' +
      'Place photorealistic built-in kitchen cabinets on this cleaned background.\\n\\n' + layoutText + '\\n' +
      '[UTILITY ANCHOR POINTS]\\nWater supply at ' + waterPercent + '% → Sink\\nExhaust duct at ' + exhaustPercent + '% → Cooktop\\n\\n' +
      '[MATERIALS]\\nUpper: ' + tr(cabinetSpecs.door_color_upper, colorMap) + ' ' + tr(cabinetSpecs.door_finish_upper, finishMap) + '\\n' +
      'Lower: ' + tr(cabinetSpecs.door_color_lower, colorMap) + ' ' + tr(cabinetSpecs.door_finish_lower, finishMap) + '\\n' +
      'Countertop: ' + tr(cabinetSpecs.countertop_color, colorMap) + '\\nHandle: ' + (cabinetSpecs.handle_type || 'hidden') + '\\n' +
      (materialDescriptions.length > 0 ? 'Additional: ' + materialDescriptions.join(', ') + '\\n' : '') +
      '\\nRange hood MUST be fully concealed inside upper cabinet. NO exposed duct.\\n' + ragSections +
      (prev.clientPrompt ? '\\n[CLIENT] ' + prev.clientPrompt : '') +
      (prev.negativePrompt ? '\\n[PROHIBITED] ' + prev.negativePrompt : '');
  } else {
    furniturePrompt = 'PRESERVE EXACTLY the camera angle, perspective, and viewpoint from this input image. Do NOT change the viewing angle.\\n' +
      'Place kitchen furniture on this cleaned background.\\n' +
      'Water supply at ' + waterPercent + '% → Sink. Exhaust at ' + exhaustPercent + '% → Cooktop.\\n' +
      'Upper cabinets flush with ceiling. Range hood concealed. NO exposed duct.\\n' + ragSections;
  }
}

const geminiFurnitureBody = {
  contents: [{ parts: [
    { text: furniturePrompt },
    { inline_data: { mime_type: 'image/png', data: cleanedBackground } }
  ] }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 }
};

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody),
  s3OpenPrompt: prev.s3OpenPrompt,
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

async function main() {
  console.log('Fetching workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  // Update Parse S3 + Build Bodies
  const parseS3 = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('Parse S3 BEFORE:', parseS3.parameters.jsCode.length, 'chars');
  console.log('  temperature 0.4:', parseS3.parameters.jsCode.includes('temperature: 0.4'));
  parseS3.parameters.jsCode = PARSE_S3_CODE;
  console.log('Parse S3 AFTER:', parseS3.parameters.jsCode.length, 'chars');
  console.log('  temperature 0.2:', parseS3.parameters.jsCode.includes('temperature: 0.2'));
  console.log('  cleanupPrompt passed:', parseS3.parameters.jsCode.includes('cleanupPrompt,'));

  // Update Parse BG Result
  const parseBG = wf.nodes.find(n => n.name === 'Parse BG Result');
  console.log('\nParse BG BEFORE:', parseBG.parameters.jsCode.length, 'chars');
  console.log('  has retry:', parseBG.parameters.jsCode.includes('retry'));
  parseBG.parameters.jsCode = PARSE_BG_CODE;
  console.log('Parse BG AFTER:', parseBG.parameters.jsCode.length, 'chars');
  console.log('  has retry:', parseBG.parameters.jsCode.includes('retry'));
  console.log('  PRESERVE EXACTLY:', parseBG.parameters.jsCode.includes('PRESERVE EXACTLY'));
  console.log('  $vars.GEMINI_API_KEY:', parseBG.parameters.jsCode.includes('$vars.GEMINI_API_KEY'));

  // Deploy
  console.log('\nDeploying...');
  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    console.log('DEPLOY FAILED:', updateRes.status, err.substring(0, 500));
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('Deployed! active=' + updated.active);
  console.log('\nSUCCESS: Retry logic + camera preservation deployed!');
}

main().catch(err => { console.error(err); process.exit(1); });
