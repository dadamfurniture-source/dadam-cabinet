#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Fridge Cabinet A/B test: OpenAI gpt-image-2 vs Gemini 3.1 Flash Image
//
// Mirrors the fridge prompt logic in src/routes/generate.route.ts so
// both providers receive identical prompt + wall photo. Saves outputs
// under scripts/out/ for manual comparison.
//
// Usage:
//   node test-openai-fridge.mjs <wall-photo.jpg> [--gemini-only|--openai-only]
//
// Env:
//   OPENAI_API_KEY   required (unless --gemini-only)
//   GEMINI_API_KEY   required (unless --openai-only)
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '.env') });

// ─── CLI args ───
const args = process.argv.slice(2);
const flagGeminiOnly = args.includes('--gemini-only');
const flagOpenAIOnly = args.includes('--openai-only');
const imgArg = args.find(a => !a.startsWith('--'));
if (!imgArg) {
  console.error('Usage: node test-openai-fridge.mjs <wall-photo.jpg> [--gemini-only|--openai-only]');
  process.exit(1);
}

const IMG_PATH = resolve(process.cwd(), imgArg);
if (!existsSync(IMG_PATH)) {
  console.error(`Image not found: ${IMG_PATH}`);
  process.exit(1);
}

const OUT_DIR = resolve(__dirname, 'scripts/out/fridge-ab');
mkdirSync(OUT_DIR, { recursive: true });

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!flagGeminiOnly && !OPENAI_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }
if (!flagOpenAIOnly && !GEMINI_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// ─── Prompt logic mirrored from src/routes/generate.route.ts ───
const CATEGORY_SUBJECT_FRIDGE = 'tall pantry and refrigerator surround cabinet';
const BASE_ACHROMATICS = ['white', 'milk white', 'sand gray', 'light gray', 'fog gray', 'cashmere'];
const ALT_TWO_TONES = [
  { upper: 'cream white', lower: 'deep forest green' },
  { upper: 'white',       lower: 'navy blue' },
  { upper: 'light gray',  lower: 'deep purple' },
  { upper: 'sand beige',  lower: 'terracotta' },
  { upper: 'cashmere',    lower: 'walnut wood' },
  { upper: 'milk white',  lower: 'natural oak wood' },
  { upper: 'fog gray',    lower: 'concrete charcoal' },
  { upper: 'ivory',       lower: 'matte black' },
  { upper: 'warm white',  lower: 'olive green' },
  { upper: 'pale taupe',  lower: 'burgundy' },
];
const BASE_COUNTERTOPS = [
  { name: 'Sanded Icicle',  desc: 'white with fine sand speckles' },
  { name: 'Aspen Snow',     desc: 'clean snow white with fine grain pattern' },
  { name: 'Pebble Ice',     desc: 'icy white with small pebble flecks' },
  { name: 'Tempest Dawn',   desc: 'soft white with flowing tempest veining' },
];

// ─── Fridge-specific config (edit these to tweak per-test) ───
const FRIDGE_FORM = '3door';                 // '1door' | '3door' | '4door'
const FRIDGE_BRAND_HINT = 'Samsung Bespoke'; // 'Samsung Bespoke' | 'LG Objet'

// Mirrors SINK_DETAILS pattern in generate.route.ts:236 — compact category spec.
const FRIDGE_DETAILS = `Structure: tall pantry column (~600mm) + refrigerator recess + upper bridge cabinet spanning the top. Refrigerator: ${FRIDGE_BRAND_HINT} ${FRIDGE_FORM} built-in style, panel-ready or matching cabinet tone. ALL cabinet doors and panels: matte flat-panel, handleless, seamless reveals, no visible hardware. NO chrome bars, NO push-to-open buttons — lower cabinet doors can be opened by reaching behind the door.`;

// Background + alcove locks — drawn from workers/generate-api/src/prompts/fridge-prompt.js patterns (lines 89-142).
const BACKGROUND_LOCK = `[BACKGROUND LOCK] Preserve walls, floor, ceiling lights, electrical outlets, window frames, and camera angle at pixel level. Do NOT alter anything outside the fridge cabinet footprint.`;
const ALCOVE_LOCK = `[ALCOVE] If the photo shows an alcove frame or built-in wall opening, KEEP the frame intact and install cabinets ONLY inside the interior opening. Do NOT extend past the frame edges.`;

function buildBasePrompt(color, countertop, wallW) {
  const ctDesc = `"${countertop.name}" (${countertop.desc})`;
  return `${BACKGROUND_LOCK}
${ALCOVE_LOCK}
Edit photo: install ${CATEGORY_SUBJECT_FRIDGE}.
[COLOR FIXED] ALL cabinets must be "${color}" — matte flat panel, exactly this color, no variation.
[COUNTERTOP FIXED] Countertop must be ${ctDesc}. Use this exact color/pattern.
[GEOMETRY] Wall ~${wallW}mm.
${FRIDGE_DETAILS}
No clutter.`;
}

function buildAltPrompt(upper, lower, countertop, wallW) {
  const ctDesc = `"${countertop.name}" (${countertop.desc})`;
  return `${BACKGROUND_LOCK}
${ALCOVE_LOCK}
Edit photo: install ${CATEGORY_SUBJECT_FRIDGE}.
[TWO-TONE FIXED] Upper cabinets: "${upper}" (matte flat panel). Lower cabinets: "${lower}" (matte flat panel). Use EXACTLY these colors, no substitution.
[COUNTERTOP FIXED] Countertop must be ${ctDesc}. Use this exact color/pattern.
[GEOMETRY] Wall ~${wallW}mm.
${FRIDGE_DETAILS}
No clutter.`;
}

// ─── Image loading ───
const imgBuffer = readFileSync(IMG_PATH);
const imgBase64 = imgBuffer.toString('base64');
const ext = extname(IMG_PATH).toLowerCase();
const MIME = ext === '.png' ? 'image/png' : 'image/jpeg';

// ─── Gemini call (same payload as generate.route.ts callGemini) ───
async function callGemini(prompt) {
  const model = 'gemini-3.1-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts: [
      { inlineData: { mimeType: MIME, data: imgBase64 } },
      { text: prompt },
    ]}],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let image, text;
  for (const p of parts) {
    if (p.inlineData?.data) image = p.inlineData.data;
    if (p.text) text = p.text;
  }
  return { image, text, elapsed, status: res.status, raw: data };
}

// ─── OpenAI gpt-image-2 edit call ───
// https://platform.openai.com/docs/api-reference/images/createEdit
async function callOpenAI(prompt) {
  const form = new FormData();
  // If status=400 with "model not found", fall back to 'gpt-image-1'.
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('n', '1');
  // gpt-image-2 returns base64 by default; no response_format param needed.
  form.append('image', new Blob([imgBuffer], { type: MIME }), basename(IMG_PATH));

  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  const image = data?.data?.[0]?.b64_json;
  return { image, elapsed, status: res.status, raw: data };
}

// ─── Save helper ───
function saveImage(providerName, variant, base64) {
  if (!base64) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(OUT_DIR, `${ts}_${providerName}_${variant}.png`);
  writeFileSync(outPath, Buffer.from(base64, 'base64'));
  return outPath;
}

// ─── Main ───
async function runProvider(providerName, callFn, prompts) {
  console.log(`\n── ${providerName} ──`);
  const results = [];
  for (const { variant, prompt } of prompts) {
    process.stdout.write(`  ${variant}: `);
    try {
      const r = await callFn(prompt);
      if (r.image) {
        const out = saveImage(providerName, variant, r.image);
        console.log(`OK  ${(r.elapsed / 1000).toFixed(1)}s  → ${out}`);
        results.push({ variant, ok: true, elapsed: r.elapsed, path: out });
      } else {
        console.log(`FAIL status=${r.status}  elapsed=${(r.elapsed / 1000).toFixed(1)}s`);
        console.log('  raw:', JSON.stringify(r.raw).substring(0, 300));
        results.push({ variant, ok: false, elapsed: r.elapsed, status: r.status });
      }
    } catch (e) {
      console.log(`ERROR  ${e.message}`);
      results.push({ variant, ok: false, error: e.message });
    }
  }
  return results;
}

async function main() {
  const wallW = 3000;
  const baseColor = BASE_ACHROMATICS[0];
  const baseCT = BASE_COUNTERTOPS[0];
  const altPick = ALT_TWO_TONES[0];
  const altCT = BASE_COUNTERTOPS[1];

  const prompts = [
    { variant: 'base', prompt: buildBasePrompt(baseColor, baseCT, wallW) },
    { variant: 'alt',  prompt: buildAltPrompt(altPick.upper, altPick.lower, altCT, wallW) },
  ];

  console.log('=== Fridge Cabinet A/B Test ===');
  console.log(`Image: ${IMG_PATH}`);
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`\nPrompts:`);
  prompts.forEach(p => console.log(`  [${p.variant}] ${p.prompt}`));

  const summary = {};
  if (!flagOpenAIOnly) summary.gemini = await runProvider('gemini', callGemini, prompts);
  if (!flagGeminiOnly) summary.openai = await runProvider('openai', callOpenAI, prompts);

  console.log('\n=== SUMMARY ===');
  for (const [provider, results] of Object.entries(summary)) {
    const okCount = results.filter(r => r.ok).length;
    const avgMs = results.filter(r => r.ok).reduce((s, r) => s + r.elapsed, 0) / Math.max(1, okCount);
    console.log(`  ${provider}: ${okCount}/${results.length} ok, avg ${(avgMs / 1000).toFixed(1)}s`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
