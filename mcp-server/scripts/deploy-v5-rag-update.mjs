#!/usr/bin/env node
/**
 * Deploy: v5 RAG Update — Parse Input + Supabase RAG Search를 v9 수준으로 업데이트
 *
 * 변경 사항:
 * 1. Parse Input: 하드코딩 triggerMap → body.triggers 외부입력 + 전체 필드
 * 2. Supabase RAG Search: $json.triggers → $('Parse Input').first().json.triggers (명시적 참조)
 */
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });
const DRY_RUN = process.argv.includes('--dry-run');

const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const WORKFLOW_ID = 'KUuawjm7m3nS0qHH'; // v5 (Wall Analysis)테스트용

// ─── Updated Parse Input Code (v9 pattern + triggerMap fallback) ───
const PARSE_INPUT_CODE = `const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

// RAG triggers: use input if provided, otherwise category defaults
const triggerMap = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  shoe_cabinet: ['신발장', '수납', '배경보정', '벽면마감'],
  vanity: ['세면대', '거울장', '수납', '배경보정', '벽면마감'],
  storage_cabinet: ['수납장', '선반', '배경보정', '벽면마감']
};
const triggers = (body.triggers && body.triggers.length > 0) ? body.triggers : (triggerMap[category] || triggerMap.sink);
const materialCodes = body.material_codes || [];
const colorKeywords = body.color_keywords || [];

return {
  category, style, roomImage, imageType,
  triggers, materialCodes, colorKeywords,
  manual_positions: body.manual_positions || null,
  prompt: body.prompt || '',
  negative_prompt: body.negative_prompt || '',
  cabinet_specs: body.cabinet_specs || {},
  layout_image: body.layout_image || '',
  layout_data: body.layout_data || null,
  mask_image: body.mask_image || '',
  modules: body.modules || null,
  reference_images: body.reference_images || [],
  material_descriptions: body.material_descriptions || [],
  styleMoodPrompt: body.style_mood_prompt || '',
  styleDoorColor: body.style_door_color || '',
  styleDoorHex: body.style_door_hex || '',
  styleDoorFinish: body.style_door_finish || '',
  styleCountertopPrompt: body.style_countertop_prompt || '',
  styleHandlePrompt: body.style_handle_prompt || '',
  styleAccentPrompt: body.style_accent_prompt || ''
};`;

// ─── Helper: n8n API fetch with retry ───
async function n8nFetch(path, opts = {}) {
  const url = `${N8N_BASE_URL}${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json',
          ...opts.headers,
        },
        signal: AbortSignal.timeout(30000),
      });
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   Retry ${attempt}/3: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  v5 RAG Update: Parse Input + Supabase RAG Search');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DEPLOY'}\n`);

  // 0. Fetch current workflow
  console.log('0. Fetching v5 workflow...');
  const res = await n8nFetch(`/workflows/${WORKFLOW_ID}`);
  const wf = await res.json();
  console.log(`   "${wf.name}" (${wf.nodes.length} nodes)\n`);

  // 1. Backup
  const backupPath = resolve(__dirname, '../tmp/pre-v5-rag-backup.json');
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`1. Backup: ${backupPath}`);

  // 2. Update Parse Input
  const parseNode = wf.nodes.find(n => n.name === 'Parse Input');
  if (!parseNode) {
    console.error('ERROR: "Parse Input" node not found!');
    process.exit(1);
  }
  const oldParseLen = parseNode.parameters.jsCode.length;
  parseNode.parameters.jsCode = PARSE_INPUT_CODE;
  console.log(`2. Parse Input: ${oldParseLen} → ${PARSE_INPUT_CODE.length} chars`);
  console.log(`   - triggerMap 하드코딩 제거 → body.triggers 외부입력`);
  console.log(`   - style 기본값: '모던' → 'modern'`);
  console.log(`   - 추가 필드: manual_positions, modules, layout_data, style* 등`);

  // 3. Update Supabase RAG Search — explicit node reference
  const ragNode = wf.nodes.find(n => n.name === 'Supabase RAG Search');
  if (!ragNode) {
    console.error('ERROR: "Supabase RAG Search" node not found!');
    process.exit(1);
  }
  const params = ragNode.parameters.bodyParameters.parameters;

  let ragUpdated = 0;
  for (const p of params) {
    if (p.name === 'query_triggers' && p.value === '={{ $json.triggers }}') {
      p.value = "={{ $('Parse Input').first().json.triggers }}";
      ragUpdated++;
    }
    if (p.name === 'filter_category' && p.value === '={{ $json.category }}') {
      p.value = "={{ $('Parse Input').first().json.category }}";
      ragUpdated++;
    }
  }
  console.log(`3. Supabase RAG Search: ${ragUpdated} parameters updated`);
  console.log(`   - query_triggers: $json → $('Parse Input').first().json`);
  console.log(`   - filter_category: $json → $('Parse Input').first().json`);

  // ── Validation ──
  console.log('\n── Validation ──');
  const hasTriggerMapFallback = parseNode.parameters.jsCode.includes('triggerMap') && parseNode.parameters.jsCode.includes('body.triggers');
  const hasBodyTriggers = parseNode.parameters.jsCode.includes('body.triggers');
  const hasExplicitRef = params.some(p => p.value.includes("$('Parse Input')"));

  console.log(`   ✓ triggerMap fallback + body.triggers: ${hasTriggerMapFallback}`);
  console.log(`   ✓ body.triggers 사용: ${hasBodyTriggers}`);
  console.log(`   ✓ 명시적 노드 참조: ${hasExplicitRef}`);

  const issues = [];
  if (!hasBodyTriggers) issues.push('body.triggers missing');
  if (!hasExplicitRef) issues.push('explicit node reference missing');
  console.log(`   Issues: ${issues.length ? issues.join(', ') : 'NONE ✓'}`);

  if (issues.length) {
    console.error('\nValidation failed! Aborting.');
    process.exit(1);
  }

  // ── Deploy or Dry Run ──
  if (DRY_RUN) {
    const previewPath = resolve(__dirname, '../tmp/v5-rag-preview.json');
    writeFileSync(previewPath, JSON.stringify(wf, null, 2));
    console.log(`\nDry run saved: ${previewPath}`);
    console.log(`Deploy with: node scripts/deploy-v5-rag-update.mjs`);
    return;
  }

  console.log('\n── Deploying ──');

  // A. Deactivate
  console.log('A. Deactivating...');
  await n8nFetch(`/workflows/${WORKFLOW_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });

  // B. Update (only send allowed fields — n8n rejects extra properties)
  console.log('B. Updating...');
  const payload = { nodes: wf.nodes, connections: wf.connections, name: wf.name, settings: wf.settings };
  const updateRes = await n8nFetch(`/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  console.log(`   Update: ${updateRes.status} ${updateRes.statusText}`);

  // C. Keep inactive (v5 is test-only)
  console.log('C. Keeping inactive (test workflow)');

  // D. Verify
  console.log('D. Verifying...');
  const verifyRes = await n8nFetch(`/workflows/${WORKFLOW_ID}`);
  const verified = await verifyRes.json();
  const verifiedParse = verified.nodes.find(n => n.name === 'Parse Input');
  const verifiedRag = verified.nodes.find(n => n.name === 'Supabase RAG Search');

  console.log(`   Parse Input: ${verifiedParse.parameters.jsCode.length} chars`);
  console.log(`   Has body.triggers: ${verifiedParse.parameters.jsCode.includes('body.triggers')}`);
  console.log(`   RAG explicit ref: ${verifiedRag.parameters.bodyParameters.parameters.some(p => p.value.includes("$('Parse Input')"))}`);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('V5 RAG UPDATE COMPLETE');
  console.log('════════════════════════════════════════════════════════');
  console.log('Rollback: restore from tmp/pre-v5-rag-backup.json');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
