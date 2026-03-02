#!/usr/bin/env node
/**
 * v9 Simplified + RAG E2E Test
 * Tests the full pipeline: Webhook → Parse → RAG → S1 → Fixed Prompts → Grok 3-stage → Response
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';
const imgPath = process.argv[2] || resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');

console.log('=== E2E Test: v9 Simplified + RAG ===\n');

let img;
try {
  img = readFileSync(imgPath);
} catch (e) {
  console.error('Image not found:', imgPath);
  process.exit(1);
}

const base64 = img.toString('base64');
console.log(`Image: ${imgPath}`);
console.log(`Size: ${(img.length / 1024).toFixed(0)}KB (base64: ${(base64.length / 1024).toFixed(0)}KB)`);
console.log(`URL: ${URL}`);
console.log(`Sending...\n`);

const t0 = Date.now();

try {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_image: base64,
      image_type: 'image/jpeg',
      category: 'sink',
      design_style: 'modern-minimal',
      style_mood_prompt: 'Clean minimalist Korean kitchen with white matte doors and warm wood accents',
      style_door_color: 'White',
      style_door_hex: '#FFFFFF',
      style_door_finish: 'Matte',
      style_countertop_prompt: 'Snow white engineered stone with subtle grey veining',
      style_handle_prompt: 'Hidden push-to-open mechanism',
      manual_positions: {
        water_pipe: { x: 35, y: 85 },
        exhaust_duct: { x: 72, y: 8 }
      }
    }),
    signal: AbortSignal.timeout(240000)
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Status: ${res.status} (${elapsed}s)`);

  if (!res.ok) {
    const errText = await res.text();
    console.error('ERROR:', errText.substring(0, 500));
    process.exit(1);
  }

  const raw = await res.text();
  console.log(`Response size: ${(raw.length / 1024).toFixed(0)}KB\n`);

  let data = JSON.parse(raw);
  if (Array.isArray(data)) data = data[0];

  if (data.success === false) {
    console.log('Result: FAIL');
    console.log(`  message: ${data.message}`);
    console.log(`  error_detail: ${data.error_detail || 'N/A'}`);
    process.exit(1);
  }

  console.log(`Result: ${data.success ? 'SUCCESS' : 'PARTIAL'}`);
  console.log(`Processing: ${data.processing || 'N/A'}`);

  const bg = data.generated_image?.background?.base64;
  const closed = data.generated_image?.closed?.base64;
  const open = data.generated_image?.open?.base64;

  console.log(`\nImages:`);
  console.log(`  Background: ${bg ? (bg.length / 1024).toFixed(0) + 'KB' : 'MISSING'}`);
  console.log(`  Closed:     ${closed ? (closed.length / 1024).toFixed(0) + 'KB' : 'MISSING'}`);
  console.log(`  Open:       ${open ? (open.length / 1024).toFixed(0) + 'KB' : 'MISSING'}`);

  // Save images
  const outDir = resolve(__dirname, '../tmp/e2e-v9');
  mkdirSync(outDir, { recursive: true });

  if (bg) {
    writeFileSync(resolve(outDir, 'background.png'), Buffer.from(bg, 'base64'));
    console.log(`\nSaved: ${outDir}/background.png`);
  }
  if (closed) {
    writeFileSync(resolve(outDir, 'closed.png'), Buffer.from(closed, 'base64'));
    console.log(`Saved: ${outDir}/closed.png`);
  }
  if (open) {
    writeFileSync(resolve(outDir, 'open.png'), Buffer.from(open, 'base64'));
    console.log(`Saved: ${outDir}/open.png`);
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Total time: ${elapsed}s`);
  console.log(`Pipeline: Webhook → Parse → RAG → S1 → Fixed Prompts → Grok x3 → Response`);
  console.log(`All 3 images: ${bg && closed && open ? 'YES ✓' : 'NO ✗'}`);

} catch (err) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`Error (${elapsed}s):`, err.message);
  process.exit(1);
}
