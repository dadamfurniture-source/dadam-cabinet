#!/usr/bin/env node
// Update "Build S3 Request" + "Parse S3 + Build Bodies" nodes (v3)
// Key fixes: preserve original camera angle, simplify cleanup prompt
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// ===== NEW Build S3 Request jsCode =====
const BUILD_S3_CODE = `// Build S3 Request - Template-based prompt generation (v3)
// Key changes: preserve original camera angle, simplified cleanup, no coordinates in prompts
const input = $input.first().json;
const s1 = input.s1Analysis || {};
const analysis = input.analysisResult;
const modules = input.modules;
const layoutData = input.layoutData;
const wb = input.coordinateFrame ? input.coordinateFrame.wall_boundaries : { width_mm: 3000, height_mm: 2400 };
const wallW = wb.width_mm || 3000;
const wallH = wb.height_mm || 2400;
const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;

const ragBg = input.ragBg || [];
const ragModules = input.ragModules || [];
const ragDoors = input.ragDoors || [];

const style = input.style || 'modern';
const cs = input.cabinetSpecs || {};
const upperColor = cs.door_color_upper || '화이트';
const upperFinish = cs.door_finish_upper || '무광';
const lowerColor = cs.door_color_lower || '화이트';
const lowerFinish = cs.door_finish_lower || '무광';
const countertopColor = cs.countertop_color || '스노우';
const handleType = cs.handle_type || 'hidden (push-to-open)';
const clientPrompt = input.clientPrompt || '';
const negativePrompt = input.negativePrompt || '';

let moduleLayout = 'No module data available';
if (modules) {
  let parts = [];
  if (modules.lower && modules.lower.length > 0) {
    parts.push('Lower modules (left to right): ' + JSON.stringify(modules.lower));
  }
  if (modules.upper && modules.upper.length > 0) {
    parts.push('Upper modules (left to right): ' + JSON.stringify(modules.upper));
  }
  moduleLayout = parts.join('\\n');
}

// Default templates (v3) - camera angle always preserved from original image
const TMPL_CLEANUP = [
  '[BACKGROUND CLEANUP]',
  'Transform this construction site photo into a finished empty room.',
  'PRESERVE EXACTLY: camera angle, perspective, viewpoint, wall structure, window frames.',
  'REMOVE: all construction debris, tools, temporary items, protective films, people, loose materials.',
  'FILL: walls with smooth painted finish. tiles with clean surface. ceiling with white flat ceiling and recessed LED downlights. floor with light oak vinyl flooring.',
  'Result: Photorealistic finished empty Korean apartment room ready for furniture.'
].join('\\n');

const TMPL_FURNITURE = [
  'PRESERVE EXACTLY the camera angle, perspective, and viewpoint from this input image. Do NOT change the viewing angle.',
  'Place photorealistic built-in kitchen cabinets on this cleaned background:',
  '{LAYOUT_DESC}',
  '{DOOR_MATERIALS}',
  '{COUNTERTOP_DESC} engineered stone countertop with bullnose edge, 20mm overhang,',
  '{HANDLE_DESC},',
  '18mm melamine-faced PB body, clean edge banding, 2.7mm MDF back panel,',
  'Upper cabinet height 720mm, depth 295mm, with 60mm crown molding flush to ceiling.',
  'Lower cabinet height 870mm (including 150mm kickboard), depth 600mm.',
  'Match the existing lighting from the input image. No artificial lighting changes.',
  'Avoid: warped doors, visible screws, uneven gaps, HDR, fish-eye, people, cluttered countertops.'
].join('\\n');

const TMPL_OPEN = [
  'Same cabinet from the previous image.',
  'PRESERVE EXACTLY: camera angle, perspective, room context, lighting from input image.',
  'Open select doors and drawers:',
  '- Doors open at 110 degrees showing Blum concealed cup hinges with soft-close.',
  '- Drawers pulled 3/4 extension on Hettich soft-close undermount slides.',
  'Interior: 18mm melamine PB shelves, white powder-coat drawer sides, clean organized storage.',
  'Keep range hood / hidden hood cabinet CLOSED.',
].join('\\n');

const S3_PROMPT = 'You are a Korean built-in kitchen furniture design expert.\\n'
  + 'Customize the DEFAULT TEMPLATES below. Do NOT rewrite from scratch. Do NOT add coordinate numbers.\\n\\n'
  + '=== WALL INFO ===\\nWall: ' + wallW + 'mm x ' + wallH + 'mm\\n'
  + (s1.wall && s1.wall.structure ? 'Structure: ' + s1.wall.structure.map(function(z){return z.zone + '(' + z.desc + ')'}).join(', ') + '\\n' : '')
  + 'Debris: ' + (s1.debris ? s1.debris.join(', ') : 'construction debris') + '\\n\\n'
  + '=== MODULE LAYOUT ===\\n' + moduleLayout + '\\n'
  + 'Water supply at ' + waterPercent + '% from left → Sink module\\n'
  + 'Exhaust duct at ' + exhaustPercent + '% from left → Cooktop module\\n\\n'
  + '=== RAG RULES ===\\n' + ragBg.join('\\n') + '\\n' + ragModules.join('\\n') + '\\n' + ragDoors.join('\\n') + '\\n\\n'
  + '=== USER SPECS ===\\n'
  + 'Style: ' + style + '\\n'
  + 'Upper: ' + upperColor + ' ' + upperFinish + ' | Lower: ' + lowerColor + ' ' + lowerFinish + '\\n'
  + 'Countertop: ' + countertopColor + ' | Handle: ' + handleType + '\\n'
  + (clientPrompt ? 'Custom: ' + clientPrompt + '\\n' : '')
  + (negativePrompt ? 'Avoid: ' + negativePrompt + '\\n' : '')
  + '\\n=== DEFAULT TEMPLATES (customize, do NOT rewrite) ===\\n'
  + 'CLEANUP:\\n' + TMPL_CLEANUP + '\\n\\n'
  + 'FURNITURE:\\n' + TMPL_FURNITURE + '\\n\\n'
  + 'OPEN:\\n' + TMPL_OPEN + '\\n\\n'
  + '=== RULES (MANDATORY) ===\\n'
  + '1. cleanup_prompt: Start from CLEANUP template. Add specific debris items. Add wall surface descriptions (e.g. "white paint on upper wall, burgundy tiles on middle"). Do NOT include coordinate numbers, pixel positions, or infrastructure details. MAX 800 chars.\\n'
  + '2. furniture_prompt: Start from FURNITURE template. Replace {LAYOUT_DESC} with module widths and positions as percentages. Replace {DOOR_MATERIALS} with actual colors/finishes. Replace {COUNTERTOP_DESC} and {HANDLE_DESC}. CRITICAL: Keep "PRESERVE EXACTLY the camera angle" as the FIRST line. MAX 1400 chars.\\n'
  + '3. open_prompt: Start from OPEN template. Specify which modules to open by position. Keep "PRESERVE EXACTLY" line. MAX 700 chars.\\n'
  + '4. NEVER mention electrical outlets, wiring, pipes, or infrastructure in cleanup_prompt.\\n'
  + '5. English only. Return ONLY valid JSON:\\n{\\"cleanup_prompt\\":\\"...\\",\\"furniture_prompt\\":\\"...\\",\\"open_prompt\\":\\"...\\"}';

const claudeS3Body = JSON.stringify({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  temperature: 0.3,
  messages: [{ role: 'user', content: S3_PROMPT }]
});

return {
  claudeS3Body,
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: input.coordinateFrame,
  s1Analysis: input.s1Analysis,
  analysisMethod: input.analysisMethod,
  modules, layoutData,
  hasBlueprint: input.hasBlueprint,
  hasMask: input.hasMask,
  hasModules: input.hasModules,
  clientPrompt, negativePrompt,
  cabinetSpecs: cs,
  layoutImage: input.layoutImage,
  maskImage: input.maskImage,
  referenceImages: input.referenceImages,
  materialDescriptions: input.materialDescriptions,
  ragResults: input.ragResults || [],
  ragBg, ragModules, ragDoors,
  ragMaterials: input.ragMaterials, ragDims: input.ragDims
};`;

// ===== NEW Parse S3 + Build Bodies jsCode =====
const PARSE_S3_CODE = `// Parse S3 + Build Bodies (v3) - safe fallback + length validation + camera preservation
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

const debrisList = analysis.construction_debris && analysis.construction_debris.length > 0 ? analysis.construction_debris.join(', ') : 'construction debris, tools, temporary items';
const ragBg = prev.ragBg || [];

let cleanupPrompt, s3FurniturePrompt, s3OpenPrompt;

if (s3Prompts && s3Prompts.cleanup_prompt && s3Prompts.furniture_prompt && s3Prompts.open_prompt) {
  cleanupPrompt = s3Prompts.cleanup_prompt;
  s3FurniturePrompt = s3Prompts.furniture_prompt;
  s3OpenPrompt = s3Prompts.open_prompt;
  // Enforce max length
  if (cleanupPrompt.length > 900) cleanupPrompt = cleanupPrompt.substring(0, 800);
  if (s3FurniturePrompt.length > 1500) s3FurniturePrompt = s3FurniturePrompt.substring(0, 1400);
} else {
  // Safe fallback - simple, no coordinates, no infrastructure mentions
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

  // Update Build S3 Request
  const buildNode = wf.nodes.find(n => n.name === 'Build S3 Request');
  if (!buildNode) { console.log('ERROR: Build S3 Request not found'); process.exit(1); }
  console.log('Build S3 Request BEFORE:', buildNode.parameters.jsCode.length, 'chars');
  buildNode.parameters.jsCode = BUILD_S3_CODE;
  console.log('Build S3 Request AFTER:', buildNode.parameters.jsCode.length, 'chars');

  // Update Parse S3 + Build Bodies
  const parseNode = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  if (!parseNode) { console.log('ERROR: Parse S3 not found'); process.exit(1); }
  console.log('Parse S3 BEFORE:', parseNode.parameters.jsCode.length, 'chars');
  parseNode.parameters.jsCode = PARSE_S3_CODE;
  console.log('Parse S3 AFTER:', parseNode.parameters.jsCode.length, 'chars');

  // Deploy
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

  // Verify
  const vBuild = updated.nodes.find(n => n.name === 'Build S3 Request');
  const vParse = updated.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('\n=== VERIFICATION ===');
  console.log('Build S3:');
  console.log('  PRESERVE EXACTLY:', vBuild.parameters.jsCode.includes('PRESERVE EXACTLY'));
  console.log('  No hardcoded 3/4 angle:', !vBuild.parameters.jsCode.includes('3/4 angle view from left-front'));
  console.log('  No coordinate numbers rule:', vBuild.parameters.jsCode.includes('Do NOT include coordinate numbers'));
  console.log('  Never mention infrastructure:', vBuild.parameters.jsCode.includes('NEVER mention electrical outlets'));
  console.log('  MAX 800 cleanup:', vBuild.parameters.jsCode.includes('MAX 800 chars'));
  console.log('Parse S3:');
  console.log('  PRESERVE EXACTLY:', vParse.parameters.jsCode.includes('PRESERVE EXACTLY'));
  console.log('  Length validation 900:', vParse.parameters.jsCode.includes('cleanupPrompt.length > 900'));
  console.log('  No REMOVAL TARGETS:', !vParse.parameters.jsCode.includes('REMOVAL TARGETS'));
  console.log('\nSUCCESS: v3 deployed - camera preservation + simplified cleanup!');
}

main().catch(err => { console.error(err); process.exit(1); });
