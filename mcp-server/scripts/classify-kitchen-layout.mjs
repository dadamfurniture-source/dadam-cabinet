#!/usr/bin/env node
/**
 * 주방 이미지 레이아웃 분류 (Claude Vision)
 *
 * 주방 이미지를 4가지 레이아웃 타입으로 분류:
 *   i_type    — 1자형 (일자형, 직선형)
 *   l_type    — ㄱ자형 (L자형)
 *   u_type    — ㄷ자형 (U자형)
 *   peninsula — 대면형 (11자형, 아일랜드, 반도형)
 *
 * Usage:
 *   node scripts/classify-kitchen-layout.mjs --source sink
 *   node scripts/classify-kitchen-layout.mjs --source sink --dry-run
 */
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

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

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not found in .env');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const GDRIVE_BASE = 'G:/내 드라이브/kitchen_dataset/furniture_dataset';
const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_CAT = process.argv.find((a, i, arr) => arr[i - 1] === '--source') || 'sink';
const BATCH_SIZE = 3;

const LAYOUT_TYPES = ['i_type', 'l_type', 'u_type', 'peninsula'];
const LAYOUT_NAMES = {
  i_type: '1자형',
  l_type: 'ㄱ자형',
  u_type: 'ㄷ자형',
  peninsula: '대면형(11자형)',
};

// ─── Claude Vision 분류 ───
async function classifyBatch(images) {
  const content = [];

  for (const img of images) {
    const data = readFileSync(img.path);
    const base64 = data.toString('base64');
    const ext = img.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    content.push({
      type: 'image',
      source: { type: 'base64', media_type: ext, data: base64 },
    });
    content.push({
      type: 'text',
      text: `Image: ${img.filename}`,
    });
  }

  content.push({
    type: 'text',
    text: `위 ${images.length}장의 주방 사진을 아래 4가지 레이아웃 타입으로 분류하세요.

레이아웃 타입:
- i_type: 1자형 (한쪽 벽면에만 일렬로 배치된 직선형 주방)
- l_type: ㄱ자형 (두 벽면을 사용하는 L자 형태 주방)
- u_type: ㄷ자형 (세 벽면을 사용하는 U자 형태 주방)
- peninsula: 대면형/11자형 (벽면 + 반도형 또는 아일랜드 카운터가 있는 주방, 거실/다이닝과 마주보는 형태)

각 이미지에 대해 정확히 한 줄씩, 아래 JSON 형식으로만 응답하세요:
{"filename": "파일명", "layout": "i_type|l_type|u_type|peninsula", "confidence": 0.0~1.0}

JSON 배열로 감싸세요. 설명은 불필요합니다.`,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0]?.text || '';

  // JSON 파싱
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  // 줄별 파싱 시도
  const results = [];
  for (const line of text.split('\n')) {
    try {
      const obj = JSON.parse(line.trim());
      if (obj.filename && obj.layout) results.push(obj);
    } catch {}
  }
  return results;
}

// ─── 메인 ───
async function main() {
  const customDir = process.argv.find((a, i, arr) => arr[i - 1] === '--dir');
  const sourceDir = customDir ? resolve(customDir) : resolve(GDRIVE_BASE, SOURCE_CAT, 'modern');

  console.log('╔═════════════════════════════════════════════╗');
  console.log('║  주방 레이아웃 분류 (Claude Vision)            ║');
  console.log('╚═════════════════════════════════════════════╝');
  console.log(`소스:     ${sourceDir}`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log();

  if (!existsSync(sourceDir)) {
    console.error(`소스 디렉토리 없음: ${sourceDir}`);
    process.exit(1);
  }

  const files = readdirSync(sourceDir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => ({ filename: f, path: resolve(sourceDir, f) }));

  console.log(`이미지: ${files.length}장\n`);

  // 배치 분류
  const allResults = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    console.log(`  배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}: ${batch.map(b => b.filename).join(', ')}`);

    if (DRY_RUN) {
      batch.forEach(b => allResults.push({ filename: b.filename, layout: 'unknown', confidence: 0 }));
      continue;
    }

    try {
      const results = await classifyBatch(batch);
      for (const r of results) {
        allResults.push(r);
        console.log(`    ${r.filename}: ${LAYOUT_NAMES[r.layout] || r.layout} (${(r.confidence * 100).toFixed(0)}%)`);
      }
    } catch (e) {
      console.error(`    분류 실패: ${e.message}`);
      batch.forEach(b => allResults.push({ filename: b.filename, layout: 'unknown', confidence: 0 }));
    }

    // API 레이트 리밋
    if (i + BATCH_SIZE < files.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 레이아웃별 통계
  const stats = {};
  for (const r of allResults) {
    stats[r.layout] = (stats[r.layout] || 0) + 1;
  }
  console.log('\n═══ 분류 결과 ═══');
  for (const [layout, count] of Object.entries(stats)) {
    console.log(`  ${(LAYOUT_NAMES[layout] || layout).padEnd(15)} ${count}장`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 파일 이동 안 함');
    return;
  }

  // 레이아웃별 폴더로 복사
  console.log('\n파일 이동...');
  for (const layout of LAYOUT_TYPES) {
    const layoutDir = resolve(GDRIVE_BASE, SOURCE_CAT, layout);
    mkdirSync(layoutDir, { recursive: true });
  }

  for (const r of allResults) {
    if (!LAYOUT_TYPES.includes(r.layout)) continue;
    const srcPath = resolve(sourceDir, r.filename);
    const dstDir = resolve(GDRIVE_BASE, SOURCE_CAT, r.layout);
    const dstPath = resolve(dstDir, r.filename);

    if (existsSync(srcPath)) {
      copyFileSync(srcPath, dstPath);
    }
  }

  // 분류 결과 저장
  const resultPath = resolve(GDRIVE_BASE, SOURCE_CAT, 'layout_classification.json');
  writeFileSync(resultPath, JSON.stringify({
    classified_at: new Date().toISOString(),
    source: SOURCE_CAT,
    total: allResults.length,
    stats,
    results: allResults,
  }, null, 2));

  console.log(`\n분류 결과 저장: ${resultPath}`);
  console.log('\n레이아웃별 폴더:');
  for (const layout of LAYOUT_TYPES) {
    const dir = resolve(GDRIVE_BASE, SOURCE_CAT, layout);
    const count = existsSync(dir) ? readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length : 0;
    console.log(`  ${dir} (${count}장)`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
