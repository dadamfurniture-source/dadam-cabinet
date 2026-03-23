#!/usr/bin/env node
// v5.5 Multi-image test — verify wall preservation across different wall types
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const N8N_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';

const TESTS = [
  {
    name: 'test2-brick-wallpaper',
    path: resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260206_063154049.jpg'),
    desc: 'White brick wallpaper + white tiles + floral wallpaper + pendant light',
    wallCheck: 'Brick wallpaper pattern and floral wallpaper should be preserved',
  },
  {
    name: 'test3-olive-paint',
    path: resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260206_063214962.jpg'),
    desc: 'White tiles + beige/olive paint + ceiling panel',
    wallCheck: 'White tiles and beige/olive paint colors should be preserved',
  },
];

async function runTest(test) {
  const outDir = resolve(__dirname, `../tmp/${test.name}`);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${test.name}`);
  console.log(`DESC: ${test.desc}`);
  console.log(`CHECK: ${test.wallCheck}`);
  console.log('='.repeat(60));

  const imgBuffer = readFileSync(test.path);
  const base64 = imgBuffer.toString('base64');
  console.log(`Image: ${(base64.length / 1024).toFixed(0)}KB base64`);

  const payload = {
    room_image: base64,
    image_type: 'image/jpeg',
    category: 'sink',
    design_style: 'modern-minimal',
  };

  console.log('Calling n8n workflow...');
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 200000);

  try {
    const res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const raw = await res.text();
    let data = JSON.parse(raw);
    if (Array.isArray(data)) data = data[0];

    console.log(`Response: ${res.status} (${elapsed}s) — ${data.success ? 'SUCCESS' : 'FAILED: ' + data.message}`);

    if (!data.success) return { name: test.name, success: false, elapsed };

    // Wall structure
    const ws = data.pipe_analysis?.wall_structure;
    if (ws && ws.length > 0) {
      console.log('Wall structure (S1):');
      ws.forEach(z => console.log(`  ${z.zone}: ${z.desc} (y: ${z.y_start}~${z.y_end})`));
    }

    // Save images
    const gi = data.generated_image || {};
    for (const [key, filename] of [['background', 'background.png'], ['closed', 'closed.png'], ['open', 'open.png']]) {
      if (gi[key]?.base64) {
        const buf = Buffer.from(gi[key].base64, 'base64');
        writeFileSync(resolve(outDir, filename), buf);
        console.log(`Saved: ${filename} (${(buf.length / 1024).toFixed(0)}KB)`);
      }
    }

    // QA
    if (data.qa_validation) {
      console.log(`QA Score: ${data.qa_validation.score} (${data.qa_validation.pass ? 'PASS' : 'FAIL'})`);
    }

    console.log(`Images saved to: ${outDir}`);
    return { name: test.name, success: true, elapsed, wallStructure: ws };

  } catch (err) {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`ERROR (${elapsed}s): ${err.message}`);
    return { name: test.name, success: false, elapsed };
  }
}

async function main() {
  console.log('=== v5.5 Multi-Image Wall Preservation Test ===\n');

  const results = [];
  for (const test of TESTS) {
    results.push(await runTest(test));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));
  results.forEach(r => {
    console.log(`  ${r.success ? 'PASS' : 'FAIL'}: ${r.name} (${r.elapsed}s)`);
  });
  console.log(`\nTotal: ${results.filter(r => r.success).length}/${results.length} passed`);
}

main();
