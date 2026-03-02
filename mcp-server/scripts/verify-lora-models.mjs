#!/usr/bin/env node
/**
 * LoRA 모델 검증 스크립트
 * 각 카테고리별 샘플 이미지 생성하여 품질 확인
 *
 * 사용법: node scripts/verify-lora-models.mjs
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const REPLICATE_KEY = process.env.REPLICATE_API_KEY;

const OUTPUT_DIR = resolve(__dirname, '../tmp/lora-verification');
mkdirSync(OUTPUT_DIR, { recursive: true });

// 카테고리별 테스트 프롬프트
const TEST_PROMPTS = {
  wardrobe: [
    `DADAM_WARDROBE modern Korean built-in wardrobe, white matte finish, sliding doors, LED indirect lighting, minimalist interior design, high quality photo, 4k`,
    `DADAM_WARDROBE luxury Korean bedroom closet, wood grain texture, full-length mirror door, organized interior shelving, warm lighting, professional interior photo`,
  ],
  shoe_cabinet: [
    `DADAM_SHOE_CABINET modern Korean built-in shoe cabinet, white finish, entrance hallway, slim design, ventilation slots, clean minimalist style, high quality photo, 4k`,
    `DADAM_SHOE_CABINET luxury entryway shoe storage, matte gray finish, LED accent lighting, full-height design, professional interior photo`,
  ],
  vanity: [
    `DADAM_VANITY modern Korean bathroom vanity, white ceramic basin, wall-mounted cabinet, LED mirror lighting, clean minimalist design, high quality photo, 4k`,
    `DADAM_VANITY luxury Korean vanity unit, marble top, undermount sink, soft-close drawers, warm indirect lighting, professional interior photo`,
  ],
  fridge_cabinet: [
    `DADAM_FRIDGE_CABINET modern Korean built-in refrigerator cabinet, white panel finish, integrated design, seamless kitchen look, high quality photo, 4k`,
    `DADAM_FRIDGE_CABINET luxury kitchen fridge enclosure, wood grain panel, built-in microwave niche, organized storage, professional interior photo`,
  ],
  l_shaped_sink: [
    `DADAM_L_SHAPED_SINK modern Korean L-shaped kitchen sink cabinet, white quartz countertop, undermount sink, minimalist faucet, LED under-cabinet lighting, high quality photo, 4k`,
    `DADAM_L_SHAPED_SINK luxury Korean L-shaped kitchen, gray tone cabinets, waterfall island edge, indirect lighting, professional interior photo`,
  ],
  peninsula_sink: [
    `DADAM_PENINSULA_SINK modern Korean peninsula kitchen with sink, white cabinets, breakfast bar, pendant lighting, open concept design, high quality photo, 4k`,
    `DADAM_PENINSULA_SINK luxury peninsula kitchen, two-tone cabinets, integrated sink, bar seating area, warm lighting, professional interior photo`,
  ],
  island_kitchen: [
    `DADAM_ISLAND_KITCHEN modern Korean island kitchen, all white design, large center island, indirect LED lighting, premium appliances, high quality photo, 4k`,
    `DADAM_ISLAND_KITCHEN luxury Korean island kitchen, marble countertop, waterfall edge, pendant lights, wood accent, professional interior photo`,
  ],
  storage_cabinet: [
    `DADAM_STORAGE_CABINET modern Korean built-in storage cabinet, white finish, glass door display section, open shelving, LED accent lighting, high quality photo, 4k`,
    `DADAM_STORAGE_CABINET luxury living room storage unit, wood and white combination, media center, bookshelf section, warm lighting, professional interior photo`,
  ],
};

async function replicateApi(method, path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const opts = {
        method,
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`https://api.replicate.com/v1${path}`, opts);
      const text = await res.text();
      try { return { status: res.status, data: JSON.parse(text) }; }
      catch { return { status: res.status, data: text }; }
    } catch (e) {
      if (attempt < retries) {
        console.warn(`    Retry ${attempt}/${retries}: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000 * attempt));
      } else throw e;
    }
  }
}

// lora_models에서 모델 정보 가져오기
async function getModels() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/lora_models?select=category,model_version,trigger_word,status&status=eq.ready&order=category`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

// 이미지 생성 요청
async function generateImage(modelVersion, prompt) {
  const { status, data } = await replicateApi('POST', '/predictions', {
    version: modelVersion.split(':')[1], // "owner/name:version" → "version"
    input: {
      prompt,
      num_outputs: 1,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      output_format: 'png',
      output_quality: 90,
    },
  });

  if (status !== 201 && status !== 200) {
    throw new Error(`Prediction failed: ${status} ${JSON.stringify(data)}`);
  }
  return data;
}

// 생성 완료 대기
async function waitForPrediction(predictionId) {
  const start = Date.now();
  while (true) {
    const { data } = await replicateApi('GET', `/predictions/${predictionId}`);
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (data.status === 'succeeded') {
      return data;
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Prediction ${data.status}: ${data.error || 'unknown'}`);
    }

    process.stdout.write(`\r    Generating... (${elapsed}s)`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

// 이미지 다운로드
async function downloadImage(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(filepath, buffer);
}

// ─── Main ───
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   LoRA Model Verification                ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const models = await getModels();
  console.log(`Found ${models.length} ready models\n`);

  const results = [];

  for (const model of models) {
    const prompts = TEST_PROMPTS[model.category];
    if (!prompts) { console.warn(`  No test prompts for ${model.category}`); continue; }

    console.log(`\n── ${model.category} (${model.trigger_word}) ──`);
    console.log(`  Model: ${model.model_version}`);

    const categoryDir = resolve(OUTPUT_DIR, model.category);
    mkdirSync(categoryDir, { recursive: true });

    for (let pi = 0; pi < prompts.length; pi++) {
      const prompt = prompts[pi];
      const filename = `sample_${pi + 1}.png`;
      const filepath = resolve(categoryDir, filename);

      // Skip if already generated
      if (existsSync(filepath)) {
        console.log(`  [${pi + 1}/${prompts.length}] Already exists: ${filename}`);
        results.push({ category: model.category, prompt: pi + 1, file: filepath, status: 'cached' });
        continue;
      }

      console.log(`  [${pi + 1}/${prompts.length}] Generating...`);
      console.log(`    Prompt: ${prompt.substring(0, 80)}...`);

      try {
        const prediction = await generateImage(model.model_version, prompt);
        const result = await waitForPrediction(prediction.id);
        console.log();

        if (result.output && result.output.length > 0) {
          const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
          await downloadImage(imageUrl, filepath);
          console.log(`    Saved: ${filepath}`);
          results.push({
            category: model.category,
            prompt: pi + 1,
            file: filepath,
            status: 'success',
            predictTime: result.metrics?.predict_time,
            imageUrl,
          });
        } else {
          console.warn(`    No output generated`);
          results.push({ category: model.category, prompt: pi + 1, status: 'no_output' });
        }
      } catch (e) {
        console.error(`    Error: ${e.message}`);
        results.push({ category: model.category, prompt: pi + 1, status: 'error', error: e.message });
      }
    }
  }

  // Save results summary
  const summaryPath = resolve(OUTPUT_DIR, 'verification-results.json');
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  // Print summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VERIFICATION SUMMARY');
  console.log(`${'═'.repeat(60)}`);

  const success = results.filter(r => r.status === 'success' || r.status === 'cached').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'no_output').length;
  console.log(`Success: ${success}/${results.length}`);
  console.log(`Failed:  ${failed}/${results.length}\n`);

  for (const r of results) {
    const icon = (r.status === 'success' || r.status === 'cached') ? '✓' : '✗';
    const time = r.predictTime ? ` (${r.predictTime.toFixed(1)}s)` : '';
    console.log(`  ${icon} ${r.category} #${r.prompt}${time} ${r.status}`);
  }

  console.log(`\nResults saved to: ${summaryPath}`);
  console.log(`Images in: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
