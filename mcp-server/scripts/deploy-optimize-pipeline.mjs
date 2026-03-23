#!/usr/bin/env node
/**
 * Pipeline Optimization Deploy Script
 *
 * Removes dead Grok/LoRA code, fixes stale strings, cleans up Build Fixed Prompts.
 *
 * Changes:
 *   1. "Build Fixed Prompts"     — Remove dead Grok body, dead furniturePrompt (~60% code reduction)
 *   2. "Format Response"         — "grok" → "gemini" strings, function name
 *   3. "Format Response (Closed)" — "grok" → "gemini" strings
 *   4. "Format Response (Error)" — "Grok" → "Gemini" error message
 *
 * Usage:
 *   node scripts/deploy-optimize-pipeline.mjs [--dry-run]
 */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env'), override: false });

const N8N_KEY = process.env.N8N_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const WF_ID = 'GAheS1PcPkzwVpYP';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const dryRun = process.argv.includes('--dry-run');

if (!N8N_KEY) { console.error('ERROR: N8N_API_KEY not found'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════
// NODE: Build Fixed Prompts — Optimized (dead Grok/furniture code removed)
// ═══════════════════════════════════════════════════════════════════
const BUILD_FIXED_PROMPTS_CODE = `// Build Fixed Prompts v3 - Cleanup + Open prompts + passthrough
// Furniture prompt is now built in Parse BG Result (v8 layout builder)
const input = $input.first().json;
const category = input.category || 'sink';
const style = input.style || 'modern';
const analysis = input.analysisResult;
const cf = input.coordinateFrame;
const modules = input.modules;
const cabinetSpecs = input.cabinetSpecs || {};

// RAG data from Supabase search
const ragResults = input.ragResults || [];
const ragBg = input.ragBg || [];
const ragModules = input.ragModules || [];
const ragDoors = input.ragDoors || [];
let ragContext = '';
if (ragBg.length > 0) ragContext += '\\n[RAG - Background Rules]\\n' + ragBg.join('\\n') + '\\n';
if (ragModules.length > 0) ragContext += '\\n[RAG - Module Rules]\\n' + ragModules.join('\\n') + '\\n';
if (ragDoors.length > 0) ragContext += '\\n[RAG - Door Rules]\\n' + ragDoors.join('\\n') + '\\n';

// ═══ 1. Cleanup Prompt ═══
const cleanupPrompt =
  '이 공사현장 사진을 완성된 빈 방으로 변환하세요.\\n' +
  '유지: 카메라 앵글, 원근감, 시점, 벽 구조, 원래 벽과 타일 색상, 창틀\\n' +
  '제거: 바닥과 표면의 모든 공사 잔해, 도구, 자재, 봉투, 사람';

// ═══ 2. Open Door Prompt ═══
const SEP = '═══════════════════════════════════════════════════════════════';
const CATEGORY_CONTENTS = {
  wardrobe: '- 행거에 걸린 셔츠, 블라우스, 재킷, 코트\\n- 접힌 스웨터, 니트, 티셔츠\\n- 청바지, 면바지 등 하의류\\n- 서랍 속 속옷, 양말 정리함\\n- 가방, 모자, 스카프 액세서리',
  sink: '- 그릇, 접시, 밥공기, 국그릇\\n- 컵, 머그잔, 유리잔\\n- 냄비, 프라이팬, 조리도구\\n- 양념통, 오일병\\n- 도마, 주걸, 국자\\n[싱크볼 하부 - 필수]\\n- 배수관 (P트랩/S트랩)\\n- 급수관 (냉/온수)\\n- 수도 분배기 (앵글밸브)\\n[싱크볼 하부 - 금지]\\n❌ 쓰레기통, 세제, 청소용품, 잡동사니',
  fridge: '- 커피머신, 전자레인지\\n- 토스터, 믹서기\\n- 식료품, 시리얼 박스\\n- 컵, 머그잔\\n- 간식, 음료',
  vanity: '- 화장품, 스킨케어 제품\\n- 메이크업 브러시, 파우치\\n- 향수, 로션, 크림\\n- 헤어드라이어, 고데기\\n- 수건, 세면도구',
  shoe: '- 운동화, 스니커즈\\n- 구두, 로퍼, 힐\\n- 샌들, 슬리퍼\\n- 부츠, 레인부츠\\n- 신발 관리용품',
  storage: '- 책, 잡지, 문서\\n- 수납박스, 바구니\\n- 이불, 침구류\\n- 여행가방, 캐리어\\n- 계절용품'
};
const CATEGORY_FORBIDDEN = {
  wardrobe: '❌ 식기류, 주방용품 금지 (옷장에는 의류만)',
  sink: '❌ 의류, 옷 금지 (주방에는 주방용품만)',
  fridge: '❌ 의류, 옷 금지 (냉장고장에는 가전/식품만)',
  vanity: '❌ 의류, 주방용품 금지 (화장대에는 화장품만)',
  shoe: '❌ 의류, 식기류 금지 (신발장에는 신발만)',
  storage: '❌ 음식물 금지 (수납장에는 수납용품만)'
};

const contents = CATEGORY_CONTENTS[category] || CATEGORY_CONTENTS.storage;
const forbidden = CATEGORY_FORBIDDEN[category] || CATEGORY_FORBIDDEN.storage;
const sinkExtra = category === 'sink' ? '- 싱크볼, 수전, 쿡탑, 후드 위치: 변경 금지\\n' : '';

const openPrompt =
  '[TASK] 이 가구 이미지에서 모든 도어를 열린 상태로 변경하세요.\\n\\n' +
  SEP + '\\n[CRITICAL - 절대 변경 금지] ★★★ 가장 중요\\n' + SEP + '\\n' +
  '- 도어 개수: 현재 이미지에 보이는 도어 개수 정확히 유지\\n' +
  '- 도어 위치: 각 도어의 위치 그대로 유지\\n' +
  '- 도어 크기/비율: 각 도어의 너비와 높이 비율 완전히 동일\\n' +
  '- 도어 색상/재질: 변경 금지\\n' +
  '- 가구 전체 크기와 형태: 변경 금지\\n' +
  '- 카메라 앵글, 원근감, 시점: 완전히 동일\\n' +
  '- 배경 (벽, 바닥, 천장, 조명): 동일\\n' +
  sinkExtra + '\\n' +
  SEP + '\\n[CRITICAL - 도어 구조 유지 규칙]\\n' + SEP + '\\n' +
  '- 절대 도어를 추가하거나 제거하지 마세요\\n' +
  '- 절대 도어를 합치거나 분할하지 마세요\\n' +
  '- 닫힌 상태의 도어 분할선/경계선을 정확히 따르세요\\n' +
  '- 각 도어는 독립적으로 열려야 합니다\\n\\n' +
  SEP + '\\n[변경할 것 - 도어 상태만]\\n' + SEP + '\\n' +
  '여닫이 도어 (Swing door):\\n→ 현재 위치에서 힌지 기준 90도 바깥으로 회전하여 열림\\n\\n' +
  '서랍 도어 (Drawer):\\n→ 현재 위치에서 30-40% 앞으로 당겨진 상태\\n\\n' +
  '※ 여닫이를 서랍처럼 열거나, 서랍을 여닫이처럼 열면 안됨!\\n\\n' +
  SEP + '\\n[내부 수납물 - ' + category + ']\\n' + SEP + '\\n' +
  contents + '\\n\\n' +
  SEP + '\\n[품목 혼동 금지]\\n' + SEP + '\\n' +
  forbidden + '\\n\\n' +
  SEP + '\\n[ABSOLUTELY FORBIDDEN]\\n' + SEP + '\\n' +
  '❌ 치수 라벨, 텍스트, 숫자 추가 금지\\n' +
  '❌ 배경, 방 요소 변경 금지\\n' +
  '❌ 카메라 앵글 변경 금지\\n' +
  '❌ 도어 타입 변경 금지 (swing↔drawer)\\n' +
  '❌ 도어 추가/제거/합치기/분할 금지\\n\\n' +
  SEP + '\\n[OUTPUT]\\n' + SEP + '\\n' +
  '- 닫힌 이미지와 도어 구조 100% 일치\\n' +
  '- 포토리얼리스틱 인테리어 사진 품질\\n' +
  '- 정리된 수납 상태 (어지럽지 않게)';

return {
  cleanupPrompt,
  fixedOpenPrompt: openPrompt,
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: cf,
  s1Analysis: input.s1Analysis,
  analysisMethod: input.analysisMethod,
  modules: input.modules,
  layoutData: input.layoutData,
  hasBlueprint: input.hasBlueprint,
  hasMask: input.hasMask,
  hasModules: input.hasModules,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  materialDescriptions: input.materialDescriptions,
  ragContext: ragContext,
  styleMoodPrompt: input.styleMoodPrompt || '',
  styleDoorColor: input.styleDoorColor || '',
  styleDoorFinish: input.styleDoorFinish || ''
};`;


// ═══════════════════════════════════════════════════════════════════
// NODE: Format Response — Fix Grok → Gemini strings
// ═══════════════════════════════════════════════════════════════════
const FORMAT_RESPONSE_CODE = `// Format Response - Gemini 4-stage pipeline
const prev = $('Parse Furniture + Prep Open').first().json;
const openResponse = $input.first().json;
const analysis = prev.analysisResult;
const cf = prev.coordinateFrame;

function extractImage(resp) {
  try {
    const data = resp && resp.data;
    if (data && data.length > 0 && data[0].b64_json) return data[0].b64_json;
    return null;
  } catch(e) { return null; }
}

const openImage = extractImage(openResponse);

return [{
  success: true,
  message: 'Claude S1 analysis + Gemini 4-stage image generation complete',
  processing: 'claude-s1 + gemini-4-stage',
  category: prev.category,
  style: prev.style,
  pipe_analysis: {
    method: prev.analysisMethod || 'default',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    wall_width_mm: analysis.wall_width_mm,
    wall_height_mm: analysis.wall_height_mm,
    wall_structure: cf && cf.wall_boundaries ? cf.wall_boundaries.wall_structure : null,
    confidence: analysis.confidence,
    coordinate_frame: cf || null,
    rendering_mode: prev.renderingMode || 'fallback',
    has_blueprint: prev.hasBlueprint || false,
    layout_data: prev.layoutData || null
  },
  generated_image: {
    background: { base64: prev.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background (Gemini)' },
    closed: { base64: prev.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture + Correction (Gemini)' },
    open: { base64: openImage, mime_type: 'image/png', description: 'Stage 3: Doors open (Gemini)' }
  }
}];`;


// ═══════════════════════════════════════════════════════════════════
// NODE: Format Response (Closed) — Fix Grok → Gemini
// ═══════════════════════════════════════════════════════════════════
const FORMAT_RESPONSE_CLOSED_CODE = `const input = $('Parse Furniture + Prep Open').first().json;
const analysis = input.analysisResult;
const cf = input.coordinateFrame;

return [{
  success: true,
  message: 'Claude S1 analysis + image generation complete (closed doors only)',
  processing: 'claude-s1 + gemini-2-stage',
  category: input.category,
  style: input.style,
  pipe_analysis: {
    method: input.analysisMethod || 'default',
    water_supply_percent: analysis.water_supply_percent,
    exhaust_duct_percent: analysis.exhaust_duct_percent,
    wall_width_mm: analysis.wall_width_mm,
    wall_height_mm: analysis.wall_height_mm,
    confidence: analysis.confidence,
    coordinate_frame: cf || null,
    rendering_mode: input.renderingMode || 'fallback',
    has_blueprint: input.hasBlueprint || false,
    layout_data: input.layoutData || null
  },
  generated_image: {
    background: { base64: input.cleanedBackground, mime_type: 'image/png', description: 'Stage 1: Cleaned background (Gemini)' },
    closed: { base64: input.closedImage, mime_type: 'image/png', description: 'Stage 2: Furniture + Correction (Gemini)' },
    open: null
  }
}];`;


// ═══════════════════════════════════════════════════════════════════
// NODE: Format Response (Error) — Fix Grok → Gemini
// ═══════════════════════════════════════════════════════════════════
const FORMAT_RESPONSE_ERROR_CODE = `const input = $('Build Fixed Prompts').first().json;
return [{json: {
  success: false,
  message: 'Background cleanup failed',
  error_detail: 'Background cleanup failed - Gemini could not generate cleaned image',
  category: input.category
}}];`;


// ═══════════════════════════════════════════════════════════════════
// MAIN DEPLOYMENT FLOW
// ═══════════════════════════════════════════════════════════════════

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

console.log('═══════════════════════════════════════════════════════');
console.log('  Pipeline Optimization: Dead Code + Stale Strings');
console.log('═══════════════════════════════════════════════════════');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOY'}`);
console.log();

// ─── Fetch workflow ───
console.log('0. Fetching workflow...');
const wfRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
if (!wfRes.ok) { console.error(`ERROR: Fetch failed: ${wfRes.status}`); process.exit(1); }
const wf = await wfRes.json();
console.log(`   "${wf.name}" (${wf.nodes.length} nodes)`);

// ─── Backup ───
const tmpDir = resolve(__dirname, '../tmp');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const backupPath = resolve(tmpDir, 'pre-optimize-backup.json');
writeFileSync(backupPath, JSON.stringify(wf, null, 2));
console.log(`1. Backup: ${backupPath}`);

// ─── Modify nodes ───
function findNode(name) {
  const idx = wf.nodes.findIndex(n => n.name === name);
  if (idx === -1) { console.error(`ERROR: "${name}" not found`); process.exit(1); }
  return idx;
}

// 2. Build Fixed Prompts — remove dead code
const bfpIdx = findNode('Build Fixed Prompts');
const bfpOld = wf.nodes[bfpIdx].parameters.jsCode.length;
wf.nodes[bfpIdx].parameters.jsCode = BUILD_FIXED_PROMPTS_CODE;
console.log(`2. Build Fixed Prompts: ${bfpOld} → ${BUILD_FIXED_PROMPTS_CODE.length} chars (${Math.round((1 - BUILD_FIXED_PROMPTS_CODE.length / bfpOld) * 100)}% reduced)`);

// 3. Format Response — grok → gemini
const frIdx = findNode('Format Response');
wf.nodes[frIdx].parameters.jsCode = FORMAT_RESPONSE_CODE;
console.log(`3. Format Response: extractGrokImage → extractImage, grok-3-stage → gemini-4-stage`);

// 4. Format Response (Closed) — grok → gemini
const frcIdx = findNode('Format Response (Closed)');
wf.nodes[frcIdx].parameters.jsCode = FORMAT_RESPONSE_CLOSED_CODE;
console.log(`4. Format Response (Closed): grok-2-stage → gemini-2-stage`);

// 5. Format Response (Error) — Grok → Gemini
const freIdx = findNode('Format Response (Error)');
wf.nodes[freIdx].parameters.jsCode = FORMAT_RESPONSE_ERROR_CODE;
console.log(`5. Format Response (Error): "Grok could not" → "Gemini could not"`);

// ─── Global: Replace any remaining old Gemini key ───
const OLD_KEY = 'AIzaSyBUkAqtH585oxKwmObMak_lyiZRwaY4BaI';
let keyUpdates = 0;
if (GEMINI_KEY && GEMINI_KEY !== OLD_KEY) {
  for (const node of wf.nodes) {
    if (!node.parameters?.jsCode) continue;
    if (node.parameters.jsCode.includes(OLD_KEY)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(new RegExp(OLD_KEY, 'g'), GEMINI_KEY);
      keyUpdates++;
    }
  }
}
if (keyUpdates) console.log(`6. Gemini API key updated in ${keyUpdates} nodes`);

// ─── Validation ───
console.log('\n── Validation ──');
let issues = 0;

// Check for xAI API references
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || '';
  if (code.includes('api.x.ai') || code.includes('xai-')) {
    console.error(`   ❌ xAI ref: "${n.name}"`);
    issues++;
  }
}

// Check for Grok model references
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || '';
  if (code.includes('grok-imagine')) {
    console.error(`   ❌ grok-imagine model: "${n.name}"`);
    issues++;
  }
}

// Check for dead grokAuth/grokCleanupBody/grokFurnitureBody
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || '';
  if (code.includes('grokAuth') || code.includes('grokCleanupBody')) {
    console.error(`   ❌ Dead Grok variable: "${n.name}"`);
    issues++;
  }
}

// Check for LoRA/Replicate
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || '';
  if (code.includes('replicate.com') || code.includes('REPLICATE')) {
    console.error(`   ❌ LoRA/Replicate ref: "${n.name}"`);
    issues++;
  }
}

// Check for old Gemini key
for (const n of wf.nodes) {
  const code = n.parameters?.jsCode || '';
  if (code.includes(OLD_KEY)) {
    console.error(`   ❌ Old Gemini key: "${n.name}"`);
    issues++;
  }
}

// Positive checks
const bfp = wf.nodes[bfpIdx];
console.log(`   ✓ Build Fixed Prompts: no grokAuth = ${!bfp.parameters.jsCode.includes('grokAuth')}`);
console.log(`   ✓ Build Fixed Prompts: no furniturePrompt build = ${!bfp.parameters.jsCode.includes('fixedFurniturePrompt')}`);
console.log(`   ✓ Format Response: gemini-4-stage = ${wf.nodes[frIdx].parameters.jsCode.includes('gemini-4-stage')}`);
console.log(`   Issues: ${issues === 0 ? 'NONE ✓' : issues}`);

// ─── Dry run or Deploy ───
if (dryRun) {
  const outPath = resolve(tmpDir, 'optimize-preview.json');
  writeFileSync(outPath, JSON.stringify(wf, null, 2));
  console.log(`\nDry run saved: ${outPath}`);
  console.log('Deploy with: node scripts/deploy-optimize-pipeline.mjs');
  process.exit(0);
}

// ─── Deploy ───
console.log('\n── Deploying ──');

console.log('A. Deactivating...');
await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: false }),
});

console.log('B. Updating...');
const putRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ nodes: wf.nodes, connections: wf.connections, settings: wf.settings, name: wf.name }),
});
if (!putRes.ok) {
  const errText = await putRes.text();
  console.error(`DEPLOY FAILED: ${putRes.status} - ${errText.substring(0, 300)}`);
  process.exit(1);
}
console.log(`   Update: ${putRes.status} OK`);

console.log('C. Activating...');
await n8nFetch(`${BASE}/workflows/${WF_ID}`, {
  method: 'PATCH',
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});

// ─── Verify ───
console.log('D. Verifying...');
const vRes = await n8nFetch(`${BASE}/workflows/${WF_ID}`, { headers: { 'X-N8N-API-KEY': N8N_KEY } });
const v = await vRes.json();
const vBfp = v.nodes.find(n => n.name === 'Build Fixed Prompts');
const vFr = v.nodes.find(n => n.name === 'Format Response');

console.log(`   Active: ${v.active}`);
console.log(`   Build Fixed Prompts: ${vBfp?.parameters?.jsCode?.length} chars (no grokAuth: ${!vBfp?.parameters?.jsCode?.includes('grokAuth')})`);
console.log(`   Format Response: gemini-4-stage = ${vFr?.parameters?.jsCode?.includes('gemini-4-stage')}`);

console.log(`\n${'═'.repeat(60)}`);
console.log('OPTIMIZATION COMPLETE');
console.log(`${'═'.repeat(60)}`);
console.log('Removed:');
console.log('  - Dead grokCleanupBody + grokAuth (xAI API key exposure)');
console.log('  - Dead fixedFurniturePrompt (~10KB unused computation)');
console.log('  - All "Grok" string references in Format Response nodes');
console.log('Rollback: restore from tmp/pre-optimize-backup.json');
