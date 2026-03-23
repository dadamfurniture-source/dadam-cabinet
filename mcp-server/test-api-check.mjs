#!/usr/bin/env node
// API 개별 접근성 테스트
import { config } from 'dotenv';
config();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

console.log('=== API Key 확인 ===');
console.log('Gemini:', GEMINI_KEY ? GEMINI_KEY.substring(0, 8) + '...' : 'MISSING');
console.log('Claude:', CLAUDE_KEY ? CLAUDE_KEY.substring(0, 8) + '...' : 'MISSING');

// 1. Gemini 모델 테스트
console.log('\n=== Test 1: gemini-3-pro-image-preview ===');
const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_KEY}`;

try {
  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Say OK' }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
  });
  const data = await res.json();
  if (res.ok) {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`OK (${res.status}): "${text}"`);
  } else {
    console.log(`FAIL (${res.status}):`, JSON.stringify(data.error || data, null, 2));
  }
} catch (e) {
  console.log('ERROR:', e.message);
}

// 2. Claude API 테스트
console.log('\n=== Test 2: claude-sonnet-4-20250514 ===');
if (CLAUDE_KEY) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': CLAUDE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }],
      }),
    });
    const data = await res.json();
    if (res.ok) {
      const text = data.content?.[0]?.text || '';
      console.log(`OK (${res.status}): "${text}"`);
    } else {
      console.log(`FAIL (${res.status}):`, JSON.stringify(data.error || data, null, 2));
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
} else {
  console.log('SKIP - no key');
}

// 3. Gemini 이미지 생성 능력 테스트 (responseModalities: image)
console.log('\n=== Test 3: Gemini image generation (responseModalities: image) ===');
try {
  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Generate a simple 50x50 pixel red square image' }] }],
      generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 },
    }),
  });
  const data = await res.json();
  if (res.ok) {
    const parts = data.candidates?.[0]?.content?.parts || [];
    const hasImage = parts.some(p => p.inlineData || p.inline_data);
    const textPart = parts.find(p => p.text)?.text || '';
    console.log(`OK (${res.status}): hasImage=${hasImage}, text="${textPart.substring(0, 100)}"`);
  } else {
    console.log(`FAIL (${res.status}):`, JSON.stringify(data.error || data, null, 2));
  }
} catch (e) {
  console.log('ERROR:', e.message);
}

// 4. n8n 변수 확인 (GEMINI_API_KEY가 n8n $vars에서 오는지)
console.log('\n=== 참고: n8n 워크플로우 설정 ===');
console.log('- Gemini URL: generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview');
console.log('- Gemini Key 참조: $vars.GEMINI_API_KEY (n8n Environment Variables)');
console.log('- Claude 인증: n8n credential "Anthropic account 2"');
console.log('- Claude 모델: claude-sonnet-4-20250514');
console.log('- 타임아웃: 각 API 120초');
