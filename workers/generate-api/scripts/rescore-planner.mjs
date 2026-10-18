#!/usr/bin/env node
/**
 * 플래너 모드 재채점 (2026-10-19) — 이미 만든 결과 사진을 새 역판독(layout.js §4)으로 다시 읽어 점수를 낸다.
 * 워커가 잡에서 하는 것과 같은 함수(buildPlannerReadPrompt · normalizePlannerRead · compareLayoutToSpec)를 부른다.
 *
 * 키는 환경 변수 ANTHROPIC_API_KEY 에서만 읽는다 (저장소에 두지 않는다). 모델은 ANTHROPIC_MODEL (기본 claude-opus-5).
 * 사용법은 같은 폴더 README.md.
 *
 *   node scripts/rescore-planner.mjs --spec d1.json --folder <공개 폴더 URL> [--old] [--out r.json]
 *   node scripts/rescore-planner.mjs --spec d1.json --photo <URL> --elevation <URL>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import {
  LAYOUT_SCHEMA,
  PLANNER_READ_SCHEMA,
  buildLayoutPrompt,
  buildPlannerReadPrompt,
  normalizeLayout,
  normalizePlannerRead,
} from '../src/layout.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { callClaudeJson } from '../src/claude.js';

const HELP = `usage: node scripts/rescore-planner.mjs --spec <design_spec.json> (--folder <url> | --photo <url> [--elevation <url>])
  --spec       design_spec JSON 파일 (generations 행을 통째로 줘도 된다 — options.design_spec 을 꺼낸다)
  --folder     결과 폴더 URL — base.jpg 와 render-elevation_labeled.png(없으면 render-elevation.png)를 쓴다
  --photo      결과 사진 URL (--folder 대신)
  --elevation  정면 입면 URL (--folder 대신, 생략하면 입면 없이 글 목록만)
  --labeled    --elevation 이 번호 입면이면 붙인다 (--folder 는 파일 이름으로 안다)
  --category   품목 (기본: spec.category, 없으면 sink)
  --wall       벽 WxH mm (기본 3000x2400) — --old 의 옛 판독에만 쓴다
  --old        옛 판독(사진 한 장)도 같이 돌려 나란히 보인다
  --out        결과 JSON 파일`;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (['old', 'labeled', 'help'].includes(k)) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType: res.headers.get('content-type') || (/\.png$/i.test(url) ? 'image/png' : 'image/jpeg'), url };
}

function loadSpec(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (j && j.options && j.options.design_spec) return { spec: j.options.design_spec, row: j };
  if (j && j.design_spec) return { spec: j.design_spec, row: j };
  return { spec: j, row: null };
}

function table(layout) {
  return layout.units
    .map((u) => `  ${u.id.padEnd(4)} plan ${u.expected.seen}/${u.expected.doors}d+${u.expected.drawers}dr  read ${u.seen}/${u.doors}d+${u.drawers}dr`)
    .join('\n');
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.help || !a.spec || (!a.folder && !a.photo)) {
    console.log(HELP);
    process.exit(a.help ? 0 : 2);
  }
  const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL };
  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY 환경 변수가 없습니다.');
    process.exit(2);
  }
  const { spec, row } = loadSpec(a.spec);
  const category = a.category || (row && row.category) || spec.category || 'sink';

  const folder = a.folder ? a.folder.replace(/\/+$/, '') : null;
  const photo = await fetchImage(a.photo || `${folder}/base.jpg`);
  if (!photo) throw new Error('결과 사진을 읽지 못했습니다');
  let elevation = null;
  let kind = null;
  if (folder) {
    elevation = await fetchImage(`${folder}/render-elevation_labeled.png`);
    kind = elevation ? 'labeled' : null;
    if (!elevation) {
      elevation = await fetchImage(`${folder}/render-elevation.png`);
      kind = elevation ? 'plain' : null;
    }
  } else if (a.elevation) {
    elevation = await fetchImage(a.elevation);
    kind = elevation ? (a.labeled ? 'labeled' : 'plain') : null;
  }

  const pctx = { category, designSpec: spec, elevation: kind };
  const t0 = Date.now();
  const { json: raw, model } = await callClaudeJson(env, {
    prompt: buildPlannerReadPrompt(pctx),
    images: elevation ? [photo, elevation] : [photo],
    schema: PLANNER_READ_SCHEMA,
  });
  const layout = normalizePlannerRead(raw, { ...pctx, model, now: new Date().toISOString() });
  layout.verify = compareLayoutToSpec(layout, spec, category);
  layout.elapsed_ms = Date.now() - t0;
  const result = { photo: photo.url, elevation: elevation && elevation.url, elevationKind: kind, planner: layout };

  if (a.old) {
    const [w, h] = String(a.wall || '3000x2400').split('x').map(Number);
    const lctx = { category, wallAnalysis: (row && row.wall_analysis) || { wallW: w, wallH: h }, options: (row && row.options) || {} };
    const o = await callClaudeJson(env, { prompt: buildLayoutPrompt(lctx), image: photo, schema: LAYOUT_SCHEMA });
    const old = normalizeLayout(o.json, { ...lctx, model: o.model, now: new Date().toISOString() });
    old.verify = compareLayoutToSpec(old, spec, category);
    result.old = old;
  }

  const v = layout.verify;
  console.log(`new  ok=${v.ok} score=${v.score}/${v.max} elevation=${kind || 'none'} shape=${layout.shape} (${layout.elapsed_ms}ms, ${model})`);
  console.log(`     floor doors ${v.read.floorDoors}+${v.read.floorDrawers}dr / upper doors ${v.read.upperDoors ?? '-'}  (plan ${v.expected.floorDoors}+${v.expected.floorDrawers} / ${v.expected.upperDoors ?? '-'})`);
  console.log(table(layout));
  v.issues.forEach((s) => console.log(`     - ${s}`));
  if (result.old) {
    const ov = result.old.verify;
    console.log(`old  ok=${ov.ok} score=${ov.score}/${ov.max} floor doors ${ov.read.floorDoors}+${ov.read.floorDrawers}dr / upper ${ov.read.upperDoors ?? '-'}`);
    ov.issues.forEach((s) => console.log(`     - ${s}`));
  }
  if (a.out) writeFileSync(a.out, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
