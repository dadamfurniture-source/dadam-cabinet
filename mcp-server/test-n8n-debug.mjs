#!/usr/bin/env node
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const PROD_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';

// 문제 이미지 (792KB) - 빈 응답 재현 테스트
const imgBuffer = readFileSync('../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');
const base64 = imgBuffer.toString('base64');
console.log('Image:', (imgBuffer.length / 1024).toFixed(0) + 'KB');
console.log('Calling n8n production...\n');

const t0 = Date.now();
const res = await fetch(PROD_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    room_image: base64,
    image_type: 'image/jpeg',
    category: 'sink',
    design_style: 'modern-minimal',
    style_name: '모던 미니멀',
    style_keywords: 'clean lines',
    style_atmosphere: 'serene',
    design_prompt: 'debug test',
    manual_positions: null,
    has_manual_positions: false,
  }),
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log('Status:', res.status, res.statusText);
console.log('Content-Length:', res.headers.get('content-length'));

const text = await res.text();
console.log('Body:', text.length, 'chars\n');

if (text.length === 0) {
  console.log('=== EMPTY RESPONSE ===');
  console.log('워크플로우가 Respond 노드에 도달하지 못하고 에러 발생.');
  console.log('n8n Cloud → Executions 목록에서 최근 실패 실행을 확인하세요.');
  console.log('가능한 원인:');
  console.log('  1. Gemini API 호출 실패 (키/모델/할당량)');
  console.log('  2. Claude API 호출 실패');
  console.log('  3. Code 노드 파싱 에러');
  console.log('  4. 타임아웃 (120초 초과)');
} else {
  try {
    let data = JSON.parse(text);
    if (Array.isArray(data)) data = data[0];

    // 이미지 base64 제거하고 출력
    const safe = JSON.parse(JSON.stringify(data));
    if (safe.generated_image) {
      for (const key of ['background', 'closed', 'open']) {
        if (safe.generated_image[key] && safe.generated_image[key].base64) {
          safe.generated_image[key].base64 = `[${safe.generated_image[key].base64.length} chars]`;
        }
      }
    }
    console.log(JSON.stringify(safe, null, 2));
  } catch (e) {
    console.log('Not JSON:', text.substring(0, 500));
  }
}

console.log('\nTime:', elapsed + 's');
