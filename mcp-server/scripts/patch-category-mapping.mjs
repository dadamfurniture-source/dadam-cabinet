#!/usr/bin/env node
/**
 * Grok Furniture 노드에 sink → 세부 카테고리 매핑 추가
 * sink는 LoRA에 없으므로 l_shaped_sink로 기본 매핑
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });
config({ path: resolve(__dirname, '../.env'), override: false });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// Step 1: Fetch
console.log('Fetching workflow...');
const wf = await (await fetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
})).json();

const gfIdx = wf.nodes.findIndex(n => n.name === 'Grok Furniture');
const gf = wf.nodes[gfIdx];
const oldCode = gf.parameters.jsCode;

// Step 2: Insert category mapping after "const category = ..."
const MAPPING_CODE = `
// ─── 카테고리 매핑 (generic → LoRA specific) ───
const CATEGORY_MAP = {
  'sink': 'l_shaped_sink',
  'kitchen': 'island_kitchen',
  'closet': 'wardrobe',
  'cabinet': 'storage_cabinet',
  'shoe': 'shoe_cabinet',
  'fridge': 'fridge_cabinet',
  'bathroom': 'vanity',
};
const loraCategory = CATEGORY_MAP[category] || category;`;

const newCode = oldCode.replace(
  "const category = input.category || '';",
  "const category = input.category || '';" + MAPPING_CODE
).replace(
  // Supabase 쿼리에서 category → loraCategory 사용
  "'/rest/v1/lora_models?category=eq.' + category + '&status=eq.ready",
  "'/rest/v1/lora_models?category=eq.' + loraCategory + '&status=eq.ready"
).replace(
  // 에러 메시지에도 loraCategory 표시
  "'No LoRA model for category: ' + category",
  "'No LoRA model for category: ' + category + ' (mapped: ' + loraCategory + ')'"
).replace(
  // 출력에 loraCategory 기록
  "_loraCategory: category,",
  "_loraCategory: loraCategory,"
);

gf.parameters.jsCode = newCode;
console.log(`Code updated: ${oldCode.length} → ${newCode.length} chars`);

// Verify mapping is in place
if (!newCode.includes('CATEGORY_MAP')) {
  console.error('ERROR: Mapping not injected properly');
  process.exit(1);
}

// Step 3: Deploy
console.log('Deploying...');
const putRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
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
  console.error('DEPLOY FAILED:', putRes.status, await putRes.text());
  process.exit(1);
}
console.log('Deploy:', putRes.status, 'OK');

// Step 4: Verify
const v = await (await fetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
})).json();
const vNode = v.nodes.find(n => n.name === 'Grok Furniture');
console.log('Verified CATEGORY_MAP:', vNode.parameters.jsCode.includes('CATEGORY_MAP'));
console.log('Verified loraCategory:', vNode.parameters.jsCode.includes('loraCategory'));
console.log('\nDone. sink → l_shaped_sink mapping active.');
