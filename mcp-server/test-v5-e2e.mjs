#!/usr/bin/env node
/**
 * v5 Wall Analysis E2E Test
 * Pipeline: Webhook → Parse → RAG → Wall Vision → Build Prompts → Closed → Open → Response
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';
const imgPath = process.argv[2] || resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');

console.log('=== E2E Test: v5 Wall Analysis ===\n');

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
      triggers: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
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
  console.log(`Message: ${data.message || 'N/A'}`);

  // Wall analysis data
  if (data.wall_analysis) {
    const wa = data.wall_analysis;
    console.log(`\nWall Analysis:`);
    console.log(`  Dimensions: ${wa.wall_width_mm || '?'}mm x ${wa.wall_height_mm || '?'}mm`);
    console.log(`  Tile: ${wa.tile_type || '?'} (${wa.tile_size_mm?.width || '?'}x${wa.tile_size_mm?.height || '?'}mm)`);
    console.log(`  Confidence: ${wa.confidence || '?'}`);
  }

  // RAG
  if (data.rag_rules_count !== undefined) {
    console.log(`  RAG rules: ${data.rag_rules_count}`);
  }

  // Images (v5: closed + open, no background)
  const closed = data.generated_image?.closed?.base64;
  const open = data.generated_image?.open?.base64;

  console.log(`\nImages:`);
  console.log(`  Closed: ${closed ? (closed.length / 1024).toFixed(0) + 'KB' : 'MISSING'}`);
  console.log(`  Open:   ${open ? (open.length / 1024).toFixed(0) + 'KB' : 'MISSING'}`);

  // Save images
  const outDir = resolve(__dirname, '../tmp/e2e-v5');
  mkdirSync(outDir, { recursive: true });

  if (closed) {
    writeFileSync(resolve(outDir, 'closed.png'), Buffer.from(closed, 'base64'));
    console.log(`\nSaved: ${outDir}/closed.png`);
  }
  if (open) {
    writeFileSync(resolve(outDir, 'open.png'), Buffer.from(open, 'base64'));
    console.log(`Saved: ${outDir}/open.png`);
  }

  // Save full response metadata (without images)
  const meta = { ...data };
  if (meta.generated_image?.closed) meta.generated_image.closed.base64 = '[truncated]';
  if (meta.generated_image?.open) meta.generated_image.open.base64 = '[truncated]';
  writeFileSync(resolve(outDir, 'response-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Saved: ${outDir}/response-meta.json`);

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Total time: ${elapsed}s`);
  console.log(`Pipeline: Webhook → Parse → RAG → Wall Vision → Build Prompts → Closed → Open`);
  console.log(`Images: ${closed && open ? '2/2 ✓' : closed ? '1/2 (closed only)' : '0/2 ✗'}`);

} catch (err) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`Error (${elapsed}s):`, err.message);
  process.exit(1);
}
