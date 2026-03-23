#!/usr/bin/env node
// Update "Parse S3 + Build Bodies" node: safe fallback prompt + length validation
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

const NEW_JS_CODE = `// Parse S3 + Build Bodies - Parse Claude S3 response, build Gemini cleanup body (v2)
// Added: prompt length validation + safe fallback using KEEP pattern
const prev = $('Build S3 Request').first().json;
const s3Response = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;

// Parse S3 response
let s3Prompts = null;
try {
  const content = s3Response.content || [];
  const textBlock = content.find(b => b.type === 'text');
  if (textBlock && textBlock.text) {
    const jsonMatch = textBlock.text.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) s3Prompts = JSON.parse(jsonMatch[0]);
  }
} catch(e) { s3Prompts = null; }

// Fallback data
const debrisList = analysis.construction_debris && analysis.construction_debris.length > 0 ? analysis.construction_debris.join(', ') : 'construction debris, tools, temporary items, cement bags';
const ragBg = prev.ragBg || [];

let cleanupPrompt, s3FurniturePrompt, s3OpenPrompt;

if (s3Prompts && s3Prompts.cleanup_prompt && s3Prompts.furniture_prompt && s3Prompts.open_prompt) {
  cleanupPrompt = s3Prompts.cleanup_prompt;
  s3FurniturePrompt = s3Prompts.furniture_prompt;
  s3OpenPrompt = s3Prompts.open_prompt;
  // Enforce max length to prevent Gemini IMAGE_OTHER rejection
  if (cleanupPrompt.length > 1100) {
    cleanupPrompt = cleanupPrompt.substring(0, 1000);
  }
  if (s3FurniturePrompt.length > 1600) {
    s3FurniturePrompt = s3FurniturePrompt.substring(0, 1500);
  }
} else {
  // Safe fallback using KEEP pattern (not aggressive REMOVAL language)
  cleanupPrompt = '[BACKGROUND CLEANUP - STRUCTURE PRESERVATION]\\n' +
    'Clean the construction site photo into a finished empty room.\\n' +
    'KEEP: wall structure, camera angle, perspective, lighting, electrical outlets, water supply pipes, gas valves, window frames.\\n' +
    'REMOVE: ' + debrisList + ', people, loose materials.\\n' +
    'FINISH: Smooth painted walls in paint zones. Clean tile surfaces in tile zones. Finished ceiling with recessed LED downlights. Clean vinyl flooring in light oak tone.\\n' +
    (ragBg.length > 0 ? ragBg.join('\\n') + '\\n' : '') +
    'KEEP: water supply pipe at ' + analysis.water_supply_percent + '% from left.\\n' +
    'Output: Photorealistic empty finished Korean apartment room ready for furniture.';
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
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 }
};

return {
  geminiCleanupBody: JSON.stringify(geminiCleanupBody),
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

async function main() {
  console.log('Fetching workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  const node = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  if (!node) {
    console.log('ERROR: "Parse S3 + Build Bodies" node not found');
    process.exit(1);
  }

  console.log('BEFORE length:', node.parameters.jsCode.length, 'chars');
  console.log('Has REMOVAL TARGETS:', node.parameters.jsCode.includes('REMOVAL TARGETS'));
  console.log('Has PRIORITY #1:', node.parameters.jsCode.includes('PRIORITY #1'));

  node.parameters.jsCode = NEW_JS_CODE;

  console.log('\nAFTER length:', node.parameters.jsCode.length, 'chars');
  console.log('Has KEEP pattern:', node.parameters.jsCode.includes('KEEP: wall structure'));
  console.log('Has length validation:', node.parameters.jsCode.includes('cleanupPrompt.length > 1100'));

  console.log('\nDeploying...');
  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    console.log('DEPLOY FAILED:', updateRes.status, err.substring(0, 500));
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('Deployed! active=' + updated.active);

  const verifyNode = updated.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('\n=== VERIFICATION ===');
  console.log('Has KEEP pattern:', verifyNode.parameters.jsCode.includes('KEEP: wall structure'));
  console.log('Has length validation:', verifyNode.parameters.jsCode.includes('cleanupPrompt.length > 1100'));
  console.log('No REMOVAL TARGETS:', !verifyNode.parameters.jsCode.includes('REMOVAL TARGETS'));
  console.log('No PRIORITY #1:', !verifyNode.parameters.jsCode.includes('PRIORITY #1'));
  console.log('\nSUCCESS: Safe fallback + length validation deployed!');
}

main().catch(err => { console.error(err); process.exit(1); });
