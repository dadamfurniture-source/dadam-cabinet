#!/usr/bin/env node
/**
 * Deploy RAG Node: Supabase RAG Search 노드 추가
 *
 * 변경 사항:
 * 1. Supabase RAG Search Code 노드 추가
 * 2. Parse Wall Data → Supabase RAG Search → Build All Prompts 연결
 * 3. Build All Prompts 코드 업데이트 (RAG 규칙 반영)
 *
 * Usage:
 *   node scripts/deploy-rag-node.mjs --dry-run   # Preview only
 *   node scripts/deploy-rag-node.mjs             # Live deploy
 */
import { config } from 'dotenv';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const V5_ID = 'KUuawjm7m3nS0qHH';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!N8N_API_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }
if (!SUPABASE_URL) { console.error('ERROR: SUPABASE_URL not found'); process.exit(1); }
if (!SUPABASE_ANON_KEY) { console.error('ERROR: SUPABASE_ANON_KEY not found'); process.exit(1); }

function loadNodeCode(filename) {
  let code = readFileSync(resolve(__dirname, 'v10-nodes', filename), 'utf-8');
  code = code.replace(/%%SUPABASE_URL%%/g, SUPABASE_URL);
  code = code.replace(/%%SUPABASE_ANON_KEY%%/g, SUPABASE_ANON_KEY);
  if (GEMINI_KEY) code = code.replace(/%%GEMINI_API_KEY%%/g, GEMINI_KEY);
  return code;
}

const RAG_SEARCH_CODE = loadNodeCode('supabase-rag-search.js');
const BUILD_ALL_PROMPTS_CODE = loadNodeCode('build-all-prompts.js');

async function n8nFetch(path, opts = {}) {
  const url = `${N8N_BASE_URL}${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json', ...opts.headers },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   Retry ${attempt}/3: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Deploy: Supabase RAG Search Node 추가');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DEPLOY'}\n`);

  // 0. Fetch current workflow
  console.log('0. Fetching workflow...');
  const res = await n8nFetch(`/workflows/${V5_ID}`);
  let wf = await res.json();
  console.log(`   "${wf.name}" (${wf.nodes.length} nodes)\n`);

  // 1. Backup
  const backupPath = resolve(__dirname, '../tmp/pre-rag-node-backup.json');
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`1. Backup: ${backupPath}\n`);

  const findNode = (name) => wf.nodes.find(n => n.name === name);

  // 2. Add or update Supabase RAG Search node
  console.log('2. Adding Supabase RAG Search node...');
  let ragNode = findNode('Supabase RAG Search');
  const parseWallNode = findNode('Parse Wall Data');
  const buildPromptsNode = findNode('Build All Prompts');

  if (!parseWallNode) { console.error('ERROR: Parse Wall Data node not found'); process.exit(1); }
  if (!buildPromptsNode) { console.error('ERROR: Build All Prompts node not found'); process.exit(1); }

  // Position: between Parse Wall Data and Build All Prompts
  const ragPosition = [
    Math.round((parseWallNode.position[0] + buildPromptsNode.position[0]) / 2),
    parseWallNode.position[1],
  ];

  if (!ragNode) {
    ragNode = {
      parameters: { jsCode: RAG_SEARCH_CODE, mode: 'runOnceForAllItems' },
      id: randomUUID(),
      name: 'Supabase RAG Search',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: ragPosition,
    };
    wf.nodes.push(ragNode);
    console.log(`   ✓ NEW node created (${RAG_SEARCH_CODE.length} chars)`);

    // Shift Build All Prompts and downstream 200px right
    const shiftNodes = ['Build All Prompts', 'Gemini Furniture', 'Validate & Fix',
      'Parse Furniture + Build Open', 'Has Closed Image?', 'Gemini Open Door',
      'Format Response (Both)', 'Format Response (Closed Only)',
      'Respond (Both Images)', 'Respond (Closed Only)'];
    for (const n of wf.nodes) {
      if (shiftNodes.includes(n.name)) {
        n.position = [n.position[0] + 200, n.position[1]];
      }
    }
    console.log('   ✓ Downstream nodes shifted 200px right');
  } else {
    ragNode.parameters.jsCode = RAG_SEARCH_CODE;
    ragNode.parameters.mode = 'runOnceForAllItems';
    console.log(`   ✓ Existing node updated (${RAG_SEARCH_CODE.length} chars)`);
  }

  // 3. Update Build All Prompts code
  console.log('\n3. Updating Build All Prompts...');
  buildPromptsNode.parameters.jsCode = BUILD_ALL_PROMPTS_CODE;
  console.log(`   ✓ Build All Prompts: ${BUILD_ALL_PROMPTS_CODE.length} chars`);

  // 4. Rewire connections
  console.log('\n4. Rewiring connections...');
  // Parse Wall Data → Supabase RAG Search → Build All Prompts
  wf.connections['Parse Wall Data'] = {
    main: [[{ node: 'Supabase RAG Search', type: 'main', index: 0 }]]
  };
  wf.connections['Supabase RAG Search'] = {
    main: [[{ node: 'Build All Prompts', type: 'main', index: 0 }]]
  };
  console.log('   ✓ Parse Wall Data → Supabase RAG Search → Build All Prompts');

  // Verify other connections remain intact
  const expectedConnections = {
    'Webhook': 'Parse Input',
    'Parse Input': 'Wall Analysis',
    'Wall Analysis': 'Gemini Wall Vision',
    'Gemini Wall Vision': 'Parse Wall Data',
    'Build All Prompts': 'Gemini Furniture',
  };
  for (const [from, to] of Object.entries(expectedConnections)) {
    if (!wf.connections[from]) {
      console.log(`   ⚠ Missing connection: ${from} → ${to}`);
    }
  }

  console.log('');

  // 5. Validate
  console.log('5. Validation...');
  const nodeNames = wf.nodes.map(n => n.name);
  const checks = {
    'Has Supabase RAG Search': nodeNames.includes('Supabase RAG Search'),
    'Has Build All Prompts': nodeNames.includes('Build All Prompts'),
    'Has Parse Wall Data': nodeNames.includes('Parse Wall Data'),
    'RAG → Build connection': !!wf.connections['Supabase RAG Search'],
    'ParseWall → RAG connection': wf.connections['Parse Wall Data']?.main?.[0]?.[0]?.node === 'Supabase RAG Search',
    'Build has ragRules ref': BUILD_ALL_PROMPTS_CODE.includes('ragRules'),
  };

  let allPass = true;
  for (const [check, ok] of Object.entries(checks)) {
    console.log(`   ${ok ? '✓' : '✗'} ${check}`);
    if (!ok) allPass = false;
  }

  if (!allPass) {
    console.error('\n❌ Validation failed. Aborting.');
    process.exit(1);
  }
  console.log('   ✓ All checks passed\n');

  // 6. Deploy
  if (DRY_RUN) {
    const outPath = resolve(__dirname, '../tmp/rag-node-dry-run.json');
    writeFileSync(outPath, JSON.stringify(wf, null, 2));
    console.log(`DRY RUN: Output saved to ${outPath}`);
    console.log(`Total nodes: ${wf.nodes.length}`);
    return;
  }

  console.log('6. Deploying to n8n Cloud...');
  // n8n API는 불필요한 속성 거부 — 허용 속성만 전송
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
    staticData: wf.staticData,
  };
  const putRes = await n8nFetch(`/workflows/${V5_ID}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error(`Deploy failed: ${putRes.status} ${errText}`);
    process.exit(1);
  }

  const result = await putRes.json();
  console.log(`   ✓ Deployed! "${result.name}" (${result.nodes.length} nodes)`);

  // 7. Activate
  console.log('\n7. Activating workflow...');
  const actRes = await n8nFetch(`/workflows/${V5_ID}/activate`, { method: 'POST' });
  if (actRes.ok) {
    console.log('   ✓ Workflow activated');
  } else {
    console.log('   ⚠ Activation response:', actRes.status);
  }

  // 8. Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Deploy Complete!');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Nodes: ${result.nodes.length}`);
  console.log(`  Pipeline: Parse Wall Data → Supabase RAG Search → Build All Prompts → ...`);
  console.log(`  RAG triggers: category-based (${Object.keys({ sink: 1, wardrobe: 1, fridge: 1, vanity: 1, shoe: 1, storage: 1 }).join(', ')})`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
