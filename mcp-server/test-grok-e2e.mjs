#!/usr/bin/env node
/**
 * Grok 워크플로우 E2E 테스트
 * Usage: node mcp-server/test-grok-e2e.mjs [이미지경로]
 *
 * 기본 이미지: screenshot/testimage/KakaoTalk_20260216_123628816.jpg
 * 타임아웃: 3분 (Grok 이미지 생성 3단계)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GROK_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-grok';
const GEMINI_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';

// 이미지 경로 (인자 또는 기본값)
const imgPath = process.argv[2]
  || resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');

console.log('=== Grok Workflow E2E Test ===\n');

// 이미지 로드
let imgBuffer;
try {
  imgBuffer = readFileSync(imgPath);
} catch (e) {
  console.error(`이미지 파일 없음: ${imgPath}`);
  process.exit(1);
}

const base64 = imgBuffer.toString('base64');
console.log(`이미지: ${imgPath}`);
console.log(`크기: ${(imgBuffer.length / 1024).toFixed(0)}KB (base64: ${(base64.length / 1024).toFixed(0)}KB)\n`);

const payload = {
  room_image: base64,
  image_type: 'image/jpeg',
  category: 'sink',
  design_style: 'modern-minimal',
  manual_positions: null,
};

async function callWorkflow(name, url) {
  console.log(`--- ${name} ---`);
  console.log(`URL: ${url}`);
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`응답: ${res.status} (${elapsed}s)`);

    if (!res.ok) {
      const err = await res.text();
      console.error(`ERROR: ${err.substring(0, 500)}`);
      return null;
    }

    const raw = await res.text();
    console.log(`응답 크기: ${(raw.length / 1024).toFixed(0)}KB`);

    let data = JSON.parse(raw);
    if (Array.isArray(data)) data = data[0];

    // 에러 응답
    if (data.success === false) {
      console.log(`결과: FAIL - ${data.message}`);
      console.log(`  error_detail: ${data.error_detail || 'N/A'}`);
      return { name, success: false, elapsed, data };
    }

    // 성공 응답
    const bg = data.generated_image?.background?.base64;
    const closed = data.generated_image?.closed?.base64;
    const open = data.generated_image?.open?.base64;
    const qa = data.qa_validation;

    console.log(`결과: ${data.success ? 'SUCCESS' : 'PARTIAL'}`);
    console.log(`  processing: ${data.processing}`);
    console.log(`  background: ${bg ? (bg.length / 1024).toFixed(0) + 'KB' : 'N/A'}`);
    console.log(`  closed:     ${closed ? (closed.length / 1024).toFixed(0) + 'KB' : 'N/A'}`);
    console.log(`  open:       ${open ? (open.length / 1024).toFixed(0) + 'KB' : 'N/A'}`);
    if (qa) console.log(`  QA score:   ${qa.score} (${qa.pass ? 'PASS' : 'FAIL'})`);

    return { name, success: true, elapsed, bg, closed, open, qa, data };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`ERROR (${elapsed}s): ${err.message}`);
    return null;
  }
}

async function main() {
  const mode = process.argv[3] || 'grok'; // 'grok', 'gemini', 'both'

  let grokResult = null;
  let geminiResult = null;

  if (mode === 'grok' || mode === 'both') {
    grokResult = await callWorkflow('Grok', GROK_URL);
    console.log('');
  }

  if (mode === 'gemini' || mode === 'both') {
    geminiResult = await callWorkflow('Gemini', GEMINI_URL);
    console.log('');
  }

  // 이미지 저장 (결과 확인용)
  const outDir = resolve(__dirname, '../tmp/grok-test');
  mkdirSync(outDir, { recursive: true });

  for (const [label, result] of [['grok', grokResult], ['gemini', geminiResult]]) {
    if (!result || !result.success) continue;
    for (const [stage, b64] of [['bg', result.bg], ['closed', result.closed], ['open', result.open]]) {
      if (b64) {
        const outFile = resolve(outDir, `${label}-${stage}.png`);
        writeFileSync(outFile, Buffer.from(b64, 'base64'));
        console.log(`Saved: ${outFile}`);
      }
    }
  }

  // 비교 요약
  if (mode === 'both' && grokResult && geminiResult) {
    console.log('\n=== 비교 ===');
    console.log(`Grok:   ${grokResult.elapsed}s, closed=${grokResult.closed ? 'OK' : 'FAIL'}`);
    console.log(`Gemini: ${geminiResult.elapsed}s, closed=${geminiResult.closed ? 'OK' : 'FAIL'}`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
