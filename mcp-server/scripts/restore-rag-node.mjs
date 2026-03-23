#!/usr/bin/env node
/**
 * Restore Supabase RAG Search node to v9 workflow.
 * - Adds RAG node from backup
 * - Reconnects: Parse Input → RAG Search → Build S1 Request
 * - Restores triggers/materialCodes/colorKeywords in Parse Input
 * - Restores RAG classification in Build S1 Request
 * - Feeds RAG data into Build Fixed Prompts
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const backupPath = resolve(__dirname, '../../n8n/archive/v8-grok-pre-simplify.json');

// Load both
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));
const backup = JSON.parse(readFileSync(backupPath, 'utf-8'));

console.log('=== Restore RAG Node to v9 ===');
console.log(`Current nodes: ${wf.nodes.length}`);

// 1. Get RAG node from backup
const ragNode = backup.nodes.find(n => n.name === 'Supabase RAG Search');
if (!ragNode) { console.error('ERROR: RAG node not found in backup'); process.exit(1); }

// Position between Parse Input and Build S1 Request
const parseInput = wf.nodes.find(n => n.name === 'Parse Input');
const buildS1 = wf.nodes.find(n => n.name === 'Build S1 Request');
// Put RAG between them
ragNode.position = [
  parseInput.position[0] + 200,
  parseInput.position[1]
];
// Shift Build S1 and everything after right by 200
const ragX = ragNode.position[0];
for (const node of wf.nodes) {
  if (node.position[0] >= ragX && node.name !== 'Parse Input') {
    node.position[0] += 200;
  }
}

// 2. Add RAG node
wf.nodes.push(ragNode);
console.log(`Added: Supabase RAG Search`);

// 3. Update Parse Input to restore triggers/materialCodes/colorKeywords
const parseInputNode = wf.nodes.find(n => n.name === 'Parse Input');
parseInputNode.parameters.jsCode = `const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

// RAG triggers from input
const triggers = body.triggers || [];
const materialCodes = body.material_codes || [];
const colorKeywords = body.color_keywords || [];

return {
  category, style, roomImage, imageType,
  triggers, materialCodes, colorKeywords,
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
console.log('Updated: Parse Input (restored triggers/materialCodes/colorKeywords)');

// 4. Update Build S1 Request to restore RAG classification
const buildS1Node = wf.nodes.find(n => n.name === 'Build S1 Request');
buildS1Node.parameters.jsCode = `// Build S1 Request - RAG classification + Claude Vision S1 body
const input = $('Parse Input').first().json;
const ragResults = $input.all().map(i => i.json);
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

// RAG classification
const ragBg = [], ragModules = [], ragDoors = [], ragMaterials = [];
if (Array.isArray(ragResults)) {
  ragResults.forEach(rule => {
    const rt = rule.rule_type || rule.chunk_type || '';
    const trigger = (rule.triggers && rule.triggers[0]) || rule.trigger || '';
    if (rt === 'background') ragBg.push('- ' + rule.content);
    else if (rt === 'module') ragModules.push('- ' + trigger + ': ' + rule.content);
    else if (rt === 'door') ragDoors.push('- ' + trigger + ': ' + rule.content);
    else if (rt === 'material') ragMaterials.push(rule);
  });
}

const ragDims = {};
const allRagText = ragResults.map(r => r.content || '').join(' ');
const dimExtractors = {
  UPPER_H: /\\uC0C1\\uBD80\\uC7A5[^0-9]*(\\d{3,4})/, LOWER_H: /\\uD558\\uBD80\\uC7A5[^0-9]*(\\d{3,4})/,
  MOLDING: /\\uBAB0\\uB529[^0-9]*(\\d{2,3})/, TOE_KICK: /\\uAC78\\uB808\\uBC1B\\uC774[^0-9]*(\\d{2,3})/,
  SINK_W: /\\uC2F1\\uD06C[^0-9]*(\\d{3,4})/, COOKTOP_W: /\\uCFE1\\uD0D1[^0-9]*(\\d{3,4})/,
  COUNTERTOP: /\\uC0C1\\uD310[^0-9]*(\\d{2,3})/
};
Object.keys(dimExtractors).forEach(function(key) {
  var m = allRagText.match(dimExtractors[key]);
  if (m) ragDims[key] = parseInt(m[1], 10);
});

const S1_PROMPT = 'You are analyzing a Korean kitchen construction site photo for built-in furniture installation.\\n\\nThe photo contains colored sticker markers placed by the user:\\n- BLUE circle (color #2196f3) = water supply pipe location\\n- ORANGE circle (color #ff9800) = exhaust duct location\\n\\nTASKS:\\n1. STICKER DETECTION: Find both stickers and report their center positions on a 0-1000 grid\\n   (x: 0=left edge, 1000=right edge; y: 0=top, 1000=bottom)\\n2. WALL MEASUREMENT: Estimate wall dimensions in mm using visual cues:\\n   - Count horizontal tiles x standard tile width (300mm or 600mm)\\n   - Estimate height from ceiling to floor\\n   - Standard Korean ceiling heights: 2400, 2600, 2700mm\\n3. WALL STRUCTURE: Identify finish zones:\\n   - Where tiles end and paint begins (y-coordinate as 0.0-1.0 ratio)\\n   - Tile type/color description\\n   - Paint color description\\n4. OBSTACLES: Detect electrical outlets, gas pipes, windows, doors with positions\\n5. DEBRIS: List visible construction debris items\\n\\nReturn ONLY valid JSON:\\n{"stickers": {"water_supply": {"detected":true,"x":420,"y":875,"confidence":"high"},"exhaust_duct": {"detected":true,"x":710,"y":82,"confidence":"high"}},"wall": {"width_mm": 2700,"height_mm": 2400,"tile_size_mm": {"w":300,"h":600},"tile_count_h": 9,"structure": [{"zone":"tile","y_start":0.38,"y_end":1.0,"desc":"beige ceramic 300x600mm"},{"zone":"paint","y_start":0.0,"y_end":0.38,"desc":"white matte paint"}]},"obstacles": [{"type":"outlet","x":850,"y":650,"size_mm":{"w":80,"h":80}}],"debris": ["cement bags","power drill","exposed wiring"]}';

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
  ragResults: Array.isArray(ragResults) ? ragResults : [],
  ragBg, ragModules, ragDoors, ragMaterials, ragDims,
  claudeS1Body
};`;
console.log('Updated: Build S1 Request (restored RAG classification)');

// 5. Update Parse S1 + Positions to pass RAG data through
const parseS1 = wf.nodes.find(n => n.name === 'Parse S1 + Positions');
const parseS1Code = parseS1.parameters.jsCode;
// Check if ragResults is already passed
if (!parseS1Code.includes('ragResults')) {
  // Add RAG passthrough to the return statement
  const returnMatch = parseS1Code.match(/return \[?\{[^]*\}\]?;?\s*$/);
  if (returnMatch) {
    const returnStr = returnMatch[0];
    const insertBefore = returnStr.includes('}]') ? '}]' : '};';
    const ragFields = `,
  ragResults: prev.ragResults || [],
  ragBg: prev.ragBg || [],
  ragModules: prev.ragModules || [],
  ragDoors: prev.ragDoors || [],
  ragMaterials: prev.ragMaterials || [],
  ragDims: prev.ragDims || {}`;
    parseS1.parameters.jsCode = parseS1Code.replace(
      insertBefore,
      ragFields + '\n' + insertBefore
    );
    console.log('Updated: Parse S1 + Positions (added RAG passthrough)');
  }
} else {
  console.log('Skip: Parse S1 + Positions (already has RAG)');
}

// 6. Update Build Fixed Prompts to use RAG data
const buildFP = wf.nodes.find(n => n.name === 'Build Fixed Prompts');
const fpCode = buildFP.parameters.jsCode;

// Add RAG data extraction after the initial input parsing
const ragInsert = `
// RAG data from Supabase search
const ragResults = input.ragResults || [];
const ragBg = input.ragBg || [];
const ragModules = input.ragModules || [];
const ragDoors = input.ragDoors || [];
const ragMaterials = input.ragMaterials || [];
const ragDims = input.ragDims || {};

// Build RAG context string for prompts
let ragContext = '';
if (ragBg.length > 0) ragContext += '\\n[RAG - Background Rules]\\n' + ragBg.join('\\n') + '\\n';
if (ragModules.length > 0) ragContext += '\\n[RAG - Module Rules]\\n' + ragModules.join('\\n') + '\\n';
if (ragDoors.length > 0) ragContext += '\\n[RAG - Door Rules]\\n' + ragDoors.join('\\n') + '\\n';

// Apply RAG dimensions if available
const upperH = ragDims.UPPER_H || 720;
const lowerH = ragDims.LOWER_H || 870;
const molding = ragDims.MOLDING || 60;
const toeKick = ragDims.TOE_KICK || 150;
`;

// Insert after cabinetSpecs line
const insertAfter = "const cabinetSpecs = input.cabinetSpecs || {};";
buildFP.parameters.jsCode = fpCode.replace(
  insertAfter,
  insertAfter + ragInsert
);

// Now inject ragContext into the furniture prompt (before STRICTLY FORBIDDEN)
buildFP.parameters.jsCode = buildFP.parameters.jsCode.replace(
  "SEP + '\\n[STRICTLY FORBIDDEN]\\n' + SEP + '\\n' +",
  `(ragContext ? SEP + '\\n[RAG DESIGN RULES - \\uBC18\\uB4DC\\uC2DC \\uC900\\uC218]\\n' + SEP + '\\n' + ragContext + '\\n' : '') +\n  SEP + '\\n[STRICTLY FORBIDDEN]\\n' + SEP + '\\n' +`
);

// Update dimension references to use RAG values
buildFP.parameters.jsCode = buildFP.parameters.jsCode.replace(
  "'Upper cabinet height 720mm",
  "'Upper cabinet height ' + upperH + 'mm"
);
// Also for lower height etc. if hardcoded
buildFP.parameters.jsCode = buildFP.parameters.jsCode.replace(
  "'Lower cabinet height 870mm",
  "'Lower cabinet height ' + lowerH + 'mm"
);

// Add RAG data to the return statement
buildFP.parameters.jsCode = buildFP.parameters.jsCode.replace(
  "materialDescriptions: input.materialDescriptions\n};",
  "materialDescriptions: input.materialDescriptions,\n  ragResults: ragResults,\n  ragContext: ragContext\n};"
);

console.log('Updated: Build Fixed Prompts (added RAG context injection)');

// 7. Rewire connections: Parse Input → RAG → Build S1 Request
wf.connections['Parse Input'] = {
  main: [[{ node: 'Supabase RAG Search', type: 'main', index: 0 }]]
};
wf.connections['Supabase RAG Search'] = {
  main: [[{ node: 'Build S1 Request', type: 'main', index: 0 }]]
};
console.log('Rewired: Parse Input → Supabase RAG Search → Build S1 Request');

// 8. Save
writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf-8');

console.log(`\nFinal nodes: ${wf.nodes.length}`);
console.log('Saved to:', wfPath);

// Verify
const verify = JSON.parse(readFileSync(wfPath, 'utf-8'));
const ragExists = verify.nodes.some(n => n.name === 'Supabase RAG Search');
const connOk = verify.connections['Parse Input']?.main[0][0].node === 'Supabase RAG Search'
  && verify.connections['Supabase RAG Search']?.main[0][0].node === 'Build S1 Request';
console.log(`\nVerification:`);
console.log(`  RAG node exists: ${ragExists}`);
console.log(`  Connection chain correct: ${connOk}`);
console.log(`  Pipeline: Parse Input → Supabase RAG Search → Build S1 Request → ...`);
console.log('\n=== Done ===');
