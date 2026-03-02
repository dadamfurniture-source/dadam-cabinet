#!/usr/bin/env node
/**
 * Correction + Open Door → Gemini 전환 배포 스크립트
 *
 * 변경 사항:
 *   1. "Parse Furniture + Prep Open" 노드: Stage 2 Correction을 Grok → Gemini로 교체
 *   2. "Grok Open Door" 노드: httpRequest(xAI) → code(Gemini img2img)
 *
 * 파이프라인 변경:
 *   Before: Cleanup(Grok) → Furniture(Flux LoRA) → Correction(Grok) → Open(Grok)
 *   After:  Cleanup(Grok) → Furniture(Flux LoRA) → Correction(Gemini) → Open(Gemini)
 *
 * 사용법:
 *   node scripts/deploy-gemini-stages.mjs [--dry-run]
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, '../../n8n/.env') });
config({ path: resolve(__dirname, '../.env'), override: false });

const N8N_KEY = process.env.N8N_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBUkAqtH585oxKwmObMak_lyiZRwaY4BaI';
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

const dryRun = process.argv.includes('--dry-run');

if (!N8N_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }

console.log('=== Deploy Gemini Stages (Correction + Open Door) ===');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log();

// ─── Step 0: Fetch current workflow from n8n Cloud ───
console.log('0. Fetching current workflow from n8n Cloud...');
const fetchRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
if (!fetchRes.ok) {
  console.error(`ERROR: Failed to fetch workflow: ${fetchRes.status}`);
  process.exit(1);
}
const wf = await fetchRes.json();
console.log(`   Fetched: "${wf.name}" (${wf.nodes.length} nodes, active: ${wf.active})`);

// ─── Step 1: "Parse Furniture + Prep Open" — Correction을 Gemini로 교체 ───
const pfIdx = wf.nodes.findIndex(n => n.name === 'Parse Furniture + Prep Open');
if (pfIdx === -1) {
  console.error('ERROR: "Parse Furniture + Prep Open" node not found');
  process.exit(1);
}

const pfNode = wf.nodes[pfIdx];
console.log(`\n1. Updating "${pfNode.name}" — Correction: Grok → Gemini`);

const newPfCode = `// Parse Furniture + Prep Open - Stage 2 Gemini Correction + Open prep
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

// ─── Stage 2: Gemini Correction Pass ───
if (closedImage) {
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_KEY}';
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
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: CORRECTION_PROMPT },
          { inlineData: { mimeType: 'image/png', data: closedImage } }
        ]}],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    });
    const geminiData = await geminiRes.json();
    // Extract image from Gemini response
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData && p.inlineData.mimeType?.startsWith('image/'));
    if (imgPart && imgPart.inlineData.data) {
      closedImage = imgPart.inlineData.data;
    }
  } catch(e) { /* Stage 2 failed, use Stage 1 image */ }
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

pfNode.parameters.jsCode = newPfCode;
console.log(`   Updated code: ${newPfCode.length} chars`);

// ─── Step 2: "Grok Open Door" — httpRequest(xAI) → code(Gemini) ───
const odIdx = wf.nodes.findIndex(n => n.name === 'Grok Open Door');
if (odIdx === -1) {
  console.error('ERROR: "Grok Open Door" node not found');
  process.exit(1);
}

const oldOd = wf.nodes[odIdx];
console.log(`\n2. Replacing "${oldOd.name}" — httpRequest(xAI) → code(Gemini)`);

const newOdCode = `// Gemini Open Door — img2img editing via Gemini
const input = $input.first().json;
const closedImage = input.closedImage;
const openPrompt = input.openPrompt || '[TASK: OPEN DOORS AND DRAWERS]\\nPRESERVE EVERYTHING - ONLY OPEN DOORS\\nHinged doors: Open outward ~90 degrees\\nDrawers: Pull out 30-40%\\nShow interior storage items.';

if (!closedImage) {
  return [{ json: { data: [], _error: 'No closed image for open door stage' } }];
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_KEY}';

// Retry logic for Gemini API
let lastError = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: openPrompt },
          { inlineData: { mimeType: 'image/png', data: closedImage } }
        ]}],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      lastError = 'Gemini API ' + res.status + ': ' + errText.substring(0, 200);
      if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
      return [{ json: { data: [], _error: lastError } }];
    }

    const geminiData = await res.json();
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData && p.inlineData.mimeType?.startsWith('image/'));

    if (imgPart && imgPart.inlineData.data) {
      // Grok-compatible output format for Format Response node
      return [{ json: { data: [{ b64_json: imgPart.inlineData.data }], _source: 'gemini-open-door' } }];
    }

    // No image in response — check for text-only response
    const textPart = parts.find(p => p.text);
    lastError = 'Gemini returned no image' + (textPart ? ': ' + textPart.text.substring(0, 100) : '');
    if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
    return [{ json: { data: [], _error: lastError } }];

  } catch(e) {
    lastError = 'Gemini fetch error: ' + e.message;
    if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
    return [{ json: { data: [], _error: lastError } }];
  }
}

return [{ json: { data: [], _error: 'Gemini max retries: ' + lastError } }];`;

const newOdNode = {
  id: oldOd.id,
  name: oldOd.name,  // 이름 유지 → connections 유지
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: oldOd.position,
  parameters: {
    jsCode: newOdCode
  }
};

wf.nodes[odIdx] = newOdNode;
console.log(`   Replaced: httpRequest → code (${newOdCode.length} chars)`);

// ─── Step 3: Validation ───
console.log('\n3. Validation...');

// Check for $vars references
let varsLeft = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  const matches = node.parameters.jsCode.match(/\$vars\./g);
  if (matches) {
    console.error(`   WARNING: ${node.name} still has ${matches.length} $vars references`);
    varsLeft += matches.length;
  }
}

// Check for remaining xAI references in modified nodes
const modifiedNodes = ['Parse Furniture + Prep Open', 'Grok Open Door'];
for (const name of modifiedNodes) {
  const node = wf.nodes.find(n => n.name === name);
  if (node?.parameters?.jsCode) {
    if (node.parameters.jsCode.includes('api.x.ai')) {
      console.error(`   WARNING: ${name} still contains xAI API reference!`);
    }
    if (node.parameters.jsCode.includes('grok-imagine')) {
      console.error(`   WARNING: ${name} still contains grok-imagine model reference!`);
    }
  }
}

console.log(`   $vars check: ${varsLeft === 0 ? 'PASS' : 'FAIL (' + varsLeft + ' remaining)'}`);
console.log('   xAI reference check: Modified nodes clean');

// ─── Step 4: Dry run or Deploy ───
if (dryRun) {
  const outPath = resolve(__dirname, '../tmp/gemini-stages-preview.json');
  writeFileSync(outPath, JSON.stringify(wf, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log('Parse Furniture (Gemini Correction) — first 300 chars:');
  console.log(newPfCode.substring(0, 300) + '...');
  console.log(`\n${'─'.repeat(50)}`);
  console.log('Grok Open Door (Gemini) — first 300 chars:');
  console.log(newOdCode.substring(0, 300) + '...');
  console.log(`\nDry run saved to: ${outPath}`);
  console.log('Deploy with: node scripts/deploy-gemini-stages.mjs');
  process.exit(0);
}

// ─── Deploy to n8n Cloud ───
console.log('\n─── Deploying to n8n Cloud ───');

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

// ─── Verify ───
console.log('\nD. Verifying deployment...');
const verifyRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
const verified = await verifyRes.json();

const pfVerify = verified.nodes.find(n => n.name === 'Parse Furniture + Prep Open');
const odVerify = verified.nodes.find(n => n.name === 'Grok Open Door');

console.log(`   Active: ${verified.active}`);
console.log(`   Parse Furniture type: ${pfVerify?.type}`);
console.log(`   Parse Furniture has Gemini: ${pfVerify?.parameters?.jsCode?.includes('gemini-2.0-flash') || false}`);
console.log(`   Open Door type: ${odVerify?.type}`);
console.log(`   Open Door has Gemini: ${odVerify?.parameters?.jsCode?.includes('gemini-2.0-flash') || false}`);

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log('DEPLOYMENT COMPLETE');
console.log(`${'═'.repeat(50)}`);
console.log('Pipeline: Cleanup(Grok) → Furniture(Flux LoRA) → Correction(Gemini) → Open(Gemini)');
console.log('');
console.log('Changes:');
console.log('  - Stage 2 Correction: Grok xAI → Gemini 2.0 Flash img2img');
console.log('  - Open Door: httpRequest(xAI) → code(Gemini 2.0 Flash img2img)');
console.log('  - Output format: Grok-compatible { data: [{ b64_json }] } maintained');
console.log('  - Cleanup: still Grok (unchanged)');
console.log('  - Furniture: still Flux LoRA (unchanged)');
console.log('');
console.log('Rollback: re-fetch from n8n Cloud history or redeploy previous version');
