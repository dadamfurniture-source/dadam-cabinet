#!/usr/bin/env node
/**
 * 분류된 가구 이미지를 Supabase Storage + furniture_images 테이블에 업로드
 *
 * Usage:
 *   node scripts/upload-furniture-images.mjs                  # 전체 카테고리
 *   node scripts/upload-furniture-images.mjs --category wardrobe  # 특정 카테고리만
 *   node scripts/upload-furniture-images.mjs --dry-run        # 업로드 없이 확인만
 *
 * 프로세스:
 *   1. furniture-images 버킷 확인/생성
 *   2. Google Drive에서 classification_result.json 읽기
 *   3. 이미지를 Supabase Storage에 업로드
 *   4. furniture_images 테이블에 메타데이터 INSERT
 *   5. 진행상황 체크포인트 저장 (재시작 가능)
 */
import { config } from 'dotenv';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'furniture-images';

const GDRIVE_BASE = 'G:/내 드라이브/kitchen_dataset/furniture_dataset';
const ALL_CATEGORIES = [
  'wardrobe', 'shoe_cabinet', 'vanity', 'fridge_cabinet',
  'l_shaped_sink', 'peninsula_sink', 'island_kitchen', 'storage_cabinet'
];

// ─── Args ───
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1] : null;
}
const DRY_RUN = process.argv.includes('--dry-run');
const targetCategory = getArg('category');
const categories = targetCategory ? [targetCategory] : ALL_CATEGORIES;

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

// ─── Checkpoint ───
const CHECKPOINT_DIR = resolve(GDRIVE_BASE, '../_upload_checkpoints');
function loadCheckpoint(category) {
  const path = resolve(CHECKPOINT_DIR, `${category}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
  return { uploaded: {} };
}
import { mkdirSync } from 'fs';

function saveCheckpoint(category, data) {
  if (!existsSync(CHECKPOINT_DIR)) {
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
  writeFileSync(resolve(CHECKPOINT_DIR, `${category}.json`), JSON.stringify(data, null, 2));
}

// ─── 1. 버킷 확인/생성 ───
async function ensureBucket() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers });
  if (res.ok) {
    console.log(`Bucket "${BUCKET}": EXISTS`);
    return;
  }

  console.log(`Creating bucket "${BUCKET}"...`);
  const createRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create bucket: ${createRes.status} ${text}`);
  }
  console.log(`Bucket "${BUCKET}": CREATED`);
}

// ─── 2. 이미지 업로드 ───
async function uploadImage(filePath, storagePath) {
  const buffer = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const contentType = mimeTypes[ext] || 'image/jpeg';

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

// ─── 3. DB INSERT ───
async function insertMetadata(record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/furniture_images`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(record),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert failed (${res.status}): ${text}`);
  }
}

// ─── 4. 카테고리 처리 ───
async function processCategory(category) {
  const metadataPath = resolve(GDRIVE_BASE, category, 'metadata', 'classification_result.json');
  if (!existsSync(metadataPath)) {
    console.warn(`  SKIP: ${metadataPath} not found`);
    return { uploaded: 0, skipped: 0, errors: 0 };
  }

  const result = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  const images = result.images || {};
  const imageNames = Object.keys(images);
  const checkpoint = loadCheckpoint(category);

  let uploaded = 0, skipped = 0, errors = 0;

  for (let i = 0; i < imageNames.length; i++) {
    const filename = imageNames[i];
    const meta = images[filename];

    // 이미 업로드된 경우 skip
    if (checkpoint.uploaded[filename]) {
      skipped++;
      continue;
    }

    // unknown 스타일은 건너뛰기
    if (meta.style === 'unknown') {
      skipped++;
      continue;
    }

    const filePath = resolve(GDRIVE_BASE, category, 'raw', filename);
    if (!existsSync(filePath)) {
      console.warn(`  MISSING: ${filePath}`);
      errors++;
      continue;
    }

    const fileSize = statSync(filePath).size;
    // 5MB 초과 파일 skip (Supabase Storage 기본 제한)
    if (fileSize > 50 * 1024 * 1024) {
      console.warn(`  TOO LARGE (${(fileSize / 1024 / 1024).toFixed(1)}MB): ${filename}`);
      errors++;
      continue;
    }

    const storagePath = `${category}/${meta.style}/${filename}`;

    if (DRY_RUN) {
      console.log(`  [DRY] ${filename} → ${storagePath} (${meta.style}, ${meta.confidence})`);
      uploaded++;
      continue;
    }

    try {
      const publicUrl = await uploadImage(filePath, storagePath);

      await insertMetadata({
        category,
        style: meta.style,
        description: meta.reason,
        image_url: publicUrl,
        storage_path: `${BUCKET}/${storagePath}`,
        source: 'crawl',
        is_training: true,
        file_size_bytes: fileSize,
        tags: [meta.style, category],
      });

      checkpoint.uploaded[filename] = { style: meta.style, at: new Date().toISOString() };
      uploaded++;

      // 10개마다 체크포인트 저장 + 로그
      if (uploaded % 10 === 0) {
        saveCheckpoint(category, checkpoint);
        console.log(`  ${uploaded + skipped}/${imageNames.length} (uploaded: ${uploaded}, skipped: ${skipped})`);
      }

      // Rate limit: 50ms 딜레이
      await new Promise(r => setTimeout(r, 50));

    } catch (e) {
      console.error(`  ERR ${filename}: ${e.message}`);
      errors++;
      // 에러 시 더 긴 대기
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 최종 체크포인트 저장
  if (!DRY_RUN) saveCheckpoint(category, checkpoint);

  return { uploaded, skipped, errors, total: imageNames.length };
}

// ─── Main ───
console.log(`=== Furniture Image Upload ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
console.log(`Categories: ${categories.join(', ')}\n`);

if (!DRY_RUN) await ensureBucket();

const summary = [];
for (const category of categories) {
  console.log(`\n[${category}]`);
  const start = Date.now();
  const stats = await processCategory(category);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Done: ${stats.uploaded} uploaded, ${stats.skipped} skipped, ${stats.errors} errors (${elapsed}s)`);
  summary.push({ category, ...stats, elapsed });
}

console.log('\n=== Summary ===');
console.log('Category          | Total | Upload | Skip | Err | Time');
console.log('──────────────────|───────|────────|──────|─────|──────');
let totalUp = 0, totalSkip = 0, totalErr = 0;
for (const s of summary) {
  const cat = s.category.padEnd(18);
  console.log(`${cat}| ${String(s.total || 0).padStart(5)} | ${String(s.uploaded).padStart(6)} | ${String(s.skipped).padStart(4)} | ${String(s.errors).padStart(3)} | ${s.elapsed}s`);
  totalUp += s.uploaded;
  totalSkip += s.skipped;
  totalErr += s.errors;
}
console.log(`${'TOTAL'.padEnd(18)}| ${String(totalUp + totalSkip + totalErr).padStart(5)} | ${String(totalUp).padStart(6)} | ${String(totalSkip).padStart(4)} | ${String(totalErr).padStart(3)} |`);
