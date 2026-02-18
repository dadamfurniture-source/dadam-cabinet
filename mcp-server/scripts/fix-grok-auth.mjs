#!/usr/bin/env node
/**
 * Fix: $vars not available in API-created workflows.
 * Solution: Hardcode XAI API key directly in Code nodes
 * - Remove Set Grok Auth nodes (no longer needed)
 * - Restore direct connections
 * - Replace $vars.XAI_API_KEY with actual key in Code nodes
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const localPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const XAI_KEY = process.env.XAI_API_KEY;

// Step 1: Fetch current workflow
console.log('--- Step 1: Fetch workflow ---');
const getRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
if (!getRes.ok) {
  console.error('Fetch failed:', await getRes.text());
  process.exit(1);
}
const wf = await getRes.json();
console.log(`Fetched: ${wf.nodes.length} nodes`);

// Step 2: Remove Set Grok Auth nodes
console.log('\n--- Step 2: Remove Set nodes ---');
const setNodes = wf.nodes.filter(n => n.name.startsWith('Set Grok Auth'));
console.log(`Found ${setNodes.length} Set nodes:`, setNodes.map(n => n.name));
wf.nodes = wf.nodes.filter(n => !n.name.startsWith('Set Grok Auth'));
console.log(`Remaining: ${wf.nodes.length} nodes`);

// Step 3: Restore direct connections
console.log('\n--- Step 3: Restore connections ---');
// Parse S3 + Build Bodies → Grok Background Cleanup (direct)
if (wf.connections['Set Grok Auth (BG)']) {
  wf.connections['Parse S3 + Build Bodies'].main[0] = [
    { node: 'Grok Background Cleanup', type: 'main', index: 0 }
  ];
  delete wf.connections['Set Grok Auth (BG)'];
  console.log('Fixed: Parse S3 → Grok BG Cleanup (direct)');
}

// Has Cleaned BG? (true) → Grok Furniture (direct)
if (wf.connections['Set Grok Auth (Furn)']) {
  wf.connections['Has Cleaned BG?'].main[0] = [
    { node: 'Grok Furniture', type: 'main', index: 0 }
  ];
  delete wf.connections['Set Grok Auth (Furn)'];
  console.log('Fixed: Has Cleaned BG? → Grok Furniture (direct)');
}

// Has Closed Image? (true) → Grok Open Door (direct)
if (wf.connections['Set Grok Auth (Open)']) {
  wf.connections['Has Closed Image?'].main[0] = [
    { node: 'Grok Open Door', type: 'main', index: 0 }
  ];
  delete wf.connections['Set Grok Auth (Open)'];
  console.log('Fixed: Has Closed Image? → Grok Open Door (direct)');
}

// Step 4: Replace $vars.XAI_API_KEY in Code nodes
console.log('\n--- Step 4: Fix $vars references in Code nodes ---');
const codeNodes = ['Parse S3 + Build Bodies', 'Parse BG Result', 'Parse Furniture + Prep Open'];
for (const name of codeNodes) {
  const node = wf.nodes.find(n => n.name === name);
  if (!node || !node.parameters.jsCode) {
    console.log(`WARN: ${name} not found or no jsCode`);
    continue;
  }
  const before = node.parameters.jsCode;
  // Replace $vars.XAI_API_KEY with the actual key string
  node.parameters.jsCode = before.replace(/\$vars\.XAI_API_KEY/g, `'${XAI_KEY}'`);
  const count = (before.match(/\$vars\.XAI_API_KEY/g) || []).length;
  console.log(`${name}: replaced ${count} $vars reference(s)`);
}

// Step 5: Fix HTTP node headers - use $json.grokAuth from Code node output
console.log('\n--- Step 5: Verify HTTP node headers ---');
for (const name of ['Grok Background Cleanup', 'Grok Furniture', 'Grok Open Door']) {
  const node = wf.nodes.find(n => n.name === name);
  if (!node) { console.log(`WARN: ${name} not found`); continue; }
  const authHeader = node.parameters.headerParameters.parameters.find(p => p.name === 'Authorization');
  console.log(`${name}: Authorization = ${authHeader?.value || 'MISSING'}`);
}

// Step 6: Final validation
console.log('\n--- Step 6: Validation ---');
const allJsCode = wf.nodes
  .filter(n => n.parameters?.jsCode)
  .map(n => n.parameters.jsCode)
  .join('\n');
const varsRefs = (allJsCode.match(/\$vars\./g) || []).length;
const setNodeCount = wf.nodes.filter(n => n.name.includes('Set Grok Auth')).length;
console.log(`$vars references remaining: ${varsRefs}`);
console.log(`Set Grok Auth nodes remaining: ${setNodeCount}`);
console.log(`XAI_KEY references: ${(allJsCode.match(/xai-8Stt/g) || []).length}`);
if (varsRefs > 0) {
  console.error('ERROR: Still has $vars references!');
  process.exit(1);
}

// Step 7: Save locally
writeFileSync(localPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log(`\nSaved: ${localPath}`);

// Step 8: Deploy
console.log('\n--- Step 8: Deploy ---');
await fetch(`${BASE}/workflows/${WF_ID}/deactivate`, {
  method: 'POST', headers: { 'X-N8N-API-KEY': N8N_KEY }
});
const putRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, name: wf.name,
  }),
});
if (!putRes.ok) {
  console.error('Deploy failed:', await putRes.text());
  process.exit(1);
}
console.log('Updated:', putRes.status);
await fetch(`${BASE}/workflows/${WF_ID}/activate`, {
  method: 'POST', headers: { 'X-N8N-API-KEY': N8N_KEY }
});
console.log('Activated');
console.log('\nDone! Test: node mcp-server/test-grok-e2e.mjs');
