#!/usr/bin/env node
// Direct Gemini API comparison: v4 prompt vs v5.1 prompt
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../n8n/.env') });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;

const IMG_PATH = resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');
const imgBase64 = readFileSync(IMG_PATH).toString('base64');

const PROMPTS = {
  'v4-original':
    'Transform this construction site photo into a finished empty room.\n' +
    'PRESERVE: camera angle, perspective, viewpoint, wall structure, window frames.\n' +
    'REMOVE: all construction debris, tools, materials, bags, people from floors and surfaces.\n' +
    'FILL: walls with smooth paint finish, tiles cleaned and polished, white flat ceiling with recessed LED downlights, light oak vinyl flooring.\n' +
    'Output: Photorealistic empty finished Korean apartment room ready for furniture installation.',

  'v5.1-wall-preserve':
    'Transform this construction site photo into a finished empty room.\n' +
    'PRESERVE: camera angle, perspective, all wall surfaces exactly as-is, window frames.\n' +
    'REMOVE: construction debris, tools, materials from floor.\n' +
    'FLOOR: light oak vinyl. CEILING: keep existing.\n' +
    'Output: Photorealistic finished empty room with original walls intact.',

  'v5.2-hybrid':
    'Transform this construction site photo into a finished empty room.\n' +
    'PRESERVE: camera angle, perspective, viewpoint, wall surfaces (keep all tiles and paint colors as-is), window frames.\n' +
    'REMOVE: all construction debris, tools, materials, bags, people from floors and surfaces.\n' +
    'FILL: floor with light oak vinyl flooring, ceiling clean and finished.\n' +
    'Output: Photorealistic empty finished Korean apartment room ready for furniture installation.',
};

async function testPrompt(name, prompt) {
  console.log(`\n--- Testing: ${name} ---`);
  console.log(`Prompt (${prompt.length} chars): ${prompt.substring(0, 100)}...`);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: imgBase64 } }
      ]
    }],
    generationConfig: { responseModalities: ['image', 'text'], temperature: 0.2 }
  };

  const t0 = Date.now();
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason || 'NONE';
    const parts = candidate?.content?.parts || [];
    const hasImage = parts.some(p => p.inlineData || p.inline_data);
    const textPart = parts.find(p => p.text);
    const tokens = data.usageMetadata?.promptTokenCount;

    console.log(`  Result: ${finishReason} | hasImage: ${hasImage} | tokens: ${tokens} | ${elapsed}s`);
    if (textPart) console.log(`  Text: ${textPart.text.substring(0, 200)}`);
    if (!hasImage && data.promptFeedback) console.log(`  Feedback:`, JSON.stringify(data.promptFeedback));

    return { name, finishReason, hasImage, elapsed };
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    return { name, finishReason: 'ERROR', hasImage: false };
  }
}

async function main() {
  console.log('=== Gemini Cleanup Prompt Comparison Test ===');
  console.log(`Image: ${IMG_PATH}`);

  const results = [];
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    const result = await testPrompt(name, prompt);
    results.push(result);
  }

  console.log('\n=== SUMMARY ===');
  results.forEach(r => {
    const status = r.hasImage ? 'SUCCESS' : 'FAILED';
    console.log(`  ${status}: ${r.name} (${r.finishReason}, ${r.elapsed}s)`);
  });
}

main();
