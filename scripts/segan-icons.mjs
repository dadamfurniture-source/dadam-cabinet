#!/usr/bin/env node
// ============================================================
// SEGAN 앱 아이콘 · 워드마크 만들기 — segan/icons/ 의 SVG·PNG 를 매번 같은 결과로 다시 만든다.
//
//   워드마크: 「SEGAN」 Noto Sans KR 굵기 200, 자간 0.46em, 잉크 #2D2A26
//   앱 아이콘: 네이비 타일 #0B2545 가운데 「S」 하나 (굵기 200, #F6F3EE)
//              S 의 잉크 높이 = 타일 높이의 60% (마스커블은 80% 안전 영역에 맞춰 48%)
//              모서리는 각지게 둔다 — 둥글리기는 OS 가 한다.
//
// 글꼴을 불러오지 않는다. 글리프 윤곽(아래 GLYPHS)은 Noto Sans KR ExtraLight(굵기 200 인스턴스,
// SIL Open Font License 1.1) 의 S·E·G·A·N 을 SVG 경로로 옮겨 둔 것이다 (단위: 1000/em, y 위쪽).
// PNG 는 이 경로를 직접 래스터화해 만든다 (스캔라인 · 세로 32단 슈퍼샘플 · 가로는 정확한 면적).
// 헤드리스 브라우저 · 이미지 라이브러리 없이 node 내장 모듈(zlib)만 쓴다.
//
// 쓰는 법: node scripts/segan-icons.mjs
//   → segan/icons/ 아래 파일을 모두 다시 쓴다. 바뀐 파일만 커밋하면 된다.
//   아이콘 그림을 바꾸면 npm run asset-version 으로 자산 버전도 올린다 (?v= 로 캐시를 깬다).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'segan/icons');

export const NAVY = '#0b2545';
export const PAPER = '#f6f3ee';
export const INK = '#2d2a26';
const TRACKING_EM = 0.46;
export const S_HEIGHT = 0.6; // 일반 아이콘: S 잉크 높이 / 타일 높이
export const S_HEIGHT_MASKABLE = 0.48; // 마스커블: 0.6 × 안전 영역 0.8

// Noto Sans KR ExtraLight — advance 와 윤곽 (1000 units/em, y 위쪽)
const GLYPHS = {
  S: {
    advance: 575,
    d: 'M297 -13Q217 -13 155.5 17.5Q94 48 52 97L83 130Q123 85 178.5 58.0Q234 31 297 31Q381 31 430.5 72.0Q480 113 480 178Q480 225 462.0 253.0Q444 281 414.5 298.5Q385 316 348 332L238 381Q207 396 172.5 417.5Q138 439 114.0 473.5Q90 508 90 562Q90 615 117.5 655.0Q145 695 193.0 718.0Q241 741 301 741Q367 741 418.5 715.5Q470 690 503 654L474 622Q443 655 399.5 675.5Q356 696 301 696Q228 696 184.0 660.5Q140 625 140 566Q140 523 160.0 495.5Q180 468 210.0 452.0Q240 436 265 424L375 375Q416 357 451.0 333.0Q486 309 507.0 273.5Q528 238 528 182Q528 127 499.5 82.5Q471 38 419.0 12.5Q367 -13 297 -13Z',
  },
  E: { advance: 567, d: 'M108 0V728H505V685H156V408H449V366H156V42H516V0Z' },
  G: {
    advance: 667,
    d: 'M372 -13Q279 -13 209.0 33.5Q139 80 100.0 165.0Q61 250 61 365Q61 452 84.0 521.0Q107 590 150.0 639.5Q193 689 251.5 715.0Q310 741 382 741Q456 741 503.5 712.5Q551 684 580 654L551 622Q523 652 482.5 674.0Q442 696 383 696Q299 696 238.0 655.5Q177 615 144.5 541.0Q112 467 112 366Q112 264 143.5 189.0Q175 114 234.5 72.5Q294 31 377 31Q426 31 470.0 46.0Q514 61 539 86V315H365V357H588V69Q554 33 499.0 10.0Q444 -13 372 -13Z',
  },
  A: {
    advance: 581,
    d: 'M9 0 266 728H314L571 0H520L373 430Q351 495 331.5 555.0Q312 615 292 682H288Q269 615 249.0 555.0Q229 495 206 430L58 0ZM125 251V292H452V251Z',
  },
  N: {
    advance: 701,
    d: 'M108 0V728H159L468 212L550 68H555Q552 121 549.5 173.5Q547 226 547 278V728H594V0H543L235 515L152 660H148Q151 608 152.5 558.0Q154 508 154 455V0Z',
  },
};

// ── 경로 ────────────────────────────────────────────────────

/** 절대 좌표 M L H V Q C Z 만 (글리프 펜 출력). → [{ op, pts: [[x,y]…] }] */
export function parsePath(d) {
  const tokens = d.match(/[MLHVQCZ]|-?\d*\.?\d+/g);
  const out = [];
  let i = 0;
  let op = null;
  let cur = [0, 0];
  let start = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLHVQCZ]/.test(tokens[i])) op = tokens[i++];
    else if (op === 'M') op = 'L'; // M 뒤에 이어지는 좌표는 L
    if (op === 'Z') {
      out.push({ op: 'Z', pts: [] });
      cur = start;
      continue;
    }
    if (op === 'M' || op === 'L') {
      const p = [num(), num()];
      out.push({ op, pts: [p] });
      if (op === 'M') start = p;
      cur = p;
    } else if (op === 'H') {
      cur = [num(), cur[1]];
      out.push({ op: 'L', pts: [cur] });
    } else if (op === 'V') {
      cur = [cur[0], num()];
      out.push({ op: 'L', pts: [cur] });
    } else if (op === 'Q') {
      const c = [num(), num()];
      cur = [num(), num()];
      out.push({ op: 'Q', pts: [c, cur] });
    } else if (op === 'C') {
      const c1 = [num(), num()];
      const c2 = [num(), num()];
      cur = [num(), num()];
      out.push({ op: 'C', pts: [c1, c2, cur] });
    } else {
      throw new Error(`모르는 경로 명령: ${op}`);
    }
  }
  return out;
}

const mapPath = (cmds, f) => cmds.map((c) => ({ op: c.op, pts: c.pts.map(f) }));

function bounds(cmds) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of cmds)
    for (const [x, y] of c.pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0, y0, x1, y1 };
}

const fmt = (n) => String(Math.round(n * 100) / 100);
function toD(cmds) {
  return cmds
    .map((c) =>
      c.op === 'Z' ? 'Z' : c.op + c.pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join(' ')
    )
    .join('');
}

/** 글리프 S 를 size×size 타일 가운데에, 잉크 높이 = size×ratio 로 (y 아래쪽 픽셀 좌표) */
export function centeredS(size, ratio) {
  const cmds = parsePath(GLYPHS.S.d);
  // 제어점까지 넣은 박스지만 S 는 극점마다 끝점이 있어 잉크 박스와 같다 (52,-13)–(528,741)
  const b = bounds(cmds);
  const s = (size * ratio) / (b.y1 - b.y0);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return mapPath(cmds, ([x, y]) => [size / 2 + (x - cx) * s, size / 2 - (y - cy) * s]);
}

/** 워드마크 SEGAN — 자간 0.46em, 잉크 박스에 꼭 맞게 (y 아래쪽, 단위 = em/100) */
export function wordmark() {
  const scale = 0.1; // 1000 units/em → 100/em
  let pen = 0;
  const all = [];
  for (const ch of 'SEGAN') {
    const g = GLYPHS[ch];
    const x0 = pen;
    all.push(...mapPath(parsePath(g.d), ([x, y]) => [x0 + x, y]));
    pen += g.advance + TRACKING_EM * 1000;
  }
  const b = bounds(all);
  const cmds = mapPath(all, ([x, y]) => [(x - b.x0) * scale, (b.y1 - y) * scale]);
  return { cmds, width: (b.x1 - b.x0) * scale, height: (b.y1 - b.y0) * scale };
}

// ── SVG ─────────────────────────────────────────────────────

export function iconSvg(size = 512, ratio = S_HEIGHT) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" fill="${NAVY}"/>`,
    `<path fill="${PAPER}" d="${toD(centeredS(size, ratio))}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}

export function wordmarkSvg() {
  const { cmds, width, height } = wordmark();
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}" role="img" aria-label="SEGAN">`,
    `<path fill="${INK}" d="${toD(cmds)}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}

// ── 래스터화 ────────────────────────────────────────────────

/** 곡선을 잘게 펴서 모서리 목록으로 (허용 오차 0.02px) */
function edgesOf(cmds) {
  const edges = [];
  let cur = null;
  let start = null;
  const line = (a, b) => {
    if (a[1] === b[1]) return;
    const dir = b[1] > a[1] ? 1 : -1;
    const [p, q] = dir > 0 ? [a, b] : [b, a];
    edges.push({ y0: p[1], y1: q[1], x0: p[0], dxdy: (q[0] - p[0]) / (q[1] - p[1]), dir });
  };
  const steps = (dev) => Math.max(8, Math.ceil(Math.sqrt(dev / (8 * 0.02))));
  for (const c of cmds) {
    if (c.op === 'M') {
      if (cur && start) line(cur, start);
      cur = start = c.pts[0];
    } else if (c.op === 'L') {
      line(cur, c.pts[0]);
      cur = c.pts[0];
    } else if (c.op === 'Q') {
      const [p1, p2] = c.pts;
      const p0 = cur;
      const n = steps(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]));
      let prev = p0;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        const p = [
          u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
          u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ];
        line(prev, p);
        prev = p;
      }
      cur = p2;
    } else if (c.op === 'C') {
      const [p1, p2, p3] = c.pts;
      const p0 = cur;
      const n = steps(
        Math.max(
          Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
          Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1])
        ) * 1.5
      );
      let prev = p0;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const cc = 3 * u * t * t;
        const dd = t * t * t;
        const p = [
          a * p0[0] + b * p1[0] + cc * p2[0] + dd * p3[0],
          a * p0[1] + b * p1[1] + cc * p2[1] + dd * p3[1],
        ];
        line(prev, p);
        prev = p;
      }
      cur = p3;
    } else if (c.op === 'Z') {
      if (cur && start) line(cur, start);
      cur = start;
    }
  }
  return edges;
}

/** non-zero 채우기 덮임률 (w×h, 0~1) */
export function coverage(cmds, w, h, ss = 32) {
  const edges = edgesOf(cmds);
  const cov = new Float32Array(w * h);
  const acc = new Float64Array(w + 1);
  const span = (a, b) => {
    a = Math.max(0, Math.min(w, a));
    b = Math.max(0, Math.min(w, b));
    if (b <= a) return;
    const ia = Math.floor(a);
    const ib = Math.floor(b);
    if (ia === ib) {
      acc[ia] += b - a;
      return;
    }
    acc[ia] += ia + 1 - a;
    for (let c = ia + 1; c < ib; c++) acc[c] += 1;
    if (ib < w) acc[ib] += b - ib;
  };
  for (let row = 0; row < h; row++) {
    acc.fill(0);
    for (let k = 0; k < ss; k++) {
      const y = row + (k + 0.5) / ss;
      const xs = [];
      for (const e of edges)
        if (y >= e.y0 && y < e.y1) xs.push([e.x0 + (y - e.y0) * e.dxdy, e.dir]);
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      let from = 0;
      for (const [x, dir] of xs) {
        const before = wind;
        wind += dir;
        if (before === 0 && wind !== 0) from = x;
        else if (before !== 0 && wind === 0) span(from, x);
      }
    }
    for (let c = 0; c < w; c++) cov[row * w + c] = Math.min(1, acc[c] / ss);
  }
  return cov;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 네이비 타일 + S → RGB 바이트 (불투명) */
export function renderIcon(size, ratio) {
  const cov = coverage(centeredS(size, ratio), size, size);
  const bg = rgb(NAVY);
  const fg = rgb(PAPER);
  const px = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const a = cov[i];
    for (let ch = 0; ch < 3; ch++) px[i * 3 + ch] = Math.round(bg[ch] + (fg[ch] - bg[ch]) * a);
  }
  return px;
}

// ── PNG (RGB 8비트, 행마다 필터 고르기, zlib 9) ─────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(w, h, px) {
  const bpp = 3;
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = up ? up[i] : 0;
        const c = up && i >= bpp ? up[i - bpp] : 0;
        const pred =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 0xff;
        cand[f][i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8비트 · RGB · deflate · 기본 필터 · 인터레이스 없음
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 만들 파일 ───────────────────────────────────────────────

export const PNG_ICONS = [
  { file: 'icon-192.png', size: 192, ratio: S_HEIGHT },
  { file: 'icon-512.png', size: 512, ratio: S_HEIGHT },
  { file: 'icon-maskable-512.png', size: 512, ratio: S_HEIGHT_MASKABLE },
  { file: 'apple-touch-icon.png', size: 180, ratio: S_HEIGHT },
  { file: 'favicon-32.png', size: 32, ratio: S_HEIGHT },
  { file: 'favicon-16.png', size: 16, ratio: S_HEIGHT },
];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const write = (name, data) => {
    const abs = path.join(OUT_DIR, name);
    const same =
      fs.existsSync(abs) && Buffer.compare(fs.readFileSync(abs), Buffer.from(data)) === 0;
    if (!same) fs.writeFileSync(abs, data);
    console.log(`${same ? '  =' : '  ✎'} segan/icons/${name}`);
  };
  write('icon.svg', iconSvg());
  write('wordmark.svg', wordmarkSvg());
  for (const { file, size, ratio } of PNG_ICONS)
    write(file, encodePng(size, size, renderIcon(size, ratio)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
