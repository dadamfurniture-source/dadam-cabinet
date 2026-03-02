#!/usr/bin/env node
/**
 * LoRA 배치 학습 스크립트
 * 8개 카테고리를 병렬로 Replicate에 학습 요청
 *
 * 사용법: node scripts/train-lora-batch.mjs [--steps 1000] [--dry-run]
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
const REPLICATE_OWNER = 'dadamfurniture-source';

const TRAINER_MODEL = 'ostris/flux-dev-lora-trainer';
const TRAINER_VERSION = '26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2';

const CATEGORIES = [
  'wardrobe', 'shoe_cabinet', 'vanity', 'fridge_cabinet',
  'l_shaped_sink', 'peninsula_sink', 'island_kitchen', 'storage_cabinet'
];

const DRY_RUN = process.argv.includes('--dry-run');
const STEPS = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === '--steps') || '1000');

const CHECKPOINT_PATH = resolve(__dirname, '../tmp/training-batch-checkpoint.json');

function loadCheckpoint() {
  if (existsSync(CHECKPOINT_PATH)) return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  return {};
}
function saveCheckpoint(data) {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true });
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2));
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase: ${res.status} ${await res.text()}`);
  return res.json();
}

async function replicateApi(method, path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const opts = {
        method,
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}`, 'Content-Type': 'application/json' }
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`https://api.replicate.com/v1${path}`, opts);
      const text = await res.text();
      try { return { status: res.status, data: JSON.parse(text) }; }
      catch { return { status: res.status, data: text }; }
    } catch (e) {
      console.warn(`    API call failed (attempt ${attempt}/${retries}): ${e.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 3000 * attempt));
      else throw e;
    }
  }
}

// ─── Step 1: Ensure destination model exists on Replicate ───
async function ensureModel(category) {
  const modelName = `dadam-${category.replace(/_/g, '-')}`;
  const destination = `${REPLICATE_OWNER}/${modelName}`;

  // Check if model already exists
  const { status } = await replicateApi('GET', `/models/${destination}`);
  if (status === 200) {
    console.log(`  Model ${modelName} exists`);
    return destination;
  }

  // Create model (public visibility required for this account tier)
  console.log(`  Creating model ${modelName}...`);
  const { status: cs, data: cd } = await replicateApi('POST', '/models', {
    owner: REPLICATE_OWNER,
    name: modelName,
    visibility: 'public',
    hardware: 'gpu-t4',
    description: `Dadam AI - ${category} furniture LoRA model`,
  });

  if (cs !== 201 && cs !== 200) {
    throw new Error(`Failed to create model ${modelName}: ${cs} ${JSON.stringify(cd)}`);
  }
  console.log(`  Model ${modelName} created`);
  return destination;
}

// ─── Step 2: Download images and create zip ───
async function downloadAndZip(category, images) {
  const tmpDir = resolve(__dirname, `../tmp/lora-${category}`);
  const zipPath = resolve(__dirname, `../tmp/lora-${category}.zip`);

  // Skip if zip already exists and matches image count
  if (existsSync(zipPath)) {
    console.log(`  Zip already exists: ${zipPath}`);
    return zipPath;
  }

  mkdirSync(tmpDir, { recursive: true });
  console.log(`  Downloading ${images.length} images...`);

  let downloaded = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const filename = `${String(i).padStart(3, '0')}.jpg`;
    const filepath = resolve(tmpDir, filename);

    // Skip if already downloaded
    if (existsSync(filepath)) { downloaded++; continue; }

    for (let retry = 0; retry < 3; retry++) {
      try {
        const url = img.image_url;
        const res = await fetch(url);
        if (!res.ok) { console.warn(`    Skip ${i}: HTTP ${res.status}`); break; }
        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(filepath, buffer);

        if (img.description) {
          writeFileSync(resolve(tmpDir, `${String(i).padStart(3, '0')}.txt`), img.description);
        }
        downloaded++;
        break;
      } catch (e) {
        if (retry === 2) console.warn(`    Error ${i}: ${e.message}`);
        else await new Promise(r => setTimeout(r, 2000));
      }
    }

    if ((i + 1) % 20 === 0) console.log(`    ${i + 1}/${images.length} downloaded`);
  }

  console.log(`  Downloaded ${downloaded}/${images.length} images`);

  // Create zip
  try {
    // Remove old zip first
    if (existsSync(zipPath)) execSync(`rm -f "${zipPath}"`);
    execSync(`cd "${tmpDir}" && powershell Compress-Archive -Path * -DestinationPath "${zipPath}" -Force`, { stdio: 'pipe' });
  } catch {
    execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
  }

  console.log(`  Zip created: ${zipPath}`);
  return zipPath;
}

// ─── Step 3: Upload zip to Supabase Storage ───
async function uploadZip(category, zipPath) {
  const storagePath = `lora-training/${category}/${Date.now()}.zip`;
  const buffer = readFileSync(zipPath);

  const key = SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/furniture-images/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/zip',
      },
      body: buffer,
    }
  );

  if (!res.ok) throw new Error(`Storage upload error: ${res.status} ${await res.text()}`);

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/furniture-images/${storagePath}`;
  console.log(`  Uploaded: ${publicUrl}`);
  return publicUrl;
}

// ─── Step 4: Start training on Replicate ───
async function startTraining(category, destination, zipUrl) {
  const triggerWord = `DADAM_${category.toUpperCase()}`;

  const { status, data } = await replicateApi(
    'POST',
    `/models/${TRAINER_MODEL}/versions/${TRAINER_VERSION}/trainings`,
    {
      destination,
      input: {
        input_images: zipUrl,
        trigger_word: triggerWord,
        steps: STEPS,
        learning_rate: 0.0004,
        resolution: '512',
        autocaption: true,
        batch_size: 1,
      }
    }
  );

  if (status !== 201 && status !== 200) {
    throw new Error(`Training start failed: ${status} ${JSON.stringify(data)}`);
  }

  console.log(`  Training started: ${data.id} → ${destination}`);
  return { id: data.id, triggerWord, destination };
}

// ─── Step 5: Poll all training jobs ───
async function pollTrainings(jobs) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Monitoring ${jobs.length} training jobs...`);
  console.log(`${'='.repeat(60)}\n`);

  const start = Date.now();
  const results = {};

  while (Object.keys(results).length < jobs.length) {
    for (const job of jobs) {
      if (results[job.category]) continue;

      const { data } = await replicateApi('GET', `/trainings/${job.trainingId}`);
      const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);

      if (data.status === 'succeeded') {
        results[job.category] = { success: true, data };
        console.log(`✓ ${job.category} completed (${elapsed}min) - model: ${data.output?.version?.substring(0, 20)}...`);
      } else if (data.status === 'failed' || data.status === 'canceled') {
        results[job.category] = { success: false, error: data.error || data.status };
        console.log(`✗ ${job.category} ${data.status}: ${data.error || 'unknown'}`);
      }
    }

    const pending = jobs.length - Object.keys(results).length;
    if (pending > 0) {
      const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
      process.stdout.write(`\r  [${elapsed}min] ${Object.keys(results).length}/${jobs.length} completed, ${pending} pending...`);
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  return results;
}

// ─── Step 6: Save results to lora_models ───
async function saveModel(category, trainingResult, imageCount) {
  const triggerWord = `DADAM_${category.toUpperCase()}`;
  const key = SUPABASE_SERVICE_KEY;
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
      model_id: trainingResult.output?.version || '',
      model_version: trainingResult.output?.version || '',
      trigger_word: triggerWord,
      training_images_count: imageCount,
      training_steps: STEPS,
      replicate_training_id: trainingResult.id,
      status: 'ready',
      metadata: {
        completed_at: trainingResult.completed_at,
        predict_time: trainingResult.metrics?.predict_time,
        batch_trained: true,
      },
    }),
  });

  if (!res.ok) console.warn(`  Warning: Failed to save ${category} to lora_models: ${res.status}`);
  else console.log(`  Saved ${category} to lora_models`);
}

// ─── Main ───
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Dadam AI - LoRA Batch Training         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Categories: ${CATEGORIES.length}`);
  console.log(`Steps: ${STEPS}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  const checkpoint = loadCheckpoint();
  const trainingJobs = [];

  // ── Phase 1: Prepare each category ──
  for (const category of CATEGORIES) {
    console.log(`\n── ${category} ──`);

    // Check if already submitted
    if (checkpoint[category]?.trainingId && !checkpoint[category]?.completed) {
      console.log(`  Resuming: training ${checkpoint[category].trainingId} already submitted`);
      trainingJobs.push({
        category,
        trainingId: checkpoint[category].trainingId,
        imageCount: checkpoint[category].imageCount,
      });
      continue;
    }

    if (checkpoint[category]?.completed) {
      console.log(`  Already completed, skipping`);
      continue;
    }

    // 1. Get training images
    const images = await supabaseGet(
      `furniture_images?category=eq.${category}&is_training=eq.true&select=id,image_url,storage_path,description`
    );
    console.log(`  Found ${images.length} training images`);

    if (images.length === 0) {
      console.warn(`  No training images! Skipping.`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would train with ${images.length} images`);
      continue;
    }

    // 2. Ensure destination model exists
    const destination = await ensureModel(category);

    // 3. Download and zip
    const zipPath = await downloadAndZip(category, images);

    // 4. Upload zip to Storage
    const zipUrl = await uploadZip(category, zipPath);

    // 5. Start training
    const training = await startTraining(category, destination, zipUrl);

    checkpoint[category] = {
      trainingId: training.id,
      destination: training.destination,
      triggerWord: training.triggerWord,
      zipUrl,
      imageCount: images.length,
      startedAt: new Date().toISOString(),
    };
    saveCheckpoint(checkpoint);

    trainingJobs.push({
      category,
      trainingId: training.id,
      imageCount: images.length,
    });
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No training jobs submitted.');
    return;
  }

  if (trainingJobs.length === 0) {
    console.log('\nAll categories already completed!');
    return;
  }

  // ── Phase 2: Poll all training jobs ──
  const results = await pollTrainings(trainingJobs);

  // ── Phase 3: Save results ──
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('Saving results...');

  let successCount = 0;
  let failCount = 0;

  for (const [category, result] of Object.entries(results)) {
    if (result.success) {
      const job = trainingJobs.find(j => j.category === category);
      await saveModel(category, result.data, job?.imageCount || 0);
      checkpoint[category].completed = true;
      checkpoint[category].modelVersion = result.data.output?.version;
      successCount++;
    } else {
      checkpoint[category].error = result.error;
      failCount++;
    }
  }
  saveCheckpoint(checkpoint);

  // ── Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log('TRAINING SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`Success: ${successCount}/${trainingJobs.length}`);
  console.log(`Failed:  ${failCount}/${trainingJobs.length}`);
  console.log();

  for (const category of CATEGORIES) {
    const cp = checkpoint[category];
    if (!cp) continue;
    const status = cp.completed ? '✓' : cp.error ? '✗' : '?';
    const trigger = `DADAM_${category.toUpperCase()}`;
    console.log(`  ${status} ${category.padEnd(18)} trigger: ${trigger}  ${cp.modelVersion?.substring(0, 30) || cp.error || ''}`);
  }

  console.log(`\nUse in prompts: "DADAM_WARDROBE modern Korean built-in wardrobe..."`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
