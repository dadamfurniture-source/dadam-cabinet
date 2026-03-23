#!/usr/bin/env node
/**
 * verify-grok.mjs — Verify the Grok transformation was applied correctly.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

// 1. JSON.parse validity
console.log('\n[1] JSON validity');
let wf;
try {
  wf = JSON.parse(readFileSync(inputPath, 'utf-8'));
  check('JSON.parse succeeds', true);
} catch (e) {
  check('JSON.parse succeeds', false);
  console.error(e.message);
  process.exit(1);
}

// Helper
function findNode(name) {
  return wf.nodes.find(n => n.name === name);
}

// 2. No Gemini references remain in node names
console.log('\n[2] No Gemini node names');
const geminiNodes = wf.nodes.filter(n => n.name.includes('Gemini'));
check('No nodes named "Gemini..."', geminiNodes.length === 0);
if (geminiNodes.length > 0) {
  geminiNodes.forEach(n => console.log('    Found:', n.name));
}

// 3. Grok nodes exist
console.log('\n[3] Grok nodes exist');
check('Grok Background Cleanup exists', !!findNode('Grok Background Cleanup'));
check('Grok Furniture exists', !!findNode('Grok Furniture'));
check('Grok Open Door exists', !!findNode('Grok Open Door'));

// 4. HTTP nodes have correct settings
console.log('\n[4] HTTP node settings');
for (const name of ['Grok Background Cleanup', 'Grok Furniture', 'Grok Open Door']) {
  const node = findNode(name);
  if (!node) continue;
  const p = node.parameters;
  check(`${name} URL = api.x.ai/v1/images/edits`, p.url === 'https://api.x.ai/v1/images/edits');
  check(`${name} method = POST`, p.method === 'POST');
  check(`${name} sendQuery = false`, p.sendQuery === false);
  check(`${name} sendHeaders = true`, p.sendHeaders === true);
  const authHeader = p.headerParameters?.parameters?.find(h => h.name === 'Authorization');
  check(`${name} has Authorization header`, !!authHeader);
  check(`${name} auth uses XAI_API_KEY`, authHeader?.value?.includes('XAI_API_KEY'));
  check(`${name} timeout = 120000`, p.options?.timeout === 120000);
}

// 5. Code nodes — JS validity
console.log('\n[5] Code node JS validity');
const codeNodes = ['Build Cleanup Prompt', 'Parse BG + Build Furniture', 'Parse Furniture + Prep Open', 'Format Response (All)'];
for (const name of codeNodes) {
  const node = findNode(name);
  if (!node) { check(`${name} exists`, false); continue; }
  const code = node.parameters.jsCode;
  try {
    // Basic syntax check — won't execute but will catch syntax errors
    new Function(code);
    check(`${name} JS syntax valid`, true);
  } catch (e) {
    check(`${name} JS syntax valid`, false);
    console.log(`    Error: ${e.message}`);
  }
}

// 6. Code nodes — Grok body patterns
console.log('\n[6] Grok body patterns in code');
{
  const cleanup = findNode('Build Cleanup Prompt');
  const code = cleanup.parameters.jsCode;
  check('Build Cleanup has grokCleanupBody', code.includes('grokCleanupBody'));
  check('Build Cleanup has model: grok-imagine-image', code.includes("model: 'grok-imagine-image'"));
  check('Build Cleanup has response_format: b64_json', code.includes("response_format: 'b64_json'"));
  check('Build Cleanup NO geminiCleanupBody', !code.includes('geminiCleanupBody'));
}
{
  const furniture = findNode('Parse BG + Build Furniture');
  const code = furniture.parameters.jsCode;
  check('Parse BG has grokFurnitureBody', code.includes('grokFurnitureBody'));
  check('Parse BG has model: grok-imagine-image', code.includes("model: 'grok-imagine-image'"));
  check('Parse BG has response.data[0].b64_json parsing', code.includes('data[0].b64_json'));
  check('Parse BG NO geminiFurnitureBody', !code.includes('geminiFurnitureBody'));
  check('Parse BG NO candidates[0].content', !code.includes('candidates[0].content'));
}
{
  const prepOpen = findNode('Parse Furniture + Prep Open');
  const code = prepOpen.parameters.jsCode;
  check('Prep Open has grokOpenBody', code.includes('grokOpenBody'));
  check('Prep Open has data[0].b64_json parsing', code.includes('data[0].b64_json'));
  check('Prep Open NO geminiOpenBody', !code.includes('geminiOpenBody'));
  check('Prep Open NO candidates', !code.includes('candidates'));
}
{
  const formatAll = findNode('Format Response (All)');
  const code = formatAll.parameters.jsCode;
  check('Format Response has data[0].b64_json parsing', code.includes('data[0].b64_json'));
  check('Format Response NO candidates', !code.includes('candidates'));
}

// 7. HTTP node body references
console.log('\n[7] HTTP node body references');
check('Grok Background Cleanup body = grokCleanupBody', findNode('Grok Background Cleanup')?.parameters.body === '={{ $json.grokCleanupBody }}');
check('Grok Furniture body = grokFurnitureBody', findNode('Grok Furniture')?.parameters.body === '={{ $json.grokFurnitureBody }}');
check('Grok Open Door body = grokOpenBody', findNode('Grok Open Door')?.parameters.body === '={{ $json.grokOpenBody }}');

// 8. Blueprint mode: text layout description
console.log('\n[8] Blueprint mode text layout');
{
  const code = findNode('Parse BG + Build Furniture').parameters.jsCode;
  check('Blueprint has PRECISE CABINET LAYOUT text', code.includes('PRECISE CABINET LAYOUT'));
  check('Blueprint has wall dimension text', code.includes('mm wide'));
  check('Blueprint has UPPER CABINETS section', code.includes('UPPER CABINETS'));
  check('Blueprint has LOWER CABINETS section', code.includes('LOWER CABINETS'));
  check('Blueprint has x position percentages', code.includes('xStart'));
  // Verify only 1 image in Grok body (no inline_data for blueprint)
  check('Blueprint mode uses single image (no inline_data)', !code.includes('inline_data'));
}

// 9. Connections
console.log('\n[9] Connections');
const connStr = JSON.stringify(wf.connections);
check('Connection: "Grok Background Cleanup" present', connStr.includes('"Grok Background Cleanup"'));
check('Connection: "Grok Furniture" present', connStr.includes('"Grok Furniture"'));
check('Connection: "Grok Open Door" present', connStr.includes('"Grok Open Door"'));
check('Connection: NO "Gemini" references', !connStr.includes('Gemini'));

// 10. No Gemini references anywhere in the file
console.log('\n[10] No Gemini references in entire file');
const fullStr = JSON.stringify(wf);
const geminiCount = (fullStr.match(/Gemini/gi) || []).length;
const geminiApiKeyCount = (fullStr.match(/GEMINI_API_KEY/g) || []).length;
check(`No "Gemini" in node names/connections (found: ${geminiCount - geminiApiKeyCount} non-API-key refs)`,
  geminiCount === geminiApiKeyCount); // Only acceptable if it's GEMINI_API_KEY references (shouldn't exist now)
check('No GEMINI_API_KEY references', geminiApiKeyCount === 0);

// Summary
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log(`${'═'.repeat(50)}`);
process.exit(fail > 0 ? 1 : 0);
