#!/usr/bin/env node
/**
 * 홍보용 「촬영 연출」 사진 찍기 (2026-11-20). 프롬프트는 src/shoot-prompts.js.
 *
 *   node scripts/shoot.mjs --out <폴더> [--count 6] [--seed 20261120] [--subjects kitchen,wardrobe]
 *                          [--only 1,3] [--ratio 4:5] [--recolour 2] [--dry] [--env <파일>,<파일>]
 *
 *   --dry       찍지 않고 목록과 프롬프트만 manifest.json 에 적는다
 *   --only      목록에서 이 번호만 찍는다 (1부터)
 *   --recolour  바탕 한 장마다 색만 바꾼 장을 n 장 더 (「같은 주방, 다른 색」)
 *   --env       KEY=VALUE 파일에서 GEMINI_API_KEY 를 읽는다 (예: .dev.vars). 값은 찍지 않는다
 *
 * 키는 GEMINI_API_KEY (워커와 같은 모델 gemini-3-pro-image, 2K). 한 장마다 구글 요금이 든다.
 * 「AI 연출」 표시는 여기서 넣지 않는다 — 올리는 단계에서 찍는다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callGemini, imageModel } from '../src/gemini.js';
import { SHOOT_TONES } from '../src/shoot-prompts.js';
import { planShoots, buildShootPrompt, buildShootRecolourPrompt } from '../src/shoot-prompts.js';

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    o[k] = v;
  }
  return o;
}

async function loadEnvFiles(list) {
  for (const f of String(list || '')
    .split(',')
    .filter(Boolean)) {
    const text = await readFile(f, 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.out) throw new Error('--out <폴더> 가 필요합니다');
  await loadEnvFiles(a.env);
  const count = Number(a.count) || 6;
  const seed = Number(a.seed) || 1;
  const ratio = typeof a.ratio === 'string' ? a.ratio : '4:5';
  const recolour = Math.max(0, Number(a.recolour) || 0);
  const subjects = typeof a.subjects === 'string' ? a.subjects.split(',') : undefined;
  const only = typeof a.only === 'string' ? a.only.split(',').map(Number) : null;

  const plan = planShoots({ count, seed, subjects });
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL,
  };
  await mkdir(a.out, { recursive: true });
  const manifest = {
    seed,
    ratio,
    model: imageModel(env),
    made_at: new Date().toISOString(),
    shots: [],
  };

  for (let i = 0; i < plan.length; i++) {
    const s = plan[i];
    const prompt = buildShootPrompt(s);
    const row = {
      id: s.id,
      subject: s.subject,
      layout: s.layout.label,
      home: s.home.label,
      shot: s.shot.label,
      light: s.light.label,
      tone: s.tone.tone,
      surface: s.surface ? s.surface.label : null,
      floor: s.floor.label,
      table: s.table.label,
      prompt,
      file: null,
      variants: [],
    };
    manifest.shots.push(row);
    if (a.dry || (only && !only.includes(i + 1))) continue;
    if (!env.GEMINI_API_KEY)
      throw new Error('GEMINI_API_KEY 가 없습니다 (--env 로 파일을 주거나 환경 변수로)');

    const t0 = Date.now();
    const base = await callGemini(env, {
      prompt,
      imageSize: '2K',
      aspectRatio: ratio,
      temperature: 0.9,
    });
    if (!base.image)
      throw new Error(
        `${s.id}: 이미지가 오지 않았습니다 — ${String(base.text || '').slice(0, 120)}`
      );
    row.file = `${s.id}.${EXT[base.imageMime] || 'png'}`;
    await writeFile(path.join(a.out, row.file), Buffer.from(base.image, 'base64'));
    console.log(
      `찍음 ${row.file} · ${row.layout} · ${row.shot} · ${row.light} · ${row.tone} (${Math.round((Date.now() - t0) / 1000)}초)`
    );

    // 색만 바꾼 장 — 이 장의 색을 뺀 나머지에서 차례로
    const others = SHOOT_TONES.filter((t) => t.key !== s.tone.key);
    for (let v = 0; v < recolour && v < others.length; v++) {
      const tone = others[(i + v) % others.length];
      const r = await callGemini(env, {
        prompt: buildShootRecolourPrompt(s, tone),
        images: [{ base64: base.image, mimeType: base.imageMime || 'image/png' }],
        imageSize: '2K',
        aspectRatio: ratio,
      });
      if (!r.image) continue;
      const file = `${s.id}--${tone.key}.${EXT[r.imageMime] || 'png'}`;
      await writeFile(path.join(a.out, file), Buffer.from(r.image, 'base64'));
      row.variants.push({ tone: tone.tone, file });
      console.log(`  색 바꿈 ${file} · ${tone.tone}`);
    }
  }
  await writeFile(path.join(a.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`목록 ${path.join(a.out, 'manifest.json')} · ${manifest.shots.length}장 계획`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
