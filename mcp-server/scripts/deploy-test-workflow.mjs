#!/usr/bin/env node
/**
 * 테스트 워크플로우 배포
 * 프로덕션(KUuawjm7m3nS0qHH)을 복제하여 kitchen_layout 반영된 테스트 버전 생성
 *
 * Usage:
 *   node scripts/deploy-test-workflow.mjs --dry-run   # 미리보기
 *   node scripts/deploy-test-workflow.mjs             # 배포
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 파싱 (Windows CR 대응)
const envFiles = [resolve(__dirname, '../.env'), resolve(__dirname, '../../n8n/.env')];
for (const envPath of envFiles) {
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const l of content.split('\n')) {
      const t = l.replace(/\r$/, '').trim();
      if (t.length === 0 || t.startsWith('#')) continue;
      const e = t.indexOf('=');
      if (e > 0) { const k = t.substring(0, e).trim(); if (process.env[k] === undefined) process.env[k] = t.substring(e+1).trim(); }
    }
  } catch {}
}

const DRY_RUN = process.argv.includes('--dry-run');
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const PROD_ID = 'KUuawjm7m3nS0qHH';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!N8N_API_KEY || !GEMINI_KEY) {
  console.error('ERROR: N8N_API_KEY or GEMINI_API_KEY missing');
  process.exit(1);
}

function loadNodeCode(filename) {
  let code = readFileSync(resolve(__dirname, 'v10-nodes', filename), 'utf-8');
  code = code.replace(/%%GEMINI_API_KEY%%/g, GEMINI_KEY);
  return code;
}

async function n8nApi(method, path, body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const opts = {
        method,
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`${N8N_BASE}${path}`, opts);
      return { status: res.status, data: await res.json() };
    } catch (e) {
      console.log(`  API retry (${attempt}/5): ${e.message}`);
      if (attempt === 5) throw e;
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║  테스트 워크플로우 배포 (kitchen_layout)        ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`프로덕션 ID: ${PROD_ID}`);
console.log(`Dry run: ${DRY_RUN}\n`);

// Step 1: 프로덕션 워크플로우 가져오기
console.log('── Step 1: 프로덕션 워크플로우 가져오기 ──');
const { status, data: prodWf } = await n8nApi('GET', `/workflows/${PROD_ID}`);
if (status !== 200) {
  console.error('프로덕션 워크플로우 조회 실패:', status);
  process.exit(1);
}
console.log(`  ✓ "${prodWf.name}" (${prodWf.nodes?.length || 0} 노드)`);

// Step 2: 노드 코드 업데이트
console.log('\n── Step 2: 노드 코드 업데이트 (kitchen_layout 추가) ──');

function findNode(name) {
  return prodWf.nodes?.find(n => n.name === name);
}

// 2-1: Parse Input에 kitchen_layout 추가
const parseInputNode = findNode('Parse Input');
if (parseInputNode) {
  const updatedParseInput = `const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

return {
  category, style, roomImage, imageType,
  prompt: body.prompt || '',
  negative_prompt: body.negative_prompt || '',
  cabinet_specs: body.cabinet_specs || {},
  layout_data: body.layout_data || null,
  modules: body.modules || null,
  material_descriptions: body.material_descriptions || [],
  kitchen_layout: body.kitchen_layout || 'i_type',
  styleMoodPrompt: body.style_mood_prompt || '',
  styleDoorColor: body.style_door_color || '',
  styleDoorHex: body.style_door_hex || '',
  styleDoorFinish: body.style_door_finish || '',
  styleCountertopPrompt: body.style_countertop_prompt || '',
  styleHandlePrompt: body.style_handle_prompt || '',
  styleAccentPrompt: body.style_accent_prompt || ''
};`;
  parseInputNode.parameters.jsCode = updatedParseInput;
  console.log('  ✓ Parse Input: kitchen_layout 추가');
}

// 2-2: Wall Analysis에 kitchen_layout passthrough
const wallAnalysisNode = findNode('Wall Analysis');
if (wallAnalysisNode) {
  const code = wallAnalysisNode.parameters.jsCode || '';
  if (!code.includes('kitchen_layout')) {
    // return 구문에 kitchen_layout 추가
    const updated = code.replace(
      /styleAccentPrompt:\s*input\.styleAccentPrompt,\n\s*geminiAnalysisBody/,
      'styleAccentPrompt: input.styleAccentPrompt,\n  kitchen_layout: input.kitchen_layout,\n  geminiAnalysisBody'
    );
    if (updated !== code) {
      wallAnalysisNode.parameters.jsCode = updated;
      console.log('  ✓ Wall Analysis: kitchen_layout passthrough 추가');
    } else {
      console.log('  ⚠ Wall Analysis: 패턴 매칭 실패, 수동 확인 필요');
    }
  } else {
    console.log('  ✓ Wall Analysis: 이미 kitchen_layout 포함');
  }
}

// 2-3: Parse Wall Data에 kitchen_layout passthrough
const parseWallNode = findNode('Parse Wall Data');
if (parseWallNode) {
  const code = parseWallNode.parameters.jsCode || '';
  if (!code.includes('kitchen_layout')) {
    const updated = code.replace(
      /styleAccentPrompt:\s*input\.styleAccentPrompt,\n\s*wallData/,
      'styleAccentPrompt: input.styleAccentPrompt,\n  kitchen_layout: input.kitchen_layout,\n  wallData'
    );
    if (updated !== code) {
      parseWallNode.parameters.jsCode = updated;
      console.log('  ✓ Parse Wall Data: kitchen_layout passthrough 추가');
    } else {
      // 다른 패턴 시도
      const updated2 = code.replace(
        /analysisSuccess:.*$/m,
        'analysisSuccess: wallData.confidence !== "low",\n  kitchen_layout: input.kitchen_layout'
      );
      if (updated2 !== code) {
        parseWallNode.parameters.jsCode = updated2;
        console.log('  ✓ Parse Wall Data: kitchen_layout passthrough 추가 (패턴2)');
      } else {
        console.log('  ⚠ Parse Wall Data: 패턴 매칭 실패');
      }
    }
  } else {
    console.log('  ✓ Parse Wall Data: 이미 kitchen_layout 포함');
  }
}

// 2-4: Build All Prompts 업데이트 (layoutDesc 포함)
const buildPromptsNode = findNode('Build All Prompts');
if (buildPromptsNode) {
  buildPromptsNode.parameters.jsCode = loadNodeCode('build-all-prompts.js');
  console.log(`  ✓ Build All Prompts: ${buildPromptsNode.parameters.jsCode.length} chars (layoutDesc 포함)`);
}

// Step 3: 테스트 워크플로우로 복제 (새 이름으로)
console.log('\n── Step 3: 테스트 워크플로우 생성 ──');

// 기존 테스트 워크플로우 확인
const { data: allWfs } = await n8nApi('GET', '/workflows?limit=100');
const existingTest = allWfs.data?.find(w => w.name === '[TEST] Dadam Kitchen Layout');

if (existingTest) {
  console.log(`  기존 테스트 워크플로우 발견: ${existingTest.id}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] 업데이트하지 않음');
  } else {
    // 기존 테스트 워크플로우 업데이트
    const updateBody = {
      name: '[TEST] Dadam Kitchen Layout',
      nodes: prodWf.nodes,
      connections: prodWf.connections,
      settings: prodWf.settings,
    };
    const { status: uStatus } = await n8nApi('PUT', `/workflows/${existingTest.id}`, updateBody);
    console.log(`  업데이트: ${uStatus === 200 ? '✓' : '✗ ' + uStatus}`);

    // 활성화
    await n8nApi('POST', `/workflows/${existingTest.id}/activate`);
    console.log(`  활성화 완료`);
    console.log(`\n  테스트 워크플로우 ID: ${existingTest.id}`);
  }
} else {
  // 새 워크플로우 생성
  const testWf = {
    name: '[TEST] Dadam Kitchen Layout',
    nodes: prodWf.nodes.map(n => {
      // Webhook 경로 변경 (프로덕션과 구분)
      if (n.type === 'n8n-nodes-base.webhook') {
        return { ...n, parameters: { ...n.parameters, path: 'test-kitchen-layout' } };
      }
      return n;
    }),
    connections: prodWf.connections,
    settings: prodWf.settings,
  };

  if (DRY_RUN) {
    console.log('  [DRY RUN] 워크플로우 생성하지 않음');
    console.log(`  노드: ${testWf.nodes.length}개`);
    console.log(`  Webhook: /webhook/test-kitchen-layout`);
  } else {
    const { status: cStatus, data: created } = await n8nApi('POST', '/workflows', testWf);
    if (cStatus === 200 || cStatus === 201) {
      console.log(`  ✓ 생성 완료: ${created.id}`);

      // 활성화
      await n8nApi('PATCH', `/workflows/${created.id}`, { active: true });
      console.log(`  ✓ 활성화 완료`);
      console.log(`\n  테스트 Webhook: https://dadam.app.n8n.cloud/webhook/test-kitchen-layout`);
      console.log(`  워크플로우 ID: ${created.id}`);
    } else {
      console.error('  생성 실패:', cStatus);
    }
  }
}

console.log(`\n${'═'.repeat(50)}`);
console.log('완료! 테스트 방법:');
console.log('  curl -X POST https://dadam.app.n8n.cloud/webhook/test-kitchen-layout \\');
console.log('    -H "Content-Type: application/json" \\');
console.log('    -d \'{"room_image":"<base64>","category":"sink","kitchen_layout":"i_type","design_style":"modern"}\'');
