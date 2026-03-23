#!/usr/bin/env node
// Fix: Use fixed simple cleanup prompt (not Claude S3 generated)
// Claude S3's detailed cleanup prompts trigger Gemini IMAGE_OTHER
// Simple 350-char prompt = 3/3 success rate
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// Parse S3 + Build Bodies: ALWAYS use fixed simple cleanup prompt
const PARSE_S3_CODE = `// Parse S3 + Build Bodies (v4) - Fixed simple cleanup + S3 for furniture/open
const prev = $('Build S3 Request').first().json;
const s3Response = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;

// Parse S3 for furniture + open prompts only
let s3Prompts = null;
try {
  const content = s3Response.content || [];
  const textBlock = content.find(b => b.type === 'text');
  if (textBlock && textBlock.text) {
    const jsonMatch = textBlock.text.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) s3Prompts = JSON.parse(jsonMatch[0]);
  }
} catch(e) { s3Prompts = null; }

// FIXED cleanup prompt - simple and reliable (tested 3/3 success)
// Do NOT use Claude S3 generated cleanup - too detailed, triggers Gemini IMAGE_OTHER
const cleanupPrompt = 'Transform this construction site photo into a finished empty room.\\n' +
  'PRESERVE: camera angle, perspective, viewpoint, wall structure, window frames.\\n' +
  'REMOVE: all construction debris, tools, materials, bags, people from floors and surfaces.\\n' +
  'FILL: walls with smooth paint finish, tiles cleaned and polished, white flat ceiling with recessed LED downlights, light oak vinyl flooring.\\n' +
  'Output: Photorealistic empty finished Korean apartment room ready for furniture installation.';

let s3FurniturePrompt = null, s3OpenPrompt = null;
if (s3Prompts && s3Prompts.furniture_prompt && s3Prompts.open_prompt) {
  s3FurniturePrompt = s3Prompts.furniture_prompt;
  s3OpenPrompt = s3Prompts.open_prompt;
  if (s3FurniturePrompt.length > 1500) s3FurniturePrompt = s3FurniturePrompt.substring(0, 1400);
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

async function main() {
  console.log('Fetching workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  const parseS3 = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('Parse S3 BEFORE:', parseS3.parameters.jsCode.length, 'chars');
  parseS3.parameters.jsCode = PARSE_S3_CODE;
  console.log('Parse S3 AFTER:', parseS3.parameters.jsCode.length, 'chars');

  // Verify the fixed prompt
  const fixedPrompt = 'Transform this construction site photo into a finished empty room.';
  console.log('Has fixed cleanup:', parseS3.parameters.jsCode.includes(fixedPrompt));
  console.log('No S3 cleanup usage:', !parseS3.parameters.jsCode.includes('s3Prompts.cleanup_prompt'));

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
  console.log('\nSUCCESS: Fixed cleanup prompt deployed (S3 still used for furniture/open)');
}

main().catch(err => { console.error(err); process.exit(1); });
