#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// 카테고리별 closed-door 프롬프트 검증 스크립트
//
// 6개 카테고리(sink/wardrobe/fridge/vanity/shoe/storage)에 동일 참조
// 이미지로 Gemini 호출 후 결과를 파일로 저장. 카테고리별 외관 명세
// (CATEGORY_META, PR #244)가 이미지에 의도대로 반영되는지 육안 검증.
//
// 실행:
//   cd mcp-server
//   npm run build                                    # dist 갱신 필수
//   node scripts/test-closed-door-categories.mjs [참조이미지경로]
//
// 출력:
//   tmp/category-test/{cat}-closed.png       이미지
//   tmp/category-test/prompts/{cat}.txt      카테고리별 실제 보낸 프롬프트
//   tmp/category-test/results.json           메트릭 (시간/토큰/finishReason)
// ═══════════════════════════════════════════════════════════════

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { buildClosedDoorPrompt } from '../dist/prompts/templates/closed-door.prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-image';

const REFERENCE_IMAGE_PATH = process.argv[2] || resolve(
  __dirname,
  '../../screenshot/testimage/KakaoTalk_20260216_123628816.jpg'
);
const OUTPUT_DIR = resolve(__dirname, '../../tmp/category-test');

const CATEGORIES = ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'];

// 카테고리별 최소 합리적인 모듈 구성 (실제 사용 패턴 근사)
const MODULE_CONFIG = {
  sink:     { upper: 4, lower: 4 },  // 4구 상부장 + 싱크+쿡탑 포함 하부장 4
  wardrobe: { upper: 0, lower: 6 },  // 6도어 옷장 (짝수 강제)
  fridge:   { upper: 1, lower: 0 },  // 냉장고 위 상부장 1, 측면 키큰장은 모델 자동
  vanity:   { upper: 1, lower: 2 },  // 상부 거울장 1 + 하부 수납 2
  shoe:     { upper: 0, lower: 4 },  // 신발장 4도어
  storage:  { upper: 0, lower: 4 },  // 수납장 4도어
};

function buildParams(category) {
  const mod = MODULE_CONFIG[category];
  const makeModules = (n) => Array.from({ length: n }, () => ({ width: 600, name: 'cabinet' }));

  return {
    category,
    style: 'modern',
    wallData: {}, // 배관 정보 없음 — sink는 SECTION 2 폴백
    rules: { materials: [], materialKeywords: [] },
    cabinetSpecs: {
      door_color_upper: '화이트',
      door_finish_upper: '무광',
    },
    modules: {
      upper: makeModules(mod.upper),
      lower: makeModules(mod.lower),
      upper_count: mod.upper,
      lower_count: mod.lower,
    },
  };
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadReferenceImage() {
  if (!existsSync(REFERENCE_IMAGE_PATH)) {
    console.error(`❌ 참조 이미지 없음: ${REFERENCE_IMAGE_PATH}`);
    console.error(`   사용법: node scripts/test-closed-door-categories.mjs [참조이미지경로]`);
    process.exit(1);
  }
  const buffer = readFileSync(REFERENCE_IMAGE_PATH);
  return {
    base64: buffer.toString('base64'),
    sizeKB: (buffer.length / 1024).toFixed(0),
    mimeType: REFERENCE_IMAGE_PATH.endsWith('.png') ? 'image/png' : 'image/jpeg',
  };
}

function saveImage(base64, filename) {
  const path = resolve(OUTPUT_DIR, filename);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

async function callGemini(prompt, referenceImage, mimeType) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 미설정 — mcp-server/.env 확인');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const parts = [];
  if (referenceImage) parts.push({ inline_data: { mime_type: mimeType, data: referenceImage } });
  parts.push({ text: prompt });

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 },
    }),
  });
  const elapsedMs = Date.now() - t0;
  const data = await res.json();

  if (!res.ok) return { ok: false, elapsedMs, error: JSON.stringify(data).substring(0, 500) };

  const candidate = data.candidates?.[0];
  const imgPart = candidate?.content?.parts?.find(p => p.inlineData || p.inline_data);
  const image = imgPart ? (imgPart.inlineData || imgPart.inline_data).data : null;
  const finishReason = candidate?.finishReason || 'UNKNOWN';
  return { ok: !!image, elapsedMs, image, finishReason, usageMetadata: data.usageMetadata || null };
}

async function main() {
  console.log('═══ Category Closed-Door Prompt Test ═══\n');
  ensureDir(OUTPUT_DIR);
  ensureDir(resolve(OUTPUT_DIR, 'prompts'));

  const ref = loadReferenceImage();
  console.log(`참조 이미지: ${REFERENCE_IMAGE_PATH} (${ref.sizeKB}KB)`);
  console.log(`출력 디렉토리: ${OUTPUT_DIR}\n`);

  const results = {
    reference: { path: REFERENCE_IMAGE_PATH, sizeKB: ref.sizeKB },
    model: GEMINI_MODEL,
    categories: {},
  };

  for (const cat of CATEGORIES) {
    const params = buildParams(cat);
    const prompt = buildClosedDoorPrompt(params);
    writeFileSync(resolve(OUTPUT_DIR, 'prompts', `${cat}.txt`), prompt);

    console.log(`[${cat.padEnd(8)}] 호출 중... (프롬프트 ${prompt.length}자)`);
    const r = await callGemini(prompt, ref.base64, ref.mimeType);
    console.log(`           ${r.ok ? '✓' : '✗'} ${(r.elapsedMs / 1000).toFixed(1)}s ${r.finishReason || (r.error?.substring(0, 80) || '')}`);

    if (r.image) saveImage(r.image, `${cat}-closed.png`);

    results.categories[cat] = {
      ok: r.ok,
      elapsedMs: r.elapsedMs,
      finishReason: r.finishReason,
      error: r.error,
      promptLength: prompt.length,
      usageMetadata: r.usageMetadata,
    };
  }

  writeFileSync(resolve(OUTPUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

  console.log('\n═══ 요약 ═══');
  for (const [cat, r] of Object.entries(results.categories)) {
    console.log(`  ${cat.padEnd(10)} ${r.ok ? '✓' : '✗'} ${(r.elapsedMs / 1000).toFixed(1)}s   프롬프트 ${r.promptLength}자`);
  }
  console.log(`\n이미지: ${OUTPUT_DIR}/{sink,wardrobe,fridge,vanity,shoe,storage}-closed.png`);
  console.log(`프롬프트 본문: ${OUTPUT_DIR}/prompts/{category}.txt`);
  console.log(`메트릭: ${OUTPUT_DIR}/results.json`);
  console.log('\n육안 검증 체크리스트:');
  console.log('  [sink]     싱크볼+수전+쿡탑+슬림 후드, 쿡탑 아래 서랍, 카운터탑-도어 30mm 갭, 핸드리스');
  console.log('  [wardrobe] 짝수 도어(6), 세로 길쭉 비율, 좌대 60mm 보임');
  console.log('  [fridge]   중앙 빌트인 냉장고, 측면 키큰장, 10mm 상단 갭');
  console.log('  [vanity]   상부 거울 명확, 하부 카운터/세면대');
  console.log('  [shoe]     얕은 깊이감(350mm), 매립형 도어');
  console.log('  [storage]  깔끔한 매립형 도어, 색상 통일');
  console.log('  [공통]     핸드리스 J-pull, 크롬바/노브 없음, 한글/숫자 텍스트 없음');
}

main().catch(err => {
  console.error('\n❌ 실패:', err);
  process.exit(1);
});
