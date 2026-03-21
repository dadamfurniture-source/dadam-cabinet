#!/usr/bin/env node
/**
 * Deploy ControlNet Furniture Node to n8n v10 Pipeline
 *
 * 기존 v10 파이프라인에 ControlNet 노드 추가:
 * 1. Build All Prompts 뒤에 Switch 노드 삽입
 * 2. renderingMode === 'blueprint' → ControlNet Furniture
 * 3. 나머지 → 기존 Gemini Furniture (기본값)
 * 4. 양쪽 모두 Parse Furniture로 합류
 *
 * Usage:
 *   node scripts/deploy-controlnet-node.mjs --dry-run   # Preview only
 *   node scripts/deploy-controlnet-node.mjs             # Live deploy
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3200';
const V5_ID = 'KUuawjm7m3nS0qHH';

if (!N8N_API_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }

// ─── Load node code ───
function loadNodeCode(filename) {
  let code = readFileSync(resolve(__dirname, 'v10-nodes', filename), 'utf-8');
  code = code.replace(/%%GEMINI_API_KEY%%/g, GEMINI_KEY || '');
  code = code.replace(/%%MCP_SERVER_URL%%/g, MCP_SERVER_URL);
  return code;
}

const CONTROLNET_FURNITURE_CODE = loadNodeCode('controlnet-furniture.js');

// ─── n8n API helpers ───
async function n8nApi(method, path, body) {
  const opts = {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${N8N_BASE_URL}${path}`, opts);
  return res.json();
}

// ─── Main ───
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Deploy ControlNet Node to v10 Pipeline        ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`MCP Server: ${MCP_SERVER_URL}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  // 1. 현재 워크플로우 가져오기
  console.log('── Step 1: Fetching current workflow ──');
  const workflow = await n8nApi('GET', `/workflows/${V5_ID}`);
  const nodes = workflow.nodes || [];
  const connections = workflow.connections || {};

  console.log(`  Current nodes: ${nodes.length}`);
  console.log(`  Nodes: ${nodes.map(n => n.name).join(', ')}`);

  // 2. ControlNet Furniture 노드가 이미 있는지 확인
  const existingCN = nodes.find(n => n.name === 'ControlNet Furniture');
  if (existingCN) {
    console.log('  ControlNet Furniture node already exists. Updating code...');
    existingCN.parameters.jsCode = CONTROLNET_FURNITURE_CODE;
  }

  // 3. Switch 노드 확인
  const existingSwitch = nodes.find(n => n.name === 'Route Furniture');
  if (existingSwitch) {
    console.log('  Route Furniture switch node already exists.');
  }

  if (existingCN && existingSwitch) {
    console.log('\n  Both nodes exist. Updating code only.');
    if (!DRY_RUN) {
      await n8nApi('PUT', `/workflows/${V5_ID}`, { nodes, connections });
      console.log('  ✓ Workflow updated');
    } else {
      console.log('  [DRY RUN] Would update workflow');
    }
    return;
  }

  // 4. 새 노드 추가
  console.log('\n── Step 2: Adding new nodes ──');

  // Build All Prompts 노드 위치 찾기
  const buildPrompts = nodes.find(n => n.name === 'Build All Prompts');
  const geminiFurniture = nodes.find(n => n.name === 'Gemini Furniture');

  if (!buildPrompts || !geminiFurniture) {
    console.error('  ERROR: Cannot find "Build All Prompts" or "Gemini Furniture" nodes');
    process.exit(1);
  }

  const bpPos = buildPrompts.position || [0, 0];
  const gfPos = geminiFurniture.position || [0, 0];

  // Switch 노드 추가 (Build All Prompts와 Gemini Furniture 사이)
  if (!existingSwitch) {
    const switchNode = {
      id: crypto.randomUUID(),
      name: 'Route Furniture',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3,
      position: [bpPos[0] + 300, bpPos[1]],
      parameters: {
        rules: {
          values: [
            {
              conditions: {
                options: { caseSensitive: false, leftValue: '' },
                conditions: [{
                  leftValue: '={{ $json.renderingMode }}',
                  rightValue: 'blueprint',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
              renameOutput: true,
              outputKey: 'ControlNet',
            },
          ],
        },
        options: { fallbackOutput: 'extra' },
      },
    };
    nodes.push(switchNode);
    console.log('  + Added "Route Furniture" switch node');
  }

  // ControlNet Furniture Code 노드 추가
  if (!existingCN) {
    const cnNode = {
      id: crypto.randomUUID(),
      name: 'ControlNet Furniture',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [gfPos[0], gfPos[1] + 200],
      parameters: {
        jsCode: CONTROLNET_FURNITURE_CODE,
        mode: 'runOnceForAllItems',
      },
    };
    nodes.push(cnNode);
    console.log('  + Added "ControlNet Furniture" code node');
  }

  // 5. 연결 업데이트
  console.log('\n── Step 3: Updating connections ──');

  // Build All Prompts → Route Furniture
  connections['Build All Prompts'] = {
    main: [[{ node: 'Route Furniture', type: 'main', index: 0 }]],
  };

  // Route Furniture → output 0 (ControlNet) / fallback (Gemini)
  connections['Route Furniture'] = {
    main: [
      [{ node: 'ControlNet Furniture', type: 'main', index: 0 }], // ControlNet
      [{ node: 'Gemini Furniture', type: 'main', index: 0 }],     // Fallback (Gemini)
    ],
  };

  // ControlNet Furniture → Parse Furniture (기존 Gemini Furniture와 동일 대상)
  const geminiTarget = connections['Gemini Furniture']?.main?.[0]?.[0];
  if (geminiTarget) {
    connections['ControlNet Furniture'] = {
      main: [[{ ...geminiTarget }]],
    };
    console.log(`  ControlNet Furniture → ${geminiTarget.node}`);
  }

  console.log('  Build All Prompts → Route Furniture → [ControlNet | Gemini]');

  // 6. 배포
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Preview:');
    console.log(`  Total nodes: ${nodes.length}`);
    console.log(`  New: Route Furniture (Switch), ControlNet Furniture (Code)`);
    console.log(`  Flow: Build All Prompts → Route Furniture`);
    console.log(`           ├─ renderingMode=blueprint → ControlNet Furniture → Parse Furniture`);
    console.log(`           └─ default                 → Gemini Furniture     → Parse Furniture`);
    console.log('\n  ControlNet code preview (first 200 chars):');
    console.log('  ' + CONTROLNET_FURNITURE_CODE.substring(0, 200));
  } else {
    console.log('\n── Step 4: Deploying ──');
    const result = await n8nApi('PUT', `/workflows/${V5_ID}`, { nodes, connections });
    if (result.id) {
      console.log(`  ✓ Workflow updated (${nodes.length} nodes)`);
      // Activate
      await n8nApi('POST', `/workflows/${V5_ID}/activate`);
      console.log('  ✓ Workflow activated');
    } else {
      console.error('  ✗ Deploy failed:', JSON.stringify(result).substring(0, 200));
    }
  }

  console.log('\n═══ Done ═══');
  console.log('To test: POST /webhook/dadam-interior-v4 with renderingMode: "blueprint"');
  console.log('Default: renderingMode absent → Gemini pipeline (unchanged)');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
