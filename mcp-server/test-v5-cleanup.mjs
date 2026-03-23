#!/usr/bin/env node
// v5 Cleanup Prompt Test — Wall Preservation Verification
// Calls n8n workflow, saves images, logs S1 wall structure + cleanup prompt details
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const N8N_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';
const OUT_DIR = resolve(__dirname, '../tmp/latest-gen');
mkdirSync(OUT_DIR, { recursive: true });

const IMG_PATH = resolve(__dirname, '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg');

async function main() {
  console.log('=== v5 Cleanup Prompt Test ===');
  console.log('Goal: Verify wall tiles are preserved (not repainted)');
  console.log('');

  // Load test image
  const imgBuffer = readFileSync(IMG_PATH);
  const base64 = imgBuffer.toString('base64');
  console.log(`Image: ${IMG_PATH}`);
  console.log(`Size: ${(base64.length / 1024).toFixed(0)}KB base64`);

  const payload = {
    room_image: base64,
    image_type: 'image/jpeg',
    category: 'sink',
    design_style: 'modern-minimal',
  };

  console.log('\nCalling n8n workflow... (60-120s expected)');
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
    console.log(`\nResponse: ${res.status} (${elapsed}s)`);

    if (!res.ok) {
      console.error('FAILED:', await res.text());
      process.exit(1);
    }

    const raw = await res.text();
    console.log(`Response size: ${(raw.length / 1024).toFixed(0)}KB`);
    if (raw.length < 2000) {
      console.log('Raw response:', raw);
    } else {
      console.log('Raw response (first 500 chars):', raw.substring(0, 500));
    }

    let data = JSON.parse(raw);
    if (Array.isArray(data)) data = data[0];
    console.log('Top-level keys:', Object.keys(data));

    // === Key verification: pipe_analysis ===
    console.log('\n=== ANALYSIS RESULTS ===');
    const pa = data.pipe_analysis || {};
    console.log('Method:', pa.method);
    console.log('Confidence:', pa.confidence);
    console.log('Wall:', pa.wall_width_mm, 'x', pa.wall_height_mm, 'mm');
    console.log('Water supply:', pa.water_supply_percent, '%');
    console.log('Exhaust duct:', pa.exhaust_duct_percent, '%');
    console.log('Rendering mode:', pa.rendering_mode);

    // Wall structure from S1
    const wallStructure = pa.wall_structure;
    console.log('\n=== WALL STRUCTURE (S1) ===');
    if (wallStructure && wallStructure.length > 0) {
      wallStructure.forEach((zone, i) => {
        console.log(`  Zone ${i + 1}: ${zone.zone} — ${zone.desc} (y: ${zone.y_start}~${zone.y_end})`);
      });
    } else {
      console.log('  (no wall structure data)');
    }

    // QA validation
    if (data.qa_validation) {
      console.log('\n=== QA VALIDATION ===');
      console.log('Score:', data.qa_validation.score);
      console.log('Pass:', data.qa_validation.pass);
      if (data.qa_validation.issues) {
        data.qa_validation.issues.forEach(issue => {
          console.log(`  [${issue.severity}] ${issue.check}: ${issue.detail}`);
        });
      }
    }

    // Save images
    console.log('\n=== SAVING IMAGES ===');
    const gi = data.generated_image || {};

    if (gi.background?.base64) {
      const buf = Buffer.from(gi.background.base64, 'base64');
      writeFileSync(resolve(OUT_DIR, 'background.png'), buf);
      console.log(`  background.png: ${(buf.length / 1024).toFixed(0)}KB`);
    } else {
      console.log('  background: MISSING');
    }

    if (gi.closed?.base64) {
      const buf = Buffer.from(gi.closed.base64, 'base64');
      writeFileSync(resolve(OUT_DIR, 'closed.png'), buf);
      console.log(`  closed.png: ${(buf.length / 1024).toFixed(0)}KB`);
    } else {
      console.log('  closed: MISSING');
    }

    if (gi.open?.base64) {
      const buf = Buffer.from(gi.open.base64, 'base64');
      writeFileSync(resolve(OUT_DIR, 'open.png'), buf);
      console.log(`  open.png: ${(buf.length / 1024).toFixed(0)}KB`);
    } else {
      console.log('  open: MISSING');
    }

    // Summary
    console.log('\n=== VERIFICATION CHECKLIST ===');
    const checks = [
      ['S1 wall structure detected', !!(wallStructure && wallStructure.length > 0)],
      ['Background image generated', !!gi.background?.base64],
      ['Closed image generated', !!gi.closed?.base64],
      ['Open image generated', !!gi.open?.base64],
      ['Gemini finishReason OK', data.success !== false],
    ];

    let allPass = true;
    checks.forEach(([label, ok]) => {
      console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}`);
      if (!ok) allPass = false;
    });

    console.log('\n' + (allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'));
    console.log(`\nImages saved to: ${OUT_DIR}`);
    console.log('Compare background.png with v4-before/background.png to verify wall preservation');
    console.log(`Total time: ${elapsed}s`);

  } catch (err) {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\nERROR (${elapsed}s):`, err.message);
    process.exit(1);
  }
}

main();
