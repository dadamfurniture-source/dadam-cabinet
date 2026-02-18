#!/usr/bin/env node
/**
 * Deploy Grok workflow to n8n Cloud.
 * Reads local JSON (with $vars.XAI_API_KEY), injects actual key from env, deploys.
 * Does NOT modify the local JSON file.
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const XAI_KEY = process.env.XAI_API_KEY;
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

if (!N8N_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }
if (!XAI_KEY) { console.error('ERROR: XAI_API_KEY not found'); process.exit(1); }

// Read local JSON
const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));

// Inject actual key into Code nodes (in memory only)
console.log('=== Deploy Grok Workflow ===');
let injected = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  const before = node.parameters.jsCode;
  // Replace $vars.XAI_API_KEY with actual key
  const after = before.replace(/\$vars\.XAI_API_KEY/g, `'${XAI_KEY}'`);
  if (after !== before) {
    node.parameters.jsCode = after;
    const count = (before.match(/\$vars\.XAI_API_KEY/g) || []).length;
    console.log(`${node.name}: injected ${count} key ref(s)`);
    injected += count;
  }
}

// Also fix grokAuth in return statements that use string concatenation
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  // "Bearer " + $vars.XAI_API_KEY → "Bearer <actual_key>"  (already handled by above)
  // But check for "Bearer " + '<key>' pattern from the above replacement
  node.parameters.jsCode = node.parameters.jsCode.replace(
    `"Bearer " + '${XAI_KEY}'`,
    `"Bearer ${XAI_KEY}"`
  );
}

console.log(`Total injections: ${injected}`);

// Validate: no $vars remaining
const allCode = wf.nodes.filter(n => n.parameters?.jsCode).map(n => n.parameters.jsCode).join('\n');
const varsLeft = (allCode.match(/\$vars\./g) || []).length;
if (varsLeft > 0) {
  console.error(`ERROR: ${varsLeft} $vars references remaining!`);
  process.exit(1);
}
console.log('Validation: 0 $vars remaining');

// Deploy
console.log('\nDeploying...');
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
  console.error('DEPLOY FAILED:', await putRes.text());
  process.exit(1);
}
console.log('Updated:', putRes.status);

await fetch(`${BASE}/workflows/${WF_ID}/activate`, {
  method: 'POST', headers: { 'X-N8N-API-KEY': N8N_KEY }
});
console.log('Activated');
console.log('\nDone! Local JSON unchanged (safe for git).');
