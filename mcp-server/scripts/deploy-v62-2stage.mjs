#!/usr/bin/env node
// Deploy v6.2: 2-Stage Gemini Furniture Generation
// Changes:
//   Parse BG Result: V6_RULES removed (shorter Stage 1 prompt)
//   Parse Furniture + Prep Open: Stage 2 correction pass added
// Does NOT change: cleanup prompt (v5.5), workflow structure, other nodes
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

// Load local workflow JSON
const wfJsonPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
const localWf = JSON.parse(readFileSync(wfJsonPath, 'utf-8'));

function getLocalNodeCode(nodeName) {
  const node = localWf.nodes.find(n => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in local workflow JSON`);
  return node.parameters.jsCode;
}

const PARSE_BG_CODE = getLocalNodeCode('Parse BG Result');
const PARSE_FURNITURE_CODE = getLocalNodeCode('Parse Furniture + Prep Open');

async function main() {
  console.log('=== Deploy v6.2: 2-Stage Gemini Furniture Generation ===');
  console.log('Target nodes: Parse BG Result, Parse Furniture + Prep Open');
  console.log('');

  // Verify v6.2 changes
  console.log('[Parse BG Result]');
  console.log('  V6_RULES removed:', !PARSE_BG_CODE.includes('V6_RULES'));
  console.log('  No furniturePrompt += V6_RULES:', !PARSE_BG_CODE.includes('furniturePrompt += V6_RULES'));
  console.log('  Still has extractGeminiImage:', PARSE_BG_CODE.includes('extractGeminiImage'));
  console.log('  Still has retry logic:', PARSE_BG_CODE.includes('retry'));
  console.log('  Code length:', PARSE_BG_CODE.length, 'chars');

  console.log('[Parse Furniture + Prep Open]');
  console.log('  Has Stage 2 correction:', PARSE_FURNITURE_CODE.includes('STAGE 2'));
  console.log('  Has CORRECTION_PROMPT:', PARSE_FURNITURE_CODE.includes('CORRECTION_PROMPT'));
  console.log('  Has CLOSED DOORS rule:', PARSE_FURNITURE_CODE.includes('CLOSED DOORS'));
  console.log('  Has COOKTOP rule:', PARSE_FURNITURE_CODE.includes('COOKTOP'));
  console.log('  Has DRAWER CABINET rule:', PARSE_FURNITURE_CODE.includes('DRAWER CABINET'));
  console.log('  Has FAUCET rule:', PARSE_FURNITURE_CODE.includes('FAUCET'));
  console.log('  Has NO DUCT PIPE rule:', PARSE_FURNITURE_CODE.includes('NO DUCT PIPE'));
  console.log('  Has temperature 0.2:', PARSE_FURNITURE_CODE.includes('temperature: 0.2'));
  console.log('  Has graceful fallback:', PARSE_FURNITURE_CODE.includes('Stage 2 failed'));
  console.log('  Code length:', PARSE_FURNITURE_CODE.length, 'chars');
  console.log('');

  // Validation gates
  if (PARSE_BG_CODE.includes('V6_RULES')) {
    console.error('ABORT: V6_RULES still present in Parse BG Result');
    process.exit(1);
  }
  if (!PARSE_FURNITURE_CODE.includes('CORRECTION_PROMPT')) {
    console.error('ABORT: CORRECTION_PROMPT not found in Parse Furniture + Prep Open');
    process.exit(1);
  }

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

  // Update Parse BG Result
  const parseBG = wf.nodes.find(n => n.name === 'Parse BG Result');
  if (parseBG) {
    console.log('Parse BG Result BEFORE:', parseBG.parameters.jsCode.length, 'chars');
    parseBG.parameters.jsCode = PARSE_BG_CODE;
    console.log('Parse BG Result AFTER:', parseBG.parameters.jsCode.length, 'chars');
  } else {
    console.error('WARNING: Parse BG Result node not found');
  }

  // Update Parse Furniture + Prep Open
  const parseFurniture = wf.nodes.find(n => n.name === 'Parse Furniture + Prep Open');
  if (parseFurniture) {
    console.log('Parse Furniture BEFORE:', parseFurniture.parameters.jsCode.length, 'chars');
    parseFurniture.parameters.jsCode = PARSE_FURNITURE_CODE;
    console.log('Parse Furniture AFTER:', parseFurniture.parameters.jsCode.length, 'chars');
  } else {
    console.error('WARNING: Parse Furniture + Prep Open node not found');
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
  console.log('v6.2 2-Stage Furniture Generation deployed to n8n Cloud');
  console.log('- Parse BG Result: V6_RULES removed (~700 chars shorter prompt)');
  console.log('- Parse Furniture + Prep Open: Stage 2 correction pass added');
  console.log('  Stage 1: Layout + materials (~2,100 chars)');
  console.log('  Stage 2: Correction (~500 chars, temp 0.2)');
  console.log('  Fallback: Stage 2 failure → Stage 1 image used');
}

main().catch(err => { console.error(err); process.exit(1); });
