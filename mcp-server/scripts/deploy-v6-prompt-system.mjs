#!/usr/bin/env node
// Deploy v6: Supabase 연동 동적 프롬프트 시스템
// Updates: Parse Input, Build S3 Request, Parse S3 + Build Bodies
// DOES NOT change cleanup prompt (v5.5 preserved)
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

if (!N8N_KEY) {
  console.error('ERROR: N8N_API_KEY not found in n8n/.env');
  process.exit(1);
}

// Load the updated workflow JSON to extract node code
const wfJsonPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
const localWf = JSON.parse(readFileSync(wfJsonPath, 'utf-8'));

// Extract jsCode from each target node in the local JSON
function getLocalNodeCode(nodeName) {
  const node = localWf.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in local workflow JSON`);
  return node.parameters.jsCode;
}

const PARSE_INPUT_CODE = getLocalNodeCode('Parse Input');
const BUILD_S3_CODE = getLocalNodeCode('Build S3 Request');
const PARSE_S3_CODE = getLocalNodeCode('Parse S3 + Build Bodies');

async function main() {
  console.log('=== Deploy v6: Supabase Dynamic Prompt System ===');
  console.log('Target nodes: Parse Input, Build S3 Request, Parse S3 + Build Bodies');
  console.log('');

  // Verify key changes
  console.log('[Parse Input]');
  console.log('  Has styleMoodPrompt:', PARSE_INPUT_CODE.includes('styleMoodPrompt'));
  console.log('  Has styleAccentPrompt:', PARSE_INPUT_CODE.includes('styleAccentPrompt'));
  console.log('  Code length:', PARSE_INPUT_CODE.length, 'chars');

  console.log('[Build S3 Request]');
  console.log('  Has v6 header:', BUILD_S3_CODE.includes('v6'));
  console.log('  Has cabinetSection:', BUILD_S3_CODE.includes('cabinetSection'));
  console.log('  Has [ANGLE] section:', BUILD_S3_CODE.includes('[ANGLE]'));
  console.log('  Has [CABINET APPEARANCE]:', BUILD_S3_CODE.includes('[CABINET APPEARANCE]'));
  console.log('  Code length:', BUILD_S3_CODE.length, 'chars');

  console.log('[Parse S3 + Build Bodies]');
  console.log('  Has v5.5 cleanup:', PARSE_S3_CODE.includes('original wall and tile colors'));
  console.log('  Has style passthrough:', PARSE_S3_CODE.includes('styleMoodPrompt'));
  console.log('  NO cleanup change:', !PARSE_S3_CODE.includes('smooth paint'));
  console.log('  Code length:', PARSE_S3_CODE.length, 'chars');
  console.log('');

  // Fetch current workflow
  console.log('Fetching current workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  if (!res.ok) {
    console.error('Failed to fetch workflow:', await res.text());
    process.exit(1);
  }
  const wf = await res.json();

  // Update Parse Input
  const parseInput = wf.nodes.find(n => n.name === 'Parse Input');
  if (parseInput) {
    console.log('Parse Input BEFORE:', parseInput.parameters.jsCode.length, 'chars');
    parseInput.parameters.jsCode = PARSE_INPUT_CODE;
    console.log('Parse Input AFTER:', parseInput.parameters.jsCode.length, 'chars');
  } else {
    console.error('WARNING: Parse Input node not found');
  }

  // Update Build S3 Request
  const buildS3 = wf.nodes.find(n => n.name === 'Build S3 Request');
  if (buildS3) {
    console.log('Build S3 BEFORE:', buildS3.parameters.jsCode.length, 'chars');
    buildS3.parameters.jsCode = BUILD_S3_CODE;
    console.log('Build S3 AFTER:', buildS3.parameters.jsCode.length, 'chars');
  } else {
    console.error('WARNING: Build S3 Request node not found');
  }

  // Update Parse S3 + Build Bodies
  const parseS3 = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  if (parseS3) {
    console.log('Parse S3 BEFORE:', parseS3.parameters.jsCode.length, 'chars');
    parseS3.parameters.jsCode = PARSE_S3_CODE;
    console.log('Parse S3 AFTER:', parseS3.parameters.jsCode.length, 'chars');
  } else {
    console.error('WARNING: Parse S3 + Build Bodies node not found');
  }

  // Deploy
  console.log('\nDeploying...');
  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
    }),
  });

  if (!updateRes.ok) {
    console.error('DEPLOY FAILED:', await updateRes.text());
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('');
  console.log('=== DEPLOYED SUCCESSFULLY ===');
  console.log('Workflow active:', updated.active);
  console.log('v6 Dynamic Prompt System deployed to n8n Cloud');
  console.log('- Parse Input: +7 style fields');
  console.log('- Build S3: v3 modular TMPL_FURNITURE + cabinetSection');
  console.log('- Parse S3: style passthrough, cleanup v5.5 UNCHANGED');
}

main().catch(err => { console.error(err); process.exit(1); });
