#!/usr/bin/env node
// Direct Gemini API test - bypass n8n to test cleanup reliability
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

// Load test image
const imgPath = resolve(__dirname, '../../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');
const imgBuffer = readFileSync(imgPath);
const base64 = imgBuffer.toString('base64');
console.log('Image:', (imgBuffer.length / 1024).toFixed(0) + 'KB');

// Simple cleanup prompt
const SIMPLE_PROMPT = `Transform this construction site photo into a finished empty room.
PRESERVE: camera angle, perspective, viewpoint, wall structure.
REMOVE: all debris, tools, materials, people from the floor and surfaces.
FILL: walls with smooth paint, ceiling with white flat finish, floor with light oak vinyl.
Output: Photorealistic empty finished apartment room.`;

console.log('Prompt length:', SIMPLE_PROMPT.length, 'chars');
console.log('\nTesting 3 attempts with different temperatures...\n');

async function callGemini(prompt, temp, attempt) {
  const t0 = Date.now();
  console.log(`[Attempt ${attempt}] temp=${temp}...`);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: { responseModalities: ['image', 'text'], temperature: temp }
  };

  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason || 'NO_CANDIDATE';
  const parts = candidate?.content?.parts || [];
  const hasImage = parts.some(p => p.inlineData || p.inline_data);
  const textPart = parts.find(p => p.text);

  console.log(`  finishReason: ${finishReason}`);
  console.log(`  hasImage: ${hasImage}`);
  console.log(`  time: ${elapsed}s`);
  if (textPart) console.log(`  text: ${textPart.text.substring(0, 200)}`);
  if (data.promptFeedback) console.log(`  promptFeedback:`, JSON.stringify(data.promptFeedback));
  if (data.error) console.log(`  ERROR:`, JSON.stringify(data.error).substring(0, 300));

  // Save image if successful
  if (hasImage) {
    const imgPart = parts.find(p => p.inlineData || p.inline_data);
    const imgData = (imgPart.inlineData || imgPart.inline_data).data;
    const outDir = resolve(__dirname, '../../tmp/gemini-test');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `attempt-${attempt}-t${temp}.png`), Buffer.from(imgData, 'base64'));
    console.log(`  SAVED: tmp/gemini-test/attempt-${attempt}-t${temp}.png`);
  }

  return { finishReason, hasImage, elapsed };
}

async function main() {
  const results = [];

  // Test with different temperatures
  for (const [i, temp] of [[1, 0.1], [2, 0.3], [3, 0.5]]) {
    const result = await callGemini(SIMPLE_PROMPT, temp, i);
    results.push(result);
    console.log();
  }

  console.log('=== SUMMARY ===');
  results.forEach((r, i) => {
    console.log(`Attempt ${i+1}: ${r.finishReason} | image: ${r.hasImage} | ${r.elapsed}s`);
  });

  const successCount = results.filter(r => r.hasImage).length;
  console.log(`\nSuccess rate: ${successCount}/3`);
}

main().catch(console.error);
