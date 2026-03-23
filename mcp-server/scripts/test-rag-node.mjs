#!/usr/bin/env node
// Test: RAG 노드가 포함된 v10 워크플로우 E2E 테스트
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';
const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const WF_ID = 'KUuawjm7m3nS0qHH';

async function main() {
  // 1. 테스트 이미지 로드
  const imgPath = resolve(__dirname, '../../screenshot/testimage/KakaoTalk_20260206_063103659.jpg');
  let imgBuffer;
  try {
    imgBuffer = readFileSync(imgPath);
  } catch {
    console.error('테스트 이미지 없음:', imgPath);
    process.exit(1);
  }
  const base64 = imgBuffer.toString('base64');
  console.log(`테스트 이미지: ${(base64.length / 1024).toFixed(0)}KB`);

  // 2. n8n 워크플로우 호출
  console.log('\nn8n 워크플로우 호출 중... (60~120초 소요)');
  const t0 = Date.now();

  const res = await fetch(N8N_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_image: base64,
      image_type: 'image/jpeg',
      category: 'sink',
      design_style: 'modern-minimal',
      style_name: '모던 미니멀',
    }),
    signal: AbortSignal.timeout(180000),
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`응답: ${res.status} (${elapsed}s)`);

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error:', errText.substring(0, 500));
    // Still check execution details
  }

  // 3. 최근 실행 확인 (RAG 노드 결과)
  console.log('\n최근 실행 확인...');
  await new Promise(r => setTimeout(r, 3000)); // Wait for execution to be saved

  const listRes = await fetch(`${BASE}/executions?workflowId=${WF_ID}&limit=1`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const list = await listRes.json();
  const execId = list.data[0].id;
  console.log(`Execution ID: ${execId} | Status: ${list.data[0].status}`);

  const exRes = await fetch(`${BASE}/executions/${execId}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const ex = await exRes.json();
  const runData = ex.data?.resultData?.runData || {};

  // RAG 노드 결과
  if (runData['Supabase RAG Search']) {
    const ragResult = runData['Supabase RAG Search'][0];
    if (ragResult.error) {
      console.log('\n❌ RAG Search ERROR:', ragResult.error.message);
    } else {
      const ragOutput = ragResult.data?.main?.[0]?.[0]?.json;
      console.log('\n✅ Supabase RAG Search 성공!');
      console.log(`  규칙 수: ${ragOutput?.ragRuleCount}`);
      console.log(`  트리거: ${JSON.stringify(ragOutput?.ragTriggers)}`);
      if (ragOutput?.ragRules) {
        console.log(`  배경 규칙: ${ragOutput.ragRules.background?.length}개`);
        console.log(`  모듈 규칙: ${ragOutput.ragRules.modules?.length}개`);
        console.log(`  도어 규칙: ${ragOutput.ragRules.doors?.length}개`);
        console.log(`  자재 규칙: ${ragOutput.ragRules.materials?.length}개`);
        // Show samples
        if (ragOutput.ragRules.modules?.length > 0) {
          console.log('\n  모듈 규칙 샘플:');
          ragOutput.ragRules.modules.slice(0, 5).forEach(r => console.log('   ', r));
        }
      }
    }
  } else {
    console.log('\n❌ RAG 노드 실행 안됨');
  }

  // Build All Prompts RAG 반영 확인
  if (runData['Build All Prompts']) {
    const buildResult = runData['Build All Prompts'][0];
    if (buildResult.error) {
      console.log('\n❌ Build All Prompts ERROR:', buildResult.error.message);
    } else {
      const output = buildResult.data?.main?.[0]?.[0]?.json;
      const prompt = output?.furniturePrompt || '';
      console.log('\n✅ Build All Prompts:');
      console.log(`  프롬프트 길이: ${prompt.length}자`);
      console.log(`  RAG 섹션 포함: ${prompt.includes('[BACKGROUND RULES]') || prompt.includes('[MODULE RULES]') || prompt.includes('[DOOR RULES]') || prompt.includes('[MATERIAL RULES]')}`);

      // Show RAG sections if present
      for (const section of ['BACKGROUND RULES', 'MODULE RULES', 'DOOR RULES', 'MATERIAL RULES']) {
        if (prompt.includes(`[${section}]`)) {
          const match = prompt.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?:\\[|★)`));
          if (match) console.log(`\n  [${section}]:\n${match[1].trim().substring(0, 300)}`);
        }
      }
    }
  }

  // Errors
  let hasError = false;
  for (const [name, results] of Object.entries(runData)) {
    if (results[0]?.error) {
      console.log(`\n❌ ${name}: ${results[0].error.message}`);
      hasError = true;
    }
  }

  if (!hasError) {
    console.log('\n✅ 전체 파이프라인 성공!');
  }
}

main().catch(e => console.error('Fatal:', e));
