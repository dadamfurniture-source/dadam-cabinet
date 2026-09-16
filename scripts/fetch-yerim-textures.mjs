#!/usr/bin/env node
// ============================================================
// 예림 LUX 자재 스와치 → 타일 텍스처 파이프라인
//
//   database/seed/yerim-lux.json 의 image_url 144장을
//     1) 내려받아 tmp/yerim-swatches/ 에 캐시하고 (tmp/ 는 .gitignore)
//     2) 흰 테두리를 잘라낸 뒤 가운데 정사각형으로 맞추고
//     3) 512×512 JPEG(품질 82)로 assets/materials/yerim/<code>.jpg 에 저장하고
//     4) 잘라낸 타일의 **선형광(linear-light) 평균색**을 다시 계산한다.
//
// 왜 선형광인가: 처음 시드(2026-09-15)는 sRGB 값을 그대로 평균했다. sRGB 는 감마가 실린
//   값이라 그대로 더하면 어두운 쪽으로 치우친다. 사람이 보는 밝기대로 평균하려면
//   sRGB → 선형 → 평균 → sRGB 로 돌아와야 한다. 나뭇결처럼 밝고 어두운 줄이 섞인
//   자재일수록 차이가 크다(실물보다 탁하고 어둡게 보이던 원인).
//
// 내려받기: 호스트에서 node fetch 가 막혀 있어 curl 을 쓴다. 예림 서버는 UA/Referer 가
//   없으면 거절하므로 둘 다 붙인다. 예의상 순차 + 지연, 실패하면 한 번 재시도.
//
// 쓰는 법:
//   node scripts/fetch-yerim-textures.mjs              # 내려받기 + 타일 + 색 계산 (보고만)
//   node scripts/fetch-yerim-textures.mjs --write-seed # 위 + 시드 JSON 의 color_hex·texture_url·tile_mm 갱신
//   node scripts/fetch-yerim-textures.mjs --force      # 캐시 무시하고 다시 내려받기
//   node scripts/fetch-yerim-textures.mjs --only YR-MB-05,YR-SM-01
//
// 의존성: jimp (devDependency 전용 — 앱 번들에는 들어가지 않는다. 정적 HTML 이라 런타임 의존성 없음).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Jimp = require('jimp');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = path.join(ROOT, 'database/seed/yerim-lux.json');
const CACHE_DIR = path.join(ROOT, 'tmp/yerim-swatches');
const OUT_DIR = path.join(ROOT, 'assets/materials/yerim');

export const TILE_PX = 512;
export const JPEG_QUALITY = 82;

/**
 * 테두리 판정 기준: 한 줄의 **평균** 색차(0~255)가 이 값을 넘으면 그 줄부터 내용이다.
 * 예림 스와치의 테두리는 완전한 흰색(255,255,255)이라 평균 색차가 정확히 0 이고,
 * 자재가 거의 흰색(예 화이트엠보 #fbf7f9)이어도 평균 색차가 4~5 는 나온다.
 * 한 점만 보면(최대값) 자재가 흰색일 때 테두리와 구분이 안 되므로 평균을 쓴다.
 */
const BORDER_THRESHOLD = 1.5;
/** 테두리를 찾아도 JPEG 링잉이 남으므로 안쪽으로 조금 더 민다 (잘라낸 변의 1%). */
const SAFETY_INSET_RATIO = 0.01;
/** 테두리 검출이 실패했을 때(전면 자재 사진 등) 쓰는 고정 여백 — 예림 테두리(약 7.5%)보다 넉넉히. */
const FALLBACK_INSET_RATIO = 0.09;

/**
 * tile_mm — 스와치 한 장이 실제 가구 면에서 몇 mm 를 덮는가. type 별로 하나씩 정한다.
 *
 *   우드(결이 있는 시트: PP·PVC·MFB·MFC) = 600mm
 *     예림 원판 폭이 1220mm 이고 도어 한 짝이 보통 400~600mm 다. 600 으로 두면 도어 한 짝에
 *     결 한 폭이 들어가 실제 무늬목 랩핑과 같은 크기로 읽힌다. 더 작게 하면 결이 잘게 반복돼
 *     프린트처럼 보이고, 더 크게 하면 한 면에 결이 한 줄만 지나가 밋밋해진다.
 *
 *   무지(Acryl·Glass·PET·PET Matt·PET Glossy·UV) = 300mm
 *     무늬가 없고 미세한 엠보·질감뿐이라 타일 이음이 보이지 않는다. 작게 깔아야 질감 알갱이가
 *     실제 크기에 가깝고, 큰 면에서도 흐려지지 않는다.
 */
export const TILE_MM_BY_TYPE = {
  PP: 600,
  PVC: 600,
  MFB: 600,
  MFC: 600,
  Acryl: 300,
  Glass: 300,
  PET: 300,
  'PET Matt': 300,
  'PET Glossy': 300,
  UV: 300,
};

export function tileMmFor(type) {
  return TILE_MM_BY_TYPE[type] || 300;
}

/** 저장소 기준 상대 경로 — 플래너 페이지와 같은 출처라 CORS 도 자격증명도 필요 없다. */
export function textureUrlFor(code) {
  return `assets/materials/yerim/${code}.jpg`;
}

// ── 색 ────────────────────────────────────────────────────────

export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

export function hexOf(r, g, b) {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** bitmap({width,height,data:RGBA}) 의 선형광 평균 → sRGB hex. */
export function averageHexLinear(bitmap) {
  const { width, height, data } = bitmap;
  let r = 0, g = 0, b = 0;
  const n = width * height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    r += srgbToLinear(data[o]);
    g += srgbToLinear(data[o + 1]);
    b += srgbToLinear(data[o + 2]);
  }
  return hexOf(linearToSrgb(r / n), linearToSrgb(g / n), linearToSrgb(b / n));
}

/** 참고용 — 처음 시드가 쓰던 sRGB 공간 평균 (before/after 비교에 쓴다). */
export function averageHexSrgb(bitmap) {
  const { width, height, data } = bitmap;
  let r = 0, g = 0, b = 0;
  const n = width * height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    r += data[o]; g += data[o + 1]; b += data[o + 2];
  }
  const q = (v) => Math.max(0, Math.min(255, Math.round(v / n)));
  return hexOf(q(r), q(g), q(b));
}

// ── 테두리 검출 ────────────────────────────────────────────────

/**
 * 네 변에서 안쪽으로 훑어 모서리 색과 처음으로 달라지는 줄을 찾는다.
 * 찾지 못하면(= 전면이 자재) 고정 5% 안쪽으로 물러선다.
 * @returns {{x:number,y:number,w:number,h:number,detected:boolean}}
 */
export function detectContentBox(bitmap, threshold = BORDER_THRESHOLD) {
  const { width: W, height: H, data } = bitmap;
  const at = (x, y) => {
    const o = (y * W + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const corner = at(0, 0);
  const diff = (p) => Math.max(
    Math.abs(p[0] - corner[0]), Math.abs(p[1] - corner[1]), Math.abs(p[2] - corner[2]),
  );
  const rowHit = (y) => {
    let s = 0;
    for (let x = 0; x < W; x += 1) s += diff(at(x, y));
    return s / W > threshold;
  };
  const colHit = (x) => {
    let s = 0;
    for (let y = 0; y < H; y += 1) s += diff(at(x, y));
    return s / H > threshold;
  };

  let top = 0; while (top < H && !rowHit(top)) top += 1;
  let bottom = H - 1; while (bottom > top && !rowHit(bottom)) bottom -= 1;
  let left = 0; while (left < W && !colHit(left)) left += 1;
  let right = W - 1; while (right > left && !colHit(right)) right -= 1;

  const w = right - left + 1;
  const h = bottom - top + 1;
  const tooSmall = w < W * 0.3 || h < H * 0.3;
  if (top >= H || left >= W || tooSmall) {
    const ix = Math.round(W * FALLBACK_INSET_RATIO);
    const iy = Math.round(H * FALLBACK_INSET_RATIO);
    return { x: ix, y: iy, w: W - ix * 2, h: H - iy * 2, detected: false };
  }
  return { x: left, y: top, w, h, detected: true };
}

/** 안전 여백을 물리고 가운데 정사각형으로 맞춘다. */
export function squareInside(box) {
  const inset = Math.round(Math.min(box.w, box.h) * SAFETY_INSET_RATIO);
  const x = box.x + inset;
  const y = box.y + inset;
  const w = Math.max(1, box.w - inset * 2);
  const h = Math.max(1, box.h - inset * 2);
  const side = Math.min(w, h);
  return {
    x: x + Math.floor((w - side) / 2),
    y: y + Math.floor((h - side) / 2),
    w: side,
    h: side,
    detected: box.detected,
  };
}

// ── 내려받기 ───────────────────────────────────────────────────

/** 순차 실행이라 동기 대기가 가장 간단하다 (전체 144장 × 120ms ≈ 17초). CPU 를 돌리지 않는다. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function curl(url, dest) {
  execFileSync('curl', [
    '-sS', '--fail', '--location', '--max-time', '60',
    '-H', 'User-Agent: Mozilla/5.0',
    '-H', 'Referer: https://www.yerim.net/',
    '-o', dest, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function download(url, dest, { force = false } = {}) {
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1024) return 'cached';
  try {
    curl(url, dest);
    return 'downloaded';
  } catch {
    sleep(1500);
    curl(url, dest);           // 한 번만 재시도 — 여기서도 실패하면 위로 던진다
    return 'downloaded(retry)';
  }
}

// ── 본작업 ────────────────────────────────────────────────────

export async function tileOne(item, opts = {}) {
  const src = path.join(CACHE_DIR, `${item.code}.jpg`);
  const how = download(item.image_url, src, opts);

  const img = await Jimp.read(src);
  const box = squareInside(detectContentBox(img.bitmap));
  const cropped = img.clone().crop(box.x, box.y, box.w, box.h);

  const before = averageHexSrgb(cropped.bitmap);      // 옛 방식(참고)
  const after = averageHexLinear(cropped.bitmap);     // 새 방식(정본)

  const out = path.join(OUT_DIR, `${item.code}.jpg`);
  await cropped.resize(TILE_PX, TILE_PX, Jimp.RESIZE_BICUBIC).quality(JPEG_QUALITY).writeAsync(out);

  return {
    code: item.code,
    color_name: item.color_name,
    type: item.type,
    grain: item.grain,
    how,
    detected: box.detected,
    crop: `${box.w}×${box.h}`,
    seeded_hex: item.color_hex,
    srgb_mean: before,
    linear_mean: after,
    tile_mm: tileMmFor(item.type),
    texture_url: textureUrlFor(item.code),
    bytes: fs.statSync(out).size,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const writeSeed = argv.includes('--write-seed');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(String(argv[onlyIdx + 1] || '').split(',').filter(Boolean)) : null;

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const items = seed.items.filter((i) => !only || only.has(i.code));

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rows = [];
  const failed = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    try {
      const r = await tileOne(it, { force });
      rows.push(r);
      process.stdout.write(`[${i + 1}/${items.length}] ${r.code} ${r.how} crop ${r.crop}`
        + `${r.detected ? '' : ' (테두리 검출 실패 → 5% 고정)'} ${r.seeded_hex} → ${r.linear_mean}`
        + ` ${(r.bytes / 1024).toFixed(0)}KB\n`);
    } catch (e) {
      failed.push({ code: it.code, url: it.image_url, error: String(e.message || e).slice(0, 200) });
      process.stdout.write(`[${i + 1}/${items.length}] ${it.code} 실패: ${e.message}\n`);
    }
    if (i < items.length - 1) sleep(120);   // 예의상 지연
  }

  const total = rows.reduce((s, r) => s + r.bytes, 0);
  process.stdout.write(`\n타일 ${rows.length}장 · 합계 ${(total / 1024 / 1024).toFixed(2)} MB`
    + ` · 평균 ${(total / 1024 / Math.max(1, rows.length)).toFixed(0)} KB\n`);
  if (failed.length) {
    process.stdout.write(`실패 ${failed.length}건:\n${failed.map((f) => ` - ${f.code} ${f.url} ${f.error}`).join('\n')}\n`);
  }

  const reportPath = path.join(CACHE_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ rows, failed, total }, null, 1) + '\n', 'utf8');
  process.stdout.write(`보고서: ${path.relative(ROOT, reportPath)}\n`);

  if (writeSeed) {
    if (failed.length) throw new Error('실패한 스와치가 있어 시드를 갱신하지 않는다 — 먼저 다시 받아라');
    if (only) throw new Error('--only 로 일부만 만들었을 때는 시드를 갱신하지 않는다');
    const byCode = new Map(rows.map((r) => [r.code, r]));
    for (const it of seed.items) {
      const r = byCode.get(it.code);
      if (!r) continue;
      it.color_hex = r.linear_mean;
      it.texture_url = r.texture_url;
      it.tile_mm = r.tile_mm;
    }
    seed.note = seed.note.replace(
      /hex 는 스와치 이미지 중앙 60% 의 평균색\(브라우저 canvas\)\./,
      'hex 는 잘라낸 타일 전체의 선형광 평균색(scripts/fetch-yerim-textures.mjs, 2026-09-16 재계산).'
      + ' texture_url 은 같은 스크립트가 만든 512px 타일(assets/materials/yerim/<code>.jpg),'
      + ' tile_mm 은 type 별 물리 크기.',
    );
    seed.textures = {
      generated_at: '2026-09-16',
      script: 'scripts/fetch-yerim-textures.mjs',
      tile_px: TILE_PX,
      jpeg_quality: JPEG_QUALITY,
      tile_mm_by_type: TILE_MM_BY_TYPE,
    };
    fs.writeFileSync(SEED_PATH, JSON.stringify(seed, null, 1) + '\n', 'utf8');
    process.stdout.write(`시드 갱신: ${path.relative(ROOT, SEED_PATH)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
