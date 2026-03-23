#!/usr/bin/env node
// Update "Build S3 Request" node with template-based prompt approach
// Prevents Gemini IMAGE_OTHER rejections by constraining Claude S3 output
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// New jsCode for "Build S3 Request" node
const NEW_JS_CODE = `// Build S3 Request - Template-based prompt generation (v2)
// Uses default templates from prompt guide to constrain Claude S3 output
// Prevents Gemini IMAGE_OTHER by limiting length and using KEEP patterns
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

// Default prompt templates (from dadam-image-prompt-guide.md)
const TMPL_CLEANUP = [
  '[BACKGROUND CLEANUP - STRUCTURE PRESERVATION]',
  'Clean the construction site photo into a finished empty room.',
  'KEEP: wall structure, camera angle, perspective, lighting direction, electrical outlets, water supply pipes, gas valves, window frames.',
  'REMOVE: construction debris, tools, temporary items, protective films, people, loose materials.',
  'FINISH: Smooth painted walls in paint zones. Clean tile surfaces in tile zones. Finished ceiling with recessed LED downlights. Clean vinyl flooring in light oak tone.',
  'Output: Photorealistic empty finished Korean apartment room ready for furniture installation.'
].join('\\n');

const TMPL_FURNITURE = [
  'Photorealistic interior photograph, shot on Canon EOS R5 at 35mm, natural depth of field with cabinet in sharp focus,',
  '3/4 angle view from left-front, camera height 1600mm, 30-degree horizontal rotation,',
  '{LAYOUT_DESC}',
  '{DOOR_MATERIALS}',
  '{COUNTERTOP_DESC} engineered stone countertop with bullnose edge, 20mm overhang,',
  '{HANDLE_DESC},',
  'fully finished installation, 18mm melamine-faced PB body, clean edge banding, 2.7mm MDF back panel,',
  'soft natural daylight 5500K from window, gentle shadows, white ceiling bounce light,',
  'modern Korean apartment (3.3m x 2.4m), 2400mm ceiling, vinyl flooring in light oak tone.',
  'Avoid: warped doors, visible screws, uneven gaps, HDR, fish-eye distortion, people, cluttered countertops.'
].join('\\n');

const TMPL_OPEN = [
  'Same cabinet as previous image but with select doors and drawers partially open.',
  'Open doors at 110 degrees showing Blum concealed cup hinges with soft-close.',
  'Pull drawers 3/4 extension on Hettich soft-close undermount slides.',
  'Interior: 18mm melamine PB shelves, white powder-coat drawer sides, clean organized storage.',
  'Keep range hood / hidden hood cabinet CLOSED.',
  'Same camera angle, lighting, and room context as furniture image.'
].join('\\n');

const S3_PROMPT = 'You are a Korean built-in kitchen furniture design expert.\\n'
  + 'Customize the DEFAULT TEMPLATES below using the analysis data. Do NOT rewrite prompts from scratch.\\n\\n'
  + '=== ANALYSIS DATA ===\\n' + JSON.stringify(s1) + '\\n\\n'
  + 'Wall: ' + wallW + 'mm x ' + wallH + 'mm\\n' + moduleLayout + '\\n'
  + 'Water supply at ' + waterPercent + '% from left\\n'
  + 'Exhaust duct at ' + exhaustPercent + '% from left\\n\\n'
  + '=== RAG RULES ===\\n' + ragBg.join('\\n') + '\\n' + ragModules.join('\\n') + '\\n' + ragDoors.join('\\n') + '\\n\\n'
  + '=== USER SPECS ===\\n'
  + 'Style: ' + style + '\\n'
  + 'Upper: ' + upperColor + ' ' + upperFinish + ' | Lower: ' + lowerColor + ' ' + lowerFinish + '\\n'
  + 'Countertop: ' + countertopColor + ' | Handle: ' + handleType + '\\n'
  + (clientPrompt ? 'Custom: ' + clientPrompt + '\\n' : '')
  + (negativePrompt ? 'Avoid: ' + negativePrompt + '\\n' : '')
  + '\\n=== DEFAULT TEMPLATES (customize, do NOT rewrite) ===\\n'
  + 'CLEANUP TEMPLATE:\\n' + TMPL_CLEANUP + '\\n\\n'
  + 'FURNITURE TEMPLATE:\\n' + TMPL_FURNITURE + '\\n\\n'
  + 'OPEN TEMPLATE:\\n' + TMPL_OPEN + '\\n\\n'
  + '=== RULES (MANDATORY) ===\\n'
  + '1. cleanup_prompt: Start from CLEANUP TEMPLATE. Add specific debris items and wall zone details from analysis. NEVER instruct to remove outlets, pipes, wiring boxes, or infrastructure. Use KEEP pattern. MAX 1000 chars.\\n'
  + '2. furniture_prompt: Start from FURNITURE TEMPLATE. Replace {LAYOUT_DESC} with module positions (percentages). Replace {DOOR_MATERIALS} with colors/finishes. Replace {COUNTERTOP_DESC} with countertop. Replace {HANDLE_DESC} with handle type. MAX 1500 chars.\\n'
  + '3. open_prompt: Start from OPEN TEMPLATE. Add which modules to open by position. MAX 800 chars.\\n'
  + '4. CRITICAL: Never use aggressive removal language for infrastructure. Use KEEP not REMOVE for utilities.\\n'
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

async function main() {
  // 1. Fetch current workflow
  console.log('Fetching workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  // 2. Find "Build S3 Request" node
  const node = wf.nodes.find(n => n.name === 'Build S3 Request');
  if (!node) {
    console.log('ERROR: "Build S3 Request" node not found');
    process.exit(1);
  }

  console.log('\n=== BEFORE (first 500 chars) ===');
  console.log(node.parameters.jsCode.substring(0, 500));
  console.log('...');
  console.log('Total length:', node.parameters.jsCode.length, 'chars');

  // 3. Update jsCode
  node.parameters.jsCode = NEW_JS_CODE;

  console.log('\n=== AFTER (first 500 chars) ===');
  console.log(node.parameters.jsCode.substring(0, 500));
  console.log('...');
  console.log('Total length:', node.parameters.jsCode.length, 'chars');

  // 4. Deploy to n8n
  console.log('\nDeploying to n8n Cloud...');
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

  // 5. Verify
  const verifyNode = updated.nodes.find(n => n.name === 'Build S3 Request');
  const hasTemplates = verifyNode.parameters.jsCode.includes('TMPL_CLEANUP')
    && verifyNode.parameters.jsCode.includes('TMPL_FURNITURE')
    && verifyNode.parameters.jsCode.includes('TMPL_OPEN');
  const hasKeepPattern = verifyNode.parameters.jsCode.includes('KEEP pattern');
  const hasMaxChars = verifyNode.parameters.jsCode.includes('MAX 1000 chars');

  console.log('\n=== VERIFICATION ===');
  console.log('Has TMPL_CLEANUP/FURNITURE/OPEN:', hasTemplates);
  console.log('Has KEEP pattern rule:', hasKeepPattern);
  console.log('Has MAX char limits:', hasMaxChars);
  console.log('jsCode length:', verifyNode.parameters.jsCode.length, 'chars');

  if (hasTemplates && hasKeepPattern && hasMaxChars) {
    console.log('\nSUCCESS: Template-based S3 prompt deployed!');
  } else {
    console.log('\nWARNING: Verification incomplete');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
