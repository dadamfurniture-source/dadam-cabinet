#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// PoC: GPT Image 2 vs Gemini 2.5 Flash Image — 싱크대 카테고리 비교
//
// 같은 프롬프트 + 같은 참조이미지(현장 사진)로 두 모델을 호출하여
// 품질·지연시간·비용을 측정한다. PoC 산출물 — 프로덕션 코드 아님.
//
// 실행:
//   cd mcp-server
//   node scripts/poc-openai-vs-gemini-sink.mjs [참조이미지경로]
//
// 결과:
//   tmp/poc-sink/{provider}-closed.png    이미지
//   tmp/poc-sink/{provider}-open.png      이미지
//   tmp/poc-sink/results.json             메트릭(시간, 토큰, 에러)
// ═══════════════════════════════════════════════════════════════

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

// ─── 설정 ───────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-image';
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

const REFERENCE_IMAGE_PATH = process.argv[2] || resolve(
  __dirname,
  '../../screenshot/testimage/KakaoTalk_20260216_123628816.jpg'
);
const OUTPUT_DIR = resolve(__dirname, '../../tmp/poc-sink');

// 가격 (2026-05 기준, USD per 1M tokens)
const OPENAI_PRICING = {
  textInput: 5.0,
  imageInput: 8.0,
  imageOutput: 30.0,
};

// ─── 싱크대 PoC 프롬프트 (closed-door.prompt.ts의 핵심부 발췌) ───
const SINK_CLOSED_PROMPT = `Generate a photorealistic kitchen sink cabinet installation in this Korean apartment room.

[STYLE]
Modern minimalist Korean apartment kitchen, clean lines, professional architectural photography.

[CABINET LAYOUT]
- Upper cabinets: 4 modules, 600mm each, mounted at 1500mm height
- Lower cabinets: 4 modules, 600mm each, with 1 sink module + 1 cooktop module
- Total length: 2400mm
- Door color: matte white, handleless (J-pull recessed handle on top edge)
- Countertop: snow white quartz, 30mm thick

[CRITICAL — 절대 누락 금지]
The sink cabinet MUST include:
1. SINK BOWL: stainless steel undermount sink, 800mm wide, centered on its module
2. FAUCET: chrome single-lever faucet, mounted behind the sink bowl on the countertop
3. COOKTOP: 4-burner induction cooktop, 600mm wide, flush with countertop
4. RANGE HOOD: white slim hood mounted directly above cooktop, 700mm wide

[HANDLELESS DETAIL]
All doors are handleless. Lower cabinet doors can be opened by reaching behind the door (J-pull recessed top edge). NO chrome bar handles, NO push-to-open buttons visible.

[CAMERA]
Wide-angle interior photo, eye level, front-facing perspective. Show the entire wall with cabinets installed. Realistic lighting, photorealistic rendering.

[CRITICAL]
NO TEXT, NUMBERS, DIMENSIONS, OR LABELS in the image. Clean photograph only.`;

const SINK_OPEN_PROMPT = `Take this kitchen cabinet photo and show all doors and drawers in the OPEN position.

PRESERVE EXACTLY:
- Door count, position, size, color (100% identical)
- Cabinet layout, countertop, sink, cooktop, hood
- Camera angle, perspective, lighting

CHANGE ONLY:
- All upper cabinet swing doors: rotate 90 degrees open, showing interior shelves with dishes/cups
- All lower cabinet drawers: pull out 30-40%, showing interior storage (utensils, pots)
- Sink cabinet doors: open to show plumbing and storage underneath

NO TEXT, NUMBERS, OR LABELS in the image.`;

// ─── 유틸 ───────────────────────────────────────────────────────
function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function loadReferenceImage() {
  if (!existsSync(REFERENCE_IMAGE_PATH)) {
    console.error(`❌ 참조 이미지 없음: ${REFERENCE_IMAGE_PATH}`);
    console.error(`   사용법: node scripts/poc-openai-vs-gemini-sink.mjs <이미지경로>`);
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

function calcOpenaiCost(usage) {
  if (!usage) return null;
  const textIn = (usage.input_tokens_details?.text_tokens || 0) / 1_000_000 * OPENAI_PRICING.textInput;
  const imgIn = (usage.input_tokens_details?.image_tokens || 0) / 1_000_000 * OPENAI_PRICING.imageInput;
  const out = (usage.output_tokens || 0) / 1_000_000 * OPENAI_PRICING.imageOutput;
  return {
    textInputUSD: +textIn.toFixed(6),
    imageInputUSD: +imgIn.toFixed(6),
    outputUSD: +out.toFixed(6),
    totalUSD: +(textIn + imgIn + out).toFixed(6),
  };
}

// ─── Gemini 호출 ────────────────────────────────────────────────
async function callGemini(prompt, referenceImage, mimeType) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 미설정');
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

// ─── OpenAI 호출 ────────────────────────────────────────────────
async function callOpenAIGenerate(prompt) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 미설정');
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt,
      size: '1024x1024',
      quality: 'high',
      n: 1,
    }),
  });
  const elapsedMs = Date.now() - t0;
  const data = await res.json();
  if (!res.ok) return { ok: false, elapsedMs, error: JSON.stringify(data).substring(0, 500) };
  const image = data.data?.[0]?.b64_json || null;
  return { ok: !!image, elapsedMs, image, usage: data.usage || null, cost: calcOpenaiCost(data.usage) };
}

async function callOpenAIEdit(prompt, referenceImageBase64, mimeType) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 미설정');
  const form = new FormData();
  form.append('model', OPENAI_MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('quality', 'high');
  form.append('n', '1');
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const blob = new Blob([Buffer.from(referenceImageBase64, 'base64')], { type: mimeType });
  form.append('image', blob, `reference.${ext}`);

  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  const elapsedMs = Date.now() - t0;
  const data = await res.json();
  if (!res.ok) return { ok: false, elapsedMs, error: JSON.stringify(data).substring(0, 500) };
  const image = data.data?.[0]?.b64_json || null;
  return { ok: !!image, elapsedMs, image, usage: data.usage || null, cost: calcOpenaiCost(data.usage) };
}

// ─── 메인 ───────────────────────────────────────────────────────
async function main() {
  console.log('═══ PoC: GPT Image 2 vs Gemini — 싱크대 ═══\n');
  ensureDir(OUTPUT_DIR);

  const ref = loadReferenceImage();
  console.log(`참조 이미지: ${REFERENCE_IMAGE_PATH} (${ref.sizeKB}KB)`);
  console.log(`출력 디렉토리: ${OUTPUT_DIR}\n`);

  const results = { reference: { path: REFERENCE_IMAGE_PATH, sizeKB: ref.sizeKB }, providers: {} };

  // ─── 1. Gemini: 닫힌 → 열린 (현재 프로덕션 방식) ───
  console.log('[1/2] Gemini 2.5 Flash Image');
  console.log('  → 닫힌도어 생성...');
  const geminiClosed = await callGemini(SINK_CLOSED_PROMPT, ref.base64, ref.mimeType);
  console.log(`     ${geminiClosed.ok ? '✓' : '✗'} ${(geminiClosed.elapsedMs / 1000).toFixed(1)}s ${geminiClosed.finishReason || geminiClosed.error?.substring(0, 100) || ''}`);
  if (geminiClosed.image) saveImage(geminiClosed.image, 'gemini-closed.png');

  let geminiOpen = { ok: false, skipped: true };
  if (geminiClosed.image) {
    console.log('  → 열린도어 생성 (닫힌 이미지 참조)...');
    geminiOpen = await callGemini(SINK_OPEN_PROMPT, geminiClosed.image, 'image/png');
    console.log(`     ${geminiOpen.ok ? '✓' : '✗'} ${(geminiOpen.elapsedMs / 1000).toFixed(1)}s ${geminiOpen.finishReason || geminiOpen.error?.substring(0, 100) || ''}`);
    if (geminiOpen.image) saveImage(geminiOpen.image, 'gemini-open.png');
  }

  results.providers.gemini = {
    closed: { ok: geminiClosed.ok, elapsedMs: geminiClosed.elapsedMs, finishReason: geminiClosed.finishReason, error: geminiClosed.error, usageMetadata: geminiClosed.usageMetadata },
    open: { ok: geminiOpen.ok, elapsedMs: geminiOpen.elapsedMs, finishReason: geminiOpen.finishReason, error: geminiOpen.error, usageMetadata: geminiOpen.usageMetadata },
    totalElapsedMs: (geminiClosed.elapsedMs || 0) + (geminiOpen.elapsedMs || 0),
  };

  // ─── 2. OpenAI: 텍스트→이미지(닫힌) → 편집(열린) ───
  console.log('\n[2/2] OpenAI GPT Image 2');
  console.log('  → 닫힌도어 생성 (text-to-image)...');
  const openaiClosed = await callOpenAIGenerate(SINK_CLOSED_PROMPT);
  console.log(`     ${openaiClosed.ok ? '✓' : '✗'} ${(openaiClosed.elapsedMs / 1000).toFixed(1)}s ${openaiClosed.cost ? `$${openaiClosed.cost.totalUSD}` : openaiClosed.error?.substring(0, 100) || ''}`);
  if (openaiClosed.image) saveImage(openaiClosed.image, 'openai-closed.png');

  let openaiOpen = { ok: false, skipped: true };
  if (openaiClosed.image) {
    console.log('  → 열린도어 생성 (image edit, 닫힌 이미지 참조)...');
    openaiOpen = await callOpenAIEdit(SINK_OPEN_PROMPT, openaiClosed.image, 'image/png');
    console.log(`     ${openaiOpen.ok ? '✓' : '✗'} ${(openaiOpen.elapsedMs / 1000).toFixed(1)}s ${openaiOpen.cost ? `$${openaiOpen.cost.totalUSD}` : openaiOpen.error?.substring(0, 100) || ''}`);
    if (openaiOpen.image) saveImage(openaiOpen.image, 'openai-open.png');
  }

  const openaiTotalCost = (openaiClosed.cost?.totalUSD || 0) + (openaiOpen.cost?.totalUSD || 0);
  results.providers.openai = {
    model: OPENAI_MODEL,
    closed: { ok: openaiClosed.ok, elapsedMs: openaiClosed.elapsedMs, usage: openaiClosed.usage, cost: openaiClosed.cost, error: openaiClosed.error },
    open: { ok: openaiOpen.ok, elapsedMs: openaiOpen.elapsedMs, usage: openaiOpen.usage, cost: openaiOpen.cost, error: openaiOpen.error },
    totalElapsedMs: (openaiClosed.elapsedMs || 0) + (openaiOpen.elapsedMs || 0),
    totalCostUSD: +openaiTotalCost.toFixed(6),
  };

  // ─── 결과 저장 + 요약 ───
  writeFileSync(resolve(OUTPUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

  console.log('\n═══ 요약 ═══');
  console.log(`Gemini 총 시간:  ${(results.providers.gemini.totalElapsedMs / 1000).toFixed(1)}s`);
  console.log(`OpenAI 총 시간:  ${(results.providers.openai.totalElapsedMs / 1000).toFixed(1)}s`);
  console.log(`OpenAI 총 비용:  $${results.providers.openai.totalCostUSD}`);
  console.log(`\n결과 파일: ${resolve(OUTPUT_DIR, 'results.json')}`);
  console.log(`이미지: ${OUTPUT_DIR}/{gemini,openai}-{closed,open}.png`);
  console.log('\n육안 비교 체크리스트:');
  console.log('  [ ] 싱크볼 + 수전 표시 여부');
  console.log('  [ ] 쿡탑 + 후드 표시 여부');
  console.log('  [ ] 핸드리스(매립형) 손잡이 — 크롬바/푸시버튼 없음');
  console.log('  [ ] 한글 텍스트/라벨이 이미지에 들어가지 않음');
  console.log('  [ ] 도어 개수·색상·크기 일관성 (닫힘 vs 열림)');
}

main().catch(err => {
  console.error('\n❌ PoC 실패:', err);
  process.exit(1);
});
