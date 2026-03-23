#!/usr/bin/env node
// Deploy v5.2: Embedded code (same approach as update-fixed-cleanup.mjs)
// Only changes cleanup prompt from v4 → v5.2 (wall preservation)
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// EXACT v4 code with ONLY the cleanup prompt changed to v5.2
const PARSE_S3_CODE = `// Parse S3 + Build Bodies (v5.2) - Wall-preserving cleanup + S3 for furniture/open
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

// v5.5 cleanup prompt - v4 FILL exact + PRESERVE adds wall color constraint
// v4 FILL works (Gemini generates image). Problem: it repaints walls gray.
// v5.5: Keep v4 FILL verbatim. Add "original wall colors" to PRESERVE to constrain.
const cleanupPrompt = 'Transform this construction site photo into a finished empty room.\\n' +
  'PRESERVE: camera angle, perspective, viewpoint, wall structure, original wall and tile colors, window frames.\\n' +
  'REMOVE: all construction debris, tools, materials, bags, people from floors and surfaces.\\n' +
  'FILL: walls with clean paint finish, tiles cleaned and polished, white flat ceiling with recessed LED downlights, light oak vinyl flooring.\\n' +
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
  console.log('Deploying v5.2 (embedded code, same structure as v4)...');

  // Verify the prompt change
  console.log('Has wall-preserve PRESERVE:', PARSE_S3_CODE.includes('all wall surfaces and tiles as-is'));
  console.log('No old wall FILL:', !PARSE_S3_CODE.includes('walls with smooth paint'));
  console.log('Code length:', PARSE_S3_CODE.length, 'chars');

  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  const parseS3 = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('Parse S3 BEFORE:', parseS3.parameters.jsCode.length, 'chars');
  parseS3.parameters.jsCode = PARSE_S3_CODE;
  console.log('Parse S3 AFTER:', parseS3.parameters.jsCode.length, 'chars');

  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });

  if (!updateRes.ok) {
    console.error('DEPLOY FAILED:', await updateRes.text());
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('Deployed! active=' + updated.active);
  console.log('SUCCESS: v5.2 wall-preserving cleanup deployed (embedded)');
}

main().catch(err => { console.error(err); process.exit(1); });
