#!/usr/bin/env node
// n8n 워크플로우 단계별 재현 테스트
// 792KB 이미지에서 어느 단계가 실패하는지 확인
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const imgBuffer = readFileSync('../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');
const base64 = imgBuffer.toString('base64');

console.log(`Image: ${(imgBuffer.length/1024).toFixed(0)}KB (2133x1600)\n`);

// ─── STEP 1: Claude 배관 분석 ───
console.log('=== STEP 1: Claude Pipe Analysis ===');
const t1 = Date.now();

const claudeBody = {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2048,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
      { type: 'text', text: '이 주방 사진에서 급수 배관과 배기 덕트 위치를 JSON으로 답하세요. {"water_supply_percent": 숫자, "exhaust_duct_percent": 숫자}' }
    ]
  }]
};

const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'anthropic-version': '2023-06-01',
    'x-api-key': CLAUDE_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify(claudeBody),
});

const claudeData = await claudeRes.json();
console.log(`  Status: ${claudeRes.status} (${((Date.now()-t1)/1000).toFixed(1)}s)`);
if (claudeRes.ok) {
  const text = claudeData.content?.[0]?.text || '';
  console.log(`  Response: ${text.substring(0, 300)}`);
  console.log('  PASS\n');
} else {
  console.log(`  ERROR:`, JSON.stringify(claudeData.error || claudeData));
  console.log('  FAIL - Claude 단계에서 실패\n');
  process.exit(1);
}

// ─── STEP 2: Gemini Background Cleanup ───
console.log('=== STEP 2: Gemini Background Cleanup ===');
const t2 = Date.now();

const cleanupBody = {
  contents: [{ parts: [
    { text: 'Clean this construction site image. Remove debris, tools, and wires. Keep wall structure, floor, ceiling positions. Output a clean empty room ready for furniture.' },
    { inline_data: { mime_type: 'image/jpeg', data: base64 } }
  ]}],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 }
};

const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_KEY}`;

try {
  const gemRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleanupBody),
  });

  const gemData = await gemRes.json();
  console.log(`  Status: ${gemRes.status} (${((Date.now()-t2)/1000).toFixed(1)}s)`);

  if (gemRes.ok) {
    const parts = gemData.candidates?.[0]?.content?.parts || [];
    const hasImage = parts.some(p => p.inlineData || p.inline_data);
    const imgData = parts.find(p => p.inlineData || p.inline_data);
    const imgSize = imgData ? (imgData.inlineData || imgData.inline_data).data?.length || 0 : 0;
    console.log(`  hasImage: ${hasImage}, imageSize: ${(imgSize/1024).toFixed(0)}KB`);

    if (hasImage) {
      console.log('  PASS\n');

      // ─── STEP 3: Gemini Furniture Placement ───
      console.log('=== STEP 3: Gemini Furniture Placement ===');
      const t3 = Date.now();
      const bgBase64 = (imgData.inlineData || imgData.inline_data).data;

      const furnitureBody = {
        contents: [{ parts: [
          { text: 'Add modern minimal kitchen furniture to this clean room. Place sink at 30% from left, cooktop at 70%. Add upper and lower cabinets. No exposed ductwork.' },
          { inline_data: { mime_type: 'image/png', data: bgBase64 } }
        ]}],
        generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 }
      };

      const furRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(furnitureBody),
      });

      const furData = await furRes.json();
      console.log(`  Status: ${furRes.status} (${((Date.now()-t3)/1000).toFixed(1)}s)`);

      if (furRes.ok) {
        const furParts = furData.candidates?.[0]?.content?.parts || [];
        const hasFurImg = furParts.some(p => p.inlineData || p.inline_data);
        console.log(`  hasImage: ${hasFurImg}`);

        if (hasFurImg) {
          console.log('  PASS\n');

          // ─── STEP 4: Gemini Open Door ───
          console.log('=== STEP 4: Gemini Open Door ===');
          const t4 = Date.now();
          const closedImg = furParts.find(p => p.inlineData || p.inline_data);
          const closedBase64 = (closedImg.inlineData || closedImg.inline_data).data;

          const openBody = {
            contents: [{ parts: [
              { text: 'Open all cabinet doors and drawers in this kitchen image. Show the interior shelves.' },
              { inline_data: { mime_type: 'image/png', data: closedBase64 } }
            ]}],
            generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 }
          };

          const openRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(openBody),
          });

          const openData = await openRes.json();
          console.log(`  Status: ${openRes.status} (${((Date.now()-t4)/1000).toFixed(1)}s)`);

          if (openRes.ok) {
            const openParts = openData.candidates?.[0]?.content?.parts || [];
            const hasOpenImg = openParts.some(p => p.inlineData || p.inline_data);
            console.log(`  hasImage: ${hasOpenImg}`);
            console.log(hasOpenImg ? '  PASS' : '  FAIL - no open door image');
          } else {
            console.log(`  ERROR:`, JSON.stringify(openData.error || openData).substring(0, 300));
            console.log('  FAIL');
          }
        } else {
          console.log(`  finishReason:`, furData.candidates?.[0]?.finishReason);
          console.log('  FAIL - no furniture image');
        }
      } else {
        console.log(`  ERROR:`, JSON.stringify(furData.error || furData).substring(0, 300));
        console.log('  FAIL');
      }
    } else {
      console.log(`  finishReason:`, gemData.candidates?.[0]?.finishReason);
      const textPart = parts.find(p => p.text);
      if (textPart) console.log(`  text:`, textPart.text.substring(0, 200));
      console.log('  FAIL - no cleaned background image');
    }
  } else {
    console.log(`  ERROR:`, JSON.stringify(gemData.error || gemData).substring(0, 300));
    console.log('  FAIL');
  }
} catch (e) {
  console.log(`  FETCH ERROR: ${e.message}`);
  console.log('  FAIL');
}

const totalTime = ((Date.now() - t1) / 1000).toFixed(1);
console.log(`\nTotal: ${totalTime}s`);
