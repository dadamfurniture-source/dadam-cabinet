#!/usr/bin/env node
// Test with EXACT prompt from n8n execution vs generic prompt
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

// EXACT prompt from n8n execution 727 (failed with IMAGE_OTHER)
const EXACT_N8N_PROMPT = `Transform this construction site photo into a finished empty room.
PRESERVE: camera angle, perspective, all wall surfaces exactly as-is (white matte paint, burgundy red horizontal subway tiles with white grout, light gray or white paint).
REMOVE: construction debris, tools, materials from floor.
FLOOR: light oak vinyl. CEILING: keep existing.
Output: Photorealistic finished empty room with original walls intact.`;

// Same prompt WITHOUT wall description
const NO_WALL_DESC = `Transform this construction site photo into a finished empty room.
PRESERVE: camera angle, perspective, all wall surfaces exactly as-is, window frames.
REMOVE: construction debris, tools, materials from floor.
FLOOR: light oak vinyl. CEILING: keep existing.
Output: Photorealistic finished empty room with original walls intact.`;

// Also test with header auth (like n8n does) instead of query param
const GEMINI_URL_HEADER = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

async function testPrompt(name, prompt, useHeader = false) {
  console.log(`\n--- ${name} (${prompt.length} chars, auth: ${useHeader ? 'header' : 'query'}) ---`);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: imgBase64 } }
      ]
    }],
    generationConfig: { responseModalities: ['image', 'text'], temperature: 0.2 }
  };

  const url = useHeader ? GEMINI_URL_HEADER : GEMINI_URL;
  const headers = { 'Content-Type': 'application/json' };
  if (useHeader) headers['x-goog-api-key'] = GEMINI_KEY;

  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const c = data.candidates?.[0];
  const hasImage = c?.content?.parts?.some(p => p.inlineData || p.inline_data) || false;
  console.log(`  ${c?.finishReason || 'N/A'} | hasImage: ${hasImage} | ${elapsed}s`);
  if (data.error) console.log(`  ERROR: ${JSON.stringify(data.error)}`);
  return { name, reason: c?.finishReason, hasImage };
}

async function main() {
  console.log('=== Exact N8N Prompt Reproduction Test ===\n');

  await testPrompt('exact-n8n-query', EXACT_N8N_PROMPT, false);
  await testPrompt('exact-n8n-header', EXACT_N8N_PROMPT, true);
  await testPrompt('no-wall-desc-query', NO_WALL_DESC, false);
}

main();
