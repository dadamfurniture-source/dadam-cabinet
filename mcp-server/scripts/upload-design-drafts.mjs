#!/usr/bin/env node
/**
 * 디자인 시안 이미지 → 스타일 분류 → Supabase 업로드
 *
 * 프로세스:
 *   1. 디자인 시안 폴더명 → 기존 카테고리 매핑
 *   2. Claude Vision으로 스타일 분류
 *   3. Supabase Storage 업로드 + furniture_images INSERT
 */
import { config } from 'dotenv';
import { resolve, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'furniture-images';

const DESIGN_DIR = 'C:/Users/hchan/dadamagent/tmp/naver-works/디자인시안';
const CHECKPOINT_PATH = resolve(DESIGN_DIR, '_upload_checkpoint.json');

// ─── 폴더명 → 카테고리 매핑 ───
const FOLDER_MAP = {
  '화장대': 'vanity',
  '1자형 싱크대': 'l_shaped_sink',
  'ㄱ자형 싱크대': 'l_shaped_sink',
  '신발장': 'shoe_cabinet',
  '수납장': 'storage_cabinet',
  '붙박이장': 'wardrobe',
  '알파룸': 'wardrobe',
  '드레스룸': 'wardrobe',
  '아일랜드형 싱크대': 'island_kitchen',
  'TV장': 'storage_cabinet',
  'ㄷ자형 싱크대': 'peninsula_sink',
  '냉장고장 카페장(홈바장)': 'fridge_cabinet',
  // 제외
  '블룸 서랍재': null,  // 하드웨어 부품 → 학습 데이터 부적합
};

const STYLES = ['modern', 'nordic', 'classic', 'natural', 'industrial', 'luxury'];

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

// ─── Claude Vision 분류 ───
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function classifyStyle(filePath) {
  const buffer = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
  const mediaType = mimeMap[ext] || 'image/jpeg';

  // 5MB 초과 체크
  if (buffer.length > 5 * 1024 * 1024) return { style: 'modern', confidence: 0.5, reason: 'file too large for classification' };

  const base64 = buffer.toString('base64');

  for (let retry = 0; retry < 3; retry++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `이 한국 빌트인 가구 이미지의 인테리어 스타일을 분류하세요.
가능한 스타일: ${STYLES.join(', ')}
JSON으로 답하세요: {"style": "...", "confidence": 0.0~1.0, "reason": "한국어 설명"}` }
          ]
        }]
      });

      const text = response.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (STYLES.includes(parsed.style)) return parsed;
      }
    } catch (e) {
      if (retry < 2) { await new Promise(r => setTimeout(r, 2000 * (retry + 1))); continue; }
      console.warn(`    Classification failed: ${e.message.slice(0, 60)}`);
    }
  }
  return { style: 'modern', confidence: 0.5, reason: 'classification failed, default' };
}

// ─── Supabase 업로드 ───
async function uploadImage(filePath, storagePath) {
  const buffer = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': mimeMap[ext] || 'image/jpeg', 'x-upsert': 'true' },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function insertMetadata(record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/furniture_images`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Insert ${res.status}: ${await res.text()}`);
}

// ─── Checkpoint ───
function loadCheckpoint() {
  if (existsSync(CHECKPOINT_PATH)) return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  return { done: {} };
}
function saveCheckpoint(cp) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

// ─── Main ───
console.log('=== 디자인 시안 → Supabase 업로드 ===\n');

const checkpoint = loadCheckpoint();
const folders = readdirSync(DESIGN_DIR).filter(f => {
  const p = resolve(DESIGN_DIR, f);
  return statSync(p).isDirectory() && !f.startsWith('_');
});

let totalUploaded = 0, totalSkipped = 0, totalErrors = 0;
const summary = [];

for (const folder of folders) {
  const category = FOLDER_MAP[folder];
  if (category === null) {
    console.log(`[${folder}] → SKIP (하드웨어 부품)`);
    summary.push({ folder, category: '-', uploaded: 0, skipped: 0, errors: 0 });
    continue;
  }
  if (!category) {
    console.log(`[${folder}] → SKIP (매핑 없음)`);
    summary.push({ folder, category: '-', uploaded: 0, skipped: 0, errors: 0 });
    continue;
  }

  console.log(`\n[${folder}] → ${category}`);
  const dirPath = resolve(DESIGN_DIR, folder);
  const files = readdirSync(dirPath).filter(f => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f));

  let uploaded = 0, skipped = 0, errors = 0;

  for (const file of files) {
    const key = `${folder}/${file}`;
    if (checkpoint.done[key]) { skipped++; continue; }

    const filePath = resolve(dirPath, file);

    try {
      // 1. 스타일 분류
      const classification = await classifyStyle(filePath);
      console.log(`  ${file} → ${classification.style} (${classification.confidence})`);

      // 2. Storage 업로드 (source=design_draft로 구분)
      const storagePath = `${category}/${classification.style}/draft_${file}`;
      const publicUrl = await uploadImage(filePath, storagePath);

      // 3. DB INSERT
      const fileSize = statSync(filePath).size;
      await insertMetadata({
        category,
        style: classification.style,
        description: classification.reason,
        image_url: publicUrl,
        storage_path: `${BUCKET}/${storagePath}`,
        source: 'design_draft',
        is_training: true,
        file_size_bytes: fileSize,
        tags: [classification.style, category, 'design_draft', folder],
      });

      checkpoint.done[key] = { style: classification.style, at: new Date().toISOString() };
      uploaded++;

      if (uploaded % 5 === 0) saveCheckpoint(checkpoint);

      // Rate limit
      await new Promise(r => setTimeout(r, 1500));

    } catch (e) {
      console.error(`  ERR ${file}: ${e.message.slice(0, 80)}`);
      errors++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  saveCheckpoint(checkpoint);
  totalUploaded += uploaded;
  totalSkipped += skipped;
  totalErrors += errors;
  summary.push({ folder, category, uploaded, skipped, errors, total: files.length });
  console.log(`  Done: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
}

console.log('\n=== Summary ===');
console.log('Folder                     | Category        | Total | Up | Skip | Err');
console.log('───────────────────────────|─────────────────|───────|────|──────|────');
for (const s of summary) {
  console.log(`${s.folder.padEnd(27)}| ${(s.category || '-').padEnd(16)}| ${String(s.total || 0).padStart(5)} | ${String(s.uploaded).padStart(2)} | ${String(s.skipped).padStart(4)} | ${String(s.errors).padStart(2)}`);
}
console.log(`\nTOTAL: ${totalUploaded} uploaded, ${totalSkipped} skipped, ${totalErrors} errors`);
