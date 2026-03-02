#!/usr/bin/env node
/**
 * Grok Furniture → Flux LoRA 교체 배포 스크립트 v2
 *
 * 현재 파이프라인:
 *   Cleanup(Grok) → Furniture(Grok httpRequest) → Parse Furniture → Open(Grok)
 *
 * 변경 후:
 *   Cleanup(Grok) → Furniture(Replicate Flux LoRA Code) → Parse Furniture → Open(Grok)
 *
 * 변경 사항:
 *   1. "Grok Furniture" 노드 타입: httpRequest → code
 *   2. Replicate API로 LoRA 모델 호출 (카테고리별 자동 선택)
 *   3. Grok 호환 출력 형식 유지 ({ data: [{ b64_json }] })
 *   4. Stage 2 Correction (Parse Furniture) 은 여전히 Grok 유지
 *
 * 사용법:
 *   node scripts/deploy-flux-lora.mjs [--dry-run]
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load both .env files (n8n keys + mcp-server keys)
config({ path: resolve(__dirname, '../../n8n/.env') });
config({ path: resolve(__dirname, '../.env'), override: false });

const N8N_KEY = process.env.N8N_API_KEY;
const XAI_KEY = process.env.XAI_API_KEY;
const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vvqrvgcgnlfpiqqndsve.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

const dryRun = process.argv.includes('--dry-run');

if (!N8N_KEY) { console.error('ERROR: N8N_API_KEY not found (n8n/.env)'); process.exit(1); }
if (!XAI_KEY) { console.error('ERROR: XAI_API_KEY not found (n8n/.env)'); process.exit(1); }
if (!REPLICATE_KEY) { console.error('ERROR: REPLICATE_API_KEY not found (mcp-server/.env)'); process.exit(1); }
if (!SUPABASE_ANON_KEY) { console.error('ERROR: SUPABASE_ANON_KEY not found (mcp-server/.env)'); process.exit(1); }

const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));

console.log('=== Deploy Flux LoRA (Furniture Stage) v2 ===');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log();

// ─── 1. Grok Furniture 노드를 Code 노드 + Replicate Flux LoRA로 교체 ───
const furnitureIdx = wf.nodes.findIndex(n => n.name === 'Grok Furniture');
if (furnitureIdx === -1) {
  console.error('ERROR: "Grok Furniture" node not found');
  process.exit(1);
}

const oldNode = wf.nodes[furnitureIdx];
console.log(`Found: "${oldNode.name}" (${oldNode.type})`);
console.log(`  Position: [${oldNode.position}]`);

// 노드 타입을 httpRequest → code 로 교체 (위치/ID/이름 유지)
const newNode = {
  id: oldNode.id,
  name: oldNode.name, // 이름 유지 → connections 깨지지 않음
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: oldNode.position,
  parameters: {
    jsCode: `// ═══ Flux LoRA Furniture Generation via Replicate ═══
// Replaces Grok Furniture httpRequest with Replicate LoRA Code node
// Output format: Grok-compatible { data: [{ b64_json }] }

const input = $input.first().json;

// Extract data from Parse BG Result
const grokBody = JSON.parse(input.grokFurnitureBody || '{}');
const furniturePrompt = grokBody.prompt || '';
const cleanedBg = input.cleanedBackground || '';
const category = input.category || '';

if (!cleanedBg) {
  return [{ json: { data: [], _error: 'No cleaned background image' } }];
}
if (!furniturePrompt) {
  return [{ json: { data: [], _error: 'No furniture prompt' } }];
}

// ─── Supabase: 카테고리별 LoRA 모델 조회 ───
const SUPABASE_URL = '${SUPABASE_URL}';
const SUPABASE_KEY = '${SUPABASE_ANON_KEY}';
let loraModel = null;

try {
  const loraRes = await fetch(
    SUPABASE_URL + '/rest/v1/lora_models?category=eq.' + category + '&status=eq.ready&order=created_at.desc&limit=1',
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
  );
  const models = await loraRes.json();
  if (Array.isArray(models) && models.length > 0) loraModel = models[0];
} catch(e) {
  // LoRA 조회 실패 시 fallback
}

if (!loraModel || !loraModel.model_version) {
  return [{ json: { data: [], _error: 'No LoRA model for category: ' + category } }];
}

// model_version 형식: "owner/name:versionhash" → versionhash만 추출
const versionParts = loraModel.model_version.split(':');
const version = versionParts.length > 1 ? versionParts[1] : versionParts[0];

// 트리거 워드 + 프롬프트 결합
const prompt = (loraModel.trigger_word || '') + ' ' + furniturePrompt;

const REPLICATE_KEY = '${REPLICATE_KEY}';

// ─── Replicate: 이미지 생성 요청 ───
const predRes = await fetch('https://api.replicate.com/v1/predictions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + REPLICATE_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    version,
    input: {
      prompt,
      image: 'data:image/png;base64,' + cleanedBg,
      prompt_strength: 0.3,
      num_outputs: 1,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      output_format: 'png',
    }
  })
});

if (!predRes.ok) {
  const errText = await predRes.text();
  return [{ json: { data: [], _error: 'Replicate submit: ' + predRes.status, _detail: errText.substring(0, 200) } }];
}

const prediction = await predRes.json();

// ─── Replicate: 완료 대기 (polling) ───
let result = prediction;
const maxWait = 180000; // 3분
const pollStart = Date.now();

while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
  if (Date.now() - pollStart > maxWait) {
    return [{ json: { data: [], _error: 'Replicate timeout', _predictionId: result.id } }];
  }
  await new Promise(r => setTimeout(r, 3000));
  const pollRes = await fetch('https://api.replicate.com/v1/predictions/' + result.id, {
    headers: { 'Authorization': 'Bearer ' + REPLICATE_KEY }
  });
  result = await pollRes.json();
}

if (result.status !== 'succeeded') {
  return [{ json: { data: [], _error: 'Replicate ' + result.status + ': ' + (result.error || 'unknown') } }];
}

// ─── 생성 이미지 URL → base64 변환 ───
const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
if (!outputUrl) {
  return [{ json: { data: [], _error: 'No output image from Replicate' } }];
}

const imgRes = await fetch(outputUrl);
const imgBuf = Buffer.from(await imgRes.arrayBuffer());
const b64 = imgBuf.toString('base64');

// ─── Grok 호환 형식으로 반환 (Parse Furniture + Prep Open 호환) ───
return [{ json: {
  data: [{ b64_json: b64 }],
  _loraUsed: loraModel.trigger_word,
  _loraCategory: category,
  _predictionId: result.id,
  _predictTime: result.metrics?.predict_time || 0,
  _source: 'replicate-flux-lora'
} }];`
  }
};

wf.nodes[furnitureIdx] = newNode;
console.log(`Replaced: "Grok Furniture" httpRequest → code (Replicate Flux LoRA)`);

// ─── 2. XAI_API_KEY 주입 (Cleanup, Open, Parse Furniture 등) ───
let injected = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  if (node.name === 'Grok Furniture') continue;
  const before = node.parameters.jsCode;
  const after = before.replace(/\$vars\.XAI_API_KEY/g, `'${XAI_KEY}'`);
  if (after !== before) {
    node.parameters.jsCode = after;
    const count = (before.match(/\$vars\.XAI_API_KEY/g) || []).length;
    console.log(`  ${node.name}: injected ${count} XAI key ref(s)`);
    injected += count;
  }
}

// Fix Bearer concatenation (이전 배포에서 남은 문제 수정)
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  node.parameters.jsCode = node.parameters.jsCode.replace(
    `"Bearer " + '${XAI_KEY}'`,
    `"Bearer ${XAI_KEY}"`
  );
}

console.log(`XAI injections: ${injected}`);

// ─── 3. $vars 참조 검증 ───
const allCode = wf.nodes
  .filter(n => n.parameters?.jsCode)
  .map(n => ({ name: n.name, code: n.parameters.jsCode }));

let varsLeft = 0;
for (const { name, code } of allCode) {
  const matches = code.match(/\$vars\./g);
  if (matches) {
    console.error(`  WARNING: ${name} still has ${matches.length} $vars references`);
    varsLeft += matches.length;
  }
}

// httpRequest 노드의 expression에서도 $vars 확인
for (const node of wf.nodes) {
  if (node.type !== 'n8n-nodes-base.httpRequest') continue;
  const str = JSON.stringify(node.parameters);
  const matches = str.match(/\$vars\./g);
  if (matches) {
    // grokAuth expression에서 $vars 교체
    const paramStr = JSON.stringify(node.parameters);
    const fixed = paramStr.replace(/\$vars\.XAI_API_KEY/g, `'${XAI_KEY}'`);
    if (fixed !== paramStr) {
      node.parameters = JSON.parse(fixed);
      console.log(`  ${node.name}: fixed $vars in httpRequest params`);
    } else {
      console.error(`  WARNING: ${node.name} httpRequest has ${matches.length} unresolved $vars`);
      varsLeft += matches.length;
    }
  }
}

if (varsLeft > 0) {
  console.error(`\nERROR: ${varsLeft} $vars references remaining!`);
  process.exit(1);
}

console.log('\nValidation passed: no $vars references remaining');

// ─── 4. Dry run or Deploy ───
if (dryRun) {
  const outPath = resolve(__dirname, '../../tmp/flux-lora-deploy-preview.json');
  writeFileSync(outPath, JSON.stringify(wf, null, 2));

  // Show the Furniture node code for review
  const furnitureNode = wf.nodes.find(n => n.name === 'Grok Furniture');
  console.log(`\n${'─'.repeat(50)}`);
  console.log('Grok Furniture node (new code):');
  console.log(`${'─'.repeat(50)}`);
  console.log(furnitureNode.parameters.jsCode.substring(0, 300) + '...');
  console.log(`\nDry run saved to: ${outPath}`);
  console.log('Review before deploying with: node scripts/deploy-flux-lora.mjs');
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

// Step 1: Deactivate (PATCH method)
console.log('1. Deactivating workflow...');
const deactRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
console.log(`   Deactivate: ${deactRes.status}`);

// Step 2: Update
console.log('2. Updating workflow...');
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

// Step 3: Activate (PATCH method)
console.log('3. Activating workflow...');
const actRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
console.log(`   Activate: ${actRes.status}`);

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log('DEPLOYMENT COMPLETE');
console.log(`${'═'.repeat(50)}`);
console.log('Pipeline: Cleanup(Grok) → Furniture(Flux LoRA) → Open(Grok)');
console.log('');
console.log('Changes:');
console.log('  - Grok Furniture: httpRequest(xAI) → code(Replicate Flux LoRA)');
console.log('  - LoRA model: auto-selected from Supabase lora_models by category');
console.log('  - Output: Grok-compatible { data: [{ b64_json }] }');
console.log('  - Stage 2 Correction: still Grok (unchanged)');
console.log('  - Cleanup/Open: still Grok (unchanged)');
console.log('');
console.log('Rollback: redeploy from n8n/v8-grok-analysis.json (local copy unchanged)');
