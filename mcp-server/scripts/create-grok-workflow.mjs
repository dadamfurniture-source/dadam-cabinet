#!/usr/bin/env node
/**
 * create-grok-workflow.mjs
 * Copies v8 Gemini workflow and converts image generation to Grok (xAI).
 * Claude analysis steps (S1/S3/S4) are preserved unchanged.
 *
 * Steps:
 * 1. Read v8-claude-analysis-vars.json + deep copy
 * 2. Transform 9 nodes (Webhook, Parse S3, 3 HTTP nodes, 3 Code nodes, connections)
 * 3. Save as n8n/v8-grok-analysis.json
 * 4. Create new workflow via n8n API + activate
 */
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

if (!N8N_KEY) {
  console.error('ERROR: N8N_API_KEY not found in n8n/.env');
  process.exit(1);
}

const srcPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
const outPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(JSON.stringify(JSON.parse(readFileSync(srcPath, 'utf-8'))));

function findNode(name) {
  const node = wf.nodes.find(n => n.name === name);
  if (!node) throw new Error(`Node "${name}" not found`);
  return node;
}

// Grok extract function (replaces Gemini's candidates parsing)
const EXTRACT_GROK_FN = `function extractGrokImage(resp) {
  try {
    const data = resp && resp.data;
    if (data && data.length > 0 && data[0].b64_json) {
      return data[0].b64_json;
    }
    return null;
  } catch(e) { return null; }
}`;

// Grok HTTP node template
function makeGrokHttpParams(bodyField) {
  return {
    method: 'POST',
    url: 'https://api.x.ai/v1/images/edits',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '={{ "Bearer " + $vars.XAI_API_KEY }}' },
        { name: 'Content-Type', value: 'application/json' }
      ]
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: `={{ $json.${bodyField} }}`,
    options: { timeout: 120000 }
  };
}

// Helper: find end of brace-only block after a marker
function findClosingBraces(code, startIdx, count) {
  let pos = startIdx;
  let found = 0;
  while (pos < code.length && found < count) {
    if (code[pos] === '}') found++;
    else if (!/[\s]/.test(code[pos])) break;
    pos++;
  }
  return pos;
}

console.log('=== Create Grok Workflow from v8 Claude Analysis ===\n');

// ─── 0. Workflow name ───
wf.name = 'Dadam Interior v8 (Grok Analysis)';
console.log('[0] Workflow name -> "Dadam Interior v8 (Grok Analysis)"');

// ─── 1. Webhook: path -> dadam-interior-grok ───
{
  const node = findNode('Webhook');
  node.parameters.path = 'dadam-interior-grok';
  node.webhookId = randomUUID();
  console.log('[1] Webhook path -> "dadam-interior-grok"');
}

// ─── 2. Parse S3 + Build Bodies: geminiCleanupBody -> grokCleanupBody ───
{
  const node = findNode('Parse S3 + Build Bodies');
  let code = node.parameters.jsCode;

  // Replace Gemini body construction with Grok format
  const geminiBodyRx = /const geminiCleanupBody = \{[\s\S]*?generationConfig:[\s\S]*?\};/;
  if (!geminiBodyRx.test(code)) throw new Error('[2] Could not find geminiCleanupBody block');

  code = code.replace(geminiBodyRx,
`const grokCleanupBody = {
  model: 'grok-imagine-image',
  prompt: cleanupPrompt,
  image: {
    url: 'data:' + (prev.imageType || 'image/jpeg') + ';base64,' + prev.roomImage,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};`);

  code = code.replace(
    'geminiCleanupBody: JSON.stringify(geminiCleanupBody)',
    'grokCleanupBody: JSON.stringify(grokCleanupBody)'
  );

  // Clean up historical comments that reference Gemini
  code = code.replace('v4 FILL works with Gemini, but repaints walls gray.', 'v4 FILL repaints walls gray.');
  code = code.replace('Gemini STOP + burgundy tiles preserved', 'STOP + burgundy tiles preserved');

  node.parameters.jsCode = code;
  console.log('[2] Parse S3 + Build Bodies: grokCleanupBody');
}

// ─── 3. Gemini Background Cleanup HTTP -> Grok Background Cleanup ───
{
  const node = findNode('Gemini Background Cleanup');
  node.name = 'Grok Background Cleanup';
  node.parameters = makeGrokHttpParams('grokCleanupBody');
  console.log('[3] Gemini Background Cleanup -> Grok Background Cleanup');
}

// ─── 4. Parse BG Result: extract + retry + furnitureBody ───
{
  const node = findNode('Parse BG Result');
  let code = node.parameters.jsCode;

  // 4a. Rename all function calls
  code = code.replaceAll('extractGeminiImage', 'extractGrokImage');

  // 4b. Replace function body (now named extractGrokImage)
  const fnRx = /function extractGrokImage\(resp\) \{[\s\S]*?catch\(e\) \{ return null; \}\s*\}/;
  if (!fnRx.test(code)) throw new Error('[4b] Could not find extractGrokImage function');
  code = code.replace(fnRx, EXTRACT_GROK_FN);

  // 4c. Replace retry block (Gemini -> Grok)
  const retryMarker = '// Retry on IMAGE_OTHER';
  const retryEndMarker = '/* continue to next retry */';
  const rsi = code.indexOf(retryMarker);
  const rei = code.indexOf(retryEndMarker);
  if (rsi === -1 || rei === -1) throw new Error('[4c] Could not find retry block');
  const retryBlockEnd = findClosingBraces(code, rei + retryEndMarker.length, 3);

  const grokRetry = `// Retry if cleanup failed
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
        n: 1,
        response_format: 'b64_json'
      });
      const retryRes = await fetch(grokUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: retryBody,
      });
      const retryData = await retryRes.json();
      cleanedBackground = extractGrokImage(retryData);
    } catch(e) { /* continue to next retry */ }
  }
}`;

  code = code.substring(0, rsi) + grokRetry + code.substring(retryBlockEnd);

  // 4d. Replace geminiFurnitureBody construction
  const furnitureBodyRx = /const geminiFurnitureBody = \{[\s\S]*?generationConfig:[\s\S]*?\};/;
  if (!furnitureBodyRx.test(code)) throw new Error('[4d] Could not find geminiFurnitureBody block');

  code = code.replace(furnitureBodyRx,
`const grokFurnitureBody = {
  model: 'grok-imagine-image',
  prompt: furniturePrompt,
  image: {
    url: 'data:image/png;base64,' + cleanedBackground,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};`);

  // 4e. Rename return field
  code = code.replace(
    'geminiFurnitureBody: JSON.stringify(geminiFurnitureBody)',
    'grokFurnitureBody: JSON.stringify(grokFurnitureBody)'
  );

  node.parameters.jsCode = code;
  console.log('[4] Parse BG Result: extractGrokImage + Grok retry + grokFurnitureBody');
}

// ─── 5. Gemini Furniture HTTP -> Grok Furniture ───
{
  const node = findNode('Gemini Furniture');
  node.name = 'Grok Furniture';
  node.parameters = makeGrokHttpParams('grokFurnitureBody');
  console.log('[5] Gemini Furniture -> Grok Furniture');
}

// ─── 6. Parse Furniture + Prep Open: extract + Stage2 + openBody ───
{
  const node = findNode('Parse Furniture + Prep Open');
  let code = node.parameters.jsCode;

  // 6a. Rename all function calls
  code = code.replaceAll('extractGeminiImage', 'extractGrokImage');

  // 6b. Replace function body
  const fnRx = /function extractGrokImage\(resp\) \{[\s\S]*?catch\(e\) \{ return null; \}\s*\}/;
  if (!fnRx.test(code)) throw new Error('[6b] Could not find extractGrokImage function');
  code = code.replace(fnRx, EXTRACT_GROK_FN);

  // 6c. Replace Stage 2 correction pass (Gemini -> Grok)
  const s2Marker = '// === STAGE 2: Correction Pass ===';
  const s2EndMarker = '/* Stage 2 failed, use Stage 1 image */';
  const s2si = code.indexOf(s2Marker);
  const s2ei = code.indexOf(s2EndMarker);
  if (s2si === -1 || s2ei === -1) throw new Error('[6c] Could not find Stage 2 block');
  const s2BlockEnd = findClosingBraces(code, s2ei + s2EndMarker.length, 2);

  const grokStage2 = `// === STAGE 2: Correction Pass (Grok) ===
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
    '4. FAUCET: Clear, detailed faucet — tall arched spout, single lever, chrome or matte black.\\n' +
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
        n: 1,
        response_format: 'b64_json'
      }),
    });
    const correctedImage = extractGrokImage(await correctionRes.json());
    if (correctedImage) closedImage = correctedImage;
  } catch(e) { /* Stage 2 failed, use Stage 1 image */ }
}`;

  code = code.substring(0, s2si) + grokStage2 + code.substring(s2BlockEnd);

  // 6d. Replace geminiOpenBody construction
  const openBodyRx = /const geminiOpenBody = \{[\s\S]*?generationConfig:[\s\S]*?\};/;
  if (!openBodyRx.test(code)) throw new Error('[6d] Could not find geminiOpenBody block');

  code = code.replace(openBodyRx,
`const grokOpenBody = {
  model: 'grok-imagine-image',
  prompt: openPrompt,
  image: {
    url: 'data:image/png;base64,' + closedImage,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};`);

  // 6e. Rename return field
  code = code.replace(
    'geminiOpenBody: JSON.stringify(geminiOpenBody)',
    'grokOpenBody: JSON.stringify(grokOpenBody)'
  );

  node.parameters.jsCode = code;
  console.log('[6] Parse Furniture + Prep Open: extractGrokImage + Grok Stage2 + grokOpenBody');
}

// ─── 7. Gemini Open Door HTTP -> Grok Open Door ───
{
  const node = findNode('Gemini Open Door');
  node.name = 'Grok Open Door';
  node.parameters = makeGrokHttpParams('grokOpenBody');
  console.log('[7] Gemini Open Door -> Grok Open Door');
}

// ─── 8. Build S4 Request: extractGeminiImage -> extractGrokImage ───
{
  const node = findNode('Build S4 Request');
  let code = node.parameters.jsCode;

  code = code.replaceAll('extractGeminiImage', 'extractGrokImage');
  const fnRx = /function extractGrokImage\(resp\) \{[\s\S]*?catch\(e\) \{ return null; \}\s*\}/;
  if (!fnRx.test(code)) throw new Error('[8] Could not find extractGrokImage function');
  code = code.replace(fnRx, EXTRACT_GROK_FN);

  node.parameters.jsCode = code;
  console.log('[8] Build S4 Request: extractGrokImage');
}

// ─── 8b. Format Response nodes: update processing strings ───
{
  const fqa = findNode('Format Response + QA');
  fqa.parameters.jsCode = fqa.parameters.jsCode.replace('gemini-3-stage', 'grok-3-stage');

  const fc = findNode('Format Response (Closed)');
  fc.parameters.jsCode = fc.parameters.jsCode.replace('gemini-2-stage', 'grok-2-stage');

  const fe = findNode('Format Response (Error)');
  fe.parameters.jsCode = fe.parameters.jsCode.replace(
    'Gemini could not generate cleaned image',
    'Grok could not generate cleaned image'
  );

  console.log('[8b] Format Response nodes: gemini -> grok strings');
}

// ─── 9. Connections: Gemini -> Grok node name renames ───
{
  const renameMap = {
    'Gemini Background Cleanup': 'Grok Background Cleanup',
    'Gemini Furniture': 'Grok Furniture',
    'Gemini Open Door': 'Grok Open Door'
  };

  let connStr = JSON.stringify(wf.connections);
  for (const [old, nw] of Object.entries(renameMap)) {
    connStr = connStr.split(JSON.stringify(old)).join(JSON.stringify(nw));
  }
  wf.connections = JSON.parse(connStr);
  console.log('[9] Connections: Gemini -> Grok renames');
}

// ═══════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════
console.log('\n--- Validation ---');
const fullStr = JSON.stringify(wf);

const checks = [];
function check(label, ok) {
  checks.push({ label, ok });
  console.log(`  ${ok ? 'OK' : 'FAIL'}: ${label}`);
}

// No Gemini references (node names, connections, code)
const geminiInNames = wf.nodes.filter(n => /gemini/i.test(n.name));
check('No Gemini node names', geminiInNames.length === 0);

const geminiInConn = JSON.stringify(wf.connections).match(/Gemini/gi) || [];
check('No Gemini in connections', geminiInConn.length === 0);

check('No extractGeminiImage', !fullStr.includes('extractGeminiImage'));
check('No geminiCleanupBody', !fullStr.includes('geminiCleanupBody'));
check('No geminiFurnitureBody', !fullStr.includes('geminiFurnitureBody'));
check('No geminiOpenBody', !fullStr.includes('geminiOpenBody'));
check('No GEMINI_API_KEY', !fullStr.includes('GEMINI_API_KEY'));

// Grok references present
check('Has extractGrokImage', fullStr.includes('extractGrokImage'));
check('Has grokCleanupBody', fullStr.includes('grokCleanupBody'));
check('Has grokFurnitureBody', fullStr.includes('grokFurnitureBody'));
check('Has grokOpenBody', fullStr.includes('grokOpenBody'));
check('Has XAI_API_KEY', fullStr.includes('XAI_API_KEY'));
check('Has grok-imagine-image', fullStr.includes('grok-imagine-image'));
check('Has api.x.ai', fullStr.includes('api.x.ai'));
check('Webhook path = dadam-interior-grok', fullStr.includes('dadam-interior-grok'));

const failed = checks.filter(c => !c.ok);
if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.length} checks`);
  failed.forEach(f => console.error(`  - ${f.label}`));
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed.`);

// ═══════════════════════════════════════════════
// Save local JSON
// ═══════════════════════════════════════════════
writeFileSync(outPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log(`\nSaved: ${outPath}`);

// ═══════════════════════════════════════════════
// Deploy to n8n
// ═══════════════════════════════════════════════
async function deploy() {
  console.log('\n--- Deploying to n8n ---');

  // Strip fields n8n doesn't accept on create
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings
  };

  // Create workflow
  const createRes = await fetch(`${BASE}/workflows`, {
    method: 'POST',
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error('Create failed:', createRes.status, err);
    process.exit(1);
  }

  const created = await createRes.json();
  const newId = created.id;
  console.log(`Created workflow: ${newId}`);

  // Activate
  const activateRes = await fetch(`${BASE}/workflows/${newId}/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });

  if (!activateRes.ok) {
    const err = await activateRes.text();
    console.error('Activate failed:', activateRes.status, err);
  } else {
    console.log(`Activated workflow: ${newId}`);
  }

  console.log(`\nWebhook: https://dadam.app.n8n.cloud/webhook/dadam-interior-grok`);
}

deploy().catch(e => {
  console.error('Deploy error:', e.message);
  process.exit(1);
});
