#!/usr/bin/env node
/**
 * 단일 카테고리 LoRA 학습
 *
 * 로컬 이미지 폴더 → ZIP → Supabase Storage → Replicate 학습
 *
 * Usage:
 *   node scripts/train-single-category.mjs --source "G:/내 드라이브/kitchen_dataset/classified/1자형" --category sink --trainer sdxl
 *   node scripts/train-single-category.mjs --source "path/to/images" --category l_shaped_sink --trainer sdxl --dry-run
 */
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 수동 파싱 (Windows CR 대응)
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPLICATE_KEY = process.env.REPLICATE_API_KEY;
const REPLICATE_OWNER = 'dadamfurniture-source';

// ── 트레이너 설정 ──
const TRAINERS = {
  flux: {
    model: 'ostris/flux-dev-lora-trainer',
    version: '26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2',
    defaultSteps: 1000,
    buildInput: (zipUrl, triggerWord, steps) => ({
      input_images: zipUrl,
      trigger_word: triggerWord,
      steps,
      learning_rate: 0.0004,
      resolution: '512',
      autocaption: true,
      batch_size: 1,
    }),
  },
  sdxl: {
    model: 'stability-ai/sdxl',
    version: '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
    defaultSteps: 2000,
    buildInput: (zipUrl, triggerWord, steps) => ({
      input_images: zipUrl,
      token_string: triggerWord,
      caption_prefix: `a photo of ${triggerWord}, `,
      max_train_steps: steps,
      use_face_detection_instead: false,
      is_lora: true,
      unet_learning_rate: 1e-6,
      lora_lr: 1e-4,
      resolution: 1024,
      train_batch_size: 4,
      checkpointing_steps: 500,
    }),
  },
};

// ── Args ──
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1] : null;
}

const SOURCE_DIR = getArg('source');
const CATEGORY = getArg('category') || 'sink';
const TRAINER_TYPE = getArg('trainer') || 'sdxl';
const STEPS = parseInt(getArg('steps') || String(TRAINERS[TRAINER_TYPE]?.defaultSteps || 2000));
const DRY_RUN = process.argv.includes('--dry-run');

if (!SOURCE_DIR) {
  console.error('Usage: node scripts/train-single-category.mjs --source <path> --category <name> [--trainer sdxl|flux] [--steps N] [--dry-run]');
  process.exit(1);
}

const trainer = TRAINERS[TRAINER_TYPE];
if (!trainer) {
  console.error(`Unknown trainer: ${TRAINER_TYPE}`);
  process.exit(1);
}

const TRIGGER_WORD = `DADAM_${CATEGORY.toUpperCase()}`;

// ── Replicate API ──
async function replicateApi(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.replicate.com/v1${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// ── Main ──
async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  단일 카테고리 LoRA 학습                        ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`소스:     ${SOURCE_DIR}`);
  console.log(`카테고리: ${CATEGORY}`);
  console.log(`트리거:   ${TRIGGER_WORD}`);
  console.log(`트레이너: ${TRAINER_TYPE} (${trainer.model})`);
  console.log(`스텝:     ${STEPS}`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log();

  // Step 1: 이미지 확인
  if (!existsSync(SOURCE_DIR)) {
    console.error(`소스 디렉토리 없음: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const imageFiles = readdirSync(SOURCE_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`이미지: ${imageFiles.length}장`);

  if (imageFiles.length < 10) {
    console.error('최소 10장 이상 필요합니다.');
    process.exit(1);
  }

  // Step 2: ZIP 생성 (PowerShell 대신 Node.js archiver 또는 간단 방식)
  const tmpDir = resolve(__dirname, '../tmp');
  mkdirSync(tmpDir, { recursive: true });
  const zipPath = resolve(tmpDir, `lora-${CATEGORY}-${TRAINER_TYPE}.zip`);

  console.log(`\nZIP 생성: ${zipPath}`);
  if (!DRY_RUN) {
    if (existsSync(zipPath)) {
      try { execSync(`rm -f "${zipPath}"`); } catch { /* ignore */ }
    }

    // PowerShell로 ZIP (한글 경로 대응: 절대 경로 사용)
    const absSource = resolve(SOURCE_DIR).replace(/\//g, '\\');
    const absZip = resolve(zipPath).replace(/\//g, '\\');
    const psCmd = `powershell -Command "Compress-Archive -Path '${absSource}\\*' -DestinationPath '${absZip}' -Force"`;
    console.log(`  PS: ${psCmd.substring(0, 100)}...`);

    try {
      execSync(psCmd, { stdio: 'pipe', timeout: 120000 });
    } catch (e1) {
      console.warn(`  PowerShell ZIP 실패, tar 시도...`);
      // tar로 폴백 (Windows 10+ 내장)
      try {
        execSync(`tar -cf "${zipPath}" -C "${SOURCE_DIR}" .`, { stdio: 'pipe', timeout: 120000 });
      } catch (e2) {
        console.error('ZIP 생성 실패:', e1.message);
        process.exit(1);
      }
    }

    if (!existsSync(zipPath)) {
      console.error('ZIP 파일이 생성되지 않았습니다.');
      process.exit(1);
    }
    const zipSize = readFileSync(zipPath).length;
    console.log(`  ZIP 크기: ${(zipSize / 1024 / 1024).toFixed(1)}MB`);
  }

  // Step 3: Supabase Storage 업로드
  const storagePath = `lora-training/${CATEGORY}/${TRAINER_TYPE}_${Date.now()}.zip`;
  console.log(`\nSupabase 업로드: ${storagePath}`);

  let zipUrl;
  if (!DRY_RUN) {
    const buffer = readFileSync(zipPath);
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/furniture-images/${storagePath}`,
      {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/zip',
        },
        body: buffer,
      }
    );
    if (!res.ok) {
      console.error(`업로드 실패: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    zipUrl = `${SUPABASE_URL}/storage/v1/object/public/furniture-images/${storagePath}`;
    console.log(`  URL: ${zipUrl}`);
  } else {
    zipUrl = 'https://example.com/dry-run.zip';
    console.log('  [DRY RUN] 업로드 스킵');
  }

  // Step 4: Replicate 모델 생성/확인
  const modelName = `dadam-${CATEGORY.replace(/_/g, '-')}`;
  const destination = `${REPLICATE_OWNER}/${modelName}`;

  console.log(`\nReplicate 모델: ${destination}`);
  if (!DRY_RUN) {
    const { status } = await replicateApi('GET', `/models/${destination}`);
    if (status !== 200) {
      console.log('  모델 생성 중...');
      const { status: cs, data: cd } = await replicateApi('POST', '/models', {
        owner: REPLICATE_OWNER,
        name: modelName,
        visibility: 'public',
        hardware: 'gpu-t4',
        description: `Dadam AI - ${CATEGORY} furniture LoRA (${TRAINER_TYPE})`,
      });
      if (cs !== 201 && cs !== 200) {
        console.error(`모델 생성 실패: ${cs}`, cd);
        process.exit(1);
      }
    }
    console.log('  ✓ 모델 준비 완료');
  }

  // Step 5: 학습 시작
  const trainingInput = trainer.buildInput(zipUrl, TRIGGER_WORD, STEPS);
  console.log(`\n학습 시작 (${STEPS} steps)...`);

  if (DRY_RUN) {
    console.log('[DRY RUN] 학습 입력:', JSON.stringify(trainingInput, null, 2));
    return;
  }

  const { status: ts, data: td } = await replicateApi(
    'POST',
    `/models/${trainer.model}/versions/${trainer.version}/trainings`,
    { destination, input: trainingInput }
  );

  if (ts !== 201 && ts !== 200) {
    console.error(`학습 시작 실패: ${ts}`, td);
    process.exit(1);
  }

  const trainingId = td.id;
  console.log(`  학습 ID: ${trainingId}`);
  console.log(`  대상: ${destination}`);

  // Step 6: 학습 완료 대기 (폴링)
  console.log('\n학습 진행 중...');
  const startTime = Date.now();
  const maxWait = 45 * 60 * 1000; // 45분

  while (Date.now() - startTime < maxWait) {
    const { data } = await replicateApi('GET', `/trainings/${trainingId}`);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    if (data.status === 'succeeded') {
      console.log(`\n✓ 학습 완료! (${elapsed}분)`);
      console.log(`  모델 버전: ${data.output?.version}`);

      // Supabase lora_models 저장
      const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/lora_models`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          category: CATEGORY,
          model_id: data.output?.version || '',
          model_version: data.output?.version || '',
          trigger_word: TRIGGER_WORD,
          training_images_count: imageFiles.length,
          training_steps: STEPS,
          replicate_training_id: trainingId,
          status: 'ready',
          metadata: {
            completed_at: data.completed_at,
            predict_time: data.metrics?.predict_time,
            trainer_type: TRAINER_TYPE,
            trainer_model: trainer.model,
            source_dir: SOURCE_DIR,
          },
        }),
      });

      if (saveRes.ok) console.log('  ✓ lora_models 테이블 저장 완료');
      else console.warn('  ⚠ lora_models 저장 실패:', saveRes.status);

      console.log(`\n다음 단계:`);
      console.log(`  테스트 이미지 생성: POST /webhook/controlnet-image { category: "${CATEGORY}", ... }`);
      return;
    }

    if (data.status === 'failed' || data.status === 'canceled') {
      console.error(`\n✗ 학습 ${data.status}: ${data.error || 'unknown'}`);
      process.exit(1);
    }

    process.stdout.write(`\r  [${elapsed}min] ${data.status}...`);
    await new Promise(r => setTimeout(r, 15000));
  }

  console.error('\n학습 타임아웃 (45분 초과)');
  console.log(`  학습 ID: ${trainingId} — 수동 확인: https://replicate.com/p/${trainingId}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
