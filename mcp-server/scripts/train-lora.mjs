#!/usr/bin/env node
/**
 * LoRA 학습 스크립트
 *
 * 사용법:
 *   node scripts/train-lora.mjs <category> [--steps 1000] [--trigger DADAM_SINK]
 *
 * 예시:
 *   node scripts/train-lora.mjs sink
 *   node scripts/train-lora.mjs hood --steps 1500 --trigger DADAM_HOOD
 *   node scripts/train-lora.mjs door --steps 2000
 *
 * 프로세스:
 *   1. Supabase에서 해당 카테고리의 is_training=true 이미지 조회
 *   2. 이미지 다운로드 → zip 패키징
 *   3. zip을 Supabase Storage에 업로드
 *   4. Replicate LoRA 학습 요청
 *   5. 학습 완료 대기
 *   6. lora_models 테이블에 결과 저장
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { createReadStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPLICATE_KEY = process.env.REPLICATE_API_KEY;

// ─── Args ───
const category = process.argv[2];
if (!category) {
  console.error('Usage: node scripts/train-lora.mjs <category> [--steps N] [--trigger WORD]');
  console.error('Categories: sink, hood, cooktop, door, countertop, handle, faucet');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

const steps = parseInt(getArg('steps', '1000'));
const triggerWord = getArg('trigger', `DADAM_${category.toUpperCase()}`);

console.log(`=== LoRA Training: ${category} ===`);
console.log(`Trigger: ${triggerWord}`);
console.log(`Steps: ${steps}`);
console.log();

// ─── 1. Supabase에서 학습용 이미지 조회 ───
async function getTrainingImages() {
  const url = `${SUPABASE_URL}/rest/v1/furniture_images?category=eq.${category}&is_training=eq.true&select=id,image_url,storage_path,description`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── 2. 이미지 다운로드 + zip 생성 ───
async function downloadAndZip(images) {
  const tmpDir = resolve(__dirname, `../tmp/lora-${category}`);
  mkdirSync(tmpDir, { recursive: true });

  console.log(`Downloading ${images.length} images...`);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const url = img.image_url || `${SUPABASE_URL}/storage/v1/object/public/${img.storage_path}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  Skip ${i}: ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = img.storage_path?.split('.').pop() || 'jpg';
    const filename = `${String(i).padStart(3, '0')}.${ext}`;
    writeFileSync(resolve(tmpDir, filename), buffer);

    // 캡션 파일 (autocaption 보조)
    if (img.description) {
      writeFileSync(resolve(tmpDir, `${String(i).padStart(3, '0')}.txt`), img.description);
    }

    if ((i + 1) % 10 === 0) console.log(`  Downloaded ${i + 1}/${images.length}`);
  }

  // zip 생성 (tar + gzip via child_process)
  const zipPath = resolve(__dirname, `../tmp/lora-${category}.zip`);
  const { execSync } = await import('child_process');

  try {
    // Windows: PowerShell Compress-Archive 또는 7z
    execSync(`cd "${tmpDir}" && powershell Compress-Archive -Path * -DestinationPath "${zipPath}" -Force`, { stdio: 'pipe' });
  } catch {
    // Linux/Mac fallback
    execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
  }

  console.log(`Zip created: ${zipPath}`);
  return zipPath;
}

// ─── 3. Supabase Storage에 zip 업로드 ───
async function uploadZip(zipPath) {
  const storagePath = `lora-training/${category}/${Date.now()}.zip`;
  const buffer = createReadStream(zipPath);
  const chunks = [];
  for await (const chunk of buffer) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const key = SUPABASE_SERVICE_KEY || SUPABASE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/furniture-images/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/zip',
      },
      body,
    }
  );

  if (!res.ok) throw new Error(`Storage upload error: ${res.status} ${await res.text()}`);

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/furniture-images/${storagePath}`;
  console.log(`Uploaded to: ${publicUrl}`);
  return publicUrl;
}

// ─── 4. Replicate 학습 요청 ───
async function startTraining(zipUrl) {
  const res = await fetch('https://api.replicate.com/v1/trainings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: 'e440909d01a3b47efab37a893702ed90c708d8e2ede3465f1e8aac1c9e2efff5',
      input: {
        input_images: zipUrl,
        trigger_word: triggerWord,
        steps,
        learning_rate: 0.0004,
        resolution: 512,
        autocaption: true,
        batch_size: 1,
      },
    }),
  });

  if (!res.ok) throw new Error(`Replicate error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── 5. 학습 완료 대기 ───
async function waitForTraining(trainingId) {
  console.log(`\nWaiting for training ${trainingId}...`);
  const start = Date.now();

  while (true) {
    const res = await fetch(`https://api.replicate.com/v1/trainings/${trainingId}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` },
    });
    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (data.status === 'succeeded') {
      console.log(`\nTraining completed in ${elapsed}s`);
      return data;
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Training ${data.status}: ${data.error || 'unknown'}`);
    }

    process.stdout.write(`\r  Status: ${data.status} (${elapsed}s)`);
    await new Promise(r => setTimeout(r, 10000));
  }
}

// ─── 6. lora_models 테이블에 저장 ───
async function saveModel(training, imageCount) {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lora_models`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      category,
      model_id: training.output?.version || training.model || '',
      model_version: training.output?.version || '',
      trigger_word: triggerWord,
      training_images_count: imageCount,
      training_steps: steps,
      replicate_training_id: training.id,
      status: 'ready',
      metadata: {
        completed_at: training.completed_at,
        predict_time: training.metrics?.predict_time,
      },
    }),
  });

  if (!res.ok) console.warn(`Warning: Failed to save to lora_models: ${res.status}`);
  else console.log('Saved to lora_models table');
}

// ─── Main ───
try {
  // Step 1: 학습 이미지 조회
  const images = await getTrainingImages();
  console.log(`Found ${images.length} training images for "${category}"`);

  if (images.length === 0) {
    console.error('\nNo training images found!');
    console.error('Mark images with: UPDATE furniture_images SET is_training = true WHERE category = \'' + category + '\' AND ... ;');
    process.exit(1);
  }

  if (images.length < 10) {
    console.warn(`\nWarning: Only ${images.length} images. Recommend 20-50 for good results.`);
  }

  // Step 2: 다운로드 + zip
  const zipPath = await downloadAndZip(images);

  // Step 3: Storage 업로드
  const zipUrl = await uploadZip(zipPath);

  // Step 4: 학습 시작
  const training = await startTraining(zipUrl);
  console.log(`Training started: ${training.id}`);

  // Step 5: 완료 대기
  const result = await waitForTraining(training.id);

  // Step 6: 결과 저장
  await saveModel(result, images.length);

  // Summary
  console.log(`\n=== Training Complete ===`);
  console.log(`Category: ${category}`);
  console.log(`Trigger: ${triggerWord}`);
  console.log(`Images: ${images.length}`);
  console.log(`Steps: ${steps}`);
  console.log(`Model: ${result.output?.version || 'check Replicate dashboard'}`);
  console.log(`\nUse in prompts: "${triggerWord} modern Korean kitchen..."`);

} catch (err) {
  console.error('\nError:', err.message);
  process.exit(1);
}
